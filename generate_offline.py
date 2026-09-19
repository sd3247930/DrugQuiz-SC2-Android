#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文件名称：安卓版/generate_offline.py
文件作用：
    把题库单一数据源（../tools/data/questions.json，300 题，含解析与法条）
    生成为 App 内嵌的离线数据文件 www/data-offline.js。

输出内容（window.__QUESTION_BANK__）：
    [
      { "type": "单选", "question": "题干", "options": ["A. ...", ...],
        "answer": ["C"], "explanation": "AI解析", "law": {"title": "...", "text": "..."} }
    ]

为什么单独生成：
    与参考项目 CommDebug-apk 的做法一致——题库与页面代码分离，
    换题只需重跑本脚本 + npm run sync，不用改前端代码。

运行：python generate_offline.py
"""

import io
import json
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "www", "data-offline.js")

# 题库来源按优先级查找：
#   1) ../tools/data/questions.json  —— 项目里的题库唯一数据源（本地开发时优先，保证用的是最新题库）
#   2) ./data/questions.json         —— 仓库内自带的题库快照（本仓库独立克隆/CI 构建时使用）
SRC_CANDIDATES = [
    os.path.join(os.path.dirname(BASE), "tools", "data", "questions.json"),
    os.path.join(BASE, "data", "questions.json"),
]


def find_source():
    """按优先级找到题库文件；都找不到时退出并给出提示"""
    for path in SRC_CANDIDATES:
        if os.path.exists(path):
            return path
    print("❌ 找不到题库文件，已尝试以下位置：")
    for path in SRC_CANDIDATES:
        print("   - %s" % path)
    print("   请先在本项目根目录运行：python tools/import-new-bank.py")
    sys.exit(1)


def main():
    src = find_source()
    with io.open(src, encoding="utf-8") as f:
        bank = json.load(f)

    # 校验（与静态版、服务端版同一套口径）
    errors = []
    single = sum(1 for q in bank if q.get("type") == "单选")
    multi = sum(1 for q in bank if q.get("type") == "多选")
    if len(bank) != 300:
        errors.append("题目总数应为 300，实际 %d" % len(bank))
    if single != 190 or multi != 110:
        errors.append("题型分布应为单选 190 / 多选 110，实际 %d / %d" % (single, multi))
    for idx, q in enumerate(bank, 1):
        letters = [o.strip()[0] for o in q.get("options", []) if o.strip()]
        if not q.get("question"):
            errors.append("第 %d 题题干为空" % idx)
        if len(q.get("options", [])) < 4:
            errors.append("第 %d 题选项少于 4 个" % idx)
        if not q.get("explanation"):
            errors.append("第 %d 题缺少解析" % idx)
        if not (q.get("law") or {}).get("text"):
            errors.append("第 %d 题缺少法条依据" % idx)
        for a in q.get("answer", []):
            if a not in letters:
                errors.append("第 %d 题答案 %s 不在选项中" % (idx, a))
    if errors:
        print("❌ 校验未通过：")
        for e in errors[:20]:
            print("   -", e)
        sys.exit(1)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("/* 自动生成：Android 离线题库数据（请勿手改，改题请改源文件后重跑 generate_offline.py） */\n")
        f.write("window.__QUESTION_BANK__ = ")
        json.dump(bank, f, ensure_ascii=False, indent=0, separators=(",", ":"))
        f.write(";\n")
        f.write("window.__BANK_STATS__ = {total: %d, single: %d, multi: %d};\n" % (len(bank), single, multi))

    size_kb = os.path.getsize(OUT) / 1024
    print("✅ 已生成离线题库：%s" % OUT)
    print("   题库来源：%s" % src)
    print("   题目：%d 题（单选 %d / 多选 %d），文件 %.0f KB" % (len(bank), single, multi, size_kb))
    print("   每题均含 AI 解析与法条依据")


if __name__ == "__main__":
    main()
