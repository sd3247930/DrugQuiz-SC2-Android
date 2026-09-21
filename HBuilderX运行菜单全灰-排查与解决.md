# HBuilderX「运行」菜单三项全灰：原因、排查与解决

日期：2026-09-21
现象：HBuilderX 里 **运行(R) → 运行到浏览器(B) / 运行到手机或模拟器(N) / 运行到小程序模拟器(M) 三项全部不可用（灰色）**
对象工程：`D:\codex code\HBuilderProjects\DrugQuiz-SC2-Android\Pharma Law Quiz Bank`

---

## 一、结论（根因）

HBuilderX 的「运行」菜单是**按「当前激活项目」的类型**启用的。
**它现在认的项目是外层那个 `DrugQuiz-SC2-Android` 目录（普通文件夹），而不是里面真正的 uni-app 工程。**
普通文件夹没有可运行的平台，于是三项全灰。

还有第二个叠加因素：**这个工程目录今天被改过名**（HBuilderX 里登记的旧路径已经不存在了），
旧项目条目失效，也会让菜单没有可用目标。

### 证据（HBuilderX 自己的配置文件）

文件：`C:\Users\Administrator\AppData\Roaming\HBuilder X\HBuilder X.ini`

```ini
[workspace]
projects\size=2
projects\1\path=D:/codex code/HBuilderProjects/LifestyleApp          ← 你的正常项目
projects\1\type=32                                                    ← type=32 = uni-app 项目
projects\2\path=D:/codex code/HBuilderProjects/DrugQuiz-SC2-Android   ← 外层目录被开成了项目
projects\2\type=1                                                     ← type=1 = 普通目录/非可运行类型
projects\3\path=D:/codex code/HBuilderProjects/DrugQuiz-SC2-Android/药品管理相关法规知识竞赛试题库
projects\3\type=32                                                    ← 旧名字，目录已不存在
```

同一文件里，编辑器打开的文件与项目的对应关系更能说明问题：

```ini
page\recentFiles\1\filepath=D:/codex code/HBuilderProjects/DrugQuiz-SC2-Android/Pharma Law Quiz Bank/manifest.json
page\recentFiles\1\projectId={55b6d756-610b-4a5c-8835-44bdb68c4543}   ← 这个 id 正是上面 projects\2（外层目录）
```

也就是说：**`Pharma Law Quiz Bank` 下的文件，被 HBuilderX 归到了「外层目录」这个 type=1 的项目里**。

### 目录改名的时间线（也能对上）

| 时间 | 事件 |
| --- | --- |
| 16:39:46 | HBuilderX 新建工程，当时的目录名是「药品管理相关法规知识竞赛试题库」 |
| 16:40 | HBuilderX 打开并编辑该旧路径下的 `manifest.json` / `pages.json` / `App.vue` |
| 16:41:38 | 目录被重命名为 `Pharma Law Quiz Bank`（外层 `DrugQuiz-SC2-Android` 的修改时间） |
| 之后 | 旧项目条目失效、新路径未重新登记 → 运行菜单没有可用目标 |

---

## 二、怎么解决（3 分钟，按顺序做）

### 2.0 已用 HBuilderX CLI 执行完成（2026-09-21 17:43，无需再手动点）

HBuilderX 自带 `D:\ProgramData\HBuilderX\cli.exe`，支持项目导入/关闭/列出，因此这 5 步可以
用命令行精确执行（效果与在界面里点一样，且可复核）：

```powershell
$cli   = "D:\ProgramData\HBuilderX\cli.exe"
$inner = "D:\codex code\HBuilderProjects\DrugQuiz-SC2-Android\Pharma Law Quiz Bank"
$outer = "D:\codex code\HBuilderProjects\DrugQuiz-SC2-Android"

& $cli project list                                     # 修复前：列表里根本没有本工程
& $cli project open  --path $inner                      # 步骤 2：导入正确的工程根
& $cli project close --path $outer                      # 步骤 3：移除外层目录这个多余条目
& $cli open file     --file "$inner\manifest.json"      # 步骤 4：让编辑器焦点落在工程内
& $cli project list                                     # 步骤 5：确认类型

# 附：用 HBuilderX 自己的运行管线编译一次（--compile true 只编译、不弹浏览器）
& $cli launch web --project "Pharma Law Quiz Bank" --compile true
```

**实际输出（关键三行）**：

```
修复前： 1 - DrugQuiz-SC2-Android(Web)        ← 外层目录被当成 Web 项目，本工程不在列表
         2 - LifestyleApp(UniApp_VUE)

project open：  正在导入项目...   项目导入成功

修复后： 1 - LifestyleApp(UniApp_VUE)
         2 - Pharma Law Quiz Bank(UniApp_VUE)   ← 正确识别为 uni-app（Vue3）

launch web：     项目 Pharma Law Quiz Bank 开始编译
                 编译器版本：5.26（vue3）
                 vite v5.2.8 dev server running at: http://localhost:5173/
                 已停止运行...                ← --compile true，编译完即停，不留后台服务
```

**关于步骤 1（关闭 HBuilderX）**：这里没有强杀 IDE，而是用 HBuilderX 官方支持的
`project close` + `project open` 完成「清掉旧的项目登记」这一目的 ——
强杀可能丢未保存内容。若你更希望彻底重启，随时可以关掉再打开，项目列表已经修好、重启后不会回退。

**修复后变化**：HBuilderX 现在把本工程认作 `UniApp_VUE` 项目，「运行」菜单按项目类型启用
—— 菜单已经具备可点的条件。运行到手机仍需插线（`cli devices list` 当前为空），
运行到小程序模拟器仍需另装微信开发者工具。

---

### 2.1 手动做法（如果你更习惯在界面里点）

1. **先关闭 HBuilderX**（它从 16:38 一直开着，缓存了旧的项目列表与类型）。
2. 重新打开 HBuilderX → **文件 → 打开目录** → 选中
   `D:\codex code\HBuilderProjects\DrugQuiz-SC2-Android\Pharma Law Quiz Bank`
   （**一定选到这一层**，它才是工程根：根目录下有 `manifest.json`、`pages.json`、`App.vue`、`main.js`）。
3. 在左侧**项目管理器**里，把两个多余的条目右键 **移除项目**：
   - `DrugQuiz-SC2-Android`（普通文件夹那个，**就是它顶掉了项目身份**）；
   - `药品管理相关法规知识竞赛试题库`（旧名字，路径已不存在）。
4. 在项目管理器里**双击打开**工程内的任意文件（比如 `manifest.json` 或 `pages/index/index.vue`），
   让编辑器标签属于该项目 —— 运行菜单这时就会亮起来。
5. 确认左侧项目图标显示为 **uni-app 项目**（不是普通文件夹）。

做完这 5 步，三个运行项的可点状态如下：

| 菜单项 | 之后能否用 | 前提 |
| --- | --- | --- |
| 运行到浏览器 | ✅ 可用 | 本机装了 Chrome/Edge（或内置浏览器插件，已确认存在） |
| 运行到手机或模拟器 | ✅ 可用（但**没设备时仍会灰/提示**） | 手机开 USB 调试 + 数据线连接 + `adb devices` 能看到设备 |
| 运行到小程序模拟器 | 仍灰属正常 | 需要另外安装并配置「微信开发者工具」路径（本工程没必要用） |

---

## 三、为什么「打开目录」要选到 `Pharma Law Quiz Bank` 这一层

| 打开的目录 | HBuilderX 认定的项目类型 | 运行菜单 |
| --- | --- | --- |
| `HBuilderProjects\DrugQuiz-SC2-Android`（外层） | 普通目录（type=1） | ❌ 三项全灰 |
| `...\DrugQuiz-SC2-Android\Pharma Law Quiz Bank`（真正的工程根） | uni-app（type=32） | ✅ 正常 |

HBuilderX 判断「是不是 uni-app 项目」看的是**项目根目录下有没有 `manifest.json` + `pages.json`**。
外层目录没有这两个文件，所以它只能当普通文件夹 —— 这正是当前全灰的原因。

> 另一个常见诱因：HBuilderX 项目管理器**只会自动列出 `HBuilderProjects` 的第 1 层子目录**。
> 本工程在第 2 层（`HBuilderProjects\DrugQuiz-SC2-Android\Pharma Law Quiz Bank`），
> 所以**必须用「文件 → 打开目录」手动添加**，它不会自己出现在项目列表里。

---

## 四、如果按上面做完还是灰的：按这张表逐项排查

| # | 检查点 | 怎么查 | 不正常时怎么办 |
| --- | --- | --- | --- |
| 1 | 当前编辑器焦点不在项目里 | 看左侧项目管理器是否有高亮项目，编辑器标签是不是该项目下的文件 | 双击项目里的文件再试 |
| 2 | 项目没被识别为 uni-app | 项目名右侧/图标是否 uni-app 类型 | 确认根目录有 `manifest.json` + `pages.json`；没有就是打开错目录了 |
| 3 | uni-app 编译器插件缺失 | 工具 → 插件安装，看 `uniapp-cli-vite` 是否已装 | 已确认本机**已安装**（`D:\ProgramData\HBuilderX\plugins\uniapp-cli-vite`） |
| 4 | 内置浏览器/本机浏览器缺失 | 工具 → 设置 → 运行配置 | 本机有 Edge；内置浏览器插件 `builtincef3browser` 也在 |
| 5 | 手机没连上 | `D:\ProgramData\HBuilderX\plugins\launcher-tools\tools\adbs\adb.exe devices` | 插线 + 打开 USB 调试 + 手机上允许调试授权；没设备时该项本来就是灰的 |
| 6 | HBuilderX 缓存了旧状态 | 重启 HBuilderX 再看 | 重启后仍灰 → 重复第二节第 3 步移除多余项目条目 |
| 7 | 微信小程序 | 需要微信开发者工具 | 本工程用不到，灰着正常 |

---

## 五、工程本身的迁移正确性检验（已跑，全绿）

命令（在 `药品管理题库\安卓版\` 下执行）：

```powershell
python sync_hbuilder.py --check     # 同步一致性
node verify_hbuilder.mjs            # HBuilderX 工程验收 + 识别条件/环境诊断
$env:HBX_WWW_DIR="D:\codex code\HBuilderProjects\DrugQuiz-SC2-Android\Pharma Law Quiz Bank\hybrid\html"; node verify_www.mjs; Remove-Item Env:\HBX_WWW_DIR
```

| 检查 | 结果 |
| --- | --- |
| 工程根必备文件（`manifest.json`/`pages.json`/`App.vue`/`main.js`/`index.html`/`uni.scss`） | ✅ 齐全 |
| `manifest.json` appid | ✅ `__UNI__7B7379B` |
| `pages.json` 里的页面都有对应 `.vue` | ✅ 1 个页面 |
| 应用名 / 版本 / 包名 / 权限 | ✅ 药品法规刷题 / 1.5.3(153) / `com.drugquiz.sc2` / 权限已裁到 2 项 |
| 两处副本（`hybrid/html`、`static/app-web`） | ✅ 19 个文件逐字节一致；与 `www/` 一致（18 + `app-shim.js`） |
| `file://` 四页冒烟（App 端 web-view 的运行环境） | ✅ 首页 300 题 / 答题判分 + 解析 / 进度落盘 / 导出 / 答题卡 300 格 / 零报错 |
| 网页资源完整验收 | ✅ 55/55 |
| 真实编译器出包 | ✅ HBuilderX 自带编译器（5.26 / vue3）一次通过，产物 `unpackage\dist\build\h5\` |
| 编译产物浏览器实测 | ✅ 外层标题「药品法规刷题」、iframe 加载 300 题页面、答题正常 |
| **验收脚本合计** | ✅ **36/36**（含本次新增的「HBuilderX 识别条件 + 环境诊断」7 项） |

> 结论：**工程迁移本身是正确的**，问题只出在「HBuilderX 里打开/登记的项目不是这个工程」。

---

## 六、可选：把工程挪到第 1 层（更省事，但会改路径）

如果希望 HBuilderX 一打开就自动列出、不用每次「打开目录」，可以把工程移到
`D:\codex code\HBuilderProjects\Pharma Law Quiz Bank`（`HBuilderProjects` 的第 1 层）。

代价：路径变了，需要同步更新 `sync_hbuilder.py` 的默认 `--project` 值与文档。
工程内部**没有硬编码绝对路径**（只有同步脚本的默认参数），所以搬家很安全。
需要的话告诉我，我改脚本 + 文档，你也可以随时用 `--project "<新路径>"` 临时指定。

> 顺带说明：目录名里的**空格不是问题** —— 本机用 HBuilderX 自带编译器对该路径成功出过包，
> 说明编译链路完全支持含空格的路径。
