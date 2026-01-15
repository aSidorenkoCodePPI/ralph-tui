# Ralph TUI

[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-f9f1e1.svg)](https://bun.sh)

**AI Agent Loop Orchestrator** - A terminal UI for orchestrating AI coding agents to work through task lists autonomously.

Ralph TUI connects your AI coding assistant (GitHub Copilot CLI, Claude Code, OpenCode) to your task tracker and runs them in an autonomous loop, completing tasks one-by-one with intelligent selection, error handling, and full visibility.

## Quick Start

```powershell
# Install from GitHub release (recommended)
npm install -g https://github.com/aSidorenkoCodePPI/ralph-tui/releases/download/v0.1.6/ralph-tui-0.1.6.tgz

# Setup your project
cd your-project
ralph-tui setup

# Create a PRD with AI assistance
ralph-tui create-prd --chat

# Run Ralph!
ralph-tui run --prd ./prd.json
```

That's it! Ralph will work through your tasks autonomously.

## Supported AI Agents

| Agent | Description | Default |
|-------|-------------|---------|
| `copilot` | GitHub Copilot CLI | Yes |
| `claude` | Claude Code CLI | No |
| `opencode` | OpenCode CLI | No |

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
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
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Ralph selects the highest-priority task, builds a prompt, executes your AI agent, detects completion, and repeats until all tasks are done.

## Features

- **AI Agents**: GitHub Copilot CLI (default), Claude Code, OpenCode
- **Task Trackers**: prd.json (simple), Beads (git-backed with dependencies)
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
| `ralph-tui config show` | Display merged configuration |
| `ralph-tui plugins agents` | List available agent plugins |

### Common Options

```bash
# Run with a PRD file (uses Copilot CLI by default)
ralph-tui run --prd ./prd.json

# Run headless (no TUI)
ralph-tui run --prd ./prd.json --headless

# Override agent
ralph-tui run --prd ./prd.json --agent claude

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

## Prerequisites

- [Bun](https://bun.sh) - JavaScript runtime
- [GitHub Copilot CLI](https://githubnext.com/projects/copilot-cli) - Default AI agent

### Installing GitHub Copilot CLI

```powershell
# Windows
npm install -g @github/copilot

# Authenticate
gh auth login
```

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
│   ├── config/           # Configuration (Zod schemas)
│   ├── engine/           # Execution engine
│   ├── plugins/
│   │   ├── agents/       # Agent plugins (copilot, claude, opencode)
│   │   └── trackers/     # Tracker plugins (json, beads)
│   ├── session/          # Session persistence
│   └── tui/              # Terminal UI components
└── dist/                 # Built output
```

## Credits

- Original [Ralph Wiggum loop concept](https://ghuntley.com/ralph/) by Geoffrey Huntley
- Forked from [subsy/ralph-tui](https://github.com/subsy/ralph-tui)

## License

MIT License
