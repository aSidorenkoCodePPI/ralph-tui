# Ralph TUI

[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-f9f1e1.svg)](https://bun.sh)
[![npm version](https://img.shields.io/npm/v/@asidorenkocodeppi/ralph-tui.svg)](https://www.npmjs.com/package/@asidorenkocodeppi/ralph-tui)

**AI Agent Loop Orchestrator** - A terminal UI for orchestrating AI coding agents to work through task lists autonomously.

Ralph TUI connects your AI coding assistant (GitHub Copilot CLI, OpenCode) to your task tracker and runs them in an autonomous loop, completing tasks one-by-one with intelligent selection, error handling, and full visibility.

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

### Step 2: Install Ralph TUI

```powershell
# Install the package
npm install -g @asidorenkocodeppi/ralph-tui

# IMPORTANT: Also install with bun to create the CLI symlink
bun install -g @asidorenkocodeppi/ralph-tui
```

> **Note:** The `bun install -g` step is required to create the `ralph-tui` command in your PATH.

### Step 3: Install GitHub Copilot CLI (Default Agent)

```powershell
# Windows
npm install -g @github/copilot

# Authenticate
gh auth login
```

### Verify Installation

```powershell
ralph-tui --help
```

If you get "command not found", try:
```powershell
# Option 1: Run directly with bunx
bunx @asidorenkocodeppi/ralph-tui --help

# Option 2: Add bun's bin to PATH (add to your shell profile)
export PATH="$HOME/.bun/bin:$PATH"
```

## Quick Start

```powershell
<<<<<<< HEAD
=======
# Install from npm (recommended)
npm install -g @asidorenkocodeppi/ralph-tui

>>>>>>> a38e19b9b10ec283578d9d0ba32773dd35f471f4
# Setup your project
cd your-project
ralph-tui setup

# Create a PRD with AI assistance
ralph-tui create-prd

# Or create a PRD from a Jira issue
ralph-tui create-prd --jira

# Or create a PRD from a Jira ticket
ralph-tui create-prd --jira

# Run Ralph!
ralph-tui run --prd ./tasks/prd.json
```

That's it! Ralph will work through your tasks autonomously.

## Jira Integration

Ralph TUI integrates with Jira to convert your tickets into actionable PRDs with user stories.

### Fetching Jira Issues

```bash
# List your assigned Jira issues
ralph-tui jira-prd
```

This uses GitHub Copilot CLI's MCP (Model Context Protocol) to fetch issues assigned to you from Jira.

### Creating PRDs from Jira Tickets

```bash
# Interactive: select a Jira ticket and generate a PRD
ralph-tui create-prd --jira
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
1. Ralph selects the highest-priority incomplete task
2. Builds a prompt with task details + context
3. Executes your AI agent (Copilot CLI)
4. Detects completion via `<promise>COMPLETE</promise>` token
5. Marks task done, moves to next

Repeat until all tasks are complete.

## Features

- **Jira Integration**: Convert Jira tickets to PRDs with AI-generated user stories
- **AI Agents**: GitHub Copilot CLI (default), OpenCode
- **Task Trackers**: prd.json (simple), Beads (git-backed with dependencies)
- **Jira Integration**: Create PRDs from Jira issues with `--jira` flag
- **Session Persistence**: Pause anytime, resume later, survive crashes
- **Real-time TUI**: Watch agent output, control execution with keyboard shortcuts
- **Cross-iteration Context**: Automatic progress tracking between tasks
- **Cross-platform**: Works on Windows, macOS, and Linux

## CLI Commands

| Command | Description |
|---------|-------------|
| `ralph-tui` | Launch the interactive TUI |
| `ralph-tui run [options]` | Start Ralph execution |
| `ralph-tui resume` | Resume an interrupted session |
| `ralph-tui status` | Check session status |
| `ralph-tui logs` | View iteration output logs |
| `ralph-tui setup` | Run interactive project setup |
| `ralph-tui create-prd` | Create a new PRD interactively |
<<<<<<< HEAD
| `ralph-tui create-prd --jira` | Create a PRD from a Jira issue |
| `ralph-tui jira-prd` | List Jira issues assigned to you |
=======
| `ralph-tui create-prd --jira` | Create PRD from Jira ticket |
| `ralph-tui jira-prd` | List assigned Jira issues |
>>>>>>> a38e19b9b10ec283578d9d0ba32773dd35f471f4
| `ralph-tui config show` | Display merged configuration |
| `ralph-tui plugins agents` | List available agent plugins |

### Common Options

```bash
# Run with a PRD file (uses Copilot CLI by default)
ralph-tui run --prd ./prd.json

# Run headless (no TUI)
ralph-tui run --prd ./prd.json --headless

# Override agent
ralph-tui run --prd ./prd.json --agent opencode

# Override model (Copilot supports: claude-sonnet-4, gpt-5, etc.)
ralph-tui run --prd ./prd.json --model claude-sonnet-4

# Limit iterations
ralph-tui run --iterations 5
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

<<<<<<< HEAD
=======
## Prerequisites

- [Bun](https://bun.sh) - JavaScript runtime (REQUIRED)
- [GitHub Copilot CLI](https://githubnext.com/projects/copilot-cli) - Default AI agent

### Installing Bun (Required)

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

### Installing GitHub Copilot CLI

```powershell
# Install
npm install -g @githubnext/github-copilot-cli

# Authenticate
gh auth login
```

### Jira MCP Setup (for Jira integration)

The Jira integration uses GitHub Copilot CLI's MCP feature. Ensure your Copilot CLI is configured with Jira MCP access.

>>>>>>> a38e19b9b10ec283578d9d0ba32773dd35f471f4
## Development

### Setup

```bash
git clone https://github.com/aSidorenkoCodePPI/ralph-tui.git
cd ralph-tui
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
ralph-tui/
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

- Original [Ralph Wiggum loop concept](https://ghuntley.com/ralph/) by Geoffrey Huntley
- Forked from [subsy/ralph-tui](https://github.com/subsy/ralph-tui)

## License

MIT License
