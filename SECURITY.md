# Security policy

## Reporting a vulnerability

Report privately through a [GitHub security advisory](https://github.com/agentic-workbench/agent-quick-menu/security/advisories/new). Do not open a public issue for a vulnerability.

## What to know

A Claude Code mod runs with your user's permissions. Install it only if you trust it.

agent-quick-menu reads:

- Claude Code's settings and the rows `/config` shows.
- The plugin registry: which plugins are installed and loaded, and their commands.
- Other plugins' `.claude-plugin/quick-menu.json` files.

It writes:

- Its own state (favourites, fold state) in `$.store`.
- `/config` rows, only when you change a setting in the pane.

It makes no network requests of its own.
