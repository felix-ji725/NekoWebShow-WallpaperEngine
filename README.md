<div align="center">
  <img src="./neko.png" width="96" alt="NekoWebShow" />
  <h1>NekoWebShow for Wallpaper Engine</h1>
  <p>把《猫娘乐园》的 E-mote 网页图鉴，做成 Windows 桌面壁纸</p>
  <p>
    <img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="license" />
    <img src="https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-lightgrey.svg" alt="platform" />
    <img src="https://img.shields.io/badge/Wallpaper%20Engine-web%20wallpaper-ff69b4.svg" alt="wallpaper engine" />
  </p>
</div>

把 [NekoWebShow](https://github.com/Chocola-X/NekoWebShow)（网页版《猫娘乐园》E-mote 图鉴）适配成 **Windows / Wallpaper Engine** 壁纸：8 个角色、195 套皮肤、121 张背景、271 条语音，双人同屏、注视跟随、点击反应与语音口型全部保留。

> **非官方移植。** 本项目是上游项目的衍生作品，第三方维护，不是作者发布，未获作者背书；上游作者对 Windows 平台的任何问题不承担责任。
>
> 上游播放器由 **GTX690战术核显卡导弹** 开发：<https://www.nekopara.uk> ・ <https://show.nekopara.uk>
>
> **本项目（修改版）源码：<https://github.com/felix-ji725/NekoWebShow-WallpaperEngine>**

<!-- 效果截图：截好后放到 docs/ 下，取消下面注释 -->
<!--
## 效果

<p align="center">
  <img src="./docs/preview-duo.png" width="720" alt="双人模式" />
</p>
-->

## 功能

- **完整素材**：8 角色 / 195 皮肤 / 121 背景（含 35 组分时段动态场景）/ 271 语音，全部离线
- **双人模式**：两个模型同屏，用 ①② 切换当前编辑对象，各自的皮肤、大小、位置、注视、点击动作与语音口型互不干扰
- **注视跟随**：按屏幕尺寸归一化，鼠标移到面板上也不中断
- **点击反应**：身体 / 脸 / 头分区命中，动作 + 语音 + 口型同步
- **交互控制**：帧率上限（30/60/120/240/无上限，无上限时显示实时帧数）、静音、锁定位置与大小、角色大小 ±、背景切换
- **持久化**：角色、皮肤、大小、位置、面板位置全部记住
- **多语言**：简体中文 / 繁體中文 / English / 日本語

## 快速开始

### 方式 A：一条命令（推荐）

双击 **`获取素材并安装.bat`**：

1. 从上游仓库下载素材包（约 1 GB，BITS 断点续传，内置镜像备用）
2. 自动解出 `data/`、`background/`、`sounds/` 放到项目里
3. 校验数量（195 / 121 / 271）
4. 调起安装脚本

下载失败会自动降级为**逐文件下载**（588 个文件，可中断续传，重跑跳过已完成）。

### 方式 B：手动下载

1. 打开上游仓库 <https://github.com/Chocola-X/NekoWebShow>
2. `Code` → `Download ZIP`（约 1.x GB）
3. 解压，把里面的 `data`、`background`、`sounds` 三个文件夹复制到本项目根目录
4. 双击 `安装到WallpaperEngine.bat`，选 `J`（目录联接）或 `C`（复制）

装完在 Wallpaper Engine →「已安装」里选 **NekoWebShow-Portable**。

## 素材说明

`data/`、`background/`、`sounds/` **不随本仓库分发**。

这些是《猫娘乐园》的游戏素材，版权归 **NEKO WORKs**，不属于上游作者，也不属于本项目。请自行准备（见上一节），仅限个人自用，**请勿再分发**。

校验清单：

```
data/        195 个 *.pure.psb.zip
background/  121 张 png
sounds/      271 个文件
合计         约 0.97 GB
```

## 常见问题

**黑屏 / 只有背景没有角色**
完全退出 WE（托盘右键 Exit）再打开。CEF 会缓存旧脚本。

**角色不跟鼠标**
WE 默认「有窗口获得焦点时暂停壁纸」。Win+D 露出桌面再移动鼠标。

**面板滚不动 / 滚轮没用**
WE 不把 `wheel` 事件转发给 web 壁纸。用右侧粉色滚动条，或标题栏 `▲▼`（可按住连滚）。

**换装没反应**
看面板左下角有没有「正在给角色二换装…」。双人模式下先用 ①② 选当前编辑哪个角色。

## 相对上游的改动

| 改动 | 原因 |
| --- | --- |
| `fetch()` → `fetchBinary()` | `file://` 下 Chromium 只允许 http(s) |
| 注视量程归一化 | `face_eye_*` 量程只有 ±30，上游实现在 90px 外就顶死 |
| 双人模式 | 第二个 `EmotePlayer` 注册进同一个 `EmoteDevice` |
| 自绘滚动条 + `▲▼` | WE 不转发 `wheel`，原生滚动条也拖不动 |
| localStorage 持久化 | `file://` 下 cookie 不可用 |
| 安装脚本 | 目录联接 / 复制双模式，注册表兜底查 Steam 路径 |

## 许可证

[GNU AGPL-3.0](LICENSE)，与上游一致。

分发打包好的壁纸（含本项目代码）时，你需要：附上本仓库地址、保留 `LICENSE`、保留上游署名与链接、不加额外限制。

## 致谢

- [NekoWebShow](https://github.com/Chocola-X/NekoWebShow) — 上游播放器，AGPL-3.0
- [FreeMote](https://github.com/UlyssesWu/FreeMote) 与 [FreeMote-SDK](https://github.com/Project-AZUSA/FreeMote-SDK) — E-mote 解包与 WebGL 驱动
- [fflate](https://github.com/101arrowz/fflate) — 解压，MIT
- 《猫娘乐园》素材版权归 **NEKO WORKs**

本项目与 NEKO WORKs、Wallpaper Engine 开发商均无关联。
