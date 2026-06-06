import { describe, expect, it, vi } from "vitest";
import { createAutomationTool } from "../lib/tools/automation-tool.ts";

function makeStore(id = "studio_job_1") {
  return {
    addJob: vi.fn((jobData) => ({ ...jobData, id, enabled: true })),
    listJobs: vi.fn(() => []),
  };
}

function deferredDecision() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((r) => { resolve = r; });
  return { promise, resolve };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("automation tool", () => {
  it("creates notify automations as Agent-run drafts and asks for confirmation by default", async () => {
    const store = makeStore();
    const decision = deferredDecision();
    const confirmStore = {
      create: vi.fn(() => ({
        confirmId: "confirm_1",
        promise: decision.promise,
      })),
    };
    const tool = createAutomationTool(store, {
      confirmStore,
      getAgentId: () => "agent-a",
      getSessionCwd: () => "/workspace/fallback",
      getSessionWorkspaceFolders: () => ["/workspace/ref"],
      getHomeCwd: () => "/home/agent-a",
    });

    const result = await tool.execute(
      "call_1",
      {
        action: "add_notify",
        scheduleType: "cron",
        schedule: "0 9 * * *",
        label: "Drink Water",
        title: "喝水",
        body: "站起来活动一下",
        channels: ["desktop"],
      },
      undefined,
      undefined,
      {
        sessionManager: {
          getSessionFile: () => "/sessions/agent-a.jsonl",
          getCwd: () => "/workspace/current",
        },
      },
    );

    expect(confirmStore.create).toHaveBeenCalledWith(
      "cron",
      { jobData: expect.objectContaining({ label: "Drink Water" }) },
      "/sessions/agent-a.jsonl",
    );
    expect(result.details).toMatchObject({
      action: "pending_add",
      confirmId: "confirm_1",
      jobData: expect.objectContaining({ label: "Drink Water" }),
    });
    expect(result.content[0].text).toContain("/confirm confirm_1");
    expect(result.content[0].text).toContain("/reject confirm_1");
    expect(store.addJob).not.toHaveBeenCalled();

    decision.resolve({ action: "confirmed" });
    await flushMicrotasks();

    expect(store.addJob).toHaveBeenCalledWith(expect.objectContaining({
      type: "cron",
      schedule: "0 9 * * *",
      prompt: expect.stringContaining("notify"),
      label: "Drink Water",
      actorAgentId: "agent-a",
      executionContext: {
        kind: "session_workspace",
        cwd: "/workspace/current",
        workspaceFolders: ["/workspace/ref"],
        sourceSessionPath: "/sessions/agent-a.jsonl",
        createdByAgentId: "agent-a",
      },
      executor: {
        kind: "agent_session",
        agentId: "agent-a",
        prompt: expect.stringContaining("站起来活动一下"),
        model: "",
        executionContext: {
          kind: "session_workspace",
          cwd: "/workspace/current",
          workspaceFolders: ["/workspace/ref"],
          sourceSessionPath: "/sessions/agent-a.jsonl",
          createdByAgentId: "agent-a",
        },
        migratedFrom: {
          kind: "direct_action",
          action: "notify",
        },
      },
      createdBy: {
        kind: "agent",
        agentId: "agent-a",
        sourceSessionPath: "/sessions/agent-a.jsonl",
      },
    }));
    expect(store.addJob.mock.calls[0][0].executor.prompt).toContain('"channels":["desktop"]');
  });

  it("uses the latest confirmation store at execution time", async () => {
    const store = makeStore();
    const decision = deferredDecision();
    const confirmStore = {
      create: vi.fn(() => ({
        confirmId: "confirm_late",
        promise: decision.promise,
      })),
    };
    const tool = createAutomationTool(store, {
      getConfirmStore: () => confirmStore,
      getAgentId: () => "agent-a",
      getSessionCwd: () => "/workspace/current",
    });

    const result = await tool.execute(
      "call_late",
      {
        action: "add_notify",
        scheduleType: "cron",
        schedule: "0 12 * * *",
        label: "Tea",
        title: "喝茶",
      },
      undefined,
      undefined,
      { sessionManager: { getSessionFile: () => "/sessions/live.jsonl" } },
    );

    expect(confirmStore.create).toHaveBeenCalledWith(
      "cron",
      { jobData: expect.objectContaining({ label: "Tea" }) },
      "/sessions/live.jsonl",
    );
    expect(result.details).toMatchObject({ action: "pending_add", confirmId: "confirm_late" });
    decision.resolve({ action: "rejected" });
    await flushMicrotasks();
    expect(store.addJob).not.toHaveBeenCalled();
  });

  it("uses edited draft fields when a confirmation card is approved", async () => {
    const store = makeStore();
    const decision = deferredDecision();
    const confirmStore = {
      create: vi.fn(() => ({
        confirmId: "confirm_1",
        promise: decision.promise,
      })),
    };
    const tool = createAutomationTool(store, {
      confirmStore,
      getAgentId: () => "agent-a",
      getSessionCwd: () => "/workspace/current",
      getSessionWorkspaceFolders: () => [],
    });

    await tool.execute(
      "call_2",
      {
        action: "add_notify",
        scheduleType: "cron",
        schedule: "0 10 * * *",
        label: "Reminder",
        title: "提醒",
      },
      undefined,
      undefined,
      { sessionManager: { getSessionFile: () => "/sessions/agent-a.jsonl" } },
    );

    expect(store.addJob).not.toHaveBeenCalled();
    decision.resolve({
      action: "confirmed",
      value: {
        jobData: {
          label: "Edited Reminder",
          schedule: "30 10 * * *",
          prompt: "edited agent run prompt",
          actorAgentId: "malicious-agent",
        },
      },
    });
    await flushMicrotasks();

    expect(store.addJob).toHaveBeenCalledWith(expect.objectContaining({
      label: "Edited Reminder",
      schedule: "30 10 * * *",
      prompt: "edited agent run prompt",
      actorAgentId: "agent-a",
      executor: expect.objectContaining({
        kind: "agent_session",
        agentId: "agent-a",
        prompt: "edited agent run prompt",
      }),
    }));
  });

  it("creates notify automation immediately only when auto approve is explicitly enabled", async () => {
    const store = makeStore();
    const confirmStore = {
      create: vi.fn(() => ({
        confirmId: "confirm_1",
        promise: Promise.resolve({ action: "confirmed" }),
      })),
    };
    const tool = createAutomationTool(store, {
      getAutoApprove: () => true,
      confirmStore,
      getAgentId: () => "agent-a",
      getSessionCwd: () => "/workspace/current",
      getSessionWorkspaceFolders: () => [],
    });

    await tool.execute(
      "call_2b",
      {
        action: "add_notify",
        scheduleType: "cron",
        schedule: "0 10 * * *",
        label: "Reminder",
        title: "提醒",
      },
      undefined,
      undefined,
      { sessionManager: { getSessionFile: () => "/sessions/agent-a.jsonl" } },
    );

    expect(confirmStore.create).not.toHaveBeenCalled();
    expect(store.addJob).toHaveBeenCalledOnce();
  });

  it("creates plugin action automations as Agent-run job data", async () => {
    const store = makeStore("studio_job_2");
    const tool = createAutomationTool(store, {
      autoApprove: true,
      getAgentId: () => "agent-a",
      getSessionCwd: () => "/workspace/current",
      getSessionWorkspaceFolders: () => [],
    });

    await tool.execute(
      "call_3",
      {
        action: "add_plugin_action",
        scheduleType: "cron",
        schedule: "0 18 * * *",
        label: "Daily Note",
        pluginId: "notes",
        actionId: "create_note",
        params: { title: "Today", folder: "daily" },
      },
      undefined,
      undefined,
      { sessionManager: { getSessionFile: () => "/sessions/agent-a.jsonl" } },
    );

    expect(store.addJob).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("notes/create_note"),
      label: "Daily Note",
      executor: {
        kind: "agent_session",
        agentId: "agent-a",
        prompt: expect.stringContaining('"folder":"daily"'),
        model: "",
        executionContext: {
          kind: "session_workspace",
          cwd: "/workspace/current",
          workspaceFolders: [],
          sourceSessionPath: "/sessions/agent-a.jsonl",
          createdByAgentId: "agent-a",
        },
        migratedFrom: {
          kind: "plugin_action",
          pluginId: "notes",
          actionId: "create_note",
        },
      },
    }));
  });

  it("rejects removed file.create automation actions", async () => {
    const store = makeStore();
    const tool = createAutomationTool(store, {
      getAgentId: () => "agent-a",
      getSessionCwd: () => "/workspace/current",
    });

    const result = await tool.execute(
      "call_4",
      {
        action: "add_file_create",
        scheduleType: "cron",
        schedule: "0 18 * * *",
        relativePath: "notes/today.md",
        content: "# Today\n",
      },
      undefined,
      undefined,
      {},
    );

    expect(result.details).toMatchObject({
      action: "add_file_create",
      error: "unknown automation action: add_file_create",
    });
    expect(store.addJob).not.toHaveBeenCalled();
  });
});
