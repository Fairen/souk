import type { RemoteInfo } from "./git.js";

/**
 * A coding-agent target. Adapters are tiered by how much structure they need:
 *
 *  - Tier 1 (native): reads `.claude-plugin/marketplace.json` as-is. Only config
 *    and docs differ. No generated artifacts. → Claude Code, GitHub Copilot.
 *  - Tier 2 (light registry): needs an extra committed registry that points at
 *    the shared `plugins/`. Content reused. → Codex, Cursor.
 *  - Tier 3 (transform): needs per-plugin transformed file trees. → Gemini/
 *    Antigravity, OpenCode, Kiro.
 *
 * `agpo init` fully wires Tier 1. For Tier 2/3 it records the target in
 * `metadata.targets` and emits docs, but defers artifact GENERATION to a
 * dedicated build step, because those registries must be kept fresh by every
 * lifecycle command (add/sync/bump) — an ongoing build concern, not an init one.
 */
export type AgentTier = 1 | 2 | 3;

export interface InstallHint {
  /** Shell/session commands a consumer runs to add + install from this agent. */
  lines: string[];
  /** Extra caveat shown under the commands, if any. */
  note?: string;
}

export interface TeamSettings {
  /** Where the extraKnownMarketplaces block goes for this agent. */
  path: string;
}

export interface AgentAdapter {
  id: string;
  label: string;
  tier: AgentTier;
  /** How a consumer installs a plugin from a marketplace on this agent. */
  install(marketplaceArg: string, marketplaceName: string): InstallHint;
  /** Team auto-install settings file, when the agent supports it. */
  teamSettings?: TeamSettings;
}

const claudeCode: AgentAdapter = {
  id: "claude-code",
  label: "Claude Code",
  tier: 1,
  install: (arg, name) => ({
    lines: [`/plugin marketplace add ${arg}`, `/plugin install <plugin-name>@${name}`],
  }),
  teamSettings: { path: ".claude/settings.json" },
};

const copilot: AgentAdapter = {
  id: "copilot",
  label: "GitHub Copilot CLI",
  tier: 1,
  install: (arg, name) => ({
    lines: [
      `copilot plugin marketplace add ${arg}`,
      `copilot plugin install <plugin-name>@${name}`,
    ],
    note: "Copilot CLI and Copilot in VS Code read marketplace.json under .claude-plugin/ natively.",
  }),
  teamSettings: { path: ".github/copilot/settings.json" },
};

const codex: AgentAdapter = {
  id: "codex",
  label: "OpenAI Codex CLI",
  tier: 2,
  install: (arg) => ({
    lines: [`codex marketplace add ${arg}`],
    note: "Requires a Codex registry (.agents/plugins/marketplace.json). Generate it with `agpo build --target codex` (planned); the Claude catalog alone is not read by Codex.",
  }),
};

const cursor: AgentAdapter = {
  id: "cursor",
  label: "Cursor",
  tier: 2,
  install: () => ({
    lines: ["# add the marketplace in Cursor, then: /plugin install <plugin-name>"],
    note: "Requires a committed Cursor registry (.cursor-plugin/). Generate it with `agpo build --target cursor` (planned).",
  }),
};

const gemini: AgentAdapter = {
  id: "gemini",
  label: "Gemini CLI",
  tier: 3,
  install: () => ({
    lines: ["gemini extensions install ."],
    note: "Needs a transformed tree (gemini-extension.json + GEMINI.md) via `agpo build --target gemini` (planned). Note: Gemini CLI is being retired (2026-06-18) in favour of Antigravity CLI (`agy`).",
  }),
};

const opencode: AgentAdapter = {
  id: "opencode",
  label: "OpenCode",
  tier: 3,
  install: () => ({
    lines: ["# clone the repo, then generate the OpenCode tree (.opencode/)"],
    note: "Needs a transformed tree via `agpo build --target opencode` (planned). OpenCode reads AGENTS.md natively for context.",
  }),
};

const kiro: AgentAdapter = {
  id: "kiro",
  label: "Kiro",
  tier: 3,
  install: () => ({
    lines: ["# install the generated root artifact (POWER.md, .kiro/)"],
    note: "Needs a transformed tree via `agpo build --target kiro` (planned).",
  }),
};

export const AGENT_ADAPTERS: AgentAdapter[] = [
  claudeCode,
  copilot,
  codex,
  cursor,
  gemini,
  opencode,
  kiro,
];

export const DEFAULT_AGENTS = ["claude-code", "copilot"];

export function getAdapter(id: string): AgentAdapter | undefined {
  return AGENT_ADAPTERS.find((a) => a.id === id);
}

export function parseAgentList(raw: string): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (getAdapter(part)) {
      if (!ids.includes(part)) ids.push(part);
    } else {
      unknown.push(part);
    }
  }
  return { ids, unknown };
}

/** Compose the README "Install" section body from the selected agents. */
export function renderInstallSections(
  agentIds: string[],
  marketplaceArg: string,
  marketplaceName: string,
): string {
  const blocks: string[] = [];
  for (const id of agentIds) {
    const a = getAdapter(id);
    if (!a) continue;
    const hint = a.install(marketplaceArg, marketplaceName);
    const tierTag = a.tier === 1 ? "" : ` _(tier ${a.tier} — requires generation)_`;
    blocks.push(
      `**${a.label}**${tierTag}\n\n\`\`\`\n${hint.lines.join("\n")}\n\`\`\`` +
        (hint.note ? `\n\n> ${hint.note}` : ""),
    );
  }
  return blocks.join("\n\n");
}

/** Compose the README team-setup section for agents that support it. */
export function renderTeamSections(agentIds: string[], teamSourceBlock: string, marketplaceName: string): string {
  const supported = agentIds
    .map(getAdapter)
    .filter((a): a is AgentAdapter => Boolean(a?.teamSettings));
  if (supported.length === 0) return "";
  const paths = supported
    .map((a) => `- **${a.label}** — \`${a.teamSettings!.path}\``)
    .join("\n");
  return (
    `Register the marketplace so teammates get it automatically when they trust the repository.\n\n` +
    `${paths}\n\n` +
    `Each accepts the same \`extraKnownMarketplaces\` block:\n\n` +
    "```json\n" +
    `{\n  "extraKnownMarketplaces": {\n    "${marketplaceName}": {\n      "source": ${teamSourceBlock}\n    }\n  }\n}\n` +
    "```"
  );
}

/** The AGENTS.md root file, read natively by most agents for context. */
export function renderAgentsMd(marketplaceName: string, description: string, agentIds: string[]): string {
  const labels = agentIds.map((id) => getAdapter(id)?.label ?? id).join(", ");
  return `# ${marketplaceName}

${description}

This repository is a plugin marketplace managed with [agpo](https://www.npmjs.com/package/agpo).
The catalog lives in \`.claude-plugin/marketplace.json\`; each plugin lives under \`plugins/<name>/\`.

Target agents: ${labels}.

## For agents working in this repo

- Plugins are self-contained under \`plugins/<name>/\` with a \`.claude-plugin/plugin.json\` manifest and \`skills/\`, \`commands/\`, \`agents/\`, \`hooks/\` as needed.
- After changing a plugin, run \`agpo sync\` to reconcile the catalog and \`agpo validate\` before committing.
- Version a plugin with \`agpo bump <plugin>\` (conventional-commit aware).
`;
}
