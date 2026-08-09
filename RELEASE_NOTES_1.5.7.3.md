# Mineradio 1.5.7.3

## 本次发布

- 以发布者电脑当前 `D:\Mineradio` 的 1.5.7.2 完整程序为基准重新封装，功能代码、播放器资源和运行时依赖保持一致。
- Windows 文件版本、产品版本、应用发布版本和安装包名称更新为 `1.5.7.3`。
- 沿用 `com.mineradio.desktop` 应用标识和原安装器目录识别逻辑，可直接覆盖 1.5.7.2 及此前兼容版本。
- 覆盖安装只更新程序目录，继续保留 `%APPDATA%\Mineradio` 中的用户数据、歌单、设置和音源配置。

## 本机验证

- 已在现有 `D:\Mineradio` 1.5.7.2 上完成一次真实静默覆盖安装。
- 覆盖后 `Mineradio.exe` 文件版本与产品版本均为 `1.5.7.3`，应用发布版本为 `1.5.7.3`。
- 主进程、GPU、网络、渲染器和音频进程均成功启动并保持响应。
- 安装后的 `resources/app` 共 2384 个文件，与用于封装的本机程序逐文件 SHA-256 对比，差异为 0。

## Windows 发布文件

- `Mineradio.Setup.1.5.7.3.exe`
- `Mineradio.Setup.1.5.7.3.exe.blockmap`
- `latest.yml`
- `Mineradio.Setup.1.5.7.3.SHA256.txt`

安装包 SHA-256：

```text
9775698e51260dcaa8bc8ca5bcfb555f799c35b5339521ace76ef828c8e50ac0  Mineradio.Setup.1.5.7.3.exe
```

> 本版未使用 Authenticode 商业代码签名证书，Windows SmartScreen 可能在首次运行时显示“未知发布者”。请从本仓库 Release 下载并核对 SHA-256。
