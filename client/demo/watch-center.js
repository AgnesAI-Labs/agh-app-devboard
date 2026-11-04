/* Generated from the design mock 2026-11-02-devboard-watch-center.html: markup, CSS scoped to a shadow root, and the mock's script as run(root). */
export const css = String.raw`
:host{display:block;color-scheme:light;--bg:#f3f3f1;--surface:#fff;--sub:#f8f8f6;--line:#e4e4e0;--line2:#ecece8;--fill:#f3f3f1;--text:#1b1d22;--text2:#4b4f58;--text3:#666b76;--brand:#4f5bd5;--brand-bg:#eef0fc;--brand-line:#d9dcf7;--ok:#25784a;--ok-bg:#e6f3eb;--warn:#8a5a10;--warn-bg:#f7eedd;--bad:#b23a34;--bad-bg:#fae9e7;--bad-line:#f1cfcb;--info:#2563a8;--info-bg:#e8f0f9;--hot:#fdf5f4;--shadow:0 12px 40px rgb(20 22 30 / 18%)}
:host([data-dark]){color-scheme:dark;--bg:#16171b;--surface:#22242a;--sub:#1c1e23;--line:#33353c;--line2:#2b2d33;--fill:#2b2d33;--text:#ececea;--text2:#b8bac2;--text3:#9a9ea8;--brand:#8a93ff;--brand-bg:#2a2d4a;--brand-line:#3a3f6b;--ok:#6fcf97;--ok-bg:#1f3328;--warn:#e0b25c;--warn-bg:#3a2f1a;--bad:#f0a39e;--bad-bg:#4a1f1d;--bad-line:#6b2c29;--info:#7db3e8;--info-bg:#1d2d42;--hot:#2c2020;--shadow:0 12px 40px rgb(0 0 0 / 50%)}
*{box-sizing:border-box}
[hidden]{display:none!important}
:host{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif;background:var(--bg);color:var(--text);font-size:14px;line-height:1.5;font-variant-numeric:tabular-nums}
button,input{font:inherit;color:inherit}
button{cursor:pointer}
:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.mono{font-family:"SF Mono",ui-monospace,Menlo,monospace;font-size:12.5px}
.muted{color:var(--text3);font-size:12px}
header.top{position:sticky;top:0;z-index:20;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 24px;display:flex;flex-wrap:wrap;align-items:center;gap:10px 20px}
.title{display:flex;align-items:center;gap:10px}
.title h1{margin:0;font-size:22px;font-weight:650;letter-spacing:-.01em}
.demo{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:999px;background:var(--info-bg);color:var(--info);font-size:12px;white-space:nowrap}
.demo::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--info)}
.kpi-line{font-size:14px;color:var(--text2);margin-left:auto}
.kpi-line b{font-size:20px;font-weight:650;color:var(--brand);padding:0 2px}
.controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px;width:100%}
.btn{height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--surface);font-size:13px;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.btn:hover{border-color:var(--text3)}
.btn-primary{background:var(--brand);border-color:var(--brand);color:#fff;font-weight:600}
:host([data-dark]) .btn-primary{color:#14152a}
.btn-primary:hover{filter:brightness(1.08);border-color:var(--brand)}
.btn-sm{height:28px;padding:0 10px;font-size:12.5px}
.btn-quiet{border-color:transparent;background:transparent;color:var(--text2)}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface)}
.seg button{border:0;background:transparent;height:30px;padding:0 10px;font-size:13px;color:var(--text2)}
.seg button[aria-pressed=true]{background:var(--brand-bg);color:var(--brand);font-weight:600}
.clock{font-size:12px;color:var(--text3);margin-left:4px}
.sp{flex:1}
.pop-wrap{position:relative}
.pop{position:absolute;right:0;top:38px;width:420px;max-height:70vh;overflow:auto;background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);padding:6px 0;z-index:30}
.pop[hidden]{display:none}
.pop h3{margin:0;padding:10px 16px 4px;font-size:13px}
.rule{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 16px;border-top:1px solid var(--line2)}
.rule-name{font-weight:600;font-size:13px}
.sw{height:26px;min-width:76px;padding:0 10px;border-radius:999px;border:1px solid var(--line);background:var(--fill);font-size:12px;color:var(--text2)}
.sw[aria-checked=true]{background:var(--ok-bg);color:var(--ok);border-color:transparent;font-weight:600}
.sw[aria-checked=false]{background:var(--warn-bg);color:var(--warn);border-color:transparent;font-weight:600}
.sw:disabled{opacity:.6;cursor:default}
.layout{display:grid;grid-template-columns:minmax(300px,360px) minmax(0,1fr);gap:16px;padding:16px 24px 40px;align-items:start}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line2)}
.card-head h2{margin:0;font-size:15px;font-weight:600;display:flex;align-items:center;gap:8px}
.count{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:20px;padding:0 7px;border-radius:999px;background:var(--fill);color:var(--text2);font-size:12px;font-weight:600}
.count-on{background:var(--brand);color:#fff}
:host([data-dark]) .count-on{color:#14152a}
.chip{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:6px;font-size:12px;font-weight:500;white-space:nowrap;background:var(--fill);color:var(--text2)}
.chip-ok{background:var(--ok-bg);color:var(--ok)}.chip-warn{background:var(--warn-bg);color:var(--warn)}.chip-bad{background:var(--bad-bg);color:var(--bad)}.chip-info{background:var(--info-bg);color:var(--info)}.chip-brand{background:var(--brand-bg);color:var(--brand)}
/* signal desk */
.desk{position:sticky;top:112px;display:flex;flex-direction:column;height:calc(100vh - 128px);min-height:420px}
.feed{list-style:none;margin:0;padding:6px 0;overflow:auto;flex:1;min-height:0}
.feed-empty{padding:28px 16px;color:var(--text3);font-size:13px;text-align:center}
.msg{margin:0;padding:0}
.msg-btn{display:flex;gap:10px;width:100%;text-align:left;border:0;background:transparent;padding:8px 16px;align-items:flex-start}
.msg-btn:hover{background:var(--sub)}
.ico{flex:none;width:26px;height:26px;border-radius:8px;display:grid;place-items:center;background:var(--fill);color:var(--text2)}
.ico svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.src-im .ico{background:var(--brand-bg);color:var(--brand)}.src-ci .ico{background:var(--ok-bg);color:var(--ok)}.src-phm .ico{background:var(--warn-bg);color:var(--warn)}.src-email .ico{background:var(--info-bg);color:var(--info)}
.msg-body{min-width:0;flex:1}
.msg-head{display:flex;gap:8px;align-items:baseline;font-size:12px;color:var(--text3)}
.msg-head b{color:var(--text);font-size:13px}
.msg p{margin:1px 0 0;font-size:13px;overflow-wrap:anywhere}
.tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.tag{font-size:11.5px;color:var(--text3);background:var(--fill);border-radius:5px;padding:0 6px;line-height:19px}
.tag-info{background:var(--info-bg);color:var(--info)}.tag-warn{background:var(--warn-bg);color:var(--warn)}.tag-brand{background:var(--brand-bg);color:var(--brand);font-weight:500}
.msg.dim .msg-body{opacity:.62}
.msg.bot .msg-btn{background:var(--brand-bg);border-radius:10px;margin:2px 12px;width:auto}
.msg.bot .ico{background:var(--brand);color:#fff;font-size:12px;font-weight:700}
:host([data-dark]) .msg.bot .ico{color:#14152a}
.compose{border-top:1px solid var(--line2);padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.compose-row{display:flex;gap:8px}
.compose input{flex:1;min-width:0;height:34px;border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:0 10px}
.quick{display:flex;flex-wrap:wrap;gap:6px}
.quick button{border:1px dashed var(--line);background:transparent;border-radius:999px;padding:1px 10px;font-size:12px;color:var(--text2)}
/* main */
.main{display:flex;flex-direction:column;gap:16px;min-width:0}
.q-title{margin:0 0 8px;font-size:12px;letter-spacing:.04em;color:var(--text3);font-weight:600}
.need-card{border-color:var(--brand-line);box-shadow:0 0 0 3px var(--brand-bg)}
.need-card .card-head h2{font-size:17px;font-weight:650}
.needs{list-style:none;margin:0;padding:0}
.need{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;padding:12px 16px;border-top:1px solid var(--line2)}
.need:first-child{border-top:0}
.need-stalled{background:var(--hot)}
.need-main{display:flex;gap:10px;align-items:flex-start;min-width:0;flex:1 1 380px}
.need-title{font-weight:600;font-size:14px}
.need-sub{font-size:13px;color:var(--text2)}
.need-sub b{color:var(--text)}
.need-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.reply{display:flex;gap:8px;width:100%}
.reply input{flex:1;height:32px;border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:0 10px}
.empty-line{padding:14px 16px;color:var(--text3);font-size:13px}
.funnel{display:flex;align-items:stretch;gap:0;padding:12px 16px;flex-wrap:wrap}
.stage{flex:1 1 110px;text-align:left;background:transparent;border:0;border-radius:10px;padding:6px 10px;position:relative}
.stage:hover{background:var(--sub)}
.stage small{display:block;font-size:12px;color:var(--text3)}
.stage strong{font-size:24px;font-weight:650;line-height:1.2}
.stage.on strong{color:var(--brand)}
.stage:not(:last-child)::after{content:"›";position:absolute;right:-4px;top:50%;transform:translateY(-50%);color:var(--text3);font-size:18px}
.funnel-note{padding:0 16px 12px;font-size:12px;color:var(--text3)}
.lanes{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:12px 16px}
.lane{text-align:left;border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--surface);display:flex;flex-direction:column;gap:3px;min-height:104px;min-width:0}
.lane:hover{border-color:var(--text3)}
.lane-empty{border-style:dashed;background:transparent;color:var(--text3);font-size:12px;align-items:center;justify-content:center;cursor:default}
.lane-empty:hover{border-color:var(--line)}
.lane-top{display:flex;gap:6px;align-items:center;justify-content:space-between}
.lane-title{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.lane-line{font-size:12.5px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.lane .pulse{width:7px;height:7px;border-radius:50%;background:var(--ok);display:inline-block;animation:pulse 1.6s ease-in-out infinite}
.lane.holding .pulse{background:var(--text3);animation:none}
@keyframes pulse{50%{opacity:.35}}
.queue{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:0 16px 12px}
.queue .qi{border:1px solid var(--line);background:var(--sub);border-radius:8px;padding:2px 10px;font-size:12.5px}
.note{margin:0 16px 12px;padding:8px 12px;border-radius:10px;font-size:13px;background:var(--sub);color:var(--text3)}
.note.alert{background:var(--bad-bg);color:var(--bad);border:1px solid var(--bad-line)}
.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
.mini{list-style:none;margin:0;padding:0}
.mini li button{display:block;width:100%;text-align:left;border:0;background:transparent;padding:8px 16px;border-top:1px solid var(--line2);font-size:13px}
.mini li:first-child button{border-top:0}
.mini li button:hover{background:var(--sub)}
.mini .wd{color:var(--warn)}
.in{animation:slide .35s ease-out}
@keyframes slide{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
/* drawer */
.scrim{position:fixed;inset:0;background:rgb(10 12 20 / 30%);z-index:40}
.scrim[hidden],.drawer[hidden]{display:none}
.drawer{position:fixed;top:0;right:0;bottom:0;width:min(460px,100vw);background:var(--surface);border-left:1px solid var(--line);box-shadow:var(--shadow);z-index:50;display:flex;flex-direction:column;animation:drawer .22s ease-out}
@keyframes drawer{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}
.dr-head{display:flex;align-items:flex-start;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line2)}
.dr-head h2{margin:0;font-size:16px;font-weight:650;flex:1}
.dr-body{overflow:auto;padding:14px 18px 28px}
.tl{list-style:none;margin:0;padding:0 0 0 20px;position:relative}
.tl::before{content:"";position:absolute;left:5px;top:6px;bottom:6px;width:2px;background:var(--line)}
.tl>li{position:relative;padding:0 0 18px}
.tl>li::before{content:"";position:absolute;left:-20px;top:5px;width:12px;height:12px;border-radius:50%;background:var(--surface);border:2px solid var(--text3)}
.tl>li.k-trigger::before{border-color:var(--brand)}.tl>li.k-decision::before{border-color:var(--info)}.tl>li.k-mandate::before{border-color:var(--warn)}.tl>li.k-outcome::before{border-color:var(--ok);background:var(--ok)}.tl>li.k-bad::before{border-color:var(--bad);background:var(--bad)}
.tl h4{margin:0 0 4px;font-size:12px;color:var(--text3);font-weight:600;letter-spacing:.03em}
.tl p{margin:2px 0;font-size:13px}
.tl .kv{display:grid;grid-template-columns:76px 1fr;gap:2px 10px;font-size:13px;margin:4px 0}
.tl .kv dt{color:var(--text3);font-size:12px}.tl .kv dd{margin:0;overflow-wrap:anywhere}
.prog{list-style:none;margin:4px 0 0;padding:0;font-size:12.5px}
.prog li{display:flex;gap:8px;padding:2px 0;color:var(--text2)}
.prog time{color:var(--text3);flex:none;width:44px}
.prog .p-surface{color:var(--brand);font-weight:600}.prog .p-discard{color:var(--text3);font-style:italic}.prog .p-done{color:var(--ok);font-weight:600}.prog .p-input{color:var(--info)}
.would{padding:10px 12px;border-radius:10px;background:var(--warn-bg);color:var(--warn);font-size:13px;margin-top:6px}
.listrow{display:block;width:100%;text-align:left;border:1px solid var(--line);background:var(--surface);border-radius:10px;padding:8px 12px;margin-bottom:8px;font-size:13px}
.listrow:hover{border-color:var(--text3)}
@media (max-width:1180px){.layout{grid-template-columns:300px minmax(0,1fr);padding:12px}.lanes{grid-template-columns:repeat(2,minmax(0,1fr))}.two{grid-template-columns:1fr}header.top{padding:10px 12px}}
@media (max-width:900px){.layout{grid-template-columns:1fr}.desk{position:static;height:520px}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}

.mt12{margin-top:12px}.mt6{margin-top:6px}.m04{margin:0 4px}.ico-brand{color:var(--brand)}.ico-bad{color:var(--bad)}
`

export const html = String.raw`
<header class="top">
 <div class="title"><h1>值守中心</h1><span class="demo">演示 · 模拟信号源</span><span class="muted">宁川装备 · 9号线车门系统</span></div>
 <div class="kpi-line" aria-live="polite">本次值守：Agent 打扰你 <b id="kpiI">0</b> 次 · 交付 <b id="kpiD">0</b> 项</div>
 <div class="controls">
  <button class="btn btn-primary" id="bPlay">▶ 播放「宁川的一天」</button>
  <button class="btn" id="bPause">暂停</button>
  <div class="seg" role="group" aria-label="播放速度"><button data-speed="1" aria-pressed="true">1×</button><button data-speed="4" aria-pressed="false">4×</button><button data-speed="16" aria-pressed="false">16×</button></div>
  <button class="btn" id="bReset">重置</button>
  <span class="clock">模拟时间 <b id="clock">08:30</b></span>
  <span class="sp"></span>
  <div class="pop-wrap"><button class="btn" id="bRules" aria-expanded="false" aria-controls="pop">规则 <span class="count" id="ruleCount">0</span></button>
   <div class="pop" id="pop" hidden role="region" aria-label="规则设置"></div></div>
 </div>
</header>
<div class="layout">
 <section class="card desk" aria-label="模拟信号台">
  <div class="card-head"><h2>模拟信号台 <span class="muted">宁川研发群</span></h2><span class="count" id="feedCount">0</span></div>
  <ol class="feed" id="feed" aria-live="polite"></ol>
  <form class="compose" id="compose">
   <div class="quick"><button type="button" data-fill="@研发协调员 ">@研发协调员</button><button type="button" data-fill="@研发协调员 检查 DEF-0137 的复现条件并整理要点">示例：整理复现条件</button><button type="button" data-fill="大家午饭吃什么">示例：闲聊</button></div>
   <div class="compose-row"><input id="msg" autocomplete="off" aria-label="在研发群发消息" placeholder="以演示者身份发消息，含 @研发协调员 会被受理"><button class="btn btn-primary" type="submit">发送</button></div>
  </form>
 </section>
 <div class="main">
  <section aria-labelledby="h-need"><p class="q-title">① 现在要我做什么？</p>
   <div class="card need-card"><div class="card-head"><h2 id="h-need">需要你处理 <span class="count count-on" id="needCount">0</span></h2></div><ul class="needs" id="needs"></ul></div></section>
  <section aria-labelledby="h-sys"><p class="q-title">② 系统在做什么？</p>
   <div class="card"><div class="card-head"><h2 id="h-sys">值守漏斗</h2><span class="muted">点数字看明细</span></div>
    <div class="funnel" id="funnel"></div><div class="funnel-note" id="funnelNote"></div></div>
   <div class="card mt12"><div class="card-head"><h2>子 Agent <span class="muted" id="laneSum"></span></h2><button class="btn btn-sm btn-quiet" id="bHist">历史记录 <span class="count" id="histCount">0</span></button></div>
    <div class="lanes" id="lanes"></div><div class="queue" id="queue"></div><p class="note" id="watch"></p></div>
   <div class="card mt12"><div class="card-head"><h2>只记录 <span class="count" id="shadowCount">0</span></h2><span class="muted">影子规则：只记录会做什么，不开工</span></div><ul class="mini" id="shadow"></ul></div></section>
  <p class="muted m04">③ 一件事的来龙去脉：点击任意消息、工单或数字，从右侧抽屉查看。</p>
 </div>
</div>
<div class="scrim" id="scrim" hidden></div>
<aside class="drawer" id="drawer" hidden role="dialog" aria-modal="true" aria-labelledby="drTitle">
 <div class="dr-head"><button class="btn btn-sm btn-quiet" id="drBack" hidden>返回</button><h2 id="drTitle"></h2><button class="btn btn-sm" id="drClose" aria-label="关闭抽屉（Esc）">关闭</button></div>
 <div class="dr-body" id="drBody"></div>
</aside>
`

/** Runs the mock's engine and UI inside `root` (a ShadowRoot); returns the cleanup. */
export function run(root) {

const Engine=(()=>{
const SLOTS=4, STALL=25, MPS=3; // MPS: simulated minutes shown per simulated second
const TERMINAL=new Set(['done','discarded']);
const RULES=[
 {id:'R-chat',name:'闲聊与确认',kind:'drop',re:/(午饭|食堂|外卖|奶茶|收到|好的|OK|谢谢|辛苦|哈哈|👍)/,tag:'闲聊'},
 {id:'R-meet',name:'会议事务',kind:'drop',re:/(会议室|纪要|腾讯会议|日历|改到|推迟|议程)/,tag:'会议事务'},
 {id:'R-ci-green',name:'CI 构建通过',kind:'drop',src:'ci',re:/(通过|✅)/,tag:'构建通过'},
 {id:'R-phm-hb',name:'PHM 心跳',kind:'drop',src:'phm',re:/(心跳|在线)/,tag:'心跳'},
 {id:'R-news',name:'订阅邮件',kind:'drop',src:'email',re:/(周刊|订阅|退订|Newsletter)/i,tag:'订阅邮件'},
 {id:'R-route',name:'线程跟进直送',kind:'route',desc:'已立项线程里的新消息，直接送达工单，不重新判断'},
 {id:'R-mention',name:'@协调员 请求立项',kind:'accept',desc:'有人明确@研发协调员并给出对象与交付物'},
 {id:'R-ci-red',name:'CI 失败自动立项',kind:'accept',desc:'构建或回归失败，派对应角色先排查'},
 {id:'R-phm-spec',name:'PHM 告警静默起草',kind:'accept',desc:'告警先静默起草 8D，确认可复现才来找你'},
 {id:'R-clause',name:'客户条款来函起草响应',kind:'accept',desc:'客户就合同条款来函，起草条款响应',mode:'shadow'},
 {id:'R-mail-status',name:'客户进展询问起草答复',kind:'accept',desc:'客户询问缺陷或项目进展，起草答复'},
];
const RULE_BY_ID=Object.fromEntries(RULES.map(r=>[r.id,r]));
const nid=(s,k)=>k+'-'+String(++s.seq[k]).padStart(3,'0');
const tk=(s,id)=>s.tickets.find(t=>t.id===id);
const say=t=>t.length>100?t.slice(0,99)+'…':t;

function makeState(){return {now:0,scriptOn:false,cursor:0,seq:{TRG:0,DEC:0,WI:0,M:0},triggers:[],threads:{},decisions:[],tickets:[],messages:[],feed:[],
 rules:Object.fromEntries(RULES.filter(r=>r.kind!=='drop').map(r=>[r.id,{id:r.id,name:r.name,mode:r.mode||'live'}]))};}

function log(s,t,kind,line){t.progress.push({at:s.now,kind,line}); if(kind!=='surface'&&kind!=='discard'&&kind!=='input')t.lastProgressAt=s.now;}
function botSay(s,t,text){ if(!text||!t.origin.mentionsBot)return; const m={id:nid(s,'M'),at:s.now,text:say(text),ticketId:t.id}; s.messages.push(m); s.feed.push({kind:'bot',id:m.id}); }

function ready(s,t){t.state='speculative_ready';t.holdUntil=null;
 t.needsHuman={waitsFor:'你',question:'已确认可复现，草稿已备好，是否采纳？',actions:[{act:'adopt',label:'采纳草稿',primary:true},{act:'discard',label:'丢弃'}]};
 log(s,t,'surface','确认可复现，草稿转为待你处理');}
const ENDS={
 done:(s,t,st)=>{t.state='done';log(s,t,'done',st.result||st.line);botSay(s,t,st.say);},
 waiting_human:(s,t,st)=>{t.state='waiting_human';t.needsHuman=st.needs;log(s,t,'surface',st.line);botSay(s,t,st.say);},
 hold:(s,t,st)=>{t.holdUntil=s.now+st.ttl;log(s,t,'info',st.line);if(t.confirmed)ready(s,t);},
};
const SIGNALS={repro_confirmed:(s,t)=>{t.confirmed=true;if(t.holdUntil!=null&&t.state==='running')ready(s,t);}};

function startQueued(s){
 let n=s.tickets.filter(t=>t.state==='running').length;
 for(const t of s.tickets){ if(n>=SLOTS)break; if(t.state!=='queued')continue;
  t.state='running';t.startedAt=s.now;t.step=0;t.lastProgressAt=s.now;n++;log(s,t,'info','子 Agent 已启动（角色：'+t.role+'）'); }
}
function createTicket(s,tr,dec,ev){
 const o=ev.oracle;
 const t={id:nid(s,'WI'),title:o.title,mandate:{scope:o.scope,ruleId:o.ruleId},objectRef:o.objectRef||'未指定',state:'queued',role:o.role,progress:[],lastProgressAt:s.now,needsHuman:null,
  plan:o.plan,step:0,startedAt:null,speculative:!!o.speculative,confirmed:false,holdUntil:null,resume:o.resume,retry:o.retry,
  origin:{mentionsBot:tr.mentionsBot,triggerId:tr.id,threadId:tr.thread,decisionId:dec.id}};
 s.tickets.push(t);s.threads[tr.thread].subscribedTicketIds.push(t.id);
 log(s,t,'info','已立项，等待空闲子 Agent');startQueued(s);
 botSay(s,t,(o.ack||'好的，我来'+o.title+'，有结论再回到这里。')+(t.state==='queued'?'（排队中）':''));
 return t;
}
function decide(s,tr,ev){
 const th=s.threads[tr.thread];
 const live=th.subscribedTicketIds.map(id=>tk(s,id)).filter(t=>t&&!TERMINAL.has(t.state));
 if(live.length)return {layer:'rule',verdict:'record',ruleId:'R-route',reason:'已送达工单，未重新判断',routedTo:live[0].id};
 if(!tr.mentionsBot){const r=RULES.find(r=>r.kind==='drop'&&(!r.src||r.src===tr.source)&&r.re.test(tr.text));
  if(r)return {layer:'rule',verdict:'ignore',ruleId:r.id,reason:'已过滤：'+r.tag};}
 const o=ev.oracle||{verdict:'ignore',reason:'没有@协调员，也没有需要立项的对象'};
 const rule=o.ruleId&&s.rules[o.ruleId];
 if(o.verdict==='accept'&&rule&&rule.mode==='shadow')return {layer:'model',verdict:'record',ruleId:o.ruleId,reason:o.reason,shadow:true,wouldDo:o.wouldDo||('如果开启，会：'+o.title)};
 return {layer:'model',verdict:o.verdict,ruleId:o.ruleId||null,reason:o.reason};
}
function ingest(s,ev){
 const tr={id:nid(s,'TRG'),source:ev.src,thread:null,actor:ev.actor,text:ev.text,at:s.now,mentionsBot:!!ev.bot};
 tr.thread=ev.thread||('th-'+tr.id);
 s.triggers.push(tr);
 const th=s.threads[tr.thread]||(s.threads[tr.thread]={id:tr.thread,title:ev.title||ev.text.slice(0,18),triggerIds:[],subscribedTicketIds:[]});
 th.triggerIds.push(tr.id);s.feed.push({kind:'trigger',id:tr.id});
 const dec={id:nid(s,'DEC'),threadId:tr.thread,triggerIds:[tr.id],...decide(s,tr,ev)};
 s.decisions.push(dec);
 if(dec.routedTo){const t=tk(s,dec.routedTo);log(s,t,'input','收到补充（'+tr.actor+'）：'+tr.text);if(ev.signal&&SIGNALS[ev.signal])SIGNALS[ev.signal](s,t);}
 else if(dec.verdict==='accept')createTicket(s,tr,dec,ev);
 else if(tr.mentionsBot){const m={id:nid(s,'M'),at:s.now,text:say(dec.shadow?'这类请求目前只记录、没有开工。'+dec.wouldDo:'已看到，这条不需要立项：'+dec.reason)};s.messages.push(m);s.feed.push({kind:'bot',id:m.id});}
}
const KW=/(分析|起草|整理|检查|查|修|看看|复现|生成|汇总|排查|核对)/;
const ROLE_BY=[[/(试验|TT-|图纸|结构)/,'机械设计师'],[/(缺陷|DEF-|复现|验证)/,'验证工程师'],[/(CI|固件|代码|构建)/,'软件设计师（开发）'],[/(变更|CR-|基线)/,'配置管理员'],[/(告警|故障|PHM)/,'诊断工程师']];
function oracleFor(text,bot){
 if(!bot||!KW.test(text))return {verdict:'ignore',reason:bot?'这条是问候或闲聊，没有可交付的事项':'没有@协调员，也不是需要立项的请求'};
 const role=(ROLE_BY.find(([re])=>re.test(text))||[0,'质量工程师'])[1];
 const obj=(text.match(/(PRJ|DEF|CR|TT)-\d{4}(-\d+)?/)||['未指定'])[0];
 return {verdict:'accept',ruleId:'R-mention',reason:'明确@协调员，并提出了可交付的事项',role,title:'处理：'+text.replace(/@研发协调员/g,'').trim().slice(0,22),objectRef:obj,scope:'只读相关记录，产出草稿或结论，不直接改动正式数据',
  plan:[{at:4,line:'读取相关记录'},{at:10,line:'整理要点'},{at:16,end:'done',result:'已完成，结果已汇总',say:'已完成，结果已汇总到工单，可在「一件事的来龙去脉」查看。'}]};
}
const DEF_RETRY=[{at:5,line:'重新执行并核对输入'},{at:12,end:'done',result:'重新派发后已完成'}];
const ACTS={
 adopt:{from:'speculative_ready',to:'done',line:'你已采纳草稿'},
 discard:{from:'speculative_ready',to:'discarded',line:'你已丢弃草稿'},
 approve:{from:'waiting_human',to:'done',line:'你已以「质量工程师」身份批准'},
 reply:{from:'waiting_human',to:'queued',line:'你已回复',plan:'resume'},
 redispatch:{from:'stalled',to:'queued',line:'你已重新派发',plan:'retry'},
};
function stepOnce(s,script){
 while(s.scriptOn&&s.cursor<script.length&&script[s.cursor].t<=s.now){ingest(s,script[s.cursor++]);}
 for(const t of s.tickets){
  if(t.state!=='running')continue;
  if(t.holdUntil!=null&&!t.confirmed&&s.now>=t.holdUntil){t.state='discarded';log(s,t,'discard','未等到「确认可复现」，草稿已静默丢弃');continue;}
  while(t.state==='running'&&t.plan[t.step]&&t.startedAt+t.plan[t.step].at<=s.now){const st=t.plan[t.step++];if(st.end)ENDS[st.end](s,t,st);else log(s,t,'info',st.line);}
  if(t.state==='running'&&t.holdUntil==null&&s.now-t.lastProgressAt>STALL){
   t.state='stalled';const mins=Math.round((s.now-t.lastProgressAt)*MPS);
   t.needsHuman={waitsFor:'你（进展巡检提示）',question:'子 Agent 已约 '+mins+' 分钟没有新进展，可能卡住',actions:[{act:'redispatch',label:'重新派发',primary:true}]};
   log(s,t,'surface','进展巡检：超过 '+mins+' 分钟无进展，已标记为停滞');}
 }
 startQueued(s);
}
const H={
 advance(s,{to,script}){while(s.now+1e-9<to){s.now=Math.min(s.now+0.5,to);stepOnce(s,script);}},
 play(s){s.scriptOn=true;},
 say(s,{text}){ingest(s,{src:'im',actor:'你（演示）',text,bot:/@研发协调员/.test(text),oracle:oracleFor(text,/@研发协调员/.test(text))});startQueued(s);},
 toggleRule(s,{id}){const r=s.rules[id];if(r)r.mode=r.mode==='live'?'shadow':'live';},
 act(s,{id,act,text}){
  const t=tk(s,id),a=ACTS[act];if(!t||!a||t.state!==a.from)return;
  t.state=a.to;t.needsHuman=null;log(s,t,'info',a.line+(text?'：'+text:''));
  if(a.plan){t.plan=t[a.plan]||DEF_RETRY;t.step=0;}
  if(a.to==='discarded')log(s,t,'discard','草稿已丢弃');
  startQueued(s);
 },
};
function reduce(state,action){const s=structuredClone(state);H[action.type](s,action);return s;}

const by=(s,st)=>s.tickets.filter(t=>t.state===st);
const decOf=(s,trId)=>s.decisions.find(d=>d.triggerIds.includes(trId));
const trOf=(s,d)=>d.triggerIds.map(id=>s.triggers.find(t=>t.id===id));
const Q={
 received:s=>s.triggers,
 ruleFiltered:s=>s.decisions.filter(d=>d.layer==='rule'&&d.verdict==='ignore'),
 routed:s=>s.decisions.filter(d=>d.routedTo),
 sentToModel:s=>s.decisions.filter(d=>d.layer==='model'),
 accepted:s=>s.tickets,
 delivered:s=>by(s,'done'),
 interruptions:s=>s.tickets.filter(t=>t.progress.some(p=>p.kind==='surface')),
 needsYou:s=>s.tickets.filter(t=>['waiting_human','speculative_ready','stalled'].includes(t.state)),
 running:s=>by(s,'running'),queued:s=>by(s,'queued'),stalled:s=>by(s,'stalled'),
 shadow:s=>s.decisions.filter(d=>d.shadow),
 discarded:s=>by(s,'discarded'),
 closed:s=>s.tickets.filter(t=>TERMINAL.has(t.state)),
};
const metrics=s=>Object.fromEntries(['received','ruleFiltered','routed','sentToModel','accepted','interruptions','delivered'].map(k=>[k,Q[k](s).length]));
return {SLOTS,STALL,MPS,RULES,RULE_BY_ID,makeState,reduce,Q,metrics,decOf,trOf,tk,oracleFor};
})();


const SCRIPT=(()=>{
const A=(act,label,primary)=>({act,label,primary});
const real=[
 {t:20,src:'email',actor:'运营方设备部 刘主任',thread:'th-clause',title:'夹紧力条款来函',text:'来函：关于 9 号线车门夹紧力条款第 6.3 条，请贵司书面说明满足依据。',
  oracle:{verdict:'accept',ruleId:'R-clause',reason:'客户就合同条款来函，属于「条款响应」类请求',role:'质量工程师',title:'起草夹紧力条款 6.3 响应',objectRef:'PRJ-2025-042',scope:'只读试验数据，起草条款响应草稿',wouldDo:'如果开启，会：由质量工程师起草夹紧力条款 6.3 的响应草稿，引用 TT-2026-011 数据',plan:[]}},
 {t:38,src:'im',actor:'张工',thread:'th-tt011',title:'TT-2026-011 夹紧力复测',bot:true,text:'@研发协调员 TT-2026-011 夹紧力复测没过，帮我分析失败原因，并起草一份变更',
  oracle:{verdict:'accept',ruleId:'R-mention',reason:'明确@协调员，并给出试验对象与可交付物（分析 + 变更草案）',role:'机械设计师',title:'分析 TT-2026-011 失败并起草变更',objectRef:'TT-2026-011',scope:'只读试验记录与图纸；可起草变更草案，不可提交变更',
   ack:'好的，我会分析 TT-2026-011 的失败原因并起草变更，结论出来后回到这里。',
   plan:[{at:3,line:'读取 TT-2026-011 试验记录与夹紧力曲线'},{at:14,line:'定位原因：夹紧弹簧预紧偏低，偏差超出公差'},{at:28,line:'起草变更草案：调整预紧垫片规格'},
    {at:40,end:'waiting_human',line:'草案就绪，等待技术负责人决定',say:'分析完成，变更草案已起草。需要技术负责人决定是否提交评审。',needs:{waitsFor:'技术负责人',question:'变更草案已就绪，是否提交评审？',actions:[A('approve','以「技术负责人」批准提交',true),A('reply','回复')]}}],
   resume:[{at:5,line:'已按你的回复调整草案'},{at:12,end:'done',result:'已按回复更新变更草案并提交评审'}]}},
 {t:52,src:'im',actor:'李工',thread:'th-tt011',text:'补充：上周 3 号样机也出现过类似的夹紧力偏低'},
 {t:58,src:'ci',actor:'CI',thread:'th-fw482',title:'门控固件构建失败',text:'door-ctrl-fw #482 构建失败：test_obstacle_retry 超时',
  oracle:{verdict:'accept',ruleId:'R-ci-red',reason:'主干构建失败，命中「CI 失败自动立项」',role:'软件设计师（开发）',title:'修复门控固件 CI 失败',objectRef:'DEF-0137',scope:'可在修复分支提交代码，不可合入主干',
   plan:[{at:4,line:'拉取构建日志，复现 test_obstacle_retry 超时'},{at:16,line:'定位：障碍物重试计时器未复位'},{at:30,line:'已在修复分支提交补丁，重跑 CI'},{at:42,end:'done',result:'修复已完成：重试计时器在每次开门时复位，CI 重跑通过。'}]}},
 {t:66,src:'phm',actor:'PHM',thread:'th-phm53',title:'5号线 3号门 关门到位抖动',text:'告警：5号线 3 号门 关门到位信号抖动 (1/3)',
  oracle:{verdict:'accept',ruleId:'R-phm-spec',reason:'告警簇首条，命中「PHM 告警静默起草」，先静默起草，不打扰',role:'诊断工程师',title:'5号线3号门关门到位抖动 8D 草稿',objectRef:'PRJ-2023-011',scope:'只读 PHM 数据，静默起草 8D，不对外发布',speculative:true,
   plan:[{at:5,line:'读取 3 号门近 7 天 PHM 曲线'},{at:12,line:'对比同型号门历史告警'},{at:22,line:'起草 8D 草稿（D1–D4）'},{at:24,end:'hold',ttl:70,line:'草稿就绪，静默待命，等待「确认可复现」'}]}},
 {t:72,src:'phm',actor:'PHM',thread:'th-phm53',text:'告警：5号线 3 号门 关门到位信号抖动 (2/3)'},
 {t:79,src:'phm',actor:'PHM',thread:'th-phm53',text:'告警：5号线 3 号门 关门到位信号抖动 (3/3)'},
 {t:80,src:'im',actor:'王工',thread:'th-def137',title:'DEF-0137 关联试验记录',bot:true,text:'@研发协调员 把 DEF-0137 关联的试验记录整理成一张对照表',
  oracle:{verdict:'accept',ruleId:'R-mention',reason:'明确@协调员，对象与交付物清楚',role:'验证工程师',title:'整理 DEF-0137 关联试验记录',objectRef:'DEF-0137',scope:'只读试验记录，生成对照表',
   ack:'好的，我会整理 DEF-0137 关联的试验记录，做成对照表。',
   plan:[{at:3,line:'检索与 DEF-0137 关联的试验记录'},{at:12,line:'已找到 7 份记录，开始对齐字段'},{at:25,end:'done',result:'已生成对照表（7 份记录）',say:'整理完成：DEF-0137 关联 7 份试验记录，对照表已生成。'}]}},
 {t:84,src:'phm',actor:'PHM',thread:'th-phm97',title:'9号线 7号门 开门时间偏长',text:'告警：9号线 7 号门 开门时间略超限一次',
  oracle:{verdict:'accept',ruleId:'R-phm-spec',reason:'命中「PHM 告警静默起草」，信号较弱，先静默起草',role:'诊断工程师',title:'9号线7号门开门时间偏长 8D 草稿',objectRef:'PRJ-2025-042',scope:'只读 PHM 数据，静默起草 8D，不对外发布',speculative:true,
   plan:[{at:5,line:'读取 7 号门开门时间序列'},{at:12,line:'对比阈值与同线门数据'},{at:22,line:'起草 8D 草稿（D1–D3）'},{at:24,end:'hold',ttl:40,line:'草稿就绪，静默待命，等待「确认可复现」'}]}},
 {t:86,src:'ci',actor:'CI',thread:'th-nightly',title:'夜间回归失败',text:'nightly-regression 2 个用例失败：test_door_close_timing, test_pinch_recover',
  oracle:{verdict:'accept',ruleId:'R-ci-red',reason:'夜间回归失败，命中「CI 失败自动立项」',role:'验证工程师',title:'排查夜间回归 2 个失败用例',objectRef:'PRJ-2025-042',scope:'只读构建与日志，可重跑回归',
   plan:[{at:4,line:'对比失败用例的历史通过率'},{at:12,line:'判断为测试台环境抖动，重跑中'},{at:30,end:'done',result:'重跑全部通过，判定为环境抖动，无需处理。'}]}},
 {t:92,src:'im',actor:'陈工',thread:'th-cr019',title:'CR-2026-019 基线同步',bot:true,text:'@研发协调员 CR-2026-019 批准了，把受影响图纸清单同步到配置基线',
  oracle:{verdict:'accept',ruleId:'R-mention',reason:'明确@协调员，变更已批准，动作清楚',role:'配置管理员',title:'同步 CR-2026-019 到配置基线',objectRef:'CR-2026-019',scope:'可更新配置基线清单，需保留变更记录',
   ack:'好的，我会把 CR-2026-019 的受影响图纸同步到配置基线。',
   plan:[{at:4,line:'读取 CR-2026-019 受影响图纸清单'}],
   retry:[{at:5,line:'重新读取清单并比对基线'},{at:14,line:'基线已同步，生成变更记录'},{at:20,end:'done',result:'基线已同步，变更记录已生成'}]}},
 {t:96,src:'phm',actor:'PHM',thread:'th-phm53',text:'复现确认：5号线 3 号门 同一故障 24 小时内第 3 次出现',signal:'repro_confirmed'},
 {t:108,src:'email',actor:'运营方 王工程师',thread:'th-status',title:'询问 DEF-0137 进展',text:'来函：请告知 DEF-0137 当前处理进展与预计关闭时间。',
  oracle:{verdict:'accept',ruleId:'R-mail-status',reason:'客户询问缺陷进展，命中「客户进展询问起草答复」',role:'质量工程师',title:'起草 DEF-0137 进展答复',objectRef:'DEF-0137',scope:'只读缺陷记录，起草答复草稿，不直接发出',
   plan:[{at:6,line:'读取 DEF-0137 状态与计划'},{at:14,line:'起草答复（含预计关闭时间）'},{at:20,end:'done',result:'答复草稿已完成并存入缺陷记录'}]}},
];
const M=(t,src,actor,text,reason)=>({t,src,actor,text,oracle:{verdict:'ignore',reason}});
const N=(t,src,actor,text)=>({t,src,actor,text});
const noise=[
 N(2,'im','林工','早，今天食堂的早餐有包子'),N(4,'ci','CI','door-ctrl-fw #478 构建通过 ✅'),N(6,'phm','PHM','PHM 心跳：5号线 全部 32 个车门节点在线'),
 N(9,'email','供应商门户','《轨道交通装备周刊》本周精选，退订请点击'),N(11,'im','赵工','收到'),N(13,'im','周工','下午 3 点评审会改到 3 点半，会议室 B2'),
 N(16,'ci','CI','door-ctrl-fw #479 构建通过 ✅'),N(18,'im','张工','好的，谢谢'),N(22,'phm','PHM','PHM 心跳：9号线 全部 44 个车门节点在线'),
 N(25,'im','吴工','中午谁点外卖？我要黄焖鸡'),N(27,'ci','CI','docs-site #212 构建通过 ✅'),N(30,'im','钱工','纪要我晚点发群里'),
 N(33,'email','行业协会','【Newsletter】供应商质量月报订阅更新'),N(36,'im','郑工','哈哈哈 这个表情包绝了'),N(41,'ci','CI','door-ctrl-fw #480 构建通过 ✅'),
 N(44,'phm','PHM','PHM 心跳：5号线 全部 32 个车门节点在线'),N(47,'im','孙工','OK，我先去吃饭'),N(50,'im','林工','辛苦大家'),
 N(55,'ci','CI','sim-cluster #90 构建通过 ✅'),N(57,'im','周工','会议室 A3 被占了，改到 B1'),N(61,'phm','PHM','PHM 心跳：9号线 全部 44 个车门节点在线'),
 N(63,'im','吴工','奶茶团购，要的 +1'),N(68,'email','行业协会','订阅提醒：设备管理协会月刊'),N(70,'ci','CI','sim-cluster #91 构建通过 ✅'),
 N(74,'im','赵工','收到，稍后看'),N(76,'im','钱工','腾讯会议链接已发邮箱'),N(78,'phm','PHM','PHM 心跳：5号线 全部 32 个车门节点在线'),
 N(82,'im','郑工','👍'),N(90,'ci','CI','docs-site #213 构建通过 ✅'),N(94,'im','林工','好的好的'),
 N(98,'email','行业协会','《城市轨道周刊》第 44 期 订阅'),N(102,'phm','PHM','PHM 心跳：9号线 全部 44 个车门节点在线'),N(104,'im','孙工','有人下楼拿外卖吗'),
 N(110,'ci','CI','door-ctrl-fw #484 构建通过 ✅'),N(114,'im','周工','日历已更新，下周例会推迟一天'),N(118,'im','吴工','收到'),
 N(124,'phm','PHM','PHM 心跳：5号线 全部 32 个车门节点在线'),N(130,'im','钱工','辛苦了，明天见'),N(136,'ci','CI','sim-cluster #92 构建通过 ✅'),
 N(142,'email','供应商门户','供应商门户系统维护通知（订阅邮件）'),N(150,'im','郑工','哈哈 好的'),N(158,'phm','PHM','PHM 心跳：9号线 全部 44 个车门节点在线'),
 N(166,'im','林工','会议室预订系统有点卡'),N(172,'ci','CI','door-ctrl-fw #485 构建通过 ✅'),
 M(8,'im','孙工','有人看到最新的试验报告模板放哪了吗','人与人之间的提问，没有@协调员，也不涉及需要立项的对象'),
 M(29,'ci','CI','door-ctrl-fw 构建耗时 6 分 40 秒，比昨天长 12%','只是耗时波动，未超阈值，不需要处理'),
 M(62,'phm','PHM','5号线 11 号门 电机电流略偏高，低于告警阈值','低于告警阈值，不构成告警'),
 M(106,'email','采购部','转发：夹紧弹簧供应商交期确认（仅抄送）','仅抄送，无需答复'),
 M(126,'im','张工','这周五前大家别动主干分支','通知类消息，没有需要立项的动作'),
 M(146,'im','陈工','感觉最近门控板温升有点高？','闲聊式猜测，没有对象编号，也没有明确请求'),
];
return [...real,...noise].sort((a,b)=>a.t-b.t);
})();


const E=Engine,Q=E.Q,$=id=>root.getElementById(id);
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let S=E.makeState(),running=false,speed=1,replyFor=null,stack=[],opener=null;
const prev={},seen=new Set();
const esc=x=>String(x).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clock=t=>{const m=510+Math.floor(t*E.MPS);return String(Math.floor(m/60)%24).padStart(2,'0')+':'+String(m%60).padStart(2,'0');};
const ago=t=>{const n=Math.round((S.now-t)*E.MPS);return n<1?'刚刚':n+' 分钟前';};
const enter=k=>seen.has(k)?'':(seen.add(k),' in');
const region=(id,sig,fn)=>{if(prev[id]===sig)return;prev[id]=sig;$(id).innerHTML=fn();};
const ICON={
 im:'<path d="M4 5h16v11H9l-5 4z"/>',
 ci:'<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 8v8M18 11c0 4-6 3-12 5"/>',
 phm:'<path d="M3 12h4l2-6 4 12 2-6h6"/>',
 email:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
 need:'<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>'};
const SRC={im:'IM',ci:'CI',phm:'PHM',email:'邮件'};
const svg=k=>'<svg viewBox="0 0 24 24" aria-hidden="true">'+ICON[k]+'</svg>';
const STATE={queued:['排队中',''],running:['运行中','chip-ok'],waiting_human:['等人决定','chip-brand'],speculative_ready:['草稿待采纳','chip-brand'],done:['已交付','chip-ok'],stalled:['已停滞','chip-bad'],discarded:['已丢弃','']};
const stChip=t=>{const [l,c]=STATE[t.state];return '<span class="chip '+c+'">'+(t.state==='running'&&t.holdUntil!=null?'静默待命':l)+'</span>';};
const setNum=(el,n)=>{const from=+el.dataset.n||0;el.dataset.n=n;if(reduced||from===n){el.textContent=n;return;}
 const t0=performance.now();const f=now=>{const k=Math.min(1,(now-t0)/350);el.textContent=Math.round(from+(n-from)*k);if(k<1&&+el.dataset.n===n)requestAnimationFrame(f);};requestAnimationFrame(f);};
const dispatch=a=>{S=E.reduce(S,a);render();};

/* ---------- renderers ---------- */
function tags(tr){
 const d=E.decOf(S,tr.id);if(!d)return '';
 const r=d.layer==='rule'&&d.verdict==='ignore'?'<span class="tag">'+esc(d.reason)+'</span>':
  d.routedTo?'<span class="tag tag-info">已送达工单，未重新判断</span>':
  d.shadow?'<span class="tag tag-warn">只记录 · 未开工</span>':
  d.verdict==='ignore'?'<span class="tag">协调员判断：无需处理</span>':
  d.verdict==='accept'?'<span class="tag tag-brand">工单：'+esc(S.tickets.find(t=>t.origin.decisionId===d.id).title)+'</span>':'';
 return '<div class="tags">'+r+'</div>';
}
function renderFeed(){
 const dim=tr=>{const d=E.decOf(S,tr.id);return d&&d.verdict==='ignore'?' dim':'';};
 const sig=S.feed.length+'|'+S.decisions.length+'|'+S.tickets.map(t=>t.title).join();
 const box=$('feed'),stick=box.scrollTop+box.clientHeight>=box.scrollHeight-40;
 region('feed',sig,()=>{
  if(!S.feed.length)return '<li class="feed-empty">还没有信号。点「播放」，或在下方发一条消息。</li>';
  return S.feed.map(f=>{
   if(f.kind==='bot'){const m=S.messages.find(x=>x.id===f.id);return '<li class="msg bot'+enter(f.id)+'"><button class="msg-btn" data-open="wi:'+m.ticketId+'"><span class="ico" aria-hidden="true">研</span><span class="msg-body"><span class="msg-head"><b>研发协调员</b><span>'+clock(m.at)+'</span></span><p>'+esc(m.text)+'</p></span></button></li>';}
   const tr=S.triggers.find(x=>x.id===f.id);
   return '<li class="msg src-'+tr.source+dim(tr)+enter(f.id)+'"><button class="msg-btn" data-open="tr:'+tr.id+'"><span class="ico" aria-label="'+SRC[tr.source]+'">'+svg(tr.source)+'</span><span class="msg-body"><span class="msg-head"><b>'+esc(tr.actor)+'</b><span>'+SRC[tr.source]+' · '+clock(tr.at)+'</span></span><p>'+esc(tr.text)+'</p>'+tags(tr)+'</span></button></li>';
  }).join('');});
 if(stick)box.scrollTop=box.scrollHeight;
 setNum($('feedCount'),S.triggers.length);
}
function needRow(t){
 const n=t.needsHuman,open=replyFor===t.id;
 const acts=n.actions.map(a=>'<button class="btn btn-sm'+(a.primary?' btn-primary':'')+'" data-act="'+a.act+'" data-id="'+t.id+'">'+esc(a.label)+'</button>').join('');
 return '<li class="need'+(t.state==='stalled'?' need-stalled':'')+enter('n'+t.id+t.state)+'"><div class="need-main"><span class="ico '+(t.state==='stalled'?'ico-bad':'ico-brand')+'" aria-hidden="true">'+svg('need')+'</span><div><div class="need-title">'+esc(t.title)+'</div><div class="need-sub">等待：<b>'+esc(n.waitsFor)+'</b> · 需要：'+esc(n.question)+'</div><div class="muted">'+esc(t.role)+' · '+esc(t.objectRef)+' · <span data-since="'+t.progress.at(-1).at+'"></span></div></div></div>'
  +'<div class="need-actions">'+acts+'<button class="btn btn-sm btn-quiet" data-open="wi:'+t.id+'">查看</button></div>'
  +(open?'<form class="reply" data-reply="'+t.id+'"><input aria-label="回复内容" value="请按草案提交，夹紧力数据补充到附件" autofocus><button class="btn btn-sm btn-primary">发送回复</button></form>':'')+'</li>';
}
function renderNeeds(){
 const L=Q.needsYou(S);
 region('needs',L.map(t=>t.id+t.state).join()+replyFor,()=>L.length?L.map(needRow).join(''):'<li class="empty-line">现在没有需要你的事</li>');
 setNum($('needCount'),L.length);
 if(replyFor){const i=root.querySelector('[data-reply] input');if(i&&root.activeElement!==i&&!i.dataset.f){i.dataset.f=1;i.focus();}}
}
const STAGES=[['received','进入'],['ruleFiltered','规则挡掉'],['sentToModel','交给协调员判断'],['accepted','立项'],['delivered','交付']];
function renderFunnel(){
 if(!$('funnel').children.length)$('funnel').innerHTML=STAGES.map(([k,l])=>'<button class="stage'+(k==='accepted'?' on':'')+'" data-stage="'+k+'"><small>'+l+'</small><strong data-n="0">0</strong></button>').join('');
 for(const [k] of STAGES)setNum(root.querySelector('[data-stage="'+k+'"] strong'),Q[k](S).length);
 const r=Q.routed(S).length;$('funnelNote').textContent=r?'另有 '+r+' 条直接送达已有工单（未重新判断）。进入 = 规则挡掉 + 直送 + 交给协调员判断。':'进入 = 规则挡掉 + 直送已有工单 + 交给协调员判断。';
}
function laneCard(t){
 const last=t.progress.at(-1);
 return '<button class="lane'+(t.holdUntil!=null?' holding':'')+enter('l'+t.id)+'" data-open="wi:'+t.id+'"><span class="lane-top"><span class="chip chip-info">'+esc(t.role)+'</span><span class="pulse" aria-hidden="true"></span></span><span class="lane-title">'+esc(t.title)+'</span><span class="muted">'+esc(t.objectRef)+(t.holdUntil!=null?' · 静默待命':'')+'</span><span class="lane-line">'+esc(last.line)+'</span></button>';
}
function renderLanes(){
 const R=Q.running(S),W=Q.queued(S),X=Q.stalled(S);
 const sig=R.map(t=>t.id+t.progress.length+(t.holdUntil!=null)).join()+'|'+W.map(t=>t.id).join()+'|'+X.map(t=>t.id).join();
 region('lanes',sig,()=>Array.from({length:E.SLOTS},(_,i)=>R[i]?laneCard(R[i]):'<div class="lane lane-empty">空闲</div>').join(''));
 region('queue','q'+W.map(t=>t.id).join(),()=>W.length?'<span class="muted">排队等待空闲槽位：</span>'+W.map((t,i)=>'<button class="qi'+enter('q'+t.id)+'" data-open="wi:'+t.id+'">'+(i+1)+'. '+esc(t.title)+'</button>').join(''):'');
 $('laneSum').textContent='运行 '+R.length+'/'+E.SLOTS+' · 排队 '+W.length;
 const n=$('watch');n.className='note'+(X.length?' alert':'');
 n.textContent=X.length?'进展巡检：'+X.map(t=>'「'+t.title+'」').join('、')+' 超过 '+E.STALL*E.MPS+' 分钟无新进展，已移入「需要你处理」。':'进展巡检：运行中的子 Agent 均有新进展。';
 setNum($('histCount'),Q.closed(S).length);
}
function renderShadow(){
 const L=Q.shadow(S);
 region('shadow',L.map(d=>d.id).join(),()=>L.length?L.map(d=>{const tr=E.trOf(S,d)[0];return '<li class="'+enter(d.id)+'"><button data-open="tr:'+tr.id+'"><b>'+esc(tr.actor)+'：</b>'+esc(tr.text.slice(0,34))+'…<br><span class="wd">'+esc(d.wouldDo)+'</span></button></li>';}).join(''):'<li class="empty-line">暂无。把某条规则切到「只记录」后，命中的请求会出现在这里。</li>');
 setNum($('shadowCount'),L.length);
}
function renderRules(){
 const R=Object.values(S.rules);
 $('ruleCount').textContent=R.length;
 region('pop',R.map(r=>r.mode).join()+S.decisions.length,()=>{
  const hits=id=>S.decisions.filter(d=>d.ruleId===id).length;
  const drops=E.RULES.filter(r=>r.kind==='drop');
  return '<h3>可切换规则</h3>'+R.map(r=>{const m=E.RULE_BY_ID[r.id],live=r.mode==='live';
   return '<div class="rule"><div><div class="rule-name">'+esc(r.name)+'</div><div class="muted">'+esc(m.desc)+' · 命中 '+hits(r.id)+' 次</div></div><button class="sw" role="switch" aria-checked="'+live+'" data-rule="'+r.id+'">'+(live?'实时':'只记录')+'</button></div>';}).join('')
   +'<h3 class="mt6">常驻过滤（不可关）</h3>'+drops.map(r=>'<div class="rule"><div><div class="rule-name">'+esc(r.name)+'</div><div class="muted">命中 '+hits(r.id)+' 次</div></div><span class="chip">常驻</span></div>').join('');});
}
function renderKpi(){setNum($('kpiI'),Q.interruptions(S).length);setNum($('kpiD'),Q.delivered(S).length);$('clock').textContent=clock(S.now);
 root.querySelectorAll('[data-since]').forEach(e=>{e.textContent=ago(+e.dataset.since);});}

/* ---------- drawer ---------- */
const layerChip=d=>'<span class="chip '+(d.layer==='rule'?'chip-info':'chip-brand')+'">'+(d.layer==='rule'?'规则层':'协调员（模型）')+'</span>';
const VERB={ignore:'忽略',record:'记录',accept:'立项',stop:'叫停'};
function trBlock(tr){return '<li class="k-trigger"><h4>触发 · '+SRC[tr.source]+'</h4><p><b>'+esc(tr.actor)+'</b> <span class="muted">'+clock(tr.at)+(tr.mentionsBot?' · @协调员':'')+'</span></p><p>'+esc(tr.text)+'</p><p class="muted">线程：'+esc(S.threads[tr.thread].title)+' <span class="mono">'+tr.id+' / '+tr.thread+'</span></p></li>';}
function decBlock(d){
 const rm=d.ruleId&&(S.rules[d.ruleId]||E.RULE_BY_ID[d.ruleId]);
 return '<li class="k-decision"><h4>判断</h4><p>'+layerChip(d)+' <span class="chip">'+VERB[d.verdict]+'</span>'+(d.shadow?' <span class="chip chip-warn">影子模式</span>':'')+'</p><dl class="kv"><dt>理由</dt><dd>'+esc(d.reason)+'</dd>'+(rm?'<dt>规则</dt><dd>'+esc(rm.name)+' <span class="mono">'+rm.id+'</span>'+(S.rules[d.ruleId]?' · '+(S.rules[d.ruleId].mode==='live'?'实时':'只记录'):'')+'</dd>':'')+'<dt>判断编号</dt><dd class="mono">'+d.id+'</dd></dl>'+(d.shadow?'<div class="would">'+esc(d.wouldDo)+'。未创建工单，没有子 Agent 运行。</div>':'')+'</li>';
}
function ticketBlocks(t){
 const trs=[S.triggers.find(x=>x.id===t.origin.triggerId)];
 const d=S.decisions.find(x=>x.id===t.origin.decisionId);
 const out=t.state==='done'?'<li class="k-outcome"><h4>结果</h4><p><span class="chip chip-ok">已交付</span> '+esc(t.progress.findLast(p=>p.kind==='done').line)+'</p></li>':
  t.state==='discarded'?'<li class="k-bad"><h4>结果</h4><p><span class="chip">已静默丢弃</span> '+(t.progress.some(p=>p.kind==='surface')?'已由你丢弃。':'从未进入「需要你处理」，没有打扰任何人。')+'</p></li>':
  t.needsHuman?'<li class="k-bad"><h4>当前状态</h4><p>'+stChip(t)+' 等待 <b>'+esc(t.needsHuman.waitsFor)+'</b>：'+esc(t.needsHuman.question)+'</p></li>':
  '<li><h4>当前状态</h4><p>'+stChip(t)+'</p></li>';
 return trBlock(trs[0])+decBlock(d)+'<li class="k-mandate"><h4>工单授权</h4><dl class="kv"><dt>工单</dt><dd>'+esc(t.title)+' <span class="mono">'+t.id+'</span></dd><dt>对象</dt><dd class="mono">'+esc(t.objectRef)+'</dd><dt>角色</dt><dd>'+esc(t.role)+(t.speculative?'（静默起草）':'')+'</dd><dt>授权范围</dt><dd>'+esc(t.mandate.scope)+'</dd><dt>依据规则</dt><dd class="mono">'+t.mandate.ruleId+'</dd></dl></li>'
  +'<li><h4>子 Agent 进展</h4><ul class="prog">'+t.progress.map(p=>'<li class="p-'+p.kind+'"><time>'+clock(p.at)+'</time><span>'+esc(p.line)+'</span></li>').join('')+'</ul></li>'+out;
}
function drawerHtml(k){
 const [kind,id]=k.split(':');
 if(kind==='wi'){const t=E.tk(S,id);return [t.title,'<ol class="tl">'+ticketBlocks(t)+'</ol>'];}
 if(kind==='tr'){const tr=S.triggers.find(x=>x.id===id),d=E.decOf(S,id),t=S.tickets.find(x=>x.origin.decisionId===d.id);
  return ['消息的来龙去脉','<ol class="tl">'+trBlock(tr)+decBlock(d)+(t?'<li class="k-outcome"><h4>后续</h4><button class="listrow" data-open="wi:'+t.id+'"><b>'+esc(t.title)+'</b> '+stChip(t)+'</button></li>':d.routedTo?'<li class="k-outcome"><h4>后续</h4><button class="listrow" data-open="wi:'+d.routedTo+'">已送达工单：'+esc(E.tk(S,d.routedTo).title)+'</button></li>':'<li class="k-outcome"><h4>后续</h4><p class="muted">'+(d.shadow?'只记录，未开工。':'没有后续动作，不打扰任何人。')+'</p></li>')+'</ol>'];}
 const L={received:['进入',()=>S.triggers.map(t=>[t,E.decOf(S,t.id)])],ruleFiltered:['规则挡掉',()=>Q.ruleFiltered(S).map(d=>[E.trOf(S,d)[0],d])],sentToModel:['交给协调员判断',()=>Q.sentToModel(S).map(d=>[E.trOf(S,d)[0],d])]};
 if(L[id]){const rows=L[id][1]();return [L[id][0]+'（'+rows.length+'）',rows.slice().reverse().map(([tr,d])=>'<button class="listrow" data-open="tr:'+tr.id+'"><b>'+esc(tr.actor)+'</b> <span class="muted">'+SRC[tr.source]+' · '+clock(tr.at)+(d?' · '+esc(d.reason):'')+'</span><br>'+esc(tr.text)+'</button>').join('')||'<p class="muted">暂无</p>'];}
 const T={accepted:['立项',Q.accepted],delivered:['交付',Q.delivered],closed:['历史记录（已交付与已丢弃）',Q.closed]}[id];
 const rows=T[1](S);return [T[0]+'（'+rows.length+'）',rows.map(t=>'<button class="listrow" data-open="wi:'+t.id+'"><b>'+esc(t.title)+'</b> '+stChip(t)+'<br><span class="muted">'+esc(t.role)+' · '+esc(t.objectRef)+'</span></button>').join('')||'<p class="muted">暂无</p>'];
}
let drSig='';
function renderDrawer(){
 const k=stack.at(-1);$('drawer').hidden=$('scrim').hidden=!k;$('drBack').hidden=stack.length<2;
 if(!k)return;
 const sig=k+'|'+S.tickets.map(t=>t.state+t.progress.length).join()+S.triggers.length+S.decisions.length+Object.values(S.rules).map(r=>r.mode).join();
 if(sig===drSig)return;drSig=sig;
 const [h,b]=drawerHtml(k);$('drTitle').textContent=h;$('drBody').innerHTML=b;
}
function openD(k){if(!stack.length)opener=root.activeElement;stack.push(k);drSig='';renderDrawer();if(stack.length===1)$('drClose').focus();}
function closeD(){stack=[];drSig='';renderDrawer();if(opener&&opener.isConnected)opener.focus();}

function render(){renderFeed();renderNeeds();renderFunnel();renderLanes();renderShadow();renderRules();renderKpi();renderDrawer();}

/* ---------- wiring ---------- */
root.addEventListener('click',e=>{
 const o=e.target.closest('[data-open]');if(o){openD(o.dataset.open);return;}
 const g=e.target.closest('[data-stage]');if(g){openD('list:'+g.dataset.stage);return;}
 const a=e.target.closest('[data-act]');if(a){if(a.dataset.act==='reply'){replyFor=replyFor===a.dataset.id?null:a.dataset.id;prev.needs=null;renderNeeds();}else dispatch({type:'act',id:a.dataset.id,act:a.dataset.act});return;}
 const r=e.target.closest('[data-rule]');if(r){dispatch({type:'toggleRule',id:r.dataset.rule});return;}
 const f=e.target.closest('[data-fill]');if(f){const i=$('msg');i.value=f.dataset.fill;i.focus();return;}
 if(!e.target.closest('.pop-wrap'))setPop(false);
});
root.addEventListener('submit',e=>{
 const f=e.target.closest('[data-reply]');if(f){e.preventDefault();const id=f.dataset.reply;replyFor=null;prev.needs=null;dispatch({type:'act',id,act:'reply',text:f.querySelector('input').value});}
});
const setPop=on=>{$('pop').hidden=!on;$('bRules').setAttribute('aria-expanded',on);};
$('bRules').onclick=e=>{e.stopPropagation();setPop($('pop').hidden);};
$('scrim').onclick=closeD;$('drClose').onclick=closeD;$('drBack').onclick=()=>{stack.pop();drSig='';renderDrawer();};
root.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(stack.length)closeD();else setPop(false);});
$('bPlay').onclick=()=>{if(!S.scriptOn)S=E.reduce(S,{type:'play'});running=true;sync();};
$('bPause').onclick=()=>{running=false;sync();};
root.querySelectorAll('[data-speed]').forEach(b=>b.onclick=()=>{speed=+b.dataset.speed;sync();});
$('bReset').onclick=()=>{S=E.makeState();running=false;replyFor=null;stack=[];seen.clear();for(const k in prev)prev[k]=null;root.querySelectorAll('[data-n]').forEach(e=>e.dataset.n=0);sync();render();};
$('compose').onsubmit=e=>{e.preventDefault();const t=$('msg').value.trim();if(!t)return;$('msg').value='';running=true;S=E.reduce(S,{type:'say',text:t});sync();render();};
function sync(){
 $('bPlay').textContent=!S.scriptOn?'▶ 播放「宁川的一天」':(running?'播放中…':'▶ 继续');
 $('bPlay').disabled=running&&S.scriptOn;$('bPause').disabled=!running;
 root.querySelectorAll('[data-speed]').forEach(b=>b.setAttribute('aria-pressed',+b.dataset.speed===speed));
}
const timer=setInterval(()=>{if(!running)return;S=E.reduce(S,{type:'advance',to:S.now+0.25*speed,script:SCRIPT});render();},250);
sync();render();
root.host.__watch={get S(){return S},E,SCRIPT,dispatch,setSpeed:v=>{speed=v},play:()=>$('bPlay').click()};

return () => clearInterval(timer)
}
