/**
 * ABOUTME: Agent plugins module for AI agent integrations.
 * This module exports plugin interfaces, registry, and implementations
 * for various AI agents (Claude Code, OpenCode, etc.)
 */

// Export types
export type {
  AgentPlugin,
  AgentPluginFactory,
  AgentPluginMeta,
  AgentPluginConfig,
  AgentDetectResult,
  AgentFileContext,
  AgentExecutionStatus,
  AgentExecutionResult,
  AgentExecuteOptions,
  AgentExecutionHandle,
  AgentSetupQuestion,
} from './types.js';

// Export base class
export { BaseAgentPlugin } from './base.js';

// Export registry
export { AgentRegistry, getAgentRegistry } from './registry.js';

// Export built-in plugin registration
export { registerBuiltinAgents } from './builtin/index.js';

// Export tracing module for subagent lifecycle tracking
export { SubagentTraceParser } from './tracing/index.js';
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
} from './tracing/index.js';
