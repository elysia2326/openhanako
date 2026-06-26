import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";
import { CronStore } from "../lib/desk/cron-store.ts";
import { loadCodexAutomationContracts } from "../lib/desk/personal-tasks/codex-automation-import.ts";
import { PERSONAL_TASK_DEFINITIONS } from "../lib/desk/personal-tasks/personal-task-definitions.ts";
import { seedPersonalTasks } from "../lib/desk/personal-tasks/personal-task-seed.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "fixtures", "personal-tasks", "codex-automation-sample.json");

function makeTmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "personal-task-seed-"));
  return {
    root: dir,
    store: new CronStore(path.join(dir, "cron-jobs.json"), path.join(dir, "cron-runs")),
  };
}

function writeCodexFile(root: string, relativePath: string, content: unknown) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + "\n", "utf-8");
}

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

describe("Codex automation import", () => {
  it("loads contracts from automations.json object shape", () => {
    const { root } = makeTmpStore();
    const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
    writeCodexFile(root, "automations.json", { automations: fixtures });

    const contracts = loadCodexAutomationContracts(root);

    expect(Array.from(contracts.keys())).toEqual([
      "GitHub整理",
      "数字政府资料查找并整理",
    ]);
    expect(contracts.get("GitHub整理")).toMatchObject({
      title: "GitHub整理",
      scheduleType: "cron",
      schedule: "0 9 * * *",
      outputPath: "D:\\obsidian\\GitHub整理.md",
    });
  });

  it("falls back to .codex/tasks.json array shape and ignores invalid earlier files", () => {
    const { root } = makeTmpStore();
    const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
    fs.writeFileSync(path.join(root, "automations.json"), "{ broken json", "utf-8");
    fs.writeFileSync(path.join(root, "automation.json"), "{ broken json", "utf-8");
    fs.writeFileSync(path.join(root, "tasks.json"), "{ broken json", "utf-8");
    writeCodexFile(root, ".codex/tasks.json", fixtures);

    const contracts = loadCodexAutomationContracts(root);

    expect(contracts.size).toBe(2);
    expect(contracts.get("数字政府资料查找并整理")).toMatchObject({
      title: "数字政府资料查找并整理",
      prompt: expect.any(String),
    });
  });

  it("scans all known files without overwriting earlier contracts with the same title", () => {
    const { root } = makeTmpStore();
    writeCodexFile(root, "automations.json", {
      automations: [
        {
          title: "GitHub整理",
          scheduleType: "cron",
          schedule: "15 8 * * *",
          prompt: "github from first file",
          outputPath: "D:\\obsidian\\github-first.md",
        },
      ],
    });
    writeCodexFile(root, "tasks.json", {
      tasks: [
        {
          title: "GitHub整理",
          scheduleType: "cron",
          schedule: "45 8 * * *",
          prompt: "github from later file",
          outputPath: "D:\\obsidian\\github-later.md",
        },
        {
          title: "数字政府资料查找并整理",
          scheduleType: "cron",
          schedule: "0 10 * * *",
          prompt: "digital government from later file",
          outputPath: "D:\\obsidian\\digital-later.md",
        },
      ],
    });

    const contracts = loadCodexAutomationContracts(root);

    expect(contracts.get("GitHub整理")).toMatchObject({
      prompt: "github from first file",
      outputPath: "D:\\obsidian\\github-first.md",
    });
    expect(contracts.get("数字政府资料查找并整理")).toMatchObject({
      prompt: "digital government from later file",
      outputPath: "D:\\obsidian\\digital-later.md",
    });
  });
});

describe("personal task seed", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("seeds imported jobs with personalTask metadata and stays idempotent", () => {
    const { root, store } = makeTmpStore();
    roots.push(root);
    const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
    writeCodexFile(root, "automations.json", { automations: fixtures });

    const first = seedPersonalTasks({
      store,
      codexAutomationRoot: root,
      getPrimaryAgentId: () => "agent-a",
    });
    const second = seedPersonalTasks({
      store,
      codexAutomationRoot: root,
      getPrimaryAgentId: () => "agent-a",
    });

    expect(first).toMatchObject({ created: 2, skipped: 0, disabled: 0 });
    expect(second).toMatchObject({ created: 0, skipped: 2, disabled: 0 });

    const jobs = store.listJobs();
    const githubJob = jobs.find((job) => job.personalTask?.key === "github_digest");
    const digitalGovernmentJob = jobs.find((job) => job.personalTask?.key === "digital_government_research");
    expect(jobs).toHaveLength(2);
    expect(githubJob).toMatchObject({
      enabled: true,
      modelPolicyKey: "automation_cheap",
      personalTask: expect.objectContaining({
        key: "github_digest",
        source: "codex_import",
        codexTitle: "GitHub整理",
        outputPath: "D:\\obsidian\\GitHub整理.md",
      }),
    });
    expect(githubJob.prompt).toContain("GitHub整理");
    expect(githubJob.prompt).toContain("cachePolicy");
    expect(githubJob.prompt).toContain("failurePolicy");
    expect(digitalGovernmentJob).toMatchObject({
      enabled: true,
      modelPolicyKey: "automation_cheap",
      personalTask: expect.objectContaining({
        key: "digital_government_research",
        source: "codex_import",
        codexTitle: "数字政府资料查找并整理",
      }),
    });
  });

  it("supports plan parameter names and injected time for imported metadata", () => {
    const { root, store } = makeTmpStore();
    roots.push(root);
    const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
    const injectedNow = new Date("2026-06-25T00:00:00.000Z");
    writeCodexFile(root, "automations.json", { automations: fixtures });

    const result = seedPersonalTasks({
      store,
      actorAgentId: "agent-a",
      codexRoot: root,
      now: () => injectedNow,
    });

    expect(result).toMatchObject({ created: 2, skipped: 0, disabled: 0 });
    const jobs = store.listJobs();
    expect(jobs.every((job) => job.createdAt === injectedNow.toISOString())).toBe(true);
    expect(jobs.every((job) => job.personalTask?.importedAt === injectedNow.toISOString())).toBe(true);
  });

  it("creates disabled templates when the primary agent id is missing", () => {
    const { root, store } = makeTmpStore();
    roots.push(root);
    const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
    writeCodexFile(root, "automations.json", { automations: fixtures });

    const result = seedPersonalTasks({
      store,
      codexAutomationRoot: root,
      getPrimaryAgentId: () => null,
    });

    expect(result).toMatchObject({ created: 0, skipped: 0, disabled: 2 });
    expect(store.listJobs()).toHaveLength(2);
    expect(store.listJobs().every((job) => job.enabled === false)).toBe(true);
    expect(store.listJobs().every((job) => job.personalTask?.source === "hana_template")).toBe(true);
  });
});
