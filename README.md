# Mineradio

Mineradio 是一个 Windows 桌面音乐播放器，面向本地音乐播放、跨平台歌单导入同步、歌曲搜索、歌词展示和沉浸式可视化场景。

当前发布版本：`1.5.3`

项目地址：

```text
https://github.com/ww085213/Mineradio-LX-Music
```

## 下载

请从本仓库 Releases 页面下载：

[Mineradio Releases](https://github.com/ww085213/Mineradio-LX-Music/releases)

Windows 安装包文件名：

```text
Mineradio.Setup.1.5.3.exe
```

`1.5.3` 安装包使用 `com.mineradio.desktop` 应用 ID、`Mineradio` 产品名和 `Mineradio.exe` 可执行文件名，可覆盖当前 `1.5.2` 安装目录。

## 1.5.3 更新重点

- 清理旧登录、账号、二维码、会员、账号胶囊等二创前残留界面和空壳代码。
- 修复本地 FLAC 播放兼容问题，增强异常音频的解码回退。
- 扩展本地导入格式，支持更多音频后缀。
- 修复网易歌单链接被误识别为专辑的问题。
- 增加已导入平台歌单的同步能力。
- 修复酷我、咪咕在当前分流/VPN 环境下的导入和搜索连通问题。
- 验证小蜗、小枸、酷狗概念版、小菇歌单导入可用。
- 验证本地文件夹导入、本地搜索和 `123木头人 - 黑Girl.flac` 播放路径可用。

## 功能

- 本地音乐文件和文件夹导入。
- 本地播放队列、歌单、封面、歌词和自定义歌词。
- 平台歌单链接导入与同步。
- 跨平台歌曲搜索。
- 桌面歌词、沉浸式播放界面和可视化效果。
- 播放质量、速度、音量、视觉预设和快捷键设置。
- GitHub Releases 更新检测。

## 支持的平台入口

歌单导入和同步支持：

- 小秋
- 小芸
- 小蜗
- 小枸
- 小枸概念版
- 小菇
- LX 歌单文件
- 本地文件和本地文件夹

具体平台接口可能受网络、DNS、分流规则和平台公开状态影响。若出现网络失败，优先检查 VPN、分流路由和系统代理。

## 本地音乐格式

常见格式包括：

```text
mp3, flac, wav, m4a, aac, ogg, oga, opus, wma, ape, alac, m4b,
aiff, aif, aifc, caf, amr, awb, mka, mkv, ac3, dts, tta, tak,
wv, au, snd, ra, rm
```

部分浏览器内核不能直接播放的格式会尝试通过本地解码缓存转换为可播放音频。

## 从源码运行

```bash
npm install
npm start
```

## 构建 Windows 安装包

```bash
npm run build:win
```

构建产物输出到 `dist/`：

```text
dist/Mineradio.Setup.1.5.3.exe
dist/Mineradio.Setup.1.5.3.exe.blockmap
dist/latest.yml
```

## 发布

发布到 GitHub：

```bash
gh release create v1.5.3 dist/Mineradio.Setup.1.5.3.exe dist/Mineradio.Setup.1.5.3.exe.blockmap dist/latest.yml --repo ww085213/Mineradio-LX-Music --title "Mineradio 1.5.3" --notes-file release-notes-1.5.3.md
```

## 说明

Mineradio 不是网易云音乐、QQ 音乐、酷我音乐、酷狗音乐、咪咕音乐、LX Music 或任何第三方音乐平台的官方客户端。平台接口能力仅用于个人本地客户端体验和歌单整理，请遵守对应平台服务条款和版权规则。

本项目不内置音乐内容，不提供音乐内容下载，不重新分发音乐内容。
