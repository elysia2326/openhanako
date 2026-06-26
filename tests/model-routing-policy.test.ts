import { describe, expect, it } from "vitest";
import { resolveAutomationModel } from "../lib/desk/model-routing/model-routing-policy.ts";
import { AutomationModelRoutingStore } from "../lib/desk/model-routing/model-routing-store.ts";

const models = [
  { id: "deepseek-chat", provider: "deepseek", name: "DeepSeek Chat" },
  { id: "gpt-4.1", provider: "openai-relay", name: "GPT relay" },
  { id: "claude-sonnet-4", provider: "anthropic-relay", name: "Claude relay" },
];

describe("resolveAutomationModel", () => {
  it("uses explicit job model before policy routing", () => {
    const decision = resolveAutomationModel({
      job: { model: { id: "gpt-4.1", provider: "openai-relay" }, modelPolicyKey: "automation_cheap" },
      availableModels: models,
    });

    expect(decision.model).toEqual({ id: "gpt-4.1", provider: "openai-relay" });
    expect(decision.reason).toContain("explicit job model");
  });

  it("ignores incomplete explicit string models and routes by policy", () => {
    const decision = resolveAutomationModel({
      job: { model: "legacy-gpt-id", modelPolicyKey: "automation_cheap" },
      availableModels: models,
    });

    expect(decision.model).toEqual({ id: "deepseek-chat", provider: "deepseek" });
    expect(decision.reason).toContain("ignored incomplete explicit model");
  });

  it("routes automation_cheap to official DeepSeek when available", () => {
    const decision = resolveAutomationModel({
      job: { modelPolicyKey: "automation_cheap" },
      availableModels: models,
    });

    expect(decision.model).toEqual({ id: "deepseek-chat", provider: "deepseek" });
    expect(decision.policyKey).toBe("automation_cheap");
  });

  it("routes hard policy to Claude relay", () => {
    const decision = resolveAutomationModel({
      job: { modelPolicyKey: "hard" },
      availableModels: models,
    });

    expect(decision.model).toEqual({ id: "claude-sonnet-4", provider: "anthropic-relay" });
    expect(decision.reason).toContain("hard task");
  });

  it("routes daily policy to GPT relay when available", () => {
    const decision = resolveAutomationModel({
      job: { modelPolicyKey: "daily" },
      availableModels: models,
    });

    expect(decision.model).toEqual({ id: "gpt-4.1", provider: "openai-relay" });
    expect(decision.policyKey).toBe("daily");
  });

  it("routes fusion_reviewer with explicit reviewer policy semantics", () => {
    const decision = resolveAutomationModel({
      job: { modelPolicyKey: "fusion_reviewer" },
      availableModels: models,
    });

    expect(decision.model).toEqual({ id: "gpt-4.1", provider: "openai-relay" });
    expect(decision.policyKey).toBe("fusion_reviewer");
    expect(decision.reason).toContain("fusion reviewer");
  });

  it("falls back from cheap to GPT after repeated failure", () => {
    const decision = resolveAutomationModel({
      job: { modelPolicyKey: "automation_cheap", model: { id: "deepseek-chat", provider: "deepseek" } },
      availableModels: models,
      phase: "fallback",
      previousErrorCount: 2,
    });

    expect(decision.model).toEqual({ id: "gpt-4.1", provider: "openai-relay" });
    expect(decision.fallbackFrom).toEqual({ id: "deepseek-chat", provider: "deepseek" });
  });
});

describe("AutomationModelRoutingStore", () => {
  it("records and clears latest decisions by job id", () => {
    const store = new AutomationModelRoutingStore();
    store.record("job_1", {
      model: { id: "deepseek-chat", provider: "deepseek" },
      policyKey: "automation_cheap",
      phase: "primary",
      reason: "automation cheap policy selected DeepSeek-capable model",
    });

    expect(store.latest("job_1")?.model).toEqual({ id: "deepseek-chat", provider: "deepseek" });
    store.clear("job_1");
    expect(store.latest("job_1")).toBeNull();
  });
});
