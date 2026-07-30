# 小树壁纸主题系统

本文档描述小树壁纸 Next 的主题格式、资源引用方式、运行时行为和主题包制作规范。

## 1. 概览

主题系统由三部分组成：

- `theme.json`：版本化主题清单，保存颜色、背景、字体和自定义 CSS。
- `.lttheme`：主题分发包，本质是 ZIP，根目录必须包含 `theme.json`，可包含 `assets/` 内置资源。
- 主题运行时：将清单映射到 HeroUI 语义 CSS 变量，并负责背景媒体、字体和自定义 CSS 的生命周期。

当前格式标识为 `little-tree-theme`，格式版本为 `1`。未知格式或未知版本会被拒绝。

主题存储在用户配置目录的 `themes/<theme-id>/` 下。默认主题 `default` 是内置只读主题，不占用用户主题目录，可以被导出或复制。

## 2. 目录结构

一个带内置图片和字体的主题包示例：

```text
forest.lttheme
├── theme.json
└── assets
    ├── background.webp
    └── interface.woff2
```

`.lttheme` 包内路径统一使用 `/`。不允许绝对路径、`..`、符号链接或主题目录外引用。

## 3. 完整清单示例

```json
{
  "format": "little-tree-theme",
  "format_version": 1,
  "id": "forest-night",
  "name": "Forest Night",
  "description": "低饱和森林配色与内置背景。",
  "author": "Theme Author",
  "version": "1.0.0",
  "colors": {
    "accent": "#16845B",
    "accent_foreground": "#FFFFFF",
    "light": {
      "background": "#F5F8F6",
      "foreground": "#18211C",
      "surface": "#FFFFFF",
      "surface_secondary": "#EAF0EC",
      "surface_tertiary": "#E1E9E4",
      "muted": "#64736A",
      "border": "#D5DFD9",
      "separator": "#DEE6E1"
    },
    "dark": {
      "background": "#101512",
      "foreground": "#F2F7F4",
      "surface": "#1B231E",
      "surface_secondary": "#243029",
      "surface_tertiary": "#2B3830",
      "muted": "#A3B1A8",
      "border": "#35433B",
      "separator": "#2E3B34"
    }
  },
  "background": {
    "type": "image",
    "gradient": "linear-gradient(135deg, #F5F8F6 0%, #E1E9E4 100%)",
    "source": {
      "mode": "bundled",
      "value": "assets/background.webp"
    },
    "fit": "cover",
    "position": "center center",
    "media_opacity": 1,
    "overlay_opacity": 0.2,
    "video_volume": 0
  },
  "typography": {
    "font_family": "Segoe UI, sans-serif",
    "source": {
      "mode": "bundled",
      "value": "assets/interface.woff2"
    }
  },
  "custom_css": "[data-theme-profile=\"forest-night\"] { --radius: 0.375rem; }",
  "created_at": "",
  "updated_at": "",
  "is_builtin": false
}
```

导入和保存时，应用会规范化清单并写入 `created_at`、`updated_at` 和 `is_builtin`。主题作者不应依赖手工设置这些字段。

## 4. 顶层字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `format` | string | 是 | 固定为 `little-tree-theme`。 |
| `format_version` | integer | 是 | 当前固定为 `1`。 |
| `id` | string | 是 | 1 至 64 字符；仅小写字母、数字、点、下划线、连字符。 |
| `name` | string | 是 | 显示名称，最长 80 字符。 |
| `description` | string | 否 | 主题说明，最长 500 字符。 |
| `author` | string | 否 | 作者名称，最长 80 字符。 |
| `version` | string | 是 | 主题版本，最长 32 字符。 |
| `colors` | object | 是 | 主题色和浅色/深色语义颜色。 |
| `background` | object | 是 | 应用背景定义。 |
| `typography` | object | 是 | 字体族及可选字体资源。 |
| `custom_css` | string | 否 | 注入到应用文档末尾的 CSS，最大 128 KiB。 |

导入发生 ID 冲突时，应用会生成带数字后缀的新 ID，不会覆盖已安装主题。

## 5. 颜色系统

`colors.accent` 是全局主题色，映射到 HeroUI 的 `--accent`、`--focus` 和 `--link`。`accent_foreground` 是主题色表面上的文字和图标颜色。

`colors.light` 与 `colors.dark` 必须各自提供以下字段：

| 字段 | HeroUI 变量 | 用途 |
| --- | --- | --- |
| `background` | `--background` | 应用底色、背景媒体回退色。 |
| `foreground` | `--foreground` | 主要文字。 |
| `surface` | `--surface`、`--overlay` | 卡片、弹层和输入框。 |
| `surface_secondary` | `--surface-secondary` | 次级面板和导航。 |
| `surface_tertiary` | `--surface-tertiary` | 更高对比度的表面。 |
| `muted` | `--muted` | 辅助文字和占位符。 |
| `border` | `--border` | 控件与容器边框。 |
| `separator` | `--separator` | 分隔线。 |

颜色支持十六进制以及 `rgb()`、`rgba()`、`hsl()`、`hsla()`、`oklch()`、`oklab()` 和 `color()`。单个颜色值不能包含 CSS 声明分隔符。

悬停色、柔和状态色和多级边框由 HeroUI 使用 `color-mix()` 从源令牌计算，不写入主题文件。

运行时始终保留 `data-theme="light|dark"`，主题 ID 写入 `data-theme-profile`。自定义 CSS 应优先使用后者限定作用域。

## 6. 背景

`background.type` 支持：

- `solid`：使用当前明暗模式的 `colors.*.background`。
- `gradient`：使用 `background.gradient`。
- `image`：显示 `background.source` 指向的图片。
- `video`：循环、静音、自动播放 `background.source` 指向的视频。

在主题设计器中切换到视频背景时，资源来源默认设为 `path`（本地路径引用）。视频通常体积较大，这样可以直接播放原文件而无需先复制到主题目录；如需分发主题，可手动改为 `bundled`。

其他字段：

| 字段 | 类型 | 范围/可选值 |
| --- | --- | --- |
| `gradient` | string | `linear-gradient()`、`radial-gradient()`、`conic-gradient()` 及 repeating 变体；不允许 `url()`。 |
| `fit` | string | `cover`、`contain`、`fill`、`none`。 |
| `position` | string | 合法 CSS `object-position`，例如 `center center`、`50% 25%`。 |
| `media_opacity` | number | 0 至 1。 |
| `overlay_opacity` | number | 0 至 1；以当前明暗模式背景色覆盖媒体，提高文字可读性。 |
| `video_volume` | number | 0 至 1；仅用于视频背景，默认为 `0`（静音）。 |

图片支持 AVIF、BMP、GIF、JPEG、PNG、WebP。视频支持 MP4、WebM、MOV、M4V。

## 7. 资源来源

背景和字体使用统一资源对象：

```json
{
  "mode": "bundled",
  "value": "assets/background.webp"
}
```

### `bundled`

资源内置在主题目录或 `.lttheme` 包中。`value` 必须位于 `assets/` 下。内置主题便于分发和离线使用，导出时资源会写入主题包。

### `path`

`value` 是本机绝对路径。应用通过带会话认证的本地媒体路由读取该文件，网页层不会直接使用 `file://`。

路径引用不会复制进主题包。把主题导入另一台设备后，原路径通常不存在，需要重新选择文件。

### `url`

`value` 是无用户名和密码的 HTTP(S) 链接。资源由 WebView 直接加载，需要网络连接，并受远端可用性、证书和内容类型影响。

不支持在主题 JSON 中使用 Base64 或 Data URL。大图片和视频应放入 `.lttheme` 的 `assets/`，这样可避免 JSON 和 RPC 内存膨胀。

## 8. 字体

`typography.font_family` 是 CSS 回退字体族列表。`typography.source` 可以为 `null`，表示使用默认字体；也可以使用 `installed`、`bundled`、`path` 或 `url`。

`installed` 是独立的字体来源。其 `value` 保存字体 family 名称，例如：

```json
{
  "mode": "installed",
  "value": "Microsoft YaHei UI"
}
```

选择“本机已安装字体”来源后，主题设计器会显示可搜索字体选择器。主行显示字体 Full Font Name，副行单独显示字体家族和样式；主题的 `installed.value` 只保存字体家族名称。应用不会复制或导出操作系统字体文件。主题在其他设备使用时，如果该字体未安装，浏览器会使用 `font_family` 中的回退字体。

内置或路径字体支持 WOFF2、WOFF、TTF、OTF。指定资源后，运行时将其注册为内部字体 `LittleTreeThemeFont`，并把 `font_family` 作为回退列表。

字体链接必须直接返回字体文件。指向 CSS 样式表的 Google Fonts 等链接不能作为 `source`；这类高级加载可在可信主题的 `custom_css` 中使用 `@import`，但不建议依赖远程样式表。

## 9. 自定义 CSS

`custom_css` 使用 `<style>.textContent` 注入，不会被作为 HTML 解析。主题切换、预览关闭或设计器卸载时，运行时会覆盖或恢复对应样式。

推荐限定作用域：

```css
[data-theme-profile="forest-night"] {
  --radius: 0.375rem;
  --field-radius: 0.5rem;
}

[data-theme-profile="forest-night"] .navigation {
  backdrop-filter: blur(16px);
}
```

自定义 CSS 具有完整界面控制能力，也可以发起外部资源请求。仅导入可信来源的主题。应用不会尝试重写或隔离 CSS 选择器。

### 页面专属 CSS 标记

标记外的 CSS 始终全局生效。使用以下注释标记定义只在指定页面注入的 CSS：

```css
/* 全局 CSS */
[data-theme-profile="forest-night"] {
  --radius: 0.375rem;
}

/* @page home */
.home-hero {
  backdrop-filter: blur(18px);
}
/* @endpage */

/* @page search, resource */
.result-card {
  border-radius: 0;
}
/* @endpage */
```

`@page` 后可填写一个页面 ID、逗号分隔的多个页面 ID，或 `*`。页面标记不支持嵌套。运行时会在根元素同步设置 `data-app-page="<页面 ID>"`，高级主题也可使用该属性限定选择器。

可用页面 ID：

- `home`、`resource`、`generate`、`create`、`search`、`sniff`
- `favorite`、`tags`、`store`、`settings`、`help`、`history`、`tools`
- `resource-cnu-detail`、`resource-pixivel-detail`、`resource-source-management`
- `tools-color-palette`

例如，`/* @page settings */` 会应用于所有设置分类。页面切换时，运行时会重新生成主题样式，只保留全局 CSS 和当前页面匹配的块。

## 10. 导入、导出和管理

主题设置位于“设置 > 外观”：

1. “导入主题”接受 `.lttheme` 或不含内置资源的主题 JSON。
2. “导出主题”生成 `.lttheme`；只有 `bundled` 资源会随包导出。
3. 默认主题不可修改或删除，可通过“创建副本”进入设计器。
4. 删除当前启用主题后，应用自动恢复默认主题。
5. “启用”把主题 ID 写入 `ui.theme_profile`；明暗模式独立写入 `ui.theme`。
6. 实时预览只影响当前会话中的运行时样式，不会自动保存或启用草稿。

切换主题或新建主题时，如果当前草稿未保存，设置界面会先要求确认放弃修改。

## 11. 校验和限制

- 主题清单最大 512 KiB，自定义 CSS 最大 128 KiB。
- `.lttheme` 最大 1 GiB，最多 64 个文件。
- 单个图片、视频或字体资源最大 768 MiB。
- 包内拒绝绝对路径、目录穿越和符号链接。
- 保存采用临时文件加原子替换；导入先完整解压和校验，再移动到正式目录。
- 本地主题媒体路由要求当前应用会话令牌，并返回 `X-Content-Type-Options: nosniff`。
- 视频媒体路由声明字节范围支持，允许 WebView 按需读取和拖动播放位置。

## 12. 兼容性规则

主题读取器只接受明确支持的 `format_version`。未来新增可选字段时会保持同一版本；删除字段、改变字段语义或修改资源布局时将提升版本。

主题作者应：

- 保留未知但合法的语义设计意图，不依赖 HeroUI 内部 BEM 类名。
- 使用 `data-theme-profile` 为自定义 CSS 限定主题。
- 同时检查浅色和深色文字对比度。
- 为远程或路径资源保留合适的 `colors.*.background` 回退色。
- 发布前使用主题设置中的实时预览检查所有主要页面和弹层。
