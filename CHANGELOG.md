# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Releases are tagged (`v0.1.0`, ...) and listed here. `plugin.json` has no version field on purpose, so installs follow the commit of the branch they track (`main` is releases, `develop` is the latest). The first release is 0.1.0.

## [Unreleased]

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

### Changed

- The pane is clearer: aligned label/value rows, `[ on ]` / `[ off ]` toggles, and `value ▾` choices; the digits no longer renumber when a favourite is missing.
- Settings of marketplace plugins (`name@marketplace`) are matched by the plugin's bare name.
- `USERPROFILE` is used when `HOME` is unset, and `CLAUDE_CODE_PLUGIN_DIRS` may be separated by `;`.
- Install instructions use `/plugin marketplace add`; the private-repository note and the `claude -p` sentence are gone.
