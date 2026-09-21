/* ============================================================
   答题卡选题面板（全屏弹层）
   决策依据（《答题卡选题功能完善方案.md》D1～D7）：
     D1 全屏弹层；D2 题型 + 状态 + 关键词筛选（前端完成）；
     D3 选题状态存 localStorage（drug_quiz_selection）；
     D4 进入练习后按勾选顺序出题；
     D6 只做服务端版；D7 只扩展 /api/questions + 新增 /api/selection/meta。
   ============================================================ */

const SEL_KEY = "drug_quiz_selection";   /* 新增键，独立于现有三个键 */
const SEL_PAGE_SIZE = 50;                /* 每页渲染 50 条 */

const sel = {
  all: [],                 /* 全部题目（含 status / collected） */
  view: [],                /* 当前筛选结果 */
  selected: [],            /* 已勾选 id，**保持勾选顺序**（D4） */
  filter: { qtype: "全部", status: "全部", keyword: "" },
  rendered: 0,             /* 已渲染条数（滚动加载） */
  loaded: false
};

const STATUS_TEXT = { new: "未做", correct: "已做对", wrong: "做错", collected: "已收藏" };
const STATUS_ICON = { new: "", correct: "✓", wrong: "✗", collected: "☆" };

function selApi(url, options) {
  const opt = options || {};
  const headers = { "Content-Type": "application/json" };
  if (opt.method === "POST") headers["X-CSRF-Token"] = CSRF;
  return fetch(url, {
    method: opt.method || "GET",
    headers: headers,
    body: opt.body ? JSON.stringify(opt.body) : undefined
  }).then(function (res) {
    if (!res.ok) throw new Error("请求失败：" + res.status);
    return res.json();
  });
}

/* ---------------- 持久化（D3：仅 localStorage） ---------------- */
function selSave() {
  try {
    localStorage.setItem(SEL_KEY, JSON.stringify({
      selectedIds: sel.selected,
      filter: sel.filter,
      updatedAt: new Date().toISOString()
    }));
  } catch (e) { /* 隐私模式等场景忽略 */ }
}

function selRestore() {
  try {
    const raw = localStorage.getItem(SEL_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.selectedIds)) {
      const valid = new Set(sel.all.map(function (q) { return q.index; }));
      sel.selected = data.selectedIds.filter(function (id) { return valid.has(id); });
    }
    if (data.filter && typeof data.filter === "object") {
      sel.filter = {
        qtype: data.filter.qtype || "全部",
        status: data.filter.status || "全部",
        keyword: data.filter.keyword || ""
      };
    }
  } catch (e) { /* 数据损坏时用默认值 */ }
}

function selReset() {
  sel.selected = [];
  selSave();
}

/* ---------------- 数据 ---------------- */
async function selLoadData() {
  if (sel.loaded) return;
  const data = await selApi("/api/questions?page_size=500");
  sel.all = data.questions || [];
  sel.loaded = true;
}

/* ---------------- 面板开关 ---------------- */
async function selOpen() {
  const panel = $("selectionPanel");
  if (!panel) return;
  try {
    await selLoadData();
  } catch (err) {
    toast(err.message);
    return;
  }
  selRestore();
  selRenderFilters();
  selApplyFilter();
  panel.classList.remove("hidden");
  document.body.classList.add("sheet-open");
  /* 面板是白底：把状态栏图标切成深色（否则白底白图标看不见），并接管返回键 */
  if (window.SheetKit) {
    window.SheetKit.setStatusBarIconStyle("LIGHT");
    window.SheetKit.pushBackGuard("selectionPanel");
  }
}

function selClose() {
  const panel = $("selectionPanel");
  if (panel) panel.classList.add("hidden");
  document.body.classList.remove("sheet-open");
  /* 回到深青顶栏：状态栏图标切回浅色；并释放返回键拦截 */
  if (window.SheetKit) {
    window.SheetKit.setStatusBarIconStyle("DARK");
    window.SheetKit.releaseBackGuard("selectionPanel");
  }
  selSave();     /* 关闭面板时保留勾选（方案 7 节的约定） */
}

/* ---------------- 筛选区 ---------------- */
function selRenderFilters() {
  const box = $("selectionFilters");
  if (!box) return;
  box.textContent = "";

  function radioGroup(label, name, values, current, onPick) {
    const wrap = document.createElement("div");
    wrap.className = "filter-group";
    const title = document.createElement("span");
    title.className = "filter-label";
    title.textContent = label;
    wrap.appendChild(title);

    values.forEach(function (item) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (current === item.value ? " active" : "");
      btn.textContent = item.text;
      btn.addEventListener("click", function () {
        onPick(item.value);
        selRenderFilters();
        selApplyFilter();
      });
      wrap.appendChild(btn);
    });
    return wrap;
  }

  box.appendChild(radioGroup("题型", "qtype",
    [{ value: "全部", text: "全部" }, { value: "单选题", text: "单选题" }, { value: "多选题", text: "多选题" }],
    sel.filter.qtype,
    function (v) { sel.filter.qtype = v; }));

  box.appendChild(radioGroup("状态", "status",
    [{ value: "全部", text: "全部" }, { value: "new", text: "未做" }, { value: "wrong", text: "做错" }, { value: "collected", text: "已收藏" }],
    sel.filter.status,
    function (v) { sel.filter.status = v; }));

  const kw = document.createElement("div");
  kw.className = "filter-group";
  const kwLabel = document.createElement("span");
  kwLabel.className = "filter-label";
  kwLabel.textContent = "关键词";
  const input = document.createElement("input");
  input.type = "search";
  input.id = "selectionKeyword";
  input.placeholder = "按题干搜索，如：追溯";
  input.value = sel.filter.keyword;
  let timer = null;
  input.addEventListener("input", function () {
    /* 实时过滤：轻微防抖，300 题量级无需后端 */
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      sel.filter.keyword = input.value.trim();
      selApplyFilter();
    }, 150);
  });
  kw.appendChild(kwLabel);
  kw.appendChild(input);
  box.appendChild(kw);
}

/* ---------------- 列表 ---------------- */
function selApplyFilter() {
  const f = sel.filter;
  const kw = (f.keyword || "").trim();
  sel.view = sel.all.filter(function (q) {
    if (f.qtype !== "全部" && q.qtype !== f.qtype) return false;
    if (f.status !== "全部" && q.status !== f.status) return false;
    if (kw && (q.stem || "").indexOf(kw) < 0) return false;
    return true;
  });
  sel.rendered = 0;
  const list = $("selectionList");
  if (list) list.textContent = "";
  selRenderMore();
}

function selRenderMore() {
  const list = $("selectionList");
  if (!list) return;
  const next = sel.view.slice(sel.rendered, sel.rendered + SEL_PAGE_SIZE);

  if (!sel.view.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "没有符合条件的题目";
    list.appendChild(empty);
    selUpdateBar();
    return;
  }

  next.forEach(function (q) {
    const row = document.createElement("label");
    row.className = "sel-row";
    row.dataset.id = q.index;

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = sel.selected.indexOf(q.index) >= 0;
    box.addEventListener("change", function () { selToggle(q.index, box.checked); });

    const no = document.createElement("span");
    no.className = "sel-no";
    no.textContent = q.index;

    const badge = document.createElement("span");
    badge.className = "badge " + (q.qtype === "多选题" ? "badge-multi" : "badge-single");
    badge.textContent = q.qtype === "多选题" ? "多" : "单";

    const stem = document.createElement("span");
    stem.className = "sel-stem";
    stem.textContent = (q.stem || "").slice(0, 30) + ((q.stem || "").length > 30 ? "…" : "");

    const st = document.createElement("span");
    st.className = "sel-status status-" + q.status;
    st.textContent = STATUS_ICON[q.status] || "";
    st.title = STATUS_TEXT[q.status] || "";

    row.appendChild(box);
    row.appendChild(no);
    row.appendChild(badge);
    row.appendChild(stem);
    row.appendChild(st);
    list.appendChild(row);
  });

  sel.rendered += next.length;
  selUpdateBar();
}

/** 滚动到底部自动加载下一页 */
function selOnScroll() {
  const list = $("selectionList");
  if (!list) return;
  if (list.scrollTop + list.clientHeight >= list.scrollHeight - 24) {
    if (sel.rendered < sel.view.length) selRenderMore();
  }
}

function selToggle(id, checked) {
  const idx = sel.selected.indexOf(id);
  if (checked && idx < 0) {
    sel.selected.push(id);      /* push 保持勾选顺序（D4） */
  } else if (!checked && idx >= 0) {
    sel.selected.splice(idx, 1);
  }
  selSave();
  selUpdateBar();
}

function selUpdateBar() {
  const count = $("selectionCount");
  if (count) count.textContent = "已选 " + sel.selected.length + " 题";
  const all = $("selAllBtn");
  if (all) {
    all.textContent = sel.view.length && sel.selected.length >= sel.view.length
      ? "取消全选" : "全选筛选结果";
  }
  const start = $("selStartBtn");
  if (start) start.disabled = sel.selected.length === 0;
}

/* ---------------- 批量操作 ---------------- */
function selSelectAll() {
  if (sel.selected.length >= sel.view.length && sel.view.length) {
    sel.selected = [];
  } else {
    sel.selected = sel.view.map(function (q) { return q.index; });   /* 按筛选结果顺序 */
  }
  selSave();
  selSyncCheckboxes();
  selUpdateBar();
}

function selInvert() {
  const current = new Set(sel.selected);
  sel.selected = sel.view.filter(function (q) { return !current.has(q.index); })
    .map(function (q) { return q.index; });
  selSave();
  selSyncCheckboxes();
  selUpdateBar();
}

function selClear() {
  sel.selected = [];
  selSave();
  selSyncCheckboxes();
  selUpdateBar();
}

function selSyncCheckboxes() {
  document.querySelectorAll("#selectionList .sel-row").forEach(function (row) {
    const id = Number(row.dataset.id);
    const box = row.querySelector("input");
    if (box) box.checked = sel.selected.indexOf(id) >= 0;
  });
}

/* ---------------- 开始练习（D4：按勾选顺序） ---------------- */
function selStart() {
  if (!sel.selected.length) {
    toast("请先勾选题目");
    return;
  }
  const ids = sel.selected.slice();      /* 顺序 = 勾选顺序 */
  /* 按方案验收 S-11：开始练习后选题状态重置（清空勾选，保留筛选条件） */
  selReset();
  window.location.href = APP_PATHS.custom(ids);
}

/* ---------------- 初始化 ---------------- */
function selInit() {
  const open = $("openSelectionBtn");
  if (open) open.addEventListener("click", selOpen);
  const close = $("closeSelectionBtn");
  if (close) close.addEventListener("click", selClose);
  const list = $("selectionList");
  if (list) list.addEventListener("scroll", selOnScroll);
  const all = $("selAllBtn");
  if (all) all.addEventListener("click", selSelectAll);
  const invert = $("selInvertBtn");
  if (invert) invert.addEventListener("click", selInvert);
  const clear = $("selClearBtn");
  if (clear) clear.addEventListener("click", selClear);
  const start = $("selStartBtn");
  if (start) start.addEventListener("click", selStart);
  /* 左右滑动也可关闭面板（起手点距边缘 ≥24px，避免与系统返回手势冲突） */
  if (window.SheetKit) window.SheetKit.registerSheet($("selectionPanel"), selClose);
}

document.addEventListener("DOMContentLoaded", selInit);
