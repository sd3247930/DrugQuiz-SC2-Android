import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor 配置（技术栈与 E:\5.Question bank testing software\CommDebug-apk 一致）
 * appId     Android 包名，安装到手机后用于区分应用
 * appName   手机桌面显示的应用名
 * webDir    前端资源目录（本项目的网页部分）
 */
const config: CapacitorConfig = {
  appId: "com.drugquiz.sc2",
  appName: "药品法规刷题",
  webDir: "www",
  server: {
    androidScheme: "https",
  },
  /* ⚠️ 临时诊断开关：允许用 adb 连 WebView 调试端口读取真实 DOM（诊断完成后必须删除） */
  android: {
    webContentsDebuggingEnabled: true,
  },
  /**
   * 状态栏 / 手势条（Capacitor 8 内置的 SystemBars 插件，Bridge 会自动注册）
   *
   * 为什么必须显式写：插件默认 style = DEFAULT，会跟随白天/夜间自动切换——
   * 白天模式下它把状态栏图标设成**深色**，压在深青顶栏 #0F5B78 上几乎看不清。
   *
   * style 语义（注意与直觉相反）：
   *   'DARK'  = 深色背景 → **浅色（白）图标**  ← 我们用这个，配合深青顶栏
   *   'LIGHT' = 浅色背景 → 深色图标（面板打开时由网页临时切换）
   *
   * insetsHandling：'css' = 由插件把 insets 注入成 CSS 变量 --safe-area-inset-*，
   * 网页用 max(env(...), var(--safe-area-inset-*)) 取大值让开状态栏/挖孔。
   */
  plugins: {
    /* 键名必须与插件类名一致（Capacitor 用类名找配置），加引号是为了让 CI 断言好匹配 */
    "SystemBars": {
      style: "DARK",
      insetsHandling: "css",
    },
  },
};

export default config;
