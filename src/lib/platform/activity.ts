export interface ActivityItem {
  id: string;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export function getActionIcon(action: string): string {
  const a = action.toLowerCase();
  if (a.includes('create') || a.includes('suspenso')) return '🟢';
  if (a.includes('plan') || a.includes('change')) return '🟣';
  if (a.includes('login')) return '🔵';
  if (a.includes('ban') || a.includes('fail')) return '🔴';
  return '📝';
}

export function formatRelativeTime(date: string): string {
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 60) return `${minutes} minuto${minutes !== 1 ? 's' : ''} atrás`;
  if (hours < 24) return `${hours} hora${hours !== 1 ? 's' : ''} atrás`;
  if (days < 7) return `${days} dia${days !== 1 ? 's' : ''} atrás`;
  return new Date(date).toLocaleDateString('pt-BR');
}
