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
};

export default config;
