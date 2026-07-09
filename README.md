# Mineradio - LX Music / MR

Mineradio 是一个 Windows 桌面音乐播放器、歌单工具和音乐可视化应用。它可以独立播放本地音乐，也支持导入歌单、显示歌词、桌面歌词、壁纸和可视化效果。

Mineradio 不内置音乐音源，不分发受版权保护的音频、歌词、封面或壁纸内容。涉及第三方平台、兼容音源脚本或用户本地文件时，请只导入和播放你有权使用的内容，并遵守相应服务条款。

## 版权与使用声明

- 本项目为二创维护版本，非官方项目。
- Mineradio 不内置、不上传、不分发任何音乐音源、音频、歌词、封面、壁纸或其他受版权保护内容。
- 本项目仅提供本地音乐播放、歌单管理、歌词显示、可视化和用户自有内容导入等工具能力。
- 用户自行导入的本地文件、音源脚本、第三方链接或其他内容，应确保拥有合法使用权限，并自行遵守相关平台服务条款。
- 禁止将本项目用于盗版音乐、违规抓取、绕过平台限制、传播侵权内容或其他违法违规用途。
- 因用户自行导入、配置、分享或违规使用第三方内容产生的版权争议、账号风险、法律责任，由使用者自行承担。

## 当前版本

### Mineradio 1.5.4

[下载 1.5.4 安装包](https://github.com/ww085213/Mineradio-LX-Music/releases/download/v1.5.4/Mineradio.Setup.1.5.4.exe) / [查看 1.5.4 Release](https://github.com/ww085213/Mineradio-LX-Music/releases/tag/v1.5.4)

国内下载较慢时，可以优先尝试下面的镜像入口：

| 下载方式 | 链接 | 说明 |
| --- | --- | --- |
| 镜像下载 1 | [点击下载](https://gh.llkk.cc/https://github.com/ww085213/Mineradio-LX-Music/releases/download/v1.5.4/Mineradio.Setup.1.5.4.exe) | 国内用户推荐 |
| 镜像下载 2 | [备用镜像](https://ghfast.top/https://github.com/ww085213/Mineradio-LX-Music/releases/download/v1.5.4/Mineradio.Setup.1.5.4.exe) | 镜像 1 慢时使用 |
| 镜像下载 3 | [备用镜像](https://gh-proxy.com/https://github.com/ww085213/Mineradio-LX-Music/releases/download/v1.5.4/Mineradio.Setup.1.5.4.exe) | 公益加速服务 |
| GitHub Release | [官方下载](https://github.com/ww085213/Mineradio-LX-Music/releases/download/v1.5.4/Mineradio.Setup.1.5.4.exe) | 官方备用地址 |

已安装 `1.5.3 补充版` 的用户，可以在软件内使用「检查更新」直接下载并安装 `1.5.4`。

## 1.5.4 更新内容

- 桌面融合播放升级：播放器、歌词和播放控制可以更完整地融入桌面壁纸环境，桌面模式下也能直接操控播放。
- 修复关闭后播放状态丢失：退出或关闭到托盘前会保存当前歌曲、播放进度和播放状态，下次打开优先恢复上次播放。
- 优化本地歌曲加载速度：切歌时优先开始播放，封面、歌词、元数据和兼容性检查改为后台补齐，减少点歌后的等待。
- 优化启动流畅性：恢复本地音乐库时不再一次性处理整个曲库缓存，大型文件夹会分批后台处理，降低打开软件时的卡顿。
- Wallpaper Engine 导入增强：优先选择高清真实媒体资源，避免误用模糊预览图。
- 动态壁纸兼容转换：WebM、MOV、M4V、GIF 等动态壁纸会通过 FFmpeg 转为清晰 MP4 缓存，改善非 MP4 壁纸模糊、尺寸不对和播放兼容问题。
- 桌面壁纸铺满修复：桌面融合窗口会按多屏桌面边界铺满，减少边缘露底和尺寸错位。
- 降低桌面粒子和歌词渲染负载，减少开启桌面融合后卡顿。
## 作者支持

如果我的二创给大家带来好的体验，大家的支持就是我继续长期更新下去的动力。感谢大家的理解与支持。

[查看完整支持页](docs/SUPPORT.md)

![Mineradio 作者支持渠道](docs/assets/support/mineradio-author-support-poster.png)

> 支持完全自愿，用于软件维护、版本更新和稳定性改进；不提供功能解锁、专属资源、优先服务等权益，也不构成付费服务合同。
> 扫码前请确认收款人显示为「旸」。

## 主要功能

- 本地音乐播放：支持导入本地文件和文件夹，管理本地音乐库和播放队列。
- 本地歌单：支持自定义歌单、文件夹歌单和主页歌单卡片浏览。
- 跨平台歌单导入：支持 LX 歌单文件和多个平台分享链接导入。
- 音源管理：支持导入本地落雪兼容音源脚本、链接导入、批量文件导入和音源切换。
- 歌词：支持本地歌词、在线歌词匹配、翻译歌词、桌面歌词和歌词偏移调整。
- 可视化：支持粒子可视化、3D 歌词舞台、自定义壁纸、视频背景和 Wallpaper Engine 壁纸读取。
- 桌面体验：支持托盘控制、媒体控制信息、沉浸模式、桌面融合播放和迷你队列。
- 更新：支持从 GitHub Release 检查后续版本并下载更新。

## 不包含的内容

Mineradio 不包含：

- LX Music 程序本体
- 内置音乐音源
- 歌曲、专辑、封面、歌词或其他版权内容
- 网易云音乐账号登录
- QQ 音乐账号登录
- 官方平台收藏同步
- 官方平台会员能力

## 开发运行

```bash
npm install
npm start
```

## 打包

```bash
npm run build:win
```

构建产物输出到 `dist/`：

- `Mineradio.Setup.1.5.4.exe`
- `Mineradio.Setup.1.5.4.exe.blockmap`
- `latest.yml`

macOS DMG 需要在 macOS 环境构建：

```bash
npm run build:mac
```

## 发布仓库

默认发布仓库为 `ww085213/Mineradio-LX-Music`。更新检查配置位于 `package.json` 的 `mineradio.update` 字段。

## License

MIT
