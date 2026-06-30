# Browser AI Assistant

Browser AI Assistant 是一个面向 Chrome / Edge 的浏览器侧边栏 AI 工作台。它基于当前网页、多个标签页、图片附件、Network 请求、JS 源码、Source Map 和运行时信息组织上下文，让 AI 不只是在旁边聊天，而是能参与网页阅读、资料整理、接口分析、前端调试和受控浏览器自动化。

项目地址：https://github.com/AhYi8/browser-ai-assistant

## 使用教程

完整安装、配置、使用流程和常见问题请查看 [插件教程](./docs/插件教程.md)。

## 为什么做这个项目

日常使用浏览器时，AI 助手最容易卡在几个地方：

- 当前网页内容需要复制粘贴，多个标签页之间更难整理。
- 网页正文、指定 DOM、HTML 源码、图片和历史对话经常分散在不同入口。
- 调接口、看源码、查 Source Map、分析运行时状态时，AI 缺少可验证的浏览器证据。
- 聊天结果需要导出、复用、同步，但普通聊天框很难沉淀成工作流。
- 提示词、模型渠道、搜索工具、同步备份等配置需要长期维护。

所以这个项目的目标不是再做一个“浏览器里的聊天框”，而是把网页上下文、聊天、提示词、工具调用、浏览器自动化、调试分析、导出和同步整合成一个可持续扩展的侧边栏工作台。

## 产品预览

### 浏览器自动化 Web 逆向

[查看完整视频演示](https://pub-f0613a38047b45fa81e40fbca68dd2fd.r2.dev/browser-ai-assistant/%E8%87%AA%E5%8A%A8%E5%8C%96%E9%80%86%E5%90%91.mp4)

### 浏览器自动化

![浏览器自动化](./docs/assets/product-preview/浏览器自动化.gif)

### AI 多标签页对话

![AI 多标签页对话](./docs/assets/product-preview/AI多标签页对话.gif)

### AI Network 请求自动化分析

![AI Network 请求自动化分析](./docs/assets/product-preview/Network-接口分析.gif)

## 能力概览

### 1. 基础配置

- **渠道管理**：支持多个 OpenAI Compatible 和 Anthropic 端点渠道，可分别配置默认对话模型、会话标题生成模型和模型视觉能力。
- **Tavily 网络搜索**：支持网络搜索工具配置，并支持多 API Key 自动轮询。
- **提取规则**：支持按 URL 正则匹配页面，使用 CSS / XPath 提取指定元素作为上下文；规则未命中、提取为空或选择器异常时，自动回退到全局页面提取。
- **聊天偏好**：支持全局系统提示词、失败重试次数、temperature、max_tokens、top_k、流式响应、工具调用和快捷键配置。
- **提示词管理**：支持提示词模板增删改查，聊天输入框内可通过 `/` 快捷调用，并在发送时保存提示词调用快照。
- **多端同步**：支持 Chrome Sync、WebDAV、S3 兼容存储三种远程备份；支持备份前缀、手动备份、手动恢复、自动定时同步和可选 AES-GCM 加密。

### 2. 网页上下文与聊天

- **当前页面上下文**：按稳定结构注入页面标题、当前 URL 和页面内容，支持可见文本与完整 HTML 两种提取模式。
- **多标签页上下文**：可以选择多个标签页，将多个页面内容按顺序合并后参与首轮对话。
- **图片与视觉模型**：视觉模型支持上传图片、粘贴图片、截取当前标签页截图、缩略图展示和放大预览。
- **会话管理**：支持新建、重命名、归档、删除、文件夹管理和拖拽移动。
- **后台生成**：切换会话不会强行中断当前会话生成；后台任务完成、失败或终止后会在会话列表中提示。
- **隐私模式**：隐私会话默认只保存在内存中，手动保存后才转为普通历史会话。

### 3. 工具调用与联网能力

- **基础工具**：支持当前系统时间、Tavily 网络搜索等原生工具调用。
- **统一工具注册表**：工具以注册表形式集中管理，便于后续增加、删除、启用、禁用和分组展示。
- **工具过程展示**：工具调用过程、工具结果和附件会写入聊天消息，便于复盘、导出和继续追问。
- **流式工具链路**：工具决策和最终回答隔离，避免把阶段性工具思考误当成最终回答。

### 4. 浏览器自动化与调试分析

在 `chrome.debugger` 模式下，Browser AI Assistant 可以在用户授权范围内连接当前标签页，执行浏览器自动化和调试分析。

- `network.*`：请求列表、详情读取、等待请求、请求对比、参数候选分析、JS 候选提取。
- `js.*`：JS 资源索引、源码搜索、同源 JS 补位和源码上下文提取。
- `sourcemap.*`：Source Map 候选发现、压缩代码位置映射、原始源码片段提取。
- `runtime.*`：运行时全局摘要、模块搜索、函数描述。
- `replay.*`：受控请求重放沙箱，用于基于已捕获请求生成草案、发送和对比响应。
- `full_access.*`：完全访问模式下的脚本执行、页面 fetch、Network 原文详情、Storage 读取和撤销。
- 浏览器通用工具：页面观测、元素检查、截图、控制台采集、交互操作、现场诊断、性能摘要、表单分析等。

这些能力让 AI 不只是“猜页面发生了什么”，而是可以结合页面状态、请求、源码、映射关系和运行时摘要进行分析。

### 5. 权限与安全边界

浏览器自动化能力分为三种运行模式：

- **普通模式**：默认限制高风险能力，只暴露低风险观察和分析工具。
- **受控增强模式**：遇到敏感字段、请求重放、上下文扩展等边界时，需要用户确认，并发放一次性授权。
- **完全访问模式**：用户显式选择后，才开放最高权限工具。

项目默认不信任模型输出和外部输入。Network 详情、工具附件、导出内容和后续上下文都会尽量经过脱敏、截断和边界校验；Runtime 分析只允许固定只读模板，Source Map 只从受控范围内提取有限源码片段，请求重放默认采用受控沙箱。

### 6. 导出、复制与阅读体验

- 支持将完整会话导出为 Markdown、Word、PDF。
- 支持消息级“重新生成”、“复制为 Markdown”、“复制为图片”。
- Markdown 渲染支持 GFM 表格、代码块、行内代码、有序列表和无序列表。
- 代码块支持语言标签、换行切换、展开收起、源码复制和复制反馈。
- 消息列表自动滚动会尊重用户当前位置，查看历史消息时不会被新消息强行拉到底部。
- AI 请求失败重试进度只作为临时 UI 状态展示，不污染聊天历史和导出内容。

## 使用体验

Browser AI Assistant 的核心体验是“把浏览器当前工作现场交给 AI”：

- 阅读网页时，可以直接基于当前页或多个标签页提问，不需要来回复制内容。
- 分析网页应用时，可以让 AI 查看请求、源码、Source Map 和运行时摘要，再给出判断。
- 整理资料时，可以把对话、推理过程、搜索结果和工具附件一起导出。
- 长任务生成时，可以切到其他会话继续工作，后台任务完成后再回来查看。
- 长期使用时，模型渠道、提示词、同步备份和提取规则都可以持续沉淀。

## 未来计划

- 集成 MCP 功能。
- 尽可能无损地实现 Skill 生态，让 Skill 不只是提示词模板，而是可描述、可执行、可组合、可分发的工作单元。
- 增加 AI 驱动的自动化爬虫能力。
- 增加 AI Token 监控与请求成本分析。
- 继续扩展浏览器自动化、调试分析和可插拔工具能力。

## 技术栈

- Chrome Manifest V3
- Chrome Side Panel API、Context Menus、Commands、Alarms、Storage、Scripting、Tabs、Debugger
- React 19
- TypeScript
- Vite
- Zustand
- Dexie / IndexedDB
- Tailwind CSS
- Radix UI Dialog / Select / Tabs / Tooltip
- react-markdown / remark-gfm
- highlight.js
- docx
- Vitest
- Playwright

## 目录结构

```text
.
├── public/manifest.json        # Chrome 扩展清单，构建后输出到 dist/manifest.json
├── src/background/             # MV3 Service Worker、运行时消息、流式端口、同步闹钟和浏览器控制
├── src/content/                # 注入网页的内容脚本和页面内容提取逻辑
├── src/shared/                 # 共享类型、模型适配器、聊天构造、存储、同步、加密和工具注册
├── src/side-panel/             # 侧边栏 React 应用、状态、组件、主题和样式
├── tests/unit/                 # 单元测试
├── tests/e2e/                  # Playwright 端到端冒烟测试
├── docs/                       # 安装、验收、设计规格、实施计划和文档资产
├── doc/                        # 需求设计文档
├── dist/                       # 构建产物，本地生成，不建议手动编辑
└── artifacts/                  # 本地打包产物，本地生成，不提交版本库
```

## 环境要求

- Node.js：建议使用较新的 LTS 版本。
- npm。
- Chrome、Edge 或其他兼容 Manifest V3 与 Side Panel API 的 Chromium 浏览器。

## 快速开始

安装依赖：

```powershell
npm install
```

启动本地开发服务：

```powershell
npm run dev
```

构建 Chrome 扩展产物：

```powershell
npm run build:extension
```

构建完成后，在浏览器扩展管理页使用“加载已解压的扩展程序”，选择项目下的 `dist` 目录。

生成本地可分发扩展目录：

```powershell
npm run package:extension
```

打包完成后会生成 `artifacts/chrome-extension`，其中包含 `build-info.json`，用于追踪本次本地构建来源。

## 常用命令

```powershell
npm run dev               # 启动 Vite 开发服务
npm run build             # 构建生产产物
npm run build:extension   # 构建 Chrome 扩展产物
npm run package:extension # 生成本地可分发扩展目录
npm run check:package     # 验证并生成本地可分发扩展目录
npm run preview           # 预览构建结果
npm run test              # 运行 Vitest 单元测试
npm run test:watch        # 以 watch 模式运行单元测试
npm run test:e2e          # 运行 Playwright 端到端测试
npm run typecheck         # 执行 TypeScript 类型检查
npm run check             # 类型检查、构建、单测和打包综合验证
```

## 本地安装扩展

1. 在项目根目录执行：

   ```powershell
   npm run build:extension
   ```

2. 打开 Chrome 或 Edge 的扩展管理页面。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择项目中的 `dist` 目录。

注意：不要直接选择项目根目录。扩展清单文件在构建后才会输出到 `dist/manifest.json`。

如果需要把扩展目录交给其他本地环境测试，可以执行 `npm run package:extension`，再选择 `artifacts/chrome-extension`。该目录是由 `dist` 复制并校验生成的本地产物，不应手动编辑，也不应提交到 Git。

## 首次使用

1. 打开扩展侧边栏。
2. 进入“设置”。
3. 在“渠道管理”中新增或编辑模型渠道。
4. 填写端点类型、端点地址和 API Key。
5. 添加模型，或先拉取远端模型列表再选择模型添加。
6. 可选：测试模型连通性。
7. 可选：设置默认对话模型、会话标题生成模型和视觉理解能力。
8. 回到聊天页，刷新当前页面上下文后开始对话。

## 数据与隐私说明

- 模型渠道、API Key、提取规则、聊天历史、提示词和同步配置默认保存在浏览器本地 IndexedDB 中。
- 只有用户显式开启同步后，数据才会备份到 Chrome Sync、WebDAV 或 S3 兼容存储。
- 同步快照会过滤本地密钥类设置，例如加密密钥、WebDAV 密码、S3 Secret Key。
- 隐私模式消息默认只保存在内存中，不会自动写入 IndexedDB 或同步快照。
- 浏览器自动化高风险能力必须由用户显式开启对应模式后才会暴露。

## 致谢

感谢 [linux.do](https://linux.do/) 社区各位佬的公益站！