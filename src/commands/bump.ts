import { execFileSync } from "node:child_process";
import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { MARKETPLACE_DIR, PLUGIN_MANIFEST_FILE } from "../lib/constants.js";
import { readJson, writeJson } from "../lib/fsutils.js";
import {
  findMarketplaceRoot,
  readMarketplace,
  scanLocalPlugins,
  type PluginManifest,
} from "../lib/marketplace.js";
import { syncCommand } from "./sync.js";

export type BumpLevel = "major" | "minor" | "patch";

export interface BumpOptions {
  tag?: boolean;
  dryRun?: boolean;
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  })
    .toString()
    .trim();
}

function incrementSemver(version: string, level: BumpLevel): string {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`"${version}" is not a semver version`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Latest release tag for this plugin (`<name>@x.y.z`), if any. */
function lastReleaseTag(root: string, plugin: string): string | undefined {
  try {
    const tags = git(root, [
      "tag",
      "--list",
      `${plugin}@*`,
      "--sort=-v:refname",
    ]);
    return tags.split("\n").filter(Boolean)[0];
  } catch {
    return undefined;
  }
}

interface CommitAnalysis {
  level: BumpLevel | undefined;
  commits: number;
  reasons: string[];
}

/**
 * Conventional-commit analysis of history touching the plugin directory,
 * since its last release tag (or the whole history when untagged):
 *   BREAKING CHANGE / `type!:`  -> major
 *   feat                        -> minor
 *   anything else (fix, perf…)  -> patch
 */
function analyzeCommits(root: string, pluginDir: string, since?: string): CommitAnalysis {
  const range = since ? [`${since}..HEAD`] : [];
  let raw = "";
  try {
    raw = git(root, [
      "log",
      ...range,
      "--format=%H%x1f%s%x1f%b%x1e",
      "--",
      path.relative(root, pluginDir) || ".",
    ]);
  } catch {
    return { level: undefined, commits: 0, reasons: ["not a git repository"] };
  }
  const commits = raw.split("\x1e").map((c) => c.trim()).filter(Boolean);
  if (commits.length === 0) return { level: undefined, commits: 0, reasons: [] };

  let level: BumpLevel = "patch";
  const reasons: string[] = [];
  for (const c of commits) {
    const [, subject = "", body = ""] = c.split("\x1f");
    const breaking =
      /^[a-z]+(\([^)]*\))?!:/.test(subject) || /BREAKING[ -]CHANGE/.test(body);
    const feat = /^feat(\([^)]*\))?!?:/.test(subject);
    if (breaking) {
      level = "major";
      reasons.push(`major  ${subject}`);
    } else if (feat) {
      if (level !== "major") level = "minor";
      reasons.push(`minor  ${subject}`);
    } else {
      reasons.push(`patch  ${subject}`);
    }
  }
  return { level, commits: commits.length, reasons };
}

export async function bumpCommand(
  startDir: string,
  pluginName: string | undefined,
  levelArg: string | undefined,
  opts: BumpOptions = {},
): Promise<void> {
  const root = findMarketplaceRoot(startDir);
  if (!root) {
    p.log.error("No .claude-plugin/marketplace.json found. Run `agpo init` first.");
    process.exitCode = 1;
    return;
  }
  const mp = readMarketplace(root);
  const locals = scanLocalPlugins(root, mp);
  if (locals.length === 0) {
    p.log.error("No local plugins found under the plugin root.");
    process.exitCode = 1;
    return;
  }

  let name = pluginName;
  if (!name) {
    const answer = await p.select({
      message: "Plugin to bump",
      options: locals.map((l) => ({
        value: l.manifest.name || l.dirName,
        label: `${l.manifest.name || l.dirName} (${l.manifest.version ?? "unversioned"})`,
      })),
    });
    if (p.isCancel(answer)) {
      p.cancel("Cancelled.");
      process.exitCode = 1;
      return;
    }
    name = answer;
  }

  const local = locals.find((l) => (l.manifest.name || l.dirName) === name);
  if (!local) {
    p.log.error(`No local plugin named "${name}". Known: ${locals.map((l) => l.manifest.name || l.dirName).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  if (levelArg && !["major", "minor", "patch", "auto"].includes(levelArg)) {
    p.log.error(`Invalid level "${levelArg}". Use major, minor, patch, or auto.`);
    process.exitCode = 1;
    return;
  }

  const current = local.manifest.version ?? "0.1.0";
  let level: BumpLevel;

  if (!levelArg || levelArg === "auto") {
    const sinceTag = lastReleaseTag(root, name);
    const analysis = analyzeCommits(root, local.dir, sinceTag);
    if (!analysis.level) {
      p.log.info(
        `No commits touching ${path.relative(root, local.dir)}${sinceTag ? ` since ${sinceTag}` : ""} — nothing to bump.`,
      );
      return;
    }
    level = analysis.level;
    p.log.info(
      `${analysis.commits} commit(s)${sinceTag ? ` since ${pc.cyan(sinceTag)}` : " (no previous release tag)"}:\n  ` +
        analysis.reasons.slice(0, 12).join("\n  ") +
        (analysis.reasons.length > 12 ? `\n  … ${analysis.reasons.length - 12} more` : ""),
    );
  } else {
    level = levelArg as BumpLevel;
  }

  const next = incrementSemver(current, level);
  const tagName = `${name}@${next}`;

  if (opts.dryRun) {
    p.log.info(`[dry-run] ${name}: ${current} -> ${pc.green(next)} (${level})${opts.tag ? ` + tag ${tagName}` : ""}`);
    return;
  }

  const manifestPath = path.join(local.dir, MARKETPLACE_DIR, PLUGIN_MANIFEST_FILE);
  const manifest = readJson<PluginManifest>(manifestPath);
  manifest.version = next;
  writeJson(manifestPath, manifest);

  // Propagate to catalog + README.
  await syncCommand(root, { quiet: true });

  p.log.success(`${name}: ${current} -> ${pc.green(next)} (${level})`);

  if (opts.tag) {
    try {
      git(root, ["add", "-A"]);
      git(root, ["commit", "-m", `chore(release): ${tagName}`]);
      git(root, ["tag", tagName]);
      p.log.success(`Committed and tagged ${pc.cyan(tagName)} — push with: git push --follow-tags`);
    } catch (err) {
      p.log.warn(`Version bumped but commit/tag failed: ${(err as Error).message}`);
    }
  } else {
    p.log.info("Commit the change, then push. Use --tag to commit and tag in one step.");
  }
}
