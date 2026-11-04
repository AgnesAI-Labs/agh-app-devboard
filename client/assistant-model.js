// Pure model of the assistant page: session events -> chat items, and the watch rail from board data.
// No React and no host imports, so the unit tests run it directly. The store (board.data) stays the
// source of truth for every card; events only add bubbles, progress lines and the places cards go.

/** Tool name -> label of its collapsed progress line. The one table to extend when a tool is added. */
export const TOOL_LABELS = {
  devboard_board: '查看看板',
  devboard_create_requirement: '创建需求',
  devboard_create_task: '创建任务',
  devboard_transition: '流转状态',
  devboard_request_human: '请你拍板',
  devboard_project_create: '新建项目',
  devboard_stage_update: '更新阶段',
  devboard_artifact_record: '登记交付物',
  devboard_req_upsert: '更新需求',
  devboard_gate_submit: '提交评审门',
  devboard_gate_status: '查看评审门',
  devboard_gate_check: '规则快检',
  devboard_gate_review: '评审会',
  devboard_test_record: '登记测试',
  devboard_defect_upsert: '更新缺陷',
  devboard_change_upsert: '更新变更',
  devboard_trial_upsert: '更新试验',
  devboard_problem_upsert: '更新质量问题',
  devboard_fault_list: '查看故障',
  devboard_approval_submit: '提交审批',
  devboard_app_register: '登记应用入口',
  devboard_fastforward: '快进演示',
  devboard_handoff: '查看交接',
  devboard_watch_decide: '值守判定',
  devboard_watch_ticket: '推进值守工单',
  devboard_watch_reply: '在群里回复',
  subagent_spawn: '派出角色',
  subagent_collect: '收取角色结果',
  subagent_list: '查看角色进度',
  subagent_send_message: '续派角色',
  read: '读取文件',
  write: '写入文件',
  edit: '修改文件',
  shell: '执行命令',
  grep: '搜索内容',
  find: '查找文件',
  ls: '浏览目录',
  skill_read: '查阅手册',
  present: '展示成果',
}

/** DevBoard tools that never change the board; every other `devboard_*` call counts as a write. */
export const READ_ONLY = new Set([
  'devboard_board',
  'devboard_gate_status',
  'devboard_gate_check',
  'devboard_fault_list',
  'devboard_handoff',
])

/** Tools whose result adds a card to the chat; the card itself is drawn from board data by project id. */
const CARD_OF = {
  devboard_project_create: 'project',
  devboard_stage_update: 'project',
  devboard_gate_submit: 'gate',
  devboard_gate_check: 'gate',
  devboard_gate_review: 'gate',
  devboard_approval_submit: 'approval',
  devboard_request_human: 'intervention',
  devboard_artifact_record: 'deliverable',
  devboard_app_register: 'deliverable',
  devboard_fastforward: ['gate', 'approval'], // lands at a gate, with an approval flow running in the change scenario
}

/** Cards that ask the person for a decision. */
const DECISION_CARDS = ['gate', 'approval', 'intervention']
const AGENT_CALLS = ['subagent_spawn', 'subagent_collect']
const PROJECT_ID = /PRJ-\d{4}-\d{3}/
const KEEP = 2000

/** The read-only composer label: board tools run without a card; shell, file edits and the like still ask. */
export const BOARD_NO_CONFIRM = { text: '看板操作免确认', hint: '小川登记看板无需逐条确认；运行命令、改文件仍会问你' }

export const toolLabel = (name) => TOOL_LABELS[name] ?? name
export const isWriteCall = (name) => name.startsWith('devboard_') && !READ_ONLY.has(name)

/** Text of an event payload: content blocks, a plain string, or a text field. */
export function textOf(data) {
  const c = data?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c))
    return c
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
  return typeof data?.text === 'string' ? data.text : ''
}

/** A tool result of a session opened before a plugin reload: the host refuses its store access with CAPABILITY_DENIED (index.mjs describeError). */
export const capabilityDenied = (text) => /^\s*CAPABILITY_DENIED\b/.test(String(text ?? ''))

/**
 * A turn that ended in error (ledger turn/end {reason:'error', error:{code,message}}), as a plain-language line plus the
 * raw code/message for the technical detail; null for a turn that ended any other way. Shared by the chat and the coordinator chip.
 */
export function turnError(data) {
  if (data?.reason !== 'error') return null
  const code = String(data.error?.code ?? 'ERROR')
  const message = String(data.error?.message ?? '')
  const what = code === 'TRANSPORT' ? `模型服务返回错误（${message || '无响应'}）` : `出现错误（${message || code}）`
  return { code, message, text: `这一轮没有完成：${what}。可以重试，或在页头换一个模型。` }
}

const REASON_TEXT = {
  repeated_write: (n, tool) => (tool === 'subagent_collect' ? `连续 ${n ?? '多'} 次重复等待同一个角色的结果` : `连续 ${n ?? '多'} 次重复了同一个操作`),
  no_progress: (n) => `连续 ${n ?? '多'} 次回复都没有新的进展`,
  schema_invalid: () => '工具调用的参数不合法',
  tool_call_as_text: () => '工具调用被写成了文字，没有执行',
  output_truncated: () => '回复在输出上限处被截断',
}

/**
 * A turn that ended `blocked` (the core's automatic checks, or a hook, stopped it), as a plain-language line plus the
 * raw reason codes. `reasons` are the latest x/core/verifier-recovery verdict reasons, `tool` the turn's last tool call.
 */
export function blockedNotice(data, reasons, tool) {
  const said = (reasons ?? []).map((r) => {
    const [code, n] = String(r).split(':', 2)
    return REASON_TEXT[code]?.(n, tool) ?? String(r)
  })
  const hook = data?.error?.code === 'HOOK_BLOCKED' ? `被拦截规则拦下（${data.error.message || '无说明'}）` : ''
  const why = said.length ? `：${said.join('；')}` : hook ? `：${hook}` : ''
  return {
    detail: (reasons ?? []).join(', ') || String(data?.error?.code ?? ''),
    text: `这一轮被自动检查拦下了${why}。这不代表任务出错；点「继续」或直接发一条消息，我会接着做。`,
  }
}

export const EMPTY = Object.freeze({
  items: [],
  n: 0,
  busy: false,
  turn: { writes: false, lastAssistant: null, cards: [], cardIds: [] },
})

const push = (s, item) => {
  const id = `m${s.n + 1}`
  return { ...s, n: s.n + 1, items: [...s.items, { id, ...item }] }
}
const patch = (s, id, change) => ({
  ...s,
  items: s.items.map((i) => (i.id === id ? { ...i, ...change } : i)),
})

/** First-line marker of a hand-back the page sent for the person. */
export const AUTO_HANDBACK = '自动交回 · '
const SENT_KEEP = 200

/** Open hand-back cards (with a work object) whose id is not in `sent`, oldest first. */
export const pendingHandbacks = (data, sent, failed) =>
  (data?.handbacks ?? [])
    .filter((c) => c.state === 'OPEN' && c.action && c.object?.type && c.object.id && !(sent ?? []).includes(c.id) && !failed?.has(c.id))
    .sort((a, b) => a.rev - b.rev)

/** The sent-id list stays bounded: only the newest ids matter, older cards are long followed up. */
export const capSent = (ids) => ids.slice(-SENT_KEEP)

// Host user/message kinds a person authors (core step/inbox.ts EnqueueMsg.kind); absent = legacy rows.
const PERSON_KINDS = new Set(['prompt', 'follow_up', 'steer', undefined])

/** Fold one ledger event into the chat state. Events it does not know leave the state alone. */
export function reduceEvent(s, event) {
  const { type, data } = event
  if (type === 'user/message') {
    const text = textOf(data)
    if (!text) return s
    // Runtime/hook context and nested-result notes (host kind runtime_context) are for the model, not the chat.
    if (data?.kind === 'runtime_context') return s
    // Only the person's own message (principal, trusted, a prompt-like kind) is a user bubble; anything else
    // (a background child's completion notice is origin system, trust untrusted) is a collapsed system line.
    const person = (event.origin ?? 'principal') === 'principal' && event.trust !== 'untrusted' && PERSON_KINDS.has(data?.kind)
    if (!person) return push(s, { kind: 'system', label: text.startsWith('Handled by ') ? '系统 · 子任务结果' : '系统 · 通知', text })
    // An automatic hand-back is sent with its prompt below the first line; the chat shows only the line.
    return push(s, { kind: 'user', text: text.startsWith(AUTO_HANDBACK) ? text.split('\n')[0] : text })
  }
  if (type === 'devboard/reset') return EMPTY // a new conversation: the page chat starts over
  if (type === 'devboard/notice') return push(s, { kind: 'system', label: '系统 · 通知', text: data.text })
  // a new turn answers any 继续 offer still showing
  if (type === 'turn/start')
    return {
      ...s,
      busy: true,
      items: s.items.map((i) => (i.kind === 'blocked' && !i.done ? { ...i, done: true } : i)),
      turn: { writes: false, lastAssistant: null, cards: [], cardIds: [] },
    }
  if (type === 'x/core/verifier-recovery') return { ...s, turn: { ...s.turn, reasons: data?.verdict?.reasons ?? [] } }
  if (type === 'turn/end') {
    const { lastAssistant, writes } = s.turn
    const cardIds = s.turn.cardIds ?? []
    const failed = turnError(data)
    // a panel that asks the person to decide sits right below the reply that asks, not above it
    const asks = (i) => i.kind === 'card' && cardIds.includes(i.id) && DECISION_CARDS.includes(i.card)
    const settled = { ...s, busy: false, items: [...s.items.filter((i) => !asks(i)), ...s.items.filter(asks)] }
    const stopped = data?.reason === 'blocked'
    const lastTool = s.items.findLast((i) => i.kind === 'progress')?.name ?? ''
    const next = failed
      ? push(settled, { kind: 'error', ...failed })
      : stopped
        ? push(settled, { kind: 'blocked', done: false, ...blockedNotice(data, s.turn.reasons, lastTool) })
        : settled
    // A reply is "answer only" when its finished turn made no DevBoard write call: observable, not self-reported.
    return lastAssistant && !writes ? patch(next, lastAssistant, { answerOnly: true }) : next
  }
  if (type === 'assistant/message') {
    const text = textOf(data)
    if (!text) return s
    const next = push(s, { kind: 'assistant', text })
    return { ...next, turn: { ...s.turn, lastAssistant: `m${next.n}` } }
  }
  if (type === 'tool/call') {
    const name = String(data?.name ?? '')
    const next = push(s, {
      kind: 'progress',
      toolUseId: data?.toolUseId,
      name,
      label: toolLabel(name),
      status: 'running',
      args: data?.args ?? null,
      refText: JSON.stringify(data?.args ?? null).slice(0, KEEP),
    })
    return isWriteCall(name) ? { ...next, turn: { ...next.turn, writes: true } } : next
  }
  if (type === 'tool/result') {
    const line = s.items.find((i) => i.kind === 'progress' && i.toolUseId === data?.toolUseId)
    if (!line) return s
    const failed = data?.isError === true
    const refText = `${line.refText}\n${textOf(data)}`.slice(0, KEEP * 2)
    const next = patch(s, line.id, { status: failed ? 'error' : 'done', refText, denied: failed && capabilityDenied(textOf(data)) })
    const projectId = refText.match(PROJECT_ID)?.[0]
    if (failed || !projectId) return next
    return [].concat(CARD_OF[line.name] ?? []).reduce((acc, card) => {
      const key = `${card}:${projectId}`
      if (acc.turn.cards.includes(key)) return acc
      const id = `m${acc.n + 1}`
      return { ...push(acc, { kind: 'card', card, projectId }), turn: { ...acc.turn, cards: [...acc.turn.cards, key], cardIds: [...(acc.turn.cardIds ?? []), id] } }
    }, next)
  }
  return s
}

const roleName = (role) => String(role ?? '').split('#').pop()

/** Sub-agents still working: spawn or collect calls that have not returned. Derived from events alone. */
export const runningAgents = (s) =>
  s.items
    .filter((i) => i.kind === 'progress' && i.status === 'running' && AGENT_CALLS.includes(i.name))
    // ponytail: a spawn with wait=false returns at once, so a child kept running by a later collect shows via that collect
    .map((i) => ({
      id: i.toolUseId,
      anchor: i.id,
      name: i.name === 'subagent_spawn' ? roleName(i.args?.role) || '子角色' : String(i.args?.childKey ?? '子角色'),
    }))

/** Latest chat item that mentions the id in a tool call or its result; the rail scrolls there. */
export const anchorFor = (s, id) => s.items.findLast((i) => i.kind === 'progress' && i.refText.includes(id))?.id

/** The single user acts as this role on interventions (the demo default), so nobody switches roles here. */
export const HUMAN_ROLE = '项目经理'
/** An intervention still waits for the user until it is resolved; a claimed one is the user's own to finish. */
export const unfinished = (i, data) => {
  if (!(i.state === 'OPEN' || i.state === 'EXPIRED' || i.state === 'CLAIMED')) return false
  // the server never resolves a gate-entity request on decision, so a decided or superseded gate ends it here
  const g = i.entity?.kind === 'gate' ? data?.gates?.find((x) => x.id === i.entity.id) : undefined
  return !g || (g.decision === 'PENDING' && !g.superseded)
}

/** True when the server refuses a person signing this stage's gates as `role` (`humanBarred`; old snapshots: the author only). */
export const humanBarredFor = (stage, role) => (stage?.humanBarred ?? [stage?.author]).includes(role)

/**
 * What a person must decide on this gate or approval flow right now: { roles, any, verb, label } from the
 * server's `waits` (the one rule behind `humanNext`), undefined when nobody waits on it. The page never re-derives it.
 */
export const waitFor = (data, type, id) => (data?.waits ?? []).find((w) => w.type === type && w.id === id)

/** Approving needs every open finding ticked and one closing note; `closeFindings` is the payload for the ticked ones. */
export const closurePlan = (gate, ticked, note) => {
  const n = String(note ?? '').trim()
  const open = (gate.findings ?? []).filter((f) => !f.closed)
  return {
    ready: open.every((f) => ticked[f.id]) && (!open.length || !!n),
    closeFindings: open.filter((f) => ticked[f.id]).map((f) => ({ id: f.id, note: n })),
  }
}

export const signatureLabel = (sig) =>
  `${sig.role}${sig.actor?.simulated ? '（演示）' : sig.actor?.kind === 'agent' ? '（智能体）' : sig.actor?.kind === 'human' ? '（人工）' : '（未标注）'}`

/** The 操作人 of a history row: only a row that carries an actor (a gate decision) is labelled by it. */
export const historyBy = (r) => (r.actor ? signatureLabel({ role: r.by ?? '', actor: r.actor }) : (r.by ?? ''))

// The outcome shapes the host expects from onPermissionRequest (runtime-tested in the p14 probe); every page that answers one uses these.
export const ALLOW = { verdict: 'allowed-once' }
export const DENY = { verdict: 'rejected' }

/**
 * Pending tool-permission requests, alive only while the SDK request is: an abort of `signal`
 * (unmount cancel -> 'detached', deadline, withdrawal) removes the entry and resolves it unanswered.
 */
export function createPermissionQueue() {
  const pending = []
  let snap = []
  let seen = 0
  const listeners = new Set()
  const emit = () => {
    snap = pending.slice()
    listeners.forEach((l) => l())
  }
  const remove = (entry) => {
    const i = pending.indexOf(entry)
    if (i < 0) return false
    pending.splice(i, 1)
    emit()
    return true
  }
  return {
    snapshot: () => snap,
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    add: (req, { signal }) =>
      new Promise((resolve) => {
        if (signal.aborted) return resolve({ unanswered: signal.reason })
        const entry = { id: `perm${++seen}`, req, resolve }
        signal.addEventListener('abort', () => remove(entry) && resolve({ unanswered: signal.reason }), { once: true })
        pending.push(entry)
        emit()
      }),
    answer: (entry, outcome) => remove(entry) && entry.resolve(outcome),
  }
}

/**
 * Open tool-permission decisions of the session (`approval.list` snapshots), as cards. The live request is gone once its
 * delivery deadline passes (the turn ends `parked`) but the durable decision stays answerable; the workbench answers it the same way.
 * Entry: `{ id, durable: { sessionId, id, revision }, toolUseId, options, req }`, `req` shaped like a live ACP request for permissionSummary.
 */
export function durablePermissions(decisions, now = Date.now()) {
  const out = []
  for (const d of decisions ?? []) {
    const spec = d?.request?.spec
    const call = spec?.subject?.call
    if (spec?.purpose !== 'tool.permission' || !call || typeof call.name !== 'string') continue
    if (d.result || d.invalidation || d.consumption) continue
    const until = d.request.expiresAt ? Date.parse(d.request.expiresAt) : Infinity
    if (!(until > now)) continue
    out.push({
      id: `dec:${d.handle.id}:${d.revision}`,
      durable: { sessionId: d.handle.sessionId, id: d.handle.id, revision: d.revision },
      toolUseId: call.toolUseId,
      options: Array.isArray(spec.options) ? spec.options : [],
      req: { toolCall: { toolCallId: call.toolUseId, title: spec.prompt, rawInput: call.args ?? null, _meta: { 'ai.agnes.harness': { tool: call.name } } } },
    })
  }
  return out
}

/** Live entries first; a durable decision whose tool call already has a live card is the same question, shown once. */
export const mergePermissions = (live, durable) => {
  const shown = new Set(live.map((e) => e.req?.toolCall?.toolCallId).filter(Boolean))
  return [...live, ...durable.filter((e) => !shown.has(e.toolUseId))]
}

/** Tool calls whose answer is parked on a durable decision: their progress line says so instead of spinning. */
export const parkedToolIds = (entries) => new Set(entries.filter((e) => e.durable).map((e) => e.toolUseId))

const BUTTONS = [
  { verdict: 'rejected', label: '拒绝', appearance: 'secondary' },
  { verdict: 'allowed-once', label: '允许一次', appearance: 'primary' },
]
/** The card buttons: a live request takes either outcome; a durable one only what its decision offers. */
export const permissionButtons = (entry) => BUTTONS.filter((b) => !entry.durable || entry.options.includes(b.verdict))

// Whitelist: printable characters, plain space, \n and \t pass; every control, format, line/paragraph
// separator and space-like character, variation selectors, tag characters and blank-rendering fillers
// become visible \uXXXX / \u{XXXXX} escapes, so nothing is disguised or silently invisible.
const HIDDEN = /(?![ \n\t])[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}ᅟᅠㅤﾠ⠀͏︀-️\u17B4\u17B5\u180B-\u180F\uFFFC\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu
const hex = (c) => {
  const n = c.codePointAt(0)
  const h = n.toString(16).toUpperCase()
  return n > 0xffff ? `\\u{${h}}` : `\\u${h.padStart(4, '0')}`
}
// A combining mark with no visible base (text start, after whitespace or an escaped character) renders as nothing or
// glues onto a neighbouring escape, so it is escaped too; marks on a real base keep accented text intact.
const MARK = /^\p{M}$/u
export const reveal = (t) => {
  let based = false
  let out = ''
  for (const c of t) {
    const hidden = HIDDEN.test(c) || (MARK.test(c) && !based)
    HIDDEN.lastIndex = 0
    if (hidden) out += hex(c)
    else out += c
    if (hidden || /^\s$/u.test(c)) based = false
    else if (!MARK.test(c)) based = true
  }
  return out
}
// Ordinary reply text keeps its formatting characters; only bidi controls (which reorder what is shown) are escaped.
export const bidiSafe = (t) => t.replace(/[؜‎‏‪-‮⁦-⁩]/g, hex)
const trimBlank = (t) => t.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/(?:\r?\n[ \t]*)+$/, '')

/**
 * What the user is asked to allow, unclipped: the real tool name (trusted heading, from the host's
 * _meta), the kind, the agent's own title (untrusted, informational), the full command and every other
 * input as [key, value]. Hidden characters are escaped and blank edge lines trimmed so nothing is
 * disguised or pushed out of view.
 */
export function permissionSummary(req) {
  const call = req?.toolCall ?? {}
  const raw = call.rawInput
  const obj = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : null
  const command = typeof obj?.command === 'string' ? reveal(trimBlank(obj.command)) : ''
  const str = (v) => reveal(typeof v === 'string' ? v : JSON.stringify(v))
  const extras = obj
    ? Object.entries(obj).filter(([k]) => !(k === 'command' && command)).map(([k, v]) => [reveal(k), str(v)])
    : raw == null ? [] : [['input', str(raw)]]
  const tool = call._meta?.['ai.agnes.harness']?.tool
  return {
    tool: typeof tool === 'string' ? reveal(tool) : '',
    kind: call.kind ?? '',
    title: reveal(String(call.title || call.kind || '工具调用')),
    command,
    commandLines: command ? command.split('\n').length : 0,
    extras,
    noInput: raw == null,
  }
}

/**
 * Markdown-lite for replies: blocks `p` (lines joined by \n), `h`, `ul`/`ol` (items), `quote` and fenced `code`.
 * The page renders every block as React text, so nothing here is ever HTML; unknown syntax stays literal text.
 */
export function markdownBlocks(text) {
  const blocks = []
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const LIST = /^\s{0,3}(?:([-*•])|(\d{1,3})[.)])\s+(.*)$/
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]
    const fence = line.match(/^\s{0,3}(```|~~~)\s*([\w+-]*)\s*$/)
    if (fence) {
      const body = []
      for (i++; i < lines.length && !lines[i].trimStart().startsWith(fence[1]); i++) body.push(lines[i])
      i++
      blocks.push({ type: 'code', lang: fence[2], text: body.join('\n') })
      continue
    }
    if (!line.trim()) {
      i++
      continue
    }
    const head = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (head) {
      blocks.push({ type: 'h', level: head[1].length, text: head[2] })
      i++
      continue
    }
    const item = line.match(LIST)
    if (item) {
      const type = item[1] ? 'ul' : 'ol'
      const items = []
      for (; i < lines.length; i++) {
        const m = lines[i].match(LIST)
        if (m && (m[1] ? 'ul' : 'ol') === type) items.push(m[3])
        else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) items[items.length - 1] += `\n${lines[i].trim()}`
        else break
      }
      blocks.push({ type, start: type === 'ol' ? Number(item[2]) : undefined, items })
      continue
    }
    if (/^\s{0,3}>/.test(line)) {
      const body = []
      for (; i < lines.length && /^\s{0,3}>/.test(lines[i]); i++) body.push(lines[i].replace(/^\s{0,3}>\s?/, ''))
      blocks.push({ type: 'quote', text: body.join('\n') })
      continue
    }
    const body = []
    for (; i < lines.length && lines[i].trim() && !LIST.test(lines[i]) && !/^\s{0,3}(#{1,6}\s|>|```|~~~)/.test(lines[i]); i++) body.push(lines[i])
    blocks.push({ type: 'p', text: body.join('\n') })
  }
  return blocks
}

/** Inline spans of one block: `code` first (its content stays literal), then **bold**; everything else is text. */
export function markdownInline(text) {
  const out = []
  const RE = /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/g
  const s = String(text ?? '')
  let at = 0
  for (const m of s.matchAll(RE)) {
    if (m.index > at) out.push({ type: 'text', text: s.slice(at, m.index) })
    out.push(m[1] !== undefined ? { type: 'code', text: m[1] } : { type: 'b', text: m[2] ?? m[3] })
    at = m.index + m[0].length
  }
  if (at < s.length) out.push({ type: 'text', text: s.slice(at) })
  return out
}

const projectOfGate = (g) => g.stageId.split('/')[0]
const trailOf = (item) => [
  ...(item.history ?? []).map((h) => `${h.at?.slice(0, 16).replace('T', ' ') ?? ''} ${h.by ?? ''} ${h.from}→${h.to}${h.note ? `：${h.note}` : ''}`),
  ...(item.signatures ?? []).map((g) => `${signatureLabel(g)} 已签署`),
]

/**
 * The watch rail. needs = open interventions + the gates and approval flows the server says a person must
 * decide (`data.waits`) + pending tool permissions (T7 supplies the count);
 * running = sub-agents from events; done = delivered projects and passed gates.
 * `projectId` narrows the board-derived entries to one project.
 */
export function railOf(data, s, { projectId, permissions = 0 } = {}) {
  const inScope = (id) => !projectId || id === projectId
  const gateEntry = (g) => ({
    kind: 'gate',
    id: g.id,
    projectId: projectOfGate(g),
    title: `${g.code} · ${g.name}`,
    trail: trailOf(g),
  })
  const waits = (type) => (data.waits ?? []).filter((w) => w.type === type && inScope(w.projectId) && !w.meeting) // a gate awaiting its review meeting is nobody's to decide yet
  const gates = waits('gate').flatMap((w) => data.gates.filter((g) => g.id === w.id))
  const merged = new Set(gates.map((g) => g.id)) // a request handed on a listed gate is that gate's item, not a second one
  const asks = (g) => data.interventions.filter((i) => i.entity?.kind === 'gate' && i.entity.id === g.id && unfinished(i, data))
  const needs = [
    ...data.interventions
      .filter((i) => unfinished(i, data) && inScope(i.projectId) && !(i.entity?.kind === 'gate' && merged.has(i.entity.id)))
      .map((i) => ({ kind: 'intervention', id: i.id, projectId: i.projectId, title: i.ask, trail: trailOf(i) })),
    ...gates.map((g) => {
      const e = gateEntry(g)
      return { ...e, trail: [...asks(g).map((i) => `请求：${i.ask}`), ...e.trail] }
    }),
    ...waits('approval').map((w) => ({ kind: 'approval', id: w.id, projectId: w.projectId, title: w.label, trail: [] })),
    ...(permissions > 0 && !projectId ? [{ kind: 'permission', id: 'permission', title: '待授权的工具', count: permissions, trail: [] }] : []),
  ]
  const delivered = data.projects.filter(
    (p) => inScope(p.id) && data.stages.some((x) => x.id === `${p.id}/RELEASE` && x.state === 'PASSED'),
  )
  const done = [
    ...delivered.map((p) => ({ kind: 'project', id: p.id, projectId: p.id, title: p.name, trail: [] })),
    ...data.gates
      .filter((g) => g.decision === 'APPROVED' && !g.superseded && inScope(projectOfGate(g)))
      .map(gateEntry),
  ]
  const safe = (e) => ({ ...e, title: reveal(String(e.title ?? '')), trail: (e.trail ?? []).map((t) => reveal(String(t))) })
  return { needs: needs.map(safe), running: runningAgents(s).map(safe), done: done.map(safe) }
}
