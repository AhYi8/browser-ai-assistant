# Network 工具化与 Web 逆向自动化规划

## 1. 摘要

Network 分析已从“发送前自动注入上下文”的旧流程，重构为浏览器自动化工具组中的 `network.*` Function。

模型现在可以在工具循环中主动决定何时清空请求、等待新增请求、筛选请求、读取详情、对比请求、定位 JS 资源和分析参数。第一阶段已经落地基于 `chrome.debugger` 的后台 Network 采集，以及 `network.compare_requests`、`network.find_parameter_candidates`、`network.extract_js_candidates` 三个逆向辅助工具。

完整 Web 逆向能力继续按阶段推进。Source map 已作为独立 `sourcemap.*` 工具组落地，受控只读 `Runtime.evaluate` 已并入默认普通模式，用于补足静态 JS / Source Map 无法确认运行时模块、公开配置和函数导出形态的场景。本阶段同时落地三模式运行态、受控增强 AI 边界确认、无凭据请求重放沙箱 v1，以及完全访问最高权限模式。完全访问由用户在当前会话中主动切换后生效，允许工具结果原样回灌给 AI，不再套用人为脱敏、只读限制、敏感信息过滤、逐项确认或请求重放沙箱限制；仍受 Chrome、网页 CSP、站点权限和扩展平台本身硬限制约束。

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

状态：当前范围已实施；`runtime.*` 已并入三模式中的普通模式，默认只读、脱敏、固定模板，不再需要单独“运行时只读分析”按钮；不包含完全访问、任意脚本执行或敏感字段解锁。

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
- `runtime.*` 属于浏览器自动化工具组，在普通模式和受控增强模式下默认可用，但仍必须满足浏览器控制开启、当前 tab 已 attach、Network recorder 已启用和 background 固定只读模板校验。

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

- 继续复用顶部浏览器控制作为基础运行态；不再提供顶部“运行时只读分析”按钮。
- 三模式选择位于输入区 `.composer-switches` 内、流式响应开关左侧；浏览器控制关闭时禁用并显示普通模式。
- 普通模式即当前受限模式：运行时只读分析默认开启，但仍只读、脱敏、固定模板。
- 受控增强模式启用 `boundary.request_user_choice` 与 `replay.*`；模式由用户选择后在当前会话内保持生效，AI 回复轮次、工具循环、`network.clear_requests`、导航、刷新或切换受控 tab 只能清理一次性 grant 和请求重放草案，不能自动切回普通模式。
- 完全访问模式已实现最高权限运行态；仅在用户切换到 `full_access` 后暴露 `full_access.*`，普通模式和受控增强模式下 background 必须 fail closed。
- 工具注册表中 `runtime.*` 可出现在浏览器自动化分组；Side Panel 和 background 必须双重过滤浏览器控制、Network recorder 和三模式运行态。
- `full_access` 是真实运行态授权上下文；该模式下关闭人为脱敏、只读限制和敏感信息过滤，工具结果可原样进入 AI 上下文。

建议执行边界：

- 新增独立 `RuntimeReadToolExecutor` 或同等模块，避免继续堆入 `browserControlMessageHandler.ts`。
- `BrowserDebuggerConnection` 可以保留底层 `evaluate` 封装，但只读运行时工具必须通过执行器提供的固定模板调用，不允许外部传任意 CDP 方法或任意表达式。
- webpack / Vite / Rollup 模块缓存探测应使用有限候选模板，例如只检查常见全局 chunk 数组、模块导出键和函数摘要；不得递归遍历完整对象图。
- 全局路径读取只接受安全路径段，例如标识符、数字索引和有限白名单符号；禁止 `constructor`、`prototype`、`__proto__`、`eval`、`Function` 等危险路径段。
- 关键词搜索必须限制关键词数量、长度和返回命中数量；命中结果只返回模块摘要、导出键、类型和截断片段。
- 每次工具调用都应记录工具调用记录、授权状态摘要、截断/脱敏标记和中文失败摘要；不得记录用户临时授权的敏感原文。

建议实施顺序：

1. 将阶段四运行时只读并入三模式运行态：普通模式默认开启受限只读，受控增强继承只读能力，完全访问模式暴露最高权限 `full_access.*` 工具。
2. 新增 `runtime.*` 工具注册、模型安全函数名和浏览器自动化分组展示，并由浏览器控制、Network recorder 和三模式运行态过滤。
3. 新增只读执行器和固定表达式模板，先实现 `runtime.inspect_globals` 与 `runtime.describe_function`，验证安全框架。
4. 再实现 `runtime.search_modules`，仅覆盖常见 webpack / Vite 模块缓存摘要，不追求所有打包器通吃。
5. 补充工具结果脱敏、截断、错误归一化、工具循环和流式收尾测试。
6. 根据真实验证结果再决定是否需要用户可见附件；未完成附件设计前只返回 tool message。

验收标准：

- 未开启浏览器控制或 Network recorder 未启用时，模型看不到 `runtime.*` 工具 schema，background 也拒绝伪造工具调用。
- 模型无法传入任意 JavaScript，只能传结构化参数。
- 读取公开对象、函数摘要和模块摘要能返回有限结果，并标记 `redacted` / `truncated`。
- 试图读取 Cookie、Storage、DOM 写入、网络请求、危险路径段或超预算内容时均返回固定中文错误或脱敏摘要。
- 关闭浏览器控制、tab 关闭或 debugger detach 后，三模式运行态回到普通模式；切换受控 tab、导航、刷新或 `network.clear_requests` 后只清理临时 grant、请求重放草案和缓存状态，用户选择的模式继续保持。

### 5.5 阶段五：请求重放沙箱

状态：v1 已进入受控增强模式；仅实现无凭据、同源、逐次确认、脱敏截断的请求重放沙箱，不实现携带 Cookie、Authorization、Storage 或页面上下文凭据的重放。

目标：

在隔离环境中构造请求重放，用于验证接口参数、分页参数、排序参数和非敏感请求体结构。该阶段只服务“确认参数结构和响应形态”的诊断目标，不用于登录绕过、批量探测、风控规避、验证码绕过、撞库、爆破或携带用户凭据访问受保护资源。

阶段判断：

- Network、JS、Source Map 和只读 Runtime 已能定位接口、参数候选、生成逻辑入口和运行时摘要，但仍可能无法确认某个非敏感参数是否影响响应。
- 仅靠当前页面真实操作可能难以稳定复现分页、排序或筛选组合；请求重放沙箱应作为最小验证工具，而不是替代页面操作的通用 HTTP 客户端。
- 阶段五不得复用浏览器页面上下文、Cookie、Authorization、Storage、IndexedDB 或调试协议中的凭据；如确需敏感凭据，必须进入阶段六逐次解锁设计，不能在阶段五暗中放行。
- 请求由扩展 background 沙箱通过 `fetch` 发起，仍受浏览器扩展环境、目标站点 CORS 与重定向策略影响；跨域或不可读响应只能返回受限摘要，不得借页面上下文绕过 CORS。

建议工具：

| 工具 | 用途 |
| --- | --- |
| `replay.prepare_request` | 基于已采集请求生成脱敏后的重放草案，输出目标 URL 摘要、method、非敏感 header、query/body 参数结构和风险提示，不发起网络请求。 |
| `replay.send_request` | 只发送用户本次确认过的无凭据重放请求，并返回脱敏、截断后的响应摘要。 |
| `replay.compare_responses` | 对比原始采集响应摘要与重放响应摘要，判断状态码、结构、分页字段、排序字段和关键业务字段差异。 |

命名规则：

- 用户可见文档保留 `replay.*` 点号名称。
- 发给 OpenAI-compatible 模型的 `function.name` 必须使用 `replay_prepare_request`、`replay_send_request`、`replay_compare_responses` 这类安全名称。
- `replay.*` 属于浏览器自动化工具组，但必须处于受控增强模式；浏览器控制开启不等于允许重放，发送草案还必须拥有本轮一次性 boundary grant。

默认行为：

- 默认不带 Cookie。
- 默认不带 Authorization。
- 默认不带浏览器存储凭据。
- 默认不带 `Referer`、`Origin`、`User-Agent` 之外的浏览器身份类 header；是否保留 `Origin` / `Referer` 必须由沙箱策略显式判定并展示摘要。
- 默认只带用户确认后的非敏感 header，且 header 名和值都必须经过敏感词、长度和字符集校验。
- 请求目标、method、header 摘要、query 摘要、body 摘要、预计超时和最大响应读取大小必须展示给用户。
- 默认只允许 `GET`、`HEAD` 和可证明无凭据、无敏感 body 的 `POST`；`PUT`、`PATCH`、`DELETE` 以及文件上传类请求必须先保持禁用。
- 默认不自动跟随跨域重定向；同源重定向也必须限制次数并保留重定向摘要。

AI 边界确认：

- 受控增强模式新增 `boundary.request_user_choice`，OpenAI-compatible 函数名为 `boundary_request_user_choice`。
- AI 必须提供问题、原因、动态选项、风险等级和授权摘要；UI 固定追加“其他”选项和自由输入框。
- 用户选择“其他”不会直接授予权限，只把补充文字作为 tool result 回灌模型，由模型重新生成边界确认或放弃操作。
- 用户选择 AI 提供的选项后生成一次性 `BoundaryGrantContext`，绑定当前 tab、origin、工具轮和过期时间。
- 授权白名单仅限 `include_sensitive_field_in_current_tool_result`、`send_single_confirmed_replay_request_without_credentials`、`expand_runtime_summary_depth`、`expand_js_or_sourcemap_context`、`write_sensitive_result_to_chat_once`。当前阶段只保留已有真实执行器消费路径的授权；“只保留脱敏草案”这类无副作用选项应使用空授权数组，不生成伪授权。
- 禁止授权任意脚本执行、批量请求、扫描、爆破、撞库、绕过验证码/风控/登录/权限、持久保存敏感原文、自动把敏感原文发送给远端模型。

用户确认：

- 发送请求前必须逐次确认，确认只对本次请求、本次目标 URL、本次 method、本次脱敏 header 和本次 body 摘要有效。
- 确认界面只展示脱敏摘要，不展示 Cookie、Authorization、Token、Secret、Password、Session、CSRF 等原文。
- 模型只能生成重放草案，不能代替用户确认发送。
- 带敏感凭据必须进入阶段六设计；阶段五遇到敏感凭据需求时只能返回固定中文拒绝。
- 每次确认只对本次请求有效。
- 确认内容不得写入长期历史、同步快照或导出；工具记录只能保存确认事件、脱敏摘要、时间、目标摘要和执行结果摘要。

执行沙箱：

- 建议新增独立 `ReplaySandboxToolExecutor` 或同等模块，不得堆入 Network recorder、JS source index、Runtime read executor 或 `browserControlMessageHandler.ts` 主流程。
- 重放请求必须由 background 的受控沙箱发起，不得注入页面执行 `fetch`，不得借页面上下文携带站点凭据。
- HTTP 客户端必须使用固定超时、最大请求体大小、最大响应体大小、最大重定向次数和并发限制。
- 响应体读取前必须跳过明显二进制资源；文本响应必须截断、脱敏并标记 `truncated` / `redacted`。
- 请求体只允许 JSON、`application/x-www-form-urlencoded` 或纯文本摘要；multipart、二进制、压缩体和未知类型默认拒绝。
- 请求草案必须基于已采集请求或用户明确输入的目标，不能让模型自由批量生成 URL 字典或参数爆破列表。
- 同一轮工具调用必须限制重放次数；连续失败、超时、4xx/5xx 或重定向异常时不得自动扩大范围重试。
- 取消聊天生成或关闭浏览器控制时，必须中止正在进行的重放请求并清理临时授权。

数据与附件：

- `replay.prepare_request` 默认只返回 tool message，不生成用户可见附件。
- `replay.send_request` 如需生成用户可见结果，必须新增 `toolAttachments` kind，例如 `request-replay`，并完成展示、导出、后续追问上下文和历史归一化设计。
- 未完成附件设计前，重放结果只允许作为 tool message 回灌模型，不得保存完整请求体、完整响应体、完整 URL 或完整 header。
- 导出、后续追问和 UI 展示前必须重新脱敏，不能信任历史保存的重放摘要。

安全限制：

- 限制目标 URL 协议为 `http` 或 `https`。
- 限制请求大小、超时、重试次数。
- 限制目标 host：默认只能请求当前受控页面同源或用户逐次确认的已采集请求目标；禁止模型构造任意第三方扫描目标。
- 禁止读取、注入或转发 Cookie、Authorization、Proxy-Authorization、Set-Cookie、X-CSRF-Token、X-XSRF-Token 等敏感 header 原文。
- 禁止自动携带浏览器证书、客户端证书、扩展本地密钥、Chrome Storage、IndexedDB 或页面 Storage 内容。
- 禁止把 401/403、验证码、风控、登录跳转解释为可绕过目标；此类结果必须作为边界信息交付。
- 禁止自动批量撞库、爆破、绕过验证码或规避风控。

建议实施顺序：

1. 新增三模式运行态、store 状态、runtime 消息、关闭控制或 detach 收口、页面生命周期临时授权清理和中文风险提示。
2. 新增 `boundary.request_user_choice` 与 `replay.*` 工具注册、OpenAI-compatible 安全函数名和浏览器自动化分组展示，并仅在受控增强模式暴露。
3. 实现 `replay.prepare_request`，只生成脱敏草案和确认摘要，不发起网络请求。
4. 实现 `replay.send_request`，仅支持 `GET` / `HEAD` / 受限 `POST`、无凭据、固定超时、固定大小上限和一次性 boundary grant。
5. 实现 `replay.compare_responses`，只比较脱敏摘要和结构差异，不保存完整响应体。
6. 根据真实验证结果再决定是否新增用户可见 `request-replay` 附件；未完成附件设计前只返回 tool message。

验收标准：

- 未开启浏览器控制、未开启受控增强模式或 Network recorder 未启用时，模型看不到 `replay.*` 工具 schema，background 也拒绝伪造工具调用。
- 模型无法绕过 `prepare -> 用户确认 -> send` 顺序直接发送未确认请求。
- 默认重放请求不携带 Cookie、Authorization、Storage 或页面上下文凭据。
- 非法协议、跨范围目标、危险 method、敏感 header、超大 body、二进制响应、超时和取消都返回固定中文错误或脱敏摘要。
- 工具记录、导出和后续追问上下文中不出现完整敏感 URL、header、body 或响应原文。
- 关闭浏览器控制、切换受控 tab、导航、刷新、debugger detach 或终止生成后，请求重放授权、草案和进行中的请求被清理或中止；其中切换受控 tab、导航和刷新不得自动改变用户选择的三模式。

### 5.6 阶段六：敏感字段解锁与完全访问授权

目标：

允许用户在明确知情的情况下切换到 `full_access` 完全访问模式。该模式是当前会话、当前受控页面的最高权限授权：不再脱敏、不再只读、不再过滤敏感信息、不再逐项边界确认，也不再使用请求重放沙箱限制。工具结果可以原样回灌给 AI。

状态：当前范围已实施完全访问 v1；普通模式和受控增强模式不暴露 `full_access.*`，background 对伪造调用固定拒绝。

完全访问能力：

- `full_access.execute_script`：在当前页面上下文执行任意 JavaScript，返回原始 Runtime 结果。
- `full_access.fetch`：在当前页面上下文发起任意 `fetch` 请求，默认 `credentials: "include"`，允许任意 method/header/body。
- `full_access.get_network_details`：读取已采集 Network 请求、Header、Body 和响应体原文，调用 recorder 时使用 `redacted: false`。
- `full_access.read_storage`：读取当前页面可访问的 `document.cookie`、`localStorage`、`sessionStorage`、location、title 和 referrer 原文。
- `full_access.revoke`：撤销完全访问运行态并回到普通模式。

授权模型：

- 完全访问必须由用户在 UI 中切换到 `full_access`，不能由模型工具调用、Prompt、历史消息、导入数据或同步快照自动开启。
- 完全访问是运行态临时授权，不进入聊天偏好、会话历史、同步快照或导出配置。
- 关闭浏览器控制、tab 关闭、debugger detach 或调用 `full_access.revoke` 时必须回到普通模式；切回普通或受控增强后 `full_access.*` 立即不可见且不可执行。
- 当前实现不尝试绕过 Chrome、网页 CSP、站点权限、跨域规则、扩展权限或浏览器平台本身硬限制。

命名规则：

- 用户可见文档保留 `full_access.*` 点号名称。
- 发给 OpenAI-compatible 模型的 `function.name` 使用 `full_access_execute_script`、`full_access_fetch`、`full_access_get_network_details`、`full_access_read_storage`、`full_access_revoke`。
- `full_access.*` 属于最高风险浏览器自动化工具组，必须同时满足浏览器控制开启、Network recorder 已启用、当前模式为 `full_access` 和 background 二次校验。

数据处理规则：

- 完全访问工具结果不经过通用脱敏、敏感字段过滤或只读摘要模板。
- 允许 Cookie、Authorization、Token、Password、Storage、请求体、响应体等原文进入 tool result 并回灌 AI。
- `full_access.get_network_details` 返回原文后，不得再被通用 Network 附件脱敏逻辑二次处理。
- 完全访问模式不改变聊天偏好、会话历史、同步快照或导出配置的持久化边界；模式本身不持久化。

验收标准：

- 普通模式和受控增强模式下，模型看不到 `full_access.*` 工具 schema，background 也拒绝伪造工具调用。
- 完全访问模式下，模型可以看到并执行五个 `full_access.*` 工具。
- `execute_script` 返回原始执行结果，`fetch` 默认携带页面凭据，`get_network_details` 和 `read_storage` 返回未脱敏原文。
- 切回普通模式、关闭浏览器控制、tab 关闭、debugger detach 或调用 `full_access.revoke` 后，完全访问立即失效。
- 相关 vitest、`npm run typecheck`、`git diff --check` 和 `npm run build:extension` 通过。

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
11. 如果静态源码不足以确认运行时对象形态，可在普通模式或受控增强模式下调用 `runtime.inspect_globals`、`runtime.search_modules` 或 `runtime.describe_function` 读取有限摘要。
12. 如需验证非敏感接口结构，先请用户切换受控增强模式，再通过 `boundary.request_user_choice` 获取一次性边界授权，按 `replay.prepare_request -> replay.send_request -> replay.compare_responses` 顺序执行无凭据重放。
13. 输出分析结论、请求结构、参数解释、疑似加密逻辑入口、运行时证据摘要和下一步建议。

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
- Network/API 分析、源码/运行时分析只是 Playbook 内置策略中的两个方向；本项目核心定位仍是浏览器自动化助手，Web 逆向能力必须通过通用浏览器自动化工具和 Playbook 策略接入，不得把工具体系收窄为只服务 Web 逆向。
- Playbook 只能影响模型在工具循环中的策略提示和自动化报告摘要，不得改变 `network.*`、`js.*`、`sourcemap.*`、`runtime.*` 或 `full_access.*` 的暴露条件、脱敏规则、运行态授权和 background 二次校验。
- 修改用户可见使用方式时，应同步检查 `docs/插件教程.md`。
- 新增高风险能力前，必须先补权限、确认、脱敏、审计、测试和失败回滚设计。
- 所有用户可见输出、文档、注释和 commit message 必须使用简体中文。
