# Mineradio 1.6.0 发布流程

## 新版功能确认

- AI Agent“小M”可以通过自然语言调用播放器、队列、歌单、音质、歌词动画、界面与 DIY 视觉工具。
- 小M支持多家云端模型、本地 Ollama、自定义 OpenAI 兼容接口、热键和可用环境下的语音输入。
- 覆盖升级时安装器会先关闭运行中的 Mineradio，避免主程序文件被占用。

## 发布前检查

- npm 包版本、Windows 构建版本、应用发布版本、安装包名、更新清单与 Git 标签统一使用 `1.6.0`。
- 本次安装包以本机 `D:\Mineradio` 的完整安装内容为基准，包含上述 1.6.0 改动。
- `appId` 保持 `com.mineradio.desktop`，安装器沿用注册表目录识别、专属目录标记与覆盖升级逻辑。
- 覆盖安装保留 `%APPDATA%\Mineradio` 用户数据。
- 已完成真实安装、启动和卸载测试；小M、世界和平彩蛋、FFmpeg 与关键运行文件均进入安装内容。
- 安装后的 Electron 主进程与子进程成功启动并保持响应。
- 未使用 Authenticode 商业代码签名；Release 必须提供 SHA-256 校验文件并提示 SmartScreen 风险。

## Windows 发布文件

- `Mineradio.Setup.1.6.0.exe`
- `Mineradio.Setup.1.6.0.exe.blockmap`
- `latest.yml`
- `Mineradio.Setup.1.6.0.SHA256.txt`

## GitHub Release

- 标签：`v1.6.0`
- 标题：`Mineradio 1.6.0`
- 上传安装包、blockmap、`latest.yml` 与 SHA-256 校验文件。
- 发布后核对 Release 资源列表、安装包哈希和在线更新清单。
