/* ============================================================
   练习页「查看法条」（O2）
   作用：做题前/做题中即可查看**本题**依据的法条原文。
   要点：
     1. 取当前题自己的 law 字段（按题号请求 /api/question/<id>?reveal=1），
        不用 /api/law/<标题>——那会按标题返回同一条，导致 300 题显示同一段条文；
     2. 一律用 textContent 渲染，不用 innerHTML（项目安全约定）；
     3. 复用选题面板的全屏弹层样式（.sheet），不需要新的弹层机制与特性检测；
     4. 服务端版与安卓版共用本文件（安卓版由 build_www.py 复制进 www/）。
   ============================================================ */

/** 取当前题号：优先用 script.js 的练习会话，取不到时回退解析页面文字 */
function lawTipCurrentQid() {
  if (typeof session !== "undefined" && session.list && session.list[session.index]) {
    return session.list[session.index].index;
  }
  const el = document.getElementById("questionNo");
  const n = el ? Number(el.textContent.replace(/\D/g, "")) : NaN;
  return isNaN(n) ? null : n;
}

/** 切换题目时重置弹层与按钮状态（由 script.js 的切题钩子调用） */
function lawTipReset() {
  const sheet = document.getElementById("lawTipSheet");
  if (sheet) sheet.classList.add("hidden");
  document.body.classList.remove("sheet-open");
  const btn = document.getElementById("lawTipBtn");
  if (btn) {
    btn.disabled = false;
    btn.textContent = "查看法条";
  }
  const body = document.getElementById("lawTipBody");
  if (body) body.textContent = "";
}

/** 打开弹层并展示本题法条 */
async function lawTipShow() {
  const qid = lawTipCurrentQid();
  if (!qid) return;

  let data;
  try {
    data = await api("/api/question/" + qid + "?reveal=1");
  } catch (err) {
    toast(err.message);
    return;
  }

  const law = data.law || {};
  const text = (law.text || "").trim();
  const btn = document.getElementById("lawTipBtn");

  /* 该题没有法条：按钮置灰并提示，不打开空弹层 */
  if (!text) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "暂无相关法条";
    }
    toast("本题暂无收录对应法条");
    return;
  }

  document.getElementById("lawTipTitle").textContent = law.title || "本题依据的法条";

  const body = document.getElementById("lawTipBody");
  body.textContent = "";
  const textEl = document.createElement("div");
  textEl.className = "lawtip-text";
  textEl.textContent = text;              /* 纯文本渲染，避免注入 */
  body.appendChild(textEl);

  const hint = document.createElement("div");
  hint.className = "lawtip-hint";
  hint.textContent = "题库第 " + qid + " 题 · 以上为该题解析引用的条文原文";
  body.appendChild(hint);

  body.scrollTop = 0;
  document.getElementById("lawTipSheet").classList.remove("hidden");
  document.body.classList.add("sheet-open");
}

function lawTipClose() {
  const sheet = document.getElementById("lawTipSheet");
  if (sheet) sheet.classList.add("hidden");
  document.body.classList.remove("sheet-open");
}

document.addEventListener("DOMContentLoaded", function () {
  const btn = document.getElementById("lawTipBtn");
  if (btn) btn.addEventListener("click", lawTipShow);
  const close = document.getElementById("lawTipClose");
  if (close) close.addEventListener("click", lawTipClose);
  /* 切题时由 script.js 的钩子调用（renderQuestion 末尾） */
  window.onQuestionRendered = lawTipReset;
});
