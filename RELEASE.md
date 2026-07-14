# Mineradio 1.5.5 发布流程

## 发布前检查

- `package.json`、`package-lock.json`、`mineradio.releaseVersion`、`build.buildVersion`、安装包文件名和 Release 标签统一使用 `1.5.5`。
- 前端内联脚本以及 `desktop/*.js`、`server.js` 语法检查通过。
- 输出设备能列出 Windows 当前可用的真实设备名称。
- 桌面融合交互模式保留任务栏入口，退出后恢复原窗口尺寸。
- 录制输出为 60 FPS H.264，FFmpeg 与 RePKG 随包可用。
- 安装向导包含欢迎、目录选择、安装和完成页面。
- 安装包未进行 Authenticode 代码签名；发布说明必须提醒 SmartScreen 提示并提供 SHA-256 校验值。

## Windows 构建

```bash
npm install
npm run build:win
```

构建产物：

- `dist/Mineradio.Setup.1.5.5.exe`
- `dist/Mineradio.Setup.1.5.5.exe.blockmap`
- `dist/latest.yml`
- `dist/Mineradio.Setup.1.5.5.SHA256.txt`

## GitHub Release

- 标签：`v1.5.5`
- 标题：`Mineradio 1.5.5`
- 上传 Windows 安装包、blockmap、`latest.yml` 和 SHA256 文件。
- 发布后将安装包同步到百度网盘分享目录。
