export interface ModelRef {
  id: string;
  provider?: string;
}

export interface ModelOption extends ModelRef {
  provider: string;
  name?: string;
}

export interface AutomationExecutor {
  kind?: string;
  action?: string;
  agentId?: string | null;
  pluginId?: string;
  actionId?: string;
  params?: Record<string, unknown>;
  prompt?: string;
}

export interface AutomationModelDecision {
  id?: string;
  provider?: string;
  policyKey?: string;
  reason?: string;
  fallbackFrom?: string | null;
}

export interface AutomationFusionState {
  enabled?: boolean;
  enabledOnce?: boolean;
  status?: 'done' | 'error' | 'skipped';
  judgeSummary?: string | null;
}

export interface AutomationRun {
  id: string;
  jobId?: string;
  status: 'running' | 'done' | 'error' | 'skipped';
  startedAt: string | number;
  finishedAt?: string | number | null;
  summary?: string | null;
  error?: string | null;
  outputPath?: string | null;
  sessionPath?: string | null;
  modelDecision?: AutomationModelDecision | null;
  fusion?: AutomationFusionState | null;
}

export interface CronJob {
  id: string;
  type?: 'at' | 'every' | 'cron';
  enabled: boolean;
  label?: string;
  prompt?: string;
  schedule: string | number;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  createdAt?: string;
  model?: string | ModelRef;
  modelPolicyKey?: string;
  lastRunStatus?: 'running' | 'done' | 'error' | 'skipped';
  lastOutputPath?: string | null;
  fusion?: AutomationFusionState | null;
  actorAgentId?: string;
  executor?: AutomationExecutor;
}
