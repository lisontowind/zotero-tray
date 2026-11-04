# Zotero Tray

Windows 上的 Zotero 托盘插件。关闭主窗口后继续在后台运行，单击托盘图标恢复或激活窗口，右键可正常退出 Zotero。

安装包只包含可读源码和许可证，不附带 EXE、DLL 或辅助进程。支持深浅色模式、高对比度与 DPI 缩放。

## 下载和安装

1. 从 [GitHub Releases](https://github.com/lisontowind/zotero-tray/releases) 下载已发布版本的 `.xpi`；当前源码版本为 **0.1.4**，也可按下方命令本地构建。
2. 在 Zotero“工具 → 插件”中停用旧托盘插件。
3. 点击插件窗口的齿轮菜单，选择“从文件安装插件”，安装下载的 `.xpi`。

已验证：Windows x64、Zotero **10.0.7**。兼容范围暂限 Zotero 10.0.x。作者：[lisontowind](https://github.com/lisontowind)。

0.1.3 配置了 GitHub Releases 自动更新入口；对应发布必须同时包含 XPI 和 `updates.json`，且正式发布后才能生效。0.1.2 及更早版本的更新地址为占位地址，需要先手动安装一次 0.1.3 或更高版本。

## 功能

- 关闭主窗口或按 Alt+F4：隐藏到托盘，Zotero 继续运行。
- 单击托盘图标：隐藏时恢复，已显示时请求激活，最小化时还原；保留窗口位置、大小和最大化状态。
- 右键菜单：“显示 Zotero”“退出 Zotero”。退出使用 Zotero 正常流程，支持取消退出。
- 最小化按钮保持任务栏行为；独立阅读器和设置窗口保持原有关闭行为。
- 禁用或卸载时恢复隐藏窗口并清理原生资源；托盘故障时恢复窗口。
- 异常停止等待最多 5 秒；未收到原生清理确认时保留资源，避免无限等待或强制终止回调。延迟确认到达后自动完成清理。
- 减少空闲消息轮询和图标健康检查；右键菜单按托盘所在显示器刷新 DPI。
- 原生清理失败时最多尝试 4 次，间隔 250 ms；成功释放的资源不重复释放，失败的资源继续保留。
- 菜单、字体和图标按需分别更新；只切换菜单主题时复用字体与托盘图标。
- 托盘故障时显示非阻塞通知，点击可复制诊断信息；清理持续失败时提示正常重启 Zotero。

## 文档和验证

- [完整中文说明、构建与测试方法](README.zh-CN.md)
- [v0.1.4 发布说明](docs/releases/v0.1.4.md)
- [v0.1.4 验证记录](VALIDATION-0.1.4.md)
- [MIT 许可证](LICENSE)

```powershell
python scripts/build.py
node --test tests/controller.test.cjs tests/appearance.test.cjs tests/tray-events.test.cjs tests/worker-native.test.cjs
python -m unittest discover -s tests -p test_package.py
```

Windows 上可运行 `python scripts/run-windows-tests.py`，在独立配置中一键执行真实 Zotero 集成测试并正常退出测试实例。CI 同时在 Windows 和 Linux 上运行单元与打包测试；可手动选择已安装 Zotero 10 的 Windows 自托管运行器执行原生测试。

使用 Windows 系统 DLL 的原生接口，仍需考虑 Zotero 进程内调用的稳定性。扫描记录见对应版本验证文档；扫描通过不保证永不误报，无需关闭防护或添加排除项。

本项目为独立实现，与 Zotero 官方无隶属关系。
