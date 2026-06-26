import { describe, expect, it } from "vitest";
import {
  buildFusionFinalizerPrompt,
  buildFusionJudgePrompt,
  buildFusionReviewerPrompt,
} from "../lib/desk/fusion/fusion-prompts.ts";
import { runFusionReview } from "../lib/desk/fusion/fusion-runner.ts";
import { shouldRunFusion } from "../lib/desk/fusion/fusion-types.ts";

describe("fusion contracts", () => {
  it("runs fusion only when enabled or enabled once", () => {
    expect(shouldRunFusion({})).toBe(false);
    expect(shouldRunFusion({ fusion: { enabled: false } })).toBe(false);
    expect(shouldRunFusion({ fusion: { enabled: true } })).toBe(true);
    expect(shouldRunFusion({ fusion: { enabledOnce: true } })).toBe(true);
  });

  it("builds independent reviewer, judge, and finalizer prompts", () => {
    const reviewer = buildFusionReviewerPrompt({
      taskLabel: "GitHub整理",
      originalPrompt: "整理 GitHub",
      primarySummary: "输出完成",
      outputPath: "D:\\obsidian\\github.md",
    });
    const judge = buildFusionJudgePrompt({
      taskLabel: "GitHub整理",
      reviewerSummaries: ["A: 通过", "B: 发现遗漏"],
    });
    const finalizer = buildFusionFinalizerPrompt({
      taskLabel: "GitHub整理",
      primarySummary: "输出完成",
      judgeSummary: "补充 release 风险",
      outputPath: "D:\\obsidian\\github.md",
    });

    expect(reviewer).toContain("独立复核");
    expect(reviewer).not.toContain("与其他 reviewer 讨论");
    expect(judge).toContain("汇总差异");
    expect(finalizer).toContain("最终修订");
  });

  it("runs reviewers independently, then judge, then finalizer", async () => {
    const calls: Array<{ prompt: string; model: unknown; persist?: string; activityType?: string }> = [];
    const engine = {
      availableModels: [
        { id: "deepseek-chat", provider: "deepseek" },
        { id: "gpt-4.1", provider: "openai-relay" },
        { id: "claude-sonnet-4", provider: "anthropic-relay" },
      ],
      executeIsolated: async (prompt: string, opts: any) => {
        calls.push({
          prompt,
          model: opts.model,
          persist: opts.persist,
          activityType: opts.activityType,
        });
        return { sessionPath: `D:\\hana\\activity\\automation\\fusion_${calls.length}.jsonl`, error: null };
      },
      summarizeActivity: async (sessionPath: string) => `summary:${sessionPath}`,
    };

    const result = await runFusionReview({
      engine,
      agentId: "agent-a",
      job: {
        id: "job_1",
        label: "GitHub整理",
        modelPolicyKey: "automation_cheap",
        fusion: { enabledOnce: true },
      },
      originalPrompt: "整理 GitHub",
      primaryResult: { summary: "主任务完成", outputPath: "D:\\obsidian\\github.md" },
      persist: "D:\\hana\\agents\\agent-a\\activity\\automation",
    });

    expect(calls).toHaveLength(5);
    expect(calls.slice(0, 3).map((call) => call.prompt)).toEqual([
      expect.stringContaining("独立复核"),
      expect.stringContaining("独立复核"),
      expect.stringContaining("独立复核"),
    ]);
    expect(calls[3].prompt).toContain("汇总差异");
    expect(calls[4].prompt).toContain("最终修订");
    expect(calls.every((call) => call.activityType === "cron_fusion")).toBe(true);
    expect(calls.every((call) => call.persist === "D:\\hana\\agents\\agent-a\\activity\\automation")).toBe(true);
    expect(calls[0].model).toEqual({ id: "deepseek-chat", provider: "deepseek" });
    expect(calls[1].model).toEqual({ id: "gpt-4.1", provider: "openai-relay" });
    expect(calls[2].model).toEqual({ id: "claude-sonnet-4", provider: "anthropic-relay" });
    expect(result.status).toBe("done");
    expect(result.reviewers).toHaveLength(3);
    expect(result.judgeSummary).toContain("summary:");
    expect(result.finalOutputPath).toBe("D:\\obsidian\\github.md");
  });

  it("redacts secrets before passing fusion context between model prompts", async () => {
    const calls: Array<{ prompt: string; model: unknown }> = [];
    const summaries = [
      "reviewer summary Authorization: Bearer reviewer.secret",
      "reviewer error api_key=reviewer-key",
      "reviewer url D:\\obsidian\\review.md?token=reviewer-url-token",
      "judge summary Authorization: Bearer judge.secret api_key=judge-key",
      "finalizer summary ok",
    ];
    const engine = {
      availableModels: [
        { id: "deepseek-chat", provider: "deepseek" },
        { id: "gpt-4.1", provider: "openai-relay" },
        { id: "claude-sonnet-4", provider: "anthropic-relay" },
      ],
      executeIsolated: async (prompt: string, opts: any) => {
        calls.push({ prompt, model: opts.model });
        return { sessionPath: `D:\\hana\\activity\\automation\\fusion_${calls.length}.jsonl`, error: null };
      },
      summarizeActivity: async () => summaries[calls.length - 1],
    };

    const result = await runFusionReview({
      engine,
      agentId: "agent-a",
      job: {
        id: "job_secret",
        label: "Secret job",
        fusion: { enabledOnce: true },
      },
      originalPrompt: "整理资料 Authorization: Bearer raw.secret",
      primaryResult: {
        summary: "主任务完成 api_key=raw-key",
        outputPath: "D:\\obsidian\\out.md?token=raw-url-token",
      },
    });

    expect(calls).toHaveLength(5);
    const allPrompts = calls.map((call) => call.prompt).join("\n---\n");
    for (const raw of [
      "raw.secret",
      "raw-key",
      "raw-url-token",
      "reviewer.secret",
      "reviewer-key",
      "reviewer-url-token",
      "judge.secret",
      "judge-key",
    ]) {
      expect(allPrompts).not.toContain(raw);
    }
    expect(allPrompts).toContain("[redacted]");
    expect(calls[3].prompt).toContain("Reviewer 1:");
    expect(calls[3].prompt).toContain("[redacted]");
    expect(calls[4].prompt).toContain("Judge 结论");
    expect(calls[4].prompt).toContain("[redacted]");
    expect(result.judgeSummary).toContain("[redacted]");
    expect(result.finalOutputPath).toBe("D:\\obsidian\\out.md?token=[redacted]");
  });
});
