/**
 * 文件名称：安卓版/verify-quiz-200.mjs
 * 文件作用：
 *     在「自定义选题练习」里一气做完 200 题：单选 100 道 + 多选 100 道，
 *     并且**刻意包含正确与错误两种情况**（每 4 题 3 对 1 错 → 150 对 / 50 错），
 *     然后校验四项统计与答题卡矩阵：
 *       已答题数 200 ／ 最近一次正确率 75% ／ 错题数 50 ／ 累计作答次数 200 ／ 尚未作答 100
 *       矩阵：150 绿 / 50 红 / 100 未答
 *
 * 默认跑 HBuilderX 工程里的副本（即"在 HBuilderX 上"），可用 --dir 指定别的目录。
 *
 * 用法（在 安卓版/ 目录下执行）：
 *     node verify-quiz-200.mjs
 *     node verify-quiz-200.mjs --dir "D:\...\安卓版\www"
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.join(__dirname, "验证截图");
const DEFAULT_DIR = "D:/codex code/HBuilderProjects/DrugQuiz-SC2-Android/Pharma Law Quiz Bank/hybrid/html";

const argv = process.argv.slice(2);
const argDir = argv.indexOf("--dir") >= 0 ? argv[argv.indexOf("--dir") + 1] : "";
const DIR = path.resolve(process.env.QUIZ_DIR || argDir || DEFAULT_DIR);
const PORT = 4203;

const SINGLE_TARGET = 100;
const MULTI_TARGET = 100;
/** 每 4 题里 1 题故意答错 → 150 对 / 50 错（正确率 75%） */
const WRONG_EVERY = 4;

const PW_CANDIDATES = [];
if (process.env.PW_PLAYWRIGHT) PW_CANDIDATES.push(process.env.PW_PLAYWRIGHT);
PW_CANDIDATES.push(
  "file:///C:/Users/Administrator/Documents/Codex/2026-09-14/magic8-pro-chrome-edge-https-sd3247930-2/work/device-verify/node_modules/playwright/index.mjs"
);
PW_CANDIDATES.push("playwright");

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || "" });
  console.log(`${ok ? "✅" : "❌"} [${ok ? "通过" : "失败"}] ${name}${detail ? " — " + detail : ""}`);
}

function startServer(root) {
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/manifest+json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".woff2": "font/woff2"
  };
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    const filePath = path.join(root, urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, ""));
    if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404");
      return;
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(fs.readFileSync(filePath));
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  if (!fs.existsSync(DIR)) {
    console.error("❌ 目录不存在：" + DIR);
    process.exit(1);
  }

  let chromium = null;
  for (const candidate of PW_CANDIDATES) {
    try {
      const mod = await import(candidate);
      chromium = mod.chromium || (mod.default && mod.default.chromium);
      if (chromium) break;
    } catch (e) {
      /* 换下一个候选 */
    }
  }
  if (!chromium) {
    console.error("❌ 未找到 Playwright");
    process.exit(1);
  }

  const server = await startServer(DIR);
  const base = `http://localhost:${PORT}/`;
  console.log(`运行目录：${DIR}`);
  console.log(`题目组合：单选 ${SINGLE_TARGET} 道 + 多选 ${MULTI_TARGET} 道（每 ${WRONG_EVERY} 题故意答错 1 题）\n`);

  const browser = await chromium.launch(
    process.env.PW_EDGE_EXE ? { executablePath: process.env.PW_EDGE_EXE } : { channel: "msedge" }
  );

  try {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    /* 1) 读题库，挑出前 100 单选 + 前 100 多选 */
    await page.goto(base + "index.html", { waitUntil: "load" });
    await page.waitForTimeout(500);
    const bank = await page.evaluate(() => {
      const all = window.__QUESTION_BANK__ || [];
      return all.map((q, i) => ({ id: i + 1, type: q.type, answer: q.answer.slice(), question: q.question }));
    });
    const singles = bank.filter((q) => q.type === "单选").slice(0, SINGLE_TARGET);
    const multis = bank.filter((q) => q.type === "多选").slice(0, MULTI_TARGET);
    check("题库可选出 100 单选 + 100 多选",
      singles.length === SINGLE_TARGET && multis.length === MULTI_TARGET,
      `单选 ${singles.length} / 多选 ${multis.length}`);

    /* 交替排列，让两种题型都走一遍 */
    const plan = [];
    for (let i = 0; i < Math.max(singles.length, multis.length); i++) {
      if (singles[i]) plan.push({ ...singles[i], seq: plan.length + 1 });
      if (multis[i]) plan.push({ ...multis[i], seq: plan.length + 1 });
    }

    /* 2) 自定义选题练习：一次性把这 200 题作为一轮 */
    const ids = plan.map((q) => q.id).join(",");
    await page.goto(base + "practice.html?mode=custom&ids=" + encodeURIComponent(ids), { waitUntil: "load" });
    await page.waitForSelector("#options .option", { timeout: 20000 });
    const total = await page.evaluate(() => (document.getElementById("quizProgress") || {}).textContent || "");
    check("自定义选题练习已装载 200 题", total.indexOf("200") >= 0, total.trim());

    /* 3) 逐题作答 */
    const wrongLetterOf = (q) => ["A", "B", "C", "D"].find((l) => q.answer.indexOf(l) < 0);
    const stat = { single: { ok: 0, bad: 0 }, multi: { ok: 0, bad: 0 }, mismatches: [] };
    const seen = { 单选: 0, 多选: 0 };
    let done = 0;

    while (done < plan.length) {
      const cur = await page.evaluate(() => ({
        text: (document.getElementById("questionText") || {}).textContent || "",
        type: (document.getElementById("questionType") || {}).textContent || ""
      }));
      /* 自定义选题按传入 ids 的顺序出题，所以第 done 题就是 plan[done]。
         注意：题库里存在"同一题干、不同选项"的重复题（#13/#14/#55、#76/#95），
         不能按题干文本反查，否则会拿到别的题目的答案、点错选项。 */
      const q = plan[done];
      if (cur.text.trim() !== q.question.trim()) {
        stat.mismatches.push(`第 ${done + 1} 题顺序错位：页面「${cur.text.slice(0, 16)}…」≠ 题库 #${q.id}`);
      }
      /* 按题型各自计数：每 4 道单选题错 1 道、每 4 道多选题错 1 道
         → 单选 75 对/25 错、多选 75 对/25 错，合计 150 对 / 50 错 */
      seen[q.type] += 1;
      const wantWrong = seen[q.type] % WRONG_EVERY === 0;
      const letters = wantWrong
        ? (q.type === "单选" ? [wrongLetterOf(q)] : [q.answer[0]])  /* 多选只选一个 → 少选判错 */
        : q.answer;

      for (const letter of letters) {
        await page.click(`#options input[value="${letter}"]`);
      }
      await page.click("#submitBtn");
      await page.waitForSelector("#resultBox:not(.hidden)", { timeout: 10000 });
      const got = await page.evaluate(() => (document.getElementById("resultBox").textContent || "").trim());
      const ok = got.indexOf("回答正确") >= 0;
      const key = q.type === "单选" ? "single" : "multi";
      if (ok === !wantWrong) {
        if (ok) stat[key].ok += 1;
        else stat[key].bad += 1;
      } else {
        stat.mismatches.push(`#${q.id}（${q.type}，第 ${q.seq} 题）预期${wantWrong ? "错" : "对"}，实际：${got.slice(0, 30)}`);
      }
      done += 1;
      /* 进入下一题：最后一题没有"下一题"按钮 */
      const hasNext = await page.evaluate(() => {
        const b = document.getElementById("nextBtn");
        return !!b && !b.classList.contains("hidden");
      });
      if (hasNext) {
        await page.click("#nextBtn");
        await page.waitForTimeout(120);
      }
    }

    check(`单选题完成 ${SINGLE_TARGET} 道（含正确与错误）`,
      stat.single.ok + stat.single.bad === SINGLE_TARGET && stat.single.bad > 0,
      `正确 ${stat.single.ok} / 错误 ${stat.single.bad}`);
    check(`多选题完成 ${MULTI_TARGET} 道（含正确与错误）`,
      stat.multi.ok + stat.multi.bad === MULTI_TARGET && stat.multi.bad > 0,
      `正确 ${stat.multi.ok} / 错误 ${stat.multi.bad}`);
    check("判分结果与预期完全一致（无一条偏差）", stat.mismatches.length === 0,
      stat.mismatches.slice(0, 3).join("；"));

    const expectedCorrect = stat.single.ok + stat.multi.ok;
    const expectedWrong = stat.single.bad + stat.multi.bad;

    /* 4) 四项统计 */
    await page.goto(base + "index.html", { waitUntil: "load" });
    await page.waitForTimeout(600);
    const home = await page.evaluate(() => ({
      total: (document.getElementById("statTotal") || {}).textContent,
      answered: (document.getElementById("statAnswered") || {}).textContent,
      accuracy: (document.getElementById("statAccuracy") || {}).textContent,
      wrong: (document.getElementById("statWrong") || {}).textContent,
      attempts: (document.getElementById("statAttempts") || {}).textContent,
      unanswered: (document.getElementById("statUnanswered") || {}).textContent
    }));
    check("统计：已答题数 = 200", home.answered === "200", `实际 ${home.answered}`);
    check("统计：最近一次正确率 = 75%", home.accuracy === "75%", `实际 ${home.accuracy}`);
    check("统计：错题数 = 50", home.wrong === String(expectedWrong), `实际 ${home.wrong}`);
    check("统计：累计作答次数 = 200", home.attempts === "200", `实际 ${home.attempts}`);
    check("统计：尚未作答 = 100", home.unanswered === "100", `实际 ${home.unanswered}`);
    check("统计：题库总题数 = 300", home.total === "300", `实际 ${home.total}`);
    await page.screenshot({ path: path.join(SHOT_DIR, "51-200题-统计页.png") });

    /* 5) 答题卡矩阵 */
    await page.goto(base + "answer_card.html", { waitUntil: "load" });
    await page.waitForTimeout(700);
    const matrix = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll("#answerMatrix .matrix-cell"));
      const count = (cls) => cells.filter((c) => c.classList.contains(cls)).length;
      const correct = count("correct");
      const wrong = count("wrong");
      const collected = count("collected");
      return { all: cells.length, correct, wrong, collected, fresh: cells.length - correct - wrong - collected };
    });
    check("答题卡矩阵：300 格 = 150 绿 / 50 红 / 100 未答",
      matrix.all === 300 && matrix.correct === expectedCorrect && matrix.wrong === expectedWrong && matrix.fresh === 100,
      JSON.stringify(matrix));
    await page.screenshot({ path: path.join(SHOT_DIR, "52-200题-答题卡.png") });

    check("200 题作答期间无 JS 报错 / 控制台错误", errors.length === 0, errors.slice(0, 3).join("；"));

    /* 明细落盘，便于复核 */
    const detail = {
      generatedAt: new Date().toISOString(),
      dir: DIR,
      plan: plan.map((q) => ({ seq: q.seq, id: q.id, type: q.type, expect: q.seq % WRONG_EVERY === 0 ? "错" : "对" })),
      stat, home, matrix
    };
    fs.writeFileSync(path.join(SHOT_DIR, "200题作答明细.json"), JSON.stringify(detail, null, 2), "utf8");
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log("\n============ 200 题作答测试报告 ============");
  console.log(`通过 ${passed} / ${results.length} 项`);
  if (failed.length) {
    console.log("未通过：");
    failed.forEach((r) => console.log("  - " + r.name + (r.detail ? "：" + r.detail : "")));
  } else {
    console.log("全部通过");
  }
  console.log("截图目录：" + SHOT_DIR);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("❌ 测试脚本执行失败：", err);
  process.exit(1);
});
