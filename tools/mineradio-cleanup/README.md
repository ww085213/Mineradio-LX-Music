# Mineradio 清理工具

`Mineradio.Cleanup.1.0.0.exe` 是独立的 Windows 图形化清理工具，适用于官方安装版、旧版 2.1.0、自定义安装路径和残留安装记录。

[从 v1.5.7.1 Release 下载清理工具](https://github.com/ww085213/Mineradio-LX-Music/releases/download/v1.5.7.1/Mineradio.Cleanup.1.0.0.exe)

SHA-256：`0a9a91be67fda026f33c9e005e0f756bb379e8c11c1e172ddc8d82e8b1927072`

## 两种用法

- 只移除程序：删除已验证的 Mineradio 程序目录、快捷方式、开机启动项和安装注册信息，保留音源、歌单及设置。
- 彻底清除：额外删除 `%APPDATA%\Mineradio`、`%LOCALAPPDATA%\Mineradio` 和旧版持久启动脚本，使下一次安装进入首次安装状态。

工具不会删除 LX Music 自己的数据，也不会删除 `Mineradio.Setup.*.exe`。如果安装包误放在即将清理的目录中，工具会先将它移动到“下载\Mineradio Installers”。

## 安全设计

- 程序目录必须包含 `Mineradio.exe`，并通过安装标记、`package.json` 或 Windows 文件版本信息验证。
- 拒绝删除磁盘根目录、用户目录、桌面根目录或 AppData 根目录。
- 删除用户数据必须单独勾选，并在执行前二次确认。
- 被占用文件会安排在下次重启 Windows 后删除。
- 每次清理都会在 `%TEMP%` 生成 `Mineradio-Cleanup-*.log`。

## 构建

在 Windows PowerShell 中执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\mineradio-cleanup\build.ps1
```

默认输出到 `dist\cleanup`，依赖 Windows 自带的 .NET Framework 4.x，不需要额外安装 SDK。

## 自动化验证

```powershell
.\dist\cleanup\Mineradio.Cleanup.1.0.0.exe --self-test --self-test-result=C:\path\result.txt
.\dist\cleanup\Mineradio.Cleanup.1.0.0.exe --scan-report=C:\path\scan.txt
```

`--self-test` 只在系统临时目录创建并删除隔离测试数据，不会清理真实安装。
