import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Security regression (Etapa 1): /api/automations/[id] must authorize by the
// caller's ACCOUNT (resolved from the session via requireRole), NOT by the
// automation's creator.
//
//   - A teammate in the same account can read/edit/delete an automation
//     created by another member of that account.
//   - A user from another account gets 404 for the row (its existence is
//     never leaked) and their mutations are scoped to THEIR account, so a
//     direct foreign id in the URL (IDOR) can never touch it.
//
// The admin-client mock models PostgREST: eq() filters constrain which rows
// are visible/mutable, so `.eq('account_id', ctx.accountId)` only ever
// reaches rows that belong to the caller's account.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  supabaseAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: (err: unknown) => {
    const e = err as { status?: number; message?: string }
    return Response.json(
      { error: e?.message ?? 'Internal server error' },
      { status: e?.status ?? 500 },
    )
  },
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}))

import { DELETE, GET, PATCH } from './route'

interface AutomationRow extends Record<string, unknown> {
  id: string
  account_id: string
  user_id: string
}

// DB state + captured mutation scopes, reset per test.
let store: AutomationRow[]
let deleteScopes: Array<Record<string, unknown>>
let updateScopes: Array<Record<string, unknown>>

const VISION = 'acct-vision'
const JOAO = 'acct-joao'

// An automation CREATED BY a different user of the SAME account. The whole
// point of the fix: creator !== caller must still allow access when the
// account matches.
const TEAM_AUTOMATION: AutomationRow = {
  id: 'auto-1',
  account_id: VISION,
  user_id: 'user-creator-other',
  name: 'Boas-vindas',
  description: null,
  trigger_type: 'none',
  trigger_config: {},
  is_active: false,
}

function makeAdminMock() {
  function builder() {
    const filters: Record<string, unknown> = {}
    let lastOp: 'select' | 'update' | 'delete' | 'insert' = 'select'
    let updatePayload: Record<string, unknown> | null = null

    const matches = () =>
      store.filter((r) =>
        Object.entries(filters).every(([k, v]) => r[k] === v),
      )
    const terminal = () =>
      Promise.resolve({ data: matches()[0] ?? null, error: null })

    const b: Record<string, unknown> = {}
    for (const m of ['select', 'order']) b[m] = vi.fn(() => b)
    b.eq = vi.fn((k: string, v: unknown) => {
      filters[k] = v
      return b
    })
    b.insert = vi.fn((payload: Record<string, unknown>) => {
      lastOp = 'insert'
      store.push(payload as AutomationRow)
      return b
    })
    b.update = vi.fn((payload: Record<string, unknown>) => {
      lastOp = 'update'
      updatePayload = payload
      return b
    })
    b.delete = vi.fn(() => {
      lastOp = 'delete'
      return b
    })
    b.maybeSingle = vi.fn(terminal)
    // The route `await`s chains that end without a terminal (delete/update/
    // loadStepsTree). Record the scope at resolve time — after all eq()
    // filters have been applied.
    b.then = (resolve: (v: unknown) => unknown) => {
      if (lastOp === 'delete') deleteScopes.push({ ...filters })
      if (lastOp === 'update' && updatePayload) {
        updateScopes.push({ filters: { ...filters }, payload: updatePayload })
      }
      return resolve(terminal())
    }
    return b
  }
  return { from: vi.fn(() => builder()) }
}

function ctx(accountId: string, role = 'agent') {
  return {
    supabase: {},
    userId: 'user-caller',
    accountId,
    role,
    account: { id: accountId, name: accountId === VISION ? 'Vision' : 'João' },
  }
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const getReq = (id: string) => new Request(`http://localhost/api/automations/${id}`)

const patchReq = (id: string, body: unknown) =>
  new Request(`http://localhost/api/automations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const deleteReq = (id: string) =>
  new Request(`http://localhost/api/automations/${id}`, { method: 'DELETE' })

beforeEach(() => {
  store = [TEAM_AUTOMATION]
  deleteScopes = []
  updateScopes = []
  mocks.requireRole.mockReset()
  mocks.supabaseAdmin.mockReset()
  mocks.supabaseAdmin.mockImplementation(() => makeAdminMock())
})

describe('GET /api/automations/[id] — account-based authorization', () => {
  it('200 for a same-account teammate who is NOT the creator', async () => {
    mocks.requireRole.mockResolvedValue(ctx(VISION))
    const res = await GET(getReq('auto-1'), params('auto-1'))

    expect(res.status).toBe(200)
    expect(mocks.requireRole).toHaveBeenCalledWith('viewer')
    const json = await res.json()
    expect(json.automation.id).toBe('auto-1')
    // Creator is a different user, but the account matches — access allowed.
    expect(json.automation.user_id).toBe('user-creator-other')
  })

  it('404 for a user from another account (IDOR via direct id in URL)', async () => {
    mocks.requireRole.mockResolvedValue(ctx(JOAO))
    const res = await GET(getReq('auto-1'), params('auto-1'))

    expect(res.status).toBe(404)
  })

  it('404 for an id that does not exist at all', async () => {
    mocks.requireRole.mockResolvedValue(ctx(VISION))
    const res = await GET(getReq('auto-nope'), params('auto-nope'))
    expect(res.status).toBe(404)
  })

  it('401 when there is no session', async () => {
    mocks.requireRole.mockRejectedValue(
      Object.assign(new Error('Unauthorized'), { status: 401 }),
    )
    const res = await GET(getReq('auto-1'), params('auto-1'))
    expect(res.status).toBe(401)
  })
})

describe('PATCH /api/automations/[id] — writes gated by account', () => {
  it('200 + account-scoped update for a same-account teammate', async () => {
    mocks.requireRole.mockResolvedValue(ctx(VISION))
    const res = await PATCH(patchReq('auto-1', { name: 'Novo nome' }), params('auto-1'))

    expect(res.status).toBe(200)
    expect(mocks.requireRole).toHaveBeenCalledWith('agent')
    expect(updateScopes).toHaveLength(1)
    expect(updateScopes[0].filters).toMatchObject({
      id: 'auto-1',
      account_id: VISION,
    })
    expect(updateScopes[0].payload).toMatchObject({ name: 'Novo nome' })
  })

  it('404 for another account — never scopes an update to the foreign row', async () => {
    mocks.requireRole.mockResolvedValue(ctx(JOAO))
    const res = await PATCH(patchReq('auto-1', { name: 'Hack' }), params('auto-1'))

    expect(res.status).toBe(404)
    expect(updateScopes).toHaveLength(0)
  })

  it('401 when there is no session', async () => {
    mocks.requireRole.mockRejectedValue(
      Object.assign(new Error('Unauthorized'), { status: 401 }),
    )
    const res = await PATCH(patchReq('auto-1', { name: 'x' }), params('auto-1'))
    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/automations/[id] — deletes confined to the caller account', () => {
  it('scopes the delete to the caller account (same-account teammate)', async () => {
    mocks.requireRole.mockResolvedValue(ctx(VISION))
    const res = await DELETE(deleteReq('auto-1'), params('auto-1'))

    expect(res.status).toBe(200)
    expect(deleteScopes).toHaveLength(1)
    expect(deleteScopes[0]).toMatchObject({ id: 'auto-1', account_id: VISION })
  })

  it('a foreign user deletes scoped to THEIR account — cannot touch the Vision row', async () => {
    mocks.requireRole.mockResolvedValue(ctx(JOAO))
    const res = await DELETE(deleteReq('auto-1'), params('auto-1'))

    expect(res.status).toBe(200)
    expect(deleteScopes).toHaveLength(1)
    // PostgREST would match 0 rows for João's account, so the Vision
    // automation is never deleted even though the HTTP response is 200.
    expect(deleteScopes[0].account_id).toBe(JOAO)
    expect(deleteScopes[0].account_id).not.toBe(VISION)
  })
})
