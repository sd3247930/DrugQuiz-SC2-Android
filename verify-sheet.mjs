/**
 * 文件名称：安卓版/verify-sheet.mjs
 * 文件作用：
 *     验收"全屏面板（选题练习 / 法条浏览）"的安全性适配与交互，对应方案里的 SV-1～SV-9：
 *       SV-1 选题面板顶部避开状态栏/挖孔（注入 --safe-area-inset-top:34px → padding 应为 46px）
 *       SV-2 法条面板同样避开
 *       SV-3 水平滑动 80px 可关闭选题面板
 *       SV-4 水平滑动 80px 可关闭法条面板
 *       SV-5 垂直滑动 80px 不关闭
 *       SV-6 慢速滑动（>600ms）不关闭
 *       SV-7 起手点距边缘 <24px 不关闭（交给系统返回手势）
 *       SV-8 返回键（history.back）关面板且 URL 不变
 *       SV-9 ✕ 按钮仍可关闭，且关闭后 history 状态被平衡（history.state 回到 null）
 *
 * 触摸用 CDP Input.dispatchTouchEvent 真实派发，不是合成 DOM 事件。
 *
 * 用法（在 安卓版/ 目录下执行）：
 *     node verify-sheet.mjs
 *     node verify-sheet.mjs --dir "D:\...\安卓版\www"
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
const PORT = 4202;

/** 模拟 Capacitor SystemBars 注入的安全区（App 真机上是 136px/3.5 = 38.9 → 取 34px 做断言） */
const FAKE_INSET = 34;
const SHEET_PAD_BASE = 12;

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

/** 用 CDP 派发一次真实触摸滑动 */
async function swipe(cdp, { fromX, fromY, dx, dy, durationMs = 150 }) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: fromX, y: fromY }] });
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: fromX + (dx * i) / steps, y: fromY + (dy * i) / steps }]
    });
    await new Promise((r) => setTimeout(r, Math.max(1, Math.round(durationMs / steps))));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await new Promise((r) => setTimeout(r, 250));
}

async function sheetVisible(page, id) {
  return page.evaluate((sid) => {
    const el = document.getElementById(sid);
    return !!el && !el.classList.contains("hidden");
  }, id);
}

/** 打开面板（选题面板走按钮；法条面板直接调对应函数） */
async function openSheet(page, kind) {
  if (kind === "selection") {
    await page.goto(baseUrl + "answer_card.html", { waitUntil: "load" });
    await page.waitForSelector("#openSelectionBtn", { timeout: 15000 });
    await page.click("#openSelectionBtn");
    await page.waitForSelector("#selectionPanel:not(.hidden)", { timeout: 15000 });
    return "selectionPanel";
  }
  await page.goto(baseUrl + "practice.html?mode=seq", { waitUntil: "load" });
  await page.waitForSelector("#lawTipBtn", { timeout: 15000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => lawTipShow());
  await page.waitForSelector("#lawTipSheet:not(.hidden)", { timeout: 15000 });
  return "lawTipSheet";
}

let baseUrl = "";

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
  baseUrl = `http://localhost:${PORT}/`;
  console.log(`运行目录：${DIR}\n`);

  const browser = await chromium.launch(
    process.env.PW_EDGE_EXE ? { executablePath: process.env.PW_EDGE_EXE } : { channel: "msedge" }
  );

  try {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
    const cdp = await ctx.newCDPSession(page);

    /* ---------------- SV-1 / SV-2：顶部安全区 ---------------- */
    for (const kind of ["selection", "lawtip"]) {
      const sid = await openSheet(page, kind);
      /* 注入 App 里的安全区变量（Capacitor SystemBars 就是写在 documentElement 上） */
      await page.evaluate((px) => {
        document.documentElement.style.setProperty("--safe-area-inset-top", px + "px");
      }, FAKE_INSET);
      await page.waitForTimeout(150);
      const m = await page.evaluate((id) => {
        const el = document.getElementById(id);
        const cs = getComputedStyle(el);
        const header = el.querySelector(".sheet-header");
        const close = el.querySelector(".sheet-close");
        return {
          padTop: parseFloat(cs.paddingTop),
          headerTop: header ? header.getBoundingClientRect().top : -1,
          closeTop: close ? close.getBoundingClientRect().top : -1
        };
      }, sid);
      const expect = SHEET_PAD_BASE + FAKE_INSET;
      const label = kind === "selection" ? "选题面板" : "法条面板";
      check(`SV-${kind === "selection" ? 1 : 2} ${label}顶部内边距 = ${expect}px（12 + 注入的 ${FAKE_INSET}）`,
        Math.abs(m.padTop - expect) < 1, `实际 ${m.padTop}px`);
      check(`${label}标题/✕ 位于安全区下方（top ≥ ${expect}）`,
        m.headerTop >= expect - 1 && m.closeTop >= expect - 1,
        `header.top=${m.headerTop.toFixed(1)} / close.top=${m.closeTop.toFixed(1)}`);
      await page.screenshot({ path: path.join(SHOT_DIR, `50-安全区-${kind === "selection" ? "选题面板" : "法条面板"}.png`) });
      await page.click(kind === "selection" ? "#closeSelectionBtn" : "#lawTipClose");
      await page.waitForTimeout(250);
    }

    /* ---------------- SV-3 / SV-4：水平滑动关闭 ---------------- */
    for (const kind of ["selection", "lawtip"]) {
      const sid = await openSheet(page, kind);
      await swipe(cdp, { fromX: 200, fromY: 500, dx: -80, dy: 6, durationMs: 160 });
      const gone = !(await sheetVisible(page, sid));
      check(`SV-${kind === "selection" ? 3 : 4} ${kind === "selection" ? "选题" : "法条"}面板：水平滑动 80px 可关闭`, gone);
    }

    /* ---------------- SV-5：垂直滑动不关闭 ---------------- */
    {
      const sid = await openSheet(page, "selection");
      await swipe(cdp, { fromX: 200, fromY: 500, dx: 4, dy: -80, durationMs: 160 });
      check("SV-5 垂直滑动 80px 不关闭面板", await sheetVisible(page, sid));
      await page.click("#closeSelectionBtn");
      await page.waitForTimeout(250);
    }

    /* ---------------- SV-6：慢速滑动不关闭 ---------------- */
    {
      const sid = await openSheet(page, "selection");
      await swipe(cdp, { fromX: 200, fromY: 500, dx: -90, dy: 4, durationMs: 900 });
      check("SV-6 慢速滑动（>600ms）不关闭面板", await sheetVisible(page, sid));
      await page.click("#closeSelectionBtn");
      await page.waitForTimeout(250);
    }

    /* ---------------- SV-7：边缘起手不关闭（系统返回手势区） ---------------- */
    {
      const sid = await openSheet(page, "selection");
      await swipe(cdp, { fromX: 5, fromY: 500, dx: 90, dy: 4, durationMs: 160 });
      check("SV-7 起手点距边缘 <24px 不关闭（交给系统返回手势）", await sheetVisible(page, sid));
      await page.click("#closeSelectionBtn");
      await page.waitForTimeout(250);
    }

    /* ---------------- SV-8：返回键关面板且 URL 不变 ---------------- */
    {
      const sid = await openSheet(page, "selection");
      const before = await page.evaluate(() => ({ href: location.href, len: history.length, state: history.state }));
      check("面板打开时已压入一条 history（供返回键拦截）",
        before.len >= 1 && before.state && before.state.__sheet === sid,
        JSON.stringify(before.state));
      await page.evaluate(() => history.back());
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => ({ href: location.href, state: history.state, open: !!document.querySelector(".sheet:not(.hidden)") }));
      check("SV-8 返回键关闭面板", !after.open && !(await sheetVisible(page, sid)));
      check("返回键关面板后 URL 不变", after.href === before.href, after.href);
    }

    /* ---------------- SV-9：✕ 关闭 + history 状态平衡 ---------------- */
    {
      const sid = await openSheet(page, "selection");
      await page.click("#closeSelectionBtn");
      await page.waitForTimeout(400);
      const st = await page.evaluate(() => ({
        open: !!document.querySelector(".sheet:not(.hidden)"),
        state: history.state,
        body: document.body.classList.contains("sheet-open")
      }));
      check("SV-9 点 ✕ 仍可关闭面板", !st.open && !(await sheetVisible(page, sid)));
      check("点 ✕ 关闭后 history 状态被平衡（state 回到 null）", st.state === null, JSON.stringify(st.state));
      check("关闭后面板锁滚动已解除（body.sheet-open 已移除）", !st.body);
    }

    check("全程无 JS 报错 / 控制台错误", errors.length === 0, errors.slice(0, 3).join("；"));
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log("\n============ 全屏面板验收报告 ============");
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
  console.error("❌ 验收脚本执行失败：", err);
  process.exit(1);
});
