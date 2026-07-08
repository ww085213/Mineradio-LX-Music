# 发布流程

## 当前补充版

```text
1.5.3 supplement
```

## 发布前检查

- `package.json` 和 `package-lock.json` 顶层版本号保持 `1.5.3`。
- `build.appId` 为 `com.mineradio.desktop`。
- `productName`、`executableName` 和快捷方式名均为 `Mineradio`。
- `mineradio.update.owner/repo` 指向 `ww085213/Mineradio-LX-Music`。
- `public/index.html` 的音源“一键导入”支持多选本地 `.js` 音源文件。
- 前端内联脚本语法检查通过。
- `desktop/main.js`、`server.js`、`lx-source-host.js` 语法检查通过。

## 构建

```bash
npm run build:win
```

输出：

```text
dist/Mineradio.Setup.1.5.3.exe
dist/Mineradio.Setup.1.5.3.exe.blockmap
dist/latest.yml
```

## GitHub Release

补充版独立发布，不覆盖原 `v1.5.3`：

```text
v1.5.3-supplement
```

标题：

```text
Mineradio 1.5.3 补充版
```

上传：

- `dist/Mineradio.Setup.1.5.3.exe`
- `dist/Mineradio.Setup.1.5.3.exe.blockmap`
- `dist/latest.yml`
- `dist/Mineradio.Setup.1.5.3.SHA256.txt`

## 说明

补充版应用版本号仍为 `1.5.3`，不会被普通 `1.5.3` 通过检查更新自动发现。安装补充版后，后续发布 `1.5.4` 或更高版本时可直接在软件内检查更新。
