# Mineradio 1.5.4.2 发布流程

## 发布前检查

- `package.json` 和 `package-lock.json` 使用兼容 SemVer `1.5.4`；`mineradio.releaseVersion`、`build.buildVersion`、安装包文件名和 Release 标签使用 `1.5.4.2`。
- 前端内联脚本以及 `desktop/*.js`、`server.js` 语法检查通过。
- 软件界面动画关闭后，重启可直接跳过启动动画。
- 新声境预设在未开启歌词拖拽时支持舞台旋转、缩放和右侧 3D 歌单滚动。
- 软件内更新后的 HTML、JavaScript、CSS 和 JSON 不复用旧缓存。

## Windows 构建

```bash
npm install
npm run build:win
```

构建产物：

- `dist/Mineradio.Setup.1.5.4.2.exe`
- `dist/Mineradio.Setup.1.5.4.2.exe.blockmap`
- `dist/latest.yml`
- `dist/Mineradio.Setup.1.5.4.2.SHA256.txt`

## GitHub Release

- 标签：`v1.5.4.2`
- 标题：`Mineradio 1.5.4.2`
- 上传 Windows 安装包、blockmap、`latest.yml` 和 SHA256 文件。
- 发布后将安装包同步到百度网盘分享目录。
