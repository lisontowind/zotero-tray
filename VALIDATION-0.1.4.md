# 0.1.4 验证记录

2026-11-04，Windows x64、Zotero 10.0.7。真实应用测试使用 `artifacts/test-profile/profile` 和独立数据目录，不访问日常文献库。通过 `python scripts/run-windows-tests.py` 完整运行，并验证测试实例正常退出。

- 35 项 JavaScript 测试通过。新增主线程三处函数声明分别失败时的 DLL 回收、故障通知去重与点击复制诊断、通知降级、临时及持续清理失败、GDI 删除失败、图标替换失败、部分 DLL 关闭失败、停止期间拒绝外观分配等回归检查。
- 2 项 Python 打包测试通过。XPI 和更新清单可重复构建，源码边界、版本、SHA-256、下载地址和兼容范围一致；错误发布标签被拒绝。
- 46 项真实 Zotero 集成检查通过，包含隐藏恢复、原生通知、最大化、前台激活、退出取消、菜单打开时停止、10 次启停、图标丢失恢复、延迟清理确认，以及新增的外观资源复用和清理失败重试。
- 单独切换 Zotero 菜单主题：原生画刷创建累计次数由 9 变为 12，字体维持 1 次，图标维持 3 次。随后单独切换任务栏主题：图标由 3 变为 4 次，画刷维持 12 次、字体维持 1 次。统计由测试驱动包装真实 Worker 的资源创建函数取得。
- 清理重试使用真实 Worker 和原生窗口，在测试驱动中让第一次 `DestroyWindow` 返回失败；第二次调用真实系统函数后清理完成，主窗口可见，停止返回成功。持续失败和重复释放保护另由模拟测试覆盖。
- 空闲消息泵在 2107 ms 内执行 20 次，保持 100 ms 间隔。资源创建次数减少不等同于 CPU 或功耗的具体降幅。
- 正式 XPI 另行安装到同一独立配置并重启验证，插件管理器识别版本 0.1.4、作者、主页和图标；关闭到托盘、原生托盘通知恢复主窗口通过。随后正常退出，日志记录原生资源释放和数据库关闭。
- Python 脚本语法检查、Git 差异空白检查通过。GitHub Actions 配置已增加 Windows/Linux 验证矩阵及可选 Windows 自托管原生任务；远端结果以对应版本的 Actions 运行记录为准。

Defender 于 2026-11-04 11:35:32 +08:00 扫描源码与最终 XPI，均退出码 0、未发现威胁。引擎 `1.1.26100.4`，病毒库 `1.463.99.0`。未修改防护设置。

XPI SHA-256：

```text
23a49f9fd96b2933fd20039bf6c4dde80b50364162bace8be4666a17944aa731
```

原始结果：`artifacts/native-validation-0.1.4.log`、`artifacts/integration-results.json`、`artifacts/normal-quit-result.json`、`artifacts/production-0.1.4-result.json`、`artifacts/defender-scan.json`、`artifacts/test-profile/native-stdout.log`、`artifacts/test-profile/production-stdout.log`。

## 验证边界

- 真实混合 DPI 多屏仍未验证；负坐标和 DPI 刷新顺序由模拟测试覆盖。
- Explorer 恢复检查使用删除图标模拟；未重启日常 Explorer，也未触发真实休眠、注销或系统重启。
- 故障通知的去重、点击复制和降级流程由模拟测试覆盖；Windows 通知点击和屏幕阅读器交互尚需人工验收。
- Word、浏览器 Connector、32 位及 ARM 原生环境未新增验证。
- 发布前本地验证未覆盖在线更新入口；发布阶段另行核验。自动更新以正式发布的 XPI 和 `updates.json` 为准。
- 人工验收步骤见 [Windows 验证清单](docs/windows-validation.md)。
