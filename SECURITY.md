# Security policy

## Reporting a vulnerability

Report privately through a [GitHub security advisory](https://github.com/agentic-workbench/agent-quick-menu/security/advisories/new). Do not open a public issue for a vulnerability.

## What to know

A Claude Code mod runs with your user's permissions. Install it only if you trust it.

### Menu files are untrusted input

Other plugins' `.claude-plugin/quick-menu.json` files decide which buttons the menu shows, so agent-quick-menu treats them as untrusted:

- A file must be a regular file (not a link) of at most 64 KiB, with valid JSON. Anything else is skipped and listed under Problems.
- Every displayed string (title, labels, commands, args, descriptions and setting names) is rejected if it holds a control, line-break, bidi or zero-width character. Limits: title 60 characters (not blank), label 40 (not blank), command 64, setting name 64, args 500 (one line), description 200; at most 50 commands and 50 settings. At most 30 commands of one section are drawn, the rest as "+k more".
- A title may not be `Claude Code`, `Favourites`, `built-in` or another discovered plugin's name, and it is shown as `title · plugin name` unless it equals the plugin name in any case.
- Messages from a file are cut to 300 characters with bad characters replaced.
- Roots, install paths and `CLAUDE_CONFIG_DIR` must be absolute paths.

### What a press runs

A button runs a slash command through Claude Code (`$.command.run`), only when you press it or a band favourite, with the command and arguments shown beside it. That includes Claude Code's built-in commands and commands of other plugins, not only the plugin's own. Such a button is tagged (`runs <plugin>`, `runs a built-in`) and needs a second press within 5 seconds (`press again: /command`), in the pane and in the band. A command it triggers may use the network. Digit hotkeys in the band exist only when you turn on the `bandDigits` option, and only for the plugin's own commands.

### What it reads

- Settings (`enabledPlugins`) and environment variables `HOME`, `USERPROFILE`, `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_PLUGIN_DIRS`.
- The plugin registry (`installed_plugins.json` under the Claude config directory) and `enabledPlugins` from your settings.
- `.claude-plugin/plugin.json` of the plugin folders named in `CLAUDE_CODE_PLUGIN_DIRS`, and `.claude-plugin/quick-menu.json` of each enabled plugin.
- The roots `plugin.register` hands out for plugins loaded with `--plugin-dir`.
- The commands Claude Code lists and the rows `/config` shows. After a write it reads the row back (`$.config.list()`) to judge whether the write took.

### What it writes

- Its own state (favourites, at most 50, and fold state) in `$.store`.
- `/config` rows, only when you change a setting in the pane, by running `/config <key>=<value>` through Claude Code (`$.command.run`). It sets no environment variables.
- Its pane state in `$.state`, which other plugins can read.

It makes no network requests of its own and reads no credentials. Its hooks: `ui.render` on `AbovePrompt` and its `Pane`, `command.run` for `/menu` only, `plugin.register` (records roots, changes nothing), `ui.close` (observed only, passed on unchanged) and `session.start`. See "What this plugin does on your machine" in the README.
