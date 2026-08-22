# 小树壁纸版本规范

本文档描述应用本体、插件、主题、壁纸源和商店资源的版本号格式与比较规则，以 `backend/app_meta.py`、`backend/api.py`（`_version_key`）、`backend/plugins/validation.py`（`VERSION_PATTERN`、`compare_versions`）和 `backend/services/store.py` 的当前行为为准。

## 1. 总体格式

项目整体遵循 [SemVer 2.0.0](https://semver.org/lang/zh-CN/)：

```
主版本.次版本.修订号[-预发布标识][+构建元数据]
```

- **主版本**：不兼容的 API / 数据格式变更。
- **次版本**：向下兼容的功能新增。
- **修订号**：向下兼容的问题修复。
- **预发布标识**：`-` 后接字母数字段，如 `beta1`、`beta.2`；用于测试版发布。
- **构建元数据**：`+` 后接字母数字段，仅作标注，不参与优先级比较。

示例：`2.0.0`、`2.1.0-beta1`、`2.1.0-beta.2+git.abcdef`。

## 2. 应用本体版本

应用版本来自仓库根目录的 `build.json`，由 `backend/app_meta.py` 加载：

| 字段 | 说明 |
| --- | --- |
| `version` | 当前版本号，格式见第 1 节 |
| `build_type` | `stable` 或 `beta`；其他值一律按 `beta` 处理 |
| `build_time` | 构建时间 ISO 8601 |
| `git_commit` | 构建 commit |
| `built_by` | 构建方式（如 `pyinstaller`） |

- 源码直接运行（无 `build.json`）时合成为 `version=0.0.0`、`build_type=beta`。
- `build_type` 是独立的渠道标记，不影响版本号本身的比较。
- 更新检查通过 `check_for_updates(channel)` 拉取更新清单，用 `_version_key` 比较"最新版本"与当前 `VERSION` 判断是否有更新。

## 3. 版本比较规则

项目中存在两处比较实现，语义有差异，使用时注意区分。

### 3.1 更新检查：`_version_key`

位置：`backend/api.py`。用于应用更新检查等通用 SemVer 比较。

解析规则：

- 允许可选前缀 `v`/`V`（如 `v2.1.0`）。
- 核心段为点分隔整数，允许前导零（容错），末尾多余 `.0` 在比较时忽略。
- 预发布标识按 `.` 逐段比较：
  - 纯数字段按**数值**比较（因此 `beta.10 > beta.2`）；
  - 含字母的段按 ASCII 字典序比较（因此 `beta2 > beta1`）；
  - 数字段 < 字母段。
- 正式版 > 同核心版本的任何预发布版（`2.0.0 > 2.0.0-beta1`）。
- 无法解析的输入降级为"提取其中所有数字作为核心 + 整体作为预发布"，保证比较结果确定而不崩溃。

判定示例：

| 左侧 vs 右侧 | 结果 |
| --- | --- |
| `2.0.0-beta2` vs `2.0.0-beta1` | 左侧更新 ✅ |
| `2.0.0` vs `2.0.0-beta1` | 左侧更新 ✅ |
| `2.0.0-beta.10` vs `2.0.0-beta.2` | 左侧更新 ✅（数值段） |
| `2.0.0-beta2` vs `2.0.0-beta10` | 左侧更新（字典序，符合 SemVer 对含字母标识的定义） |
| `2.0.0` vs `2.0.1` | 右侧更新 |

### 3.2 插件版本：`compare_versions`

位置：`backend/plugins/validation.py:416`。用于插件升级/降级检查（`PluginManager.install_package`）。

格式校验 `VERSION_PATTERN`（同文件第 30 行）比更新检查更严格：

- 核心段 1–4 个，每段为不带前导零的非负整数（`(?:0|[1-9][0-9]*)`）。
- 预发布/构建后缀必须以 `-` 或 `+` 开头，后续为由 `.` 或 `-` 连接的字母数字段。
- 不接受 `v` 前缀；不符合格式的版本在安装时直接报错，不做容错比较。

比较规则：

1. 先比较核心段（短侧补零对齐）。
2. 核心 相同时：无后缀 > 有后缀；都无后缀则相等。
3. 都有后缀时：**整个后缀字符串做一次字典序比较**。

已知差异（相对 SemVer）：第 3 步不逐段拆分，因此 `1.0.0-beta.10` 与 `1.0.0-beta.2` 会误判为 `beta.2` 更大。发布插件时应避免使用带点的数字预发布段（推荐 `beta2`、`rc1` 这类写法）；如需修正应将 `compare_versions` 对齐 `_version_key` 的逐段算法。

## 4. 各资源类型的版本要求

### 4.1 插件

- `plugin.json` 的 `version` 必须匹配 `VERSION_PATTERN`（见 3.2）。
- 升级：相同或更高版本可覆盖安装；降级默认拒绝，仅在显式传入 `allow_downgrade=True` 时允许。
- 安装或升级前插件必须处于禁用状态。

### 4.2 主题

- 主题清单中的 `id`、`name` 无版本强制字段要求；导入时会重新生成唯一 ID 并写入 `created_at`/`updated_at`。
- 商店主题条目的 `version` 遵循第 1 节格式，仅作展示与更新提示。

### 4.3 壁纸源

壁纸源有两套独立的"版本"概念，不可混淆：

| 字段 | 格式 | 用途 |
| --- | --- | --- |
| `source.version` | 严格 `X.Y.Z` 三段数字（`backend/services/ltws.py:49`） | 壁纸源自身的语义化版本，创建/更新时校验 |
| `protocol_version` | 单个整数 | 壁纸源协议版本，决定解析器行为 |

**商店协议门槛**：商店中的壁纸源条目只接受 `protocol_version >= 4`（`backend/services/store.py` 的 `MIN_WALLPAPER_SOURCE_PROTOCOL_VERSION`）。低于该值或缺失/非法的条目会在列表加载时被跳过并记录警告，安装请求会被直接拒绝。

### 4.4 商店资源

- 商店元数据 TOML 中的 `version` 遵循第 1 节格式，默认缺省为 `0.0.0`。
- 资源包可附带 `sha256`（顶层或首个 asset），下载后会做完整性校验。
- 商店当前不执行"已安装版本 vs 远端版本"的自动比较；更新检查由对应管理页面的能力决定。
- **插件客户端兼容范围**：插件条目可在 `[plugin]` 表中声明 `min_client_version` 与 `max_client_version`（`max_client_version` 留空表示不限制上限）。从商店安装时以当前应用版本（`app_meta.VERSION`）校验：低于 `min_client_version` 或高于 `max_client_version` 都会拒绝安装并提示原因；无法解析的边界值忽略并记录警告。

## 5. 发布约定

1. 发布正式版时移除预发布后缀并同步更新 `build.json` 的 `version` 与 `build_type`。
2. 测试渠道构建保持 `build_type: beta`，版本可带 `-betaN` 后缀以便用户区分。
3. 插件作者的预发布段建议使用 `beta1`、`beta2`、`rc1` 形式（无点分隔），以规避 3.2 节的字典序限制。
4. 壁纸源作者提交商店时确认 `protocol_version >= 4` 且 `source.version` 为严格三段数字。
