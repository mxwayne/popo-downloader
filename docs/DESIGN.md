# POPO Design

独立入口：仓库根目录 `design.html`。运行：

```sh
npm run design
```

默认预览地址为 `http://127.0.0.1:4178/design.html`。`POPO_DESIGN_PORT` 可修改端口；修改源码后重新运行。只生成文件时执行 `npm run build:design`，也可以直接在浏览器打开根目录的 `design.html`。Design 不进入正式扩展清单、不修改安装器，不需要连接 POPO、Gopeed 或 Native Host。

## 目录与视觉方向

- 业务样板：三个素材文件夹入队、排队、扫描、下载、暂停、失败重试、停止剩余文件、移除历史、完成通知。
- 基础规范：现有深色蓝灰配色、系统字体、间距建议、实际圆角、Lucide 图标、层级与宿主关系。
- 基础组件：任务卡、进度、页面下载按钮、项目计数、批次操作、设置、网络提醒、摘要、通知、诊断。
- 动效与反馈：复用原有 Motion 与 CSS 扫描/下载/完成反馈；增加可重置演示、减少动态效果和目录骨架预览。
- 使用与验收：来源、状态适用性、实现状态、业务接入和验收边界。

继续使用固定深色扩展主题，浅色用于模拟 POPO 宿主。未新增浅色扩展主题、Tailwind、Radix、Animate UI 或 Magic UI。后两者已评估，当前 Motion 足够；后续有具体缺口再逐组件判断。

## 共享实现

| 文件                           | 职责                                                  |
| ------------------------------ | ----------------------------------------------------- |
| `src/ui/popup-components.tsx`  | 任务卡、进度、任务分组、设置、诊断与网络提醒          |
| `src/ui/page-components.tsx`   | 文件夹/整页按钮、项目数、任务条和通知                 |
| `src/ui/page-styles.ts`        | 原有页面注入与 Shadow DOM 样式                        |
| `src/ui/directory-skeleton.ts` | 目录切换骨架 DOM 工厂                                 |
| `popup.css`                    | 弹窗样式与基础变量；Design 原样加载到预览 Shadow Root |
| `src/ui/actions.tsx`           | 显式注入操作接口，缺少 Provider 时立即报错            |
| `src/ui-model.ts`              | 状态名称、进度、允许操作等既有业务解释                |
| `src/design/demo.ts`           | 内存模拟器与场景，禁止真实 I/O                        |
| `src/design/frame.tsx`         | 用 Shadow DOM 隔离预览，限制浮层到示例容器            |

`src/popup.tsx` 与 `src/page-ui.tsx` 保留真实 Chrome/DOM 适配，将操作接口传入公共组件。Design 不导入业务入口；发送诊断、选目录、复制均为模拟，页面 CSP 禁止连接请求。重置会重新挂载示例、清空模拟状态，并使旧异步操作失效；切换栏目会卸载计时器。

预览容器的定位与尺寸适配属于 Design 外壳，不替换业务组件样式。`320px` 是布局压力测试；正式弹窗仍沿用 `390px`。目录状态不是通用表单状态，不适用的组合在页面说明中注明。

## 验收

修改共享组件后执行 `npm run check:full` 与 `npm run build:design`。浏览器检查业务样板、重置、状态切换、长内容、窄屏、键盘和减少动态效果；网络面板应只有本地静态资源。

本地示例通过不代表真实 Windows 下载通过。Extension 变更需按 AGENTS.md 完成 Windows Dev 同步、manifest 与身份核对，再重新加载“POPO Dev 下载助手”并刷新 POPO 页面。Stable 保持只读；真实文件夹选择、诊断发送和下载恢复需现场验收。
