# Tooling

The repository ships a small but complete toolchain under ``tools/``. All
three tools are dependency-free (Python standard library only) so they run
unmodified on any developer machine, in CI, or inside a stripped-down
container.

## `tools/sync_meta.py` — single source of truth synchroniser

The project root ``build.json`` is the **only** place where the application
version, build type, build time, git commit, app name, description,
author and repo URL are written. Every other metadata file in the repo
derives from it via this tool:

| Target                | Fields written                                |
|-----------------------|-----------------------------------------------|
| `backend/pyproject.toml`   | `project.version`, `project.description` |
| `backend/app_meta.py`      | `_fallback_metadata()` block (used when `build.json` is missing at runtime, e.g. an installed wheel) |
| `frontend/package.json`    | `version`                                |

### Common invocations

```bash
# Refresh build_time + git_commit (no version change), sync all targets.
python tools/sync_meta.py

# Dry-run: print planned changes without writing anything.
python tools/sync_meta.py --dry-run

# Bump the version (release engineering step — see below for the
# relationship with tools/build.py).
python tools/sync_meta.py --bump patch
python tools/sync_meta.py --bump minor
python tools/sync_meta.py --bump major

# Override the version with an explicit SemVer string.
python tools/sync_meta.py --version 2.1.0

# Mark the build as stable and record how it was produced.
python tools/sync_meta.py --build-type stable --built-by ci

# Set explicit values (overrides everything).
python tools/sync_meta.py \
    --version 2.1.0 \
    --build-type beta \
    --build-time 2026-06-23T14:00:00+08:00 \
    --git "$(git rev-parse --short HEAD)" \
    --note "channel=nightly"

# Free-form extra top-level keys (e.g. for an undocumented channel tag).
python tools/sync_meta.py --note channel=nightly --note flavor=oss
```

### How it works

1. Reads ``build.json``.
2. Applies the requested mutations (bump / set / now / git).
3. Writes ``build.json`` back (unless ``--dry-run``).
4. Re-writes the three downstream files using regex / JSON-aware
   replacements; if a target is unchanged, the file is left untouched so
   the working tree stays clean for ``git status`` / ``git diff``.

### CI integration

The recommended CI flow is:

```bash
python tools/sync_meta.py --build-type stable --built-by ci
```

The script exits non-zero on parse errors so a malformed ``build.json``
fails the build immediately. It is safe to call on every commit because
it only writes when values actually change.

> **Versioning is a release-engineering step, not a build step.**
> `tools/build.py` deliberately does **not** bump the version. Manage
> version changes ahead of time with `tools/sync_meta.py --bump` (or by
> editing `build.json` by hand) and commit them, *then* run the build
> pipeline. This keeps a botched build from accidentally promoting
> `2.0.0` to `2.0.1` and shipping.

## `tools/build.py` — end-to-end build pipeline

One command does everything needed to produce a shippable artifact:

```bash
# Full pipeline: stamp provenance, build frontend, then PyInstaller.
python tools/build.py

# Stable release for the current commit.
python tools/build.py --build-type stable --built-by pyinstaller

# Iterate on the binary without rebuilding the npm bundle.
python tools/build.py --no-frontend

# Only stamp provenance (handy for a quick metadata refresh).
python tools/build.py --no-binary

# Preview what would change.
python tools/build.py --dry-run
```

**Versioning is deliberately a separate step.** The build pipeline never
auto-bumps ``build.json``'s version field; that decision is owned by
release engineering and happens *before* the build runs:

```bash
# 1. Bump the version and commit.
python tools/sync_meta.py --bump patch
git add build.json && git commit -m 'bump 2.0.1'

# 2. Then build the release.
python tools/build.py --build-type stable --built-by pyinstaller
```

### Pipeline steps (in order)

1. **Stamp build provenance** — runs ``tools/sync_meta.py`` with only the
   non-version flags (``--build-type``, ``--built-by``, optionally
   ``--version`` for an explicit override). The version is **never**
   auto-bumped; release engineering manages that step separately.
2. **Build the frontend** — ``npm install`` (if needed) then ``npm run
   build``, producing ``frontend/dist``.
3. **Produce the binary**:
   - If PyInstaller is installed: generates ``build.spec`` (if missing)
     and runs ``pyinstaller --noconfirm --clean build.spec``. The
     resulting ``dist/小树壁纸 Next`` (or ``dist/LittleTreeWallpaper``
     on Windows) is a single-file executable.
   - If PyInstaller is **not** installed: falls back to
     ``python -m build --wheel`` so the same command can still publish
     a ``pip``-installable artifact (useful for Linux CI without GUI
     requirements).

### What gets bundled into the binary

The auto-generated ``build.spec`` (committed on first build, then edited
in place) bundles:

- The Python source tree (via PyInstaller's analyser).
- ``build.json`` — **required** for ``backend.app_meta`` to find the
  current version at runtime.
- ``backend/README.md`` — keeps the package self-describing.
- ``frontend/dist/`` — the static SPA bundle served by FastAPI.
- A short list of optional native modules that ``pywebview`` needs
  (``win32com``, ``AppKit``, ``gi``, …) so PyInstaller doesn't drop them.

### Icon handling

The spec points at ``frontend/dist/logo.ico`` on Windows and at no icon
on macOS / Linux. Generate the ICO once with your tool of choice and
commit it next to ``logo.png``.

## How the bits fit together

```
                       build.json  (project root)
                            │
              ┌─────────────┴─────────────┐
              │                           │
   tools/sync_meta.py                edit by hand
   (--bump / --version)            (commit before building)
              │                           │
              └─────────────┬─────────────┘
                            │
                            │  tools/sync_meta.py (no flags)
                            ▼
   ┌──────────────┬──────────────────────┬──────────────────┐
   │ pyproject    │  backend/app_meta    │ frontend/        │
   │ .toml        │  .py fallback        │ package.json     │
   └──────────────┴──────────────────────┴──────────────────┘
                            │
                            │  tools/build.py
                            ▼
                     PyInstaller / wheel
                            │
                            ▼
                  dist/小树壁纸 Next (or wheel)
                            │
                            │  read at startup by
                            ▼
                  backend/app_meta  →  get_build_info RPC
                                              │
                                              ▼
                                    frontend (App.tsx)
                                       ├─ BetaWarningModal
                                       └─ BetaWatermark
```

**Two rules of thumb:**

1. **Version bumps happen before builds.** ``tools/sync_meta.py --bump``
   mutates ``build.json`` and is the only supported way to change the
   version. Commit the result, then run ``tools/build.py``.
2. **The build script never edits the version.** ``tools/build.py`` only
   refreshes ``build_time`` / ``git_commit`` / ``built_by`` (and accepts an
   explicit ``--version`` override for callers that already know the
   target version from a git tag).
