/**
 * Client-side security event logger.
 *
 * Fire-and-forget: logs events to the backend audit_logs table
 * without blocking the UI. Failures are silently ignored — this
 * is dissuasion/monitoring, not security enforcement.
 */

interface SecurityEventPayload {
  action: string;
  metadata?: Record<string, unknown>;
}

export async function logSecurityEvent(
  payload: SecurityEventPayload
): Promise<void> {
  try {
    await fetch('/api/security/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // Fire-and-forget: don't await response
    });
  } catch {
    // Silently ignore — logging failure must never block the UI
  }
}
