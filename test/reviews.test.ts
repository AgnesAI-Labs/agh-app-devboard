import { describe, expect, it } from 'vitest'
import { DomainError } from '../approvals.mjs'
import { nextRound, validateReview } from '../reviews.mjs'

const speech = (role: string, remark = '接口清晰', verdict = 'pass') => ({ role, verdict, remark })
const base = () => ({
  gateId: 'GATE-1',
  speeches: [speech('reviewer'), speech('quality')],
  verdict: 'pass',
  points: ['接口边界清晰'],
})
const bad = (patch: object, message: string) => {
  expect(() => validateReview({ ...base(), ...patch })).toThrow(DomainError)
  expect(() => validateReview({ ...base(), ...patch })).toThrow(message)
}

describe('validateReview', () => {
  it('accepts a well-formed panel and counts CJK characters, not UTF-16 units', () => {
    expect(validateReview(base())).toMatchObject({ gateId: 'GATE-1', verdict: 'pass' })
    // an astral character is one character
    expect(() => validateReview({ ...base(), points: ['𠮷'.repeat(30)] })).not.toThrow()
  })

  it('limits a remark to 50 characters', () => {
    const speeches = (n: number) => [speech('reviewer', '评'.repeat(n)), speech('quality')]
    expect(() => validateReview({ ...base(), speeches: speeches(50) })).not.toThrow()
    bad({ speeches: speeches(51) }, '超过 50 字')
  })

  it('takes 1-3 points of at most 30 characters', () => {
    expect(() => validateReview({ ...base(), points: ['a', 'b', 'c'] })).not.toThrow()
    bad({ points: [] }, '1–3 条')
    bad({ points: ['a', 'b', 'c', 'd'] }, '1–3 条')
    expect(() => validateReview({ ...base(), points: ['要'.repeat(30)] })).not.toThrow()
    bad({ points: ['要'.repeat(31)] }, '超过 30 字')
  })

  it('needs 2-3 speeches with distinct roles', () => {
    const three = [speech('reviewer'), speech('quality'), speech('tester')]
    expect(() => validateReview({ ...base(), speeches: three })).not.toThrow()
    bad({ speeches: [speech('reviewer')] }, '2–3 位')
    bad({ speeches: [...three, speech('architect')] }, '2–3 位')
    bad({ speeches: [speech('reviewer'), speech('reviewer')] }, '重复')
  })

  it('refuses an unknown verdict, in the panel or in a speech', () => {
    bad({ verdict: 'maybe' }, 'pass 或 reject')
    bad({ speeches: [speech('reviewer', 'x', 'ok'), speech('quality')] }, 'pass 或 reject')
  })
})

describe('nextRound', () => {
  const r = (verdict: string, gateId = 'G') => ({ gateId, verdict })
  it('counts consecutive rejects of this gate and escalates on the third', () => {
    expect(nextRound([], 'G')).toEqual({ round: 1, escalate: false })
    expect(nextRound([r('reject')], 'G')).toEqual({ round: 2, escalate: false })
    expect(nextRound([r('reject'), r('reject')], 'G')).toEqual({ round: 3, escalate: true })
  })
  it('ignores other gates and restarts after a pass', () => {
    expect(nextRound([r('reject'), r('reject', 'H'), r('reject')], 'G').round).toBe(3)
    expect(nextRound([r('reject'), r('reject'), r('pass')], 'G')).toEqual({ round: 1, escalate: false })
  })
})
