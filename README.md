# 药品管理相关法规知识竞赛试题库 —— Android 离线版

把「药品管理题库」（300 题，每题含 AI 解析与法条依据）打包成 **Android 手机 App**，
安装后**完全离线**使用，不需要电脑、不需要联网、不需要浏览器。

技术栈与参考项目 `E:\5.Question bank testing software\CommDebug-apk` 一致：
**Capacitor 8 + 原生 HTML/CSS/JS + Python 生成离线数据 + Gradle 工程 + GitHub Actions 出包**。

> 实现细节见 [Claude.md](./Claude.md)；构建说明见 [BUILD.md](./BUILD.md)。

---

## 功能

- **四种练习**：顺序练习（断点续做）、随机练习（打乱 300 题）、错题练习、背题模式
- **解析与法条**：每题作答后自动展开 AI 解析与法律条文依据
- **错题本 + 统计**：错题自动收录、答对自动移出；正确率（最近一次）、题型分项、累计作答次数
- **手机适配**：按钮与选项 ≥ 44px、字号 ≥ 14px，单手可点
- **完全离线**：题库内嵌在安装包里（约 350 KB 数据），飞行模式也能刷

判分规则与正式竞赛一致：**多选题选项完全一致才算对**，多选、少选、错选都算错。

---

## 安装使用

1. 到 GitHub Actions 的构建产物里下载 `DrugQuiz-SC2.apk`（或本地自行构建，见 BUILD.md）；
2. 把 APK 传到手机（微信/QQ/数据线均可）；
3. 手机上点击安装，首次会提示"允许安装未知来源应用"，同意即可；
4. 桌面出现 **药品法规刷题** 图标，点开就能用。

---

## 目录结构

```
安卓版/
├─ www/                      # App 内的网页（Capacitor 的 webDir）
│  ├─ index.html             # 页面结构（由 build_www.py 生成）
│  ├─ style.css              # 样式（由 build_www.py 生成）
│  ├─ app.js                 # 应用逻辑（由 build_www.py 生成）
│  └─ data-offline.js        # 离线题库（由 generate_offline.py 生成）
├─ generate_offline.py       # 题库 → www/data-offline.js
├─ build_www.py              # 静态版模板 → www/index.html + style.css + app.js
├─ verify_www.mjs            # 用真实浏览器验收 App 内网页（14 项）
├─ capacitor.config.ts       # Capacitor 配置（包名 / 应用名 / webDir）
├─ package.json              # Capacitor 依赖与构建脚本
├─ android/                  # Capacitor 生成的 Android 原生工程
├─ .github/workflows/build-apk.yml   # CI：自动构建 APK
├─ BUILD.md                  # 构建说明
├─ Claude.md                 # 实现技术说明文档
└─ 验证截图/                  # 网页资源验收截图
```

---

## 常用命令

```powershell
npm install                    # 安装依赖（Capacitor 8）
python generate_offline.py     # 重新生成离线题库
python build_www.py            # 重新拆分网页资源
npx cap sync android           # 同步到 Android 工程
node verify_www.mjs            # 浏览器验收 App 内网页（14 项）
```

改题流程：改 `../tools/data/questions.json`（或重跑 `../tools/import-new-bank.py`）→
再执行上面第 2～4 条命令 → 重新打包。

---

## 说明

- 本 App 为**内部培训用途**，题库内容来自药品管理相关法规与内部整理资料，请勿随意外传；
- 产物是 **debug 调试卷**（未签名 release、未上架应用商店），适合内部侧载安装；
- 练习进度保存在手机本地，卸载 App 或清除应用数据会丢失进度。
