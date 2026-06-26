// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationRunLogList } from '../AutomationRunLogList';

describe('AutomationRunLogList', () => {
  beforeEach(() => {
    window.t = ((key: string) => key) as typeof window.t;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders a single run record with status summary and output action', () => {
    const onOpenOutput = vi.fn();

    render(
      <AutomationRunLogList
        runs={[
          {
            id: 'run_1',
            jobId: 'job_1',
            status: 'done',
            startedAt: '2026-06-25T08:00:00.000Z',
            finishedAt: '2026-06-25T08:01:00.000Z',
            summary: '整理完成',
            outputPath: 'D:\\obsidian\\github.md',
            modelDecision: { provider: 'deepseek', id: 'deepseek-chat', reason: 'automation default cheap model' },
            fusion: { enabled: true, status: 'done', judgeSummary: '复核通过' },
          },
        ]}
        selectedJobTitle="GitHub整理"
        onOpenOutput={onOpenOutput}
      />,
    );

    expect(screen.getByText('GitHub整理')).toBeInTheDocument();
    expect(screen.getByText('done')).toBeInTheDocument();
    expect(screen.getByText('整理完成')).toBeInTheDocument();
    expect(screen.getByText('automation default cheap model')).toBeInTheDocument();
    expect(screen.getByText('复核通过')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'automation.actions.openOutput' }));

    expect(onOpenOutput).toHaveBeenCalledWith('D:\\obsidian\\github.md');
  });

  it('renders a visible error state instead of an empty state', () => {
    render(
      <AutomationRunLogList
        runs={[]}
        error="Unable to load run logs"
        onOpenOutput={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load run logs');
    expect(screen.queryByText('automation.logs.empty')).not.toBeInTheDocument();
  });

  it('falls back to sessionPath when a run has no outputPath', () => {
    const onOpenOutput = vi.fn();

    render(
      <AutomationRunLogList
        runs={[
          {
            id: 'run_2',
            jobId: 'job_1',
            status: 'done',
            startedAt: '2026-06-25T08:00:00.000Z',
            summary: '会话已归档',
            outputPath: null,
            sessionPath: 'D:\\hana agent\\activity\\automation\\run_2.jsonl',
          },
        ]}
        selectedJobTitle="GitHub整理"
        onOpenOutput={onOpenOutput}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'automation.actions.openOutput' }));

    expect(onOpenOutput).toHaveBeenCalledWith('D:\\hana agent\\activity\\automation\\run_2.jsonl');
  });
});
