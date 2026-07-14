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
* Git Commit message 必须使用“类型(范围): 简短中文标题”作为首行，空一行后用 `- ` 开头的中文要点说明主要变更，例如：

  ```text
  fix(module): 修复某个具体问题

  - 调整相关逻辑以满足当前需求
  - 补充或更新对应验证用例
  - 同步更新必要的文档或约束说明
  ```

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
* 聊天面板当前模型下拉列表必须按渠道配置顺序分组展示，同一渠道内保留模型原有顺序，避免模型保存顺序交错时不同渠道穿插显示。
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
* 聊天偏好和当前聊天设置里的 `maxTokens` 只表示“最大聊天上下文”请求预算，不得主动作为模型输出 `max_tokens` 参数；调整预算逻辑时必须覆盖中文上下文、历史消息、思考过程、Prompt 快照、图片附件和当前用户输入共同占用预算的测试。
* `ProviderModel.maxTokens` 只表示单个模型请求 payload 的输出上限 `max_tokens`，默认值为 `32768`；旧模型缺失该字段或仍为历史默认 `1024` 时必须归一化为 `32768`，非 1024 的用户自定义值必须保留。
* 流式聊天必须通过 `chrome.runtime.connect({ name: "chat.stream" })` 处理增量内容；普通 `runtime.sendMessage` 不应用于长期承载流式模型响应。
* SSE 解析必须容忍心跳、畸形 JSON 片段和分块边界；OpenAI 的 `delta.content` 与 `reasoning_content`、Anthropic 的 `text_delta` 和 `message_stop` 都要分别处理。
* 流式连接必须以最终 `complete` 事件作为成功收尾信号；端口在 `complete` 前断开时，不论是否已收到工具进度或正文增量，都必须将占位 AI 消息收尾为非 streaming 的固定中文失败提示，不得回退为非流式请求或留下永久占位。
* AI 请求重试进度需要通过 background 端口事件传递到侧边栏，仅作为当前 AI 占位消息的临时 UI 状态展示；`正在重试 m/n` 不得写入 `ChatMessage` 持久化字段、同步快照或导出内容，且在收到正文增量、完成、失败、取消或断开时必须立即清除。
* 工具调用链路中，工具决策请求可以强制非流式以稳定收集 `tool_calls`；但工具完成后的最终回答请求必须继承用户当前流式偏好，且不得携带 `tools/tool_choice`。浏览器自动化工具只允许影响最大工具轮次和工具暴露条件，不能让最终总结请求退回非流式。
* 产生工具调用的工具决策阶段自然语言正文属于过程消息，只能作为 `assistantMessageKind: "tool_call_turn"` 展示或回传；最终普通 assistant 消息必须只使用最终回答请求的结果。
* 工具链路进入最终回答请求时，必须明确告诉模型工具调用阶段已经结束、不会再执行工具，并要求直接给出用户可见中文总结；上一轮工具决策阶段自然语言正文只能作为过程参考，不得把“我将继续调用/测试/等待工具”这类工具决策阶段过渡话术当作最终回复交付。
* 工具循环中的“已引导对话”必须作为当前运行任务的持续请求级覆盖层：被消费后每次工具决策请求和最终回答请求都要重新注入，但不得反复写入普通 `messages` 历史；文本引导应合并进当前请求的 system 约束，图片引导可以作为临时 user 附件消息但不得成为最后一条 user 消息；每次重注入前必须同时清理旧的 user 引导消息和 system 中的持续引导块，避免模型每轮误以为刚收到新引导并反复回复“好的/明白”；上下文压缩成功后必须重新构造运行时请求，最后一条仍应是当前任务提醒或最终回答指令，不能停留在“请基于以上压缩上下文继续当前任务”这类泛化继续指令；`appendCurrentTaskReminder` / `getLatestUserTaskContent` 只能基于真实用户任务消息生成“当前必须优先处理的最新用户请求”，避免引导内容反向覆盖主任务并引发重复工具循环。
* 工具决策阶段如果模型已经返回工具调用，助手自然语言正文必须先净化后再展示或回灌：仅确认、复述、转述、纯计划以及与活动引导冲突的正文可以置空，实质性的阶段判断、行动说明和证据总结必须保留，避免确认话术在多轮工具循环中自我强化。
* 工具附件池只表示 UI 查看、导出和按需精查的证据仓库，不等同于后续模型上下文；最终回答消息引用工具附件时，必须显式区分 UI 附件引用和允许进入后续请求的上下文附件引用，避免压缩边界之前的大 Network/JS 摘要通过最终回答消息重新进入下一次真实请求上下文。
* 浏览器自动化工具链路进入最终回答请求时，还必须要求模型区分事实证据、模型推断和未验证假设；工具结果只能作为事实证据，基于证据的判断应标为模型推断，未被工具或用户确认的信息必须标为未验证假设。
* 工具决策循环最后一次返回“无工具调用”的自然语言正文只能作为内部收束信号，不得再落库或通过 `assistant:tool-turn` 发送为空工具记录的阶段性总结，避免最终总结前重复显示阶段性总结。
* OpenAI-compatible 工具决策响应除标准 `message.tool_calls` 外，还必须兼容模型把工具调用写进正文里的 DSML `<｜tool_calls｜><｜invoke name="..."｜>...` 块；解析后必须转成 `ModelToolCall` 并从 assistant 正文移除，禁止把协议文本展示给用户或写入后续上下文。疑似 DSML 工具调用但格式不完整时，也必须转成带 `parseError` 的错误工具结果回灌给模型，由模型决定继续调用工具或输出最终总结，而不是在本地直接中断工具循环或固定总结。
* DSML 工具调用解析必须同时兼容 `<｜tool_calls｜>`、`<|tool_calls|>` 和 `< | | DSML | | tool_calls>` 这类命名空间格式；带 `< | | DSML | | parameter name="..." string="...">` 的参数块必须在 background 转成结构化工具参数，不能只依赖 Side Panel 展示层剥离。当前命名空间兼容范围固定为 `DSML` 前后各两个半角或全角竖线，不为未知三竖线等变体静默扩宽协议。
* 流式响应增量写入 UI 前也必须同时过滤正文和 `reasoning_content`/思考过程里的 DSML 工具块，不能只依赖最终 `complete` 消息覆盖；过滤器必须保持普通文本、`<think>` 块和正常 reasoning 增量的原有分段回调行为，避免为隐藏协议文本牺牲正常流式体验。
* DSML 流式过滤器的跨 chunk 前缀保留规则必须与完整解析协议口径一致，至少同时覆盖半角、全角以及 `DSML` 命名空间工具块；新增协议写法时必须同步更新完整解析和前缀窗口测试，避免半截内部协议先进入 UI。
* 模型响应中的工具调用解析必须集中在 `src/background/modelResponseToolParser.ts`；非流式 assistant 响应抽取必须集中在 `src/background/modelAssistantResponseParser.ts`；流式 SSE 响应解析必须集中在 `src/background/modelStreamResponseParser.ts`；`modelRequestHandler.ts` 只负责请求编排和响应分派，不得继续内联堆叠 OpenAI、Anthropic、DSML 或供应商私有格式解析分支。新增或调整私有工具格式时，必须先补充 parser 单元测试覆盖标准调用、非法参数、残缺协议和普通正文不误解析。
* 流式响应只有收到 OpenAI-compatible `[DONE]` 或 Anthropic `message_stop` 等明确完成信号后才算成功；如果连接 EOF 前已有增量但未收到完成信号，必须返回固定中文中断错误，不能把半截正文当成完整回答。
* 非流式工具链在模型返回“无工具调用”的阶段性正文后，也必须再发起一次不携带 `tools/tool_choice` 的最终回答请求；该最终请求用于隔离工具决策上下文和最终用户可见回答，不能让最终回答继续暴露工具 schema。
* AI 回复中的 `<think>...</think>` 只在开头思考块场景解析为 `thinking`；正文中间的类似标签按普通正文保留，避免误删用户可见内容。
* 模型请求异常可能包含敏感信息，用户可见错误必须使用固定中文提示或状态码摘要，不得透出 API Key、签名、请求头或远端原始敏感报文。
* 所有 AI 请求必须携带并遵守聊天偏好中的失败重试次数，默认 5 次；主聊天、流式前工具决策、标题生成、Network 相关性筛选和 URL 正则生成不得绕过统一重试封装。
* AI 请求重试只应用于网络异常、408、429 和 5xx 等可恢复失败；普通 4xx 业务错误不得重复请求，避免放大无效请求和远端限流。
* 模型返回 2xx 但解析后没有任何可用正文、思考内容或工具调用时，视为可恢复的空模型响应；在尚未向 UI 输出流式增量前必须按聊天偏好重试，重试耗尽后才显示“模型响应中没有可用内容”。
* OpenAI-compatible 的 `finish_reason=length`、Anthropic 的 `stop_reason=max_tokens` 必须视为输出上限截断，不得因收到 `[DONE]` 或 `message_stop` 而当作成功完成；`content_filter` 等安全截断必须返回固定中文提示，不能暴露远端原始敏感报文；流式截断返回失败前必须先 flush DSML 过滤器中已确认安全的可见尾段，避免用户已收到的半截内容再额外丢尾。
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
* 聊天消息列表自动滚动必须尊重用户当前位置：只有消息列表已触底或距离底部 8px 内时，新消息、流式增量或重试状态更新才允许继续滚动到底部；用户已向上查看历史消息时不得抢夺滚动位置，相关改动必须覆盖已触底和未触底回归测试。
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
* 上下文压缩摘要 `assistantMessageKind: "context_summary"` 只作为模型请求边界和排障历史保留，不得作为普通助手消息导出；`chat.context_compression` 工具过程消息也不得导出为空助手块。
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
* 同步 provider 测试如果涉及并发读取多个远端备份，Mock 响应必须按请求 URL 或对象 key 匹配，不得用 `mockResolvedValueOnce` 假定并发请求顺序。

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
* 发布新版本时必须同步更新 `package.json`、`package-lock.json` 和 `public/manifest.json` 的版本号；若包含多项功能提交，应补充 `CHANGELOG.md` 发布范围与主要变化，并运行 `npm run check` 生成可验证的本地可分发扩展目录。
* 发布大版本前必须先用 `git log origin/master..HEAD` 核对本地未推送提交范围，并在 `CHANGELOG.md` 中记录发布覆盖范围，避免遗漏本地已完成但尚未推送的功能与修复。
* 发布小版本同样必须核对 `git log origin/master..HEAD`，并确保 `CHANGELOG.md` 发布范围、`package.json`、`package-lock.json` 和 `public/manifest.json` 的版本号一致。
* 发布 GitHub Release 前必须确认对应版本 tag 不存在、GitHub CLI 已登录且目标分支已推送；Release 正文应与本次版本说明一致，避免本地变更日志和远端发布说明漂移。
* 发布 GitHub Release 的 tag 和 Release title 不得包含中文或功能说明，只允许使用 `vX.Y.Z` 形式，例如 `v3.4.0`，避免 Release 列表标题混杂中文导致可读性和检索一致性下降。
* 发布 GitHub Release 时必须上传本地打包好的插件压缩包，例如 `artifacts/browser-ai-assistant-vX.Y.Z.zip`；不得只发布 GitHub 自动生成的源码包。
* Windows PowerShell 中创建或更新 GitHub Release 正文时，必须优先使用 UTF-8 文件并通过 `--notes-file` 传入，避免中文内容经管道传输后乱码。
* v3.6.1 发布范围固定为 `v3.6.0` 后的历史会话批量操作；发布资产必须命名为 `artifacts/browser-ai-assistant-v3.6.1.zip`，Release 标题与 tag 均使用 `v3.6.1`。
* HTML 资源引用校验必须先解析到打包目录内再检查存在性；遇到 `../` 或归一化后会跳出 `artifacts/chrome-extension` 的路径时，必须按缺失资源处理，不能读取项目其他目录来让校验通过。
* 修改打包脚本、Vite 入口、manifest 运行时路径、HTML 资源引用校验或扩展加载目录文档时，必须运行 `npm run check:package`；该脚本应先执行打包脚本单元测试，再生成真实本地扩展目录，并纳入 `npm run check` 综合验证。
* `artifacts/` 属于本地生成产物，必须加入 `.gitignore`，不得手动编辑或提交；需要复现问题时应重新运行打包命令生成。
* Chrome Web Store 自动发布暂不实现，仅作为后续 TODO；未单独设计凭据存储、上传、审核提交、失败回滚和敏感信息保护前，不得新增 `publish:chrome-webstore` 脚本或提交发布凭据示例。
* 涉及侧边栏关键交互、响应式布局、扩展加载、页面提取或导出菜单时，除单元测试外应补充 `npm run test:e2e` 或等价 Playwright 冒烟验证。
* 修改 `public/manifest.json`、background、content script、side panel 入口或 Playwright 扩展 fixture 时，应运行 `npx playwright test --project=chrome-extension` 验证真实 Chrome/Edge 扩展加载；fixture 可优先读取 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`、`CHROME_PATH`、`EDGE_PATH` 或本机 Chrome/Edge 路径，运行前必须能找到 `dist/manifest.json`，缺失时返回明确中文构建提示。
* `SettingsPanel` 只作为设置页签壳层；渠道管理、提取规则、聊天偏好、提示词和同步设置应继续放在 `src/side-panel/components/settings/*` 独立组件中，共享表单控件优先沉到同目录小组件，避免重新堆回单个超大文件。
* 渠道模型列表接口并非所有供应商都支持；渠道管理必须保留手动模型 ID 添加路径。新增或修改手动模型输入时，必须支持英文逗号批量添加、过滤空值和重复值，并补充模型 ID 编辑与 IME 组合输入回归测试。当前渠道模型区的“清空所有”按用户要求点击后立即清空当前渠道全部模型，不做二次确认；修改该行为必须补充回归测试。

### 10.13 Debugger Network 工具化

* Network 分析不再依赖 `chrome.devtools.network`、`devtools_page`、DevTools 页面或 `network.devtools` port；不得要求用户手动打开 DevTools，也不得新增“打开 DevTools”的工具入口。
* 用户开启浏览器控制后，background 必须通过已有 `chrome.debugger` 连接启用 CDP `Network.enable` 并在后台采集请求；关闭浏览器控制、切换受控 tab、tab 关闭或 debugger detach 时必须清理对应 Network 缓存。
* `network.*` 属于浏览器自动化工具组，只在工具调用总开关开启、浏览器控制开启、当前 tab 已 attach 且 Network recorder 已启用时暴露；普通发送消息不得再执行发送前自动 Network 筛选或自动注入。
* `network.*` 只作为内部稳定工具 ID 和用户可见文档口径；发给 OpenAI-compatible 模型的 `function.name` 必须使用 `network_list_requests` 这类只包含字母、数字、下划线或短横线的安全名称，禁止包含点号，执行器可兼容旧点号名称用于历史工具调用回放。
* `network.list_requests`、`network.get_request_details`、`network.clear_requests`、`network.wait_for_requests`、`network.compare_requests`、`network.find_parameter_candidates`、`network.extract_js_candidates` 必须通过统一工具执行器分发，参数需要校验类型、数量、长度、超时和上限。
* Network recorder 的请求缓存必须设置最大条目上限并优先淘汰已完成旧请求，避免长时间 SPA、轮询或大量静态资源导致 background 内存无限增长；正在等待 response/status 的 pending 请求不能被优先淘汰，避免 `wait_for_requests` 错过后续匹配事件；工具默认列表输出和执行器 `limit` 必须限制为 200，不能只依赖模型 schema。
* `Network.getResponseBody` 读取前必须跳过明显二进制资源，例如图片、音视频、字体、压缩包、PDF 和 `application/octet-stream`；新增资源类型读取策略时必须补充“不调用 getResponseBody”的单元测试。
* Network 请求体字段分析只能在 `Content-Type` 明确 JSON 或 `application/x-www-form-urlencoded` 时拆字段；纯文本、XML、protobuf、未知类型以及“内容刚好是 JSON 的非 JSON 类型”应作为整体 body 字段截断分析，避免 `URLSearchParams` 或 `JSON.parse` 误拆造成逆向线索污染。
* Background 读取 Network 元数据、详情和响应体前后都必须按统一口径脱敏敏感 header、query 和 body 字段，并保留 `redacted`、`truncated` 标记；`requestIds` 属于外部输入，非法时 fail closed，不能转发给 CDP。
* `Network.getResponseBody` 只允许用于读取已采集请求的响应体；Cookie、Authorization、Storage、证书、凭据类 CDP 方法仍不得加入浏览器控制 allow-list。
* Network URL 脱敏不能只依赖标准绝对 URL 解析；相对 URL、缺少协议的 URL、旧快照或导入脏数据也必须尽量脱敏 query 中的敏感参数。
* Network 工具结果如需用户可见详情，只能写入通用 `toolAttachments`，附件 kind 固定为 `network`；旧字段 `networkContextAttachment` 仅作为历史兼容读取入口，不得再生成新数据。
* 历史 Network 附件展示、导出和后续上下文使用前必须重新脱敏并重新生成固定标题和摘要，不能信任 IndexedDB、同步恢复、导入或旧版本保存的 `title`、`summary` 与请求明细。
* `network.compare_requests`、`network.find_parameter_candidates`、`network.extract_js_candidates` 只做启发式辅助分析，不得自动解锁或回传 Cookie、Authorization、Token 等原文敏感字段。
* `js.list_resources`、`js.search_sources`、`js.extract_context` 属于浏览器自动化工具组，必须与 `network.*` 使用相同暴露条件；JS 源码索引、同源补位和工具执行器必须拆成独立模块，禁止继续堆入 `BrowserNetworkRecorder`、`BrowserNetworkToolExecutor` 或 `browserControlMessageHandler.ts` 主流程。
* `js-source` 工具附件必须通过通用 `toolAttachments` 保存、展示、导出和后续上下文注入；历史归一化和聚合必须保留 `redacted`、`truncated`、资源来源、命中位置和同源补位失败摘要。
* `js-source` 空结果附件如果仍包含合法 `kind`、标题、摘要或 `sourceToolCallId`，归一化时必须保留，避免工具调用完成但没有资源、命中、上下文或失败项时 UI 丢失结果；展示层聚合必须复用共享层结构化聚合并基于去重后的结构重新生成摘要，不能拼接旧 `summary`。
* `js-source` 展示计数必须匹配当前附件的主要内容：存在搜索命中或上下文时显示片段数；仅列出资源时显示资源数，避免标题角标与摘要中的资源数量不一致。
* JS 同源补位只允许读取当前受控页面同源的 `http`/`https` JS 静态文本资源；不得携带 Cookie、Authorization 或浏览器存储凭据，不得用于 API 请求、请求重放、批量探测或跨域重定向跟随。
* JS 源码索引必须跟随受控页面生命周期清理：执行 `network.clear_requests`、关闭浏览器控制、导航、刷新、历史前进后退、切换受控标签页时，都不得继续暴露旧页面的 JS 命中或上下文。
* JS 资源判定只能基于 URL `pathname` 的 `.js/.mjs` 后缀、`resourceType=Script` 或可信 JavaScript MIME；不得被 query/hash 中的 `.js`、JSON/HTML MIME 或非脚本资源误导。
* 同源 JS 补位响应必须使用可信 JavaScript MIME 白名单，并在读取正文前基于 `Content-Length` 等可用头信息拦截超大响应；禁止把 JSON、HTML 或未知文本响应当作 JS 源码读入内存。
* `sourcemap.list_candidates`、`sourcemap.resolve_location`、`sourcemap.extract_original_context` 属于浏览器自动化工具组，必须与 `network.*`、`js.*` 使用相同暴露条件；发给 OpenAI-compatible 模型的函数名必须使用 `sourcemap_list_candidates` 这类安全名称。
* Source Map 工具必须复用 `JsSourceIndex` 中已索引的 JS 资源内容、响应头和生命周期，不得维护第三份 JS 源码缓存；执行 `network.clear_requests`、关闭浏览器控制、导航、刷新、历史前进后退、切换受控标签页时，必须同步清理 Source Map 缓存。
* Source Map 候选发现必须按优先级处理响应头 `SourceMap`、兼容头 `X-SourceMap`、源码尾部 `sourceMappingURL` 和 inline data URL；输入行列对外使用一基行列，调用 `@jridgewell/trace-mapping` 时必须转换为行一基、列零基。
* 外部 Source Map 只允许读取当前受控页面同源的 `http`/`https` map 或 JSON 文本资源；fetch 必须使用 `credentials: "omit"` 和 `redirect: "manual"`，跨域、跨协议、跨端口、跨域重定向、非法 MIME、超时和超大小响应必须返回固定中文失败。
* 外部 Source Map 读取失败必须优先区分浏览器拒绝请求、超时、HTTP 状态码失败、响应体读取失败以及 JSON/mappings 解析失败；相关改动必须覆盖压缩响应读取和 Network 已采集同源 `.map` 回退测试。
* 外部 Source Map 的同源 URL 归一化、同源判断、MIME 白名单和大小上限必须集中复用 `sourceMapFetchGuards`，不要在 fetcher、executor 或 UI 层各自维护分叉规则。
* Source Map 复用 Network 已采集 `.map` 详情作为回退时，必须同时校验 `status` 为 2xx、`failed !== true`、未截断、同源、MIME 合法、UTF-8 字节数未超限且 JSON 可解析；回退成功也要在候选摘要中保留主动读取失败原因和已复用 Network 响应的说明，便于诊断。
* inline Source Map data URL 只接受 JSON、source-map 或可信文本 JSON，解码前后都必须限制大小；非法编码、非法 JSON 或非法 mappings 必须 fail closed，并返回固定中文摘要。
* Source Map 工具只允许从 `sourcesContent` 提取有限原始源码片段；不得主动拉取 `sources` 指向的原始源码文件，不得保存完整 Source Map 或完整 `sourcesContent` 到 `toolAttachments`、历史、同步快照、导出或后续追问上下文。
* `source-map` 工具附件必须通过通用 `toolAttachments` 保存、展示、导出和后续上下文注入；历史归一化和聚合必须保留候选来源、映射位置、原始片段、失败摘要、`redacted` 与 `truncated` 标记。
* `source-map` 原始片段即使未实际替换敏感词，也必须标记为已进入脱敏管道；UI 展示、工具正文、导出和后续追问上下文只能输出 `resourceId`、行列、原始 source、name、ignored、sourcesContent 状态和中文失败摘要，不得直接 `JSON.stringify` 完整对象或暴露完整 `resourceUrl`；候选展示只能显示 inline、外部 Source Map 或无 URL 摘要，不得直接渲染完整 map URL。
* Source Map 原始源码片段展示、导出和再次注入模型前必须复用敏感赋值脱敏和截断规则，避免泄露 Cookie、Authorization、Token、API Key、Secret、Password、Session、CSRF 等凭据。
* 浏览器自动化授权统一为三种运行态：`normal_restricted` 普通模式、`controlled_enhanced` 受控增强模式、`full_access` 完全访问最高权限模式；聊天偏好只能保存“开启浏览器控制后的默认模式”，不得保存当前页面的已授权运行态、一次性 grant、会话历史授权或导出授权。
* 浏览器控制关闭时当前运行态必须显示并收口为 `normal_restricted`；用户开启浏览器控制后，Side Panel 才能按聊天偏好中的默认模式同步到 background，若 background 拒绝必须回退到普通模式并给出中文错误。
* `.composer-switches` 中流式响应开关左侧必须保留三模式选择；顶部不得恢复“运行时只读分析”按钮。浏览器控制关闭时模式选择必须禁用并显示普通模式。
* 三模式选择菜单弹层必须使用当前主题已定义的实体背景变量，例如 `--color-canvas`、`--color-surface-soft` 或 `--color-surface-card`；不得引用未定义的 `--color-surface` 导致弹层背景在 Claude light 主题下变成透明。
* `runtime.inspect_globals`、`runtime.search_modules`、`runtime.describe_function` 已并入普通模式默认能力；它们属于浏览器自动化工具组，但仍必须满足浏览器控制开启、当前 tab 已 attach、Network recorder 已启用和 background 固定只读模板校验。
* `runtime.*` 已接入统一工具注册表，OpenAI-compatible 函数名固定为 `runtime_inspect_globals`、`runtime_search_modules`、`runtime_describe_function`；浏览器控制开启不等于允许任意 Runtime 表达式，只能执行固定只读模板并由三模式运行态过滤。
* `runtime.*` 工具不得接收模型传入的任意 JavaScript 表达式，只能接收路径、关键词、模块索引、数量上限和摘要半径等结构化参数，并由独立执行器拼装固定只读模板；危险路径段、超长输入、超预算结果和疑似副作用用途必须 fail closed。
* `runtime.*` 解析 CDP `Runtime.evaluate` 响应时必须显式校验响应层级类型；用户输入路径允许 `window.` / `globalThis.` 作为控制台书写习惯前缀，但执行固定模板前必须统一剥离并继续套用危险字段校验。
* `runtime.*` 固定模板读取对象属性时必须优先通过自有 data property 描述符读取，accessor 属性必须跳过并标记；每个属性读取都要独立容错，避免 getter 或页面对象异常把“只读摘要”变成页面业务代码执行或整轮工具失败。
* `runtime.*` 只允许读取公开全局配置、模块缓存摘要和函数摘要；不得 DOM 写入、表单填写、点击、导航、刷新、发起网络请求、调用页面业务函数，或读取 Cookie、LocalStorage、SessionStorage、IndexedDB 等敏感存储。
* `runtime.*` 结果必须脱敏、截断并限制对象深度、数组/对象条目数、函数字符串长度和总字节数；字符串中出现 Cookie、Authorization、Bearer、JWT、API Key、Secret、Password、Session、CSRF 等敏感值时必须按值级或整段脱敏，不能只替换字段名；默认只作为 tool message 回灌模型，未完成附件 kind、展示、导出、历史归一化和后续追问上下文设计前不得生成用户可见 `toolAttachments`。
* 用户选择的三模式在当前会话内生效，不能因为 AI 回复轮次、工具循环、`network.clear_requests`、导航、刷新、切换受控 tab 或自动化模式消息里的历史 `expiresAt` 自动回到普通模式；只有用户手动切换、关闭浏览器控制、tab 关闭或 debugger detach 这类硬断开才能收口为普通模式。
* 完全访问模式允许暴露 `full_access.*`，并按用户当前会话授权关闭人为脱敏、只读限制、敏感信息过滤、逐项边界确认和请求重放沙箱限制；普通模式和受控增强模式不得暴露 `full_access.*`，background 对伪造调用必须 fail closed。
* 受控增强模式才允许暴露 `boundary.request_user_choice` 和 `replay.*`；普通模式不得暴露 `replay.*`、`full_access.*`，完全访问模式下模型应直接使用 `full_access.*` 执行最高权限动作，不再触发受控增强边界确认。
* `boundary.request_user_choice` 必须展示 AI 提供的问题、原因、动态多选项、风险等级和授权摘要；UI 必须固定追加“其他”自由输入项。“其他”只回灌给模型，不得直接生成授权。
* 边界确认弹窗提交或取消后必须立即进入本地提交中状态，禁用选项、文本框和提交/取消按钮，避免同一个 `requestId` 被重复响应导致误报失败。
* 受控增强模式下，任何 `network.*`、`js.*`、`sourcemap.*`、`runtime.*` 或 `replay.*` 工具结果只要检测到 `[已脱敏]`、`[REDACTED]`、敏感字段、截断摘要、请求重放发送确认、JS/Source Map 上下文扩展、Runtime 高风险路径、完全访问边界或其他需要用户授权的权限边界，就必须主动触发 `boundary.request_user_choice` 或在工具结果中强制要求模型下一步调用该工具；用户提交前工具循环应阻塞在确认边界上，不得继续推断、还原、请求、扩展上下文或输出敏感原文。
* 受控增强边界检测必须覆盖具体拒绝语义：同源 JS 补位失败、同源 JS 跨域重定向、Source Map 读取/同源/大小/MIME/JSON/mappings/浏览器拒绝失败、inline Source Map 失败、请求重放草案不存在/过期/跨页面/敏感 Header/方法或大小越界、运行时只读未授权、运行时路径表达式或高风险字段。普通参数类型错误、空 UID、等待超时等不涉及越权的失败不应自动弹边界确认，避免确认噪声。
* 页面副作用确认第一版复用 `boundary.request_user_choice`，不新增并行确认工具；当工具结果或提示词明确涉及表单提交、删除、付款、发布或发送消息等真实业务副作用时，必须要求模型先请求用户确认，不得把按钮文案、模型推断或工具成功当作用户确认。
* 文件上传、下载和本地文件访问确认第一版复用 `boundary.request_user_choice`，不新增并行确认工具，也不默认开放上传/下载执行工具；当工具结果或提示词明确涉及文件上传、下载、选择本地文件、读取本地文件或本地文件路径时，必须要求模型先请求用户确认，不得编造、读取、复用本地路径，也不得把页面存在文件控件或下载链接当作用户确认。
* 跨站点跳转和第三方授权页确认第一版复用 `boundary.request_user_choice`，不新增并行确认工具；当工具结果或提示词明确涉及离开当前站点、跨 origin 导航、第三方登录/OAuth/OIDC 授权页或身份提供方页面时，必须要求模型先请求用户确认，不得把 URL、页面标题、按钮文案或跳转成功当作用户确认。
* 用户在受控增强弹窗中允许“脱敏或敏感字段”后，当前 Network 详情类工具必须基于一次性 grant 立即重读当前请求详情，并把本轮工具结果和当前可见附件改为未脱敏结果；不能只把“用户已确认”文字回灌给模型却继续展示 `[已脱敏]`。该未脱敏附件只能作为当前工具结果/当前消息可见内容存在，历史追问上下文、复制、导出、同步归一化和旧附件恢复仍必须重新脱敏。
* 受控增强的每一个 `BrowserAutomationGrant` 都必须有对应执行器消费路径和回归测试；新增或修改 grant 时，测试必须证明“用户选择允许后，当前工具行为真实改变并且 grant 被一次性消费”。禁止只在弹窗、Prompt 或 tool result 文案中声明授权而不改变执行边界。
* 受控增强白名单只允许登记当前阶段已有真实消费路径的 grant；无副作用或仅保留摘要的选项必须使用空 `grants: []`，不得通过新增 grant 制造“已授权但执行器不消费”的伪放行状态。
* 边界确认返回后，manager 是否重跑原工具只能由当前 `scopeKey` 下的具体 grant 是否可消费决定，不能依赖“已触发确认”或“grantCreated”这类过程状态，避免把确认文案误当成真实放行。
* 受控增强一次性 grant 必须绑定 `scopeKey`，且消费时必须匹配当前工具名和关键参数签名；授权请求 A 不得放行请求 B、草案 B 或同源同 tab 下的其他工具调用。
* `scopeKey` 生成必须兼容内部点号工具 ID 与 OpenAI-compatible 下划线工具名，避免 AI 用 `network.get_request_details` 绑定、实际执行 `network_get_request_details` 时出现“用户允许但未放行”。
* AI 主动调用 `boundary_request_user_choice` 且选项包含非空 `grants` 时，必须同时提供 `targetToolName` 和 `targetToolArguments` 生成可消费 `scopeKey`；缺少目标工具绑定时执行器必须 fail closed，不得把“用户已确认”文字当成真实放行结果回灌模型。
* 同一轮模型返回多个浏览器自动化工具调用时必须串行执行，避免多个工具并发覆盖 `BoundaryGrantContext`、Network 缓存或请求重放草案；普通非浏览器工具可继续并发。
* 用户选择 AI 提供的边界选项后，只能生成绑定当前 tab、origin、工具轮和过期时间的一次性 `BoundaryGrantContext`；grant 不得持久化，不得跨 tab/origin/tool round 复用；导航、刷新、切换受控 tab 和 `network.clear_requests` 只能清理已生成 grant 与请求重放草案，不能取消正在等待用户提交的边界确认表单，也不能改写用户选择的三模式。
* `replay.*` 必须采用 `prepare -> boundary.request_user_choice -> send -> compare` 的执行边界；模型只能生成脱敏重放草案，不能代替用户确认发送请求，background 也必须拒绝跳过确认的伪造工具调用。
* 阶段五请求重放默认无凭据：不得携带 Cookie、Authorization、Proxy-Authorization、API Key、Storage、IndexedDB、客户端证书、扩展本地密钥、页面上下文凭据，也不得重放包含敏感 query/body 字段的请求；如需敏感凭据必须进入阶段六逐次解锁设计，阶段五只能返回固定中文拒绝。
* 请求重放工具只允许验证非敏感接口结构，默认限制为当前受控页面同源或用户逐次确认的已采集请求目标；禁止模型构造任意第三方扫描目标、批量参数字典、撞库、爆破、绕过验证码、规避风控或解释如何绕过 401/403。
* 请求重放执行器必须独立于 Network recorder、JS source index、Runtime read executor 和 `browserControlMessageHandler.ts` 主流程；请求必须由 background 受控沙箱发起，禁止注入页面执行 `fetch` 或借页面上下文携带站点凭据。
* 请求重放必须限制 method、协议、host、header、请求体类型、请求体大小、响应体大小、超时、重定向次数、并发和本轮调用次数；默认只允许 `GET`、`HEAD` 和可证明无凭据、无敏感 body 的受限 `POST`，`PUT`、`PATCH`、`DELETE` 和文件上传类请求必须先保持禁用。
* 请求重放结果默认只作为 tool message 回灌模型；未完成 `request-replay` 附件 kind、展示、导出、历史归一化和后续追问上下文设计前，不得生成用户可见 `toolAttachments`，也不得保存完整 URL、header、body 或响应原文。
* 关闭浏览器控制、切换受控 tab、导航、刷新、debugger detach、授权过期或终止生成时，必须清理请求重放授权、草案和临时确认，并中止正在进行的重放请求；其中切换受控 tab、导航和刷新不得顺带把用户选择的受控增强模式改回普通模式。
* 敏感字段解锁和“完全访问”属于请求重放之后的最高风险授权层，默认关闭；用户切换到完全访问模式后，本会话当前受控页面可通过 `full_access.execute_script`、`full_access.fetch`、`full_access.get_network_details`、`full_access.read_storage` 和 `full_access.revoke` 执行最高权限动作，工具结果可原样回灌给 AI。
* “完全访问”是用户在当前会话当前受控页面显式选择的最高权限模式；该模式下不得再叠加人为逐项确认、只读、脱敏、敏感字段过滤、请求重放沙箱、凭据剥离或目标范围白名单。实现仍只能使用 Chrome、网页和扩展平台本身允许的能力。
* 完全访问的当前页面授权、一次性 grant 与运行态证据不得持久化到聊天偏好、同步快照或导出配置；聊天偏好只允许保存“下次开启浏览器控制后默认进入完全访问”的用户偏好。用户切换模式、关闭浏览器控制、tab 关闭、debugger detach 或用户撤销时，当前完全访问授权必须立即失效，并广播状态变化让所有 Side Panel 收口。刷新、导航、工具轮次变化或生成终止不得擅自把用户选择的完全访问模式改回普通模式。
* 完全访问模式不再拆成草案和确认执行两步；用户切换模式即视为当前会话授权。实现仍只能使用 Chrome、网页和扩展平台本身允许的能力，不得声称能绕过浏览器、网页 CSP、站点权限或扩展平台硬限制。
* 修改完全访问工具时，必须覆盖：普通/受控增强不暴露、完全访问暴露、非完全访问伪造调用 fail closed、脚本执行原始返回、fetch 默认 `credentials: "include"`、Network/Storage 原文返回、撤销和生命周期清理。
* 完全访问工具结果允许原样进入 tool result、聊天消息、工具附件和后续 AI 上下文；Network 详情、列表、等待、聚合附件、展示组件、导出和后续追问上下文必须共同识别 `fullAccess: true` 与 `redacted: false`，不得在附件链路重新脱敏为“已脱敏”。
* 完全访问模式下不再要求高权限脚本或请求走草案、逐项确认或受控增强边界弹窗；如执行失败，只能返回平台、页面或扩展实际错误的安全摘要，不得声称已绕过浏览器、网页 CSP、站点权限或扩展平台硬限制。
* 受控只读 `Runtime.evaluate`、请求重放沙箱、敏感字段解锁与完全访问之外的更高风险 Web 逆向能力仍默认关闭；未单独完成权限、确认、脱敏、审计、取消和测试设计前不得实现或暗中启用。
* 修改 Network 工具、浏览器控制 debugger allow-list、manifest、background 入口或工具注册时，最小验证必须覆盖相关 vitest、`npm run typecheck` 和 `npm run build:extension`；涉及真实扩展加载路径时还应运行 `npx playwright test --project=chrome-extension`。
* Network 工具化与完整 Web 逆向路线的主规划文档统一维护在 `docs/Network工具化与Web逆向自动化规划.md`；该文档必须与当前实现保持一致，旧版 DevTools Network 手动连接方案只可作为历史背景，不得作为当前操作说明继续传播。

### 10.14 网络搜索上下文

* Tavily 网络搜索通过 `tavily_search` 原生工具调用启用；输入区不得再提供独立网络搜索按钮，模型仅在工具调用总开关和 Tavily 工具均启用时自行决定是否搜索。
* Network 工具调用与 Tavily 搜索均由模型在工具总开关下主动选择，新增工具互斥策略前不得在发送前额外注入平行上下文。
* Tavily API Key 属于本地密钥配置，不得进入同步快照、导出内容、模型请求 payload 或用户可见错误。
* 网络搜索结果必须以 assistant 消息附件保存、折叠展示并参与聊天记录导出；只有 `assistantMessageKind: "tool_call_turn"` 工具过程消息上的搜索附件允许将摘要带入后续对话，普通最终回答上的搜索附件引用只用于 UI、导出和排障，不得重新展开到模型上下文。
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
* 工具调用总开关默认开启；全局聊天偏好默认选中注册表中的全部工具，当前聊天设置覆盖全局聊天偏好。
* 工具注册表是唯一 allow-list；runtime 消息只传 `enabledToolIds`，background 必须基于注册表和 `enabledToolIds` 自行生成可暴露工具定义，不能信任 UI 或 runtime message 传入的任意 `tools` 定义；`tools` 只允许作为 background 内部净化后的模型请求选项；模型返回的工具名只有匹配已注册且已启用的工具时才允许执行，不能按模型输出动态执行未知工具。
* 模型工具分组必须由系统内置注册表统一提供，用户不可编辑分组、重命名分组或新增分组；新增工具时必须明确归入现有内置分组或同步扩展注册表分组测试。
* 浏览器自动化工具必须允许进入用户可持久化的 `enabledToolIds`，但发送模型请求前必须再按当前 `toolClassification.runtime` 与真实运行态过滤；开启浏览器控制不得自动把整组浏览器工具追加到请求中。
* 全局聊天偏好中的工具列表只配置新对话默认启用值，必须允许用户在任意浏览器控制和自动化模式状态下预选或取消所有工具；`runtime` 为 `browser_control`、`controlled_enhanced`、`full_access` 的工具实际发送前仍必须按当前运行态过滤。
* 当前聊天工具弹窗的单选、全选和分类批量启用必须复用注册表结构化分类；`runtime` 为 `browser_control`、`controlled_enhanced`、`full_access` 且当前运行态不满足时必须置灰并跳过批量启用。
* 模型返回的工具参数属于外部输入，必须解析并校验为普通对象；非法 JSON、数组、空值或非对象参数必须作为中文工具错误回灌，不能静默执行。
* 模型响应解析层发现工具参数非法时，必须写入 `ModelToolCall.parseError`；工具循环层必须基于该字段拒绝执行并把中文错误结果回灌给模型。
* background 工具运行时封装必须集中在 `src/background/backgroundToolRuntime.ts`，包括工具暴露过滤、模型工具定义转换、浏览器控制系统提示、当前时间工具、Tavily 工具和未知工具兜底；`modelRequestHandler.ts` 不得直接内联具体工具执行细节。
* 工具执行结果如果需要保存本地附件，应通过 `ModelToolResult` 附加本地元数据并由工具循环透传给最终响应；发给模型的 `tool` 消息仍只包含文本 `content`。
* 工具调用的决策阶段必须使用非流式请求，避免流式增量难以稳定解析工具调用；用户开启流式偏好且本轮暴露工具时，Side Panel 仍必须通过 `chrome.runtime.connect({ name: "chat.stream" })` 创建 AI 占位气泡，background 必须先用非流式工具决策循环跑到无工具调用或达到上限，再发起最终回答的真实流式请求；最终回答请求不得继续携带 `tools` 或 `tool_choice`，且 `complete` 事件必须透传工具附件元数据，避免 Tavily 等工具启用后丢失占位、打字机体验或搜索附件。
* 当前聊天工具调用入口必须放在 `.composer-actions` 的紧凑图标弹窗按钮中，按钮通过非激活/激活状态提示当前会话是否启用；弹窗内提供“启用”“启用全部”“关闭”和单工具启用列表，单工具激活态必须用边框与底色区分；弹窗默认按 `.composer-tool-menu-wrap` 中心线对齐并在靠近视口边缘时夹住不溢出；当前聊天设置抽屉不承载工具调用配置，避免形成重复入口。
* 工具调用设置 UI 不得提示“启用工具后会强制关闭流式响应”；当前聊天的单工具启停统一通过输入区工具图标弹窗完成，避免多个入口状态不一致。
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
* README 顶部必须保留 `docs/插件教程.md` 的使用教程入口；改写 README 时应结合项目实际能力、数据安全边界、配置方式、使用体验和当前版本状态重新组织，不得直接照搬发布帖或社区宣传文案。
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

* 聊天消息中的工具过程统一写入 `ChatMessage.toolCallRecords`；工具结果附件实体统一写入会话级 `ChatSession.toolAttachmentsById`，消息只保存 `ChatMessage.toolAttachmentIds` 引用。旧 `ChatMessage.toolAttachments` 只作为历史兼容读取入口，新写入路径不得再把完整附件大对象挂到多条消息上。
* 工具调用前的 AI 中间回复必须作为独立 `assistant` 消息保存，并使用 `assistantMessageKind: "tool_call_turn"` 标识；工具调用记录只描述工具本身，禁止把 AI 回复正文、思考内容或轮次文本塞进 `ChatToolCallRecord`。
* `assistantMessageKind: "tool_call_turn"` 的工具轮消息仍属于完整聊天历史，必须参与存储、导出、复制和后续上下文构造；任何“紧凑工具过程”之类偏好只能影响聊天面板 UI 展示，不得过滤底层消息数据。
* 启用工具调用时，Side Panel 不应在请求开始就创建最终 assistant 占位；应先写入工具轮 assistant 消息并把本轮工具记录挂在该消息下，最终模型回答再写入单独 assistant 消息。
* 流式工具调用事件采用“工具轮 assistant 占位 + 工具 start/complete 增量更新”的协议：background 可先发送同一 `id` 的 `assistant:tool-turn` 空工具记录消息，随后发送本轮 `tool:start/tool:complete`，Side Panel 必须按消息 `id` 和工具记录 `id` 更新同一工具轮消息；最终 `complete` 事件只承载最终回答正文、思考和 reasoning，不再承载前序工具记录或工具附件。
* 同一条工具轮 assistant 消息内工具调用超过 5 次时，聊天面板应默认折叠，仅展示最后一次调用和总数，并允许用户展开查看全部；该折叠不得影响导出和后续上下文。
* 工具轮消息的工具调用过程必须显示在 assistant 正文下方，并相对整个聊天面板居中；不得把工具过程放进 assistant 气泡宽度体系内，避免连续工具调用时左右参差。
* `assistantMessageKind: "tool_call_turn"` 且没有可见正文、图片或工具附件时，聊天面板只显示居中的工具调用过程，不渲染空 assistant 气泡、头像或消息操作按钮。
* 工具轮 assistant 的 `thinking` 在聊天面板中始终隐藏，但仍必须保留在消息数据、导出和后续上下文中；空正文工具轮即使存在 `thinking`，也应自动只显示工具调用过程。
* `assistantMessageKind: "tool_call_turn"` 正文为空但存在 `toolAttachmentIds` 可解析附件时，聊天面板应只展示附件和工具调用过程，不得额外渲染空 assistant 气泡或消息操作按钮。
* 聊天面板展示空正文工具轮附件时，应向上归属到上一条正文非空的 assistant 气泡下，并在展示层按附件 kind 聚合；例如连续多个 Network 附件应合并为一个“Network 请求详情”附件并累计请求数量。该展示归属不得改写底层消息、导出或后续上下文数据。
* 当 assistant 工具轮没有可见正文、可见思考、工具调用过程或可见附件时，消息列表不得渲染空的 `.message-entry` 外壳；空壳应直接跳过，避免 DOM 中残留无内容节点。
* 聊天气泡中的 Markdown 表格外框必须随内容宽度收缩，并在超出气泡时才横向滚动；不得让圆角外框占满气泡宽度而 `thead`/`tbody` 仅按内容宽度显示，避免出现双重边框视觉。
* 聊天气泡中的 Markdown 表格必须通过专用表格块保留真实 `<table>` 语义；不得在表格顶部渲染常驻 bar，复制入口应真实插入表头最后一列并在该单元格内居右显示；表格块宽度必须随内容 `fit-content` 收缩，超出气泡时再由滚动容器横向滚动；复制 Markdown 应从渲染后单元格文本重建 GFM 表格且排除表头操作区；复制图片应把排除操作区后的表格副本放入离屏容器完成真实布局，再按克隆表格最终尺寸生成高清 PNG，不得使用固定留白、裁剪区域或复制固定高度兜底；所有表格复制图片都必须走 canvas 表格绘制路径，禁止为保真把表格重新送回 SVG `foreignObject` 路径，避免 SVG 二次布局再次造成底部裁切；失败时显示中文错误且不得自动下载文件。
* Markdown 表格表头插入复制按钮后，`th` 必须覆盖为垂直居中，表头内容容器应有稳定最小高度和完整宽度；`td` 可以继续顶部对齐以适配长内容，避免按钮高度把表头文字视觉上顶到上边。
* ReactMarkdown 自定义表格组件必须过滤 `node` 等渲染器内部 props，避免把未知属性透传到真实 DOM；专用表格样式之外仍需保留 `.message-bubble table` 基础兜底样式，防止未来新增渲染路径时表格裸奔。
* v3.2.0 发布确认：Markdown 表格复制图片的首要验收标准是“完整、不裁切”；若后续要增强富文本保真，必须先证明不会重新引入 SVG `foreignObject` 裁切问题，并补充真实高度、多行和富内容表格回归测试。
* `assistantMessageKind: "tool_call_turn"` 的消息气泡下不得显示重新生成、复制、复制为图片等 `.message-regenerate-action` 操作按钮；这类中间消息只作为工具轮上下文和工具过程载体，不应被用户当成最终回答单独操作。
* 非紧凑工具过程模式下是否显示工具调用过程由全局聊天偏好 `showToolCallProcessInAssistantMode` 控制，默认关闭；关闭时聊天面板只展示工具轮 assistant 正文，开启后才在正文下方展示本轮工具过程。该偏好只影响聊天面板 UI，不得影响存储、导出、复制会话和后续上下文构造。
* `toolCallRecords` 必须在工具执行前写入 `running` 状态，工具成功或失败后再补齐 `success/error`、结果摘要、完成时间和关联附件 ID；运行中记录不可点击，完成或失败后才可查看详情。
* background 工具循环新增工具时必须通过注册表提供稳定 `id`、模型工具 `name`、用户可见 `displayName`；附件 kind 由工具返回的 `toolAttachments[].kind` 承载，不得新增未消费的注册表字段，并覆盖 start/complete 事件测试。
* 新增 background 工具执行测试时，优先按工具能力单独命名测试文件，例如 `currentTimeTool.test.ts`；不要把新工具测试继续塞进已有具体工具测试文件，避免文件职责漂移。
* 仅供 AI 推理使用的工具结果，例如当前系统时间，只能作为 tool message 回灌给模型，不得返回 `toolAttachments`，避免在 AI 消息气泡下生成可见附件；相关测试必须断言最终响应不包含 `toolAttachments`。
* 工具附件 kind 必须使用安全的 kebab-case 字符串，并由通用附件组件渲染为 `.message-xxxx-attachment`；Tavily 搜索固定使用 `web-search`，Network 固定使用 `network`。
* Tavily 网络搜索不得再使用历史旧字段 `webSearchContextAttachment`；新结果只能进入通用工具附件体系并落到会话级附件仓库。`networkContextAttachment` 与旧 `toolAttachments` 仍仅作为历史兼容读取入口，读取后必须迁移为 `toolAttachmentsById + toolAttachmentIds`。
* 同一条消息中同一工具多次调用产生的结果附件，在用户展示、导出和后续追问前必须先聚合为一个附件；不同工具即使产生相同 kind 的附件也必须拆分展示。原始附件实体只保存在会话级仓库中，消息引用仅用于工具调用详情追溯和附件 ID 关联。
* 工具附件聚合必须同时支持 `attachment.sourceToolCallId` 和 `toolCallRecords[].attachmentIds` 两种关联方式；附件缺少 `sourceToolCallId` 时，必须通过 `attachmentIds` 反查工具记录，避免不同工具的同 kind 附件被误合并。
* 同一工具如果产出多种 kind 的附件，聚合展示层必须降级为通用 `tool-result-set` 附件承载摘要和详情，不能继续按 kind 拆成多块附件。
* 未知 kind 的同类工具附件在展示层聚合时不得只保留第一个附件；必须降级为通用附件并合并标题、摘要、详情、脱敏和截断标记，避免后续新增附件类型时静默丢失数据。
* 读取历史消息时如果旧 `toolAttachments` 与旧字段 `networkContextAttachment` 同时存在，必须合并并去重后迁移到 `ChatSession.toolAttachmentsById`；旧版 `webSearchContextAttachment` 必须直接忽略，避免 Tavily 旧字段重新污染新工具附件协议。
* 后续请求构造、当前上下文 Token 估算、复制、导出和消息展示都必须通过 `toolAttachmentIds -> toolAttachmentsById` 解析附件；同一上下文范围内相同附件 ID 只能展开一次，禁止工具过程消息和最终回答消息重复注入同一批 Network/JS 附件。
* Network、JS、Source Map、FullAccess 等长附件的完整详情默认只用于附件弹窗、复制和导出；后续模型上下文只能注入轻量摘要、ID、URL、状态、位置和短片段，不得默认注入 response body、request body、完整 header、完整 JS 源码或图片 base64。
* 工具详情、附件展示和导出前必须重新执行必要脱敏与截断，不得展示 API Key、Authorization、Cookie、签名、原始敏感 URL 参数或未清洗的第三方错误报文。
* 修改工具事件、工具附件或工具可视化时，最小验证必须覆盖 `toolLoop`、background 端口、Side Panel 消息渲染、存储归一化、导出和后续追问上下文。

## 15. 浏览器自动化控制规划

* 浏览器自动化控制总体规划维护在 `docs/浏览器自动化控制总体规划设计.md`，后续阶段实施前必须先基于该总体规划生成当前阶段的详细计划文档，再开始代码变更。
* 浏览器自动化通用工具集补全与工具分类规划维护在 `docs/浏览器自动化通用工具集补全规划设计.md`；新增或调整工具前必须先明确其运行要求、核心能力和总体风险，避免只按实现文件或单一分组管理工具。
* 浏览器自动化阶段落地后，规划文档中的历史“缺口”必须同步改写为“原始缺口与当前状态”，明确区分已落地第一版、仍保留后续预留和明确不默认开放的能力，避免完成审计时把历史描述误判为当前未完成项。
* 工具分类只能用于 UI 筛选、批量启用、提示词和审计展示，不能替代工具注册表 allow-list、`requiredCapabilities` 过滤、运行态授权和 background 执行期二次校验。
* 浏览器自动化系统提示词必须使用“观察页面、操作页面、分析现场、请求确认、交付结果”和风险级别约束模型调度顺序；模型应先观察再操作、操作后验证，且不得把高风险或最高风险工具结果当作用户确认。
* 后续新增浏览器自动化工具时，应优先按“观察页面、操作页面、分析现场、请求确认、交付结果”五类归档，并同步补充注册表测试、暴露条件测试和必要的脱敏/导出测试。
* `automation-report` 是阶段 E 交付结果附件 kind，只能由后台基于真实 `ChatToolCallRecord` 和已有 `toolAttachments` 自动生成，不得新增模型可调用的报告生成工具，也不得信任模型传入的报告结构。
* `automation-report` 必须进入通用 `toolAttachments` 体系，覆盖历史归一化、消息展示、导出和后续追问上下文；报告内容必须包含任务类型、目标、结论、步骤证据、自动化时间线、失败摘要和 `fullAccessIncluded` 标记。
* `automation-report.timeline` 只能由后台基于真实工具调用记录、页面变化记录、等待记录、用户确认记录或失败恢复建议生成；第一版从 `ChatToolCallRecord` 推导工具调用、页面变化、等待、用户确认和失败恢复事件，不得让模型伪造时间线。
* `automation-report.reportType` 只能由后台基于真实工具调用记录或旧报告步骤推导，第一版固定为 `general`、`page_inspection`、`form_diagnosis`、`interface_analysis` 四类；不得让模型传入或覆盖任务类型。
* `automation-report` 的目标、结论、步骤证据、时间线详情、失败工具和可恢复动作在保存、展示、导出和后续追问前必须脱敏与截断；完全访问工具结果只能通过 `fullAccessIncluded` 标明存在，不得把原文重新写入报告摘要。
* 除 `system.current_time` 和 `web_search.tavily` 外，当前所有浏览器自动化、分析、确认、重放和完全访问工具都必须在 `chrome.debugger` 模式下才可启用；非 `chrome.debugger` 模式下这些工具在 UI 中必须置灰，background 也必须拒绝伪造调用。
* 工具全选、按分类启用、预设启用或导入配置恢复时，都必须跳过当前运行态不可用的 debugger 工具；模型请求构造前也必须按真实运行态过滤工具 schema 和浏览器自动化系统提示词。
* 浏览器自动化基于 `chrome.debugger`，默认需要在 manifest 中声明 `debugger` 权限，但运行时必须由用户显式开启浏览器控制开关；默认关闭时不得 attach debugger、不得暴露 `browser.*` 工具。
* 浏览器控制 UI 必须展示中文风险提示，说明扩展会通过 Chrome 调试协议读取或操作当前受控页面，且关闭开关后 background 必须立即 detach 并清理连接状态。
* 浏览器控制的唯一用户开关入口必须位于全局设置图标按钮左侧，浏览器控制与设置都使用等尺寸图标按钮，并通过边框和文字颜色表示浏览器控制激活态；设置页、当前聊天设置抽屉和 `.composer-actions` 不得新增平行开关入口。
* 全局 header 图标按钮必须使用视觉重心居中的图标轮廓；浏览器控制图标应采用对称浏览器窗口或控制类图形，避免带气泡尾巴等偏心轮廓导致按钮看起来歪斜。
* `browserControlEnabled` 是全局运行态授权开关，不属于 `chatPreferences` 或 `ChatSessionPreferenceOverrides`；刷新或重载后必须默认关闭，开启失败时前端必须回滚该运行态，不得把 debugger 授权状态持久化到聊天偏好或会话历史。
* 关闭浏览器控制开关后代码必须立即发送关闭并 detach，但 Chrome 顶部“已开始调试此浏览器”提示可能由浏览器延迟数秒消失，不能用人为延迟替代立即 detach。
* 浏览器控制工具仍必须走统一工具注册表 allow-list；runtime 消息只能传 `enabledToolIds`，background 不得信任 UI 或模型传入的任意 `tools` 定义。
* 浏览器自动化工具必须归入独立内置分组；日常对话默认不下发该组工具，只有用户已启用对应工具且全局浏览器控制/debugger 运行态满足该工具分类要求时，才允许下发该工具。
* 第一阶段只允许搭建权限、开关、风险提示和连接生命周期；第二阶段只允许接入 `browser.take_snapshot` 快照闭环；第三阶段只允许接入 `browser.click`、`browser.fill`、`browser.press_key`、`browser.wait_for` 基础操作；第四阶段只允许接入 `browser.navigate_page`、`browser.new_page`、`browser.list_pages`、`browser.select_page`、`browser.close_page` 导航与多页面控制；高风险工具必须按规划继续分阶段接入。
* MCP 远程工具调用不属于浏览器自动化地基阶段；如后续接入，必须作为独立工具来源设计配置、权限、脱敏和远程调用边界，不能与本地 `chrome.debugger` 控制逻辑耦合。
* 浏览器控制必须默认拒绝受限页面，包括 `chrome://`、`edge://`、`about:`、`chrome-extension://`、`view-source:` 和 Chrome Web Store；失败时返回固定中文提示，不透出底层敏感错误。
* 快照工具必须通过 Accessibility Tree 生成模型可读页面结构，并维护 UID 与 DOM backend node 的映射；模型不得猜测 UID，页面导航或快照版本变化后旧 UID 必须失效。
* `browser.*` 工具只有在工具调用开启、用户启用对应工具、且全局 `browserControlEnabled` 运行态为 true 时才允许暴露给模型；Side Panel 发送请求前必须过滤关闭状态下的全部 `browser.*` 工具。
* background 也必须基于当前 `BrowserControlManager` 连接运行态二次过滤全部 `browser.*` 工具，不能仅信任 runtime 传入的 `enabledToolIds`；未连接时不得把浏览器工具 schema 或浏览器控制系统提示发送给模型。
* 所有模型工具调用循环都必须使用聊天偏好 `browserAutomationMaxToolIterations` 作为最大工具决策轮次，默认 32，并支持当前聊天覆盖全局值；浏览器自动化、Tavily、MCP 等工具都不得回退到代码默认轮次，但仍必须保留最大轮次保护，防止模型反复调用工具造成死循环或资源滥用。
* 浏览器自动化工具链路在流式模式下也必须追加不带 `tools/tool_choice` 的最终模型请求，并继承用户当前流式偏好；如果模型仍需继续操作页面，必须在最终请求前的工具决策循环中通过原生工具调用协议返回 `tool_calls` / `tool_use`，避免退化为正文里的伪工具 DSL。
* AI 正文解析必须剥离模型误输出的 DSML 工具调用标记，避免 `< | | DSML | | invoke ...>` 之类内部工具片段进入用户可见消息；如果 DSML 与可见正文出现在同一行，只能剥离工具标记和参数片段，不得误删标签前的正常正文。
* `browser.take_snapshot` 不接受任何参数；background 执行前必须确认当前 debugger 会话已连接，不得为工具调用自动 attach，失败时返回固定中文 tool error。
* `browser.get_page_state` 不接受任何参数，只能通过固定 `Runtime.evaluate` 模板读取 URL、标题、`readyState`、viewport、滚动位置和焦点元素摘要；不得开放模型自定义脚本或选择器。
* `browser.get_page_state` 输出必须对 URL 敏感 query、焦点元素文本和属性摘要做脱敏与截断；未开启浏览器控制时必须返回与其他 `browser.*` 操作一致的固定中文错误。
* `browser.get_console_messages` 不接受任何参数，只能读取 background 通过 `Runtime.consoleAPICalled`、`Runtime.exceptionThrown` 和 `Log.entryAdded` 已采集的 Console、JS 异常与资源错误摘要；不得为该工具执行模型自定义脚本。
* `browser.get_console_messages` 输出必须对日志正文、堆栈 URL 和资源 URL 做敏感字段脱敏与长度截断；关闭浏览器控制、切换受控页面、导航、刷新或 tab 关闭时必须清理 Console 缓存，避免旧页面现场污染新任务。
* `browser.inspect_element` 只接受 `take_snapshot` 返回的 UID，不接受 CSS 选择器、XPath、HTML 或模型自定义脚本；执行时必须复用快照 UID 到 backend node 的映射，旧快照或不存在 UID 必须要求重新读取快照。
* `browser.inspect_element` 只能返回元素级属性、AX 摘要、布局、有限 computed style 和可交互状态；不得返回完整 DOM 子树、完整 `outerHTML`、事件监听器源码或未脱敏 URL/文本。
* `browser.find_elements` 只允许在最近一次 `take_snapshot` 已缓存的 UID 候选中查找，不得扫描完整 DOM 或生成临时 selector；返回的 UID 必须可继续用于 `inspect_element`、`click` 或 `fill`。
* `browser.find_elements` 的 CSS 策略只允许简单标签、类、ID 或单个属性选择器，并且只能对已有 UID 候选调用固定 `matches()` 检查；不得接受复杂组合选择器、XPath、脚本片段或超长查询。
* `browser.screenshot` 必须依赖当前已 attach 的 `chrome.debugger` 会话，只允许通过 `Page.captureScreenshot` 返回 PNG data URL，单张最大 5MB；非 debugger 运行态必须与其他 `browser.*` 工具一样禁用并由 background 拒绝。
* `browser.screenshot` 默认只截取当前视口；元素截图只能接受最近一次 `take_snapshot` 返回的 UID，必须先 `DOM.scrollIntoViewIfNeeded`，再基于 `DOM.getBoxModel` 的 border/padding/content 外接区域计算 clip，并启用 `captureBeyondViewport`，不接受 CSS 选择器、XPath、坐标猜测或模型自定义脚本。
* `browser.screenshot` 的工具正文不得包含 base64、完整图片原文或可下载链接；图片必须通过 `toolAttachments` 的 `browser-screenshot` 结构化附件返回，后续追问和导出只能注入截图元数据摘要。
* `browser-screenshot` 工具附件在聊天面板必须默认折叠，只展示标题和摘要；图片预览只能放在展开内容中，并限制最大高度，避免连续截图撑满消息流；点击截图预览时必须复用现有图片预览弹窗，不能新增平行预览状态。
* 快照输出必须包含页面标题、URL 和模型可读节点结构；输出过长时必须截断并追加中文说明，避免把超大 AX Tree 原样回灌模型。
* 快照格式化必须边遍历边限制 AX Tree 展开深度、节点数量和字符预算，遇到极端嵌套、重复 `childIds` 或超大页面时应输出中文截断说明，不能等完整字符串生成后才截断。
* 快照 UID 复用必须绑定当前页面身份；页面 URL 或标题变化、空快照或 detach 后不得继续复用旧页面的 backend node UID 映射。
* `DOM.enable` 和 `Accessibility.enable` 应在 debugger attach 初始化阶段启用；快照阶段只读取 `Accessibility.getFullAXTree`，且 `BrowserDebuggerConnection` 不应向外暴露任意 CDP 命令发送入口。
* 浏览器控制专用系统提示只能在本轮实际暴露 `browser.*` 工具时追加，必须要求模型先快照、不得猜 UID、工具失败时不得编造页面状态或操作结果。
* 修改 `browser.take_snapshot` 链路时必须覆盖 OpenAI tool_calls、Anthropic tool_use、未开启浏览器控制过滤、伪造 tools 拒绝、空 AX Tree、CDP 失败和 UID 稳定性测试。
* `browser.click`、`browser.fill`、`browser.press_key`、`browser.scroll`、`browser.hover`、`browser.double_click`、`browser.context_click`、`browser.drag` 和 `browser.wait_for_state` 的 `includeSnapshot` 只能在操作成功后追加最新快照；操作失败时不得自动追加快照，必须提示重新调用 `take_snapshot`。
* `browser.click` 必须优先使用 `Input.dispatchMouseEvent` 真实鼠标事件，布局读取、命中检测或节点状态异常时才允许使用受控 JS fallback；fallback 只允许触发必要鼠标事件和焦点，不得开放任意脚本能力。
* `browser.hover` 必须只接受最近一次 `take_snapshot` 返回的 UID 和可选 `includeSnapshot`，不接受 CSS 选择器、XPath、坐标猜测或模型自定义脚本；执行时应先滚动到元素并读取布局中心点，再通过 `Input.dispatchMouseEvent` 的 `mouseMoved` 触发真实悬停态。
* `browser.double_click` 必须只接受最近一次 `take_snapshot` 返回的 UID 和可选 `includeSnapshot`，不接受 CSS 选择器、XPath、坐标猜测或模型自定义脚本；执行时应通过 `Input.dispatchMouseEvent` 发送真实双击鼠标事件序列，不得回退为任意 JS 双击模拟。
* `browser.context_click` 必须只接受最近一次 `take_snapshot` 返回的 UID 和可选 `includeSnapshot`，不接受 CSS 选择器、XPath、坐标猜测或模型自定义脚本；执行时应通过 `Input.dispatchMouseEvent` 发送真实右键鼠标事件序列，只打开上下文菜单，不自动选择菜单项或编造菜单结果。
* `browser.drag` 属于阶段 C 高风险操作工具，必须只接受最近一次 `take_snapshot` 返回的 `sourceUid`，目标只能是 `targetUid` 或同时提供 `deltaX`、`deltaY` 的有限相对偏移；不得接受 CSS 选择器、XPath、绝对坐标、坐标猜测或模型自定义脚本。
* `browser.drag` 的 `deltaX`、`deltaY` 必须是 -2000 到 2000 的整数；执行时应通过 `Input.dispatchMouseEvent` 发送真实鼠标拖拽事件序列，不提供任意 JS fallback。
* `browser.fill` 必须通过 UID 定位并受控填写页面元素；文本输入使用聚焦、选择、`Input.insertText` 和 `input/change` 事件，`select` 按 value 或文本匹配，checkbox/radio/switch 只接受 `true` 或 `false`。
* `browser.press_key` 只能接受白名单按键和常见组合键，例如 `Enter`、`Escape`、方向键、`Home/End`、`PageUp/PageDown`、`Space`、单字符字母数字和 `Ctrl/Shift/Alt/Meta` 组合；未知按键必须返回中文错误。
* `browser.wait_for` 只能等待页面可见文本，默认超时 5000ms，最大超时 30000ms；超时必须返回中文 tool error，不能阻塞聊天流程或留下永久占位。
* `browser.wait_for_state` 属于阶段 C 低风险状态等待工具，第一版只允许 `url_contains`、`ready_state`、`element_visible`、`element_hidden`、`network_idle`；等待 URL 或 readyState 必须提供非空 `value`，等待元素显隐必须提供最近一次 `take_snapshot` 返回的 UID，等待 Network 空闲不需要 `value` 或 `uid`，不接受 CSS 选择器、XPath、坐标猜测或模型自定义脚本。
* `browser.wait_for_state` 的 `timeout` 必须是 1 到 30000 毫秒，默认 5000 毫秒；Network 空闲等待必须基于 Network recorder 暴露的进行中请求状态，不能用固定 sleep 假装空闲。
* `browser.analyze_interaction_blocker` 属于阶段 D 低风险现场分析工具，必须依赖已 attach 的 `chrome.debugger` 会话，只接受最近一次 `take_snapshot` 返回的 UID 和可选 `expectedAction`；不得接受 CSS 选择器、XPath、坐标、选择器猜测或模型自定义脚本。
* `browser.analyze_interaction_blocker` 只能读取元素可见性、禁用态、可编辑性、视口位置、中心点遮挡、`pointer-events`、禁用 fieldset 和表单非法字段数量等只读诊断信息；不得修改 DOM、触发表单、自动重试点击/填写或扩展为任意脚本入口。
* `browser.analyze_interaction_blocker` 输出必须结构化展示证据、阻塞原因和建议动作，并沿用页面状态脱敏与截断规则；新增诊断字段时必须补充注册表 schema、参数拒绝、非 debugger 拒绝和敏感文本不外泄测试。
* `browser.analyze_form` 属于阶段 D 中风险现场分析工具，必须依赖已 attach 的 `chrome.debugger` 会话，只接受可选的最近一次 `take_snapshot` UID 和可选 `includeFieldDetails`；不得接受 CSS 选择器、XPath、坐标、选择器猜测或模型自定义脚本。
* `browser.analyze_form` 只能读取表单结构、字段标签、字段状态、提交按钮状态和错误文案摘要；字段详情不得返回用户输入原文值，只能返回 `hasValue` 等布尔状态，不得提交表单、触发表单校验或修改 DOM。
* `browser.analyze_form` 输出中的表单 action、字段标签、按钮文本和错误文案必须脱敏与截断；新增表单诊断字段时必须补充注册表 schema、参数拒绝、非 debugger 拒绝、字段原文不外泄和敏感文本脱敏测试。
* `browser.get_performance_summary` 属于阶段 D 低风险现场分析工具，必须依赖已 attach 的 `chrome.debugger` 会话，不接受任何模型参数，不得接受 CSS 选择器、XPath、坐标、选择器猜测或模型自定义脚本。
* `browser.get_performance_summary` 只能通过固定 `Runtime.evaluate` 模板读取 Navigation Timing、Resource Timing 和 Long Task 摘要；输出只允许包含耗时、传输大小、资源类型和脱敏资源 URL，不得读取或展示 Header、Cookie、响应体、完整资源内容或敏感 query 原文。
* 修改性能摘要工具时必须补充注册表 schema、参数拒绝、非 debugger 拒绝、资源 URL 脱敏和不外泄敏感 query 的回归测试。
* `browser.collect_diagnostics` 属于阶段 D 中风险聚合诊断工具，必须依赖已 attach 的 `chrome.debugger` 会话，不接受任何模型参数，不得接受 CSS 选择器、XPath、坐标、选择器猜测或模型自定义脚本。
* `browser.collect_diagnostics` 只能聚合页面状态、Console 摘要、性能摘要和最近 Network 错误/慢请求的脱敏元数据；不得读取响应体、Header、Cookie、请求体原文、完整资源内容或通过聚合恢复敏感原文。
* `browser.collect_diagnostics` 的单项读取失败必须输出固定中文失败摘要，不得让整个聚合流程泄露底层异常；修改该工具时必须补充注册表 schema、参数拒绝、非 debugger 拒绝、聚合输出脱敏和不调用 `Network.getResponseBody` 的回归测试。
* `browser.scroll` 属于阶段 C 操作页面工具，必须依赖已 attach 的 `chrome.debugger` 会话；只接受方向、像素距离、可选 UID 和 `includeSnapshot`，不接受 CSS 选择器、XPath、坐标猜测或模型自定义脚本。
* `browser.scroll` 默认滚动当前视口；提供 UID 时只能滚动最近一次 `take_snapshot` 返回的元素，并通过固定 `Runtime.callFunctionOn` 模板调用元素 `scrollBy/scrollTo`，不得扩展为任意页面脚本执行能力。
* `browser.scroll` 的 `direction` 只允许 `up`、`down`、`left`、`right`、`top`、`bottom`，`amount` 必须是 1 到 5000 的整数；成功后可按需追加最新快照，失败时不得自动追加快照。
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

## 17. 聊天 Markdown 代码块

* 聊天气泡中的 Markdown fenced code block 必须通过 `MarkdownCodeBlock` 专用组件渲染，行内代码仍保持普通 `<code>` 样式，避免工具附件或 Network 详情的 `<pre>` 被误改。
* 代码块顶部操作栏左侧只能展示只读语言类型，不能提供编辑入口；无法从 `language-*` 判断类型时必须兜底显示 `text`。
* 代码块默认不换行并允许横向滚动，折叠态必须限制最大高度并显示纵向滚动；展开后应按内容高度展示且不再出现纵向滚动条。
* 代码块工具栏的换行/不换行、展开/收起按钮只能通过图标切换表达状态，激活态不得额外改变按钮底色或边框，避免误读为独立选中按钮。
* 代码块复制按钮只能复制源码原文，不得包含语言标签、操作栏文本、行号或额外 Markdown 围栏。
* 代码块复制按钮必须在复制成功后显示简短“已复制”内联反馈，复制失败时显示“复制失败”内联反馈；失败时不得保留或误显成功反馈，避免误导用户。
* 代码块复制反馈必须防御快速重复点击的异步乱序，只能由最后一次复制请求更新状态；组件卸载后不得继续更新复制反馈或遗留计时器。
* 聊天 Markdown 代码块样式测试应断言 `.markdown-code-block-*` 专用选择器，不得继续依赖历史 `.message-bubble pre` 选择器。

## 18. 会话级生成任务与终止

* 聊天生成状态必须按会话隔离维护，不得用单一全局 `sending` 阻塞其他会话；全局 `sending` 只能作为当前活动会话是否正在生成的派生状态。
* 切换或新建会话不得自动终止原会话生成任务；后台任务完成、失败或终止后必须按原 `sessionId` 回写对应会话，不得依赖当前活动会话。
* 同一会话同一时间只允许一个生成任务；不同会话允许并发生成。删除运行中会话前必须先终止该会话任务并清理终止句柄，避免结果写回已删除会话。
* 运行中跟进行为属于聊天偏好，默认必须为“排队”；旧设置或非法值必须归一化，不能让历史配置阻断发送。
* `Ctrl+Shift+Enter` 固定作为运行中“执行相反跟进行为”的快捷键，不得重新加入普通发送快捷键选项；非运行中按普通发送处理。
* 运行中跟进队列必须按会话隔离保存和消费；后台会话完成后自动发送排队项时必须写回原会话，不得读取当前活动会话。
* 用户主动终止运行中任务仍视为当前任务结束，队列中的下一条排队跟进会继续自动消费；除非需求明确调整，不得把终止解释为清空或暂停整个队列。
* 排队跟进自动消费时，如果模型可用性、视觉能力等发送前置校验失败，必须保留原队列项并继续展示，不能先删除后静默丢失用户输入。
* 排队跟进列表中的单条消息必须允许用户改为引导；改为引导时只切换该条跟进行为并发送到当前运行任务，不得立即启动新请求。
* 用户通过“引导”按钮或 `Ctrl+Shift+Enter` 触发引导时，UI 必须立即追加用户消息气泡；实际引导仍等当前/最新 AI 生成进入后续可消费点后生效。
* 引导跟进被当前任务消费后，必须在当前任务结束前持续注入到每一次工具决策请求和最终总结请求；持续注入的引导是已生效约束，提示词必须要求模型不要回复确认、不要复述引导、直接继续工具决策或最终回答；如果当前任务没有可消费的后续决策点，必须保留其用户消息引用并在任务结束后继续发送这条既有用户消息，避免用户补充丢失且不重新显示到排队列表。
* 引导跟进被当前任务实际消费时，必须追加一条工具过程样式的“已引导对话”提示，帮助用户理解引导已生效；该提示不受“是否展示工具调用过程”聊天偏好影响。
* “已引导对话”是运行中跟进的状态提示，不是普通工具调用记录，展示文案前不得带“已调用”。
* 排队跟进列表折叠时也必须展示最旧、下一次将执行的跟进内容，并提供删除和引导按钮，避免用户为了操作队首消息被迫展开列表。
* 排队跟进列表不得展示“排队对话（数量）”标题或右上角数字角标，折叠态只展示队首消息及必要操作。
* 排队跟进列表折叠状态应保持紧凑高度和较小 padding，避免挤占聊天输入区。
* 排队跟进列表的展开/折叠控制必须使用独立图标按钮，不使用普通文字按钮样式；折叠态展开按钮放在队首消息“引导”按钮右侧，展开态折叠按钮必须绝对定位在 `.follow-up-queue` 内部右上角，不得独占一行。
* 排队跟进列表不得提供“清空”按钮，避免误删整队；保留单条删除入口即可。
* 排队跟进列表中的删除和引导操作必须使用图标按钮，并保留清晰中文 `aria-label` 与 `title`。
* 已切换为引导的跟进项虽然可继续留在内存队列等待实际消费，但不得继续显示在“排队对话”区域，因为用户消息气泡已经承担可见反馈。
* 隐私会话保存为普通历史会话时，运行中跟进队列必须随会话 ID 迁移；丢弃隐私会话或重置 store 时必须清理对应队列。
* 用户点击“终止”必须只终止当前活动会话任务，并通过 `chat.stream` port 断开与 background `AbortController` 串联，确保底层模型请求被取消。
* 会话任务收尾、终止句柄注册和终止句柄注销都必须绑定 `taskId`；同一会话旧任务的 finally 或 port 回调不得覆盖、完成或注销新任务。
* 用户在终止句柄注册前点击终止时，必须记录待终止意图并在句柄注册后立即执行，不能只把 UI 标记为已终止而让真实请求继续运行。
* 流式端口收到最终 `complete` 后，后续终止操作应视为无效；不得在成功回答落库过程中追加“已终止”失败消息或把成功任务改成终止态。
* 后台会话失败只能写回对应会话消息；用户可见全局失败提示必须按当前活动会话归属展示，避免后台任务污染正在查看的会话。
* 隐私会话生成中不得保存为普通历史会话，除非同时迁移消息写入目标、任务状态和终止句柄；当前策略应拒绝保存并提示用户先终止或等待完成。
* 工具调用循环必须接收并传递 `AbortSignal`，在每轮模型请求前后、工具执行前后和最终回答请求前后检查终止状态；新增长耗时工具时应优先让内部等待逻辑也观察该信号。
* 会话列表中的后台生成状态优先使用无可见文案的视觉状态展示：运行中只使用低频边框闪烁，完成后只使用绿色稳定边框，失败和终止只使用对应语义色边框；不得为该状态新增 `::before`、状态点、状态条、阴影或可见文案；必须兼容 `prefers-reduced-motion` 并保留读屏可识别的 `aria-label`。
* 会话任务状态只允许依赖边框表达时，`.session-item` 基础边框必须保持足够可见且尺寸稳定，当前使用 `2px solid var(--color-hairline-soft)`；不得退回过细边框导致运行中/完成态在真实扩展里不可辨认。
* 会话运行中边框闪烁必须只通过 `border-color` 的透明度从 `1` 到 `0` 循环变化表达，不得改用阴影、伪元素、状态点或布局占位元素模拟闪烁。
* 会话任务状态类名必须在组件中以静态字符串映射生成，不能只依赖 `` `session-item-${status}` `` 这类动态模板字符串；涉及 Tailwind `@layer` 的状态样式必须通过测试确认构建产物仍保留关键选择器，避免源码存在但真实扩展 CSS 被裁剪。
* 用户切回某个会话后，应取消该会话当前任务在会话列表中的状态边框展示，但不得清除运行中任务本身；终止按钮、后台写回和完成/失败/终止收尾仍必须依赖原任务状态继续工作。
* 会话任务状态边框的隐藏记录只在该会话处于当前打开状态时生效；用户从仍在运行的会话切到其他会话时，必须恢复原会话在列表中的运行中边框状态。
* 已完成、失败或已终止的后台会话被用户重新打开后应视为已读；再次切换到其他会话时不得恢复该终态边框，除非该会话后续发起新的生成任务。

## 19. 浏览器自动化 Playbook 层

* Playbook 层是浏览器自动化工具系统与未来 Skill 生态之间的任务策略接口，只能描述任务策略、适用场景、推荐能力、风险、验证方式和失败恢复建议；不得声明、安装、启用或绕过任何工具。
* 内置 Playbook 必须维护在独立注册表中，不得写入 Prompt 模板表 `promptTemplates`，也不得复用用户提示词管理作为隐藏内置策略仓库。
* 第一版 Playbook 设置只通过 `appSettings.automationPlaybookSettings` 保存禁用 ID 列表；加载时必须与注册表合并并忽略未知 ID，不新增 Dexie 表。
* Playbook 预选属于内部路由：预选 Prompt、候选列表和模型原始响应不得进入正式聊天上下文、聊天历史、同步快照导出的消息正文或后续追问上下文；只能保留选中策略的结构化摘要。
* Playbook 预选触发条件必须保持收敛，至少应体现浏览器现场或明确 Network/API/源码/运行时分析意图，避免因“当前”“JS”等高频词对普通问答频繁发起额外模型请求。
* Playbook 预选失败不得阻断正式聊天；允许记录固定中文诊断摘要和状态码，但不得记录用户原文、候选完整 JSON、模型原始响应或敏感请求信息。
* Playbook 不得改变 `enabledToolIds`、工具注册表 allow-list、`shouldExposeTool`、运行态授权、完全访问开关、边界确认、脱敏策略或 background 执行期二次校验。
* 正式工具循环只允许注入选中 Playbook 的完整策略提示，不得把全部 Playbook 正文塞进正式请求。
* `automation-report.playbook` 只能保存 ID、标题、来源、选择理由和置信度摘要；不得保存预选模型原始响应。
* 任务策略设置页必须允许用户查看每个策略的完整详情；即使是不可编辑的内置或 Skill 策略，也必须能审阅完整策略提示、适用提示、推荐能力、风险、来源和默认启用状态。
* 未来 Skill Playbook 必须走同一 Registry、同一设置合并和同一安全边界，不得为 Skill 单独开平行工具权限或平行注入链路。
* `browser.extract_content` 是普通受限浏览器控制下的只读观察工具，只能复用页面上下文提取规则、全文提取或合法 CSS/XPath 选择器提取文本/HTML；不得执行模型自定义脚本、读取 Cookie/Storage、跨域 iframe、Header 或 Network 原文。
* `browser.extract_content` 的 selector 来源必须在 background 工具入口先做 CSS/XPath 合法性校验，非法输入应返回明确中文错误，不得只依赖 content script 吞掉异常后表现为空结果。
* `browser.extract_content` 返回给模型、工具记录、历史或导出的 URL 必须复用页面状态 URL 脱敏口径，避免 token、session、code、secret 等敏感查询参数进入模型上下文或持久化数据。
* `chat.send.extractionRules` 只作为当前工具执行上下文传给 background，供 `browser.extract_content` 的 `auto_rule` 来源复用；不得写入聊天正文、历史消息、导出内容或 Playbook 预选提示。

## 20. Side Panel 历史入口响应式布局

* 宽面板历史会话列表固定在聊天区左侧；窄面板通过“历史”按钮打开的历史抽屉也必须从左侧弹出，避免同一功能在不同宽度下左右方向不一致。
* `.drawer-panel` 仍作为默认右侧抽屉基础样式供当前聊天设置等入口复用；历史抽屉只能通过 `.history-drawer` 覆盖 `left/right` 与边框方向，不得直接修改通用抽屉导致其他抽屉入口换边。
* 历史抽屉打开和关闭必须基于 Radix Dialog 的 `data-state` 提供渐入渐出效果；关闭动画也要覆盖，不能只做打开态动画。
* 历史抽屉动画必须兼容 `prefers-reduced-motion: reduce`，低动效模式下禁用位移动画并避免强制动效。
* 修改历史入口、聊天顶部按钮或抽屉样式时，必须补充或更新 `App.test.tsx` 中的样式约束测试，覆盖历史抽屉左侧弹出且当前聊天设置抽屉仍保持右侧默认样式。
* 会话和文件夹的二级操作菜单打开后，点击菜单、触发按钮之外的空白区域必须自动关闭，并清理对应的二次删除确认态。
* 文件夹三点按钮只作为二级菜单入口，菜单内提供“重命名”和“删除”；删除必须二次确认，且 Store 层必须拒绝删除包含未归档会话的非空文件夹，不能只依赖 UI 判断。
* 全局操作结果、请求失败、同步成功/失败、导出成功/失败、渠道远端模型列表结果等用户通知，必须统一走右上角 `NotificationHost`，默认 5 秒自动关闭并支持手动关闭；通知必须从右侧渐入、向右侧渐出，并兼容 `prefers-reduced-motion: reduce`；不得在聊天控件上方新增 `.chat-failure` 这类内联错误提示。
* 表单字段校验、上下文弹窗中单个标签页失败、列表项局部状态等与具体输入或条目强绑定的信息可以保留在原位置，但不能替代全局操作结果通知。

## 21. MCP 远程工具

* MCP 远程工具属于独立 `mcp_remote` 工具来源，不得与浏览器自动化、Network、Runtime、受控增强或完全访问模式耦合；启用 MCP 工具不要求开启浏览器控制。
* MCP MVP 只支持 HTTP/Streamable HTTP 的 `tools/list` 与 `tools/call`，不支持 stdio、Native Messaging、resources、prompts、OAuth 或自定义 header。
* MCP HTTP 初始化必须遵循生命周期：`initialize` 成功后使用同一 `Mcp-Session-Id` 发送 `notifications/initialized`，再执行 `tools/list` 或 `tools/call`；兼容 2025-03-26 协议时，`tools/list` 需带分页参数 `params.cursor`，避免严格服务端返回 `Invalid request parameters`。
* MCP Server 配置和工具发现缓存存储在 `appSettings`；Bearer Token 必须作为本地敏感配置单独存储，导出同步快照时过滤，恢复快照时保留本地 token。
* MCP 工具只能来自已启用 Server 最近成功发现的 `tools/list` allow-list；background 执行前必须二次校验 server、工具名、启用状态和发现缓存，不能信任 UI 或模型传入的任意工具 schema。
* MCP Server 列表启用/禁用开关必须同步影响工具注册表和全局聊天偏好 `enabledToolIds`；禁用 Server 时必须移除该 Server 的 MCP 工具 ID，重新启用时只恢复当前缓存中 schema 合法的工具。
* MCP 工具调用过程在聊天展示层必须复用系统内置工具调用行样式，并受现有聊天偏好展示控制；不得新增 MCP 参数摘要业务，完整参数仍通过现有调用详情弹窗查看。
* MCP 设置页的已发现工具列表必须默认收起，通过“工具列表”按钮在 Server 卡片下方展开，避免工具名和编辑、刷新、删除等操作按钮挤在同一行。
* MCP 设置页展开后的工具项必须使用两行布局：标题一行、描述一行，二者都要单行截断并通过悬浮 `title` 展示完整内容，不得因长描述撑出横向滚动条。
* 新增 MCP Server 保存成功后必须自动刷新一次工具列表，并把本次新发现且 schema 合法的 MCP 工具默认加入全局聊天偏好启用列表；手动“工具列表/刷新工具”按钮仍需保留。
* MCP 工具结果 MVP 只作为 `tool` message 回灌模型，不生成 `toolAttachments`；后续若新增可见附件，必须同步覆盖历史归一化、导出、展示、同步和后续上下文测试。
* MCP 工具第一版采用“启用即允许”策略；高风险数据库写入、删除、任意 SQL 等执行前确认属于后续独立风险策略，不得复用浏览器自动化的完全访问开关代替 MCP 权限控制。

* MCP 工具 ID 归一化允许 `mcp.` 前缀下的工具名包含大写字母和编码片段；不要再用仅面向内置工具的全局 ID 规则过滤 MCP 发现结果。
* MCP 工具 ID 生成必须保证 `serverId` 和工具名可无歧义反解；`serverId` 中的点号必须额外编码，避免 `mcp.<server>.<tool>` 被错误拆分。
* MCP 模型侧 `function.name` 必须在当前暴露工具集合内无冲突；不同 MCP Server 或工具名清洗后相同的时候，必须追加稳定后缀，避免工具循环按名称反查时误执行另一个远程工具。
* MCP HTTP 客户端必须在公共入口设置默认超时，并兼容外部 `AbortSignal`；远端无响应时必须返回固定中文错误，不能让聊天工具链永久挂起。
* MCP background 刷新工具列表只能接收 `serverId`，必须从本地已保存配置读取 endpoint 和 Bearer Token；不得信任 UI 或 runtime message 传入的完整 Server 对象，避免 token 被绑定到伪造 endpoint。
* MCP Server 删除会同时清理配置和本地 Bearer Token，设置页必须二次确认，并覆盖取消删除与确认删除的回归测试。

## 22. Side Panel 设置表单布局

* 聊天偏好、渠道参数、MCP 与同步等设置表单复用 `.chat-preference-grid` 时，列宽必须能容纳常见中文长标签；调整字段文案或新增长标签后，应检查标签不会在桌面宽面板下被压成非预期换行。
* 调整设置表单网格时必须同时兼顾窄面板：列宽下限应通过响应式写法回落到单列，不得造成横向滚动或输入框溢出。

## 23. 会话 Token 用量监控

* 会话 Token 用量只能统计供应商响应中明确返回的真实 `usage` 字段，不得用本地估算值补齐；失败、取消、异常中断或无会话归属的设置页请求不得累计到会话。
* 输入区 Token 圆形进度条只作为轻量状态指示：圆环本体不得使用背景色、边框或鼠标悬浮高亮；键盘聚焦所需的 `focus-visible` 轮廓不在此限；圆环应作为发送按钮左侧的轻量状态位，不应挤占 `context-strip`；详细输入、输出、写入、读取等明细应放入项目风格一致的悬浮信息层，避免挤占输入区布局。
* 会话级统计统一写入 `ChatSession.tokenUsageEntries`，并按成功 AI Response 追加；普通聊天、工具决策、工具最终回答和标题生成必须用 `ChatTokenUsageSource` 区分来源，避免后续排查时混淆统计口径。
* `ChatTokenUsageEntry.usageSchemaVersion` 用于隔离不同统计口径；修改输入、输出、缓存写入或缓存读取的归一化规则时必须评估是否提升版本，旧版本或无版本条目不得继续参与会话汇总。
* 会话 Token 用量条目的去重合并必须复用共享的 `mergeTokenUsageEntries`，不得在 Store、标题生成或流式处理模块重复实现，避免 schema 过滤和去重规则漂移。
* 流式聊天中，background 每完成一次可归属当前会话的模型响应后应通过 `chat.stream` 端口发送 `token_usage` 事件，Side Panel 只能把它作为当前请求的即时预览更新内存态；只有最终 `complete` 成功后才能持久化到会话，失败、取消或断开时必须丢弃本次预览用量。
* 流式最终 `complete` 事件可能再次携带同一批用量，Side Panel 持久化时必须按 entry id 去重，避免实时预览和最终收尾重复累计。
* OpenAI-compatible usage 中 `prompt_tokens_details.cached_tokens` 计为缓存读取，输入 Token 应按 `prompt_tokens - cached_tokens` 统计；DeepSeek 的 `prompt_cache_hit_tokens` 计为缓存读取，`prompt_cache_miss_tokens` 计为输入；Anthropic 的 `cache_creation_input_tokens` 和 `cache_read_input_tokens` 分别计为缓存写入和缓存读取。
* 流式 OpenAI-compatible 请求需要携带 `stream_options.include_usage = true`，并且只有收到明确完成信号后才能把 usage 追加到会话；流式中断时即使已收到正文增量也不得累计 Token 用量。
* 修改 Token 用量字段、解析逻辑、会话归一化、标题生成或聊天请求链路时，必须覆盖共享归一化、非流式解析、流式解析、Store 落库和输入区展示测试。

## 24. 聊天上下文预算与工具可用性

* 聊天偏好和当前聊天设置中的 `maxTokens` 语义是“最大聊天上下文”，只用于请求上下文预算、页面上下文裁剪和自动压缩阈值判断，不得主动作为模型输出 `max_tokens` 参数；模型输出上限只能来自 `ProviderModel.maxTokens`。
* `maxTokens` 在类型层必须明确区分“模型输出上限”和“最大聊天上下文预算”两种语义；新增或修改相关字段时必须同步检查默认值、归一化、UI 文案和请求构造，避免同名字段被误用。
* 聊天上下文自动压缩阈值使用 `contextCompressionThresholdPercent` 百分比字段，默认 `90`；全局聊天偏好和当前聊天设置都必须提供入口，当前会话覆盖优先生效，归一化范围为 `1-100`。
* 自动压缩判断不得使用“当前会话累计 Token 用量”；必须从会话首条消息或最新 `assistantMessageKind: "context_summary"` 摘要消息开始，累加本次请求实际会带入的系统提示、页面上下文、历史消息、当前用户输入、Prompt 快照、思考内容、工具附件和图片附件估算。
* 发送前自动压缩判断必须以实际即将提交给模型的 request messages 为准；历史工具附件、Network 原文、Prompt 展开、页面上下文裁剪后的 system 消息等都会改变真实请求体，不能只用未展开的会话消息估算，否则会出现请求完成后才发现上下文超限。
* `context_summary` 是后续请求上下文的最新边界；多次压缩时只能从最新摘要及其之后的消息构造正式聊天请求，摘要之前的历史仍保留用于展示、导出、同步和排查，但不再进入模型上下文。
* 压缩摘要请求属于独立模型请求，必须使用 `ChatTokenUsageSource` 区分来源，并在压缩失败时返回明确中文错误且不得丢弃原始历史消息。
* 上下文压缩请求必须走可取消的 `chat.stream` 端口并绑定当前 `chatTaskId`；用户终止时需要断开端口并串联 background 的 `AbortController`，不得让压缩阶段继续占用模型请求资源。
* 工具调用循环中每一次 AI 请求前都必须检查当前临时上下文阈值；触发压缩时只能发起不带 `tools/tool_choice/enabledToolIds` 的独立压缩请求，成功摘要必须作为最新 `context_summary` 边界持久化，压缩请求失败（含重试耗尽）后必须停止当前工具循环并返回中文错误。
* 工具调用循环首次请求前的上下文阈值判断必须沿用 Side Panel 传入的当前请求上下文估算作为基线；后续只叠加工具循环新增的 assistant 决策、工具结果、用户引导和最终回答指令，避免同一段历史在前后台使用不同本地估算口径导致过早压缩。
* 工具调用循环最终回答前必须先按真实最终 request messages 估算上下文；压缩成功后必须立即再次发送压缩后的 `context:estimate`，让底部 Token 条显示即将发送给模型的真实上下文，而不是压缩前的大数。
* Network、JS、Source Map、FullAccess 等长工具结果的完整详情应保留在会话级附件仓库；历史请求上下文和压缩请求默认只注入摘要化内容。当它们导致压缩请求本身超预算时，只允许继续摘要化注入模型的 `tool.content`，不得删除附件仓库里的完整排查详情。
* 工具调用循环每次请求模型前都必须显式锚定最新用户请求：当前任务以最后一条真实 user 消息为准，运行中用户引导只作为持续覆盖层修正执行方向，不得替代主任务；除非用户明确要求继续旧任务，否则不得沿着更早的历史任务继续调用工具或输出结论；该锚点只作为临时请求上下文，不作为普通聊天消息落库。
* 工具调用循环内压缩完成后，原始用户任务只能按剩余上下文预算保留摘录；如果压缩摘要、保留的 system 消息和继续指令仍超过阈值，必须停止当前工具循环并返回明确中文错误，不得继续把超阈值请求发给模型。
* 工具调用循环内压缩完成后，必须优先保留最新用户任务或最新用户指令，再考虑较早用户消息；不得只保留第一条 user 历史，否则长会话会被旧主题带偏并出现答非所问。
* 工具调用循环内压缩完成后，如果临时上下文只有压缩摘要和“继续当前任务”指令，不能立刻重复压缩；只有摘要之后出现新的工具结果、助手决策、用户引导等材料时才允许再次触发压缩，避免单轮请求陷入压缩循环；压缩中被取消时也必须把 `chat.context_compression` 工具过程收尾为中文错误状态。
* 工具循环即时上下文估算必须贴近真实模型 payload：`tool` 角色消息只按实际发送的 `content` 估算；历史 assistant 消息如果已由请求构造阶段把工具附件展开进 `content`，估算时也不得再从 `toolAttachments` 或 `toolCallRecords` 重复收集同一批附件，避免 Tavily、Network、源码片段等长附件导致过早压缩。
* 上下文压缩工具调用参数中应记录触发时的估算上下文、最大上下文和阈值；消息列表展示“上下文压缩”过程时也应显示这些诊断值，并统一标注为“实际请求上下文”或“运行中上下文”，便于排查异常压缩。
* 当前上下文 Token 数展示与自动压缩触发必须复用同一估算口径：未发送时按即将提交给模型的 request messages 估算，发送中优先使用 background 通过 `context:estimate` 推送的运行中上下文估算；不得使用仅按落库会话消息估算的偏小值，也不得回退为会话累计 Token 用量。
* 上下文压缩过程必须作为 `chat.context_compression` 工具调用过程展示：压缩中显示“正在进行上下文压缩”，完成后显示“上下文压缩”，压缩摘要放在工具调用详情弹窗结果中；`context_summary` 消息只作为上下文边界和持久化摘要，不应额外渲染成普通 AI 气泡。
* 上下文压缩工具过程属于系统过程，必须始终显示，不受普通“工具调用过程”展示开关控制；展示层识别时需兼容 `toolId=chat.context_compression`、历史 `toolId/name=context_compression` 和 `displayName=上下文压缩`，且按钮文案不得使用普通工具的“已调用”前缀。
* 排队跟进自动消费遇到上下文压缩失败时应视为正式请求前置失败：队列项必须恢复；如果已追加跟进用户消息，必须保存并复用 `userMessageId`，避免下一次重试重复追加同一条用户消息。
* `tavily_search` 的可用性必须基于已归一化的 Tavily API Key 判断；未配置有效 Key 时，设置页、聊天工具菜单、发送请求构造和 background 入口都必须过滤或禁用该工具，不能只依赖前端隐藏。
* Network/JS 详情池默认上限为 `500`，由 `toolDetailPoolKeepLimit` 统一控制；该值只约束会话级附件仓库中的详情保留数量，不得作为模型输出上限或上下文预算的替代语义。
* Network/JS 附件持久化时必须先做噪音过滤与摘要收紧：明显无关的静态资源、广告、埋点、失败噪音直接丢弃；需要保留的内容也只在后续上下文中展开 ID、URL、method/status、字段名与必要片段，不得长期把完整 header/body/source 原文写进模型上下文。
* 工具附件摘要与详情池裁剪必须在共享层完成，Side Panel 和 background 只传递 `toolDetailPoolKeepLimit` 与附件引用，不得在多个位置各自实现不同的裁剪口径，避免同一附件在工具过程和最终回答中重复展开。
* 普通最终回答消息上的 `toolAttachmentIds` 默认只用于 UI 展示、导出和排障，不得参与后续模型上下文展开；只有 `assistantMessageKind: "tool_call_turn"` 的工具过程消息才允许把附件摘要注入下一次请求，避免最终回答把压缩边界之前的大附件重新带回上下文。

## 25. 历史会话批量操作

* 历史会话批量选择属于单个列表实例的临时 UI 状态，不得写入 Zustand 持久状态；桌面历史侧栏与窄面板历史弹窗必须各自维护选择，关闭、退出或切换未归档/已归档分区时应清空。
* 历史会话的“批量操作”入口必须放在 `.session-list-header-actions` 最左侧并使用文字按钮，不得占用标题行或改回仅图标入口；进入批量模式后该按钮保持原位置，通过 `aria-pressed` 和主题主色表达激活状态，“新建文件夹”和“新建”必须保留在操作区并禁用置灰，不得从 DOM 条件移除。
* 历史会话批量控制区必须使用紧凑稳定的单行网格，将选择数量合并进“归档 N/删除 N”按钮；独立选择状态只作为视觉隐藏的 `aria-live` 信息保留，已归档分区只显示删除操作，窄面板不得出现文字截断、重叠或异常换行。
* 未归档分区可以批量归档或删除，已归档分区只能批量删除；“全选/取消全选”只能作用于当前文件夹（已归档区视为独立文件夹），不得从文件夹标题操作跨文件夹选择，Store 仍需按分区重新校验并去重会话 ID，不能信任组件传参。
* 批量归档和批量删除必须在 Dexie 单事务中完成；归档应在事务内读取最新会话后只更新归档标记与更新时间，避免覆盖并发聊天响应或用户设置，删除不得通过循环单条仓库操作形成部分成功状态。
* 批量删除前必须同步中止目标会话的运行任务；任务中止发生在 Dexie 事务外，代码必须用中文注释明确这一边界。成功后一次性清理任务状态、重试进度、上下文估算、跟进队列和忽略标记，并只执行一次活动会话重选。持久化失败时保留会话并显示固定中文错误，但不得尝试恢复已经中止的远端请求。
* 修改历史会话批量操作时必须覆盖仓库事务、Store 分区与状态清理、桌面及窄面板组件交互测试；至少验证折叠内容全选、分区切换清空、确认取消、确认执行、失败保留和禁用单条菜单/拖拽。
