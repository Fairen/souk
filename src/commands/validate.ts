import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  KEBAB_CASE_RE,
  MARKETPLACE_DIR,
  PLUGIN_MANIFEST_FILE,
  RESERVED_MARKETPLACE_NAMES,
} from "../lib/constants.js";
import { getAdapter } from "../lib/agents.js";
import {
  findMarketplaceRoot,
  marketplacePath,
  readMarketplace,
  resolveLocalPluginDir,
  type Marketplace,
} from "../lib/marketplace.js";

interface Finding {
  level: "error" | "warn";
  message: string;
}

export interface ValidateOptions {
  strict?: boolean;
}

export async function validateCommand(
  startDir: string,
  opts: ValidateOptions = {},
): Promise<void> {
  const root = findMarketplaceRoot(startDir);
  if (!root) {
    p.log.error("No .claude-plugin/marketplace.json found. Run `agpo init` first.");
    process.exitCode = 1;
    return;
  }

  const findings: Finding[] = [];
  let mp: Marketplace | undefined;

  // 1. JSON parses
  try {
    mp = readMarketplace(root);
  } catch (err) {
    findings.push({
      level: "error",
      message: `marketplace.json is not valid JSON: ${(err as Error).message}`,
    });
  }

  if (mp) {
    // 2. Required fields and naming rules
    if (!mp.name) {
      findings.push({ level: "error", message: "Missing required field: name" });
    } else {
      if (!KEBAB_CASE_RE.test(mp.name)) {
        findings.push({
          level: "error",
          message: `Marketplace name "${mp.name}" must be kebab-case`,
        });
      }
      if (RESERVED_MARKETPLACE_NAMES.includes(mp.name)) {
        findings.push({
          level: "error",
          message: `Marketplace name "${mp.name}" is reserved by Claude Code`,
        });
      }
    }
    if (!mp.owner?.name) {
      findings.push({ level: "error", message: "Missing required field: owner.name" });
    }
    if (!Array.isArray(mp.plugins)) {
      findings.push({ level: "error", message: "plugins must be an array" });
    }

    // 3. Per-plugin checks
    const seen = new Set<string>();
    for (const entry of mp.plugins ?? []) {
      const label = entry.name ?? "<unnamed>";
      if (!entry.name) {
        findings.push({ level: "error", message: "A plugin entry is missing its name" });
        continue;
      }
      if (!KEBAB_CASE_RE.test(entry.name)) {
        findings.push({
          level: "error",
          message: `Plugin name "${label}" must be kebab-case`,
        });
      }
      if (seen.has(entry.name)) {
        findings.push({ level: "error", message: `Duplicate plugin name "${label}"` });
      }
      seen.add(entry.name);
      if (entry.source === undefined) {
        findings.push({ level: "error", message: `Plugin "${label}" is missing source` });
        continue;
      }

      const localDir = resolveLocalPluginDir(root, mp, entry);
      if (localDir) {
        if (!fs.existsSync(localDir)) {
          findings.push({
            level: "error",
            message: `Plugin "${label}" source resolves to missing directory ${path.relative(root, localDir)}`,
          });
        } else {
          const manifestPath = path.join(localDir, MARKETPLACE_DIR, PLUGIN_MANIFEST_FILE);
          if (!fs.existsSync(manifestPath)) {
            findings.push({
              level: "error",
              message: `Plugin "${label}" has no ${MARKETPLACE_DIR}/${PLUGIN_MANIFEST_FILE}`,
            });
          } else {
            try {
              const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
              if (manifest.name && manifest.name !== entry.name) {
                findings.push({
                  level: "warn",
                  message: `Catalog entry "${label}" but plugin.json declares "${manifest.name}" — run \`agpo sync\``,
                });
              }
              if (
                manifest.version &&
                entry.version &&
                manifest.version !== entry.version
              ) {
                findings.push({
                  level: "warn",
                  message: `Version drift for "${label}": catalog ${entry.version} vs plugin.json ${manifest.version} — run \`agpo sync\``,
                });
              }
            } catch {
              findings.push({
                level: "error",
                message: `Plugin "${label}": plugin.json is not valid JSON`,
              });
            }
          }
        }
      }
    }

    // 4. Distribution footgun: relative sources only resolve for Git-based
    // distribution (the nominal case) — informational, not a warning.
    const hasRelative = (mp.plugins ?? []).some((e) => typeof e.source === "string");
    if (hasRelative) {
      p.log.info(
        "Note: relative plugin sources resolve only when the marketplace is added via Git (any forge), not via a direct URL to marketplace.json.",
      );
    }
  }

  // 4b. Target agents that need generation (recorded but not built by agpo).
  if (mp?.metadata?.targets) {
    const needBuild = mp.metadata.targets.filter((id) => (getAdapter(id)?.tier ?? 1) > 1);
    if (needBuild.length > 0) {
      p.log.info(
        `metadata.targets includes tier 2/3 agent(s): ${needBuild.join(", ")}. ` +
          "The Claude catalog validates here; run `agpo build` to (re)generate their registries and `agpo build --check` in CI.",
      );
    }
  }

  // 5. Delegate to the official validator when available
  let officialRan = false;
  try {
    execFileSync("claude", ["plugin", "validate", root, ...(opts.strict ? ["--strict"] : [])], { stdio: "pipe" });
    officialRan = true;
    p.log.success("claude plugin validate: passed");
  } catch (err: unknown) {
    const e = err as { code?: string; stdout?: Buffer; stderr?: Buffer };
    if (e.code === "ENOENT") {
      p.log.info(
        "Claude Code CLI not found — skipped `claude plugin validate` (install it for the official schema check).",
      );
    } else {
      officialRan = true;
      const out = [e.stdout?.toString(), e.stderr?.toString()].filter(Boolean).join("\n").trim();
      findings.push({
        level: "error",
        message: `claude plugin validate failed${out ? ":\n" + out : ""}`,
      });
    }
  }

  const errors = findings.filter((f) => f.level === "error");
  const warns = findings.filter((f) => f.level === "warn");
  for (const f of warns) p.log.warn(f.message);
  for (const f of errors) p.log.error(f.message);

  if (errors.length > 0) {
    p.log.error(pc.red(`Validation failed: ${errors.length} error(s), ${warns.length} warning(s).`));
    process.exitCode = 1;
  } else {
    p.log.success(
      pc.green(
        `${path.relative(process.cwd(), marketplacePath(root)) || marketplacePath(root)} is valid` +
          (warns.length ? ` (${warns.length} warning(s))` : "") +
          (officialRan ? "" : " [local checks only]"),
      ),
    );
  }
}
