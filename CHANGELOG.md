# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [semantic versioning](https://semver.org). Each release bumps `version` in `.claude-plugin/plugin.json` and is tagged `v<version>`.

## [Unreleased]

## [0.1.8] - 2026-10-03

### Changed

- Commands are listed one per line, aligned like the settings table: star, button, the dim `/command args` hint, then the dim description clipped to the width. The foreign/built-in tag, the confirm-twice label and the "+k more" cap stay.
- A boolean setting shows a green `● on` or a gray `○ off`.
- Section titles are bold cyan; counts and the `built-in` tag are dim. The fold chevron is its own button beside the title. A pinned star is undimmed, an unpinned one dim (a Button label cannot take a colour).
- Colours that carry meaning are named (`green`, `gray`, `cyan`, `red`) rather than theme keys, which rendered pale in some terminals.
- The description in `plugin.json`, `marketplace.json` and the README is narrowed to what the plugin does: a pane and prompt band for plugin commands declared in quick-menu.json, plus plugin and Claude Code settings exposed through /config.

## [0.1.7] - 2026-10-03

### Fixed

- `plugin.json` names its `types` contract again; without it `claude plugin validate` refused the module's `$.state` keys. The gate now validates the manifest as well as the marketplace.

## [0.1.6] - 2026-10-03

### Added

- PRIVACY.md, and documentation, support, privacy and terms links in `plugin.json` for the directory listing.

### Changed

- README states exactly what the `command.run` and `plugin.register` hooks see and that they change nothing else.

## [0.1.5] - 2026-10-03

### Changed

- The pane uses Claude Code's own close mark instead of a second Close button.

## [0.1.4] - 2026-10-03

### Changed

- The marketplace entry names its owner and author without links.

## [0.1.3] - 2026-10-03

### Changed

- The manifests carry no `$schema` URLs and `plugin.json` no `icon` field; Claude Code finds the icon at its default path.

## [0.1.2] - 2026-10-03

### Changed

- `plugin.json` carries the release `version`, so Claude Code updates installs on each release.

## [0.1.1] - 2026-10-03

### Changed

- Settings are written through Claude Code's own `/config <key>=<value>`, so every write is visible as that command.
- README: a section on what the plugin runs, sets and reads on your machine, and what each hook does.
- Plugin icon.

## [0.1.0] - 2026-10-03

### Added

- `/menu` pane with one section per plugin: its commands as buttons and its `userConfig` settings as a label/value table.
- Claude Code's own settings in a "Claude Code" section; managed-policy rows are locked.
- A one-line band above the prompt with favourites, opt-in digit hotkeys `1` to `9` (`bandHotkeys` setting, default off; own-plugin commands only, numbered by position in the pinned list), and `ctrl+x tab` to focus it.
- Favourites (`☆` / `★`), foldable sections with `Expand all` / `Collapse all`, and a filter field.
- `.claude-plugin/quick-menu.json` convention with a JSON schema, and a "Problems" list for skipped files.
- `/menu refresh` and background discovery after `session.start`.
- Commands-only and settings-only sections for plugins without a menu file.
- A `Close` button (`x`) in the narrow-terminal band (the pane closes with Claude Code's `×`, Esc or ctrl+x x); a hint to pin with `☆` while there are no favourites.
- A `bandHotkeys` option (off by default) that binds the digits `1` to `9` in the band to the pinned own-plugin commands, by their place in the pinned list.
- Each command button shows what it runs (`/<command> <args>`); a command owned by another plugin or a built-in is tagged and needs a second press within 5 seconds.
- Menu files are treated as untrusted: regular files of at most 64 KiB, strings with control, bidi or zero-width characters rejected, length and count limits, and clipped messages.
- `SECURITY.md`, `CONTRIBUTING.md`, a Code of Conduct, issue and pull request templates, CI that checks the JSON files, and Dependabot.
- `keywords` in `plugin.json` and `description`, `category` and `author` on the marketplace entry.

[Unreleased]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.8...HEAD
[0.1.8]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/agentic-workbench/agent-quick-menu/releases/tag/v0.1.0
