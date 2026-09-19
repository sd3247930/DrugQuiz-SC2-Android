# 实现技术说明文档：药品管理题库 Android 版

> 项目名称：药品管理相关法规知识竞赛试题库（生产二部专用）—— Android 离线版
> 项目代号：DrugQuiz-SC2-Android
> 文档版本：v1.0　|　编写日期：2026-09-19
> 落地目录：`D:\codex code\四合一工具集\药品管理题库\安卓版`
> 技术栈来源：`E:\5.Question bank testing software\CommDebug-apk`（Capacitor 离线 APK 方案）
> 配套文档：`README.md`（使用）、`BUILD.md`（构建）

---

## 0. 一句话结论

用与参考项目 **完全一致的技术栈**（Capacitor 8 + 原生 HTML/CSS/JS + Python 生成离线数据 + Gradle 工程 + GitHub Actions 出包），
把「药品管理题库」的 300 道题（含 AI 解析与法条依据）打包成 **Android 离线 App**：
装到手机上后不联网、不依赖电脑、不需要浏览器，断网也能刷题。

**当前状态**：项目工程与离线数据已完成，App 内网页资源经真实浏览器验收 **14/14 通过**；
APK 需通过 GitHub Actions 构建（本机沙箱环境无法运行 Gradle，原因见第 6.3 节）。

---

## 1. 技术栈（均为实测版本）

| 层 | 技术 | 版本 | 说明 |
| --- | --- | --- | --- |
| 移动容器 | Capacitor | **8.5.0** | `@capacitor/core`、`@capacitor/cli`、`@capacitor/android` 三者同版本 |
| 前端 | 原生 HTML / CSS / JavaScript | — | 与静态版、服务端版共用同一份逻辑来源，**不引入任何前端框架** |
| 数据生成 | Python | **3.14.6** | `generate_offline.py`、`build_www.py` |
| 构建工具 | Gradle | **8.14.3** | 由 `android/gradlew` 驱动 |
| JDK | Temurin OpenJDK | **21.0.12** | Capacitor 8 与 AGP 要求 Java 21 |
| Android SDK | compileSdk / targetSdk | **36** | build-tools 36.0.0 |
| 最低系统 | minSdk | **24** | 对应 Android 7.0 及以上 |
| 运行时 | Android WebView | — | Capacitor 内置，加载本地 `assets/public` |
| CI | GitHub Actions | — | Node 22 + JDK 21 + Android SDK 36，产出 APK 工件 |

**依赖清单（package.json）**

```json
{
  "dependencies": { "@capacitor/android": "^8.5.0", "@capacitor/core": "^8.5.0" },
  "devDependencies": { "@capacitor/cli": "^8.5.0", "typescript": "^7.0.2" }
}
```

> 说明：本项目**没有**引入参考项目里的原生 TTS 朗读插件——药品题库当前没有语音朗读功能，
> 不装载无用插件可以少一层编译风险（如将来要加朗读，按参考项目的 `TextToSpeechPlugin` 方案补即可）。

---

## 2. 目录结构

```
安卓版/
├─ www/                         # App 内网页（Capacitor 的 webDir）
│  ├─ index.html                # 页面结构      ← build_www.py 生成
│  ├─ style.css                 # 样式          ← build_www.py 生成
│  ├─ app.js                    # 应用逻辑      ← build_www.py 生成
│  └─ data-offline.js           # 离线题库      ← generate_offline.py 生成
├─ generate_offline.py          # 题库 → www/data-offline.js（含校验）
├─ build_www.py                 # 静态版模板 → www 三件套
├─ verify_www.mjs               # 真实浏览器验收 App 内网页（14 项）
├─ capacitor.config.ts          # 包名 / 应用名 / webDir
├─ package.json / package-lock.json
├─ android/                     # Capacitor 生成的原生工程（Gradle）
│  ├─ app/src/main/AndroidManifest.xml
│  ├─ app/src/main/java/com/drugquiz/sc2/MainActivity.java
│  ├─ app/src/main/assets/public/   # cap sync 后的网页资源（随安装包分发）
│  ├─ variables.gradle          # minSdk 24 / compileSdk 36 / targetSdk 36
│  └─ gradlew(.bat) / build.gradle / settings.gradle
├─ .github/workflows/build-apk.yml   # CI：生成数据 → 同步 → 校验 → 打包 → 上传
├─ .gitignore
├─ README.md / BUILD.md / Claude.md（本文件）
└─ 验证截图/                     # 网页资源验收截图
```

---

## 3. 架构与数据流

```
        题库单一数据源（整个项目共用的唯一出处）
        ../tools/data/questions.json   ← 300 题：题干/选项/答案/解析/法条
                     │
                     ├────────────► generate_offline.py
                     │                     │
                     │                     ▼
                     │              www/data-offline.js（window.__QUESTION_BANK__）
                     │
        ../tools/index.template.html（静态版页面模板，同一份 UI 来源）
                     │
                     └────────────► build_www.py
                                           │
                                           ▼
                              www/index.html + style.css + app.js
                                           │
                              npx cap sync android
                                           │
                                           ▼
                   android/app/src/main/assets/public/  ← 随安装包一起分发
                                           │
                                  gradlew assembleDebug
                                           │
                                           ▼
                                   DrugQuiz-SC2.apk
```

**三个交付形态、一份题库**

| 形态 | 位置 | 定位 |
| --- | --- | --- |
| 静态单文件版 | 项目根目录 `index.html` | 电脑双击即用、可发网址（GitHub Pages） |
| 服务端版（Flask） | `服务端版/` | 局域网多设备共享进度、自由选题、答题卡、笔记 |
| **Android 离线版（本目录）** | `安卓版/` | 手机安装即用、**完全离线**、无需电脑 |

三者题库都由 `tools/data/questions.json` 生成，不会出现"手机上的题和电脑上的不一样"。

---

## 4. 关键技术实现

### 4.1 Capacitor 工程与配置

```ts
// capacitor.config.ts
const config: CapacitorConfig = {
  appId: "com.drugquiz.sc2",      // Android 包名，安装后用于区分应用
  appName: "药品法规刷题",          // 手机桌面显示的名称
  webDir: "www",                  // 网页资源目录，cap sync 时复制进安装包
  server: { androidScheme: "https" }
};
```

工程由官方 CLI 生成，不手写 Gradle：

```bash
npx cap add android      # 生成 android/ 原生工程（Capacitor 8 对应 AGP / SDK 版本）
npx cap sync android     # 把 www/ 复制到 android/app/src/main/assets/public 并更新插件
```

生成结果（实测）：

| 项 | 值 |
| --- | --- |
| 包名 / applicationId | `com.drugquiz.sc2` |
| 应用名（strings.xml） | 药品法规刷题 |
| 主 Activity | `android/app/src/main/java/com/drugquiz/sc2/MainActivity.java`（默认 BridgeActivity） |
| 资源目录 | `android/app/src/main/assets/public/` |

### 4.2 网页资源的来源：与静态版**同源拆分**

App 里的页面逻辑不是重写的，而是由 `build_www.py` 从**静态版页面模板**（`../tools/index.template.html`）
机械拆分而来，保证三端 UI 与行为一致：

| 输出 | 来源 | 关键改动 |
| --- | --- | --- |
| `www/style.css` | 模板 `<style>` 区块 | 原样抽取 |
| `www/app.js` | 模板 `<script>` 区块 | ① 题库改为 `window.__QUESTION_BANK__`；② 去掉 Service Worker 相关代码 |
| `www/index.html` | 模板 `<head>` + `<body>` | 去掉 PWA 的 manifest / apple-touch-icon 引用，改为引入 `style.css`、`data-offline.js`、`app.js` |

模板文件的查找策略与题库一致，保证独立克隆也能构建：

| 优先级 | 路径 | 用途 |
| --- | --- | --- |
| 1 | `../tools/index.template.html` | 项目里的**模板唯一来源**（本地开发优先，与网页版保持同步） |
| 2 | `template/index.template.html` | 本仓库自带的**模板快照**（独立克隆 / CI 构建时使用） |

**为什么去掉 Service Worker**：App 的资源随安装包分发，本就在本地，注册 SW 只会去请求一个不存在的 `sw.js`
并产生控制台 404 噪音；离线能力由安装包本身保证。因此 `build_www.py` 会把注册函数与调用一并剔除（已实测生成结果中 `serviceWorker` 出现 0 次）。

**为什么这样拆分而不是复制一份代码**：题库与 UI 只要保持"一个来源、多处生成"，就不会出现
"网页版改了、App 没改"的经典分叉问题。

### 4.3 离线题库生成

```python
# generate_offline.py（核心逻辑）
bank = json.load(open("../tools/data/questions.json"))   # 300 题
# 校验：总题数 300、单选 190 / 多选 110、每题有解析与法条、答案必须在选项内
json.dump(bank, "www/data-offline.js")   # 写成 window.__QUESTION_BANK__ = [...]
```

题库文件按优先级查找，保证"本地开发用最新题库、独立克隆也能构建"：

| 优先级 | 路径 | 用途 |
| --- | --- | --- |
| 1 | `../tools/data/questions.json` | 项目里的**题库唯一数据源**（本地开发优先使用） |
| 2 | `data/questions.json` | 本仓库自带的**题库快照**（独立克隆 / CI 构建时使用） |

> 维护约定：改题请在项目源目录重跑 `tools/import-new-bank.py`，再把新的
> `questions.json` 复制到 `安卓版/data/questions.json` 更新快照，两者内容应保持一致。

产物 `www/data-offline.js` 实测 **347 KB**，包含：

| 字段 | 说明 |
| --- | --- |
| `type` | `单选` / `多选` |
| `question` | 题干 |
| `options` | 选项数组（4 或 5 个，保留 `A.` 前缀） |
| `answer` | 答案字母数组，如 `["C"]` / `["A","C"]` |
| `explanation` | AI 解析（300/300 题均有） |
| `law` | 法条标题 + 条文原文（300/300 题均有） |

校验不通过脚本会直接报错退出，不会生成"缺题少解析"的安装包。

### 4.4 数据存储：App 内同样是浏览器本地存储

Capacitor 用 WebView 承载页面，页面的 `localStorage` 落在 App 的私有存储里，
因此静态版那套键名可以**原样复用**：

| 键名 | 内容 |
| --- | --- |
| `drug_quiz_data` | 顺序练习进度 + 每题作答记录（含累计次数） |
| `drug_quiz_wrong` | 错题本 + 每题答错次数 |
| `drug_quiz_settings` | 设置（背题模式等） |

影响：卸载 App 或"清除应用数据"会丢失进度；进度不跨设备同步（与静态版口径一致）。

### 4.5 CI 的两道校验（防"空壳包"）

`.github/workflows/build-apk.yml` 在打包前做两件事，避免出现"App 装上了但一道题都没有"：

1. **题库计数校验**：`data-offline.js` 必须存在、包含 `window.__QUESTION_BANK__`，且题目数 ≥ 300；
2. **资源一致性校验**：`android/app/src/main/assets/public/index.html` 与 `www/index.html` 必须一致（否则说明忘了 `cap sync`）。

### 4.6 手机适配（沿用静态版已验证的样式）

- 按钮最小高度 48px、选项点击区 ≥ 44px、正文字号 ≥ 14px；
- 393×852（主流手机）下四个页面均无横向溢出（实测 393/393）；
- 触摸操作不依赖悬停，选项用原生 `radio` / `checkbox` 承载，便于系统无障碍朗读。

---

## 5. 验收

### 5.1 App 内网页资源（已完成）

`node verify_www.mjs`——用真实 Edge 无头浏览器、手机尺寸 393×852 打开 `www/`，**14 / 14 通过**：

| 验收项 | 结果 |
| --- | --- |
| App 标题正确 | 通过 |
| 离线题库加载成功（300 题） | 通过（data-offline.js 300 题 / 应用读取 300 题） |
| 每题均含解析与法条 | 通过 |
| 顺序练习进度显示 300 题 | 通过 |
| 判分正确（单选答对） | 通过 |
| 作答后自动展开解析与法条 | 通过（解析 187 字 / 法条 212 字） |
| 背题模式可用 | 通过（高亮答案 + 显示解析） |
| 答错提示正确 | 通过 |
| 错题本记录错题 | 通过 |
| 统计页正确率与题型分项 | 通过 |
| 刷新后进度保留 | 通过（2 条 → 2 条） |
| 手机尺寸无横向溢出 | 通过（393 / 393） |
| 无 JS 报错 / 无控制台错误 | 通过 |

截图见 `验证截图/01~04`。

### 5.2 APK 真机验收（待 CI 出包后执行）

| 编号 | 验收项 | 判定方式 |
| --- | --- | --- |
| AV-1 | APK 可安装、桌面图标名为「药品法规刷题」 | 真机安装 |
| AV-2 | 打开后显示 300 题、无需联网 | 首次启动即断网测试 |
| AV-3 | **飞行模式下**可完整刷题（顺序/随机/错题/背题） | 关键验收项 |
| AV-4 | 作答后解析与法条正常显示、可滚动阅读 | 抽 5 题核对 |
| AV-5 | 杀进程后重开，进度仍在 | 真机验证 |
| AV-6 | 返回键行为正常（不直接退出到系统桌面异常） | 真机操作 |

---

## 6. 构建与打包

### 6.1 一站式命令

```bash
npm install                  # 安装 Capacitor 依赖
python generate_offline.py   # 生成离线题库（含 300 题校验）
python build_www.py          # 拆分网页资源
npx cap sync android         # 同步到 Android 工程
node verify_www.mjs          # 浏览器验收（可选但推荐）
cd android && gradlew assembleDebug   # 打包
```

### 6.2 推荐路径：GitHub Actions

推送代码后在 **Actions → Build DrugQuiz APK → Run workflow**，约 5～8 分钟出包，
在运行页底部下载 `DrugQuiz-APK` 工件（含 APK 与 SHA-256）。

### 6.3 本机构建受限（重要）

本机沙箱环境**无法运行 Gradle 构建**，报错：

```
java.io.IOException: Unable to establish loopback connection
  at org.gradle.internal.remote.internal.inet.SocketConnection.<init>(SocketConnection.java:64)
```

实测排查结论：

| 检查项 | 结果 |
| --- | --- |
| `gradlew --version` | ✅ 正常（Gradle 8.14.3 / JDK 21.0.12） |
| JDK 的 `Pipe.open()` | ✅ 单独测试成功（**不是** JDK 层问题） |
| 依赖与 SDK | ✅ npm 依赖、JDK 21、Android SDK 36 均已就绪 |
| Gradle 常驻守护模式 | ❌ 另报 `Could not create service of type FileLockContentionHandler` |

即：限制出现在 Gradle **启动 daemon 子进程并与之建立回环连接**这一环，属环境限制，
与项目配置无关（参考项目 `CommDebug-apk` 的 `BUILD.md` 记录了完全相同的问题）。

**应对**：走 GitHub Actions，或在普通 Windows / Android Studio 环境本地打包。

---

## 7. 与参考项目 CommDebug-apk 的技术对照

| 技术点 | CommDebug-apk | 本项目（安卓版） |
| --- | --- | --- |
| 容器 | Capacitor 8 | 同 |
| 网页目录 | `www/`（index.html + app.js + style.css + data-offline.js） | 同结构 |
| 离线数据生成 | `generate_offline.py`（题库 + 教材章节） | `generate_offline.py`（题库 + 解析 + 法条） |
| 额外生成脚本 | — | **`build_www.py`**：从静态版模板拆分出三件套，保证与网页版同源 |
| 原生插件 | 自研 TTS 朗读插件 | 无（本期无朗读需求） |
| 包名 / 应用名 | `com.commdebug.questionbank` / Comm Debug | `com.drugquiz.sc2` / 药品法规刷题 |
| SDK | minSdk 24 / compileSdk 36 | 同 |
| CI 校验 | 朗读三层实现 + 资产一致性 | 题库 ≥300 题 + 资产一致性 |
| 产物 | `Comm Debug.apk`（debug） | `DrugQuiz-SC2.apk`（debug） |
| 已知环境限制 | Gradle loopback（记录在 BUILD.md） | 同（已复现并记录在第 6.3 节） |

---

## 8. 维护指南

### 8.1 换题 / 加题

```bash
cd "D:\codex code\四合一工具集\药品管理题库"
python tools/import-new-bank.py      # 从 private/单选题、private/多选题 重新生成题库（含校验）
cd 安卓版
python generate_offline.py           # 重新生成离线数据
npx cap sync android                 # 同步进工程
```

### 8.2 改界面 / 改交互

改 `../tools/index.template.html`（静态版模板）后执行 `python build_www.py`——
**网页版与 App 会一起变**，这是"同源"的好处；不要在 `www/app.js` 里直接改，下次生成会被覆盖。

### 8.3 升级 Capacitor

```bash
npm install @capacitor/core@latest @capacitor/cli@latest @capacitor/android@latest
npx cap sync android
```

升级后建议在 Android Studio 里确认一次 `variables.gradle` 的 SDK 版本要求。

---

## 9. 风险与待办

| 编号 | 类型 | 内容 | 应对 |
| --- | --- | --- | --- |
| R-1 | 环境 | 本机无法运行 Gradle，出包依赖 CI | 已提供 CI 工作流；本地改动请走 Android Studio |
| R-2 | 产物 | 当前为 debug 包，未签名 release、未上架 | 如需正式分发，需配置签名与版本号策略 |
| R-3 | 数据 | 进度只在本机、卸载即丢 | 如需保留，可后续加"导出/导入进度" |
| R-4 | 合规 | 题库含法规条文与解析，属内部培训资料 | 建议仅内部分发，公网仓库注意可见范围 |
| R-5 | 待办 | APK 真机验收（第 5.2 节 6 项）尚未执行 | CI 出包后在安卓手机上逐项验证 |

---

## 10. 附录

### 10.1 命令速查

| 目的 | 命令 |
| --- | --- |
| 安装依赖 | `npm install` |
| 生成离线题库 | `python generate_offline.py` |
| 生成网页资源 | `python build_www.py` |
| 同步到 Android 工程 | `npx cap sync android` |
| 浏览器验收 | `node verify_www.mjs` |
| 打包（本地） | `cd android && gradlew assembleDebug` |
| 打开原生工程 | Android Studio 打开 `android/` 目录 |

### 10.2 关键文件清单

| 文件 | 作用 |
| --- | --- |
| `capacitor.config.ts` | 包名、应用名、webDir |
| `generate_offline.py` | 题库 → `www/data-offline.js`（含校验） |
| `build_www.py` | 静态版模板 → `www/index.html` / `style.css` / `app.js` |
| `www/data-offline.js` | 300 题离线数据（347 KB） |
| `android/app/src/main/assets/public/` | 随安装包分发的网页资源 |
| `android/app/src/main/AndroidManifest.xml` | 应用声明（含 INTERNET 权限，Capacitor 默认） |
| `.github/workflows/build-apk.yml` | CI：生成 → 同步 → 校验 → 打包 → 上传工件 |
| `verify_www.mjs` | App 内网页的浏览器验收（14 项） |

### 10.3 版本记录

| 版本 | 日期 | 内容 |
| --- | --- | --- |
| v1.0 | 2026-09-19 | 新建 `安卓版/`，按 CommDebug-apk 技术栈完成 Capacitor 工程、离线题库生成、网页资源拆分、CI 工作流；网页资源浏览器验收 14/14 通过 |
