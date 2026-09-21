/**
 * 文件名称：安卓版/probe_device_webview.mjs
 * 文件作用：
 *     通过 adb + Chrome DevTools 协议，直接读写手机上 App 的 WebView（真机联调工具）。
 *     前提：APK 里打开了 WebView 调试（capacitor.config.ts → android.webContentsDebuggingEnabled
 *     且 MainActivity 在 super.onCreate 之前调用 WebView.setWebContentsDebuggingEnabled(true)），
 *     并已执行：
 *         adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *
 * 用法：
 *     node probe_device_webview.mjs probe          # 读取安全区/顶栏 padding 等关键值
 *     node probe_device_webview.mjs shell "<js>"   # 在页面里执行任意 JS 并打印结果
 *     node probe_device_webview.mjs var off|on|38  # 临时移除/恢复 --safe-area-inset-top（做 A/B 对照）
 */

const PORT = process.env.CDP_PORT || 9222;

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = targets.find((t) => t.type === "page") || targets[0];
  if (!page) throw new Error("没有可用的页面目标，请检查 adb forward 与 App 是否在前台");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  await new Promise((r) => ws.addEventListener("open", r));
  const evaluate = (expression) =>
    new Promise((resolve) => {
      const myId = ++id;
      pending.set(myId, (msg) => resolve(msg.result && msg.result.result ? msg.result.result.value : msg));
      ws.send(JSON.stringify({ id: myId, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
    });
  return { ws, evaluate };
}

const [mode, arg] = process.argv.slice(2);
const { ws, evaluate } = await connect();

if (mode === "probe") {
  const out = await evaluate(`(function(){
    const bar = document.querySelector('.app-bar');
    return {
      href: location.href,
      inlineTop: document.documentElement.style.getPropertyValue('--safe-area-inset-top'),
      inlineBottom: document.documentElement.style.getPropertyValue('--safe-area-inset-bottom'),
      computedSafeTop: getComputedStyle(document.documentElement).getPropertyValue('--safe-top'),
      barPaddingTop: bar ? getComputedStyle(bar).paddingTop : null,
      barHeight: bar ? bar.getBoundingClientRect().height : null,
      hasAndroidShell: typeof window.AndroidAppShell !== 'undefined',
      envTop: (function(){ var d=document.createElement('div');
        d.style.cssText='position:fixed;top:0;left:0;width:1px;height:env(safe-area-inset-top, 0px)';
        document.body.appendChild(d); var h=d.getBoundingClientRect().height; d.remove(); return h; })()
    };
  })()`);
  console.log(JSON.stringify(out, null, 2));
} else if (mode === "shell") {
  console.log(JSON.stringify(await evaluate(arg), null, 2));
} else if (mode === "var") {
  if (arg === "off") {
    console.log("移除 --safe-area-inset-top →",
      await evaluate("document.documentElement.style.removeProperty('--safe-area-inset-top'); getComputedStyle(document.querySelector('.app-bar')).paddingTop"));
  } else {
    const px = arg === "on" ? "38" : arg;
    console.log(`设置 --safe-area-inset-top = ${px}px →`,
      await evaluate(`document.documentElement.style.setProperty('--safe-area-inset-top','${px}px'); getComputedStyle(document.querySelector('.app-bar')).paddingTop`));
  }
} else {
  console.log("用法: node probe_device_webview.mjs probe | shell \"<js>\" | var off|on|<px>");
}
ws.close();
