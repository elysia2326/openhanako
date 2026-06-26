import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createCronSchedulerMock, schedulers } = vi.hoisted(() => ({
  createCronSchedulerMock: vi.fn(),
  schedulers: [],
}));

vi.mock("../lib/desk/cron-scheduler.js", () => ({
  createCronScheduler: createCronSchedulerMock,
}));

vi.mock("../lib/desk/heartbeat.js", () => ({
  HEARTBEAT_ACTIVITY_DIR: ".hana-heartbeat",
  createHeartbeat: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../lib/fresh-compact/daily-scheduler.js", () => ({
  createFreshCompactDailyScheduler: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}));

vi.mock("../hub/fresh-compact-maintainer.js", () => ({
  FreshCompactMaintainer: vi.fn().mockImplementation(function () {
    this.runDaily = vi.fn();
  }),
}));

import { Scheduler } from "../hub/scheduler.ts";
import { automationModelRoutingStore } from "../lib/desk/model-routing/model-routing-store.ts";

describe("Scheduler studio cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    automationModelRoutingStore.clearAll();
    schedulers.length = 0;
    createCronSchedulerMock.mockImplementation((opts) => {
      const scheduler = {
        opts,
        start: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
        checkJobs: vi.fn(),
      };
      schedulers.push(scheduler);
      return scheduler;
    });
  });

  it("starts one studio cron scheduler instead of one scheduler per agent directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-scheduler-cron-"));
    try {
      fs.mkdirSync(path.join(root, "agents", "agent-a"), { recursive: true });
      fs.mkdirSync(path.join(root, "agents", "agent-b"), { recursive: true });
      const studioStore = { listJobs: vi.fn(() => []) };
      const engine = {
        agentsDir: path.join(root, "agents"),
        agents: new Map(),
        getStudioCronStore: () => studioStore,
        getHeartbeatMaster: () => false,
      };

      const scheduler = new Scheduler({ hub: { engine, eventBus: { emit: vi.fn() } } });
      scheduler.start();

      expect(createCronSchedulerMock).toHaveBeenCalledTimes(1);
      expect(createCronSchedulerMock.mock.calls[0][0].cronStore).toBe(studioStore);
      expect(schedulers[0].start).toHaveBeenCalledOnce();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("executes a studio cron job with its actorAgentId and captured executionContext", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-scheduler-cron-"));
    try {
      const agentsDir = path.join(root, "agents");
      fs.mkdirSync(path.join(agentsDir, "agent-a"), { recursive: true });
      fs.mkdirSync(path.join(agentsDir, "agent-b"), { recursive: true });
      const activityStore = { add: vi.fn() };
      const executeIsolated = vi.fn(async (_prompt: string, _opts: any) => ({ sessionPath: "", error: null }));
      const engine = {
        agentsDir,
        agents: new Map(),
        getStudioCronStore: () => ({ listJobs: vi.fn(() => []) }),
        getHeartbeatMaster: () => false,
        ensureAgentRuntime: vi.fn(async (agentId) => ({ id: agentId, agentName: agentId })),
        getAgent: vi.fn((agentId) => ({ id: agentId, agentName: agentId })),
        executeIsolated,
        summarizeActivity: vi.fn(),
        getActivityStore: vi.fn(() => activityStore),
        emitDevLog: vi.fn(),
      };
      const eventBus = { emit: vi.fn() };
      const scheduler = new Scheduler({ hub: { engine, eventBus } });
      scheduler.start();
      const executeJob = createCronSchedulerMock.mock.calls[0][0].executeJob;

      await executeJob({
        id: "studio_job_1",
        label: "Agent B workspace job",
        prompt: "run in b",
        model: { id: "gpt-test", provider: "openai" },
        actorAgentId: "agent-b",
        executionContext: {
          kind: "session_workspace",
          cwd: "/workspace/b",
          workspaceFolders: ["/workspace/ref"],
          sourceSessionPath: "/sessions/b.jsonl",
          createdByAgentId: "agent-b",
        },
      });

      expect(executeIsolated).toHaveBeenCalledWith(
        expect.stringContaining("run in b"),
        expect.objectContaining({
          agentId: "agent-b",
          cwd: "/workspace/b",
          workspaceFolders: ["/workspace/ref"],
          parentSessionPath: "/sessions/b.jsonl",
          model: { id: "gpt-test", provider: "openai" },
          activityType: "cron",
        }),
      );
      expect(activityStore.add).toHaveBeenCalledWith(expect.objectContaining({
        type: "cron",
        agentId: "agent-b",
        label: "Agent B workspace job",
      }));
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "activity_update" }),
        null,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns cron run metadata and stores cron activity below automation archive", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-scheduler-cron-"));
    try {
      const agentsDir = path.join(root, "agents");
      fs.mkdirSync(path.join(agentsDir, "agent-a"), { recursive: true });
      const activityStore = { add: vi.fn() };
      const sessionPath = path.join(agentsDir, "agent-a", "activity", "automation", "cron_1.jsonl");
      const executeIsolated = vi.fn(async (_prompt: string, _opts: any) => ({ sessionPath, error: null }));
      const engine = {
        agentsDir,
        agents: new Map(),
        getStudioCronStore: () => ({ listJobs: vi.fn(() => []) }),
        getHeartbeatMaster: () => false,
        ensureAgentRuntime: vi.fn(async (agentId) => ({ id: agentId, agentName: agentId })),
        getAgent: vi.fn((agentId) => ({ id: agentId, agentName: agentId })),
        executeIsolated,
        summarizeActivity: vi.fn(async () => "整理完成"),
        getActivityStore: vi.fn(() => activityStore),
        emitDevLog: vi.fn(),
      };
      const eventBus = { emit: vi.fn() };
      const scheduler = new Scheduler({ hub: { engine, eventBus } });
      scheduler.start();
      const executeJob = createCronSchedulerMock.mock.calls[0][0].executeJob;

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
        sessionPath,
        sessionFile: "cron_1.jsonl",
        summary: "整理完成",
        status: "done",
      }));
      expect(executeIsolated).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          persist: path.join(agentsDir, "agent-a", "activity", "automation"),
          activityType: "cron",
        }),
      );
      expect(activityStore.add).toHaveBeenCalledWith(expect.objectContaining({
        type: "cron",
        sessionFile: "cron_1.jsonl",
        status: "done",
      }));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("runCronJobNow returns the completed run status after synchronous execution", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-scheduler-cron-"));
    try {
      const agentsDir = path.join(root, "agents");
      fs.mkdirSync(path.join(agentsDir, "agent-a"), { recursive: true });
      const activityStore = { add: vi.fn() };
      const runs: any[] = [];
      const job = {
        id: "studio_job_now",
        label: "Run Now",
        prompt: "run now",
        actorAgentId: "agent-a",
        executionContext: {
          kind: "session_workspace",
          cwd: "/workspace/a",
          workspaceFolders: [],
          sourceSessionPath: "/sessions/a.jsonl",
          createdByAgentId: "agent-a",
        },
      };
      const engine = {
        agentsDir,
        agents: new Map(),
        availableModels: [{ id: "deepseek-chat", provider: "deepseek" }],
        getStudioCronStore: () => ({
          listJobs: vi.fn(() => []),
          getJob: vi.fn((id) => id === job.id ? job : null),
          logRun: vi.fn((id, run) => runs.push({ id, run })),
        }),
        getHeartbeatMaster: () => false,
        ensureAgentRuntime: vi.fn(async (agentId) => ({ id: agentId, agentName: agentId })),
        getAgent: vi.fn((agentId) => ({ id: agentId, agentName: agentId })),
        executeIsolated: vi.fn(async () => ({ sessionPath: "", error: null })),
        summarizeActivity: vi.fn(),
        getActivityStore: vi.fn(() => activityStore),
        emitDevLog: vi.fn(),
      };
      const scheduler = new Scheduler({ hub: { engine, eventBus: { emit: vi.fn() } } });

      const run = await scheduler.runCronJobNow(job.id, { fusionOnce: true });

      expect(run).toEqual(expect.objectContaining({ jobId: job.id, status: "done" }));
      expect(runs[0].run.status).toBe("done");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs fusion after the primary cron result when enabled once", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-scheduler-cron-"));
    try {
      const agentsDir = path.join(root, "agents");
      fs.mkdirSync(path.join(agentsDir, "agent-a"), { recursive: true });
      const activityStore = { add: vi.fn() };
      const executeIsolated: any = vi.fn(async () => ({ sessionPath: path.join(agentsDir, "agent-a", "activity", "automation", "cron_1.jsonl"), error: null }));
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
      expect(executeIsolated.mock.calls[1][0]).toContain("独立复核");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the primary cron result successful when fusion fails", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-scheduler-cron-"));
    try {
      const agentsDir = path.join(root, "agents");
      fs.mkdirSync(path.join(agentsDir, "agent-a"), { recursive: true });
      const activityStore = { add: vi.fn() };
      const executeIsolated: any = vi
        .fn()
        .mockResolvedValueOnce({
          sessionPath: path.join(agentsDir, "agent-a", "activity", "automation", "cron_1.jsonl"),
          error: null,
        })
        .mockRejectedValueOnce(new Error("fusion reviewer unavailable"));
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
        summarizeActivity: vi.fn(async (sessionPath) => `summary:${sessionPath}`),
        getActivityStore: vi.fn(() => activityStore),
        emitDevLog: vi.fn(),
      };
      const scheduler = new Scheduler({ hub: { engine, eventBus: { emit: vi.fn() } } });
      scheduler.start();
      const executeJob = createCronSchedulerMock.mock.calls[0][0].executeJob;

      const result = await executeJob({
        id: "studio_job_fusion_error",
        label: "Important job",
        prompt: "run important",
        actorAgentId: "agent-a",
        fusion: { enabled: true },
        executionContext: {
          kind: "session_workspace",
          cwd: "/workspace/a",
          workspaceFolders: [],
          sourceSessionPath: "/sessions/a.jsonl",
          createdByAgentId: "agent-a",
        },
      });

      expect(result.error).toBeNull();
      expect(result.fusion).toEqual(expect.objectContaining({
        enabled: true,
        status: "error",
        error: "fusion reviewer unavailable",
      }));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("executes agent_session cron jobs through the executor read model", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-scheduler-cron-"));
    try {
      const agentsDir = path.join(root, "agents");
      fs.mkdirSync(path.join(agentsDir, "agent-a"), { recursive: true });
      const activityStore = { add: vi.fn() };
      const executeIsolated = vi.fn(async (_prompt: string, _opts: any) => ({ sessionPath: "", error: null }));
      const engine = {
        agentsDir,
        agents: new Map(),
        getStudioCronStore: () => ({ listJobs: vi.fn(() => []) }),
        getHeartbeatMaster: () => false,
        ensureAgentRuntime: vi.fn(async (agentId) => ({ id: agentId, agentName: agentId })),
        getAgent: vi.fn((agentId) => ({ id: agentId, agentName: agentId })),
        executeIsolated,
        summarizeActivity: vi.fn(),
        getActivityStore: vi.fn(() => activityStore),
        emitDevLog: vi.fn(),
      };
      const eventBus = { emit: vi.fn() };
      const scheduler = new Scheduler({ hub: { engine, eventBus } });
      scheduler.start();
      const executeJob = createCronSchedulerMock.mock.calls[0][0].executeJob;

      await executeJob({
        id: "studio_job_2",
        label: "Executor job",
        trigger: { kind: "cron", expression: "0 9 * * *" },
        executor: {
          kind: "agent_session",
          agentId: "agent-a",
          prompt: "run from executor",
          model: { id: "gpt-test", provider: "openai" },
          executionContext: {
            kind: "session_workspace",
            cwd: "/workspace/a",
            workspaceFolders: ["/workspace/ref"],
            sourceSessionPath: "/sessions/a.jsonl",
            createdByAgentId: "agent-a",
          },
        },
      });

      expect(executeIsolated).toHaveBeenCalledWith(
        expect.stringContaining("run from executor"),
        expect.objectContaining({
          agentId: "agent-a",
          cwd: "/workspace/a",
          workspaceFolders: ["/workspace/ref"],
          parentSessionPath: "/sessions/a.jsonl",
          model: { id: "gpt-test", provider: "openai" },
          activityType: "cron",
        }),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses the global automation permission mode for background Agent cron runs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-scheduler-cron-"));
    try {
      const agentsDir = path.join(root, "agents");
      fs.mkdirSync(path.join(agentsDir, "agent-a"), { recursive: true });
      const activityStore = { add: vi.fn() };
      const executeIsolated = vi.fn(async (_prompt: string, _opts: any) => ({ sessionPath: "", error: null }));
      const engine = {
        agentsDir,
        agents: new Map(),
        getStudioCronStore: () => ({ listJobs: vi.fn(() => []) }),
        getHeartbeatMaster: () => false,
        getAutomationPermissionMode: vi.fn(() => "auto"),
        ensureAgentRuntime: vi.fn(async (agentId) => ({ id: agentId, agentName: agentId })),
        getAgent: vi.fn((agentId) => ({ id: agentId, agentName: agentId })),
        executeIsolated,
        summarizeActivity: vi.fn(),
        getActivityStore: vi.fn(() => activityStore),
        emitDevLog: vi.fn(),
      };
      const eventBus = { emit: vi.fn() };
      const scheduler = new Scheduler({ hub: { engine, eventBus } });
      scheduler.start();
      const executeJob = createCronSchedulerMock.mock.calls[0][0].executeJob;

      await executeJob({
        id: "studio_job_auto",
        label: "Auto permission job",
        prompt: "run with default permission",
        actorAgentId: "agent-a",
        executionContext: {
          kind: "session_workspace",
          cwd: "/workspace/a",
          workspaceFolders: [],
          sourceSessionPath: "/sessions/a.jsonl",
          createdByAgentId: "agent-a",
        },
      });

      expect(engine.getAutomationPermissionMode).toHaveBeenCalledOnce();
      expect(executeIsolated).toHaveBeenCalledWith(
        expect.stringContaining("run with default permission"),
        expect.objectContaining({
          permissionMode: "auto",
          allowHumanApproval: false,
          activityType: "cron",
        }),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("routes automation jobs through the model policy when no explicit model is set", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-scheduler-cron-"));
    try {
      const agentsDir = path.join(root, "agents");
      fs.mkdirSync(path.join(agentsDir, "agent-a"), { recursive: true });
      const activityStore = { add: vi.fn() };
      const executeIsolated = vi.fn(async (_prompt: string, _opts: any) => {
        expect(automationModelRoutingStore.latest("studio_job_policy")?.phase).toBe("primary");
        return { sessionPath: "", error: null };
      });
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

      const executeResult = await executeJob({
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

      expect(executeIsolated.mock.calls[0][1]).toEqual(expect.objectContaining({
        model: { id: "deepseek-chat", provider: "deepseek" },
      }));
      expect(executeIsolated.mock.calls[0][1]).not.toHaveProperty("modelDecision");
      expect(activityStore.add).toHaveBeenCalledWith(expect.objectContaining({
        modelDecision: expect.objectContaining({ policyKey: "automation_cheap", phase: "primary" }),
      }));
      expect(executeResult.modelDecision).toEqual(expect.objectContaining({
        policyKey: "automation_cheap",
        phase: "primary",
      }));
      expect(automationModelRoutingStore.latest("studio_job_policy")).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("retries once with the same model and stops when retry succeeds", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-scheduler-cron-"));
    try {
      const agentsDir = path.join(root, "agents");
      fs.mkdirSync(path.join(agentsDir, "agent-a"), { recursive: true });
      const activityStore = { add: vi.fn() };
      const executeIsolated = vi
        .fn()
        .mockResolvedValueOnce({ sessionPath: "", error: "first failure" })
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

      const executeResult = await executeJob({
        id: "studio_job_retry_success",
        label: "Retry job",
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

      expect(executeIsolated).toHaveBeenCalledTimes(2);
      expect(executeIsolated.mock.calls[0][1].model).toEqual({ id: "deepseek-chat", provider: "deepseek" });
      expect(executeIsolated.mock.calls[1][1].model).toEqual({ id: "deepseek-chat", provider: "deepseek" });
      expect(executeIsolated.mock.calls[0][1]).not.toHaveProperty("modelDecision");
      expect(executeIsolated.mock.calls[1][1]).not.toHaveProperty("modelDecision");
      expect(activityStore.add).toHaveBeenCalledTimes(1);
      expect(activityStore.add).toHaveBeenCalledWith(expect.objectContaining({
        modelDecision: expect.objectContaining({ phase: "retry" }),
        modelAttempts: [
          expect.objectContaining({ phase: "primary" }),
          expect.objectContaining({ phase: "retry" }),
        ],
      }));
      expect(executeResult.modelAttempts.map((attempt) => attempt.phase)).toEqual(["primary", "retry"]);
      expect(executeResult.modelDecision.phase).toBe("retry");
      expect(automationModelRoutingStore.latest("studio_job_retry_success")).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to GPT only after primary and retry both fail", async () => {
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

      const executeResult = await executeJob({
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
      expect(executeIsolated.mock.calls[0][1]).not.toHaveProperty("modelDecision");
      expect(executeIsolated.mock.calls[1][1]).not.toHaveProperty("modelDecision");
      expect(executeIsolated.mock.calls[2][1]).not.toHaveProperty("modelDecision");
      expect(activityStore.add).toHaveBeenCalledTimes(1);
      expect(activityStore.add).toHaveBeenCalledWith(expect.objectContaining({
        modelDecision: expect.objectContaining({ phase: "fallback" }),
        modelAttempts: [
          expect.objectContaining({ phase: "primary" }),
          expect.objectContaining({ phase: "retry" }),
          expect.objectContaining({ phase: "fallback" }),
        ],
      }));
      expect(executeResult.modelAttempts.map((attempt) => attempt.phase)).toEqual(["primary", "retry", "fallback"]);
      expect(executeResult.modelDecision.phase).toBe("fallback");
      expect(automationModelRoutingStore.latest("studio_job_fallback")).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed if an unmigrated non-Agent automation executor reaches the scheduler", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-scheduler-cron-"));
    try {
      const agentsDir = path.join(root, "agents");
      fs.mkdirSync(path.join(agentsDir, "agent-a"), { recursive: true });
      const executeIsolated = vi.fn();
      const engine = {
        agentsDir,
        agents: new Map(),
        getStudioCronStore: () => ({ listJobs: vi.fn(() => []) }),
        getHeartbeatMaster: () => false,
        executeIsolated,
        emitDevLog: vi.fn(),
      };
      const scheduler = new Scheduler({ hub: { engine, eventBus: { emit: vi.fn() } } });
      scheduler.start();
      const executeJob = createCronSchedulerMock.mock.calls[0][0].executeJob;

      const result = executeJob({
        id: "studio_job_notify",
        label: "Drink Water",
        actorAgentId: "agent-a",
        executor: {
          kind: "direct_action",
          action: "notify",
          params: {
            title: "喝水",
            body: "站起来活动一下",
            channels: ["desktop"],
          },
        },
      });

      await expect(result).rejects.toThrow(/unsupported automation executor: direct_action/);
      expect(executeIsolated).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
