/**
 * ABOUTME: Select Jira issue command for ralph-tui.
 * Provides an interactive TUI for selecting a Jira issue from the user's assigned list.
 * Used as part of the PRD generation workflow (US-002).
 */

import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { IssueSelectionApp } from '../tui/components/IssueSelectionApp.js';
import type { JiraIssueWithPriority } from '../tui/components/IssueSelectionView.js';
import type { JiraIssue } from './jira-prd.js';

/**
 * Result of the issue selection process.
 */
export interface IssueSelectionResult {
  /** Whether an issue was selected (true) or selection was cancelled (false) */
  selected: boolean;
  /** The selected issue, if any */
  issue?: JiraIssueWithPriority;
}

/**
 * Options for the selectIssue function.
 */
export interface SelectIssueOptions {
  /** List of issues to select from */
  issues: JiraIssue[];
  /** Whether issues are still loading */
  loading?: boolean;
  /** Error message if loading failed */
  error?: string;
}

/**
 * Display an interactive issue selection UI.
 * Returns a promise that resolves with the selection result.
 *
 * @param options - Options containing issues and loading/error state
 * @returns Promise resolving to the selection result
 */
export async function selectIssue(options: SelectIssueOptions): Promise<IssueSelectionResult> {
  const { issues, loading = false, error } = options;

  // Cast issues to include priority (optional field is already on JiraIssue)
  const issuesWithPriority: JiraIssueWithPriority[] = issues;

  // Create renderer for the TUI
  const renderer = await createCliRenderer({
    exitOnCtrlC: false, // We handle Ctrl+C/Escape in the app
  });

  const root = createRoot(renderer);

  return new Promise<IssueSelectionResult>((resolve) => {
    const handleIssueSelected = (issue: JiraIssueWithPriority) => {
      root.unmount();
      renderer.destroy();
      resolve({ selected: true, issue });
    };

    const handleCancel = () => {
      root.unmount();
      renderer.destroy();
      resolve({ selected: false });
    };

    root.render(
      <IssueSelectionApp
        issues={issuesWithPriority}
        loading={loading}
        error={error}
        onIssueSelected={handleIssueSelected}
        onCancel={handleCancel}
      />
    );
  });
}

/**
 * Interactive issue selection for use by other commands.
 * This is a convenience wrapper that displays the selection UI
 * and returns the selected issue.
 *
 * @param issues - List of Jira issues to select from
 * @returns The selected issue or null if cancelled
 */
export async function selectIssueInteractive(issues: JiraIssue[]): Promise<JiraIssue | null> {
  const result = await selectIssue({ issues });
  return result.selected && result.issue ? result.issue : null;
}
