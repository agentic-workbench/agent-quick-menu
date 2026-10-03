# agent-quick-menu

[![License: MIT](https://img.shields.io/github/license/agentic-workbench/agent-quick-menu)](LICENSE)
[![CI](https://github.com/agentic-workbench/agent-quick-menu/actions/workflows/ci.yml/badge.svg)](https://github.com/agentic-workbench/agent-quick-menu/actions/workflows/ci.yml)

A quick menu for Claude Code: every plugin's commands and settings, and Claude Code's own, in one pane and a band above the prompt.

<!-- screenshot: docs/screenshot.png, to be added -->

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
- The band above the prompt is one line: `≣ menu │ 1 Pull  2 Status …` (hotkey `m` while the band is focused, then your favourites).
- `ctrl+x tab` focuses the band.
- With an empty prompt, the digits `1` to `9` press the command favourites in order. Setting favourites carry no digit. Digits do not arm while the band scrolls, and another mod's same hotkey may win.
- `☆` / `★` on any row adds or removes a favourite. Favourites are listed first in the pane.
- Every section folds: press its header (`▸` / `▾`). Favourites start open, every other section folded. `Expand all` (`e`) and `Collapse all` (`c`) sit on the top line; the state is kept across sessions. `Close` (`x`) at the right end of the top line, or Escape, closes the pane. With no favourites yet, the pane says to press `☆` on a row.
- The filter field at the top (`filter…`) matches setting labels and keys and command names, case-insensitive, across every section. Sections without a match are hidden, matching ones open while a filter is set, and the counts follow.
- Every setting row is a plain label and a value: a boolean is a small `[ on ]` / `[ off ]` toggle, a choice keeps `value ▾`.
- If the terminal is too narrow to place the pane, a toast says so and the band lists the sections (header buttons, at most as many rows as the band may take, and a `Close` button) instead.
- `[-]` at the end of the band (drawn by Claude Code, or ctrl+x ctrl+a) folds the band.

## What appears

- One section per plugin that ships a `.claude-plugin/quick-menu.json`: its commands as a wrapping row of buttons and its settings (`userConfig`) as an aligned label/value table.
- A commands-only section for a plugin loaded with `--plugin-dir` whose root is not known (see Limitations): its registered commands, and a dim line saying to set `CLAUDE_CODE_PLUGIN_DIRS`.
- A settings-only section for each plugin without the file that has `userConfig` rows.
- A "Claude Code" section with Claude Code's own settings.
- A locked row (`managed`) is set by managed policy and cannot be changed here.
- A "Problems" list shows plugin files that were skipped and why.

## For plugin authors

Add `.claude-plugin/quick-menu.json` to your plugin:

```json
{
  "$schema": "https://raw.githubusercontent.com/agentic-workbench/agent-quick-menu/main/schema/quick-menu.schema.json",
  "version": 1,
  "commands": [{ "command": "my-plugin:status", "label": "Status" }]
}
```

The full format is in [docs/convention.md](docs/convention.md).

## Limitations

- There is no global hotkey; the band hotkeys work only while the band is focused or the prompt is empty.
- A `--plugin-dir` plugin's root is only learned when its hooks module loads after this one (`plugin.register`; kept across a reload of the menu); a plugin without one, or loaded earlier, is listed from `$.command.list()` with its commands only. Set `CLAUDE_CODE_PLUGIN_DIRS` to the same folder to read its `quick-menu.json`. A `--plugin-dir` copy shadows an installed copy of the same plugin. The menu reads its own file from its own folder.
- Discovery runs in the background, after every plugin's `session.start` and on `/menu refresh` (which toasts the counts when it is done), so `/menu` answers at once.
- Settings that are not shown in `/config` are not shown here.
- A favourite setting that is not boolean opens the pane instead of toggling.

## Releases

Releases are tagged (`v0.1.0`, ...) and listed in [CHANGELOG.md](CHANGELOG.md). `plugin.json` has no version field on purpose, so an install follows the commit of the branch it tracks: `main` is releases, `develop` is the latest.

## Development

```
make check                 # claude plugin validate + test, and tsc --noEmit when tsc is on PATH
claude --plugin-dir .      # try the plugin from this checkout
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branches, commits and tests, and the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## License

MIT, see [LICENSE](LICENSE).
