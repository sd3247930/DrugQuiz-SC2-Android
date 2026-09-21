/**
 * 文件名称：安卓版/run_quiz_on_device.mjs
 * 文件作用：
 *     在**真机上的 HBuilderX（uni-app 标准基座）版本**里，自动完成「单选 N 道 + 多选 N 道」
 *     并回到首页读取四项统计，用于"在 HBuilderX 上做完题目 → 真机查看统计"的验收。
 *
 * 前提：
 *     1. HBuilderX 已把项目运行到手机（`cli.exe launch app-android --project "Pharma Law Quiz Bank"`）
 *     2. 已把基座 WebView 的调试端口转发到本机，例如：
 *        adb forward tcp:9223 localabstract:webview_devtools_remote_<基座pid>
 *
 * 用法：
 *     node run_quiz_on_device.mjs                 # 默认 100 单选 + 100 多选，每 4 题错 1 题
 *     node run_quiz_on_device.mjs --port 9223 --n 100
 */

const argv = process.argv.slice(2);
const argOf = (name, def) => (argv.indexOf(name) >= 0 ? argv[argv.indexOf(name) + 1] : def);
const PORT = Number(argOf("--port", 9223));
const N = Number(argOf("--n", 100));
const WRONG_EVERY = Number(argOf("--wrong-every", 4));

async function targets() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  return list;
}

async function findAppPage() {
  const list = await targets();
  return list.find((t) => t.type === "page" && /hybrid\/html\/.*\.html/.test(t.url)) || null;
}

/** 等到 App 的页面 URL 命中条件（用于等导航完成） */
async function waitForPage(matchFn, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const p = await findAppPage();
    if (p && matchFn(p.url)) return p;
    await sleep(400);
  }
  return null;
}

async function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  await new Promise((r) => ws.addEventListener("open", r));
  const evaluate = (expression, awaitPromise = false) =>
    new Promise((resolve) => {
      const myId = ++id;
      pending.set(myId, (msg) => {
        if (msg.error) return resolve({ error: msg.error });
        const r = msg.result || {};
        if (r.exceptionDetails) return resolve({ exception: r.exceptionDetails.text || "JS 异常" });
        resolve(r.result ? r.result.value : null);
      });
      ws.send(JSON.stringify({ id: myId, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise } }));
    });
  return { ws, evaluate };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 注入到手机页面里的答题器：自己找当前题、按计划作答、逐题推进 */
const RUNNER = (n, wrongEvery) => `(async () => {
  const bank = window.__QUESTION_BANK__ || [];
  const singles = [], multis = [];
  bank.forEach((q, i) => { (q.type === '单选' ? singles : multis).push(i + 1); });
  const plan = [];
  for (let i = 0; i < ${n}; i++) {
    if (singles[i]) plan.push(singles[i]);
    if (multis[i]) plan.push(multis[i]);
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const byId = (id) => bank[id - 1];
  window.__RUN__ = { phase: 'start', done: 0, total: plan.length, stat: { 单选: { ok: 0, bad: 0 }, 多选: { ok: 0, bad: 0 } }, mismatch: [] };
  const seen = { 单选: 0, 多选: 0 };
  const ids = plan.join(',');
  /* 注意：导航由外层脚本负责，这里只负责答题。
     曾经这里放过一个"防止重复注入"的自我导航分支，但它拿未编码的 ids 去比 URL
     （URL 里逗号是 %2C），判断永远为假 → 每次都重新导航一次 → 注入被冲掉、__RUN__ 始终为 null。 */
  window.__RUN__.phase = 'running';
  for (let i = 0; i < plan.length; i++) {
    const q = byId(plan[i]);
    let guard = 0;
    while (guard++ < 120) {
      const t = (document.getElementById('questionText') || {}).textContent || '';
      if (t.trim() === q.question.trim()) break;
      await sleep(50);
    }
    seen[q.type] += 1;
    const wantWrong = seen[q.type] % ${wrongEvery} === 0;
    const letters = wantWrong
      ? (q.type === '单选' ? ['A','B','C','D'].find((l) => q.answer.indexOf(l) < 0) : [q.answer[0]])
      : q.answer;
    for (const L of letters) {
      const el = document.querySelector('#options input[value="' + L + '"]');
      if (el && !el.checked) el.click();
    }
    document.getElementById('submitBtn').click();
    guard = 0;
    while (guard++ < 120) {
      const box = document.getElementById('resultBox');
      if (box && !box.classList.contains('hidden')) break;
      await sleep(50);
    }
    const got = ((document.getElementById('resultBox') || {}).textContent || '').trim();
    const ok = got.indexOf('回答正确') >= 0;
    if (ok === !wantWrong) { ok ? window.__RUN__.stat[q.type].ok++ : window.__RUN__.stat[q.type].bad++; }
    else window.__RUN__.mismatch.push('#' + plan[i] + ' 预期' + (wantWrong ? '错' : '对') + '，实际：' + got.slice(0, 20));
    window.__RUN__.done = i + 1;
    const next = document.getElementById('nextBtn');
    if (next && !next.classList.contains('hidden')) { next.click(); await sleep(90); }
  }
  window.__RUN__.phase = 'done';
  return JSON.stringify(window.__RUN__);
})()`;

async function main() {
  const page = await findAppPage();
  if (!page) {
    console.error("❌ 没找到 App 的 WebView 页面，请确认已运行到手机、已 adb forward");
    process.exit(1);
  }
  console.log("已连接页面：" + page.url);
  const { ws, evaluate } = await connect(page.webSocketDebuggerUrl);

  /* 0) 先清掉上次留下的进度，保证统计从 0 开始 */
  await evaluate(`localStorage.removeItem('drug_quiz_data');
                  localStorage.removeItem('drug_quiz_wrong');
                  localStorage.removeItem('drug_quiz_selection');
                  'reset-ok'`);
  console.log("已清空本机进度（drug_quiz_data / wrong / selection）");

  /* 1) 计算这一轮的题号并让页面跳到"自定义选题练习" */
  const ids = await evaluate(`(function(){
    const bank = window.__QUESTION_BANK__ || [];
    const s = [], m = [];
    bank.forEach((q, i) => (q.type === '单选' ? s : m).push(i + 1));
    const plan = [];
    for (let i = 0; i < ${N}; i++) { if (s[i]) plan.push(s[i]); if (m[i]) plan.push(m[i]); }
    return plan.join(',');
  })()`);
  console.log(`本轮题号：${ids.split(",").length} 道（交替排列）`);
  await evaluate(`location.href = 'practice.html?mode=custom&ids=' + encodeURIComponent(${JSON.stringify(ids)})`);

  /* 2) 等练习页真正加载完，再注入答题器（否则注入会被导航冲掉） */
  const practicePage = await waitForPage((u) => u.indexOf("practice.html") >= 0, 25000);
  if (!practicePage) {
    console.error("❌ 练习页没有加载出来");
    process.exit(1);
  }
  console.log("练习页已就绪：" + practicePage.url.slice(-60));
  const conn2 = await connect(practicePage.webSocketDebuggerUrl);
  await conn2.evaluate(RUNNER(N, WRONG_EVERY), true).catch(() => null);
  await sleep(1500);
  let status = null;
  for (let i = 0; i < 360; i++) {
    await sleep(1000);
    status = await conn2.evaluate("JSON.stringify(window.__RUN__ || null)");
    if (typeof status === "string" && status !== "null") {
      const s = JSON.parse(status);
      if (i % 5 === 0 || s.phase === "done") console.log(`  进度 ${s.done}/${s.total}（${s.phase}）`);
      if (s.phase === "done") { status = s; break; }
    }
  }
  console.log("答题结果：" + JSON.stringify(status));

  /* 3) 回首页读四项统计 */
  await conn2.evaluate("location.href = 'index.html'");
  await sleep(2000);
  const page3 = await findAppPage();
  const conn3 = await connect(page3.webSocketDebuggerUrl);
  const stats = await conn3.evaluate(`JSON.stringify({
    total: (document.getElementById('statTotal')||{}).textContent,
    answered: (document.getElementById('statAnswered')||{}).textContent,
    accuracy: (document.getElementById('statAccuracy')||{}).textContent,
    wrong: (document.getElementById('statWrong')||{}).textContent,
    attempts: (document.getElementById('statAttempts')||{}).textContent,
    unanswered: (document.getElementById('statUnanswered')||{}).textContent
  })`);
  console.log("真机四项统计：" + stats);

  conn3.ws.close();
  conn2.ws.close();
  ws.close();
}

main().catch((e) => {
  console.error("❌ 执行失败：", e);
  process.exit(1);
});
