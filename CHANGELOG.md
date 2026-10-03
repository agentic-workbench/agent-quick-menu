# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Releases are tagged (`v0.1.0`, ...) and listed here. `plugin.json` has no version field on purpose, so installs follow the commit of the branch they track (`main` is releases, `develop` is the latest). The first release is 0.1.0.

## [Unreleased]

## [0.1.0] - 2026-10-03

### Added

- `/menu` pane with one section per plugin: its commands as buttons and its `userConfig` settings as a label/value table.
- Claude Code's own settings in a "Claude Code" section; managed-policy rows are locked.
- A one-line band above the prompt with favourites, opt-in digit hotkeys `1` to `9` (`bandHotkeys` setting, default off; own-plugin commands only, numbered by position in the pinned list), and `ctrl+x tab` to focus it.
- Favourites (`☆` / `★`), foldable sections with `Expand all` / `Collapse all`, and a filter field.
- `.claude-plugin/quick-menu.json` convention with a JSON schema, and a "Problems" list for skipped files.
- `/menu refresh` and background discovery after `session.start`.
- Commands-only and settings-only sections for plugins without a menu file.
- A `Close` button (`x`) at the right end of the pane's top line and in the narrow-terminal band; a hint to pin with `☆` while there are no favourites.
- A `bandHotkeys` option (off by default) that binds the digits `1` to `9` in the band to the pinned own-plugin commands, by their place in the pinned list.
- Each command button shows what it runs (`/<command> <args>`); a command owned by another plugin or a built-in is tagged and needs a second press within 5 seconds.
- Menu files are treated as untrusted: regular files of at most 64 KiB, strings with control, bidi or zero-width characters rejected, length and count limits, and clipped messages.
- `SECURITY.md`, `CONTRIBUTING.md`, a Code of Conduct, issue and pull request templates, CI that checks the JSON files, and Dependabot.
- `keywords` in `plugin.json` and `description`, `category` and `author` on the marketplace entry.

[Unreleased]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/agentic-workbench/agent-quick-menu/releases/tag/v0.1.0
