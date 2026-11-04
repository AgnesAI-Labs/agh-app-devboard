// The Xiaochuan page: one coordinator session in the middle, a watch rail on the right. The chat is
// session events folded by assistant-model.js; every card is drawn from board.data (the store is the
// source of truth), and events only add lines, refresh the board and decide where to scroll.
import { applicationWorkRequest, resolveApplicationWork } from '@agnes/web-client'
import { Banner, Button } from '@agnes/web-ui'
import React from 'react'
import { assistantFor } from './assistant-session.js'
import {
  anchorFor,
  BOARD_NO_CONFIRM,
  AUTO_HANDBACK,
  EMPTY,
  HUMAN_ROLE,
  createPermissionQueue,
  durablePermissions,
  mergePermissions,
  parkedToolIds,
  pendingHandbacks,
  permissionButtons,
  permissionSummary,
  railOf,
  reveal,
  bidiSafe,
  reduceEvent,
  signatureLabel,
  closurePlan,
  unfinished,
  waitFor,
  markdownBlocks,
  markdownInline,
} from './assistant-model.js'
import { gateBadge, h, stageName, stateBadge, TruncatedNotice, time, verb } from './board.js'

const NAME = '小川'

// Tool permission requests wait here, not in component state: a remount of the page keeps them, and so
// does the SDK request, because one assistant per client keeps its permission handler across remounts.
// A deadline or withdrawal aborts the request, so a card never outlives it.
const queue = createPermissionQueue()
const onPermission = (req, ctx) => queue.add(req, ctx)
// Tool calls whose live card was answered here: a durable decision fetched before the answer landed must not bring the card back.
const answered = new Set()
const answerPermission = (entry, outcome) => {
  const id = entry.req?.toolCall?.toolCallId
  queue.answer(entry, outcome)
  if (id) answered.add(id)
}
const usePermissions = () => React.useSyncExternalStore(queue.subscribe, queue.snapshot, queue.snapshot)

/**
 * Open durable decisions of the session. A request that outlives its delivery deadline leaves the live queue while its
 * decision stays answerable (the turn ends `parked`), so they are read on mount, after a reconnect, when a turn parks and
 * whenever a live card leaves, and shown as cards the same way (merged with the live ones by the caller).
 */
function useParkedApprovals(assistant, ready, conversation, liveCount) {
  const [entries, setEntries] = React.useState([])
  const latest = React.useRef(0)
  const refresh = React.useCallback(async () => {
    const mine = ++latest.current
    try {
      const list = durablePermissions(await assistant.pendingApprovals()).filter((e) => !answered.has(e.toolUseId))
      if (mine === latest.current) setEntries(list)
    } catch {
      // The next trigger reads again; the live card, if any, is unaffected.
    }
  }, [assistant])
  React.useEffect(() => {
    if (!ready) return undefined
    void refresh()
    return assistant.onParked(() => void refresh())
  }, [assistant, ready, conversation, refresh, liveCount])
  const decide = React.useCallback(
    async (entry, verdict, onError) => {
      try {
        await assistant.decideApproval(entry.durable, verdict)
        answered.add(entry.toolUseId)
        setEntries((cur) => cur.filter((e) => e.id !== entry.id))
      } catch (error) {
        onError(`授权失败：${error instanceof Error ? error.message : String(error)}`)
      }
      void refresh() // a decision answered elsewhere or already past is dropped by the read
    },
    [assistant, refresh],
  )
  return { entries, decide }
}

const ICONS = {
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  spin: 'M21 12a9 9 0 1 1-6.2-8.56',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16v-4M12 8h.01',
  ask: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10ZM9 12l2 2 4-4',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  folder: 'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  back: 'M9 10 4 15l5 5M20 4v7a4 4 0 0 1-4 4H4',
  panel: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM15 3v18',
  chevron: 'm9 18 6-6-6-6',
  plus: 'M12 5v14M5 12h14',
}
const Icon = ({ name, size = 16 }) =>
  h(
    'svg',
    {
      className: `devboard-assistant-icon is-${name}`,
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
    },
    h('path', { d: ICONS[name] }),
  )

const Avatar = ({ ghost, large }) =>
  h('span', { className: `devboard-assistant-avatar${ghost ? ' ghost' : ''}${large ? ' large' : ''}`, 'aria-hidden': true }, ghost ? null : '川')

const inline = (text) =>
  markdownInline(text).map((span, i) =>
    span.type === 'code' ? h('code', { key: i }, span.text) : span.type === 'b' ? h('strong', { key: i }, span.text) : span.text,
  )

/** A reply as Markdown-lite; every node is React text, and bidi controls are escaped before parsing. */
function Markdown({ text }) {
  return markdownBlocks(bidiSafe(text)).map((b, i) => {
    if (b.type === 'code') return h('pre', { key: i }, h('code', null, b.text))
    if (b.type === 'h') return h('p', { key: i, className: 'devboard-assistant-md-h' }, inline(b.text))
    if (b.type === 'quote') return h('blockquote', { key: i }, inline(b.text))
    if (b.type === 'ul' || b.type === 'ol')
      return h(b.type, { key: i, start: b.start }, b.items.map((t, j) => h('li', { key: j }, inline(t))))
    return h('p', { key: i }, inline(b.text))
  })
}

/** Answer buttons of an intervention: the legal targets of its state machine, `by` is the user's role. */
function InterventionActions({ item, data, board }) {
  const [note, setNote] = React.useState('')
  const legal = data.machines.intervention[item.state] ?? []
  const go = (to) =>
    board.run(
      'devboard.transition',
      { kind: 'intervention', id: item.id, to, by: HUMAN_ROLE, ...(note.trim() ? { note: note.trim() } : {}) },
      `${item.id} 已${verb(item.state, to, 'intervention')}`,
    ) // the board refreshes itself after every run
  return h(
    'div',
    { className: 'devboard-assistant-actions' },
    legal.includes('RESOLVED') &&
      h('input', { className: 'devboard-assistant-input', value: note, maxLength: 2000, placeholder: '处理结论（可选）', 'aria-label': '处理结论', onChange: (e) => setNote(e.target.value) }),
    h(
      'div',
      { className: 'devboard-assistant-buttons' },
      legal.map((to) =>
        h(Button, { key: to, appearance: to === 'RESOLVED' || to === 'CLAIMED' ? 'primary' : 'secondary', disabled: board.busy, onClick: () => go(to) }, verb(item.state, to, 'intervention')),
      ),
    ),
  )
}

/** The roles a panel still waits for: one signs at a time, the next shows once the board refreshes. */
const Waiting = ({ wait }) =>
  wait.roles.length > 1 &&
  h('p', { className: 'devboard-assistant-meta' }, wait.any ? `任选其一：${wait.roles.join('、')}` : `待签：${wait.roles.join('、')}，先以「${wait.roles[0]}」签署`)

/** Approve / reject of a gate a person decides. The server marks the actor human; `by` is the role the server says waits. */
function GateActions({ gate, wait, data, board }) {
  const [comment, setComment] = React.useState('')
  const [ticked, setTicked] = React.useState({})
  const [closing, setClosing] = React.useState('')
  const by = wait.roles[0]
  const open = (gate.findings ?? []).filter((f) => !f.closed)
  const plan = closurePlan(gate, ticked, closing)
  const go = (decision) =>
    board.run(
      'devboard.gate',
      {
        gateId: gate.id,
        decision,
        by,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        ...(decision === 'APPROVED' && plan.closeFindings.length ? { closeFindings: plan.closeFindings } : {}),
      },
      `${gate.code} 已${decision === 'APPROVED' ? '签署' : '驳回'}`,
    )
  // nobody may sign (the server's reason): explain the stall instead of offering buttons that would be refused
  if (!wait.roles.length) return h('div', { className: 'devboard-assistant-actions' }, h('p', { className: 'devboard-assistant-meta', role: 'status' }, wait.blocked))
  return h(
    'div',
    { className: 'devboard-assistant-actions' },
    h(Waiting, { wait }),
    open.length > 0 &&
      h(
        'fieldset',
        { className: 'devboard-assistant-findings' },
        h('legend', null, `还有 ${open.length} 条评审意见未关闭，批准前须逐条确认已处理`),
        open.map((f) =>
          h(
            'label',
            { key: f.id },
            h('input', { type: 'checkbox', checked: !!ticked[f.id], onChange: (e) => setTicked({ ...ticked, [f.id]: e.target.checked }) }),
            h('span', { className: 'devboard-assistant-code' }, reveal(f.id)),
            h('span', null, reveal(String(f.text ?? ''))),
          ),
        ),
        h('input', { className: 'devboard-assistant-input', value: closing, maxLength: 500, placeholder: '关闭说明（批准必填）', 'aria-label': '关闭说明', onChange: (e) => setClosing(e.target.value) }),
      ),
    h('input', { className: 'devboard-assistant-input', value: comment, maxLength: 2000, placeholder: '意见（驳回必填）', 'aria-label': '意见', onChange: (e) => setComment(e.target.value) }),
    h(
      'div',
      { className: 'devboard-assistant-buttons' },
      h(Button, { appearance: 'secondary', disabled: board.busy || !comment.trim(), onClick: () => go('REJECTED') }, '驳回'),
      h(Button, { appearance: 'primary', disabled: board.busy || !plan.ready, onClick: () => go('APPROVED') }, `以「${by}」批准`),
    ),
  )
}

/** Agree / reject of the current node of an approval flow, signed as a role the server says waits on it. */
function ApprovalActions({ flow, wait, data, board }) {
  const [comment, setComment] = React.useState('')
  const act = (action, by) =>
    board.run(
      'devboard.approval',
      { action, id: flow.id, by, ...(comment.trim() ? { comment: comment.trim() } : {}) },
      `${flow.id} 已${data.labels.approvalAction[action]}`,
    )
  return h(
    'div',
    { className: 'devboard-assistant-actions' },
    h(Waiting, { wait }),
    h('input', { className: 'devboard-assistant-input', value: comment, maxLength: 2000, placeholder: '意见（驳回必填）', 'aria-label': '意见', onChange: (e) => setComment(e.target.value) }),
    h(
      'div',
      { className: 'devboard-assistant-buttons' },
      h(Button, { appearance: 'secondary', disabled: board.busy || !comment.trim(), onClick: () => act('REJECT', wait.roles[0]) }, '驳回'),
      // an any-one node offers each waiting role; an all-roles node signs one role at a time
      (wait.any ? wait.roles : wait.roles.slice(0, 1)).map((role) =>
        h(Button, { key: role, appearance: 'primary', disabled: board.busy, onClick: () => act('APPROVE', role) }, `以「${role}」同意`),
      ),
    ),
  )
}

/** A chat card: icon, title and an id chip on top; `tone` marks the ones waiting for the person. */
const Card = ({ label, icon, title, chip, tone, children }) =>
  h(
    'section',
    { className: 'devboard-assistant-card', 'data-tone': tone, 'aria-label': label },
    h(
      'header',
      { className: 'devboard-assistant-card-head' },
      h('span', { className: 'devboard-assistant-card-icon' }, h(Icon, { name: icon })),
      h('h3', null, title),
      chip && h('span', { className: 'devboard-assistant-chip' }, chip),
    ),
    children,
  )

function PermissionCard({ entry, onAnswer }) {
  const { tool, kind, title, command, commandLines, extras, noInput } = permissionSummary(entry.req)
  const field = (key, label, value) =>
    h('div', { key, className: 'devboard-assistant-field' }, h('dt', null, label), h('dd', null, value))
  return h(
    Card,
    { label: '工具授权', icon: 'shield', title: '需要你授权', chip: tool || kind || '工具调用', tone: 'warn' },
    h(
      'dl',
      { className: 'devboard-assistant-fields' },
      field('title', '智能体说明', title),
      noInput && field('none', '参数', '无参数详情'),
      command && field('command', `命令（共 ${commandLines} 行）`, h('pre', { className: 'devboard-assistant-cmd' }, command)),
      extras.map(([k, v]) => field(`x-${k}`, k, h('pre', { className: 'devboard-assistant-cmd' }, v))),
    ),
    h(
      'div',
      { className: 'devboard-assistant-buttons' },
      permissionButtons(entry).map((b) => h(Button, { key: b.verdict, appearance: b.appearance, onClick: () => onAnswer(entry, b.verdict) }, b.label)),
    ),
  )
}

/**
 * Card renderers by kind; a card the map does not know is left out rather than guessed.
 */
const CARDS = {
  project: ({ data, projectId }) => {
    const project = data.projects.find((p) => p.id === projectId)
    if (!project) return null
    const stages = data.stages.filter((s) => s.projectId === projectId)
    const current = stages.find((s) => s.state !== 'PASSED')
    return h(
      Card,
      { label: `项目 ${project.name}`, icon: 'folder', title: reveal(String(project.name)), chip: project.id },
      h(
        'p',
        { className: 'devboard-assistant-card-sub' },
        reveal(String(project.customer ?? '')),
        project.plannedEnd && ` · 计划 ${time(project.plannedEnd)} 完成`,
      ),
      h(
        'ol',
        { className: 'devboard-assistant-stepper' },
        stages.map((s) =>
          h(
            'li',
            { key: s.id, 'data-state': s.state, 'aria-current': s === current ? 'step' : undefined },
            h('span', { className: 'devboard-assistant-dot' }, s.state === 'PASSED' && h(Icon, { name: 'check', size: 12 })),
            h('span', { className: 'devboard-assistant-stepname' }, stageName(data, projectId, s.stage)),
          ),
        ),
      ),
    )
  },
  intervention: ({ data, projectId, board }) => {
    const items = data.interventions.filter((i) => i.projectId === projectId && unfinished(i, data)).slice(-3)
    if (!items.length) return null
    return h(
      Card,
      { label: '需要你拍板', icon: 'ask', title: '需要你拍板', chip: projectId, tone: 'warn' },
      items.map((i) =>
        h(
          'div',
          { key: i.id, className: 'devboard-assistant-ask' },
          h('p', { className: 'devboard-assistant-ask-q' }, reveal(String(i.ask ?? ''))),
          h(
            'p',
            { className: 'devboard-assistant-meta' },
            `${data.labels.interventionType[i.type] ?? i.type} · 截止 ${time(i.dueAt)} `,
            stateBadge(data, i.state),
          ),
          h(InterventionActions, { item: i, data, board }),
        ),
      ),
    )
  },
  gate: ({ data, projectId, board, live }) => {
    const gates = data.gates.filter((g) => g.stageId.startsWith(`${projectId}/`) && !g.superseded).slice(-4)
    if (!gates.length) return null
    const waiting = gates.some((g) => waitFor(data, 'gate', g.id) && !waitFor(data, 'gate', g.id).meeting)
    return h(
      Card,
      { label: '评审门', icon: 'flag', title: '评审门', chip: projectId, tone: waiting ? 'warn' : undefined },
      h(
        'ul',
        { className: 'devboard-assistant-rows' },
        gates.map((g) =>
          h(
            'li',
            { key: g.id },
            h(
              'div',
              { className: 'devboard-assistant-rowline' },
              h('span', { className: 'devboard-assistant-code' }, reveal(String(g.code))),
              h('span', { className: 'devboard-assistant-rowtitle' }, reveal(String(g.name))),
              gateBadge(data, g.decision),
            ),
            (g.signatures ?? []).length > 0 &&
              h('p', { className: 'devboard-assistant-meta' }, `签署：${g.signatures.map(signatureLabel).join('、')}`),
            live && waitFor(data, 'gate', g.id) && h(GateActions, { gate: g, wait: waitFor(data, 'gate', g.id), data, board }),
          ),
        ),
      ),
    )
  },
  approval: ({ data, projectId, board, live }) => {
    const waits = !live ? [] : (data.waits ?? []).filter((w) => w.type === 'approval' && w.projectId === projectId)
    if (!waits.length) return null
    return h(
      Card,
      { label: '审批流程', icon: 'flag', title: '需要你审批', chip: projectId, tone: 'warn' },
      waits.map((w) => {
        const flow = data.approvals.find((a) => a.id === w.id)
        return (
          flow &&
          h(
            'div',
            { key: w.id, className: 'devboard-assistant-ask' },
            h('p', { className: 'devboard-assistant-ask-q' }, h('span', { className: 'devboard-assistant-code' }, reveal(w.id)), ' ', reveal(String(w.label))),
            h(ApprovalActions, { flow, wait: w, data, board }),
          )
        )
      }),
    )
  },
  deliverable: ({ data, projectId }) => {
    const items = data.artifacts.filter((a) => a.projectId === projectId).slice(-6)
    if (!items.length) return null
    return h(
      Card,
      { label: '交付物', icon: 'file', title: '交付物', chip: projectId },
      h(
        'ul',
        { className: 'devboard-assistant-rows' },
        items.map((a) =>
          h(
            'li',
            { key: a.id },
            h(
              'div',
              { className: 'devboard-assistant-rowline' },
              h('span', { className: 'devboard-assistant-rowtitle' }, reveal(String(a.title))),
              h('span', { className: 'devboard-assistant-code' }, reveal(String(a.version ?? ''))),
              stateBadge(data, a.status),
            ),
          ),
        ),
      ),
    )
  },
}

const STEP_ICON = { running: 'spin', done: 'check', error: 'x', note: 'info' }
const STEP_HINT = { running: '进行中', error: '失败' }

/** One collapsed step: a tool call (running / done / error) or a system notice, details on click. */
function Step({ item, parked }) {
  const status = item.kind === 'system' ? 'note' : item.status
  return h(
    'details',
    { className: 'devboard-assistant-progress', 'data-status': status },
    h(
      'summary',
      null,
      h('span', { className: 'devboard-assistant-step-icon' }, h(Icon, { name: STEP_ICON[status] ?? 'info', size: 14 })),
      h('span', { className: 'devboard-assistant-step-label' }, item.kind === 'system' ? item.label : reveal(item.label)),
      (parked || STEP_HINT[status]) && h('span', { className: 'devboard-assistant-step-hint' }, parked ? '等待你授权' : STEP_HINT[status]),
      h('span', { className: 'devboard-assistant-step-chev' }, h(Icon, { name: 'chevron', size: 14 })),
    ),
    h('pre', null, reveal(String((item.kind === 'system' ? item.text : item.refText) ?? ''))),
  )
}

/** Consecutive tool steps and notices read as one block; everything else stands alone. */
function groupsOf(items) {
  const out = []
  for (const item of items) {
    const step = item.kind === 'progress' || item.kind === 'system'
    const last = out.at(-1)
    if (step && last?.kind === 'steps') last.items.push(item)
    else out.push(step ? { kind: 'steps', id: item.id, items: [item] } : { kind: 'one', id: item.id, item })
  }
  return out
}

/** Chat rows: the person's lines on the right, the assistant's side under one avatar per run. */
const Flow = React.memo(function Flow({ items, data, board, permissions, parkedTools, onAnswer, busy, onNew, starting, onContinue }) {
  const rows = []
  let lead = true
  const side = (key, content, attrs) => {
    rows.push(h('div', { key, className: 'devboard-assistant-side', ...attrs }, h(Avatar, { ghost: !lead }), h('div', { className: 'devboard-assistant-col' }, content)))
    lead = false
  }
  const groups = groupsOf(items)
  const lastCard = new Map(items.filter((i) => i.kind === 'card').map((i) => [`${i.card}:${i.projectId}`, i.id]))
  const staleAt = groups.findLastIndex((g) => g.kind === 'steps' && g.items.some((i) => i.denied)) // one notice, under the latest refused call
  for (const [at, g] of groups.entries()) {
    if (g.kind === 'steps') {
      side(g.id, [
        h(
          'div',
          { key: 'steps', className: 'devboard-assistant-steps' },
          g.items.map((item) => h('div', { key: item.id, 'data-item': item.id, className: 'devboard-assistant-item' }, h(Step, { item, parked: item.status === 'running' && parkedTools.has(item.toolUseId) }))),
        ),
        at === staleAt &&
          h(
            'p',
            { key: 'stale', className: 'devboard-assistant-stale', role: 'alert' },
            h('span', null, '插件已更新，这个对话无法再读写看板'),
            h(Button, { htmlType: 'button', disabled: starting, onClick: onNew }, '开始新对话'),
          ),
      ])
      continue
    }
    const { item } = g
    if (item.kind === 'user') {
      lead = true
      if (item.text.startsWith(AUTO_HANDBACK))
        rows.push(
          h(
            'div',
            { key: item.id, 'data-item': item.id, className: 'devboard-assistant-item devboard-assistant-event' },
            h('span', null, h(Icon, { name: 'back', size: 14 }), bidiSafe(item.text)),
          ),
        )
      else
        rows.push(
          h(
            'div',
            { key: item.id, 'data-item': item.id, className: 'devboard-assistant-item devboard-assistant-row user' },
            h('div', { className: 'devboard-assistant-bubble user' }, bidiSafe(item.text)),
          ),
        )
      continue
    }
    if (item.kind === 'error') {
      side(
        item.id,
        h(
          'div',
          { className: 'devboard-assistant-failed', role: 'alert' },
          h('p', null, item.text),
          h('details', null, h('summary', null, '技术详情'), h('pre', null, `${item.code}: ${item.message}`)),
        ),
        { 'data-item': item.id, className: 'devboard-assistant-side devboard-assistant-item' },
      )
      continue
    }
    if (item.kind === 'blocked') {
      side(
        item.id,
        h(
          'div',
          { className: 'devboard-assistant-blocked', role: 'status' },
          h('p', null, item.text),
          !item.done && h(Button, { htmlType: 'button', disabled: busy, onClick: onContinue }, '继续'),
          item.detail && h('details', null, h('summary', null, '技术详情'), h('pre', null, item.detail)),
        ),
        { 'data-item': item.id, className: 'devboard-assistant-side devboard-assistant-item' },
      )
      continue
    }
    if (item.kind === 'assistant') {
      side(
        item.id,
        [
          h('div', { key: 'text', className: 'devboard-assistant-bubble devboard-assistant-md' }, h(Markdown, { text: item.text })),
          item.answerOnly && h('span', { key: 'tag', className: 'devboard-assistant-tag' }, h(Icon, { name: 'info', size: 12 }), '仅回答，未建工单'),
        ],
        { 'data-item': item.id, className: 'devboard-assistant-side devboard-assistant-item' },
      )
      continue
    }
    const Render = CARDS[item.card]
    // only the newest gate / approval card of a project carries the panel, so one decision is never offered twice
    const live = lastCard.get(`${item.card}:${item.projectId}`) === item.id
    const card = Render ? Render({ data, projectId: item.projectId, board, live }) : null
    if (card) side(item.id, card, { 'data-item': item.id, className: 'devboard-assistant-side devboard-assistant-item' })
  }
  if (permissions.length > 0)
    side(
      'permission',
      permissions.map((entry) => h(PermissionCard, { key: entry.id, entry, onAnswer })),
      { 'data-item': 'permission', className: 'devboard-assistant-side devboard-assistant-item' },
    )
  if (busy)
    side(
      'busy',
      h('p', { className: 'devboard-assistant-typing', role: 'status' }, h('span', { className: 'devboard-assistant-dots', 'aria-hidden': true }, h('i'), h('i'), h('i')), `${NAME}正在处理…`),
    )
  return rows
})

const SUGGESTIONS = ['新建项目：社区图书借阅登记台，月底交付', '有哪些事等我处理？', '现在各项目进展到哪了？']

function Welcome({ ready, failed, onPick }) {
  return h(
    'div',
    { className: 'devboard-assistant-welcome' },
    h(Avatar, { large: true }),
    h('h2', null, ready ? '你好，我是小川' : failed ? `未能载入与${NAME}的对话` : `正在连接${NAME}…`),
    h('p', null, '你的研发助理：建项目、提需求、推进评审和交付。智能体自己干活，只在需要你拍板时找你。'),
    h('p', { className: 'devboard-assistant-hint' }, `和${NAME}说点什么，例如：`),
    h(
      'div',
      { className: 'devboard-assistant-suggest' },
      SUGGESTIONS.map((s) => h('button', { key: s, type: 'button', disabled: !ready, onClick: () => onPick(s) }, s)),
    ),
  )
}

const SECTIONS = [
  ['needs', '需要你处理'],
  ['running', '进行中'],
  ['done', '已完成'],
]
const DONE_SHOWN = 5
const KIND_LABEL = { intervention: '拍板', gate: '评审门', approval: '审批', permission: '授权', project: '已交付', agent: '子角色' }

function RailCard({ entry, open, onClick, data, board, live, section }) {
  const expanded = entry.kind === 'permission' || open
  return h(
    'div',
    { className: `devboard-assistant-rcard${expanded ? ' open' : ''}`, 'data-section': section },
    h(
      'button',
      { type: 'button', onClick, 'aria-expanded': open },
      section === 'running' && h('span', { className: 'devboard-assistant-step-icon', 'data-status': 'running' }, h(Icon, { name: 'spin', size: 14 })),
      h('span', { className: 'devboard-assistant-rtitle' }, entry.title),
      h(
        'span',
        { className: 'devboard-assistant-rmeta' },
        h('span', { className: 'devboard-assistant-kind' }, KIND_LABEL[entry.kind] ?? KIND_LABEL.agent),
        entry.count ? ` ${entry.count} 项` : null,
        entry.projectId && h('span', { className: 'devboard-assistant-code', title: data.projects.find((p) => p.id === entry.projectId)?.name }, entry.projectId),
      ),
    ),
    open && entry.kind === 'intervention' && h(InterventionActions, { item: data.interventions.find((i) => i.id === entry.id), data, board }),
    open && live && entry.kind === 'gate' && waitFor(data, 'gate', entry.id) && h(GateActions, { gate: data.gates.find((g) => g.id === entry.id), wait: waitFor(data, 'gate', entry.id), data, board }),
    open && live && entry.kind === 'approval' && waitFor(data, 'approval', entry.id) && h(ApprovalActions, { flow: data.approvals.find((a) => a.id === entry.id), wait: waitFor(data, 'approval', entry.id), data, board }),
    open && entry.trail.length > 0 && h('ol', { className: 'devboard-assistant-trail' }, entry.trail.map((t, i) => h('li', { key: i }, t))),
  )
}

function Rail({ rail, open, pick, data, board, shown, onClose }) {
  const [allDone, setAllDone] = React.useState(false)
  return h(
    'aside',
    { id: 'devboard-assistant-rail', className: 'devboard-assistant-rail', 'data-shown': shown, 'aria-label': '值守栏' },
    h(
      'div',
      { className: 'devboard-assistant-rail-head' },
      h('span', null, '值守'),
      h('button', { type: 'button', className: 'devboard-assistant-iconbtn', 'aria-label': '收起值守栏', onClick: onClose }, h(Icon, { name: 'x' })),
    ),
    SECTIONS.map(([key, title]) => {
      const list = key === 'done' ? rail.done.slice().reverse() : rail[key]
      const visible = key === 'done' && !allDone ? list.slice(0, DONE_SHOWN) : list
      return h(
        'section',
        { key, className: 'devboard-assistant-sec', 'data-section': key },
        h('h2', null, title, h('span', { className: `devboard-assistant-count${key === 'needs' && rail.needs.length ? ' on' : ''}` }, rail[key].length)),
        list.length === 0 && h('p', { className: 'devboard-assistant-empty' }, key === 'needs' ? '没有等你处理的事' : '暂无'),
        visible.map((entry) =>
          h(RailCard, { key: entry.id, entry, open: open === entry.id, onClick: () => pick(entry), data, board, live: key === 'needs', section: key }),
        ),
        key === 'done' &&
          list.length > DONE_SHOWN &&
          h('button', { type: 'button', className: 'devboard-assistant-more', onClick: () => setAllDone(!allDone) }, allDone ? '收起' : `显示全部 ${list.length} 条`),
      )
    }),
  )
}

function useAssistantStream(ctx, board) {
  const assistant = React.useMemo(() => assistantFor(ctx), [ctx])
  const [state, dispatch] = React.useReducer(reduceEvent, EMPTY)
  const [status, setStatus] = React.useState({ phase: 'connecting' })
  const [attempt, setAttempt] = React.useState(0)
  const [conversation, setConversation] = React.useState(0) // bumps when a new conversation replaces the session
  const [starting, setStarting] = React.useState(false)
  const refresh = React.useRef(board.refresh)
  refresh.current = board.refresh
  const stored = React.useRef(undefined)
  const noticed = React.useRef(false) // a retry keeps the reducer state, so the notice goes in once per mount
  const shown = React.useRef(0) // a retry re-follows the retained rows: the reducer already holds them
  const ready = Boolean(board.data)
  if (ready && stored.current === undefined) stored.current = board.data.assistant
  React.useEffect(() => {
    if (!ready) return undefined
    let alive = true
    let unfollow
    let unreleased
    let timer
    // Replaying history fires many results at once: one refresh after the burst is enough.
    const soon = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void refresh.current(), 400)
    }
    void (async () => {
      try {
        setStatus({ phase: 'connecting' })
        await assistant.ensure(stored.current)
        if (!alive) return
        setStatus({ phase: 'ready' })
        void refresh.current() // a new session id was just saved
        if (assistant.notice && !noticed.current) {
          noticed.current = true
          dispatch({ seq: 0, type: 'devboard/notice', data: { text: assistant.notice } })
        }
        unreleased = assistant.onReleased(() => setStatus({ phase: 'released' }))
        unfollow = assistant.follow(
          (event) => {
            if (event.seq <= shown.current) return
            shown.current = event.seq
            dispatch(event)
            if (event.type === 'turn/end' || event.type === 'tool/result') soon()
          },
          (error) => setStatus({ phase: 'error', message: error instanceof Error ? error.message : String(error) }),
          () => {
            shown.current = 0
            dispatch({ seq: 0, type: 'devboard/reset' })
            if (assistant.notice) dispatch({ seq: 0, type: 'devboard/notice', data: { text: assistant.notice } }) // e.g. the carried model was refused
          },
        )
      } catch (error) {
        if (alive) setStatus({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    })()
    return () => {
      alive = false
      clearTimeout(timer)
      unfollow?.()
      unreleased?.()
    }
  }, [assistant, ready, attempt])
  /** Takes the session back from the tab that claimed it. */
  const reclaim = async () => {
    try {
      await assistant.reclaim()
      setStatus({ phase: 'ready' })
    } catch (error) {
      setStatus({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }
  /** Opens a fresh coordinator session (the chat empties through the follow reset); `onError` gets a failure. */
  const startNew = async (onError) => {
    setStarting(true)
    try {
      await assistant.startNew()
      setConversation((n) => n + 1)
      void refresh.current() // the board now names the new session and its sent hand-backs
    } catch (error) {
      onError(`新对话失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setStarting(false)
    }
  }
  return { assistant, state, status, conversation, starting, startNew, reclaim, retry: () => setAttempt((n) => n + 1) }
}

/**
 * Cards of what people decided are sent to the coordinator once, oldest first, one at a time. The id is
 * claimed on the server before the send (a reload or another tab must not send it twice) and released when
 * the send fails. A failed card is not retried by the board refresh; the page's 重试 button calls retry.
 */
function useAutoHandback(assistant, ready, data, onError) {
  const busy = React.useRef(false)
  const skip = React.useRef(new Set()) // sent from this page, or failed and waiting for an explicit retry
  const [tick, setTick] = React.useState(0)
  React.useEffect(() => {
    if (!ready || !data || busy.current) return
    const card = pendingHandbacks(data, data.assistant?.sentHandbacks, skip.current)[0]
    if (!card) return
    busy.current = true
    void (async () => {
      let claimed = false
      try {
        const work = resolveApplicationWork(applicationWorkRequest(card.action, card.object), 'zh-CN')
        if (!work) throw new Error('DevBoard 尚未被采纳，无法交回')
        const text = `${AUTO_HANDBACK}${card.text}\n${work.prompt}\n附带工作对象：${card.object.type} ${card.object.id}`
        if (!(await assistant.claimSent(card.id))) return // another tab recorded it first
        claimed = true
        skip.current.add(card.id) // data is stale until the next refresh
        await assistant.send(text, { handback: true })
        setTick((n) => n + 1) // look for the next card
      } catch (error) {
        skip.current.add(card.id)
        if (claimed) await assistant.releaseSent(card.id).catch(() => {})
        onError(`自动交回失败：${error instanceof Error ? error.message : String(error)}`, () => {
          skip.current.delete(card.id)
          setTick((n) => n + 1)
        })
      } finally {
        busy.current = false
      }
    })()
  }, [assistant, ready, data, tick, onError])
}

/** The session's primary model beside the status pill: shows it, and switches it for this conversation only. Hidden while it cannot be read. */
function ModelMenu({ assistant, ready, conversation, busy, onError }) {
  const [current, setCurrent] = React.useState(undefined)
  const [options, setOptions] = React.useState([])
  const [open, setOpen] = React.useState(false)
  const [switching, setSwitching] = React.useState(false)
  const root = React.useRef(null)
  React.useEffect(() => {
    if (!ready) return undefined
    let alive = true
    Promise.all([assistant.currentModel(), assistant.models()])
      .then(([now, list]) => alive && (setCurrent(now), setOptions(list)))
      .catch(() => alive && setCurrent(undefined))
    return () => {
      alive = false
    }
  }, [assistant, ready, conversation])
  const disabled = busy || switching
  React.useEffect(() => {
    if (!open) return undefined
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !root.current?.contains(e.target)) {
        setOpen(false)
        if (e.type === 'keydown') root.current?.querySelector('button')?.focus()
      }
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    root.current?.querySelector('[aria-checked="true"], [role^="menuitem"]')?.focus()
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  if (!current) return null
  const same = (o) => o.route === current.route && o.id === current.model
  const nameOf = (o) => reveal(String(o.label || o.id))
  const shown = options.find(same)
  const pick = async (o) => {
    setOpen(false)
    if (same(o)) return
    setSwitching(true)
    try {
      setCurrent(await assistant.setModel(o))
    } catch (error) {
      onError(`切换模型失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSwitching(false)
    }
  }
  const onMenuKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...root.current.querySelectorAll('[role="menuitemradio"]')]
    const at = items.indexOf(document.activeElement)
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }
  return h(
    'div',
    { className: 'devboard-assistant-model', ref: root },
    h(
      'button',
      {
        type: 'button',
        className: 'devboard-assistant-modelbtn',
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-label': `模型：${shown ? nameOf(shown) : reveal(current.model)}`,
        disabled,
        title: reveal(`${current.route} / ${current.model}`),
        onClick: () => setOpen(!open),
      },
      h('span', null, shown ? nameOf(shown) : reveal(current.model)),
      h(Icon, { name: 'chevron', size: 12 }),
    ),
    open &&
      h(
        'div',
        { className: 'devboard-assistant-modelmenu', role: 'menu', 'aria-label': '选择模型', onKeyDown: onMenuKey },
        options.map((o) =>
          h(
            'button',
            { key: `${o.route}/${o.id}`, type: 'button', role: 'menuitemradio', 'aria-checked': same(o), title: reveal(o.route), onClick: () => void pick(o) },
            h('span', null, nameOf(o)),
            same(o) && h(Icon, { name: 'check', size: 14 }),
          ),
        ),
      ),
  )
}

const STATUS = {
  connecting: ['连接中', 'connecting'],
  ready: ['在线', 'ready'],
  busy: ['处理中', 'busy'],
  error: ['连接出错', 'error'],
  released: ['在别的标签页', 'error'],
}

/** A stable callback that always calls the latest closure, so memoized children are not re-rendered by it. */
function useEvent(fn) {
  const latest = React.useRef(fn)
  latest.current = fn
  return React.useCallback((...args) => latest.current(...args), [])
}

/**
 * The composer owns the draft: a keystroke re-renders only this form, never the conversation or the rail
 * (in a long chat that was seconds per key). The page fills it through the ref (`fill`) and gets the text on send.
 */
const Composer = React.forwardRef(function Composer({ ready, sendError, retryHandback, clearError, onSend }, ref) {
  const [draft, setDraft] = React.useState('')
  const input = React.useRef(null)
  React.useImperativeHandle(ref, () => ({
    fill: (text) => {
      setDraft(text)
      input.current?.focus()
    },
  }))
  // The composer grows with its text up to the CSS max-height, then scrolls.
  React.useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])
  const submit = async (e) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || !ready) return
    setDraft('')
    if (!(await onSend(text))) setDraft(text)
  }
  const onKeyDown = (e) => {
    // Enter sends; Shift+Enter is a new line, and Enter that confirms an IME composition is not a send.
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return
    e.preventDefault()
    e.currentTarget.form?.requestSubmit()
  }
  return h(
    'form',
    { className: 'devboard-assistant-compose', onSubmit: submit },
    sendError &&
      h(
        'p',
        { className: 'devboard-assistant-error', role: 'alert' },
        sendError,
        retryHandback && h(Button, { htmlType: 'button', onClick: () => { clearError(); retryHandback() } }, '重试'),
      ),
    h(
      'div',
      { className: 'devboard-assistant-composer' },
      h('textarea', {
        ref: input,
        rows: 1,
        value: draft,
        onChange: (e) => setDraft(e.target.value),
        onKeyDown,
        'aria-label': `对${NAME}说`,
        placeholder: ready ? '布置工作，或问问进展…' : `正在连接${NAME}…`,
        autoComplete: 'off',
        maxLength: 4000,
      }),
      h(
        'div',
        { className: 'devboard-assistant-compose-bar' },
        h(
          'span',
          { className: 'devboard-assistant-compose-note' },
          h(
            'span',
            { className: 'devboard-assistant-access', title: BOARD_NO_CONFIRM.hint, 'aria-label': `${BOARD_NO_CONFIRM.text}：${BOARD_NO_CONFIRM.hint}`, role: 'note' },
            BOARD_NO_CONFIRM.text,
          ),
          h('span', { className: 'devboard-assistant-hint' }, 'Enter 发送 · Shift + Enter 换行'),
        ),
        h(Button, { htmlType: 'submit', appearance: 'primary', disabled: !ready || !draft.trim() }, '发送'),
      ),
    ),
  )
})

export function Assistant({ ctx, board }) {
  const { assistant, state, status, conversation, starting, startNew, reclaim, retry } = useAssistantStream(ctx, board)
  const [sendError, setSendErrorState] = React.useState('')
  const [retryHandback, setRetryHandback] = React.useState(undefined)
  const setSendError = React.useCallback((message, retry) => {
    setSendErrorState(message)
    setRetryHandback(() => retry)
  }, [])
  const [projectId, setProjectId] = React.useState('')
  const [open, setOpen] = React.useState('')
  const [railShown, setRailShown] = React.useState(false)
  const scroller = React.useRef(null)
  const composer = React.useRef(null)
  const data = board.data
  const newConversation = useEvent(() => {
    setSendError('')
    void startNew(setSendError)
  })
  useAutoHandback(assistant, status.phase === 'ready', data, setSendError)
  const live = usePermissions()
  const parked = useParkedApprovals(assistant, status.phase === 'ready', conversation, live.length)
  const permissions = React.useMemo(() => mergePermissions(live, parked.entries), [live, parked.entries])
  const parkedTools = React.useMemo(() => parkedToolIds(permissions), [permissions])
  const answerCard = useEvent((entry, verdict) => (entry.durable ? void parked.decide(entry, verdict, setSendError) : answerPermission(entry, { verdict })))
  React.useEffect(() => assistant.onPermissionRequest(onPermission), [assistant])

  // Follow the conversation unless the reader scrolled up to look at something. Whether to follow is read
  // before new rows land (on scroll), so a replayed history on mount still ends at the latest line.
  const follow = React.useRef(true)
  const onScroll = (e) => {
    const el = e.currentTarget
    follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  React.useLayoutEffect(() => {
    const el = scroller.current
    if (el && follow.current) el.scrollTop = el.scrollHeight
  }, [state.items.length, permissions.length, state.busy, data])

  const rail = React.useMemo(
    () => (data ? railOf(data, state, { projectId: projectId || undefined, permissions: permissions.length }) : { needs: [], running: [], done: [] }),
    [data, state, projectId, permissions],
  )
  const pick = (entry) => {
    setOpen((cur) => (cur === entry.id ? '' : entry.id))
    const target = entry.anchor ?? (entry.kind === 'permission' ? 'permission' : anchorFor(state, entry.id))
    const node = target && scroller.current?.querySelector(`[data-item="${target}"]`)
    if (!node) return
    node.scrollIntoView({ block: 'center', behavior: 'smooth' })
    node.classList.add('flash')
    setTimeout(() => node.classList.remove('flash'), 1500)
  }
  const submitText = useEvent(async (text) => {
    if (!text || status.phase !== 'ready') return
    setSendError('')
    try {
      await assistant.send(text)
    } catch (error) {
      setSendError(`发送失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
    return true
  })
  const onContinue = React.useCallback(() => void submitText('继续'), [submitText])
  const usePrompt = React.useCallback((text) => composer.current?.fill(text), [])
  const clearError = React.useCallback(() => setSendError(''), [setSendError])

  if (!data) return h('main', { className: 'devboard-app devboard-assistant', 'data-devboard-page': 'assistant' }, h('p', { role: 'status', className: 'devboard-assistant-loading' }, board.error || '正在读取看板…'))
  const [statusText, statusKey] = STATUS[status.phase === 'ready' && state.busy ? 'busy' : status.phase] ?? STATUS.connecting
  return h(
    'main',
    { className: 'devboard-app devboard-assistant', 'data-devboard-page': 'assistant' },
    h(
      'header',
      { className: 'devboard-assistant-top' },
      h(
        'div',
        { className: 'devboard-assistant-brand' },
        h(Avatar, null),
        h('h1', null, NAME, h('span', null, ' · 研发助理')),
        h('span', { className: 'devboard-assistant-status', 'data-phase': statusKey }, h('i', { 'aria-hidden': true }), statusText),
        h(ModelMenu, { assistant, ready: status.phase === 'ready', conversation, busy: state.busy, onError: setSendError }),
      ),
      h(
        'div',
        { className: 'devboard-assistant-projects', role: 'group', 'aria-label': '当前项目' },
        [{ id: '', name: '全部项目' }, ...data.projects].map((p) =>
          h('button', { key: p.id, type: 'button', 'aria-pressed': projectId === p.id, title: p.name, onClick: () => setProjectId(p.id) }, p.name),
        ),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'devboard-assistant-newbtn',
          'aria-label': '新对话',
          title: '开始新对话；旧对话保留在会话列表',
          disabled: status.phase !== 'ready' || starting,
          onClick: newConversation,
        },
        h(Icon, { name: 'plus' }),
        h('span', null, '新对话'),
      ),
      h(
        'button',
        { type: 'button', className: 'devboard-assistant-railbtn', 'aria-controls': 'devboard-assistant-rail', 'aria-expanded': railShown, onClick: () => setRailShown(!railShown) },
        h(Icon, { name: 'panel' }),
        '值守',
        rail.needs.length > 0 && h('span', { className: 'devboard-assistant-count on' }, rail.needs.length),
      ),
    ),
    board.error && h(Banner, { tone: 'error' }, board.error),
    h(TruncatedNotice, { data }),
    status.phase === 'released' &&
      h(Banner, { tone: 'error' }, h('span', null, '小川已在另一个标签页打开 '), h(Button, { onClick: reclaim }, '在此页接回')),
    status.phase === 'error' && h(Banner, { tone: 'error' }, h('span', null, `${status.message} `), h(Button, { onClick: retry }, '重试')),
    h(
      'div',
      { className: 'devboard-assistant-shell' },
      h(
        'section',
        { className: 'devboard-assistant-chat', 'aria-label': `与${NAME}对话` },
        h(
          'div',
          { className: 'devboard-assistant-scroll', ref: scroller, onScroll },
          h(
            'div',
            { className: 'devboard-assistant-flow', 'aria-live': 'polite' },
            state.items.length === 0 && permissions.length === 0
              ? h(Welcome, { ready: status.phase === 'ready', failed: status.phase === 'error' || status.phase === 'released', onPick: usePrompt })
              : h(Flow, { items: state.items, data, board, permissions, parkedTools, onAnswer: answerCard, busy: state.busy, onNew: newConversation, starting, onContinue }),
          ),
        ),
        h(Composer, { ref: composer, ready: status.phase === 'ready', sendError, retryHandback, clearError, onSend: submitText }),
      ),
      h(Rail, { rail, open, pick, data, board, shown: railShown, onClose: () => setRailShown(false) }),
    ),
  )
}
