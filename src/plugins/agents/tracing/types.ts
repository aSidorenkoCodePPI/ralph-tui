/**
 * ABOUTME: Type definitions for subagent lifecycle event tracking and JSONL parsing.
 * Defines interfaces for parsing and tracking agent subagent spawns,
 * progress updates, completions, and errors from JSONL output.
 */

/**
 * Represents a parsed JSONL message from agent output (e.g., Claude Code).
 * Agents may emit various event types as JSON objects, one per line.
 */
export interface AgentJsonlMessage {
  /** The type of message (e.g., 'assistant', 'user', 'result', 'system') */
  type?: string;
  /** Message content for text messages */
  message?: string;
  /** Tool use information if applicable */
  tool?: {
    name?: string;
    input?: Record<string, unknown>;
  };
  /** Result data for completion messages */
  result?: unknown;
  /** Cost information if provided */
  cost?: {
    inputTokens?: number;
    outputTokens?: number;
    totalUSD?: number;
  };
  /** Session ID for conversation tracking */
  sessionId?: string;
  /** Raw parsed JSON for custom handling */
  raw: Record<string, unknown>;
}

/**
 * Result of parsing a JSONL line.
 * Success contains the parsed message, failure contains the raw text.
 */
export type JsonlParseResult =
  | { success: true; message: AgentJsonlMessage }
  | { success: false; raw: string; error: string };

/**
 * Streaming JSONL parser interface for processing agent output.
 * Use this for processing streaming output where data chunks may
 * split across line boundaries.
 */
export interface StreamingJsonlParser {
  /** Push a chunk of data to the parser. Returns any complete lines that were parsed. */
  push: (chunk: string) => JsonlParseResult[];
  /** Flush any remaining buffered content. Call this when the stream ends. */
  flush: () => JsonlParseResult[];
  /** Get the current accumulated state. */
  getState: () => { messages: AgentJsonlMessage[]; fallback: string[] };
}

/**
 * Parse a single line of JSONL output from an agent.
 * Attempts to parse as JSON, falls back to raw text on failure.
 *
 * @param line A single line of output (may include newline characters)
 * @returns Parse result with either the parsed message or raw text
 */
export function parseJsonlLine(line: string): JsonlParseResult {
  const trimmed = line.trim();

  // Skip empty lines
  if (!trimmed) {
    return { success: false, raw: line, error: 'Empty line' };
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;

    // Build the structured message from parsed JSON
    const message: AgentJsonlMessage = {
      raw: parsed,
    };

    // Extract common fields if present
    if (typeof parsed.type === 'string') {
      message.type = parsed.type;
    }
    if (typeof parsed.message === 'string') {
      message.message = parsed.message;
    }
    if (typeof parsed.sessionId === 'string') {
      message.sessionId = parsed.sessionId;
    }
    if (parsed.result !== undefined) {
      message.result = parsed.result;
    }

    // Extract tool information if present
    if (parsed.tool && typeof parsed.tool === 'object') {
      const toolObj = parsed.tool as Record<string, unknown>;
      message.tool = {
        name: typeof toolObj.name === 'string' ? toolObj.name : undefined,
        input:
          toolObj.input && typeof toolObj.input === 'object'
            ? (toolObj.input as Record<string, unknown>)
            : undefined,
      };
    }

    // Extract cost information if present
    if (parsed.cost && typeof parsed.cost === 'object') {
      const costObj = parsed.cost as Record<string, unknown>;
      message.cost = {
        inputTokens:
          typeof costObj.inputTokens === 'number'
            ? costObj.inputTokens
            : undefined,
        outputTokens:
          typeof costObj.outputTokens === 'number'
            ? costObj.outputTokens
            : undefined,
        totalUSD:
          typeof costObj.totalUSD === 'number' ? costObj.totalUSD : undefined,
      };
    }

    return { success: true, message };
  } catch (err) {
    // JSON parsing failed - return as raw text
    return {
      success: false,
      raw: line,
      error: err instanceof Error ? err.message : 'Parse error',
    };
  }
}

/**
 * Parse a complete JSONL output string from an agent.
 * Handles multi-line output, parsing each line independently.
 * Lines that fail to parse are returned as raw text in the fallback array.
 *
 * @param output Complete output string (may contain multiple lines)
 * @returns Object with parsed messages and any raw fallback lines
 */
export function parseJsonlOutput(output: string): {
  messages: AgentJsonlMessage[];
  fallback: string[];
} {
  const messages: AgentJsonlMessage[] = [];
  const fallback: string[] = [];

  const lines = output.split('\n');

  for (const line of lines) {
    const result = parseJsonlLine(line);
    if (result.success) {
      messages.push(result.message);
    } else if (result.raw.trim()) {
      // Only add non-empty lines to fallback
      fallback.push(result.raw);
    }
  }

  return { messages, fallback };
}

/**
 * Create a streaming JSONL parser that accumulates partial lines.
 * Use this for processing streaming output where data chunks may
 * split across line boundaries.
 *
 * @returns Parser object with push() method and getState() to retrieve results
 */
export function createStreamingJsonlParser(): StreamingJsonlParser {
  let buffer = '';
  const messages: AgentJsonlMessage[] = [];
  const fallback: string[] = [];

  return {
    /**
     * Push a chunk of data to the parser.
     * Returns any complete lines that were parsed.
     */
    push(chunk: string): JsonlParseResult[] {
      buffer += chunk;
      const results: JsonlParseResult[] = [];

      // Process complete lines (ending with newline)
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        const result = parseJsonlLine(line);
        results.push(result);

        if (result.success) {
          messages.push(result.message);
        } else if (result.raw.trim()) {
          fallback.push(result.raw);
        }
      }

      return results;
    },

    /**
     * Flush any remaining buffered content.
     * Call this when the stream ends to process any trailing content.
     */
    flush(): JsonlParseResult[] {
      if (!buffer.trim()) {
        buffer = '';
        return [];
      }

      const result = parseJsonlLine(buffer);
      buffer = '';

      if (result.success) {
        messages.push(result.message);
      } else if (result.raw.trim()) {
        fallback.push(result.raw);
      }

      return [result];
    },

    /**
     * Get the current accumulated state.
     */
    getState(): { messages: AgentJsonlMessage[]; fallback: string[] } {
      return { messages, fallback };
    },
  };
}

/**
 * Types of subagent lifecycle events.
 * - 'spawn': Subagent was started (Task tool invocation)
 * - 'progress': Subagent is making progress (intermediate updates)
 * - 'complete': Subagent finished successfully
 * - 'error': Subagent encountered an error
 */
export type SubagentEventType = 'spawn' | 'progress' | 'complete' | 'error';

/**
 * Base interface for all subagent events.
 */
export interface SubagentEventBase {
  /** Unique identifier for this subagent instance */
  id: string;

  /** Type of lifecycle event */
  type: SubagentEventType;

  /** Timestamp when the event occurred (ISO 8601) */
  timestamp: string;

  /** Type of agent being used (e.g., 'Explore', 'Bash', 'Plan') */
  agentType: string;

  /** Human-readable description of what the subagent is doing */
  description: string;

  /** ID of the parent subagent if this is a nested call, undefined for top-level */
  parentId?: string;
}

/**
 * Event emitted when a subagent is spawned via the Task tool.
 */
export interface SubagentSpawnEvent extends SubagentEventBase {
  type: 'spawn';

  /** The prompt/task given to the subagent */
  prompt: string;

  /** Model being used (if specified) */
  model?: string;
}

/**
 * Event emitted when a subagent reports progress.
 */
export interface SubagentProgressEvent extends SubagentEventBase {
  type: 'progress';

  /** Progress message or update */
  message: string;
}

/**
 * Event emitted when a subagent completes successfully.
 */
export interface SubagentCompleteEvent extends SubagentEventBase {
  type: 'complete';

  /** Exit status: 'success' or other status string */
  exitStatus: string;

  /** Duration of the subagent execution in milliseconds */
  durationMs: number;

  /** Summary of what the subagent accomplished */
  result?: string;
}

/**
 * Event emitted when a subagent encounters an error.
 */
export interface SubagentErrorEvent extends SubagentEventBase {
  type: 'error';

  /** Error message */
  errorMessage: string;

  /** Error code if available */
  errorCode?: string;

  /** Duration before error in milliseconds */
  durationMs?: number;
}

/**
 * Union of all subagent event types.
 */
export type SubagentEvent =
  | SubagentSpawnEvent
  | SubagentProgressEvent
  | SubagentCompleteEvent
  | SubagentErrorEvent;

/**
 * Callback function for receiving subagent events in real-time.
 */
export type SubagentEventCallback = (event: SubagentEvent) => void;

/**
 * State of a tracked subagent.
 */
export interface SubagentState {
  /** Unique identifier for this subagent */
  id: string;

  /** Type of agent */
  agentType: string;

  /** Description of the task */
  description: string;

  /** Current status */
  status: 'running' | 'completed' | 'error';

  /** Parent subagent ID if nested */
  parentId?: string;

  /** Child subagent IDs */
  childIds: string[];

  /** Timestamp when spawned */
  spawnedAt: string;

  /** Timestamp when completed/errored */
  endedAt?: string;

  /** Duration in milliseconds (computed when ended) */
  durationMs?: number;

  /** The prompt given to the subagent */
  prompt?: string;

  /** Result or error message */
  result?: string;
}

/**
 * Options for the SubagentTraceParser.
 */
export interface SubagentTraceParserOptions {
  /** Callback for real-time event updates */
  onEvent?: SubagentEventCallback;

  /** Whether to track parent-child hierarchy (default: true) */
  trackHierarchy?: boolean;
}

/**
 * Summary of subagent activity from a trace.
 */
export interface SubagentTraceSummary {
  /** Total number of subagents spawned */
  totalSpawned: number;

  /** Number of subagents that completed successfully */
  completed: number;

  /** Number of subagents that errored */
  errored: number;

  /** Number of subagents still running */
  running: number;

  /** Maximum nesting depth observed */
  maxDepth: number;

  /** Total duration of all completed subagents */
  totalDurationMs: number;

  /** Map of agent type to count */
  byAgentType: Record<string, number>;
}
