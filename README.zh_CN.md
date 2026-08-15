<div align="center">
  <img width="96" height="96" src="build/icons/256x256.png" alt="Scrcpy GUI">
  <h1>Scrcpy GUI</h1>
  <p><strong>一个简洁、现代的 scrcpy 桌面图形界面</strong></p>
  <p>由 <a href="https://github.com/SimonAKing">Simon Ma</a> 用 ❤ 构建 · <a href="README.md">English</a></p>
</div>

<p align="center">
  <a href="https://github.com/SimonAKing/scrcpy-gui/actions/workflows/validate.yml"><img src="https://github.com/SimonAKing/scrcpy-gui/actions/workflows/validate.yml/badge.svg" alt="Validate"></a>
  <a href="https://github.com/SimonAKing/scrcpy-gui/releases"><img src="https://img.shields.io/github/v/release/SimonAKing/scrcpy-gui?style=flat-square" alt="最新稳定版"></a>
  <a href="https://github.com/SimonAKing/scrcpy-gui/releases"><img src="https://img.shields.io/github/downloads/SimonAKing/scrcpy-gui/total.svg?style=flat-square" alt="下载量"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/SimonAKing/scrcpy-gui?style=flat-square" alt="MIT"></a>
  <a href="https://github.com/SimonAKing/scrcpy-gui/issues"><img src="https://img.shields.io/badge/contributions-welcome-brightgreen.svg?style=flat-square" alt="欢迎贡献"></a>
</p>

Scrcpy GUI 可以发现通过 USB 或无线调试连接的 Android 设备，并通过可靠的图形配置启动 [scrcpy](https://github.com/Genymobile/scrcpy)。它支持同时投屏多台设备、录制、音频、现代键盘模式、画面裁剪、窗口布局和当前 scrcpy 4.x 命令行参数。

> 2.4 是从底层重建后的首个正式稳定版。反馈回归问题时，请附上「日志」页内容、操作系统和 scrcpy 版本。

## 界面

![Scrcpy GUI 设备与无线连接页面](docs/images/scrcpy-gui-v2-devices.png)

设置被拆分为常规、视频、控制、录制、窗口和高级六个聚焦分类，不再把全部选项堆在一张长表单里。

<details>
<summary>查看设置页面</summary>

![Scrcpy GUI 设置页面](docs/images/scrcpy-gui-v2-settings.png)

</details>

## scrcpy 是什么？

scrcpy 是 Genymobile 维护的高性能轻量工具。它可以通过 USB 或 TCP/IP 显示并控制 Android 设备，不需要 Root，也不会在手机中留下安装应用。Scrcpy GUI 仍是独立前端；为简化安装，发布包会内置未经修改且完成校验的官方 scrcpy 包，并遵循 scrcpy 自身许可证。

## 功能亮点

- 继承 scrcpy 的原生性能、画质、音频、键鼠控制、剪贴板、拖放传输和录制能力
- 自动发现 USB 设备，清晰显示未授权、离线等真实状态
- 发布包内置经过校验的官方 scrcpy 4.1 与 adb，无需配置 PATH
- 支持 Android 11+ 的 `adb pair` 无线配对，也支持传统 TCP/IP 直连
- 同时启动多台设备，并防止同一设备被重复打开
- 支持命名配置、每设备独立设置与别名、保存无线地址以及按需自动启动
- 支持鼠标控制 Android 按键、电脑端截图、触摸显示开关和 ADB 动作录制回放
- 可配置视频码率、尺寸、帧率、方向、编码器、裁剪和窗口布局
- 支持音频、控制、保持唤醒、关闭手机屏幕、显示触摸、全屏、无边框和窗口置顶
- 支持 SDK、UHID、AOA 键盘模式以及可配置的 scrcpy 快捷键修饰键
- 等到 scrcpy 真正启动后才报告成功，失败时直接保留 stderr 日志
- 可关闭弹窗通知、最小化到系统托盘
- 自动识别系统语言，支持英文、简体中文、繁体中文和俄语
- Electron Renderer 沙箱、context isolation、受限 IPC，不通过 shell 拼接并执行参数
- Windows、macOS、Linux 自动验证与发布构建

## 2.0 与 1.5 的区别

2.0 替换了 2018 年的 Electron/Vue 技术栈和 scrcpy 1.x 参数体系，重新实现了界面、当前 scrcpy 参数、进程状态管理、Android 11+ 配对、多设备可靠性、问题日志、安全边界、自动测试和跨平台发布。旧版的部分参数含义已经变化，因此 1.x 配置不会被自动导入。

## 使用要求

1. Android 5.0（API 21）或更高版本；音频转发还需满足 scrcpy 对 Android 版本的要求。
2. 在手机的「开发者选项」中开启「USB 调试」。部分厂商还要求开启额外的安全/键鼠控制选项。
3. 官方 Scrcpy GUI 发布包已经内置经 SHA-256 校验的 scrcpy 4.1 与 `adb`；也可以手动选择其他兼容的 scrcpy 4.x 可执行文件。

发布包无需配置 `PATH` 即可使用。如果手动选择其他 `scrcpy`，Scrcpy GUI 还会在该程序同目录、系统 `PATH`、常见 Homebrew 目录以及标准 Android SDK 目录中查找 `adb`。

## 安装

从 [GitHub Releases](https://github.com/SimonAKing/scrcpy-gui/releases) 下载对应平台的软件包：

- **Windows：**x64 或 32 位 x86 安装程序（`.exe`）/ 免安装 `.zip`
- **macOS：**Intel 或 Apple 芯片版本的 `.dmg` / `.zip`
- **Linux：**`.AppImage`、Debian（`.deb`）、Arch（`.pacman`）或免安装 `.tar.gz`

当前正式版构建尚未进行代码签名或公证，操作系统可能会要求你确认信任该应用。打开前请使用 Release 中的 `SHA256SUMS.txt` 校验下载文件。

从 v2.4.1 起，Release 还会附带 SPDX SBOM 和 GitHub 构建来源证明。下载资产后，除核对 SHA-256 清单外，还可运行 `gh attestation verify PATH/TO/ASSET -R SimonAKing/scrcpy-gui` 验证其工作流来源。

本次实际执行的自动检查，以及尚未验证的硬件/安装矩阵，记录在 [v2.4.0 Release smoke 报告](docs/RELEASE_SMOKE_V2.4.0.md)中。

### 使用其他 scrcpy 安装

通常直接使用内置运行环境即可。如需覆盖，Windows 用户可从 [scrcpy releases](https://github.com/Genymobile/scrcpy/releases) 下载其他官方压缩包，解压后在 Scrcpy GUI 中选择 `scrcpy.exe`。

macOS 可通过 Homebrew 安装：

```bash
brew install scrcpy android-platform-tools
```

Linux 用户可使用发行版中的新版本软件包，或参考 scrcpy 官方 [Linux 文档](https://github.com/Genymobile/scrcpy/blob/master/doc/linux.md)。部分发行版的软件包更新较慢；Scrcpy GUI 2.0 要求 scrcpy 4.x。

## 使用方法

### 有线连接

1. 开启 USB 调试，用支持数据传输的 USB 线连接手机。
2. 在手机上允许当前电脑进行调试。
3. 等待设备卡片出现。如果显示「未授权」，说明手机仍在等待确认。
4. 选择一台或多台设备，点击「打开选中设备」。

### Android 11+ 无线调试

1. 确保电脑和手机处于同一网络。
2. 打开「开发者选项 → 无线调试」。
3. 在手机上选择「使用配对码配对设备」。
4. 将页面显示的配对地址（包含端口）和六位配对码输入 Scrcpy GUI，点击「配对」。
5. 再输入无线调试主页面显示的连接地址，点击「连接」。
6. 选择连接后的设备并启动投屏。

配对端口与连接端口通常不同。地址输入支持主机名、IPv4、带方括号的 IPv6，以及 1–65535 端口。

每个连接成功的地址都会被保存，可以为它改名；只有稳定且需要在启动时重试的地址才建议开启「启动时自动连接」。

### 传统无线连接

对于使用 ADB over TCP/IP 的旧设备，先在 USB 连接下开启设备的 TCP/IP 模式，再连接 `手机IP:5555`。不要把未经认证的 ADB 端口暴露到不可信网络或公网。

### 多设备投屏

可以同时选中多张已授权设备卡片并启动。每个 scrcpy 进程独立跟踪，一台失败不会把其他设备误报为成功，同一序列号也不会被意外重复启动。

可以把当前「设置」保存为命名启动配置，再为每张设备卡片指定不同配置。设备别名按序列号保存；配置没有填写窗口标题时，别名会自动成为 scrcpy 窗口标题。「连接后自动启动」需在每台设备上单独开启，并且有防重复启动保护。

### 设备控制与自动化

在控制面板选择目标设备后，可以直接点击返回、主页、最近任务、菜单、音量、电源、屏幕开关、旋转和触摸显示，无需记忆 scrcpy 快捷键。「截图」通过 `adb exec-out screencap` 获取画面，并在保存到电脑前校验 PNG。

点击「录制动作」后操作控制按钮，停止并保存即可得到动作序列。「自动化」页面还可以编排归一化点击/滑动、非敏感文本、启动应用、截图、等待、控制和设备状态断言。导入的自动化必须先按未信任内容逐项预览；任意 shell 和需要持久化的敏感文本都会被拒绝。

可以把选中的设备保存为带默认启动配置和并发上限的设备组。批量启动、控制、截图、推送文件、安装 APK、启动应用或运行自动化之前，预检表会逐台展示在线/授权状态、能力、会话冲突、目标几何信息和预计动作。未通过项不会从结果中消失，部分成功不会被误报为整体成功；输入、覆盖文件和 APK 降级还需要额外确认。活动自动化支持取消，逐设备运行报告会进入「产物」页。

### 录制

在「设置」中开启录制，选择 `.mp4` 或 `.mkv` 文件，再启动设备。开启「不播放」后可仅录制、不显示投屏窗口。

### 附加参数

每行填写一个完整的 scrcpy 参数。Scrcpy GUI 会把每一行作为单独参数直接传给进程，不经过 shell。`-s` 与 `--serial` 会被拒绝，因为设备序列号应由已选择的设备卡片管理。

### Boss 键与 ADB 退出行为

可选的全局 Boss 键会立即关闭全部投屏并隐藏 Scrcpy GUI，可通过托盘图标恢复主界面；默认快捷键为 `Ctrl/Cmd+Shift+B`，支持修改。如果只有本 GUI 使用 ADB，也可以开启「退出时停止共享的 ADB 服务」；Android Studio 或其他工具共用 ADB 时应保持关闭。

## scrcpy 快捷键

快捷键修饰键由 scrcpy 管理，平台之间可能不同。除非确实需要修改，否则建议保留「系统默认」。常用快捷键包括：

| 操作 | 快捷键 |
| --- | --- |
| 切换全屏 | `MOD` + `f` |
| 调整为像素一致大小 | `MOD` + `g` |
| 调整窗口以适应设备画面 | `MOD` + `w` |
| Home / 返回 / 最近任务 | `MOD` + `h` / `b` / `s` |
| 音量增加 / 减少 | `MOD` + `↑` / `↓` |
| 电源键 | `MOD` + `p` |
| 关闭 / 点亮设备屏幕 | `MOD` + `o` / `Shift` + `o` |
| 旋转设备 | `MOD` + `r` |
| 复制 / 剪切 / 粘贴 | `MOD` + `c` / `x` / `v` |
| 显示或隐藏 FPS | `MOD` + `i` |

完整列表请查看当前 [scrcpy 控制文档](https://github.com/Genymobile/scrcpy/blob/master/doc/control.md)。文件拖放、APK 安装、剪贴板同步和这些快捷键都由启动后的 scrcpy 窗口提供。

## 常见问题排查

- **没有发现设备：**执行 `adb devices -l`，解锁手机并接受电脑授权。
- **找不到 scrcpy：**在「运行环境」中选择准确的可执行文件，或将它加入 `PATH`。
- **投屏窗口立即退出：**打开「日志」页查看 scrcpy stderr，这里会保留进程的真实失败原因。
- **键盘快捷键失效：**将修饰键恢复为「系统默认」，并检查 scrcpy 当前快捷键表。
- **厂商系统拒绝鼠标控制：**开启该厂商额外的 USB 调试/安全控制选项。
- **画面绿屏、黑屏或模糊：**先用相同命令直接运行 scrcpy 复现；编解码与渲染故障发生在设备、驱动或 scrcpy 层，GUI 的日志会提供准确命令和错误用于定位。
- **裁剪或窗口尺寸被拒绝：**宽度和高度必须同时为 0，或者同时大于 0。

更多诊断与已知边界请查看 [GitHub Issues](https://github.com/SimonAKing/scrcpy-gui/issues)。

## 本地开发

推荐 Node.js 22 或更高版本：

```bash
npm ci
npm test
npm run dev
```

生产检查与打包：

```bash
npm run typecheck
npm run build
npm run build:dir
```

项目使用 Electron、Vue 3、TypeScript、Vite 和 electron-builder。主进程集成位于 `src/main/`，沙箱 Renderer 位于 `src/renderer/`，共享 IPC 类型位于 `src/shared/`，纯参数与地址逻辑测试位于 `tests/`。

提交 PR 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。反馈 Bug 时请提供可复现步骤、平台与版本信息，以及「日志」页中相关内容。

后续产品方向、功能需求、技术架构、安全边界与实施里程碑详见[产品与技术功能规格](docs/PRODUCT_TECHNICAL_SPEC.zh_CN.md)。

## 社区与致谢

- 问题、Bug 与功能建议：[GitHub Issues](https://github.com/SimonAKing/scrcpy-gui/issues)
- 安全漏洞：请按 [SECURITY.md](SECURITY.md) 私下报告，不要提交公开 issue
- 俄语翻译最初由 [@dEN5-tech](https://github.com/dEN5-tech) 在 [#69](https://github.com/SimonAKing/scrcpy-gui/pull/69) 中贡献，并已迁移到 2.0 界面。
- 感谢 [Genymobile/scrcpy](https://github.com/Genymobile/scrcpy) 以及 Scrcpy GUI 的所有贡献者。

## 支持项目

如果 Scrcpy GUI 对你有帮助，欢迎 Star、提交可复现的问题、完善文档或贡献 PR。也可以通过 [PayPal](https://paypal.me/tomotoes) 支持原作者。

## 许可证

Scrcpy GUI 自 v2.4.1 起使用 [MIT License](LICENSE)。v2.4.0 及更早的已发布版本继续遵循其发布时附带的 GPL-3.0-only 许可。内置 scrcpy 仍是遵循其自身许可证的独立项目，详见[第三方声明](THIRD_PARTY_NOTICES.md)。
