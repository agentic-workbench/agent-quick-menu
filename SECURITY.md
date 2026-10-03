# Security policy

## Reporting a vulnerability

Report privately through a [GitHub security advisory](https://github.com/agentic-workbench/agent-quick-menu/security/advisories/new). Do not open a public issue for a vulnerability.

## What to know

A Claude Code mod runs with your user's permissions. Install it only if you trust it.

### Menu files are untrusted input

Other plugins' `.claude-plugin/quick-menu.json` files decide which buttons the menu shows, so agent-quick-menu treats them as untrusted:

- A file must be a regular file (not a link) of at most 64 KiB, with valid JSON. Anything else is skipped and listed under Problems.
- Every string is rejected if it holds a control, line-break, bidi or zero-width character. Limits: title 60 characters, label 40 (not blank), command 64, args 500 (one line), description 200; at most 50 commands and 50 settings. At most 30 commands of one section are drawn, the rest as "+k more".
- A title may not be `Claude Code`, `Favourites`, `built-in` or another discovered plugin's name, and it is shown as `title · plugin name`.
- Messages from a file are cut to 300 characters with bad characters replaced.
- Roots, install paths and `CLAUDE_CONFIG_DIR` must be absolute paths.

### What a press runs

A button runs a slash command through Claude Code (`$.command.run`), with the command and arguments shown beside it. That includes Claude Code's built-in commands and commands of other plugins, not only the plugin's own. Such a button is tagged (`runs <plugin>`, `runs a built-in`) and needs a second press within 5 seconds (`press again: /command`), in the pane and in the band. A command it triggers may use the network. Digit hotkeys in the band exist only when you turn on the `bandHotkeys` option, and only for the plugin's own commands.

### What it reads

- Environment variables `HOME`, `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_PLUGIN_DIRS`.
- The plugin registry (`installed_plugins.json` under the Claude config directory) and `enabledPlugins` from your settings.
- `.claude-plugin/plugin.json` of the plugin folders named in `CLAUDE_CODE_PLUGIN_DIRS`, and `.claude-plugin/quick-menu.json` of each enabled plugin.
- The roots `plugin.register` hands out for plugins loaded with `--plugin-dir`.
- The commands Claude Code lists and the rows `/config` shows.

### What it writes

- Its own state (favourites, at most 50, and fold state) in `$.store`.
- `/config` rows, only when you change a setting in the pane.
- Its pane state in `$.state`, which other plugins can read.

It makes no network requests of its own.
