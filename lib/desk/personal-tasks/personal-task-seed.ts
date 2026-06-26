import { createModuleLogger } from "../../debug-log.ts";
import { PERSONAL_TASK_DEFINITIONS } from "./personal-task-definitions.ts";
import { loadCodexAutomationContracts } from "./codex-automation-import.ts";

const log = createModuleLogger("personal-task-seed");

function buildPrompt(definition, contract, source) {
  const basePrompt = contract?.prompt || definition.defaultPrompt;
  const lines = [
    basePrompt,
    `personalTask.key: ${definition.key}`,
    `personalTask.source: ${source}`,
    `personalTask.codexTitle: ${definition.codexTitle}`,
    `personalTask.outputPath: ${contract?.outputPath || definition.defaultOutputPath}`,
    `cachePolicy: ${JSON.stringify(contract?.cachePolicy ?? null)}`,
    `failurePolicy: ${JSON.stringify(contract?.failurePolicy ?? null)}`,
  ];
  if (contract?.cwd) lines.push(`cwd: ${contract.cwd}`);
  if (Array.isArray(contract?.workspaceFolders) && contract.workspaceFolders.length > 0) {
    lines.push(`workspaceFolders: ${JSON.stringify(contract.workspaceFolders)}`);
  }
  return lines.join("\n");
}

function buildPersonalTaskMetadata(definition, contract, source, timestamp) {
  return {
    key: definition.key,
    source,
    codexTitle: definition.codexTitle,
    importedAt: timestamp,
    outputPath: contract?.outputPath || definition.defaultOutputPath,
  };
}

function createDisabledTemplateJob(store, definition, sourceReason, timestamp) {
  return store.addImportedJob({
    type: definition.defaultScheduleType,
    schedule: definition.defaultSchedule,
    prompt: [
      definition.defaultPrompt,
      `personalTask.key: ${definition.key}`,
      `personalTask.source: hana_template`,
      `diagnostic: ${sourceReason}`,
      `personalTask.outputPath: ${definition.defaultOutputPath}`,
    ].join("\n"),
    label: definition.label,
    enabled: false,
    personalTask: buildPersonalTaskMetadata(definition, null, "hana_template", timestamp),
    modelPolicyKey: definition.modelPolicyKey,
    createdAt: timestamp,
  });
}

function createImportedJob(store, definition, contract, actorAgentId, timestamp) {
  return store.addImportedJob({
    type: contract.scheduleType || definition.defaultScheduleType,
    schedule: contract.schedule ?? definition.defaultSchedule,
    prompt: buildPrompt(definition, contract, "codex_import"),
    label: definition.label,
    enabled: true,
    actorAgentId,
    executionContext: {
      kind: "session_workspace",
      cwd: contract.cwd || null,
      workspaceFolders: contract.workspaceFolders || [],
      sourceSessionPath: null,
      createdByAgentId: actorAgentId,
    },
    personalTask: buildPersonalTaskMetadata(definition, contract, "codex_import", timestamp),
    modelPolicyKey: definition.modelPolicyKey,
    createdAt: timestamp,
  });
}

export function seedPersonalTasks({
  store,
  actorAgentId: explicitActorAgentId = null,
  codexRoot = "",
  now = () => new Date(),
  codexAutomationRoot = "",
  getPrimaryAgentId = null,
}) {
  if (!store || typeof store.listJobs !== "function" || typeof store.addImportedJob !== "function") {
    throw new Error("seedPersonalTasks requires a cron store");
  }

  const actorAgentId = typeof explicitActorAgentId === "string" && explicitActorAgentId.trim()
    ? explicitActorAgentId.trim()
    : typeof getPrimaryAgentId === "function"
      ? getPrimaryAgentId()
      : null;
  const resolvedCodexRoot = typeof codexRoot === "string" && codexRoot.trim()
    ? codexRoot
    : codexAutomationRoot;
  const contracts = loadCodexAutomationContracts(resolvedCodexRoot);
  const existing = new Set(
    store.listJobs()
      .map((job) => job?.personalTask?.key)
      .filter((key) => typeof key === "string" && key),
  );

  const summary = { created: 0, skipped: 0, disabled: 0 };
  for (const definition of PERSONAL_TASK_DEFINITIONS) {
    if (existing.has(definition.key)) {
      summary.skipped += 1;
      continue;
    }

    const contract = contracts.get(definition.codexTitle) || null;
    const timestamp = now().toISOString();
    if (actorAgentId && contract) {
      createImportedJob(store, definition, contract, actorAgentId, timestamp);
      summary.created += 1;
      continue;
    }

    const reason = !actorAgentId
      ? "missing primary agent id"
      : `missing Codex contract for ${definition.codexTitle}`;
    createDisabledTemplateJob(store, definition, reason, timestamp);
    summary.disabled += 1;
  }

  if (summary.created || summary.disabled || summary.skipped) {
    log.info(JSON.stringify({
      event: "personal_tasks_seeded",
      summary,
      hasActorAgentId: Boolean(actorAgentId),
      codexAutomationRoot: resolvedCodexRoot || null,
    }));
  }

  return summary;
}
