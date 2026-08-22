# Little Tree Wallpaper Next

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="frontend/public/logo.png" alt="Little Tree Wallpaper Next" width="112" height="112">
</p>

<p align="center">
  A desktop wallpaper manager that combines browsing, search, favorites, creation, dynamic desktops and automation.
</p>

<p align="center">
  <a href="https://github.com/Little-Tree-Studio/Little-Tree-Wallpaper-Next/releases"><img alt="Release" src="https://img.shields.io/github/v/release/Little-Tree-Studio/Little-Tree-Wallpaper-Next?include_prereleases&label=version"></a>
  <img alt="Beta" src="https://img.shields.io/badge/status-beta-orange">
  <a href="LICENSES"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-blue"></a>
  <img alt="Python" src="https://img.shields.io/badge/Python-3.12%2B-informational?logo=python&logoColor=white">
  <img alt="Node" src="https://img.shields.io/badge/Node.js-20%2B-informational?logo=node.js&logoColor=white">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%2010%2F11-informational?logo=windows&logoColor=white">
  <a href="https://github.com/Little-Tree-Studio/Little-Tree-Wallpaper-Next/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/Little-Tree-Studio/Little-Tree-Wallpaper-Next?style=flat&color=yellow&logo=github"></a>
</p>

<p align="center">
  <a href="https://github.com/Little-Tree-Studio/Little-Tree-Wallpaper-Next/releases">Download</a>
  ·
  <a href="https://docs.zsxiaoshu.cn/docs/wallpaper/">Documentation</a>
  ·
  <a href="https://github.com/Little-Tree-Studio/Little-Tree-Wallpaper-Next/issues">Issues</a>
</p>

> [!WARNING]
> Little Tree Wallpaper Next 2.0 is currently in beta. Features, configuration, extension file formats and APIs may change at any time, possibly in incompatible ways, and it is not recommended for critical production use. Dynamic wallpapers, plugins and advanced automation remain advanced features; please read the [notes](#important-notes) below before using them.

## Features

- **Multiple wallpaper sources**: browse Bing, Windows Spotlight, Shiguang, CNU, Pixiv, IntelliMarkets and custom wallpaper sources.
- **Image search & sniffing**: search images via Baidu Images, Pexels, Pixiv and more, or extract usable images directly from web pages.
- **Favorites & organization**: manage wallpapers with favorite folders, tags and history; supports favorite pack import/export and localizing remote resources.
- **Wallpaper creation**: compose text, images, shapes, gradients and filters on a multi-layer canvas; save `.ltwp` projects or export PNG/JPEG.
- **AI image generation**: supports Pollinations AI, `models.dev` providers and OpenAI-compatible image generation endpoints.
- **Dynamic desktop** (Windows): create dynamic scenes from local videos, images, folders or favorites, with clock, date, sticky-note and other desktop widgets.
- **Visual automation**: switch wallpapers or run combined actions on app launch, on an interval or at a daily time using simple, block-based or node-graph modes.
- **Theme system**: customize light/dark semantic colors, app background, fonts and CSS; supports `.lttheme` import/export.
- **Resource store**: browse and install themes, wallpaper sources and plugins from the built-in store, with official and custom store sources; downloads are size-checked and SHA-256 verified.
- **Plugin system**: extend pages, navigation, resource pages, theme variables and dynamic wallpaper widgets through `.ltp` Python plugins.
- **Local desktop app**: the React UI is hosted by LumiView, while a FastAPI backend listens only on a random loopback port protected by a per-launch token.

## Platform Support

| Platform | Static wallpaper | Core management | Dynamic wallpaper | Notes |
| --- | --- | --- | --- | --- |
| Windows 10/11 | Supported | Supported | Experimental | Most complete; dynamic wallpaper relies on Explorer WorkerW |
| macOS | Code support | In principle | Not supported | Verify AppKit integration and system permissions yourself when running from source or packaging |
| Linux | Partial | In principle | Not supported | Static wallpaper depends on the desktop environment and tools such as `gsettings` and `feh` |

Releases and testing currently focus on Windows. Linux offers adaptations for GNOME, KDE Plasma, XFCE, Cinnamon, MATE, Deepin, LXQt/LXDE, Hyprland, Sway and others, but real-world results depend on the desktop environment, display server and installed tools.

## Getting Started

### Using Releases

Most users can download platform builds from [Releases](https://github.com/Little-Tree-Studio/Little-Tree-Wallpaper-Next/releases). On Windows, run `LittleTreeWallpaper.exe` directly.

Online wallpapers, search, web sniffing and AI image generation require a network connection; availability depends on the corresponding third-party services. The project itself does not require an account; some custom image-generation services or wallpaper sources may need their own API keys.

### Running from Source

Requirements:

- Python 3.12 or later
- Node.js 20 or later, plus npm
- [uv](https://docs.astral.sh/uv/) is recommended
- Windows dynamic wallpapers require Windows 10/11 with a working Explorer desktop

Run all commands from the repository root.

1. Clone the repository:

```powershell
git clone https://github.com/Little-Tree-Studio/Little-Tree-Wallpaper-Next.git
cd Little-Tree-Wallpaper-Next
```

2. Install and build the frontend:

```powershell
npm install --prefix frontend
npm run build --prefix frontend
```

3. Install backend dependencies:

```powershell
uv sync --project backend --group dev --no-install-project
```

`--no-install-project` only syncs app dependencies; the source code is imported directly from the repository root.

Without uv, create a virtual environment and install from the requirements file:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
```

4. Start the app:

With uv:

```powershell
uv run --project backend --no-sync python -m backend.main
```

With a local virtual environment:

```powershell
.\.venv\Scripts\python -m backend.main
```

The backend picks a random free port on `127.0.0.1` and then opens the LumiView application window. A standalone frontend dev server cannot replace the desktop entry because most features depend on the local backend API.

To hide the beta watermark in the bottom-right corner for the current process, append `--no-watermark` to the launch command or release executable. This flag does not modify persistent settings nor dismiss the beta warning dialog.

## Development & Testing

### Frontend

```powershell
npm run dev --prefix frontend
npm run test:ci --prefix frontend
npm run build --prefix frontend
npm run preview --prefix frontend
```

The frontend uses React 19, TypeScript, Vite, HeroUI 3, Tailwind CSS 4 and React Router.

### Backend Tests

```powershell
uv run --project backend --no-sync python -m unittest discover -s backend/tests -p "test_*.py"
```

Tests cover the local FastAPI service, settings management, plugins, themes, web sniffing, dynamic wallpapers, automation, the tray and some online sources. Capabilities involving third-party network services or the Windows desktop may still depend on the runtime environment.

### Building the App

A full build syncs build metadata, compiles the frontend and invokes PyInstaller:

```powershell
uv run --project backend --no-sync python tools/build.py
```

Common build options:

```powershell
# Build a stable-channel version
uv run --project backend --no-sync python tools/build.py --build-type stable --built-by pyinstaller

# Reuse an existing frontend/dist and only repackage
uv run --project backend --no-sync python tools/build.py --no-frontend

# Produce a directory artifact (dist/LittleTreeWallpaper/)
uv run --project backend --no-sync python tools/build.py --mode folder

# Produce a directory artifact plus a multilingual NSIS installer (requires NSIS 3)
uv run --project backend --no-sync python tools/build.py --mode installer

# Only preview metadata changes
uv run --project backend --no-sync python tools/build.py --dry-run
```

PyInstaller artifacts land in the root `dist/` directory by default. Builds target the current host platform only; they do not produce executables for every platform at once. See [`docs/TOOLING.md`](docs/TOOLING.md) for metadata syncing, packaging options and plugin packaging details.

## Project Structure

```text
Little-Tree-Wallpaper-Next/
├── backend/             Python backend, desktop entry point, services and tests
│   ├── plugins/         Plugin validation, context and lifecycle management
│   ├── services/        Wallpaper sources, storage, themes, dynamic wallpaper and automation
│   └── tests/           unittest tests
├── frontend/            React + HeroUI frontend
│   ├── public/          App icon and other static assets
│   └── src/             Pages, components, themes, plugin rendering and the API client
├── docs/                Plugin, theme, build tooling and versioning documentation
├── tools/               Metadata syncing, app build and plugin packaging tools
├── build/               Static app metadata
├── build.json           Version and build provenance information
└── build.spec           PyInstaller build configuration
```

## Extension Development

- [Plugin development](docs/PLUGINS.md): `.ltp` format, manifests, permissions, declarative UI, Python lifecycle and packaging limits.
- [Theme system](docs/THEMES.md): `.lttheme` format, semantic colors, background media, font resources and custom CSS.
- [Versioning spec](docs/VERSIONING.md): version formats, comparison rules and release conventions for the app, plugins, themes, wallpaper sources and store resources.
- [Tooling guide](docs/TOOLING.md): build metadata, PyInstaller workflow and reproducible plugin packaging.

### Publishing Store Resources

Extension authors publish themes, wallpaper sources and plugins through the official resources repository: [Little-Tree-Wallpaper-Resources](https://github.com/shu-shu-1/Little-Tree-Wallpaper-Resources). Add your entry TOML (following the templates there) and its assets via a pull request; once merged, they appear in the built-in store.

The store reads `index.json` and TOML metadata from a store source (official source: `https://wallpaper.api.zsxiaoshu.cn`; a custom source can be configured in settings). Each entry needs a download address via `download_path`/`download_url` or `assets`, optionally with `sha256` for install verification. Wallpaper source entries must declare `protocol_version >= 4`; see the [versioning spec](docs/VERSIONING.md).

## Data Directories

The app uses standard per-user directories chosen by `platformdirs`, storing separately:

- Config: app settings, themes and plugin configuration
- Data: downloads, wallpaper sources, plugins and plugin data
- Cache: image cache, logs, sniff results and crash reports

Exact paths can be viewed or opened from the "Settings" and "Help & Feedback" pages. Provider configuration such as API keys is stored in local config files; never commit your personal config directory to the repository or share it with others.

## Important Notes

- **Dynamic wallpapers are Windows-only**: the current implementation relies on undocumented Explorer WorkerW desktop window behavior; Windows updates or Explorer state changes may affect compatibility.
- **Automation depends on the app process**: scheduled tasks run only while Little Tree Wallpaper is running; the "app launch" trigger is not the same as OS autostart.
- **Import advanced automations carefully**: advanced nodes can execute programs, read/write files, open URLs or trigger system power actions; only import `.ltauto` files from trusted sources.
- **Plugins are not sandboxed**: plugin Python code runs with the same current-user permissions as the app and can access files, network, processes and environment variables. There is no digital signing or publisher authentication today; only install trusted, auditable plugins.
- **Themes deserve the same trust**: theme custom CSS applies to the entire app UI, and remote media/fonts may issue network requests; only import trusted themes.
- **Online content is provided by third parties**: content, APIs, rate limits and regional availability may change at any time. Respect the source site's terms and confirm copyright authorization when using or redistributing images.
- **Store content comes from third parties**: themes, wallpaper sources and plugins in the store are provided by their authors; verify trustworthiness before installing. Wallpaper source entries require `protocol_version >= 4`; plugin installation follows the same trust confirmation flow as local imports.

## Feedback & Contributing

- Usage questions and FAQs: [project documentation](https://docs.zsxiaoshu.cn/docs/wallpaper/)
- Bugs and feature requests: [GitHub Issues](https://github.com/Little-Tree-Studio/Little-Tree-Wallpaper-Next/issues)
- Contributing guidelines: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Security policy and vulnerability reporting: [`SECURITY.md`](SECURITY.md)
- Disclaimer: [`DISCLAIMER.md`](DISCLAIMER.md)

When filing an issue, please include the app version, operating system, reproduction steps and logs. Logs and crash reports can be viewed and exported from the "Help & Feedback" page.

<!-- ## Star History

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Little-Tree-Studio/Little-Tree-Wallpaper-Next&type=Date&theme=dark" />
  <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Little-Tree-Studio/Little-Tree-Wallpaper-Next&type=Date" />
  <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Little-Tree-Studio/Little-Tree-Wallpaper-Next&type=Date">
</picture> -->

## License

[`LICENSES`](LICENSES) at the repository root contains the full text of the [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html). When copying, modifying or distributing this project, please comply with its terms.
