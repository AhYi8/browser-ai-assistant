# Browser AI Assistant

Browser AI Assistant 是一个基于 Chrome Manifest V3 的浏览器侧边栏 AI 助手。它可以读取当前网页内容，把网页上下文带入对话，并通过用户配置的模型渠道完成摘要、解释、问答、改写等任务。

## 功能特性

- **网页上下文对话**：通过 Content Script 提取当前页面可见文本，并在侧边栏中发起基于页面内容的 AI 对话。
- **提取规则配置**：支持按 URL 规则配置 CSS 选择器或 XPath，优先提取页面中的关键内容；规则未命中或提取失败时回退到全局文本提取。
- **多渠道模型管理**：支持配置多个模型渠道和模型，当前代码内置 OpenAI Chat Completions 与 Anthropic Messages 两类请求协议。
- **流式与非流式响应**：聊天请求支持普通响应和流式响应，并兼容模型返回的思考内容解析。
- **Markdown 渲染**：AI 回复支持 Markdown 与代码高亮展示。
- **会话历史**：使用 IndexedDB 保存本地会话、消息、分组与配置数据。
- **会话标题生成**：支持用配置的标题模型为新会话生成标题，失败时使用兜底标题。
- **加密与备份基础能力**：提供本地加密、Chrome Sync 备份与恢复相关模块。
- **Chrome 扩展入口**：支持点击扩展图标、快捷键和右键菜单打开 Side Panel。

## 技术栈

- Chrome Manifest V3
- React 19
- TypeScript
- Vite
- Zustand
- Dexie / IndexedDB
- Tailwind CSS
- Radix UI
- react-markdown / remark-gfm / highlight.js
- Vitest
- Playwright

## 目录结构

```text
.
├── public/manifest.json        # Chrome 扩展清单，构建后输出到 dist/manifest.json
├── src/background/             # MV3 Service Worker 与运行时消息处理
├── src/content/                # 注入网页的内容脚本与页面文本提取逻辑
├── src/side-panel/             # 侧边栏 React 应用、状态与主题样式
├── src/shared/                 # 共享类型、存储、模型适配器、加密与聊天工具
├── tests/unit/                 # 单元测试
├── tests/e2e/                  # Playwright 端到端冒烟测试
├── docs/                       # 安装、验收和设计过程文档
└── dist/                       # 构建产物，本地开发生成，不建议手动编辑
```

## 环境要求

- Node.js 版本需满足当前依赖要求，建议使用较新的 LTS 版本。
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

执行扩展构建：

```powershell
npm run build:extension
```

构建完成后，将浏览器扩展管理页中的“加载已解压的扩展程序”指向项目下的 `dist` 目录。

## 常用命令

```powershell
npm run dev              # 启动 Vite 开发服务
npm run build            # 构建生产产物
npm run build:extension  # 构建 Chrome 扩展产物
npm run preview          # 预览构建结果
npm run test             # 运行 Vitest 单元测试
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

## 模型配置说明

首次使用前，需要在侧边栏设置中配置模型渠道和模型：

- 渠道名称。
- Endpoint URL。
- API Key。
- 请求协议类型。
- 模型 ID。
- temperature、max tokens 和系统提示词等参数。

API Key 等敏感信息只应保存在用户本地或用户明确授权的同步数据中。不要把真实密钥提交到 Git 仓库。

## 内容提取说明

默认情况下，扩展会提取当前页面中的可见文本作为对话上下文。对于内容结构复杂的网站，可以配置 URL 匹配规则，并为每条规则配置多行 CSS 选择器或 XPath，以减少无关内容干扰。

当规则未匹配、选择器执行失败或提取结果为空时，扩展会回退到全局文本提取，保证基础问答流程可用。

## 测试与验证

推荐在提交代码前至少执行：

```powershell
npm run typecheck
npm run test
npm run build:extension
```

涉及扩展加载、侧边栏打开、网页内容提取或端到端交互时，补充执行：

```powershell
npm run test:e2e
```

## 安全注意事项

- 不要提交 API Key、访问令牌、私钥、连接串或其他敏感信息。
- 所有外部输入，包括网页内容、模型返回值、用户填写的 URL 和选择器，都应按不可信数据处理。
- 调整 Content Script、Background 消息和模型请求逻辑时，需要重点关注权限边界、注入风险、跨域请求、敏感信息泄露和资源滥用。

## 开发状态

当前项目处于早期迭代阶段，核心能力围绕网页内容提取、模型渠道配置、聊天体验、历史会话和本地扩展安装展开。后续可继续完善更多模型协议、同步方式、导出能力和更完整的端到端覆盖。
