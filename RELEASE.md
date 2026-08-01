# Mineradio 1.5.7.1 发布流程

## 发布前检查

- npm 包版本保持 `1.5.7`，Windows 构建版本、应用显示版本、安装包名、更新清单与 Git 标签均为 `1.5.7.1`。
- `npm run verify:release` 通过，主进程、preload、代理服务及页面内联脚本均可解析。
- 音效、歌手专辑、实时频谱高度、主页透明模式、桌面歌词左右调节、音乐星球和局域网遥控均进入打包资源。
- 桌面融合锁定态使用 WorkerW 且不复制 Explorer 图标；Wallpaper Engine 同时运行时 Mineradio 画面、真实桌面图标和鼠标路由均正常。
- Spotify 公开歌单在线完整导入、分页去重、系统代理和离线缓存回退均通过验证。
- 从原版、旧版及其他二创版本覆盖安装后可进入首页，并保留 `%APPDATA%\Mineradio` 用户数据。
- 安装/卸载路径经过专属目录与标记校验，不会误删非 Mineradio 目录。
- 安装包包含 FFmpeg、RePKG 和相应第三方许可说明。
- 安装包内的 `qrcode` 运行时依赖可直接加载并生成二维码；全新用户数据目录启动后主页面和局域网遥控接口均返回 HTTP 200。
- 干净环境启动不会生成 `startup-crash.log`。
- 未使用 Authenticode 代码签名；Release 必须提供 SHA-256 校验文件并提示 SmartScreen 风险。

## Windows 构建

```bash
npm install
npm run build:win
```

构建产物：

- `dist/Mineradio.Setup.1.5.7.1.exe`
- `dist/Mineradio.Setup.1.5.7.1.exe.blockmap`
- `dist/latest.yml`
- `dist/Mineradio.Setup.1.5.7.1.SHA256.txt`

## GitHub Release

- 标签：`v1.5.7.1`
- 标题：`Mineradio 1.5.7.1`
- 上传安装包、blockmap、`latest.yml` 与 SHA-256 校验文件。
- 发布后核对 README 下载链接、Release 资源列表、安装包哈希和在线更新清单。
