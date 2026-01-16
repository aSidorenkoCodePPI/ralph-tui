/**
 * ABOUTME: WorkerProgressApp component for the Ralph TUI.
 * Main application component for displaying worker execution progress.
 * Integrates WorkerProgressDashboard with keyboard handling and state management.
 * Used by the learn command when executing workers with TUI enabled.
 */

import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import type { ReactNode } from 'react';
import { useState, useCallback, useEffect, useRef } from 'react';
import { colors, layout } from '../theme.js';
import { Header } from './Header.js';
import { Footer } from './Footer.js';
import { ConfirmationDialog } from './ConfirmationDialog.js';
import { WorkerProgressDashboard } from './WorkerProgressDashboard.js';
import type {
  WorkerState,
  WorkerProgressState,
  WorkerEvent,
  WorkerEventListener,
} from '../worker-types.js';

/**
 * Props for the WorkerProgressApp component.
 */
export interface WorkerProgressAppProps {
  /** Initial workers to display */
  initialWorkers: WorkerState[];
  /** Subscribe to worker events for real-time updates */
  onSubscribe?: (listener: WorkerEventListener) => () => void;
  /** Callback when quit is requested */
  onQuit?: () => Promise<void>;
  /** Callback when interrupt is confirmed */
  onInterrupt?: () => Promise<void>;
  /** Agent name being used for workers */
  agentName?: string;
  /** Model being used */
  currentModel?: string;
}

/**
 * Calculate overall progress percentage.
 */
function calculateProgressPercent(workers: WorkerState[]): number {
  if (workers.length === 0) return 0;
  const completed = workers.filter(w => w.status === 'complete' || w.status === 'error').length;
  return Math.round((completed / workers.length) * 100);
}

/**
 * Worker Progress App component.
 * Displays comprehensive worker execution progress with real-time updates.
 */
export function WorkerProgressApp({
  initialWorkers,
  onSubscribe,
  onQuit,
  onInterrupt,
  agentName = 'copilot',
  currentModel,
}: WorkerProgressAppProps): ReactNode {
  const { height } = useTerminalDimensions();
  
  // Worker state
  const [workers, setWorkers] = useState<WorkerState[]>(initialWorkers);
  const [verboseMode, setVerboseMode] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [peakMemoryMB, setPeakMemoryMB] = useState<number | undefined>(undefined);
  const [peakCpuPercent, setPeakCpuPercent] = useState<number | undefined>(undefined);
  const [startedAt, setStartedAt] = useState<string | undefined>(undefined);
  
  // Navigation state (US-005)
  const [selectedWorkerIndex, setSelectedWorkerIndex] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  
  // Dialog state
  const [showQuitDialog, setShowQuitDialog] = useState(false);
  
  // Timer ref for elapsed time updates
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  // Calculate derived state
  const completedCount = workers.filter(w => w.status === 'complete' || w.status === 'error').length;
  const runningCount = workers.filter(w => w.status === 'running').length;
  const queuedCount = workers.filter(w => w.status === 'queued').length;
  const totalCount = workers.length;
  const progressPercent = calculateProgressPercent(workers);
  
  // Determine overall status
  const isComplete = completedCount === totalCount;
  const hasErrors = workers.some(w => w.status === 'error');
  const status = isComplete 
    ? (hasErrors ? 'error' : 'complete') 
    : (runningCount > 0 ? 'executing' : 'ready');

  // Build progress state for dashboard
  const progressState: WorkerProgressState = {
    workers,
    completedCount,
    runningCount,
    queuedCount,
    totalCount,
    verboseMode,
    progressPercent,
    startedAt,
    elapsedMs,
    peakMemoryMB,
    peakCpuPercent,
    selectedWorkerIndex,
    focusMode,
  };

  // Start elapsed time timer
  useEffect(() => {
    startTimeRef.current = Date.now();
    setStartedAt(new Date().toISOString());
    
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 500); // Update every 500ms per AC

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  // Stop timer when all complete
  useEffect(() => {
    if (isComplete && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [isComplete]);

  // Subscribe to worker events
  useEffect(() => {
    if (!onSubscribe) return;

    const unsubscribe = onSubscribe((event: WorkerEvent) => {
      switch (event.type) {
        case 'worker:started':
          setWorkers(prev => prev.map(w => 
            w.id === event.workerId 
              ? { ...w, status: 'running', startedAt: event.timestamp }
              : w
          ));
          break;

        case 'worker:output':
          setWorkers(prev => prev.map(w => 
            w.id === event.workerId 
              ? { 
                  ...w, 
                  latestOutput: event.data,
                  stdout: event.stream === 'stdout' 
                    ? (w.stdout ?? '') + event.data 
                    : w.stdout,
                  stderr: event.stream === 'stderr'
                    ? (w.stderr ?? '') + event.data
                    : w.stderr,
                }
              : w
          ));
          break;

        case 'worker:complete':
          setWorkers(prev => prev.map(w => 
            w.id === event.workerId 
              ? { 
                  ...w, 
                  status: 'complete', 
                  completedAt: event.timestamp,
                  elapsedMs: event.durationMs,
                }
              : w
          ));
          break;

        case 'worker:error':
          setWorkers(prev => prev.map(w => 
            w.id === event.workerId 
              ? { 
                  ...w, 
                  status: 'error', 
                  completedAt: event.timestamp,
                  elapsedMs: event.durationMs,
                  error: event.error,
                }
              : w
          ));
          break;

        case 'worker:retrying':
          setWorkers(prev => prev.map(w => 
            w.id === event.workerId 
              ? { 
                  ...w, 
                  status: 'retrying', 
                  retryAttempt: event.retryAttempt,
                  maxRetries: event.maxRetries,
                }
              : w
          ));
          break;

        case 'workers:progress':
          setPeakMemoryMB(prev => 
            event.memoryMB && (!prev || event.memoryMB > prev) ? event.memoryMB : prev
          );
          setPeakCpuPercent(prev =>
            event.cpuPercent && (!prev || event.cpuPercent > prev) ? event.cpuPercent : prev
          );
          break;

        case 'workers:all-complete':
          // Final update handled by worker:complete events
          break;
      }
    });

    return unsubscribe;
  }, [onSubscribe]);

  // Handle keyboard input
  const handleKeyboard = useCallback(
    (key: { name: string; sequence?: string }) => {
      // Handle quit dialog
      if (showQuitDialog) {
        switch (key.name) {
          case 'y':
            setShowQuitDialog(false);
            onQuit?.();
            break;
          case 'n':
          case 'escape':
            setShowQuitDialog(false);
            break;
        }
        return;
      }

      switch (key.name) {
        case 'q':
          // Show quit confirmation if workers are still running per AC
          if (runningCount > 0) {
            setShowQuitDialog(true);
          } else {
            onQuit?.();
          }
          break;

        case 'escape':
          // Esc exits focus mode if active, otherwise show quit dialog
          if (focusMode) {
            setFocusMode(false);
          } else {
            setShowQuitDialog(true);
          }
          break;

        case 'return':
          // Enter toggles focus mode per AC
          setFocusMode(prev => !prev);
          break;

        case 'up':
          // Navigate up in worker list per AC
          setSelectedWorkerIndex(prev => Math.max(0, prev - 1));
          break;

        case 'down':
          // Navigate down in worker list per AC
          setSelectedWorkerIndex(prev => Math.min(workers.length - 1, prev + 1));
          break;

        case 'v':
          // Toggle verbose mode per AC
          setVerboseMode(prev => !prev);
          break;

        case 'c':
          // Ctrl+C to interrupt
          if (key.sequence === '\u0003') {
            if (onInterrupt) {
              onInterrupt();
            } else {
              setShowQuitDialog(true);
            }
          }
          break;
      }
    },
    [showQuitDialog, onQuit, onInterrupt, focusMode, runningCount, workers.length]
  );

  useKeyboard(handleKeyboard);

  // Calculate layout
  const contentHeight = Math.max(1, height - layout.header.height - layout.footer.height);

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
      <Header
        status={status as 'ready' | 'executing' | 'complete' | 'error'}
        elapsedTime={Math.floor(elapsedMs / 1000)}
        completedTasks={completedCount}
        totalTasks={totalCount}
        agentName={agentName}
        currentModel={currentModel}
        currentIteration={runningCount}
        maxIterations={totalCount}
      />

      {/* Main content - Worker Progress Dashboard */}
      <box
        style={{
          flexGrow: 1,
          height: contentHeight,
          padding: 1,
        }}
      >
        <WorkerProgressDashboard
          progressState={progressState}
          onToggleVerbose={() => setVerboseMode(prev => !prev)}
          maxHeight={contentHeight - 2}
        />
      </box>

      {/* Footer */}
      <Footer />

      {/* Quit Confirmation Dialog */}
      <ConfirmationDialog
        visible={showQuitDialog}
        title="Cancel Worker Execution?"
        message="All running workers will be terminated."
        hint="[y] Yes  [n/Esc] Cancel"
      />
    </box>
  );
}
