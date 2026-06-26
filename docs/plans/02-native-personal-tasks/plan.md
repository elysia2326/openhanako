# Native Personal Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将用户已有 Codex 自动化中的 `GitHub整理` 和 `数字政府资料查找并整理` 导入为 HanaAgent 原生自动化任务，默认使用低成本模型执行，并沿用原有路径和输出约定。

**Architecture:** 在 `lib/desk/personal-tasks` 中定义个人任务模板、Codex 自动化契约读取器和 seed 逻辑，再由 `StudioCronService` 在加载 studio cron store 时执行幂等 seed。导入成功时创建启用状态的原生 `agent_session` job；找不到 Codex 契约时创建禁用模板，用户可在工具栏中补全。

**Tech Stack:** TypeScript, Node fs/path, existing `StudioCronService`, existing `CronStore`, Vitest.

## Global Constraints

- 不在运行时调用 Codex；Codex 自动化配置只作为导入来源。
- Codex 自动化配置的路径、schedule、输出路径、缓存读取策略和失败约定优先于 HanaAgent 默认模板。
- 导入失败不能阻塞 HanaAgent 启动；必须创建禁用模板并写入可诊断日志。
- 默认模型策略为 `automation_cheap`，由 `03-model-routing` 实现。
- 不删除、不移动、不覆盖用户的 Codex 配置文件。
- 允许读取 `C:\Users\23697\Documents\Codex`。

---

## Assigned Agents

主实施智能体：`Native Task Runner Agent`

复核智能体：

- `Spec Compliance Reviewer`
- `Code Quality Reviewer`

要求使用的 skills：

- `api-and-interface-design`
- `test-driven-development`
- `superpowers:test-driven-development`
- `superpowers:verification-before-completion`
- `security-and-hardening`
- `observability-and-instrumentation`

建议模型：

- 实施：DeepSeek 官方。
- 复核：GPT 中转或 Claude 中转。

## File Structure

```text
lib/desk/personal-tasks
├── codex-automation-import.ts
├── personal-task-definitions.ts
└── personal-task-seed.ts

core/studio-cron-service.ts
tests/personal-task-seed.test.ts
tests/fixtures/personal-tasks/codex-automation-sample.json
```

## Data Contracts

### `PersonalTaskDefinition`

```ts
export interface PersonalTaskDefinition {
  key: 'github_digest' | 'digital_government_research';
  label: 'GitHub整理' | '数字政府资料查找并整理';
  codexTitle: string;
  defaultScheduleType: 'cron';
  defaultSchedule: string;
  defaultPrompt: string;
  defaultOutputPath: string;
  modelPolicyKey: 'automation_cheap';
}
```

### `CodexAutomationContract`

```ts
export interface CodexAutomationContract {
  title: string;
  scheduleType?: 'at' | 'every' | 'cron';
  schedule?: string | number;
  prompt?: string;
  cwd?: string | null;
  workspaceFolders?: string[];
  outputPath?: string | null;
  cachePolicy?: string | null;
  failurePolicy?: string | null;
}
```

### Job fields added by seed

```ts
personalTask: {
  key: 'github_digest' | 'digital_government_research';
  source: 'codex_import' | 'hana_template';
  codexTitle: string;
  importedAt: string;
  outputPath: string;
}
modelPolicyKey: 'automation_cheap'
```

### Task 1: Define Native Personal Task Templates

**Files:**

- Create: `lib/desk/personal-tasks/personal-task-definitions.ts`
- Test: `tests/personal-task-seed.test.ts`

**Interfaces:**

- Produces `PERSONAL_TASK_DEFINITIONS`.
- Produces `isPersonalTaskKey(value: unknown): value is PersonalTaskDefinition['key']`.

- [ ] **Step 1: Write the failing definition test**

```ts
import { describe, expect, it } from "vitest";
import { PERSONAL_TASK_DEFINITIONS } from "../lib/desk/personal-tasks/personal-task-definitions.ts";

describe("personal task definitions", () => {
  it("defines the two native personal tasks with cheap automation policy", () => {
    expect(PERSONAL_TASK_DEFINITIONS.map((task) => task.label)).toEqual([
      "GitHub整理",
      "数字政府资料查找并整理",
    ]);
    expect(PERSONAL_TASK_DEFINITIONS.every((task) => task.modelPolicyKey === "automation_cheap")).toBe(true);
    expect(PERSONAL_TASK_DEFINITIONS.every((task) => task.defaultScheduleType === "cron")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
npm test -- tests/personal-task-seed.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement task definitions**

```ts
export interface PersonalTaskDefinition {
  key: "github_digest" | "digital_government_research";
  label: "GitHub整理" | "数字政府资料查找并整理";
  codexTitle: string;
  defaultScheduleType: "cron";
  defaultSchedule: string;
  defaultPrompt: string;
  defaultOutputPath: string;
  modelPolicyKey: "automation_cheap";
}

export const PERSONAL_TASK_DEFINITIONS: PersonalTaskDefinition[] = [
  {
    key: "github_digest",
    label: "GitHub整理",
    codexTitle: "GitHub整理",
    defaultScheduleType: "cron",
    defaultSchedule: "0 9 * * *",
    defaultPrompt: [
      "执行个人 GitHub 整理自动化。",
      "优先读取既有缓存和本地资料，整理近期需要关注的仓库、issue、PR、release 和后续动作。",
      "按原 Codex 自动化约定写入 Markdown 输出文件。",
    ].join("\n"),
    defaultOutputPath: "D:\\obsidian\\GitHub整理.md",
    modelPolicyKey: "automation_cheap",
  },
  {
    key: "digital_government_research",
    label: "数字政府资料查找并整理",
    codexTitle: "数字政府资料查找并整理",
    defaultScheduleType: "cron",
    defaultSchedule: "0 10 * * *",
    defaultPrompt: [
      "执行数字政府资料查找并整理自动化。",
      "优先读取缓存；需要联网时只检索与数字政府、政务服务、数据治理和政策资料直接相关的来源。",
      "按原 Codex 自动化约定写入 Markdown 输出文件。",
    ].join("\n"),
    defaultOutputPath: "D:\\obsidian\\数字政府资料查找并整理.md",
    modelPolicyKey: "automation_cheap",
  },
];

export function isPersonalTaskKey(value: unknown): value is PersonalTaskDefinition["key"] {
  return value === "github_digest" || value === "digital_government_research";
}
```

- [ ] **Step 4: Run the test and verify GREEN**

```powershell
npm test -- tests/personal-task-seed.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/desk/personal-tasks/personal-task-definitions.ts tests/personal-task-seed.test.ts
git commit -m "feat: define native personal automation tasks"
```

### Task 2: Read Codex Automation Contracts Safely

**Files:**

- Create: `lib/desk/personal-tasks/codex-automation-import.ts`
- Create: `tests/fixtures/personal-tasks/codex-automation-sample.json`
- Modify: `tests/personal-task-seed.test.ts`

**Interfaces:**

```ts
export interface CodexAutomationContract {
  title: string;
  scheduleType?: "at" | "every" | "cron";
  schedule?: string | number;
  prompt?: string;
  cwd?: string | null;
  workspaceFolders?: string[];
  outputPath?: string | null;
  cachePolicy?: string | null;
  failurePolicy?: string | null;
}

export function loadCodexAutomationContracts(codexRoot: string): Map<string, CodexAutomationContract>;
```

Known files searched, in order:

```text
automations.json
automation.json
tasks.json
.codex/automations.json
.codex/tasks.json
```

Accepted JSON shapes:

```json
{ "automations": [ { "title": "GitHub整理" } ] }
{ "tasks": [ { "title": "GitHub整理" } ] }
[ { "title": "GitHub整理" } ]
```

- [ ] **Step 1: Add fixture**

```json
{
  "automations": [
    {
      "title": "GitHub整理",
      "scheduleType": "cron",
      "schedule": "30 8 * * *",
      "prompt": "从 Codex 导入的 GitHub 整理 prompt",
      "cwd": "D:\\AI-Agent",
      "workspaceFolders": ["D:\\AI-Agent", "D:\\obsidian"],
      "outputPath": "D:\\obsidian\\codex-github.md",
      "cachePolicy": "read-cache-first",
      "failurePolicy": "retry-then-switch-model"
    }
  ]
}
```

- [ ] **Step 2: Write the failing import test**

```ts
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { loadCodexAutomationContracts } from "../lib/desk/personal-tasks/codex-automation-import.ts";

describe("loadCodexAutomationContracts", () => {
  it("loads automation contracts from known Codex files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-contracts-"));
    try {
      fs.copyFileSync(
        path.join(process.cwd(), "tests/fixtures/personal-tasks/codex-automation-sample.json"),
        path.join(root, "automations.json"),
      );

      const contracts = loadCodexAutomationContracts(root);

      expect(contracts.get("GitHub整理")).toEqual(expect.objectContaining({
        title: "GitHub整理",
        scheduleType: "cron",
        schedule: "30 8 * * *",
        outputPath: "D:\\obsidian\\codex-github.md",
      }));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run the test and verify RED**

```powershell
npm test -- tests/personal-task-seed.test.ts
```

Expected: FAIL because `codex-automation-import.ts` does not exist.

- [ ] **Step 4: Implement safe importer**

```ts
import fs from "fs";
import path from "path";

export interface CodexAutomationContract {
  title: string;
  scheduleType?: "at" | "every" | "cron";
  schedule?: string | number;
  prompt?: string;
  cwd?: string | null;
  workspaceFolders?: string[];
  outputPath?: string | null;
  cachePolicy?: string | null;
  failurePolicy?: string | null;
}

const KNOWN_CODEX_AUTOMATION_FILES = [
  "automations.json",
  "automation.json",
  "tasks.json",
  path.join(".codex", "automations.json"),
  path.join(".codex", "tasks.json"),
];

function readJson(filePath: string) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

function arrayFromCodexJson(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  if (Array.isArray(record.automations)) return record.automations;
  if (Array.isArray(record.tasks)) return record.tasks;
  return [];
}

function normalizeContract(value: unknown): CodexAutomationContract | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" && record.title.trim()
    ? record.title.trim()
    : typeof record.label === "string" && record.label.trim()
      ? record.label.trim()
      : "";
  if (!title) return null;
  const scheduleType = record.scheduleType === "at" || record.scheduleType === "every" || record.scheduleType === "cron"
    ? record.scheduleType
    : record.type === "at" || record.type === "every" || record.type === "cron"
      ? record.type
      : undefined;
  const workspaceFolders = Array.isArray(record.workspaceFolders)
    ? record.workspaceFolders.filter((item): item is string => typeof item === "string" && item.trim())
    : undefined;
  return {
    title,
    ...(scheduleType ? { scheduleType } : {}),
    ...(typeof record.schedule === "string" || typeof record.schedule === "number" ? { schedule: record.schedule } : {}),
    ...(typeof record.prompt === "string" ? { prompt: record.prompt } : {}),
    ...(typeof record.cwd === "string" ? { cwd: record.cwd } : {}),
    ...(workspaceFolders ? { workspaceFolders } : {}),
    ...(typeof record.outputPath === "string" ? { outputPath: record.outputPath } : {}),
    ...(typeof record.cachePolicy === "string" ? { cachePolicy: record.cachePolicy } : {}),
    ...(typeof record.failurePolicy === "string" ? { failurePolicy: record.failurePolicy } : {}),
  };
}

export function loadCodexAutomationContracts(codexRoot: string): Map<string, CodexAutomationContract> {
  const contracts = new Map<string, CodexAutomationContract>();
  if (typeof codexRoot !== "string" || !codexRoot.trim()) return contracts;
  for (const rel of KNOWN_CODEX_AUTOMATION_FILES) {
    const data = readJson(path.join(codexRoot, rel));
    for (const item of arrayFromCodexJson(data)) {
      const contract = normalizeContract(item);
      if (contract && !contracts.has(contract.title)) contracts.set(contract.title, contract);
    }
  }
  return contracts;
}
```

- [ ] **Step 5: Run the test and verify GREEN**

```powershell
npm test -- tests/personal-task-seed.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add lib/desk/personal-tasks/codex-automation-import.ts tests/fixtures/personal-tasks/codex-automation-sample.json tests/personal-task-seed.test.ts
git commit -m "feat: import codex automation contracts"
```

### Task 3: Seed Personal Tasks Into Studio Cron Store

**Files:**

- Create: `lib/desk/personal-tasks/personal-task-seed.ts`
- Modify: `tests/personal-task-seed.test.ts`
- Modify: `lib/desk/cron-store.ts`

**Interfaces:**

```ts
export interface SeedPersonalTasksOptions {
  store: {
    listJobs(): any[];
    addJob(input: any): any;
  };
  actorAgentId: string | null;
  codexRoot: string;
  now?: () => Date;
}

export function seedPersonalTasks(options: SeedPersonalTasksOptions): { created: number; skipped: number };
```

- [ ] **Step 1: Write the failing seed test**

```ts
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { CronStore } from "../lib/desk/cron-store.ts";
import { seedPersonalTasks } from "../lib/desk/personal-tasks/personal-task-seed.ts";

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-task-store-"));
  return {
    root,
    store: new CronStore(path.join(root, "cron-jobs.json"), path.join(root, "cron-runs"), { idPrefix: "studio_job" }),
  };
}

describe("seedPersonalTasks", () => {
  it("creates native jobs from Codex contracts and is idempotent", () => {
    const codexRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-contracts-"));
    const { root, store } = makeStore();
    try {
      fs.copyFileSync(
        path.join(process.cwd(), "tests/fixtures/personal-tasks/codex-automation-sample.json"),
        path.join(codexRoot, "automations.json"),
      );

      const first = seedPersonalTasks({ store, actorAgentId: "agent-a", codexRoot, now: () => new Date("2026-06-25T00:00:00.000Z") });
      const second = seedPersonalTasks({ store, actorAgentId: "agent-a", codexRoot, now: () => new Date("2026-06-25T00:00:00.000Z") });

      expect(first.created).toBe(2);
      expect(second.created).toBe(0);
      const jobs = store.listJobs();
      expect(jobs.map((job) => job.label)).toEqual(["GitHub整理", "数字政府资料查找并整理"]);
      expect(jobs[0]).toEqual(expect.objectContaining({
        prompt: "从 Codex 导入的 GitHub 整理 prompt",
        schedule: "30 8 * * *",
        modelPolicyKey: "automation_cheap",
        personalTask: expect.objectContaining({
          key: "github_digest",
          source: "codex_import",
          outputPath: "D:\\obsidian\\codex-github.md",
        }),
      }));
      expect(jobs[1].enabled).toBe(false);
    } finally {
      fs.rmSync(codexRoot, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
npm test -- tests/personal-task-seed.test.ts
```

Expected: FAIL because `personal-task-seed.ts` does not exist and `CronStore` does not persist `personalTask` / `modelPolicyKey`.

- [ ] **Step 3: Extend `CronStore` allowed job metadata**

In `lib/desk/cron-store.ts`, include these optional fields in `addJob`, `addImportedJob`, and `updateJob` persistence:

```ts
    personalTask = null,
    modelPolicyKey = "",
```

Add to created job:

```ts
      ...(personalTask && typeof personalTask === "object" && !Array.isArray(personalTask) ? { personalTask: clonePlainObject(personalTask) } : {}),
      ...(typeof modelPolicyKey === "string" && modelPolicyKey.trim() ? { modelPolicyKey: modelPolicyKey.trim() } : {}),
```

Add to `ALLOWED` in `updateJob`:

```ts
      "personalTask",
      "modelPolicyKey",
```

When updating these keys:

```ts
      if (key === "personalTask") {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          job.personalTask = JSON.parse(JSON.stringify(value));
        }
        continue;
      }
      if (key === "modelPolicyKey") {
        if (typeof value === "string" && value.trim()) job.modelPolicyKey = value.trim();
        continue;
      }
```

- [ ] **Step 4: Implement seed logic**

```ts
import { loadCodexAutomationContracts } from "./codex-automation-import.ts";
import { PERSONAL_TASK_DEFINITIONS } from "./personal-task-definitions.ts";

export interface SeedPersonalTasksOptions {
  store: {
    listJobs(): any[];
    addJob(input: any): any;
  };
  actorAgentId: string | null;
  codexRoot: string;
  now?: () => Date;
}

function existingTaskKeys(jobs: any[]) {
  return new Set(
    jobs
      .map((job) => job?.personalTask?.key)
      .filter((key): key is string => typeof key === "string" && key.length > 0),
  );
}

function buildPrompt(definition: (typeof PERSONAL_TASK_DEFINITIONS)[number], contract: any | null) {
  const parts = [
    contract?.prompt || definition.defaultPrompt,
    "",
    `输出文件：${contract?.outputPath || definition.defaultOutputPath}`,
  ];
  if (contract?.cachePolicy) parts.push(`缓存策略：${contract.cachePolicy}`);
  if (contract?.failurePolicy) parts.push(`失败策略：${contract.failurePolicy}`);
  return parts.join("\n");
}

export function seedPersonalTasks({ store, actorAgentId, codexRoot, now = () => new Date() }: SeedPersonalTasksOptions) {
  if (!actorAgentId) return { created: 0, skipped: PERSONAL_TASK_DEFINITIONS.length };
  const contracts = loadCodexAutomationContracts(codexRoot);
  const existing = existingTaskKeys(store.listJobs());
  let created = 0;
  let skipped = 0;

  for (const definition of PERSONAL_TASK_DEFINITIONS) {
    if (existing.has(definition.key)) {
      skipped++;
      continue;
    }
    const contract = contracts.get(definition.codexTitle) || null;
    const outputPath = contract?.outputPath || definition.defaultOutputPath;
    store.addJob({
      type: contract?.scheduleType || definition.defaultScheduleType,
      schedule: contract?.schedule || definition.defaultSchedule,
      prompt: buildPrompt(definition, contract),
      label: definition.label,
      enabled: !!contract,
      actorAgentId,
      executionContext: {
        kind: contract ? "codex_personal_task_import" : "hana_personal_task_template",
        cwd: contract?.cwd || null,
        workspaceFolders: contract?.workspaceFolders || [],
        sourceSessionPath: null,
        createdByAgentId: actorAgentId,
      },
      personalTask: {
        key: definition.key,
        source: contract ? "codex_import" : "hana_template",
        codexTitle: definition.codexTitle,
        importedAt: now().toISOString(),
        outputPath,
      },
      modelPolicyKey: definition.modelPolicyKey,
      createdBy: { kind: "personal_task_seed", agentId: actorAgentId },
    });
    created++;
  }

  return { created, skipped };
}
```

- [ ] **Step 5: Run the test and verify GREEN**

```powershell
npm test -- tests/personal-task-seed.test.ts tests/cron-store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add lib/desk/personal-tasks/personal-task-seed.ts lib/desk/cron-store.ts tests/personal-task-seed.test.ts
git commit -m "feat: seed native personal automation tasks"
```

### Task 4: Wire Seeding Into StudioCronService

**Files:**

- Modify: `core/studio-cron-service.ts`
- Modify: `tests/personal-task-seed.test.ts`

**Interfaces:**

- `StudioCronService` constructor accepts optional `getPrimaryAgentId?: () => string | null` and `codexAutomationRoot?: string`.
- If omitted, `codexAutomationRoot` defaults to `C:\Users\23697\Documents\Codex` on Windows and empty string elsewhere.

- [ ] **Step 1: Add failing service integration test**

```ts
import { StudioCronService } from "../core/studio-cron-service.ts";

describe("StudioCronService personal task seed", () => {
  it("seeds personal tasks when the studio store is loaded", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-personal-tasks-"));
    const codexRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-contracts-"));
    try {
      fs.copyFileSync(
        path.join(process.cwd(), "tests/fixtures/personal-tasks/codex-automation-sample.json"),
        path.join(codexRoot, "automations.json"),
      );
      const service = new StudioCronService({
        hanakoHome: root,
        agentsDir: path.join(root, "agents"),
        getStudioId: () => "studio-main",
        getPrimaryAgentId: () => "agent-a",
        codexAutomationRoot: codexRoot,
      });

      const jobs = service.listJobs();

      expect(jobs.map((job) => job.label)).toEqual(["GitHub整理", "数字政府资料查找并整理"]);
      expect(jobs[0].actorAgentId).toBe("agent-a");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(codexRoot, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
npm test -- tests/personal-task-seed.test.ts
```

Expected: FAIL because `StudioCronService` ignores personal task seeding.

- [ ] **Step 3: Update `StudioCronService` constructor**

Add fields:

```ts
  declare _getPrimaryAgentId: () => string | null;
  declare _codexAutomationRoot: string;
```

Initialize:

```ts
    this._getPrimaryAgentId = typeof arguments[0]?.getPrimaryAgentId === "function"
      ? arguments[0].getPrimaryAgentId
      : () => null;
    this._codexAutomationRoot = typeof arguments[0]?.codexAutomationRoot === "string"
      ? arguments[0].codexAutomationRoot
      : process.platform === "win32"
        ? "C:\\Users\\23697\\Documents\\Codex"
        : "";
```

Import:

```ts
import { seedPersonalTasks } from "../lib/desk/personal-tasks/personal-task-seed.ts";
```

After `_importLegacyJobs(this._store, studioId);` add:

```ts
    try {
      seedPersonalTasks({
        store: this._store,
        actorAgentId: this._getPrimaryAgentId(),
        codexRoot: this._codexAutomationRoot,
      });
    } catch (err) {
      log.warn(`failed to seed personal automation tasks: ${(err as Error).message}`);
    }
```

- [ ] **Step 4: Ensure Engine Provides Primary Agent Id**

Find where `new StudioCronService` is constructed. Pass:

```ts
getPrimaryAgentId: () => this.agent?.id || this.currentAgentId || null
```

If the constructor site cannot access `this.agent`, use:

```ts
getPrimaryAgentId: () => this.listAgents?.()[0]?.id || null
```

The implementation must use an existing engine property visible at that construction site.

- [ ] **Step 5: Run service tests**

```powershell
npm test -- tests/personal-task-seed.test.ts tests/studio-cron-service.test.ts tests/desk-route-cron.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add core/studio-cron-service.ts tests/personal-task-seed.test.ts
git commit -m "feat: seed personal tasks in studio cron service"
```

## Quality Gate

Run:

```powershell
node scripts/hana-agent-quality-harness.mjs --stage tasks
npm run typecheck
```

Expected:

- The two native tasks are present after studio cron service loads.
- Running seed twice does not duplicate tasks.
- Missing Codex contract creates disabled Hana templates.
- Imported Codex paths are copied into `personalTask.outputPath`.
- Reviewers confirm the implementation does not delete or mutate Codex files.
