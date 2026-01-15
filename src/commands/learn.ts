/**
 * ABOUTME: Learn command for ralph-tui.
 * Analyzes a project directory so AI agents understand the codebase structure and conventions.
 * Scans file structure, detects project type, and extracts patterns.
 * Supports path exclusion via .gitignore, .ralphignore, and binary file detection.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

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
  --include <pattern> Include paths matching pattern (overrides exclusions)
                      Can be specified multiple times
  --json              Output in JSON format (machine-readable)
  --verbose, -v       Show detailed analysis output (includes excluded paths)
  --force, -f         Overwrite existing file without confirmation
  --quiet, -q         Suppress progress output
  --strict            Exit with error on any warning (inaccessible/failed files)
  -h, --help          Show this help message

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
 * Analyze a project directory
 */
export async function analyzeProject(
  rootPath: string, 
  depth: DepthLevel = 'standard',
  progressReporter?: ProgressReporter,
  includePatterns: string[] = [],
  verbose: boolean = false
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

  const truncated = scanResult.files >= maxFiles;
  const durationMs = Date.now() - startTime;

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
    codePatterns,
    exclusionConfig: exclusionManager.getConfig(),
    exclusionStats: exclusionManager.getStats(),
  };
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
      parsedArgs.verbose
    );

    // Stop progress reporter and set generating phase
    progressReporter.setPhase('Generating context file...');
    progressReporter.stop();

    // Generate and write context file (unless JSON output mode)
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
      
      // Show file info (final summary with path and size - AC5)
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
