/**
 * 文件名称：安卓版/web/app-shim.js
 * 文件作用：
 *     HTML5+（uni-app / HBuilderX）运行环境的兼容补丁。
 *
 * 为什么需要它：
 *     Android WebView 里用 file:// 打开本地页面时，navigator.clipboard 可能不存在，
 *     而「导出进度」在 App 模式下依赖剪贴板（见 script.js 的 deliverExport）。
 *     本补丁在 HTML5+ 环境下用 plus.navigator.setClipboard 顶上一个同签名的实现，
 *     失败也不影响页面（原代码还有只读文本框兜底）。
 *
 * 影响范围：
 *     只在 HTML5+ 环境（window.plus 存在）生效；
 *     普通浏览器、Capacitor WebView 里什么也不做，因此可以安全地随网页一起分发。
 */
(function () {
  "use strict";

  /** 给 navigator.clipboard 打补丁：仅在缺失时替换，不覆盖浏览器原生实现 */
  function patchClipboard() {
    if (typeof window.plus === "undefined" || !window.plus.navigator) return;
    window.__HAS_PLUS__ = true;
    try {
      var native = navigator.clipboard;
      if (native && typeof native.writeText === "function") return;
      var impl = {
        writeText: function (text) {
          return new Promise(function (resolve, reject) {
            try {
              window.plus.navigator.setClipboard(String(text));
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        }
      };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        get: function () { return impl; }
      });
    } catch (err) {
      /* 补丁失败不阻塞页面：原代码会退回只读文本框 */
    }
  }

  /* HTML5+ 就绪后（或已经就绪时）立即打补丁 */
  if (window.plus) patchClipboard();
  document.addEventListener("plusready", patchClipboard, false);
})();
