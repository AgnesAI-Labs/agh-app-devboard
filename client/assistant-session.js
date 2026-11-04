// The assistant is one long-lived coordinator session the page creates once and re-attaches on every
// visit. Nothing here touches React: the page passes in its client context.

import { AUTO_HANDBACK, createPermissionQueue, reveal, textOf } from './assistant-model.js'

export const ASSISTANT_AGENT = '@agnes-showcase/devboard#coordinator'
export const ASSISTANT_NAME = '小川'
// agent excludes systemPromptAppend / preset / bundles: the routing rules live in the coordinator persona.
const SESSION_BUSY = -32002
const SESSION_NOT_FOUND = -32003 // protocol/src/errors.ts AGNES_ERRORS.SESSION_NOT_FOUND
const SEMANTIC_REJECTED = -32011
// daemon-foundation storage/workspaces.ts + rpc throwWorkspaceRpcError: rpcError('SEMANTIC_REJECTED', { code }) -> JsonRpcError.data.code
const WORKSPACE_GONE = new Set(['WORKSPACE_STALE', 'WORKSPACE_NOT_FOUND', 'WORKSPACE_INVALID'])
const workspaceGone = (e) => e?.code === SEMANTIC_REJECTED && WORKSPACE_GONE.has(e.data?.code)

// ponytail: a reload replays at most this many trailing ledger rows (every kind counts); older chat lines stay
// on the server and are not shown. Raise it, or page back with session.projectUIHistory, if conversations outgrow it.
export const HISTORY_EVENTS = 1500

/**
 * Cursor convention (sdk session.ts): fromSeq is the last row already applied and the server resumes strictly
 * after it. Resume from the last row this page saw, else from a bounded window before the server's tail.
 */
export const resumeFrom = (seen, serverSeq, limit = HISTORY_EVENTS) => (seen > 0 ? seen : Math.max(0, serverSeq - limit))

/** Rows strictly after `from` in rising order: a replayed boundary row or a re-attach overlap never shows twice. */
export async function* unseen(source, from) {
  let last = from
  for await (const event of source) {
    if (event.seq <= last) continue
    last = event.seq
    yield event
  }
}

export const newSessionKey = (prefix = 'devboard-assistant') => `${prefix}:${crypto.randomUUID()}`

/**
 * devboard-projects/ is written relative to the session workspace, so DevBoard has no directory of its
 * own: keep the stored one, else the most recently used workspace the daemon still has (never `excluded`, the one that just failed).
 */
export const pickCwd = (stored, workspaces, excluded) => stored || workspaces?.find((w) => w.available && w.path !== excluded)?.path

/**
 * Same rule as the channel runner: steer a running turn, and queue a follow-up when there is nothing to steer.
 * The daemon does not run queued input behind a turn that ended `blocked` (follow-up-runner.ts), and `resume` is
 * refused there (CONTROL_NOT_RUNNING: no open turn, not paused). So with `stalled` the queued item is sent now (sendNow).
 * An automatic hand-back (`handback`) is always its own next turn: core claims one next-turn item per turn and taints
 * the turn only by that item, so steering it into a turn a role completion notice opened would taint the whole turn.
 * It never crosses a blocked turn on its own (the 继续 card does); the pump wakes it once the turn is over.
 */
export async function sendVia(session, busy, text, stalled = false, handback = false) {
  if (handback) return session.followUp(text)
  if (busy) {
    try {
      return await session.steer(text)
    } catch (error) {
      if (error?.code !== SESSION_BUSY) throw error
    }
  }
  const seq = await session.followUp(text)
  if (stalled) {
    const { pending = [] } = await session.controls()
    const waiting = pending.filter((i) => i.kind === 'follow_up')
    const mine = waiting.findLast((i) => textOf(i) === text) ?? waiting.at(-1)
    if (mine) await session.sendNow(mine.itemId)
  }
  return seq
}

// An attach replays every row to the SDK handle, which marks each as admitted even with no reader yet - so a
// plain attach here would swallow the history before the pump could read it. This one matches no row: it only
// learns the server's last seq and generation for the window. the pump does the one real attach.
const probe = (s) => s.attach({ filter: { acpUpdates: false, types: ['devboard/probe-no-rows'] } })

// The workbench opens the URL-selected session on its own (F5 on `?session=<id>`), and its attach admits every row to the shared
// handle before this page's reader exists: the rows are gone for good, so the history cannot be replayed from the ledger.
// It is rebuilt from the server's UI projection instead: the person's messages, the replies and one line per tool call
// (no live cards, no turn bookkeeping). Rows carry the node's own seq, so the live stream continues after `upto`.
export function rowsFromNodes(nodes) {
  const rows = []
  for (const n of nodes ?? []) {
    if (n?.kind === 'user') rows.push({ seq: n.seq, type: 'user/message', origin: n.origin, trust: n.trust, data: { content: n.content } })
    else if (n?.kind === 'assistant' && n.text) rows.push({ seq: n.seq, type: 'assistant/message', data: { content: [{ type: 'text', text: n.text }] } })
    else if (n?.kind === 'tool') {
      const text = (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? ''))
      rows.push({ seq: n.seq, type: 'tool/call', data: { toolUseId: n.toolUseId, name: n.name, args: n.argsPreview ?? null } })
      if (n.status !== 'running') rows.push({ seq: n.resultSeq ?? n.seq, type: 'tool/result', data: { toolUseId: n.toolUseId, isError: n.status === 'failed' || n.status === 'error', content: text(n.resultPreview) } })
    }
  }
  return rows.sort((a, b) => a.seq - b.seq)
}

// The host hot-swaps a changed plugin's client modules in an open page. The new module gets its own `ctx` but the same
// SDK client underneath, whose session handle (and admit watermark) the old module's assistant already used up: a second
// assistant could never replay the history and would show an empty chat for good. So an assistant that finds a live one for
// its handle takes the old one's retained rows and cursor over (the old one detaches first: one attachment per connection).
const livePeers = (globalThis[Symbol.for('agnes.devboard.assistants')] ??= new Set())

/**
 * `ctx` is the client context given to `apply(ctx)`: ctx.agnes is the SDK client, ctx.profile.services the plugin services.
 * `opts` makes it another long-lived coordinator session: `name` (the session title), `keyPrefix` (its session key) and
 * `save(input)` (where its id is registered; default: the 小川 record).
 */
export function createAssistant(ctx, opts = {}) {
  const name = opts.name ?? ASSISTANT_NAME
  const handlers = new Set()
  const waiting = [] // permission requests that arrived while no page handler was registered
  let session
  let pending
  let busy = false
  let blocked = false // the last turn ended `blocked`: queued input waits for a resume
  let queuedInbox = [] // inbox items of the latest `inbox` row
  const woken = new Set() // notices already sent now; a notice is tried once
  let wakeTimer
  let lostCwd // the stored workspace the daemon rejected as gone; consumed by create
  let notice // chat line for a conversation moved off a gone workspace
  let seen = 0 // highest ledger seq pumped
  const log = [] // trailing rows kept for the pages that mount later
  const listeners = new Set()
  const parkedListeners = new Set() // told when a turn ends `parked`: its permission request left the page but the decision is still open
  let pump
  let epoch = 0 // bumped when a new conversation replaces the session; an older pump stops delivering
  let cwd // working directory of the current session
  let offGate // removes the dispatcher from the current session
  let starting
  // One page per browser owns the session: the daemon offers a permission request to the attached connections in
  // order, so a stale tab that is still attached would hold every card until core's 60 s deadline.
  let channel
  let released = false // another tab claimed the session: this page is detached and pumps nothing
  let stopStream // ends the pump's event iterator, so a released page's old reader stops buffering rows
  const releaseListeners = new Set()
  const peer = {
    get session() {
      return session
    },
    get released() {
      return released
    },
    async handOver() {
      await release()
      return { seen, busy, blocked, queuedInbox, rows: [...log] }
    },
  }
  if (opts.claimTab !== false) livePeers.add(peer)

  // The SDK auto-rejects a request that finds no handler, so the one handler on the session is this stable
  // dispatcher, installed before the attach: it forwards to the page's latest handler, else holds the request.
  const run = (handler, w) =>
    Promise.resolve(handler(w.request, w.context)).then(w.resolve, () => w.resolve({ unanswered: 'transport' }))
  // Each request gets its own abort, chained to the host's, so a new conversation can withdraw the old session's requests.
  const inflight = new Set()
  const dispatch = (request, hostContext) => {
    const handler = [...handlers].at(-1)
    const own = new AbortController()
    const withdraw = () => own.abort(hostContext.signal.reason ?? 'detached')
    if (hostContext.signal.aborted) withdraw()
    else hostContext.signal.addEventListener('abort', withdraw, { once: true })
    inflight.add(own)
    own.signal.addEventListener('abort', () => inflight.delete(own), { once: true })
    const context = { ...hostContext, signal: own.signal }
    return new Promise((resolve) => {
      const w = { request, context, resolve }
      // A withdrawn request is unanswered at once, whether or not the page's handler ever honours its signal.
      context.signal.addEventListener('abort', () => resolve({ unanswered: context.signal.reason ?? 'detached' }), { once: true })
      if (handler) return run(handler, w)
      waiting.push(w)
      context.signal.addEventListener(
        'abort',
        () => {
          const i = waiting.indexOf(w)
          if (i >= 0) waiting.splice(i, 1)
          resolve({ unanswered: context.signal.reason ?? 'detached' })
        },
        { once: true },
      )
    })
  }
  const save = opts.save ?? (async (input) => {
    const receipt = await ctx.profile.services.effect('devboard.assistant', input, {
      operationId: crypto.randomUUID(),
    })
    if (receipt?.output?.ok === false) throw new Error(receipt.output.error)
    return receipt?.output
  })

  async function open(stored) {
    if (!stored?.sessionId) return undefined
    let s
    let off
    try {
      // The SDK journal keeps the position the last visit reached and the handle drops every row at or below
      // it, so the history could never be replayed. Rewind it before the first attach; the pump sets the real cursor.
      const kept = await ctx.agnes.journal.cursor(stored.sessionId)
      if (kept) await ctx.agnes.journal.setCursor(stored.sessionId, { ...kept, fromSeq: 0 })
      s = await ctx.agnes.session.open(stored.sessionId, {
        cwd: stored.cwd,
        onPermissionRequest: dispatch,
        onPermissionRequestRegistered: (o) => (off = o),
      })
      // The cached handle is already another assistant's (a swapped-out module of this page): take over its retained rows
      // and cursor after it detached, since this handle's admit watermark can never replay them.
      const prior = [...livePeers].find((p) => p !== peer && !p.released && p.session === s)
      if (prior) {
        const left = await prior.handOver()
        ;({ seen, busy, blocked, queuedInbox } = left)
        log.push(...left.rows)
      } else {
        // Someone else already read this handle (the workbench): its watermark is past the history, rebuild it from the projection.
        const consumed = s.cursor().fromSeq > 0
        const opening = consumed ? await s.projectUIOpening().catch(() => undefined) : undefined
        await probe(s)
        if (opening) {
          log.push(...rowsFromNodes(opening.timeline.nodes))
          seen = Math.max(opening.timeline.upto ?? 0, log.at(-1)?.seq ?? 0)
        }
      }
      offGate = off
      cwd = stored.cwd
      return s
    } catch (error) {
      off?.()
      await s?.detach().catch(() => {})
      // Only a session the daemon no longer has is replaced; a timeout or restart must keep the stored id so a retry reopens it.
      if (error?.code === SESSION_NOT_FOUND) return undefined
      // A deleted, moved or unreadable workspace cannot be reopened: start over elsewhere (create skips lostCwd).
      if (workspaceGone(error)) {
        lostCwd = stored.cwd
        return undefined
      }
      throw error
    }
  }

  /** Tells every other tab of this origin that this page owns `sessionId` now; one that hears it lets go. */
  function claim(sessionId) {
    channel?.close()
    channel = undefined
    released = false
    if (opts.claimTab === false || typeof BroadcastChannel === 'undefined') return
    channel = new BroadcastChannel(`devboard-assistant:${globalThis.location?.origin ?? ''}:${sessionId}`)
    channel.onmessage = () => void release()
    channel.postMessage('claim')
  }

  /** Another tab claimed the session: drop the permission handler and open requests, detach, stop the pump. */
  async function release() {
    if (released || !session) return
    released = true
    epoch++
    clearTimeout(wakeTimer)
    offGate?.()
    offGate = undefined
    for (const own of [...inflight]) own.abort('detached') // each resolves unanswered now, so core moves on at once
    waiting.length = 0
    stopStream?.()
    pump = undefined
    await session.detach().catch(() => {})
    for (const cb of [...releaseListeners]) cb()
  }

  /** Takes the session back from the tab that claimed it. */
  async function reclaim() {
    if (!released) return
    claim(session.id)
    offGate = session.onPermissionRequest(dispatch)
    if (listeners.size > 0) ensurePump()
  }

  async function create(stored, carry) {
    const dir = pickCwd(lostCwd ? undefined : stored?.cwd, (await ctx.agnes.workspace.list()).items, lostCwd)
    if (!dir) throw new Error('没有可用的工作目录，请先在 Agnes 里添加一个工作区')
    const s = await ctx.agnes.createSession({ cwd: dir, agent: ASSISTANT_AGENT, sessionKey: newSessionKey(opts.keyPrefix) })
    const off = s.onPermissionRequest(dispatch)
    await probe(s)
    // The title is cosmetic; a failed rename must not lose the session id.
    await ctx.agnes.session.rename(s.id, name).catch(() => {})
    await save({ sessionId: s.id, cwd: dir, ...(carry && { keepSentHandbacks: true }) })
    offGate = off
    cwd = dir
    if (lostCwd) notice = reveal(`原工作目录 ${lostCwd} 已不可用，已在 ${dir} 新开对话；之前的对话仍可在 Agnes 会话列表中找到。`)
    lostCwd = undefined
    return s
  }

  async function startPump() {
    const mine = epoch
    const s = session
    try {
      const from = resumeFrom(seen, s.lastServerSeq)
      // Replayed rows are pushed during the attach call, so the reader must exist first: detach, and let
      // events() attach with the cursor after it has registered its listener (sdk session.ts events/ensureAttached).
      await s.detach()
      const it = s.events({ cursor: { fromSeq: from, generation: s.generation } })[Symbol.asyncIterator]()
      stopStream = () => void it.return?.()
      for await (const event of unseen({ [Symbol.asyncIterator]: () => it }, from)) {
        if (mine !== epoch) return // a new conversation took over: nothing of the old session reaches the page
        seen = event.seq
        if (event.type === 'turn/start') {
          busy = true
          blocked = false
        } else if (event.type === 'turn/end') {
          busy = false
          blocked = event.data?.reason === 'blocked'
          if (event.data?.reason === 'parked') for (const l of [...parkedListeners]) l()
        } else if (event.type === 'inbox') queuedInbox = event.data?.items ?? []
        if (event.type === 'inbox' || event.type === 'turn/end') wakeSoon(mine)
        log.push(event)
        if (log.length > HISTORY_EVENTS) log.splice(0, log.length - HISTORY_EVENTS)
        for (const l of [...listeners]) l.onEvent(event)
      }
      // The stream only ends by itself when the handle closed (connection lost for good): say so instead of leaving a silent, stale chat.
      if (mine === epoch) for (const l of [...listeners]) l.onError?.(new Error('与小川的连接已断开，请刷新页面'))
    } catch (error) {
      if (mine === epoch) for (const l of [...listeners]) l.onError?.(error)
    }
  }
  // A queued automatic hand-back (principal origin, AUTO_HANDBACK prefix) is woken like a notice, but never behind a blocked turn.
  const wakeable = (i) =>
    i.target === 'next-turn' &&
    i.kind === 'follow_up' &&
    !woken.has(i.itemId) &&
    (i.origin === 'system' || (!blocked && i.origin === 'principal' && textOf(i).startsWith(AUTO_HANDBACK)))
  // A role child's completion notice is queued as the parent's next-turn input, and the daemon runs that only behind a
  // completed turn it is already driving. Idle (nothing running) or behind a `blocked` turn it just sits there, so once
  // the page has seen it wait and no turn is open it is sent now. Debounced so a replay or a turn about to pick it up settles first.
  const wakeSoon = (mine) => {
    clearTimeout(wakeTimer)
    wakeTimer = setTimeout(async () => {
      const item = queuedInbox.find(wakeable)
      if (mine !== epoch || busy || !item) return
      woken.add(item.itemId)
      await session.sendNow(item.itemId).catch(() => {}) // already picked up (QUEUED_INPUT_GONE) or not allowed: nothing to do
    }, opts.wakeMs ?? 1500)
  }
  const ensurePump = () => {
    if (pump || released) return
    const p = startPump().finally(() => {
      if (pump === p) pump = undefined
    })
    pump = p
  }

  const primaryOf = async (x) => (await x.capabilities())?.modelRoutes?.value?.primary ?? undefined

  /** Puts the old session's primary model on the new one; returns a notice line when the daemon refuses it. An unreadable old model means the default. */
  async function carryModel(old, s) {
    const want = await primaryOf(old).catch(() => undefined)
    if (!want) return undefined
    const have = await primaryOf(s).catch(() => undefined)
    if (have && have.route === want.route && have.model === want.model) return undefined
    try {
      await s.setModel({ slot: 'primary', route: want.route, model: want.model })
    } catch {
      return reveal(`原模型 ${want.model} 不可用，已使用默认模型 ${have?.model ?? '默认'}`)
    }
    return undefined
  }

  /** Replaces the session with a new one; the page chat, cursor and the old session's open permission requests are dropped. */
  async function startNew() {
    if (!session) throw new Error('助理会话尚未就绪')
    const old = session
    const oldOff = offGate
    const s = await create({ cwd }, true) // a failure leaves the current conversation untouched
    const carried = await carryModel(old, s) // before the page switches: its header and first request already use it
    epoch++
    clearTimeout(wakeTimer)
    queuedInbox = []
    woken.clear()
    oldOff?.()
    for (const own of [...inflight]) own.abort('detached') // the host's requests of the old session; the new one has none yet
    waiting.length = 0
    await old.detach().catch(() => {})
    session = s
    claim(s.id)
    seen = 0
    busy = false
    blocked = false
    log.length = 0
    notice = carried
    pump = undefined
    for (const l of [...listeners]) l.onReset?.()
    if (listeners.size > 0) ensurePump()
    return s
  }

  return {
    /** `stored` is `board.data.assistant`. Concurrent calls share one attempt. */
    ensure(stored) {
      if (session) return reclaim().then(() => session) // a page mounting here takes the session back from another tab
      pending ??= (async () => {
        const s = (await open(stored)) ?? (await create(stored))
        session = s
        claim(s.id)
        return s
      })().finally(() => {
        pending = undefined
      })
      return pending
    },
    /** `handback`: an automatic hand-back, queued as its own next turn instead of steered into a running one. */
    async send(text, { handback = false } = {}) {
      if (!session) throw new Error('助理会话尚未就绪')
      if (released) throw new Error('小川已在另一个标签页打开')
      return sendVia(session, busy, text, blocked, handback)
    },
    /** Records a hand-back id as sent before sending (a reload or a second tab must not send it twice); false when it was already recorded. */
    claimSent: async (id) => (await save({ addSentHandback: id })).added === true,
    /** Takes a recorded id back after a failed send. */
    releaseSent: (id) => save({ removeSentHandback: id }),
    /**
     * Subscribes a page to the ledger: the retained rows first (a remount rebuilds its chat from them), then
     * live ones. One pump per assistant re-attaches with an explicit cursor, so unsubscribing is synchronous
     * and a page switch never re-attaches. Returns the unsubscribe function; `error` gets a failed pump.
     */
    follow(onEvent, onError, onReset) {
      if (!session) throw new Error('助理会话尚未就绪')
      const listener = { onEvent, onError, onReset }
      for (const event of log) onEvent(event)
      listeners.add(listener)
      ensurePump()
      return () => listeners.delete(listener)
    },
    /** `cb()` runs when another tab claims the session; returns the unsubscribe function. */
    onReleased(cb) {
      releaseListeners.add(cb)
      return () => releaseListeners.delete(cb)
    },
    /** True while another tab owns the session. */
    get released() {
      return released
    },
    /** Takes the session back from the other tab (re-attaches the pump and the permission handler). */
    reclaim,
    /** Open durable decisions of the session (snapshots, `[]` before a session exists): what the host workbench lists beside a parked turn. */
    async pendingApprovals() {
      if (!session) return []
      return (await ctx.agnes.approval.list(session.id)).decisions ?? []
    },
    /** Answers a durable decision as the workbench does; the command id makes a repeated click the same command. */
    decideApproval: ({ sessionId, id, revision }, verdict) =>
      ctx.agnes.approval.decide({ sessionId, id, revision, commandId: `${id}:${revision}:${verdict}`, response: { option: verdict, value: null } }),
    /** `cb()` runs when a turn ends `parked`; returns the unsubscribe function. */
    onParked(cb) {
      parkedListeners.add(cb)
      return () => parkedListeners.delete(cb)
    },
    /** Starts a new conversation (one at a time): a new session registered as the assistant's, old one left in the session list. */
    startNew() {
      starting ??= startNew().finally(() => {
        starting = undefined
      })
      return starting
    },
    /** The session's primary model `{ route, model }` (session capabilities, as the host picker reads it); undefined when unreadable. */
    async currentModel() {
      if (!session) return undefined
      return (await session.capabilities())?.modelRoutes?.value?.primary ?? undefined
    },
    /** Models the daemon offers: `[{ route, id, label? }]` (apis().profile.models, as the host picker reads it). */
    async models() {
      return (await ctx.agnes.apis())?.profile?.models ?? []
    },
    /** Switches only this session's primary model, then returns the re-read current model. Throws when there is no session or the daemon refuses. */
    async setModel(option) {
      if (!session) throw new Error('助理会话尚未就绪')
      await session.setModel({ slot: 'primary', route: option.route, model: option.id })
      return this.currentModel()
    },
    /** One-time chat line when the conversation moved off a gone workspace; undefined otherwise. */
    get notice() {
      return notice
    },
    get lastServerSeq() {
      return session?.lastServerSeq ?? 0
    },
    onPermissionRequest(handler) {
      handlers.add(handler)
      for (const w of waiting.splice(0)) run(handler, w)
      return () => handlers.delete(handler)
    },
  }
}

const assistants = new WeakMap()
/**
 * One assistant per SDK client. The client caches the session handle and its admit watermark for good, so a
 * second assistant on the same client could neither replay history nor keep the permission handler of the first.
 */
export const assistantFor = (ctx) => {
  let assistant = assistants.get(ctx.agnes)
  if (!assistant) assistants.set(ctx.agnes, (assistant = createAssistant(ctx)))
  return assistant
}

const coordinators = new WeakMap()
/**
 * The coordinator of one project group (值守中心): its own session, registered in that group's watch record, separate from 小川.
 * Its permission requests wait in `queue` for as long as the client lives, so a page remount never loses one.
 */
export function coordinatorFor(ctx, projectId) {
  let byProject = coordinators.get(ctx.agnes)
  if (!byProject) coordinators.set(ctx.agnes, (byProject = new Map()))
  let entry = byProject.get(projectId)
  if (!entry) {
    const queue = createPermissionQueue()
    const assistant = createAssistant(ctx, {
      name: `值守协调员 · ${projectId}`,
      claimTab: false,
      keyPrefix: `devboard-watch:${projectId}`,
      save: async ({ sessionId, cwd }) => {
        const receipt = await ctx.profile.services.effect('devboard.watch.session', { projectId, sessionId, cwd }, { operationId: crypto.randomUUID() })
        if (receipt?.output?.ok === false) throw new Error(receipt.output.error)
        return receipt?.output
      },
    })
    assistant.onPermissionRequest(queue.add)
    byProject.set(projectId, (entry = { assistant, queue }))
  }
  return entry
}
