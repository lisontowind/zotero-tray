# 0.1.2 验证记录

2026-11-02，Windows x64、Zotero 10.0.7、Gecko 140。全部应用测试使用工作区内的独立配置。

本版增加真实窗口可见性检查和 Windows `SetForegroundWindow` 调用。窗口已显示时只执行焦点与前台激活；隐藏时先恢复，最小化时先还原。保留位置、大小和最大化状态。

- 18 项 JavaScript 单元测试通过，包含可见窗口激活、窗口状态不变，以及 Windows 拒绝激活时托盘仍可用。
- 41 项真实 Zotero 集成检查通过，包含原生激活接口调用、成功返回时立即核对实际前台 HWND、窗口几何不变，以及既有菜单、深浅色、退出取消和资源释放检查。
- 测试使用独立实例自己的窗口作为前台测试对象；合成通知不保证拥有真实鼠标点击的前台权限。测试明确区分系统接受和拒绝激活两种结果，不修改 Windows 焦点策略。Windows 对前台激活的限制见 [Microsoft 文档](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)。
- 可复现构建与纯源码包边界检查通过；最终生产包安装、启动及非强制正常退出验证通过。

Defender 于 2026-11-02 03:42:25 +08:00 扫描源码和最终安装包，均退出码 0、未发现威胁。引擎 `1.1.26100.4`，病毒库 `1.463.63.0`。未修改防护设置或添加排除项。

XPI SHA-256：

```text
37eee1b524f67e411ff89e0ddae4d3e86088efbb70855904cc131658ff3c46fd
```

既有验证边界沿用 `VALIDATION-0.1.1.md`。原始证据位于 `artifacts/integration-results.json`、`artifacts/defender-scan.json`、`artifacts/activation-production-quit-result.json` 及 `artifacts/test-profile/activation-stdout.log`。
