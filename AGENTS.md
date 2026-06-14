# AGENTS.md

> **核心目标**：交付高质量、安全、可维护、可验证的代码。
> **硬性约束**：所有用户可见输出、文档、注释、Git Commit 一律使用**简体中文**。

## 1. 工作原则

* **先分析后执行**：实施前先明确目标、边界、风险、影响范围与验收标准。
* **禁止静默假设**：有歧义、信息不足或存在多种合理解释时，必须显式说明；必要时先澄清。
* **优先简单方案**：优先选择更少代码、更少抽象、更易验证、与现有结构更一致的方案。
* **解决根因**：避免补丁式修复、过度设计和为未来需求提前建模。
* **最小必要改动**：只改完成当前需求所必需的内容，禁止无关优化、无关重构、无关清理。
* **复杂任务先列计划**：多步骤任务先给出简明计划，并说明每一步的验证方式。

## 2. 编码要求

* 文件统一使用 **UTF-8 无 BOM**。
* 标识符使用清晰、准确的英文命名，禁止无意义命名。
* 所有注释使用**简体中文**。
* 关键逻辑、接口边界、兼容性处理和非显而易见的决策必须写中文注释，重点说明“为什么”和业务背景。
* 设计遵循 **KISS、YAGNI、SOLID、DRY**，保持高内聚、低耦合。
* 修改既有代码时应保持项目原有风格；除非用户明确要求，不得顺手统一风格或调整结构。

## 3. 变更边界

* 每一处改动都必须能直接追溯到当前需求。
* 任何项目修改完成后，必须同步修改、补充并完善项目级 `AGENTS.md`，记录本次变更沉淀出的约束、工程经验、验证要求或适配说明。
* 不得顺手修改相邻代码、注释、格式、命名、目录结构或技术栈写法。
* 只允许清理**由本次改动直接产生**的无用 import、变量、函数或分支。
* 对历史遗留死代码、坏味道、无关告警或无关测试失败，可以说明，但不得擅自处理。

## 4. 安全要求

* 严禁硬编码密钥、令牌、密码、证书、私钥、连接串等敏感信息。
* 所有外部输入都必须进行合法性校验、类型校验、边界检查和必要清洗。
* 涉及数据库、文件、网络、脚本执行、反序列化、上传下载、权限控制等场景时，必须优先检查注入、越权、路径穿越、资源滥用、敏感信息泄露等风险。
* 默认不信任外部输入和第三方返回值，默认收紧边界而不是放宽边界。

## 5. Git 与工作区规则

* 默认在当前分支修改代码。
* 每次会话（任务）开始时都需要首先拉取最新代码，并处理冲突（如果存在）。
* 若当前分支存在未暂存变更，开始修改前必须先执行 `git add .`，若当前分支不存在变更，开始修改前必须先执行代码拉取与合并操作。
* 未经用户**明确授权**，禁止执行 `git commit`。
* 未经用户明确授权，禁止执行会覆盖、删除、改写历史或影响现有改动的 Git 操作，如 `git push`、`git rebase`、`git reset --hard`、`git checkout --` 等。
* 用户明确要求执行 `git commit` 时，默认先执行 `git add .` 并提交当前工作区全部变更；除非用户明确指定提交范围，否则不得自行按文件或部分内容选择性提交。

## 6. 测试与验证

* **无验证不交付**：任何代码变更完成后，必须执行与影响范围匹配的最小充分验证。
* 逻辑变更必须补充或更新自动化测试；核心逻辑优先保证 **80%+ 覆盖率**。
* 修复 Bug 时，优先先写可复现问题的测试，再修复并验证通过。
* 增加校验时，优先覆盖非法输入、空值、边界值、类型不匹配和极端输入。
* 重构必须保证行为和接口契约不变，并通过相关测试验证。
* 可根据影响范围选择单元测试、集成测试、契约测试、端到端测试、构建验证、静态检查、类型检查或冒烟验证。
* 纯文档、纯注释、纯文案修改可不跑测试，但交付时必须说明原因以及为何不会影响运行逻辑。

## 7. 检索与资料使用

* 本地检索优先使用 `rg`。
* 除纯本地代码微调、纯文档微调或已能从本地上下文充分确定结论外，默认进行联网检索。
* 联网检索优先使用官方文档、标准规范、权威资料和一手来源。
* 关键结论应尽量保留来源依据；资料冲突时需说明采用依据，不得凭模糊记忆输出高风险结论。

## 8. 交付要求

交付时必须明确说明：

* **做了什么**
* **为什么这样做**
* **如何验证**
* **剩余风险**
* **潜在技术债**
* **`AGENTS.md` 同步更新情况**
* **简要复盘**

如未补测试、未做集成验证或未处理相邻问题，也必须说明原因。

## 9. 质量红线

以下情况视为不合格：

* 在存在歧义时静默假设并直接实施
* 引入与需求无关的改动
* 为未来需求提前设计复杂结构
* 未验证即交付
* 用主观判断代替测试结论
* 硬编码敏感信息
* 未校验外部输入
* 修改范围失控
* 顺手处理历史遗留问题
* 未经授权执行提交或其他破坏性 Git 操作

## 10. Chrome 扩展工程经验

### 10.1 Content Script 构建与注入

* `manifest.json` 的 `content_scripts[].js` 和 `chrome.scripting.executeScript({ files })` 注入的是普通内容脚本，不要产出带静态 `import` 的 ES Module 文件。
* `dist/content/index.js` 必须是可直接执行的单文件脚本，例如 IIFE；构建后必须检查不包含 `^import` 或动态 `import(`。
* 如果 content script 依赖共享工具函数，应通过构建阶段内联到 content script 产物中，而不是让 content script 运行时再 import `dist/assets/*`。
* 修改 `public/manifest.json`、`vite.config.ts` 或扩展运行时入口时，必须同步维护 manifest 与 Vite 构建入口的合约测试，确保 background、side panel、devtools 和 content script 的产物路径一致。
* 遇到 `Could not establish connection. Receiving end does not exist.` 时，优先排查目标 tab 是否已有 content script 接收器、扩展重载后旧页面是否未注入、构建产物是否为普通脚本、当前页面是否为受限页面。
* background 向 tab 发送消息失败且确认为 content script 缺失时，可以用 `chrome.scripting.executeScript` 按需注入后重试一次；受限页面注入失败时必须返回明确中文错误。
* 扩展重载后，已打开页面不一定自动拥有当前版本 content script。修复相关问题时，必须覆盖“未连接时注入后重试”的测试。

### 10.2 Runtime 消息与长任务

* `chrome.runtime.sendMessage` 在不同环境中可能表现为 Promise 或 callback 形态，封装时必须兼容两者，并读取 `chrome.runtime.lastError`。
* `chrome.runtime.onMessage` 中异步 `sendResponse` 必须返回字面量 `true`，不能只返回 Promise。
* 不要把耗时外部模型请求长期挂在 runtime message port 上；MV3 service worker 和消息通道生命周期可能导致 `The message port closed before a response was received.`。
* 对需要当前 tab 信息的长任务，应优先让 background 快速返回 tab URL、tabId 等必要上下文，再由 Side Panel 或稳定执行环境继续完成耗时请求。

### 10.3 Side Panel 表单与中文输入法

* React 受控输入框如果会保存用户可输入的中文文本，必须兼容 IME 组合输入；不能在 `compositionstart` 到 `compositionend` 期间把拼音中间态直接提交到全局状态、IndexedDB、Chrome Storage 或远端同步设置。
* 对 `input`、`textarea` 等文本控件，优先复用已有的组合输入安全封装，例如 `useComposedTextInput`：组合输入期间只更新本地草稿，组合结束后再提交最终文本。
* 修复或新增涉及中文输入的表单时，必须补充回归测试，覆盖“组合输入期间不保存拼音中间态，组合结束后只保存最终中文文本”。
* API Key、URL、路径、备份前缀、模型名等看似英文的配置项也可能被用户用中文输入法输入，应按文本输入统一处理，避免出现 `beifen`、`shizhong` 等拼音残留。

### 10.4 模型视觉能力标识

* 任何展示已添加模型、默认对话模型、AI 标题生成模型、当前聊天模型或类似模型选择列表的 UI，都必须检查 `ProviderModel.supportsVision`。
* 当 `supportsVision` 为 `true` 时，模型名后面必须显示符合当前主题的眼睛状标识，提示该模型支持视觉理解。
* 普通 DOM 列表优先复用 `ModelVisionIcon` 和 `.model-vision-icon`；原生 `<select><option>` 不能渲染 HTML 时，必须通过 `formatModelLabelWithVision` 在 option 文本后追加“视觉”文本标识。
* 新增类似模型列表时必须补充测试，覆盖支持视觉理解的模型能看到眼睛状标识，避免不同入口能力提示不一致。

### 10.5 页面上下文与提取规则

* 页面上下文必须始终保留稳定结构：页面标题、当前 URL、页面内容按固定顺序拼接，相关逻辑优先维护 `createPageContextPrompt` 和对应测试。
* Side Panel 默认仍以当前活动标签页作为页面上下文来源；如果用户在上下文弹窗中选择多个标签页，必须按所选标签页顺序分别提取并合并，每个标签页仍保持标题、URL、内容结构。
* 多标签页上下文选择只统一使用当前全局提取模式（可见文本或 HTML 源码），不得为单个标签页新增独立提取模式开关。
* 新建会话、进入隐私模式、切换到空会话或删除后落到空会话时，必须同时清理多标签页候选、列表加载态和列表错误，避免上一会话的弹窗状态残留。
* 聊天请求只在新会话首问注入当前页面上下文；继续追问、重新生成或编辑后重新生成不得重新注入当前标签页上下文，避免把后续页面状态误混入历史语义。
* 多标签页抽取允许部分失败；成功项继续参与注入，失败项必须在标签页选择弹窗中显示中文错误，全部失败时按空上下文处理且不阻断发送。
* 页面提取支持 `text` 与 `all` 两种模式；新增提取能力时必须同时考虑可见文本、完整 HTML、CSS 命中、XPath 命中、空结果回退和超长截断。
* 提取规则只接受合法 JavaScript URL 正则以及合法 CSS/XPath；任何新增规则入口都必须复用 `validateExtractionRuleDraft`，不能绕过校验直接落库。
* 多条规则命中时必须按 `sortOrder` 选择第一条；命中规则但提取为空或选择器异常时必须回退到全局提取，同时保留 `matchedRuleId` 供 UI 展示。
* 页面上下文刷新存在竞态风险；切换提取模式或连续刷新时，较早的慢速响应不能覆盖较新的状态，相关改动必须覆盖回归测试。
* AI 生成 URL 正则只允许返回可被 `new RegExp(pattern)` 接受的候选；解析逻辑必须兼容 JSON 数组、`{ patterns: [] }` 和编号列表，但最终必须去重、过滤非法项并限制候选数量。
* 需要当前标签页 URL 的长任务应让 background 快速返回 URL，再由 Side Panel 继续后续模型请求，避免把长耗时流程挂在 runtime message port 上。
* 新对话是否默认注入当前页面上下文属于全局聊天偏好；实现时应初始化现有 `appendPageContextToSystemPrompt` 状态，复用标签页选择弹窗里的激活/取消注入能力，不新增平行注入逻辑。
* 新对话是否默认提取 HTML 源码属于全局聊天偏好；实现时应初始化现有 `contextMode` 和 `pageContext.extractMode`，复用 `text/all` 提取模式，不新增第三种页面上下文模式。

### 10.6 模型请求、流式响应与思考过程

* 模型协议分支必须以 `EndpointType` 为入口，新增协议时同步更新 `EndpointType`、请求 payload 构造、模型列表请求、连通性测试、聊天响应解析和单元测试。
* OpenAI Chat Completions 兼容协议与 Anthropic Messages 协议的 system、messages、图片格式、鉴权 header 和端点补全规则不同，不能复用未区分协议的请求体。
* DeepSeek reasoning/thinking 模型在工具调用链路中要求回传 assistant 历史消息的 `reasoning_content`；实现时必须把供应商原始 reasoning 单独保存为 `reasoningContent`，不要只保存 UI 展示用 `thinking`，且只能对明确需要该字段的 DeepSeek reasoning 模型解析、保存并写入 OpenAI-compatible payload，避免普通兼容渠道因额外字段报错；不得把通用 `thinking` 兜底当作 `reasoning_content` 回传；模型匹配不得使用 `v4`、`r1` 这类短关键词直接命中，必须匹配 `deepseek-v4`、`deepseek-r1` 或 `reasoner/reasoning/thinking` 等明确特征。
* `maxTokens` 在本项目中同时参与请求输出参数和页面上下文预算估算；调整预算逻辑时必须覆盖中文上下文、历史消息、思考过程和用户输入共同占用预算的测试。
* 流式聊天必须通过 `chrome.runtime.connect({ name: "chat.stream" })` 处理增量内容；普通 `runtime.sendMessage` 不应用于长期承载流式模型响应。
* SSE 解析必须容忍心跳、畸形 JSON 片段和分块边界；OpenAI 的 `delta.content` 与 `reasoning_content`、Anthropic 的 `text_delta` 和 `message_stop` 都要分别处理。
* 流式连接必须以最终 `complete` 事件作为成功收尾信号；端口在 `complete` 前断开时，不论是否已收到工具进度或正文增量，都必须将占位 AI 消息收尾为非 streaming 的固定中文失败提示，不得回退为非流式请求或留下永久占位。
* 工具调用链路中，工具决策请求可以强制非流式以稳定收集 `tool_calls`；但工具完成后的最终回答请求必须继承用户当前流式偏好，且不得携带 `tools/tool_choice`。浏览器自动化工具只允许影响最大工具轮次和工具暴露条件，不能让最终总结请求退回非流式。
* OpenAI-compatible 工具决策响应除标准 `message.tool_calls` 外，还必须兼容模型把工具调用写进正文里的 DSML `<｜tool_calls｜><｜invoke name="..."｜>...` 块；解析后必须转成 `ModelToolCall` 并从 assistant 正文移除，禁止把协议文本展示给用户或写入后续上下文。疑似 DSML 工具调用但格式不完整时，也必须转成带 `parseError` 的错误工具结果回灌给模型，由模型决定继续调用工具或输出最终总结，而不是在本地直接中断工具循环或固定总结。
* 模型响应中的工具调用解析必须集中在 `src/background/modelResponseToolParser.ts`；非流式 assistant 响应抽取必须集中在 `src/background/modelAssistantResponseParser.ts`；流式 SSE 响应解析必须集中在 `src/background/modelStreamResponseParser.ts`；`modelRequestHandler.ts` 只负责请求编排和响应分派，不得继续内联堆叠 OpenAI、Anthropic、DSML 或供应商私有格式解析分支。新增或调整私有工具格式时，必须先补充 parser 单元测试覆盖标准调用、非法参数、残缺协议和普通正文不误解析。
* 流式响应只有收到 OpenAI-compatible `[DONE]` 或 Anthropic `message_stop` 等明确完成信号后才算成功；如果连接 EOF 前已有增量但未收到完成信号，必须返回固定中文中断错误，不能把半截正文当成完整回答。
* 非流式工具链在模型返回“无工具调用”的阶段性正文后，也必须再发起一次不携带 `tools/tool_choice` 的最终回答请求；该最终请求用于隔离工具决策上下文和最终用户可见回答，不能让最终回答继续暴露工具 schema。
* AI 回复中的 `<think>...</think>` 只在开头思考块场景解析为 `thinking`；正文中间的类似标签按普通正文保留，避免误删用户可见内容。
* 模型请求异常可能包含敏感信息，用户可见错误必须使用固定中文提示或状态码摘要，不得透出 API Key、签名、请求头或远端原始敏感报文。
* 所有 AI 请求必须携带并遵守聊天偏好中的失败重试次数，默认 5 次；主聊天、流式前工具决策、标题生成、Network 相关性筛选和 URL 正则生成不得绕过统一重试封装。
* AI 请求重试只应用于网络异常、408、429 和 5xx 等可恢复失败；普通 4xx 业务错误不得重复请求，避免放大无效请求和远端限流。
* AI 请求重试必须带指数退避和抖动，429 等限流响应应优先尊重 `Retry-After`；单元测试应通过注入延迟函数避免真实等待。
* 非流式 AI 请求的可恢复失败重试应覆盖响应体读取和 JSON 解析阶段；流式请求只能在开始读取增量前重试，避免重复输出已下发内容。

### 10.7 图片附件、视觉模型与标签页截图

* 图片输入只在当前模型 `supportsVision` 为 `true` 时开放；非视觉模型必须禁用上传、粘贴、截图入口，并在状态层拒绝带图请求。
* 图片附件必须限制类型为 PNG、JPEG、WebP、GIF，单张最大 5MB，单条消息最多 5 张；新增入口必须复用同一限制并补充测试。
* 剪贴板、文件选择和当前标签页截图都属于外部输入，必须校验 MIME、data URL、大小和附件元信息，不能信任浏览器或 content script 返回值。
* 当前标签页截图只接受合法 PNG data URL，附件名固定为 `当前标签页截图.png`；修改截图流程时必须覆盖成功、失败、超限和非法返回值场景。
* OpenAI 兼容请求使用 `image_url` 内容块，Anthropic 请求使用 base64 image 内容块；Anthropic data URL 非法时必须抛出明确错误并由上层转成中文失败提示。
* 历史用户消息中的图片附件必须可持久化、重新加载展示、放大预览，并在编辑后重新生成时随原用户消息继续发送。

### 10.8 会话历史、隐私模式与并发保存

* `ChatSession` 是聊天历史的聚合根；新增会话字段时必须同步更新类型定义、Dexie 读取归一化、同步快照、导出逻辑和相关测试。
* 修改会话消息、标题、文件夹、归档状态或模型选择时，优先通过 `updateChatSession` 在事务中基于最新会话合并，避免异步模型响应覆盖用户后续操作。
* 发送中用户继续输入的草稿不得被响应完成清空；发送状态必须防重复提交，快速连续发送只保留第一次有效请求。
* 重新生成 AI 消息必须丢弃该 AI 消息及后续消息，再基于上方用户消息重新请求；重新生成或编辑用户消息必须丢弃该用户消息后的所有消息。
* 编辑历史用户消息时，空白内容不得触发请求；带图片消息重新发送必须检查当前模型视觉能力并保留原附件。
* 当前会话模型选择优先级为会话保存模型、当前有效选择、默认对话模型、首个可用模型；删除模型或渠道时必须同步清理无效默认模型和会话模型。
* 隐私模式消息只允许保存在内存态 `privateChatSession`，不得自动写入 IndexedDB 或同步快照；手动保存隐私会话后才转为普通历史会话。
* 隐私模式有消息时切换历史会话必须确认，取消时保留内存会话；新建普通对话或保存隐私会话时才退出隐私模式。
* 会话文件夹拖拽必须拒绝归档会话和不存在的目标文件夹；拖拽实现要兼容 React state 丢失时从 `dataTransfer` 恢复源 ID。

### 10.9 Prompt 模板与斜杠调用

* Prompt 模板存储在 `promptTemplates` 表，依赖 Dexie 数据库版本 `3`；新增或调整模板字段时必须同步数据库 schema、仓库方法、同步快照和 v2 升级测试。
* Prompt 模板标题和内容都不能为空，保存前必须 trim；排序必须基于完整 ID 列表校验，参数无效时保留原顺序并输出告警。
* 斜杠调用只在当前输入的最后一个 `/` 后且查询片段不含空白时打开候选；选择模板后必须移除完整斜杠片段，不能残留查询文字。
* 发送消息时保存用户可见输入和 Prompt 调用快照，请求模型时再把快照展开进 user 内容；后续模板修改不应改变历史消息含义。
* `PromptInlineEditor` 基于 `contentEditable`，处理输入、粘贴、换行、退格删除 token 和 IME 组合输入时必须避免 React 受控值与 DOM 光标互相覆盖。
* Prompt token 在编辑器中可以是按钮，但历史消息展示中的 token 不应成为可点击按钮；可访问标签必须区分“已调用提示词”“用户消息提示词”“编辑消息提示词”。
* 导出聊天记录时必须包含 Prompt 调用快照，避免只导出标题导致上下文缺失。

### 10.10 聊天记录导出

* Markdown、Word、PDF 导出必须共用同一套会话块抽象，确保标题、导出时间、会话时间、消息数量、角色、正文、思考过程和 Prompt 快照一致。
* Markdown 导出正文外层代码围栏必须长于正文中已有最长反引号围栏，避免聊天内容提前截断。
* 消息气泡级复制和 AI 消息图片导出必须共用 `createChatMessageMarkdown`，确保剪贴板文本、图片内容、Network 附件和网络搜索附件口径一致。
* 消息级导出遇到历史 Network 附件时必须在导出前重新脱敏，不能直接信任 IndexedDB、同步恢复或旧版本保存的 `title`、`summary` 与请求明细。
* 任何聊天导出或消息导出触发 Blob 下载时，必须复用 `downloadBlob`，由该工具统一负责临时链接清理和 Blob URL 释放。
* Word 导出使用动态 `import("docx")`，避免把文档库无谓前置到初始侧边栏路径；修改导出依赖时必须确认构建产物和懒加载行为。
* PDF 导出通过打开打印窗口实现，弹窗被拦截时必须返回明确中文错误；打印 HTML 必须转义标题和消息正文，避免注入。
* 下载文件名必须清理非法字符、控制字符、空标题和前导点；新增导出格式必须复用同一文件名清洗规则。
* 创建 Blob URL 后必须在 finally 中移除临时链接并释放 URL，即使下载点击失败也不能泄漏页面资源。

### 10.11 数据同步、备份与加密

* 同步功能默认关闭；开启同步不等于开启自动同步，自动备份必须由用户显式开启并通过 Chrome alarms 恢复和触发。
* 备份前必须校验同步已开启、备份前缀非空且不包含路径分隔符或连续点号；远程路径、对象 key 和 Chrome Sync key 不得直接信任用户输入。
* 同步快照必须过滤本地密钥类设置：加密密钥、WebDAV 密码、S3 Secret Key；恢复远端快照时必须保留当前本地这些密钥和远程凭据。
* 加密使用 AES-GCM 和 PBKDF2；加密开启但没有本地密钥时拒绝备份，恢复加密备份失败时返回“确认本地密钥是否正确”的中文错误。
* Chrome Sync provider 必须检查单项配额并返回统一中文提示；WebDAV provider 遇到远程目录不存在时按层级创建目录后重试；S3 provider 使用 SigV4 和 path-style URL。
* 读取远端备份必须先校验 `SyncRemoteBackup` 格式、版本、provider、prefix 和 payload；格式无效或前缀不匹配时不得覆盖本地数据。
* 手动恢复会覆盖本地业务数据，UI 必须二次确认；修改恢复流程时必须覆盖取消确认、保留密钥、旧快照兼容和覆盖本地数据测试。
* 远程备份支持同一前缀保留多份历史版本；新增或修改 provider 时必须实现 `write`、`list`、`read` 和 `delete`，并兼容旧单文件备份。
* 自动清理旧备份只能删除同一前缀下超过 `maxBackupCount` 的最早备份，不能影响其他前缀；修改保留策略必须覆盖跨前缀不删除的测试。
* 手动恢复列表应展示当前备份目标下全部远程备份，允许选择不同前缀的备份恢复；恢复时仍必须校验 provider、备份格式、加密密钥和快照结构。
* 任何新增持久化业务表或设置项都必须同步评估是否进入 `SyncDataSnapshot`，以及是否属于必须过滤的本地密钥或凭据。

### 10.12 IndexedDB、状态仓库与验证边界

* IndexedDB 名称集中在 `DATABASE_NAME`，版本集中在 `DATABASE_VERSION`；新增表或索引只能通过 Dexie version 迁移追加，不能直接修改旧版本 schema 造成历史数据丢失。
* 仓库层负责数据库事务和旧数据归一化，Zustand store 负责 UI 状态编排；不要让 React 组件直接读写 Dexie 表。
* `clearDatabase` 和 `replaceAllDataFromSync` 是高风险覆盖操作，新增表时必须加入这两个函数的事务表列表，避免清理或恢复后数据残留。
* Store 中的异步动作必须在失败时恢复 `sending`、`loading` 等等待态并写入中文错误；不能让 UI 永久卡在处理中。
* 新增 background message type 时必须同步更新 `RuntimeMessage` 联合类型、入口分发、单元测试和必要的中文错误处理。
* 修改 `src/shared/types.ts` 中的持久化类型时，必须同步检查：默认值、旧数据 normalize、存储测试、同步快照、导出、UI 展示和模型请求构造。
* 持久化设置中的 boolean 字段不能直接用 `??` 接收旧数据或同步快照；必须通过 `typeof value === "boolean"` 归一化，非 boolean 值回退默认值。
* `src/side-panel/state/appStore.ts` 应保持为 Zustand store 壳层和 action 绑定入口；聊天请求链路中的 Network 上下文准备、流式消息写入、标题生成、runtime message 封装，以及提取规则、Prompt 模板、页面上下文、同步设置、会话文件夹和会话生命周期小动作等独立动作，应放在同目录相邻模块中，避免重新堆回单个超大 store 文件。
* 文档或配置之外的代码改动，最小验证通常至少包括 `npm run typecheck` 和相关 `vitest` 文件；涉及构建、content script、background 或 manifest 时还必须执行 `npm run build:extension`。
* 项目级综合验证统一使用 `npm run check`；新增质量门禁时优先挂入该脚本，避免不同任务各自维护零散命令。
* 本地可分发扩展目录统一通过 `npm run package:extension` 生成到 `artifacts/chrome-extension`；该命令必须先执行 `npm run build:extension`，再复制 `dist`、校验 HTML 引用的本地相对或根相对资源并写入 `build-info.json`。
* HTML 资源引用校验必须先解析到打包目录内再检查存在性；遇到 `../` 或归一化后会跳出 `artifacts/chrome-extension` 的路径时，必须按缺失资源处理，不能读取项目其他目录来让校验通过。
* 修改打包脚本、Vite 入口、manifest 运行时路径、HTML 资源引用校验或扩展加载目录文档时，必须运行 `npm run check:package`；该脚本应先执行打包脚本单元测试，再生成真实本地扩展目录，并纳入 `npm run check` 综合验证。
* `artifacts/` 属于本地生成产物，必须加入 `.gitignore`，不得手动编辑或提交；需要复现问题时应重新运行打包命令生成。
* Chrome Web Store 自动发布暂不实现，仅作为后续 TODO；未单独设计凭据存储、上传、审核提交、失败回滚和敏感信息保护前，不得新增 `publish:chrome-webstore` 脚本或提交发布凭据示例。
* 涉及侧边栏关键交互、响应式布局、扩展加载、页面提取或导出菜单时，除单元测试外应补充 `npm run test:e2e` 或等价 Playwright 冒烟验证。
* 修改 `public/manifest.json`、background、content script、side panel 入口或 Playwright 扩展 fixture 时，应运行 `npx playwright test --project=chrome-extension` 验证真实 Chrome/Edge 扩展加载；fixture 可优先读取 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`、`CHROME_PATH`、`EDGE_PATH` 或本机 Chrome/Edge 路径，运行前必须能找到 `dist/manifest.json`，缺失时返回明确中文构建提示。
* `SettingsPanel` 只作为设置页签壳层；渠道管理、提取规则、聊天偏好、提示词和同步设置应继续放在 `src/side-panel/components/settings/*` 独立组件中，共享表单控件优先沉到同目录小组件，避免重新堆回单个超大文件。

### 10.13 DevTools Network 上下文

* Network 上下文只在用户显式开启本轮开关后触发；默认关闭，避免无意采集或发送请求详情。
* 相关性筛选属于内部预处理：只能使用当前用户需求和 Network 元数据摘要，不得写入 `ChatMessage`、不得保存到会话历史；筛选阶段的 AI 对话内容不得进入后续主对话上下文。
* 正式模型请求才允许注入筛选出的完整请求详情；注入内容必须基于当前用户需求和已筛选详情构造，不能把筛选阶段的 AI 对话内容拼进主请求。
* Network 详情附件必须挂载到本轮 assistant 消息上，而不是用户消息；聊天面板、历史持久化和导出都要能看到摘要和可读详情。
* 已挂载到历史 assistant 消息的 Network 详情附件必须在后续正式模型请求中继续作为上下文发送，但不得改写用户或 AI 的可见正文，避免聊天列表和导出内容重复膨胀；模型请求、聊天面板展示和聊天记录导出在使用历史附件前都必须重新脱敏，不能信任 IndexedDB、同步恢复、导入或旧版本遗留数据。
* 历史 Network 附件的 `title`、`summary` 属于可迁移脏数据，展示和导出前必须使用固定标题，并基于重新脱敏后的 `requests` 调用统一格式化逻辑重新生成摘要，不得直接展示或导出旧 `title`、`summary` 字段，避免旧版本、导入或同步恢复带入敏感 URL、Header 或 Body 摘要。
* 采集、筛选、详情读取和附件展示都必须默认脱敏敏感 header、query 和 body 字段，并保留 `redacted`、`truncated` 标记；新增原文发送入口前必须增加显式确认和对应测试。
* Background 返回 Network 快照或详情前必须先按统一口径脱敏；`networkContext.getDetails` 的 `requestIds` 属于外部输入，必须校验数组类型、非空字符串、长度和数量边界，非法时不得转发给 DevTools。
* Side Panel 读取 background 返回的 Network 快照和详情后仍应保留二次脱敏，用于防御旧版本 IndexedDB、同步恢复、导入数据或异常 runtime 返回绕过 background 边界；相关测试必须覆盖非法 `requestIds`、请求/响应 header、URL query 和 body 脱敏。
* Network URL 脱敏不能只依赖标准绝对 URL 解析；相对 URL、缺少协议的 URL 或旧快照脏数据也必须尽量脱敏 query 中的敏感参数。DevTools port 返回的快照和详情结构属于外部输入，必须校验数组和必要字段，异常时 fail closed 返回固定中文错误，不能让监听器抛错或让详情请求永久等待。
* DevTools 未连接、没有请求、筛选为空或详情部分读取失败时，必须返回明确中文提示，且不得发送空详情正式分析请求。
* 当前标签页刷新时必须通过 `chrome.tabs.onUpdated` 显式记录刷新状态，并配合 DevTools recorder 的 `chrome.devtools.network.onNavigated` 清空旧请求缓存、重新读取 HAR、重新上报连接；刷新中不得使用旧快照分析，应返回明确中文提示。
* DevTools Network 上下文后续可规划为显式工具，但在独立设计工具暴露条件、请求 ID 参数校验、统一脱敏、附件保存、历史注入和失败提示前，仍保持当前内部预处理流程，不得临时接入通用工具注册表。
* background 对 DevTools port 短暂断开应保留最近快照一小段时间，避免刷新期间立即误报未连接；同 tab 重连后必须取消旧清理并用新快照覆盖。
* DevTools recorder 不能只在脚本加载时 `chrome.runtime.connect` 一次；必须监听 port disconnect，自动重连，并在每次重连后重新读取 HAR、上报当前 inspected tab 的快照，避免“先打开 DevTools，稍后打开 Side Panel”时 service worker 已重启导致连接丢失。
* Background 转发 Network 详情请求给 DevTools 后必须设置超时并清理 pending 记录；DevTools 崩溃、不响应或端口异常时不得让聊天发送流程永久等待。
* 流式模式下应先完成筛选和详情补全，再创建/展示流式 assistant 正文；附件应随 assistant 占位消息一起保存并在完成后保留。
* Side Panel 请求 Network 上下文时必须绑定当前激活标签页对应的 DevTools 连接；未显式传 `tabId` 时只能匹配当前 active tab，不得回退到其他唯一 DevTools 连接，避免把插件自身页面、Side Panel 或 Service Worker 的 DevTools 当成业务页面上下文。
* 打开 Side Panel 时 background 必须记录本次侧边栏绑定的业务 `tabId`，Network 请求未显式传 `tabId` 时应优先使用该绑定 tab，而不是重新依赖 `chrome.tabs.query({ active: true })` 猜测。
* Network 快照成功后必须返回并固定使用该 DevTools 连接的 `tabId`；后续筛选模型调用可能改变浏览器 active tab，读取详情时不得再次依赖当前 active tab 推断连接。
* Network 相关性筛选结果解析必须兼容模型只返回 JSON、返回编号文本，以及误传完整 OpenAI 兼容响应对象的情况；完整响应对象应递归读取 `choices[].message.content` 后再解析 `requestIds`。
* Network 相关性筛选解析必须兼容模型把元数据列表序号误当作 `req-N` ID 返回的情况；当真实请求 ID 不存在该 `req-N` 时，应按元数据顺序映射到第 N 条请求，避免误判筛选为空。
* Chrome HAR 的真实请求 ID 可能是裸数字；Network 相关性筛选解析遇到模型返回 `req-N` 时，必须先检查裸数字 `N` 是否为真实请求 ID，再按元数据序号兜底映射。
* Network 相关性筛选内部模型请求必须优先使用 OpenAI Chat Completions 兼容的 `response_format: { type: "json_schema", ... }` 约束结构化输出，只允许返回 `requestIds` 数组。
* Network 相关性筛选已有分组级语义重试，底层 AI 请求传输重试必须限制为较小上限，避免分组并发时与默认 AI 重试次数相乘放大限流。
* 如果模型明确不支持 `json_schema`，Network 相关性筛选应降级到 Tool Calling / Function Calling；如果工具调用也明确不支持，最后才降级到提示词 JSON 约束。
* Network 相关性筛选请求较多时必须按聊天偏好中的分组大小并发筛选，默认每组 50 条元数据；每组最多重试 3 次，任一组最终失败时必须把本轮 Network 上下文视为失败，不得继续读取部分详情并发送正式分析请求。
* Network 相关性筛选分组大小属于全局聊天偏好；实现时必须同步更新默认值、旧数据归一化、设置面板、存储相关测试和分组筛选回归测试，不能在筛选逻辑中重新硬编码固定分组数。
* DevTools Network 已采集请求、相关性筛选输入请求和筛选后详情注入请求都不设置数量上限；分组筛选数量必须按实际请求数和当前分组大小向上取整，不能先截断再分组。
* 后续对话再次启用 Network 上下文时，进入相关性筛选前必须先用历史 assistant 附件中的完整请求 URL 对新采集请求去重；历史 URL 和新采集 URL 必须使用同一脱敏口径比较，避免旧版本原始 URL 与当前脱敏 URL 匹配不上；同一快照内完整 URL 重复也只保留第一条，避免重复分析和重复加入上下文；缺失 URL 的请求不能被误判为历史重复，应返回明确中文失败提示。
* Network 相关性筛选构造消息和实际模型请求必须共用同一个模型配置参数，避免筛选 Prompt 中的模型元数据与发送请求的模型配置不一致。
* Network 分组工具必须防御非法分组大小，避免 `0`、负数或脏数据造成死循环；用户可见的筛选失败兜底提示必须使用中文。
* Network 请求相关性筛选 Prompt 属于全局聊天偏好；默认值必须等同当前硬编码筛选 Prompt，并支持 `{{userDemand}}`、`{{networkRequests}}` 占位符，缺失占位符时运行时必须补齐必要上下文。
* 修改 Network 请求相关性筛选 Prompt 设置时，必须复用组合输入安全封装，避免中文输入法中间态落库。
* Network 结构化输出约束只应用于筛选调用；正式聊天分析请求不得携带筛选专用 `structuredOutput`，Anthropic Messages 分支也不得盲目透传 OpenAI 专用 `response_format`、`tools` 或 `tool_choice` 字段。
* 结构化输出降级可读取模型失败响应中的有限错误摘要用于内部能力判断，但用户可见错误仍必须是中文摘要，不得透出 API Key、请求头或远端原始敏感报文。
* Side Panel 开启 Network 上下文后必须立即检测并定时刷新当前标签页 DevTools Network 连接状态；检测只读取请求元数据快照，不触发 AI 请求、不写入聊天历史。
* 未检测到当前标签页 DevTools Network 连接时，输入区必须提前显示“关闭 DevTools 后重新打开，再刷新页面”的中文处理建议，不能等用户发送消息后才提示。
* Network 连接状态检测必须静默执行，不要在输入区展示“正在检测”这类短暂中间态；UI 只展示最近一次稳定检测结果，例如未连接提示、已连接但无请求、已采集请求数量。
* Network 默认采集类型集属于全局聊天偏好；默认必须为 `All` 以兼容旧行为，发送分析前必须按所选类型过滤请求元数据，过滤后为空时返回明确中文提示且不得发起相关性筛选。
* Network 请求类型映射必须兼容 Chrome DevTools `_resourceType`，其中 `Fetch/XHR` 合并 `fetch` 与 `xhr`，`Doc/CSS/JS/Img/WS` 分别对应 `document/stylesheet/script/image/websocket`，截图未单列或缺失的类型归入 `Other`。
* AI 消息下方的 Network 请求详情附件中，每条 `.message-network-request-item` 必须可单独折叠，且默认折叠，避免大段 JSON 默认占满聊天面板；请求项必须有明确展开提示，长 URL 和 JSON 不得撑破 Side Panel 布局。
* 用户对开启 Network 上下文产生的消息执行重新生成时，必须保留自动化 Network 分析意图；当前 Network 开关开启时应重新读取快照、筛选并补充详情，而不是退化为普通对话。
* 当前聊天设置中的 Network 筛选分组大小和请求类型属于会话级覆盖，优先级高于全局聊天偏好；留空或恢复默认时才继承全局设置。
* 流式回复异常中断、上游报错或端口未返回内容就断开时，不得删除 AI 占位气泡，也不得自动回退为非流式请求；必须将该 AI 消息收尾为非 streaming，并显示固定中文失败提示。
* 斜杠 Prompt 命令列表必须支持键盘操作：弹出后默认选中第一项，方向键切换，Enter/Tab 选择，同时保留鼠标选择能力。

### 10.14 网络搜索上下文

* Tavily 网络搜索通过 `tavily_search` 原生工具调用启用；输入区不得再提供独立网络搜索按钮，模型仅在工具调用总开关和 Tavily 工具均启用时自行决定是否搜索。
* Tavily 工具只在普通聊天对话中暴露；DevTools Network 分析模式开启时必须从本轮可用工具中排除 Tavily，避免同时触发两类外部上下文。
* Tavily API Key 属于本地密钥配置，不得进入同步快照、导出内容、模型请求 payload 或用户可见错误。
* 网络搜索结果必须以 assistant 消息附件保存、折叠展示并参与聊天记录导出；后续对话请求需要继续携带历史搜索附件上下文。
* 单条 assistant 消息当前只支持一个 Tavily 网络搜索附件；同一轮工具调用出现多次 Tavily 搜索时，必须合并 query、answer 和 results，并按 URL 去重，不能简单以后一次覆盖前一次。
* 旧版网络搜索开关、搜索时机偏好和对外 `webSearch.search` runtime 入口必须移除；Tavily 只能由 `tavily_search` 工具调用触发，background 仅保留内部 Tavily 执行封装供工具执行器复用。
* 渠道管理中的“Tavily 搜索工具”配置必须与“渠道模型”配置保持同级 section，不能嵌套在模型渠道详情中。
* Tavily 的 `include_answer`、`include_raw_content`、`max_results` 属于全局可配置搜索参数，只保存在 Tavily 搜索工具配置中；当前聊天设置不得再提供 Tavily 参数覆盖入口，`max_results` 必须归一化到 Tavily 支持范围。
* Tavily 可配置参数的用户可见标签和选项必须使用中文；仅请求体字段和内部类型保留 Tavily 官方参数名。
* Tavily API Key 输入框默认必须为密文，可提供眼睛按钮临时显示明文；显示状态不得影响存储脱敏和同步过滤规则。
* Tavily 表单参数解析和中文标签格式化必须复用 `src/shared/webSearch/settings.ts`，避免全局设置与工具执行参数口径不一致。
* 网络搜索附件必须使用 `message-web-search-*` 独立样式类名；不得复用 DevTools Network 附件的 `message-network-*` 语义类名。
* Tavily `raw_content` 返回值在用户开启原始内容时必须进入附件、模型上下文和导出内容，并按长度截断；上下文标题等用户可见文案必须使用中文。
* 同步快照不得同步 Tavily API Key，但应保留网络搜索非密钥配置；导出快照时只清空 `webSearchSettings.tavily.apiKeysText`，恢复快照时必须保留当前本地 Tavily API Key。
* 读取历史会话时必须忽略旧版 `webSearchContextAttachment`，不得再归一化为 Tavily 工具附件，也不得进入展示、导出或模型请求。
* 读取历史会话时必须丢弃旧版 Tavily 当前聊天覆盖字段，例如 `webSearchIncludeAnswer`、`webSearchIncludeRawContent`、`webSearchMaxResults`，避免旧数据重新影响工具调用配置或同步快照。
* Tavily 工具参数只允许 `query` 字符串；不得让模型覆盖 `include_answer`、`include_raw_content`、`max_results` 等配置项，运行时必须拒绝空 query 和额外字段。
* 新增搜索渠道时必须通过 `WebSearchProviderType` 扩展配置和附件类型，不能把渠道特有字段硬编码到聊天主流程。
* 渠道管理中模型渠道 item 的展开/折叠只控制当前渠道详情；默认对话模型、AI 标题生成模型和模型列表属于渠道管理配置主体，不得放进单个渠道 item 的折叠内容中。

### 10.15 原生工具调用基础

* OpenAI Compatible 与 Anthropic 的原生工具调用必须共用协议无关的 `ModelToolDefinition`、`ModelToolCall`、`ModelToolResult`、`ModelRequestMessage` 等类型，避免在业务层直接拼各协议私有结构。
* 工具调用总开关默认关闭；每个工具必须通过独立工具 ID 显式启用，当前聊天设置覆盖全局聊天偏好。
* 工具注册表是唯一 allow-list；runtime 消息只传 `enabledToolIds`，background 必须基于注册表和 `enabledToolIds` 自行生成可暴露工具定义，不能信任 UI 或 runtime message 传入的任意 `tools` 定义；`tools` 只允许作为 background 内部净化后的模型请求选项；模型返回的工具名只有匹配已注册且已启用的工具时才允许执行，不能按模型输出动态执行未知工具。
* 模型工具分组必须由系统内置注册表统一提供，用户不可编辑分组、重命名分组或新增分组；新增工具时必须明确归入现有内置分组或同步扩展注册表分组测试。
* 浏览器自动化工具由浏览器控制运行态整组自动启用或禁用，不得作为用户可单独持久化启停的 `enabledToolIds`；UI 中该组工具只能展示跟随运行态的只读状态。
* 模型返回的工具参数属于外部输入，必须解析并校验为普通对象；非法 JSON、数组、空值或非对象参数必须作为中文工具错误回灌，不能静默执行。
* 模型响应解析层发现工具参数非法时，必须写入 `ModelToolCall.parseError`；工具循环层必须基于该字段拒绝执行并把中文错误结果回灌给模型。
* background 工具运行时封装必须集中在 `src/background/backgroundToolRuntime.ts`，包括工具暴露过滤、模型工具定义转换、浏览器控制系统提示、当前时间工具、Tavily 工具和未知工具兜底；`modelRequestHandler.ts` 不得直接内联具体工具执行细节。
* 工具执行结果如果需要保存本地附件，应通过 `ModelToolResult` 附加本地元数据并由工具循环透传给最终响应；发给模型的 `tool` 消息仍只包含文本 `content`。
* 工具调用的决策阶段必须使用非流式请求，避免流式增量难以稳定解析工具调用；用户开启流式偏好且本轮暴露工具时，Side Panel 仍必须通过 `chrome.runtime.connect({ name: "chat.stream" })` 创建 AI 占位气泡，background 必须先用非流式工具决策循环跑到无工具调用或达到上限，再发起最终回答的真实流式请求；最终回答请求不得继续携带 `tools` 或 `tool_choice`，且 `complete` 事件必须透传工具附件元数据，避免 Tavily 等工具启用后丢失占位、打字机体验或搜索附件。
* 当前聊天工具调用入口必须放在 `.composer-actions` 的紧凑图标弹窗按钮中，按钮通过非激活/激活状态提示当前会话是否启用；弹窗内提供“启用”“启用全部”“关闭”和单工具启用列表，单工具激活态必须用边框与底色区分；弹窗默认按 `.composer-tool-menu-wrap` 中心线对齐并在靠近视口边缘时夹住不溢出；当前聊天设置抽屉不承载工具调用配置，避免形成重复入口。
* 工具调用设置 UI 不得提示“启用工具后会强制关闭流式响应”；当前聊天的单工具启停统一通过输入区工具图标弹窗完成，避免多个入口状态不一致。
* Network 相关性筛选使用的 `structuredOutput` 属于内部结构化输出能力，不受用户工具调用总开关影响，避免破坏现有 Network 分析降级链路。
* 新增具体工具时必须补充工具注册、启用/禁用、参数校验、工具结果回灌和禁用状态拒绝执行的单元测试。

## 11. 前端设计系统约束

本项目的前端视觉风格采用 VoltAgent `awesome-design-md` 中的 Claude 设计规范，来源：`https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/claude/DESIGN.md`。

该规范需要被完整落实到新增或修改的前端 UI、预览 HTML、设计说明和交互文案中。由于本项目是 Chrome 扩展 Side Panel，而不是营销官网，执行时必须在不牺牲插件效率、信息密度、响应式和可访问性的前提下使用该风格。

### 11.1 设计方向

* 整体气质是**温暖画布、编辑感、克制工具型**，避免冷灰纯白、蓝紫渐变、普通后台管理台和泛 AI SaaS 模板感。
* 默认页面底色使用暖奶油色画布，主文本使用暖黑色，主要强调色使用柔和珊瑚色。
* 视觉节奏来自三类表面交替：奶油画布、浅奶油卡片、深色产品表面。
* 深色表面只用于产品质感区域，例如代码窗口、模型能力卡、终端感面板、重点 CTA 或底部区域；不要把整个插件做成黑底。
* 主 CTA 和重点强调使用珊瑚色；珊瑚色要少量使用，不能铺满每个控件。
* 插件管理类界面应保持信息清晰、可扫描、重复操作友好，不做营销落地页式大 Hero。

### 11.2 颜色令牌

颜色必须优先抽象为 CSS 变量或 Tailwind theme token，不要在组件中散落硬编码十六进制值。

#### 品牌与强调色

| 令牌 | 值 | 用途 |
|---|---:|---|
| `primary` | `#cc785c` | 珊瑚主色，用于主按钮、主要 CTA、品牌强调 |
| `primary-active` | `#a9583e` | 主按钮按下或激活态 |
| `primary-disabled` | `#e6dfd8` | 禁用态背景，也可作为暖色边线 |
| `accent-teal` | `#5db8a6` | 少量辅助状态，例如连接成功、活动指示 |
| `accent-amber` | `#e8a55a` | 少量暖色辅助强调、分类徽标 |

#### 表面色

| 令牌 | 值 | 用途 |
|---|---:|---|
| `canvas` | `#faf9f5` | 默认页面底色，必须是暖奶油色，不使用纯白作为主画布 |
| `surface-soft` | `#f5f0e8` | 柔和分区背景 |
| `surface-card` | `#efe9de` | 功能卡、内容卡，比画布深一级 |
| `surface-cream-strong` | `#e8e0d2` | 强调分区、选中分类背景 |
| `surface-dark` | `#181715` | 深色产品面、代码窗口、模型展示卡 |
| `surface-dark-elevated` | `#252320` | 深色表面内部的抬升卡片 |
| `surface-dark-soft` | `#1f1e1b` | 深色表面内部代码块背景 |
| `hairline` | `#e6dfd8` | 1px 暖色边线 |
| `hairline-soft` | `#ebe6df` | 更弱的内部分割线 |

#### 文本色

| 令牌 | 值 | 用途 |
|---|---:|---|
| `ink` | `#141413` | 标题和主要文本 |
| `body-strong` | `#252523` | 强调正文 |
| `body` | `#3d3d3a` | 默认正文 |
| `muted` | `#6c6a64` | 次级文本、说明、面包屑 |
| `muted-soft` | `#8e8b82` | 注释、脚注、版权类弱文本 |
| `on-primary` | `#ffffff` | 珊瑚按钮上的文本 |
| `on-dark` | `#faf9f5` | 深色表面上的主文本 |
| `on-dark-soft` | `#a09d96` | 深色表面上的次级文本 |

#### 语义色

| 令牌 | 值 | 用途 |
|---|---:|---|
| `success` | `#5db872` | 成功状态、可用状态 |
| `warning` | `#d4a017` | 警告提示 |
| `error` | `#c64545` | 错误和校验失败 |

### 11.3 字体与排版

* 展示标题使用 slab-serif 风格：优先 `Copernicus` 或 `Tiempos Headline`，不可用时使用 `Cormorant Garamond`、`EB Garamond`、`Georgia` 或系统 serif。
* 正文、导航、按钮、表单标签使用人文无衬线：优先 `StyreneB`，不可用时使用 `Inter`、`Söhne`、`-apple-system`、`BlinkMacSystemFont`、`Segoe UI`、`Roboto`、`sans-serif`。
* 代码、终端、模型请求示例使用 `JetBrains Mono`、`ui-monospace`、`monospace`。
* 展示标题保持 400 字重，不要加粗；强调优先增大字号或增加留白，不靠粗体轰炸。
* 展示标题可使用轻微负字距；正文、按钮、控件标签字距保持 0。若与项目全局规则冲突，插件真实 UI 优先保证可读性和不溢出。
* 在紧凑 Side Panel 中不要使用官网级大标题尺寸；把 display token 按比例下调，保持层级而不是照搬尺寸。

#### 排版令牌

| 令牌 | 字号 | 字重 | 行高 | 字距 | 用途 |
|---|---:|---:|---:|---:|---|
| `display-xl` | `64px` | `400` | `1.05` | `-1.5px` | 官网级主标题；插件内通常不直接使用 |
| `display-lg` | `48px` | `400` | `1.1` | `-1px` | 大分区标题；插件内需降级 |
| `display-md` | `36px` | `400` | `1.15` | `-0.5px` | 子分区标题、模型名展示 |
| `display-sm` | `28px` | `400` | `1.2` | `-0.3px` | CTA 标题、价格或重点卡标题 |
| `title-lg` | `22px` | `500` | `1.3` | `0` | 面板大标题、计划名 |
| `title-md` | `18px` | `500` | `1.4` | `0` | 卡片标题、导语 |
| `title-sm` | `16px` | `500` | `1.4` | `0` | 列表标题、表单组标题 |
| `body-md` | `16px` | `400` | `1.55` | `0` | 默认正文 |
| `body-sm` | `14px` | `400` | `1.55` | `0` | 说明、弱正文 |
| `caption` | `13px` | `500` | `1.4` | `0` | 徽标、辅助标签 |
| `caption-uppercase` | `12px` | `500` | `1.4` | `1.5px` | NEW、BETA、分类标签 |
| `code` | `14px` | `400` | `1.6` | `0` | 代码块 |
| `button` | `14px` | `500` | `1` | `0` | 标准按钮 |
| `nav-link` | `14px` | `500` | `1.4` | `0` | 导航链接 |

### 11.4 圆角

| 令牌 | 值 | 用途 |
|---|---:|---|
| `rounded-xs` | `4px` | 极小徽标、紧凑下拉项 |
| `rounded-sm` | `6px` | 小按钮、菜单项 |
| `rounded-md` | `8px` | 标准按钮、输入框、分类 Tab |
| `rounded-lg` | `12px` | 内容卡、功能卡、代码窗口 |
| `rounded-xl` | `16px` | 大型展示容器 |
| `rounded-pill` | `9999px` | 胶囊徽标 |
| `rounded-full` | `9999px` | 圆形头像、圆形图标按钮 |

### 11.5 间距

| 令牌 | 值 | 用途 |
|---|---:|---|
| `xxs` | `4px` | 最小间隙 |
| `xs` | `8px` | 紧凑控件间距 |
| `sm` | `12px` | 表单和列表内部间距 |
| `md` | `16px` | 标准控件组间距 |
| `lg` | `24px` | 小卡片、面板分组 |
| `xl` | `32px` | 内容卡内部 padding |
| `xxl` | `48px` | 大型 CTA 或重点区域 |
| `section` | `96px` | 官网级大分区间距；插件内仅在宽预览或文档页使用 |

在 Chrome Side Panel 中，优先使用 `8px`、`12px`、`16px`、`24px` 的紧凑节奏；不要把官网 96px 分区节奏硬套到插件面板。

### 11.6 布局

* 官网类页面最大内容宽度约 `1200px` 居中；本插件的 Side Panel 需要随用户拖拽宽度自适应。
* Side Panel 窄宽度下优先单列，宽度增加后可以引入设置级导航，但核心内容仍要保持卡片或表单的窄式可读宽度。
* 功能卡网格：桌面 3 列、平板 2 列、移动或窄面板 1 列。
* 连接器或模型卡片：桌面可多列，窄面板必须单列或 2 列，禁止横向溢出。
* 价格卡或大型比较卡：桌面多列，窄面板单列。
* 代码窗口在移动端或窄面板内允许内部横向滚动，禁止强行换行破坏代码可读性。
* 不允许为了装饰制造卡片套卡片；页面分区应是全宽带状区域或无框布局，卡片只用于独立重复项、表单面板、模态框和真正需要框定的工具区。

### 11.7 层级与深度

* 深度优先由颜色块和表面切换表达，少用阴影。
* 默认平面区域不加阴影。
* 输入框、导航分割、轻量容器使用 `1px` 暖色 hairline。
* 浅色功能卡使用 `surface-card`，通常不加阴影。
* 深色产品卡使用 `surface-dark`，内部可使用 `surface-dark-soft` 或 `surface-dark-elevated` 形成层次。
* 悬浮态可以使用极轻阴影，例如 `0 1px 3px rgba(20, 20, 19, 0.08)`，但不能形成厚重后台面板风格。

### 11.8 组件规范

#### 按钮

* `button-primary`：背景 `primary`，文本 `on-primary`，高度 `40px`，左右 padding `20px`，圆角 `8px`，字号 `14px`，字重 `500`。
* `button-primary-active`：背景 `primary-active`。
* `button-primary-disabled`：背景 `primary-disabled`，文本 `muted`。
* `button-secondary`：背景 `canvas`，文本 `ink`，hairline 边框，高度和圆角与主按钮一致。
* `button-secondary-on-dark`：用于深色表面，背景 `surface-dark-elevated`，文本 `on-dark`。
* `button-text-link`：透明背景，文本使用 `ink` 或 `primary`，用于轻量链接动作。
* `button-icon-circular`：`36px` 正圆，背景 `canvas`，hairline 边框，图标使用 `ink`。
* 插件真实 UI 中，危险操作按钮必须使用错误色或明确文案，不能只靠珊瑚色表达危险。

#### 链接

* 正文链接使用 `primary` 珊瑚色。
* 按下或激活态可以加下划线。
* 不要把链接做成冷蓝色默认浏览器风格。

#### 导航与 Tab

* 顶部导航在官网类页面高 `64px`，背景 `canvas`。
* 插件设置页可使用左侧或顶部 Tab；选中态使用 `surface-card` 或深色 `ink` 背景，避免蓝色后台系统 Tab。
* `category-tab`：透明背景、`muted` 文本、padding `8px 14px`、圆角 `8px`。
* `category-tab-active`：背景 `surface-card`、文本 `ink`。

#### 卡片与容器

* `feature-card`：背景 `surface-card`，圆角 `12px`，内部 padding `32px`；插件紧凑视图可降到 `16px` 或 `20px`。
* `product-mockup-card-dark`：背景 `surface-dark`，文本 `on-dark`，圆角 `12px`，内部 padding `32px`；用于展示产品 chrome、代码、模型能力。
* `code-window-card`：背景 `surface-dark`，内部代码块 `surface-dark-soft`，字体 `code`，圆角 `12px`，padding `24px`。
* `model-comparison-card`：背景 `canvas`，hairline 边框，圆角 `12px`，padding `32px`。
* `pricing-tier-card`：背景 `canvas`，hairline 边框，圆角 `12px`，padding `32px`。
* `pricing-tier-card-featured`：背景切换为 `surface-dark`，文本 `on-dark`。
* `callout-card-coral`：背景 `primary`，文本 `on-primary`，圆角 `12px`，padding `48px`。
* `connector-tile`：背景 `canvas`，hairline 边框，圆角 `12px`，padding `20px`。

#### 表单

* `text-input`：背景 `canvas`，文本 `ink`，字体 `body-md`，圆角 `8px`，padding `10px 14px`，高度 `40px`，hairline 边框。
* `text-input-focused`：边框变为 `primary`，外层使用 `primary` 15% 透明度的 3px focus ring。
* 表单错误使用 `error`，警告使用 `warning`，成功使用 `success`。
* 输入框标签必须清晰，不能只依赖 placeholder。

#### 徽标

* `badge-pill`：背景 `surface-card`，文本 `ink`，字号 `13px`，字重 `500`，圆角胶囊，padding `4px 12px`。
* `badge-coral`：背景 `primary`，文本 `on-primary`，大写标签字号 `12px`，字距 `1.5px`，圆角胶囊。

#### CTA 与页脚

* `cta-band-coral`：大面积珊瑚色 CTA，白色文本，圆角 `12px`，padding `64px`。
* `cta-band-dark`：深色 CTA，背景 `surface-dark`，文本 `on-dark`，圆角 `12px`，padding `64px`。
* `footer`：背景 `surface-dark`，文本 `on-dark-soft`，padding `64px`，不要反转成浅色 footer。
* Chrome 扩展的 Side Panel 通常不需要官网式页脚；仅文档页或预览页可使用。

### 11.9 插画、产品截图与品牌符号

* 优先展示真实产品 chrome、代码窗口、模型配置卡、终端式输出，而不是抽象 AI 插画。
* 插画应使用奶油底、珊瑚和深色线条，保持简单线稿风格。
* 少用摄影；若使用头像，圆形裁剪，常用直径 `40px`。
* Anthropic 式径向尖刺标记只作为风格参考，不得误用真实商标或让用户误以为本项目属于 Anthropic。
* 不使用纯装饰渐变球、紫蓝光斑、无意义背景噪声来制造“AI 感”。

### 11.10 响应式行为

| 断点 | 宽度 | 行为 |
|---|---:|---|
| Mobile | `< 768px` | 单列布局，导航折叠，标题降级，卡片单列 |
| Tablet | `768px - 1024px` | 导航收紧，功能卡 2 列，价格卡 2 列 |
| Desktop | `1024px - 1440px` | 完整导航，功能卡 3 列，价格卡 3 列 |
| Wide | `> 1440px` | 内容最大宽度封顶，增加外侧留白 |

Chrome Side Panel 的实际宽度可能不符合常规页面断点，必须额外满足：

* 面板宽度变窄时不能出现主要内容横向溢出。
* 设置、渠道管理、模型管理优先使用单列卡片和表单。
* 宽面板可以增加左侧设置级导航，但右侧内容仍保持合理最大宽度，不拉成宽表格。
* 触控目标尽量不小于 `40px`；关键操作按钮应接近或超过 `44px` 可点击区域。
* 文本不得溢出按钮、标签、卡片；长模型名、URL、选择器内容必须允许换行、截断或内部滚动。
* 小尺寸圆形图标按钮内使用文字符号（例如 `×`）时，不能只依赖 flex 居中；必须显式设置 `line-height: 1` 并清除默认 padding，避免字体行盒导致视觉上不垂直居中。
* 代码和长 URL 可在局部容器内横向滚动，不让整页滚动。

### 11.11 Do

* 使用暖奶油色作为页面默认画布。
* 使用珊瑚色作为主 CTA 和少数关键强调。
* 使用 serif 展示标题搭配人文 sans 正文，形成编辑感。
* 使用深色产品卡展示代码、模型请求、终端输出、实际功能片段。
* 在浅奶油卡和深色产品面之间形成节奏。
* 使用 8px 按钮/输入圆角、12px 卡片圆角、16px 大型展示容器圆角。
* 大分区之间保持稳定节奏；插件内用紧凑节奏替代官网大留白。
* 优先让真实功能和可读信息成为视觉中心。

### 11.12 Don't

* 不使用冷灰或纯白作为主画布。
* 不使用冷蓝、青色或紫色渐变作为品牌主色。
* 不把珊瑚色铺满所有控件和卡片。
* 不使用粗体 serif 展示标题。
* 不用纯 sans 标题替代展示 serif，除非当前区域是极紧凑控件。
* 不连续重复同一种表面模式，避免一屏全是同色卡片。
* 不添加规范外的复杂 hover 效果；主按钮按下变深即可。
* 不做宽后台表格来管理 Side Panel 的核心配置。
* 不使用普通管理台蓝灰视觉、紫色 AI 渐变、玻璃拟态大背景。

### 11.13 迭代规则

* 一次只聚焦一个组件或一个明确页面区域。
* 变体状态要单独定义，例如 active、disabled、focused。
* 使用 token 引用，不在组件中散落临时颜色、圆角和间距。
* 不单独记录 hover 设计，默认态和 active/pressed 态优先。
* 当强调不足时，优先使用更清晰的层级、留白和 serif 标题，不要直接加粗或加更多颜色。
* 保持“奶油、珊瑚、深色产品面”三元关系，不引入第四种主表面色。

### 11.14 主题样式机制

* 真实 Side Panel 的主题令牌必须集中放在 `src/side-panel/themes/` 目录下，当前默认主题文件为 `src/side-panel/themes/claude-light.css`。
* `src/side-panel/styles.css` 只负责引入当前主题文件、Tailwind 指令、全局基础样式和公共组件样式；不得在其中继续新增大段 `:root` 主题色值。
* 公共组件样式负责结构、间距、布局、状态类和可复用控件外观，例如 `ui-button-primary`、`ui-button-secondary`、`ui-input`、`ui-card`、`ui-panel`；主题文件负责颜色、字体、表面、边线、语义状态等可替换 token。
* 后续新增 UI 时，优先复用公共样式类和 `var(--color-*)`、`var(--font-*)` 等 token；不要在 React 组件里散落硬编码颜色、字体、阴影和重复按钮/输入框样式。
* 新增或修改颜色、表面、文本、语义状态等主题令牌时，应优先更新主题文件，并通过 `var(--color-*)` 在组件样式或 Tailwind 任意值中引用。
* 未来实现多主题切换时，应优先通过替换或按作用域加载主题文件来扩展，例如按根节点主题属性切换不同 theme CSS；避免在组件内写条件色值或散落硬编码十六进制颜色。
* 多主题落地前，新增主题必须先补齐同一套 token 名称，保持公共组件样式不感知具体主题；如果公共组件样式必须新增 token，应同步更新所有已存在主题文件。
* Tailwind 任意值可以引用 CSS 变量，但不能成为绕过主题机制的临时硬编码入口；同一语义重复出现两次以上时，应沉淀为公共类或主题 token。
* 文档预览页、设计说明和真实 Side Panel 可以按需求分开演进；若要让预览页复用真实主题，必须显式纳入当前任务范围，不能顺手改动。

### 11.15 已知限制与项目适配

* `Copernicus` 和 `StyreneB` 是授权字体，不能假设项目可直接使用；未配置字体资源时必须使用替代字体。
* Anthropic 径向尖刺标记属于品牌符号参考，不作为本项目 logo 直接使用。
* 原规范偏营销网站，未覆盖 Chrome 扩展真实产品 UI 的全部组件；本项目应在其色彩、排版、表面、圆角和组件原则下扩展 Side Panel 专用控件。
* 原规范未完整定义动画时长、复杂表单校验、聊天气泡、文件上传 chip、历史会话侧栏等产品组件；新增时必须先写项目级 token 和状态规范。
* API Key、同步密钥、备份凭据等敏感信息 UI 必须以安全清晰为先，不能为了视觉风格削弱警告和确认。
* 聊天输入区高频开关应优先使用紧凑图标按钮，并保留中文 `aria-label`、`title` 和 `aria-checked`；开关本体不加边框和底色，未激活/激活状态仅通过图标颜色区分。

## 12. README 与产品预览资产

* README 中的产品截图统一放在 `docs/assets/product-preview/`，避免图片散落在根目录或临时目录。
* 产品预览图使用固定文件名：`chat-analysis.png`、`settings-channel.png`、`prompt-templates.png`、`sync-backup.png`、`export-prompt.png`。
* 更新 README 产品预览时，只引用上述相对路径；如果图片尚未落盘，可以先保留 Markdown 图片占位，但必须在交付中说明。
* 产品截图不得包含真实 API Key、访问令牌、S3 Secret Key、私有端点、个人账号或其它敏感信息；需要展示时必须先脱敏。
* 纯 README 或图片占位变更不影响运行逻辑，可不执行单元测试和构建，但必须检查 Markdown 链接路径与文档编码。

## 13. 插件教程文档维护

* 项目级插件教程统一维护在 `docs/插件教程.md`，用于沉淀安装、配置、使用流程、功能说明、排障方式、安全注意事项和维护者检查清单。
* 每一次对项目的代码、配置、构建流程、用户可见功能、安全边界、验证方式或操作路径做出改动并完成代码提交后，必须重新检查并完善 `docs/插件教程.md`。
* 如果本次提交不需要修改教程，交付说明中必须明确说明原因，例如变更只涉及内部测试夹具、无用户可见行为变化或教程已有覆盖。
* 修改教程时必须保持简体中文，避免写入真实 API Key、访问令牌、私有端点、个人账号、截图敏感信息或远程存储凭据。
* 纯教程文档变更通常可不运行单元测试和构建，但必须检查 Markdown 标题层级、相对路径、代码块命令和文档编码。

## 14. 工具调用过程与通用附件

* 聊天消息中的工具过程统一写入 `ChatMessage.toolCallRecords`，工具结果附件统一写入 `ChatMessage.toolAttachments`；新增工具不得再为单个工具新增平行的消息字段。
* 工具调用前的 AI 中间回复必须作为独立 `assistant` 消息保存，并使用 `assistantMessageKind: "tool_call_turn"` 标识；工具调用记录只描述工具本身，禁止把 AI 回复正文、思考内容或轮次文本塞进 `ChatToolCallRecord`。
* `assistantMessageKind: "tool_call_turn"` 的工具轮消息仍属于完整聊天历史，必须参与存储、导出、复制和后续上下文构造；任何“紧凑工具过程”之类偏好只能影响聊天面板 UI 展示，不得过滤底层消息数据。
* 启用工具调用时，Side Panel 不应在请求开始就创建最终 assistant 占位；应先写入工具轮 assistant 消息并把本轮工具记录挂在该消息下，最终模型回答再写入单独 assistant 消息。
* 流式工具调用事件采用“工具轮 assistant 占位 + 工具 start/complete 增量更新”的协议：background 可先发送同一 `id` 的 `assistant:tool-turn` 空工具记录消息，随后发送本轮 `tool:start/tool:complete`，Side Panel 必须按消息 `id` 和工具记录 `id` 更新同一工具轮消息；最终 `complete` 事件只承载最终回答正文、思考和 reasoning，不再承载前序工具记录或工具附件。
* 同一条工具轮 assistant 消息内工具调用超过 5 次时，聊天面板应默认折叠，仅展示最后一次调用和总数，并允许用户展开查看全部；该折叠不得影响导出和后续上下文。
* 工具轮消息的工具调用过程必须显示在 assistant 正文下方，并相对整个聊天面板居中；不得把工具过程放进 assistant 气泡宽度体系内，避免连续工具调用时左右参差。
* `assistantMessageKind: "tool_call_turn"` 且没有可见正文、图片或工具附件时，聊天面板只显示居中的工具调用过程，不渲染空 assistant 气泡、头像或消息操作按钮。
* 工具轮 assistant 的 `thinking` 在聊天面板中始终隐藏，但仍必须保留在消息数据、导出和后续上下文中；空正文工具轮即使存在 `thinking`，也应自动只显示工具调用过程。
* `assistantMessageKind: "tool_call_turn"` 的消息气泡下不得显示重新生成、复制、复制为图片等 `.message-regenerate-action` 操作按钮；这类中间消息只作为工具轮上下文和工具过程载体，不应被用户当成最终回答单独操作。
* 非紧凑工具过程模式下是否显示工具调用过程由全局聊天偏好 `showToolCallProcessInAssistantMode` 控制，默认关闭；关闭时聊天面板只展示工具轮 assistant 正文，开启后才在正文下方展示本轮工具过程。该偏好只影响聊天面板 UI，不得影响存储、导出、复制会话和后续上下文构造。
* `toolCallRecords` 必须在工具执行前写入 `running` 状态，工具成功或失败后再补齐 `success/error`、结果摘要、完成时间和关联附件 ID；运行中记录不可点击，完成或失败后才可查看详情。
* background 工具循环新增工具时必须通过注册表提供稳定 `id`、模型工具 `name`、用户可见 `displayName`；附件 kind 由工具返回的 `toolAttachments[].kind` 承载，不得新增未消费的注册表字段，并覆盖 start/complete 事件测试。
* 新增 background 工具执行测试时，优先按工具能力单独命名测试文件，例如 `currentTimeTool.test.ts`；不要把新工具测试继续塞进已有具体工具测试文件，避免文件职责漂移。
* 仅供 AI 推理使用的工具结果，例如当前系统时间，只能作为 tool message 回灌给模型，不得返回 `toolAttachments`，避免在 AI 消息气泡下生成可见附件；相关测试必须断言最终响应不包含 `toolAttachments`。
* 工具附件 kind 必须使用安全的 kebab-case 字符串，并由通用附件组件渲染为 `.message-xxxx-attachment`；Tavily 搜索固定使用 `web-search`，Network 固定使用 `network`。
* Tavily 网络搜索不得再使用历史旧字段 `webSearchContextAttachment`；新结果只能写入 `toolAttachments`。`networkContextAttachment` 仍仅作为 Network 历史兼容读取入口，后续追问、导出和 UI 展示应优先遍历 `toolAttachments`。
* 同一条消息中同一工具多次调用产生的结果附件，在用户展示、导出和后续追问前必须先聚合为一个附件；不同工具即使产生相同 kind 的附件也必须拆分展示。原始 `toolAttachments` 仅用于工具调用详情追溯和附件 ID 关联。
* 工具附件聚合必须同时支持 `attachment.sourceToolCallId` 和 `toolCallRecords[].attachmentIds` 两种关联方式；附件缺少 `sourceToolCallId` 时，必须通过 `attachmentIds` 反查工具记录，避免不同工具的同 kind 附件被误合并。
* 同一工具如果产出多种 kind 的附件，聚合展示层必须降级为通用 `tool-result-set` 附件承载摘要和详情，不能继续按 kind 拆成多块附件。
* 读取历史消息时如果 `toolAttachments` 与旧字段 `networkContextAttachment` 同时存在，必须合并并去重；旧版 `webSearchContextAttachment` 必须直接忽略，避免 Tavily 旧字段重新污染新工具附件协议。
* 工具详情、附件展示和导出前必须重新执行必要脱敏与截断，不得展示 API Key、Authorization、Cookie、签名、原始敏感 URL 参数或未清洗的第三方错误报文。
* 修改工具事件、工具附件或工具可视化时，最小验证必须覆盖 `toolLoop`、background 端口、Side Panel 消息渲染、存储归一化、导出和后续追问上下文。

## 15. 浏览器自动化控制规划

* 浏览器自动化控制总体规划维护在 `docs/浏览器自动化控制总体规划设计.md`，后续阶段实施前必须先基于该总体规划生成当前阶段的详细计划文档，再开始代码变更。
* 浏览器自动化基于 `chrome.debugger`，默认需要在 manifest 中声明 `debugger` 权限，但运行时必须由用户显式开启浏览器控制开关；默认关闭时不得 attach debugger、不得暴露 `browser.*` 工具。
* 浏览器控制 UI 必须展示中文风险提示，说明扩展会通过 Chrome 调试协议读取或操作当前受控页面，且关闭开关后 background 必须立即 detach 并清理连接状态。
* 浏览器控制的唯一用户开关入口必须位于全局设置图标按钮左侧，浏览器控制与设置都使用等尺寸图标按钮，并通过边框和文字颜色表示浏览器控制激活态；设置页、当前聊天设置抽屉和 `.composer-actions` 不得新增平行开关入口。
* 全局 header 图标按钮必须使用视觉重心居中的图标轮廓；浏览器控制图标应采用对称浏览器窗口或控制类图形，避免带气泡尾巴等偏心轮廓导致按钮看起来歪斜。
* `browserControlEnabled` 是全局运行态授权开关，不属于 `chatPreferences` 或 `ChatSessionPreferenceOverrides`；刷新或重载后必须默认关闭，开启失败时前端必须回滚该运行态，不得把 debugger 授权状态持久化到聊天偏好或会话历史。
* 关闭浏览器控制开关后代码必须立即发送关闭并 detach，但 Chrome 顶部“已开始调试此浏览器”提示可能由浏览器延迟数秒消失，不能用人为延迟替代立即 detach。
* 浏览器控制工具仍必须走统一工具注册表 allow-list；runtime 消息只能传 `enabledToolIds`，background 不得信任 UI 或模型传入的任意 `tools` 定义。
* 浏览器自动化工具必须归入独立内置分组；日常对话自动禁用该组工具，只有全局浏览器控制/debugger 模式开启时才自动启用并允许下发该组工具。
* 第一阶段只允许搭建权限、开关、风险提示和连接生命周期；第二阶段只允许接入 `browser.take_snapshot` 快照闭环；第三阶段只允许接入 `browser.click`、`browser.fill`、`browser.press_key`、`browser.wait_for` 基础操作；第四阶段只允许接入 `browser.navigate_page`、`browser.new_page`、`browser.list_pages`、`browser.select_page`、`browser.close_page` 导航与多页面控制；高风险工具必须按规划继续分阶段接入。
* MCP 远程工具调用不属于浏览器自动化地基阶段；如后续接入，必须作为独立工具来源设计配置、权限、脱敏和远程调用边界，不能与本地 `chrome.debugger` 控制逻辑耦合。
* 浏览器控制必须默认拒绝受限页面，包括 `chrome://`、`edge://`、`about:`、`chrome-extension://`、`view-source:` 和 Chrome Web Store；失败时返回固定中文提示，不透出底层敏感错误。
* 快照工具必须通过 Accessibility Tree 生成模型可读页面结构，并维护 UID 与 DOM backend node 的映射；模型不得猜测 UID，页面导航或快照版本变化后旧 UID 必须失效。
* `browser.*` 工具只有在工具调用开启、用户启用对应工具、且全局 `browserControlEnabled` 运行态为 true 时才允许暴露给模型；Side Panel 发送请求前必须过滤关闭状态下的全部 `browser.*` 工具。
* background 也必须基于当前 `BrowserControlManager` 连接运行态二次过滤全部 `browser.*` 工具，不能仅信任 runtime 传入的 `enabledToolIds`；未连接时不得把浏览器工具 schema 或浏览器控制系统提示发送给模型。
* 浏览器自动化工具调用需要支持连续快照、点击、填写、切页等多步流程，可以使用高于普通工具的最大轮次；该轮次必须来自聊天偏好 `browserAutomationMaxToolIterations`，默认 32，并支持当前聊天覆盖全局值；但仍必须保留最大轮次保护，防止模型反复调用工具造成死循环或资源滥用。
* 浏览器自动化工具链路在流式模式下也必须追加不带 `tools/tool_choice` 的最终模型请求，并继承用户当前流式偏好；如果模型仍需继续操作页面，必须在最终请求前的工具决策循环中通过原生工具调用协议返回 `tool_calls` / `tool_use`，避免退化为正文里的伪工具 DSL。
* AI 正文解析必须剥离模型误输出的 DSML 工具调用标记，避免 `< | | DSML | | invoke ...>` 之类内部工具片段进入用户可见消息；如果 DSML 与可见正文出现在同一行，只能剥离工具标记和参数片段，不得误删标签前的正常正文。
* `browser.take_snapshot` 不接受任何参数；background 执行前必须确认当前 debugger 会话已连接，不得为工具调用自动 attach，失败时返回固定中文 tool error。
* 快照输出必须包含页面标题、URL 和模型可读节点结构；输出过长时必须截断并追加中文说明，避免把超大 AX Tree 原样回灌模型。
* 快照格式化必须边遍历边限制 AX Tree 展开深度、节点数量和字符预算，遇到极端嵌套、重复 `childIds` 或超大页面时应输出中文截断说明，不能等完整字符串生成后才截断。
* 快照 UID 复用必须绑定当前页面身份；页面 URL 或标题变化、空快照或 detach 后不得继续复用旧页面的 backend node UID 映射。
* `DOM.enable` 和 `Accessibility.enable` 应在 debugger attach 初始化阶段启用；快照阶段只读取 `Accessibility.getFullAXTree`，且 `BrowserDebuggerConnection` 不应向外暴露任意 CDP 命令发送入口。
* 浏览器控制专用系统提示只能在本轮实际暴露 `browser.*` 工具时追加，必须要求模型先快照、不得猜 UID、工具失败时不得编造页面状态或操作结果。
* 修改 `browser.take_snapshot` 链路时必须覆盖 OpenAI tool_calls、Anthropic tool_use、未开启浏览器控制过滤、伪造 tools 拒绝、空 AX Tree、CDP 失败和 UID 稳定性测试。
* `browser.click`、`browser.fill` 和 `browser.press_key` 的 `includeSnapshot` 只能在操作成功后追加最新快照；操作失败时不得自动追加快照，必须提示重新调用 `take_snapshot`。
* `browser.click` 必须优先使用 `Input.dispatchMouseEvent` 真实鼠标事件，布局读取、命中检测或节点状态异常时才允许使用受控 JS fallback；fallback 只允许触发必要鼠标事件和焦点，不得开放任意脚本能力。
* `browser.fill` 必须通过 UID 定位并受控填写页面元素；文本输入使用聚焦、选择、`Input.insertText` 和 `input/change` 事件，`select` 按 value 或文本匹配，checkbox/radio/switch 只接受 `true` 或 `false`。
* `browser.press_key` 只能接受白名单按键和常见组合键，例如 `Enter`、`Escape`、方向键、`Home/End`、`PageUp/PageDown`、`Space`、单字符字母数字和 `Ctrl/Shift/Alt/Meta` 组合；未知按键必须返回中文错误。
* `browser.wait_for` 只能等待页面可见文本，默认超时 5000ms，最大超时 30000ms；超时必须返回中文 tool error，不能阻塞聊天流程或留下永久占位。
* 阶段四浏览器多页面控制只能在 background 内维护 `controlledTabIds` 后台受控页面列表，不得创建、重命名、复用或删除 Chrome 原生标签组；浏览器控制不应产生用户可见的标签组 UI 副作用。
* 开启浏览器控制时必须把当前窗口内所有可控普通网页加入后台受控页面列表，并排除 `chrome://`、`edge://`、`about:`、`chrome-extension://`、`view-source:`、Chrome Web Store 等受限页面；`new_page` 创建的新页继续加入该列表。
* `browser.navigate_page` 和 `browser.new_page` 只允许导航到合法 `http:` / `https:` 普通网页，并继续拒绝 `chrome://`、`edge://`、`about:`、`chrome-extension://`、`view-source:` 和 Chrome Web Store。
* 导航、新建页面、切换页面、关闭当前受控页面后必须清理旧快照 UID；模型系统提示必须说明旧 UID 失效，继续操作前需要重新 `take_snapshot`。
* 浏览器控制动作执行后应尽力等待潜在导航和短暂 DOM 稳定，避免点击、填写或按键触发跳转后立即读取旧页面状态；稳定等待失败不得无限阻塞聊天流程；动作工具的 `includeSnapshot` 必须在该等待之后再读取快照。
* `close_page` 主动关闭当前受控页时必须处理 Chrome debugger 的预期 detach 事件，不能把工具主动迁移误判成用户取消调试；关闭前应先计算剩余受控页并在关闭后切换接管。
* 遇到网页 JS 弹窗（`alert`、`confirm`、`prompt`、`beforeunload`）时，阶段四只能等待用户手动确认、取消或输入，不得新增 AI 自动处理弹窗工具；等待用户处理最长 60000ms，超时必须返回中文 tool error。
* JS 弹窗关闭结果只归一为用户已确认、用户已取消或用户已确认并输入 prompt 文本；不得试图跨浏览器识别“是/否/确认/取消”的具体按钮文案，也不得编造用户选择。
* 修改阶段四浏览器控制链路时必须覆盖工具 schema、后台受控列表初始化、`new_page` 入列、`list/select/close` 列表边界、受限 URL 拒绝、导航历史、旧 UID 失效和 JS 弹窗等待回归测试。
* `browserControlMessageHandler.ts` 已承载 debugger 连接、快照、页面控制和工具分发多类职责；后续继续扩展浏览器控制前，应优先评估拆分连接、快照、页面导航和弹窗等待子模块，避免单文件继续膨胀。
* 浏览器控制阶段一只落地权限、全局运行态开关、风险提示和 background 调试器连接生命周期；`browserControl.setEnabled` 是当前唯一浏览器控制 runtime 消息，开启失败时前端必须回滚 `browserControlEnabled`。
* `BrowserDebuggerConnection` 必须消费 `chrome.runtime.lastError`，并在关闭开关、标签页关闭或外部 detach 时清理状态；相关修改必须覆盖 attach 成功、受限页面拒绝、关闭 detach 和标签页关闭清理测试。
* `chrome.debugger.attach` 的协议版本必须使用命名常量；`chrome.debugger.onDetach` 必须保留并传递 `reason`，至少区分用户取消调试和目标关闭，为后续 UI 状态同步预留可靠事件来源。
* 用户点击 Chrome 顶部调试提示栏“取消”属于外部 detach，background 必须通过 `browserControl.detached` 广播通知 Side Panel 回滚全局浏览器控制按钮激活态；前端处理该事件时只能更新本地运行态，不得再次发送关闭请求造成循环。
* 浏览器控制显式关闭也必须广播 `browserControl.detached`，让多个 Side Panel 或扩展页面实例同步回滚全局运行态；前端监听该事件时必须校验 `type`、`reason` 和可选 `tabId` 的结构。
* 浏览器控制关闭和标签页关闭清理必须是尽力幂等操作；即使 Chrome 因目标已关闭、外部取消或调试会话不存在而让 `detach` 返回 `lastError`，也必须消费错误并清理本地 attached 状态，不能留下假连接。
* 浏览器控制开启失败、受限页面拒绝或调试 domain 初始化失败后，background 必须清理目标标签页状态；后续 tab 关闭事件不得基于失败残留状态误发 `browserControl.detached`。
* 浏览器控制 `setEnabled` 必须防御快速开启/关闭的乱序竞态；若较早的 attach 回调晚于关闭请求返回，必须立即 detach，并且不得继续启用 CDP domain 或留下已连接状态。

## 16. 流式端口错误处理

* Side Panel 收到 `chat.stream` 端口的 `error` 事件时，应优先展示 background 已归一化的中文错误，避免把模型、工具或协议失败误判为“流式响应异常中断”。
* `chat.stream` 端口在最终 `complete` 前断开，或收到空错误、未知事件、疑似包含 `sk-`、`Authorization`、`Bearer`、`token`、`secret`、`password` 等敏感片段的错误时，仍必须回退到固定中文失败提示，不得展示第三方原始报文。
* 修改流式错误处理时必须覆盖“明确中文错误可见”和“疑似敏感原始错误不外泄”两个回归测试。
