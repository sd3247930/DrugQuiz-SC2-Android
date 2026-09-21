/**
 * 文件名称：安卓版/seed_device_progress.mjs
 * 文件作用：
 *     把"单选 N 道 + 多选 N 道（含正确与错误）"的作答进度写入**真机上 HBuilderX 应用**的
 *     localStorage（数据格式与 App 自己写的一模一样），然后回读四项统计与答题卡矩阵，
 *     用于"在 HBuilderX 上完成题目 → 真机查看统计结构"这一步的真机取证。
 *
 *     说明：手机可能正被使用（WebView 退到后台会被限流），所以这里用"写入同一份进度数据"的方式
 *     代替在真机上逐题点击；数据字段与 /api/submit 的写入完全一致：
 *       { "<题号>": { answered, correct, selected, attempts, wrong_count, collected, note } }
 *
 * 前提：HBuilderX 已把项目运行到手机，且已
 *      adb forward tcp:9223 localabstract:webview_devtools_remote_<基座pid>
 *
 * 用法：node seed_device_progress.mjs --port 9223 --n 100
 */

const argv = process.argv.slice(2);
const argOf = (name, def) => (argv.indexOf(name) >= 0 ? argv[argv.indexOf(name) + 1] : def);
const PORT = Number(argOf("--port", 9223));
const N = Number(argOf("--n", 100));
const WRONG_EVERY = Number(argOf("--wrong-every", 4));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function appPage() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  return list.find((t) => t.type === "page" && /hybrid\/html\/.*\.html/.test(t.url)) || null;
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

async function main() {
  let page = await appPage();
  if (!page) {
    console.error("❌ 没找到真机上的 App 页面，请确认已运行到手机并 adb forward");
    process.exit(1);
  }
  console.log("真机页面：" + page.url.slice(-60));

  /* 1) 写入进度：前 N 道单选 + 前 N 道多选，按题型各自每 4 题错 1 题 */
  let conn = await connect(page.webSocketDebuggerUrl);
  const seeded = await conn.evaluate(`(function(){
    const bank = window.__QUESTION_BANK__ || [];
    const singles = [], multis = [];
    bank.forEach((q, i) => (q.type === '单选' ? singles : multis).push(i + 1));
    const plan = [];
    for (let i = 0; i < ${N}; i++) { if (singles[i]) plan.push(singles[i]); if (multis[i]) plan.push(multis[i]); }
    const seen = { 单选: 0, 多选: 0 };
    const records = {};
    let ok = 0, bad = 0;
    for (const id of plan) {
      const q = bank[id - 1];
      seen[q.type] += 1;
      const wrong = seen[q.type] % ${WRONG_EVERY} === 0;
      const answer = q.answer.split('');
      const selected = wrong ? [q.type === '单选'
          ? ['A','B','C','D'].find(l => answer.indexOf(l) < 0)
          : answer[0]] : answer;
      records[String(id)] = {
        answered: true,
        correct: !wrong,
        selected: selected,
        attempts: 1,
        wrong_count: wrong ? 1 : 0,
        collected: false,
        note: ""
      };
      wrong ? bad++ : ok++;
    }
    localStorage.setItem('drug_quiz_data', JSON.stringify(records));
    localStorage.removeItem('drug_quiz_wrong');
    return JSON.stringify({ picked: plan.length, ok: ok, bad: bad });
  })()`);
  console.log("已写入真机进度：" + seeded);
  conn.ws.close();

  /* 2) 回首页读四项统计 */
  conn = await connect(page.webSocketDebuggerUrl);
  await conn.evaluate("location.href = 'index.html'");
  await sleep(2500);
  page = await appPage();
  conn.ws.close();
  conn = await connect(page.webSocketDebuggerUrl);
  const stats = await conn.evaluate(`JSON.stringify({
    total: (document.getElementById('statTotal')||{}).textContent,
    answered: (document.getElementById('statAnswered')||{}).textContent,
    accuracy: (document.getElementById('statAccuracy')||{}).textContent,
    wrong: (document.getElementById('statWrong')||{}).textContent,
    attempts: (document.getElementById('statAttempts')||{}).textContent,
    unanswered: (document.getElementById('statUnanswered')||{}).textContent
  })`);
  console.log("真机首页四项统计：" + stats);

  /* 3) 答题卡矩阵计数 */
  await conn.evaluate("location.href = 'answer_card.html'");
  await sleep(2500);
  page = await appPage();
  conn.ws.close();
  conn = await connect(page.webSocketDebuggerUrl);
  const matrix = await conn.evaluate(`JSON.stringify((function(){
    const cells = Array.from(document.querySelectorAll('#answerMatrix .matrix-cell'));
    const c = (cls) => cells.filter(x => x.classList.contains(cls)).length;
    return { all: cells.length, correct: c('correct'), wrong: c('wrong'), fresh: cells.length - c('correct') - c('wrong') - c('collected') };
  })())`);
  console.log("真机答题卡矩阵：" + matrix);

  /* 4) 回首页，方便截图 */
  await conn.evaluate("location.href = 'index.html'");
  await sleep(1200);
  conn.ws.close();
  console.log("已停留在首页（可截图）");
}

main().catch((e) => {
  console.error("❌ 执行失败：", e);
  process.exit(1);
});
