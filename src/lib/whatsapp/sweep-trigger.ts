// ============================================================
// Sweep trigger — file-based IPC between the Next.js API routes
// and the WhatsApp worker process.
//
// The API route writes a trigger file after creating/refreshing a
// session; the worker checks for it every 1s and runs an immediate
// sweep instead of waiting up to 15s for the next scheduled sweep.
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';

const SWEEP_TRIGGER_PATH = path.join(
  process.env.TMPDIR ?? process.env.TEMP ?? '/tmp',
  'wa-worker-sweep-trigger'
);

/** Write a trigger file so the next worker sweep cycle runs immediately. */
export function triggerSweep(): void {
  try {
    fs.writeFileSync(SWEEP_TRIGGER_PATH, Date.now().toString());
  } catch {
    // Best-effort — if the file can't be written, the normal sweep
    // interval will catch the session eventually.
  }
}

/** Check and consume the sweep trigger. Returns true if triggered. */
export function consumeSweepTrigger(): boolean {
  try {
    fs.unlinkSync(SWEEP_TRIGGER_PATH);
    return true;
  } catch {
    return false;
  }
}
