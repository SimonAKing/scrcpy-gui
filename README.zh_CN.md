# Scrcpy GUI

[English](README.md) · 简体中文

一个面向 [scrcpy](https://github.com/Genymobile/scrcpy) 4.x 的现代桌面管理界面。它可以发现 USB 设备、完成 Android 11+ 无线配对、同时启动多台设备、录制会话，并把 scrcpy 的常用参数集中到可靠的图形界面中。

> 2.0 是一次从底层重建的现代化版本，目前处于 Beta。反馈问题时请附上「日志」页面内容和 scrcpy 版本。

## 主要变化

- 支持 `adb pair`、无线连接和 USB 设备发现
- 支持多设备启动，并防止同一设备被重复打开
- 覆盖 scrcpy 4.x 的视频、音频、键盘、快捷键、录制、窗口、裁剪和编码设置
- 不再提前提示“打开成功”；失败时直接显示 scrcpy stderr 的真实错误
- 可以关闭弹窗通知，同时保留最多 500 条进程日志
- 自动识别系统语言，支持英文、简体中文、繁体中文和俄语
- Renderer 沙箱、context isolation、受限 IPC，不通过 shell 执行用户参数
- macOS、Windows、Linux 自动测试和发布构建

## 使用要求

- [scrcpy 4.x](https://github.com/Genymobile/scrcpy/releases)
- Android platform-tools 中的 `adb`，或自带 `adb` 的官方 scrcpy 包
- 设备已经开启 Android 调试

首次启动时选择 `scrcpy` 可执行文件；也可以提前把 `scrcpy` 与 `adb` 加入系统 `PATH`。

## Android 11+ 无线调试

1. 打开手机的「开发者选项 → 无线调试」。
2. 选择「使用配对码配对设备」。
3. 把配对地址和六位配对码填入 Scrcpy GUI，点击「配对」。
4. 再输入无线调试页面显示的连接地址，点击「连接」。

## 本地开发

推荐 Node.js 22 或更高版本：

```bash
npm ci
npm test
npm run dev
```

生产构建：

```bash
npm run typecheck
npm run build
npm run build:dir
```

## 排查问题

- 没有发现设备：先执行 `adb devices -l`，并在手机上允许当前电脑调试。
- 投屏立即退出：打开「日志」页，查看并提交 scrcpy 的 stderr。
- 裁剪和窗口尺寸的宽、高必须同时为 0，或者同时大于 0。
- 快捷键修饰键建议保持「系统默认」，避免占用普通的 Ctrl+X/C/V。

## 许可证

Scrcpy GUI 使用 [GPL-3.0](LICENSE)。scrcpy 是独立项目，遵循其自身许可证。
