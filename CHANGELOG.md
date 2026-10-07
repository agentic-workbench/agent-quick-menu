# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [semantic versioning](https://semver.org). Releases are cut automatically when `develop` is merged into `main`: `scripts/release.mjs` derives the version and the section from the Conventional Commit subjects since the last tag, bumps `version` in `.claude-plugin/plugin.json`, and the merge is tagged `v<version>`.

## [0.1.18] - 2026-10-07

### Fixed

- Discovery no longer reads the settings files (#9)

## [0.1.17] - 2026-10-06

### Fixed

- /menu discovers plugin menus when the plugin was loaded without a session start (#7)

## [0.1.16] - 2026-10-03

### Changed

- Current screenshot of the menu pane (#5)

## [0.1.15] - 2026-10-03

### Changed

- Automatic releases when develop is merged into main (#3)

## [0.1.14] - 2026-10-03

### Changed

- README with logo, badges, navigation, highlights, a current screenshot and a fuller plugin-author example.
- `CODEOWNERS`; awesome-claude-code-mods badges.

## [0.1.13] - 2026-10-03

### Added

- Optional `ask` on a command entry (`placeholder`, `default`): pressing it opens the row editor with the default typed in and `✓ run` / `✕ cancel`, and runs `/command <args> <input>`. A band favourite with `ask` opens the pane at its row with the editor open. The input is one line without control, bidi or zero-width characters, at most 500; the confirm-twice of a foreign command applies to `✓ run`. Format version stays 1.
- Text and number settings show `value ✎`; a press opens an Input with `✓ save` and `✕ cancel`. Save writes once (an unchanged value only closes, an invalid number says so and stays open); cancel discards the typed text. Escape does not cancel, since the API has no hook for it. One editor is open at a time, and a row's description is hidden while its picker or editor is open.
- The schema and the validator hold a setting name to 64 characters without control, bidi or zero-width characters, and a title to more than blanks, so "every displayed string" holds.
- `make check` runs `node scripts/check-json.mjs` and type-checks with `tsc` from PATH or else `npx -y -p typescript@5 tsc`; it skips tsc, with a message, only while the API types are missing.

### Changed

- The options of an open choice wrap under the value column.
- A write is judged by re-reading the row (`$.config.list()`), not by the text `/config` answers.
- Docs: README, SECURITY and PRIVACY list the `ui.close` hook (observed only) and everything the menu reads, and describe the current controls.
- Tests: the waits run on `mock.clock` instead of real sleeps, shared helpers (`mountPane`, `toastsOf`, `recordSets`) replace copies, tests moved into describes named by feature, repeated and obsolete tests dropped. The module is tidied (`openEditor` and `editDraft` replace `openChoice`; the unused secret-masking path is gone).

### Fixed

- Opening a text or number editor puts the focus on its Input, and opening a choice puts it on the current option, so typing and Enter work without a click first (keys no longer fall through to the main prompt).
- A `choice` setting opens an inline row of option Buttons (`● current`, `○ other`) that can be clicked or Entered, instead of a Select list; the stray `:` before the value is gone, and picking the current option only collapses the row without writing.
- Changing a setting no longer shows a red "not changed" beside the row every time. In an interactive session `/config` run from a plugin answers with no text, so the menu now reads the row back after the write: a row that holds the new value (or the value a hook clamped it to) is a success. A row's note clears on its next write, is no longer drawn once the row shows another value, and is cleared when the pane is opened again.

## [0.1.12] - 2026-10-03

### Added

- Settings rows show their description dim after the value, clipped to the pane width and dropped under 8 cells; the filter matches it. A dim ` · ` separates it from the value or `/command` hint, and it is italic and truncated with `…` so it never takes a second row.

## [0.1.11] - 2026-10-03

### Removed

- The `buttonStyle` setting and its pill/box looks; buttons keep the bracket style. The plugin directory does not accept `options` in userConfig yet.

## [0.1.10] - 2026-10-03

### Fixed

- The menu's own section lists its settings (`buttonStyle`, `bandHotkeys`); its `quick-menu.json` had hidden them with an empty `settings` list.

## [0.1.9] - 2026-10-03

### Added

- A `buttonStyle` setting (`agent-quick-menu.buttonStyle`, in the menu's own section and /config) picks the look of command buttons, the band's favourites and Expand all / Collapse all: `brackets` (the default, `[ label ]`), `pill` (a filled one-line chip that hugs its label, lighter under the pointer; command hints stay aligned through a fixed-width slot) or `box` (a rounded three-row frame; the one-row band shows `pill` instead). Toggles, choices, stars and section titles keep their look. A change reloads the mod.

### Changed

- The band's `≣ menu` button (and hotkey `m`) toggles the menu: pressing it while the pane is open closes it. The label shows the state, `≣ menu ▾` open and `≣ menu ▸` closed, read from `$.ui.panes()` at each render and redrawn on `ui.close`, so closing with ×, Esc or a key is reflected. `/menu` still always opens or focuses it.
- A section title is clickable: the chevron and the title are one button in the accent colour, `[ ▾ title ]`, so a press anywhere on it (or Enter) folds or unfolds the section; counts and `built-in` stay dim.

### Fixed

- Commands a plugin registers after discovery (one after another in its session.start) no longer show as `(not available)`: availability is computed afresh from `$.command.list()` when the pane opens, on `/menu refresh`, and before a press on a command marked unavailable is refused.

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

[0.1.18]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.17...v0.1.18
[0.1.17]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.16...v0.1.17
[0.1.16]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.15...v0.1.16
[0.1.15]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.14...v0.1.15
[0.1.14]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.13...v0.1.14
[0.1.13]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/agentic-workbench/agent-quick-menu/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/agentic-workbench/agent-quick-menu/releases/tag/v0.1.0
