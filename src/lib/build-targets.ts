import path from "node:path";
import { DEFAULT_PLUGIN_ROOT } from "./constants.js";
import type { LocalPlugin, Marketplace } from "./marketplace.js";

export interface GeneratedFile {
  /** Path relative to the marketplace root. */
  relPath: string;
  content: string;
}

export interface BuildContext {
  mp: Marketplace;
  plugins: LocalPlugin[];
}

/** pluginRoot as a leading-"./"-free posix segment, e.g. "plugins". */
function pluginRootRel(mp: Marketplace): string {
  const raw = mp.metadata?.pluginRoot ?? DEFAULT_PLUGIN_ROOT;
  return raw.replace(/^\.\//, "").replace(/\/+$/, "");
}

function sourcePath(mp: Marketplace, dirName: string): string {
  return `./${path.posix.join(pluginRootRel(mp), dirName)}`;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

/** Verbatim re-serialization of a plugin's Claude manifest (strict targets: no extra keys). */
function manifestCopy(local: LocalPlugin): string {
  return json(local.manifest);
}

/**
 * Cursor target. In-place marketplace like Claude: a repo-root registry with
 * string sources (same shape as .claude-plugin/marketplace.json) plus a
 * per-plugin .cursor-plugin/plugin.json mirror.
 * @see https://github.com/ai-plugin-marketplace/template
 */
export function generateCursor(ctx: BuildContext): GeneratedFile[] {
  const { mp, plugins } = ctx;
  const registry = {
    name: mp.name,
    owner: mp.owner,
    ...(mp.metadata
      ? {
          metadata: {
            ...(mp.metadata.description ? { description: mp.metadata.description } : {}),
            ...(mp.metadata.version ? { version: mp.metadata.version } : {}),
          },
        }
      : {}),
    plugins: plugins.map((p) => ({
      name: p.manifest.name || p.dirName,
      source: sourcePath(mp, p.dirName),
    })),
  };
  const files: GeneratedFile[] = [
    { relPath: path.posix.join(".cursor-plugin", "marketplace.json"), content: json(registry) },
  ];
  for (const p of plugins) {
    files.push({
      relPath: path.posix.join(pluginRootRel(mp), p.dirName, ".cursor-plugin", "plugin.json"),
      content: manifestCopy(p),
    });
  }
  return files;
}

/**
 * Codex CLI target. Repo-root registry at .agents/plugins/marketplace.json with
 * object sources ({ source: "local", path }) plus policy/category, and a
 * per-plugin .codex-plugin/plugin.json mirror (required by Codex).
 * @see https://developers.openai.com/codex/plugins/build
 */
export function generateCodex(ctx: BuildContext): GeneratedFile[] {
  const { mp, plugins } = ctx;
  const registry = {
    name: mp.name,
    plugins: plugins.map((p) => ({
      name: p.manifest.name || p.dirName,
      source: { source: "local", path: sourcePath(mp, p.dirName) },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Productivity",
    })),
  };
  const files: GeneratedFile[] = [
    {
      relPath: path.posix.join(".agents", "plugins", "marketplace.json"),
      content: json(registry),
    },
  ];
  for (const p of plugins) {
    files.push({
      relPath: path.posix.join(pluginRootRel(mp), p.dirName, ".codex-plugin", "plugin.json"),
      content: manifestCopy(p),
    });
  }
  return files;
}

export type Tier2Generator = (ctx: BuildContext) => GeneratedFile[];

/** Tier-2 targets agpo can generate. Keyed by agent id. */
export const TIER2_GENERATORS: Record<string, Tier2Generator> = {
  cursor: generateCursor,
  codex: generateCodex,
};

/** Repo-root registry file for each tier-2 target (used to detect prior builds). */
export const TIER2_ROOT_REGISTRY: Record<string, string> = {
  cursor: path.posix.join(".cursor-plugin", "marketplace.json"),
  codex: path.posix.join(".agents", "plugins", "marketplace.json"),
};

export function isTier2Buildable(id: string): boolean {
  return id in TIER2_GENERATORS;
}
