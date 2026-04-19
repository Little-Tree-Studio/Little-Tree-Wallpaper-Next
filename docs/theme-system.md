# 主题系统

小树壁纸 Next 的主题系统围绕一个可导入、可导出、可设计、可预览的主题文件格式展开。

主题可以同时定义以下内容：

- MUI 主题色与基础视觉变量
- 全局背景，可选图片或视频
- 全局 CSS
- 组件级 CSS
- 主题元数据

主题文件默认扩展名为 .ltwtheme，本质上是 JSON 文档。

## 功能概览

设置页中的主题系统支持：

- 切换内置主题
- 新建主题
- 复制当前主题继续修改
- 编辑自定义主题
- 导入主题文件
- 导出主题文件
- 实时预览主题效果

## 安全提醒

主题支持自定义 CSS 和远程媒体资源，这意味着主题本身具备一定的表现力，也带来了风险。

请注意：

- 恶意 CSS 可能隐藏按钮、覆盖交互区、伪装界面状态
- 远程图片、图标和视频可能向外部地址发起请求
- 不建议直接导入来源不明的主题文件

建议仅从可信来源导入主题，并在应用前先检查元数据、背景资源地址和 CSS 内容。

## 主题文件格式

主题文件结构如下：

```json
{
  "format": "ltw-theme",
  "schema_version": 1,
  "metadata": {
    "id": "aurora-paper-custom",
    "name": "极光纸页 Plus",
    "icon": "data:image/png;base64,...",
    "summary": "适合白天使用的轻纸感主题。",
    "description_md": "## 设计说明\n\n支持更透明的卡片和背景媒体。",
    "author": "Little Tree",
    "version": "1.0.0",
    "supported_app_version": ">=0.1.0",
    "author_website": "https://example.com"
  },
  "theme": {
    "mode": "light",
    "palette": {
      "primary": "#4d6bfe",
      "secondary": "#db8f49",
      "success": "#2f8f69",
      "warning": "#bf7b1d",
      "info": "#2e83c6",
      "background_default": "#f5f2eb",
      "background_paper": "#fffaf3",
      "text_primary": "#1f2a37",
      "text_secondary": "#5c6b7a"
    },
    "shape": {
      "border_radius": 22
    },
    "surface": {
      "blur": 20,
      "opacity": 0.82,
      "border_opacity": 0.12,
      "shadow_opacity": 0.14
    },
    "typography": {
      "font_family": "\"Segoe UI Variable\", \"Segoe UI\", \"Noto Sans SC\", sans-serif"
    },
    "background": {
      "kind": "image",
      "source": "https://example.com/background.webp",
      "poster": "",
      "opacity": 0.46,
      "blur": 8,
      "brightness": 0.92,
      "fit": "cover",
      "position": "center center",
      "overlay_tint": "#fff9f1",
      "overlay_strength": 0.48
    },
    "css": {
      "global": ":root { --theme-edge-glow: rgba(77, 107, 254, 0.22); }",
      "components": {
        "appShell": "background-image: radial-gradient(circle at top right, var(--theme-edge-glow), transparent 42%);",
        "muiCard": "&:hover { transform: translateY(-2px); }"
      }
    }
  }
}
```

## 元数据字段

metadata 中支持以下字段：

- id：主题标识符，可选。若省略，应用会根据名称自动生成
- name：主题名称，建议必填
- icon：图标地址，支持链接或 Base64
- summary：简短介绍
- description_md：详细介绍，Markdown 格式
- author：作者名称
- version：主题版本号
- supported_app_version：支持的小树壁纸 Next 版本号
- author_website：作者网站

除 name 外，其他字段都可以按需省略。

## 背景系统

background.kind 支持三种模式：

- none：只使用主题色渐变背景
- image：使用图片背景
- video：使用视频背景

source 字段支持：

- http 或 https 链接
- data: Base64 数据
- 本地路径

视频背景建议配合 poster 一起使用，避免媒体尚未就绪时出现空白。

## 自定义 CSS

### 全局 CSS

theme.css.global 会作为完整样式表直接注入页面。适合编写：

- CSS 变量
- 媒体查询
- keyframes
- 全局类选择器

### 组件 CSS

theme.css.components 用于对固定目标注入局部 CSS，目前支持以下 key：

- appShell：应用外壳
- navigationDrawer：导航抽屉
- topBar：顶部栏
- pageSurface：主页面区域
- themeManager：主题管理器自身
- muiPaper：所有 MUI Paper
- muiCard：所有 MUI Card
- muiButton：所有 MUI Button
- muiDialog：所有 MUI Dialog

组件 CSS 推荐写法有两种：

1. 只写声明块内容

```css
backdrop-filter: blur(28px);
border-radius: 28px;
```

2. 使用 & 代表当前目标选择器

```css
&:hover {
  transform: translateY(-2px);
}
```

## 设置持久化

当前启用主题和用户自定义主题列表会保存在应用设置中。

相关设置项：

- ui.theme_profile：当前主题 id
- ui.custom_themes：用户自定义主题列表

内置主题不会写入 ui.custom_themes。

## 设计建议

制作主题时建议优先按以下顺序推进：

1. 先定 mode、主色和背景色
2. 再调整 surface 的透明度、模糊和阴影
3. 再决定是否添加图片或视频背景
4. 最后再用 CSS 做局部强化

如果主题已经足够依赖自定义 CSS，建议在 description_md 中明确说明兼容范围和预期效果。
