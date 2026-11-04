import { describe, expect, it, vi } from 'vitest'
import { META_KEY } from '../../../../packages/protocol/src/index.ts'
import { localAuth } from '../../../../packages/sdk/src/auth.ts'
import { createClient } from '../../../../packages/sdk/src/client.ts'
import { memoryJournal } from '../../../../packages/sdk/src/journal.ts'
import { fakeEndpoint } from '../../../../packages/sdk/test/helpers/fake-endpoint.ts'
import { assistantFor, createAssistant, HISTORY_EVENTS } from '../client/assistant-session.js'

const actor = { id: 'u', org: 'local', role: 'owner', deptPath: [], attrs: {} }
const row = (seq: number) => ({
  jsonrpc: '2.0' as const,
  method: '_agnes/v1/session.event',
  params: {
    sessionId: 's',
    event: { seq, ts: '2026-09-08T00:00:00.000Z', id: '01J6ZM2Q3R4S5T6V7W8X9Y0ZAB', type: 'assistant/message', data: { content: [], stopReason: 'end_turn' }, actor, origin: 'model', trust: 'trusted' },
    _meta: { [META_KEY]: { promptTurnId: '1', eventSequence: seq, generation: 1, lane: 'main', phase: 'event' } },
  },
})

// Real SDK client over a fake endpoint that replays rows 1..50 on every cursor attach.
const nodes = [
  { kind: 'user', id: 'n1', seq: 1, content: [{ type: 'text', text: '第一问' }], actorLabel: 'local', origin: 'principal' },
  { kind: 'assistant', id: 'n2', seq: 2, text: '第一答', streaming: false },
  { kind: 'tool', id: 'n3', seq: 3, toolUseId: 't1', name: 'devboard_board', status: 'completed', summary: 'board', enforcement: { level: 'full', scope: ['file'] }, argsPreview: '{}', resultPreview: 'ok', resultSeq: 4 },
]
const setup = async (kept?: number, highest = 50) => {
  const journal = memoryJournal('cid')
  if (kept) await journal.setCursor('s', { fromSeq: kept, generation: 1 } as any)
  const f = fakeEndpoint({
    initialize: fakeEndpoint({}).initialize,
    'session/load': () => ({}),
    '_agnes/v1/session.open': () => ({}),
    '_agnes/v1/session.attach': (p: any, ctx: any) => {
      const types = p.filter?.types
      if (p.cursor && !(types && types.length)) for (let i = p.cursor.fromSeq + 1; i <= highest; i++) ctx.push(row(i))
      return { generation: 1, lastSeq: highest, resolvedProfileHash: null }
    },
    '_agnes/v1/session.detach': () => ({}),
    '_agnes/v1/session.projectUIOpening': () => ({
      timeline: { sessionId: 's', upto: highest, opState: null, nodes, turns: [], generation: 1 },
      history: { hasEarlier: false, startIndex: 0, totalNodes: nodes.length },
    }),
  })
  const agnes = createClient({ transport: { kind: 'inproc', endpoint: f.endpoint } as any, journal, authProviders: { local: () => localAuth() } as any, bufferLimit: 1000 })
  return { ctx: { agnes, profile: { services: { effect: async () => ({ output: { ok: true } }) } } } as any, f }
}

// One page visit: mount, collect the rows the page is shown, unmount.
const visit = async (ctx: any, quiet = 100) => {
  const a = assistantFor(ctx)
  await a.ensure({ sessionId: 's', cwd: '/w' })
  const got: number[] = []
  const off = a.follow((e: any) => got.push(e.seq))
  await new Promise((r) => setTimeout(r, quiet))
  off()
  return got
}

describe('assistant across page remounts (real SDK client)', () => {
  it('shows the full history on every visit, one session load', async () => {
    const { ctx, f } = await setup()
    const first = await visit(ctx)
    const second = await visit(ctx)
    expect(first).toHaveLength(50)
    expect(second).toEqual(first)
    expect(assistantFor(ctx)).toBe(assistantFor(ctx))
    expect(f.calls.filter((c) => c.method === 'session/load')).toHaveLength(1)
  })

  it('an assistant created by a swapped-in client module takes over the old one: same history', async () => {
    const { ctx } = await setup()
    const old = createAssistant(ctx)
    await old.ensure({ sessionId: 's', cwd: '/w' })
    const oldRows: number[] = []
    old.follow((e: any) => oldRows.push(e.seq))
    await new Promise((r) => setTimeout(r, 100))
    expect(oldRows).toHaveLength(50)
    // The host swaps the plugin's client modules: another assistant on the same SDK client (same cached session handle).
    const fresh = createAssistant(ctx)
    await fresh.ensure({ sessionId: 's', cwd: '/w' })
    const rows: number[] = []
    fresh.follow((e: any) => rows.push(e.seq))
    await new Promise((r) => setTimeout(r, 100))
    expect(rows).toEqual(oldRows)
    expect(old.released).toBe(true)
  })

  it('replays history even when the journal kept the position of an earlier visit', async () => {
    const { ctx } = await setup(40)
    expect(await visit(ctx)).toHaveLength(50)
  })

  it('unsubscribes immediately: a left page gets no more rows', async () => {
    const { ctx, f } = await setup()
    const a = assistantFor(ctx)
    await a.ensure({ sessionId: 's', cwd: '/w' })
    const got: number[] = []
    const off = a.follow((e: any) => got.push(e.seq))
    await new Promise((r) => setTimeout(r, 100))
    off()
    f.push(row(51))
    await new Promise((r) => setTimeout(r, 50))
    expect(got).toHaveLength(50)
    const later: number[] = []
    a.follow((e: any) => later.push(e.seq))
    expect(later.at(-1)).toBe(51) // retained while nobody was watching
    // the retained tail is bounded: only the newest HISTORY_EVENTS rows are replayed to a later page
    for (let i = 52; i <= HISTORY_EVENTS + 100; i++) {
      f.push(row(i))
      if (i % 200 === 0) await new Promise((r) => setTimeout(r, 10))
    }
    await new Promise((r) => setTimeout(r, 100))
    const capped: number[] = []
    a.follow((e: any) => capped.push(e.seq))
    expect(capped).toHaveLength(HISTORY_EVENTS)
    expect(capped.at(-1)).toBe(HISTORY_EVENTS + 100)
  })

  it('replays a ledger longer than the SDK buffer without losing or duplicating a row', async () => {
    const { ctx } = await setup(undefined, HISTORY_EVENTS + 100)
    const got = await visit(ctx, 500)
    expect(got).toHaveLength(HISTORY_EVENTS)
    expect(got.at(-1)).toBe(HISTORY_EVENTS + 100)
  })

  it('tells the page when the event stream ends because the connection is gone', async () => {
    const { ctx } = await setup()
    const a = assistantFor(ctx)
    await a.ensure({ sessionId: 's', cwd: '/w' })
    const errors: unknown[] = []
    a.follow(() => {}, (e: unknown) => errors.push(e))
    await new Promise((r) => setTimeout(r, 100))
    await ctx.agnes.close()
    await new Promise((r) => setTimeout(r, 100))
    expect(errors).toHaveLength(1)
  })

  it('hands the session to the page opened last: the older tab detaches and withdraws its open request', async () => {
    const tick = () => new Promise((r) => setTimeout(r, 100))
    const stored = { sessionId: 's', cwd: '/w' }
    const older = await setup()
    const newer = await setup()
    const A = assistantFor(older.ctx)
    await A.ensure(stored)
    const released = vi.fn()
    A.onReleased(released)
    A.follow(() => {})
    A.onPermissionRequest(() => new Promise(() => {})) // a page that never answers
    older.f.push({
      jsonrpc: '2.0',
      id: 'p1',
      method: 'session/request_permission',
      params: { sessionId: 's', toolCall: { toolCallId: 't', status: 'pending', title: 'x' }, options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }] },
    })
    await tick()
    const detaches = () => older.f.calls.filter((c) => c.method === '_agnes/v1/session.detach').length
    const before = detaches()
    const B = assistantFor(newer.ctx)
    await B.ensure(stored)
    await tick()
    expect(released).toHaveBeenCalledTimes(1)
    expect(A.released).toBe(true)
    expect(B.released).toBe(false)
    expect(detaches()).toBe(before + 1)
    expect(older.f.calls.find((c) => c.method === '<response:p1>')).toMatchObject({ params: { result: { outcome: { outcome: 'cancelled' } } } })
    await expect(A.send('hi')).rejects.toThrow('另一个标签页')
    // a released page pumps nothing, even when a page mounts on it
    const got: number[] = []
    A.follow((e: any) => got.push(e.seq))
    older.f.push(row(51))
    await tick()
    expect(got.includes(51)).toBe(false)
    // taking it back releases the other tab
    await A.reclaim()
    await tick()
    expect(A.released).toBe(false)
    expect(B.released).toBe(true)
  })

  it('shows the history of a session the workbench already read (URL-selected): rebuilt from the projection, live rows continue', async () => {
    const { ctx, f } = await setup()
    // the workbench opens the selected session first; its attach admits every row to the shared handle
    const s = await ctx.agnes.session.open('s', { cwd: '/w' })
    void (async () => {
      for await (const _ of s.events({ cursor: { fromSeq: 0, generation: 1 } })) void _
    })()
    await new Promise((r) => setTimeout(r, 100))
    const a = assistantFor(ctx)
    await a.ensure({ sessionId: 's', cwd: '/w' })
    const got: any[] = []
    a.follow((e: any) => got.push(e))
    await new Promise((r) => setTimeout(r, 100))
    expect(got.map((e) => [e.seq, e.type])).toEqual([[1, 'user/message'], [2, 'assistant/message'], [3, 'tool/call'], [4, 'tool/result']])
    f.push(row(51))
    await new Promise((r) => setTimeout(r, 50))
    expect(got.at(-1).seq).toBe(51)
  })
})
