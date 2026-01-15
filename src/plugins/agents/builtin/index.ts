/**
 * ABOUTME: Built-in agent plugin registration.
 * Registers all bundled agent plugins with the AgentRegistry.
 */

import { getAgentRegistry } from '../registry.js';
import createOpenCodeAgent from './opencode.js';
import createCopilotAgent from './copilot.js';

/**
 * Register all built-in agent plugins with the registry.
 * Should be called once during application initialization.
 */
export function registerBuiltinAgents(): void {
  const registry = getAgentRegistry();

  // Register built-in plugins
  registry.registerBuiltin(createOpenCodeAgent);
  registry.registerBuiltin(createCopilotAgent);
}

// Export the factory functions for direct use
export { createOpenCodeAgent, createCopilotAgent };

// Export Copilot plugin class
export { CopilotAgentPlugin } from './copilot.js';
