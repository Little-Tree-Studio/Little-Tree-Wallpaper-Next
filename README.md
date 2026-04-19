## Current Status / 当前实现

<table width="100%">
  <tr>
    <td align="left" width="120">
      <img src="src\little_tree_wallpaper\assets\icon.ico" alt="Logo" width="100" />
    </td>
    <td align="right">
      <h1>Little Tree Wallpaper Next  <br><span style="font-size: 0.7em; font-weight: normal;">小树壁纸Next</span></h1>
      <h3 style="margin-top: -10px;">A wallpaper app for desktop <br><span style="font-size: 0.7em; font-weight: normal;">一个桌面壁纸应用</span></h3>
    </td>
  </tr>
</table>

> [!NOTE]
>
> **EN**
>
> This project is still under development.
>
> This repository is the refactored desktop edition of Little Tree Wallpaper, currently based on PyWebview + React + MUI.
>
> [Main repository of Little Tree Wallpaper](https://github.com/shu-shu-1/Little-Tree-Wallpaper)
>
> **中文**
>
> 该项目仍在开发中。
>
> 这是小树壁纸的重构版桌面应用，目前采用 PyWebview + React + MUI 作为主要技术栈。
>
> [小树壁纸主仓库](https://github.com/shu-shu-1/Little-Tree-Wallpaper)

![Visitor Count](http://estruyf-github.azurewebsites.net/api/VisitorHit?user=shu-shu-1&repo=Little-Tree-Wallpaper-Next-Flet&countColor=%237B1E7B)

## Overview / 概述 ℹ️

**EN**

Little Tree Wallpaper is a versatile app designed to quickly change and download wallpapers from a variety of sources, including Bing, 360, and Wallhaven. ✨ In addition, it supports multiple interfaces that allow users to bookshop and automatically rotate their favorite wallpapers.Little Tree Wallpaper will conduct local intelligent classification of users' wallpapers.

Stay tuned for more exciting features coming soon! 🎉

If you like this project, please give it a star! ⭐️

**中文**

小树壁纸是一款多功能应用程序，旨在快速更换和下载来自多种来源的壁纸，包括 Bing、360 和 Wallhaven。✨ 另外，它支持多种接口，允许用户收藏并自动轮换他们喜欢的壁纸，小树壁纸会为用户壁纸进行本地智能分类。

敬请期待更多激动人心的功能即将上线，我们将不断更新优化，为您带来更好的使用体验！🎉

如果您喜欢这个项目，不妨点个 ⭐️ 吧！

## Environment / 环境要求

- Python 3.10 or newer; Python 3.11 is recommended. / Python 3.10 及以上，推荐 Python 3.11。
- [uv](https://docs.astral.sh/uv/) is used for Python dependency and runtime management. / 使用 [uv](https://docs.astral.sh/uv/) 管理 Python 依赖与运行流程。
- Node.js 20 or newer is required to build frontend assets. / 构建前端静态资源需要 Node.js 20 及以上版本。

## Quick Start / 快速开始

### 1. Sync Python Environment / 同步 Python 环境

```powershell
uv sync
```

Dependencies are resolved from pyproject.toml and uv.lock. / 项目依赖以 pyproject.toml 和 uv.lock 为准。

### 2. Install And Build Frontend / 安装并构建前端

```powershell
cd frontend
npm install
npm run build
cd ..
```

### 3. Launch The Desktop App / 启动桌面应用

```powershell
uv run python main.py
```

## Common Commands / 常用开发命令

```powershell
uv sync
uv run python main.py

cd frontend
npm install
npm run build
npm run dev
```

Notes / 说明：

- The desktop host loads frontend/dist by default, so frontend changes usually require another npm run build. / 桌面宿主默认读取 frontend/dist，因此修改前端后通常需要重新执行 npm run build。
- npm run dev is useful for standalone frontend debugging, but it does not replace the static assets loaded by the desktop shell. / npm run dev 适合单独调试前端界面，不会自动替代桌面端加载的静态资源。
- requirements.txt is now only a legacy compatibility artifact and is no longer the primary dependency source. / 当前保留的 requirements.txt 仅用于兼容历史工作流，不再作为主依赖来源。

## Project Layout / 目录结构

```text
frontend/                     React + MUI frontend project / React + MUI 前端工程
  src/                        UI, theming, i18n, and app components / 应用界面、主题系统、多语言与业务组件
  public/                     Static frontend assets / 前端静态资源
src/little_tree_wallpaper/    Python host, bridge layer, and services / Python 宿主、桌面桥接与服务实现
  services/                   Wallpaper, favorites, plugins, store, and storage services / 壁纸、收藏、插件、商店、存储等服务
  assets/                     App icons and host-side assets / 应用图标与宿主资源
examples/ltws/                Example LTWS v3 wallpaper sources / 示例 LTWS v3 壁纸源
docs/                         Design and implementation docs / 设计与实现文档
main.py                       Desktop application entry / 桌面应用入口
pyproject.toml                Python project metadata and dependencies / Python 项目元数据与依赖声明
uv.lock                       uv lockfile / uv 锁文件
```

## Highlights / 当前实现重点

- The desktop host and frontend shell are already in place, including window bootstrap, settings bridge, and frontend-backend communication. / 已有桌面宿主与前端界面骨架，可以完成桌面窗口启动、设置桥接与前后端通信。
- Multiple wallpaper sources and service layers are implemented, including Bing, Windows Spotlight, LTWS, and the custom intelligent market flow. / 已实现多类壁纸来源与服务层，包括 Bing、Windows Spotlight、LTWS、自定义智能市场等。
- Favorites, localization, history, auto-change, theming, plugins, and store scaffolding are all present and ready for further iteration. / 收藏、本地化、历史记录、自动换壁纸、主题系统、插件与商店骨架均已进入可继续迭代的状态。
- The frontend already includes a theme designer, theme import/export, i18n, and wallpaper creator modules. / 前端包含主题设计器、主题导入导出、多语言、壁纸创作器等模块。

## Development Notes / 开发说明

- Windows wallpaper integration is implemented; macOS and Linux currently rely on baseline command-based branches. / Windows 壁纸设置已实现，macOS 与 Linux 目前仍以基础命令分支为主。
- Frontend build artifacts are emitted to frontend/dist, and the desktop app loads that directory directly. / 前端构建产物输出到 frontend/dist，桌面应用直接加载该目录。
- The store and plugin systems are still closer to host-side scaffolding, which makes them a good base for future protocol and installation work. / 商店与插件系统目前偏向宿主框架能力，适合作为后续真实协议接入与安装流程的基础层。
- LTWS currently covers source/config/categories/apis, template substitution, JSON Pointer wildcards, basic validation, and API caching. / LTWS 当前实现覆盖 source/config/categories/apis、变量替换、JSON Pointer 通配、基础校验与 API 缓存。
- This repository is currently best validated on Windows, while other platforms still focus on baseline functionality. / 当前仓库更适合在 Windows 上优先验证完整桌面体验，其它平台仍以基础能力为主。

## Documentation / 文档

- Theme system design and file format details: [docs/theme-system.md](docs/theme-system.md). / 主题系统设计与文件格式说明见 [docs/theme-system.md](docs/theme-system.md)。

## Roadmap / 后续方向

- Improve plugin installation flow and lifecycle management. / 完善插件安装与生命周期管理。
- Continue expanding cross-platform wallpaper integration and system-level experience. / 继续补足跨平台壁纸设置与系统集成体验。
- Consolidate store protocol, resource delivery, and theme/plugin distribution workflows. / 收敛商店协议、资源下载与主题/插件分发流程。
