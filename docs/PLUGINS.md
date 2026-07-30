# 小树壁纸插件开发

本文档对应插件清单 `schema_version: 1`，以 `backend/plugins/validation.py`、`context.py` 和 `manager.py` 的当前行为为准。完整可打包示例位于 `examples/plugins/complete-example/`。

## 1. 架构与信任边界

插件由三个层次组成：

- `.ltp` 包：安装和升级时使用的 ZIP 文件。
- `plugin.json`：声明身份、权限和受限 UI contribution。
- Python 入口：启用时由 `PluginManager` 载入应用进程，并通过 `PluginContext` 注册动作和生命周期对象。

**插件是受信任的进程内 Python 代码。安装和启用插件前必须由用户明确确认信任其来源和代码。** 插件与应用具有相同的操作系统用户权限，可以导入 Python 模块、访问文件、网络、进程和环境变量。清单中的 `permissions` 只校验 UI contribution 是否经过声明，不是操作系统权限控制，也不是沙箱。

包校验可以阻止目录穿越、符号链接、原生可执行文件和部分错误资源，但不能证明 Python 代码安全。当前实现没有签名或发布者认证、依赖自动安装、虚拟环境、进程隔离、网络隔离、热加载 JavaScript，也不接受 JavaScript 文件。

## 2. 安装与生命周期工作流

宿主管理层使用 `PluginManager` 完成以下流程：

1. 用户选择 `.ltp` 并确认信任来源。
2. `install_package(path)` 读取整个包、计算 SHA-256、校验 ZIP 和清单，再原子地替换插件安装目录。新安装插件默认禁用。
3. `set_enabled(id, True)` 载入模块，调用 `setup(context)`，再调用返回对象的可选 `on_start(context)`。只有全部完成并通过动作引用检查后，插件才进入 `started` 状态。
4. `set_enabled(id, False)` 调用可选 `on_stop(context)`，移除运行时模块、动作和 contribution 快照，但保留插件文件与持久设置。
5. `remove(id)` 只允许删除已禁用插件，并同时删除其安装目录、数据、配置和缓存目录。

应用启动时，管理器从配置中的启用列表发现插件；宿主调用 `start_enabled()` 后逐个启动，单个插件失败不会阻止其他插件。`reload(id)` 会先停止并卸载，再按启用状态重新载入。应用关闭时 `shutdown()` 停止所有已启动插件。

升级前必须先禁用插件。相同或更高版本可以覆盖安装；降级默认拒绝，宿主只有显式传入 `allow_downgrade=True` 才能降级。安装过程保留已有的启用状态，但由于启用插件不能升级，正常升级时该状态为禁用。不要把重载理解为 JavaScript 热更新：它只是重新执行 Python 入口并重建运行时状态。

## 3. `.ltp` 格式与限制

`.ltp` 本质是 ZIP，路径分隔符统一为 `/`。`plugin.json` 必须位于压缩包根目录；入口模块可以位于子目录。允许的文件只有：

- 根目录的 `plugin.json`。
- 扩展名为 `.py` 的 Python 源文件。
- `.gif`、`.jpeg`、`.jpg`、`.png`、`.webp` 图片；安装校验会检查文件头，WebP 还会检查 `WEBP` 标记。

不允许绝对路径、Windows 驱动器路径、空路径段、`.`、`..`、反斜杠、NUL、大小写不敏感的重复路径、加密条目、符号链接、特殊文件、带可执行权限的 ZIP 文件，以及脚本、字节码、原生库或安装包等可执行格式。ZIP 只接受 Stored 或 Deflate 压缩。

限制如下：

| 项目 | 限制 |
| --- | ---: |
| `.ltp` 压缩后大小 | 10 MiB |
| 解压后文件总大小 | 20 MiB |
| ZIP 条目数 | 256 |
| 单文件大小 | 4 MiB |
| `plugin.json` | 64 KiB |
| 包内路径长度 | 240 字符 |
| 通用 JSON 值 | 256 KiB |
| action payload | 64 KiB |
| action result | 256 KiB |
| 单条 style CSS | 64 KiB |
| 单个页面或 overlay 的 block 总数 | 64 |
| block 嵌套深度 | 3 |

安装元数据 `.install.json` 由宿主生成，不应放进源目录或包中。安装时包会被整体读入内存；不要接近限制制作不必要的大资源。

## 4. 完整清单示例

下面的示例覆盖所有扩展点。为便于阅读缩短了页面 block；可直接运行的完整版见 `examples/plugins/complete-example/plugin.json`。

```json
{
  "schema_version": 1,
  "id": "com.example.counter",
  "name": "计数器示例",
  "version": "1.0.0",
  "description": "演示插件 API。",
  "author": "Example Author",
  "entrypoint": "module.py:setup",
  "permissions": [
    "ui.buttons",
    "ui.global_style",
    "ui.navigation",
    "ui.overlay",
    "ui.pages",
    "ui.resource_pages",
    "ui.theme"
  ],
  "contributes": {
    "pages": {
      "id": "home",
      "label": "计数器",
      "route": "/plugins/com.example.counter",
      "blocks": [
        {"type": "heading", "text": "计数器", "level": 1},
        {"type": "button", "label": "+1", "action": "increment", "payload": {"step": 1}}
      ]
    },
    "resource_pages": {
      "id": "resources",
      "label": "计数资源",
      "route": "/plugins/com.example.counter/resources",
      "blocks": [{"type": "text", "text": "资源区内容"}]
    },
    "navigation": {"id": "nav", "label": "计数器", "page": "home", "location": "sidebar"},
    "buttons": {"id": "quick-add", "label": "快速 +1", "action": "increment", "location": "global"},
    "overlays": {
      "id": "notice",
      "label": "状态悬浮层",
      "className": "counter-overlay",
      "blocks": [{"type": "text", "text": "插件正在运行"}]
    },
    "styles": [
      {"id": "scoped", "scope": "plugin", "css": ".counter-overlay { width: 100%; }"},
      {"id": "global", "scope": "global", "css": ":root { --counter-installed: 1; }"}
    ],
    "theme": {
      "id": "tokens",
      "label": "计数器变量",
      "variables": {"--counter-accent": "#16845b"}
    }
  }
}
```

每个 contribution kind 可以写成单个对象或对象数组；校验后都会规范化为数组。未知 contribution kind 会被拒绝。`location`、`position`、`fixed` 和 `className` 等宿主字段也会经过类型和值校验，不能用于注入任意布局或脚本。

### 顶层字段完整参考

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `schema_version` | 是 | 必须是整数 `1`，布尔值不算整数。 |
| `id` | 是 | 最长 128；小写字母和数字组成的段，可用 `.`、`_`、`-` 分隔，不能连续或位于首尾。推荐反向域名。 |
| `name` | 是 | 去除首尾空白后非空，最长 120。 |
| `version` | 是 | 1 至 4 段非负十进制整数，可带一个以 `-` 或 `+` 开始的字母数字后缀，例如 `1.2.0-beta.1`。最长 64。 |
| `description` | 是 | 去除首尾空白后非空，最长 1000。 |
| `author` | 是 | 去除首尾空白后非空，最长 160。 |
| `entrypoint` | 否 | 默认 `module.py:setup`；格式为安全相对路径 `path/module.py:callable`，最长 200，文件必须存在。 |
| `permissions` | 是 | 字符串数组，不可重复，只能使用支持的权限。可以为空。 |
| `contributes` | 是 | 对象，可以为空；键是支持的扩展点，值是一个 descriptor 或 descriptor 数组。 |

清单必须是 UTF-8 JSON，只允许有限 JSON 数值，不接受 `NaN`、`Infinity`。验证器目前不会拒绝未知顶层字段，但插件不应依赖它们。

## 5. 权限

| 权限 | 允许的 contribution |
| --- | --- |
| `ui.buttons` | `buttons` |
| `ui.global_style` | `styles` 中的 `scope: "global"` |
| `ui.navigation` | `navigation` |
| `ui.overlay` | `overlays` |
| `ui.pages` | `pages` |
| `ui.resource_pages` | `resource_pages` |
| `ui.theme` | `theme` |
| `ui.widgets` | `widgets` |

`styles` 的默认 `scope` 是 `plugin`，不要求权限。权限必须由清单显式声明；运行时 `context.contribute()` 也使用同一权限集合校验。权限不会限制 Python 代码访问主机，因此用户信任确认不能省略。

## 6. 扩展点

所有 descriptor 都必须有 `id`。ID 最长 80，使用与插件 ID 相同的小写 slug/反向域名规则。每个 kind 内不能重复 ID，`pages` 与 `resource_pages` 之间也不能重名。

### `pages` 与 `resource_pages`

两者都需要：

- `label`：非空显示文字，最长 120。
- `route`：必须位于 `/plugins/<插件 ID>` 命名空间，最长 240；不能含 `..`、百分号、重复斜线或末尾斜线。启用时会拒绝与其他插件重复的路由。
- `blocks`：可省略，默认空数组；格式见下一节。

后端对两者使用相同 block 校验。`resource_pages` 表达“由资源区域承载”的语义，具体入口、布局和路由挂载由宿主前端决定。

### `navigation`

需要 `label`，并至少提供以下一项：

- `route`：直接导航到合法内部路由。
- `page`：引用同一插件在 `pages` 或 `resource_pages` 声明的 ID；未知引用会被拒绝。

若同时提供两者，后端会同时保留。`location: "sidebar"` 等额外布局元数据不由后端验证，只有宿主支持时才产生效果。

### `buttons`

需要 `label` 和 `action`。`action` 必须引用插件启用期间注册的动作；可选 `payload` 必须是 JSON 兼容值且不超过 64 KiB。宿主触发按钮时调用该动作。全局按钮位置属于宿主布局约定，示例使用 `location: "global"`。

### `overlays`

需要 `label`，可包含 `blocks`。`position` 可选 `top-left`、`top-right`、`bottom-left`、`bottom-right`，由宿主固定定位并限制尺寸；插件 CSS 不能自行改变浮层的宿主定位。

### `styles`

需要非空 `css`，UTF-8 大小不超过 64 KiB。`scope` 可为：

- `plugin`：默认值，表达样式只用于插件 UI。
- `global`：表达全局样式，必须声明 `ui.global_style`。

`scope: "plugin"` 由宿主包装进对应 `data-plugin-id` 的 CSS `@scope`，并禁止任何 `@` at-rule，避免注册全局字体、动画或属性。`scope: "global"` 需要高风险权限并按原样注入，因此仍应保持最小化，且必须审查其中的选择器与资源引用。

### `theme`

需要 `label` 和 `variables`。`variables` 最多 128 项；键必须是以 `--` 开头、最长 80 的 CSS 自定义属性名；值只能是字符串或非布尔数字，并拒绝反斜线、注释、at-rule 和标签字符等危险语法。变量在宿主主题之后挂载，禁用插件时移除。建议使用带插件 ID 的变量前缀，避免覆盖 HeroUI 或用户主题变量。

## 7. 页面 block

页面和 overlay 使用同一组声明式 block。它们是 JSON 数据，不是 HTML，也不能携带 JavaScript。每个 descriptor 最多 64 个 block，计数包含嵌套 block，嵌套深度最多 3。

### `widgets`

`widgets` 允许插件向动态壁纸的小组件抽屉注册桌面组件。它需要 `ui.widgets` 权限，并继续使用宿主支持的声明式 block，不允许注入 HTML 或前端 JavaScript。

```json
{
  "id": "weather-card",
  "label": "天气卡片",
  "description": "显示插件提供的天气摘要",
  "default_size": {"width": 28, "height": 20},
  "blocks": [
    {"type": "heading", "text": "今日天气", "level": 3},
    {"type": "text", "text": "晴，24°C"}
  ]
}
```

`default_size.width` 和 `default_size.height` 使用桌面百分比，范围均为 8 到 100。桌面背景层不接收鼠标交互，因此小组件不能包含 `button` block；所有可见内容必须在贡献声明或宿主编辑器中预先确定。

| `type` | 字段与规则 |
| --- | --- |
| `text` | `text` 必填、非空、最长 4000。 |
| `heading` | `text` 同上；`level` 可省略，默认 2，只能为 1 至 6。 |
| `image` | `src` 是包内安全相对图片路径且文件必须存在；`alt` 可选，最长 300。 |
| `card` | `title` 可选、最长 200；`blocks` 可选并递归使用本表。 |
| `button` | `label` 必填、最长 120；`action` 必须引用已注册动作；`payload` 可选，最大 64 KiB。 |
| `divider` | 无必填附加字段。 |

图片 `src` 只能指向 `.gif`、`.jpeg`、`.jpg`、`.png`、`.webp`。不要使用绝对路径、URL、Data URL 或 `..`。当前完整示例不需要图片，因此没有附带占位资源。

## 8. Python `PluginContext` API

入口收到一个窄接口对象，但“窄接口”不等于沙箱。公开属性：

| 属性 | 含义 |
| --- | --- |
| `plugin_id` | 已校验的插件 ID。 |
| `plugin_path` | 插件安装目录，只应读取包内资源。 |
| `data_path` | 插件持久数据目录。移除插件时删除。 |
| `config_path` | 插件配置目录，`settings.json` 位于此处。移除插件时删除。 |
| `cache_path` | 可重建缓存目录。移除插件时删除。 |
| `logger` | 带 `plugin_id` 上下文的标准 Python logger adapter。 |

公开方法：

```python
context.get_setting(key: str, default=None) -> JSONValue
context.set_setting(key: str, value: JSONValue) -> None
context.register_action(action_id: str, callback) -> None
context.contribute(kind: str, descriptor: dict) -> None
```

设置键最长 160，只能由字母、数字、下划线组成的段以 `.` 分隔，例如 `counter.value`。点号创建嵌套对象。值和默认值必须可 JSON 序列化，不允许非字符串对象键、非有限浮点数或自定义对象；读取返回 JSON 副本。设置文件使用临时文件、`fsync` 和原子替换写入，并由进程内锁串行访问。

动作 ID 最长 80，必须唯一。callback 接收一个已经复制并限制到 64 KiB 的 JSON payload，同步返回最大 256 KiB 的 JSON 值。返回 coroutine、自定义对象、字节串或非有限浮点数会导致调用失败。未启用、未完成启动或未知动作也会失败。不要在动作中执行长时间阻塞工作；当前调用路径是同步的。

`context.contribute()` 可以在 `setup` 或 `on_start` 动态追加 descriptor，使用与清单相同的校验和权限。它不能与同 kind、同 ID 的已有清单 contribution 重复。插件启动末尾会再次检查所有页面按钮和全局按钮引用的 action 是否已注册。

## 9. 生命周期与动作完整示例

```python
from typing import Any


class CounterPlugin:
    def on_start(self, context: Any) -> None:
        context.set_setting("lifecycle.starts", context.get_setting("lifecycle.starts", 0) + 1)
        context.logger.info("counter plugin started")

    def on_stop(self, context: Any) -> None:
        context.set_setting("lifecycle.stops", context.get_setting("lifecycle.stops", 0) + 1)


def setup(context: Any) -> CounterPlugin:
    if context.get_setting("counter.value", None) is None:
        context.set_setting("counter.value", 0)

    def increment(payload: Any) -> dict[str, int]:
        request = payload if isinstance(payload, dict) else {}
        step = request.get("step", 1)
        if type(step) is not int:
            raise ValueError("step must be an integer")
        value = context.get_setting("counter.value", 0) + step
        context.set_setting("counter.value", value)
        return {"count": value}

    context.register_action("increment", increment)
    return CounterPlugin()
```

模块执行、`setup` 或 `on_start` 任一阶段抛出异常都会撤销本次运行时对象、动作和 contribution，并把插件状态标记为错误。`on_stop` 异常会被记录，并在清理运行时引用后向管理操作报告错误。生命周期 hook 应可重复执行，不要只依赖模块全局变量；重载会创建新的模块名和对象。

## 10. 样式、主题与启动行为

推荐规则：

- 插件 UI 样式优先使用 `scope: "plugin"`，选择器只针对插件自己声明的类。
- 只有确有跨页面需求时才声明 `ui.global_style` 和 `scope: "global"`；不要覆盖 `body`、通配符或宿主组件内部类。
- CSS 可以发起外部资源请求，且不经过 Python 权限系统；审查插件时必须同时审查 CSS。
- 自定义变量使用 `--<plugin-id>-...` 风格前缀，并为变量缺失准备 CSS fallback。
- 不要依赖 contribution 额外字段自动产生 DOM class 或位置；先确认目标宿主版本的渲染行为。

“开机启动”不是单独的 manifest hook。插件被用户启用后，启用 ID 会持久化；下次应用启动由 `start_enabled()` 载入，并执行正常的 `setup`、`on_start` 流程。插件不得自行写启用状态或绕过用户信任确认。

## 11. 打包

仓库提供确定性打包器；请在已安装项目后端依赖的开发环境中，从仓库根目录运行：

```powershell
python tools/plugin_pack.py examples/plugins/complete-example
python tools/plugin_pack.py examples/plugins/complete-example -o C:\Temp\complete-example.ltp
```

未指定 `-o` 时，输出到当前目录，文件名为 `<id>-<version>.ltp`。工具会：

1. 安全枚举源目录，拒绝符号链接、特殊文件、不支持类型、路径冲突和超限文件。
2. 将仓库根目录加入 `sys.path`，调用 `backend.plugins.validation.validate_manifest` 校验源清单及资源引用。
3. 按路径排序写入 Deflate ZIP，所有条目使用固定时间 `1980-01-01 00:00:00` 和规范化只读非执行权限 `0644`。
4. 再调用 `read_package` 校验最终字节，使用同目录临时文件和 `os.replace` 原子写入目标。
5. 输出插件 ID、版本、包 SHA-256 和绝对输出路径。

同一 Python/zlib 实现、相同源文件字节应生成相同包。不要把生成的 `.ltp` 提交到示例源目录；发布物应由 CI 或发布流程单独保存。

## 12. 调试与版本升级

- 先运行打包器；清单、图片签名、权限、action 引用中的大部分错误会在打包或启用阶段给出明确消息。
- 查看 `backend.plugins` 日志和插件 `context.logger` 输出。管理结果中的 `state`、`status`、`error` 用于区分禁用、已启动和错误。
- contribution 只有在插件成功启动后才出现在运行时快照中。安装成功不代表 Python 入口已经执行。
- 修改 Python 或清单后重新打包，禁用旧版本，再安装并启用新版本。不要直接编辑用户安装目录。
- 每次发布提升 `version`。正式版本高于带后缀版本；当前比较器按数字 release 段比较，再对完整后缀做字符串比较，不是完整 SemVer 优先级实现。
- `package_hash` 是 `.ltp` 原始字节的 SHA-256，可用于人工核对下载与安装结果，但它不是数字签名，也不能证明作者身份。
- 插件不能声明或自动安装第三方依赖。若代码依赖宿主环境中偶然存在的包，会导致不可移植；优先使用标准库并把实现保持在允许的 `.py` 文件内。
- 包不接受 JavaScript、CSS 文件或 HTML 文件。UI 与 CSS 必须写在 manifest descriptor 中；更新后需要完整重载，不存在热 JS。

## 13. 安全最佳实践

- 只安装和启用用户明确信任、能够审计来源的插件。当前安装确认发生在选择文件前；安装后管理页展示 ID、作者、版本、权限和哈希，并在首次运行确认中展示完整 SHA-256 与醒目的进程内代码警告。安装动作本身不会执行插件代码。
- 发布源码并让 `.ltp` 可由确定性打包命令复现；通过独立安全渠道公布 SHA-256。
- Python 代码采用最小权限思路，只使用 `plugin_path`、`data_path`、`config_path`、`cache_path`，不要读取应用私有配置或其他插件目录。
- 不记录令牌、Cookie、文件内容和个人数据。日志中不要写入 action payload，除非已经做敏感字段清理。
- 网络请求使用 HTTPS、超时和响应大小限制；不要下载后执行代码，不要使用 `eval`、`exec`、`pickle` 或不安全反序列化。
- 对 action payload 做类型、范围和长度校验；action 结果只返回必要的 JSON 数据。
- 写持久文件时使用临时文件和原子替换；缓存损坏必须可恢复。
- `setup`、`on_start`、`on_stop` 保持幂等，正确释放线程、定时器、文件句柄和网络连接。
- 全局 CSS 保持最小范围，避免远程 `url()`、`@import`、高层级 `z-index` 和覆盖宿主交互元素。
- 升级前备份重要插件数据。删除插件会删除其数据、配置和缓存，无法由管理器恢复。
