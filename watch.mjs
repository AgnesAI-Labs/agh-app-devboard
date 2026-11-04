// Watch center (design 2026-11-03): the project group's chat, the local rule layer and the ticket state machine.
// Plain functions over one project's watch state (`w`), no host imports, so node tests drive them directly.
// Nothing here calls a model: a message the rules would hand to the coordinator stops as the decision
// { layer: 'model', verdict: 'pending' } (shown as 待协调员判断) until `settle` records the coordinator's answer.
// The coordinator (a real model session per project group) answers through three tools that call settle,
// coordinatorTicket and botSay; the page only forwards messages to that session.

import { waitingOnRole } from './client/lens.js'
import { checkText, chunks, DomainError, read, snapshot } from './domain.mjs'
import { ROLES } from './profiles.mjs'

const fail = (message) => {
  throw new DomainError(message)
}

export const MESSAGE_LIMIT = 500
export const TICKET_LIMIT = 200
export const MEMBER_LIMIT = 40
export const TEXT_LIMIT = 500
export const STALL_MS = 25 * 60_000
export const SOURCES = ['im', 'ci', 'phm', 'email']
export const SOURCE_LABELS = { im: 'IM', ci: 'CI', phm: 'PHM', email: '邮件' }
/** Only these roles change members and rule modes. */
export const MANAGER_ROLES = ['项目经理', '技术负责人']
export const BOT = 'bot'
export const BOT_NAME = '研发协调员'
const MENTION = /@研发协调员/

// ── Rules ───────────────────────────────────────────────────────────────────────────────────────
// drop: always on, the message ends here. route: a live thread's follow-ups go to its ticket.
// accept: a request the coordinator should judge; `live` hands it over, `shadow` only records what it would do.

export const RULES = [
  { id: 'R-chat', name: '闲聊与确认', kind: 'drop', re: /(午饭|食堂|外卖|奶茶|收到|好的|OK|谢谢|辛苦|哈哈|👍)/, tag: '闲聊' },
  { id: 'R-meet', name: '会议事务', kind: 'drop', re: /(会议室|纪要|视频会议|日历|改到|推迟|议程)/, tag: '会议事务' },
  { id: 'R-ci-green', name: 'CI 构建通过', kind: 'drop', src: 'ci', re: /(通过|✅)/, tag: '构建通过' },
  { id: 'R-phm-hb', name: 'PHM 心跳', kind: 'drop', src: 'phm', re: /(心跳|在线)/, tag: '心跳' },
  { id: 'R-news', name: '订阅邮件', kind: 'drop', src: 'email', re: /(周刊|订阅|退订|Newsletter)/i, tag: '订阅邮件' },
  { id: 'R-route', name: '线程跟进直送', kind: 'route', desc: '已立项线程里的新消息，直接送达工单，不重新判断' },
  { id: 'R-mention', name: '@协调员 请求立项', kind: 'accept', desc: '有人明确 @研发协调员', test: (m) => m.mentionsBot },
  {
    id: 'R-ci-red',
    name: 'CI 失败自动立项',
    kind: 'accept',
    desc: '构建或回归失败，派对应角色先排查',
    src: 'ci',
    re: /(失败|failed|❌)/i,
  },
  {
    id: 'R-phm-spec',
    name: 'PHM 告警静默起草',
    kind: 'accept',
    desc: '告警先静默起草 8D，确认可复现才来找你',
    src: 'phm',
    re: /(告警|报警|alarm)/i,
  },
  {
    id: 'R-clause',
    name: '客户条款来函起草响应',
    kind: 'accept',
    desc: '客户就合同条款来函，起草条款响应',
    src: 'email',
    re: /(条款|合同)/,
    mode: 'shadow',
  },
  {
    id: 'R-mail-status',
    name: '客户进展询问起草答复',
    kind: 'accept',
    desc: '客户询问缺陷或项目进展，起草答复',
    src: 'email',
    re: /(进展|进度|询问)/,
  },
]
const RULE_BY_ID = Object.fromEntries(RULES.map((r) => [r.id, r]))
const matches = (r, m) => (r.test ? r.test(m) : (!r.src || r.src === m.source) && r.re.test(m.text))
export const ruleMode = (w, id) => w.rules[id] ?? RULE_BY_ID[id]?.mode ?? 'live'

// ── Ticket state machine ────────────────────────────────────────────────────────────────────────

const TERMINAL = ['done', 'discarded']
/** state → event → next state. Anything not listed throws. */
export const TICKET_MACHINE = {
  queued: { start: 'running' },
  running: { finish: 'done', ask: 'waiting_human', ready: 'speculative_ready', stall: 'stalled', expire: 'discarded' },
  waiting_human: { approve: 'done', reply: 'queued' },
  speculative_ready: { adopt: 'done', discard: 'discarded' },
  stalled: { redispatch: 'queued' },
  done: {},
  discarded: {},
}
/** What a person may do on a ticket that waits for them. */
const HUMAN_ACTIONS = {
  waiting_human: [
    { act: 'approve', label: '批准', primary: true },
    { act: 'reply', label: '回复' },
  ],
  speculative_ready: [
    { act: 'adopt', label: '采纳草稿', primary: true },
    { act: 'discard', label: '丢弃' },
  ],
  stalled: [{ act: 'redispatch', label: '重新派发', primary: true }],
}
const LINES = {
  start: ['info', '子 Agent 已启动'],
  finish: ['done', '已完成'],
  ask: ['surface', '需要人决定'],
  ready: ['surface', '草稿转为待处理'],
  stall: ['surface', '进展巡检：长时间无进展，已标记为停滞'],
  expire: ['discard', '草稿未获确认，已静默丢弃'],
  approve: ['info', '已批准'],
  reply: ['info', '已回复'],
  adopt: ['info', '已采纳草稿'],
  discard: ['discard', '已丢弃草稿'],
  redispatch: ['info', '已重新派发'],
}
const iso = (now) => new Date(now).toISOString()
const clip = (value, name, max) => {
  if (typeof value !== 'string' || !value.trim()) fail(`缺少字段：${name}`)
  return checkText(value, name).trim().slice(0, max)
}

const ticketOf = (w, id) => w.tickets.find((t) => t.id === id) ?? fail(`未找到工单 ${id}`)
const waitsForMember = (wf, member) =>
  wf?.memberId ? wf.memberId === member.id : Boolean(wf?.role) && wf.role === member.role

export function addProgress(w, ticketId, line, now, kind = 'info') {
  const t = ticketOf(w, ticketId)
  t.progress.push({ at: iso(now), kind, line: clip(line, 'line', 300) })
  if (kind !== 'surface' && kind !== 'input' && kind !== 'discard') t.lastProgressAt = iso(now)
  return t
}

/**
 * One table-driven move. `ask` and `ready` need `needsHuman: { waitsFor: { role?, memberId? }, question }`;
 * the actions come from the table. Every other state clears `needsHuman`.
 */
export function moveTicket(w, ticketId, event, now, extra = {}) {
  const t = ticketOf(w, ticketId)
  const next = TICKET_MACHINE[t.state]?.[event]
  if (!next) fail(`工单 ${t.id} 当前为 ${t.state}，不能执行 ${event}`)
  let needs = null
  if (HUMAN_ACTIONS[next]) {
    const wf = extra.needsHuman?.waitsFor
    if (!wf || (!wf.role && !wf.memberId)) fail(`工单转入 ${next} 需要指明等待谁（waitsFor）`)
    if (wf.role && !ROLES.includes(wf.role)) fail(`角色无效：${wf.role}`)
    needs = {
      waitsFor: wf,
      question: clip(extra.needsHuman.question, 'question', 300),
      actions: HUMAN_ACTIONS[next],
    }
  }
  const [kind, line] = LINES[event]
  t.state = next
  t.needsHuman = needs
  addProgress(w, t.id, extra.line ? `${extra.line}` : line, now, kind)
  return t
}

/** Running tickets with no progress for STALL_MS become stalled and wait for the project manager. */
export function patrol(w, now) {
  const moved = []
  for (const t of w.tickets) {
    if (t.state !== 'running' || now - Date.parse(t.lastProgressAt) <= STALL_MS) continue
    const mins = Math.round((now - Date.parse(t.lastProgressAt)) / 60_000)
    moveTicket(w, t.id, 'stall', now, {
      line: `进展巡检：超过 ${mins} 分钟无进展，已标记为停滞`,
      needsHuman: { waitsFor: { role: '项目经理' }, question: `子 Agent 已约 ${mins} 分钟没有新进展，可能卡住` },
    })
    moved.push(t.id)
  }
  return moved
}

/** A person's action on a ticket: the declared member must be the one it waits for, and the action one it offers. */
export function humanAct(w, { ticketId, memberId, act, text }, now) {
  const t = ticketOf(w, ticketId)
  const member = memberOf(w, memberId)
  if (!t.needsHuman) fail(`工单 ${t.id} 当前（${t.state}）没有等待人处理的事项`)
  const offered = t.needsHuman.actions.find((a) => a.act === act)
  if (!offered) fail(`工单 ${t.id} 不提供动作 ${String(act)}（可选 ${t.needsHuman.actions.map((a) => a.act).join(' / ')}）`)
  if (!waitsForMember(t.needsHuman.waitsFor, member)) {
    const wf = t.needsHuman.waitsFor
    fail(`这件事在等${wf.memberId ? memberName(w, wf.memberId) : `「${wf.role}」`}，当前身份（${member.name}·${member.role}）不能处理`)
  }
  const reply = typeof text === 'string' ? text.trim() : ''
  if (act === 'reply' && !reply) fail('回复需要填写内容')
  if (reply) checkText(reply, 'text')
  return moveTicket(w, t.id, act, now, {
    line: `${member.name}（${member.role}）${offered.label}${reply ? `：${reply.slice(0, 200)}` : ''}`,
  })
}

/** What the coordinator may do to a ticket; approve / reply / adopt / discard are people's, stall is the patrol's. */
export const COORDINATOR_EVENTS = ['start', 'finish', 'ask', 'ready', 'expire']

/**
 * The coordinator's move on a ticket: a progress line, a state event from the table, or both (the line then
 * becomes the event's progress line). `ask` and `ready` carry `needsHuman`; the offered actions come from the table.
 */
export function coordinatorTicket(w, { ticketId, line, event, needsHuman }, now) {
  const t = ticketOf(w, ticketId)
  if (!event && !line) fail('需要 line（进度）或 event（状态转换）')
  if (event) {
    if (!COORDINATOR_EVENTS.includes(event)) fail(`协调员不能执行 ${String(event)}（可用 ${COORDINATOR_EVENTS.join(' / ')}）`)
    return moveTicket(w, t.id, event, now, { ...(line ? { line } : {}), ...(needsHuman ? { needsHuman } : {}) })
  }
  if (needsHuman) fail('needsHuman 只能随 ask / ready 事件一起提交')
  if (TERMINAL.includes(t.state)) fail(`工单 ${t.id} 已结束（${t.state}），不能再追加进度`)
  return addProgress(w, t.id, line, now)
}

// ── Members ─────────────────────────────────────────────────────────────────────────────────────

export const memberOf = (w, id) => w.members.find((m) => m.id === id) ?? fail(`未找到成员 ${String(id)}`)
export const memberName = (w, id) => (id === BOT ? BOT_NAME : (w.members.find((m) => m.id === id)?.name ?? id))
export const canManage = (member) => MANAGER_ROLES.includes(member.role)
function manager(w, by) {
  const m = memberOf(w, by)
  if (!canManage(m)) fail(`只有${MANAGER_ROLES.join('、')}可以调整成员与规则（当前身份：${m.role}）`)
  return m
}

export function addMember(w, { by, name, role }) {
  manager(w, by)
  const n = clip(name, 'name', 24)
  if (!ROLES.includes(role)) fail(`角色无效：${String(role)}`)
  if (w.members.some((m) => m.name === n)) fail(`成员 ${n} 已在本群`)
  if (w.members.length >= MEMBER_LIMIT) fail(`成员已达上限 ${MEMBER_LIMIT}`)
  const member = { id: `M-${++w.seq.M}`, name: n, role }
  w.members.push(member)
  return member
}

export function removeMember(w, { by, memberId }) {
  manager(w, by)
  if (by === memberId) fail('不能移除自己')
  const m = memberOf(w, memberId)
  w.members = w.members.filter((x) => x.id !== m.id)
  return m
}

export function setRuleMode(w, { by, ruleId, mode }) {
  manager(w, by)
  const r = RULE_BY_ID[ruleId]
  if (r?.kind !== 'accept') fail(`规则 ${String(ruleId)} 不可切换（常驻过滤和线程直送不能关闭）`)
  if (mode !== 'live' && mode !== 'shadow') fail(`模式无效：${String(mode)}`)
  w.rules[ruleId] = mode
  return { ruleId, mode }
}

/** Demo reset: the group's messages, decisions and tickets go; members, rules and the coordinator session stay, ids are never reused. */
export function resetWatch(w, { by }) {
  manager(w, by)
  const gone = { messages: w.messages.length, tickets: w.tickets.length }
  w.messages = []
  w.decisions = []
  w.tickets = []
  return gone
}

// ── Messages and the rule layer ─────────────────────────────────────────────────────────────────

const liveTicketOnThread = (w, threadId) =>
  w.tickets.find((t) => t.origin.threadId === threadId && !TERMINAL.includes(t.state))

export function decide(w, m) {
  const live = liveTicketOnThread(w, m.threadId)
  if (live)
    return { layer: 'rule', verdict: 'route', ruleId: 'R-route', reason: '已送达工单，未重新判断', ticketId: live.id }
  if (!m.mentionsBot) {
    const drop = RULES.find((r) => r.kind === 'drop' && matches(r, m))
    if (drop) return { layer: 'rule', verdict: 'ignore', ruleId: drop.id, reason: `已过滤：${drop.tag}` }
  }
  const accept = RULES.find((r) => r.kind === 'accept' && matches(r, m))
  if (accept && ruleMode(w, accept.id) === 'shadow')
    return {
      layer: 'rule',
      verdict: 'record',
      ruleId: accept.id,
      reason: `命中影子规则「${accept.name}」，只记录、不开工`,
      shadow: true,
      wouldDo: `如果开启，会交给协调员判断：${accept.desc}`,
    }
  if (accept)
    return { layer: 'model', verdict: 'pending', ruleId: accept.id, reason: `命中「${accept.name}」，待协调员判断` }
  return { layer: 'rule', verdict: 'record', ruleId: null, reason: '没有 @协调员，也不命中立项规则，仅记录' }
}

function trim(w) {
  const pinned = new Set(w.tickets.filter((t) => !TERMINAL.includes(t.state)).map((t) => t.origin.messageId))
  while (w.messages.length > MESSAGE_LIMIT) {
    const i = w.messages.findIndex((m) => !pinned.has(m.id))
    if (i < 0) break
    const [gone] = w.messages.splice(i, 1)
    w.decisions = w.decisions.filter((d) => d.messageId !== gone.id)
  }
}

/** A member's message or a signal enters the group; the server owns at, thread and the @ flag. */
export function ingest(w, { source, actor, text, threadId }, now) {
  if (!SOURCES.includes(source)) fail(`来源无效：${String(source)}`)
  const body = clip(text, 'text', TEXT_LIMIT)
  if (threadId !== undefined && !w.messages.some((m) => m.threadId === threadId)) fail(`未找到线程 ${threadId}`)
  if (source === 'im') memberOf(w, actor)
  const message = {
    id: `MSG-${++w.seq.MSG}`,
    projectId: w.projectId,
    source,
    actor,
    text: body,
    threadId: threadId ?? `TH-${++w.seq.TH}`,
    mentionsBot: MENTION.test(body),
    at: iso(now),
  }
  w.messages.push(message)
  const decision = { id: `DEC-${++w.seq.DEC}`, messageId: message.id, at: iso(now), ...decide(w, message) }
  w.decisions.push(decision)
  if (decision.verdict === 'route')
    addProgress(w, decision.ticketId, `收到补充（${memberName(w, actor)}）：${body.slice(0, 200)}`, now, 'input')
  trim(w)
  return { message, decision }
}

/** The coordinator's answer to a pending message: ignore, record or accept with a ticket. */
export function settle(w, messageId, { verdict, reason, ticket }, now) {
  const d = w.decisions.find((x) => x.messageId === messageId)
  if (d?.layer !== 'model' || d.verdict !== 'pending') fail(`消息 ${messageId} 没有待协调员判断的判定`)
  if (!['ignore', 'record', 'accept'].includes(verdict)) fail(`判定无效：${String(verdict)}`)
  const why = clip(reason, 'reason', 300)
  // the ticket first: a refused ticket must leave the decision pending
  if (verdict === 'accept') d.ticketId = createTicket(w, d, ticket ?? {}, now).id
  d.verdict = verdict
  d.reason = why
  return d
}

function createTicket(w, decision, spec, now) {
  const message = w.messages.find((m) => m.id === decision.messageId)
  if (w.tickets.length >= TICKET_LIMIT) {
    const i = w.tickets.findIndex((t) => TERMINAL.includes(t.state))
    if (i < 0) fail(`进行中的工单已达上限 ${TICKET_LIMIT}`)
    w.tickets.splice(i, 1)
  }
  const ticket = {
    id: `WI-${++w.seq.WI}`,
    projectId: w.projectId,
    title: clip(spec.title, 'title', 120),
    role: clip(spec.role, 'role', 40),
    objectRef: clip(spec.objectRef ?? '未指定', 'objectRef', 64),
    mandate: { scope: clip(spec.scope, 'scope', 300), ruleId: decision.ruleId },
    origin: { messageId: message.id, threadId: message.threadId, requester: message.actor },
    state: 'queued',
    progress: [],
    needsHuman: null,
    createdAt: iso(now),
    lastProgressAt: iso(now),
    ...(spec.speculative ? { speculative: true } : {}),
  }
  w.tickets.push(ticket)
  addProgress(w, ticket.id, '已立项，等待空闲子 Agent', now)
  return ticket
}

/**
 * The coordinator speaks in the group, only where it was asked: the thread has a message that @-mentioned it
 * or a ticket. Its words are not an entry, so they get no decision and never reach the rule layer.
 */
export function botSay(w, { threadId, text }, now) {
  if (!w.messages.some((m) => m.threadId === threadId)) fail(`未找到线程 ${String(threadId)}`)
  const asked =
    w.messages.some((m) => m.threadId === threadId && m.mentionsBot) || w.tickets.some((t) => t.origin.threadId === threadId)
  if (!asked) fail(`线程 ${threadId} 里没有 @研发协调员，也没有立项，协调员不主动插话`)
  const message = {
    id: `MSG-${++w.seq.MSG}`,
    projectId: w.projectId,
    source: 'im',
    actor: BOT,
    text: clip(text, 'text', TEXT_LIMIT),
    threadId,
    mentionsBot: false,
    at: iso(now),
  }
  w.messages.push(message)
  trim(w)
  return message
}

/** The project's coordinator session, registered by the page that created it so every reload re-attaches the same one. */
export function setSession(w, { sessionId, cwd }) {
  w.session = { sessionId: clip(sessionId, 'sessionId', 64), cwd: clip(cwd, 'cwd', 1024) }
  return w.session
}

// ── Queries ─────────────────────────────────────────────────────────────────────────────────────

/** What waits for this member: tickets that name them (by id or role) and the board items of their role. */
export function needsFor(w, board, member) {
  const tickets = w.tickets.filter((t) => t.needsHuman && waitsForMember(t.needsHuman.waitsFor, member))
  const { gates, flows, interventions } = waitingOnRole(member.role, board)
  return {
    tickets: tickets.map((t) => t.id),
    gates: gates.map((g) => g.id),
    flows: flows.map((f) => f.id),
    interventions: interventions.map((i) => i.id),
  }
}

/** Every number of the funnel, counted from the stored records. */
export function funnel(w) {
  const dec = (f) => w.decisions.filter(f).length
  return {
    received: w.messages.filter((m) => m.actor !== BOT).length,
    ruleFiltered: dec((d) => d.layer === 'rule' && d.verdict === 'ignore'),
    routed: dec((d) => d.verdict === 'route'),
    sentToModel: dec((d) => d.layer === 'model'),
    pendingModel: dec((d) => d.layer === 'model' && d.verdict === 'pending'),
    recorded: dec((d) => d.layer === 'rule' && d.verdict === 'record' && !d.shadow),
    shadow: dec((d) => d.shadow),
    accepted: w.tickets.length,
    interruptions: w.tickets.filter((t) => t.progress.some((p) => p.kind === 'surface')).length,
    delivered: w.tickets.filter((t) => t.state === 'done').length,
  }
}

// ── Seed ────────────────────────────────────────────────────────────────────────────────────────

const roleAlt = [...ROLES].sort((a, b) => b.length - a.length).join('|')
const PERSON = new RegExp(`^(${roleAlt}) ([\\u4e00-\\u9fff]{2,4})$`)

function people(value, out) {
  if (typeof value === 'string') {
    const m = PERSON.exec(value)
    if (m) out.set(m[2], m[1])
  } else if (value && typeof value === 'object') for (const v of Object.values(value)) people(v, out)
}

/** Members come from what the project already names: its manager, risk owners, CCB seats, requesters. */
export function seedMembers(board, projectId) {
  const project = board.projects.find((p) => p.id === projectId) ?? fail(`未找到项目 ${projectId}`)
  const found = new Map()
  people(project.manager, found)
  people(project, found)
  for (const key of ['changes', 'defects', 'trials', 'problems', 'tasks', 'requirements'])
    for (const item of board[key] ?? []) if (item.projectId === projectId) people(item, found)
  // The two roles that decide things must exist, so the group is never without someone to ask.
  for (const [name, role] of [['郑凯', '技术负责人'], ['韩雪', '质量工程师']])
    if (![...found.values()].includes(role) && !found.has(name)) found.set(name, role)
  return [...found].slice(0, 12).map(([name, role], i) => ({ id: `M-${i + 1}`, name, role }))
}

const MIN = 60_000
/** A new group starts with its members only: every message and ticket afterwards is real activity. */
export function seedWatch(board, projectId) {
  const members = seedMembers(board, projectId)
  return {
    projectId,
    seq: { M: members.length, MSG: 0, DEC: 0, WI: 0, TH: 0 },
    members,
    rules: {},
    session: null,
    messages: [],
    decisions: [],
    tickets: [],
  }
}

// ── Store ───────────────────────────────────────────────────────────────────────────────────────
// Per project: a meta key plus chunked messages / decisions / tickets, each value under the 64 KiB cap.

const key = (projectId, name) => `devboard/watch/${projectId}/${name}`
const COLLECTIONS = ['messages', 'decisions', 'tickets']

function load(store, projectId) {
  const meta = store.get(key(projectId, 'meta'))
  if (!meta) return undefined
  const w = { projectId, seq: meta.seq, members: meta.members, rules: meta.rules, session: meta.session ?? null }
  for (const c of COLLECTIONS)
    w[c] = Array.from({ length: meta.chunks?.[c] ?? 0 }, (_, i) => store.get(key(projectId, `${c}/${i}`)) ?? []).flat()
  return w
}

function save(store, w) {
  const previous = store.get(key(w.projectId, 'meta'))
  const counts = {}
  for (const c of COLLECTIONS) {
    const parts = chunks(w[c])
    parts.forEach((part, i) => {
      store.set(key(w.projectId, `${c}/${i}`), part)
    })
    for (let i = parts.length; i < (previous?.chunks?.[c] ?? 0); i++) store.delete(key(w.projectId, `${c}/${i}`))
    counts[c] = parts.length
  }
  store.set(key(w.projectId, 'meta'), { seq: w.seq, members: w.members, rules: w.rules, session: w.session, chunks: counts })
}

/** Read-only: a project never written yet reads as its seed relative to `now`. Applies the stall patrol to the copy only. */
export function readWatch(store, projectId, now = Date.now()) {
  const board = read(store, now)
  const w = store.transaction(() => load(store, projectId)) ?? seedWatch(board, projectId)
  patrol(w, now)
  return { w, board }
}

/** One transaction per write: load (or seed), run the stall patrol, apply `work`, persist. */
export function updateWatch(store, projectId, work, now = Date.now()) {
  const board = read(store, now)
  return store.transaction(() => {
    const w = load(store, projectId) ?? seedWatch(board, projectId)
    patrol(w, now)
    const result = work(w, board)
    save(store, w)
    return result
  })
}

/** The page's read model for one project and (optionally) one declared member. */
export function watchSnapshot(store, { projectId, memberId }, now = Date.now()) {
  const { w, board } = readWatch(store, projectId, now)
  const member = memberId ? w.members.find((m) => m.id === memberId) : undefined
  const data = snapshot(board, now, projectId)
  const hits = (id) => w.decisions.filter((d) => d.ruleId === id).length
  return JSON.parse(
    JSON.stringify({
      projectId,
      now: iso(now),
      projects: board.projects.map((p) => ({ id: p.id, name: p.name })),
      members: w.members,
      session: w.session,
      rules: RULES.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        desc: r.desc ?? `命中「${r.tag}」的消息直接挡掉`,
        mode: r.kind === 'accept' ? ruleMode(w, r.id) : 'live',
        hits: hits(r.id),
      })),
      messages: w.messages,
      decisions: w.decisions,
      tickets: w.tickets,
      funnel: funnel(w),
      // the member the needs were computed for: a page that just switched identity must not show the old member's list
      needsMember: member?.id ?? null,
      needs: member ? needsFor(w, data, member) : null,
      stallMinutes: STALL_MS / MIN,
    }),
  )
}

// ── Service handlers (index.mjs wires them to the schemas) ───────────────────────────────────────

export const watchHandlers = {
  'devboard.watch.post': (input, store) =>
    updateWatch(store, input.projectId, (w, _board) => {
      const member = memberOf(w, input.by)
      const actor = input.source === 'im' ? member.id : (input.from ?? SOURCE_LABELS[input.source])
      return ingest(w, { source: input.source, actor, text: input.text, threadId: input.threadId }, Date.now())
    }),
  'devboard.watch.act': (input, store) =>
    updateWatch(store, input.projectId, (w) => ({
      ticket: humanAct(w, { ticketId: input.ticketId, memberId: input.by, act: input.act, text: input.text }, Date.now()),
    })),
  'devboard.watch.member': (input, store) =>
    updateWatch(store, input.projectId, (w) =>
      input.op === 'add'
        ? { member: addMember(w, input) }
        : { member: removeMember(w, { by: input.by, memberId: input.memberId }) },
    ),
  'devboard.watch.rule': (input, store) =>
    updateWatch(store, input.projectId, (w) => setRuleMode(w, input)),
  'devboard.watch.reset': (input, store) =>
    updateWatch(store, input.projectId, (w) => ({ cleared: resetWatch(w, { by: input.by }) })),
  'devboard.watch.session': (input, store) =>
    updateWatch(store, input.projectId, (w) => ({ session: setSession(w, input) })),
}
