/* ============================================================
   页面初始化（page-init.js）—— 安卓版专用
   服务端版由 Flask 在服务端渲染统计值与设置项；
   App 内没有后端，这里用本地接口把这些值填进页面，
   并把服务端版特有的「重新导入题库」按钮替换成「重置为内置题库（恢复出厂）」。
   ============================================================ */

(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }
  function setText(id, value) { const el = $(id); if (el) el.textContent = value; }

  async function fillStats() {
    let stats;
    try {
      stats = await (await fetch("/api/stats")).json();
    } catch (e) { return; }
    const accuracy = (stats.accuracy === null || stats.accuracy === undefined) ? "—" : stats.accuracy + "%";

    /* 首页 */
    setText("menuProgress", "当前进度：已作答 " + stats.answered + " 题 / 共 " + stats.total + " 题");
    setText("menuSummary", "错题 " + stats.wrong + " 题 · 最近一次正确率 " + accuracy + " · 累计作答 " + stats.attempts + " 次");
    setText("statTotal", stats.total);
    setText("statAnswered", stats.answered);
    setText("statAccuracy", accuracy);
    setText("statWrong", stats.wrong);
    setText("statAttempts", stats.attempts);
    setText("statUnanswered", stats.unanswered);
    setText("entryTotal", stats.total);
    setText("bankTotal", stats.total);

    /* 答题卡 */
    setText("cardAnswered", stats.answered);
    setText("cardAccuracy", accuracy);
    setText("cardAttempts", stats.attempts);
  }

  async function fillSettings() {
    if (!$("setBackMode") && !$("setDark") && !$("setFont") && !$("setAutoNext")) return;
    let s;
    try {
      s = await (await fetch("/api/settings")).json();
    } catch (e) { return; }
    if ($("setBackMode")) $("setBackMode").checked = !!s.back_mode;
    if ($("setDark")) $("setDark").checked = !!s.dark_mode;
    if ($("setAutoNext")) $("setAutoNext").checked = !!s.auto_next;
    if ($("setFont")) $("setFont").value = s.font_size || "large";
  }

  /* 说明：原先这里有个 fillSubtitle()，会把练习页副标题按练习模式改写成中文长句。
     v1.5.1 起副标题改为固定英文标签（Home / Practice / Answer Card / Settings，由模板渲染），
     该函数的目标选择器 .subtitle 也早已随 v2.6 顶栏改版失效（永远命中不到），因此整体删除。 */

  /** 练习页在顶部导航中高亮当前模式（服务端由模板决定，App 内按 URL 决定） */
  function fillNav() {
    if (!window.PAGE || window.PAGE !== "practice") return;
    const mode = new URLSearchParams(location.search).get("mode") || "seq";
    const label = { seq: "顺序练习", random: "随机练习", wrong: "错题练习", custom: "答题卡" }[mode] || "";
    if (!label) return;
    document.querySelectorAll(".nav a").forEach(function (a) {
      if (a.textContent.trim() === label) a.classList.add("active");
    });
  }

  /** 「重置为内置题库（恢复出厂）」：清空本地数据并恢复默认设置 */
  function initResetBank() {
    const btn = $("resetBankBtn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      const ok = window.confirm(
        "重置为内置题库（恢复出厂）？\n\n" +
        "将清除：作答进度、错题本、收藏、笔记、设置与选题状态。\n" +
        "题库本身是内置的，不会被删除。\n此操作无法撤销。"
      );
      if (!ok) return;
      try {
        localStorage.removeItem("drug_quiz_data");
        localStorage.removeItem("drug_quiz_wrong");
        localStorage.removeItem("drug_quiz_settings");
        localStorage.removeItem("drug_quiz_selection");
      } catch (e) { /* 忽略 */ }
      window.alert("已重置为出厂状态。");
      window.location.href = "index.html";
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    fillStats();
    fillSettings();
    fillNav();
    initResetBank();
  });
})();
