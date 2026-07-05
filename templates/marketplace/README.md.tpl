# {{marketplaceName}}

{{description}}

A [plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces): a Git repository whose `.claude-plugin/marketplace.json` catalog is consumed by AI coding agents. Works from any Git host.

## Install

{{installSections}}

## Team setup (automatic installation)

{{teamSections}}

## Available plugins

<!-- agpo:plugins:start -->
_No plugins yet. Add one with `agpo add <template> <name>`._
<!-- agpo:plugins:end -->

## Development

This marketplace is managed with [agpo](https://www.npmjs.com/package/agpo):

```bash
agpo add skill my-skill      # scaffold a new plugin from a template
agpo sync                    # reconcile marketplace.json with plugins/
agpo validate                # check the catalog before pushing
agpo bump my-skill --tag     # version a plugin from conventional commits
```

The catalog lives in `.claude-plugin/marketplace.json`; each plugin lives in `plugins/<name>/` with its own `.claude-plugin/plugin.json` manifest. Target agents are recorded in `metadata.targets`.
