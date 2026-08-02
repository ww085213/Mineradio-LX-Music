# Mineradio - LX Music / MR

## 最新版本：1.5.7.1

[下载 Windows 安装包](https://github.com/ww085213/Mineradio-LX-Music/releases/download/v1.5.7.1/Mineradio.Setup.1.5.7.1.exe) / [查看 v1.5.7.1 Release](https://github.com/ww085213/Mineradio-LX-Music/releases/tag/v1.5.7.1)

[下载 Mineradio 独立清理工具](https://github.com/ww085213/Mineradio-LX-Music/releases/download/v1.5.7.1/Mineradio.Cleanup.1.0.0.exe)（Windows 10/11，需要管理员确认）

支持 Windows 10/11 x64。安装向导可选择安装目录和是否创建桌面快捷方式；原版、旧版及其他二创版本可直接覆盖升级。安装程序只更新程序文件，会保留 `%APPDATA%\Mineradio` 中的歌单、设置和用户数据。升级前建议先退出正在运行的 Mineradio。

1.5.7.1 主要更新：

- 修复 Spotify（小绿）公开歌单导入：支持完整分页、去重、系统代理及本地缓存；成功导入一次后，临时无法访问 Spotify 时仍可从缓存恢复歌单。
- 桌面融合改为稳定的 WorkerW 双状态切换：锁定后完整 Mineradio 固定在桌面，真实桌面图标保持可见、可点击；再次按可配置全局快捷键即可恢复播放器操作。
- 修复与 Wallpaper Engine 同时运行时的覆盖、图标消失、鼠标失效和频闪问题，不再复制桌面图标，也不会在锁定态隐藏 Mineradio 画面。
- 修复低性能电脑或慢速网络环境下启动恢复误清空配置的问题，保留歌单、壁纸、播放设置、界面设置和用户音源。
- 延续 1.5.7 的音效实验室、歌手专辑、实时频谱、桌面歌词、音乐星球、局域网遥控和可视化升级。
- 安装包继续支持从原版、旧版及其他二创版本安全覆盖升级，并校验二维码、FFmpeg、RePKG、平台导入及关键桌面运行时。
- 提供独立图形化清理工具：可以只移除程序并保留音源/歌单，也可以彻底清除用户数据，让下次安装进入首次安装状态。

[查看 Mineradio 1.5.7.1 完整更新说明](RELEASE_NOTES_1.5.7.1.md)

安装包 SHA-256：`451eb3e1dc0c76c480778f43b0d54781a21d6491c05498d4e8290b56ffd1b4d5`

> 当前 Windows 安装包未使用 Authenticode 代码签名证书，Windows SmartScreen 可能提示“未知发布者”。请只从本仓库 Release 下载，并核对上方 SHA-256。

## 彻底卸载或重新体验首次安装

下载并运行 `Mineradio.Cleanup.1.0.0.exe`。工具会先扫描已验证的 Mineradio 安装目录，再让你选择清理范围：

- 默认模式删除程序、快捷方式和安装注册信息，但保留音源、歌单与设置。
- 勾选“彻底清除用户数据”后，会删除 `%APPDATA%\Mineradio`、`%LOCALAPPDATA%\Mineradio` 和旧版持久启动脚本；重新安装时即为首次安装状态。
- 工具不会删除 LX Music 自己的数据，也不会删除 `Mineradio.Setup.*.exe`；若安装包位于清理目录内，会先移到“下载\Mineradio Installers”。

清理工具 SHA-256：`0a9a91be67fda026f33c9e005e0f756bb379e8c11c1e172ddc8d82e8b1927072`

Mineradio 是一款 Windows 桌面音乐播放器、歌单工具和音乐可视化应用。它可以独立播放本地音乐，也支持导入歌单、显示歌词、桌面歌词、壁纸和可视化效果。

Mineradio 不内置音乐音源，不分发受版权保护的音频、歌词、封面或壁纸内容。涉及第三方平台、兼容音源脚本或用户本地文件时，请只导入和播放你有权使用的内容，并遵守相应服务条款。

## 作者支持

如果这个二创版本给你带来了更好的体验，欢迎自愿支持后续维护与稳定性改进。

[查看完整支持页](docs/SUPPORT.md)

![Mineradio 作者支持渠道](docs/assets/support/mineradio-author-support-poster.png)

> 支持完全自愿，不提供功能解锁、专属资源、优先服务等权益，也不构成付费服务合同。

## 主要功能

- 本地音乐：导入本地文件和文件夹，管理音乐库、播放队列、自定义歌单和文件夹歌单。
- 音乐首页：继续播放、每日推荐、最近播放、聆听统计、接下来播放、音乐星球地图和局域网多设备遥控。
- 歌手与专辑：在线匹配歌手，浏览专辑及曲目，整张播放或收藏。
- 音乐电台：29 种私人漫游、场景、风格和能量模式，可收藏并置顶常用电台。
- 平台榜单与歌单导入：综合及多平台榜单、LX 歌单文件和多平台分享链接导入。
- 音源管理：导入本地 LX 兼容音源脚本、链接导入、批量文件导入和音源切换。
- 歌词：本地及在线歌词、翻译歌词、歌词偏移、多种窗口内动画，以及可调左右/高度/大小/透明度的桌面歌词。
- 音效：均衡器、自定义声场、空间音频、人声/伴奏分离、智能母带、智能 DJ、前级增益和输出设备选择。
- 可视化：底部实时频谱及高度调节、粒子可视化、3D 歌词舞台、自定义壁纸、视频背景和 Wallpaper Engine 壁纸读取。
- 桌面体验：托盘和媒体控制、沉浸模式、桌面融合播放、可拖动歌单栏、迷你队列，以及可选主页透明交互。
- 录制与预览：60 FPS H.264 场景录制、GIF 预览和 Wallpaper Engine 资源转换。
- 更新：从 GitHub Release 检查后续版本并下载更新。

## 安装包包含的内容

正式 Windows 安装包包含运行完整功能所需的：

- Electron 主程序、页面、桌面歌词和全部前端资源
- 音效、歌手专辑、实时频谱、音乐星球、局域网遥控代码与二维码运行时依赖
- FFmpeg 8.1.1、RePKG v0.4.0-alpha 及第三方许可说明
- 安全覆盖升级、路径校验和卸载保护逻辑

不包含 LX Music 程序本体、内置音乐音源、平台账号登录能力，或任何歌曲、歌词、封面、壁纸等版权内容。

## 开发运行

```bash
npm install
npm start
```

## 打包

```bash
npm run build:win
npm run build:cleanup
```

`build:win` 会下载并校验固定版本的 FFmpeg 与 RePKG，运行发布校验，然后生成：

- `dist/Mineradio.Setup.1.5.7.1.exe`
- `dist/Mineradio.Setup.1.5.7.1.exe.blockmap`
- `dist/latest.yml`
- `dist/Mineradio.Setup.1.5.7.1.SHA256.txt`
- `dist/cleanup/Mineradio.Cleanup.1.0.0.exe`
- `dist/cleanup/Mineradio.Cleanup.1.0.0.SHA256.txt`

macOS DMG 需在 macOS 环境执行 `npm run build:mac`。

## 原项目、授权与使用声明

- 本项目基于 [XxHuberrr/Mineradio](https://github.com/XxHuberrr/Mineradio) 修改维护，是非官方二创版本。
- 本修改版继续按照 **GPL-3.0-only** 发布；公开源码应与 Release 安装包保持对应。
- 本项目不代表原作者、网易云音乐、QQ 音乐、腾讯音乐娱乐集团或其他第三方平台的官方版本。
- 用户应确保对自行导入的本地文件、音源脚本和第三方链接拥有合法使用权限，并遵守相关平台条款。
- 禁止将本项目用于盗版音乐、违规抓取、绕过平台限制、传播侵权内容或其他违法违规用途。

默认发布仓库为 `ww085213/Mineradio-LX-Music`，更新检查配置位于 `package.json` 的 `mineradio.update` 字段。

## License

本项目采用 [GNU General Public License v3.0](LICENSE)（GPL-3.0-only）发布。
