export interface PersonalTaskDefinition {
  key: "github_digest" | "digital_government_research";
  label: "GitHub整理" | "数字政府资料查找并整理";
  codexTitle: string;
  defaultScheduleType: "cron";
  defaultSchedule: string;
  defaultPrompt: string;
  defaultOutputPath: string;
  modelPolicyKey: "automation_cheap";
}

export const PERSONAL_TASK_DEFINITIONS: PersonalTaskDefinition[] = [
  {
    key: "github_digest",
    label: "GitHub整理",
    codexTitle: "GitHub整理",
    defaultScheduleType: "cron",
    defaultSchedule: "0 9 * * *",
    defaultPrompt: [
      "执行个人 GitHub 整理自动化。",
      "优先读取既有缓存和本地资料，整理近期需要关注的仓库、issue、PR、release 和后续动作。",
      "按原 Codex 自动化约定写入 Markdown 输出文件。",
    ].join("\n"),
    defaultOutputPath: "D:\\obsidian\\GitHub整理.md",
    modelPolicyKey: "automation_cheap",
  },
  {
    key: "digital_government_research",
    label: "数字政府资料查找并整理",
    codexTitle: "数字政府资料查找并整理",
    defaultScheduleType: "cron",
    defaultSchedule: "0 10 * * *",
    defaultPrompt: [
      "执行数字政府资料查找并整理自动化。",
      "优先读取缓存；需要联网时只检索与数字政府、政务服务、数据治理和政策资料直接相关的来源。",
      "按原 Codex 自动化约定写入 Markdown 输出文件。",
    ].join("\n"),
    defaultOutputPath: "D:\\obsidian\\数字政府资料查找并整理.md",
    modelPolicyKey: "automation_cheap",
  },
];

export function isPersonalTaskKey(value: unknown): value is PersonalTaskDefinition["key"] {
  return value === "github_digest" || value === "digital_government_research";
}
