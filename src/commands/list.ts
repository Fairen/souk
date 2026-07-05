import * as p from "@clack/prompts";
import pc from "picocolors";
import { PLUGIN_TEMPLATES, TEMPLATE_DESCRIPTIONS } from "../lib/constants.js";

export async function listCommand(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" Available plugin templates ")));
  for (const t of PLUGIN_TEMPLATES) {
    p.log.message(`${pc.cyan(pc.bold(t))}\n  ${TEMPLATE_DESCRIPTIONS[t]}`);
  }
  p.log.message(
    `Remote and local templates are also supported:\n  agpo add gh:owner/repo/dir my-plugin\n  agpo add gl:owner/repo#v2 my-plugin\n  agpo add https://git.company.io/team/templates.git//skill-fr my-plugin\n  agpo add ./local-template my-plugin`,
  );
  p.outro("Usage: agpo add <template|spec> <plugin-name>");
}
