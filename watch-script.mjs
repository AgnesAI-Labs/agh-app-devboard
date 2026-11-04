// 「宁川的一天」: the watch center's demo script (design 2026-11-03, P3). Pure data plus two pure functions.
// The events are the prototype's: [minute of the day, source, speaker or sender, text, thread?]. They carry no verdicts:
// each one is posted through devboard.watch.post like a real message, and the rule layer (and the coordinator behind it)
// decides what happens. `adaptScript` puts them on the project's real members and objects, `planScript` asks the rule
// layer how many of them it would hand to the coordinator, which is a real model call each.

import { ingest, readWatch } from './watch.mjs'

/** Prototype speaker → the role whose member says the line. A project without that role falls back to a stable other member. */
const SPEAKERS = {
  张工: '机械设计师',
  李工: '质量工程师',
  王工: '验证工程师',
  陈工: '配置管理员',
  林工: '软件设计师',
  赵工: '系统设计师',
  周工: '项目经理',
  吴工: '电气设计师',
  钱工: '配置管理员',
  郑工: '技术负责人',
  孙工: 'RAMS 工程师',
}

export const SCRIPT = [
  [2, 'im', '林工', '早，今天食堂的早餐有包子'],
  [4, 'ci', 'CI', 'door-ctrl-fw #478 构建通过 ✅'],
  [6, 'phm', 'PHM', 'PHM 心跳：5号线 全部 32 个车门节点在线'],
  [8, 'im', '孙工', '有人看到最新的试验报告模板放哪了吗'],
  [9, 'email', '供应商门户', '《轨道交通装备周刊》本周精选，退订请点击'],
  [11, 'im', '赵工', '收到'],
  [13, 'im', '周工', '下午 3 点评审会改到 3 点半，会议室 B2'],
  [16, 'ci', 'CI', 'door-ctrl-fw #479 构建通过 ✅'],
  [18, 'im', '张工', '好的，谢谢'],
  [20, 'email', '运营方设备部 刘主任', '来函：关于 9 号线车门夹紧力条款第 6.3 条，请贵司书面说明满足依据。', 'clause'],
  [22, 'phm', 'PHM', 'PHM 心跳：9号线 全部 44 个车门节点在线'],
  [25, 'im', '吴工', '中午谁点外卖？我要黄焖鸡'],
  [27, 'ci', 'CI', 'docs-site #212 构建通过 ✅'],
  [29, 'ci', 'CI', 'door-ctrl-fw 构建耗时 6 分 40 秒，比昨天长 12%'],
  [30, 'im', '钱工', '纪要我晚点发群里'],
  [33, 'email', '行业协会', '【Newsletter】供应商质量月报订阅更新'],
  [36, 'im', '郑工', '哈哈哈 这个表情包绝了'],
  [38, 'im', '张工', '@研发协调员 TT-2026-011 夹紧力复测没过，帮我分析失败原因，并起草一份变更', 'tt011'],
  [41, 'ci', 'CI', 'door-ctrl-fw #480 构建通过 ✅'],
  [44, 'phm', 'PHM', 'PHM 心跳：5号线 全部 32 个车门节点在线'],
  [47, 'im', '孙工', 'OK，我先去吃饭'],
  [50, 'im', '林工', '辛苦大家'],
  [52, 'im', '李工', '补充：上周 3 号样机也出现过类似的夹紧力偏低', 'tt011'],
  [55, 'ci', 'CI', 'sim-cluster #90 构建通过 ✅'],
  [57, 'im', '周工', '会议室 A3 被占了，改到 B1'],
  [58, 'ci', 'CI', 'door-ctrl-fw #482 构建失败：test_obstacle_retry 超时', 'fw482'],
  [61, 'phm', 'PHM', 'PHM 心跳：9号线 全部 44 个车门节点在线'],
  [62, 'phm', 'PHM', '5号线 11 号门 电机电流略偏高，低于告警阈值'],
  [63, 'im', '吴工', '奶茶团购，要的 +1'],
  [66, 'phm', 'PHM', '告警：5号线 3 号门 关门到位信号抖动 (1/3)', 'phm53'],
  [68, 'email', '行业协会', '订阅提醒：设备管理协会月刊'],
  [70, 'ci', 'CI', 'sim-cluster #91 构建通过 ✅'],
  [72, 'phm', 'PHM', '告警：5号线 3 号门 关门到位信号抖动 (2/3)', 'phm53'],
  [74, 'im', '赵工', '收到，稍后看'],
  [76, 'im', '钱工', '视频会议链接已发邮箱'],
  [78, 'phm', 'PHM', 'PHM 心跳：5号线 全部 32 个车门节点在线'],
  [79, 'phm', 'PHM', '告警：5号线 3 号门 关门到位信号抖动 (3/3)', 'phm53'],
  [80, 'im', '王工', '@研发协调员 把 DEF-0137 关联的试验记录整理成一张对照表', 'def137'],
  [82, 'im', '郑工', '👍'],
  [84, 'phm', 'PHM', '告警：9号线 7 号门 开门时间略超限一次', 'phm97'],
  [86, 'ci', 'CI', 'nightly-regression 2 个用例失败：test_door_close_timing, test_pinch_recover', 'nightly'],
  [90, 'ci', 'CI', 'docs-site #213 构建通过 ✅'],
  [92, 'im', '陈工', '@研发协调员 CR-2026-019 批准了，把受影响图纸清单同步到配置基线', 'cr019'],
  [94, 'im', '林工', '好的好的'],
  [96, 'phm', 'PHM', '复现确认：5号线 3 号门 同一故障 24 小时内第 3 次出现', 'phm53'],
  [98, 'email', '行业协会', '《城市轨道周刊》第 44 期 订阅'],
  [102, 'phm', 'PHM', 'PHM 心跳：9号线 全部 44 个车门节点在线'],
  [104, 'im', '孙工', '有人下楼拿外卖吗'],
  [106, 'email', '采购部', '转发：夹紧弹簧供应商交期确认（仅抄送）'],
  [108, 'email', '运营方 王工程师', '来函：请告知 DEF-0137 当前处理进展与预计关闭时间。', 'status'],
  [110, 'ci', 'CI', 'door-ctrl-fw #484 构建通过 ✅'],
  [114, 'im', '周工', '日历已更新，下周例会推迟一天'],
  [118, 'im', '吴工', '收到'],
  [124, 'phm', 'PHM', 'PHM 心跳：5号线 全部 32 个车门节点在线'],
  [126, 'im', '张工', '这周五前大家别动主干分支'],
  [130, 'im', '钱工', '辛苦了，明天见'],
  [136, 'ci', 'CI', 'sim-cluster #92 构建通过 ✅'],
  [142, 'email', '供应商门户', '供应商门户系统维护通知（订阅邮件）'],
  [146, 'im', '陈工', '感觉最近门控板温升有点高？'],
  [150, 'im', '郑工', '哈哈 好的'],
  [158, 'phm', 'PHM', 'PHM 心跳：9号线 全部 44 个车门节点在线'],
  [166, 'im', '林工', '会议室预订系统有点卡'],
  [172, 'ci', 'CI', 'door-ctrl-fw #485 构建通过 ✅'],
]

/** The object kinds the script names, with the board list and id prefix that own them. */
const OBJECTS = [
  [/DEF-\d{4}/g, 'defects', 'DEF-'],
  [/TT-\d{4}-\d{3}/g, 'trials', 'TT-'],
  [/CR-\d{4}-\d{3}/g, 'changes', 'CR-'],
]

function realObjects(text, board, projectId) {
  let out = text
  for (const [re, list, prefix] of OBJECTS) {
    const own = (board[list] ?? []).filter((x) => x.projectId === projectId && x.id.startsWith(prefix)).map((x) => x.id)
    out = out.replace(re, (id) => (own.includes(id) ? id : (own[0] ?? id)))
  }
  return out
}

/** The script on one project's members: `by` is the member who posts (signals are posted by the speaker's colleague), `from` the sender of a signal. */
export function adaptScript(board, w) {
  const names = Object.keys(SPEAKERS)
  const member = (name) =>
    w.members.find((m) => m.role === SPEAKERS[name]) ?? w.members[Math.max(0, names.indexOf(name)) % w.members.length]
  const first = member('周工')
  return SCRIPT.map(([t, source, who, text, thread], i) => ({
    i,
    t,
    source,
    by: source === 'im' ? member(who).id : first.id,
    ...(source === 'im' ? {} : { from: who }),
    ...(thread ? { thread } : {}),
    text: realObjects(text, board, w.projectId),
  }))
}

/**
 * What the rule layer does with the events, replayed on an empty copy of the group (so no ticket exists yet).
 * `handoff` is the number of events it hands to the coordinator; `followUps` the later events in a thread that opened
 * with a handed-over one, which also reach the coordinator once that thread has a ticket (an upper bound).
 */
export function planScript(w, events) {
  const copy = { ...w, seq: { ...w.seq }, messages: [], decisions: [], tickets: [] }
  const threads = new Map()
  const opened = new Set()
  const plan = { total: events.length, handoff: 0, followUps: 0, filtered: 0, recorded: 0, shadow: 0 }
  for (const e of events) {
    const { message, decision: d } = ingest(copy, { source: e.source, actor: e.source === 'im' ? e.by : e.from, text: e.text, threadId: threads.get(e.thread) }, 0)
    if (e.thread && !threads.has(e.thread)) threads.set(e.thread, message.threadId)
    if (d.layer === 'model') {
      plan.handoff++
      if (e.thread) opened.add(e.thread)
    } else if (e.thread && opened.has(e.thread)) plan.followUps++
    if (d.verdict === 'ignore') plan.filtered++
    else if (d.shadow) plan.shadow++
    else if (d.verdict === 'record') plan.recorded++
  }
  return plan
}

/** The query behind the page's player: the adapted events from `from` on, and what the rule layer would do with them. */
export function watchScript(store, { projectId, from = 0 }) {
  const { w, board } = readWatch(store, projectId)
  const events = adaptScript(board, w)
  return { events, plan: planScript(w, events.slice(from)) }
}
