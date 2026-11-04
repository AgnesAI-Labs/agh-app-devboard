import { describe, expect, it } from 'vitest'
import { buildTimeline, scrub, toModule } from '../scripts/assistant-demo-export.mjs'

// biome-ignore lint/suspicious/noExplicitAny: ledger rows are untyped plain data
type Any = any
const row = (seq: number, sec: number, type: string, data: Any, actor: Any = { id: 'onetaway' }): Any => ({
  seq,
  ts: new Date(Date.UTC(2026, 10, 3, 18, 0, sec)).toISOString(),
  type,
  actor: JSON.stringify(actor),
  origin: 'model',
  trust: 'trusted',
  data: JSON.stringify(data),
})
const result = (id: string, body: Any, extra: Any = {}) => ({ toolUseId: id, content: [{ type: 'text', text: JSON.stringify(body) }], ...extra })

const rows = [
  row(1, 0, 'session/start', { key: 'devboard-assistant:854de0b2-ce03-4c09-9494-6b5200b7314a' }),
  row(2, 1, 'user/message', { content: [{ type: 'text', text: '新建一个项目' }] }, { id: 'local' }),
  row(3, 1, 'user/message', { content: [{ type: 'text', text: 'cwd /Users/someone/agnes-harness' }] }, { id: 'system' }),
  row(4, 2, 'turn/start', { turn: 1, trigger: 'follow_up' }),
  row(5, 3, 'assistant/message', { content: [{ type: 'text', text: '**开始**，见 /Users/someone/agnes-harness/docs/a.md，联系 a.b@corp.example' }] }),
  row(6, 4, 'tool/call', { toolUseId: 't1', name: 'devboard_gate_submit', args: { stage: 'INITIATION' } }),
  row(7, 5, 'tool/result', result('t1', { data: { stage: { stage: 'INITIATION', state: 'IN_REVIEW' }, gate: { id: 'G-1', code: 'CDCP', name: '概念决策评审', decision: 'PENDING', approverRoles: ['IPMT'] } } })),
  row(8, 6, 'tool/call', { toolUseId: 't2', name: 'shell', args: { command: 'ls /Users/someone/work/x' } }),
  row(9, 6, 'decision/state', {
    handle: { id: 'H1' },
    revision: 1,
    request: { spec: { purpose: 'tool.permission', subject: { call: { name: 'shell', args: { command: 'ls /Users/someone/work/x' } } } }, createdAt: new Date(Date.UTC(2026, 10, 3, 18, 0, 6)).toISOString() },
  }),
  row(10, 9, 'decision/state', {
    handle: { id: 'H1' },
    revision: 2,
    request: { spec: { purpose: 'tool.permission', subject: { call: { name: 'shell', args: {} } } } },
    result: { reason: 'answered', at: new Date(Date.UTC(2026, 10, 3, 18, 0, 9)).toISOString(), response: { option: 'allowed-once' }, answeredBy: { role: 'owner' } },
  }),
  row(11, 10, 'tool/result', result('t2', { ok: 1 })),
  row(12, 12, 'tool/call', { toolUseId: 't3', name: 'devboard_handoff', args: { type: 'gate', id: 'G-1' } }),
  row(13, 13, 'tool/result', result('t3', { data: { gate: { id: 'G-1', code: 'CDCP', name: '概念决策评审', decision: 'APPROVED', approver: 'IPMT', approverActor: { kind: 'human' }, decidedAt: new Date(Date.UTC(2026, 10, 3, 18, 0, 11)).toISOString(), signatures: [{ role: 'IPMT', by: 'IPMT' }] } } })),
  row(14, 14, 'turn/end', { reason: 'completed' }),
]

describe('assistant demo exporter', () => {
  const timeline = buildTimeline(rows)
  it('reduces rows to an ordered timeline with turns, gate, permission and stats', () => {
    expect(timeline.events.map((e: Any) => e.k)).toEqual(['user', 'turn', 'reply', 'tool', 'stage', 'gate', 'tool', 'perm', 'perm-answer', 'gate-decision', 'tool', 'turn-end'])
    expect(timeline.events.find((e: Any) => e.k === 'gate-decision')).toMatchObject({ t: 11, code: 'CDCP', decision: 'APPROVED', by: 'IPMT', kind: 'human', signers: ['IPMT'] })
    expect(timeline.events.find((e: Any) => e.k === 'perm-answer')).toMatchObject({ t: 9, option: 'allowed-once' })
    expect(timeline.events.map((e: Any) => e.t)).toEqual([...timeline.events.map((e: Any) => e.t)].sort((a, b) => a - b))
    expect(timeline.stats).toMatchObject({ durationSec: 14, turns: 1, toolCalls: 3, gates: 1, gatesDecided: 1, permissions: 1 })
  })
  it('scrubs home paths, emails, ids and credentials, and is deterministic', () => {
    const text = toModule(timeline)
    expect(text).not.toMatch(/\/Users\/|@corp|\*\*/)
    expect(text).toContain('docs/a.md')
    expect(toModule(buildTimeline(rows))).toBe(text)
    expect(scrub('/Users/me/agnes-harness/a/b and /Users/me/other/c')).toBe('a/b and ~/other/c')
    expect(scrub('id 854de0b2-ce03-4c09-9494-6b5200b7314a key sk-abcdefgh12345678 token=abcd1234')).toBe('id 854de0b2 key [secret] token=[secret]')
  })
})
