/**
 * 文件名称：安卓版/verify_hbuilder.mjs
 * 文件作用：
 *     验收 HBuilderX（uni-app 壳）工程是否装好了，对应集成方案的验收项：
 *     UV-1/UV-2/UV-3/UV-5/UV-6/UV-7（能在真实浏览器里验的部分）+ 结构检查。
 *
 *     分三段：
 *       一、工程结构：pages.json / manifest.json 可解析、字段对不对（应用名/包名/权限/图标）、
 *                    web-view 指向的文件存在、hybrid 与 static 两份副本逐字节一致、
 *                    app-shim.js 已注入、模板残留已清干净；
 *       二、H5 入口：按 pages/index/index.vue 里写的 H5 地址起本地服务，确认 iframe 目标可用；
 *       三、file:// 冒烟：App 端 web-view 就是这种环境 —— 四页渲染、答题判分、进度落盘、导出。
 *
 * 用法（在 安卓版/ 目录下执行）：
 *     node verify_hbuilder.mjs
 */

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.join(__dirname, "验证截图");

const PROJECT = process.env.HBX_PROJECT || "D:/codex code/HBuilderProjects/DrugQuiz-SC2-Android/Pharma Law Quiz Bank";
const APP_WEB = path.join(PROJECT, "hybrid", "html");
const H5_WEB = path.join(PROJECT, "static", "app-web");
const PAGES = ["index.html", "practice.html", "answer_card.html", "settings.html"];
const PORT = 4200;

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

/** HBuilderX 的 pages.json / manifest.json 允许注释，解析前先去掉 */
function parseJsonc(text) {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const noLine = noBlock.replace(/(^|[^:"'])\/\/.*$/gm, "$1");
  return JSON.parse(noLine);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function listFiles(root, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const rel = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(path.join(root, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
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

  /* ============ 一、工程结构 ============ */
  check("HBuilderX 工程存在", fs.existsSync(PROJECT), PROJECT);

  let pagesJson = null;
  let manifestJson = null;
  try {
    pagesJson = parseJsonc(fs.readFileSync(path.join(PROJECT, "pages.json"), "utf8"));
    check("pages.json 可解析", true);
  } catch (e) {
    check("pages.json 可解析", false, String(e).slice(0, 120));
  }
  try {
    manifestJson = parseJsonc(fs.readFileSync(path.join(PROJECT, "manifest.json"), "utf8"));
    check("manifest.json 可解析（含注释）", true);
  } catch (e) {
    check("manifest.json 可解析（含注释）", false, String(e).slice(0, 120));
  }

  if (pagesJson) {
    const first = (pagesJson.pages || [])[0] || {};
    check("首页为 pages/index/index", first.path === "pages/index/index", String(first.path));
    check("首页用全屏自定义导航（navigationStyle=custom）",
      first.style && first.style.navigationStyle === "custom",
      JSON.stringify((first.style || {}).navigationStyle));
  }

  if (manifestJson) {
    check("应用名为「药品法规刷题」", manifestJson.name === "药品法规刷题", String(manifestJson.name));
    check("版本号 1.5.3 / 153",
      manifestJson.versionName === "1.5.3" && String(manifestJson.versionCode) === "153",
      `${manifestJson.versionName} / ${manifestJson.versionCode}`);
    const android = (((manifestJson["app-plus"] || {}).distribute || {}).android) || {};
    check("预留云打包包名 com.drugquiz.sc2", android.packagename === "com.drugquiz.sc2", String(android.packagename));
    const permissions = android.permissions || [];
    const banned = ["CAMERA", "READ_PHONE_STATE", "GET_ACCOUNTS", "FLASHLIGHT", "WRITE_SETTINGS", "MOUNT_UNMOUNT_FILESYSTEMS", "VIBRATE", "READ_LOGS"];
    const leftovers = banned.filter((p) => permissions.some((line) => line.indexOf(p) >= 0));
    check("无用权限已裁掉（相机/电话/账户等）", leftovers.length === 0,
      leftovers.length ? "仍存在：" + leftovers.join("、") : `${permissions.length} 项：` + permissions.map((p) => (p.match(/permission\.([A-Z_]+)/) || [])[1]).join(", "));
    const statusbar = (manifestJson["app-plus"] || {}).statusbar || {};
    check("状态栏配置为深青 + 浅色图标",
      statusbar.background === "#0F5B78" && statusbar.style === "light",
      JSON.stringify(statusbar));
    const icons = ((manifestJson["app-plus"] || {}).distribute || {}).icons || {};
    const iconPaths = Object.values(icons.android || {});
    const missingIcons = iconPaths.filter((p) => !fs.existsSync(path.join(PROJECT, p)));
    check("打包图标已生成且路径有效", iconPaths.length >= 4 && missingIcons.length === 0,
      missingIcons.length ? "缺：" + missingIcons.join("、") : iconPaths.length + " 个");
  }

  /* 两份副本必须逐字节一致 */
  const appFiles = fs.existsSync(APP_WEB) ? listFiles(APP_WEB) : [];
  const h5Files = fs.existsSync(H5_WEB) ? listFiles(H5_WEB) : [];
  check("App 副本（hybrid/html）4 页齐全",
    PAGES.every((p) => appFiles.includes(p)), `${appFiles.length} 个文件`);
  check("H5 副本（static/app-web）4 页齐全",
    PAGES.every((p) => h5Files.includes(p)), `${h5Files.length} 个文件`);
  check("两份副本文件清单一致",
    appFiles.length > 0 && JSON.stringify(appFiles) === JSON.stringify(h5Files),
    `App ${appFiles.length} / H5 ${h5Files.length}`);
  let diffCount = 0;
  for (const rel of appFiles) {
    if (!h5Files.includes(rel)) continue;
    if (sha256(path.join(APP_WEB, rel)) !== sha256(path.join(H5_WEB, rel))) diffCount++;
  }
  check("两份副本逐文件哈希一致", appFiles.length > 0 && diffCount === 0, diffCount + " 个文件不一致");

  const shimMissing = PAGES.filter((p) => {
    const file = path.join(APP_WEB, p);
    return !fs.existsSync(file) || fs.readFileSync(file, "utf8").indexOf("app-shim.js") < 0;
  });
  check("app-shim.js 已注入 App 副本 4 个页面", shimMissing.length === 0,
    shimMissing.length ? "缺：" + shimMissing.join("、") : "");
  check("题库资源已带上（data-offline.js 300 题）", (() => {
    const f = path.join(APP_WEB, "data-offline.js");
    if (!fs.existsSync(f)) return false;
    const t = fs.readFileSync(f, "utf8");
    return t.indexOf("window.__QUESTION_BANK__") >= 0 && (t.match(/"type":"/g) || []).length >= 300;
  })());

  /* web-view 指向的文件必须真实存在（防止改路径后忘记同步） */
  const vueFile = path.join(PROJECT, "pages", "index", "index.vue");
  const vueText = fs.existsSync(vueFile) ? fs.readFileSync(vueFile, "utf8") : "";
  const appUrl = (vueText.match(/APP_URL\s*=\s*"([^"]+)"/) || [])[1] || "";
  const h5Url = (vueText.match(/H5_URL\s*=\s*"([^"]+)"/) || [])[1] || "";
  check("web-view 指向 /hybrid/html/index.html", appUrl === "/hybrid/html/index.html", appUrl);
  check("H5 指向 /static/app-web/index.html", h5Url === "/static/app-web/index.html", h5Url);
  check("web-view 目标文件存在", fs.existsSync(path.join(PROJECT, appUrl.replace(/^\//, ""))));
  check("H5 目标文件存在", fs.existsSync(path.join(PROJECT, h5Url.replace(/^\//, ""))));

  /* 模板残留 */
  check("pages/index/index.vue 已无模板残留（Hello / logo.png / uni-app 标题）",
    vueText.length > 0 && !/\bHello\b/.test(vueText) && vueText.indexOf("/static/logo.png") < 0);
  check("pages.json 已无模板默认标题",
    !!pagesJson && JSON.stringify(pagesJson).indexOf('"uni-app"') < 0);

  /* ============ 二、H5 入口可用（UV-5 的静态部分） ============ */
  const server = await startServer(H5_WEB);
  try {
    const res = await fetch(`http://localhost:${PORT}/index.html`);
    const html = await res.text();
    check("H5 副本可通过 http 正常返回首页", res.status === 200 && html.indexOf("药品法规刷题") >= 0,
      "HTTP " + res.status);
  } catch (e) {
    check("H5 副本可通过 http 正常返回首页", false, String(e).slice(0, 100));
  } finally {
    server.close();
  }

  /* ============ 三、file:// 冒烟（App 端 web-view 的运行环境） ============ */
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
    check("Playwright 可用", false, "未找到 Playwright，可用环境变量 PW_PLAYWRIGHT 指定");
  } else {
    const browser = await chromium.launch(
      process.env.PW_EDGE_EXE ? { executablePath: process.env.PW_EDGE_EXE } : { channel: "msedge" }
    );
    const errors = [];
    try {
      const ctx = await browser.newContext({
        viewport: { width: 393, height: 852 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true
      });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
      const base = "file:///" + APP_WEB.replace(/\\/g, "/").replace(/ /g, "%20") + "/";

      await page.goto(base + "index.html", { waitUntil: "load" });
      await page.waitForTimeout(700);
      const home = await page.evaluate(() => ({
        bank: typeof window.__QUESTION_BANK__ !== "undefined" ? window.__QUESTION_BANK__.length : 0,
        total: (document.getElementById("statTotal") || {}).textContent,
        appPaths: !!window.APP_PATHS,
        storage: (() => { try { localStorage.setItem("__t", "1"); localStorage.removeItem("__t"); return true; } catch (e) { return false; } })()
      }));
      check("file:// 首页加载（题库 300 题 + App 模式 + 本地存储可用）",
        home.bank === 300 && home.total === "300" && home.appPaths && home.storage,
        JSON.stringify(home));
      await page.screenshot({ path: path.join(SHOT_DIR, "42-HBuilderX壳-file首页.png") });

      await page.goto(base + "practice.html?mode=seq", { waitUntil: "load" });
      await page.waitForTimeout(700);
      await page.click("#options .option");
      await page.click("#submitBtn");
      await page.waitForTimeout(900);
      const quiz = await page.evaluate(() => ({
        resultShown: !document.getElementById("resultBox").classList.contains("hidden"),
        result: (document.getElementById("resultBox").textContent || "").replace(/\s+/g, " ").slice(0, 40),
        explainShown: !document.getElementById("explainBox").classList.contains("hidden"),
        stored: !!localStorage.getItem("drug_quiz_data")
      }));
      check("file:// 练习页判分 + 解析 + 进度落盘",
        quiz.resultShown && quiz.explainShown && quiz.stored, JSON.stringify(quiz));
      await page.screenshot({ path: path.join(SHOT_DIR, "43-HBuilderX壳-file练习页.png") });

      await page.goto(base + "settings.html", { waitUntil: "load" });
      await page.waitForTimeout(600);
      const exportBtn = await page.$("#exportProgressBtn");
      if (exportBtn) {
        await exportBtn.click();
        await page.waitForTimeout(1200);
        const exp = await page.evaluate(() => (document.getElementById("progressIOStatus") || {}).textContent || "");
        check("file:// 导出进度有明确反馈（剪贴板或文本框兜底）",
          exp.indexOf("剪贴板") >= 0 || exp.indexOf("复制") >= 0 || !!exp.length, exp.slice(0, 60));
      } else {
        check("file:// 导出进度有明确反馈（剪贴板或文本框兜底）", false, "设置页没有 #exportProgressBtn");
      }
      await page.screenshot({ path: path.join(SHOT_DIR, "44-HBuilderX壳-file设置页.png") });

      await page.goto(base + "answer_card.html", { waitUntil: "load" });
      await page.waitForTimeout(700);
      const card = await page.evaluate(() => ({
        cells: document.querySelectorAll("#answerMatrix .matrix-cell").length,
        answered: (document.getElementById("cardAnswered") || {}).textContent,
        hasNote: document.body.innerText.indexOf("答题卡矩阵") >= 0
      }));
      check("file:// 答题卡页正常（题号矩阵 300 格 + 统计卡有值）",
        card.cells === 300 && card.hasNote && !!card.answered,
        JSON.stringify(card));

      check("file:// 全程无 JS 报错 / 控制台错误", errors.length === 0, errors.slice(0, 3).join("；"));
      await ctx.close();
    } finally {
      await browser.close();
    }
  }

  /* ============ 四、HBuilderX 可识别性 / 环境诊断 ============
     背景：HBuilderX 的「运行」菜单是按**当前激活项目**的类型启用的。
     如果打开的不是真正的工程根（含 manifest.json + pages.json 的那一层），
     或者项目路径失效，三个运行项就会全部变灰。这一段把前提逐条查出来。 */
  const REQUIRED_ROOT_FILES = ["manifest.json", "pages.json", "App.vue", "main.js", "index.html", "uni.scss"];
  const missingRoot = REQUIRED_ROOT_FILES.filter((f) => !fs.existsSync(path.join(PROJECT, f)));
  check("项目根必备文件齐全（HBuilderX 据此判定为 uni-app 项目）",
    missingRoot.length === 0,
    missingRoot.length ? "缺：" + missingRoot.join("、") : REQUIRED_ROOT_FILES.join("、"));

  if (manifestJson) {
    check("manifest.json 的 appid 合法（__UNI__ 开头）",
      /^__UNI__[0-9A-F]{7}$/i.test(String(manifestJson.appid || "")), String(manifestJson.appid));
  }
  if (pagesJson) {
    const pageList = pagesJson.pages || [];
    const missingPages = pageList.map((p) => p.path).filter((p) => !fs.existsSync(path.join(PROJECT, p + ".vue")));
    check("pages.json 里每个页面都有对应 .vue 文件", pageList.length > 0 && missingPages.length === 0,
      missingPages.length ? "缺：" + missingPages.join("、") : pageList.length + " 个页面");
  }

  /* 嵌套层级：HBuilderX 默认只自动列出 HBuilderProjects 的一级子目录 */
  const HBX_ROOT = "D:/codex code/HBuilderProjects".replace(/\//g, path.sep);
  const depth = path.relative(HBX_ROOT, PROJECT).split(path.sep).filter(Boolean).length;
  check("项目嵌套层级已记录（是否需要手动「打开目录」）", true,
    depth > 1
      ? `位于第 ${depth} 层（父目录 ${path.basename(path.dirname(PROJECT))}）→ HBuilderX 默认只自动列出第 1 层，必须用「文件 → 打开目录」选到本项目根`
      : "位于第 1 层，HBuilderX 会自动列出");

  /* 父目录若被当成项目打开，会因为根目录没有 manifest.json/pages.json 而被判为普通目录 → 运行菜单全灰 */
  const parent = path.dirname(PROJECT);
  check("父目录不会顶替项目身份（防止把外层目录开成项目）",
    !fs.existsSync(path.join(parent, "manifest.json")),
    fs.existsSync(path.join(parent, "manifest.json"))
      ? "父目录里也有 manifest.json，容易开错"
      : `父目录「${path.basename(parent)}」里没有 manifest.json（若开成项目 → 类型为普通目录 → 运行菜单全灰）`);

  /* HBuilderX 本体与关键插件 */
  const HBX = process.env.HBX_HOME || "D:/ProgramData/HBuilderX";
  const PLUGINS = ["uniapp-cli-vite", "launcher-tools", "builtincef3browser"];
  const hasHbx = fs.existsSync(path.join(HBX, "HBuilderX.exe"));
  const missPlugins = PLUGINS.filter((p) => !fs.existsSync(path.join(HBX, "plugins", p)));
  check("HBuilderX 本体与关键插件齐全（编译器 / 手机运行 / 内置浏览器）",
    hasHbx && missPlugins.length === 0,
    hasHbx ? (missPlugins.length ? "缺：" + missPlugins.join("、") : PLUGINS.join("、")) : "没找到 HBuilderX.exe：" + HBX);

  /* adb 与已连接设备 */
  const adb = path.join(HBX, "plugins", "launcher-tools", "tools", "adbs", "adb.exe");
  if (fs.existsSync(adb)) {
    let devices = "";
    try {
      devices = execFileSync(adb, ["devices"], { encoding: "utf8" });
    } catch (e) {
      devices = "";
    }
    const online = devices.split(/\r?\n/).filter((l) => /\tdevice$/.test(l));
    /* 这一项是环境状态（没有手机时不该算项目缺陷），只作信息提示 */
    check("adb 可用（「运行到手机」的前提）", true,
      online.length ? "已连接设备 " + online.length + " 台" : "adb 正常，但当前没有设备：插线 + 开 USB 调试后该项才可点");
  } else {
    check("adb 可用（「运行到手机」的前提）", false, "没找到 HBuilderX 自带 adb：" + adb);
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log("\n============ HBuilderX 工程验收报告 ============");
  console.log(`通过 ${passed} / ${results.length} 项`);
  if (failed.length) {
    console.log("未通过：");
    failed.forEach((r) => console.log("  - " + r.name + (r.detail ? "：" + r.detail : "")));
  } else {
    console.log("全部验收项通过");
  }
  console.log("截图目录：" + SHOT_DIR);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("❌ 验收脚本执行失败：", err);
  process.exit(1);
});
