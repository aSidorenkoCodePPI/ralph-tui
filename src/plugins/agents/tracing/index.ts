/**
 * ABOUTME: Exports for the subagent tracing module.
 * Provides types and parser for tracking Claude Code subagent lifecycle events.
 */

export { SubagentTraceParser } from './parser.js';
export type {
  SubagentEventType,
  SubagentEventBase,
  SubagentSpawnEvent,
  SubagentProgressEvent,
  SubagentCompleteEvent,
  SubagentErrorEvent,
  SubagentEvent,
  SubagentEventCallback,
  SubagentState,
  SubagentTraceParserOptions,
  SubagentTraceSummary,
} from './types.js';
