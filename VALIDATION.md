# 0.1.0 验证记录

验证日期：2026-11-02（Asia/Shanghai）。环境：Windows x64、Zotero 10.0.7、Firefox/Gecko 140，测试菜单 DPI 为 168（175% 缩放）。全部 Zotero 测试使用工作区内的独立配置和数据目录；没有更改日常配置、文献库或旧托盘插件。

## 结果

| 验证项 | 结果 |
| --- | --- |
| 控制器和外观单元测试 | 11/11 通过 |
| 可复现构建及纯源码包边界测试 | 1/1 通过；两次构建字节相同 |
| 真实 Zotero 集成检查 | 38/38 通过 |
| 关闭事件和原生 WM_CLOSE | 隐藏窗口、保留进程；通过 Win32 IsWindowVisible 核对 |
| 恢复、窗口位置/尺寸及最大化状态 | 通过 |
| 最小化保持任务栏行为 | 通过 |
| 退出取消后再关闭 | 保持关闭到托盘行为 |
| 连续 10 次启用/停用 | GDI 资源均由 37 回落至 33，USER 资源均由 64 回落至 59，无逐次增长 |
| 禁用时恢复隐藏窗口 | 通过 |
| 控制器故障和 Worker 故障 | 恢复主窗口、释放原生资源 |
| 托盘图标丢失 | 删除测试图标后自动重建；检查系统图标 API 返回成功 |
| 原生右键菜单 | 可创建、显示；菜单仍打开时禁用可取消菜单并完成清理 |
| 显示/退出菜单命令路由 | 测试驱动提供选择结果，执行真实 Worker → 主线程路径 |
| 右键退出所走的正常 Zotero 退出流程 | 真实退出完成，原生资源清理得到确认 |
| 浅色、深色、高对比度渲染 | 在真实 Worker 中切换配置，图标和菜单颜色初始化通过；保留可访问文字 |
| 深浅色菜单文字对比度 | 普通和选中状态均超过 7:1 |
| 图标 DPI 数据 | 验证 16、20、24、28、32、48、64 像素图标格式、透明边缘和主题差异 |
| 最终生产 XPI | 安装后 active=true、appDisabled=false；托盘成功创建 |
| 最终生产插件正常退出 | 返回 shutdown、forced=false、in_app=true；日志确认原生资源清理 |

## Defender 扫描

2026-11-02 02:42:29 +08:00 使用 Microsoft Defender 自定义扫描，实时防护保持启用，没有添加排除项或修改防护设置。

- 引擎：`1.1.26100.4`
- 病毒库：`1.463.63.0`
- `addon/`：退出码 0，未发现威胁。
- 最终 `.xpi`：退出码 0，未发现威胁。

安装包大小：12,474 字节。SHA-256：

```text
23fd8773a81daae7f30d19f6c0d9312436359042e5f6669fb332fcce74f2ef2a
```

包内仅含 `manifest.json`、`bootstrap.js`、`content/tray-worker.js`、`content/appearance.js` 和 `LICENSE`。不包含 EXE、附带 DLL、测试命令桥或故障注入入口。

## 验证边界

- 图标恢复使用删除图标和重新注册模拟 Explorer 重启，没有重启用户的 Explorer。
- 高对比度使用对应渲染分支与系统颜色测试，没有更改 Windows 的全局主题设置。
- 菜单命令路由包含测试驱动选择结果；没有将自动化结果表述为人工点击验收。
- Word 引用和浏览器 Connector 保存尚未进行完整端到端测试；Windows 注销、系统重启及 Zotero 自动更新重启也未实际触发。
- 屏幕阅读器朗读、跨屏 DPI 切换和其他 Windows/Zotero 架构仍需后续实机验收。
- 本次扫描通过不保证未来病毒库或其他安全软件永不误报，也不等同于完整安全审计。

原始结果保存在 `artifacts/integration-results.json`、`artifacts/normal-quit-result.json`、`artifacts/production-quit-result.json`、`artifacts/defender-scan.json` 及测试实例日志中。
