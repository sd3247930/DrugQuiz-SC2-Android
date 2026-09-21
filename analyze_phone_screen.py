#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
文件名称：安卓版/analyze_phone_screen.py
文件作用：
    对手机截图做"顶部导航 / 状态栏 / 底栏"的客观像素分析，用于
      · 阶段 0：记录改造前的基准数字（APK 版 vs HBuilderX 版）
      · 阶段 6：改造后用同一脚本复测，逐条验收 G1/G2/G3

分析项：
    1. 顶栏品牌色带（#0F5B78）的起始与结束 y —— 判断状态栏那一条是不是被网页顶栏铺色
    2. 品牌色带内第一行"非品牌色"像素 —— 顶栏内容（Logo/文字）实际起始位置
    3. 挖孔矩形内是否为黑（硬件挖孔）以及"内容起始 y"是否落在挖孔下方
    4. 状态栏区域（挖孔以外）的亮/暗像素占比 —— 判断图标是浅色还是深色
    5. 底部：导航栏条带高度与颜色、底栏（tabbar）下沿位置

用法：
    python analyze_phone_screen.py <截图.png> [--density 3.5] [--cutout 480,0,776,136]
                                   [--status-bar 136] [--nav 78] [--label "说明"]
"""

import argparse
import sys

from PIL import Image

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BRAND = (15, 91, 120)        # #0F5B78 顶栏品牌色
BRAND_TOL = 26               # 颜色容差（JPEG/抗锯齿导致的小偏差）


def close_to(px, target, tol=BRAND_TOL):
    return all(abs(px[i] - target[i]) <= tol for i in range(3))


def row_is_brand(img, y, x0, x1, ratio=0.6):
    """从 x0 到 x1 采样，判断这一行是否大部分是品牌色"""
    total = 0
    hit = 0
    step = max(1, (x1 - x0) // 40)
    for x in range(x0, x1, step):
        total += 1
        if close_to(img.getpixel((x, y)), BRAND):
            hit += 1
    return total > 0 and hit / total >= ratio


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("png")
    ap.add_argument("--density", type=float, default=3.5, help="devicePixelRatio（荣耀 BKQ-AN90 = 3.5）")
    ap.add_argument("--cutout", default="480,0,776,136", help="挖孔矩形 x0,y0,x1,y1（物理像素）")
    ap.add_argument("--status-bar", type=int, default=136, help="状态栏高度（物理像素）")
    ap.add_argument("--nav", type=int, default=78, help="导航栏/手势条高度（物理像素）")
    ap.add_argument("--label", default="")
    args = ap.parse_args()

    img = Image.open(args.png).convert("RGB")
    W, H = img.size
    d = args.density
    cx0, cy0, cx1, cy1 = [int(v) for v in args.cutout.split(",")]

    print("=" * 68)
    print(f"截图分析{'：' + args.label if args.label else ''}  {args.png}")
    print(f"图像 {W}×{H} 物理像素 / 密度 {d} → 逻辑 {W / d:.1f}×{H / d:.1f} CSS px")
    print(f"状态栏 {args.status_bar}px = {args.status_bar / d:.1f} CSS px ；"
          f"手势条 {args.nav}px = {args.nav / d:.1f} CSS px ；"
          f"挖孔 x{cx0}-{cx1} y{cy0}-{cy1}（高 {cy1 - cy0}px = {(cy1 - cy0) / d:.1f} CSS px）")

    # ---- 1) 顶栏品牌色带范围（只看挖孔以外的中间列，避免被挖孔黑块干扰）----
    probe_x0, probe_x1 = int(W * 0.12), int(W * 0.88)
    band_start = None
    band_end = None
    for y in range(0, min(H, int(args.status_bar * 4))):
        if row_is_brand(img, y, probe_x0, probe_x1):
            if band_start is None:
                band_start = y
            band_end = y
        elif band_start is not None and y > band_end + 12:
            break
    if band_start is None:
        print("顶栏色带：未找到（顶部不是品牌色）")
    else:
        print(f"顶栏色带：#0F5B78 从 y={band_start} 到 y={band_end}"
              f"（高 {band_end - band_start + 1}px = {(band_end - band_start + 1) / d:.1f} CSS px）")
        print(f"           起始 y={band_start}px = {band_start / d:.1f} CSS px"
              f" → 状态栏那一条{'由网页顶栏铺色（edge-to-edge）' if band_start <= 2 else '不是网页顶栏铺色'}")

    # ---- 2) 顶栏色带内第一行"非品牌色"像素 = 内容（Logo/文字）起始 ----
    content_top = None
    if band_start is not None:
        for y in range(band_start, band_end + 1):
            found = False
            for x in range(probe_x0, probe_x1, 2):
                if cx0 <= x <= cx1 and y <= cy1:      # 跳过挖孔
                    continue
                if not close_to(img.getpixel((x, y)), BRAND):
                    found = True
                    break
            if found:
                content_top = y
                break
    if content_top is not None:
        print(f"顶栏内容起始：y={content_top}px = {content_top / d:.1f} CSS px"
              f"（相对状态栏底边 {args.status_bar}px，{'在下方 ✅' if content_top >= args.status_bar else '仍在状态栏/挖孔区内 ❌'}）")

    # ---- 3) 挖孔区域是否黑 + 是否与内容相交 ----
    dark = 0
    total = 0
    for y in range(cy0, cy1, 4):
        for x in range(cx0, cx1, 4):
            total += 1
            r, g, b = img.getpixel((x, y))
            if r < 40 and g < 40 and b < 40:
                dark += 1
    print(f"挖孔区域：{dark}/{total} 采样点为深色（{dark / max(1, total) * 100:.0f}%）"
          f" → {'看起来是硬件挖孔（黑）' if dark / max(1, total) > 0.5 else '不是黑（可能是白色面板或系统绘制）'}")
    if content_top is not None:
        overlap = content_top < cy1
        print(f"内容与挖孔：内容起始 y={content_top} vs 挖孔底边 y={cy1} → "
              f"{'相交 ❌（会被摄像头遮住）' if overlap else '不相交 ✅'}")

    # ---- 4) 状态栏区域（排除挖孔）的亮/暗像素占比 ----
    light = 0
    darkish = 0
    tot2 = 0
    for y in range(0, args.status_bar, 2):
        for x in range(0, W, 4):
            if cx0 <= x <= cx1 and y <= cy1:
                continue
            tot2 += 1
            r, g, b = img.getpixel((x, y))
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            if lum > 190:
                light += 1
            elif lum < 70:
                darkish += 1
    if tot2:
        print(f"状态栏区域（挖孔外）：浅色像素 {light / tot2 * 100:.1f}% ，深色像素 {darkish / tot2 * 100:.1f}%"
              f" → 图标看起来是{'浅色（白）' if light > darkish else '深色（黑）'}")

    # ---- 5) 底部：手势条条带颜色 + 底栏下沿 ----
    ys = H - args.nav
    samples = [img.getpixel((x, ys + args.nav // 2)) for x in range(int(W * 0.1), int(W * 0.9), 20)]
    avg = tuple(sum(c[i] for c in samples) // len(samples) for i in range(3))
    print(f"手势条条带：平均色 RGB{avg}")
    edge = None
    for y in range(H - args.nav - 1, H - args.nav - 400, -1):
        r, g, b = img.getpixel((int(W * 0.5), y))
        if not (abs(r - avg[0]) <= 12 and abs(g - avg[1]) <= 12 and abs(b - avg[2]) <= 12):
            edge = y
            break
    if edge is not None:
        above = img.getpixel((int(W * 0.5), edge))
        print(f"手势条上方内容下沿：y={edge}px = {edge / d:.1f} CSS px"
              f"（距屏幕底 {(H - edge) / d:.1f} CSS px，手势条高 {args.nav / d:.1f} CSS px）")
        print(f"                     该处颜色 RGB{above} → "
              f"{'底栏（浅色）' if sum(above) / 3 > 150 else '深色内容'}")
    print("=" * 68)


if __name__ == "__main__":
    main()
