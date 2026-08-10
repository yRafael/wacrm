// ============================================================
// Baileys session paths — the ONLY module that knows where auth
// state lives on disk. Kept free of any `@whiskeysockets/baileys`
// import so a Next.js route can clear a session's auth dir without
// dragging Baileys into the app bundle: `session-manager.ts`
// (worker-only, imports Baileys) re-exports from here, and the
// `/api/whatsapp/sessions/[id]` route imports this directly.
//
// Layout: <WA_SESSION_DIR>/<accountId>/<sessionId>/
// gitignored; see useMultiFileAuthState.
// ============================================================

export const WA_SESSION_DIR = process.env.WA_SESSION_DIR || './wa-sessions';

/** Directory holding one subfolder per session's auth state. */
export function sessionAuthDir(accountId: string, sessionId: string): string {
  return `${WA_SESSION_DIR}/${accountId}/${sessionId}`;
}
