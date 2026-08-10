import { NextResponse } from 'next/server'

// The Meta Cloud API webhook is DISABLED — this app talks to WhatsApp
// through the Baileys worker (`src/whatsapp/worker.ts`), which runs the
// same inbound-processing routines (`src/lib/whatsapp/inbound-process.ts`)
// and writes directly into `whatsapp_sessions` / `messages`. The former
// Meta implementation (signature verification, template events, flows/AI
// dispatch) still lives in `src/lib/whatsapp/*` but is dormant.
//
// Any traffic that still reaches this URL is answered 410 so the failure
// is loud instead of silently eating events. A Meta callback that keeps
// retrying should be disabled in the Meta dashboard / unsubscribed.
export const maxDuration = 60

const GONE_BODY = {
  error: 'Gone',
  message:
    'The Meta Cloud API webhook is disabled. Inbound WhatsApp is handled by the Baileys worker (whatsapp_sessions).',
}

// GET — former webhook verification handshake.
export async function GET() {
  return NextResponse.json(GONE_BODY, { status: 410 })
}

// POST — former inbound message delivery.
export async function POST() {
  return NextResponse.json(GONE_BODY, { status: 410 })
}
