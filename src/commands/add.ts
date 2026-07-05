import fs from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  KEBAB_CASE_RE,
  PLUGIN_TEMPLATES,
  TEMPLATE_DESCRIPTIONS,
} from "../lib/constants.js";
import { copyTemplateDir, readJson, writeJson } from "../lib/fsutils.js";
import { resolveTemplate } from "../lib/templates.js";
import {
  findMarketplaceRoot,
  pluginRootDir,
  readMarketplace,
  writeMarketplace,
} from "../lib/marketplace.js";
import { syncCommand } from "./sync.js";

export interface AddOptions {
  description?: string;
  interactive?: boolean;
}

function titleCase(kebab: string): string {
  return kebab
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function addPlugin(
  startDir: string,
  templateArg: string | undefined,
  nameArg: string | undefined,
  opts: AddOptions = {},
): Promise<void> {
  const root = findMarketplaceRoot(startDir);
  if (!root) {
    p.log.error(
      "No .claude-plugin/marketplace.json found here or in any parent directory. Run `agpo init` first.",
    );
    process.exitCode = 1;
    return;
  }

  let templateSpec = templateArg;
  if (!templateSpec) {
    const answer = await p.select({
      message: "Plugin template",
      options: PLUGIN_TEMPLATES.map((t) => ({
        value: t as string,
        label: t,
        hint: TEMPLATE_DESCRIPTIONS[t],
      })),
    });
    if (p.isCancel(answer)) return cancel();
    templateSpec = answer;
  }

  let name = nameArg;
  if (!name) {
    const answer = await p.text({
      message: "Plugin name (kebab-case)",
      placeholder: "my-plugin",
      validate: (v) =>
        KEBAB_CASE_RE.test(v) ? undefined : "Must be kebab-case (lowercase, digits, hyphens)",
    });
    if (p.isCancel(answer)) return cancel();
    name = answer;
  }
  if (!KEBAB_CASE_RE.test(name)) {
    p.log.error(`Plugin name "${name}" must be kebab-case.`);
    process.exitCode = 1;
    return;
  }

  const mp = readMarketplace(root);
  if (mp.plugins.some((e) => e.name === name)) {
    p.log.error(`A plugin named "${name}" already exists in the catalog.`);
    process.exitCode = 1;
    return;
  }

  const destDir = path.join(pluginRootDir(root, mp), name);
  if (fs.existsSync(destDir)) {
    p.log.error(`Directory already exists: ${destDir}`);
    process.exitCode = 1;
    return;
  }

  let description = opts.description;
  if (description === undefined && opts.interactive !== false) {
    const answer = await p.text({
      message: "One-line description",
      defaultValue: "",
      placeholder: `What does ${name} do?`,
    });
    if (p.isCancel(answer)) return cancel();
    description = answer;
  }
  description = description || `TODO: describe what ${name} does.`;

  const vars = {
    pluginName: name,
    pluginTitle: titleCase(name),
    description,
    authorName: mp.owner?.name ?? "Unknown",
  };

  let resolved;
  try {
    resolved = resolveTemplate(templateSpec);
  } catch (err) {
    p.log.error((err as Error).message);
    process.exitCode = 1;
    return;
  }
  try {
    copyTemplateDir(resolved.dir, destDir, vars);
  } finally {
    if (resolved.cleanup) fs.rmSync(resolved.cleanup, { recursive: true, force: true });
  }

  // Remote/local templates may ship a plain plugin.json (not .tpl): force the
  // chosen identity so the manifest matches the catalog entry.
  const manifestPath = path.join(destDir, ".claude-plugin", "plugin.json");
  if (!resolved.builtin && fs.existsSync(manifestPath)) {
    try {
      const manifest = readJson<Record<string, unknown>>(manifestPath);
      manifest.name = name;
      if (opts.description) manifest.description = description;
      writeJson(manifestPath, manifest);
    } catch {
      p.log.warn("Template plugin.json could not be parsed; left as-is.");
    }
  }
  const template = resolved.label;

  // Register in the catalog. With pluginRoot set, the bare directory name is
  // a valid source; otherwise fall back to an explicit relative path.
  const source = mp.metadata?.pluginRoot
    ? name
    : `./${path.relative(root, destDir).split(path.sep).join("/")}`;
  mp.plugins.push({ name, source, description, version: "0.1.0" });
  writeMarketplace(root, mp);

  // Keep README plugin list in sync.
  await syncCommand(root, { quiet: true });

  p.log.success(
    `Created ${pc.cyan(path.relative(startDir, destDir) || destDir)} (${template} template) and registered it in marketplace.json`,
  );
  p.log.info(
    `Edit the generated files, then test locally:\n  claude\n  /plugin marketplace add ${root}\n  /plugin install ${name}@${mp.name}`,
  );
}

function cancel(): void {
  p.cancel("Cancelled.");
  process.exitCode = 1;
}
