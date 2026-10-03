# agent-quick-menu

A quick menu for Claude Code: every plugin's commands and settings, and Claude Code's own, in one pane and a band above the prompt.

<!-- screenshot: docs/screenshot.png, to be added -->

## Requirements

Claude Code 2.1.287 or newer, in the terminal or the Desktop Code tab. The VS Code chat panel and `claude -p` are not supported.

## Install

The repository is private for now, so SSH or the `gh` credential helper must be set up for git.

```
claude plugin marketplace add dasganni/agent-quick-menu
claude plugin install agent-quick-menu@agent-quick-menu
```

Then run `/reload-plugins` in a running session.

## Usage

- `/menu` opens the pane. `/menu refresh` discovers plugin menus again.
- The band above the prompt shows `☰ menu` (hotkey `m` while the band is focused) and your favourites.
- `ctrl+x tab` focuses the band.
- With an empty prompt, the digits `1` to `9` press the favourites in order.
- `☆` / `★` on any row adds or removes a favourite. Favourites are listed first in the pane.
- `[-]` at the end of the band (drawn by Claude Code, or ctrl+x ctrl+a) folds the band.

## What appears

- One section per plugin that ships a `.claude-plugin/quick-menu.json`: its commands as buttons and its settings (`userConfig`) as rows.
- A "Claude Code" section with Claude Code's own settings.
- A locked row (`(managed)`) is set by managed policy and cannot be changed here.
- A "Problems" list shows plugin files that were skipped and why.

## For plugin authors

Add `.claude-plugin/quick-menu.json` to your plugin:

```json
{
  "$schema": "https://raw.githubusercontent.com/dasganni/agent-quick-menu/main/schema/quick-menu.schema.json",
  "version": 1,
  "commands": [{ "command": "my-plugin:status", "label": "Status" }]
}
```

The full format is in [docs/convention.md](docs/convention.md).

## Limitations

- There is no global hotkey; the band hotkeys work only while the band is focused or the prompt is empty.
- Settings that are not shown in `/config` are not shown here.
- A favourite setting that is not boolean opens the pane instead of toggling.

## Development

```
make check                 # claude plugin validate + test
claude --plugin-dir .      # try the plugin from this checkout
```

## License

MIT, see [LICENSE](LICENSE).
