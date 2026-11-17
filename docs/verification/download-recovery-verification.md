# 下载恢复验证记录

基线：macOS 工作树，HEAD `c37e2a9`，未提交；Stable 不在操作范围。
Windows 验证批次：`20261116T134613Z-c37e2a9c8382-8352`。Node 291 通过、0 失败；Playwright 12 通过。

| 验收 | 状态 | 证据 |
| --- | --- | --- |
| AC1 普通扫描异常与耗尽 | PASS（自动测试） | Node：“目录短暂读取失败自动重扫，耗尽后保留定位且继续队列” |
| AC2 完整失败明细 | PASS（自动测试） | Playwright：“失败明细展示全部条目并能单独重试”，截图已人工查看 |
| AC3 单项精准补下 | PASS（自动测试） | Node：“单项文件重试只读父目录”“单项目录补下”“单项补下实际扫描只选择目标文件” |
| AC4 保留其他失败、去重、目标消失 | PASS（自动测试） | Node：`download-recovery.test.js`、`queue.test.js` 新增用例 |
| AC5 脱敏诊断 | PASS（自动测试） | Node：“失败分类不包含原始素材名、地址或凭证” |
| AC6 本地与 Windows 检查、Dev 同步 | PASS | Windows 完整检查通过；Dev 同步批次 `11-16 21:50:23`，扩展 ID `folfhehnopknchpoaajfpboibbhnlanf`，版本 `0.7.9-dev` |
| AC7 文件准备失败退避 | PASS（自动测试） | Node：“文件准备失败后退避重试，先处理其他待下载文件” |
| AC8 扫描行号去重 | PASS（自动测试） | Node：“扫描按虚拟列表行号去重”；真实目录 `官方素材/劫妹/劫妹` 待用户重试确认 |
| AC9 目录直达与回退 | PASS（自动测试） | Node：“目录有独立地址时…”两例；真实 POPO 页面未验证 |
| AC10 英文界面按钮挂载 | PASS（现场） | 用户在英文页面确认按钮出现（批次 16:13:32）；没有英文界面的自动测试 |
| macOS Playwright | NOT VERIFIED | 本机 Chromium 1234 下载卡住，未运行；以 Windows 结果为准 |
| 真实 POPO 落盘 | NOT VERIFIED | 待用户在 Windows Dev 重载后验收 |
| Sentry 原事件根因 | NOT VERIFIED | 事件只有阶段“目录加载失败”，没有具体异常；新版本上报 `reason` 与 `routeDepth` 后再判断 |

## 下载链路重设计（docs/specs/download-pipeline-redesign.md）

| 验收 | 状态 | 证据 |
| --- | --- | --- |
| AC1 先扫后下 | PASS（自动测试） | Node：“先扫完再下：扫描队列清空前不处理待下载文件” |
| AC2 目录汇总一致 | PASS（自动测试） | Node：directory-summary、“目录扫描完成后任务带目录汇总” |
| AC3 页面面板重试 | PASS（自动测试） | Playwright：“页面左下角面板展开后显示目录与失败项，并能单独重试” |
| AC4 自动补一轮 | PASS（自动测试） | Node：自动补、权限类不补、补下任务不再补、手动补下不再补、批量不阻塞 |
| AC5 同目录复用与回退 | PASS（自动测试） | Node：复用、目录名不符回退、失败后完整加载、用户切换原页面后不复用（已变异验证） |
| AC6 连续失败冷却 | PASS（自动测试） | Node：“连续 3 次准备失败后冷却…” |
| AC7 诊断只含字段名与类型名 | PASS（自动测试，有残余） | page-probe 测试、Playwright 两例；普通小写词（如用户名）无法自动识别，需用户复制前查看 |
| 失败明细上限 200 | PASS（自动测试） | Node：“失败明细最多保存 200 项…” |
| 同目录复用实际提速 | NOT VERIFIED | 只能在真实 POPO 页面验证 |
| 页面结构诊断内容 | NOT VERIFIED | 待用户在真实页面跑一次后复制 |

## 下载链路阶段二（docs/specs/download-api-scan.md）

| 验收 | 状态 | 证据 |
| --- | --- | --- |
| AC1 接口扫描数量取自 total | PASS（自动测试） | Node：“接口扫描：两层目录带文件 ID…”、api-scan.test.js |
| AC2 有文件 ID 时不走页面流程 | PASS（自动测试） | Node：“按文件 ID 取址：只请求下载地址…” |
| AC3 more、数量不符、同名、接口失败回退 | PASS（自动测试） | Node：more 回退、同名整体回退、取址失败回退 |
| AC4 取址被拒绝时的处理 | PASS（自动测试） | Node：“被拒绝（405）：改走页面流程…”“…页面流程也没有地址：标记权限失败” |
| AC5 请求体只含模板字段 | PASS（自动测试） | Playwright：“接口桥只放行 folderSubList 的模板请求体…” |
| AC6 诊断只含数字与枚举 | PASS（自动测试） | Node：回退事件 context 断言 |
| 真实页面速度与数量一致 | NOT VERIFIED | 待用户在 Windows Dev 实测 |
| 请求体数字字段与翻页规则 | NOT VERIFIED | 第一版沿用页面最近一次请求；`more`/`total`/条数进诊断 |
| 评审加固（队列丢失、闸门、空列表、观察地址、单文件补下） | PASS（自动测试） | Node：接口扫描 5 例 + 先扫完再下（接口） + 按文件 ID 取址 3 例 |
