/* ============================================================
   本地接口垫片（local-api.js）
   作用：安卓版没有 Flask 后端，本文件把服务端版的 14 个 /api/* 接口
        在本地实现（数据来自 window.__QUESTION_BANK__ + localStorage），
        并在加载 script.js 之前覆盖 window.APP_PATHS（页面路径）。

   与服务端版的对应关系：
     /api/questions            → 题库查询（模式 / 筛选 / ids / 分页 / reveal）
     /api/selection/meta       → 选题面板元数据
     /api/question/<id>        → 单题
     /api/submit               → 判分（多选完全一致才判对）
     /api/progress, /all       → 作答进度读写
     /api/wrong                → 错题列表
     /api/collect, /api/note   → 收藏 / 笔记
     /api/batch                → 批量：导出错题 / 清空错题 / 清空全部
     /api/stats                → 统计（最近一次正确率口径）
     /api/settings (GET/POST)  → 设置
     /api/law/index, /api/law/<标题> → 法条索引与条文
     /api/import               → App 内题库为内置，返回内置题库信息（不改变数据）

   存储键（沿用静态单文件版，升级不丢进度）：
     drug_quiz_data     作答进度（服务端版同结构）
     drug_quiz_settings 设置
     drug_quiz_selection 选题面板状态
   ============================================================ */

(function () {
  "use strict";

  const DATA_KEY = "drug_quiz_data";
  const WRONG_KEY = "drug_quiz_wrong";       /* 旧版键，仅用于一次性迁移 */
  const SETTINGS_KEY = "drug_quiz_settings";
  const SELECTION_KEY = "drug_quiz_selection";
  const BANK_KEY = "drug_quiz_bank";         /* 新增（M1）：当前选中的题库 id */
  const DEFAULT_BANK = "药品法规";            /* 老数据迁移的目标桶（M2） */

  const DEFAULT_SETTINGS = {
    mode: "seq", back_mode: false, font_size: "large", dark_mode: false, auto_next: false
  };

  /* ---------------- 存储 ---------------- */
  function safeGet(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 隐私模式等忽略 */ }
  }
  function safeDel(key) {
    try { localStorage.removeItem(key); } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 多题库：当前题库与分桶（M1） ----------------
     键名一个都没改（drug_quiz_data / drug_quiz_wrong / … 保持不变），
     只把**内部结构**从「平铺」改成「按题库分桶」：
       drug_quiz_data = { "药品法规": { "1": {...} }, "软考-架构师": { ... } }
       drug_quiz_wrong = { "药品法规": [1,5] }   ← 旧键，仅迁移期使用
     设置/选题仍是全局，不分桶（字号、夜间模式是全局偏好）。 */

  function bankList() {
    const idx = window.__BANK_INDEX__;
    return (idx && idx.banks) ? idx.banks : [];
  }
  function getCurrentBank() {
    const saved = safeGet(BANK_KEY);
    const ids = bankList().map(function (b) { return b.id; });
    if (saved && (ids.length === 0 || ids.indexOf(saved) >= 0)) return saved;
    const idx = window.__BANK_INDEX__;
    return (idx && idx.default) || DEFAULT_BANK;
  }
  function setCurrentBank(id) {
    safeSet(BANK_KEY, id);
  }

  function loadProgress() {
    const all = safeGet(DATA_KEY);
    if (!all || typeof all !== "object" || Array.isArray(all)) return {};
    const cur = all[getCurrentBank()];
    return (cur && typeof cur === "object" && !Array.isArray(cur)) ? cur : {};
  }
  function saveProgress(progress) {
    const all = safeGet(DATA_KEY);
    const bag = (all && typeof all === "object" && !Array.isArray(all)) ? all : {};
    bag[getCurrentBank()] = progress;
    safeSet(DATA_KEY, bag);
  }
  /* 指定桶写入：老数据（静态版的 300 题进度）永远属于「药品法规」，
     不能因为当前选的是软考题库就写进软考桶（踩过这个坑）。 */
  function saveProgressToBank(bankId, progress) {
    const all = safeGet(DATA_KEY);
    const bag = (all && typeof all === "object" && !Array.isArray(all)) ? all : {};
    bag[bankId] = progress;
    safeSet(DATA_KEY, bag);
  }

  /** M2：把老版本的平铺数据一次性迁移到「药品法规」分桶（幂等） */
  function migrateStorageIfNeeded() {
    const raw = safeGet(DATA_KEY);
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const keys = Object.keys(raw);
      // 老结构 = 键是纯数字题号；新结构 = 键是题库 id
      const looksOld = keys.length > 0 && keys.every(function (k) { return /^\d+$/.test(k); });
      if (looksOld) {
        const migrated = {};
        migrated[DEFAULT_BANK] = raw;
        safeSet(DATA_KEY, migrated);
        if (window.__BANK_ENABLE_LOG__) {
          console.log("[bank] 老进度已迁移到「" + DEFAULT_BANK + "」分桶");
        }
      }
    }
    // 旧错题键：数组 → 分桶对象（迁移期用，新代码不再读写该键）
    const wrong = safeGet(WRONG_KEY);
    if (Array.isArray(wrong)) {
      const migratedWrong = {};
      migratedWrong[DEFAULT_BANK] = wrong;
      safeSet(WRONG_KEY, migratedWrong);
    }
    if (!safeGet(BANK_KEY)) setCurrentBank(DEFAULT_BANK);
  }

  function loadSettings() {
    return Object.assign({}, DEFAULT_SETTINGS, safeGet(SETTINGS_KEY) || {});
  }
  function saveSettings(settings) { safeSet(SETTINGS_KEY, settings); }

  /* ---------------- 旧版进度迁移（一次性） ---------------- */
  function migrateLegacyProgress() {
    const data = safeGet(DATA_KEY);
    if (!data || !data.records) return;          /* 已是新结构或无数据 */
    const progress = {};
    Object.keys(data.records).forEach(function (key) {
      const rec = data.records[key] || {};
      const qid = String(Number(key) + 1);        /* 旧版 0 起索引 → 服务端 1 起题号 */
      progress[qid] = {
        answered: true,
        correct: !!rec.correct,
        selected: rec.selected || [],
        attempts: rec.attempts || 1,
        wrong_count: 0,
        collected: false,
        note: ""
      };
    });
    const wrong = safeGet(WRONG_KEY);
    if (wrong && Array.isArray(wrong.wrongIndices)) {
      wrong.wrongIndices.forEach(function (idx) {
        const qid = String(Number(idx) + 1);
        if (!progress[qid]) {
          progress[qid] = { answered: true, correct: false, selected: [], attempts: 1, collected: false, note: "" };
        }
        progress[qid].wrong_count = (wrong.wrongCount && wrong.wrongCount[String(idx)]) || 1;
      });
    }
    saveProgressToBank(DEFAULT_BANK, progress);
  }

  /* ---------------- 题库：读当前题库（多题库，M1）---------------- */
  function bank() {
    const id = getCurrentBank();
    const all = window.__QUESTION_BANKS__;
    if (all && all[id]) return all[id];
    return window.__QUESTION_BANK__ || [];   /* 兼容：单题库构建产物 */
  }

  /* 暴露给 bank-selector.js（M4）与调试 */
  window.__BANK_API__ = {
    list: bankList,
    current: getCurrentBank,
    set: setCurrentBank,
    switchTo: function (id) {
      if (id === getCurrentBank()) return false;
      setCurrentBank(id);
      window.location.reload();     /* 刷新页面重载题库与进度，等价于 SPA 内切库 */
      return true;
    }
  };

  /** 把题库字段（静态版命名）转成接口字段（服务端版命名） */
  function toApi(q) {
    return {
      index: q.id,
      qtype: q.type === "多选" ? "多选题" : "单选题",
      stem: q.question || "",
      options: (q.options || []).map(function (opt) {
        const m = /^\s*([A-E])[.．、]?\s*(.*)$/.exec(opt);
        return m ? [m[1], m[2]] : ["", opt];
      }),
      answer: (q.answer || []).join(""),
      explanation: q.explanation || "",
      law: q.law || { title: "", text: "" }
    };
  }
  function byId(id) {
    const list = bank();
    for (let i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return toApi(list[i]);
    }
    return null;
  }

  /** 单题状态：new / correct / wrong / collected */
  function statusOf(qid, progress) {
    const item = progress[String(qid)] || {};
    if (item.wrong_count) return "wrong";
    if (item.collected) return "collected";
    if (item.answered) return item.correct ? "correct" : "wrong";
    return "new";
  }

  function computeStats() {
    const questions = bank();
    const progress = loadProgress();
    const stats = {
      total: questions.length, answered: 0, correct: 0, wrong: 0, attempts: 0,
      by_type: { "单选题": { answered: 0, correct: 0, accuracy: null },
                 "多选题": { answered: 0, correct: 0, accuracy: null } }
    };
    questions.forEach(function (q) {
      const item = progress[String(q.id)];
      if (!item || !item.answered) return;
      const qtype = q.type === "多选" ? "多选题" : "单选题";
      const bucket = stats.by_type[qtype];
      stats.answered += 1;
      stats.attempts += Number(item.attempts || 0);
      bucket.answered += 1;
      if (item.correct) {
        stats.correct += 1;
        bucket.correct += 1;
      }
      if (item.wrong_count) stats.wrong += 1;
    });
    stats.accuracy = stats.answered ? Math.round(stats.correct / stats.answered * 1000) / 10 : null;
    stats.unanswered = stats.total - stats.answered;
    Object.keys(stats.by_type).forEach(function (k) {
      const b = stats.by_type[k];
      b.accuracy = b.answered ? Math.round(b.correct / b.answered * 1000) / 10 : null;
    });
    return stats;
  }

  /* ---------------- 路由 ---------------- */
  function ok(body) {
    return { ok: true, status: 200, json: function () { return Promise.resolve(body); } };
  }
  function fail(status, message) {
    return { ok: false, status: status, json: function () { return Promise.resolve({ error: message }); } };
  }

  function queryOf(url) {
    const qs = url.indexOf("?") >= 0 ? url.split("?")[1] : "";
    const out = {};
    qs.split("&").forEach(function (pair) {
      if (!pair) return;
      const kv = pair.split("=");
      out[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || "").replace(/\+/g, " "));
    });
    return out;
  }

  async function handle(url, init) {
    const path = url.split("?")[0];
    const query = queryOf(url);
    const body = init && init.body ? JSON.parse(init.body) : {};
    const method = (init && init.method) || "GET";
    const progress = loadProgress();

    /* --- 题目列表 --- */
    if (path === "/api/questions") {
      let list = bank().map(toApi);
      const ids = (query.ids || "").trim();
      let mode = query.mode || "seq";
      if (ids) mode = "custom";

      if (mode === "custom") {
        const wanted = ids.split(",").map(function (x) { return String(x).trim(); });
        list = wanted.map(byId).filter(function (q) { return !!q; });   /* 按传入顺序（D4） */
      } else if (mode === "random") {
        for (let i = list.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const t = list[i]; list[i] = list[j]; list[j] = t;
        }
      } else if (mode === "wrong") {
        list = list.filter(function (q) { return statusOf(q.index, progress) === "wrong"; });
      }

      const qtype = (query.qtype || "").trim();
      const status = (query.status || "").trim().toLowerCase();
      const keyword = (query.keyword || "").trim();
      const law = (query.law || "").trim();
      const lawTitles = {};
      list.forEach(function (q) { lawTitles[(q.law.title || "").trim()] = true; });
      const lawExact = !!lawTitles[law];
      if (qtype && qtype !== "全部") list = list.filter(function (q) { return q.qtype === qtype; });
      if (status && status !== "全部") list = list.filter(function (q) { return statusOf(q.index, progress) === status; });
      if (keyword) list = list.filter(function (q) { return q.stem.indexOf(keyword) >= 0; });
      if (law) {
        list = list.filter(function (q) {
          const title = (q.law.title || "").trim();
          return lawExact ? title === law : title.indexOf(law) >= 0;
        });
      }

      let start = 1, count = 20;
      if (query.page !== undefined || query.page_size !== undefined) {
        const page = Math.max(parseInt(query.page || "1", 10) || 1, 1);
        count = Math.min(Math.max(parseInt(query.page_size || "50", 10) || 50, 1), 500);
        start = (page - 1) * count + 1;
      } else {
        start = Math.max(parseInt(query.start || "1", 10) || 1, 1);
        count = Math.min(Math.max(parseInt(query.count || "20", 10) || 20, 1), 500);
      }

      const reveal = query.reveal === "1";
      const items = list.slice(start - 1, start - 1 + count).map(function (q) {
        const item = {
          index: q.index, qtype: q.qtype, stem: q.stem, options: q.options,
          status: statusOf(q.index, progress),
          collected: !!(progress[String(q.index)] || {}).collected
        };
        if (reveal) {
          item.answer = q.answer;
          item.explanation = q.explanation;
          item.law = q.law;
        }
        return item;
      });
      return ok({ total: list.length, mode: mode, start: start, page_size: count, questions: items });
    }

    /* --- 选题元数据 --- */
    if (path === "/api/selection/meta") {
      const statusCount = { new: 0, correct: 0, wrong: 0, collected: 0 };
      const lawCount = {};
      bank().forEach(function (q) {
        const st = statusOf(q.id, progress);
        statusCount[st] = (statusCount[st] || 0) + 1;
        const title = ((q.law || {}).title || "").trim();
        if (title) lawCount[title] = (lawCount[title] || 0) + 1;
      });
      const law = Object.keys(lawCount).map(function (t) { return { title: t, count: lawCount[t] }; })
        .sort(function (a, b) { return b.count - a.count || (a.title < b.title ? -1 : 1); });
      return ok({
        total: bank().length, qtype: ["单选题", "多选题"], status: ["new", "wrong", "collected"],
        status_label: { new: "未做", wrong: "做错", collected: "已收藏", correct: "已做对" },
        status_count: statusCount, law: law
      });
    }

    /* --- 法条索引 / 条文 --- */
    if (path === "/api/law/index") {
      const index = {};
      bank().forEach(function (q) {
        const title = ((q.law || {}).title || "").trim();
        if (!title) return;
        (index[title] = index[title] || []).push(q.id);
      });
      return ok({ total: Object.keys(index).length, index: index });
    }
    if (path.indexOf("/api/law/") === 0) {
      const title = decodeURIComponent(path.substring("/api/law/".length));
      const index = {};
      let text = null;
      bank().forEach(function (q) {
        const t = ((q.law || {}).title || "").trim();
        if (!t) return;
        (index[t] = index[t] || []).push(q.id);
        if (!text && t === title.trim() && (q.law.text || "").trim()) text = q.law.text;
      });
      if (text === null) return ok({ found: false, message: "未找到对应法条" });
      return ok({ found: true, title: title, text: text, ids: index[title] || [] });
    }

    /* --- 单题 --- */
    if (path.indexOf("/api/question/") === 0) {
      const q = byId(path.substring("/api/question/".length));
      if (!q) return fail(404, "题目不存在");
      const item = { index: q.index, qtype: q.qtype, stem: q.stem, options: q.options };
      if (query.reveal === "1") {
        item.answer = q.answer;
        item.explanation = q.explanation;
        item.law = q.law;
      }
      return ok(item);
    }

    /* --- 判分 --- */
    if (path === "/api/submit" && method === "POST") {
      const q = byId(body.qid);
      if (!q) return fail(404, "题目不存在");
      const chosen = (body.answer || []).map(function (x) { return String(x).trim().toUpperCase().slice(0, 1); })
        .filter(function (x, i, a) { return x && a.indexOf(x) === i; }).sort();
      if (!chosen.length) return fail(400, "请先选择答案");

      const correctAnswer = q.answer.split("").sort().join("");
      const correct = chosen.join("") === correctAnswer;
      const item = progress[String(q.index)] || {};
      item.answered = true;
      item.correct = correct;
      item.selected = chosen;
      item.attempts = Number(item.attempts || 0) + 1;
      item.wrong_count = correct ? 0 : Number(item.wrong_count || 0) + 1;
      if (item.collected === undefined) item.collected = false;
      if (item.note === undefined) item.note = "";
      progress[String(q.index)] = item;
      saveProgress(progress);
      return ok({
        correct: correct, answer: correctAnswer, selected: chosen,
        explanation: q.explanation, law: q.law,
        attempts: item.attempts, wrong_count: item.wrong_count
      });
    }

    /* --- 进度 --- */
    if (path === "/api/progress" && method === "POST") {
      const items = body.items || {};
      let written = 0;
      Object.keys(items).forEach(function (key) {
        const rec = items[key] || {};
        if (!byId(key)) return;
        progress[String(key)] = {
          answered: rec.answered !== false,
          correct: !!rec.correct,
          selected: rec.selected || [],
          attempts: Number(rec.attempts || 1),
          wrong_count: Number(rec.wrong_count || 0),
          collected: !!rec.collected,
          note: rec.note || ""
        };
        written += 1;
      });
      saveProgress(progress);
      return ok({ ok: true, written: written });
    }
    if (path === "/api/progress/all") {
      return ok({ progress: progress, stats: computeStats() });
    }

    /* --- 错题 --- */
    if (path === "/api/wrong") {
      const wrong = bank().filter(function (q) { return statusOf(q.id, progress) === "wrong"; }).map(function (q) {
        const api = toApi(q);
        const item = progress[String(q.id)] || {};
        return {
          index: api.index, qtype: api.qtype, stem: api.stem, answer: api.answer,
          explanation: api.explanation, law: api.law,
          wrong_count: item.wrong_count || 0, attempts: item.attempts || 0
        };
      });
      return ok({ total: wrong.length, questions: wrong });
    }

    /* --- 收藏 / 笔记 --- */
    if (path === "/api/collect" && method === "POST") {
      const q = byId(body.qid);
      if (!q) return fail(404, "题目不存在");
      const item = progress[String(q.index)] || { answered: false, correct: false, selected: [], attempts: 0, wrong_count: 0, note: "" };
      item.collected = (body.collected === undefined) ? !item.collected : !!body.collected;
      progress[String(q.index)] = item;
      saveProgress(progress);
      return ok({ ok: true, collected: item.collected });
    }
    if (path === "/api/note" && method === "POST") {
      const q = byId(body.qid);
      if (!q) return fail(404, "题目不存在");
      const item = progress[String(q.index)] || { answered: false, correct: false, selected: [], attempts: 0, wrong_count: 0, collected: false };
      item.note = String(body.note || "").slice(0, 2000);
      progress[String(q.index)] = item;
      saveProgress(progress);
      return ok({ ok: true });
    }

    /* --- 批量 --- */
    if (path === "/api/batch" && method === "POST") {
      const action = body.action;
      if (action === "export_wrong") {
        const exported = bank().filter(function (q) { return statusOf(q.id, progress) === "wrong"; }).map(function (q) {
          const api = toApi(q);
          return { id: api.index, qtype: api.qtype, stem: api.stem, options: api.options,
                   answer: api.answer, explanation: api.explanation, law: api.law };
        });
        return ok({ ok: true, count: exported.length, questions: exported });
      }
      if (action === "clear_wrong") {
        let cleared = 0;
        Object.keys(progress).forEach(function (k) {
          if (progress[k] && progress[k].wrong_count) { progress[k].wrong_count = 0; cleared += 1; }
        });
        saveProgress(progress);
        return ok({ ok: true, cleared: cleared });
      }
      if (action === "clear_all") {
        saveProgress({});
        return ok({ ok: true, cleared: "all" });
      }
      return fail(400, "不支持的操作");
    }

    /* --- 统计 / 设置 --- */
    if (path === "/api/stats") return ok(computeStats());
    if (path === "/api/settings") {
      if (method === "POST") {
        const s = loadSettings();
        ["mode", "back_mode", "font_size", "dark_mode", "auto_next"].forEach(function (k) {
          if (body[k] !== undefined) s[k] = body[k];
        });
        saveSettings(s);
        return ok({ ok: true, settings: s });
      }
      return ok(loadSettings());
    }

    /* --- 导入题库：App 内题库为内置，直接返回内置信息 --- */
    if (path === "/api/import" && method === "POST") {
      const counts = {};
      bank().forEach(function (q) {
        const t = q.type === "多选" ? "多选题" : "单选题";
        counts[t] = (counts[t] || 0) + 1;
      });
      return ok({ ok: true, total: bank().length, counts: counts, note: "App 内题库为内置版本" });
    }

    return fail(404, "接口不存在");
  }

  /* ---------------- 拦截 fetch ---------------- */
  migrateLegacyProgress();
  migrateStorageIfNeeded();

  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : ((input && input.url) || "");
    if (url.indexOf("/api/") === 0 || url.indexOf("api/") === 0) {
      return handle(url.replace(/^\.?\//, "/"), init || {});
    }
    return realFetch ? realFetch(input, init) : Promise.reject(new Error("网络不可用"));
  };

  /* ---------------- 页面路径：App 内是静态文件 ---------------- */
  window.APP_PATHS = {
    home: "index.html",
    practice: function (mode) { return "practice.html?mode=" + mode; },
    custom: function (ids) { return "practice.html?mode=custom&ids=" + ids.join(","); },
    answerCard: "answer_card.html",
    settings: "settings.html",
    selectionKey: SELECTION_KEY
  };

  /* ---------------- 练习页：客户端决定 mode 与背题模式 ---------------- */
  const quiz = document.getElementById("quiz");
  if (quiz) {
    const mode = queryOf(location.search).mode || "seq";
    if (["seq", "random", "wrong", "custom"].indexOf(mode) >= 0) quiz.dataset.mode = mode;
    quiz.dataset.back = loadSettings().back_mode ? "1" : "0";
  }

  /* 供调试验收使用 */
  window.__LOCAL_API__ = { loadProgress: loadProgress, loadSettings: loadSettings, computeStats: computeStats };
})();
