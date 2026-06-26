#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const stages = {
  ui: [
    ["npm", ["test", "--", "desktop/src/react/components/automation/__tests__/ScheduleEditor.test.tsx", "desktop/src/react/components/automation/__tests__/schedule-draft.test.ts"]],
  ],
  tasks: [
    ["npm", ["test", "--", "tests/personal-task-seed.test.ts", "tests/cron-store.test.ts", "tests/studio-cron-service.test.ts", "tests/desk-route-cron.test.ts"]],
  ],
  routing: [
    ["npm", ["test", "--", "tests/model-routing-policy.test.ts", "tests/scheduler-studio-cron.test.ts"]],
  ],
  logs: [
    ["npm", ["test", "--", "tests/automation-run-actions.test.ts", "tests/workflow-activity-store.test.ts", "tests/cron-scheduler.test.ts", "tests/desk-route-cron.test.ts", "tests/scheduler-studio-cron.test.ts"]],
  ],
  fusion: [
    ["npm", ["test", "--", "tests/fusion-runner.test.ts"]],
  ],
  all: [
    ["npm", ["run", "typecheck"]],
    ["npm", ["test", "--", "tests/cron-store.test.ts", "tests/desk-route-cron.test.ts", "tests/scheduler-studio-cron.test.ts"]],
    ["npm", ["test", "--", "tests/personal-task-seed.test.ts", "tests/model-routing-policy.test.ts", "tests/automation-run-actions.test.ts", "tests/fusion-runner.test.ts"]],
    ["npm", ["test", "--", "desktop/src/react/components/automation/__tests__/ScheduleEditor.test.tsx", "desktop/src/react/components/automation/__tests__/schedule-draft.test.ts"]],
  ],
};

const stageArgIndex = process.argv.indexOf("--stage");
const stage = stageArgIndex >= 0 ? process.argv[stageArgIndex + 1] : "all";

if (process.argv.includes("--list")) {
  console.log(Object.keys(stages).join("\n"));
  process.exit(0);
}

if (!stages[stage]) {
  console.error(`Unknown stage: ${stage}`);
  console.error(`Valid stages: ${Object.keys(stages).join(", ")}`);
  process.exit(2);
}

for (const [command, args] of stages[stage]) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
