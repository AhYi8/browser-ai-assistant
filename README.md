# Browser AI Assistant

Browser AI Assistant 是一个基于 Chrome Manifest V3 的浏览器侧边栏 AI 助手。它把当前网页标题、URL、可见文本、HTML 片段或截图作为对话上下文，让用户在浏览页面时直接完成问答、总结、解释、改写、需求分析、图片理解和聊天记录管理。

项目强调本地可控：模型渠道、API Key、提取规则、聊天历史、提示词和同步配置默认保存在浏览器本地 IndexedDB 中。只有用户显式开启同步后，数据才会备份到 Chrome Sync、WebDAV 或 S3 兼容存储。

## 产品预览

### AI 多标签页对话

![AI 多标签页对话](https://images.21zys.qzz.io/LinuxDO/AI%E5%A4%9A%E6%A0%87%E7%AD%BE%E9%A1%B5%E5%AF%B9%E8%AF%9D.gif)

### AI Network 请求自动化分析

![AI Network 请求自动化分析](https://images.21zys.qzz.io/LinuxDO/Network-%E6%8E%A5%E5%8F%A3%E5%88%86%E6%9E%90.gif)

## 核心能力

### 浏览器侧边栏入口

- 基于 Chrome Manifest V3 和 Side Panel API。
- 支持点击扩展图标、右键菜单和快捷键打开侧边栏。
- 默认快捷键为 `Ctrl+Shift+Y`，macOS 为 `Command+Shift+Y`。
- Content Script 构建为普通 IIFE 脚本，适配 `manifest.json` 的 `content_scripts` 和运行时按需注入。
- 页面缺少当前版本 Content Script 时，后台会按需注入并重试一次页面上下文提取。

### 网页上下文提取

- 默认提取当前页面可见文本，自动跳过 `script`、`style`、`template`、`noscript`、隐藏节点和 `aria-hidden` 内容。
- 支持“提取文本”和“提取所有”两种模式；“提取所有”会返回匹配节点的 `outerHTML` 或整页 HTML。
- 页面标题、当前 URL 和页面内容按稳定结构注入到对话上下文。
- 支持上下文查看、手动刷新、规则命中提示和上下文拼接开关。
- 发送前会按模型 `maxTokens` 预算裁剪页面上下文，避免请求体过大。
- 规则命中但提取为空、选择器异常或 URL 未命中时，会回退到全局页面内容提取。

### 提取规则

- 支持按 URL 正则配置页面提取规则。
- 每条规则支持多行 CSS 选择器或 XPath。
- 多条规则同时命中时按 `sortOrder` 选择第一条。
- 支持新增、编辑、删除和上下移动规则。
- 当前页面命中的规则会在列表中高亮并顶置。
- 新增规则保存前会校验 URL 正则、CSS 和 XPath，非法草稿不会落库。
- 支持调用已配置模型为当前 URL 生成候选 JavaScript RegExp 正则。

### 模型渠道与模型管理

- 支持多个模型渠道。
- 支持 OpenAI Chat Completions 兼容协议和 Anthropic Messages 协议。
- 渠道配置包含名称、端点类型、端点地址和 API Key。
- 端点地址可填写基础域名，代码会自动补全聊天、消息或模型列表路径，并兼容历史完整路径。
- 支持从远端拉取模型列表、搜索模型、添加远端模型和手动新增模型。
- 支持模型连通性测试，并以单模型粒度展示测试状态。
- 支持全局默认对话模型、AI 标题生成模型和每个会话的当前模型持久化。
- 支持标记模型是否具备视觉理解能力；视觉模型会在模型列表和选择器中显示能力标识。

### 聊天体验

- 支持基于当前网页上下文发起对话。
- 支持普通响应和流式响应，默认开启流式响应。
- 流式响应通过 runtime port 长连接逐段更新 AI 消息。
- 流式连接未收到任何响应即断开时，会自动回退到非流式请求。
- 支持解析开头的 `<think>...</think>` 思考过程，并以可折叠区域展示。
- 支持 OpenAI 兼容流式返回中的 `reasoning_content` 思考片段。
- 支持 Markdown、GFM 表格、代码块、行内代码、有序列表和无序列表渲染。
- 支持 AI 消息重新生成、历史用户消息编辑后重新生成，以及完整会话历史随请求发送。
- 支持发送中继续输入草稿，响应完成不会清空新输入。
- 支持可配置发送快捷键，并兼容中文输入法组合输入。

### 图片与视觉模型

- 支持视觉模型上传图片、粘贴图片和截取当前标签页可见区域。
- 支持图片缩略图、删除和放大预览。
- 支持发送纯图片消息。
- 支持历史用户消息中的图片附件持久化、重新加载展示和放大预览。
- 当前模型不支持视觉理解时会禁用图片输入，并隐藏截图入口。
- 图片类型限制为 PNG、JPEG、WebP、GIF；单张最大 5MB，单条消息最多 5 张图片。
- OpenAI 兼容请求会把图片转换为 `image_url` 内容块。
- Anthropic 请求会把图片转换为 base64 image 内容块，并校验 data URL 格式。

### 会话历史与隐私模式

- 使用 IndexedDB 保存本地会话、消息、文件夹、规则、模型和设置。
- 支持新建会话、重命名、归档、删除和二次确认。
- 支持默认文件夹、自定义文件夹、已归档分区和拖拽移动。
- 宽面板支持左侧历史面板展开/折叠，窄面板支持历史抽屉浏览。
- 首轮对话完成后可使用配置的标题模型生成会话标题。
- 隐私模式消息只保存在内存中，不会自动持久化为历史会话。
- 隐私会话可手动保存，保存后退出隐私模式并转为普通历史会话。
- 隐私模式有消息时切换历史会话需要确认，避免静默丢弃内容。

### 提示词模板

- 支持在设置页维护提示词模板。
- 聊天输入框中支持斜杠快捷调用提示词。
- 发送时保存用户可见输入和提示词调用快照，请求模型时再展开模板内容。
- 后续修改模板不会改变历史消息含义。
- 提示词编辑器兼容粘贴、换行、删除 token 和中文输入法组合输入。

### 聊天记录导出

- 支持导出当前聊天为 Markdown、Word 和 PDF。
- 导出内容包含标题、导出时间、会话时间、消息数量、角色、正文、思考过程和提示词快照。
- Markdown 导出会处理正文中已有代码围栏，避免外层代码块提前截断。
- Word 导出使用动态 `import("docx")`，避免文档库进入初始侧边栏路径。
- PDF 导出通过浏览器打印窗口实现，弹窗被拦截时返回中文错误。
- 下载文件名会清理非法字符、控制字符、空标题和前导点。

### 数据同步与备份

- 支持手动备份、手动恢复和自动同步定时任务。
- 支持 Chrome Sync、WebDAV 和 S3 兼容存储。
- WebDAV 远程目录不存在时会按层级创建目录后重试。
- S3 兼容存储使用 AWS Signature V4 和 path-style URL。
- 备份前缀不能为空，且不能包含路径分隔符或连续点号。
- 支持可选 AES-GCM 加密，密钥通过 PBKDF2 派生。
- 同步快照会过滤本地密钥类设置，包括加密密钥、WebDAV 密码和 S3 Secret Key。
- 恢复远端快照会覆盖本地业务数据，但保留当前本地同步密钥和远程凭据。
- 手动恢复需要二次确认。

## 技术栈

- Chrome Manifest V3
- Chrome Side Panel API、Context Menus、Commands、Alarms、Storage、Scripting、Tabs
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
├── src/background/             # MV3 Service Worker、运行时消息、流式端口、同步闹钟
├── src/content/                # 注入网页的内容脚本和页面内容提取逻辑
├── src/shared/                 # 共享类型、模型适配器、聊天构造、存储、同步、加密
├── src/side-panel/             # 侧边栏 React 应用、状态、组件、主题和样式
├── tests/unit/                 # 单元测试
├── tests/e2e/                  # Playwright 端到端冒烟测试
├── docs/                       # 安装、验收、设计规格、实施计划和文档资产
├── doc/                        # 需求设计文档
└── dist/                       # 构建产物，本地生成，不建议手动编辑
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

## 常用命令

```powershell
npm run dev              # 启动 Vite 开发服务
npm run build            # 构建生产产物
npm run build:extension  # 构建 Chrome 扩展产物
npm run preview          # 预览构建结果
npm run test             # 运行 Vitest 单元测试
npm run test:watch       # 以 watch 模式运行单元测试
npm run test:e2e         # 运行 Playwright 端到端测试
npm run typecheck        # 执行 TypeScript 类型检查
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

## 首次使用

1. 打开扩展侧边栏。
2. 进入“设置”。
3. 在“渠道管理”中新增或编辑模型渠道。
4. 填写端点类型、端点地址和 API Key。
5. 添加模型，或先拉取远端模型列表再选择模型添加。
6. 可选：测试模型连通性。
7. 可选：设置默认对话模型、AI 标题生成模型和视觉理解能力。
8. 回到聊天页，刷新当前页面上下文后开始对话。

## 模型配置说明

渠道代表一个模型服务端点，模型代表该渠道下可请求的具体 `model_id`。

支持的端点类型：

- `openai_chat`：OpenAI Chat Completions 兼容协议。
- `anthropic_messages`：Anthropic Messages 协议。

模型级参数：

- 展示名。
- `model_id`。
- `temperature`。
- `max_tokens`。
- `top_k`，为空时不发送。
- 系统提示词。
- 是否支持视觉理解。
- 是否作为 AI 标题生成模型。

API Key、同步密钥和远程凭据属于敏感信息，请只保存在本地浏览器环境中，不要提交到 Git 仓库。

## 内容提取说明

默认情况下，扩展会提取当前页面中的可见文本作为对话上下文。对于内容结构复杂的网站，可以配置 URL 正则和 CSS/XPath 列表，让扩展优先提取关键区域。

提取流程：

1. 按规则顺序匹配当前 URL。
2. 命中规则后按多行 CSS/XPath 顺序提取内容。
3. 规则未命中、选择器失败或结果为空时回退到全局提取。
4. 聊天发送前按模型预算裁剪上下文。
5. 最终把页面标题、URL 和内容拼接进请求上下文。

## 数据存储与同步说明

本地数据保存在 IndexedDB 数据库 `browser-ai-assistant` 中。

本地业务数据包括：

- 模型渠道。
- 渠道模型。
- 提取规则。
- 提示词模板。
- 聊天会话和消息。
- 聊天文件夹。
- 应用设置。

同步备份不会把本地同步密钥类设置写入快照。开启远程同步前，请确认是否需要开启加密；未加密时，API Key、聊天记录和配置会以明文进入远程备份。

## 测试与验证

建议在提交代码前至少执行：

```powershell
npm run typecheck
npm run test
npm run build:extension
```

涉及扩展加载、侧边栏打开、页面内容提取或端到端交互时，补充执行：

```powershell
npm run test:e2e
```

当前测试覆盖的核心场景包括：

- 扩展入口、右键菜单、快捷键和 Side Panel 打开。
- Content Script 页面提取、CSS/XPath、HTML 模式和回退逻辑。
- Content Script 缺失时后台按需注入后重试。
- OpenAI 兼容与 Anthropic 请求构造、模型列表和连通性测试。
- 非流式和流式聊天响应、思考过程解析、流式回退。
- 聊天请求上下文构造、页面上下文预算裁剪。
- 图片上传、粘贴、截图、视觉模型标识和附件请求转换。
- 会话新建、重命名、归档、删除、文件夹拖拽。
- 默认模型、会话模型持久化和标题生成。
- 隐私模式内存会话与保存流程。
- 提示词模板与斜杠调用。
- Markdown、Word、PDF 导出。
- Chrome Sync、WebDAV、S3 同步和加密恢复。
- 中文输入法组合输入安全。
- Side Panel 布局、长文本、代码块、列表和表格渲染。

## 构建注意事项

- `dist/content/index.js` 必须是普通内容脚本，不能包含静态 `import` 或动态 `import(`。
- Vite 构建会额外把 `src/content/index.ts` 打包为 IIFE 输出到 `dist/content/index.js`。
- `background/index.ts` 作为 MV3 service worker 以 module 形式输出。
- `dist` 是构建产物，不建议手动编辑。

## 安全注意事项

- 不要提交 API Key、访问令牌、私钥、连接串、同步密钥或远程存储凭据。
- 默认不信任网页内容、模型返回、用户填写的 URL、正则、CSS/XPath 和远程备份。
- 调整模型请求、同步、Content Script 注入或运行时消息时，需要重点检查敏感信息泄露、路径穿越、注入、越权、资源滥用和错误信息脱敏。
- 恢复同步数据会覆盖本地业务数据，界面已做二次确认，但仍建议在确认备份来源可信后操作。

## 开源许可证

本项目使用 GPL-3.0-only 许可证，详见 `LICENSE`。

## 开发状态

项目处于快速迭代阶段，已具备可用的网页上下文聊天、模型渠道管理、提取规则、视觉输入、提示词模板、历史会话、隐私模式、多格式导出和数据同步能力。后续仍可继续完善更多模型协议、浏览器端兼容性验证、同步冲突策略和端到端测试覆盖。

## 致谢

感谢 [linux.do](https://linux.do/) 社区各位佬的公益站！