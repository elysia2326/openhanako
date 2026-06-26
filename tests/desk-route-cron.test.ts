import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioCronService } from "../core/studio-cron-service.ts";

function writeLegacyJobs(root, agentId, jobs) {
  const deskDir = path.join(root, "agents", agentId, "desk");
  fs.mkdirSync(deskDir, { recursive: true });
  fs.writeFileSync(
    path.join(deskDir, "cron-jobs.json"),
    JSON.stringify({ jobs, nextNum: jobs.length + 1 }, null, 2) + "\n",
    "utf-8",
  );
}

function createApp(engine: any, hubOverride: any = { scheduler: { getHeartbeat: vi.fn() } }) {
  return import("../server/routes/desk.ts").then(({ createDeskRoute }) => {
    const app = new Hono();
    app.route("/api", createDeskRoute(engine, hubOverride));
    return app;
  });
}

describe("desk cron route", () => {
  const roots = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("lists the studio cron store independent of the focused agent", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-desk-cron-"));
    roots.push(root);
    const agentsDir = path.join(root, "agents");
    writeLegacyJobs(root, "agent-a", [
      { id: "job_1", type: "cron", schedule: "0 9 * * *", prompt: "a", label: "A", enabled: true, nextRunAt: "2026-05-21T01:00:00.000Z" },
    ]);
    writeLegacyJobs(root, "agent-b", [
      { id: "job_1", type: "cron", schedule: "0 10 * * *", prompt: "b", label: "B", enabled: true, nextRunAt: "2026-05-21T02:00:00.000Z" },
    ]);
    const service = new StudioCronService({ hanakoHome: root, agentsDir, getStudioId: () => "studio-main" });
    const engine = {
      currentAgentId: "agent-a",
      getAgent: (id) => ({ id, agentName: id }),
      getStudioCronStore: () => service,
      listAgents: () => [],
    };
    const app = await createApp(engine);

    const first = await app.request("/api/desk/cron");
    engine.currentAgentId = "agent-b";
    const second = await app.request("/api/desk/cron");

    const firstJobs = (await first.json()).jobs.filter((job) => !job.personalTask);
    const secondJobs = (await second.json()).jobs.filter((job) => !job.personalTask);
    expect(firstJobs.map((job) => job.actorAgentId).sort()).toEqual(["agent-a", "agent-b"]);
    expect(secondJobs.map((job) => job.actorAgentId).sort()).toEqual(["agent-a", "agent-b"]);
    expect(secondJobs.map((job) => job.id).sort()).toEqual(firstJobs.map((job) => job.id).sort());
  });

  it("returns a route error when the cron store is unavailable", async () => {
    const app = await createApp({
      getStudioCronStore: () => null,
      listAgents: () => [],
    });

    const res = await app.request("/api/desk/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", id: "job_missing" }),
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: {
        code: "cron_store_unavailable",
        message: "Desk not initialized",
      },
    });
  });

  it("returns a route error for unknown cron actions", async () => {
    const app = await createApp({
      getStudioCronStore: () => ({ listJobs: () => [] }),
      listAgents: () => [],
    });

    const res = await app.request("/api/desk/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "snooze" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "unknown_cron_action",
        message: "unknown action: snooze",
      },
    });
  });

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
    service.logRun(job.id, {
      id: "run_1",
      status: "success",
      startedAt: "2026-06-25T00:00:00.000Z",
      summary: "api_key: gsk_1234567890abcdefghijklmnopqrst",
      outputPath: "D:\\obsidian\\out.md?token=file-token-value",
      modelDecision: { reason: "Bearer abc.def+/tail==" },
    });
    const app = await createApp({
      getAgent: (id) => ({ id, agentName: id }),
      getStudioCronStore: () => service,
      listAgents: () => [],
    });

    const res = await app.request(`/api/desk/cron/${job.id}/runs?limit=10`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      runs: [expect.objectContaining({ id: "run_1", jobId: job.id, status: "done" })],
    });
    expect(JSON.stringify(body)).not.toContain("gsk_1234567890abcdefghijklmnopqrst");
    expect(JSON.stringify(body)).not.toContain("file-token-value");
    expect(JSON.stringify(body)).not.toContain("abc.def+/tail==");
  });

  it("redacts secrets before run history is written to disk", async () => {
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

    service.logRun(job.id, {
      id: "run_secret",
      status: "success",
      summary: "Authorization: Bearer raw.secret",
      error: "api_key=raw-key",
      outputPath: "D:\\obsidian\\out.md?token=raw-url-token",
      modelDecision: {
        reason: "Authorization: Bearer raw.nested",
        api_key: "raw-structured-key",
      },
    });

    const runFile = path.join(root, "studios", "studio-main", "desk", "cron-runs", `${job.id}.jsonl`);
    const persisted = fs.readFileSync(runFile, "utf-8");

    expect(persisted).not.toContain("raw.secret");
    expect(persisted).not.toContain("raw-key");
    expect(persisted).not.toContain("raw-url-token");
    expect(persisted).not.toContain("raw.nested");
    expect(persisted).not.toContain("raw-structured-key");
    expect(persisted).toContain("[redacted]");
  });

  it("runs a cron job immediately through the scheduler", async () => {
    const service = {
      getJob: vi.fn((id) => id === "job_1" ? { id: "job_1", label: "Run Now" } : null),
      listJobs: vi.fn(() => []),
    };
    const runCronJobNow = vi.fn(async (id, options) => ({ jobId: id, status: "done", fusionOnce: options.fusionOnce }));
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
    expect(await res.json()).toEqual({ ok: true, run: { jobId: "job_1", status: "done", fusionOnce: true } });
    expect(runCronJobNow).toHaveBeenCalledWith("job_1", { fusionOnce: true });
  });

  it("does not persist fusionOnce when running a cron job immediately", async () => {
    const job = { id: "job_1", label: "Run Now", fusion: { enabled: false } };
    const service = {
      getJob: vi.fn(() => job),
      updateJob: vi.fn(),
      listJobs: vi.fn(() => [job]),
    };
    const runCronJobNow = vi.fn(async (id, options) => ({
      jobId: id,
      status: "done",
      fusion: options.fusionOnce ? { enabled: true, status: "done" } : null,
    }));
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
    expect(runCronJobNow).toHaveBeenCalledWith("job_1", { fusionOnce: true });
    expect(service.updateJob).not.toHaveBeenCalled();
  });

  it("persists fusion config through add and update cron routes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-desk-cron-"));
    roots.push(root);
    const service = new StudioCronService({
      hanakoHome: root,
      agentsDir: path.join(root, "agents"),
      getStudioId: () => "studio-main",
    });
    const engine = {
      getAgent: (id) => (id === "agent-a" ? { id, agentName: "Agent A" } : null),
      getStudioCronStore: () => service,
      listAgents: () => [],
    };
    const app = await createApp(engine);

    const addRes = await app.request("/api/desk/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        scheduleType: "cron",
        schedule: "0 9 * * *",
        prompt: "fusion job",
        actorAgentId: "agent-a",
        executionContext: {
          kind: "session_workspace",
          cwd: "/workspace/a",
          workspaceFolders: [],
          sourceSessionPath: "/sessions/a.jsonl",
          createdByAgentId: "agent-a",
        },
        fusion: {
          enabled: true,
          enabledOnce: false,
          importance: "important",
          reviewerPolicies: ["automation_cheap", "daily", "invalid"],
          judgePolicy: "fusion_judge",
          finalizerPolicy: "fusion_finalizer",
        },
      }),
    });

    expect(addRes.status).toBe(200);
    const added = await addRes.json();
    expect(added.job.fusion).toEqual({
      enabled: true,
      enabledOnce: false,
      importance: "important",
      reviewerPolicies: ["automation_cheap", "daily"],
      judgePolicy: "fusion_judge",
      finalizerPolicy: "fusion_finalizer",
    });

    const updateRes = await app.request("/api/desk/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        id: added.job.id,
        fusion: { enabled: false, importance: "critical", reviewerPolicies: ["hard"] },
      }),
    });

    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json();
    expect(updated.job.fusion).toEqual({
      enabled: false,
      importance: "critical",
      reviewerPolicies: ["hard"],
    });
  });

  it("mutates jobs by studio job id without resolving the focused agent", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-desk-cron-"));
    roots.push(root);
    const agentsDir = path.join(root, "agents");
    const service = new StudioCronService({ hanakoHome: root, agentsDir, getStudioId: () => "studio-main" });
    const job = service.addJob({
      type: "cron",
      schedule: "0 9 * * *",
      prompt: "studio job",
      label: "Studio Job",
      actorAgentId: "agent-a",
      executionContext: {
        kind: "session_workspace",
        cwd: "/workspace/a",
        workspaceFolders: ["/workspace/ref"],
        sourceSessionPath: "/sessions/a.jsonl",
        createdByAgentId: "agent-a",
      },
    });
    const getAgent = vi.fn((id) => ({ id, agentName: id }));
    const engine = {
      currentAgentId: "agent-b",
      getAgent,
      getStudioCronStore: () => service,
      listAgents: () => [],
    };
    const app = await createApp(engine);

    const res = await app.request("/api/desk/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", id: job.id }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).job.enabled).toBe(false);
    expect(service.getJob(job.id).enabled).toBe(false);
    expect(getAgent).not.toHaveBeenCalledWith("agent-b");
  });

  it("updates schedule type and normalizes interval minutes", async () => {
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
    const app = await createApp({
      getAgent: (id) => ({ id, agentName: id }),
      getStudioCronStore: () => service,
      listAgents: () => [],
    });

    const res = await app.request("/api/desk/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", id: job.id, type: "every", schedule: "120" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.job.type).toBe("every");
    expect(data.job.schedule).toBe(7_200_000);
  });

  it("adds every schedules with numeric milliseconds without double-normalizing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-desk-cron-"));
    roots.push(root);
    const service = new StudioCronService({
      hanakoHome: root,
      agentsDir: path.join(root, "agents"),
      getStudioId: () => "studio-main",
    });
    const app = await createApp({
      getAgent: (id) => (id === "agent-a" ? { id, agentName: "Agent A" } : null),
      getStudioCronStore: () => service,
      listAgents: () => [],
    });

    const res = await app.request("/api/desk/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        scheduleType: "every",
        schedule: 7_200_000,
        prompt: "every two hours",
        actorAgentId: "agent-a",
        executionContext: {
          kind: "session_workspace",
          cwd: "/workspace/a",
          workspaceFolders: [],
          sourceSessionPath: "/sessions/a.jsonl",
          createdByAgentId: "agent-a",
        },
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.job.type).toBe("every");
    expect(data.job.schedule).toBe(7_200_000);
  });

  it("updates every schedules with numeric milliseconds without double-normalizing", async () => {
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
    const app = await createApp({
      getAgent: (id) => ({ id, agentName: id }),
      getStudioCronStore: () => service,
      listAgents: () => [],
    });

    const res = await app.request("/api/desk/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", id: job.id, type: "every", schedule: 7_200_000 }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.job.type).toBe("every");
    expect(data.job.schedule).toBe(7_200_000);
  });

  it("adds studio jobs only with explicit actorAgentId and executionContext", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-desk-cron-"));
    roots.push(root);
    const service = new StudioCronService({
      hanakoHome: root,
      agentsDir: path.join(root, "agents"),
      getStudioId: () => "studio-main",
    });
    const engine = {
      getAgent: (id) => (id === "agent-a" ? { id, agentName: "Agent A" } : null),
      getStudioCronStore: () => service,
      listAgents: () => [],
    };
    const app = await createApp(engine);

    const missing = await app.request("/api/desk/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", scheduleType: "cron", schedule: "0 9 * * *", prompt: "missing actor" }),
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "actorAgentId and executionContext required" });

    const res = await app.request("/api/desk/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        scheduleType: "cron",
        schedule: "0 9 * * *",
        prompt: "explicit context",
        label: "Explicit Context",
        actorAgentId: "agent-a",
        executionContext: {
          kind: "session_workspace",
          cwd: "/workspace/a",
          workspaceFolders: ["/workspace/ref"],
          sourceSessionPath: "/sessions/a.jsonl",
          createdByAgentId: "agent-a",
        },
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.job).toEqual(expect.objectContaining({
      actorAgentId: "agent-a",
      executionContext: {
        kind: "session_workspace",
        cwd: "/workspace/a",
        workspaceFolders: ["/workspace/ref"],
        sourceSessionPath: "/sessions/a.jsonl",
        createdByAgentId: "agent-a",
      },
    }));
  });

  it("allows creating a disabled Agent automation draft without a prompt", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-desk-cron-"));
    roots.push(root);
    const service = new StudioCronService({
      hanakoHome: root,
      agentsDir: path.join(root, "agents"),
      getStudioId: () => "studio-main",
    });
    const engine = {
      getAgent: (id) => (id === "agent-a" ? { id, agentName: "Agent A" } : null),
      getStudioCronStore: () => service,
      listAgents: () => [],
    };
    const app = await createApp(engine);

    const res = await app.request("/api/desk/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        scheduleType: "cron",
        schedule: "0 9 * * *",
        prompt: "",
        label: "Draft",
        enabled: false,
        actorAgentId: "agent-a",
        executionContext: {
          kind: "ui_manual",
          cwd: "/workspace/a",
          workspaceFolders: [],
          sourceSessionPath: "/sessions/a.jsonl",
          createdByAgentId: "agent-a",
        },
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.job).toEqual(expect.objectContaining({
      prompt: "",
      label: "Draft",
      enabled: false,
      actorAgentId: "agent-a",
    }));
  });

  it("rejects enabling an Agent automation draft while prompt is empty", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-desk-cron-"));
    roots.push(root);
    const service = new StudioCronService({
      hanakoHome: root,
      agentsDir: path.join(root, "agents"),
      getStudioId: () => "studio-main",
    });
    const engine = {
      getAgent: (id) => (id === "agent-a" ? { id, agentName: "Agent A" } : null),
      getStudioCronStore: () => service,
      listAgents: () => [],
    };
    const app = await createApp(engine);
    const job = service.addJob({
      type: "cron",
      schedule: "0 9 * * *",
      prompt: "",
      label: "Draft",
      enabled: false,
      actorAgentId: "agent-a",
      executionContext: {
        kind: "ui_manual",
        cwd: "/workspace/a",
        workspaceFolders: [],
        sourceSessionPath: "/sessions/a.jsonl",
        createdByAgentId: "agent-a",
      },
    });

    const res = await app.request("/api/desk/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", id: job.id, enabled: true }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "prompt required to enable agent automation" });
    expect(service.getJob(job.id).enabled).toBe(false);
  });

  it("rejects toggling an empty Agent automation draft on", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-desk-cron-"));
    roots.push(root);
    const service = new StudioCronService({
      hanakoHome: root,
      agentsDir: path.join(root, "agents"),
      getStudioId: () => "studio-main",
    });
    const engine = {
      getAgent: (id) => (id === "agent-a" ? { id, agentName: "Agent A" } : null),
      getStudioCronStore: () => service,
      listAgents: () => [],
    };
    const app = await createApp(engine);
    const job = service.addJob({
      type: "cron",
      schedule: "0 9 * * *",
      prompt: "",
      label: "Draft",
      enabled: false,
      actorAgentId: "agent-a",
      executionContext: {
        kind: "ui_manual",
        cwd: "/workspace/a",
        workspaceFolders: [],
        sourceSessionPath: "/sessions/a.jsonl",
        createdByAgentId: "agent-a",
      },
    });

    const res = await app.request("/api/desk/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", id: job.id }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "prompt required to enable agent automation" });
    expect(service.getJob(job.id).enabled).toBe(false);
  });

  it("rejects direct notify executors through the cron compatibility route", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-desk-cron-"));
    roots.push(root);
    const service = new StudioCronService({
      hanakoHome: root,
      agentsDir: path.join(root, "agents"),
      getStudioId: () => "studio-main",
    });
    const engine = {
      getAgent: (id) => (id === "agent-a" ? { id, agentName: "Agent A" } : null),
      getStudioCronStore: () => service,
      listAgents: () => [],
    };
    const app = await createApp(engine);

    const res = await app.request("/api/desk/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        scheduleType: "cron",
        schedule: "0 9 * * *",
        label: "Drink Water",
        actorAgentId: "agent-a",
        executionContext: {
          kind: "session_workspace",
          cwd: "/workspace/a",
          workspaceFolders: [],
          sourceSessionPath: "/sessions/a.jsonl",
          createdByAgentId: "agent-a",
        },
        executor: {
          kind: "direct_action",
          action: "notify",
          params: {
            title: "喝水",
            body: "站起来活动一下",
            channels: ["desktop"],
          },
        },
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unsupported automation executor: direct_action" });
    expect(service.listJobs().filter((job) => !job.personalTask)).toEqual([]);
  });

  it("rejects plugin-action executors through the cron compatibility route", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-desk-cron-"));
    roots.push(root);
    const service = new StudioCronService({
      hanakoHome: root,
      agentsDir: path.join(root, "agents"),
      getStudioId: () => "studio-main",
    });
    const engine = {
      getAgent: (id) => (id === "agent-a" ? { id, agentName: "Agent A" } : null),
      getStudioCronStore: () => service,
      listAgents: () => [],
    };
    const app = await createApp(engine);

    const res = await app.request("/api/desk/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        scheduleType: "cron",
        schedule: "0 18 * * *",
        label: "Daily Note",
        actorAgentId: "agent-a",
        executionContext: {
          kind: "session_workspace",
          cwd: "/workspace/a",
          workspaceFolders: [],
          sourceSessionPath: "/sessions/a.jsonl",
          createdByAgentId: "agent-a",
        },
        executor: {
          kind: "plugin_action",
          pluginId: "notes",
          actionId: "create_note",
          params: { title: "Today" },
        },
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unsupported automation executor: plugin_action" });
    expect(service.listJobs().filter((job) => !job.personalTask)).toEqual([]);
  });

  it("rejects removed file.create direct-action jobs through the cron route", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-desk-cron-"));
    roots.push(root);
    const service = new StudioCronService({
      hanakoHome: root,
      agentsDir: path.join(root, "agents"),
      getStudioId: () => "studio-main",
    });
    const engine = {
      getAgent: (id) => (id === "agent-a" ? { id, agentName: "Agent A" } : null),
      getStudioCronStore: () => service,
      listAgents: () => [],
    };
    const app = await createApp(engine);

    const res = await app.request("/api/desk/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        scheduleType: "cron",
        schedule: "0 18 * * *",
        actorAgentId: "agent-a",
        executionContext: {
          kind: "session_workspace",
          cwd: "/workspace/a",
          workspaceFolders: [],
          sourceSessionPath: "/sessions/a.jsonl",
          createdByAgentId: "agent-a",
        },
        executor: {
          kind: "direct_action",
          action: "file.create",
          params: { relativePath: "notes/today.md", content: "# Today\n" },
        },
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unsupported automation executor: direct_action" });
    expect(service.listJobs().filter((job) => !job.personalTask)).toEqual([]);
  });
});
