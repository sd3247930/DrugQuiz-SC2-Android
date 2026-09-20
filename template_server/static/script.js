/* ============================================================
   服务端版前端逻辑
   与静态单文件版的区别：判分、进度、错题全部由服务端接口负责，
   前端只做渲染与交互；所有写操作都带 CSRF token。
   ============================================================ */

const CSRF = (document.querySelector('meta[name="csrf-token"]') || {}).content || "";
const MODE_LABEL = { seq: "顺序练习", random: "随机练习", wrong: "错题练习", custom: "自定义选题练习" };

/* 页面路径：服务端版是 Flask 路由（/...），安卓版是静态文件（*.html）。
   安卓版会在加载本脚本之前先用 window.APP_PATHS 覆盖，从而共用同一份前端代码。 */
const APP_PATHS = window.APP_PATHS || {
  home: "/",
  practice: function (mode) { return "/practice/" + mode; },
  custom: function (ids) { return "/practice/custom?ids=" + ids.join(","); }
};

/** 拼出「练习页 + 指定题号」的地址（服务端版 /practice/seq?q=7；App practice.html?mode=seq&q=7） */
function questionUrl(mode, qid) {
  const base = APP_PATHS.practice(mode);
  return base + (base.indexOf("?") >= 0 ? "&" : "?") + "q=" + qid;
}

/* ---------------- 通用工具 ---------------- */
function $(id) { return document.getElementById(id); }
function show(el) { if (el) el.classList.remove("hidden"); }
function hide(el) { if (el) el.classList.add("hidden"); }

let toastTimer = null;
function toast(text) {
  const el = $("toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2200);
}

/** 统一的接口请求：写操作自动带 CSRF token */
async function api(url, options) {
  const opt = options || {};
  const headers = { "Content-Type": "application/json" };
  if (opt.method === "POST") headers["X-CSRF-Token"] = CSRF;
  const res = await fetch(url, {
    method: opt.method || "GET",
    headers: headers,
    body: opt.body ? JSON.stringify(opt.body) : undefined
  });
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) {
    const message = data && data.error ? data.error : ("请求失败：" + res.status);
    throw new Error(message);
  }
  return data;
}

/** 应用服务端保存的设置（夜间模式 / 字号） */
async function applyAppearance() {
  try {
    const s = await api("/api/settings");
    document.body.classList.toggle("theme-dark", !!s.dark_mode);
    document.body.classList.remove("font-normal", "font-large", "font-xlarge");
    document.body.classList.add("font-" + (s.font_size || "large"));
  } catch (e) { /* 设置读取失败不影响使用 */ }
}

/* ---------------- 练习页 ---------------- */
const session = { mode: "seq", list: [], index: 0, back: false, answered: false, selected: [], records: {} };

async function loadSession() {
  const box = $("quiz");
  session.mode = box.dataset.mode || "seq";
  session.back = box.dataset.back === "1";
  updateBackUI();

  /* 答题卡矩阵跳题（?q=题号）：定位到指定题目，其余逻辑不变 */
  const jumpTo = Number(new URLSearchParams(location.search).get("q") || 0);

  /* 一次取回全部进度记录：顺序练习用来定位续做位置，「我的笔记」用来回显（E4） */
  try {
    const progress = await api("/api/progress/all");
    session.records = progress.progress || {};
  } catch (e) { session.records = {}; }

  let url = "/api/questions?mode=" + session.mode + "&start=1&count=500";
  if (session.mode === "custom") {
    /* 自定义选题练习（D4）：按答题卡选题面板传入的 ids 顺序出题 */
    const ids = new URLSearchParams(location.search).get("ids") || "";
    const data = await api("/api/questions?ids=" + encodeURIComponent(ids) + "&page_size=500");
    session.list = data.questions || [];
    session.index = 0;
  } else if (session.mode === "seq") {
    const records = session.records;
    const all = await api(url);
    session.list = all.questions || [];
    // 断点续做：跳到第一道未作答的题
    let startAt = session.list.length;
    for (let i = 0; i < session.list.length; i++) {
      const rec = records[String(session.list[i].index)];
      if (!rec || !rec.answered) { startAt = i; break; }
    }
    session.index = Math.min(startAt, Math.max(session.list.length - 1, 0));
  } else {
    const data = await api(url);
    session.list = data.questions || [];
    session.index = 0;
  }

  if (jumpTo) {
    const at = session.list.findIndex(function (q) { return q.index === jumpTo; });
    if (at >= 0) session.index = at;
  }

  if (!session.list.length) {
    $("quizProgress").textContent = session.mode === "wrong"
      ? "错题本是空的，先做一遍题目吧"
      : (session.mode === "custom" ? "没有可练习的题目，请返回答题卡重新选题" : "题库为空");
    hide($("submitBtn"));
    hide($("nextBtn"));
    show($("emptyHint"));
    $("emptyHint").textContent = "返回首页"
      + "："
      + (session.mode === "wrong" ? "先做一遍顺序练习，答错的题会自动进入错题本。" : "请先在设置页重新导入题库。");
    return;
  }
  renderQuestion();
}

function currentItem() { return session.list[session.index]; }

async function renderQuestion() {
  const item = currentItem();
  if (!item) return;
  await flushNote();          /* 切题前先把上一题的笔记落盘（E4） */
  session.answered = false;
  session.selected = [];

  $("quizProgress").textContent = MODE_LABEL[session.mode] + " · 第 " + (session.index + 1) + " / " + session.list.length + " 题";
  $("questionType").textContent = item.qtype + (item.qtype === "多选题" ? "（选全才算对）" : "");
  $("questionNo").textContent = "题库第 " + item.index + " 题";
  $("questionText").textContent = item.stem;

  renderOptions(item);

  const box = $("resultBox");
  box.textContent = "";
  box.className = "result hidden";
  hide($("explainBox"));
  $("explainText").textContent = "";
  if ($("explainHint")) $("explainHint").textContent = "";

  show($("submitBtn"));
  hide($("nextBtn"));
  $("nextBtn").textContent = (session.index + 1 >= session.list.length) ? "完成本轮" : "下一题";

  if (session.back) {
    await revealForBackMode();
  }

  /* 供扩展脚本（如「查看法条」）在切题后同步刷新自身状态 */
  if (typeof window.onQuestionRendered === "function") {
    window.onQuestionRendered(item);
  }

  renderNote();               /* 回显本题已有的笔记（E4） */
  window.scrollTo(0, 0);
}

function renderOptions(item) {
  const box = $("options");
  box.textContent = "";
  const multi = item.qtype === "多选题";
  (item.options || []).forEach(function (pair) {
    const letter = pair[0], text = pair[1];
    const label = document.createElement("label");
    label.className = "option";
    label.dataset.letter = letter;
    const input = document.createElement("input");
    input.type = multi ? "checkbox" : "radio";
    input.name = "option";
    input.value = letter;
    input.addEventListener("change", onOptionChange);
    const span = document.createElement("span");
    span.textContent = letter + ". " + text;
    label.appendChild(input);
    label.appendChild(span);
    box.appendChild(label);
  });
}

function onOptionChange() {
  if (session.answered) return;
  const inputs = document.querySelectorAll("#options input");
  session.selected = [];
  inputs.forEach(function (input) {
    const label = input.parentNode;
    if (input.checked) {
      session.selected.push(input.value);
      label.classList.add("selected");
    } else {
      label.classList.remove("selected");
    }
  });
  session.selected.sort();
}

function lockOptions() {
  document.querySelectorAll("#options input").forEach(function (input) {
    input.disabled = true;
    input.parentNode.classList.remove("selected");
    input.parentNode.classList.add("disabled");
  });
}

function markAnswer(answerText) {
  document.querySelectorAll("#options label").forEach(function (label) {
    const letter = label.dataset.letter;
    if (answerText.indexOf(letter) >= 0) label.classList.add("correct");
    else if (label.querySelector("input").checked) label.classList.add("wrong");
  });
}

/** 展示解析：解析区只放解析文字，法条依据改由「查看法条」按钮查看（D1/D2） */
function showExplanation(explanation) {
  $("explainText").textContent = (explanation && explanation.trim()) ? explanation : "本题暂无解析。";
  if ($("explainHint")) $("explainHint").textContent = "本题依据的法条可点上方「查看法条」查看。";
  show($("explainBox"));
}

async function submitAnswer() {
  if (session.answered) return;
  if (!session.selected.length) { toast("请先选择答案"); return; }
  const item = currentItem();
  let res;
  try {
    res = await api("/api/submit", { method: "POST", body: { qid: item.index, answer: session.selected } });
  } catch (err) {
    toast(err.message);
    return;
  }
  session.answered = true;
  lockOptions();
  markAnswer(res.answer);

  const box = $("resultBox");
  box.classList.remove("hidden");
  if (res.correct) {
    box.className = "result ok";
    box.textContent = "回答正确！";
  } else {
    box.className = "result bad";
    box.textContent = "回答错误。正确答案：" + res.answer + "；你选的是：" + res.selected.join("");
  }
  showExplanation(res.explanation, res.law);

  hide($("submitBtn"));
  show($("nextBtn"));

  // 答对后自动下一题（可选设置）
  try {
    const s = await api("/api/settings");
    if (s.auto_next && res.correct) {
      setTimeout(nextQuestion, 700);
    }
  } catch (e) { /* 忽略 */ }
}

function nextQuestion() {
  if (session.index + 1 >= session.list.length) {
    toast("本轮已完成");
    setTimeout(function () { window.location.href = APP_PATHS.home; }, 600);
    return;
  }
  session.index += 1;
  renderQuestion();
}

function prevQuestion() {
  if (session.index === 0) { toast("已经是第一题"); return; }
  session.index -= 1;
  renderQuestion();
}

async function revealForBackMode() {
  const item = currentItem();
  let data;
  try {
    data = await api("/api/question/" + item.index + "?reveal=1");
  } catch (err) { return; }
  lockOptions();
  markAnswer(data.answer || "");
  const box = $("resultBox");
  box.classList.remove("hidden");
  box.className = "result ok";
  box.textContent = "背题模式：正确答案是 " + (data.answer || "") + "，直接看下方解析即可。";
  showExplanation(data.explanation, data.law);
  hide($("submitBtn"));
  show($("nextBtn"));
}

function updateBackUI() {
  const btn = $("backModeBtn");
  if (!btn) return;
  btn.textContent = session.back ? "开" : "关";
  btn.classList.toggle("on", session.back);
}

async function toggleBackMode() {
  session.back = !session.back;
  updateBackUI();
  try { await api("/api/settings", { method: "POST", body: { back_mode: session.back } }); } catch (e) { /* 忽略 */ }
  toast(session.back ? "背题模式已开启：直接显示答案与解析" : "背题模式已关闭：恢复答题判分");
  if ($("quiz")) renderQuestion();
}

/* ---------------- 我的笔记（E4） ----------------
   写在解析下方，输入停止 700ms 或离开输入框时自动保存；
   存储走服务端的 /api/note，落在该题的进度记录 note 字段里（只写了笔记没作答不会计入已答题数）。 */
const noteState = { qid: null, timer: null, dirty: false };

/** 把当前题已有的笔记回显到输入框 */
function renderNote() {
  const box = $("noteText");
  if (!box) return;
  const item = currentItem();
  if (!item) return;
  const rec = session.records[String(item.index)] || {};
  box.value = rec.note || "";
  noteState.qid = item.index;
  noteState.dirty = false;
  if (noteState.timer) { clearTimeout(noteState.timer); noteState.timer = null; }
  if ($("noteStatus")) $("noteStatus").textContent = "";
}

/** 输入后防抖，避免每敲一个字就发一次请求 */
function scheduleNoteSave() {
  noteState.dirty = true;
  const status = $("noteStatus");
  if (status) status.textContent = "正在输入…";
  if (noteState.timer) clearTimeout(noteState.timer);
  noteState.timer = setTimeout(flushNote, 700);
}

/** 真正落盘；切题前会先调用一次，保证没来得及防抖的内容也不丢 */
async function flushNote() {
  if (noteState.timer) { clearTimeout(noteState.timer); noteState.timer = null; }
  if (!noteState.dirty || noteState.qid === null) return;
  const qid = noteState.qid;
  const box = $("noteText");
  const text = (box ? box.value : "").slice(0, 2000);
  const status = $("noteStatus");
  try {
    await api("/api/note", { method: "POST", body: { qid: qid, note: text } });
    const rec = session.records[String(qid)] || (session.records[String(qid)] = {});
    rec.note = text;
    noteState.dirty = false;
    if (status) status.textContent = text ? "笔记已保存（只存在本机）" : "笔记已清空";
  } catch (err) {
    if (status) status.textContent = "保存失败：" + err.message;
  }
}

function initNote() {
  const box = $("noteText");
  if (!box) return;
  box.addEventListener("input", scheduleNoteSave);
  box.addEventListener("blur", flushNote);
}

/* ---------------- 首页 ---------------- */
function initHome() {
  const btn = $("importOldBtn");
  if (!btn) return;
  btn.addEventListener("click", importOldProgress);
}

/** 把旧版（单文件版）在浏览器里存的进度导入服务端 */
async function importOldProgress() {
  const out = $("importOldResult");
  let data = null, wrong = null;
  try {
    data = JSON.parse(localStorage.getItem("drug_quiz_data") || "null");
    wrong = JSON.parse(localStorage.getItem("drug_quiz_wrong") || "null");
  } catch (e) { /* 无旧数据 */ }
  if (!data || !data.records) {
    out.textContent = "没有找到旧版进度（这台浏览器里没有 drug_quiz_data 记录）。";
    return;
  }
  const items = {};
  Object.keys(data.records).forEach(function (key) {
    const rec = data.records[key] || {};
    const qid = Number(key) + 1;   // 旧版用 0 起索引，服务端用 1 起题号
    items[qid] = {
      answered: true,
      correct: !!rec.correct,
      selected: rec.selected || [],
      attempts: rec.attempts || 1,
      wrong_count: 0
    };
  });
  if (wrong && Array.isArray(wrong.wrongIndices)) {
    wrong.wrongIndices.forEach(function (idx) {
      const qid = Number(idx) + 1;
      items[qid] = items[qid] || { answered: true, correct: false, selected: [], attempts: 1 };
      items[qid].wrong_count = (wrong.wrongCount && wrong.wrongCount[String(idx)]) || 1;
    });
  }
  try {
    const res = await api("/api/progress", { method: "POST", body: { items: items } });
    out.textContent = "已导入 " + res.written + " 条记录，刷新页面即可看到最新统计。";
    toast("已导入 " + res.written + " 条记录");
  } catch (err) {
    out.textContent = "导入失败：" + err.message;
  }
}

/* ---------------- 错题本 / 答题卡 ---------------- */
async function initCard() {
  renderMatrix();
  await renderWrongList();
  const clearBtn = $("clearWrongBtn");
  const exportBtn = $("exportWrongBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", async function () {
      if (!window.confirm("确定清空错题本吗？（作答记录与统计保留）")) return;
      try {
        const res = await api("/api/batch", { method: "POST", body: { action: "clear_wrong" } });
        toast("已清空 " + res.cleared + " 道错题");
        renderWrongList();
      } catch (err) { toast(err.message); }
    });
  }
  if (exportBtn) {
    exportBtn.addEventListener("click", async function () {
      try {
        const res = await api("/api/batch", { method: "POST", body: { action: "export_wrong" } });
        if (!res.count) { toast("错题本是空的"); return; }
        const blob = new Blob([JSON.stringify(res.questions, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "药品管理题库-错题导出.json";
        a.click();
        URL.revokeObjectURL(a.href);
        toast("已导出 " + res.count + " 道错题");
      } catch (err) { toast(err.message); }
    });
  }
}

async function renderWrongList() {
  const box = $("wrongList");
  if (!box) return;
  let data;
  try { data = await api("/api/wrong"); } catch (err) { box.textContent = err.message; return; }
  box.textContent = "";
  const total = data.total || 0;
  if ($("wrongBookProgress")) {
    $("wrongBookProgress").textContent = total ? ("错题本：共 " + total + " 题") : "错题本是空的，先做一遍题目吧";
  }
  if ($("wrongTotal")) $("wrongTotal").textContent = total;

  (data.questions || []).forEach(function (q) {
    const row = document.createElement("div");
    row.className = "wrong-row";
    const title = document.createElement("div");
    title.className = "wrong-title";
    title.textContent = "题库第 " + q.index + " 题 · " + q.qtype;
    const detail = document.createElement("div");
    detail.className = "wrong-detail";
    detail.textContent = q.stem;
    const meta = document.createElement("div");
    meta.className = "wrong-meta";
    meta.textContent = "正确答案：" + (q.answer || "") + " · 累计答错 " + (q.wrong_count || 0) + " 次";
    row.appendChild(title);
    row.appendChild(detail);
    row.appendChild(meta);
    box.appendChild(row);
  });
}

/* ---------------- 进度导出 / 导入（E2：备份、换设备、跨版本迁移） ----------------
   导出文件与「静态单文件版」通用：progress 一律以「1 起的题号」做键、统一字段名。
   导入策略由用户当场选：确定 = 覆盖，取消 = 与当前进度合并（每题保留作答次数更多的记录）。 */
const PROGRESS_FILE_VERSION = 1;

/** 导出文件名：drugquiz-progress-YYYYMMDD.json */
function progressFileName() {
  const d = new Date();
  const p = function (n) { return String(n).padStart(2, "0"); };
  return "drugquiz-progress-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + ".json";
}

/** 触发浏览器下载一个 JSON 文件 */
function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

/** 只保留结构合法的记录，避免坏文件把本地进度搞脏 */
function sanitizeProgress(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  Object.keys(raw).forEach(function (key) {
    const qid = Number(key);
    const rec = raw[key];
    if (!isFinite(qid) || qid < 1 || !rec || typeof rec !== "object") return;
    out[String(qid)] = {
      answered: !!rec.answered,
      correct: rec.correct === true,
      selected: Array.isArray(rec.selected)
        ? rec.selected.filter(function (x) { return typeof x === "string"; }) : [],
      attempts: Math.max(0, Math.floor(Number(rec.attempts) || 0)),
      wrong_count: Math.max(0, Math.floor(Number(rec.wrong_count) || 0)),
      collected: !!rec.collected,
      note: typeof rec.note === "string" ? rec.note : ""
    };
  });
  return out;
}

/** 合并两份进度：每题保留作答次数更多的一条；错题次数与收藏取并集 */
function mergeProgress(current, incoming) {
  const out = {};
  Object.keys(current).forEach(function (k) { out[k] = current[k]; });
  Object.keys(incoming).forEach(function (k) {
    const a = out[k], b = incoming[k];
    if (!a) { out[k] = b; return; }
    const newer = (b.attempts || 0) > (a.attempts || 0) ? b : a;
    out[k] = {
      answered: !!(a.answered || b.answered),
      correct: !!newer.correct,
      selected: newer.selected || [],
      attempts: Math.max(a.attempts || 0, b.attempts || 0),
      wrong_count: Math.max(a.wrong_count || 0, b.wrong_count || 0),
      collected: !!(a.collected || b.collected),
      note: a.note || b.note || ""
    };
  });
  return out;
}

/** 导出进度 + 设置，返回导出内容（便于调用方提示条数） */
async function exportProgress() {
  const all = await api("/api/progress/all");
  let settings = {};
  try { settings = await api("/api/settings"); } catch (e) { /* 设置读不到不影响导出进度 */ }
  const payload = {
    version: PROGRESS_FILE_VERSION,
    app: "DrugQuiz-SC2",
    source: window.APP_PATHS ? "android" : "server",
    exportedAt: new Date().toISOString(),
    progress: all.progress || {},
    settings: settings || {}
  };
  const how = await deliverExport(payload);
  return { payload: payload, delivered: how, count: Object.keys(payload.progress).length };
}

/** 交付导出结果：网页端直接下载；App（Capacitor WebView）不支持 a[download]，改用剪贴板兜底 */
async function deliverExport(payload) {
  const text = JSON.stringify(payload, null, 2);
  if (!window.APP_PATHS) {
    downloadJson(payload, progressFileName());
    return "download";
  }
  try {
    await navigator.clipboard.writeText(text);
    return "clipboard";
  } catch (e) {
    /* 剪贴板也不可用时，退到只读文本框，方便长按全选复制
       （不用 window.prompt：Capacitor 的桥接会拦截 prompt） */
    showExportText(text);
    return "textarea";
  }
}

/** 把导出的 JSON 放进只读文本框并全选 */
function showExportText(text) {
  const wrap = $("progressIOStatus");
  if (!wrap) return;
  let box = $("progressExportText");
  if (!box) {
    box = document.createElement("textarea");
    box.id = "progressExportText";
    box.readOnly = true;
    box.rows = 6;
    box.style.width = "100%";
    box.style.fontSize = "12px";
    box.style.marginTop = "8px";
    wrap.parentNode.insertBefore(box, wrap.nextSibling);
  }
  box.value = text;
  box.focus();
  box.select();
}

/** 导入进度：确定 = 覆盖，取消 = 合并 */
async function importProgress(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || !data.progress) {
    throw new Error("文件格式不正确：缺少 progress 字段");
  }
  const incoming = sanitizeProgress(data.progress);
  const count = Object.keys(incoming).length;
  if (!count) throw new Error("文件里没有可导入的作答记录");

  const overwrite = window.confirm(
    "导入进度（共 " + count + " 题）：\n\n" +
    "点「确定」= 用文件里的进度覆盖当前进度\n" +
    "点「取消」= 与当前进度合并（每题保留作答次数更多的记录）"
  );

  let items = incoming;
  if (overwrite) {
    await api("/api/batch", { method: "POST", body: { action: "clear_all" } });
  } else {
    const cur = (await api("/api/progress/all")).progress || {};
    items = mergeProgress(cur, incoming);
  }
  const res = await api("/api/progress", { method: "POST", body: { items: items } });
  if (data.settings && typeof data.settings === "object") {
    try { await api("/api/settings", { method: "POST", body: data.settings }); } catch (e) { /* 忽略 */ }
  }
  applyAppearance();
  return { written: res.written, mode: overwrite ? "覆盖" : "合并" };
}

/* ---------------- 答题卡题号矩阵（设计稿 04 页 / 待办 P2=A） ---------------- */
const MATRIX_BATCH = 100;   /* 分块渲染：每批 100 格，300 题也不会卡顿 */

/** 单题状态：口径与后端 status_of() 保持一致 */
function matrixStatus(rec) {
  if (!rec) return "new";
  if (rec.wrong_count) return "wrong";
  if (rec.answered) return rec.correct ? "correct" : "wrong";
  return "new";
}

/** 渲染 300 格题号矩阵：点击格子跳到对应题目（第 4 步） */
async function renderMatrix() {
  const box = $("answerMatrix");
  if (!box) return;                       /* 不是答题卡页就直接返回 */
  const hint = $("matrixHint");
  let listData, progressData;
  try {
    listData = await api("/api/questions?mode=seq&page_size=500");
    progressData = await api("/api/progress/all");
  } catch (err) {
    if (hint) hint.textContent = "题号矩阵加载失败：" + err.message;
    return;
  }

  const records = (progressData && progressData.progress) || {};
  const list = listData.questions || [];
  box.textContent = "";

  let cursor = 0, answered = 0, correct = 0, wrong = 0, collected = 0;

  function renderBatch() {
    const frag = document.createDocumentFragment();
    const end = Math.min(cursor + MATRIX_BATCH, list.length);
    for (; cursor < end; cursor++) {
      const q = list[cursor];
      const rec = records[String(q.index)];
      const status = matrixStatus(rec);
      if (rec && rec.answered) answered++;
      if (status === "correct") correct++;
      if (status === "wrong") wrong++;
      if (q.collected) collected++;

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "matrix-cell" + (status === "new" ? "" : " " + status);
      cell.dataset.qid = q.index;
      cell.dataset.status = status;
      cell.textContent = q.index;
      cell.title = "题库第 " + q.index + " 题（"
        + (status === "correct" ? "已答对" : status === "wrong" ? "做错过" : "未作答") + "）";
      if (q.collected) {
        const star = document.createElement("span");
        star.className = "matrix-star";
        star.textContent = "★";          /* 收藏只加角标，不改格子底色 */
        cell.appendChild(star);
      }
      cell.addEventListener("click", function () {
        window.location.href = questionUrl("seq", q.index);
      });
      frag.appendChild(cell);
    }
    box.appendChild(frag);

    if (cursor < list.length) {
      window.requestAnimationFrame(renderBatch);
    } else if (hint) {
      hint.textContent = "共 " + list.length + " 题 · 已答 " + answered + " · 答对 " + correct
        + " · 答错 " + wrong + (collected ? " · 收藏 " + collected : "")
        + "；点击题号跳到该题。";
    }
  }
  renderBatch();
}

/* ---------------- 设置页 ---------------- */
function initSettings() {
  const save = $("saveSettingsBtn");
  if (save) {
    save.addEventListener("click", async function () {
      try {
        await api("/api/settings", {
          method: "POST",
          body: {
            back_mode: $("setBackMode").checked,
            dark_mode: $("setDark").checked,
            font_size: $("setFont").value,
            auto_next: $("setAutoNext").checked
          }
        });
        applyAppearance();
        toast("设置已保存");
      } catch (err) { toast(err.message); }
    });
  }
  const reimport = $("reimportBtn");
  if (reimport) {
    reimport.addEventListener("click", async function () {
      const out = $("reimportResult");
      out.textContent = "正在重新导入…";
      try {
        const res = await api("/api/import", { method: "POST", body: {} });
        out.textContent = "导入完成：共 " + res.total + " 题（" + JSON.stringify(res.counts) + "）";
        toast("题库已重新导入");
      } catch (err) { out.textContent = "导入失败：" + err.message; }
    });
  }
  const clearAll = $("clearAllBtn");
  if (clearAll) {
    clearAll.addEventListener("click", async function () {
      if (!window.confirm("确定清空所有记录吗？\n\n将清除全部作答进度、错题本与收藏，无法撤销。")) return;
      try {
        await api("/api/batch", { method: "POST", body: { action: "clear_all" } });
        toast("已清空所有记录");
        setTimeout(function () { window.location.href = APP_PATHS.home; }, 700);
      } catch (err) { toast(err.message); }
    });
  }

  /* 进度导出 / 导入（E2） */
  const exportBtn = $("exportProgressBtn");
  if (exportBtn) {
    exportBtn.addEventListener("click", async function () {
      const out = $("progressIOStatus");
      try {
        const res = await exportProgress();
        let tip;
        if (res.delivered === "download") {
          tip = "已导出 " + res.count + " 条作答记录（含设置），请在下载目录查看。";
        } else if (res.delivered === "clipboard") {
          tip = "已复制 " + res.count + " 条作答记录到剪贴板（App 内无法直接保存文件，可粘贴到备忘录保存）。";
        } else {
          tip = "App 内无法直接保存文件，已把 " + res.count + " 条作答记录放到下面文本框，长按全选复制后自行保存。";
        }
        if (out) out.textContent = tip;
        toast(res.delivered === "download" ? "进度已导出"
          : (res.delivered === "clipboard" ? "进度已复制到剪贴板" : "进度已生成，请复制文本框内容"));
      } catch (err) {
        if (out) out.textContent = "导出失败：" + err.message;
        toast(err.message);
      }
    });
  }
  const importBtn = $("importProgressBtn");
  const importFile = $("importProgressFile");
  if (importBtn && importFile) {
    importBtn.addEventListener("click", function () { importFile.click(); });
    importFile.addEventListener("change", async function () {
      const file = importFile.files && importFile.files[0];
      if (!file) return;
      const out = $("progressIOStatus");
      try {
        const res = await importProgress(await file.text());
        if (out) out.textContent = "已" + res.mode + "导入 " + res.written + " 条作答记录。";
        toast("进度已导入（" + res.mode + "）");
      } catch (err) {
        if (out) out.textContent = "导入失败：" + err.message;
        toast(err.message);
      } finally {
        importFile.value = "";       /* 允许重复选择同一个文件 */
      }
    });
  }
}

/* ---------------- 入口 ---------------- */
document.addEventListener("DOMContentLoaded", function () {
  applyAppearance();
  const page = window.PAGE;
  if (page === "practice") {
    $("submitBtn").addEventListener("click", submitAnswer);
    $("nextBtn").addEventListener("click", nextQuestion);
    const prev = $("prevBtn");
    if (prev) prev.addEventListener("click", prevQuestion);
    $("backModeBtn").addEventListener("click", toggleBackMode);
    initNote();
    loadSession();
  } else if (page === "home") {
    initHome();
  } else if (page === "card") {
    initCard();
  } else if (page === "settings") {
    initSettings();
  }
});

// PWA：仅在 http/https 下注册（file:// 直接打开时自动跳过）
if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/static/sw.js").catch(function () { /* 忽略 */ });
  });
}
