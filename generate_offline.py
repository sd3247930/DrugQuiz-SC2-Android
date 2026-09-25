#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文件名称：安卓版/generate_offline.py
文件作用：
    把「多题库」数据源生成为 App 内嵌的离线数据文件 www/data-offline.js。

    数据源（按优先级）：
      1) ../tools/data/index.json + banks/*.json   —— 开发时的项目数据源
      2) ./data/index.json   + banks/*.json        —— 仓库内快照（CI / 独立克隆用）
      3) 兼容回落：单一 questions.json（老结构，没有 index.json 时）

    输出内容：
      window.__QUESTION_BANKS__ = { "<题库id>": [题目…], … }   ← 全部题库（App 内可切换）
      window.__BANK_INDEX__     = { version, banks:[…], default } ← 清单（含显示名/题数/包名）
      window.__QUESTION_BANK__  = 默认题库的题目数组             ← 兼容旧代码
      window.__BANK_STATS__     = { total, single, multi }      ← 兼容旧代码（默认题库）

    校验改按每个题库自己的 meta.json（M3）：total/single/multiple 必须对上，
    requireExplanation / requireLaw 为 true 时才强制每题带解析/法条。

运行：
    python generate_offline.py                 # 默认题库取 index.json 的 default
    python generate_offline.py --bank 软考-架构师   # 指定该 APK 的默认题库
    也可用环境变量 BANK_ID
"""

import argparse
import io
import json
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "www", "data-offline.js")

# 数据源候选目录（含 index.json 的目录）
DATA_ROOT_CANDIDATES = [
    os.path.join(os.path.dirname(BASE), "tools", "data"),   # 开发：项目数据源
    os.path.join(BASE, "data"),                             # CI：仓库内快照
]
# 老结构回落
LEGACY_CANDIDATES = [
    os.path.join(os.path.dirname(BASE), "tools", "data", "questions.json"),
    os.path.join(BASE, "data", "questions.json"),
]


def find_data_root():
    for path in DATA_ROOT_CANDIDATES:
        if os.path.exists(os.path.join(path, "index.json")):
            return path
    return None


def find_legacy_source():
    for path in LEGACY_CANDIDATES:
        if os.path.exists(path):
            return path
    return None


def read_json(path):
    with io.open(path, encoding="utf-8") as f:
        return json.load(f)


def validate(bank, meta, label):
    """按 meta.json 校验一个题库（M3 断言改造）。"""
    errors = []
    single = sum(1 for q in bank if q.get("type") == "单选")
    multi = sum(1 for q in bank if q.get("type") == "多选")

    if len(bank) != meta.get("total"):
        errors.append("[%s] 题目总数应为 %s，实际 %d" % (label, meta.get("total"), len(bank)))
    if single != meta.get("single"):
        errors.append("[%s] 单选应为 %s，实际 %d" % (label, meta.get("single"), single))
    if multi != meta.get("multiple"):
        errors.append("[%s] 多选应为 %s，实际 %d" % (label, meta.get("multiple"), multi))

    need_expl = bool(meta.get("requireExplanation"))
    need_law = bool(meta.get("requireLaw"))
    for idx, q in enumerate(bank, 1):
        letters = [o.strip()[0] for o in q.get("options", []) if o.strip()]
        if not q.get("question"):
            errors.append("[%s] 第 %d 题题干为空" % (label, idx))
        if len(q.get("options", [])) < 2:
            errors.append("[%s] 第 %d 题选项少于 2 个" % (label, idx))
        if need_expl and not q.get("explanation"):
            errors.append("[%s] 第 %d 题缺少解析（meta.requireExplanation=true）" % (label, idx))
        if need_law and not (q.get("law") or {}).get("text"):
            errors.append("[%s] 第 %d 题缺少法条依据（meta.requireLaw=true）" % (label, idx))
        if not q.get("answer"):
            errors.append("[%s] 第 %d 题没有答案" % (label, idx))
        for a in q.get("answer", []):
            if a not in letters:
                errors.append("[%s] 第 %d 题答案 %s 不在选项中" % (label, idx, a))
    return errors, single, multi


def load_all_banks(data_root):
    """读 index.json + 每个题库的 json/meta，逐个校验。"""
    index = read_json(os.path.join(data_root, "index.json"))
    banks = {}
    metas = []
    errors = []
    for item in index.get("banks", []):
        data_path = os.path.join(data_root, item["data"])
        meta_path = os.path.join(data_root, item["meta"])
        if not os.path.exists(data_path):
            errors.append("题库数据缺失：%s" % data_path)
            continue
        if not os.path.exists(meta_path):
            errors.append("题库 meta 缺失：%s" % meta_path)
            continue
        bank = read_json(data_path)
        meta = read_json(meta_path)
        bank_id = meta.get("id") or item["id"]
        errs, single, multi = validate(bank, meta, bank_id)
        errors.extend(errs)
        banks[bank_id] = bank
        metas.append({
            "id": bank_id,
            "name": meta.get("name") or item.get("name") or bank_id,
            "appName": meta.get("appName") or meta.get("name") or bank_id,
            "appId": meta.get("appId") or "com.drugquiz.sc2",
            "version": meta.get("version") or "",
            "total": len(bank),
            "single": single,
            "multiple": multi,
            "hasExplanationCount": sum(1 for q in bank if (q.get("explanation") or "").strip()),
            "hasLawCount": sum(1 for q in bank if (q.get("law") or {}).get("text")),
            "license": meta.get("license") or "",
            "description": meta.get("description") or "",
        })
    return index, banks, metas, errors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bank", default=os.environ.get("BANK_ID", ""),
                    help="该 APK 的默认题库 id（缺省用 index.json 的 default）")
    ap.add_argument("--include", default=os.environ.get("BANK_INCLUDE", ""),
                    help="只内置这些题库（逗号分隔，缺省=全部）——S-2「复选框选多个」用")
    args = ap.parse_args()

    data_root = find_data_root()
    errors = []

    if data_root:
        index, banks, metas, errors = load_all_banks(data_root)
        # S-2/S-3：按需子集（缺省=全部包含）
        wanted = [x.strip() for x in args.include.split(",") if x.strip()]
        if wanted:
            keep = [m for m in metas if m["id"] in wanted]
            banks = {k: v for k, v in banks.items() if k in wanted}
            metas = keep
            if not banks:
                errors.append("--include 指定的题库都不存在：%s" % args.include)
        default_id = args.bank or index.get("default") or (metas[0]["id"] if metas else "")
        if default_id not in banks:
            errors.append("默认题库 %r 不在 index.json 里（可选：%s）"
                          % (default_id, "、".join(banks.keys()) or "无"))
    else:
        # 兼容回落：老的单题库结构
        src = find_legacy_source()
        if not src:
            print("❌ 找不到数据源，已尝试：")
            for path in DATA_ROOT_CANDIDATES + LEGACY_CANDIDATES:
                print("   - %s" % path)
            print("   请先运行：python tools/import-new-bank.py")
            sys.exit(1)
        print("⚠️  未找到 index.json，回落到单题库模式：%s" % src)
        bank = read_json(src)
        bank_id = "药品法规"
        banks = {bank_id: bank}
        metas = [{"id": bank_id, "name": "药品法规刷题", "appName": "药品法规刷题",
                  "appId": "com.drugquiz.sc2", "version": "", "total": len(bank),
                  "single": sum(1 for q in bank if q.get("type") == "单选"),
                  "multiple": sum(1 for q in bank if q.get("type") == "多选"),
                  "hasExplanationCount": 0, "hasLawCount": 0, "license": "", "description": ""}]
        default_id = bank_id
        if len(bank) != 300:
            errors.append("题目总数应为 300，实际 %d" % len(bank))

    if errors:
        print("❌ 校验未通过：")
        for e in errors[:20]:
            print("   -", e)
        sys.exit(1)

    default_bank = banks[default_id]
    default_meta = next(m for m in metas if m["id"] == default_id)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("/* 自动生成：Android 离线题库数据（请勿手改，改题请改源文件后重跑 generate_offline.py） */\n")
        f.write("window.__QUESTION_BANKS__ = ")
        json.dump(banks, f, ensure_ascii=False, indent=0, separators=(",", ":"))
        f.write(";\n")
        f.write("window.__BANK_INDEX__ = ")
        json.dump({"version": index.get("version", 1) if data_root else 1,
                   "banks": metas, "default": default_id},
                  f, ensure_ascii=False, indent=0, separators=(",", ":"))
        f.write(";\n")
        # 兼容旧代码：__QUESTION_BANK__ 指向默认题库
        f.write('window.__QUESTION_BANK__ = window.__QUESTION_BANKS__["%s"];\n' % default_id)
        f.write("window.__BANK_STATS__ = {total: %d, single: %d, multi: %d};\n"
                % (len(default_bank), default_meta["single"], default_meta["multiple"]))

    size_kb = os.path.getsize(OUT) / 1024
    print("✅ 已生成离线题库：%s" % OUT)
    print("   数据源：%s" % (data_root or "（单题库回落）"))
    print("   题库：%d 个 ｜ 默认：%s（%s）" % (len(banks), default_id, default_meta["name"]))
    for m in metas:
        print("     · %-12s %4d 题（单选 %d / 多选 %d）｜带解析 %d ｜带法条 %d"
              % (m["id"], m["total"], m["single"], m["multiple"],
                 m["hasExplanationCount"], m["hasLawCount"]))
    print("   文件 %.0f KB" % size_kb)


if __name__ == "__main__":
    main()
