import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for the Fase 2 credential save boundary. The route must:
//   - encrypt the password at rest (never store it in the clear),
//   - re-run the parser on the pasted text for the parser_logs audit row,
//     WITHOUT duplicating the password into that log,
//   - keep one active credential row per (account, contact) — updating in
//     place when one exists, inserting otherwise,
//   - reject a contact that isn't in the caller's account.
// ---------------------------------------------------------------------------

// Records of what the route wrote, so we can assert the right rows landed.
const iptvCredentialInserts: Array<Record<string, unknown>> = []
const iptvCredentialUpdates: Array<Record<string, unknown>> = []
const parserLogInserts: Array<Record<string, unknown>> = []

// Toggles for the per-test scenario.
let existingCredential: Record<string, unknown> | null = null
let contactRow: Record<string, unknown> | null = null
let unauthenticated = false

const CONTACT = { id: 'contact-1', account_id: 'acct-1', phone: '+5511999999999' }

// A realistic panel message (same shape as the operator's Exemplo 1).
const PANEL_MSG = `*Bem-vindo a fire tv*

Usuario: 95184381
Senha: 85219891
Sua assinatura vence dia: 09/08/2026 20:07

Link M3U HLS:
http://cdn.truedtv.com.br/get.php?username=95184381&password=85219891&type=m3u_plus&output=hls

*Att.:* fire tv`

// A promotional broadcast with an indication= link but NO credentials.
const PROMO_MSG = `╭── *INDIQUE PARA UM AMIGO!*
├● 📡 ➤ https://alerquina.zeb2.top/t/MTE2NTI1?indication=p72nz7p3

_Qualquer dúvida..._`

function makeSupabaseMock() {
  function builder(table: string) {
    let didInsert = false
    let didUpdate = false

    const selectResult = () => {
      switch (table) {
        case 'profiles':
          return { data: { account_id: 'acct-1' }, error: null }
        case 'contacts':
          return { data: contactRow, error: null }
        case 'iptv_credentials':
          return { data: existingCredential, error: null }
        default:
          return { data: null, error: null }
      }
    }

    const insertResult = () => {
      switch (table) {
        case 'iptv_credentials':
          return { data: { id: 'cred-new' }, error: null }
        case 'parser_logs':
          return { data: { id: 'log-1' }, error: null }
        default:
          return { data: null, error: null }
      }
    }

    const updateResult = () => {
      switch (table) {
        case 'iptv_credentials':
          return { data: { id: existingCredential?.id ?? 'cred-new' }, error: null }
        default:
          return { data: null, error: null }
      }
    }

    const terminal = () =>
      Promise.resolve(didUpdate ? updateResult() : didInsert ? insertResult() : selectResult())

    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'delete']) {
      b[m] = vi.fn(chain)
    }
    b.insert = vi.fn((payload: Record<string, unknown>) => {
      didInsert = true
      if (table === 'iptv_credentials') iptvCredentialInserts.push(payload)
      if (table === 'parser_logs') parserLogInserts.push(payload)
      return b
    })
    b.update = vi.fn((payload: Record<string, unknown>) => {
      didUpdate = true
      if (table === 'iptv_credentials') iptvCredentialUpdates.push(payload)
      return b
    })
    b.single = vi.fn(terminal)
    b.maybeSingle = vi.fn(terminal)
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve(didUpdate ? updateResult() : didInsert ? insertResult() : selectResult())
    return b
  }

  return {
    auth: {
      getUser: vi.fn(async () =>
        unauthenticated
          ? { data: { user: null }, error: { message: 'no session' } }
          : { data: { user: { id: 'user-1' } }, error: null },
      ),
    },
    from: vi.fn((table: string) => builder(table)),
  }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

// encrypt() reads ENCRYPTION_KEY at module scope; stub it so the test
// doesn't depend on env and we can assert the encrypted payload shape.
vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s,
  isLegacyFormat: () => false,
}))

import { POST } from './route'

function postSave(overrides: Record<string, unknown> = {}) {
  return POST(
    new Request('http://localhost/api/iptv/parser/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact_id: 'contact-1',
        username: '95184381',
        password: '85219891',
        expires_at: '2026-08-09T20:07:00',
        input_text: PANEL_MSG,
        ...overrides,
      }),
    }),
  )
}

describe('POST /api/iptv/parser/save', () => {
  beforeEach(() => {
    iptvCredentialInserts.length = 0
    iptvCredentialUpdates.length = 0
    parserLogInserts.length = 0
    existingCredential = null
    contactRow = CONTACT
    unauthenticated = false
    supabaseMock = makeSupabaseMock()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('encrypts the password and logs the parse without duplicating it', async () => {
    const res = await postSave()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.credential_id).toBe('cred-new')
    // The route owns the log row id (generated server-side) and echoes it back
    // in the response; assert it matches the id that actually landed in the DB.
    expect(typeof json.parser_log_id).toBe('string')
    expect(parserLogInserts[0]?.id).toBe(json.parser_log_id)

    // Credential row: encrypted password, never plaintext.
    expect(iptvCredentialInserts).toHaveLength(1)
    const cred = iptvCredentialInserts[0]
    expect(cred).toMatchObject({
      account_id: 'acct-1',
      contact_id: 'contact-1',
      username: '95184381',
      password: 'enc:85219891',
      status: 'active',
    })
    expect(cred.password).not.toBe('85219891')
    // expires_at normalized to UTC, preserving the instant the browser saw.
    expect(new Date(cred.expires_at as string).getTime()).toBe(
      new Date('2026-08-09T20:07:00').getTime(),
    )

    // Audit row: full input + non-secret parsed fields + confidence.
    expect(parserLogInserts).toHaveLength(1)
    const log = parserLogInserts[0]
    expect(log).toMatchObject({
      account_id: 'acct-1',
      contact_id: 'contact-1',
      input_text: PANEL_MSG,
      confidence: 100,
      status: 'success',
      error: null,
    })
    expect(log.parsed_fields).toMatchObject({
      username: '95184381',
      expiresAt: '2026-08-09T20:07:00',
      panelType: 'xtream',
    })
    // The password must not appear in the log's parsed fields.
    expect(log.parsed_fields).not.toHaveProperty('password')
    expect(JSON.stringify(log.parsed_fields)).not.toContain('85219891')
  })

  it('updates the existing credential row instead of inserting a duplicate', async () => {
    existingCredential = { id: 'cred-1' }

    const res = await postSave()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.credential_id).toBe('cred-1')

    expect(iptvCredentialInserts).toHaveLength(0)
    expect(iptvCredentialUpdates).toHaveLength(1)
    expect(iptvCredentialUpdates[0]).toMatchObject({
      account_id: 'acct-1',
      contact_id: 'contact-1',
      username: '95184381',
      password: 'enc:85219891',
      status: 'active',
    })
  })

  it('logs a failed parse (promo text) but still saves the confirmed fields', async () => {
    const res = await postSave({ input_text: PROMO_MSG })
    expect(res.status).toBe(200)

    expect(parserLogInserts).toHaveLength(1)
    expect(parserLogInserts[0]).toMatchObject({ confidence: 0, status: 'error' })
    expect(iptvCredentialInserts).toHaveLength(1) // operator overrode manually
  })

  it('saves without a parser log when no input_text is given', async () => {
    const res = await postSave({ input_text: undefined })
    expect(res.status).toBe(200)
    expect(parserLogInserts).toHaveLength(0)
    expect(iptvCredentialInserts).toHaveLength(1)
  })

  it('404s when the contact is not in the caller account', async () => {
    contactRow = null

    const res = await postSave()
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json.error).toMatch(/contact not found/i)
    expect(iptvCredentialInserts).toHaveLength(0)
    expect(parserLogInserts).toHaveLength(0)
  })

  it('400s when required fields are missing', async () => {
    const res = await POST(
      new Request('http://localhost/api/iptv/parser/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: 'contact-1', username: 'u' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('400s on an invalid expiry', async () => {
    const res = await postSave({ expires_at: 'não é data' })
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toMatch(/Invalid expires_at/i)
  })

  it('400s on an unknown panel_type', async () => {
    const res = await postSave({ panel_type: 'zebra' })
    expect(res.status).toBe(400)
    expect(iptvCredentialInserts).toHaveLength(0)
  })

  it('401s when unauthenticated', async () => {
    unauthenticated = true
    const res = await postSave()
    expect(res.status).toBe(401)
    expect(iptvCredentialInserts).toHaveLength(0)
  })
})
