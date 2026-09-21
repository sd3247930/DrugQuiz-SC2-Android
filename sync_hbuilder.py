#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
文件名称：安卓版/sync_hbuilder.py
文件作用：
    把 App 的网页资源（www/）同步到 HBuilderX 的 uni-app 工程，供 web-view 加载。

为什么需要它：
    三版（网页版 / 服务端版 / 安卓版）共用一份前端代码，真相源是
    `服务端版/` + `安卓版/web/`，由 `build_www.py` 生成 `安卓版/www/`。
    HBuilderX 工程只是「壳」，它的内容必须始终与 www/ 一致，
    因此用本脚本做单向同步 + 一致性校验，避免手工复制造成漂移。

同步目标（两处，内容必须逐字节一致）：
    <项目>/hybrid/html/     App 端 <web-view> 加载（uni-app 官方规定的位置）
    <项目>/static/app-web/  H5 端 <iframe> 加载（H5 构建只打包 static/）

额外动作：
    1. 把 web/app-shim.js 复制过去，并注入到每个页面的 </head> 前
       （HTML5+ 环境下补 navigator.clipboard，见该文件头部说明）；
    2. 生成 HBuilderX 打包用的图标集到 <项目>/static/icons/；
    3. 写 <项目>/.sync-manifest.json（来源、时间、文件数与逐文件哈希）。

用法（在 安卓版/ 目录下执行）：
    python sync_hbuilder.py                  # 重新生成 www/ 并同步（默认）
    python sync_hbuilder.py --skip-build     # 只同步，不重跑生成脚本
    python sync_hbuilder.py --check          # 只检查漂移，不写任何文件
    python sync_hbuilder.py --project "<路径>"  # 指定 HBuilderX 工程路径
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(BASE, "www")
WEB_SRC = os.path.join(BASE, "web")
SHIM = os.path.join(WEB_SRC, "app-shim.js")
ICON_DIR = os.path.join(BASE, "android", "app", "src", "main", "res")

# 默认的 HBuilderX 工程路径（可用 --project 覆盖）
DEFAULT_PROJECT = r"D:\codex code\HBuilderProjects\DrugQuiz-SC2-Android\Pharma Law Quiz Bank"

APP_DIR_NAME = "hybrid/html"
H5_DIR_NAME = os.path.join("static", "app-web")
ICON_OUT_NAME = os.path.join("static", "icons")

SHIM_TAG = '<script src="app-shim.js"></script>'
PAGES = ["index.html", "practice.html", "answer_card.html", "settings.html"]
FONTS = ["inter-400.woff2", "inter-500.woff2", "inter-600.woff2", "jakarta-600.woff2", "jakarta-700.woff2"]

# 图标：Android 各密度 launcher 图标 → HBuilderX 需要的文件名
ICON_MAP = [
    ("mipmap-hdpi/ic_launcher.png", "72x72.png"),
    ("mipmap-xhdpi/ic_launcher.png", "96x96.png"),
    ("mipmap-xxhdpi/ic_launcher.png", "144x144.png"),
    ("mipmap-xxxhdpi/ic_launcher.png", "192x192.png"),
]
ICON_512_SRC = os.path.join(BASE, "..", "icons", "icon-512.png")


def log(msg):
    print(msg, flush=True)


def fail(msg):
    log("❌ " + msg)
    sys.exit(1)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def rel_files(root, prefix=""):
    """列出目录下所有文件的相对路径（正斜杠），相对 root"""
    out = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            full = os.path.join(dirpath, name)
            out.append(os.path.relpath(full, root).replace("\\", "/"))
    return sorted(out)


def run_build():
    """重新生成离线题库与网页资源（等价 CI 里的两步）"""
    # Windows 默认 stdout 是 GBK，生成脚本里打印 emoji 会报 UnicodeEncodeError；
    # 这里统一按 UTF-8 跑子进程（CI 是 Linux，本来就是 UTF-8）。
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    for script in ("generate_offline.py", "build_www.py"):
        path = os.path.join(BASE, script)
        if not os.path.exists(path):
            fail("找不到 " + path)
        log("▶ 运行 " + script)
        result = subprocess.run(
            [sys.executable, path],
            cwd=BASE,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
        )
        tail = (result.stdout or "").strip().splitlines()[-3:]
        for line in tail:
            log("   " + line)
        if result.returncode != 0:
            log(result.stderr or "")
            fail(script + " 执行失败")


def check_www():
    """www/ 自身的内容校验：题干条数、字体、页面"""
    if not os.path.isdir(WWW):
        fail("找不到 www/，请先执行 python build_www.py")
    for page in PAGES:
        if not os.path.exists(os.path.join(WWW, page)):
            fail("缺少页面：" + page)
    bank = os.path.join(WWW, "data-offline.js")
    if not os.path.exists(bank):
        fail("缺少题库文件 data-offline.js")
    text = open(bank, encoding="utf-8").read()
    if "window.__QUESTION_BANK__" not in text:
        fail("data-offline.js 里找不到 window.__QUESTION_BANK__")
    total = text.count('"type":"')
    single = text.count('"type":"单选"')
    multi = text.count('"type":"多选"')
    if total < 300 or single != 190 or multi != 110:
        fail("题库数量异常：共 %d（单选 %d / 多选 %d），期望 300（190 / 110）" % (total, single, multi))
    for font in FONTS:
        if not os.path.exists(os.path.join(WWW, "fonts", font)):
            fail("缺字体：" + font)
    return {"total": total, "single": single, "multi": multi}


def inject_shim(dest_dir):
    """把 app-shim.js 注入到目标目录的每个页面（幂等）"""
    injected = []
    for page in PAGES:
        path = os.path.join(dest_dir, page)
        html = open(path, encoding="utf-8").read()
        new_html = inject_text(html, page)
        if new_html == html:
            continue
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(new_html)
        injected.append(page)
    return injected


def inject_text(html, name="页面"):
    """在 </head> 前插入 app-shim.js（已在则原样返回），供同步与 --check 共用"""
    if SHIM_TAG in html:
        return html
    if "</head>" not in html:
        fail(name + " 里找不到 </head>，无法注入兼容脚本")
    return html.replace("</head>", "  " + SHIM_TAG + "\n</head>", 1)


def expected_target_bytes(rel):
    """目标副本里该文件应当是什么内容（www 原样 + 4 个页面注入 shim）"""
    src = os.path.join(WWW, rel.replace("/", os.sep))
    if rel in PAGES:
        return inject_text(open(src, encoding="utf-8").read(), rel).encode("utf-8")
    with open(src, "rb") as f:
        return f.read()


def copy_www(dest_dir):
    """把 www/ 整份覆盖复制到目标目录（先清理已不在 www/ 里的旧文件）"""
    os.makedirs(dest_dir, exist_ok=True)
    src_files = set(rel_files(WWW))
    for rel in rel_files(dest_dir):
        if rel not in src_files and rel != "app-shim.js":
            os.remove(os.path.join(dest_dir, rel))
    for rel in src_files:
        src = os.path.join(WWW, rel.replace("/", os.sep))
        dst = os.path.join(dest_dir, rel.replace("/", os.sep))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(src, dst)
    shutil.copyfile(SHIM, os.path.join(dest_dir, "app-shim.js"))
    injected = inject_shim(dest_dir)
    return sorted(src_files), injected


def ensure_icons(project_dir):
    """生成 HBuilderX 打包用图标集（从现有 Android 图标与品牌 logo 复制，不重画）"""
    out = os.path.join(project_dir, ICON_OUT_NAME)
    os.makedirs(out, exist_ok=True)
    made = []
    for rel, name in ICON_MAP:
        src = os.path.join(ICON_DIR, rel.replace("/", os.sep))
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(out, name))
            made.append(name)
    if os.path.exists(ICON_512_SRC):
        shutil.copyfile(ICON_512_SRC, os.path.join(out, "512x512.png"))
        made.append("512x512.png")
    return made


def compare_dirs(a, b):
    """逐文件比对两个目录是否完全一致，返回差异清单"""
    fa, fb = rel_files(a), rel_files(b)
    diffs = []
    if fa != fb:
        only_a = sorted(set(fa) - set(fb))
        only_b = sorted(set(fb) - set(fa))
        if only_a:
            diffs.append("仅 App 副本有：" + "、".join(only_a))
        if only_b:
            diffs.append("仅 H5 副本有：" + "、".join(only_b))
    for rel in sorted(set(fa) & set(fb)):
        if sha256(os.path.join(a, rel)) != sha256(os.path.join(b, rel)):
            diffs.append("内容不一致：" + rel)
    return diffs


def write_manifest(project_dir, app_dir, h5_dir, bank):
    manifest = {
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "source": WWW,
        "sourceFiles": len(rel_files(WWW)) + 1,
        "bank": bank,
        "targets": {},
    }
    for name, root in (("app", app_dir), ("h5", h5_dir)):
        files = {}
        for rel in rel_files(root):
            files[rel] = {"sha256": sha256(os.path.join(root, rel)), "size": os.path.getsize(os.path.join(root, rel))}
        manifest["targets"][name] = {"dir": root, "files": files}
    path = os.path.join(project_dir, ".sync-manifest.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    return path


def check_drift(project_dir, app_dir, h5_dir):
    """--check：只比对，不写文件"""
    if not os.path.exists(os.path.join(project_dir, ".sync-manifest.json")):
        fail("还没有同步过（缺少 .sync-manifest.json），请先运行 python sync_hbuilder.py")
    bank = check_www()
    problems = []
    expected_names = set(rel_files(WWW)) | {"app-shim.js"}
    for rel in rel_files(WWW):
        expect = expected_target_bytes(rel)
        expect_hash = hashlib.sha256(expect).hexdigest()
        for label, root in (("App 副本", app_dir), ("H5 副本", h5_dir)):
            dst = os.path.join(root, rel.replace("/", os.sep))
            if not os.path.exists(dst):
                problems.append("%s 缺文件：%s" % (label, rel))
            elif sha256(dst) != expect_hash:
                problems.append("%s 与 www 不一致：%s" % (label, rel))
    for label, root in (("App 副本", app_dir), ("H5 副本", h5_dir)):
        for rel in rel_files(root):
            if rel not in expected_names:
                problems.append("%s 有多余文件：%s" % (label, rel))
    problems += compare_dirs(app_dir, h5_dir)
    log("题库：共 %d 题（单选 %d / 多选 %d）" % (bank["total"], bank["single"], bank["multi"]))
    if problems:
        log("⚠️  检测到 %d 处漂移：" % len(problems))
        for p in problems[:20]:
            log("   - " + p)
        sys.exit(1)
    log("✅ 两处副本与 www/ 完全一致（www %d 个文件 + app-shim.js）" % len(rel_files(WWW)))


def main():
    parser = argparse.ArgumentParser(description="把 www/ 同步到 HBuilderX uni-app 工程")
    parser.add_argument("--project", default=DEFAULT_PROJECT, help="HBuilderX 工程路径")
    parser.add_argument("--skip-build", action="store_true", help="不重跑 generate_offline.py / build_www.py")
    parser.add_argument("--check", action="store_true", help="只检查漂移，不写任何文件")
    args = parser.parse_args()

    project = os.path.abspath(args.project)
    app_dir = os.path.join(project, APP_DIR_NAME)
    h5_dir = os.path.join(project, H5_DIR_NAME)

    if not os.path.isdir(project):
        fail("找不到 HBuilderX 工程目录：" + project)
    if not os.path.exists(os.path.join(project, "pages.json")):
        fail("目标目录不是 uni-app 工程（缺 pages.json）：" + project)

    if args.check:
        check_drift(project, app_dir, h5_dir)
        return

    log("工程：" + project)
    if not args.skip_build:
        run_build()

    bank = check_www()
    log("题库校验通过：共 %d 题（单选 %d / 多选 %d）" % (bank["total"], bank["single"], bank["multi"]))

    _files, injected_app = copy_www(app_dir)
    log("✅ 已同步 App 副本：" + app_dir)
    _files2, injected_h5 = copy_www(h5_dir)
    log("✅ 已同步 H5 副本：" + h5_dir)
    log("   注入 app-shim.js：App 副本 %d 页、H5 副本 %d 页" % (len(injected_app), len(injected_h5)))

    icons = ensure_icons(project)
    log("✅ 已生成图标 %d 个：" % len(icons) + "、".join(icons))

    diffs = compare_dirs(app_dir, h5_dir)
    if diffs:
        for d in diffs:
            log("   ✗ " + d)
        fail("两处副本不一致，请检查同步逻辑")
    log("✅ 两处副本逐文件一致（%d 个文件）" % len(rel_files(app_dir)))

    manifest = write_manifest(project, app_dir, h5_dir, bank)
    log("✅ 已写同步清单：" + manifest)
    log("")
    log("下一步：在 HBuilderX 里打开该工程 → 运行 → 运行到手机或模拟器")


if __name__ == "__main__":
    main()
