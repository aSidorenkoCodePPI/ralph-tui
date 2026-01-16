/**
 * ABOUTME: Worker Progress Dashboard component for the Ralph TUI.
 * Displays real-time worker progress during parallel execution with status icons,
 * progress bars, elapsed time, and streaming output with worker prefixes.
 */

import type { ReactNode } from 'react';
import { useState, useEffect, useRef } from 'react';
import { colors } from '../theme.js';
import type { WorkerState, WorkerProgressState } from '../worker-types.js';
import { workerStatusIndicators, workerStatusColors, formatWorkerElapsedTime } from '../worker-types.js';

/**
 * Props for the WorkerProgressDashboard component.
 */
export interface WorkerProgressDashboardProps {
  /** Current worker progress state */
  progressState: WorkerProgressState;
  /** Callback when verbose mode is toggled */
  onToggleVerbose?: () => void;
  /** Maximum height for the component */
  maxHeight?: number;
}

/**
 * Truncate text to fit within a maximum width.
 */
function truncateText(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return text.slice(0, maxWidth - 1) + '…';
}

/**
 * Overall progress bar showing completion percentage.
 * Displays as "▓▓▓▓░░░░ 3/5 workers complete (60%)"
 */
function OverallProgressBar({
  completedCount,
  totalCount,
  width = 20,
}: {
  completedCount: number;
  totalCount: number;
  width?: number;
}): ReactNode {
  const percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const filledWidth = Math.floor((percentage / 100) * width);
  const emptyWidth = width - filledWidth;

  const filledBar = '▓'.repeat(filledWidth);
  const emptyBar = '░'.repeat(emptyWidth);

  return (
    <box style={{ flexDirection: 'row', gap: 1 }}>
      <text>
        <span fg={colors.status.success}>{filledBar}</span>
        <span fg={colors.fg.dim}>{emptyBar}</span>
      </text>
      <text fg={colors.fg.primary}>
        {completedCount}/{totalCount} workers complete
      </text>
      <text fg={colors.fg.muted}>({percentage}%)</text>
    </box>
  );
}

/**
 * Single worker row showing status icon, name, folder/file counts, and elapsed time.
 * Format: "▶ worker-name    42 folders  156 files  1m 23s"
 */
function WorkerRow({
  worker,
  isSelected,
  maxNameWidth = 20,
}: {
  worker: WorkerState;
  isSelected?: boolean;
  maxNameWidth?: number;
}): ReactNode {
  const statusIcon = workerStatusIndicators[worker.status];
  const statusColor = workerStatusColors[worker.status];
  const nameDisplay = truncateText(worker.name, maxNameWidth);
  const elapsedDisplay = formatWorkerElapsedTime(worker.elapsedMs);

  // Build status suffix for retrying state
  const retrySuffix = worker.status === 'retrying' && worker.retryAttempt
    ? ` (${worker.retryAttempt}/${worker.maxRetries})`
    : '';

  return (
    <box
      style={{
        width: '100%',
        flexDirection: 'row',
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: isSelected ? colors.bg.highlight : 'transparent',
      }}
    >
      <text>
        <span fg={statusColor}>{statusIcon}</span>
        <span fg={colors.fg.primary}> {nameDisplay.padEnd(maxNameWidth)}</span>
        <span fg={colors.fg.muted}> {String(worker.folderCount).padStart(4)} folders</span>
        <span fg={colors.fg.muted}> {String(worker.fileCount).padStart(5)} files</span>
        <span fg={colors.fg.secondary}> {elapsedDisplay.padStart(8)}</span>
        {retrySuffix && <span fg={colors.status.warning}>{retrySuffix}</span>}
      </text>
    </box>
  );
}

/**
 * Worker list showing all workers with their current status.
 * Supports keyboard navigation with visual selection highlighting.
 */
function WorkerList({
  workers,
  maxHeight,
  selectedIndex,
}: {
  workers: WorkerState[];
  maxHeight?: number;
  selectedIndex: number;
}): ReactNode {
  // Calculate the maximum name width based on longest worker name
  const maxNameWidth = Math.min(25, Math.max(15, ...workers.map(w => w.name.length)));

  return (
    <box
      title="Workers (↑↓ navigate, Enter focus)"
      style={{
        border: true,
        borderColor: colors.border.normal,
        backgroundColor: colors.bg.secondary,
        flexDirection: 'column',
        maxHeight: maxHeight,
      }}
    >
      {/* Header row */}
      <box style={{ flexDirection: 'row', paddingLeft: 1, paddingRight: 1, marginBottom: 1 }}>
        <text fg={colors.fg.muted}>
          <span>{'  '}</span>
          <span>{'Name'.padEnd(maxNameWidth)}</span>
          <span>{' '.repeat(4)}Folders</span>
          <span>{' '.repeat(2)}Files</span>
          <span>{' '.repeat(4)}Time</span>
        </text>
      </box>
      <scrollbox style={{ flexGrow: 1 }}>
        {workers.map((worker, index) => (
          <WorkerRow
            key={worker.id}
            worker={worker}
            isSelected={index === selectedIndex}
            maxNameWidth={maxNameWidth}
          />
        ))}
      </scrollbox>
    </box>
  );
}

/**
 * Streaming output section showing latest worker output with worker name prefixes.
 * In focus mode, shows only the selected worker's full streaming output.
 * Format: "[worker-name] Analyzing..."
 */
function StreamingOutput({
  workers,
  verboseMode,
  maxLines = 10,
  focusMode,
  selectedWorkerIndex,
}: {
  workers: WorkerState[];
  verboseMode: boolean;
  maxLines?: number;
  focusMode: boolean;
  selectedWorkerIndex: number;
}): ReactNode {
  // In focus mode, only show selected worker's output
  const selectedWorker = workers[selectedWorkerIndex];
  const workersToShow = focusMode && selectedWorker ? [selectedWorker] : workers;
  
  // Collect output lines from relevant workers, most recent first
  const outputLines: Array<{ workerId: string; workerName: string; line: string }> = [];

  for (const worker of workersToShow) {
    if (worker.latestOutput) {
      // Split output into lines and take recent ones
      const lines = worker.latestOutput.split('\n').filter(l => l.trim());
      // In focus mode or verbose mode, show more lines
      const recentLines = (focusMode || verboseMode) ? lines : lines.slice(-3);
      
      for (const line of recentLines) {
        outputLines.push({
          workerId: worker.id,
          workerName: worker.name,
          line: line.trim(),
        });
      }
    }
  }

  // Take most recent lines based on maxLines (more in focus mode)
  const linesToShow = focusMode ? maxLines * 3 : maxLines;
  const displayLines = outputLines.slice(-linesToShow);

  // Build title based on mode
  const title = focusMode 
    ? `Focus: ${selectedWorker?.name ?? 'Unknown'} (Enter/Esc to exit)`
    : `Output ${verboseMode ? '[Verbose]' : ''}`;

  return (
    <box
      title={title}
      style={{
        border: true,
        borderColor: focusMode ? colors.accent.primary : colors.border.normal,
        backgroundColor: colors.bg.tertiary,
        flexGrow: 1,
        flexDirection: 'column',
      }}
    >
      <scrollbox style={{ flexGrow: 1, padding: 1 }}>
        {displayLines.length === 0 ? (
          <text fg={colors.fg.muted}>
            {focusMode 
              ? `Waiting for output from ${selectedWorker?.name ?? 'worker'}...`
              : 'Waiting for worker output...'}
          </text>
        ) : (
          displayLines.map((item, index) => (
            <box key={`${item.workerId}-${index}`} style={{ flexDirection: 'row' }}>
              <text>
                {!focusMode && (
                  <span fg={colors.accent.tertiary}>[{truncateText(item.workerName, 15)}]</span>
                )}
                <span fg={colors.fg.secondary}>{focusMode ? '' : ' '}{item.line}</span>
              </text>
            </box>
          ))
        )}
      </scrollbox>
    </box>
  );
}

/**
 * Resource usage summary showing peak memory and CPU.
 */
function ResourceSummary({
  peakMemoryMB,
  peakCpuPercent,
  elapsedMs,
}: {
  peakMemoryMB?: number;
  peakCpuPercent?: number;
  elapsedMs: number;
}): ReactNode {
  return (
    <box style={{ flexDirection: 'row', gap: 3, paddingLeft: 1 }}>
      <text fg={colors.fg.muted}>
        Elapsed: <span fg={colors.fg.secondary}>{formatWorkerElapsedTime(elapsedMs)}</span>
      </text>
      {peakMemoryMB !== undefined && (
        <text fg={colors.fg.muted}>
          Peak Memory: <span fg={colors.fg.secondary}>{peakMemoryMB.toFixed(0)} MB</span>
        </text>
      )}
      {peakCpuPercent !== undefined && (
        <text fg={colors.fg.muted}>
          Peak CPU: <span fg={colors.fg.secondary}>{peakCpuPercent.toFixed(0)}%</span>
        </text>
      )}
    </box>
  );
}

/**
 * Worker Progress Dashboard component.
 * Displays comprehensive worker execution progress with:
 * - Overall progress bar with percentage
 * - Worker list with status icons (○ queued, ▶ running, ✓ complete, ✗ error, ↻ retrying)
 * - Each worker row shows: name, folder count, file count, elapsed time
 * - Real-time streaming output with worker name prefixes
 * - Resource usage summary (memory, CPU)
 */
export function WorkerProgressDashboard({
  progressState,
  onToggleVerbose: _onToggleVerbose,
  maxHeight,
}: WorkerProgressDashboardProps): ReactNode {
  // Track elapsed time with automatic updates every 500ms
  const [, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Note: onToggleVerbose is available for future use but currently the parent handles the 'v' key
  void _onToggleVerbose;

  useEffect(() => {
    // Update every 500ms while there are running workers
    if (progressState.runningCount > 0) {
      tickRef.current = setInterval(() => {
        setTick(t => t + 1);
      }, 500);
    }

    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
      }
    };
  }, [progressState.runningCount]);

  // Calculate worker list height (roughly half of available space)
  const workerListHeight = maxHeight ? Math.floor(maxHeight * 0.4) : undefined;

  return (
    <box
      style={{
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        backgroundColor: colors.bg.primary,
        gap: 1,
      }}
    >
      {/* Overall progress bar */}
      <box
        style={{
          padding: 1,
          backgroundColor: colors.bg.secondary,
          border: true,
          borderColor: colors.border.normal,
        }}
      >
        <OverallProgressBar
          completedCount={progressState.completedCount}
          totalCount={progressState.totalCount}
        />
      </box>

      {/* Worker list - hidden in focus mode to give more space to output */}
      {!progressState.focusMode && (
        <WorkerList
          workers={progressState.workers}
          maxHeight={workerListHeight}
          selectedIndex={progressState.selectedWorkerIndex}
        />
      )}

      {/* Streaming output */}
      <StreamingOutput
        workers={progressState.workers}
        verboseMode={progressState.verboseMode}
        maxLines={progressState.verboseMode ? 20 : 10}
        focusMode={progressState.focusMode}
        selectedWorkerIndex={progressState.selectedWorkerIndex}
      />

      {/* Resource summary */}
      <ResourceSummary
        peakMemoryMB={progressState.peakMemoryMB}
        peakCpuPercent={progressState.peakCpuPercent}
        elapsedMs={progressState.elapsedMs}
      />

      {/* Keyboard shortcuts in status bar per AC */}
      <box style={{ paddingLeft: 1, flexDirection: 'row', gap: 2 }}>
        <text fg={colors.fg.dim}>
          <span fg={colors.accent.primary}>↑↓</span> navigate
        </text>
        <text fg={colors.fg.dim}>
          <span fg={colors.accent.primary}>Enter</span> {progressState.focusMode ? 'exit' : 'focus'}
        </text>
        {progressState.focusMode && (
          <text fg={colors.fg.dim}>
            <span fg={colors.accent.primary}>Esc</span> exit focus
          </text>
        )}
        <text fg={colors.fg.dim}>
          <span fg={colors.accent.primary}>v</span> verbose{progressState.verboseMode ? <span fg={colors.status.info}> [ON]</span> : ''}
        </text>
        <text fg={colors.fg.dim}>
          <span fg={colors.accent.primary}>q</span> quit
        </text>
      </box>
    </box>
  );
}
