# The `.claude-plugin/quick-menu.json` convention

A plugin lists its quick-launch commands and settings for agent-quick-menu in `.claude-plugin/quick-menu.json`. The file is read only while agent-quick-menu is installed; it costs nothing otherwise.

Schema: `https://raw.githubusercontent.com/agentic-workbench/agent-quick-menu/main/schema/quick-menu.schema.json` (set it as `$schema` for editor completion).

## Fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `$schema` | string | none | Schema URL, for editors. Ignored by the menu. |
| `version` | `1` | required | Format version of this file (not the plugin's version). Currently 1. A file with an unknown format version is skipped and reported under Problems. |
| `title` | string, not blank | the plugin name | Section heading. Shown as `title · plugin` unless it equals the plugin name, in any case. |
| `commands` | array | none | Quick-launch commands, shown as buttons. |
| `settings` | array of string | all rows | `userConfig` field names of this plugin, in display order (non-empty, at most 64 characters). Omitted: all rows. `[]`: none. |

Each entry of `commands`:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `command` | string, non-empty | required | Command name as `/` takes it, without the slash. |
| `label` | string | the command | Button text. |
| `args` | string | none | Arguments passed as typed. |
| `description` | string | none | Dimmed help text. |

## Command names

Use the name the `/` typeahead shows, without the slash:

- a skill: `plugin:skill`
- a command registered by a mod plugin: its registered name
- a built-in command

Check a name by typing `/` in Claude Code. A command that is not available is hidden from the band.

## Settings

`settings` lists field names from the plugin's own `userConfig`. They appear as rows in the plugin's section, in the given order.

## Limits

- Rejected characters, in every displayed string (`title`, `label`, `command`, `args`, `description` and each `settings` name): control characters, line and paragraph separators, format characters (bidi marks, zero-width characters, soft hyphen, tag characters), private-use characters and variation selectors. A file holding one is skipped and reported under Problems.
- Lengths, counted in code points: `title` 60, `label` 40, `command` 64, `args` 500, `description` 200, a `settings` name 64. `title`, `label`, `command` and each `settings` name may not be blank.
- At most 50 `commands` and 50 `settings`.
- The file must be a regular file of at most 64 KiB, not a symlink.
- Reserved titles: `Claude Code`, `Favourites`, `built-in`, and the name of another plugin, in any case.
- `CLAUDE_CODE_PLUGIN_DIRS` is split on `:`, or on `;` where a drive letter holds a colon (Windows).

## Plugins without the file

A plugin without `quick-menu.json` gets a settings-only section when it has `userConfig` rows (all of them, no commands). Without rows it is not listed.

## Plugins loaded with `--plugin-dir`

The menu reads the file from a plugin's root. For a `--plugin-dir` plugin the root is learned from `plugin.register` when its hooks module loads after the menu's; otherwise the menu lists its registered commands only. Name the folder in `CLAUDE_CODE_PLUGIN_DIRS` (absolute paths, `:`-separated) to make the file load.

## Format versions

Unknown keys are ignored within format version 1, so fields can be added without breaking existing files. A new format version is introduced only for breaking changes.

## Examples

A mod plugin with registered commands:

```json
{
  "$schema": "https://raw.githubusercontent.com/agentic-workbench/agent-quick-menu/main/schema/quick-menu.schema.json",
  "version": 1,
  "title": "Runtime tools",
  "commands": [
    { "command": "rt-status", "label": "Status", "description": "Show runtime state" },
    { "command": "rt-reset", "label": "Reset", "args": "--soft" }
  ]
}
```

A skills-only plugin with `userConfig`:

```json
{
  "$schema": "https://raw.githubusercontent.com/agentic-workbench/agent-quick-menu/main/schema/quick-menu.schema.json",
  "version": 1,
  "commands": [
    { "command": "notes:daily", "label": "Daily note" },
    { "command": "notes:search", "args": "todo" }
  ],
  "settings": ["notes_dir", "auto_open"]
}
```
