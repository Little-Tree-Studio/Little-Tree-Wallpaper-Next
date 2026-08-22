# Disclaimer

<p align="center">
  <a href="./DISCLAIMER.md">English</a> | <a href="./DISCLAIMER.zh-CN.md">简体中文</a>
</p>

This disclaimer applies to the Little Tree Wallpaper Next application, its source code, and all content distributed through its built-in resource store. Both the English and Simplified Chinese versions carry the same meaning; in case of discrepancy, the English version prevails.

## No Warranty

Little Tree Wallpaper Next is provided **"as is"**, without warranty of any kind, express or implied — including but not limited to the warranties of merchantability, fitness for a particular purpose and non-infringement. Sections 15 through 17 of the [GNU Affero General Public License v3.0](LICENSES) govern limitation of warranties and liability. The entire risk as to the quality and performance of the program is with you.

## Beta Software

The 2.0 line is under active beta development. Features, configuration files, extension formats (`plugin`, `theme`, `wallpaper source`, automation) and APIs may change at any time in incompatible ways. Data loss, broken extensions and unexpected behavior are possible; do not rely on beta builds in critical environments and keep backups of important data.

## Third-Party Services and Content

- Online wallpapers, image search, web sniffing, AI image generation and the resource store depend on **third-party services** (e.g. Bing, Windows Spotlight, Pixiv, Pexels, Baidu, CNU, Pollinations, models.dev providers). The project does not control their availability, rate limits, content or terms of service; they may change or disappear at any time.
- Content downloaded or displayed by the app is owned by its respective authors or rights holders. **You are solely responsible** for ensuring your use, storage and redistribution of such content complies with applicable licenses, terms of service and copyright law.
- This project is an independent work and is **not affiliated with, endorsed by, or sponsored by** Microsoft, Baidu, Pixiv, Pexels, or any other provider whose services may be integrated. All trademarks belong to their respective owners.

## Plugins, Themes and Automations

- **Plugins are trusted code, not sandboxed.** A plugin executes Python inside the app process with the same permissions as the current user: it can access files, network, processes and environment variables. Only install plugins from sources you trust and are able to audit.
- **Themes apply global custom CSS** and may reference remote fonts or media that issue network requests. Only import themes you trust.
- **Advanced automations can execute programs**, read/write files, open URLs and trigger system power actions. Review `.ltauto` files before importing them.
- The built-in resource store distributes content provided by third-party authors. The project provides the distribution mechanism but does not continuously audit every published item; verify trustworthiness before installing.

## Dynamic Desktop Feature

Dynamic wallpapers on Windows rely on undocumented Explorer WorkerW desktop window behavior. Windows updates or unusual Explorer states may cause visual glitches, performance impact or a black desktop until the feature is toggled off. Use of this feature is at your own risk.

## Automation Features

Scheduled wallpaper switching runs only while the application is running. "App launch" triggers are not OS autostart entries, and no component of this project installs persistence beyond what is explicitly shown to the user in settings.

## Limitation of Liability

To the maximum extent permitted by applicable law, in no event shall the copyright holders or contributors be liable for any direct, indirect, incidental, special, exemplary or consequential damages (including, but not limited to, procurement of substitute goods or services, loss of use, data or profits) arising in any way out of the use of this software, however caused and on any theory of liability.

## Contact

General inquiries: **studio@zsxiaoshu.cn**. Security issues: see [`SECURITY.md`](SECURITY.md). Bugs and feature requests: [GitHub Issues](https://github.com/Little-Tree-Studio/Little-Tree-Wallpaper-Next/issues).
