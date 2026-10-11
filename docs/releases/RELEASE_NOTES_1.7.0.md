# Mineradio 1.7.0

Windows 10/11 x64。安装包不内置音乐音源；音源由用户自行导入。升级保留用户数据目录中的歌单和设置。

## 歌词与背景

- 接入 Folia 的 14 种歌词动画：流光、心象、云阶、浮名、群唱、倾诉、莫奈、Claddagh、镜台、绘光、Pendolo、商籁、Still、凝彩。
- 增加深色、浅色、自定义配色和当前配色，以及背景类型、透明度、封面色彩和几何背景等设置。
- 修复商籁、绘光在受限渲染环境下的 Pixi 初始化问题。
- 修复“当前配色”把整段 CSS 字体栈当作单个字体名传入，导致逐字排版测量异常的问题。

## 界面

- 新歌词效果处于交互界面下方，当前队列、右侧唱片架、主页和音源入口保持可见。
- 返回主页继续使用当前选择的歌词背景效果。

## 下载与源码

- [Windows 安装包](https://github.com/ww085213/Mineradio-LX-Music/releases/download/v1.7.0/Mineradio.Setup.1.7.0.exe)
- [GitHub Release](https://github.com/ww085213/Mineradio-LX-Music/releases/tag/v1.7.0)
- 对应源码位于 `v1.7.0` 标签，歌词引擎构建方法见 `lyric-viz-bridge/README.md`。
- Folia 代码版权归原作者及贡献者所有，遵循 AGPL-3.0。保留的许可证及来源说明位于 `licenses/Folia-AGPL-3.0.txt` 和 `docs/THIRD_PARTY_PORTS.md`。

安装包和脚本校验已通过，具体歌词效果与设备运行表现仍需用户实际使用验证。
