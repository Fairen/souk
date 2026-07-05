import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PLUGIN_TEMPLATES, type PluginTemplate } from "./constants.js";
import { templatesDir } from "./fsutils.js";

/**
 * Template spec grammar (forge-agnostic, degit-inspired):
 *   skill | command | agent | hook | mcp          built-in
 *   ./dir | /abs/dir | path:<dir>                 local directory
 *   gh:owner/repo[/sub/dir][#ref]                 github.com shorthand
 *   gl:owner/repo[/sub/dir][#ref]                 gitlab.com shorthand
 *   <git-url>[//sub/dir][#ref]                    any forge (https/ssh/file)
 */
export interface ResolvedTemplate {
  /** Directory containing the template files, ready to copy. */
  dir: string;
  /** Human label for logs. */
  label: string;
  /** Temp directory to remove after copying, if any. */
  cleanup?: string;
  /** True for the built-in templates shipped with the CLI. */
  builtin: boolean;
}

interface GitSpec {
  cloneUrl: string;
  subdir?: string;
  ref?: string;
}

function parseGitSpec(spec: string): GitSpec | undefined {
  let ref: string | undefined;
  let body = spec;
  const hash = body.lastIndexOf("#");
  if (hash > 0) {
    ref = body.slice(hash + 1) || undefined;
    body = body.slice(0, hash);
  }

  const shorthand = body.match(/^(gh|gl):([^/]+)\/([^/]+)(?:\/(.+))?$/);
  if (shorthand) {
    const host = shorthand[1] === "gh" ? "github.com" : "gitlab.com";
    return {
      cloneUrl: `https://${host}/${shorthand[2]}/${shorthand[3]}.git`,
      subdir: shorthand[4],
      ref,
    };
  }

  // Raw git URL (https/ssh/git/file or scp-style). Optional `//subdir`.
  const looksLikeUrl =
    /^(https?|ssh|git|file):\/\//.test(body) || /^[\w.-]+@[\w.-]+:/.test(body);
  if (looksLikeUrl) {
    let subdir: string | undefined;
    const protoEnd = body.indexOf("://");
    const sep = body.indexOf("//", protoEnd === -1 ? 0 : protoEnd + 3);
    if (sep !== -1) {
      subdir = body.slice(sep + 2);
      body = body.slice(0, sep);
    }
    return { cloneUrl: body, subdir, ref };
  }
  return undefined;
}

function assertTemplateDir(dir: string, label: string): void {
  const hasManifest =
    fs.existsSync(path.join(dir, ".claude-plugin", "plugin.json.tpl")) ||
    fs.existsSync(path.join(dir, ".claude-plugin", "plugin.json"));
  if (!hasManifest) {
    throw new Error(
      `"${label}" is not a plugin template: expected .claude-plugin/plugin.json(.tpl) in ${dir}`,
    );
  }
}

export function resolveTemplate(spec: string): ResolvedTemplate {
  // 1. Built-in
  if ((PLUGIN_TEMPLATES as readonly string[]).includes(spec)) {
    return {
      dir: path.join(templatesDir(), "plugins", spec as PluginTemplate),
      label: `built-in:${spec}`,
      builtin: true,
    };
  }

  // 2. Local directory
  const localPath = spec.startsWith("path:")
    ? spec.slice(5)
    : spec.startsWith("./") || spec.startsWith("../") || path.isAbsolute(spec)
      ? spec
      : undefined;
  if (localPath !== undefined) {
    const dir = path.resolve(localPath);
    if (!fs.existsSync(dir)) throw new Error(`Template directory not found: ${dir}`);
    assertTemplateDir(dir, spec);
    return { dir, label: spec, builtin: false };
  }

  // 3. Git (any forge)
  const git = parseGitSpec(spec);
  if (!git) {
    throw new Error(
      `Unrecognized template "${spec}". Use a built-in name (${PLUGIN_TEMPLATES.join(", ")}), a local path, gh:owner/repo[/dir][#ref], gl:owner/repo[/dir][#ref], or a git URL.`,
    );
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agpo-tpl-"));
  const args = ["clone", "--depth", "1"];
  if (git.ref) args.push("--branch", git.ref);
  args.push(git.cloneUrl, tmp);
  try {
    execFileSync("git", args, { stdio: "pipe" });
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    const msg = (err as { stderr?: Buffer }).stderr?.toString().trim();
    throw new Error(`git clone failed for ${git.cloneUrl}${msg ? `:\n${msg}` : ""}`);
  }
  const dir = git.subdir ? path.join(tmp, git.subdir) : tmp;
  if (!fs.existsSync(dir)) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error(`Subdirectory "${git.subdir}" not found in ${git.cloneUrl}`);
  }
  // Never copy the clone's .git into the plugin.
  fs.rmSync(path.join(tmp, ".git"), { recursive: true, force: true });
  try {
    assertTemplateDir(dir, spec);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  return { dir, label: spec, cleanup: tmp, builtin: false };
}
