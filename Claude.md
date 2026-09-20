# 实现技术说明文档：药品管理题库 Android 版

> 项目名称：药品管理相关法规知识竞赛试题库（生产二部专用）—— Android 离线版
> 项目代号：DrugQuiz-SC2-Android
> 文档版本：v1.5　|　编写日期：2026-09-20
> 落地目录：`D:\codex code\四合一工具集\药品管理题库\安卓版`
> 仓库：<https://github.com/sd3247930/DrugQuiz-SC2-Android>
> 技术栈来源：`E:\5.Question bank testing software\CommDebug-apk`（Capacitor 离线 APK 方案）
> 配套文档：`README.md`（使用）、`BUILD.md`（构建）、`../安卓版对齐服务端版：6 件事拍板建议.md`（决策依据）

---

## 0. 一句话结论

用与参考项目一致的技术栈（**Capacitor 8 + 原生 HTML/CSS/JS + Python 生成数据 + Gradle 工程 + GitHub Actions 出包**），
把「药品管理题库」打包成 **Android 离线 App**；并且从 **v1.1 起，App 的界面与功能与服务端版（Flask）完全对齐**——
**4 个页面 + 顶部导航 + 选题面板 + 答题卡 + 设置 + 法条浏览**，全部由服务端版模板与脚本生成，两端共用同一份 UI 代码。

**当前状态（v1.5）**：

- 工程、离线数据、生成流程、CI 均已就绪，APK 可通过 GitHub Actions 一键产出；
- 功能：随服务端版同步拿到了 **答题卡 5 列题号矩阵**、**进度导出/导入**、**我的笔记**（v1.5，见第 4.11 节）；
- 验收：安卓版网页资源 **51/51** 通过；服务端版 pytest **47/47** + 浏览器 **55/55**；静态版 **75/75**（串行执行，零倒退）；
- 已产出 APK：`com.drugquiz.sc2`，versionName **1.4**（后续含 v1.5 网页资源的包需重新出包）；
- 本机沙箱无法运行 Gradle（原因见第 6.3 节），出包走 GitHub Actions 或在普通 Windows/Android Studio 构建。

---

## 1. 技术栈（均为实测版本）

| 层 | 技术 | 版本 | 说明 |
| --- | --- | --- | --- |
| 移动容器 | Capacitor | **8.5.0** | `@capacitor/core`、`@capacitor/cli`、`@capacitor/android` 三者同版本 |
| 前端 | 原生 HTML / CSS / JavaScript | — | 与服务端版**共用同一份**样式与脚本，不引入任何前端框架 |
| 离线数据 | `window.__QUESTION_BANK__` | — | 300 题（含 AI 解析与法条），随安装包分发 |
| 数据生成 | Python | **3.14.6** | `generate_offline.py`、`build_www.py` |
| 构建工具 | Gradle | **8.14.3** | 由 `android/gradlew` 驱动 |
| JDK | Temurin OpenJDK | **21.0.12** | Capacitor 8 与 AGP 要求 Java 21 |
| Android SDK | compileSdk / targetSdk | **36** | build-tools 36.0.0 |
| 最低系统 | minSdk | **24** | Android 7.0 及以上 |
| 运行时 | Android WebView | — | Capacitor 内置，加载本地 `assets/public` |
| CI | GitHub Actions | — | Node 22 + JDK 21 + Android SDK 36，产出 APK 工件 |

**依赖清单（package.json）**

```json
{
  "dependencies": { "@capacitor/android": "^8.5.0", "@capacitor/core": "^8.5.0" },
  "devDependencies": { "@capacitor/cli": "^8.5.0", "typescript": "^7.0.2" }
}
```

> 本项目**没有**引入参考项目里的原生 TTS 朗读插件——药品题库当前没有语音朗读功能，
> 不装载无用插件可以少一层编译风险（将来要加，照参考项目的 `TextToSpeechPlugin` 方案补即可）。

---

## 2. 目录结构

```
安卓版/
├─ www/                          # App 内网页（Capacitor 的 webDir）—— 全部由脚本生成
│  ├─ index.html                 #    首页：统计 + 练习入口
│  ├─ practice.html              #    练习页：题干/选项/解析与法条/背题模式/上一题
│  ├─ answer_card.html           #    答题卡：统计 + 错题本 + 选题面板 + 法条浏览
│  ├─ settings.html              #    设置：背题模式/夜间模式/字号/自动下一题/重置
│  ├─ style.css                  #    ← 服务端版 static/style.css（整份复制）
│  ├─ script.js                  #    ← 服务端版 static/script.js（去掉 SW 注册）
│  ├─ selection.js               #    ← 服务端版 static/selection.js（选题面板）
│  ├─ law.js                     #    ← 服务端版 static/law.js（法条浏览）
│  ├─ lawtip.js                  #    ← 服务端版 static/lawtip.js（练习页「查看法条」）
│  ├─ local-api.js               #    ★ App 专用：本地接口垫片（顶替 Flask 后端）
│  ├─ page-init.js               #    ★ App 专用：填充服务端渲染值、导航高亮、重置入口
│  └─ data-offline.js            #    ← generate_offline.py 生成（300 题）
├─ web/                          # App 专用脚本的**源文件**（生成时复制进 www/）
│  ├─ local-api.js
│  └─ page-init.js
├─ generate_offline.py           # 题库 → www/data-offline.js（含 300 题校验）
├─ build_www.py                  # 服务端版模板 + 脚本 → www/（含 Jinja 残留检查）
├─ verify_www.mjs                # 真实浏览器验收 App 内网页（32 项）
├─ template_server/              # 服务端版快照（templates/ + static/，供独立克隆 / CI 构建）
├─ data/questions.json           # 题库快照（同上用途）
├─ capacitor.config.ts           # 包名 / 应用名 / webDir
├─ android/                      # Capacitor 生成的原生工程（Gradle）
│  └─ app/src/main/assets/public/    # cap sync 后的网页资源（随安装包分发）
├─ .github/workflows/build-apk.yml   # CI：生成 → 同步 → 校验 → 打包 → 上传
├─ apk/                          # CI 工件下载位置（.gitignore 已忽略）
├─ README.md / BUILD.md / Claude.md（本文件）
└─ 验证截图/                      # 网页资源验收截图
```

---

## 3. 架构与数据流

```
                     题库唯一数据源
        ../tools/data/questions.json（300 题：题干/选项/答案/解析/法条）
                        │
                        ├──────────────► generate_offline.py
                        │                        │
                        │                        ▼
                        │                 www/data-offline.js（window.__QUESTION_BANK__）
                        │
        服务端版（Flask）—— App 的界面来源（D1=A：对齐服务端版）
        ../服务端版/templates/*.html + ../服务端版/static/*.js|css
                        │
                        ├──────────────► build_www.py
                        │                        │
                        │                        ▼
                        │        www/{index,practice,answer_card,settings}.html
                        │        www/{style.css,script.js,selection.js,law.js}
                        │                        │
                        │        web/{local-api.js,page-init.js}（App 专用）
                        │                        │
                        └────────────────► npx cap sync android
                                                 │
                                                 ▼
                        android/app/src/main/assets/public/ ← 随安装包分发
                                                 │
                                        gradlew assembleDebug
                                                 │
                                                 ▼
                                        DrugQuiz-SC2.apk（完全离线）
```

**关键设计：与服务端版共用一份 UI 代码**

App 里的页面与交互脚本不是另写的一套，而是从服务端版**生成**的。这样：

1. 服务端版改界面 / 加功能，App 重新生成即可跟上，不会两边分叉；
2. 唯一的差异被压缩到两个 App 专用文件（`local-api.js`、`page-init.js`）与少量构建期替换。

---

## 4. 关键技术实现

### 4.1 Capacitor 工程与配置

```ts
// capacitor.config.ts
const config: CapacitorConfig = {
  appId: "com.drugquiz.sc2",     // Android 包名
  appName: "药品法规刷题",         // 手机桌面显示名
  webDir: "www",                 // 网页资源目录，cap sync 时复制进安装包
  server: { androidScheme: "https" }
};
```

```bash
npx cap add android      # 生成 android/ 原生工程（Capacitor 8 对应 AGP / SDK 版本）
npx cap sync android     # 把 www/ 复制到 android/app/src/main/assets/public 并更新插件
```

### 4.2 从服务端版生成 App 页面（`build_www.py`）

转换规则（构建期完成，App 内不依赖任何模板引擎）：

| 服务端版写法 | App 内替换为 |
| --- | --- |
| `{% extends %}` / `{% block %}` | 构建时展开成完整 HTML |
| `{{ url_for('index') }}` 等 | `index.html` / `practice.html?mode=seq` / `answer_card.html` / `settings.html` |
| `{{ url_for('static', filename='x') }}` | `x` |
| `{{ stats.* }}`、`{% if settings.* %}checked{% endif %}` | 留空，由 `page-init.js` 用本地接口填充 |
| `{{ csrf_token }}` | 留空（App 内无后端；垫片不校验） |
| PWA 的 `manifest` / `apple-touch-icon` 链接 | 删除（App 内不需要） |
| 「导入旧版进度」区块 | 删除（决策 D3=A） |
| 「重新导入题库」按钮 | 换成「重置为内置题库（恢复出厂）」（决策 D2） |
| 页脚「保存在运行本服务的电脑上…」 | 改为「保存在本机（App 私有存储）」 |
| `script.js` 末尾的 Service Worker 注册 | 删除（App 内资源随安装包分发，注册只会 404） |

**两条安全阀**：

1. **Jinja 残留检查**：转换后若仍存在 `{{ ... }}` 或 `{% ... %}`，脚本直接报错退出（实测拦住过 practice 页的 3 处动态值）；
2. **孤儿文件清理**：`www/` 下不属于本次生成清单的文件会被删除（防止结构变更后的旧文件被误打进包里）。

### 4.3 离线题库生成（`generate_offline.py`）

```python
bank = json.load(open("../tools/data/questions.json"))   # 300 题
# 校验：总数 300、单选 190 / 多选 110、每题有解析与法条、答案必须在选项内
json.dump(bank, "www/data-offline.js")   # window.__QUESTION_BANK__ = [...]
```

题库来源按优先级查找，保证"本地开发用最新题库、独立克隆也能构建"：

| 优先级 | 路径 | 用途 |
| --- | --- | --- |
| 1 | `../tools/data/questions.json` | 项目里的**题库唯一数据源** |
| 2 | `data/questions.json` | 本仓库自带的**题库快照**（独立克隆 / CI） |

### 4.4 本地接口垫片（`web/local-api.js`）—— App 无后端的核心

服务端版的前端通过 `fetch("/api/...")` 与 Flask 通信。App 内没有后端，垫片**拦截同源 `/api/*` 请求**并在本地作答：

```js
window.fetch = function (input, init) {
  const url = typeof input === "string" ? input : (input && input.url) || "";
  if (url.indexOf("/api/") === 0) return handle(url, init || {});   // 本地实现
  return realFetch ? realFetch(input, init) : Promise.reject(new Error("网络不可用"));
};
```

实现的接口与服务端版一一对应（14 个）：

| 接口 | 本地实现要点 |
| --- | --- |
| `GET /api/questions` | 模式（seq/random/wrong/custom）、筛选（题型/状态/关键词/法条）、ids 保序、分页、reveal |
| `GET /api/selection/meta` | 题型、状态枚举与计数、法条索引 |
| `GET /api/question/<id>` | 单题，`reveal=1` 附答案与解析 |
| `POST /api/submit` | 判分：**多选完全一致才判对**；写进度、答错计数、答对清零 |
| `POST /api/progress`、`GET /api/progress/all` | 进度读写（旧版结构自动迁移） |
| `GET /api/wrong` | 错题列表（含错误次数、答案、解析、法条） |
| `POST /api/collect`、`POST /api/note` | 收藏与笔记 |
| `POST /api/batch` | 导出错题 / 清空错题 / 清空全部 |
| `GET /api/stats` | 统计：正确率按**每题最近一次作答**，另计累计作答次数 |
| `GET/POST /api/settings` | 设置读写 |
| `GET /api/law/index`、`GET /api/law/<标题>` | 法条索引与条文原文 |
| `POST /api/import` | App 内题库为内置，返回内置题库信息（不改变数据） |

**字段适配**：题库文件用的是静态版字段（`type`/`question`/`options`/`answer[]`），
垫片内部转换成服务端版接口字段（`qtype`/`stem`/`options[[字母,文本]]`/`answer` 字符串），因此前端脚本无需改动。

**进度数据格式与迁移**：`drug_quiz_data` 直接采用服务端版的结构
（`{题号: {answered, correct, selected, attempts, wrong_count, collected, note}}`）。
首次启动时若发现旧版结构（`{currentIndex, records}`），会自动迁移，**升级不丢进度**。

### 4.5 页面初始化（`web/page-init.js`）

服务端版由 Flask 渲染的少量内容，在 App 内由本文件填充：

- 首页 / 答题卡的统计卡与进度文案（`#statTotal`、`#statAnswered`、`#cardAnswered` 等）；
- 设置页的开关与字号下拉（`#setBackMode`、`#setDark`、`#setFont`、`#setAutoNext`）；
- 练习页副标题与顶部导航高亮（App 内模式由 URL 决定）；
- 「重置为内置题库（恢复出厂）」按钮：清空 `drug_quiz_data` / `drug_quiz_wrong` / `drug_quiz_settings` / `drug_quiz_selection` 四项本地数据（题库本身不删）。

### 4.6 前端路径常量（`APP_PATHS`）

服务端版页面走 Flask 路由（`/practice/seq`），App 内是静态文件（`practice.html?mode=seq`）。
`script.js` / `selection.js` 统一通过常量跳转，垫片在加载前端脚本之前覆盖它：

```js
// 服务端版默认（script.js）
const APP_PATHS = window.APP_PATHS || { home: "/", practice: ..., custom: ... };
// App 内（local-api.js 提前设置）
window.APP_PATHS = { home: "index.html", practice: m => "practice.html?mode=" + m,
                     custom: ids => "practice.html?mode=custom&ids=" + ids.join(",") };
```

### 4.7 CI 的两道校验（防"空壳包"）

`.github/workflows/build-apk.yml` 在打包前检查：

1. **题库完整性**：`data-offline.js` 存在、含 `window.__QUESTION_BANK__`、题目数 = 300（单选 190 / 多选 110）、含解析与法条字段；
2. **资源完整性**：4 个页面 + 6 个脚本/样式文件齐全，且 `answer_card.html`、`local-api.js` 与 `www/` 一致（防止忘记 `cap sync`）。

### 4.8 手机适配

- 按钮最小高度 48px、选项点击区 ≥ 44px、正文字号 ≥ 14px；
- 393×852（主流手机）下各页面无横向溢出（实测 393/393）；
- 选项用原生 `radio` / `checkbox`，便于系统无障碍朗读；
- 多页面结构下，Android 返回键走浏览器历史，回退符合直觉。

### 4.9 练习页「查看法条」（v1.2 新增）

做题前/做题中即可查看**本题**依据的法条原文，实现在**服务端版 `static/lawtip.js`**（两端共用）：

- **取数按题号**：请求 `/api/question/<id>?reveal=1` 取当前题的 `law`。
  **不用** `/api/law/<标题>`——题库里法条标题只有 1 种、条文有 298 种，按标题取会让 300 题显示同一段条文；
- **渲染**：一律 `textContent`（项目安全约定，不插入未净化 HTML）；
- **弹层**：复用选题面板的 `.sheet` 全屏弹层，无需 Popover API，也就没有老版 WebView 的兼容问题；
- **切题同步**：`script.js` 的 `renderQuestion()` 末尾调用 `window.onQuestionRendered(item)` 钩子，`lawtip.js` 借此重置弹层与按钮；
- **边界**：该题无收录法条时，按钮置灰为「暂无相关法条」并提示，不打开空弹层。

### 4.10 夜间模式与视觉 token（v1.2）

**夜间模式（O1）**：机制保持 `body.theme-dark` class 切换不变。v1.2 补齐了原先漏覆盖的元素——
`.progress` / `.summary` / `.stat-label` / `.q-no` / `.mode-label` / `.type-tag` / `.explain-title`
（补齐前实测对比度仅 2.73:1 与 2.41:1），以及 `.result.ok/bad`、`.option.correct/wrong`、`.badge-*` 的暗色态；
现在 4 个页面抽样元素在暗色下的文字对比度**全部 ≥ 4.5:1**，并已固化为自动验收项。

> 备注：审核时曾发现《安卓版优化实施方案》把根因写成"CSS 依赖 `@media (prefers-color-scheme)`"，
> 实测该写法在 `style.css` 中从未出现（0 处），机制一直是 class 切换且可用；真正的问题是覆盖不全。

**视觉 token（O3）**：`style.css` 末尾新增设计 token 层（`:root` 定义颜色/圆角/阴影/间距，
`body.theme-dark` 只重定义变量），并以追加覆盖的方式精修：背景改为**纯 CSS 渐变 + 细网格纹理**
（不引入 p5.js 等任何第三方库）、题干卡片化、选项卡片悬浮反馈、导航胶囊、按钮与标签统一走 token。
既有 30 条 `theme-dark` 规则保持不变，降低回归风险。

### 4.11 v1.5 同步的三项功能与 App 端适配

App 的网页资源由 `build_www.py` 从服务端版生成，所以服务端版的新功能 App 直接继承。
v1.5 同步过来的三项里，**只有进度导出需要 App 端特殊处理**：

**① 答题卡 5 列题号矩阵**（纯前端，无需适配）

查看答题卡页统计下方新增 5 列网格（300 格），未答灰 / 答对绿 / 答错红 / 收藏右上角 ★，
点题号跳到该题。每批 100 格 `requestAnimationFrame` 分块渲染，实测 300 格约 8ms。

**② 进度导出 / 导入 —— App 端必须改用剪贴板**

| 平台 | 导出 | 导入 |
| --- | --- | --- |
| 网页（服务端版 / 静态版） | `a[download]` + Blob 下载成 `.json` 文件 | `<input type="file">` |
| **App（Capacitor WebView）** | **`a[download]` 不被支持，点了没反应** → 改走 `navigator.clipboard.writeText`；剪贴板也不可用时退到**只读文本框 + 自动全选**，长按复制 | `<input type="file">` 会调起**原生文件选择器**，正常可用 |

实现要点：脚本用 `window.APP_PATHS` 是否存在判断"是不是 App 壳"，网页端照旧下载文件。
**刻意不用 `window.prompt` 做兜底**——Capacitor 的 JS 桥接会拦截 `prompt`，行为不可预期。

导出文件格式与另外两版**完全一致**（`{version, app, source, exportedAt, progress, settings}`，
`progress` 以 1 起的题号做键），所以 App ↔ 服务端版 ↔ 静态版三边都能互相导入。

**③ 我的笔记**（纯前端，走已有的本地接口垫片）

练习页解析下方新增文本域，输入停止 700ms 或失焦自动保存。存储走 `local-api.js` 的 `/api/note`，
落在 App 私有存储（localStorage）的进度记录 `note` 字段里；`computeStats()` 只统计 `answered` 为真的记录，
所以**只写笔记没作答不会计入已答题数**（这一条已固化为自动验收项）。

> 注：导出为**真正的文件**（而不是剪贴板）需要引入 `@capacitor/filesystem` + `@capacitor/share`
> 并重新打 APK，属单独立项，本版未做。

---

## 5. 验收

### 5.1 App 内网页资源（`node verify_www.mjs`，**51 / 51 通过**）

真实 Edge 无头浏览器、手机尺寸 393×852：

| 分组 | 覆盖项 |
| --- | --- |
| 首页 | 标题、离线题库 300 题、统计由本地接口填充、无「导入旧版进度」、顶部导航 6 项 |
| 练习页 | 进度显示、题型标签、选项渲染、判分正确、作答后自动展开解析与法条、上一题、背题模式 |
| 答题卡 | 错题本列表、统计填充、选题面板打开、默认 50 条、题型筛选、关键词筛选、勾选多题、按勾选顺序开始练习、自定义练习题数 |
| 法条浏览 | 列出法条、展开条文原文、一键练习该法条下的题 |
| 设置 | 夜间模式保存生效、「重置为内置题库」入口存在、无「重新导入题库」 |
| 夜间模式（v1.2） | 4 个页面：模式已启用 + 暗色下文字对比度均 ≥ 4.5:1（共 8 项） |
| 查看法条（v1.2） | 按钮存在、弹出的是**本题**对应法条、弹层可关闭、切题后状态重置（共 4 项） |
| 答题卡矩阵（v1.5） | 新增 5 列题号矩阵（入口存在、300 格、状态色与进度一致） |
| 进度备份（v1.5） | 设置页有「导出进度 / 导入进度」入口；App 内导出走剪贴板、剪贴板不可用时退到只读文本框（共 2 项） |
| 我的笔记（v1.5） | 解析下方有输入框；笔记经本地接口垫片保存、重新进入该题能回显、不计入已答题数（共 2 项） |
| 通用 | 进度持久化、手机尺寸无横向溢出、无 JS 报错、无控制台错误 |

截图见 `验证截图/01~05`。

### 5.2 服务端版 / 静态版回归（确认零倒退）

| 对象 | 验收 | 结果 |
| --- | --- | --- |
| 服务端版（Flask） | `pytest tests/ -q` | **47 / 47 通过** |
| 服务端版（Flask） | `node tools/verify-server-ui.mjs` | **34 / 34 通过**（含新增的法条浏览 3 项） |
| 静态单文件版 | `node tools/verify-ui.mjs` | **55 / 55 通过** |

### 5.3 APK 真机验收（待你在手机上执行）

| 编号 | 验收项 | 判定方式 |
| --- | --- | --- |
| AV-1 | APK 可安装、桌面图标名为「药品法规刷题」 | 真机安装 |
| AV-2 | **飞行模式下**可完整刷题（顺序/随机/错题/自定义/背题） | 关键验收项 |
| AV-3 | 四个页面与顶部导航可正常跳转，返回键行为正常 | 真机操作 |
| AV-4 | 选题面板、答题卡、设置、法条浏览在真机上可正常使用 | 真机操作 |
| AV-5 | 杀进程后重开，进度与收藏仍在 | 真机验证 |

---

## 6. 构建与打包

### 6.1 一站式命令

```bash
npm install                  # 安装 Capacitor 依赖
python generate_offline.py   # 生成离线题库（300 题校验）
python build_www.py          # 从服务端版生成网页资源（Jinja 残留检查）
npx cap sync android         # 同步到 Android 工程
node verify_www.mjs          # 浏览器验收（32 项）
cd android && gradlew assembleDebug   # 打包
```

### 6.2 推荐路径：GitHub Actions

推送后在 **Actions → Build DrugQuiz APK → Run workflow** 触发，
约 2～3 分钟出包，在运行页底部下载 `DrugQuiz-APK` 工件（含 APK 与 SHA-256）。

### 6.3 本机构建受限（重要）

本机沙箱环境**无法运行 Gradle 构建**：

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

即限制出现在 Gradle **启动 daemon 子进程并与之建立回环连接**这一环，属环境限制
（参考项目 `CommDebug-apk` 的 `BUILD.md` 记录了完全相同的问题）。

**应对**：走 GitHub Actions，或在普通 Windows / Android Studio 环境本地打包。

---

## 7. 与参考项目 CommDebug-apk 的技术对照

| 技术点 | CommDebug-apk | 本项目（安卓版 v1.1） |
| --- | --- | --- |
| 容器 | Capacitor 8 | 同 |
| 网页目录 | `www/`（index + app.js + style.css + data-offline.js） | `www/`（4 页面 + 5 脚本 + 样式 + 数据） |
| 页面来源 | 自建单页 | **从服务端版生成**（模板 + 脚本整份复用） |
| 后端替代 | 无（纯静态） | **本地接口垫片 `local-api.js`**（实现 14 个接口） |
| 离线数据 | `generate_offline.py`（题库 + 章节） | `generate_offline.py`（题库 + 解析 + 法条） |
| 额外构建脚本 | — | `build_www.py`（Jinja 转换 + 孤儿文件清理 + SW 移除） |
| 原生插件 | 自研 TTS 朗读插件 | 无（本期无朗读需求） |
| 包名 / 应用名 | `com.commdebug.questionbank` / Comm Debug | `com.drugquiz.sc2` / 药品法规刷题 |
| SDK | minSdk 24 / compileSdk 36 | 同 |
| CI 校验 | 朗读三层实现 + 资产一致性 | 题库 300 题（含解析/法条）+ 4 页面与脚本齐全 + 资产一致性 |
| 产物 | `Comm Debug.apk` | `DrugQuiz-SC2.apk`（debug，4.0 MB） |
| 已知环境限制 | Gradle loopback（BUILD.md） | 同（见第 6.3 节） |

---

## 8. 维护指南

### 8.1 换题 / 加题

```bash
cd "D:\codex code\四合一工具集\药品管理题库"
python tools/import-new-bank.py          # 从 private/单选题、private/多选题 重新生成题库
cd 安卓版
python generate_offline.py               # 重新生成离线数据
npx cap sync android                     # 同步进工程
```

### 8.2 改界面 / 加功能（重要）

**改服务端版**（`../服务端版/templates/*.html`、`../服务端版/static/*.js|css`），然后：

```bash
cd 安卓版
python build_www.py      # 重新生成 App 页面（同时刷新 template_server 快照）
npx cap sync android
node verify_www.mjs      # 32 项验收
```

> 不要手改 `www/` 下的文件——它们每次生成都会被覆盖。App 特有的逻辑请写在 `web/local-api.js`、`web/page-init.js`。
> 若服务端版新增了需要客户端填充的渲染值，`build_www.py` 的 Jinja 残留检查会报错，提示你补转换规则。

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
| R-1 | 环境 | 本机无法运行 Gradle，出包依赖 CI | 已提供 CI；本地改动请走 Android Studio |
| R-2 | 生成链 | 服务端版结构大改时，转换规则可能需要同步调整 | Jinja 残留检查会直接报错，不会静默产出坏页面 |
| R-3 | 产物 | 当前为 debug 包，未签名 release、未上架 | 如需正式分发，需配置签名与版本号策略 |
| R-4 | 数据 | 进度只在本机，卸载即丢 | 后续可加"导出/导入进度" |
| R-5 | 待办 | APK 真机验收（第 5.3 节 5 项）尚未执行 | 装到手机后逐项验证，重点是飞行模式与返回键 |

---

## 10. 附录

### 10.1 命令速查

| 目的 | 命令 |
| --- | --- |
| 安装依赖 | `npm install` |
| 生成离线题库 | `python generate_offline.py` |
| 从服务端版生成页面 | `python build_www.py` |
| 同步到 Android 工程 | `npx cap sync android` |
| 浏览器验收 | `node verify_www.mjs` |
| 打包（本地） | `cd android && gradlew assembleDebug` |
| 打开原生工程 | Android Studio 打开 `android/` 目录 |

### 10.2 关键文件清单

| 文件 | 作用 | 来源 |
| --- | --- | --- |
| `capacitor.config.ts` | 包名、应用名、webDir | 手写 |
| `generate_offline.py` | 题库 → `www/data-offline.js`（含校验） | 手写 |
| `build_www.py` | 服务端版 → `www/`（Jinja 转换 + 校验 + 清理） | 手写 |
| `web/local-api.js` | 本地接口垫片（14 个接口） | 手写 |
| `web/page-init.js` | 渲染值填充、导航高亮、重置入口 | 手写 |
| `www/*.html`、`www/*.js`、`www/style.css` | App 内网页资源 | **自动生成** |
| `template_server/`、`data/questions.json` | 快照，供独立克隆 / CI 构建 | 自动刷新 |
| `.github/workflows/build-apk.yml` | CI：生成 → 同步 → 校验 → 打包 → 上传 | 手写 |
| `verify_www.mjs` | 网页资源浏览器验收（32 项） | 手写 |

### 10.3 版本记录

| 版本 | 日期 | 内容 |
| --- | --- | --- |
| v1.0 | 2026-09-19 | 新建 `安卓版/`，按 CommDebug-apk 技术栈完成 Capacitor 工程、离线题库生成、网页资源拆分、CI 工作流；网页资源验收 14/14 通过；首版 APK 产出 |
| v1.1 | 2026-09-19 | 按《安卓版对齐服务端版：6 件事拍板建议》（D1～D6 全按推荐）实施：改为 4 页面 + 顶部导航并与服务端版对齐；`build_www.py` 重写为从服务端版生成；新增本地接口垫片 `local-api.js` 与 `page-init.js`；新增收藏、笔记、法条浏览；去掉「导入旧版进度」、「重新导入题库」改为「重置为内置题库」；服务端版同步新增法条浏览与 `APP_PATHS`；验收 32/32（安卓）+ 47/47 + 34/34（服务端）+ 55/55（静态）；APK 升到 versionCode 2 / versionName 1.1 |
| v1.2 | 2026-09-19 | 按《安卓版优化方案-审核意见与执行计划》（O1～O5 全按推荐）实施：**O1** 夜间模式补齐 7 类漏覆盖元素与对比度（不动 `theme-dark` 机制）；**O2** 练习页新增「查看法条」按钮与弹层（取当前题 `law.text`、`textContent` 渲染、切题重置，服务端版 `static/lawtip.js` 两端共用）；**O3** 新增设计 token 层与纯 CSS 背景纹理（零依赖）；**O5** 暗色对比度/覆盖率与法条控件固化为自动验收（安卓 32→44 项、服务端 34→45 项）。验收：44/44 + 47/47 + 45/45 + 55/55；APK 升到 versionCode 3 / versionName 1.2 |
| v1.3 | 2026-09-19 | 解析区不再显示「法条依据」小节（只保留解析文字 + 一行"点上方查看法条"提示），`showExplanation()` 同步调整，作答后与背题模式行为一致；静态版同步隐藏并补上「查看法条」按钮；三套验收口径改为"解析区不含法条依据 + 查看法条仍可用"。验收：安卓 45/45 + 服务端 47/47 + 45/45 + 静态 56/56；APK 升到 versionCode 4 / versionName 1.3 |
