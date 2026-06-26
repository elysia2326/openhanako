/**
 * Scheduler — Heartbeat + Cron 调度（v2）
 *
 * Heartbeat：所有有 desk 的 agent 各自并行跑，不依赖焦点 agent
 * Cron：Studio 级任务列表统一调度，不随 active agent / workspace 切换而变化
 *
 * 通知策略：Automation 统一作为后台 Agent session 执行。
 * 固定通知和插件动作也会在迁移阶段包装成 Agent Run prompt。
 */

import fs from "fs";
import path from "path";
import { createHeartbeat } from "../lib/desk/heartbeat.ts";
import { createCronScheduler } from "../lib/desk/cron-scheduler.ts";
import { getAutomationExecutor } from "../lib/desk/automation-executors.ts";
import { getLocale } from "../lib/i18n.ts";
import { createFreshCompactDailyScheduler } from "../lib/fresh-compact/daily-scheduler.ts";
import { FreshCompactMaintainer } from "./fresh-compact-maintainer.ts";
import { createModuleLogger } from "../lib/debug-log.ts";
import { WORKSPACE_OUTPUT_ROOT_DIRNAME } from "../shared/workspace-output.ts";
import { resolveAutomationOutputPath } from "../lib/desk/automation-runs/run-output-resolver.ts";
import { sanitizeAutomationRunForLog } from "../lib/desk/automation-runs/run-summary.ts";
import { resolveAutomationModel } from "../lib/desk/model-routing/model-routing-policy.ts";
import { automationModelRoutingStore } from "../lib/desk/model-routing/model-routing-store.ts";
import { runFusionReview } from "../lib/desk/fusion/fusion-runner.ts";
import { shouldRunFusion } from "../lib/desk/fusion/fusion-types.ts";

const log = createModuleLogger("scheduler");
const freshCompactLog = createModuleLogger("fresh-compact");

function normalizeCronExecutionContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      kind: "missing",
      cwd: null,
      workspaceFolders: [],
      sourceSessionPath: null,
    };
  }
  return {
    kind: typeof value.kind === "string" && value.kind.trim() ? value.kind.trim() : "session_workspace",
    cwd: typeof value.cwd === "string" && value.cwd.trim() ? value.cwd : null,
    workspaceFolders: Array.isArray(value.workspaceFolders)
      ? value.workspaceFolders.filter(p => typeof p === "string" && p.trim())
      : [],
    sourceSessionPath: typeof value.sourceSessionPath === "string" && value.sourceSessionPath.trim()
      ? value.sourceSessionPath
      : null,
    notificationContext: normalizeNotificationContext(value.notificationContext),
  };
}

function normalizeNotificationContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const target = normalizeBridgeDeliveryTarget(value.bridgeDeliveryTarget || value.deliveryTarget);
  return target ? { bridgeDeliveryTarget: target } : null;
}

function normalizeBridgeDeliveryTarget(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.kind && value.kind !== "bridge") return null;
  const platform = typeof value.platform === "string" && value.platform.trim() ? value.platform.trim() : null;
  const chatId = typeof value.chatId === "string" && value.chatId.trim() ? value.chatId.trim() : null;
  const sessionKey = typeof value.sessionKey === "string" && value.sessionKey.trim() ? value.sessionKey.trim() : null;
  if (!platform || (!chatId && !sessionKey)) return null;
  const agentId = typeof value.agentId === "string" && value.agentId.trim() ? value.agentId.trim() : null;
  return {
    kind: "bridge",
    platform,
    chatType: "dm",
    ...(chatId ? { chatId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(agentId ? { agentId } : {}),
  };
}

export class Scheduler {
  declare _cronScheduler: any;
  declare _executingJobs: any;
  declare _freshCompactMaintainer: any;
  declare _freshCompactScheduler: any;
  declare _heartbeats: any;
  declare _hub: any;
  /**
   * @param {object} opts
   * @param {import('./index.ts').Hub} opts.hub
   */
  constructor({ hub }) {
    this._hub = hub;
    this._heartbeats = new Map(); // agentId → heartbeat instance
    this._cronScheduler = null; // Studio CronScheduler
    this._executingJobs = new Map(); // jobId → AbortController（per-job 锁 + abort 控制）
    this._freshCompactMaintainer = new FreshCompactMaintainer({ hub });
    this._freshCompactScheduler = createFreshCompactDailyScheduler({
      runDaily: (opts) => this._freshCompactMaintainer.runDaily(opts),
      warn: (msg) => freshCompactLog.warn(msg),
    });
  }

  /** @returns {import('../core/engine.ts').HanaEngine} */
  get _engine() { return this._hub.engine; }

  /** 获取某个 agent 的 heartbeat 实例 */
  getHeartbeat(agentId) {
    if (!agentId) return null;
    return this._heartbeats.get(agentId) ?? null;
  }

  /** 暴露 Studio cronScheduler（agentId 参数仅为兼容旧调用方） */
  getCronScheduler(agentId) {
    return this._cronScheduler ?? null;
  }

  // ──────────── 生命周期 ────────────

  start() {
    this.startHeartbeat();
    this._startStudioCron();
    this._freshCompactScheduler.start();
  }

  async stop() {
    this._freshCompactScheduler.stop();
    await this.stopHeartbeat();
    if (this._cronScheduler) {
      await this._cronScheduler.stop();
      this._cronScheduler = null;
    }
  }

  /** 兼容旧 agent 生命周期调用：Studio cron 只有一个 scheduler */
  startAgentCron(agentId) { this._startStudioCron(); }

  /** 为指定 agent 启动 heartbeat（公共 API，供 createAgent 等场景使用） */
  startAgentHeartbeat(agentId, agent) {
    this._startAgentHeartbeat(agentId, agent);
  }

  /** 兼容旧 agent 生命周期调用：删除 agent 不停止 Studio cron scheduler */
  async removeAgentCron(agentId) {
    return undefined;
  }

  /** 重建 heartbeat（支持指定 agentId 或全量） */
  async reloadHeartbeat(agentId) {
    if (agentId) {
      await this.stopHeartbeat(agentId);
      const agent = this._engine.getAgent(agentId);
      if (agent) this._startAgentHeartbeat(agentId, agent);
      return;
    }
    await this.stopHeartbeat();
    this.startHeartbeat();
  }

  startHeartbeat() {
    for (const [agentId, agent] of this._engine.agents || []) {
      this._startAgentHeartbeat(agentId, agent);
    }
  }

  _startAgentHeartbeat(agentId, agent) {
    if (this._heartbeats.has(agentId)) return; // 幂等

    const engine = this._engine;
    const hbInterval = agent.config?.desk?.heartbeat_interval;
    const masterEnabled = engine.getHeartbeatMaster() !== false;
    const hbEnabled = masterEnabled && (agent.config?.desk?.heartbeat_enabled === true);
    // per-agent workspace（fallback: 主 agent → ~/Desktop）
    const getWorkspace = () => engine.getHomeCwd(agentId);
    const hb = createHeartbeat({
      getDeskFiles: async () => {
        try {
          const dir = getWorkspace();
          if (!dir) return [];
          let entries;
          try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
          catch { return []; }
          const items = await Promise.all(
            entries
              .filter(e => !e.name.startsWith(".") && e.name !== WORKSPACE_OUTPUT_ROOT_DIRNAME)
              .map(async (e) => {
                const fp = path.join(dir, e.name);
                let mtime = 0;
                try { mtime = (await fs.promises.stat(fp)).mtimeMs; } catch {}
                return { name: e.name, isDir: e.isDirectory(), mtime };
              })
          );
          return items;
        } catch { return []; }
      },
      getWorkspacePath: getWorkspace,
      getAgentName: () => agent.agentName,
      registryPath: path.join(agent.deskDir, "jian-registry.json"),
      overwatchPath: path.join(agent.deskDir, "overwatch.md"),
      // 巡检/笺巡检不传 withMemory：executeIsolated 默认走 agent.systemPrompt，
      // 而该 cache 始终按 master 开关构建，与 per-session 开关解耦。
      // 用户关 master 时自动不带记忆；只关某个 session 的开关不影响这里。
      onBeat: (prompt, runTools: any = {}) => this._executeActivityForAgent(agentId, prompt, "heartbeat", null, {
        extraCustomTools: Array.isArray(runTools.customTools) ? runTools.customTools : [],
      }),
      onJianBeat: (prompt, cwd, runTools: any = {}) => {
        const isZh = getLocale().startsWith("zh");
        this._executeActivityForAgent(agentId, prompt, "heartbeat", `${isZh ? "笺" : "jian"}:${path.basename(cwd)}`, {
          cwd,
          extraCustomTools: Array.isArray(runTools.customTools) ? runTools.customTools : [],
        });
      },
      intervalMinutes: hbInterval,
      emitDevLog: (text, level) => engine.emitDevLog(text, level),
      locale: agent.config?.locale,
    });
    this._heartbeats.set(agentId, hb);
    if (hbEnabled) hb.start();
  }

  async stopHeartbeat(agentId?) {
    if (agentId) {
      const hb = this._heartbeats.get(agentId);
      if (hb) { await hb.stop(); this._heartbeats.delete(agentId); }
      return;
    }
    // 并行停止所有 heartbeat，减少总关闭时间
    await Promise.all([...this._heartbeats.values()].map(hb => hb.stop()));
    this._heartbeats.clear();
  }

  // ──────────── Studio Cron ────────────

  _startStudioCron() {
    if (this._cronScheduler) return;
    const engine = this._engine;
    const cronStore = engine.getStudioCronStore?.();
    if (!cronStore) return;

    const sched = createCronScheduler({
      cronStore,
      executeJob: (job) => this._executeCronJob(job),
      abortJob: (jobId) => {
        const ac = this._executingJobs.get(jobId);
        if (ac) { ac.abort(); log.log(`cron abort ${jobId} (timeout)`); }
      },
      onJobDone: (job, result) => {
        this._hub.eventBus.emit(
          {
            type: "cron_job_done",
            jobId: job.id,
            label: job.label,
            agentId: job.actorAgentId,
            actorAgentId: job.actorAgentId,
            result,
          },
          null,
        );
      },
    } as any);
    this._cronScheduler = sched;
    sched.start();
    log.log("Studio cron 已启动");
  }

  // ──────────── 执行 ────────────

  async _executeCronJob(job) {
    const executor = getAutomationExecutor(job);
    if (executor.kind !== "agent_session") {
      throw new Error(`unsupported automation executor: ${executor.kind}`);
    }
    const actorAgentId = executor.agentId || job.actorAgentId || job.legacyRef?.agentId || null;
    if (!actorAgentId) {
      throw new Error(`cron job ${job.id} missing actorAgentId`);
    }
    const result = await this._executeCronJobForAgent(actorAgentId, job, executor);
    return sanitizeAutomationRunForLog({ executorKind: "agent_session", ...result });
  }

  async runCronJobNow(jobId, options: any = {}) {
    const cronStore = this._engine.getStudioCronStore?.();
    if (!cronStore) throw new Error("cron store unavailable");
    const job = cronStore.getJob(jobId);
    if (!job) throw new Error("not found");
    const startedAt = new Date().toISOString();
    const runJob = options.fusionOnce
      ? { ...job, fusion: { ...(job.fusion || {}), enabledOnce: true } }
      : job;
    try {
      const result = await this._executeCronJob(runJob);
      const finishedAt = new Date().toISOString();
      cronStore.logRun(job.id, sanitizeAutomationRunForLog({
        id: result?.id || `manual_${Date.now()}`,
        status: "success",
        startedAt,
        finishedAt,
        ...result,
      }));
      return { ...result, jobId: job.id, status: result?.status || "done" };
    } catch (err) {
      const finishedAt = new Date().toISOString();
      cronStore.logRun(job.id, sanitizeAutomationRunForLog({
        id: `manual_${Date.now()}`,
        status: err?.skipped ? "skipped" : "error",
        startedAt,
        finishedAt,
        error: err?.message || String(err),
      }));
      throw err;
    }
  }

  /**
   * 执行某个 agent 的 cron 任务（active 或非 active 均可）
   * 同一 agent 同时只运行一个 cron，防止并发写冲突
   */
  async _executeCronJobForAgent(agentId, job, executor = getAutomationExecutor(job)) {
    // per-job 锁：同一 job 不并发，但同一 agent 的不同 job 可以并行
    if (this._executingJobs.has(job.id)) {
      log.log(`cron 跳过 ${job.id}：上一次仍在执行`);
      const err = new Error(`cron job ${job.id} 仍在执行，跳过`);
      (err as any).skipped = true;
      throw err;
    }
    const ac = new AbortController();
    this._executingJobs.set(job.id, ac);
    try {
      const isZh = getLocale().startsWith("zh");
      const promptBody = executor.prompt || job.prompt || "";
      const prompt = isZh
        ? [
            `[定时任务 ${job.id}: ${job.label}]`,
            "",
            "**注意：这是系统自动触发的定时任务，不是用户发来的。**",
            "**不要在执行过程中创建新的定时任务。**",
            "",
            promptBody,
          ].join("\n")
        : [
            `[Cron job ${job.id}: ${job.label}]`,
            "",
            "**Note: This is an automated cron job, NOT a user message.**",
            "**Do not create new cron jobs during execution.**",
            "",
            promptBody,
          ].join("\n");
      let activityResult: any = null;
      const modelAttempts: any[] = [];
      let lastError: unknown = null;
      for (const phase of ["primary", "retry", "fallback"] as const) {
        try {
          activityResult = await this._executeCronJobAttempt(agentId, job, executor, prompt, phase, ac.signal, modelAttempts);
          modelAttempts.push(activityResult.modelDecision);
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          if ((err as any)?.modelDecision) modelAttempts.push((err as any).modelDecision);
          if (phase === "fallback") throw err;
        }
      }
      if (lastError) throw lastError;
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
            signal: ac.signal,
            persist: path.join(this._engine.agentsDir, agentId, "activity", "automation"),
          });
        } catch (err) {
          fusion = {
            enabled: true,
            status: "error",
            reviewers: [],
            judge: { model: null, sessionPath: null, summary: null, error: null },
            finalizer: { model: null, sessionPath: null, summary: null, error: null },
            judgeSummary: null,
            finalOutputPath: null,
            error: err?.message || String(err),
          };
        }
      }
      return {
        executorKind: "agent_session",
        ...activityResult,
        modelAttempts,
        outputPath: resolveAutomationOutputPath(job, activityResult),
        fusion: fusion || activityResult?.fusion || null,
      };
    } finally {
      automationModelRoutingStore.clear(job.id);
      this._executingJobs.delete(job.id);
    }
  }

  async _executeCronJobAttempt(agentId, job, executor, prompt, phase, signal, previousModelAttempts: any[] = []) {
    const modelDecision = resolveAutomationModel({
      job,
      executor,
      availableModels: this._engine.availableModels || [],
      phase,
      previousErrorCount: Number(job.consecutiveErrors || 0) + (phase === "fallback" ? 2 : 0),
    });
    const modelAttempts = [...previousModelAttempts, modelDecision];
    automationModelRoutingStore.record(job.id, modelDecision);
    try {
      return await this._executeActivityForAgent(agentId, prompt, "cron", job.label, {
        model: modelDecision.model || undefined,
        modelDecision,
        modelAttempts,
        recordFailedActivity: phase === "fallback",
        signal,
        ...this._cronExecutionOptions(job, executor),
      });
    } catch (err) {
      (err as any).modelDecision = modelDecision;
      throw err;
    }
  }

  _cronExecutionOptions(job, executor = getAutomationExecutor(job)) {
    const ctx = normalizeCronExecutionContext(executor.executionContext || job.executionContext);
    const opts: any = {};
    if (ctx.cwd) opts.cwd = ctx.cwd;
    opts.workspaceFolders = ctx.workspaceFolders;
    if (ctx.sourceSessionPath) opts.parentSessionPath = ctx.sourceSessionPath;
    if (ctx.notificationContext) opts.notificationContext = ctx.notificationContext;
    opts.permissionMode = executor.permissionMode || job.permissionMode || this._engine.getAutomationPermissionMode?.() || "auto";
    opts.allowHumanApproval = false;
    return opts;
  }

  /**
   * 执行活动（任意 agent，统一走 executeIsolated）
   */
  async _executeActivityForAgent(agentId, prompt, type, label, opts: any = {}) {
    const engine = this._engine;
    await engine.ensureAgentRuntime?.(agentId, {
      priority: "background",
      reason: type,
    });
    const agentDir = path.join(engine.agentsDir, agentId);
    const activityDir = type === "cron"
      ? path.join(agentDir, "activity", "automation")
      : path.join(agentDir, "activity");
    const startedAt = Date.now();
    const id = `${type === "heartbeat" ? "hb" : "cron"}_${startedAt}`;

    // 所有 agent 统一走 executeIsolated（支持 agentId + signal 参数）
    const { signal, modelDecision, modelAttempts, recordFailedActivity = true, ...restOpts } = opts;
    const result = await engine.executeIsolated(prompt, {
      agentId,
      persist: activityDir,
      signal,
      activityType: type,
      ...restOpts,
    });
    const { sessionPath, error } = result;

    const finishedAt = Date.now();
    const failed = !!error;

    // 取 agentName（从长驻实例获取，fallback agentId）
    const ag = engine.getAgent(agentId);
    const agentName = ag?.agentName || agentId;

    // 生成摘要
    let summary = null;
    if (typeof sessionPath === "string" && sessionPath) {
      try {
        summary = await engine.summarizeActivity(sessionPath, undefined, { agentId });
      } catch {}
    }

    const entry = {
      id,
      type,
      label: label || null,
      agentId,
      agentName,
      startedAt,
      finishedAt,
      summary: (() => {
        const isZhS = getLocale().startsWith("zh");
        const hbLabel = isZhS ? "日常巡检" : "routine patrol";
        const cronLabel = isZhS ? "定时任务" : "cron job";
        const failSuffix = isZhS ? "执行失败" : "execution failed";
        if (failed) return `${label || (type === "heartbeat" ? hbLabel : cronLabel)} ${failSuffix}`;
        return summary || (type === "heartbeat" ? hbLabel : (label || cronLabel));
      })(),
      sessionFile: typeof sessionPath === "string" ? path.basename(sessionPath) : null,
      status: failed ? "error" : "done",
      error: error || null,
      modelDecision: modelDecision || null,
      modelAttempts: Array.isArray(modelAttempts) ? modelAttempts : undefined,
    };

    // 写入对应 agent 的 ActivityStore
    if (!failed || recordFailedActivity) {
      engine.getActivityStore(agentId).add(entry);

      // WS 广播
      this._hub.eventBus.emit({ type: "activity_update", activity: entry }, null);
    }

    if (failed) {
      const isZhR = getLocale().startsWith("zh");
      const reason = error || (isZhR ? "后台任务未生成 session" : "background task produced no session");
      engine.emitDevLog(`[${type}] ${label || "后台任务"} 失败: ${reason}`, "error");
      throw new Error(reason);
    }

    engine.emitDevLog(`活动记录: ${entry.summary}`, "heartbeat");
    return {
      sessionPath: typeof sessionPath === "string" && sessionPath ? sessionPath : null,
      sessionFile: typeof sessionPath === "string" && sessionPath ? path.basename(sessionPath) : null,
      summary: entry.summary,
      status: entry.status,
      error: entry.error,
      modelDecision: modelDecision || null,
      modelAttempts: Array.isArray(modelAttempts) ? modelAttempts : undefined,
      fusion: opts.fusion || result?.fusion || null,
    };
  }

}
