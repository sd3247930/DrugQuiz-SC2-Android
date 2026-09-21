# 药品管理相关法规知识竞赛试题库 —— Android 离线版

把「药品管理题库」（300 题，每题含 AI 解析与法条依据）打包成 **Android 手机 App**，
安装后**完全离线**使用，不需要电脑、不需要联网、不需要浏览器。

技术栈与参考项目 `E:\5.Question bank testing software\CommDebug-apk` 一致：
**Capacitor 8 + 原生 HTML/CSS/JS + Python 生成离线数据 + Gradle 工程 + GitHub Actions 出包**。

> 实现细节见 [Claude.md](./Claude.md)；构建说明见 [BUILD.md](./BUILD.md)。

---

## 功能（v1.1 起与服务端版一致）

- **四个页面 + 顶部导航**：首页 / 顺序练习 / 随机练习 / 错题练习 / 答题卡 / 设置
- **练习**：顺序（断点续做）、随机（打乱 300 题）、错题练习、**自定义选题练习**（按勾选顺序）、背题模式、上一题
- **解析**：每题作答后自动展开 AI 解析（v1.3 起解析区不再重复展示法条原文，改由下面的按钮查看）
- **查看法条**：做题前/做题中即可点「查看法条」看**本题**依据的条文原文（切题自动更新，无对应法条时置灰）
- **答题卡**：统计卡、**5 列题号矩阵（点题号跳题）**、错题本列表、清空错题、**导出错题（JSON）**
- **选题练习**：按**题型 / 状态（未做、做错、已收藏）/ 关键词**筛选后自由勾题，全选 / 反选 / 清空
- **法条浏览**：列出法条 → 展开条文原文 → 一键练该法条下的题
- **我的笔记**：练习页解析下方写自己的备注（错因、易混点），停止输入或离开输入框自动保存，只存在本机
- **进度备份**：设置页可**导出 / 导入进度**（JSON）；App 内导出走剪贴板（WebView 不支持直接下载文件），导入走原生文件选择器
- **设置**：背题模式、夜间模式（4 个页面文字对比度均 ≥4.5:1）、字号、答对自动下一题；一键「重置为内置题库（恢复出厂）」
- **视觉**：统一设计 token + 纯 CSS 背景纹理（零依赖），题干卡片化、选项悬浮反馈、导航胶囊

## v1.4 设计稿移植（界面按设计稿重做）

- **品牌图标**：Android 全套图标（5 密度 × 普通/圆形/自适应前景）与 WebView 头部 logo 已换成品牌 Logo
- **顶部品牌栏**：深青底 + logo + 部门标识「生产二部」（设计稿规格 56px）
- **底部 4 个 tab**：首页 / 练习 / 答题卡 / 设置（60px，含 safe-area 与 72px 底部留白）
- **M3 设计 token**：主色 `#0F5B78`、画布 `#F8FAFC`、Slate 文字色、答对 `#10B981` / 答错 `#EF4444`、圆角 4/6/8
- **字体自托管**：Inter 400/500/600 + Plus Jakarta Sans 600/700（latin 子集，约 195 KB），离线可用
- 未引入任何第三方库（Vue / Vite / Tailwind / p5.js 都没有）
- **完全离线**：题库内嵌在安装包里（约 350 KB 数据），飞行模式也能刷

> 设计稿来源：`../private/Stitch - Design with AI/` 下的 `01品牌完整Logo/`、`02首页/`、`03练习页/`、`04答题卡与选题页/`、`05设置页/`（private 目录已整理分层）

## v1.5 功能补齐（与服务端版同步）

App 的网页资源由 `build_www.py` 从服务端版生成，所以服务端版这几轮的新功能 App 一起拿到了：

- **答题卡题号矩阵**：查看答题卡页的统计下方新增 5 列题号矩阵（300 格），未答灰 / 答对绿 / 答错红 / 收藏 ★；点题号直接跳到该题
- **进度导出 / 导入**：设置页新增「进度备份」，导出文件格式与服务端版、静态单文件版**互通**
  - App 内特别注意：**Capacitor 的 WebView 不支持 `a[download]`**，所以导出改走**剪贴板**（提示"可粘贴到备忘录保存"），剪贴板不可用时退到**只读文本框 + 自动全选**；
  - 导入不受影响，`<input type="file">` 在 WebView 里会调起**原生文件选择器**
- **我的笔记**：练习页解析下方写备注，自动保存（走 `local-api.js` 的 `/api/note`，存在 App 私有存储里）
- 顺带对齐服务端版的统计口径：只写了笔记、没有作答的题**不计入已答题数**

判分规则与正式竞赛一致：**多选题选项完全一致才算对**，多选、少选、错选都算错。

## v1.5.3 固定签名 + Release 直链（网页点一下就装）

这一版把「怎么拿到 APK」从**登录 GitHub 找构建产物**改成**网页上点一下直接下载**，并顺手修掉一个会丢数据的坑：

| 项 | 改动 |
| --- | --- |
| 固定签名 | 新增 `drugquiz` 密钥（备份在 `../../android-signing/`），CI 出的是正式签名 release 包。**改之前每次 CI 的 debug 签名都不一样，新版装不上旧版、必须卸载重装（进度丢失）** |
| Release 直链 | 打 `v*` tag → 自动发 Release，产物固定名 `DrugQuiz-SC2.apk`：`releases/latest/download/DrugQuiz-SC2.apk` 永久有效 |
| 版本 | versionCode 9 / versionName 1.5.3（首个签名稳定的版本） |
| 网页入口 | 静态单文件版顶栏新增「📲 安装」→「📥 下载应用（APK）」面板（见根目录 `../README.md`） |

> ⚠️ 因为换成了正式签名密钥，**从 1.5.2 及更早版本升级到 1.5.3 需要先卸载旧版**（签名不同无法覆盖）。从 1.5.3 往后就可以直接覆盖升级了。卸载前记得在旧 App 里「导出进度」，装好新版再「导入进度」。

---

## 安装使用

**方式一（推荐，直接在手机上装）**

1. 手机浏览器打开网页版 <https://sd3247930.github.io/drug-quiz-sc2/>；
2. 点右上角 **「📲 安装」** → 面板里点 **「📥 下载应用（APK）」** → 浏览器直接下载安装包；
3. 点安装，首次会提示「允许安装未知来源应用」，同意即可；
4. 桌面出现 **药品法规刷题** 图标，点开就能用；
5. 想把网页上的进度搬进来：先在网页「导出进度」保存文件，再在 App「设置 → 进度备份 → 导入进度」导入。

> 固定直链（永远指向最新版，可直接转发给同事）：
> <https://github.com/sd3247930/DrugQuiz-SC2-Android/releases/latest/download/DrugQuiz-SC2.apk>

**方式二（本地构建，见 BUILD.md）**

在 `安卓版/` 目录执行 `npx cap sync android` 后在 `android/` 里 `gradlew assembleRelease`（本地无签名环境变量时会自动退回 debug 签名）。

**由 GitHub Actions 自动出包**

推送 `main` 只出 artifact（保留 90 天）；打 `v*` tag 会自动发 Release，产物固定名 `DrugQuiz-SC2.apk`。见 `.github/workflows/build-apk.yml`。

---

## 目录结构

```
安卓版/
├─ www/                      # App 内的网页（Capacitor 的 webDir）
│  ├─ index.html             # 首页        ┐
│  ├─ practice.html          # 练习页      ├ 由 build_www.py 从服务端版生成
│  ├─ answer_card.html       # 答题卡      │
│  ├─ settings.html          # 设置页      ┘
│  ├─ style.css / script.js / selection.js / law.js   # ← 服务端版原样复用
│  ├─ local-api.js           # ★ 本地接口垫片（App 无后端的核心）
│  ├─ page-init.js           # ★ 填充统计与设置项、导航高亮、重置入口
│  └─ data-offline.js        # 离线题库（由 generate_offline.py 生成）
├─ web/                      # App 专用脚本源文件（生成时复制进 www/）
│  ├─ local-api.js           # ★ 本地接口垫片源文件
│  ├─ page-init.js           # ★ 页面初始化源文件
│  └─ app-shim.js            # ★ HTML5+（HBuilderX）环境的剪贴板兼容补丁
├─ data/questions.json       # 题库快照（独立克隆/CI 构建用；本地优先读 ../tools/data/questions.json）
├─ template_server/          # 服务端版快照（同上用途）
├─ generate_offline.py       # 题库 → www/data-offline.js
├─ build_www.py              # 服务端版模板 + 脚本 → www/（含 Jinja 残留检查与孤儿文件清理）
├─ verify_www.mjs            # 用真实浏览器验收 App 内网页（55 项）
├─ sync_hbuilder.py          # 把 www/ 同步到 HBuilderX 工程并校验一致性
├─ verify_hbuilder.mjs       # HBuilderX 工程验收（29 项：结构 + file:// 冒烟）
├─ HBuilderX说明.md           # 在 HBuilderX 里运行/调试的完整说明
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
node verify_www.mjs            # 浏览器验收 App 内网页（55 项）
python sync_hbuilder.py        # 同步到 HBuilderX 工程（可选，见 HBuilderX说明.md）
node verify_hbuilder.mjs       # 验收 HBuilderX 工程（29 项）
node verify-quiz-40.mjs        # 作答测试：单选 20 道 + 多选 20 道（16 项断言）
node verify-sheet.mjs          # 全屏面板验收（16 项：安全区 + 滑动关闭 + 返回键）
python analyze_phone_screen.py <截图.png>   # 手机截图像素分析（顶栏安全区 / 挖孔 / 图标颜色 / 底栏）
node probe_device_webview.mjs probe         # 真机 WebView 探针（需临时开启调试开关，见交付说明）
```

> 同一份网页资源现在有两个「壳」：Capacitor（本目录，出正式 APK）与 HBuilderX uni-app 工程
> （`D:\codex code\HBuilderProjects\DrugQuiz-SC2-Android\Pharma Law Quiz Bank`，用于在 HBuilderX 里运行调试）。
> 同步与验收命令见 [HBuilderX说明.md](./HBuilderX说明.md)。

改题流程：在项目源目录重跑 `../tools/import-new-bank.py` → 把新的 `questions.json`
复制到本目录 `data/questions.json` 更新快照 → 再执行上面第 2～4 条命令 → 重新打包。

改界面流程：改 `../服务端版/`（模板或前端脚本）→ `python build_www.py` → `npx cap sync android`。
App 会跟着服务端版一起变，这是 v1.1 起的设计（详见 `Claude.md` 第 4.2 节）。

---

## 相关仓库 / 其它版本

同一个题库有三个版本，进度格式互通：

- **网页版（静态单文件）**：[sd3247930.github.io/drug-quiz-sc2](https://sd3247930.github.io/drug-quiz-sc2/)
  —— 单个 `index.html`，双击即用，也可添加到手机主屏离线刷题
- **服务端版（Flask）**：局域网多人访问、进度存在服务端电脑上；**App 的网页资源就是由它生成的**
  （同一套模板与脚本，所以三版界面一致）
- **进度互通**：三个版本的「导出进度」生成同一种 JSON，可在任意两版之间互相导入
  （App 在设置页「进度备份」，网页版在首页「记录管理」）

---

## 说明

- 本 App 为**内部培训用途**，题库内容来自药品管理相关法规与内部整理资料，请勿随意外传；
- 产物是 **debug 调试卷**（未签名 release、未上架应用商店），适合内部侧载安装；
- 练习进度保存在手机本地，卸载 App 或清除应用数据会丢失进度。
