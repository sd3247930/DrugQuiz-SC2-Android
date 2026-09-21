package com.drugquiz.sc2;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebSettings;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import java.util.Locale;

/**
 * 药品法规刷题 · Android 壳。
 *
 * 本类只做两件事，都是"把系统安全区交给网页"的问题 —— 因为 Capacitor 8 内置的
 * SystemBars 插件依赖 WebView 版本/分支判断，在部分机型（实测荣耀 BKQ-AN90 /
 * Android 16 / WebView 152）上既不注入 CSS 变量、也不做原生 inset，导致顶栏
 * Logo/标题落在状态栏与摄像头挖孔区域内。
 *
 * 解决办法（确定性，不依赖插件分支）：
 *   1. 每次页面加载后，把「状态栏 ∪ 挖孔」的 insets 注入成 CSS 变量
 *      --safe-area-inset-top / --safe-area-inset-bottom（单位 px，已按 density 换算）；
 *      网页 CSS 用 max(env(...), var(--safe-area-inset-*)) 取大值让开安全区。
 *      注入的是 documentElement 的行内样式，页面内跳转（4 个 HTML 互相跳）会自动重注入。
 *   2. 暴露一个 JS 接口 AndroidAppShell.setStatusBarStyle(style)，供网页在全屏白底
 *      面板打开时把状态栏图标切成深色（"LIGHT" = 浅色背景 → 深色图标），关闭再切回。
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        /* ⚠️ 临时诊断代码（定位完后删除）：WebView 调试开关必须在**任何 WebView 实例创建之前**调用，
           否则 devtools 端口不会建立（Capacitor 自己的开关是在 WebView 创建之后才调的）。 */
        WebView.setWebContentsDebuggingEnabled(true);

        super.onCreate(savedInstanceState);

        if (getBridge() == null) return;
        final WebView webView = getBridge().getWebView();
        if (webView == null) return;

        /* 本地资源（https://localhost/assets 下的 www）不需要 HTTP 缓存：
           否则升级安装后 WebView 可能继续用旧的 style.css / *.js，导致改动不生效。 */
        webView.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);

        /* 1) 状态栏图标样式：插件不可用时的兜底通道 */
        webView.addJavascriptInterface(
            new Object() {
                @JavascriptInterface
                public void setStatusBarStyle(final String style) {
                    runOnUiThread(() -> applyStatusBarIconStyle("LIGHT".equals(style)));
                }
            },
            "AndroidAppShell"
        );

        /* 2) 页面加载完成后注入一次安全区（每次导航都会触发） */
        getBridge().addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageLoaded(WebView view) {
                    injectSafeArea(view);
                }
            }
        );

        /* 3) insets 变化（手势条显隐、键盘、旋转）时同步一次 */
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
            injectSafeArea((WebView) view);
            return insets;      /* 不消费，避免影响 Capacitor 自身与其他监听者 */
        });
        webView.requestApplyInsets();
    }

    /** 把根窗口的「状态栏 ∪ 挖孔」尺寸注入成网页可读的 CSS 变量 */
    private void injectSafeArea(WebView webView) {
        WindowInsetsCompat rootInsets = ViewCompat.getRootWindowInsets(webView);
        if (rootInsets == null) return;

        Insets bars = rootInsets.getInsets(
            WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
        );
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0f) density = 1f;

        String js = String.format(
            Locale.US,
            "try{" +
                "var d=document.documentElement.style;" +
                "d.setProperty('--safe-area-inset-top','%dpx');" +
                "d.setProperty('--safe-area-inset-bottom','%dpx');" +
            "}catch(e){}",
            Math.round(bars.top / density),
            Math.round(bars.bottom / density)
        );
        webView.evaluateJavascript(js, null);
    }

    /** lightBackground = true 时用深色图标（浅色面板）；false 时用浅色图标（深青顶栏） */
    private void applyStatusBarIconStyle(boolean lightBackground) {
        try {
            WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            controller.setAppearanceLightStatusBars(lightBackground);
        } catch (Exception ignored) {
            /* 个别 ROM 不支持时不阻塞 */
        }
    }
}
