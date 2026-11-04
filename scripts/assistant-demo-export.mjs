#!/usr/bin/env node
// Reduce the ledger rows of one real 小川 run into the compact timeline the 「小川演示」 page replays.
//   node scripts/assistant-demo-export.mjs <events.json> <out.js>
// Input: a JSON array of ledger rows { seq, ts, type, actor, origin, trust, data } where `data` is a JSON string.
// Output: an ES module `export default { meta, stats, events }`, deterministic for the same input and scrubbed
// (no absolute local paths, no ids beyond a short prefix, no credentials, no email addresses).
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TOOL_LABELS = {
  skill_read: '读取工作手册',
  devboard_project_create: '新建项目',
  devboard_board: '读看板',
  devboard_artifact_record: '登记交付物',
  devboard_gate_submit: '提交评审门',
  devboard_gate_check: '预检评审门',
  devboard_gate_status: '查看评审门',
  devboard_gate_review: '评审会意见',
  devboard_handoff: '接收人的决议',
  devboard_stage_update: '推进阶段',
  devboard_req_upsert: '登记需求条目',
  devboard_create_requirement: '新建需求',
  devboard_create_task: '新建任务',
  devboard_transition: '流转状态',
  devboard_defect_upsert: '登记缺陷',
  devboard_test_record: '登记测试结果',
  devboard_app_register: '登记应用地址',
  devboard_watch_ticket: '值守工单',
  subagent_spawn: '派出角色',
  subagent_list: '查看角色',
  subagent_collect: '收取角色结果',
  subagent_send_message: '给角色发消息',
  shell: '运行命令',
  job_output: '读后台输出',
  job_kill: '停止后台任务',
  read: '读文件',
  grep: '搜索',
  edit: '编辑文件',
}
const STAGES = ['INITIATION', 'REQUIREMENTS', 'DESIGN', 'IMPLEMENTATION', 'VERIFICATION', 'RELEASE']

/** Remove what must not ship: home paths, ids, emails, credentials. Idempotent. */
export function scrub(input) {
  let s = String(input ?? '')
  // the workspace root and any other home directory become relative paths
  s = s.replace(/\/(?:Users|home)\/[^/\s"'`)]+\/agnes-harness\/?/g, '')
  s = s.replace(/\/(?:Users|home)\/[^/\s"'`)]+\//g, '~/')
  s = s.replace(/\/(?:Users|home)\/[^/\s"'`)]+/g, '~')
  s = s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
  s = s.replace(/\b(?:sk|pk|ghp|gho|xox[a-z])[-_][A-Za-z0-9_-]{8,}/g, '[secret]')
  s = s.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[secret]')
  s = s.replace(/\b(api[_-]?key|token|secret|password|passwd)(["']?\s*[:=]\s*["']?)[^\s"',;]{4,}/gi, '$1$2[secret]')
  // session keys, request ids and other long identifiers keep an 8-character prefix
  s = s.replace(/\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '$1')
  s = s.replace(/\b[0-9a-f]{32,}\b/gi, (m) => m.slice(0, 8))
  s = s.replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, (m) => m.slice(0, 8))
  s = s.replace(/\b(devboard-assistant):[0-9a-f]{8}/g, '$1')
  return s
}

const trim = (s, n) => {
  const t = scrub(s).trim()
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
}
const oneLine = (s, n) => trim(String(s ?? '').replace(/\s+/g, ' '), n)
// chat replies keep their line breaks; markdown emphasis and code marks are dropped
const plain = (s, n) => trim(String(s ?? '').replace(/\*\*|`|^#+\s*/gm, ''), n)

const parse = (str) => {
  try {
    return typeof str === 'string' ? JSON.parse(str) : (str ?? {})
  } catch {
    return {}
  }
}
const textOf = (content) =>
  (Array.isArray(content) ? content : [])
    .filter((c) => c && c.type === 'text')
    .map((c) => c.text)
    .join('\n')
const jsonOf = (s) => {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
const actorId = (actor) => (typeof actor === 'string' ? (parse(actor).id ?? actor) : actor?.id)

function hintFor(name, a) {
  switch (name) {
    case 'shell':
      return oneLine(a.command, 90)
    case 'read':
    case 'edit':
      return oneLine(a.path, 80)
    case 'grep':
      return oneLine(`${a.pattern ?? ''} ${a.path ?? ''}`, 80)
    case 'devboard_artifact_record':
      return oneLine(a.path ?? a.title, 80)
    case 'devboard_transition':
      return oneLine(`${a.id ?? ''} → ${a.to ?? ''}`, 60)
    case 'devboard_create_requirement':
    case 'devboard_create_task':
      return oneLine(a.title, 80)
    case 'devboard_stage_update':
    case 'devboard_gate_submit':
      return oneLine(a.stage, 40)
    case 'devboard_gate_check':
    case 'devboard_gate_status':
    case 'devboard_gate_review':
      return oneLine(a.gateId ?? a.projectId, 60)
    case 'devboard_handoff':
      return oneLine(a.id, 60)
    case 'devboard_req_upsert':
      return Array.isArray(a.items) ? `${a.items.length} 条` : ''
    case 'devboard_defect_upsert':
      return oneLine(a.id ?? a.title, 60)
    case 'subagent_spawn':
      return oneLine(String(a.role ?? '').split('#').pop(), 40)
    case 'job_output':
    case 'job_kill':
      return oneLine(String(a.jobId ?? '').slice(0, 8), 20)
    default:
      return ''
  }
}

/** Rows → { meta, stats, events }. Pure and deterministic. */
export function buildTimeline(rows) {
  const list = [...rows].sort((a, b) => a.seq - b.seq)
  if (list.length === 0) throw new Error('no ledger rows')
  const startMs = Date.parse(list[0].ts)
  const endMs = Date.parse(list.at(-1).ts)
  const off = (ts) => Math.max(0, Math.round((Date.parse(ts) - startMs) / 1000))

  const calls = new Map()
  const results = new Map()
  for (const r of list) {
    const d = parse(r.data)
    if (r.type === 'tool/call') calls.set(d.toolUseId, { ...d, seq: r.seq, ts: r.ts })
    if (r.type === 'tool/result') results.set(d.toolUseId, { ...d, seq: r.seq })
  }
  const resultText = (id) => textOf(results.get(id)?.content)
  const resultJson = (id) => jsonOf(resultText(id))?.data ?? null

  const events = []
  let ord = 0
  const push = (ts, ev) => events.push({ t: off(ts), ord: ord++, ...ev })

  const roleByChild = new Map() // childKey → { role, title }
  const lastCollect = new Map() // childKey → latest finished collect text
  const roles = new Set()
  const gates = new Map() // gate id → { code, name, decided }
  const defects = new Set()
  const closedDefects = new Set()
  const stat = { turns: 0, toolCalls: 0, errors: 0, tests: 0, deliverables: 0, permissions: 0, handbacks: 0, spawns: 0 }
  const counted = { requirements: 0, tasks: 0 }

  for (const r of list) {
    const d = parse(r.data)
    const who = actorId(r.actor)
    switch (r.type) {
      case 'turn/start':
        stat.turns++
        push(r.ts, { k: 'turn', n: d.turn, trigger: d.trigger })
        break
      case 'turn/end':
        push(r.ts, { k: 'turn-end', n: stat.turns, reason: d.reason })
        break
      case 'user/message': {
        if (who === 'system') break // runtime context blocks, not conversation
        const text = textOf(d.content)
        const hand = /^自动交回\s*·\s*(.+?)\s*→/.exec(text)
        if (hand) {
          stat.handbacks++
          const gate = /gate\s+(\S+)/.exec(text)
          push(r.ts, { k: 'handback', text: oneLine(hand[1], 60), gate: gate ? gate[1] : undefined })
        } else push(r.ts, { k: 'user', text: plain(text, 320) })
        break
      }
      case 'assistant/message': {
        const text = textOf(d.content)
        if (text.trim()) push(r.ts, { k: 'reply', text: plain(text, 460) })
        break
      }
      case 'tool/call': {
        stat.toolCalls++
        const res = results.get(d.toolUseId)
        const isErr = Boolean(res?.isError)
        if (isErr) stat.errors++
        const a = d.args ?? {}
        push(r.ts, {
          k: 'tool',
          name: d.name,
          label: TOOL_LABELS[d.name] ?? d.name,
          hint: hintFor(d.name, a) || undefined,
          err: isErr || undefined,
        })
        if (isErr) break
        const data = resultJson(d.toolUseId)
        const structured = res?.structured
        if (d.name === 'subagent_spawn' && structured?.childKey) {
          const ref = String(structured.role?.ref ?? a.role ?? '')
          const role = ref.split('#').pop() || 'role'
          const title = structured.role?.title?.['zh-CN'] ?? role
          roleByChild.set(structured.childKey, { role, title })
          roles.add(role)
          stat.spawns++
          push(r.ts, { k: 'spawn', role, title, task: oneLine(a.task, 150) })
        } else if (d.name === 'subagent_collect') {
          const body = resultText(d.toolUseId)
          if (a.childKey && body && !/: running\s*$/.test(body.slice(0, 400)) && !/^child\s.*: running/.test(body)) {
            lastCollect.set(a.childKey, body)
          }
        } else if (d.name === 'devboard_artifact_record') {
          stat.deliverables++
          push(r.ts, {
            k: 'artifact',
            stage: a.stage,
            kind: a.kind,
            path: oneLine(a.path, 90),
            title: oneLine(a.title, 80),
            version: a.version,
          })
        } else if (d.name === 'devboard_stage_update' && data?.state) {
          push(r.ts, { k: 'stage', stage: data.stage ?? a.stage, state: data.state })
        } else if (d.name === 'devboard_gate_submit' && data?.gate) {
          const g = data.gate
          const known = gates.get(g.id)
          if (!known) gates.set(g.id, { code: g.code, name: g.name, decided: false })
          push(r.ts, { k: 'stage', stage: data.stage?.stage ?? a.stage, state: data.stage?.state })
          if (g.decision && g.decision !== 'PENDING') {
            gates.get(g.id).decided = true
            push(g.decidedAt ?? r.ts, gateDecision(g, 'auto'))
          } else if (!known) {
            push(r.ts, {
              k: 'gate',
              id: g.id,
              code: g.code,
              name: g.name,
              stage: data.stage?.stage ?? a.stage,
              roles: g.approverRoles,
              auto: g.auto || undefined,
            })
          }
        } else if (d.name === 'devboard_handoff' && data?.gate?.decision && data.gate.decision !== 'PENDING') {
          const g = data.gate
          if (!gates.has(g.id)) gates.set(g.id, { code: g.code, name: g.name, decided: false })
          gates.get(g.id).decided = true
          push(g.decidedAt ?? r.ts, gateDecision(g, g.approverActor?.kind ?? 'human'))
        } else if (d.name === 'devboard_defect_upsert' && data?.id) {
          defects.add(data.id)
          if (data.state === 'CLOSED') closedDefects.add(data.id)
          push(r.ts, {
            k: 'defect',
            id: data.id,
            title: oneLine(data.title, 90),
            severity: data.severity,
            state: data.state,
            by: a.actingRole,
          })
        } else if (d.name === 'devboard_test_record' && data?.id) {
          stat.tests++
          push(r.ts, {
            k: 'test',
            id: data.id,
            level: data.level,
            total: data.total,
            passed: data.passed,
            failed: data.failed,
            skipped: data.skipped,
          })
        } else if (d.name === 'devboard_create_requirement') counted.requirements++
        else if (d.name === 'devboard_create_task') counted.tasks++
        break
      }
      case 'x/core/child-result-collected': {
        const child = roleByChild.get(d.childKey)
        if (!child) break
        push(r.ts, {
          k: 'role-result',
          role: child.role,
          title: child.title,
          text: plain((lastCollect.get(d.childKey) ?? '').split('\n').find((l) => l.trim()) ?? '', 200),
        })
        break
      }
      case 'decision/state': {
        if (d.request?.spec?.purpose !== 'tool.permission' || d.revision !== 1) break
        const call = d.request.spec.subject?.call ?? {}
        const a = call.args ?? {}
        const id = `p${++stat.permissions}`
        push(d.request.createdAt ?? r.ts, {
          k: 'perm',
          id,
          tool: call.name,
          label: TOOL_LABELS[call.name] ?? call.name,
          cmd: oneLine(a.command ?? a.path ?? (a.jobId ? `job ${String(a.jobId).slice(0, 8)}` : ''), 140),
          handle: String(d.handle?.id ?? ''),
        })
        break
      }
      default:
    }
  }

  // answers: the last revision of each permission handle carries the result
  const answers = new Map()
  for (const r of list) {
    if (r.type !== 'decision/state') continue
    const d = parse(r.data)
    if (d.request?.spec?.purpose === 'tool.permission' && d.result?.reason === 'answered') answers.set(String(d.handle?.id ?? ''), d.result)
  }
  for (const ev of events) {
    if (ev.k !== 'perm') continue
    const res = answers.get(ev.handle)
    delete ev.handle
    if (res) {
      push(res.at ?? new Date(startMs + ev.t * 1000).toISOString(), {
        k: 'perm-answer',
        id: ev.id,
        option: res.response?.option ?? 'answered',
        by: res.answeredBy?.role ?? 'owner',
      })
    }
  }

  events.sort((x, y) => x.t - y.t || x.ord - y.ord)
  for (const e of events) {
    delete e.ord
    for (const key of Object.keys(e)) if (e[key] === undefined) delete e[key]
  }

  const decided = [...gates.values()].filter((g) => g.decided).length
  const project = firstProject(list, calls, results)
  return {
    meta: {
      project,
      startedAt: new Date(startMs).toISOString(),
      endedAt: new Date(endMs).toISOString(),
      stages: STAGES,
    },
    stats: {
      durationSec: Math.round((endMs - startMs) / 1000),
      turns: stat.turns,
      toolCalls: stat.toolCalls,
      toolErrors: stat.errors,
      gates: gates.size,
      gatesDecided: decided,
      humanHandbacks: stat.handbacks,
      roles: roles.size,
      roleRuns: stat.spawns,
      defects: defects.size,
      defectsClosed: closedDefects.size,
      deliverables: stat.deliverables,
      testRuns: stat.tests,
      permissions: stat.permissions,
      requirements: counted.requirements,
      tasks: counted.tasks,
    },
    events,
  }
}

function gateDecision(g, kind) {
  const sig = Array.isArray(g.signatures) ? g.signatures.map((s) => oneLine(s.by ?? s.role, 20)) : []
  return {
    k: 'gate-decision',
    id: g.id,
    code: g.code,
    name: g.name,
    decision: g.decision,
    by: oneLine(g.approver, 20),
    signers: sig.length ? sig : undefined,
    kind: kind === 'human' ? 'human' : 'auto',
    comment: oneLine(g.comment, 80) || undefined,
  }
}

function firstProject(list, calls, results) {
  for (const r of list) {
    if (r.type !== 'tool/call') continue
    const d = parse(r.data)
    if (d.name !== 'devboard_project_create') continue
    const out = jsonOf(textOf(results.get(d.toolUseId)?.content))?.data
    return {
      id: out?.id ?? d.args?.projectId ?? '',
      name: oneLine(d.args?.name, 40),
      org: oneLine(d.args?.org, 40),
      kind: d.args?.projectKind,
    }
  }
  void calls
  return { id: '', name: '', org: '', kind: '' }
}

/** The data module: header, then one event per line, so a rerun shows a readable diff. */
export function toModule(timeline) {
  const lines = timeline.events.map((e) => `    ${JSON.stringify(e)}`)
  return [
    '// Generated by scripts/assistant-demo-export.mjs from one real 小川 run. Do not edit by hand; rerun the script.',
    'export default {',
    `  meta: ${JSON.stringify(timeline.meta)},`,
    `  stats: ${JSON.stringify(timeline.stats)},`,
    '  events: [',
    `${lines.join(',\n')},`,
    '  ],',
    '}',
    '',
  ].join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) {
    console.error('usage: assistant-demo-export.mjs <events.json> <out.js>')
    process.exit(2)
  }
  const timeline = buildTimeline(JSON.parse(readFileSync(input, 'utf8')))
  writeFileSync(output, toModule(timeline))
  const s = timeline.stats
  console.log(`${output}: ${timeline.events.length} events, ${s.turns} turns, ${s.toolCalls} tool calls, ${s.gates} gates, ${s.roles} roles, ${s.defects} defects`)
}
