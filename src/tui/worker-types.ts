/**
 * ABOUTME: Type definitions for worker progress display in the TUI.
 * Defines worker state, status types, and event structures for real-time progress tracking.
 */

/**
 * Worker execution status for TUI display.
 * Maps to specific status icons:
 * - ○ queued: Waiting to start
 * - ▶ running: Currently executing
 * - ✓ complete: Finished successfully
 * - ✗ error: Failed with error
 * - ↻ retrying: Retrying after failure
 * - ⏹ canceling: Being terminated due to user cancellation
 */
export type WorkerStatus = 'queued' | 'running' | 'complete' | 'error' | 'retrying' | 'canceling';

/**
 * Status indicator icons for worker display.
 */
export const workerStatusIndicators: Record<WorkerStatus, string> = {
  queued: '○',
  running: '▶',
  complete: '✓',
  error: '✗',
  retrying: '↻',
  canceling: '⏹',
};

/**
 * Status colors for worker display (hex colors matching theme).
 */
export const workerStatusColors: Record<WorkerStatus, string> = {
  queued: '#565f89',   // muted gray
  running: '#7aa2f7',  // blue
  complete: '#9ece6a', // green
  error: '#f7768e',    // red
  retrying: '#e0af68', // yellow/warning
  canceling: '#bb9af7', // purple
};

/**
 * State of a single worker in the parallel execution system.
 */
export interface WorkerState {
  /** Unique identifier for this worker (usually group name) */
  id: string;
  
  /** Human-readable name for display */
  name: string;
  
  /** Current execution status */
  status: WorkerStatus;
  
  /** Number of folders assigned to this worker */
  folderCount: number;
  
  /** Number of files in the assigned folders */
  fileCount: number;
  
  /** Elapsed time in milliseconds (updated during execution) */
  elapsedMs: number;
  
  /** Timestamp when worker started (ISO 8601), undefined if queued */
  startedAt?: string;
  
  /** Timestamp when worker completed (ISO 8601), undefined if not complete */
  completedAt?: string;
  
  /** Error message if status is 'error' */
  error?: string;
  
  /** Current retry attempt (1-based), only set if retrying */
  retryAttempt?: number;
  
  /** Maximum retry attempts allowed */
  maxRetries?: number;
  
  /** Latest output line from this worker (for streaming display) */
  latestOutput?: string;
  
  /** Full stdout buffer (for verbose mode) */
  stdout?: string;
  
  /** Full stderr buffer */
  stderr?: string;
}

/**
 * Overall worker execution progress state.
 */
export interface WorkerProgressState {
  /** All workers in the execution */
  workers: WorkerState[];
  
  /** Number of workers completed (success or error) */
  completedCount: number;
  
  /** Number of workers currently running */
  runningCount: number;
  
  /** Number of workers waiting to start */
  queuedCount: number;
  
  /** Total number of workers */
  totalCount: number;
  
  /** Whether verbose mode is enabled (shows more output detail) */
  verboseMode: boolean;
  
  /** Overall progress percentage (0-100) */
  progressPercent: number;
  
  /** Timestamp when parallel execution started (ISO 8601) */
  startedAt?: string;
  
  /** Total elapsed time in milliseconds */
  elapsedMs: number;
  
  /** Peak memory usage in MB (from resource monitoring) */
  peakMemoryMB?: number;
  
  /** Peak CPU usage percentage */
  peakCpuPercent?: number;
  
  /** Index of the currently selected worker for navigation (0-based) */
  selectedWorkerIndex: number;
  
  /** Whether focus mode is enabled (shows only selected worker's output) */
  focusMode: boolean;
}

/**
 * Worker event types for real-time updates.
 */
export type WorkerEventType =
  | 'worker:queued'
  | 'worker:started'
  | 'worker:output'
  | 'worker:complete'
  | 'worker:error'
  | 'worker:retrying'
  | 'worker:canceling'
  | 'workers:progress'
  | 'workers:all-complete'
  | 'workers:canceling'
  | 'merge:started'
  | 'merge:progress'
  | 'merge:complete'
  | 'merge:error';

/**
 * Base worker event structure.
 */
export interface WorkerEventBase {
  /** Event type */
  type: WorkerEventType;
  
  /** Timestamp of the event (ISO 8601) */
  timestamp: string;
}

/**
 * Worker queued event - worker is waiting to start.
 */
export interface WorkerQueuedEvent extends WorkerEventBase {
  type: 'worker:queued';
  /** Worker ID */
  workerId: string;
  /** Worker name for display */
  workerName: string;
  /** Folder count assigned */
  folderCount: number;
  /** File count in assigned folders */
  fileCount: number;
}

/**
 * Worker started event - worker has begun execution.
 */
export interface WorkerStartedEvent extends WorkerEventBase {
  type: 'worker:started';
  /** Worker ID */
  workerId: string;
}

/**
 * Worker output event - streaming output from worker.
 */
export interface WorkerOutputEvent extends WorkerEventBase {
  type: 'worker:output';
  /** Worker ID */
  workerId: string;
  /** Output data */
  data: string;
  /** Stream type */
  stream: 'stdout' | 'stderr';
}

/**
 * Worker complete event - worker finished successfully.
 */
export interface WorkerCompleteEvent extends WorkerEventBase {
  type: 'worker:complete';
  /** Worker ID */
  workerId: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Worker error event - worker failed with error.
 */
export interface WorkerErrorEvent extends WorkerEventBase {
  type: 'worker:error';
  /** Worker ID */
  workerId: string;
  /** Error message */
  error: string;
  /** Duration in milliseconds before failure */
  durationMs: number;
}

/**
 * Worker retrying event - worker is retrying after failure.
 */
export interface WorkerRetryingEvent extends WorkerEventBase {
  type: 'worker:retrying';
  /** Worker ID */
  workerId: string;
  /** Retry attempt number (1-based) */
  retryAttempt: number;
  /** Maximum retry attempts */
  maxRetries: number;
  /** Delay before retry in milliseconds */
  delayMs: number;
  /** Error from previous attempt */
  previousError: string;
}

/**
 * Workers progress event - periodic progress update.
 */
export interface WorkersProgressEvent extends WorkerEventBase {
  type: 'workers:progress';
  /** Completed count */
  completedCount: number;
  /** Running count */
  runningCount: number;
  /** Total count */
  totalCount: number;
  /** Progress percentage (0-100) */
  progressPercent: number;
  /** Elapsed time in milliseconds */
  elapsedMs: number;
  /** Current memory usage in MB */
  memoryMB?: number;
  /** Current CPU usage percentage */
  cpuPercent?: number;
}

/**
 * All workers complete event - parallel execution finished.
 */
export interface WorkersAllCompleteEvent extends WorkerEventBase {
  type: 'workers:all-complete';
  /** Total workers executed */
  totalCount: number;
  /** Successful workers count */
  successCount: number;
  /** Failed workers count */
  failedCount: number;
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Sum of individual worker durations */
  sequentialDurationMs: number;
  /** Speedup factor (sequential / parallel) */
  speedupFactor: number;
}

/**
 * Merge started event - merge phase has begun.
 */
export interface MergeStartedEvent extends WorkerEventBase {
  type: 'merge:started';
  /** Number of worker outputs to merge */
  workerCount: number;
}

/**
 * Merge progress event - periodic update during merge.
 */
export interface MergeProgressEvent extends WorkerEventBase {
  type: 'merge:progress';
  /** Progress message */
  message: string;
  /** Elapsed time in milliseconds */
  elapsedMs: number;
}

/**
 * Merge complete event - merge finished successfully.
 */
export interface MergeCompleteEvent extends WorkerEventBase {
  type: 'merge:complete';
  /** Duration in milliseconds */
  durationMs: number;
  /** Path to the merged output file */
  outputPath: string;
}

/**
 * Merge error event - merge failed.
 */
export interface MergeErrorEvent extends WorkerEventBase {
  type: 'merge:error';
  /** Error message */
  error: string;
  /** Path to backup file (if available) */
  backupPath?: string;
}

/**
 * Worker canceling event - worker is being terminated due to user cancellation.
 */
export interface WorkerCancelingEvent extends WorkerEventBase {
  type: 'worker:canceling';
  /** Worker ID */
  workerId: string;
}

/**
 * Workers canceling event - graceful shutdown initiated.
 */
export interface WorkersCancelingEvent extends WorkerEventBase {
  type: 'workers:canceling';
  /** Number of running workers being terminated */
  runningCount: number;
  /** Total number of workers */
  totalCount: number;
}

/**
 * Union of all worker events.
 */
export type WorkerEvent =
  | WorkerQueuedEvent
  | WorkerStartedEvent
  | WorkerOutputEvent
  | WorkerCompleteEvent
  | WorkerErrorEvent
  | WorkerRetryingEvent
  | WorkerCancelingEvent
  | WorkersProgressEvent
  | WorkersAllCompleteEvent
  | WorkersCancelingEvent
  | MergeStartedEvent
  | MergeProgressEvent
  | MergeCompleteEvent
  | MergeErrorEvent;

/**
 * Worker event listener function type.
 */
export type WorkerEventListener = (event: WorkerEvent) => void;

/**
 * Warning summary for a worker or folder that encountered issues.
 */
export interface WorkerWarning {
  /** Worker or folder ID */
  workerId: string;
  /** Worker or folder name */
  workerName: string;
  /** Type of warning */
  type: 'failure' | 'retry' | 'partial';
  /** Number of retries attempted (if applicable) */
  retryCount?: number;
  /** Error message (if applicable) */
  error?: string;
}

/**
 * Completion summary data for display in the TUI after analysis completes.
 * US-008: View Analysis Summary on Completion
 */
export interface CompletionSummary {
  /** Total elapsed time in milliseconds */
  totalElapsedMs: number;
  /** Number of folders analyzed */
  foldersAnalyzed: number;
  /** Number of files processed */
  filesProcessed: number;
  /** Number of workers that succeeded */
  workersSucceeded: number;
  /** Number of workers that failed */
  workersFailed: number;
  /** Total number of workers */
  totalWorkers: number;
  /** Path to the output file */
  outputFilePath?: string;
  /** Size of output file in bytes */
  outputFileSizeBytes?: number;
  /** Whether the analysis was successful overall */
  success: boolean;
  /** List of warnings (failed folders, retries, etc.) */
  warnings: WorkerWarning[];
  /** Peak memory usage in MB */
  peakMemoryMB?: number;
  /** Peak CPU usage percentage */
  peakCpuPercent?: number;
  /** Speedup factor (sequential / parallel) */
  speedupFactor?: number;
  /** Per-worker statistics for verbose mode */
  workerStats?: WorkerStatistics[];
}

/**
 * Per-worker statistics for verbose mode display.
 */
export interface WorkerStatistics {
  /** Worker ID/name */
  id: string;
  /** Worker display name */
  name: string;
  /** Number of folders this worker analyzed */
  folderCount: number;
  /** Number of files this worker processed */
  fileCount: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Whether this worker succeeded */
  success: boolean;
  /** Number of retries (0 if no retries) */
  retryCount: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Create initial worker state from folder groupings.
 */
export function createWorkerState(
  id: string,
  name: string,
  folderCount: number,
  fileCount: number
): WorkerState {
  return {
    id,
    name,
    status: 'queued',
    folderCount,
    fileCount,
    elapsedMs: 0,
  };
}

/**
 * Create initial worker progress state.
 */
export function createWorkerProgressState(workers: WorkerState[]): WorkerProgressState {
  return {
    workers,
    completedCount: 0,
    runningCount: 0,
    queuedCount: workers.length,
    totalCount: workers.length,
    verboseMode: false,
    progressPercent: 0,
    elapsedMs: 0,
    selectedWorkerIndex: 0,
    focusMode: false,
  };
}

/**
 * Format elapsed time as human-readable string.
 */
export function formatWorkerElapsedTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}
