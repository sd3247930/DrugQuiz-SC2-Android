/**
 * 文件名称：安卓版/verify_www.mjs
 * 文件作用：
 *     在真实浏览器里验收 Android 版的网页资源（www/）——即 App 打开后看到的内容。
 *     覆盖：题库加载、判分、解析与法条、背题模式、错题本、统计、刷新保留、无报错、手机尺寸无溢出。
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
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "load" });

    /* 1. 资源与题库 */
    const info = await page.evaluate(() => ({
      title: document.title,
      bank: (window.__QUESTION_BANK__ || []).length,
      stats: window.__BANK_STATS__ || null,
      size: QUESTION_BANK.length,
      hasExpl: QUESTION_BANK.every((q) => q.explanation && q.explanation.trim()),
      hasLaw: QUESTION_BANK.every((q) => q.law && q.law.text && q.law.text.trim())
    }));
    check("App 标题正确", info.title.indexOf("药品管理相关法规知识竞赛试题库") >= 0, info.title);
    check("离线题库加载成功（300 题）", info.bank === 300 && info.size === 300, `data-offline.js ${info.bank} 题 / 应用读取 ${info.size} 题`);
    check("每题均含解析与法条", info.hasExpl && info.hasLaw);
    check("顺序练习进度显示 300 题",
      (await page.textContent("#menuProgress")).indexOf("300") > 0, (await page.textContent("#menuProgress")).trim());
    await page.screenshot({ path: path.join(SHOT_DIR, "01-安卓版-主菜单.png") });

    /* 2. 作答 → 解析与法条 */
    await page.click("#btnFull");
    await page.waitForSelector("#questionText:not(:empty)", { timeout: 8000 });
    const qid = await page.evaluate(() => order[cursor]);
    const q = await page.evaluate((id) => QUESTION_BANK[id], qid);
    for (const letter of q.answer) await page.click(`#options input[value="${letter}"]`);
    await page.click("#submitBtn");
    await page.waitForTimeout(300);
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

    /* 3. 背题模式 */
    await page.click("#nextBtn");
    await page.waitForTimeout(200);
    await page.click("#backModeBtn");
    await page.waitForTimeout(300);
    const back = await page.evaluate(() => ({
      on: document.getElementById("backModeBtn").classList.contains("on"),
      correct: document.querySelectorAll("#options label.correct").length,
      shown: !document.getElementById("explainBox").classList.contains("hidden")
    }));
    check("背题模式可用（高亮答案 + 显示解析）", back.on && back.correct >= 1 && back.shown);
    await page.click("#backModeBtn");
    await page.waitForTimeout(200);

    /* 4. 答错 → 错题本 */
    const cur = await page.evaluate(() => {
      const q = QUESTION_BANK[order[cursor]];
      const letters = q.options.map((o) => o.trim().charAt(0));
      return { wrong: letters.find((l) => q.answer.indexOf(l) < 0) };
    });
    await page.click(`#options input[value="${cur.wrong}"]`);
    await page.click("#submitBtn");
    await page.waitForTimeout(300);
    check("答错提示正确", (await page.textContent("#resultBox")).indexOf("回答错误") >= 0);
    await page.click('button:has-text("返回菜单")');
    await page.click('button:has-text("查看错题本")');
    await page.waitForTimeout(300);
    const rows = await page.locator(".wrong-row").count();
    check("错题本记录错题", rows >= 1, `${rows} 行`);
    await page.screenshot({ path: path.join(SHOT_DIR, "03-安卓版-错题本.png") });

    /* 5. 统计 */
    await page.click('#wrongBook button:has-text("返回菜单")');
    await page.click('button:has-text("查看统计")');
    await page.waitForTimeout(300);
    const statsText = await page.textContent("#statsContent");
    check("统计页显示正确率与题型分项",
      statsText.indexOf("最近一次正确率") >= 0 && statsText.indexOf("单选题") >= 0,
      statsText.replace(/\s+/g, " ").slice(0, 60));
    await page.screenshot({ path: path.join(SHOT_DIR, "04-安卓版-统计页.png") });

    /* 6. 刷新后进度保留（App 内同样是本地存储） */
    const before = await page.evaluate(() => Object.keys(appData.records).length);
    await page.reload({ waitUntil: "load" });
    const after = await page.evaluate(() => Object.keys(appData.records).length);
    check("刷新后进度保留", before > 0 && before === after, `刷新前 ${before} 条 / 刷新后 ${after} 条`);

    /* 7. 手机尺寸无横向溢出 */
    const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    check("手机尺寸无横向溢出", ov.sw <= ov.cw + 1, `${ov.sw} / ${ov.cw}`);

    /* 8. 控制台干净度 */
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
