// ============================================================
// Queue actions — mutações da fila de atendimento.
//
// Assumir é um update direto em `assigned_agent_id`, mesmo padrão
// do thread (message-thread.tsx). RLS escopa por conta, então não
// passamos account_id. O componente decide o toast (i18n), aqui
// só reportamos sucesso/erro.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Atribui uma conversa aberta ao operador logado. Retorna `true`
 * se a atribuição persistiu; `false` em erro (logado no console
 * com detalhes explícitos — erros do Supabase têm props não
 * enumeráveis).
 */
export async function claimConversation(
  db: SupabaseClient,
  conversationId: string,
  userId: string
): Promise<boolean> {
  const { error } = await db
    .from('conversations')
    .update({ assigned_agent_id: userId })
    .eq('id', conversationId);

  if (error) {
    console.error('[queue] claim failed:', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
    return false;
  }
  return true;
}
