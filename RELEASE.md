# Mineradio 1.5.6.2 发布流程

## 发布前检查

- npm 包版本保持有效 SemVer `1.5.6`；应用显示版本、安装包文件名和 Release 标签使用 `1.5.6.2`。
- `npm run verify:release` 通过，主进程、preload 和页面脚本可以解析。
- 从原版、旧版和其他二创版本覆盖安装后均能进入首页，不会卡在启动页。
- 覆盖安装保留 `%APPDATA%\Mineradio` 中的歌单、设置和用户数据。
- 本地歌单删除不会删除硬盘音乐文件，也不会清空当前播放队列。
- 安装包包含 FFmpeg、RePKG 与第三方许可说明。
- 安装程序、主程序、卸载程序和快捷方式使用同一套 MR 图标。
- 安装包未进行 Authenticode 代码签名；Release 必须提供 SHA-256 校验文件并提醒 SmartScreen 可能显示“未知发布者”。

## Windows 构建

```bash
npm install
npm run build:win
```

构建产物：

- `dist/Mineradio.Setup.1.5.6.2.exe`
- `dist/Mineradio.Setup.1.5.6.2.exe.blockmap`
- `dist/latest.yml`
- `dist/Mineradio.Setup.1.5.6.2.SHA256.txt`

## GitHub Release

- 标签：`v1.5.6.2`
- 标题：`Mineradio 1.5.6.2`
- 上传完整安装包、blockmap、资源补丁、资源覆盖包和 `SHA256SUMS.txt`。
- 发布后核对 README 下载链接、Release 资产列表和安装包 SHA-256。
