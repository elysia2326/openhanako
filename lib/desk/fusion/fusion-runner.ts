import { redactAutomationRunText } from "../automation-runs/run-summary.ts";
import { resolveAutomationModel, type AutomationModelPolicyKey } from "../model-routing/model-routing-policy.ts";
import {
  buildFusionFinalizerPrompt,
  buildFusionJudgePrompt,
  buildFusionReviewerPrompt,
} from "./fusion-prompts.ts";
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
  persist?: string | null;
}

async function summarize(engine: any, sessionPath: string | null, agentId: string) {
  if (!sessionPath || typeof engine.summarizeActivity !== "function") return null;
  try {
    return await engine.summarizeActivity(sessionPath, undefined, { agentId });
  } catch {
    return null;
  }
}

function redactFusionText(value: unknown): string {
  return (redactAutomationRunText(typeof value === "string" ? value : "") || "").replace(/\[redacted\]\]+/g, "[redacted]");
}

function redactFusionOptionalText(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return redactFusionText(value);
}

async function runIsolated(
  engine: any,
  agentId: string,
  prompt: string,
  model: unknown,
  signal?: AbortSignal,
  persist?: string | null,
) {
  const result = await engine.executeIsolated(prompt, {
    agentId,
    persist: persist || undefined,
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
  persist,
}: RunFusionReviewInput): Promise<FusionRunResult> {
  const reviewerPolicies: AutomationModelPolicyKey[] = job?.fusion?.reviewerPolicies || [
    "automation_cheap",
    "daily",
    "hard",
  ];
  const taskLabel = redactFusionText(job?.label || job?.id || "automation task");
  const safeOriginalPrompt = redactFusionText(originalPrompt);
  const safePrimarySummary = redactFusionText(primaryResult.summary || "");
  const safeOutputPath = redactFusionOptionalText(primaryResult.outputPath || null);
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
        taskLabel,
        originalPrompt: safeOriginalPrompt,
        primarySummary: safePrimarySummary,
        outputPath: safeOutputPath,
      }),
      decision.model,
      signal,
      persist,
    );
    const summary = run.error ? null : redactFusionOptionalText(await summarize(engine, run.sessionPath, agentId));
    reviewerResults.push({
      id: `reviewer_${i + 1}`,
      policyKey,
      model: decision.model,
      sessionPath: run.sessionPath,
      summary,
      error: redactFusionOptionalText(run.error),
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
      taskLabel,
      reviewerSummaries: reviewerResults.map((item) => item.summary || item.error || "no summary"),
    }),
    judgeDecision.model,
    signal,
    persist,
  );
  const judgeSummary = judgeRun.error ? null : redactFusionOptionalText(await summarize(engine, judgeRun.sessionPath, agentId));

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
      taskLabel,
      primarySummary: safePrimarySummary,
      judgeSummary: judgeSummary || "judge did not produce a summary",
      outputPath: safeOutputPath,
    }),
    finalizerDecision.model,
    signal,
    persist,
  );
  const finalizerSummary = finalizerRun.error ? null : redactFusionOptionalText(await summarize(engine, finalizerRun.sessionPath, agentId));
  const hasError = reviewerResults.some((item) => item.error) || judgeRun.error || finalizerRun.error;

  return {
    enabled: true,
    status: hasError ? "error" : "done",
    reviewers: reviewerResults,
    judge: {
      model: judgeDecision.model,
      sessionPath: judgeRun.sessionPath,
      summary: judgeSummary,
      error: redactFusionOptionalText(judgeRun.error),
    },
    finalizer: {
      model: finalizerDecision.model,
      sessionPath: finalizerRun.sessionPath,
      summary: finalizerSummary,
      error: redactFusionOptionalText(finalizerRun.error),
    },
    judgeSummary,
    finalOutputPath: safeOutputPath,
  };
}
