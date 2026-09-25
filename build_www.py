#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文件名称：安卓版/build_www.py
文件作用：
    从「服务端版」生成 Android 应用用的网页资源，保证 App 与服务端版功能、
    界面一致（决策 D1=A：对齐服务端版 + 单一来源）。

    来源（服务端版）                       产出（安卓版 www/）
    templates/base.html + 4 个页面   →   index.html / practice.html /
                                         answer_card.html / settings.html
    static/style.css                 →   style.css
    static/script.js                 →   script.js
    static/selection.js              →   selection.js
    static/law.js                    →   law.js
    web/local-api.js（App 专用）      →   local-api.js
    web/page-init.js（App 专用）      →   page-init.js
    （generate_offline.py 生成）      →   data-offline.js

    转换规则：
      - Jinja2 继承（extends / block）在构建时展开
      - url_for(...) → 静态文件路径（index.html / practice.html?mode=xxx / ...）
      - 服务端渲染的统计值与设置项 → 留空占位，由 page-init.js 用本地接口填充
      - PWA 的 manifest / apple-touch-icon 链接去掉（App 内不需要）
      - 「导入旧版进度」入口去掉（决策 D3=A：App 内无浏览器版数据）
      - 「重新导入题库」→「重置为内置题库（恢复出厂）」（决策 D2）
      - 转换后若仍残留 `{{` 或 `{%`，直接报错退出（不静默产出坏页面）

运行：python build_www.py
"""

import io
import os
import re
import shutil
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(BASE, "www")
WEB = os.path.join(BASE, "web")        # App 专用脚本（local-api.js / page-init.js）

# 生成清单（复制、清理、校验都以此为准，避免"复制了但被当孤儿删掉"这类不一致）
PAGES = ("index.html", "practice.html", "answer_card.html", "settings.html")
STATIC_COPIES = ("style.css", "script.js", "selection.js", "law.js", "lawtip.js")
APP_SCRIPTS = ("local-api.js", "page-init.js", "bank-selector.js")
GENERATED_EXTRA = ("data-offline.js",)   # 由 generate_offline.py 产出
SKIP_STATIC = {"manifest.json", "sw.js"}   # PWA 专用，App 内不需要
SKIP_STATIC_DIRS = {"icons"}               # PWA 图标目录同样跳过
BINARY_EXT = (".png", ".woff2", ".woff", ".jpg", ".jpeg", ".ico")

# 服务端版目录按优先级查找：
#   1) ../服务端版              —— 开发时用项目里的服务端版（保证与之同步）
#   2) ./template_server/       —— 仓库自带快照（独立克隆 / CI 构建）
SERVER_CANDIDATES = [
    os.path.join(os.path.dirname(BASE), "服务端版"),
    os.path.join(BASE, "template_server"),
]


def find_server_dir():
    """按优先级找到服务端版目录；找不到时报错退出"""
    for path in SERVER_CANDIDATES:
        if os.path.isdir(os.path.join(path, "templates")) and os.path.isdir(os.path.join(path, "static")):
            return path
    print("❌ 找不到服务端版目录（需含 templates/ 与 static/），已尝试：")
    for path in SERVER_CANDIDATES:
        print("   - %s" % path)
    sys.exit(1)


def read(path):
    with io.open(path, encoding="utf-8") as f:
        return f.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def convert_jinja(html, active):
    """把模板里的 Jinja 语法展开成静态 HTML"""
    # 1) 静态资源与页面链接
    html = re.sub(r"\{\{\s*url_for\('static',\s*filename='([^']+)'\)\s*\}\}",
                  lambda m: m.group(1), html)
    html = re.sub(r"\{\{\s*url_for\('index'\)\s*\}\}", "index.html", html)
    html = re.sub(r"\{\{\s*url_for\('answer_card'\)\s*\}\}", "answer_card.html", html)
    html = re.sub(r"\{\{\s*url_for\('settings_page'\)\s*\}\}", "settings.html", html)
    html = re.sub(r"\{\{\s*url_for\('practice',\s*mode='(\w+)'\)\s*\}\}",
                  lambda m: "practice.html?mode=" + m.group(1), html)

    # 2) CSRF：App 内无后端，本地垫片不校验，留空即可
    html = re.sub(r"\{\{\s*csrf_token\s*\}\}", "", html)

    # 3) 顶部导航高亮
    html = re.sub(r"\{%\s*if active == '(\w+)'\s*%\}active\{%\s*endif\s*%\}",
                  lambda m: "active" if m.group(1) == active else "", html)
    # 3b) 多值高亮（如练习相关的 seq/random/wrong 都算「练习」tab）
    html = re.sub(r"\{%\s*if active in \[([^\]]*)\]\s*%\}active\{%\s*endif\s*%\}",
                  lambda m: "active" if active in re.findall(r"'([^']+)'", m.group(1)) else "", html)

    # 4) 服务端渲染的统计值与设置项：留空，由 page-init.js 填充
    html = re.sub(r"\{%\s*if stats\.accuracy is none\s*%\}.*?\{%\s*endif\s*%\}", "", html, flags=re.S)
    html = re.sub(r"\{\{\s*stats\.[\w]+\s*\}\}", "", html)
    html = re.sub(r"\{%\s*if settings\.[\w]+(\s*==\s*'[\w]+')?\s*%\}\s*(checked|selected)\s*\{%\s*endif\s*%\}",
                  "", html)

    # 4b) 练习页的动态值：模式、背题模式、副标题都由客户端决定
    html = re.sub(r"\{\{\s*'1' if settings\.back_mode else '0'\s*\}\}", "0", html)
    html = re.sub(r"\{\{\s*mode\s*\}\}", "seq", html)
    html = re.sub(r"\{\{\s*\{[^{}]*\}\[mode\]\s*\}\}", "", html, flags=re.S)

    # 5) 去掉 PWA 链接（App 内不需要）
    html = re.sub(r'\s*<link rel="manifest"[^>]*>', "", html)
    html = re.sub(r'\s*<link rel="apple-touch-icon"[^>]*>', "", html)
    html = re.sub(r'\s*<meta name="apple-mobile-web-app-capable"[^>]*>', "", html)
    return html


def render_page(base, page_src, active):
    """展开模板继承：把子模板的 block 内容填进 base"""
    blocks = dict(re.findall(r"\{%\s*block (\w+)\s*%\}(.*?)\{%\s*endblock\s*%\}", page_src, re.S))

    def replace_block(match):
        return blocks.get(match.group(1), match.group(2))

    html = re.sub(r"\{%\s*block (\w+)\s*%\}(.*?)\{%\s*endblock\s*%\}", replace_block, base, flags=re.S)
    return convert_jinja(html, active)


def adapt_index(html):
    """首页：去掉「导入旧版进度」区块（决策 D3=A）"""
    return re.sub(
        r'\s*<div class="stat-section">从旧版（单文件版）导入进度</div>.*?<div class="hint" id="importOldResult"></div>',
        "", html, flags=re.S)


def adapt_settings(html):
    """设置页：「重新导入题库」→「重置为内置题库（恢复出厂）」（决策 D2）"""
    pattern = re.compile(
        r'\s*<div class="stat-section">题库管理</div>.*?<div class="hint" id="reimportResult"></div>', re.S)
    replacement = (
        '\n  <div class="stat-section">题库管理</div>\n'
        '  <div class="hint">\n'
        '    App 内的题库是内置版本（当前 <span id="bankTotal">300</span> 题），随安装包一起分发，'
        '无需也无法重新导入。若要恢复到出厂状态，点下面的按钮。\n'
        '  </div>\n'
        '  <div class="btn-row">\n'
        '    <button class="btn btn-danger" id="resetBankBtn" type="button">重置为内置题库（恢复出厂）</button>\n'
        '  </div>'
    )
    if not pattern.search(html):
        print("⚠️  设置页未找到「题库管理」区块，跳过替换（请检查服务端版模板是否改动）")
        return html
    return pattern.sub(replacement, html)


def adapt_footer(html):
    """页脚文案：服务端 → App"""
    return html.replace(
        "练习进度与错题本保存在运行本服务的电脑上（<code>data/</code> 目录），不上传任何外部服务器。",
        "练习进度、错题本、收藏与笔记保存在本机（App 私有存储），不上传任何外部服务器。"
    )


def inject_scripts(html):
    """注入 App 专用脚本：本地接口垫片必须早于 script.js 加载"""
    html = html.replace(
        '<script src="script.js"></script>',
        '<script src="data-offline.js"></script>\n'
        '<script src="local-api.js"></script>\n'
        '<script src="script.js"></script>'
    )
    html = html.replace("</body>",
                        '<script src="page-init.js"></script>\n'
                        '<script src="bank-selector.js"></script>\n</body>')
    return html


def check_no_jinja(html, name):
    """转换后不允许残留 Jinja 语法——宁可报错，也不产出坏页面"""
    leftovers = re.findall(r"\{\{.*?\}\}|\{%.*?%\}", html, re.S)
    if leftovers:
        print("❌ %s 中仍残留未处理的 Jinja 语法（共 %d 处）：" % (name, len(leftovers)))
        for item in leftovers[:10]:
            print("   -", item.strip()[:80])
        sys.exit(1)


def main():
    server = find_server_dir()
    tpl_dir = os.path.join(server, "templates")
    static_dir = os.path.join(server, "static")
    base = read(os.path.join(tpl_dir, "base.html"))

    pages = [
        ("index.html", "index.html", "home", adapt_index),
        ("practice.html", "practice.html", "", None),
        ("answer_card.html", "answer_card.html", "card", None),
        ("settings.html", "settings.html", "settings", adapt_settings),
    ]

    os.makedirs(WWW, exist_ok=True)

    for src_name, out_name, active, adapter in pages:
        html = render_page(base, read(os.path.join(tpl_dir, src_name)), active)
        html = adapt_footer(html)
        if adapter:
            html = adapter(html)
        html = inject_scripts(html)
        check_no_jinja(html, out_name)
        write(os.path.join(WWW, out_name), html)

    # 样式、脚本、品牌 logo、自托管字体整份复制（App 与服务端共用同一份代码与资源）
    # 文本文件走 write()，二进制（png/woff2）用二进制复制；PWA 专用文件跳过
    copied = []
    for name in sorted(os.listdir(static_dir)):
        src_path = os.path.join(static_dir, name)
        if os.path.isfile(src_path):
            if name in SKIP_STATIC or name == "script.js":
                continue                  # PWA 跳过；script.js 见下方特例
            dst_path = os.path.join(WWW, name)
            if name.lower().endswith(BINARY_EXT):
                shutil.copyfile(src_path, dst_path)
            else:
                write(dst_path, read(src_path))
            copied.append(name)
        elif os.path.isdir(src_path) and name not in SKIP_STATIC_DIRS:
            os.makedirs(os.path.join(WWW, name), exist_ok=True)
            for sub in sorted(os.listdir(src_path)):
                sub_src = os.path.join(src_path, sub)
                if not os.path.isfile(sub_src):
                    continue
                sub_dst = os.path.join(WWW, name, sub)
                if sub.lower().endswith(BINARY_EXT):
                    shutil.copyfile(sub_src, sub_dst)
                else:
                    write(sub_dst, read(sub_src))

    # script.js 特例：去掉 Service Worker 注册（App 内资源随安装包分发，注册只会 404）
    script = read(os.path.join(static_dir, "script.js"))
    pwa_pattern = re.compile(r"\n// PWA：仅在 http/https 下注册.*?\n\}\n", re.S)
    if pwa_pattern.search(script):
        script = pwa_pattern.sub("\n", script)
        print("   已从 script.js 移除 Service Worker 注册（App 内不需要）")
    else:
        print("⚠️  未在 script.js 中找到 Service Worker 注册代码，请确认服务端版是否改动")
    write(os.path.join(WWW, "script.js"), script)
    copied.append("script.js")

    # App 专用脚本
    for name in APP_SCRIPTS:
        write(os.path.join(WWW, name), read(os.path.join(WEB, name)))

    # 清理孤儿文件：www 下不属于本次生成清单的文件一律删除
    # （保留 generate_offline.py 产出的 data-offline.js，避免版本切换后的残留被误打进包里）
    managed = set(PAGES) | set(copied) | set(APP_SCRIPTS) | set(GENERATED_EXTRA)
    removed = []
    for name in os.listdir(WWW):
        path = os.path.join(WWW, name)
        if os.path.isfile(path) and name not in managed:
            os.remove(path)
            removed.append(name)
    if removed:
        print("   已清理孤儿文件：%s" % ", ".join(removed))

    print("✅ 已从服务端版生成 Android 网页资源")
    print("   来源：%s" % server)
    # 用真实服务端版目录时，顺手刷新仓库内的快照，保证独立克隆 / CI 也能构建
    snapshot = os.path.join(BASE, "template_server")
    if os.path.abspath(server) != os.path.abspath(snapshot):
        for sub in ("templates", "static"):
            src_dir = os.path.join(server, sub)
            if not os.path.isdir(src_dir):
                continue
            for name in sorted(os.listdir(src_dir)):
                src_file = os.path.join(src_dir, name)
                if os.path.isfile(src_file):
                    if name in SKIP_STATIC:
                        continue                          # PWA 文件不进 App 快照
                    dst_file = os.path.join(snapshot, sub, name)
                    if name.lower().endswith(BINARY_EXT):
                        os.makedirs(os.path.dirname(dst_file), exist_ok=True)
                        shutil.copyfile(src_file, dst_file)
                    else:
                        write(dst_file, read(src_file))
                elif os.path.isdir(src_file) and name not in SKIP_STATIC_DIRS:
                    for inner in sorted(os.listdir(src_file)):
                        inner_src = os.path.join(src_file, inner)
                        if not os.path.isfile(inner_src):
                            continue
                        inner_dst = os.path.join(snapshot, sub, name, inner)
                        if inner.lower().endswith(BINARY_EXT):
                            os.makedirs(os.path.dirname(inner_dst), exist_ok=True)
                            shutil.copyfile(inner_src, inner_dst)
                        else:
                            write(inner_dst, read(inner_src))
        print("   已刷新快照：%s" % snapshot)
    for name in list(PAGES) + sorted(set(managed) - set(PAGES) - set(GENERATED_EXTRA)):
        path = os.path.join(WWW, name)
        if os.path.isfile(path):
            print("   %s  %.1f KB" % (name.ljust(18), os.path.getsize(path) / 1024))
    if not os.path.exists(os.path.join(WWW, "data-offline.js")):
        print("   ⚠️  还缺 data-offline.js，请运行：python generate_offline.py")


if __name__ == "__main__":
    main()
