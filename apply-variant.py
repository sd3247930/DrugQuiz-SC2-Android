#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文件名称：apply-variant.py
文件作用：
    把一个「APK 变体」的品牌参数写进工程，让同一份代码能出多个互不冲突的安装包。
    变体的参数（包名 / 应用名 / 版本号 / 图标目录）由调用方给出，**本脚本不内置变体表**，
    避免 CI 的 matrix 与脚本各存一份参数、改一处漏一处。

    config 阶段（必须在 npx cap sync 之前跑）：
        capacitor.config.ts → appId / appName
        android/app/build.gradle → applicationId / versionCode / versionName
        （namespace 不动：Java 源码在 com/drugquiz/sc2 下，改 namespace 会连带改源码包名，
          而 applicationId 与 namespace 本来就是两件事）

    ⚠️ 关键坑（2026-09-25 由 CI 断言抓到）：
        **npx cap sync 并不会按 capacitor.config.ts 重写 res/values/strings.xml**。
        实测：把 appName 改成「软考架构师刷题」后同步，strings.xml 仍然是「药品法规刷题」，
        custom_url_scheme 也还是旧包名。桌面应用名、深链 scheme 都取自这里，
        所以必须由本脚本直接改写 strings.xml（app_name / title_activity_main /
        package_name / custom_url_scheme 四处），否则会出「包名对了、名字还是另一个 App」的包。

    branding 阶段（必须在 npx cap sync 之后跑，避免被同步覆盖）：
        把 branding 目录整棵覆盖到 android/app/src/main/res/

用法（安卓版目录下）：
    python apply-variant.py --app-id com.drugquiz.ruankao --app-name 软考架构师刷题 ^
        --version-code 1 --version-name 1.0.0
    python apply-variant.py --branding android/branding/ruankao

    CI 里 config 阶段与 branding 阶段各调一次（branding 那次把参数再传一遍即可，
    本脚本完全幂等）。

参考：药品法规版（默认）参数是 com.drugquiz.sc2 / 药品法规刷题。
"""

import argparse
import io
import os
import re
import shutil
import sys

# Windows 控制台默认 GBK，直接 print 中文/emoji 会抛 UnicodeEncodeError
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.abspath(__file__))
CAP_CONFIG = os.path.join(ROOT, "capacitor.config.ts")
BUILD_GRADLE = os.path.join(ROOT, "android", "app", "build.gradle")
ANDROID_RES = os.path.join(ROOT, "android", "app", "src", "main", "res")
STRINGS_XML = os.path.join(ANDROID_RES, "values", "strings.xml")


def read(path):
    with io.open(path, encoding="utf-8") as f:
        return f.read()


def write(path, text):
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def sub_once(text, pattern, repl, label):
    """只替换第一处；找不到就报错（避免改了没生效还静默通过）。"""
    new, n = re.subn(pattern, repl, text, count=1)
    if n != 1:
        sys.exit("❌ 在 %s 里找不到可替换的内容：%s" % (label, pattern))
    return new


def apply_config(app_id, app_name, version_code, version_name):
    changed = []

    text = read(CAP_CONFIG)
    if app_id:
        text = sub_once(text, r'(appId\s*:\s*)"[^"]*"', r'\1"%s"' % app_id, CAP_CONFIG)
    if app_name:
        text = sub_once(text, r'(appName\s*:\s*)"[^"]*"', r'\1"%s"' % app_name, CAP_CONFIG)
    write(CAP_CONFIG, text)
    changed.append("capacitor.config.ts")

    text = read(BUILD_GRADLE)
    if app_id:
        text = sub_once(text, r'applicationId\s+"[^"]*"',
                        'applicationId "%s"' % app_id, BUILD_GRADLE)
    if version_code:
        text = sub_once(text, r'versionCode\s+\d+',
                        "versionCode %s" % version_code, BUILD_GRADLE)
    if version_name:
        text = sub_once(text, r'versionName\s+"[^"]*"',
                        'versionName "%s"' % version_name, BUILD_GRADLE)
    write(BUILD_GRADLE, text)
    changed.append("android/app/build.gradle")

    # strings.xml：cap sync 不会按 capacitor.config.ts 重写它，必须自己写（见文件头说明）
    if app_id or app_name:
        if not os.path.exists(STRINGS_XML):
            sys.exit("❌ 找不到 %s（安卓工程不完整？）" % STRINGS_XML)
        text = read(STRINGS_XML)
        if app_name:
            for key in ("app_name", "title_activity_main"):
                text = sub_once(text, r'(<string name="%s">)[^<]*(</string>)' % key,
                                r'\g<1>%s\g<2>' % app_name, STRINGS_XML)
        if app_id:
            for key in ("package_name", "custom_url_scheme"):
                text = sub_once(text, r'(<string name="%s">)[^<]*(</string>)' % key,
                                r'\g<1>%s\g<2>' % app_id, STRINGS_XML)
        write(STRINGS_XML, text)
        changed.append("android/app/src/main/res/values/strings.xml")

    # 回读断言：写进去的值必须真的在文件里
    cap = read(CAP_CONFIG)
    gradle = read(BUILD_GRADLE)
    strings = read(STRINGS_XML) if os.path.exists(STRINGS_XML) else ""
    checks = []
    if app_id:
        checks += [
            ('capacitor appId', 'appId: "%s"' % app_id in cap),
            ('applicationId', 'applicationId "%s"' % app_id in gradle),
            ('strings package_name', '<string name="package_name">%s</string>' % app_id in strings),
        ]
    if app_name:
        checks += [
            ('capacitor appName', 'appName: "%s"' % app_name in cap),
            ('strings app_name', '<string name="app_name">%s</string>' % app_name in strings),
        ]
    if version_code:
        checks.append(('versionCode', re.search(r'versionCode\s+%s\b' % version_code, gradle) is not None))
    if version_name:
        checks.append(('versionName', 'versionName "%s"' % version_name in gradle))
    bad = [name for name, ok in checks if not ok]
    if bad:
        sys.exit("❌ 写入后回读校验失败：%s" % "、".join(bad))

    print("✅ 品牌参数已写入：%s" % "、".join(changed))
    for name, _ in checks:
        print("   - %s ✔" % name)


def apply_branding(src, res_dir=None):
    src = os.path.normpath(os.path.join(ROOT, src))
    if not os.path.isdir(src):
        sys.exit("❌ branding 目录不存在：%s" % src)
    dest_root = os.path.normpath(res_dir) if res_dir else ANDROID_RES
    if not os.path.isdir(dest_root):
        sys.exit("❌ 目标 res 目录不存在：%s" % dest_root)

    copied = 0
    for base, _dirs, files in os.walk(src):
        rel = os.path.relpath(base, src)
        dest_dir = os.path.normpath(os.path.join(dest_root, rel))
        os.makedirs(dest_dir, exist_ok=True)
        for name in files:
            shutil.copy2(os.path.join(base, name), os.path.join(dest_dir, name))
            copied += 1
            print("   %s → %s" % (os.path.relpath(os.path.join(base, name), src), rel))
    if copied == 0:
        sys.exit("❌ branding 目录是空的：%s" % src)
    print("✅ 已覆盖 %d 个图标资源文件（来源：%s）" % (copied, os.path.relpath(src, ROOT)))


def main():
    ap = argparse.ArgumentParser(description="把一个 APK 变体的品牌参数写进工程")
    ap.add_argument("--app-id", default="", help="Android 包名（applicationId）")
    ap.add_argument("--app-name", default="", help="桌面显示的应用名")
    ap.add_argument("--version-code", default="", help="versionCode，整数")
    ap.add_argument("--version-name", default="", help="versionName，如 1.0.0")
    ap.add_argument("--branding", default="", help="图标资源目录（相对安卓版根目录）")
    ap.add_argument("--res-dir", default="", help="目标 res 目录（默认 android/app/src/main/res，调试用可覆盖）")
    args = ap.parse_args()

    if not any([args.app_id, args.app_name, args.version_code, args.version_name, args.branding]):
        ap.error("至少要给一个参数")

    if any([args.app_id, args.app_name, args.version_code, args.version_name]):
        apply_config(args.app_id, args.app_name, args.version_code, args.version_name)
    if args.branding:
        apply_branding(args.branding, args.res_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
