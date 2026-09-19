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
const session = { mode: "seq", list: [], index: 0, back: false, answered: false, selected: [] };

async function loadSession() {
  const box = $("quiz");
  session.mode = box.dataset.mode || "seq";
  session.back = box.dataset.back === "1";
  updateBackUI();

  let url = "/api/questions?mode=" + session.mode + "&start=1&count=500";
  if (session.mode === "custom") {
    /* 自定义选题练习（D4）：按答题卡选题面板传入的 ids 顺序出题 */
    const ids = new URLSearchParams(location.search).get("ids") || "";
    const data = await api("/api/questions?ids=" + encodeURIComponent(ids) + "&page_size=500");
    session.list = data.questions || [];
    session.index = 0;
  } else if (session.mode === "seq") {
    const progress = await api("/api/progress/all");
    const records = progress.progress || {};
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
  $("lawText").textContent = "";

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

function showExplanation(explanation, law) {
  $("explainText").textContent = (explanation && explanation.trim()) ? explanation : "本题暂无解析。";
  const l = law || {};
  $("lawTitle").textContent = (l.title && l.title.trim()) ? l.title : "法条依据";
  $("lawText").textContent = (l.text && l.text.trim()) ? l.text : "本题暂无收录对应法条。";
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
    loadSession();
  } else if (page === "home") {
    initHome();
  } else if (page === "card") {
    initCard();
  } else if (page === "settings") {
    initSettings();
  }
});

