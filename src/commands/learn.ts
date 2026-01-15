/**
 * ABOUTME: Learn command for ralph-tui.
 * Analyzes a project directory so AI agents understand the codebase structure and conventions.
 * Scans file structure, detects project type, and extracts patterns.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

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
  --json              Output in JSON format (machine-readable)
  --verbose, -v       Show detailed analysis output
  --force, -f         Overwrite existing ralph-context.md without confirmation
  -h, --help          Show this help message

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
  If the file exists, prompts for confirmation unless --force is used.

Exit Codes:
  0    Analysis completed successfully
  1    Analysis failed (invalid path, permission error, etc.)

Examples:
  ralph-tui learn                    # Analyze current directory
  ralph-tui learn ./my-project       # Analyze specific directory
  ralph-tui learn --json             # JSON output for scripts
  ralph-tui learn -v                 # Verbose output
  ralph-tui learn --force            # Overwrite without confirmation
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
 * Detect architectural patterns from project structure
 */
function detectArchitecturalPatterns(rootPath: string, files: string[], topLevelDirs: string[]): string[] {
  const patterns: string[] = [];

  // MVC pattern
  const mvcDirs = ['models', 'views', 'controllers', 'model', 'view', 'controller'];
  if (mvcDirs.some(d => topLevelDirs.includes(d))) {
    patterns.push('MVC (Model-View-Controller)');
  }

  // Clean Architecture / Hexagonal
  const cleanArchDirs = ['domain', 'application', 'infrastructure', 'adapters', 'ports'];
  if (cleanArchDirs.filter(d => topLevelDirs.includes(d)).length >= 2) {
    patterns.push('Clean Architecture / Hexagonal');
  }

  // Component-based (React, Vue, etc.)
  if (topLevelDirs.includes('components') || topLevelDirs.includes('ui')) {
    patterns.push('Component-based architecture');
  }

  // Monorepo patterns
  if (topLevelDirs.includes('packages') || topLevelDirs.includes('apps') || topLevelDirs.includes('libs')) {
    patterns.push('Monorepo structure');
  }

  // Feature-based / Module-based
  if (topLevelDirs.includes('features') || topLevelDirs.includes('modules')) {
    patterns.push('Feature-based / Modular architecture');
  }

  // API patterns
  if (topLevelDirs.includes('api') || topLevelDirs.includes('routes') || topLevelDirs.includes('endpoints')) {
    patterns.push('API-centric design');
  }

  // Layered architecture
  const layeredDirs = ['services', 'repositories', 'entities'];
  if (layeredDirs.filter(d => topLevelDirs.includes(d)).length >= 2) {
    patterns.push('Layered architecture');
  }

  // Plugin/Extension architecture
  if (topLevelDirs.includes('plugins') || topLevelDirs.includes('extensions') || topLevelDirs.includes('addons')) {
    patterns.push('Plugin/Extension architecture');
  }

  // Check for configuration files suggesting patterns
  if (files.includes('nx.json')) {
    patterns.push('Nx workspace (Monorepo)');
  }
  if (files.includes('lerna.json')) {
    patterns.push('Lerna monorepo');
  }
  if (files.includes('turbo.json')) {
    patterns.push('Turborepo');
  }
  if (files.includes('pnpm-workspace.yaml')) {
    patterns.push('PNPM workspace');
  }

  // Check for serverless patterns
  if (files.includes('serverless.yml') || files.includes('serverless.yaml') || files.includes('serverless.ts')) {
    patterns.push('Serverless architecture');
  }

  // Microservices indicators
  if (files.includes('docker-compose.yml') || files.includes('docker-compose.yaml')) {
    const composePath = path.join(rootPath, files.find(f => f.startsWith('docker-compose')) || '');
    try {
      const content = fs.readFileSync(composePath, 'utf-8');
      if ((content.match(/services:/g) || []).length > 0 && content.split('image:').length > 2) {
        patterns.push('Microservices architecture');
      }
    } catch {
      // Skip
    }
  }

  return patterns;
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
  lines.push('');

  // Project Overview
  lines.push('## Project Overview');
  lines.push('');
  lines.push(`- **Name**: ${projectName}`);
  lines.push(`- **Path**: ${result.rootPath}`);
  lines.push(`- **Type**: ${result.projectTypes.join(', ')}`);
  lines.push(`- **Total Files**: ${result.totalFiles.toLocaleString()}${result.truncated ? ' (truncated at 10,000)' : ''}`);
  lines.push(`- **Total Directories**: ${result.totalDirectories.toLocaleString()}`);
  lines.push('');

  // Languages and Frameworks
  lines.push('## Languages and Frameworks');
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
  },
  relativePath: string = ''
): Promise<boolean> {
  // Check if we've hit the file limit
  if (result.files >= maxFiles) {
    return true; // truncated
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    // Permission denied or other error - skip this directory
    return false;
  }

  for (const entry of entries) {
    if (result.files >= maxFiles) {
      return true; // truncated
    }

    if (entry.isDirectory()) {
      if (!shouldIgnoreDir(entry.name)) {
        result.directories++;
        const truncated = await scanDirectory(
          path.join(dirPath, entry.name),
          maxFiles,
          result,
          path.join(relativePath, entry.name)
        );
        if (truncated) {
          return true;
        }
      }
    } else if (entry.isFile()) {
      result.files++;

      // Track file type
      const fileType = detectFileType(entry.name);
      if (fileType) {
        result.filesByType[fileType] = (result.filesByType[fileType] || 0) + 1;
      }

      // Track AGENTS.md files
      if (entry.name === 'AGENTS.md') {
        result.agentFiles.push(path.join(relativePath, entry.name));
      }
    }
  }

  return false;
}

/**
 * Analyze a project directory
 */
export async function analyzeProject(rootPath: string): Promise<LearnResult> {
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

  // Get top-level contents
  const topLevelEntries = fs.readdirSync(rootPath, { withFileTypes: true });
  const topLevelFiles = topLevelEntries.filter(e => e.isFile()).map(e => e.name);
  const topLevelDirs = topLevelEntries.filter(e => e.isDirectory() && !shouldIgnoreDir(e.name)).map(e => e.name);

  // Detect project types
  const projectTypes = detectProjectTypes(rootPath, topLevelFiles);

  // Detect conventions
  const conventions = detectConventions(rootPath, topLevelFiles);

  // Parse dependencies from manifest files
  const dependencies = parseDependencies(rootPath, topLevelFiles);

  // Detect architectural patterns
  const architecturalPatterns = detectArchitecturalPatterns(rootPath, topLevelFiles, topLevelDirs);

  // Build directory tree
  const directoryTree = buildDirectoryTree(rootPath);

  // Scan all files
  const scanResult = {
    files: 0,
    directories: 0,
    filesByType: {} as Record<string, number>,
    agentFiles: [] as string[],
  };

  const truncated = await scanDirectory(rootPath, maxFiles, scanResult);

  // Build structure overview
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

  // Conventions
  if (result.conventions.length > 0) {
    console.log('  Conventions:');
    for (const convention of result.conventions) {
      console.log(`    • ${convention}`);
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
  const contextFilePath = path.join(parsedArgs.path, 'ralph-context.md');

  try {
    if (!parsedArgs.json) {
      console.log(`Analyzing project at: ${parsedArgs.path}`);
      console.log('');
    }

    const result = await analyzeProject(parsedArgs.path);

    // Generate and write context file (unless JSON output mode)
    if (!parsedArgs.json) {
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
      fs.writeFileSync(contextFilePath, contextContent, 'utf-8');
      
      printHumanResult(result, parsedArgs.verbose);
      
      // Show file info
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
