# Personal Assistant Automation Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Coordination entry point: `docs/personal-assistant-execution.md`

**Goal:** 建立 HanaAgent 个人助手自动化项目的实施顺序、子智能体分工、质量门禁和统一 harness。

**Architecture:** 采用“原定时任务工具栏增强 + 后端 cron 扩展 + 模型路由 + Fusion 编排”的增量架构。所有功能围绕现有 `CronStore`、`AutomationPanel`、`hub/scheduler.ts` 和 activity session 体系扩展，避免新建平行系统。

**Tech Stack:** TypeScript, React 19, Hono routes, Vitest, Testing Library, Node.js 24, existing HanaAgent cron/activity/session infrastructure.

## Global Constraints

- 开发仓库固定为 `D:\hana agent\openhanako`。
- 优先修改原有定时任务工具栏，不新建独立任务中心。
- 自动化任务运行 session 必须和普通聊天 session 分开归档。
- 默认低成本模型为 DeepSeek 官方；GPT 中转用于日常复杂任务；Claude 中转只在高难任务或用户要求时使用。
- Fusion 默认关闭，仅由任务开关或用户明确要求触发。
- 不暴露 API key，不在日志中打印完整鉴权 header。
- 每个实施 plan 完成后必须跑聚焦测试和 `npm run typecheck`。

---

## 子智能体与对话编制

本项目按计划执行时创建 **9 个智能体对话**：6 个实施智能体 + 3 个复核智能体。

实施智能体：

1. `Roadmap Architect`
2. `Automation Toolbar UI Agent`
3. `Native Task Runner Agent`
4. `Model Routing Agent`
5. `Logs Archive Agent`
6. `Fusion Review Agent`

复核智能体：

7. `Spec Compliance Reviewer`
8. `Code Quality Reviewer`
9. `Integration QA Reviewer`

执行约定：

- 每个实施智能体只执行自己 plan 中的任务。
- 每个 plan 完成后先交给 `Spec Compliance Reviewer` 检查 PRD 覆盖。
- 再交给 `Code Quality Reviewer` 检查回归风险、测试质量、边界处理。
- 所有 plan 合并后由 `Integration QA Reviewer` 跑整体验证。

## 项目目录架构

计划实施后新增或扩展的目录：

```text
D:\hana agent\openhanako
├── desktop\src\react\components\automation
│   ├── AutomationCard.tsx
│   ├── AutomationPanel.module.css
│   ├── AutomationRunActions.tsx
│   ├── AutomationRunLogList.tsx
│   └── automation-types.ts
├── lib\desk
│   ├── automation-runs
│   │   ├── run-output-resolver.ts
│   │   └── run-summary.ts
│   ├── fusion
│   │   ├── fusion-runner.ts
│   │   ├── fusion-types.ts
│   │   └── fusion-prompts.ts
│   ├── model-routing
│   │   ├── model-routing-policy.ts
│   │   └── model-routing-store.ts
│   └── personal-tasks
│       ├── codex-automation-import.ts
│       ├── personal-task-definitions.ts
│       └── personal-task-seed.ts
├── scripts
│   └── hana-agent-quality-harness.mjs
└── tests
    ├── automation-run-actions.test.ts
    ├── fusion-runner.test.ts
    ├── model-routing-policy.test.ts
    └── personal-task-seed.test.ts
```

## 质量钩子与 Harness

统一质量命令：

```powershell
npm run typecheck
npm test -- tests/cron-store.test.ts tests/desk-route-cron.test.ts tests/scheduler-studio-cron.test.ts
npm test -- tests/personal-task-seed.test.ts tests/model-routing-policy.test.ts tests/fusion-runner.test.ts
npm test -- desktop/src/react/components/automation/__tests__/ScheduleEditor.test.tsx desktop/src/react/components/automation/__tests__/schedule-draft.test.ts
```

计划新增 harness：

- `scripts/hana-agent-quality-harness.mjs`：按阶段运行聚焦测试。
- `tests/fixtures/personal-tasks/codex-automation-sample.json`：Codex 自动化导入样例。
- `tests/fixtures/fusion/mock-fusion-runs.json`：Fusion reviewer / judge / finalizer 样例。

### Task 1: Create The Quality Harness Contract

**Assigned agent:** `Roadmap Architect`
**Required skills:** `superpowers:writing-plans`, `api-and-interface-design`, `test-driven-development`, `code-review-and-quality`

**Files:**

- Create: `scripts/hana-agent-quality-harness.mjs`
- Test: no standalone test; verified by running the script with `--list`

**Interfaces:**

- Produces CLI: `node scripts/hana-agent-quality-harness.mjs --stage <stage>`
- Valid stages: `ui`, `tasks`, `routing`, `logs`, `fusion`, `all`

- [ ] **Step 1: Create the harness file**

```js
#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const stages = {
  ui: [
    ["npm", ["test", "--", "desktop/src/react/components/automation/__tests__/ScheduleEditor.test.tsx", "desktop/src/react/components/automation/__tests__/schedule-draft.test.ts"]],
  ],
  tasks: [
    ["npm", ["test", "--", "tests/personal-task-seed.test.ts", "tests/desk-route-cron.test.ts"]],
  ],
  routing: [
    ["npm", ["test", "--", "tests/model-routing-policy.test.ts", "tests/scheduler-studio-cron.test.ts"]],
  ],
  logs: [
    ["npm", ["test", "--", "tests/automation-run-actions.test.ts", "tests/workflow-activity-store.test.ts"]],
  ],
  fusion: [
    ["npm", ["test", "--", "tests/fusion-runner.test.ts"]],
  ],
  all: [
    ["npm", ["run", "typecheck"]],
    ["npm", ["test", "--", "tests/cron-store.test.ts", "tests/desk-route-cron.test.ts", "tests/scheduler-studio-cron.test.ts"]],
    ["npm", ["test", "--", "tests/personal-task-seed.test.ts", "tests/model-routing-policy.test.ts", "tests/automation-run-actions.test.ts", "tests/fusion-runner.test.ts"]],
    ["npm", ["test", "--", "desktop/src/react/components/automation/__tests__/ScheduleEditor.test.tsx", "desktop/src/react/components/automation/__tests__/schedule-draft.test.ts"]],
  ],
};

const stageArgIndex = process.argv.indexOf("--stage");
const stage = stageArgIndex >= 0 ? process.argv[stageArgIndex + 1] : "all";

if (process.argv.includes("--list")) {
  console.log(Object.keys(stages).join("\n"));
  process.exit(0);
}

if (!stages[stage]) {
  console.error(`Unknown stage: ${stage}`);
  console.error(`Valid stages: ${Object.keys(stages).join(", ")}`);
  process.exit(2);
}

for (const [command, args] of stages[stage]) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
```

- [ ] **Step 2: Verify the stage list**

Run:

```powershell
node scripts/hana-agent-quality-harness.mjs --list
```

Expected:

```text
ui
tasks
routing
logs
fusion
all
```

- [ ] **Step 3: Commit**

```powershell
git add scripts/hana-agent-quality-harness.mjs
git commit -m "chore: add hana agent quality harness"
```

### Task 2: Execute Plans In Dependency Order

**Assigned agent:** `Roadmap Architect`
**Required skills:** `superpowers:subagent-driven-development`, `git-workflow-and-versioning`, `code-review-and-quality`

**Files:**

- Read: `docs/personal-assistant-prd.md`
- Read: `docs/plans/01-automation-toolbar-ui/plan.md`
- Read: `docs/plans/02-native-personal-tasks/plan.md`
- Read: `docs/plans/03-model-routing/plan.md`
- Read: `docs/plans/04-task-logs-archives/plan.md`
- Read: `docs/plans/05-fusion-review/plan.md`

**Interfaces:**

- Consumes all implementation plans.
- Produces reviewed implementation sequence.

- [ ] **Step 1: Run implementation in this order**

```text
1. 03-model-routing
2. 04-task-logs-archives
3. 02-native-personal-tasks
4. 05-fusion-review
5. 01-automation-toolbar-ui
```

Reason:

- 模型路由先于执行器集成。
- run log / archive 先于 UI 按钮。
- 个人任务依赖路由和 run log。
- Fusion 依赖路由和归档。
- UI 最后接入所有后端接口。

- [ ] **Step 2: After each plan, run its stage harness**

```powershell
node scripts/hana-agent-quality-harness.mjs --stage routing
node scripts/hana-agent-quality-harness.mjs --stage logs
node scripts/hana-agent-quality-harness.mjs --stage tasks
node scripts/hana-agent-quality-harness.mjs --stage fusion
node scripts/hana-agent-quality-harness.mjs --stage ui
```

Expected: each command exits with status `0`.

- [ ] **Step 3: Final integration gate**

```powershell
node scripts/hana-agent-quality-harness.mjs --stage all
npm run typecheck
```

Expected: both commands exit with status `0`.

- [ ] **Step 4: Review gate**

Send the diff to:

```text
Spec Compliance Reviewer
Code Quality Reviewer
Integration QA Reviewer
```

Each reviewer must produce one of:

```text
APPROVED
REQUEST_CHANGES: <specific file and reason>
```

### Task 3: Protect User Data During Implementation

**Assigned agent:** `Roadmap Architect`
**Required skills:** `security-and-hardening`, `observability-and-instrumentation`

**Files:**

- Modify: `scripts/hana-agent-quality-harness.mjs`
- Create: `tests/security-automation-log-redaction.test.ts`

**Interfaces:**

- Produces safety rule: logs may include provider/model ids but not API keys or authorization headers.

- [ ] **Step 1: Add a redaction test**

```ts
import { describe, expect, it } from "vitest";

function redactForAutomationLog(input: string) {
  return input
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-***")
    .replace(/Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/gi, "Authorization: Bearer ***");
}

describe("automation log redaction contract", () => {
  it("redacts api keys and bearer tokens", () => {
    const text = "Authorization: Bearer abc.def.ghi\nkey=sk-1234567890abcdef";
    expect(redactForAutomationLog(text)).toBe("Authorization: Bearer ***\nkey=sk-***");
  });
});
```

- [ ] **Step 2: Run the security contract**

```powershell
npm test -- tests/security-automation-log-redaction.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```powershell
git add tests/security-automation-log-redaction.test.ts
git commit -m "test: document automation log redaction contract"
```

## Completion Gate

Run:

```powershell
git status --short
node scripts/hana-agent-quality-harness.mjs --stage all
```

Expected:

- `git status --short` only shows intended project files before commit.
- Harness exits with status `0`.
- Reviewers return `APPROVED`.
