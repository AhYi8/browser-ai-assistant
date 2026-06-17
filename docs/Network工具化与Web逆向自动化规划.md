# Network 工具化与 Web 逆向自动化规划

## 1. 摘要

Network 分析已从“发送前自动注入上下文”的旧流程，重构为浏览器自动化工具组中的 `network.*` Function。

模型现在可以在工具循环中主动决定何时清空请求、等待新增请求、筛选请求、读取详情、对比请求、定位 JS 资源和分析参数。第一阶段已经落地基于 `chrome.debugger` 的后台 Network 采集，以及 `network.compare_requests`、`network.find_parameter_candidates`、`network.extract_js_candidates` 三个逆向辅助工具。

完整 Web 逆向能力继续按阶段推进。Source map 已作为独立 `sourcemap.*` 工具组落地；下一阶段建议先推进受控只读 `Runtime.evaluate` 的设计与实现，用于补足静态 JS / Source Map 无法确认运行时模块、公开配置和函数导出形态的场景。请求重放沙箱、敏感字段解锁等更高风险能力仍默认关闭，必须经过单独权限设计、用户确认、脱敏、审计和测试后才能启用。

## 2. 当前状态

### 2.1 已完成：阶段一 Network 工具化闭环

- 移除旧 DevTools Network 页面、`devtools_page` 入口和 `network.devtools` port 链路。
- 移除 Side Panel 发送前自动 Network 分析流程，不再自动执行“相关性筛选 Prompt -> 取详情 -> 拼入用户消息”。
- 移除旧 Network UI 开关、相关性筛选 Prompt、批次大小、默认采集类型等偏好字段。
- 用户开启浏览器控制后，background 通过已有 `chrome.debugger` 连接启用 CDP `Network.enable` 并后台采集请求。
- 关闭浏览器控制、切换受控 tab、tab 关闭或 debugger detach 时清理对应 Network 状态。
- `network.*` 工具归入浏览器自动化工具组，只在工具调用总开关开启、浏览器控制开启、当前 tab 已 attach 且 Network recorder 已启用时暴露。
- 旧字段 `networkContextAttachment` 仅作为历史兼容读取入口，不再生成新数据；新 Network 详情统一写入 `toolAttachments`，附件 kind 固定为 `network`。
- 工具结果、展示、导出和后续上下文使用前均按统一口径脱敏。

### 2.2 已完成工具

| 工具 | 用途 |
| --- | --- |
| `network.list_requests` | 列出当前受控页面后台采集的 Network 请求元数据，支持 method、status、resourceType、URL 关键词和数量上限过滤。 |
| `network.get_request_details` | 按 `requestIds` 读取脱敏后的请求头、请求体、响应头和响应体。 |
| `network.clear_requests` | 清空当前受控页面的 Network 请求缓存，用于建立干净观察窗口。 |
| `network.wait_for_requests` | 等待匹配请求出现，适合点击、提交、分页等页面操作后观察新增接口。 |
| `network.compare_requests` | 对比多条请求的 query、header、body、path 差异，输出稳定字段、变化字段和疑似签名字段。 |
| `network.find_parameter_candidates` | 从请求详情中识别疑似签名、时间戳、nonce、token、加密载荷和长编码字符串。 |
| `network.extract_js_candidates` | 从已采集 JS 响应中按接口路径、参数名或加密关键词提取候选资源与片段。 |
| `js.list_resources` | 列出已采集和已同源补位的 JS 资源，供源码检索和 Source Map 解析使用。 |
| `js.search_sources` | 按接口路径、参数名或关键词搜索 JS 源码，必要时按严格同源规则补位读取 JS 静态文本资源。 |
| `js.extract_context` | 按 JS 资源 ID 和字符位置提取更大的源码上下文。 |
| `sourcemap.list_candidates` | 列出 JS 资源关联的 Source Map 候选，支持响应头、`sourceMappingURL` 和 inline data URL。 |
| `sourcemap.resolve_location` | 将 JS bundle 的一基行列位置映射到原始源码位置。 |
| `sourcemap.extract_original_context` | 从 Source Map `sourcesContent` 中提取有限原始源码片段。 |

## 3. 工具接入原则

### 3.1 暴露条件

`network.*` 工具必须同时满足以下条件才允许下发给模型：

- 工具调用总开关开启。
- 浏览器控制开启。
- 当前 tab 已通过 `chrome.debugger` attach。
- Network recorder 已启用。

不得要求用户手动打开 DevTools，不得新增“打开 DevTools”的工具入口，也不得恢复基于 `chrome.devtools.network` 的旧采集链路。

### 3.2 命名与注册

- 用户可见文档口径保留 `network.list_requests` 等点号名称。
- 发给 OpenAI-compatible 模型的 `function.name` 必须使用 `network_list_requests` 这类安全名称。
- 执行器可兼容旧点号工具名，用于历史工具调用回放。
- 所有工具必须通过统一工具注册表和统一 Network 工具执行器分发。

### 3.3 附件与上下文

- Network 工具详情只能写入通用 `toolAttachments`。
- 附件 kind 固定为 `network`。
- 历史 `networkContextAttachment` 只读兼容，不得继续生成。
- 同一工具多次调用产生的同类附件，在展示、导出和后续追问前应聚合展示，但不得改写底层消息数据。

## 4. 安全边界

### 4.1 默认脱敏

默认只返回脱敏数据。以下字段或相似字段不得明文暴露：

- `Authorization`
- `Cookie`
- `Set-Cookie`
- `token`
- `api_key`
- `password`
- `secret`
- `session`
- `csrf`

脱敏应覆盖 URL query、请求头、响应头、JSON body、form body 和历史导入数据。

### 4.2 响应体读取

- `Network.getResponseBody` 只允许读取已采集请求。
- 读取前必须跳过明显二进制资源，例如图片、音视频、字体、压缩包、PDF 和 `application/octet-stream`。
- 响应体必须截断并标记 `truncated`。
- JS 候选提取只读取 Network 已采集 JS 响应内容，不执行页面脚本。

### 4.3 参数校验

工具参数必须做类型、长度、数量、枚举、超时和上限校验。

非法输入应 fail closed，返回固定中文错误，不得把非法 `requestIds` 转发给 CDP，也不得透出敏感远端错误报文。

### 4.4 高风险能力默认关闭

以下能力默认关闭，未完成单独设计前不得实现或暗中启用：

- 受控只读 `Runtime.evaluate`。
- 请求重放沙箱。
- 敏感字段解锁。
- 带 Cookie、Authorization 或其他凭据的自动请求重放。

## 5. 完整 Web 逆向能力阶段规划

### 5.1 阶段一：Network 工具化闭环

状态：已完成。

目标是支持模型执行以下闭环：

1. 清空请求缓存。
2. 操作页面或等待用户操作。
3. 等待新增请求。
4. 列表筛选接口。
5. 读取请求详情。
6. 对比请求差异。
7. 提取参数候选。
8. 搜索 JS 候选片段。
9. 输出接口分析结论。

适用场景：

- 登录后接口定位。
- 搜索、筛选、分页接口分析。
- 表单提交接口分析。
- 常见签名、时间戳、nonce、加密载荷字段初筛。

### 5.2 阶段二：JS 资源检索、同源补位与源码片段提取

目标：

- 建立 JS 资源索引。
- 在严格同源限制下补位读取未采集到的 JS 静态文本资源。
- 支持按接口路径、参数名、工具关键词反查 JS bundle。
- 返回候选文件、命中位置、有限上下文片段。
- 避免把大 bundle 整体塞给模型。

候选能力：

- `js.list_resources`：列出已采集和已同源补位的 JS 资源。
- `js.search_sources`：按关键词、接口路径、参数名搜索源码片段，必要时可触发本次同源补位。
- `js.extract_context`：按资源 ID 和位置提取更大上下文。

安全限制：

- `js.*` 属于浏览器自动化工具组，只在工具调用总开关开启、浏览器控制开启、当前 tab 已 attach 且 Network recorder 已启用时暴露。
- JS 检索结果写入通用 `toolAttachments`，附件 kind 固定为 `js-source`，展示、导出和后续上下文使用前必须保留脱敏和截断标记。
- 同源补位只允许 `http` 或 `https`，且协议、hostname、port 必须与当前受控页面一致；跨域重定向、非 JS MIME、超时和超大小响应必须拒绝。
- 同源补位不附加 Cookie、Authorization 或浏览器存储凭据，不用于请求 API、重放业务请求或批量探测。
- 默认限制单片段大小、总返回大小和候选数量。
- 不执行 JS，不读取 Cookie、Storage 或凭据。
- `network.extract_js_candidates` 仅作为历史兼容和轻量入口，新增 JS 搜索逻辑应集中在独立 JS 源码索引和工具执行器模块中，避免与 Network 请求分析耦合。

### 5.3 阶段三：Source map 处理

状态：已完成。

目标：

- 识别响应头 `SourceMap`、兼容头 `X-SourceMap`、源码尾部 `sourceMappingURL` 和 inline data URL。
- 读取同源或 Network 已采集的 source map。
- 将压缩 bundle 位置映射到原始源码文件、函数附近片段和调用上下文。

候选能力：

- `sourcemap.list_candidates`：列出可用 source map。
- `sourcemap.resolve_location`：将 bundle 位置映射到原始源码位置。
- `sourcemap.extract_original_context`：提取原始源码片段。

安全限制：

- `sourcemap.*` 属于浏览器自动化工具组，只在工具调用总开关开启、浏览器控制开启、当前 tab 已 attach 且 Network recorder 已启用时暴露。
- 外部 source map 只允许 `http` 或 `https`，且协议、hostname、port 必须与当前受控页面一致；跨域、跨协议、跨端口和跨域重定向必须拒绝。
- Source Map fetch 必须使用 `credentials: "omit"` 和 `redirect: "manual"`，不得携带 Cookie、Authorization 或浏览器存储凭据。
- inline data URL 只接受 JSON、source-map 或可信文本 JSON，并在解码前后限制大小。
- 只从 `sourcesContent` 提取有限片段；不得保存完整 source map 或完整 `sourcesContent` 到工具附件、历史、同步快照、导出或后续追问上下文。
- 返回片段必须脱敏、截断并标记 `redacted` / `truncated`，避免泄露敏感凭据。

### 5.4 阶段四：受控只读 Runtime.evaluate

状态：当前范围已实施；仅包含受控只读运行时摘要和未来授权上下文占位，不包含完全访问、任意脚本执行、请求重放或敏感字段解锁。

目标：

在用户显式开启高风险开关后，允许模型读取有限、可审查、可截断、可脱敏的页面运行时信息，用于辅助定位前端加密逻辑。该阶段只解决“静态源码已定位但仍需要确认运行时对象形态”的问题，不提供通用脚本执行能力。

阶段判断：

- 前三阶段已经能定位接口、参数候选、JS bundle 和 Source Map 原始片段，但仍可能无法确认 webpack 模块缓存、运行时公开配置、函数导出键和函数摘要。
- 项目中已有内部 `Runtime.evaluate` 用于受控等待和页面操作辅助；下一阶段不能直接把内部 evaluate 暴露给模型，必须在其上新增只读工具执行器、表达式审查、返回值清洗和独立授权。
- 阶段四应作为“诊断读取”能力，而不是“页面自动化操作”或“请求构造”能力；任何写 DOM、触发事件、读取敏感存储、发起网络请求的需求都应继续拒绝。

建议工具：

| 工具 | 用途 |
| --- | --- |
| `runtime.inspect_globals` | 按白名单路径读取公开全局对象摘要，例如 `window.__APP_CONFIG__`、`window.__INITIAL_STATE__` 的键名、基础类型和值摘要。 |
| `runtime.search_modules` | 在受控模块缓存中按关键词搜索模块名、导出键和函数摘要，默认只返回摘要，不返回完整函数体。 |
| `runtime.describe_function` | 对指定公开路径或模块导出的函数返回 `name`、参数个数、截断后的 `Function.prototype.toString` 摘要和疑似关键词命中。 |

命名规则：

- 用户可见文档保留 `runtime.*` 点号名称。
- 发给 OpenAI-compatible 模型的 `function.name` 必须使用 `runtime_inspect_globals`、`runtime_search_modules`、`runtime_describe_function` 这类安全名称。
- `runtime.*` 属于浏览器自动化工具组，但必须额外满足阶段四高风险只读授权，不能只依赖浏览器控制总开关。

允许用途：

- 读取公开全局配置。
- 查看已加载函数的字符串形式。
- 查询 webpack module 缓存中的模块名、导出键或函数摘要。
- 验证静态分析得到的候选函数是否在运行时存在。
- 辅助判断接口参数是否由公开配置、模块导出或纯前端函数生成。

禁止用途：

- DOM 写入。
- 表单填写。
- 点击、导航、刷新。
- 发起网络请求。
- 读取 Cookie、LocalStorage、SessionStorage、IndexedDB 等敏感存储。
- 任意长时间或无限循环表达式。
- 枚举完整 `window`、完整 DOM、完整模块源码或完整 source map。
- 调用页面业务函数，尤其是可能产生副作用、埋点、请求、存储写入或状态修改的函数。
- 绕过验证码、风控、登录、权限校验或站点访问控制。

安全限制：

- 默认关闭。
- 单独高风险只读开关，不持久化到聊天偏好、会话历史、同步快照或导出内容。
- 开启前必须展示固定中文风险提示，说明该能力会读取当前页面运行时公开对象摘要，且不会读取 Cookie、Storage 或执行写操作。
- 只允许工具执行器拼装固定模板表达式；模型不得直接传入任意 JavaScript 表达式。
- 所有可变输入只能是路径、关键词、模块索引、数量上限和摘要半径等结构化参数，并做类型、长度、数量、枚举和上限校验。
- 表达式必须使用固定超时和 `returnByValue: true`，禁止返回远程对象句柄供后续任意调用。
- 返回值必须经过结构化归一化、敏感字段脱敏、深度限制、数组/对象条目限制、字符串截断和总字节预算限制。
- 函数字符串只返回截断摘要和关键词附近片段，不返回完整大型函数体。
- 工具结果默认只作为 tool message 回灌模型；如后续需要用户可见附件，必须新增 `toolAttachments` kind 并完成展示、导出、后续追问上下文和历史归一化设计。
- 工具正文、附件、导出和后续追问上下文不得保存完整运行时对象、完整模块缓存或完整函数源码。
- 失败时返回固定中文错误，不透出页面异常堆栈、第三方脚本源码、远端敏感报文或 Chrome 原始调试错误。
- 失败时不回退为更高权限执行。

权限与 UI：

- 继续复用顶部浏览器控制作为基础运行态；阶段四额外增加“运行时只读分析”高风险临时开关。
- 高风险开关默认关闭，刷新、重载、关闭浏览器控制、切换受控 tab 或 debugger detach 后必须回到关闭状态。
- 设置页可以展示工具启用状态和说明，但不应新增与顶部浏览器控制平行的常驻授权入口。
- 工具注册表中 `runtime.*` 可出现在浏览器自动化分组；Side Panel 和 background 必须双重过滤未授权状态，未授权时不得把 schema 下发给模型。
- `full_access_reserved` 仅作为后续阶段授权上下文占位；当前阶段遇到该占位必须返回固定中文拒绝，不得关闭脱敏、只读限制或敏感信息过滤。

建议执行边界：

- 新增独立 `RuntimeReadToolExecutor` 或同等模块，避免继续堆入 `browserControlMessageHandler.ts`。
- `BrowserDebuggerConnection` 可以保留底层 `evaluate` 封装，但只读运行时工具必须通过执行器提供的固定模板调用，不允许外部传任意 CDP 方法或任意表达式。
- webpack / Vite / Rollup 模块缓存探测应使用有限候选模板，例如只检查常见全局 chunk 数组、模块导出键和函数摘要；不得递归遍历完整对象图。
- 全局路径读取只接受安全路径段，例如标识符、数字索引和有限白名单符号；禁止 `constructor`、`prototype`、`__proto__`、`eval`、`Function` 等危险路径段。
- 关键词搜索必须限制关键词数量、长度和返回命中数量；命中结果只返回模块摘要、导出键、类型和截断片段。
- 每次工具调用都应记录工具调用记录、授权状态摘要、截断/脱敏标记和中文失败摘要；不得记录用户临时授权的敏感原文。

建议实施顺序：

1. 新增阶段四高风险只读运行态：类型、store 状态、runtime 事件和关闭/切换/重载清理。
2. 新增 `runtime.*` 工具注册、模型安全函数名和浏览器自动化分组展示，但默认受额外授权过滤。
3. 新增只读执行器和固定表达式模板，先实现 `runtime.inspect_globals` 与 `runtime.describe_function`，验证安全框架。
4. 再实现 `runtime.search_modules`，仅覆盖常见 webpack / Vite 模块缓存摘要，不追求所有打包器通吃。
5. 补充工具结果脱敏、截断、错误归一化、工具循环和流式收尾测试。
6. 根据真实验证结果再决定是否需要用户可见附件；未完成附件设计前只返回 tool message。

验收标准：

- 未开启浏览器控制或未开启运行时只读授权时，模型看不到 `runtime.*` 工具 schema，background 也拒绝伪造工具调用。
- 模型无法传入任意 JavaScript，只能传结构化参数。
- 读取公开对象、函数摘要和模块摘要能返回有限结果，并标记 `redacted` / `truncated`。
- 试图读取 Cookie、Storage、DOM 写入、网络请求、危险路径段或超预算内容时均返回固定中文错误或脱敏摘要。
- 关闭浏览器控制、切换受控 tab、导航、刷新、debugger detach 后，运行时只读授权和缓存状态被清理。

### 5.5 阶段五：请求重放沙箱

目标：

在隔离环境中构造请求重放，用于验证接口参数、分页参数、排序参数和非敏感请求体结构。

默认行为：

- 默认不带 Cookie。
- 默认不带 Authorization。
- 默认不带浏览器存储凭据。
- 默认只带用户确认后的非敏感 header。
- 请求目标、method、header 摘要、body 摘要必须展示给用户。

用户确认：

- 带敏感凭据必须逐次确认。
- 每次确认只对本次请求有效。
- 确认内容不得写入长期历史、同步快照或导出。

安全限制：

- 限制目标 URL 协议为 `http` 或 `https`。
- 限制请求大小、超时、重试次数。
- 禁止自动批量撞库、爆破、绕过验证码或规避风控。

### 5.6 阶段六：敏感字段解锁

目标：

允许用户在明确知情的情况下，临时解锁某些敏感字段，用于本轮分析或一次请求重放。

解锁范围示例：

- 本轮显示某个 Cookie 值。
- 本轮显示 Authorization 摘要或原文。
- 允许一次请求重放携带 Cookie。
- 允许一次请求重放携带 Authorization。

约束：

- 默认关闭。
- 必须逐次确认。
- 解锁内容仅本轮可见。
- 不进入长期历史。
- 不进入同步快照。
- 不进入导出。
- 工具轮只记录脱敏摘要和确认事件。

## 6. 模型自动化 Web 逆向建议流程

模型分析接口时应优先使用以下流程：

1. `network.clear_requests` 清空观察窗口。
2. 使用 `browser.*` 工具执行页面操作，或提示用户手动触发目标行为。
3. `network.wait_for_requests` 等待新增请求。
4. `network.list_requests` 按 URL、method、resourceType、status 筛选。
5. `network.get_request_details` 获取少量高相关请求详情。
6. `network.compare_requests` 对比多条请求差异。
7. `network.find_parameter_candidates` 识别签名、时间戳、nonce、token、加密载荷等字段。
8. `network.extract_js_candidates` 按接口路径、参数名和关键词定位 JS 候选片段。
9. 必要时调用 `js.search_sources` / `js.extract_context` 定位 bundle 命中位置。
10. 必要时调用 `sourcemap.list_candidates`、`sourcemap.resolve_location` 和 `sourcemap.extract_original_context` 映射原始源码片段。
11. 如果用户已显式开启阶段四高风险只读授权，且静态源码不足以确认运行时对象形态，可调用 `runtime.inspect_globals`、`runtime.search_modules` 或 `runtime.describe_function` 读取有限摘要。
12. 输出分析结论、请求结构、参数解释、疑似加密逻辑入口、运行时证据摘要和下一步建议。

模型不得承诺绕过站点安全机制，不得自动破解、爆破、绕过验证码或规避风控。

## 7. 测试计划

### 7.1 单元测试

- 工具注册、工具暴露条件、浏览器控制未开启、未 attach、Network recorder 未启用。
- 参数校验：非法类型、空数组、超长数组、超时上限、非法 status、非法 resourceType。
- 请求生命周期：request、response、loadingFinished、loadingFailed、tab 切换、detach 清理。
- 响应体读取：跳过二进制资源、截断长文本、读取失败兜底。
- `compare_requests`：query、header、body JSON、form body、path 差异。
- `find_parameter_candidates`：签名、时间戳、nonce、长 base64、hex、嵌套 JSON、误报控制。
- `extract_js_candidates`：JS 类型识别、关键词命中、接口路径命中、片段截断、空结果。
- `sourcemap.*`：工具注册、暴露条件、响应头优先级、`sourceMappingURL`、inline data URL、同源读取、普通 v3 map、section map、无 `sourcesContent`、非法 JSON、行列转换、`ignoreList` / `x_google_ignoreList`、脱敏截断和缓存清理。
- `runtime.*`：额外高风险授权过滤、伪造工具调用拒绝、结构化参数校验、危险路径段拒绝、固定模板表达式、返回深度和大小限制、函数摘要截断、敏感字段脱敏、超时和中文错误归一化。
- 普通发送消息不再自动执行旧 Network 筛选流程。

### 7.2 集成测试

- 工具循环中模型调用 `network.*` 后能生成工具记录和 Network 附件。
- 流式模式下工具执行过程、最终回答和失败收尾保持现有行为。
- 空正文工具轮附件能在 UI 中正确展示、聚合和导出。
- `source-map` 工具附件能在 UI 中正确展示、聚合、导出并作为后续追问上下文注入。
- 阶段四未开启授权时，流式和非流式工具循环都不会下发或执行 `runtime.*`；开启授权后工具结果只进入 tool message，不意外生成用户可见附件。
- 历史 `networkContextAttachment` 能兼容读取，但不会生成新旧格式数据。

### 7.3 构建与扩展验证

最小验证：

- 相关 `vitest` 文件。
- `npm run typecheck`。
- `npm run build:extension`。

涉及 manifest、background、browser control、debugger allow-list 或真实扩展加载路径时，追加：

- `npx playwright test --project=chrome-extension`

## 8. 文档与维护要求

- 修改 Network 工具、浏览器控制、工具附件或 Web 逆向规划时，应同步检查本文件。
- 修改用户可见使用方式时，应同步检查 `docs/插件教程.md`。
- 新增高风险能力前，必须先补权限、确认、脱敏、审计、测试和失败回滚设计。
- 所有用户可见输出、文档、注释和 commit message 必须使用简体中文。
