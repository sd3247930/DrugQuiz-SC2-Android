# 构建 DrugQuiz-SC2.apk

推荐使用 **GitHub Actions 远程构建**（无需本地 Java / Android 环境）。

---

## 方式一：GitHub Actions 远程构建（推荐）

本项目已内置 CI 工作流 `.github/workflows/build-apk.yml`。

### 上传到 GitHub

```bash
# 在 GitHub 新建仓库（例如 DrugQuiz-SC2-Android），然后：
cd "D:\codex code\四合一工具集\药品管理题库\安卓版"
git remote add origin https://github.com/<你的用户名>/DrugQuiz-SC2-Android.git
git push -u origin main
```

### 触发构建

1. 打开仓库的 **Actions** 页面；
2. 左侧选 **Build DrugQuiz APK**；
3. 点 **Run workflow** → 绿色按钮。

### 下载 APK

构建成功后（约 5～8 分钟），在运行页底部 **Artifacts** 下载 `DrugQuiz-APK` 工件，
内含 `DrugQuiz-SC2.apk` 与 SHA-256 校验值，传到手机即可安装。

> CI 会做一次**题库完整性校验**：确认 `data-offline.js` 已打入安装包、题目数 ≥ 300、
> 网页资源与 `www/` 一致，防止装出来的 App 是空壳。

---

## 方式二：本地构建（需 Node 22 + JDK 21 + Android SDK 36）

```bash
# 1. 进入项目
cd "D:\codex code\四合一工具集\药品管理题库\安卓版"

# 2. 安装依赖
npm install

# 3. 生成离线题库 + 拆分网页资源 + 同步进 Android 工程
python generate_offline.py
python build_www.py
npx cap sync android

# 4. 打包（首次会下载 Gradle 依赖，需数分钟）
set JAVA_HOME=C:\path\to\jdk-21
set ANDROID_HOME=C:\path\to\android-sdk
cd android
gradlew assembleDebug

# 5. 取出 APK
copy app\build\outputs\apk\debug\app-debug.apk "..\DrugQuiz-SC2.apk"
```

或者用 Android Studio 打开 `android/` 目录，直接点 **Run / Build APK**。

---

## 方式三：在 HBuilderX 里运行 / 调试（不出包）

同一份网页资源还有一个 uni-app 壳，用于在 HBuilderX 里运行与调试：

```
D:\codex code\HBuilderProjects\DrugQuiz-SC2-Android\Pharma Law Quiz Bank
```

```powershell
# 1. 改完界面/题库后，先把 www/ 同步过去
cd "D:\codex code\四合一工具集\药品管理题库\安卓版"
python sync_hbuilder.py

# 2. 在 HBuilderX 里打开该工程 → 运行 → 运行到手机或模拟器 → 运行到 Android App 基座
```

细节（含离线自检与无界面预编译）见 [HBuilderX说明.md](./HBuilderX说明.md)。

> 注意：HBuilderX 那条路径**不出正式 APK**，网页上「📥 下载应用（APK）」的直链仍然指向
> 本目录经 GitHub Actions 构建的产物。云打包的包名与签名已预留（`com.drugquiz.sc2` +
> `android-signing/drugquiz-release.keystore`），本次未执行。

---

## 本机（沙箱环境）构建受限说明

在当前这台机器的沙箱环境里，**Gradle 无法启动构建**，报错为：

```
FAILURE: Build failed with an exception.
* What went wrong:
java.io.IOException: Unable to establish loopback connection
  at org.gradle.internal.remote.internal.inet.SocketConnection.<init>(SocketConnection.java:64)
  at org.gradle.launcher.daemon.client.DefaultDaemonConnector.connectToDaemon(...)
  at org.gradle.launcher.daemon.client.SingleUseDaemonClient.execute(...)
```

**已经排除的原因**（实测）：

| 检查项 | 结果 |
| --- | --- |
| Gradle 能否运行 | ✅ `gradlew --version` 正常（Gradle 8.14.3 / JDK 21.0.12） |
| JDK 的 NIO 管道是否可用 | ✅ 单独测试 `java.nio.channels.Pipe.open()` **成功** |
| 依赖是否齐全 | ✅ npm 依赖、JDK 21、Android SDK 36 均已就绪 |
| 守护进程模式 | ❌ 常驻守护报 `Could not create service of type FileLockContentionHandler` |

**结论**：限制在于 Gradle **启动子进程（daemon）并与之建立回环连接**这一步被沙箱禁止，
不是 JDK 或项目配置的问题。同样的问题在参考项目 `CommDebug-apk` 的 `BUILD.md` 中也有记录。

**应对**：使用上面的 **方式一（GitHub Actions）**，或在普通 Windows / 装有 Android Studio 的电脑上本地构建。

---

## 产物信息

| 项 | 值 |
| --- | --- |
| 包名 | `com.drugquiz.sc2` |
| 应用名 | 药品法规刷题 |
| minSdk / targetSdk | 24 / 36 |
| 产物类型 | debug 调试包（可侧载安装，非上架 release 包） |
| 校验 | `apksigner verify --verbose DrugQuiz-SC2.apk` |
