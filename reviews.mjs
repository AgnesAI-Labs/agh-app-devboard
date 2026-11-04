// Review-panel records of agent-judged gates (design §4.5): pure validation and round counting.
import { DomainError } from './approvals.mjs'

const fail = (message) => {
  throw new DomainError(message)
}
const len = (s) => [...String(s ?? '')].length
export const REMARK_MAX = 50
export const POINT_MAX = 30
export const MAX_ROUNDS = 3

const verdictOf = (v, name) => (['pass', 'reject'].includes(v) ? v : fail(`${name} 需为 pass 或 reject`))

/** Throws unless the panel's result fits the closing format; returns it normalised. */
export function validateReview({ gateId, speeches, verdict, points } = {}) {
  if (!gateId) fail('评审会缺少 gateId')
  verdictOf(verdict, '评审结论')
  if (!Array.isArray(speeches) || speeches.length < 2 || speeches.length > 3)
    fail('评审会需要 2–3 位评审角色发言')
  const roles = new Set()
  for (const s of speeches) {
    const role = String(s?.role ?? '').trim()
    if (!role) fail('评审发言缺少角色')
    if (roles.has(role)) fail(`评审角色「${role}」重复发言，每个角色只能发言一次`)
    roles.add(role)
    verdictOf(s.verdict, `「${role}」的结论`)
    const remark = String(s.remark ?? '').trim()
    if (!remark) fail(`「${role}」的评语不能为空`)
    if (len(remark) > REMARK_MAX) fail(`「${role}」的评语 ${len(remark)} 字，超过 ${REMARK_MAX} 字上限，请改短后重新提交`)
  }
  if (!Array.isArray(points) || points.length < 1 || points.length > 3) fail('收口要点需要 1–3 条')
  for (const [i, raw] of points.entries()) {
    const point = String(raw ?? '').trim()
    if (!point) fail(`第 ${i + 1} 条要点不能为空`)
    if (len(point) > POINT_MAX) fail(`第 ${i + 1} 条要点 ${len(point)} 字，超过 ${POINT_MAX} 字上限，请改短后重新提交`)
  }
  return { gateId, speeches, verdict, points }
}

/**
 * The round the next review of this gate would be, and whether it must go to a person. Rounds are the
 * consecutive rejects at the end of the gate's reviews (a pass resets the count); the 3rd reject in a
 * row escalates, so `escalate` is true when the stored reviews already hold 2 rejects and the new one rejects too.
 * `round` is the number of the next review; `escalate` says that review is the last allowed.
 */
export function nextRound(reviews, gateId) {
  let streak = 0
  for (const r of (reviews ?? []).filter((r) => r.gateId === gateId).toReversed()) {
    if (r.verdict !== 'reject') break
    streak++
  }
  return { round: streak + 1, escalate: streak + 1 >= MAX_ROUNDS }
}
