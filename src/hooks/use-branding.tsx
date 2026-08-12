'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { getBranding } from '@/lib/branding/queries';
import { buildColorTokens, type Branding } from '@/lib/branding/types';

// ============================================================
// BrandProvider — per-company identity at runtime.
//
// Mounted between AuthProvider and the dashboard inner shell. Once the
// user's account is known it loads `account_branding` for THAT account
// (RLS guarantees it's the caller's own) and overlays the company's
// color tokens onto <html> via inline style — which always wins over
// the `html[data-theme='…']` attribute blocks, so the brand accent
// overrides the per-user Aparência picker as confirmed with Rafael.
//
// Two responsibilities:
//   1. Apply/remove the CSS var overrides (buildColorTokens).
//   2. Expose `branding` so surfaces (sidebar logo, chat backdrop,
//      dashboard banner) render the company identity.
//
// The .then() chain pattern keeps setState out of the effect body's
// synchronous path (react-hooks/set-state-in-effect), matching
// catalog-settings / fire-hero.
// ============================================================

interface BrandingContextValue {
  /** The account's branding, or null when it never customized anything. */
  branding: Branding | null;
  /** True once the first load settles (success or null). Gates flash. */
  brandingSettled: boolean;
  /** Re-fetch + re-apply — call after saving in the Personalização panel. */
  refreshBranding: () => Promise<void>;
  /** Remove every CSS var override, restoring the Fire identity. */
  clearOverrides: () => void;
}

const BrandingContext = createContext<BrandingContextValue | null>(null);

/** CSS vars applied by buildColorTokens — tracked to remove stale ones. */
const TOKEN_KEYS = [
  '--primary',
  '--primary-hover',
  '--primary-soft',
  '--primary-soft-2',
  '--ring',
  '--chart-1',
  '--chart-2',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-ring',
] as const;

export function BrandProvider({ children }: { children: ReactNode }) {
  const { accountId } = useAuth();
  const supabase = createClient();

  const [branding, setBranding] = useState<Branding | null>(null);
  const [brandingSettled, setBrandingSettled] = useState(false);

  const clearOverrides = useCallback(() => {
    const style = document.documentElement.style;
    for (const key of TOKEN_KEYS) {
      if (style.getPropertyValue(key)) style.removeProperty(key);
    }
  }, []);

  const load = useCallback(() => {
    if (!accountId) return Promise.resolve();
    return getBranding(supabase, accountId)
      .then((b) => {
        setBranding(b);
        // Apply or clear the color overrides in one pass.
        const tokens = buildColorTokens(b?.config.colors ?? {});
        const style = document.documentElement.style;
        for (const key of TOKEN_KEYS) {
          const value = tokens[key] ?? '';
          if (value) style.setProperty(key, value);
          else style.removeProperty(key);
        }
        setBrandingSettled(true);
      })
      .catch((err) => {
        // Fail-soft: a branding hiccup never blanks the app's theme.
        console.warn('[branding] load failed:', err);
        setBrandingSettled(true);
      });
  }, [accountId, supabase]);

  // Load whenever the account resolves.
  useEffect(() => {
    void load();
  }, [load]);

  // Realtime: when an admin saves the panel, open tabs re-apply without
  // a reload. Debounced so a burst of UPDATEs coalesces into one fetch.
  useEffect(() => {
    if (!accountId) return;
    const channel = supabase
      .channel(`branding-${accountId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'account_branding',
          filter: `account_id=eq.${accountId}`,
        },
        () => {
          // Ignore the echo of our own save — the panel calls
          // refreshBranding explicitly. This only catches OTHER sessions
          // (a teammate saving while this tab is open).
          void load();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, load, supabase]);

  const refreshBranding = useCallback(() => load(), [load]);

  const value = useMemo(
    () => ({ branding, brandingSettled, refreshBranding, clearOverrides }),
    [branding, brandingSettled, refreshBranding, clearOverrides]
  );

  return (
    <BrandingContext.Provider value={value}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) {
    throw new Error('useBranding must be used within <BrandProvider>');
  }
  return ctx;
}
