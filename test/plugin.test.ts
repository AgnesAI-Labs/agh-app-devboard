import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  checkServiceDef,
  checkToolDef,
  type ServiceDef,
  type ToolDef,
} from '../../../../packages/extension-api/src/index.js'
import {
  createPackageManager,
  emptyLock,
  parsePackageBundleContract,
  parseSource,
  writeLock,
} from '../../../../packages/package-manager/src/index.js'
import { ENTRIES, handbackWork, workOf } from '../client/entries.js'
import { lensSummary } from '../client/lens.js'
import { create, read, seed, snapshot, transition, update, upsertReqs } from '../domain.mjs'
import { FILES, GATES } from '../fastforward.mjs'
import { HANDOFF_TYPES, fixNext, humanNext, meetingNext, waitsOf } from '../handoff.mjs'
import { main } from '../index.mjs'
import { ROLES } from '../profiles.mjs'
import { buildSeed } from '../seed-data.mjs'

// The plugin imports the host-provided runtime; tests resolve it from source.
vi.mock('@agnes/plugin-runtime', () => import('../../../../packages/plugin-runtime/src/author.js'))
vi.mock(
  '@sinclair/typebox',
  () => import('../../../../packages/plugin-runtime/node_modules/@sinclair/typebox/build/esm/index.mjs'),
)

// biome-ignore lint/suspicious/noExplicitAny: plugin entry and store are untyped JavaScript
type Any = any

function memoryStore(readOnly = false) {
  const rows = new Map<string, unknown>()
  const deny = () => {
    throw new Error('CAPABILITY_DENIED')
  }
  return {
    rows,
    get: (key: string) => (rows.has(key) ? structuredClone(rows.get(key)) : undefined),
    set: readOnly ? deny : (key: string, value: unknown) => void rows.set(key, structuredClone(value)),
    delete: readOnly ? deny : (key: string) => void rows.delete(key),
    transaction: <T>(work: () => T) => work(),
  }
}

const tools: ToolDef[] = []
const services: ServiceDef[] = []
const skills: { name: string }[] = []
;(main as Any).apply({
  tools: { register: (d: ToolDef) => tools.push(d) },
  services: { register: (d: ServiceDef) => services.push(d) },
  skills: { register: (d: { name: string }) => skills.push(d) },
})
const tool = (name: string) => tools.find((t) => t.name === name) as Any
const service = (name: string) => services.find((s) => s.name === name) as Any
const signal = new AbortController().signal

/** Start a flow through devboard.approval and approve every node with the roles of its node. */
async function runFlow(ctx: Any, template: string, subjectId: string, running?: string) {
  const approval = (input: Any) => service('devboard.approval').handler(input, ctx)
  let id = running
  if (!id) {
    const started = await approval({ action: 'SUBMIT', template, subjectId, by: '客户代表 方卫东' })
    expect(started, template).toMatchObject({ ok: true })
    id = started.result.id
  }
  for (let guard = 0; guard < 12; guard++) {
    const flow = read(ctx.store).approvals.find((a: Any) => a.id === id)
    if (flow.state !== 'RUNNING') return flow
    const node = flow.nodes[flow.current]
    for (const role of node.mode === 'ALL'
      ? node.roles.filter((r: string) => !node.signed.includes(r))
      : [node.roles[0]])
      expect(await approval({ action: 'APPROVE', id, by: role }), `${template} ${node.id}`).toMatchObject({
        ok: true,
      })
  }
  throw new Error(`${template} did not finish`)
}

describe('DevBoard plugin contract', () => {
  it('registers well-formed tools, services and the playbook skill', () => {
    expect(tools).toHaveLength(27)
    expect(services.map((s) => s.name).sort()).toEqual([
      'devboard.approval',
      'devboard.artifact',
      'devboard.assistant',
      'devboard.create',
      'devboard.gate',
      'devboard.handback',
      'devboard.handoff',
      'devboard.reset',
      'devboard.snapshot',
      'devboard.transition',
      'devboard.watch.act',
      'devboard.watch.member',
      'devboard.watch.post',
      'devboard.watch.reset',
      'devboard.watch.rule',
      'devboard.watch.script',
      'devboard.watch.session',
      'devboard.watch.snapshot',
    ])
    for (const t of tools) {
      expect(checkToolDef(t, { prefix: 'devboard_' }), t.name).toMatchObject({ ok: true })
      expect(t.meta.presentation?.title, t.name).toMatch(/[\u4e00-\u9fff]/u)
    }
    for (const s of services) expect(checkServiceDef(s), s.name).toMatchObject({ ok: true })
    expect(skills.map((s) => s.name)).toEqual(['devboard-playbook'])
  })

  it('serves a seed document from a read-only store without writing', async () => {
    const store = memoryStore(true)
    const snap = await service('devboard.snapshot').handler({}, { store })
    expect(snap.projects).toHaveLength(buildSeed(Date.now()).projects.length)
    expect(snap.profiles.SOFTWARE.IMPLEMENTATION.gates[0]).toMatchObject({ code: 'TR4', auto: true })
    const body = await service('devboard.artifact').handler({ artifactId: 'DOC-042-SRS' }, { store })
    expect(body).toMatchObject({ source: 'seed', truncated: false })
    expect(body.markdown).toContain('SWR-')
    expect(await service('devboard.artifact').handler({ artifactId: 'DOC-404' }, { store })).toMatchObject({
      ok: false,
    })
    const prepared = await service('devboard.gate').prepare({}, { store })
    expect(prepared.resourceRevision).toBe('1')
  })

  it('names the cause when the host refuses the store with a plain object, never [object Object]', async () => {
    // The host throws a plain RpcError object (not an Error) once the plugin was reloaded after the session opened.
    const refused = { code: -32001, message: 'CAPABILITY_DENIED', data: { code: 'CAPABILITY_DENIED' } }
    const deadStore = {
      ...memoryStore(),
      transaction: () => {
        throw refused
      },
    }
    for (const name of ['devboard_board', 'devboard_project_create']) {
      const out = await tool(name).execute(name === 'devboard_board' ? {} : { name: 'x', description: 'y' }, { store: deadStore, signal })
      expect(out.isError).toBe(true)
      expect(out.content[0].text).not.toContain('[object Object]')
      expect(out.content[0].text).toContain('CAPABILITY_DENIED')
    }
    const odd = await tool('devboard_board').execute({}, { store: { ...deadStore, transaction: () => { throw { reason: 'x' } } }, signal })
    expect(odd.content[0].text).toBe('{"reason":"x"}')
  })

  it('refuses an illegal gate decision as an answer, not a failure, and writes through update only', async () => {
    const store = memoryStore()
    const gate = read(store).gates.find(
      (g: Any) => g.decision === 'PENDING' && g.findings.some((f: Any) => !f.closed),
    )
    const ctx = { store, signal }
    const refused = await service('devboard.gate').handler(
      { gateId: gate.id, decision: 'APPROVED', by: '任意审批人' },
      ctx,
    )
    expect(refused.ok).toBe(false)
    expect(refused.error).toContain('评审门不满足')
    expect(await service('devboard.reset').handler({}, ctx)).toMatchObject({ ok: true })
  })

  it('records the board decision as a human actor and takes no actor from the client', async () => {
    const store = memoryStore()
    const ctx = { store, signal }
    // DL2 refuses an agent: it only succeeds if the server, not the client, sets the actor
    const gate = read(store).gates.find((g: Any) => g.code === 'DL2' && g.decision === 'PENDING')
    const schema = JSON.parse(JSON.stringify(service('devboard.gate').inputSchema))
    expect(schema.additionalProperties).toBe(false)
    expect(Object.keys(schema.properties)).not.toContain('actor')
    // a person closes every finding of a gate (up to 25 from agents plus the system's and the panel's) in the deciding call
    expect(schema.properties.closeFindings.maxItems).toBeGreaterThanOrEqual(64)
    // even a caller that bypasses the schema cannot pick the actor
    const out = await service('devboard.gate').handler(
      {
        gateId: gate.id,
        decision: 'APPROVED',
        by: '客户代表 周明远',
        closeFindings: gate.findings.filter((f: Any) => !f.closed).map((f: Any) => ({ id: f.id, note: 'ok' })),
        actor: { kind: 'agent', agent: 'x', simulated: true },
      },
      ctx,
    )
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true })
    const signed = read(store).gates.find((g: Any) => g.id === gate.id).signatures
    expect(signed.at(-1).actor).toEqual({ kind: 'human' })
  })

  it("puts a rejected gate's comment and open findings in the continue draft", async () => {
    const store = memoryStore()
    const ctx = { store, signal }
    const gate = read(store).gates.find(
      (g: Any) => g.decision === 'PENDING' && g.findings.some((f: Any) => !f.closed),
    )
    const finding = gate.findings.find((f: Any) => !f.closed)
    const rejected = await service('devboard.gate').handler(
      { gateId: gate.id, decision: 'REJECTED', by: `${gate.approverRoles[0]} 周明远`, comment: '需求不完整' },
      ctx,
    )
    expect(rejected, JSON.stringify(rejected)).toMatchObject({ ok: true })
    const out = await service('devboard.handoff').handler({ type: 'gate', id: gate.id }, { store })
    expect(out.draft).toContain(`${gate.code}（${gate.name}）已驳回`)
    expect(out.draft).toContain('意见：需求不完整')
    expect(out.draft).toContain(`未关闭意见 ${finding.id}：${finding.text.slice(0, 120)}`)
    expect(out.draft).toContain(`devboard_handoff({type:"gate", id:"${gate.id}"})`)
    // every hand-off type has a draft inside the cap
    for (const [type, list] of [
      ['project', 'projects'],
      ['change', 'changes'],
      ['trial', 'trials'],
      ['fault', 'faults'],
      ['problem', 'problems'],
      ['intervention', 'interventions'],
    ] as const) {
      const item = read(store)[list][0]
      if (!item) continue
      const { draft } = await service('devboard.handoff').handler({ type, id: item.id }, { store })
      expect(draft, type).toContain(`devboard_handoff({type:"${type}", id:"${item.id}"})`)
      expect(draft.length, type).toBeLessThanOrEqual(2500)
    }
  })

  it('creates a record-only order project and a live software project through devboard.create', async () => {
    const store = memoryStore()
    const ctx = { store, signal }
    const order = await service('devboard.create').handler(
      { kind: 'project', by: '项目经理', name: '订单项目', projectKind: 'RETROFIT', org: '站台门分技术中心' },
      ctx,
    )
    expect(order.ok).toBe(true)
    expect(order.result).toMatchObject({ kind: 'RETROFIT', org: '站台门分技术中心' })
    expect(order.result.live).toBeUndefined()
    const sw = await service('devboard.create').handler(
      { kind: 'project', by: '项目经理', name: '软件' },
      ctx,
    )
    expect(sw.result).toMatchObject({
      kind: 'SOFTWARE',
      live: true,
      tailoring: { skipped: ['TR2', 'TR6', 'PDCP'] },
    })
    const bad = await service('devboard.create').handler(
      { kind: 'project', by: 'x', name: 'y', projectKind: 'NOPE' },
      ctx,
    )
    expect(bad).toMatchObject({ ok: false })
    // any string field on a page command is checked, not only the ones the domain trims
    const bidi = await service('devboard.create').handler(
      { kind: 'project', by: '项目经理', name: '软件', description: 'a\u202eb' },
      ctx,
    )
    expect(bidi).toMatchObject({ ok: false, error: expect.stringContaining('U+202E') })
  })

  it('co-signs a gate through devboard.gate and moves trials, faults, problems and retrofit through devboard.transition', async () => {
    const store = memoryStore()
    const ctx = { store, signal }
    const { result: p } = update(store, (s: Any) => {
      const project = create(s, { kind: 'project', name: '订单', projectKind: 'NEW_BUILD', by: 'x' })
      project.service = { phase: '质保期' }
      s.items.push({ id: 'NC-BUF-01', projectId: project.id, name: '缓冲头', discipline: 'MECH', lru: true })
      s.faults.push({
        id: 'FA-T1',
        projectId: project.id,
        source: 'PHM',
        signal: 'SLIDE',
        train: '1',
        detectedAt: new Date().toISOString(),
        state: 'NEW',
        history: [],
      })
      return project
    })
    const transition = (input: Any) =>
      service('devboard.transition').handler({ by: '客服工程师', ...input }, ctx)
    expect(await transition({ kind: 'fault', id: 'FA-T1', to: 'DISPATCHED' })).toMatchObject({ ok: true })
    expect(await transition({ kind: 'fault', id: 'FA-T1', to: 'CLOSED' })).toMatchObject({ ok: false })

    const trial = await tool('devboard_trial_upsert').execute(
      {
        projectId: p.id,
        type: 'TYPE_TEST',
        title: '低温夹紧力',
        standard: 's',
        sample: 'SN-1',
        lab: 'x',
        plannedAt: '2026-11-02',
      },
      ctx as Any,
    )
    const tid = trial.structured.data.id
    expect(await transition({ kind: 'trial', id: tid, to: 'IN_PROGRESS' })).toMatchObject({ ok: true })
    const reported = await transition({
      kind: 'trial',
      id: tid,
      to: 'REPORTED',
      reportNo: 'R-1',
      result: 'PASS',
    })
    expect(reported.result).toMatchObject({ state: 'REPORTED', reportNo: 'R-1', result: 'PASS' })

    const problem = await tool('devboard_problem_upsert').execute(
      {
        projectId: p.id,
        title: '滑道异常',
        faultIds: ['FA-T1'],
        steps: { D4: { done: true } },
        rootCause: '导轨磨损',
      },
      ctx as Any,
    )
    const qid = problem.structured.data.id
    expect(await transition({ kind: 'problem', id: qid, to: 'ANALYZING' })).toMatchObject({ ok: true })
    expect(await transition({ kind: 'problem', id: qid, to: 'ACTION' })).toMatchObject({ ok: true })

    const change = await tool('devboard_change_upsert').execute(
      {
        projectId: p.id,
        title: '导轨 B → C',
        reason: '滑道异常',
        source: { type: 'FIELD', ref: qid },
        rootCause: '导轨磨损',
        impact: { items: [{ itemId: 'NC-BUF-01', fromRev: 'B', toRev: 'C' }], fleet: { doors: 10 } },
      },
      ctx as Any,
    )
    const cid = change.structured.data.id
    for (const to of ['ANALYZED', 'CCB_REVIEW'])
      expect(await transition({ kind: 'change', id: cid, to, by: 'CCB' })).toMatchObject({ ok: true })
    // CCB approval is the ECR flow's move; the as-designed baseline comes with the ECN release
    expect(await transition({ kind: 'change', id: cid, to: 'APPROVED', by: 'CCB' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('需走 ECR 审批'),
    })
    await runFlow(ctx, 'ECR', cid)
    await runFlow(ctx, 'ECN_RELEASE', cid)
    expect(await transition({ kind: 'retrofit', id: cid, done: 4 })).toMatchObject({ ok: true })
    expect(await transition({ kind: 'retrofit', id: cid, done: 4 })).toMatchObject({ ok: false })
    expect(await transition({ kind: 'retrofit', id: cid, done: 10 })).toMatchObject({ ok: true })
    const state = read(store)
    expect(state.configBaselines.filter((b: Any) => b.projectId === p.id).map((b: Any) => b.type)).toEqual([
      'AS_DESIGNED',
      'AS_MAINTAINED',
    ])
    expect(state.changes.find((c: Any) => c.id === cid)).toMatchObject({
      state: 'APPROVED',
      ecn: expect.any(String),
    })
    expect((await service('devboard.snapshot').handler({ projectId: p.id }, { store })).trials[0].id).toBe(
      tid,
    )
  })

  it('keeps people in charge of decisions the agent only drafts', async () => {
    const store = memoryStore()
    const ctx = { store, signal } as Any
    const { result: p } = update(store, (s: Any) =>
      create(s, { kind: 'project', name: '订单', projectKind: 'NEW_BUILD' }),
    )
    const base = {
      projectId: p.id,
      type: 'TYPE_TEST',
      title: 't',
      standard: 's',
      sample: 'x',
      lab: 'l',
      plannedAt: '2026-11-02',
    }
    const trial = (await tool('devboard_trial_upsert').execute(base, ctx)).structured.data
    const approve = await tool('devboard_trial_upsert').execute({ id: trial.id, to: 'APPROVED' }, ctx)
    expect(approve.isError).toBe(true)
    const problem = (await tool('devboard_problem_upsert').execute({ projectId: p.id, title: 'x' }, ctx))
      .structured.data
    const close = await tool('devboard_problem_upsert').execute({ id: problem.id, to: 'CLOSED' }, ctx)
    expect(close.isError).toBe(true)
    expect(read(store).problems.find((q: Any) => q.id === problem.id).state).toBe('OPEN')
    // a defect is created (no id) or moved (id + to); a mixed call is refused, not half applied
    const defect = tool('devboard_defect_upsert')
    const before = read(store).activity?.length ?? 0
    expect(
      (await defect.execute({ projectId: p.id, title: 'd', severity: 'C', to: 'CLOSED' }, ctx)).isError,
    ).toBe(true)
    const made = (await defect.execute({ projectId: p.id, title: 'd', severity: 'C' }, ctx)).structured.data
    expect((await defect.execute({ id: made.id, severity: 'A', to: 'CONFIRMED' }, ctx)).isError).toBe(true)
    expect((await defect.execute({ id: made.id }, ctx)).isError).toBe(true)
    expect(read(store).defects.find((d: Any) => d.id === made.id)).toMatchObject({
      state: 'NEW',
      severity: 'C',
    })
    expect(read(store).activity.length).toBe(before + 1)
    // a move naming another project does not reach this project's defect
    const other = read(store).projects.find((x: Any) => x.id !== p.id).id
    expect(
      (await defect.execute({ id: made.id, projectId: other, to: 'CONFIRMED' }, ctx)).structured,
    ).toBeUndefined()
    expect(read(store).defects.find((d: Any) => d.id === made.id).state).toBe('NEW')
    // a class-A defect holds TR5 and ADCP: the agent closes it only after its retest, through either tool
    const fatal = (await defect.execute({ projectId: p.id, title: 'f', severity: 'A' }, ctx)).structured.data
    expect((await defect.execute({ id: fatal.id, to: 'CLOSED' }, ctx)).isError).toBe(true)
    const move = tool('devboard_transition')
    expect((await move.execute({ kind: 'defect', id: fatal.id, to: 'CLOSED' }, ctx)).isError).toBe(true)
    // ... and only with regression evidence: a pass of its test case recorded after it entered RETEST
    const items = [
      { id: 'CUS-001', title: 'c', text: 'c' },
      { id: 'SYS-001', title: 's', text: 's', parent: ['CUS-001'] },
      { id: 'SWR-001', title: 'w', text: 'w', parent: ['SYS-001'] },
      { id: 'TC-001', title: 't', text: 't', parent: ['SWR-001'] },
    ]
    await tool('devboard_req_upsert').execute({ projectId: p.id, items }, ctx)
    const linked = (
      await defect.execute({ projectId: p.id, title: 'g', severity: 'A', testCase: 'TC-001' }, ctx)
    ).structured.data
    const run = (status: string) =>
      tool('devboard_test_record').execute(
        { projectId: p.id, level: 'UNIT', results: [{ tc: 'TC-001', status }] },
        ctx,
      )
    const tick = () => new Promise((r) => setTimeout(r, 5))
    await run('pass') // before RETEST: does not count
    await tick()
    for (const to of ['CONFIRMED', 'FIXING', 'RETEST']) await defect.execute({ id: linked.id, to }, ctx)
    await tick()
    for (const call of [
      () => defect.execute({ id: linked.id, to: 'CLOSED' }, ctx),
      () => move.execute({ kind: 'defect', id: linked.id, to: 'CLOSED' }, ctx),
    ]) {
      const refused = await call()
      expect(refused.isError).toBe(true)
      expect(JSON.stringify(refused)).toContain('devboard_test_record')
    }
    await run('fail')
    await tick()
    expect((await defect.execute({ id: linked.id, to: 'CLOSED' }, ctx)).isError).toBe(true)
    await run('pass')
    expect((await defect.execute({ id: linked.id, to: 'CLOSED' }, ctx)).isError).toBeFalsy()
    expect(read(store).defects.find((d: Any) => d.id === linked.id).state).toBe('CLOSED')
    // a class-A defect with no test case cannot be closed by the agent at all
    for (const to of ['CONFIRMED', 'FIXING', 'RETEST'])
      await defect.execute({ id: fatal.id, to }, ctx)
    expect((await defect.execute({ id: fatal.id, to: 'CLOSED' }, ctx)).isError).toBe(true)
    expect(read(store).defects.find((d: Any) => d.id === fatal.id).state).toBe('RETEST')
  })

  it('handles approvals through devboard.approval and lets the agent only start flows of its own drafts', async () => {
    const store = memoryStore()
    const ctx = { store, signal } as Any
    const approval = (input: Any) => service('devboard.approval').handler(input, ctx)
    const prepared = await service('devboard.approval').prepare(
      { action: 'SUBMIT' },
      { store: memoryStore(true) },
    )
    expect(prepared.resourceRevision).toBe('1')
    // seeded: CR-2026-031's ECR is running at the co-sign node, quality overdue
    const running = read(store).approvals.find((a: Any) => a.subject.id === 'CR-2026-031')
    expect(running).toMatchObject({ state: 'RUNNING', template: 'ECR' })
    expect(await approval({ action: 'APPROVE', id: running.id, by: '技术负责人' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('审批不满足：当前节点「专业会签」需由'),
    })
    expect(await approval({ action: 'APPROVE', id: running.id, by: '机械设计师' })).toMatchObject({
      ok: false,
    })
    expect(
      await approval({ action: 'TRANSFER', id: running.id, by: '软件设计师', to: '邓超' }),
    ).toMatchObject({
      ok: true,
    })
    expect(
      await approval({ action: 'SUBMIT', template: 'ECR', subjectId: 'CR-2026-031', by: '客户代表' }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('已有进行中的审批'),
    })
    const finished = await runFlow(ctx, 'ECR', 'CR-2026-031', running.id)
    expect(finished.state).toBe('APPROVED')
    expect(
      await approval({ action: 'COMMENT', id: running.id, by: '质量工程师', comment: 'x' }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('已批准，不能再'),
    })

    // the tool starts flows for objects the agent drafted and nothing else
    const submit = tool('devboard_approval_submit')
    expect(tool('devboard_approval_submit').parameters.properties).not.toHaveProperty('action')
    const other = await submit.execute({ template: 'ECN_RELEASE', subjectId: 'CR-2026-012' }, ctx)
    expect(other.isError).toBe(true)
    const { result: p } = update(store, (s: Any) =>
      create(s, { kind: 'project', name: '订单', projectKind: 'NEW_BUILD' }),
    )
    const drafted = (
      await tool('devboard_change_upsert').execute(
        { projectId: p.id, title: '改', reason: 'r', impact: { reqs: ['CUS-001'] } },
        ctx,
      )
    ).structured.data
    for (const to of ['ANALYZED', 'CCB_REVIEW'])
      await tool('devboard_change_upsert').execute({ id: drafted.id, to }, ctx)
    const started = await submit.execute({ template: 'ECR', subjectId: drafted.id }, ctx)
    expect(started.isError).toBeUndefined()
    expect(started.structured.data).toMatchObject({ state: 'RUNNING', initiator: { by: '研发协调员' } })
    const next = started.structured.data.humanNext
    expect(next.steps.map((st: Any) => st.role)).toEqual([
      '机械设计师',
      '电气设计师',
      '软件设计师',
      '工艺工程师',
      '质量工程师',
    ])
    for (const role of next.steps.map((st: Any) => st.role)) expect(next.text).toContain(`「${role}」`)
    expect(next.text).toContain('下方面板')
    expect(next.text).not.toMatch(/演示角色|我的待办|到看板/)
    expect(
      (await tool('devboard_handoff').execute({ type: 'change', id: drafted.id }, ctx)).structured.data
        .humanNext.text,
    ).toBe(next.text)
    const direct = await tool('devboard_change_upsert').execute({ id: drafted.id, to: 'APPROVED' }, ctx)
    expect(direct.isError).toBe(true)
  })

  it('aggregates faults by signal and time window and writes nothing', async () => {
    const store = memoryStore()
    const day = 24 * 3_600_000
    const { result: p } = update(store, (s: Any) => {
      const project = create(s, { kind: 'project', name: '订单', projectKind: 'NEW_BUILD' })
      for (const [i, [signal, age]] of [
        ['SLIDE', 1],
        ['SLIDE', 3],
        ['COMM', 40],
      ].entries())
        s.faults.push({
          id: `FA-${i}`,
          projectId: project.id,
          source: 'PHM',
          signal,
          train: '1',
          detectedAt: new Date(Date.now() - Number(age) * day).toISOString(),
          state: 'NEW',
          history: [],
        })
      return project
    })
    const before = read(store).revision
    const out = await tool('devboard_fault_list').execute({ projectId: p.id, days: 30 }, {
      store,
      signal,
    } as Any)
    expect(out.structured.data).toMatchObject({ total: 2, bySignal: { SLIDE: 2 } })
    expect(read(store).revision).toBe(before)
    const wide = await tool('devboard_fault_list').execute({ projectId: p.id, days: 90 }, {
      store,
      signal,
    } as Any)
    expect(wide.structured.data.bySignal).toEqual({ SLIDE: 2, COMM: 1 })
  })

  it('registers each deliverable of one kind under its suffix and each sub-system requirement prefix', async () => {
    const store = memoryStore()
    const { result: p } = update(store, (s: Any) => create(s, { kind: 'project', name: '软件' }))
    const files = new Map([
      [`${p.workspaceDir}/docs/a.md`, '# a'],
      [`${p.workspaceDir}/docs/b.md`, '# b'],
    ])
    const fs = {
      read: async (path: string) =>
        new TextEncoder().encode(files.get(path) ?? (Promise.reject(new Error('ENOENT')) as Any)),
    }
    const ctx = { store, signal, fs } as Any
    const base = { projectId: p.id, stage: 'VERIFICATION', kind: 'TYPE_TEST_REPORT' }
    const a = await tool('devboard_artifact_record').execute(
      { ...base, suffix: '07', path: 'docs/a.md' },
      ctx,
    )
    const b = await tool('devboard_artifact_record').execute(
      { ...base, suffix: '08', path: 'docs/b.md' },
      ctx,
    )
    expect(
      [a.structured.data.id, b.structured.data.id].map((id: string) => id.replace(/^DOC-\d+-/, '')),
    ).toEqual(['TYPE-TEST-REPORT-07', 'TYPE-TEST-REPORT-08'])
    const reqs = await tool('devboard_req_upsert').execute(
      {
        projectId: p.id,
        items: [
          { id: 'CUS-001', title: 'c', text: 'c', clause: 'TA §1', compliance: 'COMPLY' },
          { id: 'SYS-001', title: 's', text: 's', parent: ['CUS-001'] },
          { id: 'MER-001', title: 'm', text: 'm', parent: ['SYS-001'] },
        ],
      },
      ctx,
    )
    expect(reqs.isError).toBeFalsy()
    expect(read(store).reqs.find((r: Any) => r.id === 'MER-001')).toMatchObject({
      level: 'SWR',
      discipline: 'MECH',
    })
    expect(upsertReqs).toBeTypeOf('function')
  })

  it('reads a live document in the tool, keeps it inside the project directory and previews it', async () => {
    const store = memoryStore()
    const created = await tool('devboard_project_create').execute({ name: '车门健康监测看板' }, {
      store,
      signal,
    } as Any)
    const project = created.structured.data
    const files = new Map([[`${project.workspaceDir}/docs/PROJECT-PLAN.md`, '# 项目计划\n\n范围与里程碑']])
    const fs = {
      read: async (path: string) => {
        const text = files.get(path)
        if (text === undefined) throw new Error('ENOENT')
        return new TextEncoder().encode(text)
      },
    }
    const ctx = { store, signal, fs } as Any
    const base = { projectId: project.id, stage: 'INITIATION', kind: 'PLAN' }
    const recorded = await tool('devboard_artifact_record').execute(
      { ...base, path: 'docs/PROJECT-PLAN.md' },
      ctx,
    )
    expect(recorded.isError).toBeFalsy()
    const preview = await service('devboard.artifact').handler(
      { artifactId: recorded.structured.data.id },
      { store },
    )
    expect(preview).toMatchObject({ source: 'workspace', markdown: '# 项目计划\n\n范围与里程碑' })
    for (const path of ['../PRJ-2025-042/x.md', '/etc/passwd', 'docs/../../x.md', 'docs/missing.md'])
      expect((await tool('devboard_artifact_record').execute({ ...base, path }, ctx)).isError, path).toBe(
        true,
      )
    expect(update(store, (s: Any) => s.artifacts.length).result).toBe(seed(Date.now()).artifacts.length + 1)
  })

  it('writes a document given as content inside the project directory, then registers it; a refusal writes nothing', async () => {
    const store = memoryStore()
    const project = (
      await tool('devboard_project_create').execute({ name: '车门健康监测看板' }, { store, signal } as Any)
    ).structured.data
    const writes = new Map<string, string>()
    const fs = {
      read: async (path: string) => {
        const text = writes.get(path)
        if (text === undefined) throw new Error('ENOENT')
        return new TextEncoder().encode(text)
      },
      stat: async (path: string) => {
        if (!writes.has(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        return { kind: 'file', size: 0, mtimeMs: 0 }
      },
      write: async (path: string, data: string) => void writes.set(path, data),
    }
    const ctx = { store, signal, fs } as Any
    const base = { projectId: project.id, stage: 'INITIATION', kind: 'PLAN' }
    const record = (input: Any) => tool('devboard_artifact_record').execute({ ...base, ...input }, ctx)
    const ok = await record({ path: 'docs/PROJECT-PLAN.md', content: '# 项目计划\n\n范围与里程碑' })
    expect(ok.isError).toBeFalsy()
    expect([...writes]).toEqual([[`${project.workspaceDir}/docs/PROJECT-PLAN.md`, '# 项目计划\n\n范围与里程碑']])
    expect(
      await service('devboard.artifact').handler({ artifactId: ok.structured.data.id }, { store }),
    ).toMatchObject({ source: 'workspace', markdown: '# 项目计划\n\n范围与里程碑' })
    writes.clear()
    const before = read(store).artifacts.length
    const refused = [
      { path: '../PRJ-2025-042/x.md' },
      { path: 'docs/../../x.md' },
      { path: '/etc/passwd' },
      { path: 'devboard-projects/PRJ-2025-042/docs/x.md' },
      { path: 'analysis/CR-404/x.md', kind: 'ANALYSIS' }, // no such change
      { path: 'analysis/CR-1/x.md' }, // analysis files are only kind ANALYSIS
      { path: 'docs/BIG.md', content: '一'.repeat(70_000) }, // > 200 KB as UTF-8
    ]
    for (const r of refused)
      expect((await record({ content: '# x', ...r })).isError, r.path).toBe(true)
    expect(writes.size).toBe(0)
    expect(read(store).artifacts.length).toBe(before)
    // without content nothing is written: the file must already exist
    expect((await record({ path: 'docs/none.md' })).isError).toBe(true)
    expect(writes.size).toBe(0)
  })

  it('writes content only for document kinds, .md/.txt files, and never over another artifact or a locked one', async () => {
    const store = memoryStore()
    const project = (
      await tool('devboard_project_create').execute({ name: '车门健康监测看板' }, { store, signal } as Any)
    ).structured.data
    const writes = new Map<string, string>()
    const fs = {
      read: async (path: string) => {
        const text = writes.get(path)
        if (text === undefined) throw new Error('ENOENT')
        return new TextEncoder().encode(text)
      },
      stat: async (path: string) => {
        if (!writes.has(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        return { kind: 'file', size: 0, mtimeMs: 0 }
      },
      write: async (path: string, data: string) => void writes.set(path, data),
    }
    const ctx = { store, signal, fs } as Any
    const base = { projectId: project.id, stage: 'INITIATION', content: '# x' }
    const record = (input: Any) => tool('devboard_artifact_record').execute({ ...base, kind: 'PLAN', ...input }, ctx)
    const dir = project.workspaceDir
    // a registered code file, and a file nobody registered yet
    writes.set(`${dir}/src/app.js`, 'x')
    expect((await record({ kind: 'CODE', suffix: 'APP', path: 'src/app.js', content: undefined })).isError).toBeFalsy()
    writes.clear()
    const refused: Any[] = [
      { kind: 'CODE', suffix: 'A', path: 'src/a.md' },
      { kind: 'TEST', suffix: 'A', path: 'tests/a.md' },
      { kind: 'ANALYSIS', path: 'analysis/CR-1/a.md' },
      { path: 'docs/server.js' },
      { path: 'package.json' },
      { path: 'docs/NOEXT' },
      { path: 'docs/.env' },
      { path: 'docs/.hidden/PLAN.md' },
      { path: 'src/app.js' }, // another artifact's file
      { path: 'docs/a.md.js' },
    ]
    for (const r of refused) {
      const out = await record(r)
      expect(out.isError, r.path).toBe(true)
      expect(out.content[0].text, r.path).toContain('宿主')
    }
    expect(writes.size).toBe(0)
    // path aliases on case-insensitive / normalising volumes: refused, and an unregistered existing file is not overwritten
    expect((await record({ suffix: 'N', path: 'docs/caf\u00e9.md' })).isError).toBeFalsy()
    writes.set(`${dir}/docs/orphan.md`, 'old')
    const snapshot = new Map(writes)
    for (const alias of ['docs/CAF\u00c9.MD', 'docs/cafe\u0301.md', 'docs/orphan.md'])
      expect((await record({ suffix: 'Z', path: alias })).content[0].text, alias).toContain('宿主')
    expect(writes).toEqual(snapshot)
    writes.clear()
    // own unlocked file: create, then update
    expect((await record({ path: 'docs/PLAN.txt' })).isError).toBeFalsy()
    expect((await record({ path: 'docs/PLAN.txt', content: '# y' })).isError).toBeFalsy()
    expect(writes.get(`${dir}/docs/PLAN.txt`)).toBe('# y')
    // locked: baselined or under review
    for (const status of ['BASELINED', 'IN_REVIEW']) {
      update(store, (s: Any) => void (s.artifacts.find((a: Any) => a.projectId === project.id && a.source?.path?.endsWith('PLAN.txt')).status = status))
      writes.clear()
      expect((await record({ path: 'docs/PLAN.txt' })).isError, status).toBe(true)
      expect(writes.size, status).toBe(0)
    }
  })

  it('devboard_doc_write writes a new document or sectioned edits; every refusal writes nothing', async () => {
    const store = memoryStore()
    const project = (
      await tool('devboard_project_create').execute({ name: '车门健康监测看板' }, { store, signal } as Any)
    ).structured.data
    const writes = new Map<string, string>()
    const fs = {
      read: async (path: string) => {
        const text = writes.get(path)
        if (text === undefined) throw new Error('ENOENT')
        return new TextEncoder().encode(text)
      },
      write: async (path: string, data: string) => void writes.set(path, data),
    }
    const ctx = { store, signal, fs } as Any
    const dir = project.workspaceDir
    const doc = (input: Any) => tool('devboard_doc_write').execute({ projectId: project.id, ...input }, ctx)
    expect((tool('devboard_doc_write').meta as Any).isPresentational).toBe(true)
    // a new document, then sections replaced one placeholder at a time (in order, on the result of the previous edit)
    expect((await doc({ path: 'docs/SAD.md', content: '# SAD\n\n<!--A-->\n\n<!--B-->\n' })).isError).toBeFalsy()
    expect(writes.get(`${dir}/docs/SAD.md`)).toBe('# SAD\n\n<!--A-->\n\n<!--B-->\n')
    const ok = await doc({
      path: 'docs/SAD.md',
      edits: [{ oldText: '<!--A-->', newText: '## 模块\n<!--A2-->' }, { oldText: '<!--A2-->', newText: '甲' }, { oldText: '<!--B-->', newText: '## 接口' }],
    })
    expect(ok.isError).toBeFalsy()
    expect(writes.get(`${dir}/docs/SAD.md`)).toBe('# SAD\n\n## 模块\n甲\n\n## 接口\n')
    expect(ok.structured.data.path).toBe(`${dir}/docs/SAD.md`)
    // every successful write leaves an activity line (project, path, bytes, content/edits); the file is not registered yet
    const lines = () => read(store).activity.filter((l: Any) => l.tool === 'devboard_doc_write')
    expect(lines().map((l: Any) => [l.projectId, l.entity, l.summary])).toEqual([
      [project.id, { kind: 'document', id: project.id }, `写文档 ${project.id} [${project.id}] content ${new TextEncoder().encode('# SAD\n\n<!--A-->\n\n<!--B-->\n').length}B docs/SAD.md`],
      [project.id, { kind: 'document', id: project.id }, expect.stringContaining('edits')],
    ])
    // no registration happens
    expect(read(store).artifacts.some((a: Any) => a.source?.path === `${dir}/docs/SAD.md`)).toBe(false)
    // a draft deliverable's file may be rewritten, a locked one may not (also through a case/normalization alias)
    const rec = await tool('devboard_artifact_record').execute(
      { projectId: project.id, stage: 'DESIGN', kind: 'SAD', path: 'docs/SAD.md' }, ctx)
    expect(rec.isError, rec.content?.[0]?.text).toBeFalsy()
    expect((await doc({ path: 'docs/SAD.md', edits: [{ oldText: '甲', newText: '乙' }] })).isError).toBeFalsy()
    // a registered path names its deliverable in the entity
    expect(lines().at(-1).entity).toEqual({ kind: 'document', id: rec.structured.data.id })
    expect(lines().at(-1).summary).toContain('docs/SAD.md')
    writes.set(`${dir}/src/app.js`, 'x')
    const code = await tool('devboard_artifact_record').execute(
      { projectId: project.id, stage: 'IMPLEMENTATION', kind: 'CODE', suffix: 'APP', path: 'src/app.js' }, ctx)
    expect(code.isError, code.content?.[0]?.text).toBeFalsy()
    const snapshot = new Map(writes)
    const logged = lines().length
    const feed = read(store).activity.length
    const refused: Any[] = [
      { path: '../PRJ-2025-042/x.md', content: 'x' },
      { path: 'docs/../../x.md', content: 'x' },
      { path: '/etc/passwd', content: 'x' },
      { path: 'docs/server.js', content: 'x' },
      { path: 'docs/NOEXT', content: 'x' },
      { path: 'docs/.env', content: 'x' },
      { path: 'docs/.hidden/PLAN.md', content: 'x' },
      { path: 'docs/BIG.md', content: '一'.repeat(70_000) }, // > 200 KB as UTF-8
      { path: 'docs/SAD.md', edits: [{ oldText: '乙', newText: '一'.repeat(70_000) }] }, // result over the cap
      { path: 'docs/SAD.md', edits: [{ oldText: '乙', newText: '丙' }, { oldText: '不存在', newText: 'x' }] }, // one bad edit voids all
      { path: 'docs/SAD.md', edits: [{ oldText: '##', newText: 'x' }] }, // not unique
      { path: 'docs/NEW.md', edits: [{ oldText: 'a', newText: 'b' }] }, // edits need an existing file
      { path: 'docs/SAD.md', content: 'x', edits: [{ oldText: 'a', newText: 'b' }] },
      { path: 'docs/SAD.md' },
      { path: 'src/app.js', content: 'x' }, // not a document
      { projectId: 'PRJ-NONE', path: 'docs/x.md', content: 'x' },
    ]
    for (const r of refused) expect((await doc(r)).isError, JSON.stringify(r).slice(0, 80)).toBe(true)
    expect(writes).toEqual(snapshot)
    expect(lines().length).toBe(logged) // refusals log nothing
    expect(read(store).activity.length).toBe(feed)
    // locked deliverables, including aliases of the registered path
    const sad = read(store).artifacts.find((a: Any) => a.source?.path === `${dir}/docs/SAD.md`)
    for (const status of ['IN_REVIEW', 'BASELINED']) {
      update(store, (s: Any) => void (s.artifacts.find((a: Any) => a.id === sad.id).status = status))
      for (const path of ['docs/SAD.md', 'docs/sad.MD', 'docs/SAD́.md'.replace('́', '')]) {
        const out = await doc({ path, content: 'hijack' })
        expect(out.isError, `${status} ${path}`).toBe(true)
        expect(out.content[0].text).toContain('宿主')
      }
      expect((await doc({ path: 'docs/SAD.md', edits: [{ oldText: '乙', newText: 'x' }] })).isError, status).toBe(true)
    }
    expect(writes).toEqual(snapshot)
  })

  it('exempts board writes from the tainted-turn permission card without widening approval', () => {
    for (const t of tools) {
      const meta = t.meta as Any
      // only a write is flagged; a read needs nothing, and no tool asks, is destructive or reaches outside the store
      expect(meta.isPresentational === true, t.name).toBe(!meta.isReadOnly)
      expect(meta.requiresApproval, t.name).toBe('never')
      expect(meta.isDestructive || meta.isOpenWorld, t.name).toBeFalsy()
    }
    // the exemption is per tool: the preset adds no rule that could cover shell, edit or write
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const rules = JSON.stringify(pkg.bundles?.coordinator?.presets?.devboard?.approval?.command_policy ?? [])
    expect(rules).not.toMatch(/devboard|shell/)
  })

  it('labels a tool write with its acting role, logs it in the feed and refuses other roles', async () => {
    const store = memoryStore()
    const ctx = { store, signal } as Any
    // watch tools write a project group's watch record, not the board: no acting role, no feed line
    const own = (n: string) => n === 'devboard_fastforward' || n.startsWith('devboard_watch_')
    const writers = tools.filter((t) => !t.meta.isReadOnly && !own(t.name))
    expect(writers.length).toBeGreaterThan(10)
    for (const t of writers)
      expect(JSON.parse(JSON.stringify(t.parameters)).properties.actingRole, t.name).toBeDefined()
    for (const t of tools.filter((x) => x.meta.isReadOnly || own(x.name)))
      expect(JSON.parse(JSON.stringify(t.parameters)).properties.actingRole, t.name).toBeUndefined()
    const created = await tool('devboard_create_requirement').execute(
      { title: '预警排行', actingRole: 'requirements' },
      ctx,
    )
    expect(created.isError).toBeFalsy()
    const req = created.structured.data
    expect(req.history[0].by).toBe('研发协调员 · 系统设计师（需求）')
    expect(req.actingRole).toBeUndefined()
    for (const actingRole of ['admin', '开发', '研发协调员'])
      expect(
        (await tool('devboard_create_requirement').execute({ title: 'x', actingRole }, ctx)).isError,
      ).toBe(true)
    const [line] = read(store).activity
    expect(line).toMatchObject({
      actor: '研发协调员 · 系统设计师（需求）',
      tool: 'devboard_create_requirement',
      entity: { kind: 'requirement', id: req.id },
      summary: `录入需求 ${req.id}`,
    })
    expect(read(store).activity).toHaveLength(1)
    // the portfolio and project reads the model gets do not carry the feed
    const board = await tool('devboard_board').execute({}, ctx)
    expect(board.structured.data.activity).toBeUndefined()
    const view = await service('devboard.snapshot').handler({}, { store })
    expect(view.activity).toHaveLength(1)
  })

  it('reads a hand-off through the tool and the query service and refuses a bad object', async () => {
    const store = memoryStore(true)
    const gate = read(store).gates.find((g: Any) => g.decision === 'PENDING')
    const def = tool('devboard_handoff')
    expect(def.meta.isReadOnly).toBe(true)
    expect(Object.keys(JSON.parse(JSON.stringify(def.parameters)).properties)).toEqual(['type', 'id'])
    const out = await def.execute({ type: 'gate', id: gate.id }, { store, signal } as Any)
    expect(out.isError).toBeFalsy()
    expect(out.structured.data).toMatchObject({ type: 'gate', id: gate.id })
    const viaService = await service('devboard.handoff').handler({ type: 'gate', id: gate.id }, { store })
    expect(viaService.summary).toBe(out.structured.data.summary)
    const auto = {
      gates: [{ id: 'G-1', code: 'TR4', name: '代码与集成评审', decision: 'PENDING', auto: true }],
    }
    expect(humanNext(auto, { type: 'gate', id: 'G-1' })).toMatchObject({
      page: null,
      text: expect.stringContaining('无需人工操作'),
    })
    expect(humanNext(auto, { type: 'gate', id: 'G-404' })).toBeUndefined()
    // handed to a person: the auto gate is theirs to decide, so the text must not say nothing is needed
    const handed = {
      ...auto,
      projects: [{ id: 'P', projectKind: 'SOFTWARE' }],
      artifacts: [],
      stages: [{ id: 'P/S', projectId: 'P', stage: 'IMPLEMENTATION' }],
      interventions: [{ id: 'HI-1', state: 'OPEN', entity: { kind: 'gate', id: 'G-1' } }],
    }
    handed.gates = [{ ...auto.gates[0], stageId: 'P/S', approverRoles: ['技术负责人'] }]
    const handedText = humanNext(handed, { type: 'gate', id: 'G-1' })?.text
    expect(handedText).toBeTruthy()
    expect(handedText).not.toContain('无需人工操作')
    expect(handedText).toContain('批准')
    // an auto gate held by system conditions: the list is bounded (3 shown, then 「等 N 项」) and each text clipped
    const heldState = (n: number, findings: Any[] = []) => ({
      projects: [{ id: 'P', projectKind: 'SOFTWARE' }],
      stages: [{ id: 'P/S', projectId: 'P', stage: 'IMPLEMENTATION' }],
      artifacts: Array.from({ length: n }, (_, i) => ({ id: `ART-${'长'.repeat(400)}${i}`, projectId: 'P', stage: 'IMPLEMENTATION' })),
      approvals: Array.from({ length: n }, (_, i) => ({ id: `AP-${i}`, template: 'DOC_RELEASE', state: 'IN_REVIEW', subject: { type: 'artifact', id: `ART-${'长'.repeat(400)}${i}` } })),
      trials: [],
      defects: [],
      interventions: [],
      gates: [{ id: 'G-1', stageId: 'P/S', code: 'TR4', name: 'x', decision: 'PENDING', auto: true, findings }],
    })
    const heldText = humanNext(heldState(100), { type: 'gate', id: 'G-1' })?.text as string
    expect(heldText).toContain('等 10 项')
    expect(heldText).toContain('另有 90 个交付物的发布审批尚未批准')
    expect(heldText.length).toBeLessThan(900)
    expect(heldText.match(/交付物 ART/g)).toHaveLength(3)
    // open system findings with no live condition (a withdrawn flow): the coordinator cannot close them, so route to a person
    const stuck = humanNext(heldState(0, [{ id: 'F-01', by: '系统检查', text: '交付物 A 的发布审批 AP-1 待评审，尚未批准', closed: false }]), { type: 'gate', id: 'G-1' })?.text as string
    expect(stuck).toContain('devboard_request_human')
    expect(stuck).toContain('F-01')
    expect(stuck).not.toContain('由研发协调员继续关闭意见')
    const waiting = {
      projects: [{ id: 'P', projectKind: 'SOFTWARE' }],
      artifacts: [],
      stages: [{ id: 'P/S', projectId: 'P', stage: 'DESIGN', author: '项目经理', humanAuthor: '质量工程师' }],
      gates: [{ id: 'G-2', stageId: 'P/S', code: 'DL1', name: 'x', decision: 'PENDING', approverRoles: ['质量工程师', '项目经理'] }],
    }
    expect(humanNext(waiting, { type: 'gate', id: 'G-2' })?.steps.map((s) => s.role)).toEqual(['项目经理'])
    // every person gate gets a panel, a TR without the customer included; one role signs at a time and the next shows after
    // (a TR gate is a person's only once a review meeting handed it over; handed = false is the gate still awaiting its meeting)
    const tr = (over: Any = {}, handed = true) => ({
      projects: [{ id: 'P', projectKind: 'SOFTWARE' }],
      artifacts: [],
      stages: [{ id: 'P/S', projectId: 'P', stage: 'REQUIREMENTS', author: '需求分析师' }],
      gates: [{ id: 'G-TR1', stageId: 'P/S', code: 'TR1', name: '需求评审', type: 'TR', decision: 'PENDING', approverRoles: ['技术负责人', '质量经理'], signatures: [], ...over }],
      interventions: handed ? [{ id: 'HI-1', state: 'OPEN', entity: { kind: 'gate', id: 'G-TR1' } }] : [],
      approvals: [],
    })
    // no meeting yet: no signer, no humanNext, a status the page shows instead of buttons, and a next step for the agent
    const awaiting = tr({}, false)
    expect(waitsOf(awaiting, 'P')).toEqual([
      { type: 'gate', id: 'G-TR1', label: 'TR1 需求评审', projectId: 'P', roles: [], any: false, verb: '批准', meeting: true, blocked: expect.stringContaining('等待评审会') },
    ])
    expect(humanNext(awaiting, { type: 'gate', id: 'G-TR1' })).toBeUndefined()
    expect(meetingNext(awaiting, awaiting.gates[0])).toMatch(/subagent_spawn.*devboard_gate_review.*不要请人签署/)
    // auto, DCP, customer-facing and handed gates need no meeting
    for (const g of [{ auto: true }, { type: 'DCP' }, { approverRoles: ['客户代表'] }])
      expect(meetingNext(awaiting, { ...awaiting.gates[0], ...g })).toBeUndefined()
    expect(meetingNext(tr(), tr().gates[0])).toBeUndefined()
    // an auto gate with open findings owes its fix in the same turn; nothing else does
    const autoGate = { ...awaiting.gates[0], auto: true, findings: [{ id: 'F-01', closed: false }, { id: 'F-02', closed: true }] }
    expect(fixNext(awaiting, autoGate)).toMatch(/TR1 有 1 条意见未关闭.*本轮内派开发角色.*subagent_send_message.*不要以「接下来续派」/)
    expect(fixNext(awaiting, { ...autoGate, findings: [{ id: 'F-01', closed: true }] })).toBeUndefined()
    expect(fixNext(awaiting, { ...autoGate, decision: 'APPROVED' })).toBeUndefined()
    expect(fixNext(awaiting, { ...autoGate, auto: false })).toBeUndefined()
    expect(meetingNext(awaiting, { ...awaiting.gates[0], decision: 'APPROVED' })).toBeUndefined()
    expect(waitsOf(tr(), 'P')).toEqual([
      { type: 'gate', id: 'G-TR1', label: 'TR1 需求评审', projectId: 'P', roles: ['技术负责人', '质量经理'], any: false, verb: '批准' },
    ])
    // every unsigned approver barred: nobody may sign, so the stall is stated (panel + text) instead of vanishing; the signer rule stays
    const noSigner = { ...tr({ approverRoles: ['需求分析师'] }), stages: [{ id: 'P/S', projectId: 'P', stage: 'REQUIREMENTS', humanAuthor: '需求分析师' }] }
    const [blocked] = waitsOf(noSigner, 'P')
    expect(blocked).toMatchObject({ id: 'G-TR1', roles: [], blocked: expect.stringContaining('需求分析师') })
    const stuckText = humanNext(noSigner, { type: 'gate', id: 'G-TR1' })
    expect(stuckText).toMatchObject({ page: '对话面板', steps: [], object: { id: 'G-TR1' } })
    for (const text of [stuckText?.text, blocked.blocked])
      expect(text).toMatch(/没有人能签署|无人可签/)
    expect(stuckText?.text).not.toMatch(/演示角色|我的待办|到看板/)
    expect(waitsOf(tr({ signatures: [{ role: '技术负责人' }] }))[0].roles).toEqual(['质量经理'])
    expect(waitsOf(tr({ signatures: [{ role: '技术负责人' }, { role: '质量经理' }], decision: 'APPROVED' }))).toEqual([])
    expect(waitsOf(tr(), 'other')).toEqual([])
    const trText = humanNext(tr(), { type: 'gate', id: 'G-TR1' })?.text as string
    expect(trText).toContain('下方面板')
    expect(trText).toContain('G-TR1（TR1 需求评审）')
    expect(trText).not.toMatch(/演示角色|我的待办|到看板|继续推进/)
    // an approval flow: an all-roles node lists who is left, an any-one node says any will do
    const flow = (mode: string, signed: string[]) => ({
      ...tr(),
      gates: [],
      approvals: [{ id: 'AP-1', projectId: 'P', title: '变更 ECR', state: 'RUNNING', current: 0, nodes: [{ name: '会签', state: 'ACTIVE', mode, roles: ['机械设计师', '电气设计师'], signed }] }],
    })
    expect(waitsOf(flow('ALL', ['机械设计师']))).toEqual([
      { type: 'approval', id: 'AP-1', label: '变更 ECR，当前节点「会签」', projectId: 'P', roles: ['电气设计师'], any: false, verb: '同意' },
    ])
    expect(waitsOf(flow('ANY', []))[0]).toMatchObject({ roles: ['机械设计师', '电气设计师'], any: true })
    expect(humanNext(flow('ANY', []), { type: 'approval', id: 'AP-1' })?.text).toContain('任选一个角色')
    expect(readFileSync(new URL('../skills/devboard-playbook.md', import.meta.url), 'utf8')).not.toContain(
      '现场项目：车门健康监测看板',
    )
    // A new requirement typed in chat must create a project, not resume a pending one on the board.
    const playbook = readFileSync(new URL('../skills/devboard-playbook.md', import.meta.url), 'utf8')
    expect(playbook).toMatch(
      /对话里提出新项目需求，就新建项目[\s\S]*devboard_project_create[\s\S]*不得改去推进看板上已有的项目/,
    )
    for (const input of [
      { type: 'task', id: 'TASK-001' },
      { type: 'gate', id: 'GATE-404' },
      { type: 'gate' },
    ])
      expect((await def.execute(input, { store, signal } as Any)).isError, JSON.stringify(input)).toBe(true)
    expect(
      await service('devboard.handoff').handler({ type: 'gate', id: 'GATE-404' }, { store }),
    ).toMatchObject({
      ok: false,
    })
  })

  it('registers the customer change a presenter typed and hands that very change over', async () => {
    const store = memoryStore()
    const ctx = { store, signal } as Any
    const project = (
      await service('devboard.create').handler({ kind: 'project', by: '项目经理', name: '车门' }, ctx)
    ).result
    const typed = {
      kind: 'change',
      by: '项目经理',
      projectId: project.id,
      title: '预警排行默认条数改为 20',
      reason: '客户：现场每次都要手动改条数',
      source: { type: 'CUSTOMER', ref: 'TA §3.2' },
    }
    const made = await service('devboard.create').handler(typed, ctx)
    expect(made).toMatchObject({ ok: true, result: { state: 'SUBMITTED', title: typed.title } })
    const out = await service('devboard.handoff').handler({ type: 'change', id: made.result.id }, { store })
    expect(out.change).toMatchObject({ title: typed.title, source: { type: 'CUSTOMER', ref: 'TA §3.2' } })
    expect(out.summary).toContain('TA §3.2')
    // a form with no reason is refused by the board, not sent on
    expect(await service('devboard.create').handler({ ...typed, reason: '' }, ctx)).toMatchObject({
      ok: false,
    })
  })

  it('tells the coordinator to read the hand-off first in every action that carries an object', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const actions = pkg.agnes.application.workbench.actions
    const handed = [
      'continue',
      'customer-change',
      'run-app',
      'change',
      'progress',
      'interventions',
      'phm-8d',
      'trial-change',
    ]
    for (const id of handed)
      for (const lang of ['en', 'zh-CN'])
        expect(actions.find((a: Any) => a.id === id).prompt[lang], `${id} ${lang}`).toContain(
          'devboard_handoff',
        )
    for (const id of ['new-project', 'fast-forward'])
      expect(actions.find((a: Any) => a.id === id).prompt['zh-CN']).not.toContain('devboard_handoff')
    expect(pkg.files).toContain('handoff.mjs')
    expect(pkg.scripts.build).toContain('handoff.mjs')
  })

  it('ships and checks every module the server code imports', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const modules = pkg.files.filter((f: string) => f.endsWith('.mjs'))
    const imported = new Set(
      modules.flatMap((f: string) =>
        [
          ...readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').matchAll(/from '\.\/([\w-]+\.mjs)'/g),
        ].map((m) => m[1]),
      ),
    )
    for (const file of imported) {
      expect(pkg.files, file).toContain(file)
      expect(pkg.scripts.build, file).toContain(`node --check ${file}`)
    }
  })

  it.each(Object.entries(ENTRIES))(
    'opens the %s button with a declared action and a hand-off type',
    (_name, entry) => {
      const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
      const action = pkg.agnes.application.workbench.actions.find((a: Any) => a.id === entry.action)
      expect(action, entry.action).toBeDefined()
      expect(HANDOFF_TYPES).toContain(entry.type)
      // the platform accepts a work object like this one
      expect({ type: entry.type, id: 'X-1' }.type).toMatch(/^[A-Za-z][A-Za-z0-9.-]{0,63}$/)
      expect(entry.label).toMatch(/[\u4e00-\u9fff]/u)
    },
  )

  it.each([
    [
      'faultEightD',
      { id: 'FA-1', state: 'NEW' },
      { action: 'phm-8d', object: { type: 'fault', id: 'FA-1' } },
    ],
    ['faultEightD', { id: 'FA-1', state: 'CLOSED' }, undefined],
    [
      'problemEightD',
      { id: 'QP-1', state: 'OPEN' },
      { action: 'phm-8d', object: { type: 'problem', id: 'QP-1' } },
    ],
    ['problemEightD', { id: 'QP-1', state: 'CLOSED' }, undefined],
    [
      'trialChange',
      { id: 'TT-1', state: 'REPORTED' },
      { action: 'trial-change', object: { type: 'trial', id: 'TT-1' } },
    ],
    [
      'changeImpact',
      { id: 'CR-1', state: 'SUBMITTED' },
      { action: 'change', object: { type: 'change', id: 'CR-1' } },
    ],
    [
      'changeImpact',
      { id: 'CR-1', state: 'ANALYZED' },
      { action: 'change', object: { type: 'change', id: 'CR-1' } },
    ],
    ['changeImpact', { id: 'CR-1', state: 'CCB_REVIEW' }, undefined],
    [
      'interventionContinue',
      { id: 'HI-1', state: 'RESOLVED' },
      { action: 'interventions', object: { type: 'intervention', id: 'HI-1' } },
    ],
    ['interventionContinue', { id: 'HI-1', state: 'OPEN' }, undefined],
    ['projectProgress', { id: 'PRJ-1' }, { action: 'progress', object: { type: 'project', id: 'PRJ-1' } }],
    ['customerChange', { id: 'CR-9' }, { action: 'customer-change', object: { type: 'change', id: 'CR-9' } }],
    [
      'continueGate',
      { id: 'G-1', decision: 'APPROVED' },
      { action: 'continue', object: { type: 'gate', id: 'G-1' } },
    ],
    ['continueGate', { id: 'G-1', decision: 'PENDING' }, undefined],
    ['runApp', { id: 'PRJ-1' }, { action: 'run-app', object: { type: 'project', id: 'PRJ-1' } }],
  ])('offers %s for %j as %j', (name, item, expected) => {
    const got = workOf(name, item)
    if (expected) expect(got).toMatchObject(expected)
    else expect(got).toBeUndefined()
  })

  it('records per-case results through the tool, refuses disagreeing counts and keeps the old form', async () => {
    const store = memoryStore()
    const ctx = { store, signal } as Any
    const project = (await tool('devboard_project_create').execute({ name: '车门' }, ctx)).structured.data
    const items = [
      { id: 'CUS-001', title: 'c', text: 'c' },
      { id: 'SYS-001', title: 's', text: 's', parent: ['CUS-001'] },
      { id: 'SWR-001', title: 'w', text: 'w', parent: ['SYS-001'] },
      { id: 'TC-001', title: 't', text: 't', parent: ['SWR-001'] },
    ]
    await tool('devboard_req_upsert').execute({ projectId: project.id, items }, ctx)
    const record = (input: Any) =>
      tool('devboard_test_record').execute({ projectId: project.id, level: 'UNIT', ...input }, ctx)
    const schema = JSON.parse(JSON.stringify(tool('devboard_test_record').parameters))
    expect(schema.required).toEqual(['projectId', 'level'])
    expect(schema.properties.results.maxItems).toBe(500)
    expect((await record({})).isError).toBe(true)
    expect((await record({ total: 2, passed: 1, failed: 0 })).isError).toBe(true)
    expect((await record({ results: [{ tc: 'TC-001', status: 'pass' }], total: 5 })).isError).toBe(true)
    expect((await record({ results: [{ tc: 'TC-9', status: 'pass' }] })).isError).toBe(true)
    expect(read(store).testRuns.filter((t: Any) => t.projectId === project.id)).toEqual([])
    const ok = await record({ results: [{ tc: 'TC-001', status: 'pass' }], total: 1, actingRole: 'tester' })
    expect(ok.structured.data).toMatchObject({ total: 1, passed: 1, effects: { verifiedSwrs: ['SWR-001'] } })
    const state = read(store)
    expect(state.reqs.find((r: Any) => r.id === 'SWR-001' && r.projectId === project.id).status).toBe(
      'VERIFIED',
    )
    expect(state.activity.at(-1)).toMatchObject({
      actor: '研发协调员 · 验证工程师',
      entity: { kind: 'testRun' },
    })
    const old = await record({ total: 18, passed: 17, failed: 1 })
    expect(old.structured.data).toMatchObject({ total: 18, failed: 1 })
    expect(old.structured.data.results).toBeUndefined()
  })

  it('registers code, test and analysis files through the tool and previews them as text', async () => {
    const store = memoryStore()
    const project = (
      await tool('devboard_project_create').execute({ name: '车门' }, { store, signal } as Any)
    ).structured.data
    const cr = (
      await tool('devboard_change_upsert').execute({ projectId: project.id, title: '变更', reason: '原因' }, {
        store,
        signal,
      } as Any)
    ).structured.data
    const dir = project.workspaceDir
    const files = new Map([
      [`${dir}/src/app.js`, 'export const app = "<b>x</b>"'],
      [`${dir}/test/app.test.js`, 'test("x", () => {})'],
      [`${dir}/analysis/${cr.id}/${cr.id}-electrical.md`, '# 电气影响'],
    ])
    const fs = {
      read: async (path: string) => {
        const text = files.get(path)
        if (text === undefined) throw new Error('ENOENT')
        return new TextEncoder().encode(text)
      },
    }
    const ctx = { store, signal, fs } as Any
    const record = (input: Any) =>
      tool('devboard_artifact_record').execute(
        { projectId: project.id, stage: 'IMPLEMENTATION', ...input },
        ctx,
      )
    const kinds = JSON.parse(
      JSON.stringify(tool('devboard_artifact_record').parameters),
    ).properties.kind.anyOf.map((k: Any) => k.const)
    expect(kinds).toEqual(expect.arrayContaining(['CODE', 'TEST', 'ANALYSIS']))
    const code = await record({ kind: 'CODE', suffix: 'app', path: 'src/app.js', actingRole: 'developer' })
    const test = await record({ kind: 'TEST', suffix: 'app', path: 'test/app.test.js' })
    const analysis = await record({
      kind: 'ANALYSIS',
      path: `analysis/${cr.id}/${cr.id}-electrical.md`,
      actingRole: 'electrical',
    })
    for (const out of [code, test, analysis]) expect(out.isError).toBeFalsy()
    expect(
      await service('devboard.artifact').handler({ artifactId: code.structured.data.id }, { store }),
    ).toMatchObject({
      format: 'text',
      markdown: 'export const app = "<b>x</b>"',
    })
    expect(
      await service('devboard.artifact').handler({ artifactId: analysis.structured.data.id }, { store }),
    ).toMatchObject({
      format: 'markdown',
    })
    // other kinds under analysis/, other projects' directories and missing files are refused
    for (const input of [
      { kind: 'CODE', path: `analysis/${cr.id}/${cr.id}-electrical.md` },
      { kind: 'ANALYSIS', path: 'devboard-projects/PRJ-2025-042/analysis/CR-2026-019/a.md' },
      { kind: 'ANALYSIS', path: 'analysis/CR-404/a.md' },
      { kind: 'TEST', path: 'test/missing.test.js' },
    ])
      expect((await record(input)).isError, JSON.stringify(input)).toBe(true)
    expect(read(store).activity.at(-1)).toMatchObject({
      actor: '研发协调员 · 电气设计师',
      entity: { kind: 'artifact' },
    })
  })

  it('closes the loop board → composer → coordinator → board with a scripted coordinator', async () => {
    // The platform cannot be driven here, so the coordinator's turns are scripted: each turn calls the tools
    // exactly as the playbook says, and the page's side is the real query and effect services.
    const store = memoryStore()
    const files = new Map<string, string>()
    const fs = {
      read: async (path: string) => {
        const text = files.get(path)
        if (text === undefined) throw new Error('ENOENT')
        return new TextEncoder().encode(text)
      },
    }
    const ctx = { store, signal, fs } as Any
    const turn = async (name: string, input: Any) => {
      const out = await tool(name).execute(input, ctx)
      expect(out.isError, `${name} ${out.content?.[0]?.text}`).toBeFalsy()
      return out.structured.data
    }
    const page = () => service('devboard.snapshot').handler({}, { store })

    // turn 1 (the new-project action): create, write and record the plan, submit CDCP, stop
    const project = await turn('devboard_project_create', {
      name: '社区图书借阅登记台',
      description: '社区图书馆的借还登记网页，面向管理员',
    })
    files.set(`${project.workspaceDir}/docs/PROJECT-PLAN.md`, '# 项目计划')
    await turn('devboard_artifact_record', {
      projectId: project.id,
      stage: 'INITIATION',
      kind: 'PLAN',
      path: 'docs/PROJECT-PLAN.md',
      actingRole: 'requirements',
    })
    const submitted = await turn('devboard_gate_submit', { projectId: project.id, stage: 'INITIATION' })
    expect((await page()).handbacks).toEqual([])
    // the turn ends with the steps a person takes on the board, computed from the gate
    expect(submitted.humanNext).toMatchObject({
      page: '对话面板',
      steps: [{ role: 'IPMT', action: '以「IPMT」批准' }],
      object: { type: 'gate', id: submitted.gate.id },
    })
    expect(submitted.humanNext.text).toContain('下方面板以「IPMT」批准')
    expect(submitted.humanNext.text).not.toMatch(/演示角色|我的待办|到看板|继续推进/)
    expect(submitted.humanNext.text).not.toContain('车门')
    // the snapshot the page reads carries the same wait, so the panel renders it instead of re-deriving it
    expect((await page()).waits).toContainEqual(expect.objectContaining({ type: 'gate', id: submitted.gate.id, roles: ['IPMT'] }))

    // the person approves CDCP on the board
    const gateId = submitted.gate.id
    const decided = await service('devboard.gate').handler(
      { gateId, decision: 'APPROVED', by: 'IPMT 周明远', comment: '同意立项' },
      ctx,
    )
    expect(decided).toMatchObject({ ok: true })

    // the board shows the hand-back card; its button opens the composer with the gate attached
    const [card] = (await page()).handbacks
    expect(card).toMatchObject({
      text: 'CDCP 已批准 → 交回研发协调员继续',
      action: 'continue',
      object: { type: 'gate', id: gateId },
    })
    expect(workOf('continueGate', { id: gateId, decision: 'APPROVED' })).toMatchObject({
      action: card.action,
      object: card.object,
    })
    const action = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ).agnes.application.workbench.actions.find((a: Any) => a.id === card.action)
    expect(action.prompt['zh-CN']).toContain('devboard_handoff')
    expect(action.prompt['zh-CN']).toContain('humanNext.text')
    expect(action.prompt['zh-CN']).not.toContain('DEVELOPMENT')

    // turn 2: the coordinator reads the hand-off first
    const handoff = await turn('devboard_handoff', card.object)
    expect(handoff).toMatchObject({
      type: 'gate',
      gate: { code: 'CDCP', decision: 'APPROVED', comment: '同意立项' },
      project: { id: project.id },
    })
    expect(handoff.nextStep).toMatchObject({
      stage: 'REQUIREMENTS',
      state: 'NOT_STARTED',
      nextGate: { code: 'TR1' },
    })
    expect(handoff.nextStep.deliverables.join(' ')).toContain('docs/SRS.md')
    expect(handoff.project.description).toBe('社区图书馆的借还登记网页，面向管理员')
    expect(handoff.nextStep.deliverables[0]).toContain('docs/PROJECT-PLAN.md')
    expect((await turn('devboard_handoff', { type: 'project', id: project.id })).project.description).toBe(
      '社区图书馆的借还登记网页，面向管理员',
    )
    // the continue draft carries this project's real hand-off, not a static prompt
    expect(handoff.draft).toContain('继续推进「社区图书借阅登记台」')
    expect(handoff.draft).toContain('项目需求：社区图书馆的借还登记网页，面向管理员')
    expect(handoff.draft).toContain('CDCP')
    expect(handoff.draft).toContain('同意立项')
    expect(handoff.draft).toContain(handoff.nextStep.action)
    expect(handoff.draft).toContain('docs/SRS.md')
    expect(handoff.draft).toContain('完成后提交 TR1')
    expect(handoff.draft).toContain('审批角色：')
    expect(handoff.draft).toContain(`devboard_handoff({type:"gate", id:"${gateId}"})`)
    expect(handoff.draft).toContain('humanNext.text')
    expect(handoff.draft.length).toBeLessThanOrEqual(2500)
    // the summary the page shows before sending is the same one
    expect((await service('devboard.handoff').handler(card.object, { store })).summary).toBe(handoff.summary)

    // then the coordinator does what the hand-off says, as the roles it delegated to
    await turn('devboard_stage_update', {
      projectId: project.id,
      stage: 'REQUIREMENTS',
      actingRole: 'requirements',
    })
    await turn('devboard_req_upsert', {
      projectId: project.id,
      actingRole: 'requirements',
      items: [
        { id: 'CUS-001', title: '客户', text: '客户要求' },
        { id: 'SYS-001', title: '系统', text: '系统', parent: ['CUS-001'] },
        { id: 'SWR-001', title: '软需', text: '软需', parent: ['SYS-001'] },
        { id: 'TC-001', title: '用例', text: '用例', parent: ['SWR-001'] },
      ],
    })
    files.set(`${project.workspaceDir}/docs/SRS.md`, '# SRS')
    await turn('devboard_artifact_record', {
      projectId: project.id,
      stage: 'REQUIREMENTS',
      kind: 'SRS',
      path: 'docs/SRS.md',
      actingRole: 'requirements',
    })
    await turn('devboard_test_record', {
      projectId: project.id,
      level: 'UNIT',
      actingRole: 'tester',
      results: [{ tc: 'TC-001', status: 'pass' }],
    })

    // the board now shows the work, by role, and the card is gone
    const after = await page()
    expect(after.handbacks).toEqual([])
    const mine = after.activity.filter((a: Any) => a.projectId === project.id)
    expect(mine.map((a: Any) => a.actor)).toEqual([
      '研发协调员 · 验证工程师',
      '研发协调员 · 系统设计师（需求）',
      '研发协调员 · 系统设计师（需求）',
      '研发协调员 · 系统设计师（需求）',
      '研发协调员',
      '研发协调员 · 系统设计师（需求）',
      '研发协调员',
    ])
    expect(mine[0]).toMatchObject({
      summary: expect.stringContaining('登记测试运行'),
      entity: { kind: 'testRun' },
    })
    // the whole-board read counts requirements; the project's own snapshot carries them
    const mineReqs = await service('devboard.snapshot').handler({ projectId: project.id }, { store })
    expect(mineReqs.reqs.find((r: Any) => r.id === 'SWR-001').status).toBe(
      'VERIFIED',
    )
    expect(after.stages.find((st: Any) => st.id === `${project.id}/REQUIREMENTS`)).toMatchObject({
      state: 'IN_PROGRESS',
    })
    expect(after.artifacts.filter((a: Any) => a.projectId === project.id).map((a: Any) => a.kind)).toEqual([
      'PLAN',
      'SRS',
    ])
  })

  it('dismisses a hand-back card through the service and opens only a card that names its work', async () => {
    const store = memoryStore()
    const ctx = { store, signal } as Any
    const req = (
      await service('devboard.create').handler({ kind: 'requirement', by: '产品经理', title: '需求' }, ctx)
    ).result
    const hi = (
      await service('devboard.create').handler(
        {
          kind: 'intervention',
          by: '研发协调员',
          type: 'REQUIREMENT_APPROVAL',
          entity: { kind: 'requirement', id: req.id },
          ask: '怎么办',
        },
        ctx,
      )
    ).result
    for (const to of ['CLAIMED', 'RESOLVED'])
      await service('devboard.transition').handler(
        { kind: 'intervention', id: hi.id, to, by: '项目经理', note: '方案二' },
        ctx,
      )
    const [card] = (await service('devboard.snapshot').handler({}, { store })).handbacks
    expect(handbackWork(card)).toMatchObject({
      action: 'interventions',
      object: { type: 'intervention', id: hi.id },
    })
    for (const bad of [
      undefined,
      {},
      { action: 'continue' },
      { action: 'continue', object: { type: 'gate' } },
    ])
      expect(handbackWork(bad as Any)).toBeUndefined()
    expect(await service('devboard.handback').handler({ id: 'HB-404', by: '项目经理' }, ctx)).toMatchObject({
      ok: false,
    })
    expect(await service('devboard.handback').handler({ id: card.id, by: '项目经理' }, ctx)).toMatchObject({
      ok: true,
    })
    expect((await service('devboard.snapshot').handler({}, { store })).handbacks).toEqual([])
  })

  it('stores the assistant session in its own key, projects it into the snapshot and survives a reset', async () => {
    const store = memoryStore()
    const ctx = { store, signal } as Any
    const assistant = (input: Any) => service('devboard.assistant').handler(input, ctx)
    const snap = async () => (await service('devboard.snapshot').handler({}, { store })).assistant

    expect(await snap()).toBeNull()
    // a first record needs both the session and its directory; nothing is written on refusal
    expect(await assistant({ sessionId: 's1' })).toMatchObject({ ok: false })
    expect(await assistant({})).toMatchObject({ ok: false })
    expect(store.rows.has('devboard/assistant')).toBe(false)

    const first = (await assistant({ sessionId: 's1', cwd: '/w' })).assistant
    expect(first).toMatchObject({ sessionId: 's1', cwd: '/w', sentHandbacks: [] })
    expect(Date.parse(first.createdAt)).not.toBeNaN()
    expect(await snap()).toEqual(first)

    // patching keeps the session; a new session id starts a fresh record
    // sent ids merge on the server so two tabs cannot overwrite each other: add is deduped, remove is exact
    expect(await assistant({ addSentHandback: 'HB-1' })).toMatchObject({ added: true, assistant: { sentHandbacks: ['HB-1'] } })
    expect(await assistant({ addSentHandback: 'HB-1' })).toMatchObject({ added: false, assistant: { sentHandbacks: ['HB-1'] } })
    await assistant({ addSentHandback: 'HB-2' })
    expect((await assistant({ removeSentHandback: 'HB-1' })).assistant).toEqual({ ...first, sentHandbacks: ['HB-2'] })
    expect((await assistant({ removeSentHandback: 'HB-9' })).assistant.sentHandbacks).toEqual(['HB-2'])
    await assistant({ removeSentHandback: 'HB-2' })
    for (let i = 0; i < 205; i++) await assistant({ addSentHandback: `HB-${i}` })
    const capped = (await assistant({ addSentHandback: 'HB-last' })).assistant.sentHandbacks
    expect(capped).toHaveLength(200)
    expect(capped.at(-1)).toBe('HB-last')
    await assistant({ sessionId: 's1-reset', cwd: '/w' })
    expect((await assistant({ sessionId: 's1' })).assistant.sentHandbacks).toEqual([])
    // a new conversation may carry the sent ids over: those cards must not go to the new session again
    await assistant({ addSentHandback: 'HB-k' })
    expect((await assistant({ sessionId: 's1-keep', keepSentHandbacks: true })).assistant.sentHandbacks).toContain('HB-k')
    expect((await assistant({ sessionId: 's1-drop' })).assistant.sentHandbacks).toEqual([])
    expect((await assistant({ sessionId: 's2' })).assistant).toMatchObject({
      sessionId: 's2',
      cwd: '/w',
      sentHandbacks: [],
    })

    await service('devboard.reset').handler({}, ctx)
    expect((await snap()).sessionId).toBe('s2')
  })

  it('validates the assistant command input strictly', () => {
    const schema = service('devboard.assistant').inputSchema
    expect(schema.additionalProperties).toBe(false)
    expect(Object.keys(schema.properties).sort()).toEqual(['addSentHandback', 'cwd', 'keepSentHandbacks', 'removeSentHandback', 'sessionId'])
  })

  it('registers every tool in the capability names and the coordinator profile, plus the new pages and actions', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const names = tools.map((t) => t.name)
    expect(pkg.version).toMatch(/^3\.\d+\.\d+$/)
    expect(names).toContain('devboard_approval_submit')
    // the page may call only the services its client descriptor lists
    const client = JSON.parse(readFileSync(new URL('../client/agnes.client.json', import.meta.url), 'utf8'))
    expect([...client.client.services].sort()).toEqual(services.map((s) => s.name).sort())
    expect(names).toEqual(
      expect.arrayContaining(['devboard_trial_upsert', 'devboard_problem_upsert', 'devboard_fault_list']),
    )
    expect(pkg.agnes.plugins[0].capabilities.tools.names).toEqual(names)
    const profile = pkg.agnes.bundles.coordinator.profile.tools
    for (const name of names) expect(profile, name).toContain(name)
    const launch = pkg.agnes.bundles.coordinator.launch
    expect(launch.pages).toEqual(expect.arrayContaining(['trials', 'service']))
    expect(pkg.agnes.application.presentation.navigation.entries).toEqual(
      expect.arrayContaining(['@agnes-showcase/devboard#trials', '@agnes-showcase/devboard#service']),
    )
    // sidebar order: 小川, 小川演示, 值守中心, 值守中心 演示, then the rest; manifest and client descriptor agree
    const entries = pkg.agnes.application.presentation.navigation.entries
    expect(entries.slice(0, 4)).toEqual([
      '@agnes-showcase/devboard#assistant',
      '@agnes-showcase/devboard#assistant-demo',
      '@agnes-showcase/devboard#watch',
      '@agnes-showcase/devboard#watch-demo',
    ])
    const home = client.client.homeEntries.map((e: Any) => e.id)
    expect(home.slice(0, 4)).toEqual(['assistant', 'assistant-demo', 'watch', 'watch-demo'])
    expect(client.client.homeEntries.slice(0, 4).map((e: Any) => e.navigation.titles['zh-CN'])).toEqual([
      '小川',
      '小川演示',
      '值守中心',
      '值守中心 演示',
    ])
    // the descriptor lists exactly the manifest's entries, in the same order
    expect(entries).toEqual(home.map((id: string) => `@agnes-showcase/devboard#${id}`))
    const orders = client.client.homeEntries.map((e: Any) => e.navigation.order)
    expect(orders).toEqual([...orders].sort((a: number, b: number) => a - b))
    expect(new Set(orders).size).toBe(orders.length)
    const titles = pkg.agnes.application.workbench.actions.map((a: Any) => a.title['zh-CN'])
    expect(titles).toEqual(expect.arrayContaining(['分析 PHM 预警并起草 8D', '型式试验不合格 → 起草变更']))
    expect(pkg.files).toContain('profiles.mjs')
  })

  it('adds exactly one capability, the project-directory write, and the fast-forward and hand-off tool names', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const caps = pkg.agnes.plugins[0].capabilities
    expect(caps.filesystem).toEqual({ read: ['devboard-projects/**'], write: ['devboard-projects/**'] })
    expect(Object.keys(caps).sort()).toEqual(['filesystem', 'store', 'tools', 'ui'])
    expect(caps.tools.names.slice(-5, -3)).toEqual(['devboard_fastforward', 'devboard_handoff'])
    expect(caps.tools.names.slice(-3)).toEqual(['devboard_watch_decide', 'devboard_watch_ticket', 'devboard_watch_reply'])
    const policy = pkg.agnes.bundles.coordinator.profile.toolPolicy.allow
    expect(policy).toContain('devboard_fastforward')
    expect(pkg.files).toEqual(expect.arrayContaining(['fastforward.mjs', 'assets']))
    const action = pkg.agnes.application.workbench.actions.find((a: Any) => a.id === 'fast-forward')
    expect(action.agent).toBe('@agnes-showcase/devboard#coordinator')
    expect(action.prompt['zh-CN']).toContain('devboard_fastforward')
    // One tool call needs no playbook: reading it would cost a model round trip on the quick path.
    for (const lang of ['en', 'zh-CN']) expect(action.prompt[lang]).not.toContain('skill_read')
    const runApp = pkg.agnes.application.workbench.actions.find((a: Any) => a.id === 'run-app')
    expect(runApp.prompt['zh-CN']).toContain('devboard_app_register')
  })

  it('adds traceFrom to the change tool without a new tool name or capability', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const caps = pkg.agnes.plugins[0].capabilities
    expect(caps.tools.names).toHaveLength(27)
    expect(Object.keys(caps).sort()).toEqual(['filesystem', 'store', 'tools', 'ui'])
    const schema = JSON.parse(JSON.stringify(tool('devboard_change_upsert').parameters))
    expect(schema.properties.traceFrom).toMatchObject({ type: 'boolean' })
    expect(schema.required ?? []).not.toContain('traceFrom')
    const action = pkg.agnes.application.workbench.actions.find((a: Any) => a.id === 'customer-change')
    expect(action.agent).toBe('@agnes-showcase/devboard#coordinator')
    for (const lang of ['en', 'zh-CN']) {
      expect(action.prompt[lang]).toContain('traceFrom')
      expect(action.prompt[lang]).toContain('CUSTOMER')
      expect(action.prompt[lang]).toContain('devboard_approval_submit')
    }
  })

  it('takes only the gate enum as input and writes only below the new project directory', async () => {
    const def = tool('devboard_fastforward')
    const schema = JSON.parse(JSON.stringify(def.parameters))
    expect(schema).toMatchObject({ type: 'object', additionalProperties: false, required: ['gate'] })
    expect(Object.keys(schema.properties)).toEqual(['gate'])
    expect(schema.properties.gate.anyOf.map((v: Any) => v.const)).toEqual(GATES)
    const store = memoryStore()
    const writes: string[] = []
    const fs = {
      stat: async () => {
        throw new Error('ENOENT')
      },
      write: async (path: string, data: string) => {
        expect(data.length).toBeGreaterThan(0)
        writes.push(path)
      },
    }
    const ctx = { store, signal, fs } as Any
    for (const gate of ['../../etc', 'TR2', '', 7])
      expect((await def.execute({ gate }, ctx)).isError, String(gate)).toBe(true)
    expect(writes).toEqual([])
    const done = await def.execute({ gate: 'TR5' }, ctx)
    expect(done.isError).toBeFalsy()
    const { projectId, workspaceDir, gate, decision } = done.structured.data
    // the feed line names the new project, not its gate
    expect(read(store).activity.at(-1)).toMatchObject({
      tool: 'devboard_fastforward',
      entity: { kind: 'project', id: projectId },
      projectId,
      summary: `快进演示项目 ${projectId}`,
    })
    expect({ gate, decision, workspaceDir }).toEqual({
      gate: 'TR5',
      decision: 'PENDING',
      workspaceDir: `devboard-projects/${projectId}`,
    })
    expect(writes).toHaveLength(FILES.filter(([from]) => from <= 3).length)
    for (const path of writes)
      expect(path.startsWith(`${workspaceDir}/`) && !/\.\./.test(path), path).toBe(true)
    // a second call is another project in another directory
    const again = await def.execute({ gate: 'TR5' }, ctx)
    expect(again.structured.data.projectId).not.toBe(projectId)
    expect(writes.filter((p) => p.startsWith(`${workspaceDir}/`))).toHaveLength(
      FILES.filter(([from]) => from <= 3).length,
    )
  })

  it('ships a template directory that matches the manifest and the registered documents', async () => {
    const root = fileURLToPath(new URL('../assets/fastforward/', import.meta.url))
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)).map((f) => `${e.name}/${f}`) : [e.name],
      )
    expect(walk(root).sort()).toEqual(FILES.map(([, rel]) => rel).sort())
    const store = memoryStore()
    const ctx = {
      store,
      signal,
      fs: {
        stat: async () => {
          throw new Error('ENOENT')
        },
        write: async () => undefined,
      },
    } as Any
    await tool('devboard_fastforward').execute({ gate: 'DONE' }, ctx)
    const reqs = read(store).reqs.filter((r: Any) => r.projectId === read(store).projects.at(-1).id)
    const text = (rel: string) => readFileSync(join(root, rel), 'utf8')
    for (const r of reqs) {
      expect(text('docs/RTM.md'), r.id).toContain(r.id)
      if (r.level !== 'TC' && r.level !== 'DES') expect(text('docs/SRS.md'), r.id).toContain(r.id)
      if (r.level === 'DES') expect(text('docs/SAD.md'), r.id).toContain(r.id)
    }
    expect(reqs.filter((r: Any) => r.level === 'TC')).toHaveLength(8)
  })

  it('is accepted by the package manager inspection', async () => {
    const root = mkdtempSync(join(tmpdir(), 'devboard-inspect-'))
    try {
      const profile = join(root, 'profiles', 'local-dev')
      mkdirSync(profile, { recursive: true })
      cpSync(fileURLToPath(new URL('..', import.meta.url)), join(root, 'devboard'), {
        recursive: true,
        filter: (src) => !/\/(node_modules|test)(\/|$)/.test(src),
      })
      writeLock(profile, {
        ...emptyLock('local-dev', '0.1.0'),
        resolvedProfileHash: `sha256-${'0'.repeat(64)}`,
        seams: Object.fromEntries(
          ['approval', 'checkpoint', 'billing', 'verifier', 'repair', 'artifacts', 'principals'].map((n) => [
            n,
            { provider: 'local' },
          ]),
        ),
        policySnapshot: {
          capabilityCeiling: ['ui', 'store', 'tools', 'services', 'filesystem'],
          workspacePackages: 'require-project-trust',
        },
      })
      const manager = createPackageManager({
        dataDir: root,
        cwd: root,
        agnesVersion: '0.1.0',
        now: () => '2026-10-21T00:00:00Z',
        references: async () => [],
      })
      const preview = await manager.inspect(profile, parseSource('file:./devboard'))
      const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
      expect(preview).toMatchObject({ id: '@agnes-showcase/devboard', version })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each(['README.md', 'README.zh-CN.md', 'skills/devboard-playbook.md', 'workbench prompts'])(
    'keeps role references in %s delegable',
    (source) => {
      const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
      const text =
        source === 'workbench prompts'
          ? JSON.stringify(pkg.agnes.application.workbench.actions.map((action: Any) => action.prompt))
          : readFileSync(new URL(`../${source}`, import.meta.url), 'utf8')
      const roles = Object.keys(pkg.agnes.bundles).filter((id) => id !== 'coordinator')
      const references = new Set([
        ...Array.from(text.matchAll(/@agnes-showcase\/devboard#[a-z][a-z0-9-]*/g), (match) => match[0]),
        ...roles
          .filter((id) => new RegExp(`(?<![a-zA-Z0-9_-])${id}(?![a-zA-Z0-9_-])`).test(text))
          .map((id) => `${pkg.name}#${id}`),
      ])
      expect(references.size).toBeGreaterThan(0)
      expect([...references].filter((ref) => !pkg.agnes.application.delegableAgents.includes(ref))).toEqual(
        [],
      )
    },
  )

  it('resolves declared roles with narrow tools and keeps approved commands in the coordinator', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const { bundles, application } = pkg.agnes
    const contracts = parsePackageBundleContract(pkg.name, bundles)
    const coordinator = bundles.coordinator
    const policy = coordinator.presets.devboard.approval.command_policy
    expect(policy.length).toBeGreaterThan(0)
    expect(policy.every((r: { tool: string }) => r.tool === 'edit|write')).toBe(true)
    expect(coordinator.presets.devboard.subagent.isolation).toBe('shared')
    expect(coordinator.profile.toolPolicy.allow).toEqual(coordinator.profile.tools)
    expect(coordinator.presets.devboard.sandbox).toEqual({
      level: 'L1',
      on_unavailable: 'deny',
      network_allow: [],
      loopback_serve: true,
    })
    expect(coordinator.profile.tools).toEqual(
      expect.arrayContaining([
        ...tools.map((tool) => tool.name),
        'tool_search',
        'tool_describe',
        'subagent_spawn',
        'subagent_collect',
        'subagent_send_message',
        'subagent_list',
        'shell',
        'job_output',
        'job_list',
        'job_kill',
      ]),
    )
    const READ_ONLY = ['reviewer', 'quality', 'config']
    const titles: Record<string, string> = {
      requirements: '系统设计师（需求）',
      architect: '软件设计师（架构）',
      developer: '软件设计师（开发）',
      reviewer: '代码评审员',
      tester: '验证工程师',
      mechanical: '机械设计师',
      electrical: '电气设计师',
      diagnostics: '诊断工程师',
      rams: 'RAMS 工程师',
      quality: '质量工程师',
      config: '配置管理员',
    }
    expect(Object.keys(bundles).filter((id) => id !== 'coordinator')).toEqual(Object.keys(titles))
    expect(application.agents).toEqual(
      ['coordinator', ...Object.keys(titles)].map((role) => `${pkg.name}#${role}`),
    )
    expect(application.delegableAgents).toEqual(Object.keys(titles).map((role) => `${pkg.name}#${role}`))
    // Opt-in: roles' core tool gates follow the coordinator's Full access; business signing stays refused.
    expect(application.delegatedFullAccess).toBe(true)
    for (const ref of application.agents) {
      expect(contracts[ref]?.document.launch?.preset).toBe('devboard')
      const role = bundles[ref.split('#')[1]]
      expect(role.presets.devboard.model.system_prompt.personaPrefix).toContain('全过程')
    }
    expect(bundles.coordinator.presets.devboard.model.system_prompt.personaPrefix).toMatch(
      /新项目需求时先用 devboard_project_create 新建项目，不要去推进看板上已有的项目/,
    )
    // rework goes to the original role child by continuation: a new spawn would inherit the turn's taint
    expect(bundles.coordinator.presets.devboard.model.system_prompt.personaPrefix).toContain('subagent_send_message')
    expect(readFileSync(new URL('../skills/devboard-playbook.md', import.meta.url), 'utf8')).toContain('subagent_send_message')
    // a technical gate's review meeting seats read-only reviewers even in a tainted turn, and no person signs the gate before it
    const playbookText = readFileSync(new URL('../skills/devboard-playbook.md', import.meta.url), 'utf8')
    for (const text of [playbookText, bundles.coordinator.presets.devboard.model.system_prompt.personaPrefix]) {
      expect(text).toContain('只读评审席位')
      expect(text).toContain('不请人先签')
      // a rejected review meeting wraps the turn; a missing continuation child is replaced by a fresh role in the hand-back turn
      expect(text).toContain('评审会驳回后')
      expect(text).toContain('E_CHILD_NOT_FOUND')
      expect(text).toContain('不重试同一句柄')
    }
    for (const ref of application.agents.filter((r: string) => !r.endsWith('#coordinator'))) {
      expect(application.agents).toContain(ref)
      const role = bundles[ref.split('#')[1]]
      expect(role.profile.tools).toEqual(role.profile.toolPolicy.allow)
      expect(role.profile.skills).toEqual([])
      const id = ref.split('#')[1]
      const readOnly = READ_ONLY.includes(id)
      expect(role.launch.title['zh-CN']).toBe(titles[id])
      expect(role.presets.devboard.model.system_prompt.personaPrefix).toContain(`宁川装备的${titles[id]}`)
      expect(role.profile.toolPolicy.readOnly).toBe(readOnly ? true : undefined)
      expect(role.profile.tools.every((name: string) => coordinator.profile.tools.includes(name))).toBe(true)
      // the doc-writing roles also hold the one card-free board document tool, and no other devboard_* tool or shell
      const writesDocs = ['requirements', 'architect', 'tester', 'mechanical', 'electrical', 'diagnostics', 'rams'].includes(id)
      expect(role.profile.tools).toEqual(
        readOnly
          ? ['read', 'ls', 'find', 'grep']
          : ['read', 'ls', 'find', 'grep', 'write', 'edit', ...(writesDocs ? ['devboard_doc_write'] : [])],
      )
      expect(role.presets.devboard.model.system_prompt.personaPrefix.includes('devboard_doc_write'), id).toBe(writesDocs)
    }
  })

  /** A board of `count` extra projects, each a full copy of the busiest seed project plus 40 requirements. */
  function bigBoard(count: number, reqsEach = 40) {
    const store = memoryStore()
    const ids: string[] = []
    update(store, (s: Any) => {
      const proto = s.projects.find((p: Any) => p.id === 'PRJ-2025-042')
      const mine = (x: Any) => x.projectId === proto.id || x.stageId?.startsWith(`${proto.id}/`)
      const lists = { stages: 99, gates: 99, artifacts: 6, defects: 5, tasks: 99, requirements: 99 }
      for (let i = 0; i < count; i++) {
        const id = `PRJ-2030-${String(i).padStart(3, '0')}`
        ids.push(id)
        const swap = (x: Any) => JSON.parse(JSON.stringify(x).replaceAll(proto.id, id))
        s.projects.push({ ...swap(proto), risks: [] })
        for (const [name, max] of Object.entries(lists)) s[name].push(...s[name].filter(mine).slice(0, max).map(swap))
        for (let n = 0; n < reqsEach; n++)
          s.reqs.push({
            id: `SYS-${String(n).padStart(3, '0')}`,
            projectId: id,
            level: ['CUS', 'SYS', 'SWR', 'DES', 'TC'][n % 5],
            title: `需求 ${n}`,
            text: '门控器须在规定时间内完成开关门并上报状态。'.repeat(4),
            parent: [],
            verifiedBy: [],
            status: 'APPROVED',
          })
      }
    })
    return { store, ids }
  }

  it('keeps the overview snapshot inside the plugin frame on a large board and the project snapshot whole', async () => {
    const BUDGET = 768 * 1024
    const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length
    const { store, ids } = bigBoard(60)
    const out = await service('devboard.snapshot').handler({}, { store })
    // the guard stays at 768 KiB; a board of 64 projects reads from the overview well under 80% of it
    expect(bytes(out)).toBeLessThan(0.8 * BUDGET)
    expect(out.truncated).toBeFalsy()
    // the role home still counts requirements of every project by level, status and project
    const mine = out.reqs.filter((r: Any) => r.projectId === ids[7])
    expect(mine.reduce((n: number, r: Any) => n + r.n, 0)).toBe(40)
    expect(mine[0]).toMatchObject({ level: 'CUS', status: 'APPROVED', n: 8 })
    expect(out.projects.length).toBeGreaterThanOrEqual(60)
    const one = await service('devboard.snapshot').handler({ projectId: ids[7] }, { store })
    expect(one.reqs).toHaveLength(40)
    expect(one.reqs[0].text).toContain('门控器')
    // the project snapshot carries that project's full details
    expect(one.stages).toHaveLength(6)
    expect(one.stages[0].history.length).toBeGreaterThan(0)
    expect(one.gates.length).toBeGreaterThan(0)
    expect(one.gates.some((g: Any) => g.comment)).toBe(true)
    expect(one.tasks).toHaveLength(12)
    expect(one.tasks[0].history.length).toBeGreaterThan(0)
    expect(one.requirements).toHaveLength(3)
    expect(one.artifacts).toHaveLength(6)
    expect(one.artifacts[0].source).toBeDefined()
    expect(one.defects).toHaveLength(5)
    expect(one.defects[0].history.length).toBeGreaterThan(0)
    // the overview keeps what the pages read: stage and gate state, open defects, counted tasks
    expect(out.stages.filter((x: Any) => x.projectId === ids[7])).toHaveLength(6)
    expect(out.stages.some((x: Any) => 'history' in x)).toBe(false)
    expect(out.gates.filter((g: Any) => g.stageId.startsWith(`${ids[7]}/`))).toHaveLength(one.gates.length)
    expect(out.tasks.every((t: Any) => t.n > 0 && !('title' in t))).toBe(true)
    expect(out.defects.every((d: Any) => d.state !== 'CLOSED' && !('history' in d))).toBe(true)
    expect(out.requirements).toEqual([])

    // past the budget the read trims the detail it can spare and says so, instead of failing
    update(store, (s: Any) => {
      s.activity = Array.from({ length: 4000 }, (_, i) => ({
        at: new Date(i * 1000).toISOString(),
        by: '研发协调员',
        projectId: ids[0],
        summary: '推进任务'.repeat(40),
      }))
    })
    const trimmed = await service('devboard.snapshot').handler({}, { store })
    expect(bytes(trimmed)).toBeLessThan(BUDGET)
    expect(trimmed.truncated).toBe(true)
    expect(trimmed.truncatedKeys).toContain('activity')
    expect(trimmed.projects).toHaveLength(out.projects.length)
  })

  it('grows the overview with the project count, not with what each project holds', async () => {
    const size = async (count: number, scale: number) => {
      const { store } = bigBoard(count)
      update(store, (s: Any) => {
        // more detail in every project: more tasks, requirement records, history
        for (const name of ['tasks', 'requirements'])
          s[name].push(
            ...Array.from({ length: scale - 1 }, (_, i) =>
              s[name].map((x: Any) => ({ ...x, id: `${x.id}-copy${i}`, history: [...x.history, ...x.history] })),
            ).flat(),
          )
        for (const st of s.stages) st.history = Array(scale).fill(st.history).flat()
      })
      return new TextEncoder().encode(JSON.stringify(await service('devboard.snapshot').handler({}, { store }))).length
    }
    const base = await size(30, 1)
    const detailed = await size(30, 3)
    const wider = await size(60, 1)
    // three times the tasks, requirements and history per project barely moves it; twice the projects clearly does
    expect(detailed).toBeLessThan(base * 1.05)
    expect(wider).toBeGreaterThan(base * 1.5)
  })

  it('answers the role home from the overview exactly as from the full snapshot', async () => {
    const { store } = bigBoard(3)
    const state = read(store)
    const now = Date.now()
    const full: Any = { ...snapshot(state, now), waits: [] }
    const lean = await service('devboard.snapshot').handler({}, { store })
    for (const role of ROLES) {
      const a = lensSummary(role, full)
      const b = lensSummary(role, lean)
      expect(b.counts, role).toEqual(a.counts)
      expect(b.pending, role).toBe(a.pending)
      expect(b.urgent.map((u: Any) => u.id), role).toEqual(a.urgent.map((u: Any) => u.id))
    }
  })
})

describe('gate review tools', () => {
  const files = new Map<string, string>()
  const fs = { read: async (path: string) => new TextEncoder().encode(files.get(path) ?? '') }
  const panel = (gateId: string, extra: Any = {}) => ({
    gateId,
    speeches: [
      { role: 'reviewer', verdict: 'pass', remark: '接口清晰' },
      { role: 'quality', verdict: 'pass', remark: '可追溯' },
    ],
    verdict: 'pass',
    points: ['需求完整'],
    ...extra,
  })
  /** A live project whose CDCP a person approved and whose TR1 is now pending. */
  async function atTr1() {
    const store = memoryStore()
    const ctx = { store, signal, fs } as Any
    const run = async (name: string, input: Any) => tool(name).execute(input, ctx)
    const turn = async (name: string, input: Any) => {
      const out = await run(name, input)
      expect(out.isError, `${name} ${out.content?.[0]?.text}`).toBeFalsy()
      return out.structured.data
    }
    const project = await turn('devboard_project_create', { name: '评审会项目' })
    files.set(`${project.workspaceDir}/docs/PROJECT-PLAN.md`, '# 项目计划')
    await turn('devboard_artifact_record', { projectId: project.id, stage: 'INITIATION', kind: 'PLAN', path: 'docs/PROJECT-PLAN.md', actingRole: 'requirements' })
    const cdcp = (await turn('devboard_gate_submit', { projectId: project.id, stage: 'INITIATION' })).gate
    expect(await service('devboard.gate').handler({ gateId: cdcp.id, decision: 'APPROVED', by: 'IPMT 周明远' }, ctx)).toMatchObject({ ok: true })
    await turn('devboard_stage_update', { projectId: project.id, stage: 'REQUIREMENTS', to: 'IN_PROGRESS' })
    // the requirements stage has a registered deliverable, as a gate that can pass needs
    files.set(`${project.workspaceDir}/docs/SRS.md`, '# 软件需求')
    await turn('devboard_artifact_record', { projectId: project.id, stage: 'REQUIREMENTS', kind: 'SRS', path: 'docs/SRS.md', actingRole: 'requirements' })
    const tr1 = (await turn('devboard_gate_submit', { projectId: project.id, stage: 'REQUIREMENTS' })).gate
    return { store, run, turn, project, cdcp, tr1 }
  }

  it('registers both tools, the check read-only', () => {
    const names = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).agnes.plugins[0].capabilities.tools.names
    for (const name of ['devboard_gate_check', 'devboard_gate_review']) {
      expect(names).toContain(name)
      expect(tool(name)).toBeTruthy()
    }
    expect(tool('devboard_gate_check').meta.isReadOnly).toBe(true)
    expect(tool('devboard_gate_review').meta.isReadOnly).toBe(false)
  })

  it('tells the coordinator to convene the review meeting after submitting a TR gate, and a person only after it hands over', async () => {
    const store = memoryStore()
    const ctx = { store, signal, fs } as Any
    const submit = async (name: string, input: Any) => (await tool(name).execute(input, ctx)).structured.data
    const { tr1, turn } = await atTr1()
    // atTr1 ran on its own store: the TR1 submit result carries the step, never a request to sign
    const again = await turn('devboard_gate_submit', { projectId: tr1.stageId.split('/')[0], stage: 'REQUIREMENTS' })
    expect(again.nextStep).toMatch(/评审会.*subagent_spawn.*devboard_gate_review.*不要请人签署/)
    expect(again.humanNext).toBeUndefined()
    // a DCP gate (human) has no meeting step
    const p = await submit('devboard_project_create', { name: 'DCP 项目' })
    files.set(`${p.workspaceDir}/docs/PROJECT-PLAN.md`, '# 计划')
    await submit('devboard_artifact_record', { projectId: p.id, stage: 'INITIATION', kind: 'PLAN', path: 'docs/PROJECT-PLAN.md', actingRole: 'requirements' })
    const dcp = await submit('devboard_gate_submit', { projectId: p.id, stage: 'INITIATION' })
    expect(dcp.nextStep).toBeUndefined()
    expect(dcp.humanNext).toBeTruthy()
    // once handed to a person the same call carries no meeting step and points at the signer panel
    await turn('devboard_request_human', { type: 'REQUIREMENT_APPROVAL', entityKind: 'gate', entityId: tr1.id, ask: '请裁决' })
    const handed = await turn('devboard_gate_submit', { projectId: tr1.stageId.split('/')[0], stage: 'REQUIREMENTS' })
    expect(handed.nextStep).toBeUndefined()
    expect(handed.humanNext).toBeTruthy()
  })

  it('lists the checklist of a gate', async () => {
    const { turn, tr1 } = await atTr1()
    const out = await turn('devboard_gate_check', { gateId: tr1.id })
    expect(out).toMatchObject({ gateId: tr1.id, code: 'TR1' })
    expect(out.items.map((i: Any) => i.id)).toEqual(['deliverables', 'previous', 'findings'])
  })

  it('signs a passing panel as the agent, closing the system checks, and refuses a malformed one', async () => {
    const { store, run, turn, tr1 } = await atTr1()
    // a malformed panel is refused first
    const before2 = read(store)
    expect((await run('devboard_gate_review', panel(tr1.id, { points: [] }))).isError).toBe(true)
    expect(read(store).reviews).toEqual(before2.reviews)

    // the coverage check still holds, so the panel cannot waive it; once CUS→SWR is complete it closes it
    expect((await run('devboard_gate_review', panel(tr1.id, { actingRole: 'reviewer' }))).isError).toBe(true)
    expect(read(store).reviews).toEqual(before2.reviews)
    await turn('devboard_req_upsert', {
      projectId: tr1.stageId.split('/')[0],
      actingRole: 'requirements',
      items: [
        { id: 'CUS-001', title: 'c', text: 'c' },
        { id: 'SYS-001', title: 's', text: 's', parent: ['CUS-001'] },
        { id: 'SWR-001', title: 'w', text: 'w', parent: ['SYS-001'] },
      ],
    })
    const out = await turn('devboard_gate_review', panel(tr1.id, { actingRole: 'reviewer' }))
    expect(out.review).toMatchObject({ round: 1, verdict: 'pass' })
    const state = read(store)
    expect(state.reviews).toHaveLength(1)
    const gate = state.gates.find((g: Any) => g.id === tr1.id)
    expect(gate.decision).toBe('APPROVED')
    expect(gate.signatures[0].actor).toEqual({ kind: 'agent', agent: '@agnes-showcase/devboard#reviewer' })
    expect(state.activity.at(-1)).toMatchObject({ tool: 'devboard_gate_review', entity: { kind: 'gate', id: tr1.id } })
  })

  it('refuses an agent verdict on a DCP gate and writes nothing', async () => {
    const { store, run, cdcp } = await atTr1()
    const before = read(store)
    // CDCP is already decided; a fresh project's pending CDCP is the DCP case
    const fresh = await (async () => {
      const turn = async (n: string, i: Any) => (await tool(n).execute(i, { store, signal, fs } as Any)).structured.data
      const p = await turn('devboard_project_create', { name: 'DCP 项目' })
      files.set(`${p.workspaceDir}/docs/PROJECT-PLAN.md`, '# 计划')
      await turn('devboard_artifact_record', { projectId: p.id, stage: 'INITIATION', kind: 'PLAN', path: 'docs/PROJECT-PLAN.md', actingRole: 'requirements' })
      return (await turn('devboard_gate_submit', { projectId: p.id, stage: 'INITIATION' })).gate
    })()
    const after = read(store)
    expect(cdcp.id).not.toBe(fresh.id)
    const out = await run('devboard_gate_review', panel(fresh.id))
    expect(out.isError).toBe(true)
    expect(out.content[0].text).toContain('需由人工审批')
    expect(read(store)).toEqual(after)
    expect(after.revision).toBeGreaterThan(before.revision)
  })

  it('turns rejects into findings and opens a human request on the third', async () => {
    const { store, run, turn, tr1 } = await atTr1()
    const reject = () => turn('devboard_gate_review', panel(tr1.id, { verdict: 'reject', points: ['缺验收标准'] }))
    const humans = read(store).interventions.length
    expect((await reject()).humanNext).toBeUndefined()
    expect((await reject()).humanNext).toBeUndefined()
    let state = read(store)
    expect(state.gates.find((g: Any) => g.id === tr1.id)).toMatchObject({ decision: 'PENDING' })
    expect(state.gates.find((g: Any) => g.id === tr1.id).findings.filter((f: Any) => f.text === '缺验收标准')).toHaveLength(2)
    expect(state.interventions).toHaveLength(humans)
    const third = await reject()
    state = read(store)
    expect(third.intervention).toMatchObject({ state: 'OPEN', entity: { kind: 'gate', id: tr1.id } })
    expect(third.humanNext).toBeTruthy()
    expect(state.interventions).toHaveLength(humans + 1)
    expect(state.reviews.map((r: Any) => r.round)).toEqual([1, 2, 3])
    void run
  })

  it('returns the unfinished request instead of stacking another on the same gate', async () => {
    const { store, turn, tr1 } = await atTr1()
    const ask = { type: 'REQUIREMENT_APPROVAL', entityKind: 'gate', entityId: tr1.id, ask: '请裁决' }
    const first = await turn('devboard_request_human', ask)
    const count = read(store).interventions.length
    const second = await turn('devboard_request_human', { ...ask, ask: '再问一次' })
    expect(second).toMatchObject({ id: first.id, reused: true })
    expect(second.notice).toContain('未记录')
    expect(read(store).interventions).toHaveLength(count)
  })

  it('lets request_human target a pending gate and then refuses agent panels on it', async () => {
    const { store, run, turn, tr1 } = await atTr1()
    const ask = { type: 'REQUIREMENT_APPROVAL', entityKind: 'gate', entityId: tr1.id, ask: '系统检查仍成立，请裁决' }
    const bad = await run('devboard_request_human', { ...ask, entityId: 'nope' })
    expect(bad.isError).toBe(true)
    const out = await turn('devboard_request_human', ask)
    expect(out).toMatchObject({ state: 'OPEN', entity: { kind: 'gate', id: tr1.id } })
    expect(out.humanNext.object).toMatchObject({ type: 'gate', id: tr1.id })
    expect(out.humanNext.text).toContain(tr1.id)
    expect(out.humanNext.text).toContain('批准')
    expect(out.humanNext.text).not.toContain('认领')
    const panelOut = await run('devboard_gate_review', panel(tr1.id, { actingRole: 'reviewer' }))
    expect(panelOut.isError).toBe(true)
    expect(read(store).gates.find((g: Any) => g.id === tr1.id).decision).toBe('PENDING')
    // answering the request does not settle the gate: the hand-off keeps the coordinator from reviewing it again
    const resolve = (to: string) =>
      update(store, (s: Any) => transition(s, { kind: 'intervention', id: out.id, to, by: '项目经理', note: '已看' }, Date.now()))
    resolve('CLAIMED')
    resolve('RESOLVED')
    const waiting = await turn('devboard_handoff', { type: 'intervention', id: out.id })
    expect(waiting.next[0]).toContain('仍待人决议')
    expect(waiting.next[0]).toContain('不要再评审')
    expect(waiting.next[0]).not.toContain('按答复继续 gate')
    expect(waiting.target).toMatchObject({ id: tr1.id })
    // once a person has decided the gate, the hand-off says so and work continues
    update(store, (s: Any) => {
      s.gates.find((g: Any) => g.id === tr1.id).decision = 'APPROVED'
    })
    const settled = await turn('devboard_handoff', { type: 'intervention', id: out.id })
    expect(settled.next[0]).toContain('已批准')
    expect(settled.next[0]).not.toContain('不要再评审')
  })
})
