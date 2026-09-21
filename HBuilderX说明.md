# 在 HBuilderX 里运行 / 调试这个 App

本文说明「药品管理相关法规知识竞赛试题库」在 HBuilderX（uni-app）里的运行方式。
Capacitor 那条发布链路（GitHub Actions 出 APK + 网页直链下载）**完全不受影响**，
两套壳加载的是同一份网页资源。

---

## 一、两套壳的关系

| 壳 | 位置 | 用途 | 出包方式 |
| --- | --- | --- | --- |
| Capacitor | `药品管理题库\安卓版`（本目录，含 `android/`） | 正式 APK，供同事下载安装 | GitHub Actions + 固定签名 → Release 固定直链 |
| uni-app | `D:\codex code\HBuilderProjects\DrugQuiz-SC2-Android\Pharma Law Quiz Bank` | HBuilderX 里运行/调试；可选云打包 | HBuilderX 标准基座运行 / 云打包（本次未做） |

两边的网页内容都来自同一处：`服务端版/` + `web/` → `build_www.py` → `www/`。

---

## 二、uni-app 壳是怎么拼的

```
Pharma Law Quiz Bank/            （HBuilderX 工程）
├─ pages/index/index.vue         App 端 <web-view src="/hybrid/html/index.html">
│                                H5 端 <iframe src="/static/app-web/index.html">
│                                返回键：先让 web-view 内部后退，退无可退才退出应用
├─ pages.json                    单页 + 全屏（无 uni-app 导航栏）
├─ manifest.json                 应用名「药品法规刷题」/ 版本 1.5.3 / 包名 com.drugquiz.sc2 / 图标 / 状态栏
├─ App.vue                       启动即设状态栏背景 #0F5B78 + 浅色图标
├─ hybrid/html/                  ← 由同步脚本写入（App 端加载）
├─ static/app-web/               ← 由同步脚本写入（H5 端加载，两份逐字节一致）
└─ static/icons/                 ← 由同步脚本写入（打包用图标）
```

为什么是两份：App 端 `web-view` 官方只保证能加载 `hybrid/html/`，
而 H5 构建不会打包 `hybrid/`，只能用 `static/`。两份由脚本一次写出并做哈希校验。

---

## 三、日常怎么改、怎么同步

```powershell
cd "D:\codex code\四合一工具集\药品管理题库\安卓版"

python sync_hbuilder.py            # 默认：重跑 generate_offline.py + build_www.py，再同步
python sync_hbuilder.py --skip-build   # 只同步（www/ 已经是最新的）
python sync_hbuilder.py --check    # 只检查三处是否漂移，不写文件（日常自检）
python sync_hbuilder.py --project "<其他工程路径>"   # 指定别的 HBuilderX 工程
```

脚本做的 5 件事：

1. （默认）重新生成 `www/`；
2. 覆盖复制到 `hybrid/html/` 与 `static/app-web/`，并清理目标里已不在 `www/` 的旧文件；
3. 把 `web/app-shim.js` 注入到 4 个页面（HTML5+ 环境下补 `navigator.clipboard`）；
4. 生成打包图标到 `static/icons/`；
5. 校验：题库 ≥300 题（190 单选 / 110 多选）、字体齐全、两份副本逐文件 SHA-256 一致，
   并写 `.sync-manifest.json`。

**不要手改** `hybrid/html/`、`static/app-web/`、`static/icons/` —— 下次同步会覆盖。

---

## 四、在 HBuilderX 里跑

1. HBuilderX → 打开目录 → `D:\codex code\HBuilderProjects\DrugQuiz-SC2-Android\Pharma Law Quiz Bank`；
2. 手机开 USB 调试 + 数据线连接（HBuilderX 自带 adb，路径
   `D:\ProgramData\HBuilderX\plugins\launcher-tools\tools\adbs\adb.exe`，可用 `adb devices` 自检）；
3. **运行 → 运行到手机或模拟器 → 运行到 Android App 基座**；
4. 只在电脑上看：**运行 → 运行到浏览器**（H5 分支，用 iframe 加载同一份页面）。

> ⚠️ **「运行」菜单三项全灰怎么办**：多半是 HBuilderX 打开/登记的项目不是本工程
> （比如把外层的 `DrugQuiz-SC2-Android` 目录当成了项目，或工程目录改过名导致旧条目失效）。
> 排查步骤与证据见 [HBuilderX运行菜单全灰-排查与解决.md](./HBuilderX运行菜单全灰-排查与解决.md)。
>
> 已修复：工程现在在 HBuilderX 里登记为 `Pharma Law Quiz Bank(UniApp_VUE)`。
> 若以后又出现同样情况，一条命令即可重新导入：
> ```powershell
> & "D:\ProgramData\HBuilderX\cli.exe" project open --path "D:\codex code\HBuilderProjects\DrugQuiz-SC2-Android\Pharma Law Quiz Bank"
> & "D:\ProgramData\HBuilderX\cli.exe" project list
> ```

### 真机验收 6 项

| # | 项 | 预期 |
| --- | --- | --- |
| 1 | 启动 | 无 uni-app 导航栏、深青顶栏 + logo +「生产二部」，无白屏 |
| 2 | 四个 tab 切换、答一题 | 与现有 APK 一致，解析正常展开 |
| 3 | 杀掉进程重开 | 进度还在（localStorage 持久） |
| 4 | 设置页「导出进度」 | 提示已复制到剪贴板（`app-shim.js` 生效） |
| 5 | 设置页「导入进度」 | 能唤起文件选择器并导入；若不能 → 用「粘贴导入」兜底（见下） |
| 6 | 返回键 | 练习页返回回到首页，首页再按一次才退出 |

---

## 五、离线自检（不用打开 HBuilderX）

```powershell
cd "D:\codex code\四合一工具集\药品管理题库\安卓版"

node verify_hbuilder.mjs        # 29 项：工程结构 + 包名/权限/图标 + file:// 四页冒烟（含答题、落盘、导出）
node verify_www.mjs             # 55 项：网页资源完整验收（对 安卓版/www）
node verify-quiz-40.mjs         # 作答测试：单选 20 道 + 多选 20 道（判分/解析/统计/答题卡/错题本）
# 想测 Android 版那份资源：node verify-quiz-40.mjs --dir "D:\codex code\四合一工具集\药品管理题库\安卓版\www"

# 也可让 55 项直接验收 HBuilderX 工程里的副本：
$env:HBX_WWW_DIR="D:\codex code\HBuilderProjects\DrugQuiz-SC2-Android\Pharma Law Quiz Bank\hybrid\html"
node verify_www.mjs
Remove-Item Env:\HBX_WWW_DIR
```

可选的**无界面预编译**（提前暴露 pages.json / manifest.json / .vue 的语法错误，
等价于 HBuilderX 内部的编译器）：

```powershell
$plugin = "D:\ProgramData\HBuilderX\plugins\uniapp-cli-vite"
$proj   = "D:\codex code\HBuilderProjects\DrugQuiz-SC2-Android\Pharma Law Quiz Bank"
$out    = "$proj\unpackage\dist\build\h5"
$env:UNI_INPUT_DIR = $proj; $env:UNI_OUTPUT_DIR = $out
$env:UNI_PLATFORM = "h5";   $env:UNI_CLI_CONTEXT = $plugin; $env:NODE_ENV = "production"
Push-Location $plugin
node "$plugin\node_modules\vite\bin\vite.js" build --config "$plugin\vite.config.js" --outDir "$out"
Pop-Location
Remove-Item Env:\UNI_INPUT_DIR, Env:\UNI_OUTPUT_DIR, Env:\UNI_PLATFORM, Env:\UNI_CLI_CONTEXT
```

> 注意 `--outDir` 必须显式带上：不带的话 H5 应用产物会落到工程根目录的 `dist/`，
> 而 `static/`、`hybrid/` 副本会落到 `UNI_OUTPUT_DIR`，两边分家会报 404。

---

## 六、将来要用 HBuilderX 云打包

已预留好，本次**未执行**：

| 项 | 值 | 在哪配 |
| --- | --- | --- |
| 包名 | `com.drugquiz.sc2`（与现有 APK 相同 → 可覆盖升级） | `manifest.json → app-plus.distribute.android.packagename` |
| 签名 | `android-signing\drugquiz-release.keystore`（alias `drugquiz`，密码见同目录 `密码-drugquiz.txt`） | HBuilderX 打包界面「Android 自有证书」 |
| 应用名 / 版本 | 药品法规刷题 / 1.5.3（versionCode 153） | `manifest.json` 顶部 |

> 提醒：云打包还要在 HBuilderX 里登录 DCloud 账号并「重新获取 appid」（当前是本地生成的
> `__UNI__7B7379B`）。打出来的 APK 与现有 Capacitor APK **同包名同签名**，
> 可以直接覆盖安装，进度不丢。

---

## 七、已知说明 / 待实测

| 项 | 说明 |
| --- | --- |
| 剪贴板 | Android WebView 的 `file://` 页面里 `navigator.clipboard` 可能缺失，已由 `web/app-shim.js` 用 `plus.navigator.setClipboard` 顶上；再不济还有只读文本框兜底 |
| 文件导入 | `<input type="file">` 在 uni-app 的 web-view 里能否唤起系统选择器需真机确认；若不行，改成「粘贴导入」文本框（改动只在设置页） |
| 应用图标 | 打包图标由 `sync_hbuilder.py` 从现有品牌图标生成，未重画 |
| 根目录 `dist/` | 无界面预编译留下的产物，HBuilderX 用 `unpackage/`，`dist/` 可安全删除 |
