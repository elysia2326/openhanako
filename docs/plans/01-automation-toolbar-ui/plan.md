# Automation Toolbar UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 HanaAgent 定时任务工具栏升级为“顶部任务卡片 + 底部最近运行日志”的个人自动化入口，并为每个任务提供“立即执行”“查看日志”“打开输出”“Fusion 开关”和模型策略展示。

**Architecture:** 保留 `AutomationPanel` 作为入口，拆出运行按钮组件和运行日志组件。前端只调用后端稳定接口：`GET /api/desk/cron`、`GET /api/desk/cron/:id/runs`、`POST /api/desk/cron` action `runNow`，输出文件通过已有 `window.platform.openFile` 打开。

**Tech Stack:** React 19, TypeScript, CSS Modules, existing `hanaFetch`, existing `window.t`, Vitest, Testing Library.

## Global Constraints

- 必须优化原有 `desktop/src/react/components/AutomationPanel.tsx`，不新建独立任务中心页面。
- UI 使用现有设计系统、CSS modules 和 `@/ui`，不引入新 UI 库。
- 操作按钮必须可键盘访问，必须有 `aria-label` 和 `title`。
- 模型路由解释只展示在日志详情中，不在任务卡片主行展示长解释。
- 文案必须新增到 `desktop/src/locales/zh.json` 和 `desktop/src/locales/en.json`，其他语言可沿用英文键值以保证 i18n 完整。
- 本 plan 依赖 `04-task-logs-archives` 提供后端接口。

---

## Assigned Agents

主实施智能体：`Automation Toolbar UI Agent`

复核智能体：

- `Spec Compliance Reviewer`
- `Code Quality Reviewer`

要求使用的 skills：

- `frontend-ui-engineering`
- `api-and-interface-design`
- `superpowers:test-driven-development`
- `superpowers:verification-before-completion`
- `code-review-and-quality`

建议模型：

- 实施：GPT 中转或 DeepSeek 官方，按任务复杂度选择。
- 复核：Claude 中转或最强可用模型。

## File Structure

```text
desktop/src/react/components/automation
├── AutomationCard.tsx
├── AutomationPanel.module.css
├── AutomationRunActions.tsx
├── AutomationRunLogList.tsx
├── automation-types.ts
└── __tests__
    ├── AutomationRunActions.test.tsx
    └── AutomationRunLogList.test.tsx

desktop/src/react/components/AutomationPanel.tsx
desktop/src/locales/en.json
desktop/src/locales/zh.json
desktop/src/locales/ja.json
desktop/src/locales/ko.json
desktop/src/locales/zh-TW.json
```

## API Contract Consumed By UI

`GET /api/desk/cron/:id/runs?limit=20`

```ts
export interface AutomationRun {
  id: string;
  jobId: string;
  status: "running" | "done" | "error" | "skipped";
  startedAt: string | number;
  finishedAt?: string | number | null;
  summary?: string | null;
  error?: string | null;
  outputPath?: string | null;
  sessionPath?: string | null;
  modelDecision?: {
    provider?: string;
    id?: string;
    policyKey?: string;
    reason?: string;
    fallbackFrom?: string | null;
  } | null;
  fusion?: {
    enabled: boolean;
    status?: "done" | "error" | "skipped";
    judgeSummary?: string | null;
  } | null;
}
```

`POST /api/desk/cron`

```json
{ "action": "runNow", "id": "job_1", "fusionOnce": false }
```

Success:

```json
{ "ok": true, "run": { "id": "cron_1710000000000", "jobId": "job_1", "status": "running" } }
```

Failure:

```json
{ "error": "not found" }
```

### Task 1: Add UI Types For Runs, Fusion, And Model Policy

**Files:**

- Modify: `desktop/src/react/components/automation/automation-types.ts`
- Test: `desktop/src/react/components/automation/__tests__/AutomationRunActions.test.tsx`

**Interfaces:**

- Produces `AutomationRun`, `AutomationModelDecision`, `AutomationFusionState`.
- Extends `CronJob` with optional `modelPolicyKey`, `fusion`, `lastRunStatus`, `lastOutputPath`.

- [ ] **Step 1: Add the type contract**

```ts
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
```

Add these fields inside `CronJob`:

```ts
  modelPolicyKey?: string;
  lastRunStatus?: 'running' | 'done' | 'error' | 'skipped';
  lastOutputPath?: string | null;
  fusion?: AutomationFusionState | null;
```

- [ ] **Step 2: Run typecheck**

```powershell
npm run typecheck
```

Expected: PASS or only errors in later tasks because new components are not imported yet. If unrelated errors appear, record them before continuing.

- [ ] **Step 3: Commit**

```powershell
git add desktop/src/react/components/automation/automation-types.ts
git commit -m "feat: add automation run ui types"
```

### Task 2: Build AutomationRunActions Component

**Files:**

- Create: `desktop/src/react/components/automation/AutomationRunActions.tsx`
- Modify: `desktop/src/react/components/automation/AutomationPanel.module.css`
- Test: `desktop/src/react/components/automation/__tests__/AutomationRunActions.test.tsx`

**Interfaces:**

```ts
interface AutomationRunActionsProps {
  jobId: string;
  outputPath?: string | null;
  fusionOnce: boolean;
  busy?: boolean;
  onRunNow: (jobId: string, options: { fusionOnce: boolean }) => void;
  onShowLogs: (jobId: string) => void;
  onOpenOutput: (path: string) => void;
  onFusionOnceChange: (enabled: boolean) => void;
}
```

- [ ] **Step 1: Write the failing component test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AutomationRunActions } from '../AutomationRunActions';

describe('AutomationRunActions', () => {
  it('runs now with the current fusion-once value', () => {
    const onRunNow = vi.fn();
    render(
      <AutomationRunActions
        jobId="job_1"
        outputPath="D:\\out\\report.md"
        fusionOnce={true}
        onRunNow={onRunNow}
        onShowLogs={vi.fn()}
        onOpenOutput={vi.fn()}
        onFusionOnceChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'automation.actions.runNow' }));

    expect(onRunNow).toHaveBeenCalledWith('job_1', { fusionOnce: true });
  });

  it('opens output only when an output path exists', () => {
    const onOpenOutput = vi.fn();
    const { rerender } = render(
      <AutomationRunActions
        jobId="job_1"
        outputPath={null}
        fusionOnce={false}
        onRunNow={vi.fn()}
        onShowLogs={vi.fn()}
        onOpenOutput={onOpenOutput}
        onFusionOnceChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'automation.actions.openOutput' })).toBeDisabled();

    rerender(
      <AutomationRunActions
        jobId="job_1"
        outputPath="D:\\out\\report.md"
        fusionOnce={false}
        onRunNow={vi.fn()}
        onShowLogs={vi.fn()}
        onOpenOutput={onOpenOutput}
        onFusionOnceChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'automation.actions.openOutput' }));

    expect(onOpenOutput).toHaveBeenCalledWith('D:\\out\\report.md');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
npm test -- desktop/src/react/components/automation/__tests__/AutomationRunActions.test.tsx
```

Expected: FAIL because `AutomationRunActions` does not exist.

- [ ] **Step 3: Implement the component**

```tsx
import styles from './AutomationPanel.module.css';

interface AutomationRunActionsProps {
  jobId: string;
  outputPath?: string | null;
  fusionOnce: boolean;
  busy?: boolean;
  onRunNow: (jobId: string, options: { fusionOnce: boolean }) => void;
  onShowLogs: (jobId: string) => void;
  onOpenOutput: (path: string) => void;
  onFusionOnceChange: (enabled: boolean) => void;
}

function ActionIcon({ type }: { type: 'run' | 'logs' | 'output' }) {
  if (type === 'run') {
    return <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z" /></svg>;
  }
  if (type === 'logs') {
    return <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 4h14v2H5zm0 5h14v2H5zm0 5h10v2H5zm0 5h7v2H5z" /></svg>;
  }
  return <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 20h14v-2H5zm7-16-5 5h3v6h4V9h3z" /></svg>;
}

export function AutomationRunActions({
  jobId,
  outputPath,
  fusionOnce,
  busy = false,
  onRunNow,
  onShowLogs,
  onOpenOutput,
  onFusionOnceChange,
}: AutomationRunActionsProps) {
  const t = window.t ?? ((p: string) => p);
  return (
    <div className={styles.runActions}>
      <button
        className={styles.iconTextButton}
        type="button"
        disabled={busy}
        title={t('automation.actions.runNow')}
        aria-label={t('automation.actions.runNow')}
        onClick={() => onRunNow(jobId, { fusionOnce })}
      >
        <ActionIcon type="run" />
        <span>{t('automation.actions.runNow')}</span>
      </button>
      <button
        className={styles.iconTextButton}
        type="button"
        title={t('automation.actions.viewLogs')}
        aria-label={t('automation.actions.viewLogs')}
        onClick={() => onShowLogs(jobId)}
      >
        <ActionIcon type="logs" />
        <span>{t('automation.actions.viewLogs')}</span>
      </button>
      <button
        className={styles.iconTextButton}
        type="button"
        disabled={!outputPath}
        title={t('automation.actions.openOutput')}
        aria-label={t('automation.actions.openOutput')}
        onClick={() => outputPath && onOpenOutput(outputPath)}
      >
        <ActionIcon type="output" />
        <span>{t('automation.actions.openOutput')}</span>
      </button>
      <label className={styles.fusionToggle}>
        <input
          type="checkbox"
          checked={fusionOnce}
          onChange={(event) => onFusionOnceChange(event.currentTarget.checked)}
        />
        <span>{t('automation.actions.fusionOnce')}</span>
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Add CSS**

```css
.runActions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.iconTextButton {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
}

.fusionToggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
```

- [ ] **Step 5: Run the test and verify GREEN**

```powershell
npm test -- desktop/src/react/components/automation/__tests__/AutomationRunActions.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add desktop/src/react/components/automation/AutomationRunActions.tsx desktop/src/react/components/automation/AutomationPanel.module.css desktop/src/react/components/automation/__tests__/AutomationRunActions.test.tsx
git commit -m "feat: add automation run actions"
```

### Task 3: Build AutomationRunLogList Component

**Files:**

- Create: `desktop/src/react/components/automation/AutomationRunLogList.tsx`
- Modify: `desktop/src/react/components/automation/AutomationPanel.module.css`
- Test: `desktop/src/react/components/automation/__tests__/AutomationRunLogList.test.tsx`

**Interfaces:**

```ts
interface AutomationRunLogListProps {
  runs: AutomationRun[];
  selectedJobTitle?: string | null;
  loading?: boolean;
  onOpenOutput: (path: string) => void;
}
```

- [ ] **Step 1: Write the failing log-list test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AutomationRunLogList } from '../AutomationRunLogList';

describe('AutomationRunLogList', () => {
  it('renders run status, model reason, fusion summary, and opens output', () => {
    const onOpenOutput = vi.fn();
    render(
      <AutomationRunLogList
        selectedJobTitle="GitHub整理"
        onOpenOutput={onOpenOutput}
        runs={[{
          id: 'run_1',
          jobId: 'job_1',
          status: 'done',
          startedAt: '2026-06-25T08:00:00.000Z',
          finishedAt: '2026-06-25T08:01:00.000Z',
          summary: '整理完成',
          outputPath: 'D:\\obsidian\\github.md',
          modelDecision: { provider: 'deepseek', id: 'deepseek-chat', reason: 'automation default cheap model' },
          fusion: { enabled: true, status: 'done', judgeSummary: '复核通过' },
        }]}
      />,
    );

    expect(screen.getByText('GitHub整理')).toBeInTheDocument();
    expect(screen.getByText('整理完成')).toBeInTheDocument();
    expect(screen.getByText('automation default cheap model')).toBeInTheDocument();
    expect(screen.getByText('复核通过')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'automation.actions.openOutput' }));
    expect(onOpenOutput).toHaveBeenCalledWith('D:\\obsidian\\github.md');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
npm test -- desktop/src/react/components/automation/__tests__/AutomationRunLogList.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the log-list component**

```tsx
import type { AutomationRun } from './automation-types';
import styles from './AutomationPanel.module.css';

function formatRunTime(value: string | number | null | undefined) {
  if (!value) return '';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, { hour12: false });
}

export function AutomationRunLogList({
  runs,
  selectedJobTitle,
  loading = false,
  onOpenOutput,
}: {
  runs: AutomationRun[];
  selectedJobTitle?: string | null;
  loading?: boolean;
  onOpenOutput: (path: string) => void;
}) {
  const t = window.t ?? ((p: string) => p);
  if (loading) return <div className={styles.runLogEmpty}>{t('automation.logs.loading')}</div>;
  if (!runs.length) return <div className={styles.runLogEmpty}>{t('automation.logs.empty')}</div>;

  return (
    <section className={styles.runLogPanel} aria-label={t('automation.logs.title')}>
      <div className={styles.runLogHeader}>
        <h3>{selectedJobTitle || t('automation.logs.recent')}</h3>
      </div>
      <div className={styles.runLogList}>
        {runs.map((run) => (
          <article className={styles.runLogItem} key={run.id}>
            <div className={styles.runLogMain}>
              <span className={styles.runStatus} data-status={run.status}>{run.status}</span>
              <span>{formatRunTime(run.startedAt)}</span>
              {run.summary ? <strong>{run.summary}</strong> : null}
            </div>
            {run.modelDecision?.reason ? (
              <p className={styles.runLogMeta}>{run.modelDecision.reason}</p>
            ) : null}
            {run.fusion?.enabled ? (
              <p className={styles.runLogMeta}>{run.fusion.judgeSummary || run.fusion.status || t('automation.fusion.enabled')}</p>
            ) : null}
            {run.error ? <p className={styles.runLogError}>{run.error}</p> : null}
            {run.outputPath ? (
              <button
                className={styles.textButton}
                type="button"
                aria-label={t('automation.actions.openOutput')}
                title={t('automation.actions.openOutput')}
                onClick={() => onOpenOutput(run.outputPath as string)}
              >
                {t('automation.actions.openOutput')}
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Add CSS**

```css
.runLogPanel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 1px solid var(--border-subtle);
  padding-top: 12px;
}

.runLogHeader h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.runLogList {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 220px;
  overflow: auto;
}

.runLogItem {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
}

.runLogMain {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 12px;
}

.runLogMeta {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.runLogError {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}

.runLogEmpty {
  color: var(--text-secondary);
  font-size: 12px;
  padding: 12px 0;
}
```

- [ ] **Step 5: Run the test and verify GREEN**

```powershell
npm test -- desktop/src/react/components/automation/__tests__/AutomationRunLogList.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add desktop/src/react/components/automation/AutomationRunLogList.tsx desktop/src/react/components/automation/AutomationPanel.module.css desktop/src/react/components/automation/__tests__/AutomationRunLogList.test.tsx
git commit -m "feat: add automation run log list"
```

### Task 4: Integrate Actions And Logs Into AutomationCard And AutomationPanel

**Files:**

- Modify: `desktop/src/react/components/automation/AutomationCard.tsx`
- Modify: `desktop/src/react/components/AutomationPanel.tsx`
- Test: `desktop/src/react/__tests__/components/AppPages.test.tsx`

**Interfaces:**

- `AutomationCard` receives new props:

```ts
onRunNow: (id: string, options: { fusionOnce: boolean }) => Promise<void> | void;
onShowLogs: (id: string) => void;
onOpenOutput: (path: string) => void;
```

- `AutomationPanel` owns:

```ts
const [selectedLogJobId, setSelectedLogJobId] = useState<string | null>(null);
const [runs, setRuns] = useState<AutomationRun[]>([]);
const [fusionOnceByJob, setFusionOnceByJob] = useState<Record<string, boolean>>({});
```

- [ ] **Step 1: Add failing integration assertions**

In `desktop/src/react/__tests__/components/AppPages.test.tsx`, add expectations that the automation panel contains:

```tsx
expect(screen.getByLabelText('automation.actions.runNow')).toBeInTheDocument();
expect(screen.getByLabelText('automation.actions.viewLogs')).toBeInTheDocument();
expect(screen.getByLabelText('automation.actions.openOutput')).toBeInTheDocument();
```

- [ ] **Step 2: Run the integration test and verify RED**

```powershell
npm test -- desktop/src/react/__tests__/components/AppPages.test.tsx
```

Expected: FAIL because the buttons are not wired into the panel.

- [ ] **Step 3: Update `AutomationCard`**

Import:

```ts
import { AutomationRunActions } from './AutomationRunActions';
```

Extend props:

```ts
  fusionOnce: boolean;
  busy?: boolean;
  onRunNow: (id: string, options: { fusionOnce: boolean }) => Promise<void> | void;
  onShowLogs: (id: string) => void;
  onOpenOutput: (path: string) => void;
  onFusionOnceChange: (jobId: string, enabled: boolean) => void;
```

Render inside `details`, above save/delete actions:

```tsx
          <AutomationRunActions
            jobId={job.id}
            outputPath={job.lastOutputPath || null}
            fusionOnce={fusionOnce}
            busy={busy}
            onRunNow={onRunNow}
            onShowLogs={onShowLogs}
            onOpenOutput={onOpenOutput}
            onFusionOnceChange={(enabled) => onFusionOnceChange(job.id, enabled)}
          />
```

- [ ] **Step 4: Update `AutomationPanel`**

Add imports:

```ts
import { AutomationRunLogList } from './automation/AutomationRunLogList';
import type { AutomationRun, CronJob, ModelOption } from './automation/automation-types';
```

Add state:

```ts
  const [selectedLogJobId, setSelectedLogJobId] = useState<string | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runningJobs, setRunningJobs] = useState<Record<string, boolean>>({});
  const [fusionOnceByJob, setFusionOnceByJob] = useState<Record<string, boolean>>({});
```

Add functions:

```ts
  const loadRuns = useCallback(async (jobId: string) => {
    setRunsLoading(true);
    try {
      const res = await hanaFetch(`/api/desk/cron/${encodeURIComponent(jobId)}/runs?limit=20`);
      const data = await res.json();
      setRuns(Array.isArray(data.runs) ? data.runs : []);
      setSelectedLogJobId(jobId);
    } finally {
      setRunsLoading(false);
    }
  }, []);

  const runNow = useCallback(async (jobId: string, options: { fusionOnce: boolean }) => {
    setRunningJobs(prev => ({ ...prev, [jobId]: true }));
    try {
      await hanaFetch('/api/desk/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'runNow', id: jobId, fusionOnce: options.fusionOnce }),
      });
      await loadData();
      await loadRuns(jobId);
    } finally {
      setRunningJobs(prev => ({ ...prev, [jobId]: false }));
    }
  }, [loadData, loadRuns]);

  const openOutput = useCallback((filePath: string) => {
    window.platform?.openFile?.(filePath);
  }, []);
```

Pass props to `AutomationCard`:

```tsx
                      fusionOnce={fusionOnceByJob[job.id] === true}
                      busy={runningJobs[job.id] === true}
                      onRunNow={runNow}
                      onShowLogs={loadRuns}
                      onOpenOutput={openOutput}
                      onFusionOnceChange={(jobId, enabled) => setFusionOnceByJob(prev => ({ ...prev, [jobId]: enabled }))}
```

Render the log list after `.groupList`:

```tsx
                <AutomationRunLogList
                  runs={runs}
                  loading={runsLoading}
                  selectedJobTitle={jobs.find(job => job.id === selectedLogJobId)?.label || null}
                  onOpenOutput={openOutput}
                />
```

- [ ] **Step 5: Run tests**

```powershell
npm test -- desktop/src/react/components/automation/__tests__/AutomationRunActions.test.tsx desktop/src/react/components/automation/__tests__/AutomationRunLogList.test.tsx desktop/src/react/__tests__/components/AppPages.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add desktop/src/react/components/AutomationPanel.tsx desktop/src/react/components/automation/AutomationCard.tsx
git commit -m "feat: wire automation actions and logs"
```

### Task 5: Add I18n Keys

**Files:**

- Modify: `desktop/src/locales/zh.json`
- Modify: `desktop/src/locales/en.json`
- Modify: `desktop/src/locales/ja.json`
- Modify: `desktop/src/locales/ko.json`
- Modify: `desktop/src/locales/zh-TW.json`
- Test: `tests/i18n-flat-keys.test.ts`

**Interfaces:**

Keys:

```json
{
  "automation.actions.runNow": "立即执行",
  "automation.actions.viewLogs": "查看日志",
  "automation.actions.openOutput": "打开输出",
  "automation.actions.fusionOnce": "本次复核",
  "automation.logs.title": "自动化运行日志",
  "automation.logs.recent": "最近运行",
  "automation.logs.loading": "正在加载运行日志...",
  "automation.logs.empty": "暂无运行记录",
  "automation.fusion.enabled": "Fusion 复核已开启"
}
```

- [ ] **Step 1: Add Chinese and English copy**

Add exact keys above to `zh.json`; add English equivalents to `en.json`:

```json
{
  "automation.actions.runNow": "Run now",
  "automation.actions.viewLogs": "View logs",
  "automation.actions.openOutput": "Open output",
  "automation.actions.fusionOnce": "Review this run",
  "automation.logs.title": "Automation run logs",
  "automation.logs.recent": "Recent runs",
  "automation.logs.loading": "Loading run logs...",
  "automation.logs.empty": "No run records yet",
  "automation.fusion.enabled": "Fusion review enabled"
}
```

- [ ] **Step 2: Add safe fallback strings for remaining locales**

Use the English values in `ja.json`, `ko.json`, and `zh-TW.json`, except `zh-TW.json` may use:

```json
{
  "automation.actions.runNow": "立即執行",
  "automation.actions.viewLogs": "查看日誌",
  "automation.actions.openOutput": "開啟輸出",
  "automation.actions.fusionOnce": "本次複核",
  "automation.logs.title": "自動化執行日誌",
  "automation.logs.recent": "最近執行",
  "automation.logs.loading": "正在載入執行日誌...",
  "automation.logs.empty": "尚無執行紀錄",
  "automation.fusion.enabled": "Fusion 複核已開啟"
}
```

- [ ] **Step 3: Run i18n tests**

```powershell
npm test -- tests/i18n-flat-keys.test.ts desktop/src/react/__tests__/lib/i18n-flat-keys.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add desktop/src/locales/zh.json desktop/src/locales/en.json desktop/src/locales/ja.json desktop/src/locales/ko.json desktop/src/locales/zh-TW.json
git commit -m "feat: add automation action translations"
```

## Quality Gate

Run:

```powershell
node scripts/hana-agent-quality-harness.mjs --stage ui
npm run typecheck
```

Expected:

- All UI tests pass.
- Typecheck exits with status `0`.
- `Spec Compliance Reviewer` confirms the UI still uses the original automation toolbar.
- `Code Quality Reviewer` confirms there are no inaccessible buttons, text overflow, or unbounded re-render loops.
