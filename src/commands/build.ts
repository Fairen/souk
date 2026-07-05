import fs from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  findMarketplaceRoot,
  readMarketplace,
  scanLocalPlugins,
  type Marketplace,
} from "../lib/marketplace.js";
import {
  TIER2_GENERATORS,
  TIER2_ROOT_REGISTRY,
  isTier2Buildable,
  type BuildContext,
  type GeneratedFile,
} from "../lib/build-targets.js";

export interface BuildOptions {
  targets?: string;
  check?: boolean;
  quiet?: boolean;
}

function resolveTargets(mp: Marketplace, requested: string | undefined): {
  ids: string[];
  unknown: string[];
} {
  if (requested) {
    const ids: string[] = [];
    const unknown: string[] = [];
    for (const t of requested.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (isTier2Buildable(t)) ids.push(t);
      else unknown.push(t);
    }
    return { ids, unknown };
  }
  // Default: the tier-2 targets recorded in metadata.targets.
  const ids = (mp.metadata?.targets ?? []).filter(isTier2Buildable);
  return { ids, unknown: [] };
}

function computeFiles(root: string, mp: Marketplace, ids: string[]): GeneratedFile[] {
  const ctx: BuildContext = { mp, plugins: scanLocalPlugins(root, mp) };
  const files: GeneratedFile[] = [];
  for (const id of ids) {
    const gen = TIER2_GENERATORS[id];
    if (gen) files.push(...gen(ctx));
  }
  return files;
}

export async function buildCommand(startDir: string, opts: BuildOptions = {}): Promise<void> {
  const root = findMarketplaceRoot(startDir);
  if (!root) {
    p.log.error("No .claude-plugin/marketplace.json found. Run `agpo init` first.");
    process.exitCode = 1;
    return;
  }
  const mp = readMarketplace(root);
  const { ids, unknown } = resolveTargets(mp, opts.targets);

  if (unknown.length > 0) {
    p.log.warn(
      `Not tier-2 buildable (ignored): ${unknown.join(", ")}. Buildable: ${Object.keys(TIER2_GENERATORS).join(", ")}.`,
    );
  }
  if (ids.length === 0) {
    if (!opts.quiet) {
      p.log.info(
        "No tier-2 targets to build. Add one with `agpo init --agents …` (codex, cursor) or pass `--target codex,cursor`.",
      );
    }
    return;
  }

  const files = computeFiles(root, mp, ids);

  if (opts.check) {
    const drift: string[] = [];
    for (const f of files) {
      const abs = path.join(root, f.relPath);
      let actual: string | undefined;
      try {
        actual = fs.readFileSync(abs, "utf8");
      } catch {
        actual = undefined;
      }
      if (actual === undefined) drift.push(`missing: ${f.relPath}`);
      else if (actual !== f.content) drift.push(`stale:   ${f.relPath}`);
    }
    if (drift.length > 0) {
      p.log.error(
        `Tier-2 artifacts out of date (${ids.join(", ")}):\n  ${drift.join("\n  ")}\n` +
          "Run `agpo build` to regenerate.",
      );
      process.exitCode = 1;
    } else if (!opts.quiet) {
      p.log.success(`Tier-2 artifacts up to date (${ids.join(", ")}).`);
    }
    return;
  }

  // Write.
  for (const f of files) {
    const abs = path.join(root, f.relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content);
  }
  if (!opts.quiet) {
    const registries = ids
      .map((id) => TIER2_ROOT_REGISTRY[id])
      .filter(Boolean)
      .join(", ");
    p.log.success(
      `Built ${files.length} file(s) for ${pc.cyan(ids.join(", "))}.\n` +
        `Registries: ${registries}\n` +
        "Commit the generated files so consumers can install from these agents.",
    );
  }
}

/**
 * Refresh only the tier-2 targets whose root registry already exists on disk.
 * Called by `sync` so that, once a user has opted into a target via `agpo build`,
 * the generated registries never drift as plugins are added or bumped.
 */
export function refreshBuiltTargets(root: string, mp: Marketplace): string[] {
  const built = (mp.metadata?.targets ?? [])
    .filter(isTier2Buildable)
    .filter((id) => fs.existsSync(path.join(root, TIER2_ROOT_REGISTRY[id]!)));
  if (built.length === 0) return [];
  const files = computeFiles(root, mp, built);
  for (const f of files) {
    const abs = path.join(root, f.relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content);
  }
  return built;
}
