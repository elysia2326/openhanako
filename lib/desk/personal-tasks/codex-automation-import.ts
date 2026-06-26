import fs from "fs";
import path from "path";
import { createModuleLogger } from "../../debug-log.ts";

const log = createModuleLogger("codex-automation-import");

const CODEx_SEARCH_PATHS = [
  "automations.json",
  "automation.json",
  "tasks.json",
  path.join(".codex", "automations.json"),
  path.join(".codex", "tasks.json"),
];

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readJsonIfExists(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    log.warn(`failed to read Codex automation contract ${filePath}: ${err.message}`);
    return undefined;
  }
}

function normalizeContract(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const title = typeof raw.title === "string" && raw.title.trim()
    ? raw.title.trim()
    : typeof raw.label === "string" && raw.label.trim()
      ? raw.label.trim()
      : "";
  if (!title) return null;
  const scheduleType = typeof raw.scheduleType === "string" && raw.scheduleType.trim()
    ? raw.scheduleType.trim()
    : typeof raw.type === "string" && raw.type.trim()
      ? raw.type.trim()
      : "cron";
  const schedule = raw.schedule ?? raw.cron ?? raw.cronExpression ?? null;
  const prompt = typeof raw.prompt === "string" ? raw.prompt : "";
  const cwd = typeof raw.cwd === "string" && raw.cwd.trim() ? raw.cwd.trim() : null;
  const workspaceFolders = asArray(raw.workspaceFolders).filter((item) => typeof item === "string" && item.trim());
  const outputPath = typeof raw.outputPath === "string" && raw.outputPath.trim() ? raw.outputPath.trim() : "";
  const cachePolicy = clone(raw.cachePolicy) ?? null;
  const failurePolicy = clone(raw.failurePolicy) ?? null;
  return {
    title,
    scheduleType,
    schedule,
    prompt,
    cwd,
    workspaceFolders,
    outputPath,
    cachePolicy,
    failurePolicy,
  };
}

function extractContracts(parsed) {
  if (Array.isArray(parsed)) return parsed.map(normalizeContract).filter(Boolean);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    if (Array.isArray(parsed.automations)) return parsed.automations.map(normalizeContract).filter(Boolean);
    if (Array.isArray(parsed.tasks)) return parsed.tasks.map(normalizeContract).filter(Boolean);
  }
  const normalized = normalizeContract(parsed);
  return normalized ? [normalized] : [];
}

export function loadCodexAutomationContracts(codexAutomationRoot) {
  const root = typeof codexAutomationRoot === "string" && codexAutomationRoot.trim()
    ? codexAutomationRoot.trim()
    : "";
  const contracts = new Map();
  if (!root) return contracts;

  for (const relativePath of CODEx_SEARCH_PATHS) {
    const filePath = path.join(root, relativePath);
    const parsed = readJsonIfExists(filePath);
    if (parsed === null) continue;
    if (parsed === undefined) continue;
    const extracted = extractContracts(parsed);
    if (!extracted.length) continue;
    for (const contract of extracted) {
      if (!contracts.has(contract.title)) {
        contracts.set(contract.title, contract);
      }
    }
  }

  return contracts;
}
