// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationRunActions } from '../AutomationRunActions';

describe('AutomationRunActions', () => {
  beforeEach(() => {
    window.t = ((key: string) => key) as typeof window.t;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

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

    expect(onOpenOutput).toHaveBeenCalledWith('D:\\\\out\\\\report.md');
  });
});
