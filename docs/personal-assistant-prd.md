# HanaAgent Personal Assistant PRD

版本：0.1
日期：2026-06-25
仓库：`D:\hana agent\openhanako`

项目台账：`docs/personal-assistant-project-ledger.md`
历史进度页：`docs/personal-assistant-progress.md`

## 1. 产品定位

HanaAgent 作为个人助手使用，不按公开 SaaS 产品设计。V1 目标是在原有 HanaAgent 定时任务工具栏上增强自动化能力，让用户用更便宜的模型长期执行固定任务，并在重要任务上按需启用多模型复核。

本 PRD 不包含此前已要求移除的第四点需求。

## 2. 核心目标

1. 将原有定时任务工具栏升级为可执行、可查看、可追踪的自动化入口。
2. 把用户已有 Codex 自动化中的两个任务迁移为 HanaAgent 原生任务，运行时优先使用便宜模型。
3. 支持同一任务按场景自主选模型，同一会话或自动化流程可以使用多个不同模型。
4. 支持 Fusion / 复核机制，默认关闭，仅在重要任务或用户明确要求时开启。
5. 自动化任务进程和普通聊天会话分开归档，日志中保留模型选择、失败重试、输出路径和复核结论。

## 3. 用户场景

### 场景 A：日常低成本自动化

用户希望 HanaAgent 定期执行资料整理、缓存读取、GitHub 整理等任务。默认使用 DeepSeek 官方模型，减少成本；任务失败时先重试，再在成本限制内切换模型。

### 场景 B：重要任务复核

用户在任务卡片上开启 Fusion，或在对话中明确要求“开启复核 / 多模型复核”。系统使用多个模型独立复核，再由 judge 汇总，最后由 finalizer 输出最终结果。

### 场景 C：查看自动化结果

用户打开 HanaAgent 原定时任务工具栏，看到顶部任务卡片和底部最近运行日志。每个任务卡片支持“立即执行”“查看日志”“打开输出”“启用/停用”“模型策略”等操作。

## 4. V1 功能范围

### 4.1 定时任务工具栏增强

在现有 `AutomationPanel` 基础上优化，不新建独立任务中心。

必备能力：

- 顶部展示任务卡片。
- 底部展示最近运行日志。
- 每个任务卡片支持“立即执行”“查看日志”“打开输出”。
- 保留原有 schedule 编辑、启用/停用、删除能力。
- 显示任务类型、下次执行时间、上次结果、模型策略、Fusion 状态。
- 模型路由解释仅写入日志，不在主 UI 中制造噪音。

### 4.2 原生个人任务

V1 内置两个个人任务：

1. `GitHub整理`
2. `数字政府资料查找并整理`

任务来源：

- 以用户现有 Codex 自动化设置为权威来源。
- 沿用原有路径、计划、缓存读取方式、输出 Markdown 路径和失败处理约定。
- HanaAgent 内部创建原生 automation job，不在运行时简单调用 Codex。
- 如果首次启动无法找到 Codex 设置，创建禁用状态的任务模板，并在日志中提示需要导入设置。

### 4.3 模型路由

模型来源：

- DeepSeek 官方：低级任务、自动化任务、读取缓存、默认便宜执行。
- GPT 中转：日常使用、作图、一般复杂任务。
- Claude 中转：高难任务，仅在要求时或任务风险高时使用。

路由要求：

- 同一任务可按阶段选择不同模型。
- 同一会话允许多个模型参与。
- 自动化任务默认走 DeepSeek 官方。
- 失败策略为“先重试，再按成本限制切换模型”。
- 具体选择原因进入 run log。

### 4.4 Fusion / 复核

Fusion 默认关闭。

触发方式：

- 任务卡片上的一次性开关。
- 任务设置中的默认开关。
- 对话中明确要求开启复核。

执行机制：

- 多模型独立复核。
- judge 汇总差异和风险。
- finalizer 根据任务场景自动选择模型并输出最终版本。
- Fusion 不是“三个模型聊天”，模型之间不互相污染上下文。

### 4.5 日志、输出和归档

必备能力：

- 每次自动化运行生成独立 run id。
- run log 记录开始时间、结束时间、状态、模型路由、重试、Fusion、输出路径、session 文件。
- 自动化运行 session 存在独立 activity/automation 归档中，不混入普通聊天会话列表。
- “打开输出”优先打开该 run 的 Markdown 输出；没有输出文件时打开 session 文件或日志。

## 5. 权限与安全

允许读写：

- `D:\obsidian`
- `D:\hana agent`
- `D:\AI-Agent`
- `C:\Users\23697\Documents\Codex`

允许读取：

- Downloads
- Desktop

限制：

- 不删除大目录。
- 不修改系统目录。
- 不暴露 API key。
- 不在未确认时运行高风险命令。
- 任务日志不得打印完整密钥或鉴权 header。

## 6. 项目架构目标

沿用现有链路：

- 前端入口：`desktop/src/react/components/AutomationPanel.tsx`
- 任务卡片：`desktop/src/react/components/automation/AutomationCard.tsx`
- Cron API：`server/routes/desk.ts`
- Cron 存储：`lib/desk/cron-store.ts`
- 执行器：`lib/desk/automation-executors.ts`
- 调度器：`hub/scheduler.ts`
- Activity 归档：`lib/workflow-activity-store.ts` 和 `lib/activity-hub.ts`

新增模块建议：

- `lib/desk/personal-tasks/`：个人任务模板、Codex 设置导入、输出路径解析。
- `lib/desk/model-routing/`：模型策略、成本限制、失败回退。
- `lib/desk/fusion/`：reviewer / judge / finalizer 编排。
- `lib/desk/automation-runs/`：run log 扩展、输出文件定位、归档索引。
- `scripts/hana-agent-quality-harness.mjs`：聚焦质量门禁。

## 7. 成功标准

1. 打开定时任务工具栏可直接看到两个个人任务或禁用模板。
2. `GitHub整理` 和 `数字政府资料查找并整理` 可立即执行，并沿用 Codex 自动化输出路径。
3. 自动化 run log 能看见模型选择原因、失败重试、输出路径和 session 文件。
4. Fusion 关闭时不产生额外模型调用；开启时产生 reviewer、judge、finalizer 记录。
5. 后端聚焦测试、前端组件测试、typecheck 通过。
6. 任务归档不污染普通聊天会话列表。

## 8. V1 不做

- 不重做整套 HanaAgent 导航。
- 不构建公共多租户任务市场。
- 不实现复杂费用账单，只记录本次 run 使用了哪个模型策略和是否触发回退。
- 不把 Fusion 设计成模型群聊。
- 不自动清理用户目录中的历史数据。
