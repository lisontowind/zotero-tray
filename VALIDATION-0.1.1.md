# 0.1.1 验证记录

日期：2026-11-02，Asia/Shanghai。环境：Windows x64、Zotero 10.0.7、Gecko 140，175% 缩放。使用工作区内的独立 Zotero 配置，不更改日常配置和文献库。

## 修复和优化

- 菜单重现问题已复现：原实现同时处理 `WM_RBUTTONUP` 与 `WM_CONTEXTMENU`，同一点击可产生两个菜单请求。改为仅处理 `NOTIFYICON_VERSION_4` 通知、合并排队请求，并忽略菜单跟踪期间的重复请求。
- 图标几何使用包围盒和平方距离计算，按尺寸缓存与主题无关的覆盖率；重复主题通知合并。
- Worker 初始化与主线程桥接准备并行。新增入口、图标注册、Worker 初始化和主线程通知延迟的独立计时。

## 性能证据

- Node.js 基准中的 28 像素冷图标绘制，7 次取中位数：141.80 ms → 10.47 ms，约 13.5 倍。
- 7 个尺寸 × 2 种主题，共 14 份图像与优化前逐字节相同；这项基准衡量绘制算法，不等同于 Zotero 进程冷启动速度。
- 真实 Zotero 独立实例中，42 次插件安装/启停采样的入口至注册图标耗时：中位数 78.5 ms，范围 46–118 ms。包含重复启动 Worker，并非 42 次操作系统冷启动。
- 此前 0.1.0 独立启动日志显示：Zotero 日志开始至调用本插件约 2874 ms，随后至主线程收到托盘就绪消息约 143 ms。该记录说明启动入口之前也有等待，不构成严格的前后冷启动对照。

纯插件仍需等待 Zotero 调用启动入口；加载顺序不能通过本插件清单指定。固定置顶需要 Zotero 加载器支持，具体位置和代码示例见 `README.zh-CN.md`。

## 回归与安装包

- 16 个 JavaScript 单元测试全部通过。
- 39 项真实 Zotero 集成检查全部通过，包括新旧右键通知同时到达、显示窗口后无残留菜单、深浅色、高对比度、退出取消、10 次启用/停用、资源计数和故障恢复。
- 菜单回归检查使用真实 HWND 消息队列，并由测试驱动提供菜单选择结果；菜单弹出次数为 1，选择显示后待处理菜单数为 0。
- 可复现构建及纯源码包边界测试通过。最终生产 XPI 成功安装、启动，并通过非强制的正常退出流程清理资源。

Defender 扫描时间：2026-11-02 03:10:07 +08:00；引擎 `1.1.26100.4`，病毒库 `1.463.63.0`。源码与最终 XPI 均退出码 0、未发现威胁；没有修改防护设置或添加排除项。

最终 XPI 的 SHA-256：

```text
b33575d6f21ada1964092090577d0f9f25fbec569eea4496b2ee0f6ef1a76358
```

原始证据：`artifacts/performance/icon-benchmark.json`、`artifacts/performance/startup-timings.json`、`artifacts/integration-results.json`、`artifacts/defender-scan.json` 和 `artifacts/test-profile/performance-stdout.log`。

验证边界沿用首版：未触发真实 Windows 注销或 Explorer 重启，Word/Connector 完整端到端流程、屏幕阅读器朗读及其他架构仍未验证。Defender 本次通过不保证未来永不误报。
