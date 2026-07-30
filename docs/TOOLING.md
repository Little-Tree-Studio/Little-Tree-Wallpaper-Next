# 工具说明

仓库的命令行工具位于 `tools/`：

| 工具 | 用途 |
| --- | --- |
| `tools/sync_meta.py` | 更新 `build.json` 中的构建信息，并同步项目版本号 |
| `tools/build.py` | 依次更新构建信息、构建前端并通过 PyInstaller 打包应用 |
| `tools/plugin_pack.py` | 校验插件源码目录并生成可复现的 `.ltp` 插件包 |

所有命令都应从仓库根目录执行。脚本本身使用 Python 标准库，但完整构建还需要 Node.js、npm、前端依赖和 PyInstaller；插件打包器还需要能够从当前仓库导入 `backend.plugins.validation`。

可通过 `-h` 或 `--help` 查看工具的命令行帮助：

```powershell
python tools/sync_meta.py --help
python tools/build.py --help
python tools/plugin_pack.py --help
```

## 元数据同步：`tools/sync_meta.py`

`build.json` 是版本号和构建来源信息的唯一数据源。工具每次运行都会读取并更新该文件，然后把版本号同步到以下文件：

| 文件 | 同步内容 |
| --- | --- |
| `backend/pyproject.toml` | `[project]` 表中的 `version` |
| `frontend/package.json` | 顶层 `version` |

当前 `build.json` 包含以下字段：

| 字段 | 说明 |
| --- | --- |
| `version` | 应用版本号 |
| `build_type` | 构建渠道，仅支持 `beta` 或 `stable` |
| `build_time` | 构建时间；默认写入本地时区的当前时间，精确到秒 |
| `git_commit` | Git 提交短哈希；默认读取当前仓库的 `HEAD` |
| `built_by` | 构建来源，例如 `manual`、`ci` 或 `pyinstaller` |

### 项目版本号规范

本节规范适用于小树壁纸 Next 应用本身。插件的 `plugin.json.version` 和自定义壁纸源版本属于各自的数据格式，不跟随项目版本号递增。

项目版本号采用三段式语义化版本：

```text
MAJOR.MINOR.PATCH
```

例如 `2.0.0`、`2.1.0`、`2.1.3`。各段必须是十进制非负整数，不得省略，不得包含前导零；项目版本不得添加 `v` 前缀、预发布后缀或构建元数据。因此 `2.1`、`02.1.0`、`v2.1.0`、`2.1.0-beta.1` 和 `2.1.0+ci.5` 均不符合项目规范。

| 版本段 | 递增条件 | 示例 |
| --- | --- | --- |
| `MAJOR` | 存在面向用户、配置、数据格式、扩展接口或自动化接口的不兼容变更 | `2.4.3` → `3.0.0` |
| `MINOR` | 以向后兼容方式增加功能，或显著扩展现有能力 | `2.4.3` → `2.5.0` |
| `PATCH` | 修复缺陷、安全问题或进行不改变兼容接口的小幅改进 | `2.4.3` → `2.4.4` |

递增 `MAJOR` 时必须把 `MINOR` 和 `PATCH` 归零；递增 `MINOR` 时必须把 `PATCH` 归零。只有文档、注释、测试或构建流程变化且不产生新的用户发行物时，可以不提升版本。

项目使用 `build_type` 表示发布渠道，而不把渠道写入 `version`：

| `version` | `build_type` | 含义 |
| --- | --- | --- |
| `2.1.0` | `beta` | 2.1.0 功能线的测试构建，界面显示 Beta 提示 |
| `2.1.0` | `stable` | 2.1.0 正式稳定发行版 |

同一目标版本可以先发布一个或多个 Beta 构建，再发布 Stable 构建。相同版本的不同 Beta 构建由 `git_commit` 和 `build_time` 区分，不定义额外的版本优先级。已经公开发布的 Stable 产物不得用不同代码静默覆盖；如需修复，应提升 `PATCH` 并发布新版本。

版本管理还必须遵循以下规则：

1. `build.json` 是项目版本的唯一修改入口，不直接单独修改 `backend/pyproject.toml` 或 `frontend/package.json`。
2. 三个文件中的版本在提交和构建前必须保持一致。
3. 版本只能向前递增，不得复用已经公开发布的版本号，也不得在主分支回退版本。
4. 一次发布只包含一个版本提升；版本变更应在构建前完成并提交。
5. `beta` 和 `stable` 只表示渠道，不改变 `MAJOR.MINOR.PATCH` 的递增规则。

推荐使用 `tools/sync_meta.py --bump` 完成标准递增。需要跳转到指定版本时可以使用 `--version`，但调用方必须自行确保值符合上述规范，因为工具当前不会校验显式传入的版本格式。

### 常用命令

```powershell
# 刷新构建时间和 Git 提交，并同步版本号
python tools/sync_meta.py

# 只预览结果，不写入任何文件
python tools/sync_meta.py --dry-run

# 按 SemVer 规则提升版本号
python tools/sync_meta.py --bump patch
python tools/sync_meta.py --bump minor
python tools/sync_meta.py --bump major

# 直接指定版本号
python tools/sync_meta.py --version 2.1.0

# 设置构建渠道和构建来源
python tools/sync_meta.py --build-type stable --built-by ci

# 显式指定全部构建来源信息
python tools/sync_meta.py `
  --version 2.1.0 `
  --build-type stable `
  --build-time 2026-07-31T00:30:00+08:00 `
  --git 85f6de9 `
  --built-by ci
```

### 参数

| 参数 | 说明 |
| --- | --- |
| `--version VERSION` | 直接设置版本号 |
| `--bump major\|minor\|patch` | 在当前版本基础上提升主版本、次版本或修订版本 |
| `--build-type beta\|stable` | 设置构建渠道 |
| `--build-time TIME` | 设置构建时间；未提供时使用当前时间 |
| `--git COMMIT` | 设置提交标识；未提供时尝试读取当前 Git 短哈希 |
| `--built-by WHO` | 设置构建来源 |
| `--dry-run` | 打印将要同步的内容，但不写文件 |

`--bump` 与 `--version` 互斥。`--bump` 的解析器兼容带预发布或构建后缀的 SemVer；提升版本时会移除这些后缀，例如 `2.0.0-beta.1+dev` 执行 `--bump patch` 后得到 `2.0.1`。这是工具的兼容行为，不代表项目允许使用带后缀的版本号。直接使用 `--version` 时，脚本当前不会额外校验版本格式。

未显式传入 `--git` 时，如果 Git 命令不可用、超时或执行失败，工具会保留 `build.json` 中已有的 `git_commit`。未传入 `--built-by` 时也会保留原值；原值不存在时使用 `manual`。如果 `build_type` 缺失或为空，则默认使用 `beta`。

> 每次运行都会刷新 `build_time`，包括只传入版本参数时。需要保留特定时间应同时传入 `--build-time`。

### 版本发布约定

版本提升属于发布步骤，不属于构建步骤。推荐先同步并提交版本变更，再执行构建：

```powershell
python tools/sync_meta.py --bump patch
git add build.json backend/pyproject.toml frontend/package.json
git commit -m "Bump version to 2.0.1"

python tools/build.py --build-type stable --built-by pyinstaller
```

`tools/build.py` 不会自动提升版本，只会保留当前版本，或在调用方明确传入 `--version` 时覆盖版本。

## 应用构建：`tools/build.py`

该工具封装了应用发布构建流程：

1. 调用 `tools/sync_meta.py` 更新构建信息和版本文件。
2. 如未跳过前端，检查 `frontend/node_modules`。目录不存在且未启用离线模式时，执行 `npm install --no-audit --no-fund`。
3. 执行 `npm run build`，由 TypeScript 和 Vite 生成 `frontend/dist`。
4. 确认仓库根目录存在 `build.spec`。
5. 执行 `python -m PyInstaller --noconfirm --clean build.spec`。

任一子命令返回非零状态时，构建工具会立即以相同状态退出。找不到外部命令时退出码为 `127`。

### 环境要求

- 项目要求的 Python 环境及后端依赖。
- Node.js 和 npm。
- PyInstaller；开发依赖定义在 `backend/pyproject.toml` 的 `dev` 依赖组中。
- 已提交到仓库根目录的 `build.spec`。

工具不会自动安装 PyInstaller，不会在缺少 PyInstaller 时回退构建 wheel，也不会自动生成 `build.spec`。

### 常用命令

```powershell
# 完整构建：更新元数据、构建前端、生成可执行文件
python tools/build.py

# 标记为稳定版，并记录构建来源
python tools/build.py --build-type stable --built-by pyinstaller

# 使用已有的 frontend/dist，只重新打包应用
python tools/build.py --no-frontend

# 仅更新元数据，不构建前端和可执行文件
python tools/build.py --no-binary

# 不执行 npm install，但仍执行 npm run build
python tools/build.py --offline-frontend

# 只预览元数据变化；不会执行前端或 PyInstaller 构建
python tools/build.py --dry-run
```

### 参数

| 参数 | 说明 |
| --- | --- |
| `--version VERSION` | 传递给 `sync_meta.py`，直接设置版本号 |
| `--build-type beta\|stable` | 设置构建渠道 |
| `--built-by WHO` | 设置构建来源 |
| `--no-frontend` | 跳过前端依赖安装和前端构建，继续执行 PyInstaller |
| `--no-binary` | 更新元数据后立即结束，同时跳过前端和 PyInstaller |
| `--offline-frontend` | 无条件跳过 `npm install`，但仍执行 `npm run build` |
| `--dry-run` | 仅预览元数据变化，同时跳过前端和 PyInstaller |

`--offline-frontend` 不会提供离线依赖，也不会检查依赖是否完整；使用它之前应确保 `frontend/node_modules` 已经可用。`--no-frontend` 会直接使用现有的 `frontend/dist`，因此该目录应包含与当前源码和版本匹配的前端产物。

### PyInstaller 产物

当前 `build.spec` 以 `backend/main.py` 为入口，生成单文件、无控制台窗口的应用。默认输出到仓库根目录的 `dist/`：

| 平台 | 可执行文件名称 |
| --- | --- |
| Windows | `dist/LittleTreeWallpaper.exe` |
| macOS / Linux | `dist/小树壁纸 Next` |

Spec 会打包以下数据：

- `build.json`
- `backend/README.md`
- `frontend/dist`

它还声明了 pywebview、Windows 通知及各平台 GUI 后端所需的隐藏导入。Windows 图标来自 `frontend/dist/logo.ico`；其他平台不设置图标。若前端产物或图标缺失，PyInstaller 可能直接构建失败，因此正式打包通常不应跳过前端构建。

## 插件打包：`tools/plugin_pack.py`

插件打包器接收一个源码目录，校验其中的 `plugin.json`、Python 模块和静态图片，然后生成确定性的 `.ltp` 文件。`.ltp` 本质上是经过严格约束和复检的 Deflate ZIP 包。

```powershell
# 输出到当前目录，文件名为 <插件 ID>-<版本>.ltp
python tools/plugin_pack.py examples/plugins/complete-example

# 指定输出路径
python tools/plugin_pack.py examples/plugins/complete-example -o C:\Temp\complete-example.ltp
```

### 参数与输出

| 参数 | 说明 |
| --- | --- |
| `source_dir` | 插件源码目录；根目录必须包含 `plugin.json` |
| `-o PATH`、`--output PATH` | 输出文件路径；扩展名必须是 `.ltp` |

未指定输出路径时，工具在当前工作目录生成 `<id>-<version>.ltp`。指定的输出目录如果不存在，工具只会创建最后一级目录，不会递归创建多级父目录。已有的同名文件会在打包和复检成功后被原子替换。

成功时输出插件 ID、版本、包字节的 SHA-256 以及绝对输出路径：

```text
id: com.littletree.complete-example
version: 1.0.0
sha256: <64 位十六进制摘要>
output: C:\path\to\com.littletree.complete-example-1.0.0.ltp
```

校验或写入失败时，错误信息写入标准错误，进程返回 `1`，且不会用未通过校验的临时包替换目标文件。

### 打包流程

1. 拒绝不存在的源码目录、符号链接、Windows junction、特殊文件和不安全路径。
2. 按不区分大小写的方式检查路径冲突，并限制文件数量及大小。
3. 读取 UTF-8 编码的 `plugin.json`，调用 `backend.plugins.validation.validate_manifest` 校验清单、权限、入口模块、贡献项和资源引用。
4. 按相对路径排序文件，以 Deflate 最高压缩级别写入同目录临时包。
5. 将每个条目的时间固定为 `1980-01-01 00:00:00`，权限规范化为非执行普通文件 `0644`。
6. 调用 `backend.plugins.validation.read_package` 重新校验最终包，包括图片签名和压缩包结构。
7. 计算最终包的 SHA-256，并通过 `os.replace` 原子写入目标路径。

相同源码字节在相同 Python 和 zlib 实现下应生成相同包，适合由 CI 复现并发布。SHA-256 只能用于核对包字节，不代表数字签名或作者身份。

### 源目录限制

| 项目 | 限制 |
| --- | --- |
| 最终 `.ltp` 大小 | 最大 10 MiB |
| 解压后文件总大小 | 最大 20 MiB |
| 文件条目数量 | 最大 256 个 |
| 单个文件大小 | 最大 4 MiB |
| `plugin.json` 大小 | 最大 64 KiB |
| 相对路径长度 | 最大 240 个字符 |

允许打包的文件只有：

- 根目录的 `plugin.json`
- Python 源文件 `.py`
- 静态图片 `.gif`、`.jpeg`、`.jpg`、`.png`、`.webp`

包内相对路径的每一级只能使用 ASCII 字母、数字、点、下划线和连字符，并且不能使用 Windows 保留名称。工具拒绝符号链接、junction、可执行文件、原生库、脚本文件和其他文件类型；最终包复检还会拒绝加密条目或不受支持的压缩方式。详细的插件清单、权限及 UI contribution 规范见 [`docs/PLUGINS.md`](PLUGINS.md)。

## 推荐工作流

### 日常开发构建

```powershell
python tools/build.py
```

### 正式版本构建

```powershell
# 先提升并提交版本
python tools/sync_meta.py --bump patch

# 再从已确定的提交构建稳定版
python tools/build.py --build-type stable --built-by pyinstaller
```

### 插件发布

```powershell
python tools/plugin_pack.py path\to\plugin-source -o dist\plugin-id-1.0.0.ltp
```

发布前应保存工具输出的 SHA-256，并在独立可信渠道公布摘要。插件会以与应用相同的操作系统和 Python 权限在进程内执行；包校验不是安全沙箱，只应安装和启用可信、可审计的插件。
