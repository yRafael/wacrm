// ============================================================
// Conversation meta — pure helpers for the inbox list badges
// (doc Cap. 6 "Lista de conversas": indicadores por conversa).
//
// Turns a contact + its current credential into the small badges
// each list row shows:
//   - Cliente (tem credencial ativa) vs Lead (não tem)
//   - status de vencimento (Vencido / Vence em N dias)
//   - aguardando atendimento (bucket da fila, via queue.ts)
//
// No DB access and no Date injection beyond `now` — deterministic,
// so unit tests can pin the ranges.
// ============================================================

import type { Conversation, IptvCredential } from '@/types';
import { classifyConversation, type QueueBucketKey } from '@/lib/queue/queue';
import { expiryStatus, type ExpiryStatus } from '@/lib/iptv/client-stats';

/** The two commercial buckets a conversation sits in. */
export type ConversationKind = 'client' | 'lead';

/** Any current (non-deleted) credential ⇒ the contact has bought. */
export function conversationKind(
  credential: IptvCredential | null | undefined
): ConversationKind {
  return credential ? 'client' : 'lead';
}

/** Expiry classification of the contact's current credential. */
export function conversationExpiry(
  credential: IptvCredential | null | undefined,
  now: Date
): ExpiryStatus {
  return expiryStatus(credential?.expires_at ?? null, now);
}

/** Which queue bucket the conversation falls into (null = not awaiting). */
export function awaitingBucket(c: Conversation): QueueBucketKey | null {
  return classifyConversation(c);
}
