export interface FusionPromptInput {
  taskLabel: string;
  originalPrompt: string;
  primarySummary: string;
  outputPath?: string | null;
}

export interface FusionJudgePromptInput {
  taskLabel: string;
  reviewerSummaries: string[];
}

export interface FusionFinalizerPromptInput {
  taskLabel: string;
  primarySummary: string;
  judgeSummary: string;
  outputPath?: string | null;
}

export function buildFusionReviewerPrompt(input: FusionPromptInput): string {
  return [
    `任务：${input.taskLabel}`,
    "",
    "请进行独立复核。不要和其他 reviewer 交流，不要假设其他模型的结论。",
    "检查事实遗漏、结构问题、输出文件是否满足任务目标，并给出可执行修改建议。",
    "",
    `原始任务：${input.originalPrompt}`,
    `主任务摘要：${input.primarySummary}`,
    input.outputPath ? `输出文件：${input.outputPath}` : "",
  ].filter(Boolean).join("\n");
}

export function buildFusionJudgePrompt(input: FusionJudgePromptInput): string {
  return [
    `任务：${input.taskLabel}`,
    "",
    "请作为 judge 汇总差异、冲突和风险，判断哪些建议必须采纳、哪些建议可以忽略。",
    "",
    ...input.reviewerSummaries.map((summary, index) => `Reviewer ${index + 1}:\n${summary}`),
  ].join("\n\n");
}

export function buildFusionFinalizerPrompt(input: FusionFinalizerPromptInput): string {
  return [
    `任务：${input.taskLabel}`,
    "",
    "请根据 judge 结论进行最终修订。保留主任务已完成的有效内容，只修正明确问题。",
    input.outputPath ? `如需要修改文件，请更新此输出文件：${input.outputPath}` : "如无输出文件，只给出最终修订摘要。",
    "",
    `主任务摘要：${input.primarySummary}`,
    `Judge 结论：${input.judgeSummary}`,
  ].join("\n");
}
