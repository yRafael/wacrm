'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Notification } from '@/types';

/**
 * Count of unread notifications for the current user. Used by the
 * sidebar to surface a badge on the Notifications nav entry and by the
 * Pulse page to headline "alertas".
 *
 * RLS on `notifications` already scopes every read to `auth.uid() =
 * user_id`, so no explicit filter is needed here — same pattern as
 * `useTotalUnread` for conversations.
 *
 * ------------------------------------------------------------------
 * Shared subscription (why this is module-scoped):
 *
 * The sidebar (always mounted in the dashboard layout) and the Pulse
 * page both render this hook against the same singleton supabase
 * client (see `@/lib/supabase/client`). supabase-js keys realtime
 * channels per client by name, so a second instance calling
 * `.channel("notifications-unread-count")` would receive the
 * already-subscribed channel and throw ("cannot add postgres_changes
 * callbacks after subscribe()"). Instead of one channel per instance,
 * a single channel is booted on first use and every consumer reads the
 * shared count through a tiny listener store. The channel lives for the
 * whole session, so the count never drifts between mounts.
 * ------------------------------------------------------------------
 */

type Listener = (count: number) => void;

const listeners = new Set<Listener>();
let currentCount = 0;
let booting: Promise<void> | null = null;

function notify() {
  for (const fn of listeners) fn(currentCount);
}

async function bootChannel(): Promise<void> {
  const supabase = createClient();

  // Dev Fast Refresh re-runs this module, which resets the module-level
  // `booting` above — but the singleton client still holds the previously
  // subscribed channel. Reuse it instead of re-adding an `on()` to an
  // already-subscribed channel (which throws).
  const existing = supabase
    .getChannels()
    .find((c) => c.topic === 'realtime:notifications-unread-count');
  if (existing) return;

  // Initial count (head:true skips fetching rows — we only need the
  // `count` supabase-js returns alongside the empty response body).
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .is('read_at', null);
  if (!error && count != null) {
    currentCount = count;
    notify();
  }

  supabase
    .channel('notifications-unread-count')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications' },
      (payload) => {
        if (payload.eventType === 'INSERT') {
          const row = payload.new as Notification;
          if (!row.read_at) currentCount += 1;
        } else if (payload.eventType === 'UPDATE') {
          // Updates here only ever set read_at (marking a notification
          // read). Derive purely from the new row so we don't rely on
          // payload.old columns, which require REPLICA IDENTITY FULL.
          const newRow = payload.new as Notification;
          if (newRow.read_at) currentCount = Math.max(0, currentCount - 1);
        } else if (payload.eventType === 'DELETE') {
          const oldRow = payload.old as Partial<Notification>;
          if (!oldRow.read_at) currentCount = Math.max(0, currentCount - 1);
        }
        notify();
      }
    )
    .subscribe();
}

export function useUnreadNotifications(): number {
  const [count, setCount] = useState(currentCount);

  useEffect(() => {
    const listener: Listener = (n) => setCount(n);
    listeners.add(listener);

    if (!booting) {
      booting = bootChannel().catch((err) => {
        console.error('[unread-notifications] realtime failed:', err);
        // Allow a later mount to retry a transient failure.
        booting = null;
      });
    }

    return () => {
      listeners.delete(listener);
    };
  }, []);

  return count;
}
