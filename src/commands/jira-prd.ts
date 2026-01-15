/**
 * ABOUTME: Jira PRD command for ralph-tui.
 * Fetches Jira issues assigned to the current user via MCP integration
 * through the Copilot CLI, displaying them for PRD generation workflow.
 */

import { spawn } from 'node:child_process';
import {
  printSection,
  printSuccess,
  printError,
  printInfo,
} from '../setup/prompts.js';

/**
 * Types of Jira issue links supported for PRD generation.
 */
export type JiraLinkType = 'blocks' | 'is blocked by' | 'relates to';

/**
 * Represents a linked Jira issue with relationship type.
 */
export interface JiraLinkedIssue {
  /** The linked issue */
  issue: JiraIssue;

  /** Type of link relationship */
  linkType: JiraLinkType;

  /** Direction of the link (inward or outward) */
  direction: 'inward' | 'outward';
}

/**
 * Represents a Jira issue fetched from the MCP server.
 */
export interface JiraIssue {
  /** Issue key (e.g., PROJECT-123) */
  key: string;

  /** Issue summary/title */
  summary: string;

  /** Issue type (e.g., Story, Bug, Task) */
  type: string;

  /** Issue status (e.g., To Do, In Progress, Done) */
  status: string;

  /** Issue priority (e.g., High, Medium, Low) */
  priority?: string;

  /** Issue description (full text) */
  description?: string;

  /** Acceptance criteria field (if available) */
  acceptanceCriteria?: string;

  /** Labels/tags assigned to the issue */
  labels?: string[];

  /** Story points estimate (if available) */
  storyPoints?: number;

  /** Issues linked to this issue */
  linkedIssues?: JiraLinkedIssue[];
}

/**
 * Command-line arguments for the jira-prd command.
 */
export interface JiraPrdArgs {
  /** Working directory */
  cwd?: string;

  /** Timeout for MCP calls in milliseconds */
  timeout?: number;

  /** Show verbose output */
  verbose?: boolean;
}

/**
 * Parse jira-prd command arguments.
 */
export function parseJiraPrdArgs(args: string[]): JiraPrdArgs {
  const result: JiraPrdArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--cwd' || arg === '-C') {
      result.cwd = args[++i];
    } else if (arg === '--timeout' || arg === '-t') {
      const timeout = parseInt(args[++i] ?? '', 10);
      if (!isNaN(timeout)) {
        result.timeout = timeout;
      }
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      printJiraPrdHelp();
      process.exit(0);
    }
  }

  return result;
}

/**
 * Print help for the jira-prd command.
 */
export function printJiraPrdHelp(): void {
  console.log(`
ralph-tui jira-prd - Fetch Jira issues assigned to you for PRD generation

Usage: ralph-tui jira-prd [options]

Options:
  --cwd, -C <path>     Working directory (default: current directory)
  --timeout, -t <ms>   Timeout for MCP calls (default: 60000)
  --verbose, -v        Show detailed output
  --help, -h           Show this help message

Description:
  Connects to the Jira MCP server through Copilot CLI integration and
  retrieves all issues assigned to the current user. Displays a list
  of issues with their key, summary, type, and status.

  This command is useful for reviewing available work before starting
  PRD generation with 'ralph-tui create-prd'.

Prerequisites:
  - Copilot CLI must be installed and configured
  - Jira MCP server must be configured in Copilot CLI
  - User must be authenticated with Jira

Examples:
  ralph-tui jira-prd                    # Fetch assigned issues
  ralph-tui jira-prd --verbose          # Show detailed output
  ralph-tui jira-prd --timeout 120000   # Extended timeout for slow connections
`);
}

/**
 * Result of fetching Jira issues.
 */
interface FetchIssuesResult {
  success: boolean;
  issues: JiraIssue[];
  error?: string;
}

/**
 * Normalize a Jira link type name to our supported format.
 */
function normalizeLinkType(linkTypeName: string): JiraLinkType | null {
  const normalized = linkTypeName.toLowerCase().trim();

  if (normalized.includes('blocks') && !normalized.includes('blocked by')) {
    return 'blocks';
  }
  if (normalized.includes('blocked by') || normalized.includes('is blocked')) {
    return 'is blocked by';
  }
  if (normalized.includes('relates') || normalized.includes('related')) {
    return 'relates to';
  }

  return null;
}

/**
 * Parse linked issues from a Jira issue object.
 * Handles various formats from different Jira MCP implementations.
 */
function parseLinkedIssues(issueObj: Record<string, unknown>): JiraLinkedIssue[] {
  const linkedIssues: JiraLinkedIssue[] = [];

  // Try different field names for links
  const linksData = issueObj.issuelinks ?? issueObj.links ?? issueObj.linkedIssues ?? issueObj.linked_issues;

  if (!Array.isArray(linksData)) {
    return linkedIssues;
  }

  for (const link of linksData) {
    if (typeof link !== 'object' || link === null) continue;

    const linkObj = link as Record<string, unknown>;

    // Get link type information
    const typeObj = linkObj.type as Record<string, unknown> | undefined;
    const linkTypeName = typeObj?.name ?? typeObj?.outward ?? typeObj?.inward ?? linkObj.linkType ?? linkObj.type;

    if (typeof linkTypeName !== 'string') continue;

    const normalizedType = normalizeLinkType(linkTypeName);
    if (!normalizedType) continue;

    // Try to get the linked issue (either inward or outward)
    const inwardIssue = linkObj.inwardIssue as Record<string, unknown> | undefined;
    const outwardIssue = linkObj.outwardIssue as Record<string, unknown> | undefined;

    // Handle inward link (another issue points to us)
    if (inwardIssue && typeof inwardIssue.key === 'string') {
      const fields = inwardIssue.fields as Record<string, unknown> | undefined;
      const issuetype = fields?.issuetype as Record<string, unknown> | undefined;
      const status = fields?.status as Record<string, unknown> | undefined;
      const priority = fields?.priority as Record<string, unknown> | undefined;
      
      linkedIssues.push({
        issue: {
          key: String(inwardIssue.key),
          summary: String(fields?.summary ?? inwardIssue.summary ?? ''),
          type: String(issuetype?.name ?? inwardIssue.type ?? 'Unknown'),
          status: String(status?.name ?? inwardIssue.status ?? 'Unknown'),
          priority: priority?.name
            ? String(priority.name)
            : inwardIssue.priority ? String(inwardIssue.priority) : undefined,
          description: fields?.description
            ? String(fields.description)
            : inwardIssue.description ? String(inwardIssue.description) : undefined,
        },
        linkType: normalizedType,
        direction: 'inward',
      });
    }

    // Handle outward link (we point to another issue)
    if (outwardIssue && typeof outwardIssue.key === 'string') {
      const fields = outwardIssue.fields as Record<string, unknown> | undefined;
      const issuetype = fields?.issuetype as Record<string, unknown> | undefined;
      const status = fields?.status as Record<string, unknown> | undefined;
      const priority = fields?.priority as Record<string, unknown> | undefined;
      
      linkedIssues.push({
        issue: {
          key: String(outwardIssue.key),
          summary: String(fields?.summary ?? outwardIssue.summary ?? ''),
          type: String(issuetype?.name ?? outwardIssue.type ?? 'Unknown'),
          status: String(status?.name ?? outwardIssue.status ?? 'Unknown'),
          priority: priority?.name
            ? String(priority.name)
            : outwardIssue.priority ? String(outwardIssue.priority) : undefined,
          description: fields?.description
            ? String(fields.description)
            : outwardIssue.description ? String(outwardIssue.description) : undefined,
        },
        linkType: normalizedType,
        direction: 'outward',
      });
    }

    // Handle simplified format (just the linked issue key + type)
    if (!inwardIssue && !outwardIssue && linkObj.key && typeof linkObj.key === 'string') {
      linkedIssues.push({
        issue: {
          key: String(linkObj.key),
          summary: String(linkObj.summary ?? ''),
          type: String(linkObj.issueType ?? linkObj.type ?? 'Unknown'),
          status: String(linkObj.status ?? 'Unknown'),
          priority: linkObj.priority ? String(linkObj.priority) : undefined,
          description: linkObj.description ? String(linkObj.description) : undefined,
        },
        linkType: normalizedType,
        direction: linkObj.direction === 'inward' ? 'inward' : 'outward',
      });
    }
  }

  return linkedIssues;
}

/**
 * Parse a simple issue array (AI-formatted response).
 * Expected format: [{key, summary, type, status, ...}, ...]
 */
function parseIssueArray(parsed: unknown[]): JiraIssue[] {
  const issues: JiraIssue[] = [];
  
  for (const item of parsed) {
    if (
      typeof item === 'object' &&
      item !== null &&
      'key' in item &&
      typeof (item as Record<string, unknown>).key === 'string'
    ) {
      const issueObj = item as Record<string, unknown>;
      
      // Parse labels - handle both array and comma-separated string
      let labels: string[] | undefined;
      if (Array.isArray(issueObj.labels)) {
        labels = issueObj.labels.map((l) => String(l));
      } else if (typeof issueObj.labels === 'string' && issueObj.labels) {
        labels = issueObj.labels.split(',').map((l) => l.trim()).filter(Boolean);
      }

      // Parse story points - handle various field names
      let storyPoints: number | undefined;
      const spValue = issueObj.storyPoints ?? issueObj.story_points ?? issueObj.customfield_10016;
      if (typeof spValue === 'number') {
        storyPoints = spValue;
      } else if (typeof spValue === 'string') {
        const parsedSp = parseFloat(spValue);
        if (!isNaN(parsedSp)) {
          storyPoints = parsedSp;
        }
      }

      // Parse linked issues
      const linkedIssues = parseLinkedIssues(issueObj);

      issues.push({
        key: String(issueObj.key),
        summary: String(issueObj.summary ?? issueObj.title ?? ''),
        type: String(issueObj.type ?? issueObj.issuetype ?? 'Unknown'),
        status: String(issueObj.status ?? 'Unknown'),
        priority: issueObj.priority ? String(issueObj.priority) : undefined,
        description: issueObj.description ? String(issueObj.description) : undefined,
        acceptanceCriteria: issueObj.acceptanceCriteria
          ? String(issueObj.acceptanceCriteria)
          : issueObj.acceptance_criteria
            ? String(issueObj.acceptance_criteria)
            : issueObj.customfield_10017
              ? String(issueObj.customfield_10017)
              : undefined,
        labels,
        storyPoints,
        linkedIssues: linkedIssues.length > 0 ? linkedIssues : undefined,
      });
    }
  }
  
  return issues;
}

/**
 * Parse a Jira API format issue array.
 * Expected format: [{key, fields: {summary, issuetype: {name}, status: {name}, ...}}, ...]
 */
function parseJiraApiIssueArray(parsed: unknown[]): JiraIssue[] {
  const issues: JiraIssue[] = [];
  
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    
    const issueObj = item as Record<string, unknown>;
    const key = issueObj.key;
    if (typeof key !== 'string') continue;
    
    const fields = issueObj.fields as Record<string, unknown> | undefined;
    if (!fields) {
      // Maybe it's a simplified format without fields wrapper
      if (issueObj.summary) {
        issues.push({
          key,
          summary: String(issueObj.summary ?? ''),
          type: String(issueObj.type ?? issueObj.issuetype ?? 'Unknown'),
          status: String(issueObj.status ?? 'Unknown'),
          priority: issueObj.priority ? String(issueObj.priority) : undefined,
          description: issueObj.description ? String(issueObj.description) : undefined,
        });
      }
      continue;
    }
    
    const issuetype = fields.issuetype as Record<string, unknown> | undefined;
    const status = fields.status as Record<string, unknown> | undefined;
    const priority = fields.priority as Record<string, unknown> | undefined;
    
    // Parse labels
    let labels: string[] | undefined;
    if (Array.isArray(fields.labels)) {
      labels = fields.labels.map((l) => String(l));
    }
    
    // Parse story points
    let storyPoints: number | undefined;
    const spValue = fields.customfield_10016 ?? fields.storyPoints;
    if (typeof spValue === 'number') {
      storyPoints = spValue;
    }
    
    issues.push({
      key,
      summary: String(fields.summary ?? ''),
      type: String(issuetype?.name ?? 'Unknown'),
      status: String(status?.name ?? 'Unknown'),
      priority: priority?.name ? String(priority.name) : undefined,
      description: fields.description ? String(fields.description) : undefined,
      acceptanceCriteria: fields.customfield_10017 ? String(fields.customfield_10017) : undefined,
      labels,
      storyPoints,
    });
  }
  
  return issues;
}

/**
 * Parse Jira issues from Copilot CLI output.
 * The output format depends on how the MCP server formats the response.
 */
function parseIssuesFromOutput(output: string): JiraIssue[] {
  const issues: JiraIssue[] = [];

  // First, try to extract JSON from markdown code fences (```json ... ```)
  // This is the preferred format as it's the AI-formatted response
  const markdownMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (markdownMatch && markdownMatch[1]) {
    const jsonContent = markdownMatch[1].trim();
    const jsonMatch = jsonContent.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as unknown[];
        const parsedIssues = parseIssueArray(parsed);
        if (parsedIssues.length > 0) {
          return parsedIssues;
        }
      } catch {
        // JSON parsing failed, continue to other methods
      }
    }
  }

  // Try to find a Jira API response format: {"issues": [...]}
  const jiraApiMatch = output.match(/\{"[^"]*"[^}]*"issues"\s*:\s*\[[\s\S]*?\]\s*[,}]/);
  if (jiraApiMatch) {
    try {
      // Extract just the issues array from the match
      const issuesArrayMatch = jiraApiMatch[0].match(/"issues"\s*:\s*(\[[\s\S]*?\])/);
      if (issuesArrayMatch && issuesArrayMatch[1]) {
        const parsed = JSON.parse(issuesArrayMatch[1]) as unknown[];
        const parsedIssues = parseJiraApiIssueArray(parsed);
        if (parsedIssues.length > 0) {
          return parsedIssues;
        }
      }
    } catch {
      // JSON parsing failed, continue to other methods
    }
  }

  // Try to find any JSON array in the output
  const jsonMatch = output.match(/\[[\s\S]*?\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as unknown[];
      const parsedIssues = parseIssueArray(parsed);
      if (parsedIssues.length > 0) {
        return parsedIssues;
      }
    } catch {
      // JSON parsing failed, try line-by-line parsing
    }
  }

  // Try to parse line-by-line format (fallback)
  // Format: KEY | Summary | Type | Status
  const lines = output.split('\n');
  for (const line of lines) {
    // Skip empty lines and headers
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('---') || trimmed.toLowerCase().includes('key')) {
      continue;
    }

    // Try pipe-separated format
    if (trimmed.includes('|')) {
      const parts = trimmed.split('|').map((p) => p.trim());
      if (parts.length >= 2 && /^[A-Z]+-\d+$/.test(parts[0] ?? '')) {
        issues.push({
          key: parts[0] ?? '',
          summary: parts[1] ?? '',
          type: parts[2] ?? 'Unknown',
          status: parts[3] ?? 'Unknown',
        });
      }
    }
    // Try to detect issue keys at the start of lines
    else {
      const keyMatch = trimmed.match(/^([A-Z]+-\d+)[:\s]+(.+)/);
      if (keyMatch) {
        issues.push({
          key: keyMatch[1] ?? '',
          summary: keyMatch[2] ?? '',
          type: 'Unknown',
          status: 'Unknown',
        });
      }
    }
  }

  return issues;
}

/**
 * Result of fetching linked issues.
 */
interface FetchLinkedIssuesResult {
  success: boolean;
  linkedIssues: JiraLinkedIssue[];
  error?: string;
}

/**
 * Fetch linked issues for a specific Jira issue via Copilot CLI MCP integration.
 */
export async function fetchLinkedIssues(
  issueKey: string,
  timeout: number,
  verbose: boolean,
  cwd?: string
): Promise<FetchLinkedIssuesResult> {
  const prompt = `Use the Jira MCP server to get all linked issues for issue ${issueKey}.
Include links of type: blocks, is blocked by, and relates to.
For each linked issue, include: key, summary, type, status, priority, description, acceptanceCriteria (if available), and the link type.
Return the results as a JSON array with objects containing: key, summary, type, status, priority, description, acceptanceCriteria, linkType, direction (inward or outward).
Only return the JSON array, no other text.`;

  return new Promise((resolve) => {
    const args = [
      '--silent',
      '--stream', 'off',
      '--allow-all-tools',
    ];

    if (verbose) {
      console.log(`Running: copilot ${args.join(' ')}`);
      console.log(`Prompt: ${prompt}`);
    }

    const proc = spawn('copilot', args, {
      cwd: cwd ?? process.cwd(),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
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

    proc.stdin?.write(prompt);
    proc.stdin?.end();

    proc.on('error', (error) => {
      resolve({
        success: false,
        linkedIssues: [],
        error: `Failed to execute Copilot CLI: ${error.message}`,
      });
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        const errorOutput = stderr || stdout;
        resolve({
          success: false,
          linkedIssues: [],
          error: errorOutput || `Copilot CLI exited with code ${code}`,
        });
        return;
      }

      // Parse linked issues from output
      const linkedIssues = parseLinkedIssuesFromOutput(stdout);
      resolve({
        success: true,
        linkedIssues,
      });
    });

    // Timeout handling
    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 5000);

      resolve({
        success: false,
        linkedIssues: [],
        error: `Request timed out after ${timeout / 1000} seconds.`,
      });
    }, timeout);

    proc.on('close', () => {
      clearTimeout(timeoutId);
    });
  });
}

/**
 * Parse linked issues from Copilot CLI output.
 */
function parseLinkedIssuesFromOutput(output: string): JiraLinkedIssue[] {
  const linkedIssues: JiraLinkedIssue[] = [];

  const jsonMatch = output.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return linkedIssues;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown[];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;

      const linkObj = item as Record<string, unknown>;
      if (!linkObj.key || typeof linkObj.key !== 'string') continue;

      const linkTypeName = linkObj.linkType ?? linkObj.link_type ?? linkObj.type;
      if (typeof linkTypeName !== 'string') continue;

      const normalizedType = normalizeLinkType(linkTypeName);
      if (!normalizedType) continue;

      linkedIssues.push({
        issue: {
          key: String(linkObj.key),
          summary: String(linkObj.summary ?? ''),
          type: String(linkObj.issueType ?? linkObj.type ?? 'Unknown'),
          status: String(linkObj.status ?? 'Unknown'),
          priority: linkObj.priority ? String(linkObj.priority) : undefined,
          description: linkObj.description ? String(linkObj.description) : undefined,
          acceptanceCriteria: linkObj.acceptanceCriteria
            ? String(linkObj.acceptanceCriteria)
            : linkObj.acceptance_criteria
              ? String(linkObj.acceptance_criteria)
              : undefined,
        },
        linkType: normalizedType,
        direction: linkObj.direction === 'inward' ? 'inward' : 'outward',
      });
    }
  } catch {
    // JSON parsing failed
  }

  return linkedIssues;
}

/**
 * Fetch Jira issues via Copilot CLI MCP integration.
 */
async function fetchJiraIssues(
  timeout: number,
  verbose: boolean,
  cwd?: string
): Promise<FetchIssuesResult> {
  // The prompt asks Copilot to use the Jira MCP server to fetch assigned issues
  const prompt = `Use the Jira MCP server to list all issues assigned to me. 
Return the results as a JSON array with objects containing: key, summary, type, status.
Only return the JSON array, no other text.`;

  return new Promise((resolve) => {
    const args = [
      '--silent',
      '--stream', 'off',
      '--allow-all-tools',
    ];

    if (verbose) {
      console.log(`Running: copilot ${args.join(' ')}`);
      console.log(`Prompt: ${prompt}`);
    }

    const proc = spawn('copilot', args, {
      cwd: cwd ?? process.cwd(),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
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

    // Write the prompt to stdin
    proc.stdin?.write(prompt);
    proc.stdin?.end();

    proc.on('error', (error) => {
      resolve({
        success: false,
        issues: [],
        error: `Failed to execute Copilot CLI: ${error.message}`,
      });
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        // Check for common error patterns
        const errorOutput = stderr || stdout;

        if (errorOutput.includes('MCP') && errorOutput.includes('not found')) {
          resolve({
            success: false,
            issues: [],
            error: 'Jira MCP server not configured. Please configure the Jira MCP server in Copilot CLI.',
          });
          return;
        }

        if (errorOutput.includes('authentication') || errorOutput.includes('unauthorized')) {
          resolve({
            success: false,
            issues: [],
            error: 'Jira authentication failed. Please check your Jira credentials in MCP configuration.',
          });
          return;
        }

        if (errorOutput.includes('not found') || errorOutput.includes('command not found')) {
          resolve({
            success: false,
            issues: [],
            error: 'Copilot CLI not found. Install with: winget install GitHub.Copilot (Windows) or brew install copilot-cli (macOS/Linux)',
          });
          return;
        }

        resolve({
          success: false,
          issues: [],
          error: errorOutput || `Copilot CLI exited with code ${code}`,
        });
        return;
      }

      // Parse the output to extract issues
      const issues = parseIssuesFromOutput(stdout);

      if (issues.length === 0 && stdout.trim()) {
        // Output exists but no issues found - might be an error message
        if (verbose) {
          console.log('Raw output:', stdout);
        }

        // Check if the output indicates no issues
        if (
          stdout.toLowerCase().includes('no issues') ||
          stdout.toLowerCase().includes('0 issues') ||
          stdout.includes('[]')
        ) {
          resolve({
            success: true,
            issues: [],
          });
          return;
        }
      }

      resolve({
        success: true,
        issues,
      });
    });

    // Timeout handling
    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 5000);

      resolve({
        success: false,
        issues: [],
        error: `Request timed out after ${timeout / 1000} seconds. The Jira MCP server may be slow or unresponsive.`,
      });
    }, timeout);

    proc.on('close', () => {
      clearTimeout(timeoutId);
    });
  });
}

/**
 * Display issues in a formatted table.
 */
function displayIssues(issues: JiraIssue[]): void {
  if (issues.length === 0) {
    printInfo('No issues assigned to you.');
    return;
  }

  // Calculate column widths
  const keyWidth = Math.max(
    'KEY'.length,
    ...issues.map((i) => i.key.length)
  );
  const typeWidth = Math.max(
    'TYPE'.length,
    ...issues.map((i) => i.type.length)
  );
  const statusWidth = Math.max(
    'STATUS'.length,
    ...issues.map((i) => i.status.length)
  );
  const summaryWidth = Math.min(
    50,
    Math.max('SUMMARY'.length, ...issues.map((i) => i.summary.length))
  );

  // Print header
  console.log();
  const header = [
    'KEY'.padEnd(keyWidth),
    'TYPE'.padEnd(typeWidth),
    'STATUS'.padEnd(statusWidth),
    'SUMMARY',
  ].join('  ');
  console.log(`  ${header}`);
  console.log(`  ${'-'.repeat(keyWidth + typeWidth + statusWidth + summaryWidth + 6)}`);

  // Print issues
  for (const issue of issues) {
    const summary =
      issue.summary.length > summaryWidth
        ? issue.summary.substring(0, summaryWidth - 3) + '...'
        : issue.summary;

    const row = [
      issue.key.padEnd(keyWidth),
      issue.type.padEnd(typeWidth),
      issue.status.padEnd(statusWidth),
      summary,
    ].join('  ');
    console.log(`  ${row}`);
  }

  console.log();
  printSuccess(`Found ${issues.length} issue${issues.length === 1 ? '' : 's'} assigned to you.`);
}

/**
 * Execute the jira-prd command.
 */
export async function executeJiraPrdCommand(args: string[]): Promise<void> {
  const parsedArgs = parseJiraPrdArgs(args);
  const timeout = parsedArgs.timeout ?? 60000;
  const verbose = parsedArgs.verbose ?? false;

  printSection('Jira Issues');

  printInfo('Fetching issues assigned to you via Jira MCP...');

  const result = await fetchJiraIssues(timeout, verbose, parsedArgs.cwd);

  if (!result.success) {
    printError(result.error ?? 'Failed to fetch issues from Jira.');
    console.log();
    printInfo('Troubleshooting:');
    console.log('  1. Ensure Copilot CLI is installed: copilot --version');
    console.log('  2. Verify Jira MCP server is configured in Copilot CLI');
    console.log('  3. Check your Jira authentication credentials');
    console.log('  4. Try increasing timeout with --timeout <ms>');
    process.exit(1);
  }

  displayIssues(result.issues);

  if (result.issues.length > 0) {
    console.log();
    printInfo('To create a PRD from a Jira issue, run:');
    console.log('  ralph-tui create-prd');
  }
}
