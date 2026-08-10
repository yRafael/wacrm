// ============================================================
// Fire Pulse — data types
//
// Fire Pulse is the operator's "o que está acontecendo?" panel
// (Dashboard = "Como estamos?" · Pulse = "O que está acontecendo?").
// The data layer returns SEMANTIC fields; components compose the
// translated strings from them, so nothing here leaks a locale.
// ============================================================

export interface PulseMetrics {
  /** Open conversations (being handled). */
  atendimento: number;
  /** Of those, how many have an unread customer message waiting. */
  atendimentoAguardando: number;
  /** Completed renewals created today (renewals.created_at in local day). */
  renovacoesHoje: number;
  /** Active credentials whose expiry lands today (local day). */
  vencendoHoje: number;
  /** Active credentials expiring tomorrow. */
  vencendoAmanha: number;
  /** Active credentials already past their expiry date. */
  vencendoAtrasadas: number;
}

export interface DueCredential {
  id: string;
  contactId: string;
  /** Contact display name (falls back to phone in the loader). */
  contactName: string;
  /** ISO timestamp of `expires_at`. */
  expiresAt: string;
  /** True when `expires_at` is before the start of today (already late). */
  overdue: boolean;
}

export interface PendingPayment {
  id: string;
  contactId: string;
  /** Contact display name (falls back to phone in the loader). */
  contactName: string;
  amount: number;
  /** ISO timestamp of `due_at`. */
  dueAt: string;
  status: "pending" | "late" | "partial";
  /** True when `due_at` is before now (payment overdue). */
  overdue: boolean;
}

export interface PulsePriorities {
  /** Active credentials overdue or expiring today, earliest first. */
  due: DueCredential[];
  /** Open receivables (pending/late/partial), earliest due first. */
  payments: PendingPayment[];
}

export type PulseActivityKind = "renewal" | "payment" | "alert" | "credential";

export interface PulseActivityItem {
  id: string;
  kind: PulseActivityKind;
  /** ISO timestamp the event happened. */
  at: string;
  /** Where the row links to (null → non-clickable). */
  href?: string;
  /** Contact name, when the event has one. */
  contactName?: string;
  /** Money amount, when the event has one. */
  amount?: number;
  /** Notification title/body, when kind === 'alert'. */
  title?: string;
  body?: string;
}

export interface OperatorLoad {
  userId: string;
  name: string;
  avatarUrl: string | null;
  /** Open conversations assigned to this operator. */
  atendimentos: number;
  /** Of those, how many have an unread customer message waiting. */
  pendentes: number;
}

export interface PulseOperators {
  operators: OperatorLoad[];
  /** Open conversations with no assigned agent. */
  unassigned: { atendimentos: number; pendentes: number };
}
