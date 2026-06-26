import type { AutomationRun } from './automation-types';
import styles from './AutomationPanel.module.css';

interface AutomationRunLogListProps {
  runs: AutomationRun[];
  selectedJobTitle?: string | null;
  loading?: boolean;
  error?: string | null;
  onOpenOutput: (path: string) => void;
}

function formatRunTime(value: string | number | null | undefined) {
  if (!value) return '';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, { hour12: false });
}

function runLabel(run: AutomationRun) {
  const pieces: string[] = [run.status];
  const startedAt = formatRunTime(run.startedAt);
  const finishedAt = formatRunTime(run.finishedAt);
  if (startedAt) pieces.push(startedAt);
  if (finishedAt && finishedAt !== startedAt) pieces.push(finishedAt);
  return pieces.join(' · ');
}

function openTargetForRun(run: AutomationRun) {
  return run.outputPath || run.sessionPath || null;
}

export function AutomationRunLogList({
  runs,
  selectedJobTitle,
  loading = false,
  error = null,
  onOpenOutput,
}: AutomationRunLogListProps) {
  const t = window.t ?? ((p: string) => p);

  if (loading) {
    return <div className={styles.runLogEmpty} role="status">{t('automation.logs.loading')}</div>;
  }

  if (error) {
    return (
      <section className={styles.runLogPanel} aria-label={t('automation.logs.title')}>
        <div className={styles.runLogHeader}>
          <h3>{selectedJobTitle || t('automation.logs.recent')}</h3>
        </div>
        <div className={styles.runLogErrorState} role="alert">{error}</div>
      </section>
    );
  }

  if (runs.length === 0) {
    return <div className={styles.runLogEmpty} role="status">{t('automation.logs.empty')}</div>;
  }

  return (
    <section className={styles.runLogPanel} aria-label={t('automation.logs.title')}>
      <div className={styles.runLogHeader}>
        <h3>{selectedJobTitle || t('automation.logs.recent')}</h3>
      </div>

      <div className={styles.runLogList}>
        {runs.map((run) => {
          const openTarget = openTargetForRun(run);
          return (
            <article className={styles.runLogItem} key={run.id}>
              <div className={styles.runLogMain}>
                <span className={styles.runStatus} data-status={run.status}>{run.status}</span>
                <span className={styles.meta}>{runLabel(run)}</span>
                {run.summary ? <strong className={styles.runLogSummary}>{run.summary}</strong> : null}
              </div>

              {run.modelDecision?.reason ? (
                <p className={styles.runLogMeta}>{run.modelDecision.reason}</p>
              ) : null}

              {run.fusion?.enabled ? (
                <p className={styles.runLogMeta}>{run.fusion.judgeSummary || run.fusion.status || t('automation.fusion.enabled')}</p>
              ) : null}

              {run.error ? (
                <p className={styles.runLogError}>{run.error}</p>
              ) : null}

              {openTarget ? (
                <div>
                  <button
                    className={styles.textButton}
                    type="button"
                    aria-label={t('automation.actions.openOutput')}
                    title={t('automation.actions.openOutput')}
                    onClick={() => onOpenOutput(openTarget)}
                  >
                    {t('automation.actions.openOutput')}
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
