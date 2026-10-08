<p align="center">
  <img src=".claude-plugin/icon.png" alt="agent-quick-menu logo" width="128">
</p>

<h1 align="center">agent-quick-menu</h1>

<p align="center">
  <b>One menu for Claude Code:</b> every plugin's commands and settings, and Claude Code's own,<br>
  in a pane beside the transcript, a band of favourites above the prompt and a menu button below it.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/agentic-workbench/agent-quick-menu" alt="License: MIT"></a>
  <a href="https://github.com/agentic-workbench/agent-quick-menu/releases"><img src="https://img.shields.io/github/v/release/agentic-workbench/agent-quick-menu" alt="Latest release"></a>
  <a href="https://github.com/agentic-workbench/agent-quick-menu/actions/workflows/ci.yml"><img src="https://github.com/agentic-workbench/agent-quick-menu/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/karanb192/awesome-claude-code-mods"><img src="https://awesome.re/mentioned-badge.svg" alt="Listed in awesome-claude-code-mods"></a>
  <a href="https://github.com/karanb192/awesome-claude-code-mods"><img src="https://raw.githubusercontent.com/karanb192/awesome-claude-code-mods/main/badges/agentic-workbench--agent-quick-menu--agent-quick-menu-validates.svg" alt="validates"></a>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#for-plugin-authors">For plugin authors</a> ·
  <a href="docs/convention.md">Convention</a> ·
  <a href="#what-this-plugin-does-on-your-machine">What it does on your machine</a>
</p>

<p align="center">
  <img src="docs/screenshot.png" alt="The quick menu pane: foldable sections per plugin with command buttons, their slash commands and descriptions, and Claude Code's own settings with toggles and choices" width="900">
</p>

## Highlights

- **Every plugin in one place.** Each plugin gets a foldable section with its commands as buttons and its settings as editable rows; Claude Code's own `/config` settings get one too.
- **Commands that ask.** A button can prompt for its argument (a branch, a date) before it runs, with save and cancel.
- **Settings you can change in place.** Toggles, option buttons and text fields, each with its description; a filter finds a row by name or description.
- **Favourites in the band.** Pin any command or setting with ☆ and it sits above the prompt, one press away. The menu button sits at the bottom right of the prompt footer.
- **Safe by default.** Every button shows the slash command it runs; another plugin's or a built-in command needs a second press. Menu files are treated as untrusted input.
- **One file to join.** A plugin registers with a small `.claude-plugin/quick-menu.json`; no code, no dependency.

## Requirements

Claude Code 2.1.287 or newer, in the terminal or the Desktop Code tab, on macOS or Linux. The VS Code chat panel is not supported. Windows paths (`USERPROFILE`, `;` in `CLAUDE_CODE_PLUGIN_DIRS`) are read, but the menu is untested there.

## Install

In a Claude Code session:

```
/plugin marketplace add agentic-workbench/agent-quick-menu
/plugin install agent-quick-menu@agent-quick-menu
/reload-plugins
```

Or from a shell:

```
claude plugin marketplace add agentic-workbench/agent-quick-menu
claude plugin install agent-quick-menu@agent-quick-menu
```

Then run `/reload-plugins` in a running session.

## Usage

- `/menu` opens the pane. `/menu refresh` discovers plugin menus again.
- The menu button `≣ menu ▸` sits at the bottom right of the prompt footer, after the dim mode labels. Click it to toggle: it closes the menu when it is open (`▾`) and opens it when closed (`▸`); it has no hotkey, as the footer cannot hold focus. `/menu` always opens or focuses it. The band above the prompt is one line holding your favourites only, after a dim caption: `★ favourites: Pull  Status …`.
- `ctrl+x tab` focuses the band.
- Pinned favourites are buttons in the band above the prompt; one click runs them. There is no keyboard shortcut for them.
- `☆` / `★` on any row adds or removes a favourite. Favourites are listed first in the pane.
- Every section folds: press its header (`▸` / `▾`). Favourites start open, every other section folded. `Expand all` (`e`) and `Collapse all` (`c`) sit on the top line; the state is kept across sessions. The pane closes with Claude Code's own `×`, Escape or ctrl+x x. With no favourites yet, the pane says to press `☆` on a row.
- The filter field at the top (`filter…`) matches setting labels, keys and descriptions and command names and labels, case-insensitive, across every section. Sections without a match are hidden, matching ones open while a filter is set, and the counts follow.
- Every setting row is a plain label and a value, and a press edits it: a boolean is a green `●` (on) or gray `○` (off) with the plain word `on` / `off`; a choice opens an inline row of option buttons (`● current`, `○ other`), one editor open at a time; text and number rows show `value ✎` and open an Input with `✓ save` and `✕ cancel`. Cancel is the button: Escape does not cancel the edit (it closes the pane). Commands and settings show a dim italic description after ` · `.
- A command with `ask` in its menu entry opens that same editor when pressed, in the pane or from a band favourite (which opens the pane at its row), with the default typed in and `✓ run` / `✕ cancel`. Enter or `✓ run` runs `/command <args> <input>`; the row hint reads `/command <args> …`. The confirm-twice of a built-in or another plugin's command applies to `✓ run`. See [docs/convention.md](docs/convention.md).
- If the terminal is too narrow to place the pane, a toast says so and the band lists the sections (header buttons, at most as many rows as the band may take, and a `Close` button, since the engine draws no close mark there) instead.
- `[-]` at the end of the band (drawn by Claude Code, or ctrl+x ctrl+a) folds the band.

## What appears

- One section per plugin that ships a `.claude-plugin/quick-menu.json`: its commands one per line (button, then the `/command args` hint) and its settings (`userConfig`) as an aligned label/value table. A setting's description (`userConfig` `description`) follows its value dimmed, clipped to the pane width and dropped when under 8 cells remain; the filter matches it too.
- A commands-only section for a plugin loaded with `--plugin-dir` whose root is not known (see Limitations): its registered commands, and a dim line saying to set `CLAUDE_CODE_PLUGIN_DIRS`.
- A settings-only section for each plugin without the file that has `userConfig` rows.
- A "Claude Code" section with Claude Code's own settings.
- A locked row (`managed`) is set by managed policy and cannot be changed here.
- A "Problems" list shows plugin files that were skipped and why.

## What this plugin does on your machine

**Slash commands it runs, and when.** Only when you press a button or a band favourite, and only the command that row shows: `/<command> <args>` from a plugin's `quick-menu.json`. Built-in commands and other plugins' commands need a second press within 5 seconds. When you change a setting row it runs `/config <key>=<value>`, then reads the row back through `$.config.list()` to judge whether the write took. It runs nothing on its own.

**What it sets.** Only the `/config` rows you change in the pane. It sets no environment variables. It keeps favourites and folded sections in Claude Code's plugin store.

**What it reads.** The plugin registry `installed_plugins.json` under `CLAUDE_CONFIG_DIR` or `~/.claude`, the environment variables `CLAUDE_CONFIG_DIR`, `HOME`, `USERPROFILE` and `CLAUDE_CODE_PLUGIN_DIRS`, each plugin's `.claude-plugin/quick-menu.json`, the `.claude-plugin/plugin.json` of the folders in `CLAUDE_CODE_PLUGIN_DIRS`, the list of commands Claude Code offers, and the rows `/config` shows. It sends nothing over the network and reads no credentials.

**Its hooks.**

- `ui.render` on `AbovePrompt`: adds its own row of favourites and keeps every other mod's band beneath it.
- `ui.render` on `SessionMode`: draws the footer's mode labels as the engine does, then the menu button.
- `ui.render` on its `Pane`: draws the menu.
- `command.run`, matched to `/menu` only: answers `/menu` and `/menu refresh` itself. It never sees, changes or blocks any other command, including the ones it runs for you.
- `plugin.register`: reads the name, root and provenance of each plugin as it loads, to find the `quick-menu.json` of plugins loaded with `--plugin-dir`. It passes every registration on unchanged and never alters or blocks a plugin, its settings, instructions, hooks or tool descriptions.
- `ui.close`: observed only, to redraw the footer's menu button when the pane closes. It passes every close on unchanged.
- `session.start`: registers `/menu`, loads favourites and folds, and starts discovery.

## For plugin authors

Add `.claude-plugin/quick-menu.json` to your plugin:

```json
{
  "$schema": "https://raw.githubusercontent.com/agentic-workbench/agent-quick-menu/main/schema/quick-menu.schema.json",
  "version": 1,
  "commands": [
    { "command": "my-plugin:status", "label": "Status", "description": "Show the plugin's state" },
    { "command": "my-plugin:deploy", "label": "Deploy to…", "ask": { "placeholder": "environment", "default": "staging" } }
  ],
  "settings": ["verbose"]
}
```

That's it: `commands` become buttons, `ask` prompts for an argument first, and `settings` lists which of your `userConfig` fields to show (omit it to show all). Without agent-quick-menu installed the file is never read. The full format, limits and versioning promise are in [docs/convention.md](docs/convention.md).

## Limitations

- There is no global hotkey and no keyboard shortcut for the band favourites.
- A `--plugin-dir` plugin's root is only learned when its hooks module loads after this one (`plugin.register`; kept across a reload of the menu); a plugin without one, or loaded earlier, is listed from `$.command.list()` with its commands only. Set `CLAUDE_CODE_PLUGIN_DIRS` to the same folder to read its `quick-menu.json`. A `--plugin-dir` copy shadows an installed copy of the same plugin. The menu reads its own file from its own folder.
- Discovery runs in the background, after every plugin's `session.start` and on `/menu refresh` (which toasts the counts when it is done), so `/menu` answers at once.
- Settings that are not shown in `/config` are not shown here.
- A favourite setting that is not boolean opens the pane instead of toggling.

## Releases

Releases follow [semantic versioning](https://semver.org): `version` in `plugin.json` is the release, tagged as `v<version>` and listed in [CHANGELOG.md](CHANGELOG.md). Claude Code updates an install when that version changes, so installs from `main` get each release.

## Development

```
make check                 # JSON check, claude plugin validate + test, and tsc --noEmit (tsc from PATH, else via npx)
claude --plugin-dir .      # try the plugin from this checkout
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branches, commits and tests, and the [Code of Conduct](CODE_OF_CONDUCT.md).

## Privacy

See [PRIVACY.md](PRIVACY.md): the plugin collects and sends nothing.

## Security

Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## License

MIT, see [LICENSE](LICENSE).
