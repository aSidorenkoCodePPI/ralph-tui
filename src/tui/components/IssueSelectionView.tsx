/**
 * ABOUTME: Issue selection view component for the Ralph TUI.
 * Displays a filterable list of Jira issues for the user to select for PRD generation.
 * Shows issue key, summary, type, priority, and status with interactive selection.
 */

import type { ReactNode } from 'react';
import { colors, statusIndicators } from '../theme.js';
import type { JiraIssue } from '../../commands/jira-prd.js';

/**
 * Extended Jira issue with priority field for display.
 * Re-exports JiraIssue type with explicit priority for use in selection UI.
 */
export type JiraIssueWithPriority = JiraIssue;

/**
 * Props for the IssueSelectionView component
 */
export interface IssueSelectionViewProps {
  /** List of available issues */
  issues: JiraIssueWithPriority[];
  /** Filtered issues based on search query */
  filteredIssues: JiraIssueWithPriority[];
  /** Currently selected issue index (within filtered list) */
  selectedIndex: number;
  /** Current search/filter query */
  filterQuery: string;
  /** Whether filter input is active */
  isFilterActive: boolean;
  /** Whether we're loading issues */
  loading?: boolean;
  /** Error message if issue loading failed */
  error?: string;
}

/**
 * Truncate text to fit within a given width
 */
function truncateText(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) {
    return text;
  }
  return text.slice(0, maxWidth - 1) + '…';
}

/**
 * Get a status color for an issue based on its status
 */
function getIssueStatusColor(status: string): string {
  const normalizedStatus = status.toLowerCase();
  if (normalizedStatus.includes('done') || normalizedStatus.includes('closed') || normalizedStatus.includes('resolved')) {
    return colors.status.success;
  }
  if (normalizedStatus.includes('progress') || normalizedStatus.includes('review')) {
    return colors.status.info;
  }
  if (normalizedStatus.includes('block')) {
    return colors.status.error;
  }
  return colors.fg.secondary;
}

/**
 * Get a priority color
 */
function getPriorityColor(priority: string | undefined): string {
  if (!priority) return colors.fg.muted;
  const normalizedPriority = priority.toLowerCase();
  if (normalizedPriority.includes('high') || normalizedPriority.includes('critical') || normalizedPriority.includes('blocker')) {
    return colors.status.error;
  }
  if (normalizedPriority.includes('medium') || normalizedPriority.includes('normal')) {
    return colors.status.warning;
  }
  return colors.fg.muted;
}

/**
 * Get status indicator for an issue
 */
function getIssueStatusIndicator(status: string): string {
  const normalizedStatus = status.toLowerCase();
  if (normalizedStatus.includes('done') || normalizedStatus.includes('closed') || normalizedStatus.includes('resolved')) {
    return statusIndicators.done;
  }
  if (normalizedStatus.includes('progress')) {
    return statusIndicators.active;
  }
  if (normalizedStatus.includes('block')) {
    return statusIndicators.blocked;
  }
  return statusIndicators.pending;
}

/**
 * IssueSelectionView component
 * Displays a filterable list of Jira issues with selection highlighting
 */
export function IssueSelectionView({
  issues,
  filteredIssues,
  selectedIndex,
  filterQuery,
  isFilterActive,
  loading = false,
  error,
}: IssueSelectionViewProps): ReactNode {
  // Loading state
  if (loading) {
    return (
      <box
        style={{
          width: '100%',
          height: '100%',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bg.primary,
        }}
      >
        <text fg={colors.fg.secondary}>Loading issues...</text>
      </box>
    );
  }

  // Error state
  if (error) {
    return (
      <box
        style={{
          width: '100%',
          height: '100%',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bg.primary,
        }}
      >
        <text fg={colors.status.error}>Error: {error}</text>
        <text fg={colors.fg.muted}>Press 'Esc' to go back</text>
      </box>
    );
  }

  // No issues found
  if (issues.length === 0) {
    return (
      <box
        style={{
          width: '100%',
          height: '100%',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bg.primary,
        }}
      >
        <text fg={colors.fg.secondary}>No issues assigned to you</text>
        <text fg={colors.fg.muted}>Check your Jira assignments or MCP configuration</text>
      </box>
    );
  }

  return (
    <box
      style={{
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        backgroundColor: colors.bg.primary,
      }}
    >
      {/* Header */}
      <box
        style={{
          width: '100%',
          height: 3,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: colors.bg.secondary,
          paddingLeft: 1,
          paddingRight: 1,
          border: true,
          borderColor: colors.border.normal,
        }}
      >
        <box style={{ flexDirection: 'row', gap: 2 }}>
          <text fg={colors.accent.primary}>Select Issue for PRD</text>
          <text fg={colors.fg.muted}>
            ({filteredIssues.length}{filteredIssues.length !== issues.length ? ` of ${issues.length}` : ''} issues)
          </text>
        </box>
        <text fg={colors.fg.muted}>[Jira]</text>
      </box>

      {/* Filter Input */}
      <box
        style={{
          width: '100%',
          height: 3,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: isFilterActive ? colors.bg.highlight : colors.bg.secondary,
          paddingLeft: 1,
          paddingRight: 1,
          border: true,
          borderColor: isFilterActive ? colors.accent.primary : colors.border.normal,
        }}
      >
        <text fg={colors.accent.primary}>/ </text>
        <text fg={isFilterActive ? colors.fg.primary : colors.fg.muted}>
          {filterQuery || (isFilterActive ? '' : 'Type / to filter...')}
        </text>
        {isFilterActive && <text fg={colors.accent.primary}>▌</text>}
      </box>

      {/* Column Headers */}
      <box
        style={{
          width: '100%',
          height: 1,
          flexDirection: 'row',
          paddingLeft: 3,
          paddingRight: 1,
          backgroundColor: colors.bg.tertiary,
        }}
      >
        <text fg={colors.fg.muted} style={{ width: 12 }}>KEY</text>
        <text fg={colors.fg.muted} style={{ width: 10 }}>TYPE</text>
        <text fg={colors.fg.muted} style={{ width: 10 }}>PRIORITY</text>
        <text fg={colors.fg.muted} style={{ width: 12 }}>STATUS</text>
        <text fg={colors.fg.muted}>SUMMARY</text>
      </box>

      {/* Issue List */}
      <box
        style={{
          flexGrow: 1,
          flexDirection: 'column',
          paddingTop: 1,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        {filteredIssues.length === 0 ? (
          <box
            style={{
              flexGrow: 1,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <text fg={colors.fg.muted}>No issues match filter "{filterQuery}"</text>
          </box>
        ) : (
          <scrollbox style={{ flexGrow: 1 }}>
            {filteredIssues.map((issue, index) => {
              const isSelected = index === selectedIndex;
              const statusColor = getIssueStatusColor(issue.status);
              const priorityColor = getPriorityColor(issue.priority);
              const statusIndicator = getIssueStatusIndicator(issue.status);

              return (
                <box
                  key={issue.key}
                  style={{
                    width: '100%',
                    height: 1,
                    flexDirection: 'row',
                    backgroundColor: isSelected ? colors.bg.highlight : 'transparent',
                  }}
                >
                  {/* Selection indicator */}
                  <text fg={isSelected ? colors.accent.primary : 'transparent'}>
                    {isSelected ? '▸ ' : '  '}
                  </text>

                  {/* Issue Key */}
                  <text fg={colors.accent.tertiary} style={{ width: 12 }}>
                    {truncateText(issue.key, 11)}
                  </text>

                  {/* Type */}
                  <text fg={colors.fg.secondary} style={{ width: 10 }}>
                    {truncateText(issue.type, 9)}
                  </text>

                  {/* Priority */}
                  <text fg={priorityColor} style={{ width: 10 }}>
                    {truncateText(issue.priority ?? 'N/A', 9)}
                  </text>

                  {/* Status with indicator */}
                  <text fg={statusColor} style={{ width: 12 }}>
                    {statusIndicator} {truncateText(issue.status, 9)}
                  </text>

                  {/* Summary */}
                  <text fg={isSelected ? colors.fg.primary : colors.fg.secondary}>
                    {truncateText(issue.summary, 45)}
                  </text>
                </box>
              );
            })}
          </scrollbox>
        )}
      </box>

      {/* Selected Issue Preview (when an issue is selected) */}
      {filteredIssues.length > 0 && filteredIssues[selectedIndex] && (
        <box
          style={{
            width: '100%',
            height: 4,
            flexDirection: 'column',
            backgroundColor: colors.bg.secondary,
            paddingLeft: 1,
            paddingRight: 1,
            border: true,
            borderColor: colors.border.normal,
          }}
        >
          <text fg={colors.fg.muted}>Selected:</text>
          <text fg={colors.accent.primary}>
            {filteredIssues[selectedIndex].key}: {filteredIssues[selectedIndex].summary}
          </text>
        </box>
      )}

      {/* Footer with instructions */}
      <box
        style={{
          width: '100%',
          height: 3,
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.bg.secondary,
          paddingLeft: 1,
          paddingRight: 1,
          border: true,
          borderColor: colors.border.normal,
          gap: 2,
        }}
      >
        <text fg={colors.fg.muted}>
          <span fg={colors.accent.primary}>Enter</span> Select
        </text>
        <text fg={colors.fg.muted}>
          <span fg={colors.accent.primary}>↑↓</span> Navigate
        </text>
        <text fg={colors.fg.muted}>
          <span fg={colors.accent.primary}>/</span> Filter
        </text>
        <text fg={colors.fg.muted}>
          <span fg={colors.accent.primary}>Esc</span> {isFilterActive ? 'Clear Filter' : 'Cancel'}
        </text>
      </box>
    </box>
  );
}
