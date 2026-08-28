// ============================================================
// Queue helpers — fila de atendimento (pure, unit-testable).
//
// Classifica cada conversa aberta em um dos dois buckets que a
// página /queue exibe:
//   'unassigned' — conversa aberta sem `assigned_agent_id`
//                  (ninguém assumiu ainda). Tem prioridade: mesmo
//                  com cliente aguardando, ela aparece aqui.
//   'waiting'    — assumida, mas com `unread_count > 0`: o cliente
//                  mandou a última mensagem e aguarda o operador.
//
// Conversas fechadas/pending ficam de fora — a fila só mostra o
// que pede ação agora. `buildQueue` filtra + ordena cada bucket
// por `last_message_at` desc (mais recente primeiro).
// ============================================================

import type { Conversation } from '@/types';

/** Buckets exibidos na fila de atendimento. */
export type QueueBucketKey = 'unassigned' | 'waiting';

/**
 * Classifica uma conversa no bucket da fila (ou `null` se ela não
 * pertence a nenhum — status != 'open'). Unassigned tem prioridade
 * sobre waiting.
 */
export function classifyConversation(c: Conversation): QueueBucketKey | null {
  if (c.status !== 'open') return null;
  if (!c.assigned_agent_id) return 'unassigned';
  if (c.unread_count > 0) return 'waiting';
  return null;
}

export interface QueueBuckets {
  unassigned: Conversation[];
  waiting: Conversation[];
}

/** Timestamp de ordenação de uma conversa (ms). `last_message_at`
 *  é o sinal de recência; cai para updated/created quando vazio e
 *  para 0 quando o valor é inválido (vai pro fim da lista). */
function recency(c: Conversation): number {
  const ts = c.last_message_at ?? c.updated_at ?? c.created_at;
  const t = new Date(ts).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function byMostRecent(a: Conversation, b: Conversation): number {
  return recency(b) - recency(a);
}

/** Separa as conversas nos buckets e ordena cada um por recência. */
export function buildQueue(conversations: Conversation[]): QueueBuckets {
  const unassigned: Conversation[] = [];
  const waiting: Conversation[] = [];
  for (const c of conversations) {
    const bucket = classifyConversation(c);
    if (bucket === 'unassigned') unassigned.push(c);
    else if (bucket === 'waiting') waiting.push(c);
  }
  return {
    unassigned: unassigned.sort(byMostRecent),
    waiting: waiting.sort(byMostRecent),
  };
}
