#!/usr/bin/env bun
/**
 * ABOUTME: CLI entry point for the Ralph TUI application.
 * Handles subcommands (plugins, run, etc.) and defaults to 'run' when no subcommand given.
 */

import {
  printTrackerPlugins,
  printAgentPlugins,
  printPluginsHelp,
  executeRunCommand,
  executeStatusCommand,
  executeResumeCommand,
  executeConfigCommand,
  executeSetupCommand,
  executeLogsCommand,
  executeTemplateCommand,
  executeCreatePrdCommand,
  executeConvertCommand,
  executeDocsCommand,
  executeJiraPrdCommand,
  executeLearnCommand,
} from './commands/index.js';
import { checkAndAutoUpdate } from './auto-update.js';

/**
 * Show CLI help message.
 */
function showHelp(): void {
  console.log(`
Ralph TUI - AI Agent Loop Orchestrator

Usage: ralph-tui [command] [options]

Commands:
  (none)              Start Ralph execution (same as 'run')
  create-prd [opts]   Create a new PRD interactively (alias: prime)
  convert [options]   Convert PRD markdown to JSON format
  jira-prd [options]  Fetch Jira issues assigned to you via MCP
  learn [path]        Analyze project for AI agents
  run [options]       Start Ralph execution
  resume [options]    Resume an interrupted session
  status [options]    Check session status (headless, for CI/scripts)
  logs [options]      View/manage iteration output logs
  setup [options]     Run interactive project setup (alias: init)
  config show         Display merged configuration
  template show       Display current prompt template
  template init       Copy default template for customization
  plugins agents      List available agent plugins
  plugins trackers    List available tracker plugins
  docs [section]      Open documentation in browser
  help, --help, -h    Show this help message
  version, --version, -v  Show version number

Run Options:
  --epic <id>         Epic ID for beads tracker
  --prd <path>        PRD file path (auto-switches to json tracker)
  --agent <name>      Override agent plugin (e.g., copilot, opencode)
  --model <name>      Override model (e.g., opus, sonnet)
  --tracker <name>    Override tracker plugin (e.g., beads, beads-bv, json)
  --iterations <n>    Maximum iterations (0 = unlimited)
  --resume            Resume existing session (deprecated, use 'resume' command)
  --headless          Run without TUI (alias: --no-tui)
  --no-tui            Run without TUI, output structured logs to stdout
  --no-setup          Skip interactive setup even if no config exists
  --notify            Force enable desktop notifications
  --no-notify         Force disable desktop notifications

Resume Options:
  --cwd <path>        Working directory
  --headless          Run without TUI
  --force             Override stale lock

Status Options:
  --json              Output in JSON format for CI/scripts
  --cwd <path>        Working directory

Convert Options:
  --to <format>       Target format: json
  --output, -o <path> Output file path (default: ./prd.json)
  --branch, -b <name> Git branch name (prompts if not provided)
  --force, -f         Overwrite existing files

Learn Options:
  --output, -o <path> Custom output file path (default: ./ralph-context.md)
  --depth <level>     Analysis depth: shallow, standard (default), or deep
  --agent             Use master agent (copilot -p) for intelligent folder groupings
  --strategy <type>   Splitting strategy: top-level, domain, balanced, auto (default)
  --dry-run           Preview the planned split without executing workers
  --json              Output analysis in JSON format
  --verbose, -v       Show detailed analysis output
  --force, -f         Overwrite existing file without confirmation

Examples:
  ralph-tui                              # Start execution (same as 'run')
  ralph-tui create-prd                   # Create a new PRD interactively
  ralph-tui create-prd --chat            # Create PRD with AI chat mode
  ralph-tui convert --to json ./prd.md   # Convert PRD to JSON
  ralph-tui learn                        # Analyze current directory
  ralph-tui learn --agent                # Use master agent for folder groupings
  ralph-tui learn --strategy domain      # Group by code dependencies
  ralph-tui learn --dry-run              # Preview split plan
  ralph-tui learn ./my-project           # Analyze specific directory
  ralph-tui learn --depth shallow        # Quick structural scan
  ralph-tui learn --depth deep           # Full code pattern analysis
  ralph-tui learn --output ./docs/ctx.md # Custom output location
  ralph-tui run                          # Start execution with defaults
  ralph-tui run --epic myproject-epic    # Run with specific epic
  ralph-tui run --prd ./prd.json         # Run with PRD file
  ralph-tui resume                       # Resume interrupted session
  ralph-tui status                       # Check session status
  ralph-tui status --json                # JSON output for CI/scripts
  ralph-tui logs                         # List iteration logs
  ralph-tui logs --iteration 5           # View specific iteration
  ralph-tui logs --task US-005           # View logs for a task
  ralph-tui logs --clean --keep 10       # Clean up old logs
  ralph-tui plugins agents               # List agent plugins
  ralph-tui plugins trackers             # List tracker plugins
  ralph-tui template show                # Show current prompt template
  ralph-tui template init                # Create custom template
  ralph-tui docs                         # Open documentation in browser
  ralph-tui docs quickstart              # Open quick start guide
`);
}

/**
 * Handle subcommands before launching TUI.
 * @returns true if a subcommand was handled and we should exit
 */
async function handleSubcommand(args: string[]): Promise<boolean> {
  const command = args[0];

  // Version command
  if (command === 'version' || command === '--version' || command === '-v') {
    // Dynamic import to get version from package.json
    const pkg = await import('../package.json', { with: { type: 'json' } });
    console.log(`ralph-tui ${pkg.default.version}`);
    return true;
  }

  // Help command
  if (command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    return true;
  }

  // Create-PRD command (with alias: prime)
  if (command === 'create-prd' || command === 'prime') {
    await executeCreatePrdCommand(args.slice(1));
    return true;
  }

  // Init command (alias for setup)
  if (command === 'init') {
    await executeSetupCommand(args.slice(1));
    return true;
  }

  // Convert command
  if (command === 'convert') {
    await executeConvertCommand(args.slice(1));
    return true;
  }

  // Jira-PRD command
  if (command === 'jira-prd') {
    await executeJiraPrdCommand(args.slice(1));
    return true;
  }

  // Learn command
  if (command === 'learn') {
    await executeLearnCommand(args.slice(1));
    return true;
  }

  // Run command
  if (command === 'run') {
    await executeRunCommand(args.slice(1));
    return true;
  }

  // Resume command
  if (command === 'resume') {
    await executeResumeCommand(args.slice(1));
    return true;
  }

  // Status command
  if (command === 'status') {
    await executeStatusCommand(args.slice(1));
    return true;
  }

  // Logs command
  if (command === 'logs') {
    await executeLogsCommand(args.slice(1));
    return true;
  }

  // Config command
  if (command === 'config') {
    await executeConfigCommand(args.slice(1));
    return true;
  }

  // Setup command
  if (command === 'setup') {
    await executeSetupCommand(args.slice(1));
    return true;
  }

  // Template command
  if (command === 'template') {
    await executeTemplateCommand(args.slice(1));
    return true;
  }

  // Docs command
  if (command === 'docs') {
    await executeDocsCommand(args.slice(1));
    return true;
  }

  // Plugins commands
  if (command === 'plugins') {
    const subcommand = args[1];

    if (subcommand === '--help' || subcommand === '-h') {
      printPluginsHelp();
      return true;
    }

    if (subcommand === 'agents') {
      await printAgentPlugins();
      return true;
    }

    if (subcommand === 'trackers') {
      await printTrackerPlugins();
      return true;
    }

    // Unknown or missing plugins subcommand
    if (subcommand) {
      console.error(`Unknown plugins subcommand: ${subcommand}`);
    }
    printPluginsHelp();
    return true;
  }

  // Unknown command
  if (command && !command.startsWith('-')) {
    console.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
  }

  return false;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Get command-line arguments (skip node and script path)
  const args = process.argv.slice(2);

  // Check for updates and auto-update if available (skip for help/version commands)
  const skipUpdateCommands = ['help', '--help', '-h', 'version', '--version', '-v'];
  if (!skipUpdateCommands.includes(args[0])) {
    const pkg = await import('../package.json', { with: { type: 'json' } });
    await checkAndAutoUpdate(pkg.default.version);
  }

  // Handle subcommands
  const handled = await handleSubcommand(args);
  if (handled) {
    return;
  }

  // No subcommand - default to 'run' command
  await executeRunCommand(args);
}

// Run the main function
main().catch((error: unknown) => {
  console.error('Failed to start Ralph TUI:', error);
  process.exit(1);
});
