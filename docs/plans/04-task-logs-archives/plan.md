# Automation Logs And Archives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为自动化任务提供独立 run log、输出文件定位、手动立即执行入口和独立 activity archive，支撑 UI 的“查看日志”“打开输出”“立即执行”。

**Architecture:** 复用现有 `CronStore.logRun/getRunHistory`，扩展 scheduler 返回的 execution result，使 run history 保存 `sessionPath`、`outputPath`、`modelDecision` 和 Fusion 摘要。后端在 `/api/desk/cron/:id/runs` 暴露日志，在 `POST /api/desk/cron` 的 `runNow` action 触发单个 job；activity session 持久化到 `agents/<agentId>/activity/automation`，不混入普通聊天会话。

**Tech Stack:** TypeScript, Hono, existing `CronStore`, existing `Scheduler`, existing Electron `window.platform.openFile`, Vitest.

## Global Constraints

- 自动化运行记录必须独立归档，不混入普通聊天 session 列表。
- run log 必须包含开始时间、结束时间、状态、输出路径、session 文件、模型路由、重试或 fallback 信息。
- “打开输出”优先使用 `personalTask.outputPath` 或 run 中解析出的 Markdown 输出；没有输出时返回 `sessionPath`。
- 不能在 run log 中写入 API key、Authorization header 或完整 provider secrets。
- `runNow` 必须复用同一执行链路，不能另写一套绕过 scheduler 的执行器。

---

## Assigned Agents

主实施智能体：`Logs Archive Agent`

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

- 实施：DeepSeek 官方或 GPT 中转。
- 复核：GPT 中转或 Claude 中转。

## File Structure

```text
lib/desk/automation-runs
├── run-output-resolver.ts
└── run-summary.ts

hub/scheduler.ts
server/routes/desk.ts
tests/automation-run-actions.test.ts
tests/scheduler-studio-cron.test.ts
tests/desk-route-cron.test.ts
```

## API Contracts

### Read Runs

```http
GET /api/desk/cron/:id/runs?limit=20
```

Response:

```json
{
  "runs": [
    {
      "id": "cron_1710000000000",
      "jobId": "studio_job_1",
      "status": "done",
      "startedAt": "2026-06-25T08:00:00.000Z",
      "finishedAt": "2026-06-25T08:01:00.000Z",
      "summary": "整理完成",
      "outputPath": "D:\\obsidian\\GitHub整理.md",
      "sessionPath": "D:\\hana agent\\...\\activity\\automation\\cron_1710000000000.jsonl",
      "modelDecision": null,
      "fusion": null
    }
  ]
}
```

### Run Now

```http
POST /api/desk/cron
Content-Type: application/json

{ "action": "runNow", "id": "studio_job_1", "fusionOnce": false }
```

Response:

```json
{ "ok": true, "run": { "jobId": "studio_job_1", "status": "queued" } }
```

### Task 1: Resolve Automation Output Paths

**Files:**

- Create: `lib/desk/automation-runs/run-output-resolver.ts`
- Create: `tests/automation-run-actions.test.ts`

**Interfaces:**

```ts
export function resolveAutomationOutputPath(job: any, executionResult?: any): string | null;
```

Resolution order:

1. `executionResult.outputPath`
2. `executionResult.filePath`
3. `job.personalTask.outputPath`
4. first Markdown file in `executionResult.outputFiles`
5. `null`

- [ ] **Step 1: Write failing output resolver tests**

```ts
import { describe, expect, it } from "vitest";
import { resolveAutomationOutputPath } from "../lib/desk/automation-runs/run-output-resolver.ts";

describe("resolveAutomationOutputPath", () => {
  it("prefers execution output path over personal task default", () => {
    expect(resolveAutomationOutputPath(
      { personalTask: { outputPath: "D:\\obsidian\\default.md" } },
      { outputPath: "D:\\obsidian\\run.md" },
    )).toBe("D:\\obsidian\\run.md");
  });

  it("uses personal task output path when execution result has no output", () => {
    expect(resolveAutomationOutputPath(
      { personalTask: { outputPath: "D:\\obsidian\\default.md" } },
      {},
    )).toBe("D:\\obsidian\\default.md");
  });

  it("uses first markdown output file", () => {
    expect(resolveAutomationOutputPath({}, {
      outputFiles: ["D:\\tmp\\raw.txt", "D:\\tmp\\summary.md"],
    })).toBe("D:\\tmp\\summary.md");
  });
});
```

- [ ] **Step 2: Run test and verify RED**

```powershell
npm test -- tests/automation-run-actions.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement resolver**

```ts
function cleanPath(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolveAutomationOutputPath(job: any, executionResult: any = {}): string | null {
  const direct = cleanPath(executionResult?.outputPath) || cleanPath(executionResult?.filePath);
  if (direct) return direct;
  const personal = cleanPath(job?.personalTask?.outputPath);
  if (personal) return personal;
  const files = Array.isArray(executionResult?.outputFiles) ? executionResult.outputFiles : [];
  return files.find((file) => typeof file === "string" && file.toLowerCase().endsWith(".md")) || null;
}
```

- [ ] **Step 4: Run test and verify GREEN**

```powershell
npm test -- tests/automation-run-actions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/desk/automation-runs/run-output-resolver.ts tests/automation-run-actions.test.ts
git commit -m "feat: resolve automation output paths"
```

### Task 2: Normalize Run Summaries And Redact Secrets

**Files:**

- Create: `lib/desk/automation-runs/run-summary.ts`
- Modify: `tests/automation-run-actions.test.ts`

**Interfaces:**

```ts
export function redactAutomationRunText(value: unknown): string | null;
export function normalizeAutomationRun(jobId: string, raw: any): any;
```

- [ ] **Step 1: Write failing redaction tests**

```ts
import { normalizeAutomationRun, redactAutomationRunText } from "../lib/desk/automation-runs/run-summary.ts";

describe("automation run summary", () => {
  it("redacts api keys and authorization headers", () => {
    expect(redactAutomationRunText("Authorization: Bearer abc.def\nsk-1234567890abcdef")).toBe("Authorization: Bearer ***\nsk-***");
  });

  it("normalizes success to done and attaches job id", () => {
    const run = normalizeAutomationRun("job_1", {
      id: "cron_1",
      status: "success",
      error: "Authorization: Bearer secret.token",
    });

    expect(run).toEqual(expect.objectContaining({
      id: "cron_1",
      jobId: "job_1",
      status: "done",
      error: "Authorization: Bearer ***",
    }));
  });
});
```

- [ ] **Step 2: Run test and verify RED**

```powershell
npm test -- tests/automation-run-actions.test.ts
```

Expected: FAIL because `run-summary.ts` does not exist.

- [ ] **Step 3: Implement summary normalizer**

```ts
export function redactAutomationRunText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value
    .replace(/Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/gi, "Authorization: Bearer ***")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-***");
}

function normalizeStatus(status: unknown) {
  if (status === "success" || status === "done") return "done";
  if (status === "running" || status === "error" || status === "skipped") return status;
  return "error";
}

export function normalizeAutomationRun(jobId: string, raw: any) {
  return {
    ...raw,
    id: typeof raw?.id === "string" ? raw.id : `${jobId}_${raw?.timestamp || Date.now()}`,
    jobId,
    status: normalizeStatus(raw?.status),
    summary: redactAutomationRunText(raw?.summary),
    error: redactAutomationRunText(raw?.error),
  };
}
```

- [ ] **Step 4: Run tests**

```powershell
npm test -- tests/automation-run-actions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/desk/automation-runs/run-summary.ts tests/automation-run-actions.test.ts
git commit -m "feat: normalize automation run history"
```

### Task 3: Return Rich Execution Results From Scheduler

**Files:**

- Modify: `hub/scheduler.ts`
- Modify: `tests/scheduler-studio-cron.test.ts`

**Interfaces:**

- `_executeCronJob(job)` returns:

```ts
{
  executorKind: "agent_session",
  sessionPath: string | null,
  sessionFile: string | null,
  outputPath: string | null,
  modelDecision: AutomationModelDecision | null,
  fusion: null | object
}
```

- `_executeActivityForAgent(...)` returns the same metadata instead of only writing activity store.

- [ ] **Step 1: Add failing scheduler result test**

In `tests/scheduler-studio-cron.test.ts`, extend an existing success test:

```ts
      const executeResult = await executeJob({
        id: "studio_job_result",
        label: "Result job",
        prompt: "run",
        actorAgentId: "agent-a",
        personalTask: { outputPath: "D:\\obsidian\\out.md" },
        executionContext: {
          kind: "session_workspace",
          cwd: "/workspace/a",
          workspaceFolders: [],
          sourceSessionPath: "/sessions/a.jsonl",
          createdByAgentId: "agent-a",
        },
      });

      expect(executeResult).toEqual(expect.objectContaining({
        executorKind: "agent_session",
        outputPath: "D:\\obsidian\\out.md",
        sessionPath: expect.any(String),
      }));
```

Set the fake `executeIsolated` to return:

```ts
const executeIsolated = vi.fn(async () => ({ sessionPath: path.join(root, "agents", "agent-a", "activity", "automation", "cron_1.jsonl"), error: null }));
```

- [ ] **Step 2: Run scheduler test and verify RED**

```powershell
npm test -- tests/scheduler-studio-cron.test.ts
```

Expected: FAIL because `_executeCronJob` returns only `{ executorKind: "agent_session" }`.

- [ ] **Step 3: Import output resolver**

```ts
import { resolveAutomationOutputPath } from "../lib/desk/automation-runs/run-output-resolver.ts";
```

- [ ] **Step 4: Change activity directory for cron**

Inside `_executeActivityForAgent`, replace:

```ts
    const activityDir = path.join(agentDir, "activity");
```

With:

```ts
    const activityDir = type === "cron"
      ? path.join(agentDir, "activity", "automation")
      : path.join(agentDir, "activity");
```

- [ ] **Step 5: Return metadata from `_executeActivityForAgent`**

After `engine.emitDevLog(...)`, return:

```ts
    return {
      sessionPath: typeof sessionPath === "string" ? sessionPath : null,
      sessionFile: typeof sessionPath === "string" ? path.basename(sessionPath) : null,
      summary: entry.summary,
      status: entry.status,
      modelDecision: opts.modelDecision || null,
    };
```

- [ ] **Step 6: Return metadata from `_executeCronJobForAgent` and `_executeCronJob`**

Capture the result of `_executeActivityForAgent` or `_executeCronJobAttempt`, then return:

```ts
    return {
      executorKind: "agent_session",
      ...activityResult,
      outputPath: resolveAutomationOutputPath(job, activityResult),
      fusion: activityResult?.fusion || null,
    };
```

In `_executeCronJob(job)`:

```ts
    const result = await this._executeCronJobForAgent(actorAgentId, job, executor);
    return { executorKind: "agent_session", ...result };
```

- [ ] **Step 7: Run scheduler tests**

```powershell
npm test -- tests/scheduler-studio-cron.test.ts tests/automation-run-actions.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add hub/scheduler.ts tests/scheduler-studio-cron.test.ts
git commit -m "feat: return automation run metadata"
```

### Task 4: Add Run History API

**Files:**

- Modify: `server/routes/desk.ts`
- Modify: `tests/desk-route-cron.test.ts`

**Interfaces:**

- `GET /api/desk/cron/:id/runs?limit=20` reads `store.getRunHistory(id, limit)`.
- Response uses `normalizeAutomationRun`.

- [ ] **Step 1: Add failing route test**

```ts
  it("returns normalized run history for a cron job", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-desk-cron-"));
    roots.push(root);
    const service = new StudioCronService({ hanakoHome: root, agentsDir: path.join(root, "agents"), getStudioId: () => "studio-main" });
    const job = service.addJob({
      type: "cron",
      schedule: "0 9 * * *",
      prompt: "studio job",
      actorAgentId: "agent-a",
      executionContext: {
        kind: "session_workspace",
        cwd: "/workspace/a",
        workspaceFolders: [],
        sourceSessionPath: "/sessions/a.jsonl",
        createdByAgentId: "agent-a",
      },
    });
    service.logRun(job.id, { id: "run_1", status: "success", startedAt: "2026-06-25T00:00:00.000Z" });
    const app = await createApp({
      getAgent: (id) => ({ id, agentName: id }),
      getStudioCronStore: () => service,
      listAgents: () => [],
    });

    const res = await app.request(`/api/desk/cron/${job.id}/runs?limit=10`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      runs: [expect.objectContaining({ id: "run_1", jobId: job.id, status: "done" })],
    });
  });
```

- [ ] **Step 2: Run route test and verify RED**

```powershell
npm test -- tests/desk-route-cron.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Add route import**

```ts
import { normalizeAutomationRun } from "../../lib/desk/automation-runs/run-summary.ts";
```

- [ ] **Step 4: Add GET route before POST `/desk/cron`**

```ts
  route.get("/desk/cron/:id/runs", async (c) => {
    const store = getStudioCronStore(engine);
    if (!store) return deskRouteError(c, "cron_store_unavailable", "Desk not initialized", 503);
    const id = c.req.param("id");
    const limitRaw = Number(c.req.query("limit") || 20);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 20;
    const runs = store.getRunHistory(id, limit).map((run) => normalizeAutomationRun(id, run));
    return c.json({ runs });
  });
```

- [ ] **Step 5: Run route test and verify GREEN**

```powershell
npm test -- tests/desk-route-cron.test.ts tests/automation-run-actions.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add server/routes/desk.ts tests/desk-route-cron.test.ts
git commit -m "feat: expose automation run history"
```

### Task 5: Add Run Now Action

**Files:**

- Modify: `hub/scheduler.ts`
- Modify: `server/routes/desk.ts`
- Modify: `tests/desk-route-cron.test.ts`

**Interfaces:**

```ts
Scheduler.runCronJobNow(jobId: string, options?: { fusionOnce?: boolean }): Promise<any>
```

- [ ] **Step 1: Add failing route test**

```ts
  it("runs a cron job immediately through the scheduler", async () => {
    const service = {
      getJob: vi.fn((id) => id === "job_1" ? { id: "job_1", label: "Run Now" } : null),
      listJobs: vi.fn(() => []),
    };
    const runCronJobNow = vi.fn(async (id, options) => ({ jobId: id, status: "queued", fusionOnce: options.fusionOnce }));
    const app = await createApp({
      getStudioCronStore: () => service,
      listAgents: () => [],
    }, { scheduler: { runCronJobNow, getHeartbeat: vi.fn() } });

    const res = await app.request("/api/desk/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "runNow", id: "job_1", fusionOnce: true }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, run: { jobId: "job_1", status: "queued", fusionOnce: true } });
    expect(runCronJobNow).toHaveBeenCalledWith("job_1", { fusionOnce: true });
  });
```

If local `createApp` helper does not accept the second argument, update it to:

```ts
function createApp(engine, hubOverride = { scheduler: { getHeartbeat: vi.fn() } }) {
  return import("../server/routes/desk.ts").then(({ createDeskRoute }) => {
    const app = new Hono();
    app.route("/api", createDeskRoute(engine, hubOverride));
    return app;
  });
}
```

- [ ] **Step 2: Run route test and verify RED**

```powershell
npm test -- tests/desk-route-cron.test.ts
```

Expected: FAIL because `runNow` action is unknown.

- [ ] **Step 3: Add scheduler public method**

In `hub/scheduler.ts`:

```ts
  async runCronJobNow(jobId, options: any = {}) {
    const cronStore = this._engine.getStudioCronStore?.();
    if (!cronStore) throw new Error("cron store unavailable");
    const job = cronStore.getJob(jobId);
    if (!job) throw new Error("not found");
    const runJob = options.fusionOnce
      ? { ...job, fusion: { ...(job.fusion || {}), enabledOnce: true } }
      : job;
    const result = await this._executeCronJob(runJob);
    cronStore.logRun(job.id, {
      id: result?.id || `manual_${Date.now()}`,
      status: "success",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      ...result,
    });
    return { jobId: job.id, status: "queued", ...result };
  }
```

If immediate execution should block until completion, set returned status from `result.status || "done"` instead of `"queued"`. Keep the route response shape stable.

- [ ] **Step 4: Add route action**

Inside `POST /desk/cron` switch:

```ts
      case "runNow": {
        if (!params.id) return c.json({ error: "id required" }, 400);
        const job = store.getJob(params.id);
        if (!job) return c.json({ error: "not found" }, 404);
        if (typeof hub?.scheduler?.runCronJobNow !== "function") {
          return deskRouteError(c, "scheduler_unavailable", "Scheduler not initialized", 503);
        }
        const run = await hub.scheduler.runCronJobNow(params.id, { fusionOnce: params.fusionOnce === true });
        return c.json({ ok: true, run });
      }
```

- [ ] **Step 5: Run route and scheduler tests**

```powershell
npm test -- tests/desk-route-cron.test.ts tests/scheduler-studio-cron.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add hub/scheduler.ts server/routes/desk.ts tests/desk-route-cron.test.ts
git commit -m "feat: run automation jobs immediately"
```

## Quality Gate

Run:

```powershell
node scripts/hana-agent-quality-harness.mjs --stage logs
npm run typecheck
```

Expected:

- `GET /api/desk/cron/:id/runs` returns normalized run history.
- `runNow` executes through scheduler and writes run history.
- Cron activity sessions persist below `activity/automation`.
- Output path resolution prefers run output, then personal task output.
- Redaction removes API keys and Authorization bearer tokens from logs.
