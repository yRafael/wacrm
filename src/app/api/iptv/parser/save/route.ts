import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { parsePanelText } from '@/lib/iptv/parsers';
import { encrypt } from '@/lib/whatsapp/encryption';

// Fase 2 — the credential save boundary. The operator pasted the panel's
// paid-customer message, the parser extracted the fields, and this route
// persists them:
//
//   1. iptv_credentials — one active row per (account, contact). The
//      password is ENCRYPTED at rest (AES-256-GCM) and never echoed back.
//   2. parser_logs — append-only audit of the extraction. `parsed_fields`
//      intentionally excludes the password (username + expiry are enough
//      to debug a parse).
//
// The route re-runs `parsePanelText` on `input_text` when the operator
// pasted a panel message, so the log reflects the same logic the UI
// previewed. The credential row itself is built from the operator's
// confirmed fields, so manual overrides (typed credentials, no panel
// message) still save.
//
// RLS: insert/update on iptv_credentials requires agent membership — this
// is the operator workflow. The message built for the customer NEVER
// contains the password (see src/lib/iptv/message-builder.ts).

const PANEL_TYPES = ['sigma', 'xtream', 'xui', 'horus', 'generic'] as const;

/**
 * Turn the client-supplied expiry into a UTC timestamp for the DB.
 * A zone-less string ("2026-08-09T20:07:00") is interpreted in the
 * server's local time, matching how the browser previewed it.
 */
function normalizeExpiry(value: string): string | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

interface SaveBody {
  contact_id?: string;
  username?: string;
  password?: string;
  expires_at?: string;
  panel_type?: string;
  duration_days?: number;
  notes?: string;
  /** Optional raw panel message; re-parsed for the parser_logs audit row. */
  input_text?: string;
}

export async function POST(request: Request) {
  try {
    // Defense-in-depth: requireRole validates auth + account + role + subscription
    // in one round trip, replacing the manual getUser()/resolveAccountId() pattern.
    const ctx = await requireRole('agent');

    // Per-user rate limit. 30/min comfortably covers an operator working
    // a handful of panel messages while bounding a scripted paste loop.
    const limit = checkRateLimit(`parser:${ctx.userId}`, RATE_LIMITS.parser);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const accountId = ctx.accountId;

    const body = (await request.json()) as SaveBody;
    const {
      contact_id: contactId,
      username,
      password,
      expires_at: expiresAt,
      panel_type: panelType,
      duration_days: durationDays,
      notes,
      input_text: inputText,
    } = body;

    if (!contactId || !username || !expiresAt) {
      return NextResponse.json(
        { error: 'contact_id, username and expires_at are required' },
        { status: 400 }
      );
    }

    // Validate the panel family hint before it reaches the DB CHECK.
    if (
      panelType &&
      !PANEL_TYPES.includes(panelType as (typeof PANEL_TYPES)[number])
    ) {
      return NextResponse.json(
        { error: `Unknown panel_type "${panelType}"` },
        { status: 400 }
      );
    }

    if (
      durationDays !== undefined &&
      (!Number.isInteger(durationDays) || durationDays < 1)
    ) {
      return NextResponse.json(
        { error: 'duration_days must be a positive integer' },
        { status: 400 }
      );
    }

    const expiresAtUtc = normalizeExpiry(expiresAt);
    if (!expiresAtUtc) {
      return NextResponse.json(
        { error: `Invalid expires_at "${expiresAt}"` },
        { status: 400 }
      );
    }

    // The credential is linked to a contact inside the caller's account —
    // verify ownership before writing anything (a caller can't attach
    // credentials to someone else's contact).
    const { data: contactRow, error: contactErr } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (contactErr || !contactRow) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    // ---- parser_logs audit row -------------------------------------------
    // Re-run the parse on the pasted text (when provided) so the log shows
    // exactly what the parser produced — same code the UI previewed. The
    // password is deliberately kept OUT of parsed_fields.
    let parserLogId: string | undefined;
    if (inputText) {
      const parsed = parsePanelText(inputText);
      parserLogId = crypto.randomUUID();

      const logStatus =
        parsed.status === 'success'
          ? 'success'
          : parsed.status === 'partial'
            ? 'partial'
            : 'error';

      await ctx.supabase.from('parser_logs').insert({
        id: parserLogId,
        account_id: accountId,
        contact_id: contactId,
        input_text: inputText,
        parsed_fields: {
          username: parsed.fields.username,
          expiresAt: parsed.fields.expiresAt,
          panelType: parsed.panelType,
        },
        confidence: parsed.confidence,
        status: logStatus,
        error: parsed.errors.length ? parsed.errors.join('; ') : null,
      });
    }

    // ---- iptv_credentials upsert -----------------------------------------
    // One active row per (account, contact). Mutate in place when a row
    // exists (renewal/refresh), otherwise insert.
    const credentialPayload = {
      account_id: accountId,
      contact_id: contactId,
      username,
      // Encrypt at the boundary: plaintext never touches the DB.
      ...(password ? { password: encrypt(password) } : {}),
      expires_at: expiresAtUtc,
      ...(panelType ? { panel_type: panelType } : {}),
      ...(durationDays !== undefined ? { duration_days: durationDays } : {}),
      ...(notes ? { notes } : {}),
      status: 'active',
    };

    const { data: existing } = await ctx.supabase
      .from('iptv_credentials')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .is('deleted_at', null)
      .maybeSingle();

    let credentialId: string;
    let credentialError: { message: string } | null = null;

    if (existing) {
      const { data, error } = await ctx.supabase
        .from('iptv_credentials')
        .update(credentialPayload)
        .eq('id', existing.id)
        .select('id')
        .single();
      credentialId = data?.id ?? existing.id;
      credentialError = error;
    } else {
      const { data, error } = await ctx.supabase
        .from('iptv_credentials')
        .insert(credentialPayload)
        .select('id')
        .single();
      credentialId = data?.id;
      credentialError = error;
    }

    if (credentialError || !credentialId) {
      console.error('Error saving IPTV credential:', credentialError?.message ?? 'unknown');
      return NextResponse.json(
        { error: 'Failed to save credential' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      credential_id: credentialId,
      ...(parserLogId ? { parser_log_id: parserLogId } : {}),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
