/**
 * ABOUTME: CLI commands for managing plugins.
 * Provides commands to list, inspect, and manage tracker and agent plugins.
 */

import {
  getTrackerRegistry,
  registerBuiltinTrackers,
} from '../plugins/trackers/index.js';
import {
  getAgentRegistry,
  registerBuiltinAgents,
} from '../plugins/agents/index.js';

/**
 * Print help for the plugins command.
 */
export function printPluginsHelp(): void {
  console.log(`
ralph-tui plugins - Manage and inspect plugins

Usage: ralph-tui plugins <subcommand>

Subcommands:
  agents     List all available agent plugins
  trackers   List all available tracker plugins

Options:
  --help, -h   Show this help message

Description:
  Ralph TUI uses a plugin system for both AI agents and task trackers.

  Agent plugins execute prompts via AI coding assistants:
    - copilot: GitHub Copilot CLI (copilot command)
    - opencode: OpenCode CLI (opencode command)

  Tracker plugins manage task lists and progress:
    - beads: Git-backed issue tracker (.beads/ directory)
    - beads-bv: Beads with bv graph analysis for smart task selection
    - json: Simple prd.json file-based tracking

  Custom plugins can be added to:
    ~/.config/ralph-tui/plugins/agents/
    ~/.config/ralph-tui/plugins/trackers/

Examples:
  ralph-tui plugins agents      # List agent plugins
  ralph-tui plugins trackers    # List tracker plugins
`);
}

/**
 * Output format for tracker plugin CLI commands
 */
interface TrackerPluginInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  builtin: boolean;
  features: {
    bidirectionalSync: boolean;
    hierarchy: boolean;
    dependencies: boolean;
  };
}

/**
 * Output format for agent plugin CLI commands
 */
interface AgentPluginInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  builtin: boolean;
  defaultCommand: string;
  features: {
    streaming: boolean;
    interrupt: boolean;
    fileContext: boolean;
  };
}

/**
 * List all available tracker plugins.
 * Called via: ralph-tui plugins trackers
 */
export async function listTrackerPlugins(): Promise<TrackerPluginInfo[]> {
  const registry = getTrackerRegistry();

  // Register built-in plugins if not already registered
  registerBuiltinTrackers();

  // Discover user plugins
  await registry.initialize();

  // Get all registered plugins
  const plugins = registry.getRegisteredPlugins();

  return plugins.map((meta) => ({
    id: meta.id,
    name: meta.name,
    description: meta.description,
    version: meta.version,
    builtin: registry.isBuiltin(meta.id),
    features: {
      bidirectionalSync: meta.supportsBidirectionalSync,
      hierarchy: meta.supportsHierarchy,
      dependencies: meta.supportsDependencies,
    },
  }));
}

/**
 * Print tracker plugins to console in a formatted table.
 */
export async function printTrackerPlugins(): Promise<void> {
  const plugins = await listTrackerPlugins();

  if (plugins.length === 0) {
    console.log('No tracker plugins found.');
    return;
  }

  console.log('\nAvailable Tracker Plugins:\n');
  console.log('─'.repeat(80));

  for (const plugin of plugins) {
    const typeLabel = plugin.builtin ? '(built-in)' : '(user)';
    console.log(`  ${plugin.id} ${typeLabel}`);
    console.log(`    Name:        ${plugin.name}`);
    console.log(`    Description: ${plugin.description}`);
    console.log(`    Version:     ${plugin.version}`);

    const features: string[] = [];
    if (plugin.features.bidirectionalSync) features.push('sync');
    if (plugin.features.hierarchy) features.push('hierarchy');
    if (plugin.features.dependencies) features.push('dependencies');
    console.log(`    Features:    ${features.join(', ') || 'none'}`);

    console.log('─'.repeat(80));
  }

  console.log(`\nTotal: ${plugins.length} plugin(s)\n`);
}

/**
 * List all available agent plugins.
 * Called via: ralph-tui plugins agents
 */
export async function listAgentPlugins(): Promise<AgentPluginInfo[]> {
  const registry = getAgentRegistry();

  // Register built-in plugins if not already registered
  registerBuiltinAgents();

  // Discover user plugins
  await registry.initialize();

  // Get all registered plugins
  const plugins = registry.getRegisteredPlugins();

  return plugins.map((meta) => ({
    id: meta.id,
    name: meta.name,
    description: meta.description,
    version: meta.version,
    builtin: registry.isBuiltin(meta.id),
    defaultCommand: meta.defaultCommand,
    features: {
      streaming: meta.supportsStreaming,
      interrupt: meta.supportsInterrupt,
      fileContext: meta.supportsFileContext,
    },
  }));
}

/**
 * Print agent plugins to console in a formatted table.
 */
export async function printAgentPlugins(): Promise<void> {
  const plugins = await listAgentPlugins();

  if (plugins.length === 0) {
    console.log('No agent plugins found.');
    return;
  }

  console.log('\nAvailable Agent Plugins:\n');
  console.log('─'.repeat(80));

  for (const plugin of plugins) {
    const typeLabel = plugin.builtin ? '(built-in)' : '(user)';
    console.log(`  ${plugin.id} ${typeLabel}`);
    console.log(`    Name:        ${plugin.name}`);
    console.log(`    Description: ${plugin.description}`);
    console.log(`    Version:     ${plugin.version}`);
    console.log(`    Command:     ${plugin.defaultCommand}`);

    const features: string[] = [];
    if (plugin.features.streaming) features.push('streaming');
    if (plugin.features.interrupt) features.push('interrupt');
    if (plugin.features.fileContext) features.push('file-context');
    console.log(`    Features:    ${features.join(', ') || 'none'}`);

    console.log('─'.repeat(80));
  }

  console.log(`\nTotal: ${plugins.length} plugin(s)\n`);
}
