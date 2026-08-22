# Security Policy

<p align="center">
  <a href="./SECURITY.md">English</a> | <a href="./SECURITY.zh-CN.md">简体中文</a>
</p>

## Supported Versions

Little Tree Wallpaper Next 2.0 is in beta and only the latest release on each channel receives security fixes.

| Version / channel | Supported |
| --- | --- |
| latest `2.0.x-beta` release | Yes |
| older beta releases | No — please upgrade |
| 1.x (previous generation) | No — separate project lifecycle |

## Reporting a Vulnerability

**Do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose "Report a vulnerability", or contact the maintainers directly at **studio@zsxiaoshu.cn** if you cannot use that form.

When reporting by email, please use a descriptive subject (e.g. `[security] path traversal in favorites import`) and consider encrypting sensitive details; ask for our PGP key if you need one.

Please include:

- Affected version/commit and build channel.
- Platform (OS version) and how the app was installed.
- A minimal reproduction: crafted file, command sequence or network trace.
- Your assessment of impact and any known mitigations.
- Whether you would like public credit.

You can expect an acknowledgment within about 5 business days. We will coordinate a fix and disclosure timeline with you; please keep findings confidential until a fixed release is available. We are happy to credit reporters by name or handle unless you prefer to stay anonymous.

## Scope

The following are considered security issues of this application:

- **Local API protection**: bypassing or weakening the loopback-only binding, the per-launch token, or preview URL authentication; cross-origin access from other local processes or websites.
- **Path traversal / arbitrary file write**: via crafted favorite packs, `.ltwp` projects, theme packages, wallpaper source packages, store downloads, or any import/export path.
- **Code execution without user intent**: parsing bugs in untrusted input handlers (`.ltp` plugin packages, `.ltauto` automations, `.lttheme` themes, store metadata) that lead to code execution before the user has confirmed trust.
- **Privilege escalation or sandbox escape claims**: misrepresentation of what plugins may do versus documented behavior is a docs bug, but broken isolation assumptions inside `backend/plugins/` (e.g. archive entry validation, manifest validation) are vulnerabilities.
- **Secret handling**: leaking API keys, tokens or personal configuration beyond documented storage locations.

### Explicitly out of scope

- **Malicious extensions chosen by the user.** Plugins run as trusted in-process Python with full user permissions; this trust model is documented in [`docs/PLUGINS.md`](docs/PLUGINS.md) and the README notes. Installing a knowingly malicious plugin is not an app vulnerability — but parser or validator bugs that let a package bypass those checks are.
- **Windows breaking undocumented APIs.** Dynamic wallpapers rely on Explorer WorkerW behavior that Microsoft may change at any time; resulting instability is a compatibility issue, not a security flaw.
- **Third-party service availability or content**, including wallpaper/image providers and the resource store's remote content.
- **Social engineering** users into installing malicious themes/plugins/automations, when all documented warnings were shown.
- Reports against end-of-life versions without reproducing on the latest release.

## Security Design Notes

For context when assessing reports:

- The backend FastAPI server binds only to `127.0.0.1` on a random port; every launch generates a fresh access token required by the frontend and media/preview URLs.
- Plugins are Python modules executed in-process after explicit user confirmation; they are **not** sandboxed. Package validation blocks archive traversal, native executables and oversized payloads, but cannot prove code safety.
- Advanced automation nodes can execute arbitrary programs, read/write files, open URLs and trigger power actions; importing `.ltauto` files shows a confirmation flow.
- Theme custom CSS applies globally; remote fonts/media inside themes may issue network requests.

## Public Disclosure

Once a fix ships, we publish a GitHub Security Advisory with affected versions, patched versions and credits. Fixes land first on the latest beta/stable line; we do not backport to old releases while the project remains pre-stable.
