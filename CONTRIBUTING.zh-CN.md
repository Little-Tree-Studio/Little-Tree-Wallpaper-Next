# 参与小树壁纸 Next 贡献

<p align="center">
  <a href="./CONTRIBUTING.md">English</a> | 简体中文
</p>

感谢你有意为本项目做贡献！本文档说明如何报告问题、提出建议和提交代码。项目目前处于 Beta 阶段：API 与扩展格式仍可能调整，这也正是早期反馈宝贵的原因。

## 贡献方式

- **缺陷报告** —— 崩溃、渲染异常或行为不符合预期的问题。
- **功能建议** —— 先描述遇到的问题，再给出你设想的解决方案。
- **文档改进** —— 修正 [`docs/`](docs/) 与 README 中的错误或疏漏。
- **翻译** —— 完善英文或简体中文文本（`README`、`CONTRIBUTING`、`SECURITY`、`DISCLAIMER`）。
- **扩展生态** —— 开发插件、主题或壁纸源，并发布到资源商店。

## 报告缺陷

在 [GitHub Issue](https://github.com/Little-Tree-Studio/Little-Tree-Wallpaper-Next/issues) 中提交，并附上：

1. 应用版本与渠道（见"帮助与反馈"页面，也记录在 `build.json` 中）。
2. 操作系统及版本（动态壁纸问题请注明 Windows 版本号）。
3. 复现步骤、期望结果与实际结果。
4. 相关日志片段——日志与异常退出报告可在"帮助与反馈"页面导出。

提交前请先搜索是否已有同类 Issue。涉及安全问题的报告请使用[私密漏洞报告渠道](SECURITY.md)，不要公开发布。

## 提出功能建议

功能请求应从用户问题出发：你想达成什么、尝试过什么、现有方案为何不够。可维护的、跨平台的方案比高度依赖单一平台的实现更容易被接受。

## 开发环境

按 README 的["从源码运行"](./README.zh-CN.md)章节操作。要点：

- Python 3.12+、Node.js 20+，推荐安装 [uv](https://docs.astral.sh/uv/)。
- 后端测试：`uv run --project backend --no-sync python -m unittest discover -s backend/tests -p "test_*.py"`。
- 前端检查：`npm run test:ci --prefix frontend`，随后 `npm run build --prefix frontend`。
- 后端改动使用 `ruff check` 进行静态检查。

[`AGENTS.md`](AGENTS.md) 记录了面向智能体与人类的仓库级注意事项：前端改动最后必须执行一次生产构建；尽量使用 HeroUI 原生组件及其默认样式；使用 HeroUI 前先查阅其文档。

## 提交变更

1. Fork 仓库并创建主题分支（如 `feat/store-filters` 或 `fix/tray-race`）。
2. 每个 Pull Request 只处理一个主题；无关的重构请另开 PR。
3. 编写描述性的祈使句提交信息（"Add store protocol gate"，而不是 "update"）。
4. 修复缺陷或改变行为时补充或调整测试；理想情况是测试在改动前失败、改动后通过。
5. 本地确保 CI 通过：后端单元测试、前端测试套件与前端构建。
6. 行为、格式或流程变化时同步更新文档（[`docs/PLUGINS.md`](docs/PLUGINS.md)、[`docs/THEMES.md`](docs/THEMES.md)、[`docs/VERSIONING.md`](docs/VERSIONING.md)、[`docs/TOOLING.md`](docs/TOOLING.md)）。

评审会关注正确性、安全影响（见下）与长期可维护性。小而清晰的 PR 评审最快。

## 涉及安全的贡献

以下区域的代码需要格外谨慎，请在 PR 描述中说明威胁模型：

- 本地 API 鉴权（回环服务、每次启动生成的令牌）。
- 不可信输入解析：收藏包、`.ltp`/`.lttheme`/`.ltauto` 文件、壁纸源包、商店元数据与下载内容。
- 插件加载与生命周期（`backend/plugins/`）。
- 一切执行外部程序的能力（高级自动化节点）。

不要引入会静默外联的新依赖，绝不提交密钥或个人配置。

## 扩展作者

如果你贡献插件、主题或壁纸源：

- 通过官方资源仓库发布商店条目：[Little-Tree-Wallpaper-Resources](https://github.com/shu-shu-1/Little-Tree-Wallpaper-Resources)（按仓库内的元数据模板提交 Pull Request）。
- 遵循 [`docs/PLUGINS.md`](docs/PLUGINS.md)、[`docs/THEMES.md`](docs/THEMES.md) 与商店元数据模板中的格式和限制。
- 版本号必须满足[版本规范](docs/VERSIONING.md)；壁纸源要求 `protocol_version >= 4`。
- 不要混淆插件代码。用户被要求信任并审计自己安装的内容。

## 许可证

提交贡献即表示你同意以项目的 [GNU Affero General Public License v3.0](LICENSES) 许可证授权你的贡献。
