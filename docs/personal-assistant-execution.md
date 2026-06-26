# HanaAgent Personal Assistant Execution Manual

> 这是给后续 Codex 接力用的执行手册。新对话先看 [personal-assistant-project-ledger.md](./personal-assistant-project-ledger.md)，再看本文件和对应 plan。

**仓库:** `D:\hana agent\openhanako`
**最后整理:** 2026-06-26 13:11

## 当前阶段

01-05 均已完成实施和项目经理侧验证。02 / 04 / 05 / 01 的 reviewer 修复项均已复审通过；03 已完成项目经理侧验证。Roadmap final gate 和 `HanaAgent Integration QA` 均已 `APPROVED`。当前主实施并发 0 / 3，项目正在主线程完成审计。

## 已完成

- 已建立 9 个线程：6 个实施、3 个复核。
- 已统一线程命名，方便侧栏识别。
- 已放行 3 个主实施线程：
  - `HanaAgent Native Task Runner`
  - `HanaAgent Model Routing`
  - `HanaAgent Logs Archive`
- 已向前三个实施线程补发明确启动命令，要求从各自 plan 的 Task 1 开始并回报 `DONE` / `BLOCKED`、改动文件和测试结果。
- 已读取三个实施线程回包，确认 `03-model-routing`、`04-task-logs-archives`、`02-native-personal-tasks` 均返回 `DONE`。
- 项目经理侧已重新运行并通过：
  - `node scripts/hana-agent-quality-harness.mjs --stage routing`
  - `node scripts/hana-agent-quality-harness.mjs --stage logs`
  - `node scripts/hana-agent-quality-harness.mjs --stage tasks`
  - `npm run typecheck`
- 已派发 `Spec Compliance Reviewer` 和 `Code Quality Reviewer` 复核 `03/04/02`。
- `Spec Compliance Reviewer` 已要求 `02-native-personal-tasks` 修复 Codex contract 扫描和 `seedPersonalTasks` 参数契约。
- `Code Quality Reviewer` 已要求 `04-task-logs-archives` 修复 run log 落盘前 secret 脱敏。
- 已创建长期进度页与本执行手册。
- 已在 PRD 顶部挂接进度页入口。
- `HanaAgent Native Task Runner` 已完成 Codex contract 全文件扫描、同名优先级、`seedPersonalTasks({ actorAgentId, codexRoot, now })` 兼容修复；PM 侧 `tasks` harness 和 `typecheck` 通过；Spec 修复复审 `APPROVED`。
- `HanaAgent Model Routing` 已完成模型路由策略与 scheduler 接入；PM 侧 `routing` harness 和 `typecheck` 通过。
- `HanaAgent Logs Archive` 已完成 run log / output / open action 与落盘前脱敏修复；PM 侧 `logs` harness 和 `typecheck` 通过；Code 修复复审 `APPROVED`。
- `HanaAgent Fusion Review` 已完成 reviewer -> judge -> finalizer 复核链路覆盖、failure containment、one-shot route behavior、prompt 边界脱敏修复；PM 侧 `fusion` harness 和 `typecheck` 通过；Spec / Code 复审 `APPROVED`。
- `HanaAgent Automation Toolbar UI` 已完成现有 `AutomationPanel` 增强、动作按钮、运行日志、Fusion once、locale keys、错误态和 `sessionPath` fallback 修复；PM 侧 UI 目标测试、`ui` harness、`typecheck` 通过；Spec / Code 修复复审 `APPROVED`。

## 线程状态

| 角色 | 线程名 | 线程 ID | 状态 |
| --- | --- | --- | --- |
| Roadmap Architect | `HanaAgent Roadmap Architect` | `019f01e9-207a-7cb0-91b3-523230f37b41` | final gate `APPROVED` |
| Automation Toolbar UI Agent | `HanaAgent Automation Toolbar UI` | `019f01e9-3c74-7712-a5f8-a1aeb930c1b9` | UI 修复复审通过 |
| Native Task Runner Agent | `HanaAgent Native Task Runner` | `019f01e9-6ee8-7382-aacd-e513483cc45f` | DONE，Spec 修复复审通过 |
| Model Routing Agent | `HanaAgent Model Routing` | `019f01e9-aa69-7a13-9998-5e960d1227de` | DONE，PM 验证通过 |
| Logs Archive Agent | `HanaAgent Logs Archive` | `019f01ea-02d4-78b0-831f-fbc472cf8ad9` | DONE，Code 修复复审通过 |
| Fusion Review Agent | `HanaAgent Fusion Review` | `019f01ef-f759-7660-bd3a-1794bdb76b72` | DONE，Spec / Code 修复复审通过 |
| Spec Compliance Reviewer | `HanaAgent Spec Reviewer` | `019f01f0-2318-79f2-a50c-afe1f1750044` | UI fallback 修复复审 `APPROVED` |
| Code Quality Reviewer | `HanaAgent Code Reviewer` | `019f01f0-44ec-7db2-9fb0-4085b9ebebf5` | UI error-state P2 修复复审 `APPROVED` |
| Integration QA Reviewer | `HanaAgent Integration QA` | `019f01f0-6243-7bb2-9392-5f794f28e680` | final Integration QA `APPROVED` |

## 调度规则

- 同时只允许 3 个主实施线程处于活跃执行。
- 优先顺序：`03-model-routing` -> `04-task-logs-archives` -> `02-native-personal-tasks` -> `05-fusion-review` -> `01-automation-toolbar-ui` -> `00-roadmap` final gate。
- 每个实施线程先完成自己的 plan，再交 Spec Compliance Reviewer，再交 Code Quality Reviewer。
- 所有实施计划合并后，最后交 Integration QA Reviewer。

## 继续方式

1. 先读 [personal-assistant-project-ledger.md](./personal-assistant-project-ledger.md)。
2. 再看这份手册和 [personal-assistant-progress.md](./personal-assistant-progress.md) 的历史线程台账。
3. 当前不要再放行主实施线程；由主线程做最终完成审计。
4. 线程如果再次 systemError，等彻底断开后发“继续”，再重新发明确“开始执行”的消息。

## 需要恢复的线程

- 当前无需要恢复的项目线程；若主线程发现新缺口，再按模块回派。

## 待办

- 主线程完成最终审计；若无新缺口，可关闭项目经理目标。
- 已完成的 Integration QA 检查包括：
  - `node scripts/hana-agent-quality-harness.mjs --stage all`
  - `npm run typecheck`
  - 01-05 对 PRD / plan 的关键行为闭环
  - Fusion 默认关闭、按需触发
  - run log 落盘和 Fusion prompt 脱敏
  - UI action / error state / session fallback
  - 文档入口和台账状态一致性
