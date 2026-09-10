# Mineradio 1.6.1 发布流程

## 新版功能确认

- 歌单广场、公开歌单搜索和二级歌单详情已完成五平台验证。
- 排行榜只使用平台原榜，并完成全部 19 个榜单分类的联网抽样验证。
- 自动同步、完整备份、队列撤销和列表整理功能已进入发布源码。

## 发布前检查

- npm 包版本、Windows 构建版本、应用发布版本、安装包名、更新清单与 Git 标签统一使用 `1.6.1`。
- 本次安装包使用源码仓库中已从本机 `D:\Mineradio` 同步并验证的 1.6.1 文件。
- `appId` 保持 `com.mineradio.desktop`，安装器沿用注册表目录识别、专属目录标记与覆盖升级逻辑。
- 覆盖安装保留 `%APPDATA%\Mineradio` 用户数据。
- 已完成真实安装、启动和卸载测试；小M、世界和平彩蛋、FFmpeg 与关键运行文件均进入安装内容。
- 安装后的 Electron 主进程与子进程成功启动并保持响应。
- 未使用 Authenticode 商业代码签名；Release 必须提供 SHA-256 校验文件并提示 SmartScreen 风险。

## Windows 发布文件

- `Mineradio.Setup.1.6.1.exe`
- `Mineradio.Setup.1.6.1.exe.blockmap`
- `latest.yml`
- `Mineradio.Setup.1.6.1.SHA256.txt`

## GitHub Release

- 标签：`v1.6.1`
- 标题：`Mineradio 1.6.1`
- 上传安装包、blockmap、`latest.yml` 与 SHA-256 校验文件。
- 发布后核对 Release 资源列表、安装包哈希和在线更新清单。
