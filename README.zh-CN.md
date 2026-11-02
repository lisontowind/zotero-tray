# Zotero Tray

为 Windows 上的 Zotero 10 提供关闭到托盘、恢复窗口和右键正常退出功能。

这是纯 Zotero 插件：安装包内只有可读 JavaScript 和清单，不附带 EXE/DLL，不启动辅助进程，不运行 PowerShell，不监听本地端口。

## 安装和使用

1. 从 [GitHub Releases](https://github.com/lisontowind/zotero-tray/releases) 下载发行包，或构建 `dist/zotero-tray-0.1.3.xpi`。作者为 [lisontowind](https://github.com/lisontowind)。
2. 在 Zotero 的“工具 → 插件”中停用旧的 Minimize Zotero To Tray，避免两个插件同时拦截关闭事件。
3. 通过插件窗口的齿轮菜单选择“从文件安装插件”，选择本项目的 `.xpi`。
4. Zotero 启动后会出现托盘图标。如果 Windows 把图标放在折叠区域，可在任务栏的隐藏图标区域找到它。

点击主窗口的关闭按钮或按 Alt+F4 会隐藏主窗口，最小化按钮仍使用任务栏。单击托盘图标或选择右键菜单的“显示 Zotero”：窗口隐藏时恢复，已经显示时激活到前台，最小化时恢复并激活；保留窗口位置、大小和最大化状态。“退出 Zotero”和 Zotero 文件菜单的退出均走正常退出流程，保留退出取消机制。独立阅读器和设置窗口不拦截关闭。

停用或卸载本插件会先恢复隐藏的主窗口，并清理托盘图标和原生资源。

## 深色模式与缩放

- 菜单跟随 Zotero 的浅色/深色偏好；背景、文字、选中状态和分隔线均有对应配色。
- 托盘图标根据 Windows 的任务栏主题切换描边，支持 Zotero 与 Windows 使用不同主题。
- Windows 高对比度模式使用系统菜单颜色；图标采用具有对比描边的系统文字色。
- 图标在内存中按 DPI 绘制，菜单字号和间距按 DPI 缩放。主题变化无需重启 Zotero。
- 菜单保留原生键盘导航，并为自绘菜单提供 MSAA 可访问文字。

## 构建和验证

只需要 Python 3.9+；运行测试还需要 Node.js 18+ 和已安装的 Zotero 10。

```powershell
python scripts/build.py
node --test tests/controller.test.cjs tests/appearance.test.cjs tests/tray-events.test.cjs
python -m unittest discover -s tests -p test_package.py
```

构建脚本固定 ZIP 条目时间与顺序，输出 `.xpi`、`.xpi.sha256` 和 `dist/updates.json`。更新清单包含插件 ID、版本、固定版本下载链接、SHA-256 及兼容范围。安装包不包含测试驱动。

发布时运行 `python scripts/build.py --tag v0.1.3`，标签必须与清单版本一致。推送版本标签会触发 `.github/workflows/release.yml`：先测试，再创建包含 XPI、校验文件和更新清单的 GitHub Release 草稿。核对草稿后正式发布，`releases/latest/download/updates.json` 才会提供该版本；草稿和预发布版本不作为稳定更新入口。普通 PR 和手动运行工作流只做验证。

真实集成测试使用工作区内的独立 Zotero 配置和数据目录，不访问日常文献库：

```powershell
python scripts/prepare-test-profile.py
```

按脚本输出启动测试 Zotero，插件代理会在该独立配置中加载测试驱动。如果使用程序化安装，仅在测试实例启动时加 `--marionette --remote-allow-system-access`，然后运行：

```powershell
python scripts/install-test-addon.py
python scripts/integration-test.py
python scripts/quit-test-profile.py
```

测试接口仅用于独立测试进程，退出后关闭；正式安装包没有文件命令桥、调试监听器或故障注入入口。集成测试输出保存在 `artifacts/`。可用 Windows PowerShell 5.1 运行 `scripts/scan.ps1`，对源码和安装包进行 Defender 扫描并记录引擎、病毒库及 SHA-256；不修改 Defender 设置。

验证正式 XPI 时，重新启动同一独立配置并开启上述 Marionette 参数，运行 `python scripts/install-test-addon.py --package`，随后运行 `python scripts/verify-production.py`。后者安装独立的临时验证插件，核对正式包元数据及隐藏/恢复行为后正常退出测试实例；验证插件不进入发行 XPI。

## 安全和兼容性说明

已验证的平台和具体结果见 `VALIDATION-0.1.3.md`；旧版 `VALIDATION*.md` 保留历史记录。当前清单允许 Zotero 10.0.x；其他版本、32 位及 ARM 原生环境尚未验证。

插件只加载 Windows 系统目录中的系统 DLL。托盘和自绘菜单在专用 ChromeWorker 中运行，Windows 回调、消息窗口和消息泵属于同一线程。主窗口的原生窗口过程不被替换。清理采用协作停止，菜单打开时也可退出，避免留下失效的原生回调。

原生调用仍运行在 Zotero 进程中，Worker 并不构成进程级崩溃隔离。源码公开和病毒扫描无法保证绝无漏洞或永不误报；无需关闭安全中心或添加排除项。

从 0.1.3 起，HTTPS `update_url` 指向本仓库 GitHub Releases 的 `updates.json`。更新请求由 Zotero 自身发起，插件运行代码不访问网络。正式发布时必须把构建生成的 `updates.json` 与对应 XPI 一起作为附件上传；仅修改清单无法让尚未发布的版本在线更新。0.1.2 及更早版本使用 `.invalid` 占位域名，无法自动发现新地址，需要先手动安装一次新版本。

正常停止优先等待 Worker 释放全部原生资源。等待超过 5 秒或原生清理失败时，先恢复窗口并移除关闭拦截，再返回未完成状态；应用级保留集合继续持有 Worker、回调及 DLL，防止插件作用域卸载后出现悬空指针。延迟确认到达后才终止 Worker 并释放其余资源。未确认期间阻止再次启动托盘；若始终不能清理，需要正常重启 Zotero。

本项目为独立实现，不复用旧插件的 AutoHotkey 程序。代码采用 MIT 许可证。

## 启动速度和加载顺序

0.1.1 优化了图标几何计算，并按尺寸缓存与主题无关的覆盖率；重复的外观通知会被合并。Worker 启动与主线程桥接准备并行。调试日志会记录 `icon`（插件入口至注册图标）、`worker`（Worker 内部初始化）和 `notification delay`（主线程处理就绪消息的等待），以区分插件自身开销和主线程忙碌。

这无法消除 Zotero 调用插件之前的等待。本机 Zotero 10.0.7 在 `Zotero.Plugins.init()` 中按 `AddonManager.getAllAddons()` 的返回顺序依次等待各插件的启动回调；没有可在本插件清单中设置的启动优先级。

若要固定让本插件先于其他插件启动，需要给 Zotero 加载器增加置顶逻辑。在 Zotero 的 `app/omni.ja` 内，`chrome/content/zotero/xpcom/plugins.js` 的初始化方法取得插件数组之后、遍历之前，逻辑为：

```javascript
var addons = await AddonManager.getAllAddons();
const trayIndex = addons.findIndex(addon => addon.id === "zotero-tray@local");
if (trayIndex > 0) {
  addons.unshift(addons.splice(trayIndex, 1)[0]);
}
for (let addon of addons) {
  // 原有的兼容性检查和插件启动逻辑
}
```

这里只给出修改位置和代码示例，发行 XPI 不修改 Zotero 程序。Zotero 升级可能覆盖核心改动；即使置顶，也仍需等主程序执行到插件初始化阶段。修改配置目录中的 `extensions.json` 数组顺序可能影响当前实现的枚举顺序，但不是受支持的优先级接口，可能被重写，不作为本插件的自动优化方式。

0.1.1 同时修复了兼容新旧右键事件时产生的重复菜单：选择“显示 Zotero”后，菜单不再因旧事件残留而再次打开。

0.1.3 把消息泵间隔由 30 ms 调整为 100 ms，理论定时触发次数约减少 70%；这不等同于 CPU 或功耗降低 70%，事件派发最多增加约 70 ms 的轮询等待。健康状态下图标检查由每 2 秒调整为每 10 秒，Explorer 的 `TaskbarCreated` 广播会立即触发恢复检查，失败后每秒重试。菜单使用 Windows 提供的托盘坐标（支持负坐标），弹出前把隐藏的菜单所有者移到该位置并按实际窗口 DPI 更新外观，不移动 Zotero 主窗口。真实混合 DPI 多屏仍需额外设备验证。
