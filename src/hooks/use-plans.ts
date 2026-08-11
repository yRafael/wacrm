'use client';

// ============================================================
// usePlans — the account's active plan catalog, shared by every
// consumer in the conversation (header ⚡ Ações plan picker, header
// Plano selector, subscription card). Module-level cache keyed by
// account so the thread header and the contact sidebar mount the
// hook independently but only fetch once per account.
//
// Also fires `ensure_default_plans` (the 043 RPC) on first load so a
// fresh account gets Mensal/Trimestral/Semestral/Anual without any
// admin setup — fail-soft, so an agent calling the admin-tier RPC
// just logs and reads whatever the account already has.
// ============================================================

import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { ensureDefaultPlans, listPlans } from '@/lib/iptv/plans';
import type { Plan } from '@/types';

const cache = new Map<string, Plan[]>();

export function usePlans(accountId: string | undefined): Plan[] {
  const [plans, setPlans] = useState<Plan[]>(() =>
    accountId ? (cache.get(accountId) ?? []) : []
  );

  useEffect(() => {
    if (!accountId) return;
    // Cache hit: the lazy initializer already read the cache, so state is
    // correct as mounted — no setState needed (calling it synchronously
    // here trips react-hooks/set-state-in-effect).
    if (cache.has(accountId)) return;
    let cancelled = false;
    const db = createClient();
    (async () => {
      await ensureDefaultPlans(db, accountId);
      const loaded = await listPlans(db, accountId);
      if (cancelled) return;
      cache.set(accountId, loaded);
      setPlans(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return plans;
}
