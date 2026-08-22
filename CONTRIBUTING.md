# Contributing to Little Tree Wallpaper Next

<p align="center">
  <a href="./CONTRIBUTING.md">English</a> | <a href="./CONTRIBUTING.zh-CN.md">简体中文</a>
</p>

Thank you for considering contributing! This document explains how to report issues, propose changes and submit code. The project is in beta: APIs and extension formats may still change, which is exactly why early feedback matters.

## Ways to Contribute

- **Bug reports** — something crashes, renders wrongly or behaves unexpectedly.
- **Feature proposals** — describe the problem first, then your suggested solution.
- **Documentation** — fix mistakes or gaps in [`docs/`](docs/) and the READMEs.
- **Translations** — improve the English or Simplified Chinese texts (`README`, `CONTRIBUTING`, `SECURITY`, `DISCLAIMER`).
- **Extensions** — build plugins, themes or wallpaper sources and publish them to the resource store.

## Reporting Bugs

Open a [GitHub Issue](https://github.com/Little-Tree-Studio/Little-Tree-Wallpaper-Next/issues) and include:

1. App version and channel (shown in "Help & Feedback"; also recorded in `build.json`).
2. Operating system and version (Windows edition/build matters for dynamic wallpapers).
3. Steps to reproduce, expected result and actual result.
4. Relevant log excerpts — logs and crash reports can be exported from the "Help & Feedback" page.

Search existing issues before filing a duplicate. For security-sensitive reports, use [private vulnerability reporting](SECURITY.md) instead of a public issue.

## Suggesting Features

Feature requests should start from the user problem: what you are trying to achieve, what you tried, and why existing options fall short. Maintainable, cross-platform solutions are more likely to be accepted than highly platform-specific hacks.

## Development Setup

Follow ["Running from Source"](README.md#running-from-source) in the README. In short:

- Python 3.12+, Node.js 20+, [uv](https://docs.astral.sh/uv/) recommended.
- Backend tests: `uv run --project backend --no-sync python -m unittest discover -s backend/tests -p "test_*.py"`.
- Frontend checks: `npm run test:ci --prefix frontend`, then `npm run build --prefix frontend`.
- Lint backend changes with `ruff check`.

Repository-specific notes for agents and humans live in [`AGENTS.md`](AGENTS.md): frontend changes must end with a production build, prefer HeroUI default styles, and consult its docs before using HeroUI components.

## Submitting Changes

1. Fork the repository and create a topic branch (e.g. `feat/store-filters` or `fix/tray-race`).
2. Keep each pull request focused on one topic; unrelated refactors belong in their own PR.
3. Write descriptive commit messages in imperative mood ("Add store protocol gate", not "update").
4. Add or adjust tests when fixing a bug or changing behavior. Tests that fail without the change and pass with it are ideal.
5. Ensure CI passes locally: backend unit tests, frontend test suite and frontend build.
6. Update documentation when behavior, formats or workflows change ([`docs/PLUGINS.md`](docs/PLUGINS.md), [`docs/THEMES.md`](docs/THEMES.md), [`docs/VERSIONING.md`](docs/VERSIONING.md), [`docs/TOOLING.md`](docs/TOOLING.md)).

Pull requests will be reviewed with an eye on correctness, security implications (see below) and long-term maintainability. Small, well-explained PRs get reviewed fastest.

## Security-Sensitive Contributions

Code touching any of these areas requires extra care — please explain threat models in the PR description:

- Local API authentication (loopback server, per-launch token).
- Parsing of untrusted input: favorite packs, `.ltp`/`.lttheme`/`.ltauto` files, wallpaper source packages, store metadata and downloads.
- Plugin loading and lifecycle (`backend/plugins/`).
- Anything executing external programs (advanced automation nodes).

Do not introduce dependencies that phone home silently, and never commit secrets or personal configuration.

## Extension Authors

If you contribute plugins, themes or wallpaper sources:

- Publish store entries through the official resources repository: [Little-Tree-Wallpaper-Resources](https://github.com/shu-shu-1/Little-Tree-Wallpaper-Resources) (submit a pull request following its metadata templates).
- Follow the formats and limits in [`docs/PLUGINS.md`](docs/PLUGINS.md), [`docs/THEMES.md`](docs/THEMES.md) and the store metadata templates.
- Version numbers must satisfy the [versioning spec](docs/VERSIONING.md); wallpaper sources require `protocol_version >= 4`.
- Do not obfuscate plugin code. Users are asked to trust and audit what they install.

## License

By contributing, you agree that your contributions are licensed under the [GNU Affero General Public License v3.0](LICENSES), the project's license.
