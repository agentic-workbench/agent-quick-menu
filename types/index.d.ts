/** Schema version of the menu file a plugin ships at `.claude-plugin/quick-menu.json`. */
export type QuickMenuVersion = 1

/** A command that asks for arguments when pressed: the hint shown in the empty field and the text it starts with. */
export type MenuAsk = { placeholder?: string; default?: string }

/** One quick-launch command of a menu file, as `/` would take it, without the slash. */
export type MenuCommand = {
  command: string
  label?: string
  args?: string
  description?: string
  ask?: MenuAsk
}

/** A validated menu file. `settings: null` means all of the plugin's `userConfig` rows. */
export type MenuFile = {
  version: QuickMenuVersion
  title?: string
  commands: MenuCommand[]
  settings: string[] | null
}

/** One command of a discovered section; `isAvailable` is false when `$.command.list()` lacks it. */
export type SectionCommand = {
  command: string
  label: string
  args?: string
  description?: string
  ask?: MenuAsk
  isAvailable: boolean
  /** From `$.command.list()`: where the command comes from and, for a plugin's, which plugin (no `@marketplace`). */
  source?: 'builtin' | 'plugin' | 'user' | 'mcp'
  owner?: string
}

/** One plugin's section: `file` when its menu file was read, `config` when only `userConfig` rows exist, `commands` when only its registered commands are known (loaded with `--plugin-dir`). */
export type MenuSection = {
  plugin: string
  title: string
  commands: SectionCommand[]
  settings: string[] | null
  source: 'file' | 'config' | 'commands'
  /** Dim line shown under the section's header while open. */
  note?: string
  /** A plugin bundled in the binary: its title carries a dim `built-in` tag. */
  isBuiltIn?: boolean
}

/** A plugin whose menu file or registry entry could not be used. */
export type MenuProblem = { plugin: string; message: string }

/** A row's note. `shown`: the row's value (as `/config key=value` spells it) when the note was made; the note is drawn only while the row still shows it. */
export type Note = { kind: 'deny' | 'error'; text: string; shown: string }

/** Transient per-row pane state: commands waiting on `$.command.run`, and the deny or error beside a row. */
export type RowState = {
  queued: Record<string, true>
  notes: Record<string, Note>
  /** The command whose button was pressed once and waits for the confirming press until `until` (`$.clock.now()` ms). */
  armed: { id: string; until: number }
}

/** A pinned command (key: command plus args) or setting (key: config key) of the plugin. */
export type Favourite = { kind: 'command' | 'setting'; plugin: string; key: string }

declare module 'claude-code' {
  interface PluginState {
    'agent-quick-menu': {
      sections: MenuSection[]
      problems: MenuProblem[]
      rowState: RowState
      favourites: Favourite[]
      folded: Record<string, boolean>
      unplaced: boolean
      filter: string
      /** `--plugin-dir` plugin name to root, from `plugin.register`, kept across a reload of this module. */
      inlineRoots: Record<string, string>
      /** The element key of the one choice or text row being edited; '' when all are folded to `value ▾` / `value ✎`. */
      openEditor: string
      /** The text in the open text editor, as last typed. */
      editDraft: string
    }
  }
}
