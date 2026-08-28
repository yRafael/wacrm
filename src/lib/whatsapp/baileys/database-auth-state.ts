// ============================================================
// Database-backed auth state adapter for Baileys.
//
// Replaces `useMultiFileAuthState` (disk-based) with a Supabase
// adapter so credentials survive container restarts / deploys.
//
// Usage:
//   const { state, saveCreds } = await useDatabaseAuthState(
//     supabaseAdmin(), sessionId, accountId
//   );
//   const sock = makeWASocket({ auth: state, ... });
//   sock.ev.on('creds.update', saveCreds);
//
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AuthenticationState,
  SignalKeyStore,
  SignalDataSet,
} from '@whiskeysockets/baileys/lib/Types';
import { initAuthCreds, proto } from '@whiskeysockets/baileys';
import { BufferJSON } from '@whiskeysockets/baileys/lib/Utils';

// ------------------------------------------------------------
// Types for the DB rows
// ------------------------------------------------------------

interface SessionCredsRow {
  id: string;
  session_id: string;
  account_id: string;
  creds: Record<string, unknown>;
}

interface SessionKeyRow {
  id: string;
  session_id: string;
  account_id: string;
  key_type: string;
  key_id: string;
  data: unknown;
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/** Serialize a value to JSON using Baileys' BufferJSON reviver. */
function bufferJsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return { type: 'Buffer', data: Array.from(value) };
  }
  return value;
}

/** Deserialize a value from JSON using Baileys' BufferJSON replacer. */
function bufferJsonReviver(_key: string, value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    (value as { type?: string }).type === 'Buffer' &&
    Array.isArray((value as { data?: number[] }).data)
  ) {
    return Buffer.from((value as { data: number[] }).data);
  }
  return value;
}

/** Deep-clone + serialize creds for DB storage. */
function serializeCreds(creds: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(creds, bufferJsonReplacer));
}

/** Deserialize creds from DB, restoring Uint8Array/Buffer fields. */
function deserializeCreds(raw: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(raw), bufferJsonReviver);
}

// ------------------------------------------------------------
// Main adapter
// ------------------------------------------------------------

/**
 * Database-backed auth state for Baileys.
 *
 * Stores credentials (`creds`) in `whatsapp_session_creds` and
 * signal/pre-key/session keys in `whatsapp_session_keys`. Both
 * tables are scoped by `(session_id, account_id)`.
 */
export async function useDatabaseAuthState(
  db: SupabaseClient,
  sessionId: string,
  accountId: string
): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  // ----------------------------------------------------------
  // 1. Load or initialize creds
  // ----------------------------------------------------------
  const { data: credsRow } = await db
    .from('whatsapp_session_creds')
    .select('creds')
    .eq('session_id', sessionId)
    .maybeSingle();

  const creds = credsRow?.creds
    ? deserializeCreds(credsRow.creds as Record<string, unknown>)
    : initAuthCreds();

  // ----------------------------------------------------------
  // 2. Build the SignalKeyStore backed by whatsapp_session_keys
  // ----------------------------------------------------------

  // In-memory cache to avoid repeated DB reads during a single
  // socket lifecycle. Populated lazily on first `get()`.
  const keyCache = new Map<string, unknown>();
  let cacheLoaded = false;

  async function loadKeyCache(): Promise<void> {
    if (cacheLoaded) return;
    try {
      const { data: rows, error } = await db
        .from('whatsapp_session_keys')
        .select('key_type, key_id, data')
        .eq('session_id', sessionId);

      if (error) {
        console.error(`[db-auth] failed to load keys for session ${sessionId}:`, error);
        // Still mark as loaded to avoid repeated failed queries —
        // Baileys will re-key as needed.
      }

      for (const row of (rows ?? []) as SessionKeyRow[]) {
        const cacheKey = `${row.key_type}:${row.key_id}`;
        keyCache.set(cacheKey, row.data);
      }
    } catch (err) {
      console.error(`[db-auth] exception loading keys for session ${sessionId}:`, err);
    }
    cacheLoaded = true;
  }

  const keys: SignalKeyStore = {
    async get<T extends string>(type: T, ids: string[]) {
      await loadKeyCache();
      const result: Record<string, unknown> = {};
      for (const id of ids) {
        const cacheKey = `${type}:${id}`;
        const raw = keyCache.get(cacheKey);
        if (raw !== undefined) {
          // app-state-sync-key needs proto deserialization
          if (type === 'app-state-sync-key') {
            result[id] = proto.Message.AppStateSyncKeyData.fromObject(
              JSON.parse(JSON.stringify(raw), bufferJsonReviver)
            );
          } else {
            result[id] = JSON.parse(
              JSON.stringify(raw),
              bufferJsonReviver
            );
          }
        }
      }
      return result as { [id: string]: T extends keyof import('@whiskeysockets/baileys/lib/Types').SignalDataTypeMap ? import('@whiskeysockets/baileys/lib/Types').SignalDataTypeMap[T] : never };
    },

    async set(data: SignalDataSet) {
      const updates: Array<{
        session_id: string;
        account_id: string;
        key_type: string;
        key_id: string;
        data: unknown;
      }> = [];
      const deletes: Array<{
        session_id: string;
        key_type: string;
        key_id: string;
      }> = [];

      for (const [type, entries] of Object.entries(data)) {
        if (!entries) continue;
        for (const [id, value] of Object.entries(entries)) {
          const cacheKey = `${type}:${id}`;
          if (value === null || value === undefined) {
            // Delete
            keyCache.delete(cacheKey);
            deletes.push({ session_id: sessionId, key_type: type, key_id: id });
          } else {
            // Upsert
            const serialized = JSON.parse(
              JSON.stringify(value, bufferJsonReplacer)
            );
            keyCache.set(cacheKey, serialized);
            updates.push({
              session_id: sessionId,
              account_id: accountId,
              key_type: type,
              key_id: id,
              data: serialized,
            });
          }
        }
      }

      // Batch upserts
      if (updates.length > 0) {
        await db
          .from('whatsapp_session_keys')
          .upsert(updates, {
            onConflict: 'session_id,key_type,key_id',
            ignoreDuplicates: false,
          });
      }

      // Batch deletes
      if (deletes.length > 0) {
        // Delete one by one since Supabase doesn't support multi-column
        // IN clauses without RPC. Use a single RPC call for efficiency.
        for (const d of deletes) {
          await db
            .from('whatsapp_session_keys')
            .delete()
            .eq('session_id', d.session_id)
            .eq('key_type', d.key_type)
            .eq('key_id', d.key_id);
        }
      }
    },
  };

  // ----------------------------------------------------------
  // 3. saveCreds — persist the current creds object to DB
  // ----------------------------------------------------------
  async function saveCreds(): Promise<void> {
    const serialized = serializeCreds(creds as unknown as Record<string, unknown>);
    await db
      .from('whatsapp_session_creds')
      .upsert(
        {
          session_id: sessionId,
          account_id: accountId,
          creds: serialized,
        },
        { onConflict: 'session_id' }
      );
  }

  return {
    state: { creds: creds as AuthenticationState['creds'], keys },
    saveCreds,
  };
}
