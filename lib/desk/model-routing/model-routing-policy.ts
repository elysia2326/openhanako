import { parseModelRef } from "../../../shared/model-ref.ts";

export type AutomationModelPolicyKey =
  | "automation_cheap"
  | "daily"
  | "hard"
  | "fusion_reviewer"
  | "fusion_judge"
  | "fusion_finalizer";

export type AutomationModelPhase =
  | "primary"
  | "retry"
  | "fallback"
  | "fusion_reviewer"
  | "fusion_judge"
  | "fusion_finalizer";

export interface AutomationModelRef {
  id: string;
  provider: string;
}

export interface AutomationModelDecision {
  model: AutomationModelRef | string | null;
  policyKey: AutomationModelPolicyKey;
  reason: string;
  phase: AutomationModelPhase;
  fallbackFrom?: { id: string; provider?: string } | string | null;
}

export interface ResolveAutomationModelInput {
  job: any;
  executor?: any;
  availableModels?: Array<{ id: string; provider: string; name?: string }>;
  phase?: AutomationModelDecision["phase"];
  previousErrorCount?: number;
  explicitPolicyKey?: AutomationModelPolicyKey;
}

export function normalizeAutomationModelPolicyKey(value: unknown): AutomationModelPolicyKey {
  if (
    value === "daily" ||
    value === "hard" ||
    value === "fusion_reviewer" ||
    value === "fusion_judge" ||
    value === "fusion_finalizer"
  ) {
    return value;
  }
  return "automation_cheap";
}

function providerText(model: { provider?: string; id?: string; name?: string }) {
  return `${model.provider || ""} ${model.id || ""} ${model.name || ""}`.toLowerCase();
}

function findByProvider(
  models: Array<{ id: string; provider: string; name?: string }>,
  keywords: string[],
) {
  return models.find((model) => keywords.some((keyword) => providerText(model).includes(keyword))) || null;
}

function refFromUnknown(value: unknown) {
  const parsed = parseModelRef(value);
  if (!parsed?.id) return null;
  return parsed.provider ? { id: parsed.id, provider: parsed.provider } : null;
}

function hasIncompleteModelRef(value: unknown) {
  const parsed = parseModelRef(value);
  return !!parsed?.id && !parsed.provider;
}

function chooseForPolicy(
  policyKey: AutomationModelPolicyKey,
  models: Array<{ id: string; provider: string; name?: string }>,
) {
  if (policyKey === "hard" || policyKey === "fusion_finalizer") {
    return (
      findByProvider(models, ["claude", "anthropic"]) ||
      findByProvider(models, ["gpt", "openai"]) ||
      findByProvider(models, ["deepseek"])
    );
  }
  if (policyKey === "daily" || policyKey === "fusion_judge" || policyKey === "fusion_reviewer") {
    return (
      findByProvider(models, ["gpt", "openai"]) ||
      findByProvider(models, ["deepseek"]) ||
      findByProvider(models, ["claude", "anthropic"])
    );
  }
  return (
    findByProvider(models, ["deepseek"]) ||
    findByProvider(models, ["gpt", "openai"]) ||
    findByProvider(models, ["claude", "anthropic"])
  );
}

export function resolveAutomationModel({
  job,
  executor,
  availableModels = [],
  phase = "primary",
  previousErrorCount = 0,
  explicitPolicyKey,
}: ResolveAutomationModelInput): AutomationModelDecision {
  const policyKey = explicitPolicyKey || normalizeAutomationModelPolicyKey(job?.modelPolicyKey);
  const explicitModelSource = executor?.model ?? job?.model;
  const explicitModel = refFromUnknown(explicitModelSource);
  const ignoredIncompleteExplicitModel = !explicitModel && hasIncompleteModelRef(explicitModelSource);
  if (explicitModel && phase !== "fallback") {
    return {
      model: explicitModel,
      policyKey,
      phase,
      reason: "explicit job model selected",
    };
  }

  let effectivePolicy = policyKey;
  let fallbackFrom: AutomationModelDecision["fallbackFrom"] = null;
  if (phase === "fallback" && previousErrorCount >= 2) {
    fallbackFrom = explicitModel || refFromUnknown(job?.model) || null;
    effectivePolicy = policyKey === "hard" ? "hard" : "daily";
  }

  const selected = chooseForPolicy(effectivePolicy, availableModels);
  const model = selected ? { id: selected.id, provider: selected.provider } : explicitModel || null;
  const reason =
    effectivePolicy === "hard"
      ? "hard task policy selected Claude-capable model"
      : effectivePolicy === "fusion_reviewer"
        ? "fusion reviewer policy selected GPT-capable reviewer model"
      : effectivePolicy === "daily"
        ? "daily/fallback policy selected GPT-capable model"
        : "automation cheap policy selected DeepSeek-capable model";

  return {
    model,
    policyKey,
    phase,
    reason: ignoredIncompleteExplicitModel
      ? `${reason}; ignored incomplete explicit model without provider`
      : reason,
    ...(fallbackFrom ? { fallbackFrom } : {}),
  };
}
