# Mineradio 1.5.6.1 发布流程

## 发布前检查

- npm 包版本保持有效 SemVer `1.5.6`；应用显示版本、安装包文件名和 Release 标签使用 `1.5.6.1`，Windows 文件版本使用 `1.5.6.1`。
- `npm run verify:release` 检查前端全部内联脚本、主进程、服务端、安装迁移标记、壁纸转换工具和核心功能标记。
- 全新首页、音乐库、音乐电台和各平台排行榜入口及主要操作可用。
- 全新用户安装内容与当前正式程序一致，不预装或自动生成第三方音源。
- 安装向导允许选择是否创建桌面快捷方式，应用不会在用户删除后自动重建快捷方式。
- 全新安装和旧版覆盖安装都必须复测；覆盖安装前后 `%APPDATA%\Mineradio` 中的歌单和用户数据指纹一致。
- 旧版 `Uninstall\Mineradio` 和新版 GUID 卸载项都能正确恢复安装目录，不允许把 `C:\Mineradio` 错取父目录为 `C:\`。
- `win-unpacked/resources/app/bin` 必须同时包含 FFmpeg、RePKG 和第三方许可说明。
- 安装程序、主程序、卸载程序和快捷方式使用同一套 MR 图标。
- 安装包未进行 Authenticode 代码签名；发布说明必须提醒 SmartScreen 提示并提供 SHA-256 校验值。

## Windows 构建

```bash
npm install
npm run build:win
```

构建命令会自动执行 `prepare:windows-tools`，下载并校验固定版本的 FFmpeg/RePKG；禁止使用未通过脚本内 SHA-256 校验的第三方二进制。安装包内必须同时包含根目录 `LICENSE` 和 `bin/FFMPEG-NOTICE.txt`。

构建产物：

- `dist/Mineradio.Setup.1.5.6.1.exe`
- `dist/Mineradio.Setup.1.5.6.1.exe.blockmap`
- `dist/latest.yml`
- `dist/Mineradio.Setup.1.5.6.1.SHA256.txt`

## GitHub Release

- 标签：`v1.5.6.1`
- 标题：`Mineradio 1.5.6.1`
- 正式 Release 同时上传 Windows 安装包、SHA256 文件、blockmap 与 `latest.yml`，确保手动下载、完整性校验和后续自动更新链路使用同一套产物。
- 发布后将安装包同步到百度网盘分享目录。
