/**
 * 文件名称：安卓版/verify_www.mjs
 * 文件作用：
 *     在真实浏览器里验收 Android 版的网页资源（www/）——即 App 打开后看到的内容。
 *     App 页面对齐服务端版（4 个页面 + 顶部导航 + 选题面板 + 答题卡 + 设置 + 法条浏览），
 *     本脚本覆盖这些能力的端到端验收。
 *
 * 用法：node verify_www.mjs
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.join(__dirname, "www");
const SHOT_DIR = path.join(__dirname, "验证截图");
const PORT = 4199;
const BASE = `http://localhost:${PORT}/`;

const PW_CANDIDATES = [];
if (process.env.PW_PLAYWRIGHT) PW_CANDIDATES.push(process.env.PW_PLAYWRIGHT);
PW_CANDIDATES.push("file:///C:/Users/Administrator/Documents/Codex/2026-09-14/magic8-pro-chrome-edge-https-sd3247930-2/work/device-verify/node_modules/playwright/index.mjs");
PW_CANDIDATES.push("playwright");

const results = [];
const consoleErrors = [];
const pageErrors = [];

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || "" });
  console.log(`${ok ? "✅" : "❌"} [${ok ? "通过" : "失败"}] ${name}${detail ? " — " + detail : ""}`);
}

function startServer() {
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".json": "application/json; charset=utf-8"
  };
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const filePath = path.join(WWW, urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, ""));
    if (!filePath.startsWith(WWW) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404).end("404");
      return;
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(fs.readFileSync(filePath));
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  let chromium = null;
  for (const candidate of PW_CANDIDATES) {
    try {
      const mod = await import(candidate);
      chromium = mod.chromium || (mod.default && mod.default.chromium);
      if (chromium) break;
    } catch (err) { /* 下一个候选 */ }
  }
  if (!chromium) { console.error("❌ 未找到 Playwright"); process.exit(1); }

  const server = await startServer();
  const browser = await chromium.launch({ channel: "msedge" });
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true
  });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  try {
    /* --- 1. 首页：本地接口填充统计 + 导航 --- */
    await page.goto(BASE + "index.html", { waitUntil: "load" });
    await page.waitForFunction(() => {
      const el = document.getElementById("statTotal");
      return el && el.textContent.trim() === "300";
    }, { timeout: 8000 });
    check("App 标题正确", (await page.title()).indexOf("药品管理相关法规知识竞赛试题库") >= 0, await page.title());
    check("离线题库加载成功（300 题）", (await page.evaluate(() => (window.__QUESTION_BANK__ || []).length)) === 300);
    check("首页统计由本地接口填充", (await page.textContent("#statTotal")).trim() === "300",
      "总题数 " + (await page.textContent("#statTotal")).trim());
    check("首页不再有「导入旧版进度」入口", (await page.locator("#importOldBtn").count()) === 0);
    check("顶部导航 6 项", (await page.locator(".nav a").count()) === 6, `${await page.locator(".nav a").count()} 项`);
    await page.screenshot({ path: path.join(SHOT_DIR, "01-安卓版-首页.png") });

    /* --- 2. 练习页：作答 → 解析与法条 --- */
    await page.goto(BASE + "practice.html?mode=seq", { waitUntil: "load" });
    await page.waitForSelector("#questionText:not(:empty)", { timeout: 8000 });
    check("练习页进度显示 300 题", /第 \d+ \/ 300 题/.test(await page.textContent("#quizProgress")), (await page.textContent("#quizProgress")).trim());
    check("题型标签显示", ((await page.textContent("#questionType")) || "").length > 0, await page.textContent("#questionType"));
    check("选项渲染正常（≥4 个）", (await page.locator("#options .option").count()) >= 4);

    const qid = await page.evaluate(() => Number(document.getElementById("questionNo").textContent.replace(/\D/g, "")));
    const q = await page.evaluate(async (id) => (await fetch("/api/question/" + id + "?reveal=1")).json(), qid);
    for (const letter of q.answer) await page.click(`#options input[value="${letter}"]`);
    await page.click("#submitBtn");
    await page.waitForTimeout(400);
    const answered = await page.evaluate(() => ({
      result: document.getElementById("resultBox").textContent,
      shown: !document.getElementById("explainBox").classList.contains("hidden"),
      expl: document.getElementById("explainText").textContent.trim().length,
      law: document.getElementById("lawText").textContent.trim().length
    }));
    check("判分正确", answered.result.indexOf("回答正确") >= 0, answered.result);
    check("作答后自动展开解析与法条", answered.shown && answered.expl > 20 && answered.law > 20,
      `解析 ${answered.expl} 字 / 法条 ${answered.law} 字`);
    await page.screenshot({ path: path.join(SHOT_DIR, "02-安卓版-解析与法条.png") });

    /* --- 3. 背题模式 + 上一题 --- */
    await page.click("#nextBtn");
    await page.waitForTimeout(300);
    await page.click("#backModeBtn");
    await page.waitForTimeout(400);
    const back = await page.evaluate(() => ({
      on: document.getElementById("backModeBtn").classList.contains("on"),
      correct: document.querySelectorAll("#options label.correct").length,
      shown: !document.getElementById("explainBox").classList.contains("hidden")
    }));
    check("背题模式可用（高亮答案 + 显示解析）", back.on && back.correct >= 1 && back.shown);
    await page.click("#backModeBtn");
    await page.waitForTimeout(300);
    const progressBefore = await page.textContent("#quizProgress");
    await page.click("#prevBtn");
    await page.waitForTimeout(300);
    check("上一题按钮可用", (await page.textContent("#quizProgress")) !== progressBefore,
      `${progressBefore.trim()} → ${(await page.textContent("#quizProgress")).trim()}`);

    /* --- 3.5 查看法条（O2） --- */
    check("练习页显示「查看法条」按钮", (await page.locator("#lawTipBtn").count()) === 1);
    await page.click("#lawTipBtn");
    await page.waitForSelector("#lawTipSheet:not(.hidden)", { timeout: 8000 });
    const tip = await page.evaluate(() => ({
      title: document.getElementById("lawTipTitle").textContent.trim(),
      text: ((document.querySelector("#lawTipBody .lawtip-text") || {}).textContent || "").trim()
    }));
    const curQ = await page.evaluate(async () => {
      const qid = Number(document.getElementById("questionNo").textContent.replace(/\D/g, ""));
      const d = await (await fetch("/api/question/" + qid + "?reveal=1")).json();
      return { qid: qid, text: ((d.law || {}).text || "").trim() };
    });
    check("点击后弹出的是本题对应的法条（不是同一条）",
      tip.text.length > 20 && tip.text === curQ.text,
      `题号 ${curQ.qid}，弹层 ${tip.text.length} 字 / 本题 ${curQ.text.length} 字`);
    await page.screenshot({ path: path.join(SHOT_DIR, "05-安卓版-查看法条.png") });
    await page.click("#lawTipClose");
    await page.waitForTimeout(300);
    check("法条弹层可关闭", ((await page.getAttribute("#lawTipSheet", "class")) || "").includes("hidden"));
    /* 作答本题后再切题，验证控件状态随切题重置（未作答时"下一题"是隐藏的） */
    const tipQ = await page.evaluate(async () => {
      const qid = Number(document.getElementById("questionNo").textContent.replace(/\D/g, ""));
      const d = await (await fetch("/api/question/" + qid + "?reveal=1")).json();
      return d.answer.split("");
    });
    for (const letter of tipQ) await page.click(`#options input[value="${letter}"]`);
    await page.click("#submitBtn");
    await page.waitForTimeout(300);
    await page.click("#nextBtn");
    await page.waitForTimeout(400);
    check("切题后法条控件状态已重置",
      ((await page.getAttribute("#lawTipSheet", "class")) || "").includes("hidden") &&
      (await page.textContent("#lawTipBtn")).indexOf("查看法条") >= 0);

    /* --- 4. 答错 → 错题本 --- */
    const wrongLetter = await page.evaluate(() => {
      const no = Number(document.getElementById("questionNo").textContent.replace(/\D/g, ""));
      const item = (window.__QUESTION_BANK__ || []).find((x) => x.id === no);
      const letters = item.options.map((o) => o.trim().charAt(0));
      return letters.find((l) => item.answer.indexOf(l) < 0);
    });
    await page.click(`#options input[value="${wrongLetter}"]`);
    await page.click("#submitBtn");
    await page.waitForTimeout(400);
    check("答错提示正确", (await page.textContent("#resultBox")).indexOf("回答错误") >= 0);

    /* --- 5. 答题卡：统计、错题列表、选题面板 --- */
    await page.goto(BASE + "answer_card.html", { waitUntil: "load" });
    await page.waitForSelector("#wrongList .wrong-row", { timeout: 8000 });
    check("答题卡：错题本列出错题", (await page.locator("#wrongList .wrong-row").count()) >= 1);
    check("答题卡：统计由本地接口填充",
      (await page.textContent("#cardAnswered")).trim() !== "" && (await page.textContent("#cardAttempts")).trim() !== "",
      `已答 ${(await page.textContent("#cardAnswered")).trim()} / 累计 ${(await page.textContent("#cardAttempts")).trim()}`);

    await page.click("#openSelectionBtn");
    await page.waitForSelector("#selectionPanel:not(.hidden)", { timeout: 8000 });
    check("选题面板可打开", true);
    check("选题面板默认渲染 50 条", (await page.locator("#selectionList .sel-row").count()) === 50);
    await page.click('.chip:has-text("多选题")');
    await page.waitForTimeout(400);
    check("题型筛选「多选题」正确",
      await page.evaluate(() => Array.from(document.querySelectorAll("#selectionList .sel-row .badge")).every((b) => b.textContent === "多")));
    await page.click('.chip:has-text("全部")');
    await page.waitForTimeout(300);
    await page.fill("#selectionKeyword", "追溯");
    await page.waitForTimeout(500);
    const kwRows = await page.locator("#selectionList .sel-row").count();
    check("关键词筛选生效", kwRows > 0 && kwRows < 50, `命中 ${kwRows} 行`);
    await page.fill("#selectionKeyword", "");
    await page.waitForTimeout(500);

    const pickedIds = [];
    for (let i = 0; i < 3; i++) {
      pickedIds.push(Number((await page.locator("#selectionList .sel-row .sel-no").nth(i).textContent()).trim()));
      await page.click(`#selectionList .sel-row >> nth=${i}`);
      await page.waitForTimeout(120);
    }
    check("可勾选多题（无互斥限制）", (await page.textContent("#selectionCount")).indexOf("已选 3 题") >= 0);
    await page.screenshot({ path: path.join(SHOT_DIR, "03-安卓版-选题面板.png") });

    await page.click("#selStartBtn");
    await page.waitForURL(/practice\.html\?mode=custom&ids=/, { timeout: 8000 });
    await page.waitForSelector("#questionText:not(:empty)", { timeout: 8000 });
    const firstNo = await page.evaluate(() => Number(document.getElementById("questionNo").textContent.replace(/\D/g, "")));
    check("自定义练习按勾选顺序出题", firstNo === pickedIds[0], `首题 ${firstNo}，勾选 ${pickedIds.join(",")}`);
    check("自定义练习进度显示 3 题", (await page.textContent("#quizProgress")).indexOf("/ 3 题") > 0,
      (await page.textContent("#quizProgress")).trim());

    /* --- 6. 法条浏览 --- */
    await page.goto(BASE + "answer_card.html", { waitUntil: "load" });
    await page.click("#openLawBtn");
    await page.waitForSelector("#lawList:not(.hidden)", { timeout: 8000 });
    check("法条浏览：列出法条", (await page.locator("#lawList .law-row").count()) >= 1);
    await page.click("#lawList .law-title-btn >> nth=0");
    await page.waitForTimeout(600);
    const law = await page.evaluate(() => {
      const el = document.querySelector("#lawList .law-text");
      return { shown: el && !el.classList.contains("hidden"), len: el ? el.textContent.trim().length : 0 };
    });
    check("法条浏览：可展开条文原文", law.shown && law.len > 20, `条文 ${law.len} 字`);
    await page.screenshot({ path: path.join(SHOT_DIR, "04-安卓版-法条浏览.png") });
    await page.click("#lawList .law-actions button >> nth=0");
    await page.waitForURL(/practice\.html\?mode=custom&ids=/, { timeout: 8000 });
    check("法条浏览：可练习该法条下的题", true);

    /* --- 7. 设置页 --- */
    await page.goto(BASE + "settings.html", { waitUntil: "load" });
    await page.check("#setDark");
    await page.click("#saveSettingsBtn");
    await page.waitForTimeout(600);
    check("设置保存后夜间模式生效", await page.evaluate(() => document.body.classList.contains("theme-dark")));
    check("设置页提供「重置为内置题库」入口", (await page.locator("#resetBankBtn").count()) === 1);
    check("设置页不再有「重新导入题库」", (await page.locator("#reimportBtn").count()) === 0);
    await page.uncheck("#setDark");
    await page.click("#saveSettingsBtn");
    await page.waitForTimeout(400);

    /* --- 7.5 夜间模式：覆盖 + 对比度（O1 / O5） --- */
    const DARK_SELECTORS = [
      ["进度文字", ".progress"], ["概览文字", ".summary"], ["统计标签", ".stat-label"],
      ["题号", ".q-no"], ["题型标签", ".type-tag"], ["模式说明", ".mode-label"],
      ["解析标题", ".explain-title"], ["提示文字", ".hint"], ["页脚", ".footer"]
    ];
    const measureDark = () => page.evaluate((sels) => {
      function parse(rgb) {
        const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(rgb);
        return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
      }
      function lum(c) {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
      }
      function bgOf(el) {
        let node = el;
        while (node) {
          const c = parse(getComputedStyle(node).backgroundColor);
          if (c && c.a > 0.5) return c;
          node = node.parentElement;
        }
        return { r: 255, g: 255, b: 255, a: 1 };
      }
      const low = [];
      sels.forEach(([label, sel]) => {
        const el = document.querySelector(sel);
        if (!el || !el.textContent.trim()) return;
        const fg = parse(getComputedStyle(el).color);
        if (!fg) return;
        const l1 = lum(fg), l2 = lum(bgOf(el));
        const ratio = Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
        if (ratio < 4.5) low.push(label + " " + ratio + ":1");
      });
      return { dark: document.body.classList.contains("theme-dark"), low };
    }, DARK_SELECTORS);

    for (const [pageName, pageUrl] of [["首页", "index.html"], ["练习页", "practice.html?mode=seq"],
                                       ["答题卡", "answer_card.html"], ["设置页", "settings.html"]]) {
      await page.goto(BASE + pageUrl, { waitUntil: "load" });
      await page.evaluate(() => localStorage.setItem("drug_quiz_settings", JSON.stringify({ dark_mode: true })));
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(500);
      const dark = await measureDark();
      check(`${pageName}：夜间模式已启用`, dark.dark);
      check(`${pageName}：暗色下文字对比度均 ≥ 4.5:1`, dark.low.length === 0, dark.low.join("、"));
    }
    await page.goto(BASE + "settings.html", { waitUntil: "load" });
    await page.evaluate(() => localStorage.setItem("drug_quiz_settings", JSON.stringify({ dark_mode: false })));

    /* --- 8. 刷新后进度保留（App 私有存储） --- */
    const before = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("drug_quiz_data") || "{}")).length);
    await page.goto(BASE + "index.html", { waitUntil: "load" });
    await page.waitForFunction(() => document.getElementById("statAnswered") && document.getElementById("statAnswered").textContent.trim() !== "");
    const after = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("drug_quiz_data") || "{}")).length);
    check("进度持久化正常", before > 0 && before === after, `记录 ${before} 条`);

    /* --- 9. 手机尺寸无横向溢出 --- */
    const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    check("手机尺寸无横向溢出", ov.sw <= ov.cw + 1, `${ov.sw} / ${ov.cw}`);

    /* --- 10. 控制台干净度 --- */
    check("无 JS 报错", pageErrors.length === 0, pageErrors.slice(0, 2).join("；"));
    check("无控制台错误", consoleErrors.length === 0, consoleErrors.slice(0, 2).join("；"));
  } finally {
    await browser.close();
    server.close();
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log("\n============ 安卓版网页资源验收报告 ============");
  console.log(`通过 ${passed} / ${results.length} 项`);
  failed.forEach((r) => console.log("  - " + r.name + (r.detail ? "：" + r.detail : "")));
  console.log("截图目录：" + SHOT_DIR);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => { console.error("❌ 验收失败：", err); process.exit(1); });
