# Mineradio - LX Music（落雪音乐）/ MR

Mineradio 是一个可独立运行的 Windows 桌面音乐播放器、歌单工具和音乐可视化应用。安装后即可导入本地音乐、管理本地歌单、显示歌词、使用桌面歌词、切换壁纸和视觉效果。

LX Music 歌单导入、本机联动和兼容音源能力属于可选扩展。Mineradio 不包含、不分发 LX Music，不内置音乐音源，也不提供或分发任何受版权保护的音频内容。用户应只导入、播放和展示自己有权使用的音乐、歌词、封面和壁纸。

## Mineradio 1.5.3

[下载 Windows 安装包](https://github.com/ww085213/Mineradio-LX-Music/releases/download/v1.5.3/Mineradio.Setup.1.5.3.exe) · [查看完整发布说明](https://github.com/ww085213/Mineradio-LX-Music/releases/tag/v1.5.3)

> Windows x64 版本，支持自选安装目录。安装包暂未使用商业代码签名，首次运行时 Windows 可能显示安全提醒。

## 1.5.3 主要更新

### 旧登录残留清理

- 清理旧登录、账号、二维码、会员、账号胶囊等二创前残留界面和空壳代码。
- 顶部不再显示旧账号登录入口。
- 保留本地导入、歌单导入同步、搜索、播放和更新检测等正常功能。

### 本地播放修复

- 修复部分 FLAC 文件无法播放的问题。
- 对异常音频增强解码回退，必要时会生成兼容播放缓存。
- 扩展本地导入格式，支持更多音频后缀。
- 验证本地文件夹导入、本地搜索和本地播放关键路径可用。

### 歌单导入与同步

- 修复网易歌单链接被误识别为专辑的问题。
- 增加已导入平台歌单同步能力。
- 验证小蜗、小枸、酷狗概念版、小菇歌单导入可用。
- 修复酷我、咪咕在当前分流 / VPN 环境下的导入和搜索连通问题。

### 安装和发布

- 安装包版本更新为 1.5.3。
- 安装包名为 `Mineradio.Setup.1.5.3.exe`。
- 使用 `com.mineradio.desktop`、`Mineradio` 和 `Mineradio.exe`，可覆盖当前 1.5.2 安装目录。

## 功能概览

### 本地播放

- 导入本地音乐文件夹并建立音乐库。
- 支持 MP3、FLAC、WAV、M4A、OGG 等常见格式。
- 支持本地播放队列。
- 支持本地自定义歌单。
- 支持本地封面读取。
- 支持同目录 `.lrc` / `.txt` 歌词读取。
- 支持自动尝试匹配在线歌词。
- 支持重复、顺序、随机等播放模式。

### 歌单

- 本地音乐库。
- 本地自定义歌单。
- 文件夹歌单。
- LX Music 歌单导入。
- 平台歌单链接导入。
- 主页歌单卡片浏览。
- 3D 歌单架浏览。
- 大歌单分批加载。
- 主页歌单顺序可自定义，左侧同步显示。

### LX Music 与可选联动

- 支持导入 LX Music `.lxmc` 歌单文件。
- 可读取用户本机 LX Music 开放 API 提供的歌单列表。
- 可调用用户本机 LX Music 播放当前歌曲。
- 可同步播放状态、封面、标题、歌手、时长和进度。
- 支持 LX Music 歌词同步和翻译歌词显示。
- 针对播放 URL 过期状态加入重发当前歌曲兜底。
- 该能力为可选功能，不影响 Mineradio 独立播放本地音乐。

### 歌词

- 局内歌词多行显示。
- 局内歌词竖排显示。
- 桌面歌词窗口。
- 桌面歌词点击穿透。
- 桌面歌词锁定 / 解锁。
- 桌面歌词行数、大小、透明度、高度、帧率、布局和对齐设置。
- 歌词翻译显示 / 隐藏。
- 歌词时间偏移调整。
- 歌词颜色、高亮、发光、节拍联动和粒子效果。

### 视觉与壁纸

- 播放态粒子可视化。
- 3D 歌词舞台。
- 3D 歌单架。
- 自定义壁纸。
- 本地图片背景。
- 本地视频背景。
- Wallpaper Engine 壁纸读取。
- 动态壁纸下保留粒子律动和视觉预设。
- 封面背景、模糊背景、播放态视觉预设。
- 空闲态星河、星球等视觉氛围。

### 桌面体验

- Electron 桌面窗口。
- 托盘控制。
- 桌面歌词。
- 沉浸模式。
- 迷你队列。
- Windows 媒体控制信息显示。
- 主窗口外部跳转保护。

### 音源与搜索

- 支持导入落雪兼容音源脚本。
- 支持通过链接导入音源。
- 支持跨平台搜索。
- 音源失败时可尝试备用音源。
- 音源脚本在隔离沙箱中初始化和调用。

## 界面示例

> 以下截图仅用于展示 Mineradio 的界面形态和本机联动效果。截图中的歌曲名、歌手名、专辑封面、歌单封面、壁纸图片或视频画面均来自用户本机环境或第三方软件显示内容，不代表本仓库内置、分发或授权这些内容。

### 独立播放首页、歌单浏览与自定义背景

![独立播放首页、歌单浏览与自定义背景](docs/screenshots/playlist-wallpaper-example.png)

### 独立搜索与直接播放

![独立搜索与直接播放](docs/screenshots/lx-music-local-api-example.png)

### Wallpaper Engine 壁纸库

![Wallpaper Engine 壁纸库](docs/screenshots/wallpaper-engine-browser-example.png)

### 播放态粒子与音乐可视化

![播放态粒子与音乐可视化](docs/screenshots/lyric-stage-playback-example.png)

## 不包含什么

Mineradio 不包含以下内容：

- LX Music 程序本体
- 内置音乐音源
- 歌曲、专辑、封面、歌词或其他受版权保护内容
- 网易云音乐账号登录
- QQ 音乐账号登录
- 官方平台收藏同步
- 官方平台会员能力

涉及第三方平台、扩展数据源或在线内容时，用户应遵守相应服务条款和版权规则。Mineradio 不提供、托管或授权这些内容。

## 原项目、作者与版权声明

- 本项目基于原作者 [@XxHuberrr](https://github.com/XxHuberrr) 的开源项目 [XxHuberrr/Mineradio](https://github.com/XxHuberrr/Mineradio) 进行二次开发。
- 原项目与本项目均依据仓库内的 MIT License 使用和分发。
- 感谢 [@lyswhut/lx-music-desktop](https://github.com/lyswhut/lx-music-desktop) / LX Music。LX Music 相关名称仅用于说明兼容或可选联动能力；本项目不是 LX Music 官方产品，也不包含或分发 LX Music 程序本体。

## 开发运行

```bash
npm install
npm run dev
```

## 打包

```bash
npm run dist
```

打包产物输出到 `dist/`。

## 发布仓库

默认发布仓库配置为 `ww085213/Mineradio-LX-Music`。如果 fork 或迁移到其它仓库，请同步修改 `package.json` 里的 `homepage`、`repository.url`、`bugs.url` 和 `mineradio.update` 配置。

## 开源说明

本仓库只包含源码和必要静态资源，不包含 Electron / Chromium 运行时、用户本地缓存、用户歌单数据、音源配置、歌曲文件或个人配置。

第三方库和资源保留各自许可证。`public/vendor/` 中的库文件请按照对应许可证使用。

## License

MIT
