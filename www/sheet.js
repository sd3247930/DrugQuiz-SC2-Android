/**
 * 文件名称：服务端版/static/sheet.js
 * 文件作用：
 *     全屏面板（.sheet：选题练习 / 法条浏览）的通用交互，三个能力：
 *       1. 状态栏图标切换：面板是白底，App 里要把状态栏图标临时切成深色，否则白底白图标看不见；
 *       2. 右左滑动关闭：水平滑动 > 60px、横向主导、< 600ms，且起手点距屏幕左右边缘 ≥ 24px
 *          （贴边起手会被安卓手势导航当成"返回"吃掉，页面收不到事件）；
 *       3. 返回键/边缘返回手势 = 关闭面板：打开时压一条 history，popstate 时关面板，
 *          这样系统返回不会再直接离开当前页面。
 *
 * 兼容性：
 *     - 状态栏切换只在 Capacitor App 环境生效（window.Capacitor.Plugins.SystemBars），
 *       浏览器/服务端版里静默跳过，不影响任何现有逻辑；
 *     - 滑动与 history 都是标准浏览器 API，三版（App / 服务端版 / 静态版）通用。
 */
(function () {
  "use strict";

  /* ============ 1) 状态栏图标样式 ============ */
  /**
   * style: "LIGHT" = 浅色背景 → 深色图标（白底面板用）
   *        "DARK"  = 深色背景 → 浅色（白）图标（深青顶栏用）
   * 说明：Capacitor 内置的 SystemBars 插件提供 setStyle；插件不可用时静默跳过。
   */
  function setStatusBarIconStyle(style) {
    /* 通道 1：Capacitor 内置 SystemBars 插件（部分机型不生效） */
    try {
      var cap = window.Capacitor;
      var bars = cap && cap.Plugins && cap.Plugins.SystemBars;
      if (bars && typeof bars.setStyle === "function") {
        bars.setStyle({ style: style });
      }
    } catch (err) {
      /* 忽略 */
    }
    /* 通道 2：App 自己的原生接口（MainActivity 注入，确定性兜底） */
    try {
      if (window.AndroidAppShell && typeof AndroidAppShell.setStatusBarStyle === "function") {
        AndroidAppShell.setStatusBarStyle(style);
      }
    } catch (err) {
      /* 忽略 */
    }
    /* 通道 3：HBuilderX / HTML5+ 环境（注意语义相反：dark = 深色图标） */
    try {
      if (window.plus && plus.navigator && typeof plus.navigator.setStatusBarStyle === "function") {
        plus.navigator.setStatusBarStyle(style === "LIGHT" ? "dark" : "light");
      }
    } catch (err) {
      /* 浏览器里没有 plus：忽略 */
    }
  }

  /* ============ 2) 返回键 = 关面板 ============ */
  const closers = {};      /* sheetId → 关闭函数 */
  const guarded = {};      /* sheetId → 是否已压过一条 history */

  function pushBackGuard(id) {
    if (!id || guarded[id]) return;
    try {
      history.pushState({ __sheet: id }, "");
      guarded[id] = true;
    } catch (err) {
      /* 某些环境不允许 pushState：忽略，返回键行为退回系统默认 */
    }
  }

  function releaseBackGuard(id) {
    if (!id || !guarded[id]) return;
    guarded[id] = false;
    try {
      history.back();      /* 触发 popstate，但那时面板已关闭 → 不重复处理 */
    } catch (err) {
      /* 忽略 */
    }
  }

  window.addEventListener("popstate", function () {
    const open = document.querySelector(".sheet:not(.hidden)");
    if (!open || !closers[open.id]) return;
    guarded[open.id] = false;           /* 这条历史已被系统消费，别再 back() */
    closers[open.id]();
  });

  /* ============ 3) 左右滑动关闭 ============ */
  const EDGE_MIN = 24;     /* 起手点距左右边缘的最小距离（避开系统返回手势热区） */
  const MIN_DX = 60;       /* 水平位移阈值（px） */
  const MAX_MS = 600;      /* 时间上限（ms） */
  const RATIO = 1.5;       /* 横向主导倍数：|dx| > |dy| * 1.5 */

  function bindSwipeToClose(sheet, closeFn) {
    if (!sheet || typeof closeFn !== "function") return;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let tracking = false;

    sheet.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) {
        tracking = false;
        return;
      }
      const t = e.touches[0];
      if (t.clientX < EDGE_MIN || t.clientX > window.innerWidth - EDGE_MIN) {
        tracking = false;                 /* 贴边起手：交给系统返回手势 */
        return;
      }
      startX = t.clientX;
      startY = t.clientY;
      startTime = Date.now();
      tracking = true;
    }, { passive: true });

    sheet.addEventListener("touchend", function (e) {
      if (!tracking || e.changedTouches.length !== 1) {
        tracking = false;
        return;
      }
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const dt = Date.now() - startTime;
      if (Math.abs(dx) > MIN_DX && Math.abs(dx) > Math.abs(dy) * RATIO && dt < MAX_MS) {
        closeFn();
      }
    }, { passive: true });

    sheet.addEventListener("touchcancel", function () {
      tracking = false;
    }, { passive: true });
  }

  /* ============ 对外接口 ============ */
  /**
   * 注册一个面板：登记它的关闭函数（供返回键使用）并绑定滑动关闭。
   * @param {Element} sheet  面板元素（必须有 id）
   * @param {Function} closeFn 该面板自己的关闭函数
   */
  function registerSheet(sheet, closeFn) {
    if (!sheet || !sheet.id || typeof closeFn !== "function") return;
    closers[sheet.id] = closeFn;
    bindSwipeToClose(sheet, closeFn);
  }

  window.SheetKit = {
    setStatusBarIconStyle: setStatusBarIconStyle,
    registerSheet: registerSheet,
    pushBackGuard: pushBackGuard,
    releaseBackGuard: releaseBackGuard
  };
})();
