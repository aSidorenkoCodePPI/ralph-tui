/**
 * ABOUTME: Issue selection application component for the Ralph TUI.
 * Provides keyboard navigation, filtering, and issue selection functionality.
 * Used for selecting a Jira issue for PRD generation workflow.
 */

import type { ReactNode } from 'react';
import { useState, useCallback, useMemo } from 'react';
import { useKeyboard } from '@opentui/react';
import { IssueSelectionView } from './IssueSelectionView.js';
import type { JiraIssueWithPriority } from './IssueSelectionView.js';

/**
 * Props for the IssueSelectionApp component
 */
export interface IssueSelectionAppProps {
  /** List of issues to select from */
  issues: JiraIssueWithPriority[];
  /** Callback when user selects an issue */
  onIssueSelected: (issue: JiraIssueWithPriority) => void;
  /** Callback when user cancels selection */
  onCancel: () => void;
  /** Whether issues are still loading */
  loading?: boolean;
  /** Error message if loading failed */
  error?: string;
}

/**
 * IssueSelectionApp component
 * Main application component for issue selection mode
 */
export function IssueSelectionApp({
  issues,
  onIssueSelected,
  onCancel,
  loading = false,
  error,
}: IssueSelectionAppProps): ReactNode {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filterQuery, setFilterQuery] = useState('');
  const [isFilterActive, setIsFilterActive] = useState(false);

  // Filter issues based on query
  const filteredIssues = useMemo(() => {
    if (!filterQuery.trim()) {
      return issues;
    }
    const query = filterQuery.toLowerCase();
    return issues.filter(
      (issue) =>
        issue.key.toLowerCase().includes(query) ||
        issue.summary.toLowerCase().includes(query) ||
        issue.type.toLowerCase().includes(query) ||
        issue.status.toLowerCase().includes(query) ||
        (issue.priority?.toLowerCase().includes(query) ?? false)
    );
  }, [issues, filterQuery]);

  // Reset selection when filter changes
  const handleFilterChange = useCallback((newQuery: string) => {
    setFilterQuery(newQuery);
    setSelectedIndex(0);
  }, []);

  // Handle keyboard input
  const handleKeyboard = useCallback(
    (key: { name: string; sequence?: string; ctrl?: boolean; shift?: boolean }) => {
      // Handle filter mode
      if (isFilterActive) {
        switch (key.name) {
          case 'escape':
            // Clear filter and exit filter mode
            if (filterQuery) {
              handleFilterChange('');
            }
            setIsFilterActive(false);
            break;

          case 'return':
          case 'enter':
            // Exit filter mode and select if we have results
            setIsFilterActive(false);
            if (filteredIssues.length > 0 && filteredIssues[selectedIndex]) {
              onIssueSelected(filteredIssues[selectedIndex]);
            }
            break;

          case 'backspace':
            // Remove last character from filter
            if (filterQuery.length > 0) {
              handleFilterChange(filterQuery.slice(0, -1));
            }
            break;

          case 'up':
            // Navigate up while filtering
            setSelectedIndex((prev) => Math.max(0, prev - 1));
            break;

          case 'down':
            // Navigate down while filtering
            setSelectedIndex((prev) => Math.min(filteredIssues.length - 1, prev + 1));
            break;

          default:
            // Add character to filter if it's a printable character
            if (key.sequence && key.sequence.length === 1 && !key.ctrl) {
              handleFilterChange(filterQuery + key.sequence);
            }
            break;
        }
        return;
      }

      // Normal mode (not filtering)
      switch (key.name) {
        case 'escape':
        case 'q':
          onCancel();
          break;

        case 'up':
        case 'k':
          setSelectedIndex((prev) => Math.max(0, prev - 1));
          break;

        case 'down':
        case 'j':
          setSelectedIndex((prev) => Math.min(filteredIssues.length - 1, prev + 1));
          break;

        case 'return':
        case 'enter':
          // Select issue
          if (filteredIssues.length > 0 && filteredIssues[selectedIndex]) {
            onIssueSelected(filteredIssues[selectedIndex]);
          }
          break;

        default:
          // Start filter mode if user types '/' or any letter
          if (key.sequence === '/') {
            setIsFilterActive(true);
          } else if (key.sequence && key.sequence.length === 1 && /[a-zA-Z0-9]/.test(key.sequence) && !key.ctrl) {
            // Start filtering with the typed character
            setIsFilterActive(true);
            handleFilterChange(key.sequence);
          }
          break;
      }
    },
    [
      isFilterActive,
      filterQuery,
      filteredIssues,
      selectedIndex,
      onIssueSelected,
      onCancel,
      handleFilterChange,
    ]
  );

  useKeyboard(handleKeyboard);

  return (
    <IssueSelectionView
      issues={issues}
      filteredIssues={filteredIssues}
      selectedIndex={selectedIndex}
      filterQuery={filterQuery}
      isFilterActive={isFilterActive}
      loading={loading}
      error={error}
    />
  );
}
