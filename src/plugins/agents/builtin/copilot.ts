/**
 * ABOUTME: GitHub Copilot CLI agent plugin.
 * Integrates with GitHub's Copilot CLI for AI-assisted coding.
 * Supports: non-interactive mode, model selection, file context via @syntax,
 * streaming output, timeout, and graceful interruption.
 * NOTE: Prompt is passed via stdin to avoid shell escaping issues with special characters.
 */

import { spawn } from 'node:child_process';
import { BaseAgentPlugin, findCommandPath } from '../base.js';
import type {
  AgentPluginMeta,
  AgentPluginFactory,
  AgentFileContext,
  AgentExecuteOptions,
  AgentSetupQuestion,
  AgentDetectResult,
} from '../types.js';

/**
 * GitHub Copilot CLI agent plugin implementation.
 * Uses the `copilot` CLI with stdin input for non-interactive AI coding tasks.
 *
 * Key features:
 * - Auto-detects copilot binary using `which`/`where`
 * - Passes prompt via stdin to avoid shell escaping issues
 * - Supports --allow-all-tools and --allow-all-paths for autonomous operation
 * - Configurable model selection via --model flag
 * - File context via @filepath syntax in prompts
 * - Timeout handling with graceful SIGTERM before SIGKILL
 * - Streaming stdout/stderr capture
 */
export class CopilotAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    description: 'GitHub Copilot CLI for AI-assisted coding',
    version: '1.0.0',
    author: 'GitHub',
    defaultCommand: 'copilot',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: true,
    supportsSubagentTracing: false, // No JSONL output format available
  };

  /** Model to use (e.g., 'claude-opus-4.5', 'gpt-4o', 'o1') */
  private model?: string;

  /** Whether to enable streaming output */
  private stream: boolean = true;

  /** Silent mode - suppress extra output */
  private silent: boolean = true;

  /** Log level (none, error, warn, info, debug) */
  private logLevel: string = 'none';

  /** Allow all tools without prompting */
  private allowAllTools: boolean = true;

  /** Allow all paths without prompting */
  private allowAllPaths: boolean = true;

  /** Timeout in milliseconds (0 = no timeout) */
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (typeof config.model === 'string' && config.model.length > 0) {
      this.model = config.model;
    }

    if (typeof config.stream === 'boolean') {
      this.stream = config.stream;
    }

    if (typeof config.silent === 'boolean') {
      this.silent = config.silent;
    }

    if (
      typeof config.logLevel === 'string' &&
      ['none', 'error', 'warn', 'info', 'debug'].includes(config.logLevel)
    ) {
      this.logLevel = config.logLevel;
    }

    if (typeof config.allowAllTools === 'boolean') {
      this.allowAllTools = config.allowAllTools;
    }

    if (typeof config.allowAllPaths === 'boolean') {
      this.allowAllPaths = config.allowAllPaths;
    }

    if (typeof config.timeout === 'number' && config.timeout > 0) {
      this.defaultTimeout = config.timeout;
    }
  }

  /**
   * Detect copilot CLI availability.
   * Uses platform-appropriate command (where on Windows, which on Unix).
   */
  override async detect(): Promise<AgentDetectResult> {
    const command = this.commandPath ?? this.meta.defaultCommand;

    // First, try to find the binary in PATH
    const findResult = await findCommandPath(command);

    if (!findResult.found) {
      return {
        available: false,
        error: `Copilot CLI not found in PATH. Install with: winget install GitHub.Copilot (Windows) or brew install copilot-cli (macOS/Linux)`,
      };
    }

    // Verify the binary works by running --version
    const versionResult = await this.runVersion(findResult.path);

    if (!versionResult.success) {
      return {
        available: false,
        executablePath: findResult.path,
        error: versionResult.error,
      };
    }

    return {
      available: true,
      version: versionResult.version,
      executablePath: findResult.path,
    };
  }

  /**
   * Run --version to verify binary and extract version number
   */
  private runVersion(
    command: string
  ): Promise<{ success: boolean; version?: string; error?: string }> {
    return new Promise((resolve) => {
      const proc = spawn(command, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          error: `Failed to execute: ${error.message}`,
        });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // Extract version from output (e.g., "copilot 1.0.5" or just "1.0.5")
          const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
          resolve({
            success: true,
            version: versionMatch?.[1],
          });
        } else {
          resolve({
            success: false,
            error: stderr || `Exited with code ${code}`,
          });
        }
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        proc.kill();
        resolve({ success: false, error: 'Timeout waiting for --version' });
      }, 5000);
    });
  }

  override getSetupQuestions(): AgentSetupQuestion[] {
    const baseQuestions = super.getSetupQuestions();
    return [
      ...baseQuestions,
      {
        id: 'model',
        prompt: 'Model to use:',
        type: 'text',
        default: '',
        required: false,
        help: 'Model name (e.g., claude-opus-4.5, gpt-4o, o1). Leave empty for Copilot default.',
      },
      {
        id: 'stream',
        prompt: 'Enable streaming output?',
        type: 'boolean',
        default: true,
        required: false,
        help: 'Whether to stream output in real-time',
      },
      {
        id: 'silent',
        prompt: 'Silent mode?',
        type: 'boolean',
        default: true,
        required: false,
        help: 'Suppress extra output from Copilot CLI',
      },
      {
        id: 'logLevel',
        prompt: 'Log level:',
        type: 'select',
        choices: [
          { value: 'none', label: 'None', description: 'No logging (default)' },
          { value: 'error', label: 'Error', description: 'Errors only' },
          { value: 'warn', label: 'Warn', description: 'Warnings and errors' },
          { value: 'info', label: 'Info', description: 'Informational messages' },
          { value: 'debug', label: 'Debug', description: 'Debug output' },
        ],
        default: 'none',
        required: false,
        help: 'Copilot CLI logging verbosity',
      },
      {
        id: 'allowAllTools',
        prompt: 'Allow all tools without prompting?',
        type: 'boolean',
        default: true,
        required: false,
        help: 'Skip tool approval prompts for autonomous operation',
      },
      {
        id: 'allowAllPaths',
        prompt: 'Allow all paths without prompting?',
        type: 'boolean',
        default: true,
        required: false,
        help: 'Skip path permission prompts for autonomous operation',
      },
    ];
  }

  /**
   * Build the full prompt with file context.
   * Injects file context using Copilot's @filepath syntax.
   */
  private buildFullPrompt(prompt: string, files?: AgentFileContext[]): string {
    // Build file context prefix using Copilot's @filepath syntax
    let fileContext = '';
    if (files && files.length > 0) {
      const fileRefs = files.map((f) => `@${f.path}`).join(' ');
      fileContext = `Context files: ${fileRefs}\n\n`;
    }

    return fileContext + prompt;
  }

  protected buildArgs(
    _prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string[] {
    const args: string[] = [];

    // NOTE: Prompt is passed via stdin (see getStdinInput), not via -p argument.
    // This avoids shell escaping issues with special characters (markdown, newlines, etc.)

    // Model selection
    if (this.model) {
      args.push('--model', this.model);
    }

    // Streaming control
    args.push('--stream', this.stream ? 'on' : 'off');

    // Silent mode
    if (this.silent) {
      args.push('--silent');
    }

    // Log level
    args.push('--log-level', this.logLevel);

    // Permission flags for autonomous operation
    if (this.allowAllTools) {
      args.push('--allow-all-tools');
    }

    if (this.allowAllPaths) {
      args.push('--allow-all-paths');
    }

    return args;
  }

  /**
   * Provide the prompt via stdin instead of command args.
   * Also injects file context using Copilot's @filepath syntax.
   * This avoids shell interpretation issues with special characters in prompts.
   */
  protected override getStdinInput(
    prompt: string,
    files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string {
    return this.buildFullPrompt(prompt, files);
  }

  override async validateSetup(
    answers: Record<string, unknown>
  ): Promise<string | null> {
    // Validate log level
    const logLevel = answers.logLevel;
    if (
      logLevel !== undefined &&
      logLevel !== '' &&
      !['none', 'error', 'warn', 'info', 'debug'].includes(String(logLevel))
    ) {
      return 'Invalid log level. Must be one of: none, error, warn, info, debug';
    }

    return null;
  }

  /**
   * Validate a model name for the Copilot agent.
   * Copilot supports various models - validation is delegated to the CLI.
   * @param model The model name to validate
   * @returns null if valid, error message if invalid
   */
  override validateModel(model: string): string | null {
    if (model === '' || model === undefined) {
      return null; // Empty is valid (uses default)
    }
    // Model validation is delegated to Copilot CLI which validates model availability
    return null;
  }
}

/**
 * Factory function for the GitHub Copilot CLI agent plugin.
 */
const createCopilotAgent: AgentPluginFactory = () => new CopilotAgentPlugin();

export default createCopilotAgent;
