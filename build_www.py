#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文件名称：安卓版/build_www.py
文件作用：
    把「静态单文件版」的页面模板（../tools/index.template.html）拆成 Android 应用用的资源，
    目录结构对齐参考项目 CommDebug-apk 的 www/：

        www/index.html      页面结构
        www/style.css       样式
        www/app.js          应用逻辑（题库改从 data-offline.js 读取）
        www/data-offline.js 离线题库（由 generate_offline.py 生成）

    好处：换题只重跑 generate_offline.py，改样式只动 style.css，
    页面逻辑与静态版共用同一份来源，避免三处代码分叉。

运行：python build_www.py
"""

import io
import os
import re
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(os.path.dirname(BASE), "tools", "index.template.html")
WWW = os.path.join(BASE, "www")


def main():
    if not os.path.exists(TEMPLATE):
        sys.exit("❌ 找不到页面模板：%s" % TEMPLATE)
    with io.open(TEMPLATE, encoding="utf-8") as f:
        tpl = f.read()

    # ---- 1) 样式 ----
    m = re.search(r"<style>(.*?)</style>", tpl, re.S)
    if not m:
        sys.exit("❌ 模板中找不到 <style> 区块")
    css = m.group(1).strip()

    # ---- 2) 脚本 ----
    scripts = re.findall(r"<script>(.*?)</script>", tpl, re.S)
    if not scripts:
        sys.exit("❌ 模板中找不到 <script> 区块")
    js = scripts[-1].strip()

    if "const QUESTION_BANK = /*__QUESTION_BANK__*/[];" in js:
        js = js.replace("const QUESTION_BANK = /*__QUESTION_BANK__*/[];",
                        "const QUESTION_BANK = window.__QUESTION_BANK__ || [];")
    elif "const QUESTION_BANK = [];" in js:
        js = js.replace("const QUESTION_BANK = [];",
                        "const QUESTION_BANK = window.__QUESTION_BANK__ || [];")
    else:
        sys.exit("❌ 未能在脚本中找到 QUESTION_BANK 定义，请检查模板是否改动")

    # App 内不需要 Service Worker：资源随安装包分发，注册只会产生 404 噪音
    js = re.sub(r"/\*\*[^\n]*Service Worker[^\n]*\*/\nfunction registerServiceWorker\(\) \{.*?\n\}\n",
                "", js, flags=re.S)
    js = js.replace("  registerServiceWorker();\n", "")
    js = re.sub(r"\n// PWA：仅在 http/https 下注册.*?\n\}\n", "\n", js, flags=re.S)

    # ---- 3) 页面结构 ----
    body_match = re.search(r"<body>(.*?)<script>", tpl, re.S)
    if not body_match:
        sys.exit("❌ 模板中找不到 <body> 区块")
    body = body_match.group(1).strip()

    title = re.search(r"<title>(.*?)</title>", tpl, re.S)
    title = title.group(1).strip() if title else "药品管理相关法规知识竞赛试题库"
    desc = re.search(r'<meta name="description" content="(.*?)">', tpl, re.S)
    desc = desc.group(1).strip() if desc else ""
    icon = re.search(r'<link rel="icon" href="(.*?)">', tpl, re.S)
    icon = icon.group(1).strip() if icon else ""

    html = []
    html.append("<!DOCTYPE html>")
    html.append('<html lang="zh-CN">')
    html.append("<head>")
    html.append('<meta charset="UTF-8">')
    html.append('<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">')
    html.append('<meta name="theme-color" content="#1a5fb4">')
    if desc:
        html.append('<meta name="description" content="%s">' % desc)
    if icon:
        html.append('<link rel="icon" href="%s">' % icon)
    html.append("<title>%s</title>" % title)
    html.append('<link rel="stylesheet" href="style.css">')
    html.append("</head>")
    html.append("<body>")
    html.append(body)
    html.append('<script src="data-offline.js"></script>')
    html.append('<script src="app.js"></script>')
    html.append("</body>")
    html.append("</html>")
    html_text = "\n".join(html) + "\n"

    os.makedirs(WWW, exist_ok=True)
    with io.open(os.path.join(WWW, "index.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(html_text)
    with io.open(os.path.join(WWW, "style.css"), "w", encoding="utf-8", newline="\n") as f:
        f.write("/* 由 build_www.py 从 tools/index.template.html 抽取，请勿手改 */\n" + css + "\n")
    with io.open(os.path.join(WWW, "app.js"), "w", encoding="utf-8", newline="\n") as f:
        f.write("/* 由 build_www.py 从 tools/index.template.html 抽取；题库来自 data-offline.js */\n" + js + "\n")

    print("✅ 已生成 Android 网页资源")
    for name in ("index.html", "style.css", "app.js"):
        path = os.path.join(WWW, name)
        print("   %s  %.1f KB" % (name.ljust(12), os.path.getsize(path) / 1024))
    print("   提示：题库文件 www/data-offline.js 由 generate_offline.py 生成")


if __name__ == "__main__":
    main()
