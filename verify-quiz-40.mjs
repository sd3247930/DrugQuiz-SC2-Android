/**
 * 文件名称：安卓版/verify-quiz-40.mjs
 * 文件作用：
 *     按「单选题 20 道 + 多选题 20 道」做一次完整作答测试，验证：
 *       1. 两种题型都能正常渲染（题型标签、题干、4 个选项）；
 *       2. 判分正确：单选按字母判、多选「完全一致才算对」；
 *       3. 每题答完都展开解析；
 *       4. 进度落盘，统计页「已答题数 40 / 正确率 100% / 错题数 0」；
 *       5. 答题卡矩阵 300 格：40 绿、0 红、260 未答；
 *       6. 附加（另开一个干净环境）：故意答错 1 单选 + 1 多选 → 错题本 +2，
 *          再到「错题练习」答对 → 自动移出错题本。
 *
 * 默认跑 HBuilderX 工程里的副本（与手机 App 的 web-view 环境一致，走 file://）；
 * 也可以用 --http 走本地服务器，或用 --dir 指定别的目录。
 *
 * 用法（在 安卓版/ 目录下执行）：
 *     node verify-quiz-40.mjs
 *     node verify-quiz-40.mjs --dir "D:\...\安卓版\www"
 *     node verify-quiz-40.mjs --http
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.join(__dirname, "验证截图");
const DEFAULT_DIR = "D:/codex code/HBuilderProjects/DrugQuiz-SC2-Android/Pharma Law Quiz Bank/hybrid/html";

/* ---- 命令行参数 ---- */
const argv = process.argv.slice(2);
const argDir = argv.indexOf("--dir") >= 0 ? argv[argv.indexOf("--dir") + 1] : "";
const useHttp = argv.includes("--http");
const DIR = path.resolve(process.env.QUIZ_DIR || argDir || DEFAULT_DIR);
const PORT = 4201;

const SINGLE_COUNT = 20;
const MULTI_COUNT = 20;

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

/** 干净浏览器环境：清掉 localStorage，保证每次跑的起点一致 */
async function newCleanPage(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  const errors = [];
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });
  return { ctx, page, errors };
}

/** 读取题库（页面里 window.__QUESTION_BANK__），返回 {全部, 单选ids(1基), 多选ids(1基)} */
async function readBank(page, base) {
  await page.goto(base + "index.html", { waitUntil: "load" });
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const bank = window.__QUESTION_BANK__ || [];
    const single = [];
    const multi = [];
    bank.forEach((q, i) => {
      if (q.type === "单选") single.push({ id: i + 1, answer: q.answer.slice(), question: q.question });
      else if (q.type === "多选") multi.push({ id: i + 1, answer: q.answer.slice(), question: q.question });
    });
    return { total: bank.length, single, multi };
  });
}

/** 答一道题：letters = 要勾选的选项字母 */
async function answerOne(page, base, id, letters) {
  await page.goto(base + `practice.html?mode=seq&q=${id}`, { waitUntil: "load" });
  await page.waitForSelector("#options .option", { timeout: 15000 });
  await page.waitForTimeout(120);
  const state = await page.evaluate(() => ({
    no: (document.getElementById("questionNo") || {}).textContent || "",
    type: (document.getElementById("questionType") || {}).textContent || "",
    text: (document.getElementById("questionText") || {}).textContent || "",
    optionCount: document.querySelectorAll("#options .option").length
  }));
  for (const letter of letters) {
    await page.click(`#options input[value="${letter}"]`);
  }
  await page.click("#submitBtn");
  await page.waitForSelector("#resultBox:not(.hidden)", { timeout: 10000 });
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({
    result: (document.getElementById("resultBox").textContent || "").trim(),
    explainShown: !document.getElementById("explainBox").classList.contains("hidden"),
    explainLen: ((document.getElementById("explainText") || {}).textContent || "").length
  }));
  return { state, after };
}

/** 从首页/答题卡读取统计与矩阵计数 */
async function readStats(page, base) {
  await page.goto(base + "index.html", { waitUntil: "load" });
  await page.waitForTimeout(500);
  const home = await page.evaluate(() => ({
    total: (document.getElementById("statTotal") || {}).textContent,
    answered: (document.getElementById("statAnswered") || {}).textContent,
    accuracy: (document.getElementById("statAccuracy") || {}).textContent,
    wrong: (document.getElementById("statWrong") || {}).textContent,
    attempts: (document.getElementById("statAttempts") || {}).textContent,
    unanswered: (document.getElementById("statUnanswered") || {}).textContent
  }));
  await page.goto(base + "answer_card.html", { waitUntil: "load" });
  await page.waitForTimeout(600);
  const matrix = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll("#answerMatrix .matrix-cell"));
    const count = (cls) => cells.filter((c) => c.classList.contains(cls)).length;
    /* 未答的格子只有 matrix-cell 一个 class（没有 "new"），所以用总数倒推 */
    const correct = count("correct");
    const wrong = count("wrong");
    const collected = count("collected");
    return { all: cells.length, correct, wrong, collected, fresh: cells.length - correct - wrong - collected };
  });
  return { home, matrix };
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
    console.error("❌ 未找到 Playwright，可用环境变量 PW_PLAYWRIGHT 指定路径");
    process.exit(1);
  }

  const server = useHttp ? await startServer(DIR) : null;
  const base = useHttp ? `http://localhost:${PORT}/` : "file:///" + DIR.replace(/\\/g, "/").replace(/ /g, "%20") + "/";
  console.log(`运行环境：${useHttp ? "http" : "file://"}（${DIR}）\n`);

  const browser = await chromium.launch(
    process.env.PW_EDGE_EXE ? { executablePath: process.env.PW_EDGE_EXE } : { channel: "msedge" }
  );

  try {
    /* ================= 一、20 单选 + 20 多选，全部答对 ================= */
    const A = await newCleanPage(browser);
    const bank = await readBank(A.page, base);
    check("题库加载正常（300 题：190 单选 / 110 多选）",
      bank.total === 300 && bank.single.length === 190 && bank.multi.length === 110,
      `共 ${bank.total} 题（单选 ${bank.single.length} / 多选 ${bank.multi.length}）`);

    const singles = bank.single.slice(0, SINGLE_COUNT);
    const multis = bank.multi.slice(0, MULTI_COUNT);
    const singleFails = [];
    const multiFails = [];
    const typeTagFails = [];
    const optionCountFails = [];

    for (const item of singles) {
      const { state, after } = await answerOne(A.page, base, item.id, item.answer);
      /* 页面上的题型标签写作「单选题」/「多选题」，这里只要求前缀匹配 */
      if (state.type.trim().indexOf("单选") !== 0) typeTagFails.push(`#${item.id} 标签为「${state.type.trim()}」`);
      if (state.optionCount < 2) optionCountFails.push(`#${item.id} 只有 ${state.optionCount} 个选项`);
      if (after.result.indexOf("回答正确") < 0 || !after.explainShown || after.explainLen < 10) {
        singleFails.push(`#${item.id}「${state.text.slice(0, 12)}…」→ ${after.result.slice(0, 30)}`);
      }
    }
    check(`单选题完成 ${singles.length} 道：全部判为「回答正确」且解析展开`,
      singleFails.length === 0, singleFails.length ? singleFails.slice(0, 3).join("；") : `${singles.length}/${singles.length} 通过`);

    for (const item of multis) {
      const { state, after } = await answerOne(A.page, base, item.id, item.answer);
      if (state.type.trim().indexOf("多选") !== 0) typeTagFails.push(`#${item.id} 标签为「${state.type.trim()}」`);
      if (state.optionCount < 2) optionCountFails.push(`#${item.id} 只有 ${state.optionCount} 个选项`);
      if (after.result.indexOf("回答正确") < 0 || !after.explainShown || after.explainLen < 10) {
        multiFails.push(`#${item.id}「${state.text.slice(0, 12)}…」→ ${after.result.slice(0, 30)}`);
      }
    }
    check(`多选题完成 ${multis.length} 道：全部判为「回答正确」且解析展开`,
      multiFails.length === 0, multiFails.length ? multiFails.slice(0, 3).join("；") : `${multis.length}/${multis.length} 通过`);

    check("题型标签正确（单选/多选分别标注）", typeTagFails.length === 0, typeTagFails.slice(0, 3).join("；"));
    check("每题都渲染出选项", optionCountFails.length === 0, optionCountFails.slice(0, 3).join("；"));

    /* 统计与答题卡 */
    const stats = await readStats(A.page, base);
    check("统计页：已答题数 = 40", stats.home.answered === "40", `实际 ${stats.home.answered}`);
    check("统计页：最近一次正确率 = 100%", stats.home.accuracy === "100%", `实际 ${stats.home.accuracy}`);
    check("统计页：错题数 = 0、累计作答次数 = 40",
      stats.home.wrong === "0" && stats.home.attempts === "40",
      `错题 ${stats.home.wrong} / 次数 ${stats.home.attempts}`);
    check("统计页：尚未作答 = 260", stats.home.unanswered === "260", `实际 ${stats.home.unanswered}`);
    check("答题卡矩阵：300 格中 40 绿 / 0 红 / 260 未答",
      stats.matrix.all === 300 && stats.matrix.correct === 40 && stats.matrix.wrong === 0 && stats.matrix.fresh === 260,
      JSON.stringify(stats.matrix));

    await A.page.goto(base + "index.html", { waitUntil: "load" });
    await A.page.waitForTimeout(500);
    await A.page.screenshot({ path: path.join(SHOT_DIR, "46-40题-统计页.png") });
    await A.page.goto(base + "answer_card.html", { waitUntil: "load" });
    await A.page.waitForTimeout(600);
    await A.page.screenshot({ path: path.join(SHOT_DIR, "47-40题-答题卡矩阵.png") });
    check("40 题作答期间无 JS 报错 / 控制台错误", A.errors.length === 0, A.errors.slice(0, 3).join("；"));
    await A.ctx.close();

    /* ================= 二、附加：错题判定与错题本（另开干净环境） ================= */
    const B = await newCleanPage(browser);
    await readBank(B.page, base);   // 只为初始化页面与题库
    const wrongSingle = bank.single[20];
    const wrongMulti = bank.multi[20];
    const wrongLetterForSingle = ["A", "B", "C", "D"].find((l) => wrongSingle.answer.indexOf(l) < 0);
    const partialMulti = [wrongMulti.answer[0]];   // 多选只选一个 → 少选应判错

    const r1 = await answerOne(B.page, base, wrongSingle.id, [wrongLetterForSingle]);
    check("单选答错时给出正确答案对照（附加）",
      r1.after.result.indexOf("回答错误") >= 0 && r1.after.result.indexOf("正确答案") >= 0,
      r1.after.result.slice(0, 40));

    const r2 = await answerOne(B.page, base, wrongMulti.id, partialMulti);
    check("多选「少选」判错，且提示正确答案（附加）",
      r2.after.result.indexOf("回答错误") >= 0 && r2.after.result.indexOf("正确答案") >= 0,
      r2.after.result.slice(0, 40));
    await B.page.screenshot({ path: path.join(SHOT_DIR, "48-错题-少选判错.png") });

    const bs = await readStats(B.page, base);
    check("错题进入错题本：错题数 = 2、矩阵 2 红（附加）",
      bs.home.wrong === "2" && bs.matrix.wrong === 2,
      `错题 ${bs.home.wrong} / 红格 ${bs.matrix.wrong}`);

    /* 到错题练习里把这两题做对 → 应自动移出错题本 */
    for (const item of [wrongSingle, wrongMulti]) {
      await B.page.goto(base + `practice.html?mode=wrong&q=${item.id}`, { waitUntil: "load" });
      await B.page.waitForSelector("#options .option", { timeout: 15000 });
      for (const letter of item.answer) {
        await B.page.click(`#options input[value="${letter}"]`);
      }
      await B.page.click("#submitBtn");
      await B.page.waitForSelector("#resultBox:not(.hidden)", { timeout: 10000 });
      await B.page.waitForTimeout(200);
    }
    const bs2 = await readStats(B.page, base);
    check("错题重练答对后自动移出错题本（附加）",
      bs2.home.wrong === "0" && bs2.matrix.wrong === 0,
      `错题 ${bs2.home.wrong} / 红格 ${bs2.matrix.wrong}`);
    await B.page.screenshot({ path: path.join(SHOT_DIR, "49-错题重练-移出错题本.png") });
    check("附加流程无 JS 报错（附加）", B.errors.length === 0, B.errors.slice(0, 3).join("；"));
    await B.ctx.close();
  } finally {
    await browser.close();
    if (server) server.close();
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log("\n============ 40 题作答测试报告 ============");
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
