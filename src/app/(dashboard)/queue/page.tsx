'use client';

// ============================================================
// Queue page — fila de atendimento (/queue).
//
// Carrega as conversas abertas (`status = open`) com o embute de
// contato e normaliza via `normalizeConversations`. Um canal
// Realtime (`queue-live`) no `conversations` recarrega com debounce
// de 800ms quando qualquer conversa muda — assumir por outro
// operador, nova mensagem do cliente etc. mantêm a fila viva sem
// refetch a cada evento.
//
// A classificação em buckets é pura (src/lib/queue/queue.ts) e
// fica no QueueBoard; esta página só entrega os dados + reload.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  CONVERSATION_SELECT,
  normalizeConversations,
} from '@/lib/inbox/conversations';
import { QueueBoard } from '@/components/queue/queue-board';
import { useTranslations } from 'next-intl';
import type { Conversation } from '@/types';

/** Coalesce bursts — Realtime costuma disparar vários eventos de uma vez. */
const RELOAD_DEBOUNCE_MS = 800;

export default function QueuePage() {
  const t = useTranslations('Queue');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  // Timer de debounce para o efeito de Realtime abaixo.
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cadeia de .then() (padrão fire-hero): o setState fica nos
  // callbacks, fora do caminho de react-hooks/set-state-in-effect.
  // O builder do Supabase só é PromiseLike, então o setLoading vai
  // aqui dentro (não dá pra encadear .finally() depois do .then()).
  const loadQueue = useCallback(() => {
    const db = createClient();
    void db
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('status', 'open')
      .order('last_message_at', { ascending: false })
      .then(({ data, error }) => {
        setLoading(false);
        if (error) {
          console.error('[queue] load failed:', {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
          });
          return;
        }
        setConversations(normalizeConversations(data ?? []));
      });
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Live refresh: um canal no `conversations`, eventos de qualquer
  // tipo coalescidos num único reload. `loadQueue` é estável, então
  // o canal é montado uma vez e o timer é derrubado no unmount.
  useEffect(() => {
    const supabase = createClient();

    const scheduleReload = () => {
      if (reloadTimerRef.current) return;
      reloadTimerRef.current = setTimeout(() => {
        reloadTimerRef.current = null;
        loadQueue();
      }, RELOAD_DEBOUNCE_MS);
    };

    const channel = supabase.channel('queue-live');
    channel
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        scheduleReload
      )
      .subscribe();

    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [loadQueue, reloadTimerRef]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-foreground text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('description')}</p>
      </div>

      <QueueBoard
        conversations={conversations}
        loading={loading}
        onReload={loadQueue}
      />
    </div>
  );
}
