import { describe, expect, it } from 'vitest'
import { coordinatorFor, createAssistant, ASSISTANT_AGENT, HISTORY_EVENTS, newSessionKey, pickCwd, resumeFrom, sendVia, unseen } from '../client/assistant-session.js'

describe('assistant session helpers', () => {
  it('builds a unique devboard-assistant session key', () => {
    expect(newSessionKey()).toMatch(/^devboard-assistant:[0-9a-f-]{36}$/)
    expect(newSessionKey()).not.toBe(newSessionKey())
    expect(ASSISTANT_AGENT).toBe('@agnes-showcase/devboard#coordinator')
  })

  it('keeps the stored directory, else the most recently used available workspace', () => {
    const items = [
      { path: '/gone', available: false },
      { path: '/a', available: true },
      { path: '/b', available: true },
    ]
    expect(pickCwd('/stored', items)).toBe('/stored')
    expect(pickCwd(undefined, items)).toBe('/a')
    expect(pickCwd(undefined, [{ path: '/gone', available: false }])).toBeUndefined()
    expect(pickCwd(undefined, undefined)).toBeUndefined()
    expect(pickCwd(undefined, items, '/a')).toBe('/b')
  })

  it('steers a busy session, follows up an idle one, and falls back when steer finds no running turn', async () => {
    const calls: string[] = []
    const session = (steerError?: unknown) => ({
      steer: async (t: string) => {
        calls.push(`steer:${t}`)
        if (steerError) throw steerError
      },
      followUp: async (t: string) => void calls.push(`followUp:${t}`),
    })
    await sendVia(session(), true, 'a')
    await sendVia(session(), false, 'b')
    await sendVia(session({ code: -32002 }), true, 'c')
    expect(calls).toEqual(['steer:a', 'followUp:b', 'steer:c', 'followUp:c'])
    await expect(sendVia(session(new Error('boom')), true, 'd')).rejects.toThrow('boom')
  })

  it('queues an automatic hand-back as its own follow-up, even while busy or stalled', async () => {
    const calls: string[] = []
    const session = {
      steer: async (t: string) => void calls.push(`steer:${t}`),
      followUp: async (t: string) => void calls.push(`followUp:${t}`),
      sendNow: async (id: string) => void calls.push(`sendNow:${id}`),
    }
    await sendVia(session as any, true, 'h1', false, true)
    await sendVia(session as any, true, 'h2', true, true)
    await sendVia(session as any, true, 'user', false)
    expect(calls).toEqual(['followUp:h1', 'followUp:h2', 'steer:user'])
  })

  it('sends a follow-up queued behind a blocked turn now, never while a turn runs', async () => {
    const calls: string[] = []
    const text = (t: string) => [{ type: 'text', text: t }]
    const session = {
      steer: async (t: string) => void calls.push(`steer:${t}`),
      followUp: async (t: string) => void calls.push(`followUp:${t}`),
      controls: async () => ({
        pending: [
          { itemId: 'sys', kind: 'follow_up', content: text('Handled by x') },
          { itemId: 'me', kind: 'follow_up', content: text('a') },
          { itemId: 'tail', kind: 'follow_up', content: text('later') },
        ],
      }),
      sendNow: async (id: string) => void calls.push(`sendNow:${id}`),
    }
    await sendVia(session, false, 'a', true)
    await sendVia(session, true, 'b', true)
    await sendVia(session, false, 'c', false)
    expect(calls).toEqual(['followUp:a', 'sendNow:me', 'steer:b', 'followUp:c'])
  })

  it('resumes from the last seen row, else from a bounded window before the server tail', () => {
    expect(resumeFrom(40, 100)).toBe(40)
    expect(resumeFrom(0, 100)).toBe(0)
    expect(resumeFrom(0, HISTORY_EVENTS + 100)).toBe(100)
  })

  it('drops rows at or below the resume point and repeated rows, keeps order', async () => {
    async function* source() {
      for (const seq of [3, 4, 5, 5, 4, 6]) yield { seq }
    }
    const got: number[] = []
    for await (const e of unseen(source(), 4)) got.push(e.seq)
    expect(got).toEqual([5, 6])
  })

  describe('createAssistant open/create', () => {
    const outcome = { verdict: 'allowed-once' }
    const request = { requestId: 'r1', options: [] }
    const harness = (openImpl: (o: any) => Promise<any>) => {
      const log = { created: 0, detached: 0, saved: [] as any[], gateHandlers: [] as any[] }
      const handle = (id: string) => ({
        id,
        cursor: () => ({ fromSeq: 0, generation: 1 }),
        attach: async () => {},
        detach: async () => void log.detached++,
        onPermissionRequest: (h: any) => (log.gateHandlers.push(h), () => {}),
      })
      const ctx: any = {
        agnes: {
          journal: { cursor: async () => undefined, setCursor: async () => {} },
          session: {
            open: (id: string, o: any) => openImpl({ ...o, handle: handle(id) }),
            rename: async () => {},
          },
          createSession: async () => (log.created++, handle('new')),
          workspace: { list: async () => ({ items: [{ path: '/w', available: true }] }) },
        },
        profile: { services: { effect: async (_n: string, input: any) => void log.saved.push(input) } },
      }
      return { ctx, log }
    }
    const signal = () => new AbortController().signal

    it('installs the dispatcher at open and delivers requests that arrived before the page registered', async () => {
      let given: any
      const { ctx } = harness(async (o) => ((given = o), o.handle))
      const a = createAssistant(ctx)
      await a.ensure({ sessionId: 's1', cwd: '/w' })
      const early = given.onPermissionRequest(request, { signal: signal() }) // replayed at attach, no page yet
      const seen: any[] = []
      a.onPermissionRequest(async (r: any) => (seen.push(r), outcome))
      await expect(early).resolves.toEqual(outcome)
      expect(seen).toEqual([request])
      await expect(given.onPermissionRequest(request, { signal: signal() })).resolves.toEqual(outcome) // live
    })

    it('installs the dispatcher on a newly created session too', async () => {
      const { ctx, log } = harness(async () => {
        throw Object.assign(new Error('gone'), { code: -32003 })
      })
      const a = createAssistant(ctx)
      await a.ensure({ sessionId: 's1' })
      expect(log.created).toBe(1)
      expect(log.saved).toEqual([{ sessionId: 'new', cwd: '/w' }])
      const seen: any[] = []
      a.onPermissionRequest(async (r: any) => (seen.push(r), outcome))
      await expect(log.gateHandlers[0](request, { signal: signal() })).resolves.toEqual(outcome)
    })

    it("gives each project group its own coordinator session, registered in that group's watch record, holding permission requests in a queue", async () => {
      const calls: any = { created: [], renamed: [], effects: [], gate: [] }
      const handle = (id: string) => ({
        id,
        cursor: () => ({ fromSeq: 0, generation: 1 }),
        attach: async () => {},
        detach: async () => {},
        onPermissionRequest: (h: any) => (calls.gate.push(h), () => {}),
      })
      const ctx: any = {
        agnes: {
          journal: { cursor: async () => undefined, setCursor: async () => {} },
          session: { open: async () => undefined, rename: async (...a: any[]) => void calls.renamed.push(a) },
          createSession: async (o: any) => (calls.created.push(o), handle(`c${calls.created.length}`)),
          workspace: { list: async () => ({ items: [{ path: '/w', available: true }] }) },
        },
        profile: { services: { effect: async (n: string, i: any) => (calls.effects.push([n, i]), { output: { ok: true } }) } },
      }
      const a = coordinatorFor(ctx, 'PRJ-1')
      expect(coordinatorFor(ctx, 'PRJ-1')).toBe(a) // cached per group
      expect(coordinatorFor(ctx, 'PRJ-2')).not.toBe(a)
      await a.assistant.ensure(undefined)
      expect(calls.created[0]).toMatchObject({ cwd: '/w', agent: ASSISTANT_AGENT })
      expect(calls.created[0].sessionKey).toMatch(/^devboard-watch:PRJ-1:[0-9a-f-]{36}$/)
      expect(calls.renamed).toEqual([['c1', '值守协调员 · PRJ-1']])
      expect(calls.effects).toEqual([['devboard.watch.session', { projectId: 'PRJ-1', sessionId: 'c1', cwd: '/w' }]])
      // a request arriving with no page mounted waits in the queue until a person answers it
      const answered = calls.gate[0](request, { signal: signal() })
      const [entry] = a.queue.snapshot()
      expect(entry.req).toEqual(request)
      a.queue.answer(entry, outcome)
      await expect(answered).resolves.toEqual(outcome)
      expect(a.queue.snapshot()).toEqual([])
    })

    describe('new conversation', () => {
      // handles whose ledger the test feeds by hand: push(seq) adds a row, the stream ends on detach
      const make = (id: string, log: any) => {
        const rows: any[] = []
        const waiters: Array<() => void> = []
        let ended = false
        return {
          id,
          lastServerSeq: 0,
          cursor: () => ({ fromSeq: 0, generation: 1 }),
          generation: 1,
          sent: [] as string[],
          followUp: async function (this: any, t: string) {
            this.sent.push(t)
          },
          attach: async () => {},
          detach: async () => {
            ended = true
            waiters.splice(0).forEach((w) => w())
            log.detached.push(id)
          },
          onPermissionRequest: (h: any) => ((log.gate[id] = h), () => void (log.gateOff[id] = true)),
          capabilities: async () => {
            if (log.unreadable?.includes(id)) throw new Error('unreadable')
            return { modelRoutes: { value: { primary: log.models?.[id] } } }
          },
          setModel: async (r: any) => {
            ;(log.setCalls ??= []).push({ id, ...r })
            if (log.refuse) throw new Error('refused')
            ;(log.models ??= {})[id] = { route: r.route, model: r.model }
          },
          events: async function* () {
            ended = false
            for (let i = 0; !ended; ) {
              if (i < rows.length) yield rows[i++]
              else await new Promise<void>((r) => waiters.push(r))
            }
          },
          sentNow: [] as string[],
          sendNow: async function (this: any, itemId: string) {
            this.sentNow.push(itemId)
          },
          pushRow: (row: any) => (rows.push(row), waiters.splice(0).forEach((w) => w())),
          push: (seq: number) => (rows.push({ seq, type: 'assistant/message', data: { text: `${id}-${seq}` } }), waiters.splice(0).forEach((w) => w())),
        }
      }
      const setup = async () => {
        const log: any = { detached: [], gate: {}, gateOff: {}, saved: [] as any[], created: [] as any[] }
        const handles: any = {}
        let n = 0
        const ctx: any = {
          agnes: {
            journal: { cursor: async () => undefined, setCursor: async () => {} },
            session: {
              open: async (id: string, o: any) => (
                (log.gate[id] = o.onPermissionRequest),
                o.onPermissionRequestRegistered(() => void (log.gateOff[id] = true)),
                (handles[id] = make(id, log))
              ),
              rename: async () => {},
            },
            createSession: async (o: any) => (log.created.push(o), (handles[`n${++n}`] = make(`n${n}`, log))),
            workspace: { list: async () => ({ items: [{ path: '/w', available: true }] }) },
            approval: {
              list: async (id: string) => ({ decisions: log.decisions?.[id] ?? [] }),
              decide: async (c: any) => void (log.decided ??= []).push(c),
            },
          },
          profile: { services: { effect: async (_n: string, input: any) => void log.saved.push(input) } },
        }
        const a = createAssistant(ctx, { wakeMs: 5 })
        await a.ensure({ sessionId: 's1', cwd: '/w' })
        const got: any[] = []
        let resets = 0
        a.follow((e: any) => got.push(e.data.text), undefined, () => resets++)
        await new Promise((r) => setTimeout(r, 5))
        return { a, log, handles, got, resets: () => resets }
      }
      const tick = () => new Promise((r) => setTimeout(r, 10))

      const inbox = (seq: number, ...items: any[]) => ({ seq, type: 'inbox', data: { items: items.map((i, n) => ({ itemId: `i${seq}-${n}`, target: 'next-turn', kind: 'follow_up', ...i })) } })

      it('sends a role completion notice now when it waits in the inbox and no turn is open, but not a person message or during a turn', async () => {
        const { handles } = await setup()
        handles.s1.pushRow(inbox(1, { origin: 'principal' }))
        await tick()
        expect(handles.s1.sentNow).toEqual([])
        handles.s1.pushRow(inbox(2, { origin: 'system' }))
        await tick()
        expect(handles.s1.sentNow).toEqual(['i2-0'])
        handles.s1.pushRow({ seq: 3, type: 'turn/start', data: {} })
        handles.s1.pushRow(inbox(4, { origin: 'system' }))
        await tick()
        expect(handles.s1.sentNow).toEqual(['i2-0']) // the open turn picks it up itself
        handles.s1.pushRow({ seq: 5, type: 'turn/end', data: {} })
        handles.s1.pushRow(inbox(6))
        await tick()
        expect(handles.s1.sentNow).toEqual(['i2-0'])
      })

      it('sends a queued automatic hand-back now once when idle or after a parked turn, never behind a blocked turn or for a person message', async () => {
        const { handles } = await setup()
        const msg = (t: string) => ({ origin: 'principal', content: [{ type: 'text', text: t }] })
        handles.s1.pushRow(inbox(1, msg('自动交回 · a')))
        await tick()
        expect(handles.s1.sentNow).toEqual(['i1-0'])
        handles.s1.pushRow({ seq: 2, type: 'turn/start', data: {} })
        handles.s1.pushRow(inbox(3, msg('自动交回 · b')))
        handles.s1.pushRow({ seq: 4, type: 'turn/end', data: { reason: 'blocked' } })
        await tick()
        expect(handles.s1.sentNow).toEqual(['i1-0']) // behind a blocked turn only the 继续 card moves it
        handles.s1.pushRow({ seq: 5, type: 'turn/start', data: {} })
        handles.s1.pushRow(inbox(6, msg('hello'), msg('自动交回 · c')))
        handles.s1.pushRow({ seq: 7, type: 'turn/end', data: { reason: 'parked' } })
        await tick()
        expect(handles.s1.sentNow).toEqual(['i1-0', 'i6-1']) // the person's message is not woken
      })

      it('lists the session\'s durable decisions, answers one with the workbench command id, and reports a parked turn end', async () => {
        const { a, log, handles } = await setup()
        log.decisions = { s1: [{ handle: { id: 'd1', sessionId: 's1' }, revision: 2 }] }
        await expect(a.pendingApprovals()).resolves.toEqual(log.decisions.s1)
        await a.decideApproval({ sessionId: 's1', id: 'd1', revision: 2 }, 'allowed-once')
        expect(log.decided).toEqual([{ sessionId: 's1', id: 'd1', revision: 2, commandId: 'd1:2:allowed-once', response: { option: 'allowed-once', value: null } }])
        let parked = 0
        const off = a.onParked(() => parked++)
        handles.s1.pushRow({ seq: 1, type: 'turn/end', data: { reason: 'completed' } })
        handles.s1.pushRow({ seq: 2, type: 'turn/end', data: { reason: 'parked' } })
        await tick()
        expect(parked).toBe(1)
        off()
        handles.s1.pushRow({ seq: 3, type: 'turn/end', data: { reason: 'parked' } })
        await tick()
        expect(parked).toBe(1)
      })

      it('creates and registers a new session in the same directory, keeps the sent hand-backs, and resets chat and cursor', async () => {
        const { a, log, handles, got, resets } = await setup()
        handles.s1.push(1)
        handles.s1.push(2)
        await tick()
        expect(got).toEqual(['s1-1', 's1-2'])
        await a.startNew()
        expect(log.created).toMatchObject([{ cwd: '/w', agent: ASSISTANT_AGENT }])
        expect(log.saved).toEqual([{ sessionId: 'n1', cwd: '/w', keepSentHandbacks: true }])
        expect(resets()).toBe(1)
        expect(log.detached).toContain('s1')
        expect(log.gateOff.s1).toBe(true) // the old session no longer reaches the permission handler
        // a page mounting now gets none of the old rows, and the cursor starts over: seq 1 of the new session shows
        const late: any[] = []
        a.follow((e: any) => late.push(e.data.text))
        handles.n1.push(1)
        await tick()
        expect(late).toEqual(['n1-1'])
        expect(got).toEqual(['s1-1', 's1-2', 'n1-1'])
      })

      it('drops later events of the old session, sends to the new one, and shares one start between two clicks', async () => {
        const { a, handles, got, log } = await setup()
        const first = a.startNew()
        expect(a.startNew()).toBe(first)
        await first
        handles.s1.push(9) // arrives after the switch
        handles.n1.push(1)
        await tick()
        expect(got).toEqual(['n1-1'])
        await a.send('hi')
        expect(handles.n1.sent).toEqual(['hi'])
        expect(handles.s1.sent).toEqual([])
        expect(log.created).toHaveLength(1)
      })

      it('carries the old primary model onto the new session before the page switches, and skips when equal', async () => {
        const { a, log } = await setup()
        log.models = { s1: { route: 'demo', model: 'b' }, n1: { route: 'local', model: 'a' }, n2: { route: 'demo', model: 'b' } }
        let seenAtReset: any
        a.follow(() => {}, undefined, async () => (seenAtReset = await a.currentModel()))
        await a.startNew()
        expect(log.setCalls).toEqual([{ id: 'n1', slot: 'primary', route: 'demo', model: 'b' }])
        expect(await a.currentModel()).toEqual({ route: 'demo', model: 'b' })
        expect(seenAtReset).toEqual({ route: 'demo', model: 'b' })
        expect(a.notice).toBeUndefined()
        await a.startNew() // n2 already starts on the same model
        expect(log.setCalls).toHaveLength(1)
      })

      it('still starts the new conversation, with a notice, when the old model is refused', async () => {
        const { a, log } = await setup()
        log.models = { s1: { route: 'demo', model: 'b' }, n1: { route: 'local', model: 'a' } }
        log.refuse = true
        await a.startNew()
        expect(log.saved).toHaveLength(1)
        expect(a.notice).toBe('原模型 b 不可用，已使用默认模型 a')
        expect(await a.currentModel()).toEqual({ route: 'local', model: 'a' })
      })

      it('uses the default model when the old model cannot be read', async () => {
        const { a, log } = await setup()
        log.models = { n1: { route: 'local', model: 'a' } }
        log.unreadable = ['s1']
        await a.startNew()
        expect(log.setCalls).toBeUndefined()
        expect(a.notice).toBeUndefined()
      })

      it('withdraws the old session\'s open permission requests and refuses before a session exists', async () => {
        const { a, log } = await setup()
        const ctl = new AbortController()
        const seen: AbortSignal[] = []
        a.onPermissionRequest((_r: any, c: any) => (seen.push(c.signal), new Promise(() => {})) as any)
        void log.gate.s1({ requestId: 'r' }, { signal: ctl.signal })
        expect(seen[0].aborted).toBe(false)
        await a.startNew()
        expect(seen[0].aborted).toBe(true)
        await expect(createAssistant({} as any).startNew()).rejects.toThrow('尚未就绪')
      })
    })

    describe('primary model', () => {
      const primary = { route: 'local', model: 'a' }
      const withModel = async (extra: any = {}) => {
        const calls: any[] = []
        let now = primary
        const { ctx } = harness(async (o) =>
          Object.assign(o.handle, {
            capabilities: async () => ({ modelRoutes: { value: { primary: now } } }),
            setModel: async (r: any) => (calls.push(r), extra.reject ? Promise.reject(extra.reject) : void (now = { route: r.route, model: r.model })),
          }),
        )
        ctx.agnes.apis = async () => ({ profile: { models: [{ route: 'local', id: 'a' }, { route: 'demo', id: 'b', label: 'B' }] } })
        const a = createAssistant(ctx)
        return { a, calls, ensure: () => a.ensure({ sessionId: 's1', cwd: '/w' }) }
      }

      it('reads the current primary model and the offered list', async () => {
        const { a, ensure } = await withModel()
        await ensure()
        expect(await a.currentModel()).toEqual(primary)
        expect((await a.models()).map((m: any) => m.id)).toEqual(['a', 'b'])
      })

      it('switches the primary slot only, then returns the re-read model', async () => {
        const { a, calls, ensure } = await withModel()
        await ensure()
        expect(await a.setModel({ route: 'demo', id: 'b' })).toEqual({ route: 'demo', model: 'b' })
        expect(calls).toEqual([{ slot: 'primary', route: 'demo', model: 'b' }])
      })

      it('surfaces a missing session and a refused switch; reads nothing without a session', async () => {
        const none = await withModel()
        await expect(none.a.setModel({ route: 'demo', id: 'b' })).rejects.toThrow('尚未就绪')
        expect(await none.a.currentModel()).toBeUndefined()
        const refused = await withModel({ reject: new Error('refused') })
        await refused.ensure()
        await expect(refused.a.setModel({ route: 'demo', id: 'b' })).rejects.toThrow('refused')
      })
    })

    describe('stale workspace', () => {
      const SEMANTIC_REJECTED = -32011
      const rejected = (code: string) => Object.assign(new Error('rejected'), { code: SEMANTIC_REJECTED, data: { code } })
      const stale = async (code: string, items: any[] = [{ path: '/old', available: false }, { path: '/new', available: true }]) => {
        const h = harness(async () => {
          throw rejected(code)
        })
        h.ctx.agnes.workspace.list = async () => ({ items })
        h.ctx.agnes.createSession = async (o: any) => (h.log.created++, ((h.log as any).cwd = o.cwd), { ...h.ctx.agnes.session, id: 'new', attach: async () => {}, detach: async () => {}, onPermissionRequest: () => () => {} })
        return { ...h, a: createAssistant(h.ctx) }
      }

      it.each(['WORKSPACE_STALE', 'WORKSPACE_NOT_FOUND', 'WORKSPACE_INVALID'])('%s starts a new conversation in another workspace and says so', async (code) => {
        const { a, log } = await stale(code, [{ path: '/old', available: true }, { path: '/new', available: true }])
        await a.ensure({ sessionId: 's1', cwd: '/old' })
        expect((log as any).cwd).toBe('/new')
        expect(log.saved).toEqual([{ sessionId: 'new', cwd: '/new' }])
        expect(a.notice).toBe('原工作目录 /old 已不可用，已在 /new 新开对话；之前的对话仍可在 Agnes 会话列表中找到。')
      })

      it('keeps the error and the stored session when no other workspace is available', async () => {
        const { a, log } = await stale('WORKSPACE_STALE', [{ path: '/old', available: true }])
        await expect(a.ensure({ sessionId: 's1', cwd: '/old' })).rejects.toThrow('没有可用的工作目录')
        expect(log.created).toBe(0)
        expect(log.saved).toEqual([])
        expect(a.notice).toBeUndefined()
      })

      it('replaces a missing session in its own workspace without a notice, and propagates other rejections', async () => {
        const gone = harness(async () => {
          throw Object.assign(new Error('gone'), { code: -32003 })
        })
        const a = createAssistant(gone.ctx)
        await a.ensure({ sessionId: 's1', cwd: '/w' })
        expect(gone.log.saved).toEqual([{ sessionId: 'new', cwd: '/w' }])
        expect(a.notice).toBeUndefined()
        for (const err of [rejected('ID_CONFLICT'), Object.assign(new Error('x'), { code: -32010, data: { code: 'WORKSPACE_STALE' } })]) {
          const h = harness(async () => {
            throw err
          })
          await expect(createAssistant(h.ctx).ensure({ sessionId: 's1', cwd: '/w' })).rejects.toBe(err)
          expect(h.log.created).toBe(0)
        }
      })
    })

    it('keeps the stored session on a transient open error: no create, no save, handle released, error surfaced', async () => {
      const { ctx, log } = harness(async (o) => {
        o.onPermissionRequestRegistered(() => {})
        return { ...o.handle, attach: async () => { throw new Error('daemon restarting') } }
      })
      const a = createAssistant(ctx)
      await expect(a.ensure({ sessionId: 's1', cwd: '/w' })).rejects.toThrow('daemon restarting')
      expect(log.created).toBe(0)
      expect(log.saved).toEqual([])
      expect(log.detached).toBe(1)
      // retry is possible: ensure is not stuck on the failed attempt
      await expect(a.ensure({ sessionId: 's1', cwd: '/w' })).rejects.toThrow('daemon restarting')
    })
  })
})
