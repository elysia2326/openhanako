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
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M8 5v14l11-7z" />
      </svg>
    );
  }
  if (type === 'logs') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M5 4h14v2H5zm0 5h14v2H5zm0 5h10v2H5zm0 5h7v2H5z" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M5 20h14v-2H5zm7-16-5 5h3v6h4V9h3z" />
    </svg>
  );
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
        className={`${styles.textButton} ${styles.iconTextButton}`}
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
        className={`${styles.textButton} ${styles.iconTextButton}`}
        type="button"
        title={t('automation.actions.viewLogs')}
        aria-label={t('automation.actions.viewLogs')}
        onClick={() => onShowLogs(jobId)}
      >
        <ActionIcon type="logs" />
        <span>{t('automation.actions.viewLogs')}</span>
      </button>

      <button
        className={`${styles.textButton} ${styles.iconTextButton}`}
        type="button"
        disabled={!outputPath}
        title={t('automation.actions.openOutput')}
        aria-label={t('automation.actions.openOutput')}
        onClick={() => {
          if (outputPath) onOpenOutput(outputPath);
        }}
      >
        <ActionIcon type="output" />
        <span>{t('automation.actions.openOutput')}</span>
      </button>

      <label className={styles.fusionToggle} title={t('automation.actions.fusionOnce')}>
        <input
          type="checkbox"
          checked={fusionOnce}
          onChange={event => onFusionOnceChange(event.currentTarget.checked)}
        />
        <span>{t('automation.actions.fusionOnce')}</span>
      </label>
    </div>
  );
}
