// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationPanel } from '../../components/AutomationPanel';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { useStore } from '../../stores';

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: vi.fn(),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AutomationPanel', () => {
  beforeEach(() => {
    const labels: Record<string, string> = {
      'automation.title': 'Scheduled Tasks',
      'automation.add': 'Add automation',
      'automation.previousAgent': 'Show previous Agents',
      'automation.nextAgent': 'Show more Agents',
      'automation.emptyForAgent': 'No scheduled tasks for this Agent yet.',
      'automation.actions.runNow': 'Run now',
      'automation.actions.viewLogs': 'View logs',
      'automation.actions.openOutput': 'Open output',
      'automation.actions.fusionOnce': 'Review this run',
      'automation.logs.title': 'Automation run logs',
      'automation.logs.recent': 'Recent runs',
      'automation.logs.loading': 'Loading run logs...',
      'automation.logs.empty': 'No run records yet',
      'automation.logs.loadFailed': 'Unable to load run logs',
      'automation.fusion.enabled': 'Fusion review enabled',
      'automation.disable': 'Disable',
      'automation.enable': 'Enable',
      'automation.delete': 'Delete',
      'automation.defaultModel': 'Default model',
      'automation.field.label': 'Name',
      'automation.field.prompt': 'Run prompt',
      'automation.schedule.mode.daily': 'Daily',
      'automation.schedule.time': 'Time',
    };
    window.t = ((key: string) => labels[key] || key) as typeof window.t;
    window.platform = {
      openFile: vi.fn(),
    } as unknown as typeof window.platform;

    useStore.setState({
      agents: [{ id: 'agent-a', name: 'Hanako', yuan: 'hanako', isPrimary: true }],
      currentAgentId: 'agent-a',
      agentName: 'Hanako',
      agentYuan: 'hanako',
      activePanel: 'automation',
      agentAvatarUrl: '',
      currentSessionPath: null,
      sessions: [],
      deskBasePath: '/tmp/hana-desk',
      deskWorkspaceMountId: null,
      homeFolder: '/tmp',
    } as never);

    vi.mocked(hanaFetch).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/desk/cron' && !init) {
        return jsonResponse({
          jobs: [
            {
              id: 'job_1',
              enabled: true,
              label: 'GitHub整理',
              type: 'cron',
              schedule: '0 9 * * *',
              prompt: '整理 GitHub 资料',
              executor: { kind: 'agent_session' },
              actorAgentId: 'agent-a',
              lastOutputPath: 'D:\\obsidian\\GitHub整理.md',
              fusion: { enabledOnce: false },
            },
          ],
        });
      }

      if (url === '/api/models') {
        return jsonResponse({ models: [] });
      }

      if (url === '/api/desk/cron' && init?.method === 'POST') {
        return jsonResponse({
          ok: true,
          run: {
            id: 'run_now_1',
            jobId: 'job_1',
            status: 'running',
          },
        });
      }

      if (url === '/api/desk/cron/job_1/runs?limit=20') {
        return jsonResponse({
          runs: [
            {
              id: 'run_1',
              jobId: 'job_1',
              status: 'done',
              startedAt: '2026-06-25T08:00:00.000Z',
              finishedAt: '2026-06-25T08:01:00.000Z',
              summary: '整理完成',
              outputPath: 'D:\\obsidian\\GitHub整理.md',
              modelDecision: { provider: 'deepseek', id: 'deepseek-chat', reason: 'automation default cheap model' },
              fusion: { enabled: true, status: 'done', judgeSummary: '复核通过' },
            },
          ],
        });
      }

      return jsonResponse({});
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as unknown as { platform?: unknown }).platform;
  });

  it('wires the automation toolbar actions, fusion toggle, and run logs on the real panel', async () => {
    render(<AutomationPanel />);

    await screen.findByText('GitHub整理');
    fireEvent.click(screen.getByText('GitHub整理').closest('button')!);

    const runNow = await screen.findByRole('button', { name: 'Run now' });
    const viewLogs = screen.getByRole('button', { name: 'View logs' });
    const openOutput = screen.getByRole('button', { name: 'Open output' });
    const fusionOnce = screen.getByRole('checkbox', { name: 'Review this run' });

    fireEvent.click(openOutput);
    expect(window.platform?.openFile).toHaveBeenCalledWith('D:\\obsidian\\GitHub整理.md');

    fireEvent.click(fusionOnce);
    fireEvent.click(runNow);

    const postCall = vi.mocked(hanaFetch).mock.calls.find(([url, init]) => (
      url === '/api/desk/cron' && init?.method === 'POST'
    ));
    expect(postCall).toBeTruthy();
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      action: 'runNow',
      id: 'job_1',
      fusionOnce: true,
    });

    fireEvent.click(viewLogs);

    await screen.findByText('整理完成');
    expect(screen.getByRole('heading', { name: 'GitHub整理' })).toBeInTheDocument();
    expect(screen.getByText('automation default cheap model')).toBeInTheDocument();
    expect(screen.getByText('复核通过')).toBeInTheDocument();

    const logSection = screen.getByRole('region', { name: 'Automation run logs' });
    fireEvent.click(within(logSection).getByRole('button', { name: 'Open output' }));

    expect(window.platform?.openFile).toHaveBeenLastCalledWith('D:\\obsidian\\GitHub整理.md');
    expect(window.platform?.openFile).toHaveBeenCalledTimes(2);
  });

  it('shows a visible error when the runs API fails', async () => {
    vi.mocked(hanaFetch).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/desk/cron' && !init) {
        return jsonResponse({
          jobs: [
            {
              id: 'job_1',
              enabled: true,
              label: 'GitHub整理',
              type: 'cron',
              schedule: '0 9 * * *',
              prompt: '整理 GitHub 资料',
              executor: { kind: 'agent_session' },
              actorAgentId: 'agent-a',
              fusion: { enabledOnce: false },
            },
          ],
        });
      }

      if (url === '/api/models') return jsonResponse({ models: [] });
      if (url === '/api/desk/cron/job_1/runs?limit=20') return jsonResponse({ error: 'boom' }, 500);
      return jsonResponse({});
    });

    render(<AutomationPanel />);

    await screen.findByText('GitHub整理');
    fireEvent.click(screen.getByText('GitHub整理').closest('button')!);
    fireEvent.click(await screen.findByRole('button', { name: 'View logs' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load run logs');
    expect(screen.queryByText('No run records yet')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'GitHub整理' })).toBeInTheDocument();
  });

  it('shows a visible error when the runs API returns invalid JSON', async () => {
    vi.mocked(hanaFetch).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/desk/cron' && !init) {
        return jsonResponse({
          jobs: [
            {
              id: 'job_1',
              enabled: true,
              label: 'GitHub整理',
              type: 'cron',
              schedule: '0 9 * * *',
              prompt: '整理 GitHub 资料',
              executor: { kind: 'agent_session' },
              actorAgentId: 'agent-a',
              fusion: { enabledOnce: false },
            },
          ],
        });
      }

      if (url === '/api/models') return jsonResponse({ models: [] });
      if (url === '/api/desk/cron/job_1/runs?limit=20') {
        return new Response('{', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return jsonResponse({});
    });

    render(<AutomationPanel />);

    await screen.findByText('GitHub整理');
    fireEvent.click(screen.getByText('GitHub整理').closest('button')!);
    fireEvent.click(await screen.findByRole('button', { name: 'View logs' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load run logs');
    expect(screen.queryByText('No run records yet')).not.toBeInTheDocument();
  });
});
