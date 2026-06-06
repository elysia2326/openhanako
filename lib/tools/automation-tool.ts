/**
 * automation-tool.js — Agent-created scheduled automations
 *
 * User-facing automations are modeled as Agent runs. Fixed notification and
 * plugin requests are wrapped into a background Agent session prompt so the
 * scheduler exposes one execution model.
 */

import { Type, StringEnum } from "../pi-sdk/index.ts";
import { getToolSessionCwd, getToolSessionPath } from "./tool-session.ts";
import {
  buildNotifyAgentRunPrompt,
  buildPluginActionAgentRunPrompt,
  createAgentSessionAutomationExecutor,
  normalizeNotifyAutomationParams,
} from "../desk/agent-run-automation.ts";
import { applyConfirmedAutomationDraft } from "./automation-draft.ts";

function normalizeSchedule(params) {
  if (!params.scheduleType || !params.schedule) {
    throw new Error("scheduleType and schedule are required");
  }
  const type = params.scheduleType;
  let schedule = params.schedule;
  if (type === "every") {
    const minutes = parseInt(schedule, 10);
    if (isNaN(minutes) || minutes <= 0) {
      throw new Error("every schedule must be a positive number of minutes");
    }
    schedule = minutes * 60_000;
  }
  return { type, schedule };
}

function contextForTool(ctx, {
  getSessionPath,
  getAgentId,
  getSessionCwd,
  getSessionWorkspaceFolders,
  getHomeCwd,
}: {
  getSessionPath?: any;
  getAgentId?: any;
  getSessionCwd?: any;
  getSessionWorkspaceFolders?: any;
  getHomeCwd?: any;
} = {}) {
  const sessionPath = getToolSessionPath(ctx) || getSessionPath?.() || null;
  const actorAgentId = getAgentId?.() || null;
  const cwd = getToolSessionCwd(ctx)
    || (sessionPath ? getSessionCwd?.(sessionPath) : null)
    || (actorAgentId ? getHomeCwd?.(actorAgentId) : null)
    || null;
  const workspaceFolders = sessionPath
    ? (getSessionWorkspaceFolders?.(sessionPath) || [])
    : [];
  return {
    sessionPath,
    actorAgentId,
    executionContext: {
      kind: "session_workspace",
      cwd,
      workspaceFolders,
      sourceSessionPath: sessionPath,
      createdByAgentId: actorAgentId,
    },
  };
}

function pickArray(value) {
  return Array.isArray(value) ? value : undefined;
}

function pendingConfirmationText(label, confirmId) {
  const base = `Automation pending confirmation: ${label}`;
  if (!confirmId) return base;
  return `${base}\nConfirmation ID: ${confirmId}\nDesktop users can confirm from the card. Remote Bridge users can reply /confirm ${confirmId} or /reject ${confirmId}.`;
}

function notifyAgentRun(params, context) {
  if (!params.title && !params.body) throw new Error("title or body is required");
  const notifyParams = normalizeNotifyAutomationParams({
    title: params.title,
    body: params.body,
    ...(pickArray(params.channels) ? { channels: params.channels } : {}),
    ...(pickArray(params.bridgePlatforms) ? { bridgePlatforms: params.bridgePlatforms } : {}),
    ...(typeof params.contextPolicy === "string" ? { contextPolicy: params.contextPolicy } : {}),
  });
  const prompt = buildNotifyAgentRunPrompt(notifyParams);
  return {
    prompt,
    executor: createAgentSessionAutomationExecutor({
      agentId: context.actorAgentId,
      prompt,
      model: "",
      executionContext: context.executionContext,
      migratedFrom: {
        kind: "direct_action",
        action: "notify",
      },
    }),
    legacyAction: {
      kind: "direct_action",
      action: "notify",
      params: notifyParams,
    },
  };
}

function pluginActionAgentRun(params, context) {
  if (typeof params.pluginId !== "string" || !params.pluginId.trim()) {
    throw new Error("pluginId is required");
  }
  if (typeof params.actionId !== "string" || !params.actionId.trim()) {
    throw new Error("actionId is required");
  }
  const actionParams = params.params && typeof params.params === "object" && !Array.isArray(params.params)
    ? params.params
    : {};
  const pluginId = params.pluginId.trim();
  const actionId = params.actionId.trim();
  const prompt = buildPluginActionAgentRunPrompt({ pluginId, actionId, params: actionParams });
  return {
    prompt,
    executor: createAgentSessionAutomationExecutor({
      agentId: context.actorAgentId,
      prompt,
      model: "",
      executionContext: context.executionContext,
      migratedFrom: {
        kind: "plugin_action",
        pluginId,
        actionId,
      },
    }),
    legacyAction: {
      kind: "plugin_action",
      pluginId,
      actionId,
      params: actionParams,
    },
  };
}

function legacyActionForLabel(action) {
  if (!action) return null;
  if (action.kind === "direct_action" && action.action === "notify") {
    return {
      action: "notify",
      params: action.params || {},
    };
  }
  return action;
}

function labelFor(params, executor) {
  if (typeof params.label === "string" && params.label.trim()) return params.label;
  if (executor?.action === "notify") return executor.params.title || executor.params.body.slice(0, 30);
  if (executor?.kind === "plugin_action") return `${executor.pluginId}:${executor.actionId}`;
  return "";
}

function attachDeferredCreate({ promise, cronStore, jobData }: { promise: Promise<any>; cronStore: any; jobData: any }) {
  void promise.then((result) => {
    if (result?.action !== "confirmed") return;
    const confirmedJobData = applyConfirmedAutomationDraft(jobData, result.value);
    cronStore.addJob(confirmedJobData);
  }).catch(() => {});
}

export function createAutomationTool(cronStore, {
  getAutoApprove,
  autoApprove = false,
  confirmStore,
  getConfirmStore,
  getSessionPath,
  getAgentId,
  getSessionCwd,
  getSessionWorkspaceFolders,
  getHomeCwd,
}: {
  getAutoApprove?: any;
  autoApprove?: boolean;
  confirmStore?: any;
  getConfirmStore?: any;
  emitEvent?: any;
  getSessionPath?: any;
  getAgentId?: any;
  getSessionCwd?: any;
  getSessionWorkspaceFolders?: any;
  getHomeCwd?: any;
} = {}) {
  return {
    name: "automation",
    label: "Automation",
    description: "Create and manage scheduled automations. New automations run as background Agent sessions. Fixed notifications and plugin actions are wrapped into Agent-run prompts and require user confirmation unless explicit auto approval is enabled.",
    parameters: Type.Object({
      action: StringEnum(["list", "add_notify", "add_plugin_action", "remove", "toggle"], {
        description: "Action to perform.",
      }),
      scheduleType: Type.Optional(StringEnum(["at", "every", "cron"], {
        description: "Trigger type for add actions.",
      })),
      schedule: Type.Optional(Type.String({
        description: "Trigger schedule. For every, use minutes. For cron, use a 5-field cron expression.",
      })),
      label: Type.Optional(Type.String({ description: "Short display label." })),
      title: Type.Optional(Type.String({ description: "Notification title." })),
      body: Type.Optional(Type.String({ description: "Notification body." })),
      channels: Type.Optional(Type.Array(StringEnum(["auto", "desktop", "bridge_owner"]))),
      bridgePlatforms: Type.Optional(Type.Array(StringEnum(["wechat", "feishu", "telegram", "qq"]))),
      contextPolicy: Type.Optional(StringEnum(["none", "record_when_delivered"])),
      pluginId: Type.Optional(Type.String({ description: "Plugin id for plugin actions." })),
      actionId: Type.Optional(Type.String({ description: "Plugin action id. V0 maps this to the plugin tool name." })),
      params: Type.Optional(Type.Any({ description: "Plugin action parameters." })),
      id: Type.Optional(Type.String({ description: "Automation job id for remove/toggle." })),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      try {
        if (params.action === "list") {
          const jobs = cronStore.listJobs();
          return { content: [{ type: "text", text: JSON.stringify(jobs, null, 2) }], details: { action: "list", jobs } };
        }
        if (params.action === "remove") {
          if (!params.id) throw new Error("id is required");
          const ok = cronStore.removeJob(params.id);
          return { content: [{ type: "text", text: ok ? `Automation removed: ${params.id}` : `Automation not found: ${params.id}` }], details: { action: "remove", ok, jobs: cronStore.listJobs() } };
        }
        if (params.action === "toggle") {
          if (!params.id) throw new Error("id is required");
          const job = cronStore.toggleJob(params.id);
          return { content: [{ type: "text", text: job ? `Automation toggled: ${job.id}` : `Automation not found: ${params.id}` }], details: { action: "toggle", job, jobs: cronStore.listJobs() } };
        }

        const context = contextForTool(ctx, {
          getSessionPath,
          getAgentId,
          getSessionCwd,
          getSessionWorkspaceFolders,
          getHomeCwd,
        });
        const { type, schedule } = normalizeSchedule(params);
        const run = params.action === "add_notify"
          ? notifyAgentRun(params, context)
          : params.action === "add_plugin_action"
            ? pluginActionAgentRun(params, context)
            : null;
        if (!run) throw new Error(`unknown automation action: ${params.action}`);
        const legacyAction = legacyActionForLabel(run.legacyAction);
        const jobData = {
          type,
          schedule,
          prompt: run.prompt,
          label: labelFor(params, legacyAction),
          actorAgentId: context.actorAgentId,
          executionContext: context.executionContext,
          executor: run.executor,
          createdBy: {
            kind: "agent",
            agentId: context.actorAgentId,
            sourceSessionPath: context.sessionPath,
          },
        };

        if (getAutoApprove ? getAutoApprove() : autoApprove) {
          const job = cronStore.addJob(jobData);
          return {
            content: [{ type: "text", text: `Automation created: ${job.label} (${job.id})` }],
            details: { action: "added", job, jobs: cronStore.listJobs(), jobData, confirmed: true },
          };
        }

        const runtimeConfirmStore = getConfirmStore?.() || confirmStore || null;
        if (runtimeConfirmStore && context.sessionPath) {
          const { confirmId, promise } = runtimeConfirmStore.create("cron", { jobData }, context.sessionPath);
          attachDeferredCreate({ promise, cronStore, jobData });
          return {
            content: [{ type: "text", text: pendingConfirmationText(jobData.label, confirmId) }],
            details: { action: "pending_add", jobs: cronStore.listJobs(), jobData, confirmId },
          };
        }

        return {
          content: [{ type: "text", text: pendingConfirmationText(jobData.label, null) }],
          details: { action: "pending_add", jobData },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: err.message }],
          details: { action: params.action, error: err.message, jobs: cronStore.listJobs() },
        };
      }
    },
  };
}
