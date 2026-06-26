# Fusion Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 HanaAgent 的 Fusion / 复核机制：默认关闭，只在任务卡片或用户明确要求时开启，采用多模型独立复核、judge 汇总、finalizer 输出最终结果的结构。

**Architecture:** 新增 `lib/desk/fusion` 作为纯编排层。Scheduler 在主任务完成后，根据 `job.fusion.enabled` 或 `fusionOnce` 决定是否调用 Fusion；Fusion 为 reviewer、judge、finalizer 分别创建隔离执行，不让模型彼此聊天。最终结果写回 run log 的 `fusion` 字段，并可追加写入输出 Markdown。

**Tech Stack:** TypeScript, existing `engine.executeIsolated`, existing scheduler, `resolveAutomationModel`, Vitest.

## Global Constraints

- Fusion 默认关闭。
- Fusion 不是三模型聊天；reviewer 之间不共享中间输出。
- 触发方式只有任务设置、任务卡片本次开关、对话中明确要求。
- finalizer 模型自动按任务选择；一般自动化优先 GPT，中高难或明确要求时使用 Claude。
- Fusion 失败不得抹掉主任务输出；run log 中记录 Fusion 失败原因。
- Fusion 产生的 session 归档在 automation activity 下，不进入普通聊天 session 列表。

---

## Assigned Agents

主实施智能体：`Fusion Review Agent`

复核智能体：

- `Spec Compliance Reviewer`
- `Code Quality Reviewer`

要求使用的 skills：

- `api-and-interface-design`
- `test-driven-development`
- `superpowers:test-driven-development`
- `superpowers:verification-before-completion`
- `observability-and-instrumentation`
- `security-and-hardening`

建议模型：

- 实施：GPT 中转。
- 复核：Claude 中转。

## File Structure

```text
lib/desk/fusion
├── fusion-prompts.ts
├── fusion-runner.ts
└── fusion-types.ts

hub/scheduler.ts
lib/desk/cron-store.ts
server/routes/desk.ts
tests/fusion-runner.test.ts
tests/scheduler-studio-cron.test.ts
tests/desk-route-cron.test.ts
```

## Data Contracts

### `AutomationFusionConfig`

```ts
export interface AutomationFusionConfig {
  enabled?: boolean;
  enabledOnce?: boolean;
  importance?: "normal" | "important" | "critical";
  reviewerPolicies?: Array<"automation_cheap" | "daily" | "hard">;
  judgePolicy?: "fusion_judge";
  finalizerPolicy?: "fusion_finalizer";
}
```

### `FusionRunResult`

```ts
export interface FusionRunResult {
  enabled: true;
  status: "done" | "error";
  reviewers: Array<{
    id: string;
    policyKey: string;
    model: unknown;
    sessionPath: string | null;
    summary: string | null;
    error: string | null;
  }>;
  judge: {
    model: unknown;
    sessionPath: string | null;
    summary: string | null;
    error: string | null;
  };
  finalizer: {
    model: unknown;
    sessionPath: string | null;
    summary: string | null;
    error: string | null;
  };
  judgeSummary: string | null;
  finalOutputPath?: string | null;
}
```

### Task 1: Add Fusion Types And Prompt Builders

**Files:**

- Create: `lib/desk/fusion/fusion-types.ts`
- Create: `lib/desk/fusion/fusion-prompts.ts`
- Create: `tests/fusion-runner.test.ts`

**Interfaces:**

- Produces `shouldRunFusion(job: any): boolean`.
- Produces prompt builders:

```ts
buildFusionReviewerPrompt(input: FusionPromptInput): string
buildFusionJudgePrompt(input: FusionJudgePromptInput): string
buildFusionFinalizerPrompt(input: FusionFinalizerPromptInput): string
```

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { buildFusionReviewerPrompt, buildFusionJudgePrompt, buildFusionFinalizerPrompt } from "../lib/desk/fusion/fusion-prompts.ts";
import { shouldRunFusion } from "../lib/desk/fusion/fusion-types.ts";

describe("fusion contracts", () => {
  it("runs fusion only when enabled or enabled once", () => {
    expect(shouldRunFusion({})).toBe(false);
    expect(shouldRunFusion({ fusion: { enabled: false } })).toBe(false);
    expect(shouldRunFusion({ fusion: { enabled: true } })).toBe(true);
    expect(shouldRunFusion({ fusion: { enabledOnce: true } })).toBe(true);
  });

  it("builds independent reviewer, judge, and finalizer prompts", () => {
    const reviewer = buildFusionReviewerPrompt({
      taskLabel: "GitHub整理",
      originalPrompt: "整理 GitHub",
      primarySummary: "输出完成",
      outputPath: "D:\\obsidian\\github.md",
    });
    const judge = buildFusionJudgePrompt({
      taskLabel: "GitHub整理",
      reviewerSummaries: ["A: 通过", "B: 发现遗漏"],
    });
    const finalizer = buildFusionFinalizerPrompt({
      taskLabel: "GitHub整理",
      primarySummary: "输出完成",
      judgeSummary: "补充 release 风险",
      outputPath: "D:\\obsidian\\github.md",
    });

    expect(reviewer).toContain("独立复核");
    expect(reviewer).not.toContain("与其他 reviewer 讨论");
    expect(judge).toContain("汇总差异");
    expect(finalizer).toContain("最终修订");
  });
});
```

- [ ] **Step 2: Run test and verify RED**

```powershell
npm test -- tests/fusion-runner.test.ts
```

Expected: FAIL because Fusion modules do not exist.

- [ ] **Step 3: Implement types**

```ts
export interface AutomationFusionConfig {
  enabled?: boolean;
  enabledOnce?: boolean;
  importance?: "normal" | "important" | "critical";
  reviewerPolicies?: Array<"automation_cheap" | "daily" | "hard">;
  judgePolicy?: "fusion_judge";
  finalizerPolicy?: "fusion_finalizer";
}

export interface FusionRunResult {
  enabled: true;
  status: "done" | "error";
  reviewers: Array<{
    id: string;
    policyKey: string;
    model: unknown;
    sessionPath: string | null;
    summary: string | null;
    error: string | null;
  }>;
  judge: {
    model: unknown;
    sessionPath: string | null;
    summary: string | null;
    error: string | null;
  };
  finalizer: {
    model: unknown;
    sessionPath: string | null;
    summary: string | null;
    error: string | null;
  };
  judgeSummary: string | null;
  finalOutputPath?: string | null;
}

export function shouldRunFusion(job: any): boolean {
  return job?.fusion?.enabled === true || job?.fusion?.enabledOnce === true;
}
```

- [ ] **Step 4: Implement prompt builders**

```ts
export interface FusionPromptInput {
  taskLabel: string;
  originalPrompt: string;
  primarySummary: string;
  outputPath?: string | null;
}

export interface FusionJudgePromptInput {
  taskLabel: string;
  reviewerSummaries: string[];
}

export interface FusionFinalizerPromptInput {
  taskLabel: string;
  primarySummary: string;
  judgeSummary: string;
  outputPath?: string | null;
}

export function buildFusionReviewerPrompt(input: FusionPromptInput) {
  return [
    `任务：${input.taskLabel}`,
    "",
    "请进行独立复核。不要与其他 reviewer 讨论，不要假设其他模型的结论。",
    "检查事实遗漏、结构问题、输出文件是否满足任务目标，并给出可执行修改建议。",
    "",
    `原始任务：${input.originalPrompt}`,
    `主任务摘要：${input.primarySummary}`,
    input.outputPath ? `输出文件：${input.outputPath}` : "",
  ].filter(Boolean).join("\n");
}

export function buildFusionJudgePrompt(input: FusionJudgePromptInput) {
  return [
    `任务：${input.taskLabel}`,
    "",
    "请作为 judge 汇总差异、冲突和风险，判断哪些建议必须采纳、哪些建议可以忽略。",
    "",
    ...input.reviewerSummaries.map((summary, index) => `Reviewer ${index + 1}:\n${summary}`),
  ].join("\n\n");
}

export function buildFusionFinalizerPrompt(input: FusionFinalizerPromptInput) {
  return [
    `任务：${input.taskLabel}`,
    "",
    "请根据 judge 结论进行最终修订。保留主任务已完成的有效内容，只修正明确问题。",
    input.outputPath ? `如需要修改文件，请更新此输出文件：${input.outputPath}` : "如无输出文件，只给出最终修订摘要。",
    "",
    `主任务摘要：${input.primarySummary}`,
    `Judge 结论：${input.judgeSummary}`,
  ].join("\n");
}
```

- [ ] **Step 5: Run tests and verify GREEN**

```powershell
npm test -- tests/fusion-runner.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add lib/desk/fusion/fusion-types.ts lib/desk/fusion/fusion-prompts.ts tests/fusion-runner.test.ts
git commit -m "feat: define fusion review contracts"
```

### Task 2: Implement Fusion Runner With Isolated Model Calls

**Files:**

- Create: `lib/desk/fusion/fusion-runner.ts`
- Modify: `tests/fusion-runner.test.ts`

**Interfaces:**

```ts
export interface RunFusionReviewInput {
  engine: any;
  agentId: string;
  job: any;
  primaryResult: {
    summary?: string | null;
    outputPath?: string | null;
    sessionPath?: string | null;
  };
  originalPrompt: string;
  signal?: AbortSignal;
}

export async function runFusionReview(input: RunFusionReviewInput): Promise<FusionRunResult>;
```

- [ ] **Step 1: Write failing runner test**

```ts
import { runFusionReview } from "../lib/desk/fusion/fusion-runner.ts";

describe("runFusionReview", () => {
  it("runs reviewers independently, then judge, then finalizer", async () => {
    const calls: Array<{ prompt: string; model: unknown }> = [];
    const engine = {
      availableModels: [
        { id: "deepseek-chat", provider: "deepseek" },
        { id: "gpt-4.1", provider: "openai-relay" },
        { id: "claude-sonnet-4", provider: "anthropic-relay" },
      ],
      executeIsolated: async (prompt: string, opts: any) => {
        calls.push({ prompt, model: opts.model });
        return { sessionPath: `D:\\hana\\activity\\automation\\fusion_${calls.length}.jsonl`, error: null };
      },
      summarizeActivity: async (sessionPath: string) => `summary:${sessionPath}`,
    };

    const result = await runFusionReview({
      engine,
      agentId: "agent-a",
      job: { id: "job_1", label: "GitHub整理", modelPolicyKey: "automation_cheap", fusion: { enabledOnce: true } },
      originalPrompt: "整理 GitHub",
      primaryResult: { summary: "主任务完成", outputPath: "D:\\obsidian\\github.md" },
    });

    expect(calls).toHaveLength(5);
    expect(calls[0].prompt).toContain("独立复核");
    expect(calls[1].prompt).toContain("独立复核");
    expect(calls[2].prompt).toContain("独立复核");
    expect(calls[3].prompt).toContain("汇总差异");
    expect(calls[4].prompt).toContain("最终修订");
    expect(result.status).toBe("done");
    expect(result.reviewers).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test and verify RED**

```powershell
npm test -- tests/fusion-runner.test.ts
```

Expected: FAIL because `fusion-runner.ts` does not exist.

- [ ] **Step 3: Implement runner**

```ts
import { resolveAutomationModel, type AutomationModelPolicyKey } from "../model-routing/model-routing-policy.ts";
import { buildFusionFinalizerPrompt, buildFusionJudgePrompt, buildFusionReviewerPrompt } from "./fusion-prompts.ts";
import type { FusionRunResult } from "./fusion-types.ts";

export interface RunFusionReviewInput {
  engine: any;
  agentId: string;
  job: any;
  primaryResult: {
    summary?: string | null;
    outputPath?: string | null;
    sessionPath?: string | null;
  };
  originalPrompt: string;
  signal?: AbortSignal;
}

async function summarize(engine: any, sessionPath: string | null, agentId: string) {
  if (!sessionPath || typeof engine.summarizeActivity !== "function") return null;
  try {
    return await engine.summarizeActivity(sessionPath, undefined, { agentId });
  } catch {
    return null;
  }
}

async function runIsolated(engine: any, agentId: string, prompt: string, model: unknown, signal?: AbortSignal) {
  const result = await engine.executeIsolated(prompt, {
    agentId,
    persist: undefined,
    activityType: "cron_fusion",
    model,
    signal,
    allowHumanApproval: false,
  });
  return {
    sessionPath: typeof result?.sessionPath === "string" ? result.sessionPath : null,
    error: result?.error || null,
  };
}

export async function runFusionReview({
  engine,
  agentId,
  job,
  primaryResult,
  originalPrompt,
  signal,
}: RunFusionReviewInput): Promise<FusionRunResult> {
  const reviewerPolicies: AutomationModelPolicyKey[] = job?.fusion?.reviewerPolicies || ["automation_cheap", "daily", "hard"];
  const reviewerResults = [];
  for (let i = 0; i < reviewerPolicies.length; i++) {
    const policyKey = reviewerPolicies[i];
    const decision = resolveAutomationModel({
      job,
      availableModels: engine.availableModels || [],
      explicitPolicyKey: policyKey,
      phase: "fusion_reviewer",
    });
    const run = await runIsolated(
      engine,
      agentId,
      buildFusionReviewerPrompt({
        taskLabel: job?.label || job?.id || "automation task",
        originalPrompt,
        primarySummary: primaryResult.summary || "",
        outputPath: primaryResult.outputPath || null,
      }),
      decision.model,
      signal,
    );
    const summary = run.error ? null : await summarize(engine, run.sessionPath, agentId);
    reviewerResults.push({
      id: `reviewer_${i + 1}`,
      policyKey,
      model: decision.model,
      sessionPath: run.sessionPath,
      summary,
      error: run.error,
    });
  }

  const judgeDecision = resolveAutomationModel({
    job,
    availableModels: engine.availableModels || [],
    explicitPolicyKey: "fusion_judge",
    phase: "fusion_judge",
  });
  const judgeRun = await runIsolated(
    engine,
    agentId,
    buildFusionJudgePrompt({
      taskLabel: job?.label || job?.id || "automation task",
      reviewerSummaries: reviewerResults.map((item) => item.summary || item.error || "no summary"),
    }),
    judgeDecision.model,
    signal,
  );
  const judgeSummary = judgeRun.error ? null : await summarize(engine, judgeRun.sessionPath, agentId);

  const finalizerDecision = resolveAutomationModel({
    job,
    availableModels: engine.availableModels || [],
    explicitPolicyKey: "fusion_finalizer",
    phase: "fusion_finalizer",
  });
  const finalizerRun = await runIsolated(
    engine,
    agentId,
    buildFusionFinalizerPrompt({
      taskLabel: job?.label || job?.id || "automation task",
      primarySummary: primaryResult.summary || "",
      judgeSummary: judgeSummary || "judge did not produce a summary",
      outputPath: primaryResult.outputPath || null,
    }),
    finalizerDecision.model,
    signal,
  );
  const finalizerSummary = finalizerRun.error ? null : await summarize(engine, finalizerRun.sessionPath, agentId);
  const hasError = reviewerResults.some((item) => item.error) || judgeRun.error || finalizerRun.error;

  return {
    enabled: true,
    status: hasError ? "error" : "done",
    reviewers: reviewerResults,
    judge: {
      model: judgeDecision.model,
      sessionPath: judgeRun.sessionPath,
      summary: judgeSummary,
      error: judgeRun.error,
    },
    finalizer: {
      model: finalizerDecision.model,
      sessionPath: finalizerRun.sessionPath,
      summary: finalizerSummary,
      error: finalizerRun.error,
    },
    judgeSummary,
    finalOutputPath: primaryResult.outputPath || null,
  };
}
```

- [ ] **Step 4: Ensure Fusion sessions persist below automation activity**

If `engine.executeIsolated` requires a `persist` path, pass from scheduler into the runner:

```ts
persist: path.join(engine.agentsDir, agentId, "activity", "automation")
```

Then add `persist?: string` to `RunFusionReviewInput` and forward it in `runIsolated`.

- [ ] **Step 5: Run tests and verify GREEN**

```powershell
npm test -- tests/fusion-runner.test.ts tests/model-routing-policy.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add lib/desk/fusion/fusion-runner.ts tests/fusion-runner.test.ts
git commit -m "feat: run isolated fusion reviews"
```

### Task 3: Persist Fusion Config In Cron Jobs

**Files:**

- Modify: `lib/desk/cron-store.ts`
- Modify: `server/routes/desk.ts`
- Modify: `tests/cron-store.test.ts`
- Modify: `tests/desk-route-cron.test.ts`

**Interfaces:**

- `CronStore.addJob/updateJob` accepts optional `fusion`.
- Route `add/update` accepts `fusion` object.
- Route validates only safe Fusion keys.

- [ ] **Step 1: Add failing CronStore test**

```ts
  it("persists fusion config on jobs", () => {
    const store = makeTmpStore();
    const job = store.addJob({
      type: "cron",
      schedule: "0 9 * * *",
      prompt: "important",
      actorAgentId: "hana",
      fusion: { enabled: true, importance: "important" },
    } as any);

    expect(job.fusion).toEqual({ enabled: true, importance: "important" });
    const updated = store.updateJob(job.id, { fusion: { enabled: false, importance: "normal" } });
    expect(updated.fusion).toEqual({ enabled: false, importance: "normal" });
  });
```

- [ ] **Step 2: Run test and verify RED**

```powershell
npm test -- tests/cron-store.test.ts
```

Expected: FAIL because `fusion` is not persisted.

- [ ] **Step 3: Add fusion support in CronStore**

In `addJob` and `addImportedJob`, accept:

```ts
    fusion = null,
```

When building job:

```ts
      ...(fusion && typeof fusion === "object" && !Array.isArray(fusion) ? { fusion: clonePlainObject(fusion) } : {}),
```

Add to `ALLOWED`:

```ts
      "fusion",
```

Update field branch:

```ts
      if (key === "fusion") {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          job.fusion = JSON.parse(JSON.stringify(value));
        } else {
          delete job.fusion;
        }
        continue;
      }
```

- [ ] **Step 4: Add route validation**

In `server/routes/desk.ts`, before writing fields to store, normalize Fusion:

```ts
function normalizeRouteFusion(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: any = {};
  if (typeof value.enabled === "boolean") out.enabled = value.enabled;
  if (typeof value.enabledOnce === "boolean") out.enabledOnce = value.enabledOnce;
  if (value.importance === "normal" || value.importance === "important" || value.importance === "critical") out.importance = value.importance;
  if (Array.isArray(value.reviewerPolicies)) {
    out.reviewerPolicies = value.reviewerPolicies.filter((item) => item === "automation_cheap" || item === "daily" || item === "hard");
  }
  return out;
}
```

For `add` and `update`, if `fusion` is present:

```ts
fusion: normalizeRouteFusion(params.fusion),
```

or:

```ts
fields.fusion = normalizeRouteFusion(fields.fusion);
```

- [ ] **Step 5: Run tests**

```powershell
npm test -- tests/cron-store.test.ts tests/desk-route-cron.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add lib/desk/cron-store.ts server/routes/desk.ts tests/cron-store.test.ts tests/desk-route-cron.test.ts
git commit -m "feat: persist automation fusion config"
```

### Task 4: Integrate Fusion Into Scheduler

**Files:**

- Modify: `hub/scheduler.ts`
- Modify: `tests/scheduler-studio-cron.test.ts`

**Interfaces:**

- If `shouldRunFusion(job)` returns true, scheduler calls `runFusionReview` after primary task succeeds.
- Fusion result is included in run result:

```ts
{ fusion: FusionRunResult | null }
```

- If Fusion fails, primary run remains success and run result includes `fusion.status = "error"`.

- [ ] **Step 1: Add failing scheduler Fusion test**

```ts
  it("runs fusion after primary automation when enabled once", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-scheduler-cron-"));
    try {
      const agentsDir = path.join(root, "agents");
      fs.mkdirSync(path.join(agentsDir, "agent-a"), { recursive: true });
      const activityStore = { add: vi.fn() };
      const executeIsolated = vi.fn(async () => ({
        sessionPath: path.join(root, "agents", "agent-a", "activity", "automation", `run_${executeIsolated.mock.calls.length}.jsonl`),
        error: null,
      }));
      const engine = {
        agentsDir,
        agents: new Map(),
        availableModels: [
          { id: "deepseek-chat", provider: "deepseek" },
          { id: "gpt-4.1", provider: "openai-relay" },
          { id: "claude-sonnet-4", provider: "anthropic-relay" },
        ],
        getStudioCronStore: () => ({ listJobs: vi.fn(() => []) }),
        getHeartbeatMaster: () => false,
        ensureAgentRuntime: vi.fn(async (agentId) => ({ id: agentId, agentName: agentId })),
        getAgent: vi.fn((agentId) => ({ id: agentId, agentName: agentId })),
        executeIsolated,
        summarizeActivity: vi.fn(async (sessionPath) => `summary:${sessionPath}`),
        getActivityStore: vi.fn(() => activityStore),
        emitDevLog: vi.fn(),
      };
      const scheduler = new Scheduler({ hub: { engine, eventBus: { emit: vi.fn() } } });
      scheduler.start();
      const executeJob = createCronSchedulerMock.mock.calls[0][0].executeJob;

      const result = await executeJob({
        id: "studio_job_fusion",
        label: "Important job",
        prompt: "run important",
        actorAgentId: "agent-a",
        fusion: { enabledOnce: true },
        executionContext: {
          kind: "session_workspace",
          cwd: "/workspace/a",
          workspaceFolders: [],
          sourceSessionPath: "/sessions/a.jsonl",
          createdByAgentId: "agent-a",
        },
      });

      expect(executeIsolated.mock.calls.length).toBeGreaterThan(1);
      expect(result.fusion).toEqual(expect.objectContaining({ enabled: true, status: "done" }));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run scheduler test and verify RED**

```powershell
npm test -- tests/scheduler-studio-cron.test.ts
```

Expected: FAIL because scheduler does not call Fusion.

- [ ] **Step 3: Import Fusion helpers**

```ts
import { runFusionReview } from "../lib/desk/fusion/fusion-runner.ts";
import { shouldRunFusion } from "../lib/desk/fusion/fusion-types.ts";
```

- [ ] **Step 4: Call Fusion after primary success**

After primary activity result is available:

```ts
      let fusion = null;
      if (shouldRunFusion(job)) {
        try {
          fusion = await runFusionReview({
            engine: this._engine,
            agentId,
            job,
            originalPrompt: promptBody,
            primaryResult: {
              summary: activityResult?.summary || null,
              outputPath: resolveAutomationOutputPath(job, activityResult),
              sessionPath: activityResult?.sessionPath || null,
            },
            persist: path.join(this._engine.agentsDir, agentId, "activity", "automation"),
            signal: ac.signal,
          } as any);
        } catch (err) {
          fusion = {
            enabled: true,
            status: "error",
            reviewers: [],
            judge: { model: null, sessionPath: null, summary: null, error: null },
            finalizer: { model: null, sessionPath: null, summary: null, error: null },
            judgeSummary: null,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
```

Include in returned result:

```ts
fusion,
```

- [ ] **Step 5: Run scheduler and fusion tests**

```powershell
npm test -- tests/fusion-runner.test.ts tests/scheduler-studio-cron.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add hub/scheduler.ts tests/scheduler-studio-cron.test.ts
git commit -m "feat: run fusion review for important automations"
```

### Task 5: Reset One-Shot Fusion After Manual Run

**Files:**

- Modify: `hub/scheduler.ts`
- Modify: `server/routes/desk.ts`
- Modify: `tests/desk-route-cron.test.ts`

**Interfaces:**

- `runNow({ fusionOnce: true })` sets one-shot Fusion for that run only.
- Stored job `fusion.enabledOnce` is not persisted after run.

- [ ] **Step 1: Add failing one-shot test**

```ts
  it("does not persist fusionOnce after runNow", async () => {
    const job = { id: "job_1", label: "Run Now", fusion: { enabled: false } };
    const service = {
      getJob: vi.fn(() => job),
      updateJob: vi.fn(),
      listJobs: vi.fn(() => [job]),
    };
    const runCronJobNow = vi.fn(async () => ({ jobId: "job_1", fusion: { enabled: true, status: "done" } }));
    const app = await createApp({
      getStudioCronStore: () => service,
      listAgents: () => [],
    }, { scheduler: { runCronJobNow, getHeartbeat: vi.fn() } });

    await app.request("/api/desk/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "runNow", id: "job_1", fusionOnce: true }),
    });

    expect(service.updateJob).not.toHaveBeenCalledWith("job_1", expect.objectContaining({ fusion: expect.objectContaining({ enabledOnce: true }) }));
  });
```

- [ ] **Step 2: Run test and verify RED if implementation persisted one-shot**

```powershell
npm test -- tests/desk-route-cron.test.ts
```

Expected: PASS only if one-shot is already ephemeral. If it fails, fix `runNow` to clone the job instead of updating stored job.

- [ ] **Step 3: Enforce ephemeral clone in scheduler**

In `runCronJobNow`:

```ts
    const runJob = options.fusionOnce
      ? { ...job, fusion: { ...(job.fusion || {}), enabledOnce: true } }
      : job;
```

Do not call `cronStore.updateJob` for `enabledOnce`.

- [ ] **Step 4: Run tests**

```powershell
npm test -- tests/desk-route-cron.test.ts tests/scheduler-studio-cron.test.ts tests/fusion-runner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add hub/scheduler.ts server/routes/desk.ts tests/desk-route-cron.test.ts
git commit -m "feat: keep fusion once ephemeral"
```

## Quality Gate

Run:

```powershell
node scripts/hana-agent-quality-harness.mjs --stage fusion
npm run typecheck
```

Expected:

- Fusion is off by default.
- `fusion.enabled` and `fusion.enabledOnce` trigger Fusion.
- Reviewers run independently before judge.
- Judge runs before finalizer.
- Fusion failure does not erase primary automation result.
- Fusion result appears in run history under `fusion`.
- Reviewers confirm the design is not a multi-model group chat.
