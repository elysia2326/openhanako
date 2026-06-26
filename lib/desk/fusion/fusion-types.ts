export interface AutomationFusionConfig {
  enabled?: boolean;
  enabledOnce?: boolean;
  importance?: "normal" | "important" | "critical";
  reviewerPolicies?: Array<"automation_cheap" | "daily" | "hard">;
  judgePolicy?: "fusion_judge";
  finalizerPolicy?: "fusion_finalizer";
}

export interface FusionRunResult {
  enabled: true;
  status: "done" | "error";
  reviewers: Array<{
    id: string;
    policyKey: string;
    model: unknown;
    sessionPath: string | null;
    summary: string | null;
    error: string | null;
  }>;
  judge: {
    model: unknown;
    sessionPath: string | null;
    summary: string | null;
    error: string | null;
  };
  finalizer: {
    model: unknown;
    sessionPath: string | null;
    summary: string | null;
    error: string | null;
  };
  judgeSummary: string | null;
  finalOutputPath?: string | null;
}

export function shouldRunFusion(job: any): boolean {
  return job?.fusion?.enabled === true || job?.fusion?.enabledOnce === true;
}
