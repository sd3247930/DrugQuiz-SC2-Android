/* ============================================================
   法条浏览：按法条查看条文原文，并可直接练习该法条下的题目
   服务端版与安卓版共用同一份代码（接口由 Flask 或 local-api.js 提供）
   ============================================================ */

const lawState = { loaded: false, titles: [], counts: {}, openIndex: -1 };

async function lawToggle() {
  const box = $("lawList");
  if (!box) return;

  if (!lawState.loaded) {
    try {
      const data = await api("/api/law/index");
      lawState.counts = data.index || {};
      lawState.titles = Object.keys(lawState.counts);
      lawState.loaded = true;
    } catch (err) {
      toast(err.message);
      return;
    }
  }

  if (box.classList.contains("hidden")) {
    lawRender();
    show(box);
  } else {
    hide(box);
  }
}

function lawRender() {
  const box = $("lawList");
  box.textContent = "";
  if (!lawState.titles.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "暂无收录法条";
    box.appendChild(empty);
    return;
  }

  lawState.titles.forEach(function (title, i) {
    const count = (lawState.counts[title] || []).length;
    const row = document.createElement("div");
    row.className = "law-row";

    const head = document.createElement("button");
    head.type = "button";
    head.className = "law-title-btn";
    head.textContent = title + "（" + count + " 题）";
    head.addEventListener("click", function () { lawToggleText(title, i); });

    const text = document.createElement("div");
    text.className = "law-text hidden";
    text.id = "lawTextItem" + i;

    const actions = document.createElement("div");
    actions.className = "law-actions";
    const prac = document.createElement("button");
    prac.type = "button";
    prac.className = "btn btn-secondary";
    prac.textContent = "练这些题";
    prac.addEventListener("click", function () { lawPractice(title); });
    actions.appendChild(prac);

    row.appendChild(head);
    row.appendChild(text);
    row.appendChild(actions);
    box.appendChild(row);
  });
}

async function lawToggleText(title, i) {
  const el = $("lawTextItem" + i);
  if (!el) return;
  if (!el.classList.contains("hidden")) {
    hide(el);
    return;
  }
  if (!el.textContent) {
    try {
      const data = await api("/api/law/" + encodeURIComponent(title));
      el.textContent = data.found ? (data.text || "（条文为空）") : "未找到该法条原文";
    } catch (err) {
      el.textContent = "读取失败：" + err.message;
    }
  }
  show(el);
}

function lawPractice(title) {
  const ids = lawState.counts[title] || [];
  if (!ids.length) {
    toast("该法条下暂无题目");
    return;
  }
  window.location.href = APP_PATHS.custom(ids);
}

document.addEventListener("DOMContentLoaded", function () {
  const btn = $("openLawBtn");
  if (btn) btn.addEventListener("click", lawToggle);
});
