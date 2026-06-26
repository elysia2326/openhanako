# Automation Model Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为自动化任务提供稳定的模型路由策略，使低成本任务默认使用 DeepSeek 官方，日常复杂任务可走 GPT 中转，高难任务或明确要求时才走 Claude 中转，并支持失败后“先重试，再成本受限切换模型”。

**Architecture:** 新增 `lib/desk/model-routing` 模块，独立解析 job、phase、Fusion 状态、失败次数和可用模型，输出 `AutomationModelDecision`。`hub/scheduler.ts` 只消费路由结果，不写模型选择规则；日志和 UI 使用同一 decision 对象。

**Tech Stack:** TypeScript, existing `shared/model-ref.ts`, existing `engine.availableModels`, Vitest, scheduler integration tests.

## Global Constraints

- 自动化默认策略为 `automation_cheap`，优先 DeepSeek 官方。
- `daily` 策略优先 GPT 中转。
- `hard` 策略优先 Claude 中转，但只有 job 显式要求或 Fusion finalizer 判断为高难时使用。
- 不根据裸 model id 猜 provider；如果用户显式设置 job.model，优先保留该复合模型引用。
- 路由原因写入 run log，不在任务卡片主行展示。
- 失败策略固定为：同模型重试一次；继续失败时按策略 fallback；超过策略上限后停止。

---

## Assigned Agents

主实施智能体：`Model Routing Agent`

复核智能体：

- `Spec Compliance Reviewer`
- `Code Quality Reviewer`

要求使用的 skills：

- `api-and-interface-design`
- `test-driven-development`
- `superpowers:test-driven-development`
- `superpowers:verification-before-completion`
- `observability-and-instrumentation`

建议模型：

- 实施：DeepSeek 官方。
- 复核：GPT 中转。

## File Structure

```text
lib/desk/model-routing
├── model-routing-policy.ts
└── model-routing-store.ts

hub/scheduler.ts
tests/model-routing-policy.test.ts
tests/scheduler-studio-cron.test.ts
```

## Interfaces

```ts
export type AutomationModelPolicyKey =
  | "automation_cheap"
  | "daily"
  | "hard"
  | "fusion_reviewer"
  | "fusion_judge"
  | "fusion_finalizer";

export interface AutomationModelDecision {
  model: { id: string; provider: string } | string | null;
  policyKey: AutomationModelPolicyKey;
  reason: string;
  phase: "primary" | "retry" | "fallback" | "fusion_reviewer" | "fusion_judge" | "fusion_finalizer";
  fallbackFrom?: { id: string; provider?: string } | string | null;
}

export interface ResolveAutomationModelInput {
  job: any;
  executor?: any;
  availableModels?: Array<{ id: string; provider: string; name?: string }>;
  phase?: AutomationModelDecision["phase"];
  previousErrorCount?: number;
  explicitPolicyKey?: AutomationModelPolicyKey;
}
```

### Task 1: Implement Pure Routing Policy

**Files:**

- Create: `lib/desk/model-routing/model-routing-policy.ts`
- Test: `tests/model-routing-policy.test.ts`

**Interfaces:**

- Produces `resolveAutomationModel(input: ResolveAutomationModelInput): AutomationModelDecision`.
- Produces `normalizeAutomationModelPolicyKey(value: unknown): AutomationModelPolicyKey`.

- [ ] **Step 1: Write failing policy tests**

```ts
import { describe, expect, it } from "vitest";
import { resolveAutomationModel } from "../lib/desk/model-routing/model-routing-policy.ts";

const models = [
  { id: "deepseek-chat", provider: "deepseek", name: "DeepSeek Chat" },
  { id: "gpt-4.1", provider: "openai-relay", name: "GPT relay" },
  { id: "claude-sonnet-4", provider: "anthropic-relay", name: "Claude relay" },
];

describe("resolveAutomationModel", () => {
  it("uses explicit job model before policy routing", () => {
    const decision = resolveAutomationModel({
      job: { model: { id: "gpt-4.1", provider: "openai-relay" }, modelPolicyKey: "automation_cheap" },
      availableModels: models,
    });

    expect(decision.model).toEqual({ id: "gpt-4.1", provider: "openai-relay" });
    expect(decision.reason).toContain("explicit job model");
  });

  it("routes automation_cheap to official DeepSeek when available", () => {
    const decision = resolveAutomationModel({
      job: { modelPolicyKey: "automation_cheap" },
      availableModels: models,
    });

    expect(decision.model).toEqual({ id: "deepseek-chat", provider: "deepseek" });
    expect(decision.policyKey).toBe("automation_cheap");
  });

  it("routes hard policy to Claude relay", () => {
    const decision = resolveAutomationModel({
      job: { modelPolicyKey: "hard" },
      availableModels: models,
    });

    expect(decision.model).toEqual({ id: "claude-sonnet-4", provider: "anthropic-relay" });
    expect(decision.reason).toContain("hard task");
  });

  it("falls back from cheap to GPT after repeated failure", () => {
    const decision = resolveAutomationModel({
      job: { modelPolicyKey: "automation_cheap", model: { id: "deepseek-chat", provider: "deepseek" } },
      availableModels: models,
      phase: "fallback",
      previousErrorCount: 2,
    });

    expect(decision.model).toEqual({ id: "gpt-4.1", provider: "openai-relay" });
    expect(decision.fallbackFrom).toEqual({ id: "deepseek-chat", provider: "deepseek" });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
npm test -- tests/model-routing-policy.test.ts
```

Expected: FAIL because `model-routing-policy.ts` does not exist.

- [ ] **Step 3: Implement routing policy**

```ts
import { parseModelRef } from "../../../shared/model-ref.ts";

export type AutomationModelPolicyKey =
  | "automation_cheap"
  | "daily"
  | "hard"
  | "fusion_reviewer"
  | "fusion_judge"
  | "fusion_finalizer";

export interface AutomationModelDecision {
  model: { id: string; provider: string } | string | null;
  policyKey: AutomationModelPolicyKey;
  reason: string;
  phase: "primary" | "retry" | "fallback" | "fusion_reviewer" | "fusion_judge" | "fusion_finalizer";
  fallbackFrom?: { id: string; provider?: string } | string | null;
}

export interface ResolveAutomationModelInput {
  job: any;
  executor?: any;
  availableModels?: Array<{ id: string; provider: string; name?: string }>;
  phase?: AutomationModelDecision["phase"];
  previousErrorCount?: number;
  explicitPolicyKey?: AutomationModelPolicyKey;
}

export function normalizeAutomationModelPolicyKey(value: unknown): AutomationModelPolicyKey {
  if (value === "daily" || value === "hard" || value === "fusion_reviewer" || value === "fusion_judge" || value === "fusion_finalizer") {
    return value;
  }
  return "automation_cheap";
}

function providerText(model: { provider?: string; id?: string; name?: string }) {
  return `${model.provider || ""} ${model.id || ""} ${model.name || ""}`.toLowerCase();
}

function findByProvider(models: Array<{ id: string; provider: string; name?: string }>, keywords: string[]) {
  return models.find((model) => keywords.some((keyword) => providerText(model).includes(keyword))) || null;
}

function refFromUnknown(value: unknown) {
  const parsed = parseModelRef(value);
  if (!parsed?.id) return null;
  return parsed.provider ? { id: parsed.id, provider: parsed.provider } : parsed.id;
}

function chooseForPolicy(policyKey: AutomationModelPolicyKey, models: Array<{ id: string; provider: string; name?: string }>) {
  if (policyKey === "hard" || policyKey === "fusion_finalizer") {
    return findByProvider(models, ["claude", "anthropic"]) || findByProvider(models, ["gpt", "openai"]) || findByProvider(models, ["deepseek"]);
  }
  if (policyKey === "daily" || policyKey === "fusion_judge") {
    return findByProvider(models, ["gpt", "openai"]) || findByProvider(models, ["deepseek"]) || findByProvider(models, ["claude", "anthropic"]);
  }
  return findByProvider(models, ["deepseek"]) || findByProvider(models, ["gpt", "openai"]) || findByProvider(models, ["claude", "anthropic"]);
}

export function resolveAutomationModel({
  job,
  executor,
  availableModels = [],
  phase = "primary",
  previousErrorCount = 0,
  explicitPolicyKey,
}: ResolveAutomationModelInput): AutomationModelDecision {
  const policyKey = explicitPolicyKey || normalizeAutomationModelPolicyKey(job?.modelPolicyKey);
  const explicitModel = refFromUnknown(executor?.model ?? job?.model);
  if (explicitModel && phase !== "fallback") {
    return {
      model: explicitModel,
      policyKey,
      phase,
      reason: "explicit job model selected",
    };
  }

  let effectivePolicy = policyKey;
  let fallbackFrom: AutomationModelDecision["fallbackFrom"] = null;
  if (phase === "fallback" && previousErrorCount >= 2) {
    fallbackFrom = explicitModel || refFromUnknown(job?.model) || null;
    effectivePolicy = policyKey === "hard" ? "hard" : "daily";
  }

  const selected = chooseForPolicy(effectivePolicy, availableModels);
  const model = selected ? { id: selected.id, provider: selected.provider } : explicitModel || null;
  const reason =
    effectivePolicy === "hard"
      ? "hard task policy selected Claude-capable model"
      : effectivePolicy === "daily"
        ? "daily/fallback policy selected GPT-capable model"
        : "automation cheap policy selected DeepSeek-capable model";

  return {
    model,
    policyKey,
    phase,
    reason,
    ...(fallbackFrom ? { fallbackFrom } : {}),
  };
}
```

- [ ] **Step 4: Run the policy test and verify GREEN**

```powershell
npm test -- tests/model-routing-policy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/desk/model-routing/model-routing-policy.ts tests/model-routing-policy.test.ts
git commit -m "feat: add automation model routing policy"
```

### Task 2: Add Routing Store For Run-Level Decisions

**Files:**

- Create: `lib/desk/model-routing/model-routing-store.ts`
- Modify: `tests/model-routing-policy.test.ts`

**Interfaces:**

```ts
export class AutomationModelRoutingStore {
  record(jobId: string, decision: AutomationModelDecision): void;
  latest(jobId: string): AutomationModelDecision | null;
  clear(jobId: string): void;
}
```

Purpose:

- Scheduler can record the decision before execution.
- Run log code can read the latest decision and persist it.
- Store is in-memory only; persisted run log remains source of history.

- [ ] **Step 1: Write failing store test**

```ts
import { AutomationModelRoutingStore } from "../lib/desk/model-routing/model-routing-store.ts";

describe("AutomationModelRoutingStore", () => {
  it("records and clears latest decisions by job id", () => {
    const store = new AutomationModelRoutingStore();
    store.record("job_1", {
      model: { id: "deepseek-chat", provider: "deepseek" },
      policyKey: "automation_cheap",
      phase: "primary",
      reason: "automation cheap policy selected DeepSeek-capable model",
    });

    expect(store.latest("job_1")?.model).toEqual({ id: "deepseek-chat", provider: "deepseek" });
    store.clear("job_1");
    expect(store.latest("job_1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
npm test -- tests/model-routing-policy.test.ts
```

Expected: FAIL because `model-routing-store.ts` does not exist.

- [ ] **Step 3: Implement store**

```ts
import type { AutomationModelDecision } from "./model-routing-policy.ts";

export class AutomationModelRoutingStore {
  private readonly decisions = new Map<string, AutomationModelDecision>();

  record(jobId: string, decision: AutomationModelDecision) {
    if (!jobId) return;
    this.decisions.set(jobId, JSON.parse(JSON.stringify(decision)));
  }

  latest(jobId: string): AutomationModelDecision | null {
    const decision = this.decisions.get(jobId);
    return decision ? JSON.parse(JSON.stringify(decision)) : null;
  }

  clear(jobId: string) {
    this.decisions.delete(jobId);
  }
}
```

- [ ] **Step 4: Run tests and verify GREEN**

```powershell
npm test -- tests/model-routing-policy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/desk/model-routing/model-routing-store.ts tests/model-routing-policy.test.ts
git commit -m "feat: track automation model routing decisions"
```

### Task 3: Integrate Routing Into Scheduler

**Files:**

- Modify: `hub/scheduler.ts`
- Modify: `tests/scheduler-studio-cron.test.ts`

**Interfaces:**

- Scheduler calls `resolveAutomationModel` before `_executeActivityForAgent`.
- Scheduler passes `model: decision.model || undefined`.
- Scheduler passes `modelDecision: decision` into `_executeActivityForAgent` options for logging.

- [ ] **Step 1: Add failing scheduler test**

Add to `tests/scheduler-studio-cron.test.ts`:

```ts
  it("routes automation jobs through the model policy when no explicit model is set", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-scheduler-cron-"));
    try {
      const agentsDir = path.join(root, "agents");
      fs.mkdirSync(path.join(agentsDir, "agent-a"), { recursive: true });
      const activityStore = { add: vi.fn() };
      const executeIsolated = vi.fn(async () => ({ sessionPath: "", error: null }));
      const engine = {
        agentsDir,
        agents: new Map(),
        availableModels: [
          { id: "deepseek-chat", provider: "deepseek" },
          { id: "gpt-4.1", provider: "openai-relay" },
        ],
        getStudioCronStore: () => ({ listJobs: vi.fn(() => []) }),
        getHeartbeatMaster: () => false,
        ensureAgentRuntime: vi.fn(async (agentId) => ({ id: agentId, agentName: agentId })),
        getAgent: vi.fn((agentId) => ({ id: agentId, agentName: agentId })),
        executeIsolated,
        summarizeActivity: vi.fn(),
        getActivityStore: vi.fn(() => activityStore),
        emitDevLog: vi.fn(),
      };
      const scheduler = new Scheduler({ hub: { engine, eventBus: { emit: vi.fn() } } });
      scheduler.start();
      const executeJob = createCronSchedulerMock.mock.calls[0][0].executeJob;

      await executeJob({
        id: "studio_job_policy",
        label: "Policy job",
        prompt: "run cheap",
        actorAgentId: "agent-a",
        modelPolicyKey: "automation_cheap",
        executionContext: {
          kind: "session_workspace",
          cwd: "/workspace/a",
          workspaceFolders: [],
          sourceSessionPath: "/sessions/a.jsonl",
          createdByAgentId: "agent-a",
        },
      });

      expect(executeIsolated).toHaveBeenCalledWith(
        expect.stringContaining("run cheap"),
        expect.objectContaining({
          model: { id: "deepseek-chat", provider: "deepseek" },
          modelDecision: expect.objectContaining({ policyKey: "automation_cheap" }),
        }),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run scheduler test and verify RED**

```powershell
npm test -- tests/scheduler-studio-cron.test.ts
```

Expected: FAIL because scheduler uses `executor.model || job.model`.

- [ ] **Step 3: Update `hub/scheduler.ts` imports**

```ts
import { resolveAutomationModel } from "../lib/desk/model-routing/model-routing-policy.ts";
```

- [ ] **Step 4: Replace model selection in `_executeCronJobForAgent`**

Replace:

```ts
      const model = executor.model || job.model || undefined;
```

With:

```ts
      const modelDecision = resolveAutomationModel({
        job,
        executor,
        availableModels: this._engine.availableModels || [],
        phase: "primary",
        previousErrorCount: Number(job.consecutiveErrors || 0),
      });
      const model = modelDecision.model || undefined;
```

Pass into `_executeActivityForAgent`:

```ts
        modelDecision,
```

- [ ] **Step 5: Allow `_executeActivityForAgent` to forward metadata**

Inside `_executeActivityForAgent`, include `modelDecision` in the activity entry:

```ts
      modelDecision: opts.modelDecision || null,
```

The call to `engine.executeIsolated` already spreads `restOpts`; keeping `modelDecision` there is acceptable only if session options tolerate extra fields. If tests or typecheck show that extra fields are rejected, destructure it before the call:

```ts
    const { signal, modelDecision, ...restOpts } = opts;
```

and keep it only in activity/run log entries.

- [ ] **Step 6: Run scheduler tests and verify GREEN**

```powershell
npm test -- tests/model-routing-policy.test.ts tests/scheduler-studio-cron.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add hub/scheduler.ts tests/scheduler-studio-cron.test.ts
git commit -m "feat: route automation models in scheduler"
```

### Task 4: Add Failure Fallback Decision Hook

**Files:**

- Modify: `hub/scheduler.ts`
- Modify: `tests/scheduler-studio-cron.test.ts`

**Interfaces:**

- On first execution failure, scheduler retries once with the same model.
- On second failure, scheduler computes `phase: "fallback"` and executes with fallback model.
- Maximum attempts for one scheduled run: 3.

- [ ] **Step 1: Add failing fallback test**

```ts
  it("retries once and then falls back to GPT for cheap automation failures", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-scheduler-cron-"));
    try {
      const agentsDir = path.join(root, "agents");
      fs.mkdirSync(path.join(agentsDir, "agent-a"), { recursive: true });
      const activityStore = { add: vi.fn() };
      const executeIsolated = vi
        .fn()
        .mockResolvedValueOnce({ sessionPath: "", error: "first failure" })
        .mockResolvedValueOnce({ sessionPath: "", error: "second failure" })
        .mockResolvedValueOnce({ sessionPath: "", error: null });
      const engine = {
        agentsDir,
        agents: new Map(),
        availableModels: [
          { id: "deepseek-chat", provider: "deepseek" },
          { id: "gpt-4.1", provider: "openai-relay" },
        ],
        getStudioCronStore: () => ({ listJobs: vi.fn(() => []) }),
        getHeartbeatMaster: () => false,
        ensureAgentRuntime: vi.fn(async (agentId) => ({ id: agentId, agentName: agentId })),
        getAgent: vi.fn((agentId) => ({ id: agentId, agentName: agentId })),
        executeIsolated,
        summarizeActivity: vi.fn(),
        getActivityStore: vi.fn(() => activityStore),
        emitDevLog: vi.fn(),
      };
      const scheduler = new Scheduler({ hub: { engine, eventBus: { emit: vi.fn() } } });
      scheduler.start();
      const executeJob = createCronSchedulerMock.mock.calls[0][0].executeJob;

      await executeJob({
        id: "studio_job_fallback",
        label: "Fallback job",
        prompt: "run cheap",
        actorAgentId: "agent-a",
        modelPolicyKey: "automation_cheap",
        executionContext: {
          kind: "session_workspace",
          cwd: "/workspace/a",
          workspaceFolders: [],
          sourceSessionPath: "/sessions/a.jsonl",
          createdByAgentId: "agent-a",
        },
      });

      expect(executeIsolated.mock.calls[0][1].model).toEqual({ id: "deepseek-chat", provider: "deepseek" });
      expect(executeIsolated.mock.calls[1][1].model).toEqual({ id: "deepseek-chat", provider: "deepseek" });
      expect(executeIsolated.mock.calls[2][1].model).toEqual({ id: "gpt-4.1", provider: "openai-relay" });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run test and verify RED**

```powershell
npm test -- tests/scheduler-studio-cron.test.ts
```

Expected: FAIL because scheduler does not retry and fallback inside a single run.

- [ ] **Step 3: Extract single execution helper**

Inside `Scheduler`, add:

```ts
  async _executeCronJobAttempt(agentId, job, executor, prompt, phase, signal) {
    const modelDecision = resolveAutomationModel({
      job,
      executor,
      availableModels: this._engine.availableModels || [],
      phase,
      previousErrorCount: Number(job.consecutiveErrors || 0) + (phase === "fallback" ? 2 : 0),
    });
    await this._executeActivityForAgent(agentId, prompt, "cron", job.label, {
      model: modelDecision.model || undefined,
      modelDecision,
      signal,
      ...this._cronExecutionOptions(job, executor),
    });
  }
```

- [ ] **Step 4: Replace direct execution with attempts**

In `_executeCronJobForAgent`, after building `prompt`, replace the single `_executeActivityForAgent` call with:

```ts
      let lastError: unknown = null;
      for (const phase of ["primary", "retry", "fallback"] as const) {
        try {
          await this._executeCronJobAttempt(agentId, job, executor, prompt, phase, ac.signal);
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          if (phase === "fallback") throw err;
        }
      }
      if (lastError) throw lastError;
```

- [ ] **Step 5: Run routing tests**

```powershell
npm test -- tests/model-routing-policy.test.ts tests/scheduler-studio-cron.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add hub/scheduler.ts tests/scheduler-studio-cron.test.ts
git commit -m "feat: retry and fallback automation models"
```

## Quality Gate

Run:

```powershell
node scripts/hana-agent-quality-harness.mjs --stage routing
npm run typecheck
```

Expected:

- Explicit job model is preserved.
- `automation_cheap` selects DeepSeek when available.
- `daily` selects GPT relay when available.
- `hard` selects Claude relay when available.
- Fallback moves from DeepSeek to GPT only after retry.
- Reviewers confirm no API keys or provider credentials are logged.
