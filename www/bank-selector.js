/* ============================================================
   选择题库入口（bank-selector.js）—— 安卓版专用

   为什么做成"运行时注入"而不是改模板：
     服务端版 / 静态版 / 安卓版 **共用同一套模板**；
     只有安卓版支持多题库（静态版是单题库产物）。
     所以这里像 page-init.js 一样在运行时把「当前题库」区块插进首页，
     三版共用的模板一行都不用改。

   位置（M4）：首页统计卡下方、「练习入口」上方。
   切换方式：写入 drug_quiz_bank 后整页 reload——
     等价于 SPA 内切库，但能保证进度/顺序/游标等全部内存状态一致地重新初始化。
   ============================================================ */

(function () {
  "use strict";

  const API = window.__BANK_API__;
  if (!API) return;                     /* local-api.js 没加载就不出手 */

  const banks = API.list();
  if (!banks || banks.length < 2) return;   /* 只有一个题库时不显示入口 */

  const currentId = API.current();
  const current = banks.filter(function (b) { return b.id === currentId; })[0] || banks[0];

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ---------------- 样式（与 App 设计 token 一致） ---------------- */
  const style = document.createElement("style");
  style.textContent = [
    ".bank-current{display:flex;align-items:center;gap:8px;width:100%;}",
    ".bank-current .b-name{font-weight:600;}",
    ".bank-current .b-count{color:#5b6b73;font-size:.9em;}",
    ".bank-current .b-arrow{margin-left:auto;color:#5b6b73;}",
    ".bank-sheet{position:fixed;inset:0;z-index:9999;display:flex;align-items:flex-end;",
    "  background:rgba(0,0,0,.35);}",
    ".bank-sheet.hidden{display:none;}",
    ".bank-sheet-panel{background:#fff;width:100%;border-radius:16px 16px 0 0;",
    "  padding:16px 16px calc(16px + env(safe-area-inset-bottom));max-height:70vh;overflow:auto;}",
    ".bank-sheet-title{font-weight:600;margin-bottom:12px;}",
    ".bank-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;",
    "  padding:14px 12px;border:1px solid #e0e0e0;border-radius:12px;background:#fff;",
    "  margin-bottom:10px;font-size:1em;}",
    ".bank-item.active{border-color:#1a5fb4;background:#eef4fd;}",
    ".bank-item .b-name{font-weight:600;}",
    ".bank-item .b-count{color:#5b6b73;font-size:.9em;}",
    ".bank-item .b-check{margin-left:auto;color:#1a5fb4;font-weight:700;}",
    ".bank-item .b-license{display:block;color:#8a949a;font-size:.8em;margin-top:2px;}"
  ].join("");
  document.head.appendChild(style);

  /* ---------------- 入口区块（M4 首页 / N2 设置页，复用同一个弹层）----------------
     首页：插在统计卡下方（.stat-grid 之后）
     设置页：插在「练习设置」上方（#settings 的第一个子节点之前）——题库是全局配置，
             放在设置里符合用户预期，也免得用户从练习页/答题卡页切库时必须回首页。 */
  function buildEntry(inSettings) {
    const section = el("div", "stat-section", "当前题库");
    const btn = el("button", inSettings ? "btn btn-secondary bank-current" : "menu-btn bank-current");
    btn.id = "bankSelectorBtn";
    btn.type = "button";
    btn.appendChild(el("span", "b-name", current.name || current.id));
    btn.appendChild(el("span", "b-count", "（" + current.total + " 题）"));
    btn.appendChild(el("span", "b-arrow", "▾"));
    btn.addEventListener("click", openSheet);
    const holder = document.createDocumentFragment();
    holder.appendChild(section);
    holder.appendChild(btn);
    return holder;
  }

  const homeAnchor = document.querySelector(".stat-grid");
  const settingsRoot = document.getElementById("settings");
  if (homeAnchor && homeAnchor.parentNode) {
    homeAnchor.parentNode.insertBefore(buildEntry(false), homeAnchor.nextSibling);
  } else if (settingsRoot) {
    settingsRoot.insertBefore(buildEntry(true), settingsRoot.firstElementChild);
  }

  /* ---------------- 选择弹层 ---------------- */
  let sheet = null;
  function buildSheet() {
    sheet = el("div", "bank-sheet hidden");
    sheet.id = "bankSheet";
    const panel = el("div", "bank-sheet-panel");
    panel.appendChild(el("div", "bank-sheet-title", "选择题库"));

    banks.forEach(function (b) {
      const item = el("button", "bank-item" + (b.id === currentId ? " active" : ""));
      item.type = "button";
      item.dataset.bank = b.id;
      const name = el("span", "b-name", b.name || b.id);
      item.appendChild(name);
      item.appendChild(el("span", "b-count", " " + b.total + " 题"));
      if (b.id === currentId) item.appendChild(el("span", "b-check", "✓"));
      if (b.license) item.appendChild(el("span", "b-license", b.license));
      item.addEventListener("click", function () { switchTo(b); });
      panel.appendChild(item);
    });

    panel.addEventListener("click", function (e) { e.stopPropagation(); });
    sheet.appendChild(panel);
    sheet.addEventListener("click", closeSheet);
    document.body.appendChild(sheet);
  }
  function openSheet() {
    if (!sheet) buildSheet();
    sheet.classList.remove("hidden");
  }
  function closeSheet() {
    if (sheet) sheet.classList.add("hidden");
  }

  function switchTo(bank) {
    if (bank.id === currentId) { closeSheet(); return; }
    const ok = window.confirm(
      "切换到「" + (bank.name || bank.id) + "」？\n\n" +
      "各题库的进度、错题与笔记互相独立：\n切换后当前题库的进度会保留，下次切回来时继续。"
    );
    if (!ok) return;
    closeSheet();
    API.switchTo(bank.id);     /* 写入 drug_quiz_bank 并 reload */
  }
})();
