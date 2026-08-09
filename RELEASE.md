# Mineradio 1.5.7.3 发布流程

## 新版功能确认

- 音源状态与音源管理入口位于页面右上角，可直接查看和切换当前音源。
- 右上角主页按钮支持收起与恢复，减少对主页内容的遮挡。
- 搜索结果提供“下一首播放”按钮，可把选中歌曲加入下一首而不打断当前播放。

## 发布前检查

- npm 包版本保持 `1.5.7`；Windows 构建版本、应用发布版本、安装包名、更新清单与 Git 标签使用 `1.5.7.3`。
- 本次安装包以本机 `D:\Mineradio` 的完整安装内容为基准，包含上述 1.5.7.3 改动。
- `appId` 保持 `com.mineradio.desktop`，安装器沿用注册表目录识别、专属目录标记与覆盖升级逻辑。
- 覆盖安装保留 `%APPDATA%\Mineradio` 用户数据。
- 已在本机现有 1.5.7.2 上完成真实覆盖安装，安装后的 2384 个 `resources/app` 文件与封装源逐文件 SHA-256 对比，差异为 0。
- 主进程、GPU、网络、渲染器和音频进程均成功启动并保持响应。
- 未使用 Authenticode 商业代码签名；Release 必须提供 SHA-256 校验文件并提示 SmartScreen 风险。

## Windows 发布文件

- `Mineradio.Setup.1.5.7.3.exe`
- `Mineradio.Setup.1.5.7.3.exe.blockmap`
- `latest.yml`
- `Mineradio.Setup.1.5.7.3.SHA256.txt`

## GitHub Release

- 标签：`v1.5.7.3`
- 标题：`Mineradio 1.5.7.3`
- 上传安装包、blockmap、`latest.yml` 与 SHA-256 校验文件。
- 发布后核对 Release 资源列表、安装包哈希和在线更新清单。
