import fs from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import { refreshBuiltTargets } from "./build.js";
import {
  findMarketplaceRoot,
  readMarketplace,
  resolveLocalPluginDir,
  scanLocalPlugins,
  writeMarketplace,
} from "../lib/marketplace.js";

export interface SyncOptions {
  quiet?: boolean;
}

const README_START = "<!-- agpo:plugins:start -->";
const README_END = "<!-- agpo:plugins:end -->";

/**
 * Reconcile marketplace.json with the plugins on disk.
 * Source of truth: each plugin's .claude-plugin/plugin.json.
 * - Adds catalog entries for plugin directories not yet listed
 * - Updates version/description/author drifted from the manifest
 * - Warns about catalog entries whose local source no longer exists
 *   (remote sources — github/url/git-subdir/npm — are left untouched)
 * - Regenerates the plugin table in README.md between agpo markers
 */
export async function syncCommand(
  startDir: string,
  opts: SyncOptions = {},
): Promise<void> {
  const root = findMarketplaceRoot(startDir);
  if (!root) {
    p.log.error("No .claude-plugin/marketplace.json found. Run `agpo init` first.");
    process.exitCode = 1;
    return;
  }

  const mp = readMarketplace(root);
  const locals = scanLocalPlugins(root, mp);
  const changes: string[] = [];

  for (const local of locals) {
    const manifest = local.manifest;
    const entryName = manifest.name || local.dirName;
    let entry = mp.plugins.find((e) => e.name === entryName);

    if (!entry) {
      entry = {
        name: entryName,
        source: mp.metadata?.pluginRoot
          ? local.dirName
          : `./${path.relative(root, local.dir).split(path.sep).join("/")}`,
      };
      mp.plugins.push(entry);
      changes.push(`+ added "${entryName}" to the catalog`);
    }

    for (const field of ["version", "description", "author", "keywords", "homepage"] as const) {
      const value = manifest[field];
      if (value !== undefined && JSON.stringify(entry[field]) !== JSON.stringify(value)) {
        entry[field] = value as never;
        changes.push(`~ updated ${field} of "${entryName}"`);
      }
    }
  }

  // Orphan detection for local sources only.
  for (const entry of mp.plugins) {
    const dir = resolveLocalPluginDir(root, mp, entry);
    if (dir && !fs.existsSync(dir)) {
      changes.push(
        `! "${entry.name}" points to missing directory ${path.relative(root, dir)} — remove the entry or restore the plugin`,
      );
    }
  }

  mp.plugins.sort((a, b) => a.name.localeCompare(b.name));
  writeMarketplace(root, mp);

  // Keep already-built tier-2 registries (codex/cursor) fresh.
  const refreshed = refreshBuiltTargets(root, mp);
  for (const id of refreshed) changes.push(`~ refreshed ${id} tier-2 artifacts`);

  // README plugin list between markers.
  const readmePath = path.join(root, "README.md");
  if (fs.existsSync(readmePath)) {
    const readme = fs.readFileSync(readmePath, "utf8");
    const start = readme.indexOf(README_START);
    const end = readme.indexOf(README_END);
    if (start !== -1 && end !== -1 && end > start) {
      const table =
        mp.plugins.length === 0
          ? "_No plugins yet. Add one with `agpo add <template> <name>`._"
          : [
              "| Plugin | Version | Description |",
              "| :----- | :------ | :---------- |",
              ...mp.plugins.map(
                (e) =>
                  `| \`${e.name}\` | ${e.version ?? "—"} | ${e.description ?? ""} |`,
              ),
            ].join("\n");
      const updated =
        readme.slice(0, start + README_START.length) +
        "\n" +
        table +
        "\n" +
        readme.slice(end);
      if (updated !== readme) {
        fs.writeFileSync(readmePath, updated);
        changes.push("~ refreshed plugin list in README.md");
      }
    }
  }

  if (!opts.quiet) {
    if (changes.length === 0) {
      p.log.success("Catalog already in sync.");
    } else {
      p.log.success(`Sync complete:\n  ${changes.join("\n  ")}`);
      if (changes.some((c) => c.startsWith("!"))) process.exitCode = 1;
    }
  }
}
