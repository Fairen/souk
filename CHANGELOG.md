# Changelog

## Unreleased

### Changed
- **Renamed to `agpo`** (**AG**ent **P**lugin **O**rchestrator; single bin `agpo`). The previous name `souk` was rejected by the npm registry for being too similar to existing packages (`soap`, `socks`, `slug`, …). No behavior change — only the package name and CLI command.

## 0.5.0

### Added
- **`agpo build [--target <list>] [--check]`** — generates tier-2 agent artifacts from the Claude catalog (the single source of truth):
  - **Codex** — `.agents/plugins/marketplace.json` (object sources `{ source: "local", path }` + `policy` + `category`, top-level `name`) and per-plugin `plugins/<name>/.codex-plugin/plugin.json`. Format verified against the official OpenAI docs (developers.openai.com/codex/plugins/build).
  - **Cursor** — `.cursor-plugin/marketplace.json` (string sources, Claude-shaped) and per-plugin `plugins/<name>/.cursor-plugin/plugin.json`.
  - Per-plugin manifests are verbatim copies of the Claude manifest (no extra keys — those targets are strict).
  - `--check` verifies the generated files are up to date and exits non-zero on drift (CI). Default targets are the tier-2 entries in `metadata.targets`; `--target` overrides.
- **Freshness kept automatically**: `sync` (and therefore `add` and `bump`, which call it) refresh any tier-2 registry that already exists, so a built target never drifts as plugins change. Generation is opt-in (run `agpo build` once); after that it stays fresh.
- Generated CI (GitHub Actions / GitLab CI) now runs `agpo build --check` after `agpo validate`.

### Notes
- Tier-2 targets are **in-place marketplaces** (Codex, Cursor): they reuse the shared `plugins/` content via a committed registry, so agpo generates declarative registries + manifest mirrors — not transformed content trees. Tier-3 agents (Gemini/Antigravity, OpenCode, Kiro), which need per-plugin content transforms, remain out of scope.

## 0.4.0

### Added
- **`agpo init --agents <list>`** — choose the target coding agents at init time (interactive multiselect, or comma-separated flag). Adapters are tiered by structural cost:
  - **Tier 1 (native)** — Claude Code, GitHub Copilot: fully wired. The `.claude-plugin/marketplace.json` is consumed as-is; init emits the right team-settings path per agent (`.claude/settings.json`, `.github/copilot/settings.json`) and a per-agent install section.
  - **Tier 2 (light registry)** — Codex, Cursor: recorded in `metadata.targets`, documented, but artifact generation deferred to a planned `agpo build`.
  - **Tier 3 (transform)** — Gemini/Antigravity, OpenCode, Kiro: recorded and documented; heavy per-plugin transforms are out of scope for init (that is aipm/build territory).
- **`AgentAdapter` architecture** (`src/lib/agents.ts`): a single seam that composes README install sections, team-setup sections, and the target list. Adding an agent is one entry.
- **`metadata.targets`** written to the catalog, recording the intended agents.
- **Root `AGENTS.md`** emitted at init — read natively by most agents (Claude Code, Codex, Cursor, Gemini, Copilot, OpenCode, …) for repo context.
- `agpo validate` notes (info, non-failing) when `metadata.targets` includes tier 2/3 agents that need generation.

### Notes
- agpo still does **not** generate per-target artifacts (Tier 2/3). It records intent and documents the install path; a dedicated `agpo build --target <agent>` is the planned home for generation, because those registries must be kept fresh by every lifecycle command — a build concern, not an init one.
- Gemini CLI is being retired (2026-06-18) for personal accounts in favour of Antigravity CLI; the Gemini adapter carries that caveat.

## 0.3.0

### Changed
- **Renamed to `agpo`** (single bin `agpo`). Repositioned as a lifecycle manager for plugin marketplaces targeting **both Claude Code and GitHub Copilot** — both agents read the `.claude-plugin/marketplace.json` format natively (Copilot CLI and Copilot in VS Code look for `marketplace.json` under `.claude-plugin/`), so one repo installs on both with no generation step.
- `init` now scaffolds a README with install instructions for **both** agents (`/plugin marketplace add …` for Claude Code, `copilot plugin marketplace add …` for Copilot CLI) and documents the two team-settings paths (`.claude/settings.json` and `.github/copilot/settings.json`, same `extraKnownMarketplaces` block).
- Added a **Scope** section making explicit that agpo does not generate per-target artifacts for non-native agents (Cursor, Codex, Gemini, OpenCode, Kiro); that remains a build/transform concern for tools like `aipm`.

## 0.2.0

### Added
- **`hook` template**: `hooks/hooks.json` in the officially documented format (outer `"hooks"` wrapper), with an executable `scripts/<name>.sh` (exec bit preserved) reading the event JSON on stdin and using exit code 2 to block with feedback.
- **`mcp` template**: `.mcp.json` plus a zero-dependency Node stdio MCP server (`servers/<name>.mjs`) implementing initialize / tools/list / tools/call — works out of the box, migrate to `@modelcontextprotocol/sdk` when it grows.
- **Remote and local templates** in `agpo add`, forge-agnostic:
  - `gh:owner/repo[/subdir][#ref]` and `gl:owner/repo[/subdir][#ref]` shorthands
  - any git URL (`https`, `ssh`, `scp-style`, `file`) with `//subdir` and `#ref`
  - local directories (`./dir`, `/abs/dir`, `path:dir`)
  Templates are materialized via `git clone --depth 1`; `.tpl` files are rendered with `{{pluginName}}`, `{{pluginTitle}}`, `{{description}}`, `{{authorName}}`; a plain `plugin.json` is adopted with its `name` forced to the chosen plugin name.
- **`agpo bump [plugin] [level]`**: semver bump driven by conventional commits scoped to the plugin directory since its last `<plugin>@x.y.z` release tag (`feat` → minor, `BREAKING CHANGE`/`!` → major, otherwise patch). Supports explicit `major|minor|patch`, `--dry-run`, and `--tag` (commit + release tag). Always propagates to `marketplace.json` and the README table via sync.
- **`agpo validate --strict`**: passes `--strict` to the official `claude plugin validate` to treat warnings as errors in CI.

### Fixed
- Executable permissions are now preserved when copying/rendering template files.

## 0.1.0

Initial release: `init` (git-first, multi-forge, CI GitHub/GitLab, team `extraKnownMarketplaces` snippet), `add` (skill/command/agent), `sync`, `validate`, `list`.
