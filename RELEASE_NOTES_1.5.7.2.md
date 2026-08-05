# Mineradio 1.5.7.2

## 新功能

- 歌单详情新增“导出 .lxmc”，使用 LX Music 兼容的 Gzip `playListPart_v2` 格式。
- 导出文件可由 LX Music 和 Mineradio 重新导入。

## 修复与优化

- 修复右侧 3D 歌曲卡片部分封面不显示，增加地址规范化、代理/直连回退、重试、占位图和缺图自动补全。
- 缩短在线歌曲播放启动时间，增加解析缓存、下一曲预取、有界超时和失败切换。
- 歌词请求不再阻塞音频启动完成。

## 发布安全

- 正式安装包不包含 `Mineradio-Network-Split-Switch.ps1` 和 `Mineradio网络分流开关.cmd`。
- 不包含发布者的个人状态、用户歌单、自定义音源或启动日志。
- 安装器流程与 1.5.7.1 保持一致，支持选择安装目录和覆盖更新，用户数据仍保存在 `%APPDATA%\Mineradio`。

## Windows 发布文件

- `Mineradio.Setup.1.5.7.2.exe`
- `Mineradio.Setup.1.5.7.2.exe.blockmap`
- `latest.yml`
- `Mineradio.Setup.1.5.7.2.SHA256.txt`

> 本版与 1.5.7.1 一样未使用 Authenticode 商业证书签名，Windows SmartScreen 仍可能在首次运行时显示提示。
