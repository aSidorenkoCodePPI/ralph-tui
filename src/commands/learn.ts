/**
 * ABOUTME: Learn command for ralph-tui.
 * Analyzes a project directory so AI agents understand the codebase structure and conventions.
 * Scans file structure, detects project type, and extracts patterns.
 * Supports path exclusion via .gitignore, .ralphignore, and binary file detection.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';

// Type-only imports for TUI worker types (used in executeWorkersWithTui)
import type { 
  WorkerState, 
  WorkerEvent, 
  WorkerEventListener,
  CompletionSummary,
  WorkerWarning,
  WorkerStatistics,
} from '../tui/worker-types.js';

/**
 * Binary file extensions to automatically exclude
 */
const BINARY_EXTENSIONS = new Set([
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg', '.tiff', '.tif', '.psd',
  // Audio
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.wma', '.m4a',
  // Video
  '.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm',
  // Archives
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2', '.xz', '.tgz',
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // Fonts
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  // Compiled
  '.exe', '.dll', '.so', '.dylib', '.o', '.obj', '.class', '.pyc', '.pyo',
  // Other binary
  '.bin', '.dat', '.db', '.sqlite', '.sqlite3',
  // Lock files (not binary but often large and noisy)
  '.lock',
]);

/**
 * File type detection patterns
 */
const FILE_PATTERNS = {
  javascript: /\.(js|mjs|cjs)$/,
  typescript: /\.(ts|tsx)$/,
  python: /\.py$/,
  rust: /\.rs$/,
  go: /\.go$/,
  java: /\.java$/,
  csharp: /\.cs$/,
  ruby: /\.rb$/,
  php: /\.php$/,
  markdown: /\.(md|mdx)$/,
  json: /\.json$/,
  yaml: /\.(yaml|yml)$/,
  toml: /\.toml$/,
  html: /\.(html|htm)$/,
  css: /\.(css|scss|sass|less)$/,
} as const;

/**
 * Common directories to ignore during analysis
 */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'target',
  '__pycache__',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  '.nyc_output',
  'vendor',
  'venv',
  '.venv',
  'env',
  '.env',
]);

/**
 * Parse gitignore-style patterns from a file
 */
function parseIgnoreFile(filePath: string): string[] {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Convert a gitignore pattern to a RegExp
 * Supports basic gitignore patterns: *, **, ?, negation (!), directory-only (/)
 */
function gitignorePatternToRegex(pattern: string): { regex: RegExp; negated: boolean; dirOnly: boolean } {
  let negated = false;
  let dirOnly = false;
  let p = pattern;

  // Handle negation
  if (p.startsWith('!')) {
    negated = true;
    p = p.slice(1);
  }

  // Handle directory-only patterns (trailing /)
  if (p.endsWith('/')) {
    dirOnly = true;
    p = p.slice(0, -1);
  }

  // Handle leading / (anchored to root)
  const anchored = p.startsWith('/');
  if (anchored) {
    p = p.slice(1);
  }

  // Escape regex special chars except * and ?
  let regexStr = p.replace(/[.+^${}()|[\]\\]/g, '\\$&');

  // Convert gitignore patterns to regex
  // ** matches any path segments
  regexStr = regexStr.replace(/\*\*/g, '<<<DOUBLESTAR>>>');
  // * matches anything except /
  regexStr = regexStr.replace(/\*/g, '[^/]*');
  // ? matches single char except /
  regexStr = regexStr.replace(/\?/g, '[^/]');
  // Restore **
  regexStr = regexStr.replace(/<<<DOUBLESTAR>>>/g, '.*');

  // If not anchored and doesn't contain /, it can match anywhere
  if (!anchored && !pattern.includes('/')) {
    regexStr = `(^|.*/)?${regexStr}`;
  } else if (anchored) {
    regexStr = `^${regexStr}`;
  }

  // Match end of string or directory
  regexStr = `${regexStr}($|/)`;

  return {
    regex: new RegExp(regexStr),
    negated,
    dirOnly,
  };
}

/**
 * Path exclusion manager that handles gitignore, ralphignore, binary files, and include patterns
 */
class PathExclusionManager {
  private gitignorePatterns: { regex: RegExp; negated: boolean; dirOnly: boolean }[] = [];
  private ralphignorePatterns: { regex: RegExp; negated: boolean; dirOnly: boolean }[] = [];
  private includePatterns: RegExp[] = [];
  private stats: ExclusionStats = {
    totalExcluded: 0,
    excludedByGitignore: 0,
    excludedByRalphignore: 0,
    excludedAsBinary: 0,
    excludedByDefault: 0,
    reincluded: 0,
    sampleExcludedPaths: [],
  };
  private config: ExclusionConfig;

  constructor(rootPath: string, includePatterns: string[] = [], _verbose: boolean = false) {
    // Parse .gitignore
    const gitignorePath = path.join(rootPath, '.gitignore');
    const gitignoreRaw = parseIgnoreFile(gitignorePath);
    this.gitignorePatterns = gitignoreRaw.map(p => gitignorePatternToRegex(p));

    // Parse .ralphignore
    const ralphignorePath = path.join(rootPath, '.ralphignore');
    const ralphignoreRaw = parseIgnoreFile(ralphignorePath);
    this.ralphignorePatterns = ralphignoreRaw.map(p => gitignorePatternToRegex(p));

    // Parse include patterns
    this.includePatterns = includePatterns.map(p => {
      // Convert glob-like patterns to regex
      let regexStr = p.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      regexStr = regexStr.replace(/\*\*/g, '.*');
      regexStr = regexStr.replace(/\*/g, '[^/]*');
      regexStr = regexStr.replace(/\?/g, '[^/]');
      return new RegExp(`(^|/)${regexStr}($|/)`);
    });

    this.config = {
      gitignorePatterns: gitignoreRaw,
      ralphignorePatterns: ralphignoreRaw,
      includePatterns,
      respectsGitignore: fs.existsSync(gitignorePath),
      hasRalphignore: fs.existsSync(ralphignorePath),
    };
  }

  /**
   * Check if a path is force-included by --include patterns
   */
  private isForceIncluded(relativePath: string): boolean {
    for (const pattern of this.includePatterns) {
      if (pattern.test(relativePath)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a path matches gitignore patterns
   */
  private matchesGitignore(relativePath: string, isDirectory: boolean): boolean {
    let excluded = false;
    for (const { regex, negated, dirOnly } of this.gitignorePatterns) {
      if (dirOnly && !isDirectory) continue;
      if (regex.test(relativePath)) {
        excluded = !negated;
      }
    }
    return excluded;
  }

  /**
   * Check if a path matches ralphignore patterns
   */
  private matchesRalphignore(relativePath: string, isDirectory: boolean): boolean {
    let excluded = false;
    for (const { regex, negated, dirOnly } of this.ralphignorePatterns) {
      if (dirOnly && !isDirectory) continue;
      if (regex.test(relativePath)) {
        excluded = !negated;
      }
    }
    return excluded;
  }

  /**
   * Check if a file is binary based on extension
   */
  isBinaryFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return BINARY_EXTENSIONS.has(ext);
  }

  /**
   * Check if a directory should be excluded
   */
  shouldExcludeDir(dirName: string, relativePath: string): { excluded: boolean; reason?: string } {
    // Check force include first
    if (this.isForceIncluded(relativePath)) {
      this.stats.reincluded++;
      return { excluded: false };
    }

    // Check default ignored directories
    if (IGNORED_DIRS.has(dirName) || dirName.startsWith('.')) {
      this.stats.excludedByDefault++;
      this.stats.totalExcluded++;
      this.logExclusion(relativePath, 'default');
      return { excluded: true, reason: 'default' };
    }

    // Check gitignore
    if (this.matchesGitignore(relativePath, true)) {
      this.stats.excludedByGitignore++;
      this.stats.totalExcluded++;
      this.logExclusion(relativePath, 'gitignore');
      return { excluded: true, reason: 'gitignore' };
    }

    // Check ralphignore
    if (this.matchesRalphignore(relativePath, true)) {
      this.stats.excludedByRalphignore++;
      this.stats.totalExcluded++;
      this.logExclusion(relativePath, 'ralphignore');
      return { excluded: true, reason: 'ralphignore' };
    }

    return { excluded: false };
  }

  /**
   * Check if a file should be excluded
   */
  shouldExcludeFile(fileName: string, relativePath: string): { excluded: boolean; reason?: string } {
    // Check force include first
    if (this.isForceIncluded(relativePath)) {
      this.stats.reincluded++;
      return { excluded: false };
    }

    // Check binary files
    if (this.isBinaryFile(fileName)) {
      this.stats.excludedAsBinary++;
      this.stats.totalExcluded++;
      this.logExclusion(relativePath, 'binary');
      return { excluded: true, reason: 'binary' };
    }

    // Check gitignore
    if (this.matchesGitignore(relativePath, false)) {
      this.stats.excludedByGitignore++;
      this.stats.totalExcluded++;
      this.logExclusion(relativePath, 'gitignore');
      return { excluded: true, reason: 'gitignore' };
    }

    // Check ralphignore
    if (this.matchesRalphignore(relativePath, false)) {
      this.stats.excludedByRalphignore++;
      this.stats.totalExcluded++;
      this.logExclusion(relativePath, 'ralphignore');
      return { excluded: true, reason: 'ralphignore' };
    }

    return { excluded: false };
  }

  /**
   * Log an excluded path (for verbose mode)
   */
  private logExclusion(relativePath: string, reason: string): void {
    if (this.stats.sampleExcludedPaths.length < 50) {
      this.stats.sampleExcludedPaths.push(`${relativePath} (${reason})`);
    }
  }

  /**
   * Get exclusion configuration
   */
  getConfig(): ExclusionConfig {
    return this.config;
  }

  /**
   * Get exclusion statistics
   */
  getStats(): ExclusionStats {
    return this.stats;
  }
}

/**
 * Project type indicators
 */
const PROJECT_INDICATORS = {
  node: ['package.json'],
  python: ['setup.py', 'pyproject.toml', 'requirements.txt', 'Pipfile'],
  rust: ['Cargo.toml'],
  go: ['go.mod'],
  java: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
  dotnet: ['*.csproj', '*.sln'],
  ruby: ['Gemfile'],
  php: ['composer.json'],
} as const;

/**
 * Analysis depth levels
 */
export type DepthLevel = 'shallow' | 'standard' | 'deep';

/**
 * Folder splitting strategy for parallel workloads.
 * - 'top-level': Split by top-level directories only
 * - 'domain': Analyze imports/dependencies to group related code
 * - 'balanced': Distribute files evenly across workers by count/size
 * - 'auto': Let the LLM choose the best strategy (default)
 */
export type SplittingStrategy = 'top-level' | 'domain' | 'balanced' | 'auto';

/**
 * Valid splitting strategies for validation
 */
export const VALID_STRATEGIES: SplittingStrategy[] = ['top-level', 'domain', 'balanced', 'auto'];

/**
 * Code pattern information (for deep analysis)
 */
export interface CodePattern {
  /** Pattern name */
  name: string;
  /** Description of the pattern */
  description: string;
  /** Files where pattern was detected */
  files: string[];
  /** Confidence level (0-1) */
  confidence: number;
}

/**
 * Folder grouping from master agent analysis
 */
export interface FolderGrouping {
  /** Group name (e.g., 'Core Components', 'API Layer') */
  name: string;
  /** Folders in this group */
  folders: string[];
  /** Priority level (1-5, where 1 is highest priority) */
  priority: number;
}

/**
 * Master agent analysis plan
 */
export interface MasterAgentPlan {
  /** Folder groupings determined by master agent */
  groupings: FolderGrouping[];
  /** Analysis summary from the agent */
  summary?: string;
  /** Suggested analysis order */
  analysisOrder?: string[];
}

/**
 * Master agent analysis result
 */
export interface MasterAgentResult {
  /** Whether the analysis succeeded */
  success: boolean;
  /** The analysis plan if successful */
  plan?: MasterAgentPlan;
  /** Error message if failed */
  error?: string;
  /** Duration of the analysis in milliseconds */
  durationMs: number;
}

/**
 * Analysis result structure
 */
export interface LearnResult {
  /** Root directory analyzed */
  rootPath: string;

  /** Total files found */
  totalFiles: number;

  /** Total directories found */
  totalDirectories: number;

  /** Detected project type(s) */
  projectTypes: string[];

  /** File counts by type */
  filesByType: Record<string, number>;

  /** Top-level structure */
  structure: string[];

  /** Detected conventions */
  conventions: string[];

  /** AGENTS.md files found */
  agentFiles: string[];

  /** Analysis duration in milliseconds */
  durationMs: number;

  /** Whether file limit was reached */
  truncated: boolean;

  /** Dependency information from manifest files */
  dependencies: DependencyInfo[];

  /** Detected architectural patterns */
  architecturalPatterns: string[];

  /** Directory tree representation */
  directoryTree: string;

  /** Analysis depth level used */
  depthLevel: DepthLevel;

  /** Splitting strategy used for folder grouping */
  strategy?: SplittingStrategy;

  /** Code patterns detected (deep analysis only) */
  codePatterns?: CodePattern[];

  /** Exclusion configuration used */
  exclusionConfig?: ExclusionConfig;

  /** Exclusion statistics */
  exclusionStats?: ExclusionStats;

  /** Analysis warnings (skipped files, parse errors, etc.) */
  warnings?: AnalysisWarning[];

  /** Count of files skipped due to errors */
  skippedFiles?: number;

  /** Count of files that failed to parse */
  failedFiles?: number;

  /** Master agent analysis plan (when --agent is used) */
  masterAgentPlan?: MasterAgentPlan;

  /** Parallel worker execution results (when --agent is used without --dry-run) */
  workerResults?: WorkerExecutionSummary;
}

/**
 * Resource usage snapshot at a point in time.
 */
export interface ResourceSnapshot {
  /** Timestamp (ISO 8601) */
  timestamp: string;
  /** CPU usage percentage (0-100 per core, can exceed 100 on multi-core) */
  cpuPercent: number;
  /** Memory usage in megabytes */
  memoryMB: number;
  /** Active worker count at this snapshot */
  activeWorkers: number;
}

/**
 * Result of a single worker execution.
 */
export interface WorkerResult {
  /** Group name this worker was assigned */
  groupName: string;
  /** Folders this worker analyzed */
  folders: string[];
  /** Whether the worker completed successfully */
  success: boolean;
  /** Duration in milliseconds */
  durationMs: number;
  /** Worker output (stdout) */
  stdout: string;
  /** Worker errors (stderr) */
  stderr: string;
  /** Error message if failed */
  error?: string;
  /** Exit code */
  exitCode?: number;
  /** Timestamp when worker started (ISO 8601) */
  startedAt: string;
  /** Timestamp when worker completed (ISO 8601) */
  completedAt: string;
  /** Whether the worker was canceled (graceful shutdown) */
  canceled?: boolean;
}

/**
 * Summary of parallel worker execution.
 */
export interface WorkerExecutionSummary {
  /** Total number of workers spawned */
  workerCount: number;
  /** Number of successful workers */
  successCount: number;
  /** Number of failed workers */
  failedCount: number;
  /** Total wall-clock time for parallel execution (ms) */
  totalDurationMs: number;
  /** Sum of individual worker durations (for speedup calculation) */
  sequentialDurationMs: number;
  /** Speedup factor (sequential / parallel) */
  speedupFactor: number;
  /** Individual worker results */
  workers: WorkerResult[];
  /** Resource usage samples during execution */
  resourceSnapshots: ResourceSnapshot[];
  /** Peak memory usage in MB */
  peakMemoryMB: number;
  /** Peak CPU usage percentage */
  peakCpuPercent: number;
  /** Timestamp when parallel execution started (ISO 8601) */
  startedAt: string;
  /** Timestamp when parallel execution completed (ISO 8601) */
  completedAt: string;
}

/**
 * Result of merging worker outputs.
 */
export interface MergeResult {
  /** Whether the merge succeeded */
  success: boolean;
  /** The merged content if successful */
  mergedContent?: string;
  /** Path to the output file */
  outputPath?: string;
  /** Path to the backup file (partial outputs) */
  backupPath?: string;
  /** Error message if failed */
  error?: string;
  /** Duration of the merge in milliseconds */
  durationMs: number;
}

/**
 * Dependency information from manifest files
 */
export interface DependencyInfo {
  /** Source manifest file */
  source: string;
  /** Production dependencies */
  dependencies: Record<string, string>;
  /** Development dependencies */
  devDependencies: Record<string, string>;
}

/**
 * Arguments for the learn command
 */
export interface LearnArgs {
  /** Directory to analyze (default: current working directory) */
  path: string;

  /** Output format */
  json: boolean;

  /** Verbose output */
  verbose: boolean;

  /** Force overwrite existing context file */
  force: boolean;

  /** Custom output file path */
  output: string | null;

  /** Analysis depth level */
  depth: DepthLevel;

  /** Suppress progress output */
  quiet: boolean;

  /** Patterns to include (overrides exclusions) */
  include: string[];

  /** Exit with error on any warning */
  strict: boolean;

  /** Use master agent (copilot -p) for intelligent analysis */
  agent: boolean;

  /** Folder splitting strategy for parallel workloads */
  strategy: SplittingStrategy;

  /** Show planned split without executing workers */
  dryRun: boolean;

  /** Maximum retry attempts for failed workers (default: 3) */
  maxRetries: number;
}

/**
 * Exclusion configuration
 */
export interface ExclusionConfig {
  /** Patterns from .gitignore */
  gitignorePatterns: string[];
  /** Patterns from .ralphignore */
  ralphignorePatterns: string[];
  /** Include patterns that override exclusions */
  includePatterns: string[];
  /** Whether gitignore is being respected */
  respectsGitignore: boolean;
  /** Whether ralphignore was found */
  hasRalphignore: boolean;
}

/**
 * Exclusion statistics for verbose output
 */
export interface ExclusionStats {
  /** Total files excluded */
  totalExcluded: number;
  /** Files excluded by gitignore */
  excludedByGitignore: number;
  /** Files excluded by ralphignore */
  excludedByRalphignore: number;
  /** Files excluded as binary */
  excludedAsBinary: number;
  /** Files excluded by default patterns */
  excludedByDefault: number;
  /** Files re-included by --include flag */
  reincluded: number;
  /** Sample excluded paths (for verbose logging) */
  sampleExcludedPaths: string[];
}

/**
 * Analysis warning types
 */
export type WarningType = 'inaccessible' | 'parse_error' | 'read_error';

/**
 * Analysis warning structure
 */
export interface AnalysisWarning {
  /** Type of warning */
  type: WarningType;
  /** File path that caused the warning */
  filePath: string;
  /** Human-readable reason */
  reason: string;
}

/**
 * Progress callback for reporting analysis progress
 */
export type ProgressCallback = (phase: string, detail: string) => void;

/**
 * Progress reporter that handles timing and output
 */
class ProgressReporter {
  private startTime: number;
  private lastUpdate: number;
  private quiet: boolean;
  private currentPhase: string = '';
  private fileCount: number = 0;
  private dirCount: number = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private operationStart: number = 0;
  private showProgress: boolean = false;

  constructor(quiet: boolean) {
    this.quiet = quiet;
    this.startTime = Date.now();
    this.lastUpdate = this.startTime;
    this.operationStart = this.startTime;
  }

  /**
   * Start the progress reporter - will show progress after 2 seconds
   */
  start(): void {
    if (this.quiet) return;
    
    this.operationStart = Date.now();
    this.timer = setInterval(() => {
      const elapsed = Date.now() - this.operationStart;
      if (elapsed >= 2000 && !this.showProgress) {
        this.showProgress = true;
        this.printProgress();
      } else if (this.showProgress) {
        this.printProgress();
      }
    }, 2000);
  }

  /**
   * Update the current phase
   */
  setPhase(phase: string): void {
    this.currentPhase = phase;
    this.lastUpdate = Date.now();
    if (this.showProgress && !this.quiet) {
      this.printProgress();
    }
  }

  /**
   * Update file/directory counts
   */
  updateCounts(files: number, dirs: number): void {
    this.fileCount = files;
    this.dirCount = dirs;
    const now = Date.now();
    // Only print if 2 seconds have passed since last update
    if (this.showProgress && !this.quiet && now - this.lastUpdate >= 2000) {
      this.lastUpdate = now;
      this.printProgress();
    }
  }

  /**
   * Print the current progress
   */
  private printProgress(): void {
    const elapsed = ((Date.now() - this.operationStart) / 1000).toFixed(1);
    let message = `\r⏳ [${elapsed}s] ${this.currentPhase}`;
    if (this.currentPhase.toLowerCase().includes('scanning') && this.fileCount > 0) {
      message += ` - ${this.fileCount.toLocaleString()} files, ${this.dirCount.toLocaleString()} directories`;
    }
    // Clear to end of line and print
    process.stdout.write(`${message}        `);
  }

  /**
   * Stop the progress reporter and clear the line
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.showProgress && !this.quiet) {
      // Clear the progress line
      process.stdout.write('\r' + ' '.repeat(80) + '\r');
    }
  }
}

/**
 * Print help for the learn command
 */
export function printLearnHelp(): void {
  console.log(`
ralph-tui learn - Analyze project for AI agents

Usage: ralph-tui learn [path] [options]

Arguments:
  [path]              Directory to analyze (default: current directory)

Options:
  --output, -o <path> Custom output file path (default: ./ralph-context.md)
  --depth <level>     Analysis depth: shallow, standard (default), or deep
  --agent             Use master agent (copilot -p) for intelligent folder groupings
  --strategy <type>   Folder splitting strategy for parallel workloads:
                        top-level - Split by top-level directories only
                        domain    - Analyze imports/dependencies to group related code
                        balanced  - Distribute files evenly across workers by count/size
                        auto      - Let the LLM choose the best strategy (default)
  --retry <N>         Maximum retry attempts for failed workers (default: 3)
                      Retry delays use exponential backoff: immediate, 5s, 10s
  --dry-run           Show the planned split without executing workers
  --include <pattern> Include paths matching pattern (overrides exclusions)
                      Can be specified multiple times
  --json              Output in JSON format (machine-readable)
  --verbose, -v       Show detailed analysis output (includes excluded paths)
  --force, -f         Overwrite existing file without confirmation
  --quiet, -q         Suppress progress output
  --strict            Exit with error on any warning (inaccessible/failed files)
  -h, --help          Show this help message

Splitting Strategies:
  --strategy controls how the project is split into parallel workloads for analysis.
  This is useful when using --agent for intelligent folder grouping.

  top-level           Splits by top-level directories only (e.g., src/commands,
                      src/tui). Simple and fast, works well for well-organized
                      projects with clear module boundaries.

  domain              Analyzes imports/dependencies to group related code together.
                      Uses the master agent to identify code relationships and
                      create groupings that keep tightly coupled code together.

  balanced            Distributes files evenly across workers by count/size.
                      Ensures roughly equal workload per worker regardless of
                      code relationships. Good for maximizing parallel efficiency.

  auto (default)      Lets the LLM analyze the project and choose the best
                      strategy based on project structure, size, and complexity.

Master Agent Analysis (--agent):
  When --agent is specified, the learn command invokes a master agent using
  copilot -p to analyze the project structure. The agent:
  
  - Receives the project structure (file tree, package.json, imports)
  - Outputs a JSON plan with intelligent folder groupings
  - Each grouping has: group name, folders array, priority (1-5)
  - Shows 'Analyzing project structure...' spinner during analysis
  - Completes within 60 seconds for projects under 1000 files
  
  Requires: GitHub Copilot CLI installed and authenticated

Dry Run Mode:
  Use --dry-run to preview the folder splitting plan without spawning workers.
  This shows:
  - Which strategy was used/selected
  - Group names and folder assignments
  - Estimated file counts per group
  
  Combine with --output to save the plan:
    ralph-tui learn --dry-run --output plan.json

Path Exclusions:
  The following paths are excluded by default:
  - Directories: node_modules/, .git/, dist/, build/, and other common build/cache dirs
  - Binary files: images, videos, archives, compiled files, fonts, etc.
  - Patterns from .gitignore (if present in project root)
  - Patterns from .ralphignore (if present in project root)
  
  Use --include to override exclusions for specific patterns:
    ralph-tui learn --include "*.min.js" --include "dist/**"
  
  Use --verbose to see which paths are being excluded and why.

Depth Levels:
  shallow             Quick structural analysis only (~1-2 seconds)
                      - Project type detection
                      - Top-level directory structure
                      - Basic file counts

  standard (default)  Structure, dependencies, and basic patterns (~2-5 seconds)
                      - Everything in 'shallow'
                      - Full directory tree (3 levels deep)
                      - Dependency parsing from manifest files
                      - Architectural pattern detection
                      - Development conventions (linting, testing, CI/CD)

  deep                Comprehensive analysis including code patterns (~5-30 seconds)
                      - Everything in 'standard'
                      - Code pattern detection (exports, classes, functions)
                      - Import/export relationship analysis
                      - Test coverage hints
                      - Detailed AGENTS.md file discovery

Progress Indicators:
  Progress is automatically shown for operations taking longer than 2 seconds.
  The current phase (scanning, analyzing, generating) and file count are displayed.
  Use --quiet to suppress progress output.

Error Handling:
  Inaccessible files and parsing failures are logged as warnings but don't
  stop the analysis. The final summary shows skipped/failed file counts.
  Use --verbose to see detailed warning information.
  Use --strict to exit with error code 2 if any warnings occur.

Description:
  Analyzes the project directory so AI agents understand the codebase
  structure and conventions. Generates a ralph-context.md file with:

  - Project overview and type detection
  - Directory structure representation
  - Detected languages and frameworks
  - Dependencies from manifest files (package.json, requirements.txt, etc.)
  - Identified architectural patterns
  - AGENTS.md file discovery
  - Master agent folder groupings (when --agent is used)

  Supports projects with up to 10,000 files for efficient analysis.

Output:
  Creates ralph-context.md in the project root by default.
  Use --output to specify a custom path (parent directories will be created).
  If the file exists, prompts for confirmation unless --force is used.

Exit Codes:
  0    Analysis completed successfully (no warnings)
  1    Analysis failed (invalid path, permission error, etc.)
  2    Analysis completed with warnings (partial success)
       Only returned if --strict is used

Examples:
  ralph-tui learn                             # Analyze current directory
  ralph-tui learn ./my-project                # Analyze specific directory
  ralph-tui learn --agent                     # Use master agent for folder groupings
  ralph-tui learn --agent --json              # Get agent plan as JSON
  ralph-tui learn --strategy top-level        # Split by top-level directories
  ralph-tui learn --strategy domain           # Group by code dependencies
  ralph-tui learn --strategy balanced         # Distribute files evenly
  ralph-tui learn --dry-run                   # Preview split plan without executing
  ralph-tui learn --dry-run --output plan.json # Save plan to file
  ralph-tui learn --depth shallow             # Quick structural scan
  ralph-tui learn --depth deep                # Full code pattern analysis
  ralph-tui learn --output ./docs/context.md  # Custom output location
  ralph-tui learn -o "path with spaces/ctx.md" # Path with spaces
  ralph-tui learn --include "dist/**"         # Include dist folder
  ralph-tui learn --include "*.min.js"        # Include minified JS files
  ralph-tui learn --json                      # JSON output for scripts
  ralph-tui learn -v                          # Verbose output (shows exclusions)
  ralph-tui learn --force                     # Overwrite without confirmation
  ralph-tui learn --quiet                     # Suppress progress output
  ralph-tui learn --strict                    # Fail on any warning
`);
}

/**
 * Parse learn command arguments
 */
export function parseLearnArgs(args: string[]): LearnArgs {
  const result: LearnArgs = {
    path: process.cwd(),
    json: false,
    verbose: false,
    force: false,
    output: null,
    depth: 'standard',
    quiet: false,
    include: [],
    strict: false,
    agent: false,
    strategy: 'auto',
    dryRun: false,
    maxRetries: 3,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      printLearnHelp();
      process.exit(0);
    } else if (arg === '--json') {
      result.json = true;
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
    } else if (arg === '--force' || arg === '-f') {
      result.force = true;
    } else if (arg === '--quiet' || arg === '-q') {
      result.quiet = true;
    } else if (arg === '--strict') {
      result.strict = true;
    } else if (arg === '--agent') {
      result.agent = true;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--retry') {
      const nextArg = args[++i];
      if (!nextArg || nextArg.startsWith('-')) {
        console.error('Error: --retry requires a number argument (e.g., --retry 3)');
        process.exit(1);
      }
      const retryValue = parseInt(nextArg, 10);
      if (isNaN(retryValue) || retryValue < 0 || retryValue > 10) {
        console.error(`Error: Invalid retry value '${nextArg}'. Must be a number between 0 and 10.`);
        process.exit(1);
      }
      result.maxRetries = retryValue;
    } else if (arg === '--strategy') {
      const nextArg = args[++i];
      if (!nextArg || nextArg.startsWith('-')) {
        console.error('Error: --strategy requires a value argument');
        console.error(`Valid options: ${VALID_STRATEGIES.join(', ')}`);
        process.exit(1);
      }
      const strategyValue = nextArg.toLowerCase();
      if (!VALID_STRATEGIES.includes(strategyValue as SplittingStrategy)) {
        console.error(`Error: Invalid strategy '${nextArg}'.`);
        console.error(`Valid options: ${VALID_STRATEGIES.join(', ')}`);
        console.error('');
        console.error('Strategy descriptions:');
        console.error('  top-level  - Split by top-level directories only');
        console.error('  domain     - Analyze imports/dependencies to group related code');
        console.error('  balanced   - Distribute files evenly across workers by count/size');
        console.error('  auto       - Let the LLM choose the best strategy (default)');
        process.exit(1);
      }
      result.strategy = strategyValue as SplittingStrategy;
    } else if (arg === '--output' || arg === '-o') {
      const nextArg = args[++i];
      if (!nextArg || nextArg.startsWith('-')) {
        console.error('Error: --output requires a path argument');
        process.exit(1);
      }
      result.output = path.resolve(nextArg);
    } else if (arg === '--include') {
      const nextArg = args[++i];
      if (!nextArg || nextArg.startsWith('-')) {
        console.error('Error: --include requires a pattern argument');
        process.exit(1);
      }
      result.include.push(nextArg);
    } else if (arg === '--depth') {
      const nextArg = args[++i];
      if (!nextArg || nextArg.startsWith('-')) {
        console.error('Error: --depth requires a level argument (shallow, standard, or deep)');
        process.exit(1);
      }
      const depth = nextArg.toLowerCase();
      if (depth !== 'shallow' && depth !== 'standard' && depth !== 'deep') {
        console.error(`Error: Invalid depth level '${nextArg}'. Must be shallow, standard, or deep.`);
        process.exit(1);
      }
      result.depth = depth as DepthLevel;
    } else if (!arg.startsWith('-')) {
      // Positional argument - treat as path
      result.path = path.resolve(arg);
    } else {
      console.error(`Unknown option: ${arg}`);
      printLearnHelp();
      process.exit(1);
    }
  }

  return result;
}

/**
 * Check if a directory should be ignored
 */
function shouldIgnoreDir(dirName: string): boolean {
  return IGNORED_DIRS.has(dirName) || dirName.startsWith('.');
}

/**
 * Detect file type from filename
 */
function detectFileType(filename: string): string | null {
  for (const [type, pattern] of Object.entries(FILE_PATTERNS)) {
    if (pattern.test(filename)) {
      return type;
    }
  }
  return null;
}

/**
 * Detect project type(s) from root directory contents
 */
function detectProjectTypes(_rootPath: string, files: string[]): string[] {
  const types: string[] = [];

  for (const [projectType, indicators] of Object.entries(PROJECT_INDICATORS)) {
    for (const indicator of indicators) {
      if (indicator.includes('*')) {
        // Glob pattern
        const pattern = new RegExp(indicator.replace('*', '.*'));
        if (files.some(f => pattern.test(f))) {
          types.push(projectType);
          break;
        }
      } else {
        // Exact match
        if (files.includes(indicator)) {
          types.push(projectType);
          break;
        }
      }
    }
  }

  return types.length > 0 ? types : ['unknown'];
}

/**
 * Detect code conventions from the project
 */
function detectConventions(rootPath: string, files: string[]): string[] {
  const conventions: string[] = [];

  // Check for TypeScript
  if (files.includes('tsconfig.json')) {
    conventions.push('TypeScript enabled');
  }

  // Check for ESLint
  if (files.some(f => f.startsWith('eslint') || f === '.eslintrc' || f === '.eslintrc.js' || f === '.eslintrc.json')) {
    conventions.push('ESLint for linting');
  }

  // Check for Prettier
  if (files.some(f => f.startsWith('.prettier') || f === 'prettier.config.js')) {
    conventions.push('Prettier for formatting');
  }

  // Check for testing frameworks
  if (files.includes('jest.config.js') || files.includes('jest.config.ts')) {
    conventions.push('Jest for testing');
  }
  if (files.includes('vitest.config.ts') || files.includes('vitest.config.js')) {
    conventions.push('Vitest for testing');
  }
  if (files.includes('pytest.ini') || files.includes('conftest.py')) {
    conventions.push('Pytest for testing');
  }

  // Check for CI/CD
  if (fs.existsSync(path.join(rootPath, '.github', 'workflows'))) {
    conventions.push('GitHub Actions for CI/CD');
  }
  if (files.includes('.gitlab-ci.yml')) {
    conventions.push('GitLab CI for CI/CD');
  }

  // Check for Docker
  if (files.includes('Dockerfile') || files.includes('docker-compose.yml') || files.includes('docker-compose.yaml')) {
    conventions.push('Docker containerization');
  }

  // Check for AGENTS.md
  if (files.includes('AGENTS.md')) {
    conventions.push('AGENTS.md for AI guidance');
  }

  return conventions;
}

/**
 * Parse dependencies from manifest files
 */
function parseDependencies(rootPath: string, files: string[]): DependencyInfo[] {
  const deps: DependencyInfo[] = [];

  // Parse package.json (Node.js)
  if (files.includes('package.json')) {
    try {
      const pkgPath = path.join(rootPath, 'package.json');
      const content = fs.readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      deps.push({
        source: 'package.json',
        dependencies: pkg.dependencies || {},
        devDependencies: pkg.devDependencies || {},
      });
    } catch {
      // Skip on parse error
    }
  }

  // Parse requirements.txt (Python)
  if (files.includes('requirements.txt')) {
    try {
      const reqPath = path.join(rootPath, 'requirements.txt');
      const content = fs.readFileSync(reqPath, 'utf-8');
      const dependencies: Record<string, string> = {};
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const match = trimmed.match(/^([a-zA-Z0-9_-]+)(?:[>=<~!]+(.+))?$/);
          if (match) {
            dependencies[match[1]] = match[2] || '*';
          }
        }
      }
      deps.push({
        source: 'requirements.txt',
        dependencies,
        devDependencies: {},
      });
    } catch {
      // Skip on parse error
    }
  }

  // Parse pyproject.toml (Python)
  if (files.includes('pyproject.toml')) {
    try {
      const tomlPath = path.join(rootPath, 'pyproject.toml');
      const content = fs.readFileSync(tomlPath, 'utf-8');
      const dependencies: Record<string, string> = {};
      const devDependencies: Record<string, string> = {};
      // Simple TOML parsing for dependencies section
      const depsMatch = content.match(/\[project\.dependencies\]([\s\S]*?)(?=\[|$)/);
      if (depsMatch) {
        for (const line of depsMatch[1].split('\n')) {
          const match = line.match(/^\s*"?([a-zA-Z0-9_-]+)"?\s*(?:[>=<~!]+\s*"?(.+?)"?)?(?:,|$)/);
          if (match) {
            dependencies[match[1]] = match[2] || '*';
          }
        }
      }
      // Check for dev dependencies
      const devMatch = content.match(/\[project\.optional-dependencies\]([\s\S]*?)(?=\[|$)/);
      if (devMatch) {
        for (const line of devMatch[1].split('\n')) {
          const match = line.match(/^\s*"?([a-zA-Z0-9_-]+)"?\s*(?:[>=<~!]+\s*"?(.+?)"?)?(?:,|$)/);
          if (match) {
            devDependencies[match[1]] = match[2] || '*';
          }
        }
      }
      if (Object.keys(dependencies).length > 0 || Object.keys(devDependencies).length > 0) {
        deps.push({
          source: 'pyproject.toml',
          dependencies,
          devDependencies,
        });
      }
    } catch {
      // Skip on parse error
    }
  }

  // Parse Cargo.toml (Rust)
  if (files.includes('Cargo.toml')) {
    try {
      const cargoPath = path.join(rootPath, 'Cargo.toml');
      const content = fs.readFileSync(cargoPath, 'utf-8');
      const dependencies: Record<string, string> = {};
      const devDependencies: Record<string, string> = {};
      // Simple TOML parsing for [dependencies] section
      const depsMatch = content.match(/\[dependencies\]([\s\S]*?)(?=\[|$)/);
      if (depsMatch) {
        for (const line of depsMatch[1].split('\n')) {
          const match = line.match(/^\s*([a-zA-Z0-9_-]+)\s*=\s*"?(.+?)"?\s*$/);
          if (match) {
            dependencies[match[1]] = match[2];
          }
        }
      }
      // Check for dev-dependencies
      const devMatch = content.match(/\[dev-dependencies\]([\s\S]*?)(?=\[|$)/);
      if (devMatch) {
        for (const line of devMatch[1].split('\n')) {
          const match = line.match(/^\s*([a-zA-Z0-9_-]+)\s*=\s*"?(.+?)"?\s*$/);
          if (match) {
            devDependencies[match[1]] = match[2];
          }
        }
      }
      deps.push({
        source: 'Cargo.toml',
        dependencies,
        devDependencies,
      });
    } catch {
      // Skip on parse error
    }
  }

  // Parse go.mod (Go)
  if (files.includes('go.mod')) {
    try {
      const goModPath = path.join(rootPath, 'go.mod');
      const content = fs.readFileSync(goModPath, 'utf-8');
      const dependencies: Record<string, string> = {};
      const requireMatch = content.match(/require\s*\(([\s\S]*?)\)/);
      if (requireMatch) {
        for (const line of requireMatch[1].split('\n')) {
          const match = line.match(/^\s*([^\s]+)\s+v?(.+)$/);
          if (match) {
            dependencies[match[1]] = match[2];
          }
        }
      }
      deps.push({
        source: 'go.mod',
        dependencies,
        devDependencies: {},
      });
    } catch {
      // Skip on parse error
    }
  }

  // Parse Gemfile (Ruby) - basic parsing
  if (files.includes('Gemfile')) {
    try {
      const gemPath = path.join(rootPath, 'Gemfile');
      const content = fs.readFileSync(gemPath, 'utf-8');
      const dependencies: Record<string, string> = {};
      for (const line of content.split('\n')) {
        const match = line.match(/^\s*gem\s+['"]([^'"]+)['"]\s*(?:,\s*['"]?([^'"]+)['"]?)?/);
        if (match) {
          dependencies[match[1]] = match[2] || '*';
        }
      }
      deps.push({
        source: 'Gemfile',
        dependencies,
        devDependencies: {},
      });
    } catch {
      // Skip on parse error
    }
  }

  // Parse composer.json (PHP)
  if (files.includes('composer.json')) {
    try {
      const composerPath = path.join(rootPath, 'composer.json');
      const content = fs.readFileSync(composerPath, 'utf-8');
      const composer = JSON.parse(content);
      deps.push({
        source: 'composer.json',
        dependencies: composer.require || {},
        devDependencies: composer['require-dev'] || {},
      });
    } catch {
      // Skip on parse error
    }
  }

  return deps;
}

/**
 * Architectural pattern with confidence level
 */
interface ArchitecturalPattern {
  name: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Detect architectural patterns from project structure with confidence indicators
 */
function detectArchitecturalPatterns(rootPath: string, files: string[], topLevelDirs: string[]): string[] {
  const patterns: ArchitecturalPattern[] = [];

  // MVC pattern - confidence based on how many MVC dirs are present
  const mvcDirs = ['models', 'views', 'controllers', 'model', 'view', 'controller'];
  const mvcMatches = mvcDirs.filter(d => topLevelDirs.includes(d)).length;
  if (mvcMatches >= 3) {
    patterns.push({ name: 'MVC (Model-View-Controller)', confidence: 'high' });
  } else if (mvcMatches >= 2) {
    patterns.push({ name: 'MVC (Model-View-Controller)', confidence: 'medium' });
  } else if (mvcMatches >= 1) {
    patterns.push({ name: 'MVC (Model-View-Controller)', confidence: 'low' });
  }

  // Clean Architecture / Hexagonal - confidence based on matching dirs
  const cleanArchDirs = ['domain', 'application', 'infrastructure', 'adapters', 'ports'];
  const cleanArchMatches = cleanArchDirs.filter(d => topLevelDirs.includes(d)).length;
  if (cleanArchMatches >= 4) {
    patterns.push({ name: 'Clean Architecture / Hexagonal', confidence: 'high' });
  } else if (cleanArchMatches >= 3) {
    patterns.push({ name: 'Clean Architecture / Hexagonal', confidence: 'medium' });
  } else if (cleanArchMatches >= 2) {
    patterns.push({ name: 'Clean Architecture / Hexagonal', confidence: 'low' });
  }

  // Component-based (React, Vue, etc.) - high if both, medium if one
  const hasComponents = topLevelDirs.includes('components');
  const hasUi = topLevelDirs.includes('ui');
  if (hasComponents && hasUi) {
    patterns.push({ name: 'Component-based architecture', confidence: 'high' });
  } else if (hasComponents || hasUi) {
    patterns.push({ name: 'Component-based architecture', confidence: 'medium' });
  }

  // Monorepo patterns - confidence based on indicators
  const monorepoIndicators = ['packages', 'apps', 'libs', 'workspaces'].filter(d => topLevelDirs.includes(d));
  const hasMonorepoConfig = files.includes('nx.json') || files.includes('lerna.json') || 
                            files.includes('turbo.json') || files.includes('pnpm-workspace.yaml');
  if (monorepoIndicators.length >= 2 || (monorepoIndicators.length >= 1 && hasMonorepoConfig)) {
    patterns.push({ name: 'Monorepo structure', confidence: 'high' });
  } else if (monorepoIndicators.length >= 1) {
    patterns.push({ name: 'Monorepo structure', confidence: 'medium' });
  }

  // Add specific monorepo tool detection with high confidence
  if (files.includes('nx.json')) {
    patterns.push({ name: 'Nx workspace', confidence: 'high' });
  }
  if (files.includes('lerna.json')) {
    patterns.push({ name: 'Lerna monorepo', confidence: 'high' });
  }
  if (files.includes('turbo.json')) {
    patterns.push({ name: 'Turborepo', confidence: 'high' });
  }
  if (files.includes('pnpm-workspace.yaml')) {
    patterns.push({ name: 'PNPM workspace', confidence: 'high' });
  }

  // Feature-based / Module-based
  const hasFeatures = topLevelDirs.includes('features');
  const hasModules = topLevelDirs.includes('modules');
  if (hasFeatures && hasModules) {
    patterns.push({ name: 'Feature-based / Modular architecture', confidence: 'high' });
  } else if (hasFeatures || hasModules) {
    patterns.push({ name: 'Feature-based / Modular architecture', confidence: 'medium' });
  }

  // API patterns - confidence based on multiple indicators
  const apiDirs = ['api', 'routes', 'endpoints', 'controllers', 'handlers'].filter(d => topLevelDirs.includes(d));
  if (apiDirs.length >= 3) {
    patterns.push({ name: 'API-centric design', confidence: 'high' });
  } else if (apiDirs.length >= 2) {
    patterns.push({ name: 'API-centric design', confidence: 'medium' });
  } else if (apiDirs.length >= 1) {
    patterns.push({ name: 'API-centric design', confidence: 'low' });
  }

  // Layered architecture
  const layeredDirs = ['services', 'repositories', 'entities', 'dao', 'dto'];
  const layeredMatches = layeredDirs.filter(d => topLevelDirs.includes(d)).length;
  if (layeredMatches >= 3) {
    patterns.push({ name: 'Layered architecture', confidence: 'high' });
  } else if (layeredMatches >= 2) {
    patterns.push({ name: 'Layered architecture', confidence: 'medium' });
  }

  // Plugin/Extension architecture - confidence based on indicators
  const pluginDirs = ['plugins', 'extensions', 'addons', 'middleware'].filter(d => topLevelDirs.includes(d));
  if (pluginDirs.length >= 2) {
    patterns.push({ name: 'Plugin/Extension architecture', confidence: 'high' });
  } else if (pluginDirs.length >= 1) {
    patterns.push({ name: 'Plugin/Extension architecture', confidence: 'medium' });
  }

  // Check for serverless patterns - high confidence from config files
  if (files.includes('serverless.yml') || files.includes('serverless.yaml') || files.includes('serverless.ts')) {
    patterns.push({ name: 'Serverless architecture', confidence: 'high' });
  }

  // Microservices indicators
  if (files.includes('docker-compose.yml') || files.includes('docker-compose.yaml')) {
    const composePath = path.join(rootPath, files.find(f => f.startsWith('docker-compose')) || '');
    try {
      const content = fs.readFileSync(composePath, 'utf-8');
      const serviceCount = (content.match(/^\s{2}\w+:/gm) || []).length;
      if (serviceCount >= 5) {
        patterns.push({ name: 'Microservices architecture', confidence: 'high' });
      } else if (serviceCount >= 3) {
        patterns.push({ name: 'Microservices architecture', confidence: 'medium' });
      } else if (serviceCount >= 2) {
        patterns.push({ name: 'Microservices architecture', confidence: 'low' });
      }
    } catch {
      // Skip
    }
  }

  // Format patterns with confidence indicators and sort by confidence
  const confidenceOrder = { high: 0, medium: 1, low: 2 };
  return patterns
    .sort((a, b) => confidenceOrder[a.confidence] - confidenceOrder[b.confidence])
    .map(p => `${p.name} [${p.confidence} confidence]`);
}

/**
 * Build directory tree representation (up to 3 levels deep)
 */
function buildDirectoryTree(rootPath: string, maxDepth: number = 3): string {
  const lines: string[] = [];

  function walkDir(dirPath: string, prefix: string, depth: number): void {
    if (depth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    // Filter and sort entries
    const dirs = entries.filter(e => e.isDirectory() && !shouldIgnoreDir(e.name)).sort((a, b) => a.name.localeCompare(b.name));
    const files = entries.filter(e => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));

    // Limit files shown at each level
    const maxFiles = depth === 1 ? 15 : 8;
    const maxDirs = depth === 1 ? 20 : 10;
    const displayDirs = dirs.slice(0, maxDirs);
    const displayFiles = files.slice(0, maxFiles);

    const totalItems = displayDirs.length + displayFiles.length;
    let index = 0;

    for (const dir of displayDirs) {
      index++;
      const isLast = index === totalItems && files.length <= maxFiles && dirs.length <= maxDirs;
      const connector = isLast ? '└── ' : '├── ';
      lines.push(`${prefix}${connector}${dir.name}/`);
      walkDir(path.join(dirPath, dir.name), prefix + (isLast ? '    ' : '│   '), depth + 1);
    }

    for (const file of displayFiles) {
      index++;
      const isLast = index === totalItems;
      const connector = isLast ? '└── ' : '├── ';
      lines.push(`${prefix}${connector}${file.name}`);
    }

    // Show truncation message
    if (dirs.length > maxDirs || files.length > maxFiles) {
      const remaining = (dirs.length - maxDirs) + (files.length - maxFiles);
      lines.push(`${prefix}└── ... (${remaining} more items)`);
    }
  }

  const rootName = path.basename(rootPath) || rootPath;
  lines.push(`${rootName}/`);
  walkDir(rootPath, '', 1);

  return lines.join('\n');
}

/**
 * Generate Markdown content for the context file
 */
function generateContextMarkdown(result: LearnResult): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();
  const projectName = path.basename(result.rootPath);

  // Header
  lines.push('# Project Context');
  lines.push('');
  lines.push(`> Generated by ralph-tui learn on ${timestamp}`);
  lines.push(`> Analysis depth: ${result.depthLevel}`);
  lines.push('');

  // Project Overview
  lines.push('## Project Overview');
  lines.push('');
  lines.push(`- **Name**: ${projectName}`);
  lines.push(`- **Path**: ${result.rootPath}`);
  lines.push(`- **Type**: ${result.projectTypes.join(', ')}`);
  lines.push(`- **Analysis Depth**: ${result.depthLevel}`);
  lines.push(`- **Total Files**: ${result.totalFiles.toLocaleString()}${result.truncated ? ' (truncated at 10,000)' : ''}`);
  lines.push(`- **Total Directories**: ${result.totalDirectories.toLocaleString()}`);
  lines.push('');

  // Technology Stack Summary (consolidates languages, frameworks, project type)
  lines.push('## Technology Stack');
  lines.push('');
  lines.push('### Project Type');
  lines.push('');
  lines.push(`This is a **${result.projectTypes.join(', ')}** project.`);
  lines.push('');
  
  // Primary languages
  lines.push('### Primary Languages');
  lines.push('');
  if (Object.keys(result.filesByType).length > 0) {
    const sortedTypes = Object.entries(result.filesByType)
      .sort((a, b) => b[1] - a[1]);
    lines.push('| Language/Type | File Count |');
    lines.push('|--------------|------------|');
    for (const [type, count] of sortedTypes) {
      lines.push(`| ${type} | ${count.toLocaleString()} |`);
    }
    lines.push('');
  } else {
    lines.push('*No specific language files detected.*');
    lines.push('');
  }

  // Frameworks and Tools detected from config files
  const detectedFrameworks: string[] = [];
  if (result.projectTypes.includes('node')) detectedFrameworks.push('Node.js');
  if (result.projectTypes.includes('python')) detectedFrameworks.push('Python');
  if (result.projectTypes.includes('rust')) detectedFrameworks.push('Rust');
  if (result.projectTypes.includes('go')) detectedFrameworks.push('Go');
  if (result.projectTypes.includes('java')) detectedFrameworks.push('Java');
  if (result.projectTypes.includes('dotnet')) detectedFrameworks.push('.NET');
  if (result.projectTypes.includes('ruby')) detectedFrameworks.push('Ruby');
  if (result.projectTypes.includes('php')) detectedFrameworks.push('PHP');
  
  // Add detected conventions as frameworks/tools
  for (const conv of result.conventions) {
    if (conv.includes('TypeScript')) detectedFrameworks.push('TypeScript');
    if (conv.includes('Jest')) detectedFrameworks.push('Jest');
    if (conv.includes('Vitest')) detectedFrameworks.push('Vitest');
    if (conv.includes('Pytest')) detectedFrameworks.push('Pytest');
    if (conv.includes('ESLint')) detectedFrameworks.push('ESLint');
    if (conv.includes('Prettier')) detectedFrameworks.push('Prettier');
    if (conv.includes('Docker')) detectedFrameworks.push('Docker');
    if (conv.includes('GitHub Actions')) detectedFrameworks.push('GitHub Actions');
    if (conv.includes('GitLab CI')) detectedFrameworks.push('GitLab CI');
  }
  
  if (detectedFrameworks.length > 0) {
    lines.push('### Detected Frameworks and Tools');
    lines.push('');
    for (const fw of detectedFrameworks) {
      lines.push(`- ${fw}`);
    }
    lines.push('');
  }

  // Directory Structure
  lines.push('## Directory Structure');
  lines.push('');
  lines.push('```');
  lines.push(result.directoryTree);
  lines.push('```');
  lines.push('');

  // Dependencies
  lines.push('## Dependencies');
  lines.push('');
  if (result.dependencies.length > 0) {
    for (const dep of result.dependencies) {
      lines.push(`### ${dep.source}`);
      lines.push('');
      
      if (Object.keys(dep.dependencies).length > 0) {
        lines.push('**Production Dependencies:**');
        lines.push('');
        const deps = Object.entries(dep.dependencies).slice(0, 50);
        for (const [name, version] of deps) {
          lines.push(`- ${name}: ${version}`);
        }
        if (Object.keys(dep.dependencies).length > 50) {
          lines.push(`- ... and ${Object.keys(dep.dependencies).length - 50} more`);
        }
        lines.push('');
      }
      
      if (Object.keys(dep.devDependencies).length > 0) {
        lines.push('**Development Dependencies:**');
        lines.push('');
        const devDeps = Object.entries(dep.devDependencies).slice(0, 30);
        for (const [name, version] of devDeps) {
          lines.push(`- ${name}: ${version}`);
        }
        if (Object.keys(dep.devDependencies).length > 30) {
          lines.push(`- ... and ${Object.keys(dep.devDependencies).length - 30} more`);
        }
        lines.push('');
      }
    }
  } else {
    lines.push('*No manifest files detected or no dependencies found.*');
    lines.push('');
  }

  // Architectural Patterns
  lines.push('## Architectural Patterns');
  lines.push('');
  if (result.architecturalPatterns.length > 0) {
    for (const pattern of result.architecturalPatterns) {
      lines.push(`- ${pattern}`);
    }
    lines.push('');
  } else {
    lines.push('*No specific architectural patterns detected.*');
    lines.push('');
  }

  // Conventions
  lines.push('## Development Conventions');
  lines.push('');
  if (result.conventions.length > 0) {
    for (const convention of result.conventions) {
      lines.push(`- ${convention}`);
    }
    lines.push('');
  } else {
    lines.push('*No specific conventions detected.*');
    lines.push('');
  }

  // AGENTS.md files
  if (result.agentFiles.length > 0) {
    lines.push('## AI Agent Configuration');
    lines.push('');
    lines.push('The following AGENTS.md files were found, which provide guidance for AI agents:');
    lines.push('');
    for (const agentFile of result.agentFiles) {
      lines.push(`- ${agentFile || '(root)'}`);
    }
    lines.push('');
  }

  // Code Patterns (deep analysis only)
  if (result.codePatterns && result.codePatterns.length > 0) {
    lines.push('## Code Patterns');
    lines.push('');
    lines.push('The following code patterns were detected during deep analysis:');
    lines.push('');
    lines.push('| Pattern | Confidence | Description |');
    lines.push('|---------|------------|-------------|');
    for (const pattern of result.codePatterns) {
      const confidence = `${Math.round(pattern.confidence * 100)}%`;
      lines.push(`| ${pattern.name} | ${confidence} | ${pattern.description} |`);
    }
    lines.push('');
    
    // Show example files for top patterns
    const topPatterns = result.codePatterns.filter(p => p.confidence >= 0.4).slice(0, 5);
    if (topPatterns.length > 0) {
      lines.push('### Example Files by Pattern');
      lines.push('');
      for (const pattern of topPatterns) {
        lines.push(`**${pattern.name}:**`);
        for (const file of pattern.files.slice(0, 5)) {
          lines.push(`- ${file}`);
        }
        if (pattern.files.length > 5) {
          lines.push(`- ... and ${pattern.files.length - 5} more`);
        }
        lines.push('');
      }
    }
  }

  // Master Agent Folder Groupings
  if (result.masterAgentPlan) {
    lines.push('## Master Agent Analysis');
    lines.push('');
    if (result.masterAgentPlan.summary) {
      lines.push(`> ${result.masterAgentPlan.summary}`);
      lines.push('');
    }
    
    lines.push('### Folder Groupings');
    lines.push('');
    lines.push('| Priority | Group Name | Folders |');
    lines.push('|----------|------------|---------|');
    const sortedGroups = [...result.masterAgentPlan.groupings].sort((a, b) => a.priority - b.priority);
    for (const group of sortedGroups) {
      const folderList = group.folders.length > 3 
        ? `${group.folders.slice(0, 3).join(', ')} (+${group.folders.length - 3} more)`
        : group.folders.join(', ');
      lines.push(`| ${group.priority} | ${group.name} | ${folderList} |`);
    }
    lines.push('');
    
    // Detailed groupings
    lines.push('### Grouping Details');
    lines.push('');
    for (const group of sortedGroups) {
      lines.push(`#### ${group.name} (Priority ${group.priority})`);
      lines.push('');
      for (const folder of group.folders) {
        lines.push(`- ${folder}`);
      }
      lines.push('');
    }
    
    if (result.masterAgentPlan.analysisOrder && result.masterAgentPlan.analysisOrder.length > 0) {
      lines.push('### Suggested Analysis Order');
      lines.push('');
      lines.push('Follow this order when analyzing the codebase:');
      lines.push('');
      for (let i = 0; i < result.masterAgentPlan.analysisOrder.length; i++) {
        lines.push(`${i + 1}. ${result.masterAgentPlan.analysisOrder[i]}`);
      }
      lines.push('');
    }
  }

  // Parallel Worker Execution Results
  if (result.workerResults) {
    const wr = result.workerResults;
    lines.push('## Parallel Worker Execution');
    lines.push('');
    lines.push('Workers were executed in parallel to analyze the codebase faster.');
    lines.push('');
    lines.push('### Execution Summary');
    lines.push('');
    lines.push(`- **Workers Spawned**: ${wr.workerCount}`);
    lines.push(`- **Successful**: ${wr.successCount}`);
    lines.push(`- **Failed**: ${wr.failedCount}`);
    lines.push(`- **Parallel Duration**: ${(wr.totalDurationMs / 1000).toFixed(2)}s`);
    lines.push(`- **Sequential Duration** (if run one-by-one): ${(wr.sequentialDurationMs / 1000).toFixed(2)}s`);
    lines.push(`- **Speedup Factor**: ${wr.speedupFactor.toFixed(2)}x`);
    lines.push('');
    lines.push('### Resource Usage');
    lines.push('');
    lines.push(`- **Peak CPU**: ${wr.peakCpuPercent}%`);
    lines.push(`- **Peak Memory**: ${wr.peakMemoryMB}MB`);
    lines.push(`- **Resource Samples**: ${wr.resourceSnapshots.length}`);
    lines.push('');
    
    // Show individual worker results
    lines.push('### Worker Results');
    lines.push('');
    lines.push('| Worker | Status | Duration | Folders |');
    lines.push('|--------|--------|----------|---------|');
    for (const worker of wr.workers) {
      const status = worker.success ? '✓ Success' : '✗ Failed';
      const duration = `${(worker.durationMs / 1000).toFixed(2)}s`;
      const folderCount = worker.folders.length.toString();
      lines.push(`| ${worker.groupName} | ${status} | ${duration} | ${folderCount} |`);
    }
    lines.push('');
  }

  // Footer
  lines.push('---');
  lines.push('');
  lines.push('*This context file was automatically generated. For best results, review and customize as needed.*');

  return lines.join('\n');
}

/**
 * Prompt user for confirmation (simple stdin read)
 */
async function promptConfirmation(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(`${message} [y/N] `);
    
    // For non-TTY environments, default to no
    if (!process.stdin.isTTY) {
      console.log('(non-interactive, defaulting to No)');
      resolve(false);
      return;
    }

    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (data) => {
      const answer = data.toString().trim().toLowerCase();
      resolve(answer === 'y' || answer === 'yes');
    });
    process.stdin.resume();
  });
}

/**
 * Recursively scan directory for files
 */
async function scanDirectory(
  dirPath: string,
  maxFiles: number,
  result: {
    files: number;
    directories: number;
    filesByType: Record<string, number>;
    agentFiles: string[];
    warnings: AnalysisWarning[];
  },
  relativePath: string = '',
  progressReporter?: ProgressReporter,
  exclusionManager?: PathExclusionManager
): Promise<boolean> {
  // Check if we've hit the file limit
  if (result.files >= maxFiles) {
    return true; // truncated
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    // Permission denied or other error - log warning and skip this directory
    const reason = err instanceof Error ? err.message : String(err);
    result.warnings.push({
      type: 'inaccessible',
      filePath: relativePath || dirPath,
      reason: `Cannot access directory: ${reason}`,
    });
    return false;
  }

  for (const entry of entries) {
    if (result.files >= maxFiles) {
      return true; // truncated
    }

    const entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;

    if (entry.isDirectory()) {
      // Use exclusion manager if available, otherwise fall back to basic check
      let shouldExclude = false;
      if (exclusionManager) {
        const exclusionResult = exclusionManager.shouldExcludeDir(entry.name, entryRelativePath);
        shouldExclude = exclusionResult.excluded;
      } else {
        shouldExclude = shouldIgnoreDir(entry.name);
      }

      if (!shouldExclude) {
        result.directories++;
        // Update progress
        if (progressReporter) {
          progressReporter.updateCounts(result.files, result.directories);
        }
        const truncated = await scanDirectory(
          path.join(dirPath, entry.name),
          maxFiles,
          result,
          entryRelativePath,
          progressReporter,
          exclusionManager
        );
        if (truncated) {
          return true;
        }
      }
    } else if (entry.isFile()) {
      // Check file exclusion
      let shouldExclude = false;
      if (exclusionManager) {
        const exclusionResult = exclusionManager.shouldExcludeFile(entry.name, entryRelativePath);
        shouldExclude = exclusionResult.excluded;
      }

      if (!shouldExclude) {
        result.files++;

        // Track file type
        const fileType = detectFileType(entry.name);
        if (fileType) {
          result.filesByType[fileType] = (result.filesByType[fileType] || 0) + 1;
        }

        // Track AGENTS.md files
        if (entry.name === 'AGENTS.md') {
          result.agentFiles.push(entryRelativePath);
        }
        
        // Update progress periodically (every 100 files)
        if (progressReporter && result.files % 100 === 0) {
          progressReporter.updateCounts(result.files, result.directories);
        }
      }
    }
  }

  return false;
}

/**
 * Code patterns to detect in deep analysis
 */
const CODE_PATTERN_REGEXES: Record<string, { regex: RegExp; description: string }> = {
  'React Component': {
    regex: /(?:function|const)\s+[A-Z][a-zA-Z]*\s*(?:=\s*)?(?:\([^)]*\)\s*(?:=>|:)|\([^)]*\)\s*\{)/,
    description: 'React functional component pattern',
  },
  'Class Component': {
    regex: /class\s+[A-Z][a-zA-Z]*\s+extends\s+(?:React\.)?Component/,
    description: 'React class component pattern',
  },
  'Express Route': {
    regex: /(?:app|router)\.(get|post|put|delete|patch|use)\s*\(/,
    description: 'Express.js route handler',
  },
  'API Endpoint': {
    regex: /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)\s*\(/,
    description: 'Next.js/Remix API route handler',
  },
  'Custom Hook': {
    regex: /(?:export\s+)?(?:function|const)\s+use[A-Z][a-zA-Z]*\s*(?:=\s*)?\(/,
    description: 'React custom hook pattern',
  },
  'Test Suite': {
    regex: /(?:describe|test|it)\s*\(\s*['"`]/,
    description: 'Test suite (Jest/Vitest/Mocha)',
  },
  'Decorator Pattern': {
    regex: /@[A-Z][a-zA-Z]*(?:\([^)]*\))?[\s\n]+(?:export\s+)?class/,
    description: 'TypeScript decorator pattern (NestJS, Angular)',
  },
  'Singleton': {
    regex: /static\s+(?:get\s+)?instance\s*(?:\(\)|:)/,
    description: 'Singleton design pattern',
  },
  'Factory Function': {
    regex: /(?:export\s+)?(?:function|const)\s+create[A-Z][a-zA-Z]*\s*(?:=\s*)?\(/,
    description: 'Factory function pattern',
  },
  'Event Handler': {
    regex: /(?:on|handle)[A-Z][a-zA-Z]*\s*(?:=\s*)?(?:\([^)]*\)\s*=>|\([^)]*\)\s*\{)/,
    description: 'Event handler function pattern',
  },
};

/**
 * Detect code patterns in a file (for deep analysis)
 */
function detectCodePatternsInFile(_filePath: string, content: string): { pattern: string; description: string }[] {
  const detected: { pattern: string; description: string }[] = [];
  
  for (const [patternName, { regex, description }] of Object.entries(CODE_PATTERN_REGEXES)) {
    if (regex.test(content)) {
      detected.push({ pattern: patternName, description });
    }
  }
  
  return detected;
}

/**
 * Perform deep code analysis on source files
 */
async function performDeepAnalysis(
  rootPath: string,
  warnings: AnalysisWarning[],
  maxFilesToAnalyze: number = 500,
  progressReporter?: ProgressReporter,
  exclusionManager?: PathExclusionManager
): Promise<CodePattern[]> {
  const patternMap = new Map<string, { description: string; files: string[] }>();
  let filesAnalyzed = 0;

  async function analyzeDir(dirPath: string, relativePath: string = ''): Promise<void> {
    if (filesAnalyzed >= maxFilesToAnalyze) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (err) {
      // Log warning for inaccessible directory
      const reason = err instanceof Error ? err.message : String(err);
      warnings.push({
        type: 'inaccessible',
        filePath: relativePath || dirPath,
        reason: `Cannot access directory: ${reason}`,
      });
      return;
    }

    for (const entry of entries) {
      if (filesAnalyzed >= maxFilesToAnalyze) return;

      const entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        // Use exclusion manager if available
        let shouldExclude = false;
        if (exclusionManager) {
          const exclusionResult = exclusionManager.shouldExcludeDir(entry.name, entryRelativePath);
          shouldExclude = exclusionResult.excluded;
        } else {
          shouldExclude = shouldIgnoreDir(entry.name);
        }

        if (!shouldExclude) {
          await analyzeDir(
            path.join(dirPath, entry.name),
            entryRelativePath
          );
        }
      } else if (entry.isFile()) {
        // Check file exclusion
        let shouldExclude = false;
        if (exclusionManager) {
          const exclusionResult = exclusionManager.shouldExcludeFile(entry.name, entryRelativePath);
          shouldExclude = exclusionResult.excluded;
        }

        if (!shouldExclude) {
          // Only analyze source code files
          const ext = path.extname(entry.name);
          if (['.ts', '.tsx', '.js', '.jsx', '.py', '.rb', '.java', '.go'].includes(ext)) {
            const filePath = path.join(dirPath, entry.name);
            try {
              const content = fs.readFileSync(filePath, 'utf-8');
              const patterns = detectCodePatternsInFile(filePath, content);
              
              for (const { pattern, description } of patterns) {
                if (!patternMap.has(pattern)) {
                  patternMap.set(pattern, { description, files: [] });
                }
                const existing = patternMap.get(pattern)!;
                if (existing.files.length < 10) { // Limit files per pattern
                  existing.files.push(entryRelativePath);
                }
              }
              
              filesAnalyzed++;
              
              // Update progress periodically
              if (progressReporter && filesAnalyzed % 50 === 0) {
                progressReporter.updateCounts(filesAnalyzed, 0);
              }
            } catch (err) {
              // Log warning for file read/parse error
              const reason = err instanceof Error ? err.message : String(err);
              warnings.push({
                type: 'read_error',
                filePath: entryRelativePath,
                reason: `Cannot read file: ${reason}`,
              });
            }
          }
        }
      }
    }
  }

  await analyzeDir(rootPath);

  // Convert to CodePattern array with confidence
  const codePatterns: CodePattern[] = [];
  for (const [name, { description, files }] of patternMap.entries()) {
    // Confidence based on number of occurrences
    const confidence = Math.min(files.length / 5, 1);
    codePatterns.push({
      name,
      description,
      files,
      confidence,
    });
  }

  // Sort by confidence (most confident first)
  return codePatterns.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Spinner frames for console animation
 */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Get strategy-specific instructions for the master agent prompt.
 */
function getStrategyInstructions(strategy: SplittingStrategy): string {
  switch (strategy) {
    case 'top-level':
      return `
## Strategy: Top-Level Directories
Split ONLY by top-level directories. Each top-level directory should be its own group.
Do NOT analyze imports or dependencies. Simply list each major directory as a separate group.
This is a straightforward structural split.`;
    
    case 'domain':
      return `
## Strategy: Domain-Based Grouping
Analyze imports and dependencies to group related code together.
Focus on:
- Import/require statements between files
- Which folders frequently import from each other
- Domain boundaries (e.g., user management, authentication, payments)
- Keep tightly coupled code in the same group to minimize cross-group dependencies`;
    
    case 'balanced':
      return `
## Strategy: Balanced Distribution
Distribute files as evenly as possible across groups.
Focus on:
- File counts per directory
- Aim for roughly equal number of files per group
- Create groups of similar size/complexity regardless of code relationships
- Goal is to maximize parallel efficiency with even workload distribution`;
    
    case 'auto':
    default:
      return `
## Strategy: Auto (LLM Choice)
Analyze the project and choose the best splitting approach:
- For small projects (<50 files): prefer top-level split
- For projects with clear domain boundaries: prefer domain-based grouping
- For monorepos or large flat structures: prefer balanced distribution
- Consider the project type, conventions, and structure when deciding`;
  }
}

/**
 * Build the prompt for master agent analysis with strategy support.
 */
function buildMasterAgentPrompt(
  directoryTree: string,
  packageJson: Record<string, unknown> | null,
  imports: string[],
  strategy: SplittingStrategy = 'auto'
): string {
  const packageInfo = packageJson 
    ? `\n\n## Package.json Summary\n\`\`\`json\n${JSON.stringify(packageJson, null, 2)}\n\`\`\``
    : '';
  
  const importInfo = imports.length > 0
    ? `\n\n## Sample Import Statements (first 50)\n\`\`\`\n${imports.slice(0, 50).join('\n')}\n\`\`\``
    : '';

  const strategyInstructions = getStrategyInstructions(strategy);

  return `Analyze the following project structure and determine folder groupings for parallel analysis.
${strategyInstructions}

## Directory Tree
\`\`\`
${directoryTree}
\`\`\`${packageInfo}${importInfo}

## Your Task

Based on the strategy above and the project structure, create logical folder groupings.

Return ONLY a valid JSON object with this exact structure, no other text:

{
  "groupings": [
    {
      "name": "Group Name (e.g., 'Core Components', 'API Layer')",
      "folders": ["folder1", "folder2/subfolder"],
      "priority": 1
    }
  ],
  "summary": "Brief explanation of the grouping approach used",
  "analysisOrder": ["folder1", "folder2"],
  "strategyUsed": "${strategy}"
}

Rules for priority (1-5):
- 1 = Highest priority (core/critical code, foundation)
- 2 = High priority (main features, primary API)
- 3 = Medium priority (secondary features, utilities)
- 4 = Low priority (tests, docs, configs)
- 5 = Lowest priority (generated code, vendor, build)

IMPORTANT: Return ONLY the JSON object. No markdown code blocks, no explanation text before or after.`;
}

/**
 * Extract import statements from source files
 */
function extractImportStatements(
  rootPath: string,
  maxFiles: number = 100
): string[] {
  const imports: string[] = [];
  
  function scanDir(dirPath: string, depth: number = 0): void {
    if (depth > 3 || imports.length >= maxFiles * 5) return;
    
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (imports.length >= maxFiles * 5) break;
        
        if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          scanDir(path.join(dirPath, entry.name), depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) {
            try {
              const content = fs.readFileSync(path.join(dirPath, entry.name), 'utf-8');
              const lines = content.split('\n').slice(0, 30); // Only check first 30 lines
              for (const line of lines) {
                const match = line.match(/^import\s+.*?from\s+['"]([^'"]+)['"]/) ||
                              line.match(/require\(['"]([^'"]+)['"]\)/);
                if (match) {
                  imports.push(match[0]);
                }
              }
            } catch {
              // Skip unreadable files
            }
          }
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }
  
  scanDir(rootPath);
  return imports;
}

/**
 * Parse package.json for master agent context
 */
function parsePackageJsonForAgent(rootPath: string): Record<string, unknown> | null {
  const pkgPath = path.join(rootPath, 'package.json');
  try {
    if (fs.existsSync(pkgPath)) {
      const content = fs.readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      // Return only relevant fields for analysis
      return {
        name: pkg.name,
        description: pkg.description,
        main: pkg.main,
        type: pkg.type,
        scripts: pkg.scripts ? Object.keys(pkg.scripts) : [],
        dependencies: pkg.dependencies ? Object.keys(pkg.dependencies) : [],
        devDependencies: pkg.devDependencies ? Object.keys(pkg.devDependencies) : [],
      };
    }
  } catch {
    // Skip on parse error
  }
  return null;
}

/**
 * Parse JSON from potentially wrapped output
 */
function parseJsonFromOutput(output: string): MasterAgentPlan | null {
  // Try direct parse first
  try {
    const parsed = JSON.parse(output.trim());
    if (parsed.groupings && Array.isArray(parsed.groupings)) {
      return parsed as MasterAgentPlan;
    }
  } catch {
    // Continue to try extraction
  }
  
  // Try to extract JSON from markdown code blocks
  const jsonBlockMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim());
      if (parsed.groupings && Array.isArray(parsed.groupings)) {
        return parsed as MasterAgentPlan;
      }
    } catch {
      // Continue to try other methods
    }
  }
  
  // Clean up Copilot CLI output formatting:
  // - Remove bullet points (●, •, -, *)
  // - Remove leading whitespace from wrapped lines
  // - Join multi-line JSON back together
  let cleanedOutput = output
    // Remove ● or • bullet points at start of lines
    .replace(/^[●•\-\*]\s*/gm, '')
    // Remove ✔ checkmarks and tool output headers
    .replace(/^✔.*$/gm, '')
    .replace(/^\s*└.*$/gm, '')
    // Join wrapped lines (lines that start with whitespace and continue JSON)
    .replace(/\n\s{2,}/g, ' ')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
  
  // Try to find JSON object in cleaned output
  const jsonMatch = cleanedOutput.match(/\{[^{}]*"groupings"\s*:\s*\[[\s\S]*\]\s*[^{}]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.groupings && Array.isArray(parsed.groupings)) {
        return parsed as MasterAgentPlan;
      }
    } catch {
      // Continue to original method
    }
  }
  
  // Try to find JSON object in raw output (fallback)
  const rawJsonMatch = output.match(/\{[\s\S]*"groupings"[\s\S]*\}/);
  if (rawJsonMatch) {
    // Clean the matched JSON by joining wrapped lines
    const cleanedJson = rawJsonMatch[0]
      .replace(/\n\s+/g, ' ')
      .replace(/\s+/g, ' ');
    try {
      const parsed = JSON.parse(cleanedJson);
      if (parsed.groupings && Array.isArray(parsed.groupings)) {
        return parsed as MasterAgentPlan;
      }
    } catch {
      // Failed to parse
    }
  }
  
  return null;
}

/**
 * Validate the master agent plan
 */
function validateMasterAgentPlan(plan: MasterAgentPlan): string | null {
  if (!plan.groupings || !Array.isArray(plan.groupings)) {
    return 'Invalid plan: missing groupings array';
  }
  
  for (let i = 0; i < plan.groupings.length; i++) {
    const group = plan.groupings[i];
    if (!group.name || typeof group.name !== 'string') {
      return `Invalid grouping at index ${i}: missing or invalid name`;
    }
    if (!group.folders || !Array.isArray(group.folders)) {
      return `Invalid grouping at index ${i}: missing or invalid folders array`;
    }
    if (typeof group.priority !== 'number' || group.priority < 1 || group.priority > 5) {
      return `Invalid grouping at index ${i}: priority must be a number between 1 and 5`;
    }
  }
  
  return null;
}

/**
 * Invoke master agent using copilot -p to analyze project structure
 */
export async function invokeMasterAgentAnalysis(
  rootPath: string,
  directoryTree: string,
  quiet: boolean = false,
  verbose: boolean = false,
  strategy: SplittingStrategy = 'auto'
): Promise<MasterAgentResult> {
  const startTime = Date.now();
  const timeout = 60000; // 60 seconds
  
  // Gather context for the agent
  const packageJson = parsePackageJsonForAgent(rootPath);
  const imports = extractImportStatements(rootPath);
  
  // Build the prompt with strategy
  const prompt = buildMasterAgentPrompt(directoryTree, packageJson, imports, strategy);
  
  if (verbose) {
    console.log('Master agent prompt length:', prompt.length);
    console.log('Strategy:', strategy);
  }
  
  // Start spinner animation
  let spinnerInterval: ReturnType<typeof setInterval> | null = null;
  let frameIndex = 0;
  
  const strategyLabel = strategy === 'auto' ? 'auto-detect' : strategy;
  if (!quiet) {
    spinnerInterval = setInterval(() => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(`\r${SPINNER_FRAMES[frameIndex]} Analyzing project structure [strategy: ${strategyLabel}]... (${elapsed}s)`);
      frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
    }, 80);
  }
  
  return new Promise((resolve) => {
    const args = [
      '--silent',
      '--stream', 'off',
      '--allow-all-tools',
    ];
    
    if (verbose) {
      console.log(`\nRunning: copilot ${args.join(' ')}`);
    }
    
    const proc = spawn('copilot', args, {
      cwd: rootPath,
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
    
    const cleanup = () => {
      if (spinnerInterval) {
        clearInterval(spinnerInterval);
        spinnerInterval = null;
        if (!quiet) {
          process.stdout.write('\r' + ' '.repeat(60) + '\r');
        }
      }
    };
    
    proc.on('error', (error) => {
      cleanup();
      const durationMs = Date.now() - startTime;
      
      // Check if copilot is not installed
      if (error.message.includes('ENOENT') || error.message.includes('not found')) {
        resolve({
          success: false,
          error: 'Copilot CLI not found. Install with: winget install GitHub.Copilot (Windows) or brew install copilot-cli (macOS/Linux)',
          durationMs,
        });
        return;
      }
      
      resolve({
        success: false,
        error: `Failed to execute Copilot CLI: ${error.message}`,
        durationMs,
      });
    });
    
    proc.on('close', (code) => {
      cleanup();
      const durationMs = Date.now() - startTime;
      
      if (code !== 0) {
        const errorOutput = stderr || stdout;
        
        if (errorOutput.includes('not found') || errorOutput.includes('command not found')) {
          resolve({
            success: false,
            error: 'Copilot CLI not found. Install with: winget install GitHub.Copilot (Windows) or brew install copilot-cli (macOS/Linux)',
            durationMs,
          });
          return;
        }
        
        if (errorOutput.includes('authentication') || errorOutput.includes('unauthorized')) {
          resolve({
            success: false,
            error: 'Copilot CLI authentication failed. Please run "copilot auth" to authenticate.',
            durationMs,
          });
          return;
        }
        
        resolve({
          success: false,
          error: errorOutput || `Copilot CLI exited with code ${code}`,
          durationMs,
        });
        return;
      }
      
      // Parse the JSON output
      const plan = parseJsonFromOutput(stdout);
      
      if (!plan) {
        if (verbose) {
          console.log('\nRaw output:', stdout);
        }
        resolve({
          success: false,
          error: 'Failed to parse master agent output as JSON. The agent did not return valid folder groupings.',
          durationMs,
        });
        return;
      }
      
      // Validate the plan
      const validationError = validateMasterAgentPlan(plan);
      if (validationError) {
        resolve({
          success: false,
          error: validationError,
          durationMs,
        });
        return;
      }
      
      resolve({
        success: true,
        plan,
        durationMs,
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
      
      cleanup();
      resolve({
        success: false,
        error: `Master agent analysis timed out after ${timeout / 1000} seconds`,
        durationMs: timeout,
      });
    }, timeout);
    
    // Clear timeout if process completes
    proc.on('close', () => {
      clearTimeout(timeoutId);
    });
  });
}

/**
 * Analyze a project directory
 */
export async function analyzeProject(
  rootPath: string, 
  depth: DepthLevel = 'standard',
  progressReporter?: ProgressReporter,
  includePatterns: string[] = [],
  verbose: boolean = false,
  useAgent: boolean = false,
  quiet: boolean = false,
  strategy: SplittingStrategy = 'auto'
): Promise<LearnResult> {
  const startTime = Date.now();
  const maxFiles = 10000;

  // Verify path exists and is a directory
  if (!fs.existsSync(rootPath)) {
    throw new Error(`Path does not exist: ${rootPath}`);
  }

  const stats = fs.statSync(rootPath);
  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${rootPath}`);
  }

  // Create exclusion manager
  const exclusionManager = new PathExclusionManager(rootPath, includePatterns, verbose);

  // Get top-level contents
  const topLevelEntries = fs.readdirSync(rootPath, { withFileTypes: true });
  const topLevelFiles = topLevelEntries.filter(e => e.isFile()).map(e => e.name);
  const topLevelDirs = topLevelEntries.filter(e => e.isDirectory() && !shouldIgnoreDir(e.name)).map(e => e.name);

  // Detect project types (all depths)
  const projectTypes = detectProjectTypes(rootPath, topLevelFiles);

  // Build structure overview (all depths)
  const structure: string[] = [];
  for (const dir of topLevelDirs.slice(0, 10)) {
    structure.push(`${dir}/`);
  }
  for (const file of topLevelFiles.slice(0, 10)) {
    structure.push(file);
  }
  if (topLevelDirs.length + topLevelFiles.length > 20) {
    structure.push(`... and ${topLevelDirs.length + topLevelFiles.length - 20} more`);
  }

  // Initialize results
  let conventions: string[] = [];
  let dependencies: DependencyInfo[] = [];
  let architecturalPatterns: string[] = [];
  let directoryTree = '';
  let codePatterns: CodePattern[] | undefined;
  
  // Scan result for file counting
  const scanResult = {
    files: 0,
    directories: 0,
    filesByType: {} as Record<string, number>,
    agentFiles: [] as string[],
    warnings: [] as AnalysisWarning[],
  };

  // Shallow: Quick structural scan only
  if (depth === 'shallow') {
    // Just count top-level items (filter out excluded files)
    for (const file of topLevelFiles) {
      const exclusionResult = exclusionManager.shouldExcludeFile(file, file);
      if (!exclusionResult.excluded) {
        scanResult.files++;
        const fileType = detectFileType(file);
        if (fileType) {
          scanResult.filesByType[fileType] = (scanResult.filesByType[fileType] || 0) + 1;
        }
      }
    }
    scanResult.directories = topLevelDirs.length;
    directoryTree = topLevelDirs.map(d => `${d}/`).concat(topLevelFiles).slice(0, 20).join('\n');
  }

  // Standard: Full structure + dependencies + patterns
  if (depth === 'standard' || depth === 'deep') {
    if (progressReporter) {
      progressReporter.setPhase('Scanning files...');
    }
    conventions = detectConventions(rootPath, topLevelFiles);
    dependencies = parseDependencies(rootPath, topLevelFiles);
    architecturalPatterns = detectArchitecturalPatterns(rootPath, topLevelFiles, topLevelDirs);
    directoryTree = buildDirectoryTree(rootPath);
    
    // Full file scan with exclusion manager
    await scanDirectory(rootPath, maxFiles, scanResult, '', progressReporter, exclusionManager);
  }

  // Deep: Code pattern analysis
  if (depth === 'deep') {
    if (progressReporter) {
      progressReporter.setPhase('Analyzing code patterns...');
    }
    codePatterns = await performDeepAnalysis(rootPath, scanResult.warnings, 500, progressReporter, exclusionManager);
  }

  // Master agent analysis
  let masterAgentPlan: MasterAgentPlan | undefined;
  if (useAgent) {
    if (progressReporter) {
      progressReporter.stop(); // Stop standard progress, agent has its own spinner
    }
    
    const agentResult = await invokeMasterAgentAnalysis(
      rootPath,
      directoryTree,
      quiet,
      verbose,
      strategy
    );
    
    if (agentResult.success && agentResult.plan) {
      masterAgentPlan = agentResult.plan;
    } else if (!quiet) {
      console.error(`\n⚠️  Master agent analysis failed: ${agentResult.error}`);
    }
  }

  const truncated = scanResult.files >= maxFiles;
  const durationMs = Date.now() - startTime;

  // Count skipped and failed files from warnings
  const skippedFiles = scanResult.warnings.filter(w => w.type === 'inaccessible').length;
  const failedFiles = scanResult.warnings.filter(w => w.type === 'read_error' || w.type === 'parse_error').length;

  return {
    rootPath,
    totalFiles: scanResult.files,
    totalDirectories: scanResult.directories,
    projectTypes,
    filesByType: scanResult.filesByType,
    structure,
    conventions,
    agentFiles: scanResult.agentFiles,
    durationMs,
    truncated,
    dependencies,
    architecturalPatterns,
    directoryTree,
    depthLevel: depth,
    strategy: useAgent ? strategy : undefined,
    codePatterns,
    exclusionConfig: exclusionManager.getConfig(),
    exclusionStats: exclusionManager.getStats(),
    warnings: scanResult.warnings.length > 0 ? scanResult.warnings : undefined,
    skippedFiles: skippedFiles > 0 ? skippedFiles : undefined,
    failedFiles: failedFiles > 0 ? failedFiles : undefined,
    masterAgentPlan,
  };
}

/**
 * Get current system resource usage.
 * Returns CPU percentage and memory usage in MB.
 */
function getResourceUsage(): { cpuPercent: number; memoryMB: number } {
  const memoryUsage = process.memoryUsage();
  const memoryMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
  
  // Get CPU usage from os module (load average on Unix, fallback on Windows)
  const cpus = os.cpus();
  let cpuPercent = 0;
  
  if (cpus.length > 0) {
    // Calculate average CPU usage across all cores
    for (const cpu of cpus) {
      const total = cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
      const usage = ((total - cpu.times.idle) / total) * 100;
      cpuPercent += usage;
    }
    cpuPercent = Math.round(cpuPercent / cpus.length);
  }
  
  return { cpuPercent, memoryMB };
}

/**
 * Build prompt for worker agent analysis of a folder group.
 */
function buildWorkerPrompt(group: FolderGrouping, rootPath: string): string {
  const folderList = group.folders.map(f => `- ${f}`).join('\n');
  
  return `Analyze the following code folders and provide a summary of their purpose, architecture, and key patterns.

## Folder Group: ${group.name}
Priority: ${group.priority}
Root Path: ${rootPath}

## Folders to Analyze:
${folderList}

## Your Task:
1. For each folder, identify:
   - Primary purpose/responsibility
   - Key files and their roles
   - Dependencies on other folders
   - Code patterns used

2. Provide a brief summary of the entire group's architecture

Return your analysis as a structured report. Focus on information useful for understanding the codebase.`;
}

/**
 * Execute a single worker for a folder group.
 * Spawns copilot -p with the folder context and captures output.
 */
async function executeWorker(
  group: FolderGrouping,
  rootPath: string,
  verbose: boolean = false
): Promise<WorkerResult> {
  const startedAt = new Date();
  const prompt = buildWorkerPrompt(group, rootPath);
  
  return new Promise((resolve) => {
    const args = [
      '--silent',
      '--stream', 'off',
      '--allow-all-tools',
    ];
    
    if (verbose) {
      console.log(`\n[Worker: ${group.name}] Starting with ${group.folders.length} folders...`);
    }
    
    const proc = spawn('copilot', args, {
      cwd: rootPath,
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
      const completedAt = new Date();
      resolve({
        groupName: group.name,
        folders: group.folders,
        success: false,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        stdout,
        stderr,
        error: `Failed to execute worker: ${error.message}`,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
      });
    });
    
    proc.on('close', (code) => {
      const completedAt = new Date();
      resolve({
        groupName: group.name,
        folders: group.folders,
        success: code === 0,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        stdout,
        stderr,
        exitCode: code ?? undefined,
        error: code !== 0 ? `Worker exited with code ${code}` : undefined,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
      });
    });
    
    // Timeout after 120 seconds per worker
    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 5000);
    }, 120000);
    
    proc.on('close', () => {
      clearTimeout(timeoutId);
    });
  });
}

/**
 * Retry delay schedule in milliseconds (exponential backoff).
 * Attempt 1: immediate (0ms)
 * Attempt 2: 5 seconds
 * Attempt 3: 10 seconds
 */
const RETRY_DELAYS_MS = [0, 5000, 10000];

/**
 * Get retry delay for a given attempt (0-indexed).
 */
function getRetryDelayMs(attempt: number): number {
  if (attempt < RETRY_DELAYS_MS.length) {
    return RETRY_DELAYS_MS[attempt];
  }
  // For attempts beyond the defined delays, use the last delay
  return RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
}

/**
 * Execute a worker with retry logic.
 * Failed workers automatically retry with exponential backoff.
 */
async function executeWorkerWithRetry(
  group: FolderGrouping,
  rootPath: string,
  maxRetries: number,
  verbose: boolean,
  onRetry?: (attempt: number, maxRetries: number, delayMs: number, previousError: string) => void
): Promise<WorkerResult> {
  let lastResult: WorkerResult | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Apply delay for retry attempts (not first attempt)
    if (attempt > 0) {
      const delayMs = getRetryDelayMs(attempt - 1);
      if (onRetry) {
        onRetry(attempt, maxRetries, delayMs, lastResult?.error ?? 'Unknown error');
      }
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    const result = await executeWorker(group, rootPath, verbose);
    lastResult = result;
    
    if (result.success) {
      return result;
    }
    
    // If this was the last attempt, return the failed result
    if (attempt === maxRetries) {
      return result;
    }
  }
  
  // Should never reach here, but return last result for safety
  return lastResult!;
}

/**
 * Execute all workers in parallel and monitor resources.
 * All workers spawn immediately after master agent completes.
 */
export async function executeWorkersInParallel(
  plan: MasterAgentPlan,
  rootPath: string,
  quiet: boolean = false,
  verbose: boolean = false,
  maxRetries: number = 3
): Promise<WorkerExecutionSummary> {
  const startedAt = new Date();
  const resourceSnapshots: ResourceSnapshot[] = [];
  let peakMemoryMB = 0;
  let peakCpuPercent = 0;
  
  // Start resource monitoring
  const monitoringInterval = setInterval(() => {
    const usage = getResourceUsage();
    const activeWorkers = plan.groupings.length; // Simplified - all spawn at once
    
    resourceSnapshots.push({
      timestamp: new Date().toISOString(),
      cpuPercent: usage.cpuPercent,
      memoryMB: usage.memoryMB,
      activeWorkers,
    });
    
    if (usage.memoryMB > peakMemoryMB) peakMemoryMB = usage.memoryMB;
    if (usage.cpuPercent > peakCpuPercent) peakCpuPercent = usage.cpuPercent;
  }, 1000); // Sample every second
  
  // Start spinner animation for parallel execution
  let spinnerInterval: ReturnType<typeof setInterval> | null = null;
  let frameIndex = 0;
  const workerCount = plan.groupings.length;
  
  if (!quiet) {
    spinnerInterval = setInterval(() => {
      const elapsed = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
      process.stdout.write(`\r${SPINNER_FRAMES[frameIndex]} Executing ${workerCount} workers in parallel... (${elapsed}s)`);
      frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
    }, 80);
  }
  
  try {
    // AC1: All workers spawn immediately after master agent completes
    // AC2: Each worker runs copilot -p with its assigned folder context
    // AC3: Workers operate independently without blocking each other
    // AC4: Worker count matches the number of folder groups from master plan
    // US-006: Failed workers automatically retry with exponential backoff
    const workerPromises = plan.groupings.map(group => 
      executeWorkerWithRetry(
        group,
        rootPath,
        maxRetries,
        verbose,
        (attempt, maxRet, delayMs, prevError) => {
          if (!quiet) {
            const delaySec = (delayMs / 1000).toFixed(0);
            console.log(`\n↻ ${group.name}: Retry ${attempt}/${maxRet} in ${delaySec}s (${prevError})`);
          }
        }
      )
    );
    
    // Wait for all workers to complete in parallel
    const workers = await Promise.all(workerPromises);
    
    const completedAt = new Date();
    const totalDurationMs = completedAt.getTime() - startedAt.getTime();
    
    // Stop monitoring
    clearInterval(monitoringInterval);
    
    // Stop spinner
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      if (!quiet) {
        process.stdout.write('\r' + ' '.repeat(70) + '\r');
      }
    }
    
    // Calculate statistics
    const successCount = workers.filter(w => w.success).length;
    const failedCount = workers.filter(w => !w.success).length;
    
    // AC5: Total analysis time is significantly less than sum of individual folder times
    const sequentialDurationMs = workers.reduce((sum, w) => sum + w.durationMs, 0);
    const speedupFactor = sequentialDurationMs > 0 ? sequentialDurationMs / totalDurationMs : 1;
    
    // Take final resource snapshot
    const finalUsage = getResourceUsage();
    resourceSnapshots.push({
      timestamp: completedAt.toISOString(),
      cpuPercent: finalUsage.cpuPercent,
      memoryMB: finalUsage.memoryMB,
      activeWorkers: 0,
    });
    
    if (finalUsage.memoryMB > peakMemoryMB) peakMemoryMB = finalUsage.memoryMB;
    if (finalUsage.cpuPercent > peakCpuPercent) peakCpuPercent = finalUsage.cpuPercent;
    
    // AC6: System resources (CPU, memory) are monitored and logged
    if (!quiet && verbose) {
      console.log(`\n[Resources] Peak CPU: ${peakCpuPercent}%, Peak Memory: ${peakMemoryMB}MB`);
      console.log(`[Resources] Snapshots collected: ${resourceSnapshots.length}`);
    }
    
    return {
      workerCount,
      successCount,
      failedCount,
      totalDurationMs,
      sequentialDurationMs,
      speedupFactor,
      workers,
      resourceSnapshots,
      peakMemoryMB,
      peakCpuPercent,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    };
  } catch (error) {
    // Stop monitoring on error
    clearInterval(monitoringInterval);
    
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      if (!quiet) {
        process.stdout.write('\r' + ' '.repeat(70) + '\r');
      }
    }
    
    throw error;
  }
}

/**
 * Print worker execution results in human-readable format.
 */
function printWorkerResults(summary: WorkerExecutionSummary, verbose: boolean): void {
  console.log('');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('  🔄 Parallel Worker Execution Results');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('');
  console.log(`  Workers:        ${summary.workerCount}`);
  console.log(`  Successful:     ${summary.successCount}`);
  console.log(`  Failed:         ${summary.failedCount}`);
  console.log(`  Total Time:     ${(summary.totalDurationMs / 1000).toFixed(2)}s (parallel)`);
  console.log(`  Sequential Time: ${(summary.sequentialDurationMs / 1000).toFixed(2)}s (if sequential)`);
  console.log(`  Speedup Factor: ${summary.speedupFactor.toFixed(2)}x`);
  console.log('');
  console.log('  📊 Resource Usage:');
  console.log(`    Peak CPU:     ${summary.peakCpuPercent}%`);
  console.log(`    Peak Memory:  ${summary.peakMemoryMB}MB`);
  console.log('');
  
  // Show individual worker results
  if (verbose) {
    console.log('  📋 Worker Details:');
    for (const worker of summary.workers) {
      const status = worker.success ? '✓' : '✗';
      const duration = (worker.durationMs / 1000).toFixed(2);
      console.log(`    ${status} ${worker.groupName} (${duration}s) - ${worker.folders.length} folders`);
      if (!worker.success && worker.error) {
        console.log(`      Error: ${worker.error}`);
      }
    }
    console.log('');
  }
  
  // US-006: Show failed folders with warning message
  const failedWorkers = summary.workers.filter(w => !w.success);
  if (failedWorkers.length > 0) {
    console.log('  ⚠️  Warning: Some workers failed after all retries');
    console.log('  Failed folder groups:');
    for (const worker of failedWorkers) {
      console.log(`    ✗ ${worker.groupName}: ${worker.folders.join(', ')}`);
      if (worker.error) {
        console.log(`      Reason: ${worker.error}`);
      }
    }
    console.log('');
  }
}

/**
 * Build prompt for merge agent to combine worker outputs.
 * Instructs the LLM to deduplicate and organize content into logical sections.
 */
function buildMergePrompt(workerOutputs: WorkerResult[], projectName: string): string {
  const successfulOutputs = workerOutputs.filter(w => w.success && w.stdout);
  
  // Collect all worker outputs
  const outputSections = successfulOutputs.map(w => {
    return `## Worker: ${w.groupName}
Folders analyzed: ${w.folders.join(', ')}
Duration: ${(w.durationMs / 1000).toFixed(2)}s

${w.stdout}`;
  }).join('\n\n---\n\n');

  return `You are merging analysis outputs from multiple parallel workers into a single coherent project context file.

## Project: ${projectName}

## Worker Outputs to Merge:
${outputSections}

## Your Task:
1. **Deduplicate** information that appears in multiple worker outputs
2. **Organize** the merged content into these logical sections:
   - **Overview**: High-level project summary, purpose, and key characteristics
   - **Architecture**: System architecture, design patterns, and structural organization
   - **Components**: Major components/modules and their responsibilities
   - **APIs**: Exposed APIs, interfaces, and integration points
   - **Patterns**: Code patterns, conventions, and best practices observed

3. **Consolidate** related information even if workers described it differently
4. **Preserve** unique insights from each worker

## Output Format:
Return ONLY the merged markdown content with the sections above.
Use proper markdown formatting (headers, lists, code blocks).
Do NOT include any meta-commentary or explanation of the merge process.
Start directly with the "# Overview" section.`;
}

/**
 * Save partial worker outputs as backup before merge.
 * Returns the backup file path.
 */
function savePartialOutputsBackup(
  workerResults: WorkerExecutionSummary,
  rootPath: string
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = path.join(rootPath, `.ralph-partial-outputs-${timestamp}.md`);
  
  const lines: string[] = [];
  lines.push('# Partial Worker Outputs (Backup)');
  lines.push('');
  lines.push(`> Generated by ralph-tui learn on ${new Date().toISOString()}`);
  lines.push(`> This file contains raw worker outputs preserved as backup.`);
  lines.push('');
  lines.push('---');
  lines.push('');
  
  for (const worker of workerResults.workers) {
    lines.push(`## Worker: ${worker.groupName}`);
    lines.push('');
    lines.push(`- **Status**: ${worker.success ? '✓ Success' : '✗ Failed'}`);
    lines.push(`- **Duration**: ${(worker.durationMs / 1000).toFixed(2)}s`);
    lines.push(`- **Folders**: ${worker.folders.join(', ')}`);
    lines.push('');
    
    if (worker.stdout) {
      lines.push('### Output:');
      lines.push('');
      lines.push(worker.stdout);
      lines.push('');
    }
    
    if (worker.stderr && worker.stderr.trim()) {
      lines.push('### Errors:');
      lines.push('');
      lines.push('```');
      lines.push(worker.stderr);
      lines.push('```');
      lines.push('');
    }
    
    if (worker.error) {
      lines.push(`**Error**: ${worker.error}`);
      lines.push('');
    }
    
    lines.push('---');
    lines.push('');
  }
  
  fs.writeFileSync(backupPath, lines.join('\n'), 'utf-8');
  return backupPath;
}

/**
 * Merge worker outputs using copilot -p for intelligent combination.
 * Deduplicates content and organizes into logical sections.
 */
export async function mergeWorkerOutputs(
  workerResults: WorkerExecutionSummary,
  rootPath: string,
  outputPath: string,
  quiet: boolean = false,
  verbose: boolean = false
): Promise<MergeResult> {
  const startTime = Date.now();
  const projectName = path.basename(rootPath);
  
  // AC8: Preserve partial outputs as backup before merge
  let backupPath: string | undefined;
  try {
    backupPath = savePartialOutputsBackup(workerResults, rootPath);
    if (verbose && !quiet) {
      console.log(`\n📋 Partial outputs saved to: ${backupPath}`);
    }
  } catch (backupError) {
    if (!quiet) {
      console.warn(`⚠️  Could not save backup: ${backupError instanceof Error ? backupError.message : String(backupError)}`);
    }
  }
  
  // Filter to only successful workers with output
  const successfulWorkers = workerResults.workers.filter(w => w.success && w.stdout);
  
  if (successfulWorkers.length === 0) {
    return {
      success: false,
      error: 'No successful worker outputs to merge',
      backupPath,
      durationMs: Date.now() - startTime,
    };
  }
  
  // AC3: Build merge prompt for copilot -p
  const prompt = buildMergePrompt(workerResults.workers, projectName);
  
  if (verbose) {
    console.log('\nMerge prompt length:', prompt.length);
  }
  
  // Start spinner animation for merge phase
  let spinnerInterval: ReturnType<typeof setInterval> | null = null;
  let frameIndex = 0;
  
  // AC2: TUI shows 'Merging outputs...' phase with progress indicator
  if (!quiet) {
    spinnerInterval = setInterval(() => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(`\r${SPINNER_FRAMES[frameIndex]} Merging outputs... (${elapsed}s)`);
      frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
    }, 80);
  }
  
  return new Promise((resolve) => {
    const args = [
      '--silent',
      '--stream', 'off',
      '--allow-all-tools',
    ];
    
    if (verbose) {
      console.log(`\nRunning: copilot ${args.join(' ')}`);
    }
    
    const proc = spawn('copilot', args, {
      cwd: rootPath,
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
    
    const cleanup = () => {
      if (spinnerInterval) {
        clearInterval(spinnerInterval);
        spinnerInterval = null;
        if (!quiet) {
          process.stdout.write('\r' + ' '.repeat(60) + '\r');
        }
      }
    };
    
    proc.on('error', (error) => {
      cleanup();
      const durationMs = Date.now() - startTime;
      
      resolve({
        success: false,
        error: `Failed to execute merge agent: ${error.message}`,
        backupPath,
        durationMs,
      });
    });
    
    proc.on('close', (code) => {
      cleanup();
      const durationMs = Date.now() - startTime;
      
      if (code !== 0) {
        const errorOutput = stderr || stdout;
        resolve({
          success: false,
          error: errorOutput || `Merge agent exited with code ${code}`,
          backupPath,
          durationMs,
        });
        return;
      }
      
      // AC4, AC5: The merged content should be deduplicated and organized
      // Write the merged output to the target file
      try {
        // Add header to merged content
        const mergedLines: string[] = [];
        mergedLines.push('# Project Context');
        mergedLines.push('');
        mergedLines.push(`> Generated by ralph-tui learn on ${new Date().toISOString()}`);
        mergedLines.push(`> Merged from ${successfulWorkers.length} worker outputs`);
        mergedLines.push('');
        mergedLines.push('---');
        mergedLines.push('');
        mergedLines.push(stdout.trim());
        mergedLines.push('');
        mergedLines.push('---');
        mergedLines.push('');
        mergedLines.push('*This context file was automatically generated by merging parallel worker analyses.*');
        
        const finalContent = mergedLines.join('\n');
        fs.writeFileSync(outputPath, finalContent, 'utf-8');
        
        resolve({
          success: true,
          mergedContent: finalContent,
          outputPath,
          backupPath,
          durationMs,
        });
      } catch (writeError) {
        resolve({
          success: false,
          error: `Failed to write merged output: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
          backupPath,
          durationMs,
        });
      }
    });
    
    // Timeout handling for merge (120 seconds)
    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 5000);
      
      cleanup();
      resolve({
        success: false,
        error: 'Merge agent timed out after 120 seconds',
        backupPath,
        durationMs: 120000,
      });
    }, 120000);
    
    proc.on('close', () => {
      clearTimeout(timeoutId);
    });
  });
}

/**
 * Print merge results in human-readable format.
 */
function printMergeResults(result: MergeResult, _verbose: boolean): void {
  console.log('');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('  🔀 Merge Phase Results');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('');
  
  if (result.success) {
    console.log(`  Status:       ✓ Success`);
    console.log(`  Duration:     ${(result.durationMs / 1000).toFixed(2)}s`);
    if (result.outputPath) {
      console.log(`  Output:       ${result.outputPath}`);
    }
  } else {
    console.log(`  Status:       ✗ Failed`);
    console.log(`  Duration:     ${(result.durationMs / 1000).toFixed(2)}s`);
    if (result.error) {
      console.log(`  Error:        ${result.error}`);
    }
  }
  
  if (result.backupPath) {
    console.log(`  Backup:       ${result.backupPath}`);
  }
  console.log('');
}

/**
 * Execute workers with TUI progress display.
 * Provides real-time visual feedback with worker status icons, progress bar,
 * streaming output with worker prefixes, and verbose mode toggle.
 * 
 * @param plan - Master agent plan containing folder groupings
 * @param rootPath - Root path of the project
 * @param maxRetries - Maximum retry attempts for failed workers (default: 3)
 * @param outputFilePath - Path to output file (optional, for completion summary display)
 * @param verbose - Whether verbose mode is enabled (default: false)
 * @returns Worker execution summary
 */
export async function executeWorkersWithTui(
  plan: MasterAgentPlan,
  rootPath: string,
  maxRetries: number = 3,
  outputFilePath?: string,
  verbose: boolean = false,
): Promise<WorkerExecutionSummary> {
  // Dynamic import to avoid loading TUI modules when not needed
  const { createCliRenderer } = await import('@opentui/core');
  const { createRoot } = await import('@opentui/react');
  const { WorkerProgressApp } = await import('../tui/components/WorkerProgressApp.js');
  const { createWorkerState } = await import('../tui/worker-types.js');
  const React = await import('react');

  // Initialize worker states from plan groupings
  const initialWorkers: WorkerState[] = plan.groupings.map(group => 
    createWorkerState(
      group.name,
      group.name,
      group.folders.length,
      0 // File count - we could calculate this but keeping simple for now
    )
  );

  // Event listeners for real-time updates
  const listeners: Set<WorkerEventListener> = new Set();
  
  const emit = (event: WorkerEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  const subscribe = (listener: WorkerEventListener): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  // Track worker execution
  const startedAt = new Date();
  const resourceSnapshots: ResourceSnapshot[] = [];
  let peakMemoryMB = 0;
  let peakCpuPercent = 0;

  // Start resource monitoring
  const monitoringInterval = setInterval(() => {
    const usage = getResourceUsage();
    resourceSnapshots.push({
      timestamp: new Date().toISOString(),
      cpuPercent: usage.cpuPercent,
      memoryMB: usage.memoryMB,
      activeWorkers: plan.groupings.length,
    });
    
    if (usage.memoryMB > peakMemoryMB) peakMemoryMB = usage.memoryMB;
    if (usage.cpuPercent > peakCpuPercent) peakCpuPercent = usage.cpuPercent;

    // Emit progress event for TUI updates
    emit({
      type: 'workers:progress',
      timestamp: new Date().toISOString(),
      completedCount: 0, // Will be updated by individual worker events
      runningCount: plan.groupings.length,
      totalCount: plan.groupings.length,
      progressPercent: 0,
      elapsedMs: Date.now() - startedAt.getTime(),
      memoryMB: usage.memoryMB,
      cpuPercent: usage.cpuPercent,
    });
  }, 1000);

  // Create and render TUI
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
  });
  const root = createRoot(renderer);

  // Track worker results and active processes for graceful cancellation
  let workerResults: WorkerResult[] = [];
  const activeProcesses: Map<string, ChildProcess> = new Map();
  let isCanceling = false;

  /**
   * Terminate all running worker processes gracefully.
   * Sends SIGTERM first, then SIGKILL after timeout.
   */
  const terminateAllWorkers = async (): Promise<void> => {
    const runningWorkers = [...activeProcesses.entries()];
    
    // Emit canceling event for each running worker
    for (const [workerId] of runningWorkers) {
      emit({
        type: 'worker:canceling',
        timestamp: new Date().toISOString(),
        workerId,
      });
    }
    
    // Send SIGTERM to all processes
    for (const [, proc] of runningWorkers) {
      if (!proc.killed) {
        proc.kill('SIGTERM');
      }
    }
    
    // Wait a bit for graceful shutdown
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Force kill any remaining processes
    for (const [, proc] of runningWorkers) {
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
    }
    
    activeProcesses.clear();
  };

  /**
   * Handle graceful cancellation.
   * Shows 'Canceling...' status, terminates workers, preserves partial outputs.
   */
  const handleQuit = async (): Promise<void> => {
    if (isCanceling) return; // Prevent double-cancellation
    isCanceling = true;
    
    // Emit workers:canceling event for TUI to show 'Canceling...' status
    const runningCount = activeProcesses.size;
    emit({
      type: 'workers:canceling',
      timestamp: new Date().toISOString(),
      runningCount,
      totalCount: plan.groupings.length,
    });
    
    // Terminate all running workers
    await terminateAllWorkers();
    
    // Cleanup
    clearInterval(monitoringInterval);
    renderer.destroy();
    
    // Throw custom error to signal cancellation (not failure)
    const cancelError = new Error('Analysis canceled by user');
    (cancelError as Error & { canceled: boolean }).canceled = true;
    throw cancelError;
  };

  // Render the TUI
  root.render(
    React.createElement(WorkerProgressApp, {
      initialWorkers,
      onSubscribe: subscribe,
      onQuit: handleQuit,
      onInterrupt: handleQuit,
    })
  );

  // Execute workers in parallel with event emission
  // Inner function to execute a single worker attempt (without retry)
  const executeSingleWorkerAttempt = async (group: FolderGrouping): Promise<WorkerResult> => {
    // Check if cancellation is in progress
    if (isCanceling) {
      return {
        groupName: group.name,
        folders: group.folders,
        success: false,
        durationMs: 0,
        stdout: '',
        stderr: '',
        error: 'Canceled before starting',
        canceled: true,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    const workerStartedAt = new Date();
    
    // Emit started event
    emit({
      type: 'worker:started',
      timestamp: workerStartedAt.toISOString(),
      workerId: group.name,
    });

    const prompt = buildWorkerPrompt(group, rootPath);
    
    return new Promise((resolve) => {
      const args = [
        '--silent',
        '--stream', 'off',
        '--allow-all-tools',
      ];
      
      const proc = spawn('copilot', args, {
        cwd: rootPath,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      });
      
      // Track this process for graceful cancellation
      activeProcesses.set(group.name, proc);
      
      let stdout = '';
      let stderr = '';
      let wasCanceledDuringExecution = false;
      
      proc.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        
        // Emit output event for TUI streaming display
        emit({
          type: 'worker:output',
          timestamp: new Date().toISOString(),
          workerId: group.name,
          data: chunk,
          stream: 'stdout',
        });
      });
      
      proc.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        
        // Emit output event for TUI streaming display
        emit({
          type: 'worker:output',
          timestamp: new Date().toISOString(),
          workerId: group.name,
          data: chunk,
          stream: 'stderr',
        });
      });
      
      // Write the prompt to stdin
      proc.stdin?.write(prompt);
      proc.stdin?.end();
      
      proc.on('error', (error) => {
        activeProcesses.delete(group.name);
        const completedAt = new Date();
        const result: WorkerResult = {
          groupName: group.name,
          folders: group.folders,
          success: false,
          durationMs: completedAt.getTime() - workerStartedAt.getTime(),
          stdout,
          stderr,
          error: `Failed to execute worker: ${error.message}`,
          startedAt: workerStartedAt.toISOString(),
          completedAt: completedAt.toISOString(),
        };
        
        resolve(result);
      });
      
      proc.on('close', (code, signal) => {
        activeProcesses.delete(group.name);
        const completedAt = new Date();
        
        // Check if worker was terminated due to cancellation
        wasCanceledDuringExecution = isCanceling || signal === 'SIGTERM' || signal === 'SIGKILL';
        
        const result: WorkerResult = {
          groupName: group.name,
          folders: group.folders,
          success: code === 0 && !wasCanceledDuringExecution,
          durationMs: completedAt.getTime() - workerStartedAt.getTime(),
          stdout,
          stderr,
          exitCode: code ?? undefined,
          error: wasCanceledDuringExecution 
            ? 'Worker canceled' 
            : (code !== 0 ? `Worker exited with code ${code}` : undefined),
          canceled: wasCanceledDuringExecution,
          startedAt: workerStartedAt.toISOString(),
          completedAt: completedAt.toISOString(),
        };
        
        resolve(result);
      });
      
      // Timeout after 120 seconds per worker
      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGKILL');
          }
        }, 5000);
      }, 120000);
      
      proc.on('close', () => {
        clearTimeout(timeoutId);
      });
    });
  };

  // Execute a worker with retry logic - US-006 implementation
  const executeWorkerWithEvents = async (group: FolderGrouping): Promise<WorkerResult> => {
    let lastResult: WorkerResult | null = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Apply delay for retry attempts (not first attempt)
      if (attempt > 0) {
        const delayMs = getRetryDelayMs(attempt - 1);
        
        // Emit retrying event for TUI - shows '↻ retry 2/3'
        emit({
          type: 'worker:retrying',
          timestamp: new Date().toISOString(),
          workerId: group.name,
          retryAttempt: attempt,
          maxRetries: maxRetries,
          delayMs: delayMs,
          previousError: lastResult?.error ?? 'Unknown error',
        });
        
        if (delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
      
      const result = await executeSingleWorkerAttempt(group);
      lastResult = result;
      
      if (result.success) {
        // Emit complete event
        emit({
          type: 'worker:complete',
          timestamp: new Date().toISOString(),
          workerId: group.name,
          durationMs: result.durationMs,
        });
        return result;
      }
      
      // If this was the last attempt, emit error and return
      if (attempt === maxRetries) {
        emit({
          type: 'worker:error',
          timestamp: new Date().toISOString(),
          workerId: group.name,
          error: result.error ?? 'Unknown error',
          durationMs: result.durationMs,
        });
        return result;
      }
    }
    
    // Should never reach here, but return last result for safety
    return lastResult!;
  };

  // Execute all workers in parallel
  try {
    const workerPromises = plan.groupings.map(group => executeWorkerWithEvents(group));
    workerResults = await Promise.all(workerPromises);
    
    const completedAt = new Date();
    const totalDurationMs = completedAt.getTime() - startedAt.getTime();
    
    // Stop monitoring
    clearInterval(monitoringInterval);
    
    // Calculate statistics
    const successCount = workerResults.filter(w => w.success).length;
    const failedCount = workerResults.filter(w => !w.success).length;
    const sequentialDurationMs = workerResults.reduce((sum, w) => sum + w.durationMs, 0);
    const speedupFactor = sequentialDurationMs > 0 ? sequentialDurationMs / totalDurationMs : 1;

    // Emit all-complete event
    emit({
      type: 'workers:all-complete',
      timestamp: completedAt.toISOString(),
      totalCount: plan.groupings.length,
      successCount,
      failedCount,
      totalDurationMs,
      sequentialDurationMs,
      speedupFactor,
    });

    // US-008: Build completion summary for TUI display
    const warnings: WorkerWarning[] = [];
    const workerStats: WorkerStatistics[] = [];
    
    // Count total folders and collect per-worker stats
    let totalFolders = 0;
    for (const result of workerResults) {
      totalFolders += result.folders.length;
      
      // Add warnings for failed workers
      if (!result.success) {
        warnings.push({
          workerId: result.groupName,
          workerName: result.groupName,
          type: 'failure',
          error: result.error,
        });
      }
      
      // Per-worker stats for verbose mode
      workerStats.push({
        id: result.groupName,
        name: result.groupName,
        folderCount: result.folders.length,
        fileCount: 0, // Could calculate if needed
        durationMs: result.durationMs,
        success: result.success,
        retryCount: 0, // TODO: track retries per worker
        error: result.error,
      });
    }

    // Get output file size if available
    let outputFileSizeBytes: number | undefined;
    if (outputFilePath) {
      try {
        const stats = fs.statSync(outputFilePath);
        outputFileSizeBytes = stats.size;
      } catch {
        // File may not exist yet
      }
    }

    const completionSummary: CompletionSummary = {
      totalElapsedMs: totalDurationMs,
      foldersAnalyzed: totalFolders,
      filesProcessed: 0, // Could be calculated from worker outputs
      workersSucceeded: successCount,
      workersFailed: failedCount,
      totalWorkers: plan.groupings.length,
      outputFilePath,
      outputFileSizeBytes,
      success: failedCount === 0,
      warnings,
      peakMemoryMB,
      peakCpuPercent,
      speedupFactor,
      workerStats: verbose ? workerStats : undefined,
    };

    // US-008: TUI remains visible until user presses key to exit
    // Create a promise that resolves when user dismisses the completion screen
    const completionDismissed = new Promise<void>((resolve) => {
      // Re-render TUI with completion summary
      root.render(
        React.createElement(WorkerProgressApp, {
          initialWorkers,
          onSubscribe: subscribe,
          onQuit: handleQuit,
          onInterrupt: handleQuit,
          completionSummary,
          onCompletionDismiss: () => resolve(),
        })
      );
    });

    // Wait for user to press key to dismiss completion screen
    await completionDismissed;
    renderer.destroy();

    return {
      workerCount: plan.groupings.length,
      successCount,
      failedCount,
      totalDurationMs,
      sequentialDurationMs,
      speedupFactor,
      workers: workerResults,
      resourceSnapshots,
      peakMemoryMB,
      peakCpuPercent,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    };
  } catch (error) {
    clearInterval(monitoringInterval);
    renderer.destroy();
    throw error;
  }
}

/**
 * Print dry-run result showing the planned split without executing workers.
 * Saves to file if --output is specified.
 */
function printDryRunResult(result: LearnResult, args: LearnArgs): void {
  // Build the dry-run output object for JSON/file output
  const dryRunOutput = {
    dryRun: true,
    strategy: result.strategy || args.strategy,
    path: result.rootPath,
    totalFiles: result.totalFiles,
    totalDirectories: result.totalDirectories,
    projectTypes: result.projectTypes,
    plan: result.masterAgentPlan,
  };

  // Save to file if --output is specified (AC6: Plan can be saved to file with --dry-run --output plan.json)
  if (args.output) {
    const jsonContent = JSON.stringify(dryRunOutput, null, 2);
    fs.writeFileSync(args.output, jsonContent, 'utf-8');
    console.log(`\n✓ Dry-run plan saved to: ${args.output}\n`);
    return;
  }

  // JSON output mode for dry-run (to stdout)
  if (args.json) {
    console.log(JSON.stringify(dryRunOutput, null, 2));
    return;
  }

  // Human-readable dry-run output
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    DRY RUN - Split Plan Preview                ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Project:    ${result.rootPath}`);
  console.log(`  Strategy:   ${result.strategy || args.strategy}`);
  console.log(`  Files:      ${result.totalFiles.toLocaleString()}`);
  console.log(`  Directories: ${result.totalDirectories.toLocaleString()}`);
  console.log('');

  if (result.masterAgentPlan) {
    console.log('───────────────────────────────────────────────────────────────');
    console.log('  📋 Folder Groupings (from master agent)');
    console.log('───────────────────────────────────────────────────────────────');
    console.log('');

    if (result.masterAgentPlan.summary) {
      console.log(`  Summary: ${result.masterAgentPlan.summary}`);
      console.log('');
    }

    const sortedGroups = [...result.masterAgentPlan.groupings].sort((a, b) => a.priority - b.priority);
    
    for (const group of sortedGroups) {
      const folderCount = group.folders.length;
      console.log(`  [Priority ${group.priority}] ${group.name}`);
      console.log(`    Folders (${folderCount}):`);
      for (const folder of group.folders) {
        console.log(`      • ${folder}`);
      }
      console.log('');
    }

    if (result.masterAgentPlan.analysisOrder && result.masterAgentPlan.analysisOrder.length > 0) {
      console.log('  Suggested Analysis Order:');
      console.log(`    ${result.masterAgentPlan.analysisOrder.join(' → ')}`);
      console.log('');
    }

    console.log('───────────────────────────────────────────────────────────────');
    console.log(`  Total Groups: ${sortedGroups.length}`);
    console.log(`  Total Folders: ${sortedGroups.reduce((sum, g) => sum + g.folders.length, 0)}`);
  } else {
    console.log('  ⚠️  No folder groupings generated.');
    console.log('');
    if (!args.agent) {
      console.log('  Tip: Use --agent to enable master agent analysis for intelligent groupings.');
    } else {
      console.log('  The master agent analysis may have failed. Check verbose output for details.');
    }
  }

  console.log('');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('  This was a dry run. No workers were spawned.');
  console.log('  Remove --dry-run to execute the full analysis.');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('');
}

/**
 * Print human-readable analysis results
 */
function printHumanResult(result: LearnResult, verbose: boolean): void {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    Project Analysis Complete                   ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  console.log(`  Path:             ${result.rootPath}`);
  console.log(`  Project Type:     ${result.projectTypes.join(', ')}`);
  console.log(`  Depth:            ${result.depthLevel}`);
  if (result.strategy) {
    console.log(`  Strategy:         ${result.strategy}`);
  }
  console.log(`  Files:            ${result.totalFiles.toLocaleString()}${result.truncated ? ' (truncated)' : ''}`);
  console.log(`  Directories:      ${result.totalDirectories.toLocaleString()}`);
  console.log(`  Duration:         ${result.durationMs}ms`);
  console.log('');

  // File breakdown
  if (Object.keys(result.filesByType).length > 0) {
    console.log('  File Types:');
    const sortedTypes = Object.entries(result.filesByType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    for (const [type, count] of sortedTypes) {
      console.log(`    ${type.padEnd(14)} ${count.toLocaleString()}`);
    }
    console.log('');
  }

  // Conventions (standard and deep)
  if (result.conventions.length > 0) {
    console.log('  Conventions:');
    for (const convention of result.conventions) {
      console.log(`    • ${convention}`);
    }
    console.log('');
  }

  // Code patterns (deep only)
  if (result.codePatterns && result.codePatterns.length > 0) {
    console.log('  Code Patterns Detected:');
    for (const pattern of result.codePatterns.slice(0, 8)) {
      const confidence = Math.round(pattern.confidence * 100);
      console.log(`    • ${pattern.name} (${confidence}% confidence)`);
      console.log(`      ${pattern.description}`);
    }
    if (result.codePatterns.length > 8) {
      console.log(`    ... and ${result.codePatterns.length - 8} more patterns`);
    }
    console.log('');
  }

  // AGENTS.md files
  if (result.agentFiles.length > 0) {
    console.log('  AGENTS.md Files:');
    for (const agentFile of result.agentFiles.slice(0, 10)) {
      console.log(`    • ${agentFile || '(root)'}`);
    }
    if (result.agentFiles.length > 10) {
      console.log(`    ... and ${result.agentFiles.length - 10} more`);
    }
    console.log('');
  }

  // Structure
  if (verbose && result.structure.length > 0) {
    console.log('  Structure:');
    for (const item of result.structure) {
      console.log(`    ${item}`);
    }
    console.log('');
  }

  // Exclusion information (verbose mode)
  if (verbose && result.exclusionStats) {
    const stats = result.exclusionStats;
    const config = result.exclusionConfig;
    
    console.log('  Path Exclusions:');
    console.log(`    Total excluded:      ${stats.totalExcluded.toLocaleString()}`);
    if (stats.excludedByDefault > 0) {
      console.log(`    By default rules:    ${stats.excludedByDefault.toLocaleString()}`);
    }
    if (stats.excludedByGitignore > 0) {
      console.log(`    By .gitignore:       ${stats.excludedByGitignore.toLocaleString()}`);
    }
    if (stats.excludedByRalphignore > 0) {
      console.log(`    By .ralphignore:     ${stats.excludedByRalphignore.toLocaleString()}`);
    }
    if (stats.excludedAsBinary > 0) {
      console.log(`    Binary files:        ${stats.excludedAsBinary.toLocaleString()}`);
    }
    if (stats.reincluded > 0) {
      console.log(`    Re-included:         ${stats.reincluded.toLocaleString()}`);
    }
    console.log('');

    if (config) {
      console.log('  Exclusion Sources:');
      console.log(`    .gitignore:          ${config.respectsGitignore ? 'found (' + config.gitignorePatterns.length + ' patterns)' : 'not found'}`);
      console.log(`    .ralphignore:        ${config.hasRalphignore ? 'found (' + config.ralphignorePatterns.length + ' patterns)' : 'not found'}`);
      if (config.includePatterns.length > 0) {
        console.log(`    --include patterns:  ${config.includePatterns.length}`);
      }
      console.log('');
    }

    // Show sample excluded paths
    if (stats.sampleExcludedPaths.length > 0) {
      console.log('  Sample Excluded Paths:');
      for (const excludedPath of stats.sampleExcludedPaths.slice(0, 15)) {
        console.log(`    • ${excludedPath}`);
      }
      if (stats.sampleExcludedPaths.length > 15) {
        console.log(`    ... and ${stats.sampleExcludedPaths.length - 15} more`);
      }
      console.log('');
    }
  }

  // Warnings summary (skipped/failed files)
  if (result.warnings && result.warnings.length > 0) {
    console.log('  ⚠️  Warnings:');
    if (result.skippedFiles && result.skippedFiles > 0) {
      console.log(`    Inaccessible directories: ${result.skippedFiles}`);
    }
    if (result.failedFiles && result.failedFiles > 0) {
      console.log(`    Failed to read/parse:     ${result.failedFiles}`);
    }
    
    // Show individual warnings in verbose mode
    if (verbose) {
      console.log('');
      console.log('  Warning Details:');
      for (const warning of result.warnings.slice(0, 20)) {
        console.log(`    • [${warning.type}] ${warning.filePath}`);
        console.log(`      ${warning.reason}`);
      }
      if (result.warnings.length > 20) {
        console.log(`    ... and ${result.warnings.length - 20} more warnings`);
      }
    }
    console.log('');
  }

  // Master Agent Plan (when --agent is used)
  if (result.masterAgentPlan) {
    console.log('  🤖 Master Agent Analysis:');
    if (result.masterAgentPlan.summary) {
      console.log(`    Summary: ${result.masterAgentPlan.summary}`);
    }
    console.log('');
    console.log('  Folder Groupings:');
    const sortedGroups = [...result.masterAgentPlan.groupings].sort((a, b) => a.priority - b.priority);
    for (const group of sortedGroups) {
      console.log(`    [Priority ${group.priority}] ${group.name}`);
      for (const folder of group.folders.slice(0, 5)) {
        console.log(`      • ${folder}`);
      }
      if (group.folders.length > 5) {
        console.log(`      ... and ${group.folders.length - 5} more folders`);
      }
    }
    console.log('');
    if (result.masterAgentPlan.analysisOrder && result.masterAgentPlan.analysisOrder.length > 0) {
      console.log('  Suggested Analysis Order:');
      console.log(`    ${result.masterAgentPlan.analysisOrder.slice(0, 10).join(' → ')}`);
      if (result.masterAgentPlan.analysisOrder.length > 10) {
        console.log(`    ... and ${result.masterAgentPlan.analysisOrder.length - 10} more`);
      }
      console.log('');
    }
  }

  // Worker execution results (already printed by printWorkerResults, but summarize here too)
  if (result.workerResults) {
    const wr = result.workerResults;
    console.log('  🔄 Parallel Workers: See detailed results above');
    console.log(`    Speedup: ${wr.speedupFactor.toFixed(2)}x faster than sequential`);
    console.log('');
  }

  console.log('───────────────────────────────────────────────────────────────');
  console.log('  Analysis complete. AI agents can now better understand');
  console.log('  this codebase structure and conventions.');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('');
}

/**
 * Execute the learn command
 */
export async function executeLearnCommand(args: string[]): Promise<void> {
  const parsedArgs = parseLearnArgs(args);
  // Use custom output path or default to ralph-context.md in analyzed directory
  const contextFilePath = parsedArgs.output || path.join(parsedArgs.path, 'ralph-context.md');

  // Create progress reporter (quiet for JSON mode or if --quiet flag)
  const progressReporter = new ProgressReporter(parsedArgs.quiet || parsedArgs.json);

  try {
    if (!parsedArgs.json && !parsedArgs.quiet) {
      console.log(`Analyzing project at: ${parsedArgs.path}`);
      console.log(`Depth level: ${parsedArgs.depth}`);
      if (parsedArgs.agent || parsedArgs.strategy !== 'auto') {
        console.log(`Strategy: ${parsedArgs.strategy}`);
      }
      if (parsedArgs.agent) {
        console.log(`Master agent: enabled (using copilot -p)`);
      }
      if (parsedArgs.dryRun) {
        console.log(`Mode: dry-run (preview only, no workers spawned)`);
      }
      if (parsedArgs.include.length > 0) {
        console.log(`Include patterns: ${parsedArgs.include.join(', ')}`);
      }
      console.log('');
    }

    // Start progress reporting
    progressReporter.start();
    progressReporter.setPhase('Initializing...');

    const result = await analyzeProject(
      parsedArgs.path, 
      parsedArgs.depth, 
      progressReporter,
      parsedArgs.include,
      parsedArgs.verbose,
      parsedArgs.agent,
      parsedArgs.quiet || parsedArgs.json,
      parsedArgs.strategy
    );

    // Stop progress reporter and set generating phase
    progressReporter.setPhase('Generating context file...');
    progressReporter.stop();

    // Handle dry-run mode - show plan without writing context file
    if (parsedArgs.dryRun) {
      printDryRunResult(result, parsedArgs);
      process.exit(0);
    }

    // Execute parallel workers if master agent produced a plan
    // AC1: All workers spawn immediately after master agent completes
    // AC4: Worker count matches the number of folder groups from master plan
    if (parsedArgs.agent && result.masterAgentPlan && result.masterAgentPlan.groupings.length > 0) {
      if (!parsedArgs.quiet && !parsedArgs.json) {
        console.log(`\n🚀 Master agent complete. Spawning ${result.masterAgentPlan.groupings.length} workers in parallel...`);
      }
      
      try {
        const workerSummary = await executeWorkersInParallel(
          result.masterAgentPlan,
          parsedArgs.path,
          parsedArgs.quiet || parsedArgs.json,
          parsedArgs.verbose,
          parsedArgs.maxRetries
        );
        
        // Attach worker results to the result object
        result.workerResults = workerSummary;
        
        // Print worker results (unless JSON or quiet mode)
        if (!parsedArgs.json && !parsedArgs.quiet) {
          printWorkerResults(workerSummary, parsedArgs.verbose);
        }
        
        // US-007 AC1: Merge phase begins automatically when all workers complete
        // US-007 AC3: Merge uses copilot -p to intelligently combine outputs
        // US-007 AC6, AC7: --output flag specifies custom output, default is ralph-context.md
        const hasSuccessfulWorkers = workerSummary.successCount > 0;
        if (hasSuccessfulWorkers) {
          const mergeResult = await mergeWorkerOutputs(
            workerSummary,
            parsedArgs.path,
            contextFilePath,
            parsedArgs.quiet || parsedArgs.json,
            parsedArgs.verbose
          );
          
          // US-007 AC2: TUI shows merge phase progress (handled in mergeWorkerOutputs)
          // US-007 AC8: Partial outputs preserved as backup in case merge fails
          if (!parsedArgs.json && !parsedArgs.quiet) {
            printMergeResults(mergeResult, parsedArgs.verbose);
          }
          
          if (mergeResult.success) {
            // Merge succeeded - show final output info and exit
            printHumanResult(result, parsedArgs.verbose);
            
            const stats = fs.statSync(contextFilePath);
            console.log('═══════════════════════════════════════════════════════════════');
            console.log('                      Context File Generated                    ');
            console.log('═══════════════════════════════════════════════════════════════');
            console.log('');
            console.log(`  📄 File:    ${contextFilePath}`);
            console.log(`  📏 Size:    ${(stats.size / 1024).toFixed(2)} KB`);
            console.log('');
            console.log('  This file was created by merging parallel worker analyses.');
            console.log('  AI agents can now understand this project structure.');
            console.log('───────────────────────────────────────────────────────────────');
            console.log('');
            
            // Exit with warnings check if --strict
            if (parsedArgs.strict && result.warnings && result.warnings.length > 0) {
              console.log('⚠️  Exiting with error code 2 due to --strict flag and warnings.');
              process.exit(2);
            }
            process.exit(0);
          } else {
            // Merge failed - fall back to regular context generation
            if (!parsedArgs.quiet && !parsedArgs.json) {
              console.log('⚠️  Merge failed, falling back to standard context generation.');
              if (mergeResult.backupPath) {
                console.log(`   Partial outputs saved to: ${mergeResult.backupPath}`);
              }
            }
          }
        }
      } catch (workerError) {
        // US-009: Check if this was a user cancellation
        const isCancellation = workerError instanceof Error && 
          ((workerError as Error & { canceled?: boolean }).canceled === true ||
           workerError.message.includes('canceled'));
        
        if (isCancellation) {
          // US-009 AC6: Exit message indicates analysis was canceled, not failed
          if (!parsedArgs.quiet && !parsedArgs.json) {
            console.log('\n⏹️  Analysis canceled by user.');
            console.log('   All running workers have been terminated.');
          }
          // US-009 AC4: Partial outputs are preserved - exit cleanly
          process.exit(0);
        }
        
        if (!parsedArgs.quiet && !parsedArgs.json) {
          console.error(`\n⚠️  Worker execution failed: ${workerError instanceof Error ? workerError.message : String(workerError)}`);
        }
        // Continue even if workers fail - we still have the master plan
      }
    }

    // Generate and write context file (unless JSON output mode)
    // This is the fallback path when merge is not used or fails
    if (!parsedArgs.json) {
      // Create parent directories if they don't exist
      const parentDir = path.dirname(contextFilePath);
      if (!fs.existsSync(parentDir)) {
        try {
          fs.mkdirSync(parentDir, { recursive: true });
        } catch (mkdirError) {
          throw new Error(`Cannot create parent directories for ${contextFilePath}: ${mkdirError instanceof Error ? mkdirError.message : String(mkdirError)}`);
        }
      }

      // Check if path is writable by attempting to access parent directory
      try {
        fs.accessSync(parentDir, fs.constants.W_OK);
      } catch {
        throw new Error(`Path is not writable: ${contextFilePath}`);
      }

      // Check if file exists and handle overwrite
      if (fs.existsSync(contextFilePath)) {
        if (!parsedArgs.force) {
          const shouldOverwrite = await promptConfirmation(
            `File ${contextFilePath} already exists. Overwrite?`
          );
          if (!shouldOverwrite) {
            console.log('Operation cancelled. Use --force to overwrite without confirmation.');
            printHumanResult(result, parsedArgs.verbose);
            process.exit(0);
          }
        }
      }

      // Generate and write the context file
      const contextContent = generateContextMarkdown(result);
      try {
        fs.writeFileSync(contextFilePath, contextContent, 'utf-8');
      } catch (writeError) {
        throw new Error(`Cannot write to ${contextFilePath}: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
      }
      
      printHumanResult(result, parsedArgs.verbose);
      
      // Show file info (final summary with path and size)
      const stats = fs.statSync(contextFilePath);
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('                      Context File Generated                    ');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('');
      console.log(`  📄 File:    ${contextFilePath}`);
      console.log(`  📏 Size:    ${(stats.size / 1024).toFixed(2)} KB`);
      console.log('');
      console.log('  This file can be used by AI agents to understand your project.');
      console.log('───────────────────────────────────────────────────────────────');
      console.log('');
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

    // Exit with error code 2 if --strict is set and there are warnings
    if (parsedArgs.strict && result.warnings && result.warnings.length > 0) {
      if (!parsedArgs.json) {
        console.log('⚠️  Exiting with error code 2 due to --strict flag and warnings.');
      }
      process.exit(2);
    }

    process.exit(0);
  } catch (error) {
    // Stop progress reporter on error
    progressReporter.stop();
    if (parsedArgs.json) {
      console.log(JSON.stringify({
        error: true,
        message: error instanceof Error ? error.message : String(error),
      }));
    } else {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  }
}
