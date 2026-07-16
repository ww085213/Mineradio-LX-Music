# Mineradio 1.5.5.1 发布流程

## 发布前检查

- `package.json` 中的 `mineradio.releaseVersion`、`build.buildVersion`、安装包文件名和 Release 标签统一使用 `1.5.5.1`；npm 包版本继续使用兼容 SemVer 的 `1.5.5`。
- 前端内联脚本以及 `desktop/*.js`、`server.js` 语法检查通过。
- 全新首页、音乐库、音乐电台和各平台排行榜入口及主要操作可用。
- 全新用户安装内容与当前正式程序一致，不预装或自动生成第三方音源。
- 安装向导允许选择是否创建桌面快捷方式，应用不会在用户删除后自动重建快捷方式。
- 覆盖安装前后 `%APPDATA%\Mineradio` 中的歌单和用户数据指纹一致。
- 安装程序、主程序、卸载程序和快捷方式使用同一套 MR 图标。
- 安装包未进行 Authenticode 代码签名；发布说明必须提醒 SmartScreen 提示并提供 SHA-256 校验值。

## Windows 构建

```bash
npm install
npm run build:win
```

构建产物：

- `dist/Mineradio.Setup.1.5.5.1.exe`
- `dist/Mineradio.Setup.1.5.5.1.exe.blockmap`
- `dist/latest.yml`
- `dist/Mineradio.Setup.1.5.5.1.SHA256.txt`

## GitHub Release

- 标签：`v1.5.5.1`
- 标题：`Mineradio 1.5.5.1`
- 当前正式 Release 上传 Windows 安装包和 SHA256 文件；使用 electron-builder 自动更新产物时再同时上传 blockmap 与 `latest.yml`。
- 发布后将安装包同步到百度网盘分享目录。
