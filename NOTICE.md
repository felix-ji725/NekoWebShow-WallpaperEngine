# 贡献者与第三方组件声明

## 按贡献者列出

### Ulysses（UlyssesWu / Ulysses-U大）

| 贡献 | 说明 | 许可 |
| --- | --- | --- |
| FreeMote 工具链 | E-mote 模型解包与转换工具 | CC BY-NC-SA 4.0 |
| FreeMote SDK v3.9（`driver/FreeMoteDriver.js`） | 本项目使用的 WebGL / asm.js 渲染驱动，文件头部即为其版权声明 | CC BY-NC-SA 4.0 |
| 原始素材解包与整理 | 角色模型的首次解包 | — |
| 《[猫娘动态壁纸 青春版](https://steamcommunity.com/sharedfiles/filedetails/?id=3752916624)》 | Wallpaper Engine 网页壁纸作品，本项目的素材链起点 | — |

### GTX690战术核显卡导弹

| 贡献 | 说明 | 许可 |
| --- | --- | --- |
| NekoWebShow | 网页版《猫娘乐园》E-mote 图鉴播放器，本项目的代码上游 | AGPL-3.0 |
| 后续素材解包 | 动态立绘与背景图，解包自《猫娘乐园》Vol 4 / After | — |

### felix-ji725

| 贡献 | 说明 |
| --- | --- |
| Windows / Wallpaper Engine 适配 | `file://` 兼容层、`project.json`、双人模式、WE 交互适配、安装与素材获取脚本 |

### NEKO WORKs

所有角色、背景、语音素材的**原始版权方**（《猫娘乐园》）。

## 代码与工具链组件表

| 组件 | 作者 | 许可证 | 来源 |
| --- | --- | --- | --- |
| NekoWebShow（本项目上游） | GTX690战术核显卡导弹 | AGPL-3.0 | https://github.com/Chocola-X/NekoWebShow |
| FreeMote SDK（`driver/FreeMoteDriver.js`） | **Ulysses** | CC BY-NC-SA 4.0 | https://github.com/Project-AZUSA/FreeMote-SDK |
| FreeMote 工具链 | **Ulysses** | CC BY-NC-SA 4.0 | https://github.com/UlyssesWu/FreeMote |
| fflate（`fflate.js`） | Arjun Barrett | MIT | https://github.com/101arrowz/fflate |

## 素材来源链

| 环节 | 贡献者 |
| --- | --- |
| 原始素材 | © NEKO WORKs |
| 解包与首次整理 | Ulysses |
| 《猫娘动态壁纸 青春版》（Wallpaper Engine） | Ulysses |
| 动态立绘与背景图解包、播放器 NekoWebShow | GTX690战术核显卡导弹 |
| Windows / Wallpaper Engine 适配（本项目） | felix-ji725 |

**说明**：本项目所引用的素材，其解包与整理工作源自 Ulysses；此前仅致谢了 NekoWebShow 作者，未注明 Ulysses 的贡献，现已更正。素材不全由同一来源，其余部分由上游作者后续补充，具体范围本项目无法核实。

本仓库**不包含**任何素材（`data/`、`background/`、`sounds/` 已由 `.gitignore` 排除），用户需自行准备（见 README）。

## 许可说明

- 本项目代码以 **GNU AGPL-3.0** 发布
- 其中 `driver/FreeMoteDriver.js` 为 **CC BY-NC-SA 4.0**，该许可**禁止商业使用**
- 因此本项目**整体仅限非商业用途**；如需商用，需分别获得 Ulysses 与 GTX690 的授权

## 商标

「NEKOPARA / 猫娘乐园」及相关角色名称、形象为 NEKO WORKs 的商标或注册商标。本项目与其无关联、未获授权、未获背书。
