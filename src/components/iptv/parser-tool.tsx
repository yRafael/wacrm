'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Search, Copy, Check, Save } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  parsePanelText,
  type ParseResult,
} from '@/lib/iptv/parsers';
import {
  buildClientMessage,
  CLIENT_TEMPLATE_DEFAULT,
} from '@/lib/iptv/message-builder';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ContactOption {
  id: string;
  name: string | null;
  phone: string | null;
}

/** Turn a `YYYY-MM-DDTHH:MM` datetime-local value into local-time ISO with
 *  zeroed seconds — the shape the parser produces and the save route expects. */
function toLocalIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours(),
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const STATUS_BADGE: Record<
  ParseResult['status'],
  { label: string; classes: string }
> = {
  success: {
    label: 'statusSuccess',
    classes:
      'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  partial: {
    label: 'statusPartial',
    classes:
      'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  unknown: {
    label: 'statusUnknown',
    classes: 'border-border bg-muted text-muted-foreground',
  },
};

const SOURCE_LABEL: Record<ParseResult['source'], string> = {
  labels: 'sourceLabels',
  url: 'sourceUrl',
  mixed: 'sourceMixed',
  none: 'sourceNone',
};

export function ParserTool() {
  const t = useTranslations('Parser');
  const supabase = createClient();

  // ---- panel text + live parse ------------------------------------------
  const [panelText, setPanelText] = useState('');
  const [result, setResult] = useState<ParseResult>(() =>
    parsePanelText(''),
  );

  // Editable (operator-confirmed) fields. Synced from the parse whenever the
  // pasted text changes; untouched by manual edits in between.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [expiryLocal, setExpiryLocal] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const parsed = parsePanelText(panelText);
    setResult(parsed);
    if (parsed.fields.username) setUsername(parsed.fields.username);
    if (parsed.fields.password) setPassword(parsed.fields.password);
    if (parsed.fields.expiresAt) {
      // YYYY-MM-DDTHH:MM:SS → datetime-local (YYYY-MM-DDTHH:MM)
      setExpiryLocal(parsed.fields.expiresAt.slice(0, 16));
    }
  }, [panelText]);

  // ---- contact picker -----------------------------------------------------
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [contactId, setContactId] = useState<string | null>(null);
  const [contactQuery, setContactQuery] = useState('');
  const [contactOpen, setContactOpen] = useState(false);
  const contactBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('contacts')
      .select('id, name, phone')
      .order('name')
      .limit(500)
      .then(({ data, error }) => {
        if (cancelled || error) return;
        setContacts(data ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (
        contactBoxRef.current &&
        !contactBoxRef.current.contains(e.target as Node)
      ) {
        setContactOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const selectedContact = useMemo(
    () => contacts.find((c) => c.id === contactId) ?? null,
    [contacts, contactId],
  );

  const filteredContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    const list = q
      ? contacts.filter(
          (c) =>
            (c.name?.toLowerCase().includes(q) ?? false) ||
            (c.phone?.includes(q) ?? false),
        )
      : contacts;
    return list.slice(0, 50);
  }, [contacts, contactQuery]);

  function pickContact(c: ContactOption) {
    setContactId(c.id);
    setContactQuery(c.name ?? c.phone ?? '');
    setContactOpen(false);
  }

  // ---- message template + preview -----------------------------------------
  const [template, setTemplate] = useState(CLIENT_TEMPLATE_DEFAULT);
  const [copied, setCopied] = useState(false);

  const preview = useMemo(
    () =>
      buildClientMessage(template, {
        usuario: username || undefined,
        // Raw local ISO — the builder renders {{expiracao}} as DD/MM/YYYY itself.
        expiracao: expiryLocal ? (toLocalIso(expiryLocal) ?? '') : '',
        telefone: selectedContact?.phone ?? undefined,
      }),
    [template, username, expiryLocal, selectedContact],
  );

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(preview);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('saveError'));
    }
  }

  // ---- save ---------------------------------------------------------------
  const [saving, setSaving] = useState(false);

  const canSave = useMemo(() => {
    const expires = expiryLocal ? toLocalIso(expiryLocal) : null;
    return Boolean(contactId && username.trim() && expires);
  }, [contactId, username, expiryLocal]);

  async function handleSave() {
    if (!canSave) return;
    const expires = toLocalIso(expiryLocal);
    setSaving(true);
    try {
      const res = await fetch('/api/iptv/parser/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId,
          username: username.trim(),
          password,
          expires_at: expires,
          input_text: panelText || undefined,
          notes: notes || undefined,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        credential_id?: string;
      };
      if (!res.ok) throw new Error(json.error || t('saveError'));
      toast.success(t('saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  const statusBadge = STATUS_BADGE[result.status];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ============================ INPUT ============================ */}
      <Card>
        <CardHeader>
          <CardTitle>{t('panelInputLabel')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={panelText}
            onChange={(e) => setPanelText(e.target.value)}
            placeholder={t('panelInputPlaceholder')}
            className="min-h-48 font-mono text-xs leading-relaxed"
            aria-label={t('panelInputLabel')}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={statusBadge.classes}>
              {t(statusBadge.label)}
            </Badge>
            <Badge variant="secondary">
              {t('confidence', { value: result.confidence })}
            </Badge>
            <Badge variant="secondary">
              {t('panelType')}: {result.panelType}
            </Badge>
            <Badge variant="secondary">
              {t('source')}: {t(SOURCE_LABEL[result.source])}
            </Badge>
          </div>

          {result.matchedLabels.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">
                {t('matchedLabels')}:
              </span>
              {result.matchedLabels.map((label) => (
                <Badge key={label} variant="ghost">
                  {label}
                </Badge>
              ))}
            </div>
          )}

          {result.errors.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
              <p className="mb-1 font-medium">{t('errorsTitle')}</p>
              <ul className="list-inside list-disc space-y-0.5 text-xs">
                {result.errors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {result.status !== 'unknown' && (
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {t('confidence', { value: result.confidence })}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {result.confidence}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-1.5 rounded-full bg-primary transition-all"
                  style={{ width: `${result.confidence}%` }}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ====================== EXTRACTED FIELDS ======================= */}
      <Card>
        <CardHeader>
          <CardTitle>{t('extractedTitle')}</CardTitle>
          <CardDescription>{t('extractedHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="iptv-username">{t('usernameLabel')}</Label>
              <Input
                id="iptv-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="95184381"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iptv-password">{t('passwordLabel')}</Label>
              <Input
                id="iptv-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="iptv-expiry">{t('expiryLabel')}</Label>
              <Input
                id="iptv-expiry"
                type="datetime-local"
                value={expiryLocal}
                onChange={(e) => setExpiryLocal(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iptv-notes">{t('notesLabel')}</Label>
              <Input
                id="iptv-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* Contact picker */}
          <div className="space-y-1.5" ref={contactBoxRef}>
            <Label htmlFor="iptv-contact">{t('contactLabel')}</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="iptv-contact"
                value={contactQuery}
                onChange={(e) => {
                  setContactQuery(e.target.value);
                  if (e.target.value !== (selectedContact?.name ?? '')) {
                    setContactId(null);
                  }
                  setContactOpen(true);
                }}
                onFocus={() => setContactOpen(true)}
                placeholder={t('contactPlaceholder')}
                className="pl-8"
              />
              {contactOpen && (
                <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-popover shadow-md">
                  {filteredContacts.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      {t('noContacts')}
                    </p>
                  ) : (
                    filteredContacts.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => pickContact(c)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        <span className="truncate">{c.name || '—'}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {c.phone}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <Button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {saving ? t('saving') : t('saveButton')}
          </Button>
        </CardContent>
      </Card>

      {/* ====================== MESSAGE PREVIEW ======================== */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>{t('messageTitle')}</CardTitle>
          <CardDescription>{t('messageHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="iptv-template">{t('templateLabel')}</Label>
            <Textarea
              id="iptv-template"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="min-h-44 font-mono text-xs leading-relaxed"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>{t('previewLabel')}</Label>
              <Button
                variant="outline"
                size="xs"
                onClick={copyMessage}
                disabled={!preview}
              >
                {copied ? (
                  <Check className="size-3" />
                ) : (
                  <Copy className="size-3" />
                )}
                {copied ? t('copied') : t('copyMessage')}
              </Button>
            </div>
            <div className="min-h-44 rounded-lg border border-border bg-muted/40 p-3 whitespace-pre-wrap text-sm text-foreground">
              {preview}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
