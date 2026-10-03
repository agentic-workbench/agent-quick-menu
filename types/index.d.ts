/** Schema version of the menu file a plugin ships at `.claude-plugin/quick-menu.json`. */
export type QuickMenuVersion = 1

/** One quick-launch command of a menu file, as `/` would take it, without the slash. */
export type MenuCommand = {
  command: string
  label?: string
  args?: string
  description?: string
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
  isAvailable: boolean
}

/** One plugin's section: `file` when its menu file was read, `config` when only `userConfig` rows exist. */
export type MenuSection = {
  plugin: string
  title: string
  commands: SectionCommand[]
  settings: string[] | null
  source: 'file' | 'config'
}

/** A plugin whose menu file or registry entry could not be used. */
export type MenuProblem = { plugin: string; message: string }

declare module 'claude-code' {
  interface PluginState {
    'agent-quick-menu': {
      sections: MenuSection[]
      problems: MenuProblem[]
    }
  }
}
