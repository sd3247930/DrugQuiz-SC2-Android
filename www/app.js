/* 由 build_www.py 从 tools/index.template.html 抽取；题库来自 data-offline.js */
/* ============================================================
   一、题库区（QUESTION_BANK）
   - 共 300 题：单选 190 题、多选 110 题
   - 每题结构：{ type: "单选"|"多选", question: "题干", options: ["A. xx", ...], answer: ["C"] }
   - answer 已按字母升序，判分时直接与所选字母比较
   - 数据来源：private/DOCTYPE html.docx，由 tools/extract-bank.py 抽取并校验
   ============================================================ */
const QUESTION_BANK = window.__QUESTION_BANK__ || [];
const BANK_SIZE = QUESTION_BANK.length;

/* ============================================================
   二、存储区（localStorage）
   - 三个固定键名，未来升级 PWA 时保持不变，避免进度丢失
   - 浏览器禁用本地存储时自动退化为"内存存储"，页面仍可正常使用
   - 所有读取失败都回退默认值，绝不抛错打断页面
   ============================================================ */
const KEY_DATA = "drug_quiz_data";         /* 顺序练习进度 + 每题作答记录 */
const KEY_WRONG = "drug_quiz_wrong";       /* 错题本 + 每题答错次数 */
const KEY_SETTINGS = "drug_quiz_settings"; /* 用户设置（练习模式等） */

/* 探测 localStorage 是否可用（隐私模式等场景可能被禁用） */
let storageAvailable = true;
try {
  window.localStorage.setItem("__drug_quiz_probe__", "1");
  window.localStorage.removeItem("__drug_quiz_probe__");
} catch (err) {
  storageAvailable = false;
}

/* 内存兜底存储：localStorage 不可用时改用内存，页面功能不受影响 */
const memoryStore = {};

/** 读取原始字符串；失败返回 null */
function readRaw(key) {
  if (storageAvailable) {
    try { return window.localStorage.getItem(key); } catch (err) { return null; }
  }
  return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
}

/** 写入原始字符串；失败静默忽略 */
function writeRaw(key, value) {
  if (storageAvailable) {
    try { window.localStorage.setItem(key, value); } catch (err) { /* 忽略写入失败 */ }
  } else {
    memoryStore[key] = value;
  }
}

/** 删除某个键 */
function removeRaw(key) {
  if (storageAvailable) {
    try { window.localStorage.removeItem(key); } catch (err) { /* 忽略 */ }
  } else {
    delete memoryStore[key];
  }
}

/** 读取 JSON；解析失败或格式非法时返回默认值 */
function loadJSON(key, fallback) {
  const raw = readRaw(key);
  if (!raw) return fallback;
  try {
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : fallback;
  } catch (err) {
    return fallback;
  }
}

/** 保存 JSON */
function saveJSON(key, obj) {
  writeRaw(key, JSON.stringify(obj));
}

/* ---------- 默认数据结构 ---------- */
function defaultData() { return { currentIndex: 0, records: {} }; }
function defaultWrong() { return { wrongIndices: [], wrongCount: {} }; }
function defaultSettings() { return { mode: "full", backMode: false }; }

/**
 * 校正答题记录结构（防止旧数据/手工改动导致页面出错）
 * records 结构：{ 题目索引: { selected: ["C"], correct: true, attempts: 2, timestamp: 1710000000000 } }
 */
function normalizeData(raw) {
  const out = defaultData();
  if (typeof raw.currentIndex === "number" && isFinite(raw.currentIndex)) {
    out.currentIndex = Math.min(Math.max(Math.floor(raw.currentIndex), 0), BANK_SIZE);
  }
  const records = raw.records;
  if (records && typeof records === "object") {
    Object.keys(records).forEach(function (key) {
      const id = Number(key);
      const item = records[key];
      if (!isFinite(id) || id < 0 || id >= BANK_SIZE || !item || typeof item !== "object") return;
      out.records[id] = {
        selected: Array.isArray(item.selected) ? item.selected.filter(function (x) { return typeof x === "string"; }) : [],
        correct: item.correct === true,
        attempts: (typeof item.attempts === "number" && item.attempts > 0) ? Math.floor(item.attempts) : 1,
        timestamp: (typeof item.timestamp === "number") ? item.timestamp : 0
      };
    });
  }
  return out;
}

/** 校正错题本结构 */
function normalizeWrong(raw) {
  const out = defaultWrong();
  const seen = {};
  if (Array.isArray(raw.wrongIndices)) {
    raw.wrongIndices.forEach(function (id) {
      if (typeof id === "number" && isFinite(id) && id >= 0 && id < BANK_SIZE && !seen[id]) {
        seen[id] = true;
        out.wrongIndices.push(id);
      }
    });
    out.wrongIndices.sort(function (a, b) { return a - b; });
  }
  if (raw.wrongCount && typeof raw.wrongCount === "object") {
    Object.keys(raw.wrongCount).forEach(function (key) {
      const n = raw.wrongCount[key];
      if (isFinite(Number(key)) && typeof n === "number" && n > 0) {
        out.wrongCount[key] = Math.floor(n);
      }
    });
  }
  return out;
}

/* 全局数据（页面加载时从本地读取，失败即用默认值） */
let appData = normalizeData(loadJSON(KEY_DATA, defaultData()));
let wrongData = normalizeWrong(loadJSON(KEY_WRONG, defaultWrong()));
let settings = Object.assign(defaultSettings(), loadJSON(KEY_SETTINGS, {}));

/* ============================================================
   三、状态区
   mode：本次练习模式 full=顺序 / random=随机 / wrong=错题
   order：本次练习的题目顺序（元素是题库索引）
   cursor：当前在 order 中的位置
   ============================================================ */
const MODE_NAME = { full: "顺序练习", random: "随机练习", wrong: "错题练习" };
let mode = "full";
let order = [];
let cursor = 0;
let selected = [];
let answered = false;
let sessionTotal = 0;   /* 本轮已作答题数 */
let sessionCorrect = 0; /* 本轮答对题数 */
let backMode = false;   /* 背题模式：直接显示答案与解析，不判题 */

/* ============================================================
   四、工具区
   ============================================================ */
/** 按 id 取元素 */
function $(id) { return document.getElementById(id); }
/** 显示某个区块 */
function show(id) { $(id).classList.remove("hidden"); }
/** 隐藏某个区块 */
function hide(id) { $(id).classList.add("hidden"); }

/** 数组洗牌（返回新数组，不修改原数组） */
function shuffleArray(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
  }
  return out;
}

/** 生成 [0, n) 的索引数组 */
function rangeArray(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(i);
  return out;
}

/** 百分比文本；分母为 0 时显示 "—" */
function formatPercent(part, total) {
  if (!total) return "—";
  return (part / total * 100).toFixed(1) + "%";
}

/** 底部轻提示 */
let toastTimer = null;
function showToast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2200);
}

/* ============================================================
   四之二、解析与背题模式
   ============================================================ */
/** 隐藏解析区域 */
function hideExplanation() {
  $("explainBox").classList.add("hidden");
  $("explainText").textContent = "";
  $("lawText").textContent = "";
}

/** 展示解析与法条依据（一律用 textContent，纯文本渲染，避免注入风险） */
function showExplanation(q) {
  const law = q.law || {};
  $("explainText").textContent = (q.explanation && q.explanation.trim()) ? q.explanation : "本题暂无解析。";
  $("lawTitle").textContent = (law.title && law.title.trim()) ? law.title : "法条依据";
  $("lawText").textContent = (law.text && law.text.trim()) ? law.text : "本题暂无收录对应法条。";
  $("explainBox").classList.remove("hidden");
}

/** 背题模式：直接标出正确答案并展示解析，不作判分 */
function revealAnswer(q) {
  const inputs = document.querySelectorAll("#options input");
  inputs.forEach(function (input) {
    input.disabled = true;
    const label = input.parentNode;
    label.classList.remove("selected");
    label.classList.add("disabled");
    if (q.answer.indexOf(input.value) >= 0) label.classList.add("correct");
  });
  const box = $("resultBox");
  box.classList.remove("hidden");
  box.className = "result ok";
  box.textContent = "背题模式：正确答案是 " + q.answer.join("") + "，直接看下方解析即可。";
  showExplanation(q);
  $("submitBtn").classList.add("hidden");
  const nextBtn = $("nextBtn");
  nextBtn.classList.remove("hidden");
  nextBtn.textContent = (cursor + 1 >= order.length) ? "完成本轮" : "下一题";
  nextBtn.onclick = nextQuestion;
}

/** 更新背题模式按钮外观 */
function updateBackModeUI() {
  const btn = $("backModeBtn");
  if (!btn) return;
  btn.textContent = backMode ? "开" : "关";
  if (backMode) { btn.classList.add("on"); } else { btn.classList.remove("on"); }
}

/** 切换背题模式（状态保存在 drug_quiz_settings，下次打开仍生效） */
function toggleBackMode() {
  backMode = !backMode;
  settings.backMode = backMode;
  saveJSON(KEY_SETTINGS, settings);
  updateBackModeUI();
  if (!$("quiz").classList.contains("hidden")) {
    renderQuestion();
  }
  showToast(backMode ? "背题模式已开启：直接显示答案与解析" : "背题模式已关闭：恢复答题判分");
}

/* ============================================================
   五、菜单区
   ============================================================ */
/** 已作答题目数（题库中至少答过一次的题目数量） */
function countAnswered() {
  return Object.keys(appData.records).length;
}

/** 最近一次作答的正确率文本 */
function latestAccuracyText() {
  let answeredCount = 0, correctCount = 0;
  Object.keys(appData.records).forEach(function (key) {
    answeredCount++;
    if (appData.records[key].correct) correctCount++;
  });
  return formatPercent(correctCount, answeredCount);
}

/** 刷新主菜单上的进度与概览文字 */
function updateMenuProgress() {
  if (appData.currentIndex >= BANK_SIZE) {
    $("menuProgress").textContent = "顺序练习：已完成全部 " + BANK_SIZE + " 题（可以重新练一轮）";
  } else {
    $("menuProgress").textContent = "当前进度：第 " + (appData.currentIndex + 1) + " 题 / 共 " + BANK_SIZE + " 题";
  }
  $("menuSummary").textContent = "已答 " + countAnswered() + " 题 · 错题 " + wrongData.wrongIndices.length +
    " 题 · 最近一次正确率 " + latestAccuracyText();
  /* 题数动态显示，避免题库变化后文案写死出错 */
  $("btnFull").textContent = "顺序做全部 " + BANK_SIZE + " 题";
}

/** 返回主菜单 */
function backToMenu() {
  hide("quiz"); hide("stats"); hide("wrongBook");
  show("menu");
  updateMenuProgress();
  window.scrollTo(0, 0);
}

/* ============================================================
   六、答题区
   ============================================================ */
/** 记录当前练习模式到设置里 */
function rememberMode(newMode) {
  mode = newMode;
  settings.mode = newMode;
  saveJSON(KEY_SETTINGS, settings);
}

/** 顺序练习：从上次进度继续 */
function startFullQuiz() {
  rememberMode("full");
  order = rangeArray(BANK_SIZE);
  sessionTotal = 0; sessionCorrect = 0;
  if (appData.currentIndex >= BANK_SIZE) {
    appData.currentIndex = 0;
    saveJSON(KEY_DATA, appData);
  }
  cursor = appData.currentIndex;
  enterQuiz();
}

/** 随机练习：打乱顺序，从第 1 题开始（不影响顺序练习的进度） */
function startRandomQuiz() {
  rememberMode("random");
  order = shuffleArray(rangeArray(BANK_SIZE));
  cursor = 0;
  sessionTotal = 0; sessionCorrect = 0;
  enterQuiz();
}

/** 错题练习：只做错题本里的题 */
function startWrongQuiz() {
  const ids = wrongData.wrongIndices.slice().sort(function (a, b) { return a - b; });
  if (ids.length === 0) {
    showToast("错题本是空的，先做一遍题目吧");
    return;
  }
  rememberMode("wrong");
  order = ids;
  cursor = 0;
  sessionTotal = 0; sessionCorrect = 0;
  enterQuiz();
}

/** 进入答题页 */
function enterQuiz() {
  hide("menu"); hide("stats"); hide("wrongBook");
  show("quiz");
  renderQuestion();
}

/** 渲染当前题目 */
function renderQuestion() {
  const qid = order[cursor];
  const q = QUESTION_BANK[qid];
  selected = [];
  answered = false;

  $("quizProgress").textContent = MODE_NAME[mode] + " · 第 " + (cursor + 1) + " / " + order.length + " 题";
  $("questionType").textContent = (q.type === "多选") ? "多选题（选全才算对）" : "单选题";
  $("questionNo").textContent = "题库第 " + (qid + 1) + " 题 / 共 " + BANK_SIZE + " 题";
  $("questionText").textContent = q.question;

  renderOptions(q);

  const box = $("resultBox");
  box.textContent = "";
  box.className = "result hidden";
  hideExplanation();
  updateBackModeUI();

  const submitBtn = $("submitBtn");
  submitBtn.classList.remove("hidden");
  submitBtn.onclick = submitAnswer;

  const nextBtn = $("nextBtn");
  nextBtn.classList.add("hidden");
  nextBtn.onclick = nextQuestion;
  nextBtn.textContent = (cursor + 1 >= order.length) ? "完成本轮" : "下一题";

  /* 背题模式：进入题目即显示答案与解析 */
  if (backMode) {
    revealAnswer(q);
  }

  window.scrollTo(0, 0);
}

/** 渲染选项（用 DOM API 创建，不使用 innerHTML，避免注入风险） */
function renderOptions(q) {
  const box = $("options");
  box.textContent = ""; /* 清空上一次的选项 */

  q.options.forEach(function (text) {
    const letter = text.trim().charAt(0);
    const label = document.createElement("label");
    label.className = "option";
    label.dataset.letter = letter;

    const input = document.createElement("input");
    input.type = (q.type === "多选") ? "checkbox" : "radio";
    input.name = "option";
    input.value = letter;
    input.addEventListener("change", onOptionChange);

    const span = document.createElement("span");
    span.textContent = text;

    label.appendChild(input);
    label.appendChild(span);
    box.appendChild(label);
  });
}

/** 选项变化时同步 selected 状态并高亮 */
function onOptionChange() {
  if (answered) return;
  const inputs = document.querySelectorAll("#options input");
  selected = [];
  inputs.forEach(function (input) {
    const label = input.parentNode;
    if (input.checked) {
      selected.push(input.value);
      label.classList.add("selected");
    } else {
      label.classList.remove("selected");
    }
  });
  selected.sort();
}

/**
 * 提交答案
 * 判分规则（已拍板 3A）：选项与正确答案完全一致才判对，多选/少选/错选都算错
 */
function submitAnswer() {
  if (answered) return;
  if (selected.length === 0) {
    showToast("请先选择答案");
    return;
  }

  const qid = order[cursor];
  const q = QUESTION_BANK[qid];
  const correct = (selected.join("") === q.answer.join(""));

  answered = true;
  sessionTotal++;
  if (correct) sessionCorrect++;

  /* 锁定选项，并标出正确答案与错选项 */
  const inputs = document.querySelectorAll("#options input");
  inputs.forEach(function (input) {
    input.disabled = true;
    const label = input.parentNode;
    label.classList.remove("selected");
    label.classList.add("disabled");
    if (q.answer.indexOf(input.value) >= 0) {
      label.classList.add("correct");
    } else if (input.checked) {
      label.classList.add("wrong");
    }
  });

  /* 结果提示 */
  const box = $("resultBox");
  box.classList.remove("hidden");
  if (correct) {
    box.className = "result ok";
    box.textContent = "回答正确！";
  } else {
    box.className = "result bad";
    box.textContent = "回答错误。正确答案：" + q.answer.join("") + "；你选的是：" + selected.join("");
  }

  /* 作答后自动展开解析与法条依据（PRD 决策 D3-A） */
  showExplanation(q);

  /* 记录成绩（最近一次 + 累计次数），答错进入错题本 */
  recordAnswer(qid, selected, correct);

  /* 错题练习中答对：自动移出错题本 */
  if (correct && mode === "wrong") {
    removeWrong(qid);
    box.textContent += " 本题已自动移出错题本。";
  }

  $("submitBtn").classList.add("hidden");
  const nextBtn = $("nextBtn");
  nextBtn.classList.remove("hidden");
  nextBtn.textContent = (cursor + 1 >= order.length) ? "完成本轮" : "下一题";
  nextBtn.onclick = nextQuestion;
}

/** 写入作答记录 */
function recordAnswer(qid, chosen, correct) {
  const prev = appData.records[qid];
  const attempts = (prev && prev.attempts) ? prev.attempts + 1 : 1;
  appData.records[qid] = {
    selected: chosen.slice(),
    correct: correct,
    attempts: attempts,
    timestamp: Date.now()
  };
  if (!correct) addWrong(qid);
  if (mode === "full") appData.currentIndex = cursor + 1;
  saveJSON(KEY_DATA, appData);
}

/** 下一题 / 完成本轮 */
function nextQuestion() {
  if (cursor + 1 >= order.length) {
    finishSession();
    return;
  }
  cursor++;
  if (mode === "full") {
    appData.currentIndex = cursor;
    saveJSON(KEY_DATA, appData);
  }
  renderQuestion();
}

/** 本轮完成：显示小结，并把按钮改成"返回菜单" */
function finishSession() {
  if (mode === "full") {
    appData.currentIndex = BANK_SIZE;
    saveJSON(KEY_DATA, appData);
  }
  $("quizProgress").textContent = MODE_NAME[mode] + " · 本轮已结束";
  $("questionType").textContent = "";
  $("questionNo").textContent = "";
  $("questionText").textContent = "本轮完成：共做 " + sessionTotal + " 题，答对 " + sessionCorrect +
    " 题，本轮正确率 " + formatPercent(sessionCorrect, sessionTotal) + "。";
  $("options").textContent = "";
  $("resultBox").classList.add("hidden");
  $("submitBtn").classList.add("hidden");

  const nextBtn = $("nextBtn");
  nextBtn.classList.remove("hidden");
  nextBtn.textContent = "返回菜单";
  nextBtn.onclick = backToMenu;
}

/* ============================================================
   七、错题区
   ============================================================ */
/** 加入错题本（错误次数 +1） */
function addWrong(qid) {
  if (wrongData.wrongIndices.indexOf(qid) < 0) {
    wrongData.wrongIndices.push(qid);
    wrongData.wrongIndices.sort(function (a, b) { return a - b; });
  }
  const key = String(qid);
  wrongData.wrongCount[key] = (wrongData.wrongCount[key] || 0) + 1;
  saveJSON(KEY_WRONG, wrongData);
}

/** 移出错题本 */
function removeWrong(qid) {
  const idx = wrongData.wrongIndices.indexOf(qid);
  if (idx >= 0) wrongData.wrongIndices.splice(idx, 1);
  delete wrongData.wrongCount[String(qid)];
  saveJSON(KEY_WRONG, wrongData);
}

/** 打开错题本页面 */
function showWrongBook() {
  hide("menu"); hide("quiz"); hide("stats");
  show("wrongBook");
  renderWrongList();
  window.scrollTo(0, 0);
}

/** 渲染错题列表 */
function renderWrongList() {
  const box = $("wrongList");
  box.textContent = "";
  const ids = wrongData.wrongIndices.slice().sort(function (a, b) { return a - b; });

  if (ids.length === 0) {
    $("wrongBookProgress").textContent = "错题本是空的，先做一遍题目吧";
    return;
  }
  $("wrongBookProgress").textContent = "错题本：共 " + ids.length + " 题";

  ids.forEach(function (qid) {
    const q = QUESTION_BANK[qid];
    const row = document.createElement("div");
    row.className = "wrong-row";

    const title = document.createElement("div");
    title.className = "wrong-title";
    title.textContent = "题库第 " + (qid + 1) + " 题 · " + q.type;

    const detail = document.createElement("div");
    detail.className = "wrong-detail";
    detail.textContent = q.question;

    const meta = document.createElement("div");
    meta.className = "wrong-meta";
    meta.textContent = "正确答案：" + q.answer.join("") + " · 累计答错 " + (wrongData.wrongCount[String(qid)] || 1) + " 次";

    const btn = document.createElement("button");
    btn.className = "btn-secondary small";
    btn.textContent = "移出错题本";
    btn.onclick = function () {
      removeWrong(qid);
      renderWrongList();
      showToast("已移出错题本");
    };

    row.appendChild(title);
    row.appendChild(detail);
    row.appendChild(meta);
    row.appendChild(btn);
    box.appendChild(row);
  });
}

/* ============================================================
   八、统计区
   统计口径（已拍板 4A）：每题按"最近一次作答"计入正确率，同时显示累计作答次数
   ============================================================ */
/** 汇总统计数据 */
function computeStats() {
  const stats = {
    answered: 0, correct: 0, attempts: 0,
    wrong: wrongData.wrongIndices.length,
    byType: { "单选": { answered: 0, correct: 0 }, "多选": { answered: 0, correct: 0 } }
  };

  Object.keys(appData.records).forEach(function (key) {
    const id = Number(key);
    const record = appData.records[key];
    if (!isFinite(id) || id < 0 || id >= BANK_SIZE || !record) return;
    const type = QUESTION_BANK[id].type;
    if (!stats.byType[type]) stats.byType[type] = { answered: 0, correct: 0 };
    stats.answered++;
    stats.attempts += record.attempts || 0;
    stats.byType[type].answered++;
    if (record.correct) {
      stats.correct++;
      stats.byType[type].correct++;
    }
  });
  return stats;
}

/** 生成一张统计卡片 */
function createStatItem(label, value) {
  const item = document.createElement("div");
  item.className = "stat-item";
  const labelEl = document.createElement("div");
  labelEl.className = "stat-label";
  labelEl.textContent = label;
  const valueEl = document.createElement("div");
  valueEl.className = "stat-value";
  valueEl.textContent = value;
  item.appendChild(labelEl);
  item.appendChild(valueEl);
  return item;
}

/** 打开统计页 */
function showStats() {
  hide("menu"); hide("quiz"); hide("wrongBook");
  show("stats");

  const s = computeStats();
  const box = $("statsContent");
  box.textContent = "";

  const grid = document.createElement("div");
  grid.className = "stat-grid";
  grid.appendChild(createStatItem("题库总题数", String(BANK_SIZE)));
  grid.appendChild(createStatItem("已答题数", String(s.answered)));
  grid.appendChild(createStatItem("最近一次正确率", formatPercent(s.correct, s.answered)));
  grid.appendChild(createStatItem("错题数", String(s.wrong)));
  grid.appendChild(createStatItem("累计作答次数", String(s.attempts)));
  grid.appendChild(createStatItem("尚未作答", String(BANK_SIZE - s.answered)));
  box.appendChild(grid);

  const singleTitle = document.createElement("div");
  singleTitle.className = "stat-section";
  singleTitle.textContent = "题型统计";
  box.appendChild(singleTitle);

  const typeGrid = document.createElement("div");
  typeGrid.className = "stat-grid";
  typeGrid.appendChild(createStatItem(
    "单选题（已答 " + s.byType["单选"].answered + " 题）",
    formatPercent(s.byType["单选"].correct, s.byType["单选"].answered)
  ));
  typeGrid.appendChild(createStatItem(
    "多选题（已答 " + s.byType["多选"].answered + " 题）",
    formatPercent(s.byType["多选"].correct, s.byType["多选"].answered)
  ));
  box.appendChild(typeGrid);

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "正确率按每题最近一次作答计算；错题重练答对后，正确率会随之提高。";
  box.appendChild(hint);

  window.scrollTo(0, 0);
}

/* ============================================================
   九、清空记录
   ============================================================ */
function resetAll() {
  const ok = window.confirm("确定清空所有记录吗？\n\n将清除：顺序练习进度、错题本、统计记录。\n此操作无法撤销。");
  if (!ok) return;

  removeRaw(KEY_DATA);
  removeRaw(KEY_WRONG);
  removeRaw(KEY_SETTINGS);

  appData = defaultData();
  wrongData = defaultWrong();
  settings = defaultSettings();
  order = [];
  cursor = 0;
  selected = [];
  answered = false;
  sessionTotal = 0;
  sessionCorrect = 0;

  hide("quiz"); hide("stats"); hide("wrongBook");
  show("menu");
  updateMenuProgress();
  showToast("已清空所有记录，可以重新开始");
}

/* ============================================================
   十、初始化区
   ============================================================ */
function init() {
  if (BANK_SIZE === 0) {
    $("menuProgress").textContent = "题库数据异常（0 题），请重新生成 index.html";
    return;
  }
  backMode = settings.backMode === true;
  updateBackModeUI();
  updateMenuProgress();
}


window.addEventListener("DOMContentLoaded", init);
