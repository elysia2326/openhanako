import { describe, expect, it, vi } from "vitest";
import { createCronTool } from "../lib/tools/cron-tool.ts";

function deferredDecision() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((r) => { resolve = r; });
  return { promise, resolve };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("cron tool", () => {
  it("adds studio cron job data with actorAgentId and captured executionContext", async () => {
    const store = {
      addJob: vi.fn((jobData) => ({ ...jobData, id: "studio_job_1", enabled: true })),
      listJobs: vi.fn(() => []),
    };
    const tool = createCronTool(store, {
      autoApprove: true,
      getAgentId: () => "agent-a",
      getSessionCwd: () => "/workspace/fallback",
      getSessionWorkspaceFolders: () => ["/workspace/ref"],
      getHomeCwd: () => "/home/agent-a",
    });

    await tool.execute(
      "call_1",
      {
        action: "add",
        scheduleType: "cron",
        schedule: "0 9 * * *",
        prompt: "daily report",
        label: "Daily Report",
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

    expect(store.addJob).toHaveBeenCalledWith({
      type: "cron",
      schedule: "0 9 * * *",
      prompt: "daily report",
      label: "Daily Report",
      model: undefined,
      actorAgentId: "agent-a",
      executionContext: {
        kind: "session_workspace",
        cwd: "/workspace/current",
        workspaceFolders: ["/workspace/ref"],
        sourceSessionPath: "/sessions/agent-a.jsonl",
        createdByAgentId: "agent-a",
      },
    });
  });

  it("uses edited draft fields from the confirmation result without changing ownership", async () => {
    const store = {
      addJob: vi.fn((jobData) => ({ ...jobData, id: "studio_job_2", enabled: true })),
      listJobs: vi.fn(() => []),
    };
    const decision = deferredDecision();
    const confirmStore = {
      create: vi.fn(() => ({
        confirmId: "confirm_1",
        promise: decision.promise,
      })),
    };
    const tool = createCronTool(store, {
      autoApprove: false,
      confirmStore,
      getAgentId: () => "agent-a",
      getSessionCwd: () => "/workspace/fallback",
      getSessionWorkspaceFolders: () => ["/workspace/ref"],
    });

    const result = await tool.execute(
      "call_2",
      {
        action: "add",
        scheduleType: "cron",
        schedule: "0 9 * * *",
        prompt: "daily report",
        label: "Daily Report",
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

    expect(result.details).toMatchObject({ action: "pending_add", confirmId: "confirm_1" });
    expect(result.content[0].text).toContain("/confirm confirm_1");
    expect(result.content[0].text).toContain("/reject confirm_1");
    expect(store.addJob).not.toHaveBeenCalled();

    decision.resolve({
      action: "confirmed",
      value: {
        jobData: {
          label: "Edited Report",
          schedule: "30 9 * * *",
          prompt: "edited daily report",
          model: { id: "gpt-test", provider: "openai" },
          actorAgentId: "agent-b",
        },
      },
    });
    await flushMicrotasks();

    expect(store.addJob).toHaveBeenCalledWith({
      type: "cron",
      schedule: "30 9 * * *",
      prompt: "edited daily report",
      label: "Edited Report",
      model: { id: "gpt-test", provider: "openai" },
      actorAgentId: "agent-a",
      executionContext: {
        kind: "session_workspace",
        cwd: "/workspace/current",
        workspaceFolders: ["/workspace/ref"],
        sourceSessionPath: "/sessions/agent-a.jsonl",
        createdByAgentId: "agent-a",
      },
    });
  });
});
