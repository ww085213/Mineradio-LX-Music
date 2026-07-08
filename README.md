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

### Mineradio 1.5.3 补充版

[下载 1.5.3 补充版安装包](https://github.com/ww085213/Mineradio-LX-Music/releases/download/v1.5.3-supplement/Mineradio.Setup.1.5.3.exe) / [查看补充版 Release](https://github.com/ww085213/Mineradio-LX-Music/releases/tag/v1.5.3-supplement)

国内下载较慢时，可以优先尝试下面的镜像入口：

| 下载方式 | 链接 | 说明 |
| --- | --- | --- |
| 镜像下载 1 | [点击下载](https://gh-proxy.com/https://github.com/ww085213/Mineradio-LX-Music/releases/download/v1.5.3-supplement/Mineradio.Setup.1.5.3.exe) | 国内用户推荐 |
| 镜像下载 2 | [备用镜像](https://ghfast.top/https://github.com/ww085213/Mineradio-LX-Music/releases/download/v1.5.3-supplement/Mineradio.Setup.1.5.3.exe) | 镜像 1 慢时使用 |
| 镜像下载 3 | [备用镜像](https://ghproxy.net/https://github.com/ww085213/Mineradio-LX-Music/releases/download/v1.5.3-supplement/Mineradio.Setup.1.5.3.exe) | 公益加速服务 |
| GitHub Release | [官方下载](https://github.com/ww085213/Mineradio-LX-Music/releases/download/v1.5.3-supplement/Mineradio.Setup.1.5.3.exe) | 官方备用地址 |

补充版保持应用版本号为 `1.5.3`，在原 1.5.3 基础上加入音源一键批量导入入口，并保留后续软件内检查更新能力。安装补充版后，后面发布 `1.5.4` 或更高版本时，可以在软件内直接检查更新。

macOS DMG 包通过 GitHub Actions 的 macOS 构建流程生成；未签名/未公证的 macOS 包首次运行时可能需要在系统安全设置中手动允许。

> 注意：因为补充版仍是 `1.5.3`，已经安装普通 `1.5.3` 的用户不会通过“检查更新”发现它，需要手动下载补充版安装包安装。

## 作者支持

如果我的二创给大家带来好的体验，大家的支持就是我继续长期更新下去的动力。感谢大家的理解与支持。

[查看完整支持页](docs/SUPPORT.md)

![Mineradio 作者支持渠道](docs/assets/support/mineradio-author-support-poster.png)

> 支持完全自愿，用于软件维护、版本更新和稳定性改进；不提供功能解锁、专属资源、优先服务等权益，也不构成付费服务合同。
> 扫码前请确认收款人显示为“旺”。

### 原 1.5.3

[下载原 1.5.3 安装包](https://github.com/ww085213/Mineradio-LX-Music/releases/download/v1.5.3/Mineradio.Setup.1.5.3.exe) / [查看原 1.5.3 Release](https://github.com/ww085213/Mineradio-LX-Music/releases/tag/v1.5.3)

## 1.5.3 补充版更新

- 新增“音源一键导入”：一次选择多个本地落雪兼容音源 `.js` 文件，自动逐个验证并批量导入。
- 未配置播放音源时，点击音源状态会直接打开批量音源文件选择。
- 音源导入成功后会刷新当前音源状态，最后一个成功导入的音源会成为当前播放音源。
- 保留检查更新配置，后续发布更高版本时可在软件内更新。

## 主要功能

- 本地音乐播放：支持导入本地文件和文件夹，管理本地音乐库和播放队列。
- 本地歌单：支持自定义歌单、文件夹歌单和主页歌单卡片浏览。
- 跨平台歌单导入：支持 LX 歌单文件和多个平台分享链接导入。
- 音源管理：支持导入本地落雪兼容音源脚本、链接导入、批量文件导入和音源切换。
- 歌词：支持本地歌词、在线歌词匹配、翻译歌词、桌面歌词和歌词偏移调整。
- 可视化：支持粒子可视化、3D 歌词舞台、自定义壁纸、视频背景和 Wallpaper Engine 壁纸读取。
- 桌面体验：支持托盘控制、媒体控制信息、沉浸模式和迷你队列。
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

- `Mineradio.Setup.1.5.3.exe`
- `Mineradio.Setup.1.5.3.exe.blockmap`
- `latest.yml`

macOS DMG 需要在 macOS 环境构建：

```bash
npm run build:mac
```

## 发布仓库

默认发布仓库为 `ww085213/Mineradio-LX-Music`。更新检查配置位于 `package.json` 的 `mineradio.update` 字段。

## License

MIT

