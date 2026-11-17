# 下载链路阶段二：用 POPO 目录接口扫描与取址

状态：用户已确认（2026-11-17）；已实现，待 Windows 现场验收。接续 [download-pipeline-redesign.md](download-pipeline-redesign.md)（阶段一已实现并经用户现场确认“明显变快”）。

## 目的

现在每个文件都要在隐藏页面里“打开目录、滚动查找、点开文件、等预览”，再取下载地址。目录越深、文件越多，出错机会越多。POPO 页面自己用接口列目录，可以直接拿到文件 ID。改为：用接口列目录，用文件 ID 取下载地址，不再依赖隐藏页面的点击与滚动。

## 证据（2026-11-17，用户 Windows Dev 扩展的页面结构诊断，只含字段名与枚举数字）

- 列目录：`POST /api/bs-team-space/web/v1/page/folderSubList`。
- 请求体字段：`pageId`（string）、`teamSpaceId`（string）、`folderPriority`（number）、`sortField`（number）、`isAsc`（boolean）、`pageMajorVersion`（number）。
- 响应：`data.pageList[]`，每项含 `pageId`、`pageName`、`pageType`、`hasChildren`、`parentPageId`、`teamSpaceId`、`pageSize`、`pageMajorVersion`；另有 `data.more`（boolean）、`data.total`（number）。
- 枚举组合：`pageType 0 + hasChildren 1` 是文件夹；`pageType 3 + hasChildren 0` 是文件（png）。
- 已在用的取址接口：`GET /api/bs-team-space/web/v1/page/download?teamSpaceId=&pageId=`（`page-api.js` 已有，带登录令牌头）。
- 未知：请求体里各数字字段的取值、`more` 为 true 时如何翻页、`pageType` 的其他取值。

## 目标

- G1：扫描用接口取得目录树和文件 ID，数量用响应的 `total` 严格核对。
- G2：取址用文件 ID 直接调接口，不打开预览页。
- G3：任何一步不确定时回退到现有的页面扫描与点击流程，不丢文件、不放宽核对。

## 非目标与反目标

- 不放宽数量核对；任何目录静默少文件都算失败。
- 不并行取址：本规格保持准备步骤串行（一次接口约数百毫秒），不改 26 处单值状态。并行另议。
- 不改 Gopeed、Native Host、Agent、安装器；不动 Stable；不提交。
- 不绕过权限：接口返回 401、403 或业务码 405，与现有行为一致，标记权限失败。

## 设计

1. **接口桥**：`page-api.js` 目前只允许两条 GET。新增白名单项 `folderSubList`（POST）。请求体由页面脚本按固定模板拼装，只接受 `pageId`、`teamSpaceId` 两个字符串，其余字段用默认值；调用方不能传路径、方法或任意字段。
2. **接口扫描**：新增 `scanDirectoryByApi(state, pageId)`（后台）。从被点击文件夹的 `pageId` 起，按层调用 `folderSubList`。`pageType === 0` 的项入目录队列，其余项记为文件，条目带 `pageId`。
3. **找到被点击文件夹的 `pageId`**：在其父目录（当前页面 URL 里的 `pageDetail/<id>`）调用 `folderSubList`，按 `pageName` 匹配；同名不唯一或找不到时，整个任务回退到页面扫描。
4. **核对**：每个目录要求 `data.pageList.length === data.total` 且 `data.more === false`。否则该目录回退到页面扫描，并在诊断里记录 `more`、`total`、`length`（只记数字），用来弄清翻页规则。
5. **取址**：条目带 `pageId` 时，准备步骤改为一次 `REQUEST_DIRECT_DOWNLOAD`，不加载目录、不点开文件、不等预览；后续建立 Gopeed 任务与现在相同。取址失败按现有的重试、退避、冷却处理；连续失败时该文件回退到页面流程再试一次。
6. **保存路径与文件名**：沿用现有规则（目录层级用 `pageName` 路径，文件名用 `pageName` 与下载地址解析的结果）。
7. **开关与诊断**：`settings.useApiScan` 默认开启；关闭后完全走现有流程。回退次数和原因（枚举）进入脱敏诊断。
8. **不影响**：阶段一的先扫后下、目录汇总、失败明细、自动补一轮、冷却均保持；同目录复用只在页面流程里生效。

## 验收

- AC1：接口扫描得到的目录与文件数量与 `total` 一致；与页面扫描结果在测试夹具上一致。
- AC2：条目带 `pageId` 时，准备步骤不发出 `NAVIGATE_WORKER`、`OPEN_ITEM`、`GET_PREVIEW_INFO`。
- AC3：`more` 为 true、数量不符、同名文件夹、接口 401、业务码异常，每一种都回退到页面流程且文件不丢。
- AC4：按文件 ID 取址被拒绝（405、401、403）时，改走页面流程（先用预览里的媒体地址）；页面流程也拿不到地址才按权限失败标记，不自动重试。
- AC5：请求体只包含模板字段；调用方传入的多余字段、路径、方法被拒绝。
- AC6：诊断只含数字与枚举，不含文件名、路径、地址、令牌。
- AC7：现有测试全部通过；Windows 完整检查通过；同步 Dev 目录。
- AC8（现场）：用户在真实 POPO 页面下载大文件夹，目录与文件数量与页面一致，速度对比阶段一。

## 风险

- 请求体里 `folderPriority`、`sortField`、`isAsc`、`pageMajorVersion` 的取值未知。第一版使用诊断里页面自己的取值：由页面脚本记录页面最近一次 `folderSubList` 的请求体数字字段并复用，找不到时直接回退。
- 接口是 POPO 内部接口，可能变化。回退机制和开关是兜底；每次回退都进诊断。
- 访问频率：每个目录一次请求，每个文件一次取址请求，与用户在页面上操作的量级相同；第一版不并发，不增加压力。

## 留给实现者

- 数字字段的复用实现细节（页面脚本如何保存最近一次请求体）。
- 目录队列与现有 `scanQueue` 条目的字段对齐方式。要求：不破坏已存任务的恢复。

## 实现与规格的差异

- `settings.useApiScan` 只存在于存储与命令校验中，弹窗没有开关（弹窗设置区没有通用复选框，先不为它新增界面）。
- `page` 范围任务（整页扫描）不走接口：它按行号匹配“已单独排队的文件夹”，接口拿不到行号。常用的文件夹按钮任务走接口。
- 补下任务仅当目录地址的页面标识不同于根目录时走接口；单文件补下按“名称 + 目录路径”匹配，不再只依赖页面行号标识。
- 回退事件 `API_SCAN_FALLBACK` 的 `reason` 枚举：`more`、`count_mismatch`、`business_error`、`bad_shape`、`unknown_kind`、`empty_unverified`、`api_error`、`ambiguous_folder`、`no_page_id`、`download_url`、`permission`。
- 评审后的加固：接口扫描队列中途被关闭或出错时，剩下的目录转页面扫描，不会丢；页面工作区恢复超限时，未列出的目录记为失败；先扫后下的闸门同样等接口队列清空；非 0 类型却带子项的条目与“声称有子项的空列表”都交给页面扫描核对；按文件 ID 取址不借用页面里按文件名观察到的旧地址；单文件补下不递归子目录。
- 现场校正（2026-11-17）：POPO 成功的业务码是 `1`（提示“成功”）；`data.total` 不可靠（实测出现 `total` 为 0 而列表有 2 项）。规则改为：业务码 0、1、200 视为成功；`more` 为 true 回退；`total` 大于 0 时必须等于条数，`total` 为 0 视为未提供，数量取实际条数。代价：`total` 为 0 时不再有数量交叉核对，靠 `more` 与“声称有子项却为空”两道检查兜底。
- 任务显示扫描用时与下载用时（扫描方式：接口、页面或混合），数据来自 `job.startedAt`、`job.scanCompletedAt`、`job.completedAt` 与目录汇总的 `via`。
- 完成提示（现场校正）：后台给页面的任务列表不含成功完成的任务，所以原有的“任务转为完成”提示在实际使用中从未出现。现在完成凭证带 `startedAt`、`scanCompletedAt`、`scanVia`，页面在出现新凭证时弹出带扫描与下载用时的提示，停留 10 秒。
- 扫描并行（现场数据驱动）：S5 赛季（105 个目录、1572 个文件）实测全程走接口、无回退，但串行列目录用了 1 分 47 秒（约每目录 1 秒）；单文件准备中位数 0.28 秒，下载阶段已受 Gopeed 传输限制。因此接口扫描改为同级目录并行列出，上限 4，结果仍按队列顺序写入，某个目录回退不影响同批其余目录。
