import type { AutomationModelDecision } from "./model-routing-policy.ts";

export class AutomationModelRoutingStore {
  private readonly decisions = new Map<string, AutomationModelDecision>();

  record(jobId: string, decision: AutomationModelDecision) {
    if (!jobId) return;
    this.decisions.set(jobId, JSON.parse(JSON.stringify(decision)));
  }

  latest(jobId: string): AutomationModelDecision | null {
    const decision = this.decisions.get(jobId);
    return decision ? JSON.parse(JSON.stringify(decision)) : null;
  }

  clear(jobId: string) {
    this.decisions.delete(jobId);
  }

  clearAll() {
    this.decisions.clear();
  }
}

export const automationModelRoutingStore = new AutomationModelRoutingStore();
