# Loopwright

[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-f9f1e1.svg)](https://bun.sh)
[![npm version](https://img.shields.io/npm/v/@asidorenkocode/loopwright.svg)](https://www.npmjs.com/package/@asidorenkocode/loopwright)

**AI Agent Loop Orchestrator** - A terminal UI for orchestrating AI coding agents to work through task lists autonomously.

Loopwright connects your AI coding assistant (GitHub Copilot CLI, OpenCode) to your task tracker and runs them in an autonomous loop, completing tasks one-by-one with intelligent selection, error handling, and full visibility.

## Installation

### Prerequisites

- [Bun](https://bun.sh) - JavaScript runtime (REQUIRED)
- [GitHub Copilot CLI](https://githubnext.com/projects/copilot-cli) - Default AI agent

### Step 1: Install Bun

```powershell
# Windows - Option 1: via npm
npm install -g bun

# Windows - Option 2: via PowerShell
powershell -c "irm bun.sh/install.ps1 | iex"

# macOS/Linux
curl -fsSL https://bun.sh/install | bash
```

After installation, verify Bun is available:
```powershell
bun --version
```

### Step 2: Install Loopwright

```powershell
# Install the package
npm install -g @asidorenkocode/loopwright

# IMPORTANT: Also install with bun to create the CLI symlink
bun install -g @asidorenkocode/loopwright
```

> **Note:** The `bun install -g` step is required to create the `loopwright` command in your PATH.

### Step 3: Install GitHub Copilot CLI (Default Agent)

See: https://github.com/github/copilot-cli

### Verify Installation

```powershell
loopwright --help
```

If you get "command not found", try:
```powershell
# Option 1: Run directly with bunx
bunx @asidorenkocode/loopwright --help

# Option 2: Add bun's bin to PATH (add to your shell profile)
export PATH="$HOME/.bun/bin:$PATH"
```

## Quick Start

```powershell
# Setup your project
cd your-project
loopwright setup

# Create a PRD with AI assistance
loopwright create-prd

# Or create a PRD from a Jira issue
loopwright create-prd --jira

# Run Loopwright!
loopwright run --prd ./tasks/prd.json
```

That's it! Loopwright will work through your tasks autonomously.

## Jira Integration

Loopwright integrates with Jira to convert your tickets into actionable PRDs with user stories.

### Fetching Jira Issues

```bash
# List your assigned Jira issues
loopwright jira-prd
```

This uses GitHub Copilot CLI's MCP (Model Context Protocol) to fetch issues assigned to you from Jira.

### Creating PRDs from Jira Tickets

```bash
# Interactive: select a Jira ticket and generate a PRD
loopwright create-prd --jira
```

**How it works:**
1. Fetches your assigned Jira issues via Copilot CLI MCP
2. Presents an interactive selector to choose a ticket
3. Opens an AI chat session with the ticket context
4. AI transforms the Jira ticket into a structured PRD with:
   - User stories (US-001, US-002, etc.)
   - Acceptance criteria as checklists
   - Technical requirements extracted from the ticket

**Example transformation:**

Jira ticket:
```
TPH-123: Add dark mode support
Acceptance Criteria:
- User can toggle dark mode
- Settings persist across sessions
```

Generated PRD:
```markdown
### US-001: Dark Mode Toggle
- [ ] Add toggle switch in settings page
- [ ] Toggle changes theme immediately

### US-002: Persist Dark Mode Setting
- [ ] Save preference to localStorage
- [ ] Load preference on app startup
```

### Jira MCP Setup

The Jira integration uses GitHub Copilot CLI's MCP feature. Ensure your Copilot CLI is configured with Jira MCP access.

## Supported AI Agents

| Agent | Description | Default |
|-------|-------------|---------|
| `copilot` | GitHub Copilot CLI | Yes |
| `opencode` | OpenCode CLI | No |

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        PLANNING PHASE                           │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│   │    JIRA      │────▶│   AI CHAT    │────▶│   PRD.JSON   │   │
│   │   TICKET     │     │   SESSION    │     │  USER STORIES │   │
│   └──────────────┘     └──────────────┘     └──────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       EXECUTION PHASE                           │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│   │  1. SELECT   │────▶│  2. BUILD    │────▶│  3. EXECUTE  │   │
│   │    TASK      │     │    PROMPT    │     │    AGENT     │   │
│   └──────────────┘     └──────────────┘     └──────────────┘   │
│          ▲                                         │            │
│          │                                         ▼            │
│   ┌──────────────┐                         ┌──────────────┐    │
│   │  5. NEXT     │◀────────────────────────│  4. DETECT   │    │
│   │    TASK      │                         │  COMPLETION  │    │
│   └──────────────┘                         └──────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

**Planning Phase:**
1. Fetch a Jira ticket (or create manually)
2. AI chat transforms it into user stories with acceptance criteria
3. Save as `prd.json` - your task list

**Execution Phase:**
1. Loopwright selects the highest-priority incomplete task
2. Builds a prompt with task details + context
3. Executes your AI agent (Copilot CLI)
4. Detects completion via `<promise>COMPLETE</promise>` token
5. Marks task done, moves to next

Repeat until all tasks are complete.

## Features

- **Jira Integration**: Convert Jira tickets to PRDs with AI-generated user stories
- **AI Agents**: GitHub Copilot CLI (default), OpenCode
- **Task Trackers**: prd.json (simple), Beads (git-backed with dependencies)
- **Session Persistence**: Pause anytime, resume later, survive crashes
- **Real-time TUI**: Watch agent output, control execution with keyboard shortcuts
- **Cross-iteration Context**: Automatic progress tracking between tasks
- **Cross-platform**: Works on Windows, macOS, and Linux

## Project Analysis

Loopwright can analyze your project structure to help AI agents understand the codebase. The `learn` command scans your project, detects patterns, and generates a context file (`loopwright-context.md`) that agents can use for better code understanding.

### Basic Usage

```bash
# Analyze current directory
loopwright learn

# Analyze a specific path
loopwright learn ./my-project

# Custom output file
loopwright learn --output ./docs/context.md
```

### Analysis Depth

```bash
# Quick structural scan
loopwright learn --depth shallow

# Standard analysis (default)
loopwright learn --depth standard

# Deep analysis with code patterns
loopwright learn --depth deep
```

### AI-Powered Analysis

Use the `--agent` flag to enable intelligent folder grouping via GitHub Copilot:

```bash
# Let AI analyze and group related code
loopwright learn --agent

# Preview the analysis plan without executing
loopwright learn --agent --dry-run

# Choose a specific splitting strategy
loopwright learn --agent --strategy domain
```

**Splitting Strategies:**

| Strategy | Description |
|----------|-------------|
| `auto` | Let the AI choose the best strategy (default) |
| `top-level` | Split by top-level directories |
| `domain` | Group by code dependencies/imports |
| `balanced` | Distribute files evenly across workers |

### What Gets Analyzed

- **Project structure**: Directory tree and organization
- **Project types**: Detected frameworks and languages (TypeScript, React, etc.)
- **Conventions**: Coding patterns and standards
- **Dependencies**: Package relationships
- **Architectural patterns**: Design patterns in use

### Path Exclusions

The following are excluded by default:
- Build directories: `node_modules/`, `dist/`, `build/`, `.next/`
- Binary files: images, videos, archives, compiled files
- Patterns from `.gitignore` and `.loopwrightignore`

Override exclusions with `--include`:
```bash
loopwright learn --include "dist/**" --include "*.min.js"
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `loopwright` | Launch the interactive TUI |
| `loopwright run [options]` | Start Loopwright execution |
| `loopwright resume` | Resume an interrupted session |
| `loopwright status` | Check session status |
| `loopwright logs` | View iteration output logs |
| `loopwright setup` | Run interactive project setup |
| `loopwright learn` | Analyze project for AI agents |
| `loopwright create-prd` | Create a new PRD interactively |
| `loopwright create-prd --jira` | Create PRD from Jira ticket |
| `loopwright jira-prd` | List assigned Jira issues |
| `loopwright config show` | Display merged configuration |
| `loopwright plugins agents` | List available agent plugins |

### Common Options

```bash
# Run with a PRD file (uses Copilot CLI by default)
loopwright run --prd ./prd.json

# Run headless (no TUI)
loopwright run --prd ./prd.json --headless

# Override agent
loopwright run --prd ./prd.json --agent opencode

# Override model (Copilot supports: claude-sonnet-4, gpt-5, etc.)
loopwright run --prd ./prd.json --model claude-sonnet-4

# Limit iterations
loopwright run --iterations 5
```

### TUI Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `s` | Start execution |
| `p` | Pause/Resume |
| `d` | Toggle dashboard |
| `i` | Toggle iteration history |
| `q` | Quit |
| `?` | Show help |

## Development

### Setup

```bash
git clone https://github.com/aSidorenkoCodePPI/loopwright.git
cd loopwright
bun install
```

### Build & Test

```bash
bun run build       # Build the project
bun run typecheck   # Type check
bun run lint        # Run linter
bun run dev         # Run from source
```

### Project Structure

```
loopwright/
├── src/
│   ├── cli.tsx           # CLI entry point
│   ├── commands/         # CLI commands
│   │   ├── jira-prd.ts   # Jira integration
│   │   └── create-prd.ts # PRD creation with --jira flag
│   ├── chat/             # AI chat engine for PRD generation
│   ├── config/           # Configuration (Zod schemas)
│   ├── engine/           # Execution engine
│   ├── plugins/
│   │   ├── agents/       # Agent plugins (copilot, opencode)
│   │   └── trackers/     # Tracker plugins (json, beads)
│   ├── prd/              # PRD parsing and Jira mapping
│   ├── session/          # Session persistence
│   └── tui/              # Terminal UI components
└── dist/                 # Built output
```

## Credits

- Forked from [subsy/ralph-tui](https://github.com/subsy/ralph-tui)

## License

MIT License
