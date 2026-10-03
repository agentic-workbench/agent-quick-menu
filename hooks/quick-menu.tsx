import { atom, read, update } from 'claude-code'
import type { CommandInfo, ConfigRow, ConfigValue, Elements, EngineInterface, Register, RenderElement, RenderInput, RenderNode } from 'claude-code'

import type { Favourite, MenuCommand, MenuFile, MenuProblem, MenuSection, Note, RowState, SectionCommand } from '../types'

const PANE_ID = 'quick-menu'
const MENU_FILE = '.claude-plugin/quick-menu.json'
const BUILTIN_PREFIX = 'cc-plugin-'
const ENGINE = 'engine'
const MENU_COMMAND = 'menu'
const REFRESH = 'refresh'
const DISARMED = { id: '', until: 0 }

// Module state: the atoms live in the engine's `$.state` (they outlive a reload), the `let`s and the map in this instance.
const sections = atom({ plugin: 'agent-quick-menu', key: 'sections' } as const, [] as MenuSection[])
const problems = atom({ plugin: 'agent-quick-menu', key: 'problems' } as const, [] as MenuProblem[])
const favourites = atom({ plugin: 'agent-quick-menu', key: 'favourites' } as const, [] as Favourite[])
const folded = atom({ plugin: 'agent-quick-menu', key: 'folded' } as const, {} as Record<string, boolean>)
const unplaced = atom({ plugin: 'agent-quick-menu', key: 'unplaced' } as const, false)
const filter = atom({ plugin: 'agent-quick-menu', key: 'filter' } as const, '')
/** The element key of the one choice or text row being edited; '' when none. */
const openEditor = atom({ plugin: 'agent-quick-menu', key: 'openEditor' } as const, '')
/** The text in the open text editor, as last typed. */
const editDraft = atom({ plugin: 'agent-quick-menu', key: 'editDraft' } as const, '')
const rowState = atom({ plugin: 'agent-quick-menu', key: 'rowState' } as const, {
  queued: {},
  notes: {},
  armed: DISARMED,
} as RowState)
const inlineRootState = atom({ plugin: 'agent-quick-menu', key: 'inlineRoots' } as const, {} as Record<string, string>)

let sessionCwd = ''
let sessionStarted = false
let discoveryRun = 0
/** The `bandHotkeys` option: digit hotkeys on the band's own-plugin commands; off unless the person turns it on. */
let bandHotkeys = false
/**
 * Roots of `--plugin-dir` plugins, learned from `plugin.register` (the only place the types hand out another plugin's `root`).
 * `plugin.register` fires once per load of the other plugin, never again when this module reloads, so the roots are kept in
 * `$.state` (which outlives a reload) as well as here (which outlives a new session in the same process).
 */
const inlineRoots = new Map<string, string>()

/** Cells a button takes beyond its label (`[ ` and ` ]`), and the gap that follows it. */
const BUTTON_CHROME = 4
const BUTTON_GAP = 2
/** A star and the space after it; the ` · ` before a description; the least room a description is worth drawing in. */
const STAR_CELLS = 2
const SEP_CELLS = 3
const MIN_HELP_CELLS = 8
/** The band: the menu button's chrome (`[ `, ` ▾`, ` ]` and the gap), a digit hotkey's `1 `, and the divider plus the engine's `[-]`. */
const MENU_BUTTON_CHROME = 5
const DIGIT_CELLS = 3
const BAND_RESERVE = 6
const MAX_RUNS_HINT = 60
const MAX_TOAST = 200
const MAX_PROBLEM_PLUGIN = 100
const MAX_VERSION_TEXT = 20
const PANE_COLUMNS = 100

/** Limits on a menu file (a plugin's text, so untrusted); the schema mirrors them. */
const MAX_FILE_BYTES = 64 * 1024
const MAX_COMMANDS = 50
const MAX_SETTINGS = 50
const MAX_FAVOURITES = 50
const MAX_SHOWN_COMMANDS = 30
const MAX_PROBLEM = 300
const CONFIRM_MS = 5000
const LIMITS = { title: 60, label: 40, command: 64, args: 500, description: 200 } as const
/** Control, line, bidi and zero-width characters: never shown, never accepted. */
const BAD_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/u
const BAD_CHARS_ALL = new RegExp(BAD_CHARS.source, 'gu')
const RESERVED_TITLES = ['claude code', 'favourites', 'built-in']

/** Text from outside, safe to show: bad characters replaced, cut to `max`. */
const clean = (text: string, max = MAX_PROBLEM): string => text.replace(BAD_CHARS_ALL, '?').slice(0, max)

/** Display width of a label in cells: code points, not UTF-16 units. */
function width(text: string): number {
  return [...text].length
}

/** Cut to `max` characters, ending in an ellipsis. */
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

const pad = (text: string, to: number): string => text + ' '.repeat(Math.max(0, to - width(text)))

/** A path the engine's registry or the environment names must be absolute. */
const isAbsolutePath = (p: string): boolean => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)

type Validation = { ok: true; value: MenuFile } | { ok: false; error: string }

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Why `value` is not an acceptable menu string, or null. A lone `label` or `command` must hold more than blanks. */
function textError(where: string, value: unknown, max: number, nonBlank = false): string | null {
  if (typeof value !== 'string') return `${where} must be a ${nonBlank ? 'non-empty ' : ''}string`
  if (nonBlank && value.trim() === '') return `${where} must be a non-empty string`
  if (BAD_CHARS.test(value)) return `${where} holds a control, line-break, bidi or zero-width character`
  if ([...value].length > max) return `${where} is longer than ${max} characters`
  return null
}

function validateCommand(c: unknown, i: number): { ok: true; value: MenuCommand } | { ok: false; error: string } {
  if (!isObject(c)) return { ok: false, error: `commands[${i}] must be an object` }
  const bad = textError(`commands[${i}].command`, c.command, LIMITS.command, true)
  if (bad) return { ok: false, error: bad }
  const value: MenuCommand = { command: c.command as string }
  for (const key of ['label', 'args', 'description'] as const) {
    const field = c[key]
    if (field === undefined) continue
    const error = textError(`commands[${i}].${key}`, field, LIMITS[key], key === 'label')
    if (error) return { ok: false, error }
    value[key] = field as string
  }
  return { ok: true, value }
}

/** Validates a menu file; `reserved` are the lower-cased names a title may not take (other plugins'). */
export function validateMenuFile(json: unknown, reserved: readonly string[] = []): Validation {
  if (!isObject(json)) return { ok: false, error: 'menu file must be a JSON object' }
  if (json.version !== 1) {
    return { ok: false, error: `unsupported version ${clean(String(JSON.stringify(json.version)), MAX_VERSION_TEXT)} (expected 1)` }
  }
  if (json.title !== undefined) {
    const bad = textError('title', json.title, LIMITS.title)
    if (bad) return { ok: false, error: bad }
    if ([...RESERVED_TITLES, ...reserved].includes((json.title as string).trim().toLowerCase())) {
      return { ok: false, error: 'title is reserved (Claude Code, Favourites, built-in or another plugin)' }
    }
  }
  let commands: MenuCommand[] = []
  if (json.commands !== undefined) {
    if (!Array.isArray(json.commands)) return { ok: false, error: 'commands must be an array' }
    if (json.commands.length > MAX_COMMANDS) return { ok: false, error: `commands has more than ${MAX_COMMANDS} entries` }
    commands = []
    for (const [i, c] of json.commands.entries()) {
      const r = validateCommand(c, i)
      if (!r.ok) return r
      commands.push(r.value)
    }
  }
  let settings: string[] | null = null
  if (json.settings !== undefined) {
    if (!Array.isArray(json.settings) || json.settings.some(s => typeof s !== 'string' || s === '')) {
      return { ok: false, error: 'settings must be an array of non-empty strings' }
    }
    if (json.settings.length > MAX_SETTINGS) return { ok: false, error: `settings has more than ${MAX_SETTINGS} entries` }
    settings = [...(json.settings as string[])]
  }
  return { ok: true, value: { version: 1, title: json.title as string | undefined, commands, settings } }
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const decodeText = (raw: string | Uint8Array): string => (typeof raw === 'string' ? raw : new TextDecoder().decode(raw))

async function readJson($: EngineInterface, path: string): Promise<unknown> {
  return JSON.parse(decodeText(await $.fs.read(path)))
}

type Target = { name: string; root: string }

/** The plugin name without its `@<marketplace>` suffix. */
const bareName = (id: string): string => id.split('@')[0] ?? id

const PLUGIN_DIR_NOTE = 'loaded with --plugin-dir: set CLAUDE_CODE_PLUGIN_DIRS to read its quick-menu.json'

/** Plugins whose commands are not claimed by a built-in prefix or the engine. */
const isForeign = (name: string): boolean => name !== ENGINE && !name.startsWith(BUILTIN_PREFIX)

/** The install entry for this session: a project or local one for the cwd, else the user one (no other scope applies here). */
function chooseEntry(entries: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(entries)) return undefined
  const objects = entries.filter(isObject)
  const here = objects.find(
    x => (x.scope === 'project' || x.scope === 'local') && sessionCwd !== '' && x.projectPath === sessionCwd,
  )
  return here ?? objects.find(x => x.scope === 'user')
}

async function registryTargets($: EngineInterface, issues: MenuProblem[]): Promise<Target[]> {
  let enabled: string[] = []
  try {
    const settings = (await $.settings.read()) as { enabledPlugins?: Record<string, unknown> }
    enabled = Object.entries(settings.enabledPlugins ?? {})
      .filter(([, enabledFlag]) => enabledFlag === true)
      .map(([id]) => id)
  } catch (err) {
    issues.push({ plugin: 'settings', message: `cannot read settings: ${message(err)}` })
  }
  if (enabled.length === 0) return []
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  let base: string
  if (configDir) {
    if (!isAbsolutePath(configDir)) {
      issues.push({ plugin: 'CLAUDE_CONFIG_DIR', message: 'must be an absolute path; plugin registry skipped' })
      return []
    }
    base = configDir
  } else {
    const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
    if (!home || !isAbsolutePath(home)) return []
    base = `${home.replace(/[\\/]+$/, '')}/.claude`
  }
  const registryPath = `${base}/plugins/installed_plugins.json`
  let plugins: Record<string, unknown> = {}
  try {
    const json = await readJson($, registryPath)
    if (isObject(json) && isObject(json.plugins)) plugins = json.plugins
  } catch (err) {
    issues.push({ plugin: 'installed_plugins.json', message: `cannot read ${registryPath}: ${message(err)}` })
    return []
  }
  const targets: Target[] = []
  for (const id of enabled) {
    const entry = chooseEntry(plugins[id])
    if (!entry || typeof entry.installPath !== 'string') continue
    if (!isAbsolutePath(entry.installPath)) {
      issues.push({ plugin: bareName(id), message: 'installPath is not absolute; skipped' })
      continue
    }
    targets.push({ name: bareName(id), root: entry.installPath })
  }
  return targets
}

/** `--plugin-dir` folders: `CLAUDE_CODE_PLUGIN_DIRS`, then the roots `plugin.register` handed out. */
async function dirTargets($: EngineInterface, issues: MenuProblem[]): Promise<Target[]> {
  const raw = await $.env.get('CLAUDE_CODE_PLUGIN_DIRS')
  const targets: Target[] = []
  // `;` separates the folders where a drive letter holds a colon (Windows), `:` elsewhere.
  const separator = /^[A-Za-z]:[\\/]/.test(raw ?? '') || (raw ?? '').includes(';') ? ';' : ':'
  for (const root of (raw ?? '').split(separator).filter(Boolean)) {
    try {
      if (!isAbsolutePath(root)) throw new Error('not an absolute path')
      const manifest = await readJson($, `${root}/.claude-plugin/plugin.json`)
      const name = isObject(manifest) ? manifest.name : undefined
      if (typeof name !== 'string' || name === '') throw new Error('plugin.json has no name')
      targets.push({ name, root })
    } catch (err) {
      issues.push({ plugin: root, message: `cannot identify plugin dir: ${message(err)}` })
    }
  }
  let kept: Record<string, string> = {}
  try {
    kept = await read($, inlineRootState)
  } catch {
    // The kept roots are a convenience: without them only the in-process ones count.
  }
  for (const [name, root] of [...inlineRoots, ...Object.entries(kept)]) if (isAbsolutePath(root)) targets.push({ name, root })
  return targets
}

async function readMenuFile(
  $: EngineInterface,
  target: Target,
  issues: MenuProblem[],
  reserved: readonly string[],
): Promise<MenuFile | null> {
  const path = `${target.root}/${MENU_FILE}`
  const problem = (text: string): null => (issues.push({ plugin: target.name, message: `${path}: ${text}` }), null)
  try {
    if (!(await $.fs.exists(path))) return null
    const stat = await $.fs.stat(path)
    if (stat.kind !== 'file' || stat.isLink) return problem('must be a regular file, not a link')
    if (stat.size > MAX_FILE_BYTES) return problem(`larger than ${MAX_FILE_BYTES / 1024} KiB`)
    const text = decodeText(await $.fs.read(path))
    if (text.length > MAX_FILE_BYTES) return problem(`larger than ${MAX_FILE_BYTES / 1024} KiB`)
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return problem('not valid JSON')
    }
    const result = validateMenuFile(json, reserved)
    return result.ok ? result.value : problem(result.error)
  } catch (err) {
    return problem(message(err))
  }
}

/** The file's title, with the plugin's name after it unless that is the title already. */
function sectionTitle(title: string | undefined, name: string): string {
  if (title === undefined) return name
  return title.toLowerCase() === name.toLowerCase() ? title : `${title} · ${name}`
}

/** Plugins the registry and the known roots do not explain (a `--plugin-dir` one): their registered commands, no menu file. */
function commandSections(listed: readonly CommandInfo[], targets: readonly Target[]): MenuSection[] {
  const known = new Set(targets.map(t => t.name))
  const byPlugin = new Map<string, SectionCommand[]>()
  for (const c of listed) {
    if (c.source !== 'plugin' || !c.plugin) continue
    const name = bareName(c.plugin)
    if (known.has(name) || !isForeign(name)) continue
    const list = byPlugin.get(name) ?? []
    list.push({
      command: c.name,
      label: c.name,
      ...(c.description !== '' && { description: c.description }),
      isAvailable: true,
      source: c.source,
      owner: name,
    })
    byPlugin.set(name, list)
  }
  return [...byPlugin].map(([plugin, commands]) => ({
    plugin,
    title: plugin,
    commands,
    settings: null,
    source: 'commands' as const,
    note: PLUGIN_DIR_NOTE,
  }))
}

/** What a listed command (or its absence) says about a menu command. */
function availability(info: CommandInfo | undefined): Pick<SectionCommand, 'isAvailable' | 'source' | 'owner'> {
  if (!info) return { isAvailable: false }
  return { isAvailable: true, source: info.source, ...(info.plugin !== undefined && { owner: bareName(info.plugin) }) }
}

/** The file sections' commands marked against `listed`; the sections of commands the engine itself lists stay. */
function applyListing(fileSections: readonly MenuSection[], listed: readonly CommandInfo[]): MenuSection[] {
  const byName = new Map(listed.map(c => [c.name, c]))
  return fileSections.map(section =>
    section.source !== 'file'
      ? section
      : {
          ...section,
          commands: section.commands.map(({ source: _s, owner: _o, ...c }) => ({ ...c, ...availability(byName.get(c.command)) })),
        },
  )
}

/**
 * Lists the commands afresh and marks every section against that, so a command registered after discovery (plugins
 * register one after another in their session.start) shows as available. Null when the engine cannot list them.
 */
async function refreshListing($: EngineInterface): Promise<CommandInfo[] | null> {
  let listed: CommandInfo[]
  try {
    listed = await $.command.list()
  } catch {
    return null
  }
  await update($, sections, s => applyListing(s, listed))
  return listed
}

/**
 * Reads every enabled plugin's menu file and builds the file sections; failures become problems.
 * The first root per name wins: this plugin's own (`$.plugin.root`, which `plugin.register` never hands it), then the
 * `--plugin-dir` folders, then the installed copies they shadow.
 */
async function discover($: EngineInterface): Promise<{ sections: MenuSection[]; problems: MenuProblem[] }> {
  const issues: MenuProblem[] = []
  const all = [
    { name: $.plugin.name, root: $.plugin.root },
    ...(await dirTargets($, issues)),
    ...(await registryTargets($, issues)),
  ]
  const targets = all.filter((t, i) => all.findIndex(o => o.name === t.name) === i)

  let listed: CommandInfo[] = []
  try {
    listed = await $.command.list()
  } catch (err) {
    issues.push({ plugin: 'commands', message: `cannot list commands: ${message(err)}` })
  }

  const byName = new Map(listed.map(c => [c.name, c]))
  const result: MenuSection[] = []
  for (const target of targets) {
    const reserved = targets.filter(t => t.name !== target.name).map(t => bareName(t.name).toLowerCase())
    const file = await readMenuFile($, target, issues, reserved)
    if (file) {
      result.push({
        plugin: target.name,
        title: sectionTitle(file.title, target.name),
        commands: file.commands.map(c => ({
          command: c.command,
          label: c.label ?? c.command,
          ...(c.args !== undefined && { args: c.args }),
          ...(c.description !== undefined && { description: c.description }),
          ...availability(byName.get(c.command)),
        })),
        settings: file.settings,
        source: 'file',
      })
    }
  }
  result.push(...commandSections(listed, targets))
  result.sort((a, b) => a.title.localeCompare(b.title))
  return { sections: result, problems: issues.map(p => ({ plugin: clean(p.plugin, MAX_PROBLEM_PLUGIN), message: clean(p.message) })) }
}

/** Discovers and stores the sections; a run overtaken by a later one leaves the later one's answer standing. */
async function runDiscovery($: EngineInterface): Promise<{ sections: number; problems: number } | null> {
  const run = ++discoveryRun
  const discovered = await discover($)
  if (run !== discoveryRun) return null
  await update($, sections, () => discovered.sections)
  await update($, problems, () => discovered.problems)
  // The listing discovery took may predate a registration still under way; mark against a fresh one.
  await refreshListing($)
  $.ui.invalidate('ui.render')
  return { sections: discovered.sections.length, problems: discovered.problems.length }
}

/** Starts a discovery without holding the dispatch that asked for it; `announce` toasts its counts, failures always toast. */
function startDiscovery($: EngineInterface, announce = false): void {
  void runDiscovery($).then(
    counts => {
      if (counts && announce) $.ui.toast(`Quick menu refreshed: ${counts.sections} sections, ${counts.problems} problems`)
    },
    err => $.ui.toast(toastLine(`Quick menu: discovery failed: ${message(err)}`)),
  )
}

/** `/menu`: opens the pane, or starts a refresh, and answers at once; discovery runs on its own and redraws when it lands. */
async function openMenu($: EngineInterface, args: string): Promise<{ text: string }> {
  if (args.trim() === REFRESH) {
    startDiscovery($, true)
    return { text: 'Quick menu: discovering plugin menus again' }
  }
  await openPane($)
  return { text: 'Quick menu opened' }
}

/** Commands this plugin registers; the menu answers them itself (runAny). */
const OWN_COMMANDS = new Set([MENU_COMMAND])

/**
 * Runs a command a row or the band names. This plugin's own are answered here: the engine leaves a plugin's own hooks
 * out of the `command.run` its own `$.command.run` raises (re-entry), so that call would reach the engine's
 * "registered /menu but no command.run hook answered it".
 */
async function runAny($: EngineInterface, c: SectionCommand): Promise<{ text?: string }> {
  if (OWN_COMMANDS.has(c.command)) {
    const answer = await openMenu($, c.args ?? '')
    // A refresh toasts its counts when discovery lands; a toast now would push that one out (toasts are spaced 2 s).
    return (c.args ?? '').trim() === REFRESH ? {} : answer
  }
  return $.command.run({ command: c.command, ...(c.args !== undefined && { args: c.args }) })
}

const commandKey = (plugin: string, c: SectionCommand): string => `cmd:${plugin}:${c.command}:${c.args ?? ''}`
const settingKey = (key: string): string => `set:${key}`

const toastLine = (text: string): string => (text.split('\n')[0] ?? '').slice(0, MAX_TOAST)

async function setNote($: EngineInterface, id: string, note: Note | null): Promise<void> {
  await update($, rowState, s => {
    const notes = { ...s.notes }
    if (note) notes[id] = note
    else delete notes[id]
    return { ...s, notes }
  })
}

async function setQueued($: EngineInterface, id: string, isQueued: boolean): Promise<void> {
  await update($, rowState, s => {
    const queued = { ...s.queued }
    if (isQueued) queued[id] = true
    else delete queued[id]
    return { ...s, queued }
  })
}

/** Who a command belongs to, when that is not the section's own plugin: the tag shown beside it and the reason to confirm. */
function runsTag(plugin: string, c: SectionCommand): string | null {
  if (!c.isAvailable) return null
  if (c.source === 'plugin' && c.owner !== undefined && c.owner === bareName(plugin)) return null
  if (c.source === 'builtin') return 'runs a built-in'
  if (c.source === 'plugin' && c.owner !== undefined) return `runs ${c.owner}`
  if (c.source === 'user') return 'runs a user command'
  if (c.source === 'mcp') return 'runs an MCP command'
  return 'runs a command of unknown origin'
}

/** Ends an arming that nobody confirmed in time; a newer arming stands. */
async function disarm($: EngineInterface, id: string, until: number): Promise<void> {
  await update($, rowState, st => (st.armed.id === id && st.armed.until === until ? { ...st, armed: DISARMED } : st))
  $.ui.invalidate('ui.render')
}

/** Waits out the confirm window, then ends that arming. */
async function expireArming($: EngineInterface, id: string, until: number): Promise<void> {
  try {
    await $.clock.sleep(CONFIRM_MS)
    await disarm($, id, until)
  } catch {
    // The module was unloaded or the session ended while waiting: nothing is left to disarm.
  }
}

/**
 * A press on a button. A command of another plugin or a built-in first arms (the button reads "press again: /x") and runs
 * on a second press within 5 s, in the pane or the band alike.
 */
async function pressCommand($: EngineInterface, plugin: string, shown: SectionCommand): Promise<void> {
  let c = shown
  if (!c.isAvailable) {
    // Marked unavailable by a listing that may predate its registration: ask again before refusing.
    const listed = await refreshListing($)
    const info = listed?.find(x => x.name === c.command)
    if (!info) {
      $.ui.toast(toastLine(`Quick menu: /${c.command} is not available`))
      $.ui.invalidate('ui.render')
      return
    }
    c = { ...c, ...availability(info) }
    $.ui.invalidate('ui.render')
  }
  if (runsTag(plugin, c) !== null) {
    const id = commandKey(plugin, c)
    const now = await $.clock.now()
    const armed = (await read($, rowState)).armed
    if (armed.id !== id || now >= armed.until) {
      const until = now + CONFIRM_MS
      await update($, rowState, st => ({ ...st, armed: { id, until } }))
      void expireArming($, id, until)
      $.ui.invalidate('ui.render')
      return
    }
    await update($, rowState, st => ({ ...st, armed: DISARMED }))
  }
  await runCommand($, plugin, c)
}

async function runCommand($: EngineInterface, plugin: string, c: SectionCommand): Promise<void> {
  const id = commandKey(plugin, c)
  let claimed = false
  await update($, rowState, s => {
    claimed = false
    if (s.queued[id]) return s
    claimed = true
    return { ...s, queued: { ...s.queued, [id]: true as const } }
  })
  if (!claimed) return
  $.ui.invalidate('ui.render')
  try {
    const result = await runAny($, c)
    if (result.text) $.ui.toast(toastLine(result.text))
  } catch (err) {
    $.ui.toast(toastLine(message(err)))
  } finally {
    await setQueued($, id, false)
    $.ui.invalidate('ui.render')
  }
}

/** A value as `/config key=value` takes it: bare text (quotes would become part of the value), a list comma-joined. */
const configArg = (value: ConfigValue): string => (typeof value === 'object' ? value.join(',') : String(value))

/** The row as `$.config.list()` has it now; undefined when it is gone or the list cannot be read. */
async function currentRow($: EngineInterface, key: string): Promise<ConfigRow | undefined> {
  try {
    return (await $.config.list()).find(r => r.key === key)
  } catch {
    return undefined
  }
}

/**
 * Writes one row through `/config <key>=<value>`, then reads the row back: the value it holds decides, not the reply.
 * In an interactive session `$.command.run` resolves `{}` for `/config` (its "Set <label> to <value>" goes to the
 * transcript only), so the reply text cannot tell a write from a refusal; a headless one answers with text.
 */
async function writeSetting($: EngineInterface, row: ConfigRow, value: ConfigValue): Promise<void> {
  const id = settingKey(row.key)
  const before = configArg(row.value)
  await setNote($, id, null)
  try {
    const result = await $.command.run({ command: 'config', args: `${row.key}=${configArg(value)}` })
    const text = (result.text ?? '').trim()
    const now = await currentRow($, row.key)
    if (now) {
      const after = configArg(now.value)
      // Written (as asked, or as a config.set hook clamped it), or asked for the value it already held: no refusal.
      if (after !== configArg(value) && after === before) await setNote($, id, { kind: 'deny', text: text || 'not changed', shown: after })
    } else if (text !== '' && !text.startsWith('Set ') && !/not changed|already/i.test(text)) {
      // The row cannot be read back: only a reply that is no write and no "unchanged" is a refusal.
      await setNote($, id, { kind: 'deny', text, shown: before })
    }
  } catch (err) {
    await setNote($, id, { kind: 'error', text: message(err), shown: before })
  }
  $.ui.invalidate('ui.render')
}

/** Sets the open editor and its draft without drawing: the caller draws once, after what it does next. */
async function putEditor($: EngineInterface, id: string, draft = ''): Promise<void> {
  await update($, openEditor, () => id)
  await update($, editDraft, () => draft)
}

/** Opens the editor of row `id` (with `draft` in a text one), or closes every one with ''; draws. */
async function setOpenEditor($: EngineInterface, id: string, draft = ''): Promise<void> {
  await putEditor($, id, draft)
  $.ui.invalidate('ui.render')
}

/** Keeps what the person typed, so the save button knows it; the field already shows it, so no redraw. */
async function setDraft($: EngineInterface, text: string): Promise<void> {
  await update($, editDraft, () => text)
}

/** A pick of another option in an open choice row: folds the row back to `value ▾`, then writes the value (and draws). */
async function pickChoice($: EngineInterface, row: ConfigRow, value: string): Promise<void> {
  await putEditor($, '')
  await writeSetting($, row, value)
}

/**
 * Saves a text or number editor: an unchanged value just closes it, an invalid number says so and stays open, anything else
 * closes it and writes once.
 */
async function saveEdit($: EngineInterface, row: ConfigRow, raw: string): Promise<void> {
  let value: ConfigValue = raw
  if (row.kind === 'number') {
    const n = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(n)) {
      await setNote($, settingKey(row.key), { kind: 'error', text: `"${raw}" is not a number`, shown: configArg(row.value) })
      await setDraft($, raw)
      $.ui.invalidate('ui.render')
      return
    }
    value = n
  }
  if (configArg(value) === configArg(row.value)) {
    await setOpenEditor($, '')
    return
  }
  await putEditor($, '')
  await writeSetting($, row, value)
}

/** The save button: saves what was last typed. */
async function saveDraft($: EngineInterface, row: ConfigRow): Promise<void> {
  await saveEdit($, row, await read($, editDraft))
}

/** The cancel button: closes the editor without a write, and drops the note an invalid number left. */
async function cancelEdit($: EngineInterface, row: ConfigRow): Promise<void> {
  await setNote($, settingKey(row.key), null)
  await setOpenEditor($, '')
}

type Ui = ReturnType<EngineInterface['ui']['resolve']>

const favCommandKey = (c: SectionCommand): string => (c.args ? `${c.command} ${c.args}` : c.command)
const sameFav = (a: Favourite, b: Favourite): boolean =>
  a.kind === b.kind && a.plugin === b.plugin && a.key === b.key

function isFavourite(list: readonly Favourite[], f: Favourite): boolean {
  return list.some(x => sameFav(x, f))
}

function isFavourites(v: unknown): v is Favourite[] {
  return (
    Array.isArray(v) &&
    v.every(
      x =>
        isObject(x) &&
        (x.kind === 'command' || x.kind === 'setting') &&
        typeof x.plugin === 'string' &&
        typeof x.key === 'string',
    )
  )
}

function isFolds(v: unknown): v is Record<string, boolean> {
  return isObject(v) && Object.values(v).every(x => typeof x === 'boolean')
}

/** A value kept in `$.store` under `key`; a stored value `guard` refuses reads as `fallback`. */
type Stored<T> = { key: string; guard: (v: unknown) => v is T; fallback: T; clamp: (v: T) => T }

const FAVOURITES: Stored<Favourite[]> = {
  key: 'favourites',
  guard: isFavourites,
  fallback: [],
  clamp: list => list.slice(0, MAX_FAVOURITES),
}
const FOLDS: Stored<Record<string, boolean>> = { key: 'folded', guard: isFolds, fallback: {}, clamp: v => v }

async function storedValue<T>($: EngineInterface, s: Stored<T>): Promise<T> {
  try {
    const stored: unknown = await $.store.get(s.key)
    return s.guard(stored) ? s.clamp(stored) : s.fallback
  } catch {
    return s.fallback
  }
}

async function loadFavourites($: EngineInterface): Promise<void> {
  const stored = await storedValue($, FAVOURITES)
  await update($, favourites, () => stored)
}

async function loadFolds($: EngineInterface): Promise<void> {
  const stored = await storedValue($, FOLDS)
  await update($, folded, () => stored)
}

/** Writes `$.store`; a failure toasts and answers false. */
async function saveStore($: EngineInterface, key: string, value: unknown): Promise<boolean> {
  try {
    await $.store.set(key, value)
    return true
  } catch (err) {
    $.ui.toast(toastLine(`Quick menu: cannot save ${key}: ${message(err)}`))
    return false
  }
}

/** The stores are written and mirrored in their atoms alike: save, then the atom, then a draw; a failed save changes neither. */
async function writeFavourites($: EngineInterface, next: Favourite[]): Promise<void> {
  if (!(await saveStore($, FAVOURITES.key, next))) return
  await update($, favourites, () => next)
  $.ui.invalidate('ui.render')
}

async function writeFolds($: EngineInterface, next: Record<string, boolean>): Promise<void> {
  if (!(await saveStore($, FOLDS.key, next))) return
  await update($, folded, () => next)
  $.ui.invalidate('ui.render')
}

async function toggleFavourite($: EngineInterface, f: Favourite): Promise<void> {
  const list = await storedValue($, FAVOURITES)
  const pinned = isFavourite(list, f)
  if (!pinned && list.length >= MAX_FAVOURITES) {
    $.ui.toast(`Quick menu: at most ${MAX_FAVOURITES} favourites`)
    return
  }
  await writeFavourites($, pinned ? list.filter(x => !sameFav(x, f)) : [...list, f])
}

/** What a row is drawn from: the context every row of a block shares. `hasFields`: the surface draws Input (the mobile table has none; its stand-ins draw nothing). `pad`: the block's longest setting label; `cmdPad`: its longest command label; `open`: the key of the row whose editor is open; `draft`: the text in a text editor. */
type RowCtx = {
  list: readonly Favourite[]
  prefix: string
  hasFields: boolean
  pad: number
  cmdPad: number
  open: string
  draft: string
  columns: number
}

function renderStar($: EngineInterface, ui: Ui, f: Favourite, id: string, ctx: RowCtx) {
  const { Button } = ui
  const pinned = isFavourite(ctx.list, f)
  return (
    <Button
      key={`${ctx.prefix}star:${id}`}
      label={pinned ? '★' : '☆'}
      plain
      {...(pinned ? {} : { dimColor: true })}
      onPress={() => void toggleFavourite($, f)}
    />
  )
}

/** The dim ` · description` that takes what is left of the line and truncates; nothing when there is none. */
function renderHelp(ui: Ui, help: string | null) {
  if (help === null) return null
  const { Box, Text } = ui
  return (
    <Box flexDirection="row" flexShrink={1}>
      <Text dimColor>{' · '}</Text>
      <Box flexShrink={1}>
        <Text dimColor italic wrap="truncate-end">{help}</Text>
      </Box>
    </Box>
  )
}

/** `text` cut to `room` cells, or null when it is missing or `room` is under MIN_HELP_CELLS. */
const helpFor = (text: string | undefined, room: number): string | null =>
  text && room >= MIN_HELP_CELLS ? clip(text, room) : null

/** The Input element of a surface that has one (the mobile table has none). */
const inputOf = (ui: Ui) => (ui as Partial<Pick<Elements['terminal'], 'Input'>>).Input

/** A row's control and the cells it takes (label included), so the description gets what is left. An open editor takes the line. */
type Drawn = { control: RenderNode; cells: number }
const WHOLE_LINE = Number.POSITIVE_INFINITY

/** What one setting row shows: its key in the tree, the padded label and the value as text. */
type SettingView = { row: ConfigRow; id: string; label: string; shown: string }

/** Folded to `value ▾`; pressed, `value ▴` and a row of option Buttons (`● current`, `○ other`), or under the value when the line is too short. */
function renderChoice($: EngineInterface, ui: Ui, v: SettingView, options: readonly string[], ctx: RowCtx): Drawn {
  const { Box, Text, Button } = ui
  const { row, id, label, shown } = v
  const open = ctx.open === id
  const toggle = (
    <Button key={id} label={`${shown} ${open ? '▴' : '▾'}`} plain onPress={() => void setOpenEditor($, open ? '' : id)} />
  )
  const head = (
    <Box key={`choice:${id}`} flexDirection="row">
      <Text>{`${label}  `}</Text>
      {toggle}
    </Box>
  )
  if (!open) return { control: head, cells: width(label) + 2 + width(shown) + 2 }
  const buttons = options.map(value => (
    <Box key={`opt:${id}:${value}`} flexDirection="row">
      <Text> </Text>
      <Button
        key={`${id}:${value}`}
        label={`${value === shown ? '●' : '○'} ${value}`}
        plain
        onPress={() => void (value === shown ? setOpenEditor($, '') : pickChoice($, row, value))}
      />
    </Box>
  ))
  const optionsWidth = options.reduce((sum, value) => sum + 1 + 2 + width(value), 0)
  const indent = STAR_CELLS + width(label) + 2
  const fits = indent + width(shown) + 2 + optionsWidth <= ctx.columns
  const control = fits ? (
    <Box key={`choice:${id}`} flexDirection="row">
      <Text>{`${label}  `}</Text>
      {toggle}
      {buttons}
    </Box>
  ) : (
    <Box key={`choice:${id}`} flexDirection="column">
      {head}
      <Box flexDirection="row">
        <Text>{' '.repeat(indent - STAR_CELLS)}</Text>
        {buttons}
      </Box>
    </Box>
  )
  return { control, cells: WHOLE_LINE }
}

/** A text or number value: `value ✎` until pressed, then an Input with save and cancel; Enter saves. */
function renderTextEdit($: EngineInterface, ui: Ui, v: SettingView, Input: NonNullable<ReturnType<typeof inputOf>>, ctx: RowCtx): Drawn {
  const { Box, Text, Button } = ui
  const { row, id, label, shown } = v
  if (ctx.open !== id) {
    const control = (
      <Box key={`field:${id}`} flexDirection="row">
        <Text>{`${label}  `}</Text>
        <Button key={id} label={`${shown} ✎`} plain onPress={() => void setOpenEditor($, id, shown)} />
      </Box>
    )
    return { control, cells: width(label) + 2 + width(shown) + 2 }
  }
  // The label is its own Text: an Input's own label draws a `: ` before the value.
  const control = (
    <Box key={`field:${id}`} flexDirection="row" columnGap={1}>
      <Text>{`${label} `}</Text>
      <Input
        key={id}
        value={ctx.draft}
        autoFocus
        onInput={(value: string) => void setDraft($, value)}
        onSubmit={(value: string) => void saveEdit($, row, value)}
      />
      <Button key={`${id}:save`} label="✓ save" onPress={() => void saveDraft($, row)} />
      <Button key={`${id}:cancel`} label="✕ cancel" onPress={() => void cancelEdit($, row)} />
    </Box>
  )
  return { control, cells: WHOLE_LINE }
}

function renderBoolean($: EngineInterface, ui: Ui, v: SettingView): Drawn {
  const { Box, Text, Button } = ui
  const { row, id, label } = v
  const word = row.value ? 'on' : 'off'
  const control = (
    <Box key={`bool:${id}`} flexDirection="row">
      <Text>{`${label}  `}</Text>
      {row.value ? <Text color="green">●</Text> : <Text color="gray">○</Text>}
      <Text> </Text>
      <Button key={id} label={word} plain onPress={() => void writeSetting($, row, !row.value)} />
    </Box>
  )
  // The glyph, a space, the word and one cell the plain button keeps.
  return { control, cells: width(label) + 2 + 1 + 1 + width(word) + 1 }
}

function renderSetting(
  $: EngineInterface,
  ui: Ui,
  row: ConfigRow,
  plugin: string,
  notes: Record<string, Note>,
  ctx: RowCtx,
) {
  const { Box, Text } = ui
  const Input = inputOf(ui)
  const id = ctx.prefix + settingKey(row.key)
  const made = notes[settingKey(row.key)]
  // A note stands for the value it was made against: once the row shows another, it is stale and not drawn.
  const note = made && made.shown === configArg(row.value) ? made : undefined
  const shown = Array.isArray(row.value) ? row.value.join(', ') : String(row.value)
  const label = pad(row.label, ctx.pad)
  const view: SettingView = { row, id, label, shown }
  let drawn: Drawn
  if (row.isLocked) {
    drawn = { control: <Text key={id} dimColor>{`${label}  ${shown}  managed`}</Text>, cells: width(label) + 2 + width(`${shown}  managed`) }
  } else if (row.kind === 'boolean') {
    drawn = renderBoolean($, ui, view)
  } else if (row.kind === 'choice' && row.options && row.options.length > 0 && ctx.hasFields) {
    drawn = renderChoice($, ui, view, row.options, ctx)
  } else if (Input && ctx.hasFields) {
    drawn = renderTextEdit($, ui, view, Input, ctx)
  } else {
    drawn = { control: <Text key={id}>{`${label}  ${shown}`}</Text>, cells: width(label) + 2 + width(shown) }
  }
  // The description takes what is left of the line after star, label, value or editor and a note.
  const used = STAR_CELLS + drawn.cells + (note ? 2 + width(note.text) : 0) + SEP_CELLS
  const help = helpFor(row.description?.replace(/\s+/g, ' '), ctx.columns - used)
  return (
    <Box key={`row:${id}`} flexDirection="row">
      {renderStar($, ui, { kind: 'setting', plugin, key: row.key }, settingKey(row.key), ctx)}
      <Text> </Text>
      {drawn.control}
      {renderHelp(ui, help)}
      {note && <Text color="red">{`  ${note.text}`}</Text>}
    </Box>
  )
}

/** The label a command button shows: `press again: /x` while its confirming press is awaited. */
function commandLabel(plugin: string, c: SectionCommand, state: RowState): string {
  const isArmed = runsTag(plugin, c) !== null && state.armed.id === commandKey(plugin, c)
  return isArmed ? `press again: /${clip(c.command, LIMITS.command)}` : c.label
}

function renderCommand(
  $: EngineInterface,
  ui: Ui,
  plugin: string,
  c: SectionCommand,
  state: RowState,
  ctx: RowCtx,
) {
  const { Box, Text, Button } = ui
  const rid = commandKey(plugin, c)
  const id = ctx.prefix + rid
  const tag = runsTag(plugin, c)
  const runs = clip(`/${c.command}${c.args ? ` ${c.args}` : ''}`, MAX_RUNS_HINT)
  // The help text takes what is left of the line after star, button, hint and tag.
  const used = STAR_CELLS + Math.max(ctx.cmdPad, width(c.label)) + BUTTON_CHROME + BUTTON_GAP + width(runs) + (tag === null ? 0 : 1 + width(tag)) + 1
  const help = helpFor(c.isAvailable ? c.description : undefined, ctx.columns - used - SEP_CELLS)
  return (
    <Box key={`row:${id}`} flexDirection="row">
      {renderStar($, ui, { kind: 'command', plugin, key: favCommandKey(c) }, rid, ctx)}
      <Text> </Text>
      {c.isAvailable ? (
        <Button key={id} label={commandLabel(plugin, c, state)} onPress={() => void pressCommand($, plugin, c)} />
      ) : (
        <Text key={id} dimColor>{`${c.label} (not available)`}</Text>
      )}
      {c.isAvailable && <Text>{' '.repeat(Math.max(0, ctx.cmdPad - width(c.label)) + BUTTON_GAP)}</Text>}
      {c.isAvailable && <Text dimColor>{runs}</Text>}
      {tag !== null && <Text dimColor>{` ${tag}`}</Text>}
      {renderHelp(ui, help)}
      {state.queued[rid] && <Text dimColor> queued</Text>}
    </Box>
  )
}

function settingRows(section: MenuSection, rows: readonly ConfigRow[]): ConfigRow[] {
  const own = rows.filter(r => bareName(r.provider.plugin) === bareName(section.plugin))
  if (section.settings === null) return own
  const out: ConfigRow[] = []
  for (const field of section.settings) {
    const row = own.find(r => r.key === `${section.plugin}.${field}`)
    if (row) out.push(row)
  }
  return out
}

function findFavCommand(f: Favourite, known: readonly MenuSection[]): SectionCommand | undefined {
  return known.find(x => x.plugin === f.plugin)?.commands.find(c => favCommandKey(c) === f.key)
}

function renderFavourite(
  $: EngineInterface,
  ui: Ui,
  f: Favourite,
  known: readonly MenuSection[],
  rows: readonly ConfigRow[],
  state: RowState,
  ctx: RowCtx,
) {
  if (f.kind === 'command') {
    const c = findFavCommand(f, known)
    if (c) return renderCommand($, ui, f.plugin, c, state, ctx)
  } else {
    const r = rows.find(x => x.key === f.key)
    if (r) return renderSetting($, ui, r, f.plugin, state.notes, ctx)
  }
  const { Box, Text } = ui
  return (
    <Box key={`row:${ctx.prefix}gone:${f.kind}:${f.plugin}:${f.key}`} flexDirection="row">
      {renderStar($, ui, f, `${f.kind}:${f.plugin}:${f.key}`, ctx)}
      <Text> </Text>
      <Text dimColor>{`${f.key} (gone)`}</Text>
    </Box>
  )
}

/** Settings-only sections: plugins with rows but no menu file section, built at draw time. */
function configSections(rows: readonly ConfigRow[], filed: readonly MenuSection[]): MenuSection[] {
  const names = new Set(rows.map(r => r.provider.plugin).filter(n => n !== ENGINE && !filed.some(x => bareName(x.plugin) === bareName(n))))
  const builtin = new Set(rows.filter(r => r.provider.tier === 'builtin').map(r => r.provider.plugin))
  return [...names]
    .map(plugin => {
      const isBuiltIn = builtin.has(plugin)
      const bare = bareName(plugin)
      const title = isBuiltIn && bare.startsWith(BUILTIN_PREFIX) ? bare.slice(BUILTIN_PREFIX.length) : bare
      return { plugin, title, commands: [], settings: null, source: 'config' as const, ...(isBuiltIn && { isBuiltIn }) }
    })
    .sort((a, b) => a.title.localeCompare(b.title))
}

/** One foldable section of the pane: the pinned list, a plugin, or Claude Code's own settings. */
type Block = {
  id: string
  plugin: string
  title: string
  commands: SectionCommand[]
  rows: ConfigRow[]
  favs?: readonly Favourite[]
  note?: string
  isBuiltIn?: boolean
}

type MenuData = {
  all: MenuSection[]
  rows: ConfigRow[]
  state: RowState
  favs: Favourite[]
  folded: Record<string, boolean>
  /** The filter as typed, and trimmed and lower-cased as matched. */
  filterText: string
  filter: string
  openEditor: string
  draft: string
  blocks: Block[]
}

const FAV_ID = 'favourites'
const pluralOf = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/** Folded unless the map says otherwise; only the pinned list starts open. */
const isFolded = (folds: Record<string, boolean>, id: string): boolean => folds[id] ?? id !== FAV_ID

const toggleFold = async ($: EngineInterface, id: string): Promise<void> => {
  const stored = await storedValue($, FOLDS)
  await writeFolds($, { ...stored, [id]: !isFolded(stored, id) })
}

const foldAll = async ($: EngineInterface, ids: readonly string[], isFold: boolean): Promise<void> => {
  const stored = await storedValue($, FOLDS)
  await writeFolds($, { ...stored, ...Object.fromEntries(ids.map(id => [id, isFold])) })
}

async function loadMenu($: EngineInterface): Promise<MenuData> {
  const [s, state, favs, folds, filterText, open, draft, rows] = await Promise.all([
    read($, sections),
    read($, rowState),
    read($, favourites),
    read($, folded),
    read($, filter),
    read($, openEditor),
    read($, editDraft),
    $.config.list().catch((): ConfigRow[] => []),
  ])
  const needle = filterText.trim().toLowerCase()
  const all = [...s, ...configSections(rows, s)]
  const blocks: Block[] = []
  const hasText = (...texts: string[]): boolean => texts.some(t => t.toLowerCase().includes(needle))
  const keepRow = (r: ConfigRow): boolean => needle === '' || hasText(r.label, r.key, r.description ?? '')
  const keepCommand = (c: SectionCommand): boolean => needle === '' || hasText(c.label, c.command)
  const keepFav = (f: Favourite): boolean => {
    if (needle === '') return true
    if (f.kind === 'command') {
      const c = findFavCommand(f, all)
      return c ? keepCommand(c) : hasText(f.key)
    }
    const r = rows.find(x => x.key === f.key)
    return r ? keepRow(r) : hasText(f.key)
  }
  const shownFavs = favs.filter(keepFav)
  if (shownFavs.length > 0) {
    blocks.push({ id: FAV_ID, plugin: '', title: 'Favourites', commands: [], rows: [], favs: shownFavs })
  }
  const push = (b: Block): void => {
    const commands = b.commands.filter(keepCommand)
    const own = b.rows.filter(keepRow)
    if (needle === '' || commands.length + own.length > 0) blocks.push({ ...b, commands, rows: own })
  }
  for (const section of all) {
    push({
      id: `plugin:${section.plugin}`,
      plugin: section.plugin,
      title: section.title,
      commands: section.commands,
      rows: settingRows(section, rows),
      ...(section.note !== undefined && { note: section.note }),
      ...(section.isBuiltIn && { isBuiltIn: true }),
    })
  }
  const engineRows = rows.filter(r => r.provider.plugin === ENGINE)
  if (engineRows.length > 0) push({ id: ENGINE, plugin: ENGINE, title: 'Claude Code', commands: [], rows: engineRows })
  return { all, rows, state, favs, folded: folds, filterText, filter: needle, openEditor: open, draft, blocks }
}

/** Open when the map says so; every block with a match is open while a filter is set. */
const isBlockOpen = (d: MenuData, id: string): boolean => d.filter !== '' || !isFolded(d.folded, id)

function summaryOf(b: Block): string {
  if (b.favs) return `${b.favs.length} pinned`
  return [
    ...(b.commands.length > 0 ? [pluralOf(b.commands.length, 'command')] : []),
    ...(b.rows.length > 0 ? [pluralOf(b.rows.length, 'setting')] : []),
  ].join(' · ')
}

/** The key prefix of a block's rows: the pinned list's rows are keyed apart from the same rows in their section. */
const prefixOf = (b: Block): string => (b.favs ? 'fav:' : '')

/** The settings a block draws. */
const settingsOf = (b: Block, d: MenuData): ConfigRow[] =>
  b.favs ? b.favs.flatMap(f => (f.kind === 'setting' ? d.rows.filter(r => r.key === f.key) : [])) : b.rows

/**
 * Rows a block takes: its header; open, its note line, a row per shown command (plus the "more" line), a row per setting,
 * and the second line of an open choice (counted whether or not it wraps, so the band never under-counts).
 */
function blockRows(b: Block, isOpen: boolean, d: MenuData): number {
  if (!isOpen) return 1
  if (b.favs) return 1 + b.favs.length + (hasOpenChoice(b, d) ? 1 : 0)
  const shown = Math.min(b.commands.length, MAX_SHOWN_COMMANDS)
  return 1 + (b.note ? 1 : 0) + shown + (b.commands.length > MAX_SHOWN_COMMANDS ? 1 : 0) + b.rows.length + (hasOpenChoice(b, d) ? 1 : 0)
}

function hasOpenChoice(b: Block, d: MenuData): boolean {
  return settingsOf(b, d).some(r => r.kind === 'choice' && d.openEditor === prefixOf(b) + settingKey(r.key))
}

type BlockOptions = { hasFields: boolean; columns: number; showBody?: boolean }

function renderBlock($: EngineInterface, ui: Ui, b: Block, d: MenuData, { hasFields, columns, showBody = true }: BlockOptions) {
  const { Box, Text, Button } = ui
  const isOpen = isBlockOpen(d, b.id)
  const widest = Math.max(0, ...settingsOf(b, d).map(r => width(r.label)))
  const cmdLabels = b.favs
    ? b.favs.flatMap(f => (f.kind === 'command' ? [findFavCommand(f, d.all)?.label ?? ''] : []))
    : b.commands.slice(0, MAX_SHOWN_COMMANDS).map(c => c.label)
  const cmdPad = Math.max(0, ...cmdLabels.map(l => width(l)))
  const ctx: RowCtx = { list: d.favs, prefix: prefixOf(b), hasFields, pad: widest, cmdPad, open: d.openEditor, draft: d.draft, columns }
  let body: RenderNode[] = []
  if (showBody && isOpen && b.favs) {
    body = b.favs.map(f => renderFavourite($, ui, f, d.all, d.rows, d.state, ctx))
  } else if (showBody && isOpen) {
    body = [
      ...(b.note ? [<Text key={`note:${b.id}`} dimColor>{b.note}</Text>] : []),
      ...(b.commands.length > 0
        ? [
            <Box key="commands" flexDirection="column">
              {b.commands.slice(0, MAX_SHOWN_COMMANDS).map(c => renderCommand($, ui, b.plugin, c, d.state, ctx))}
              {b.commands.length > MAX_SHOWN_COMMANDS && (
                <Text key="more" dimColor>{`+${b.commands.length - MAX_SHOWN_COMMANDS} more`}</Text>
              )}
            </Box>,
          ]
        : []),
      ...b.rows.map(r => renderSetting($, ui, r, b.plugin, d.state.notes, ctx)),
    ]
  }
  return (
    <Box key={`section:${b.id}`} flexDirection="column">
      <Box flexDirection="row" columnGap={2}>
        <Button
          key={`fold:${b.id}`}
          label={`${isOpen ? '▾' : '▸'} ${b.title}`}
          variant="primary"
          onPress={() => void toggleFold($, b.id)}
        />
        {b.isBuiltIn && <Text dimColor>built-in</Text>}
        <Text dimColor>{summaryOf(b)}</Text>
      </Box>
      {body.length > 0 && (
        <Box key={`body:${b.id}`} flexDirection="column" paddingLeft={2}>
          {body}
        </Box>
      )}
    </Box>
  )
}

async function setFilter($: EngineInterface, value: string): Promise<void> {
  await update($, filter, () => value)
  $.ui.invalidate('ui.render')
}

async function renderMenu($: EngineInterface, e: RenderInput<'Pane'>) {
  const ui = $.ui.resolve(e)
  const { Box, Text, Button } = ui
  const p = await read($, problems)
  const d = await loadMenu($)
  const hasFields = e.surface !== 'mobile'
  const columns = e.props.bodyColumns
  const sectionBlocks = d.blocks.filter(b => b.id !== FAV_ID)
  const commandTotal = sectionBlocks.reduce((n, b) => n + b.commands.length, 0)
  const settingTotal = sectionBlocks.reduce((n, b) => n + b.rows.length, 0)
  const ids = d.blocks.map(b => b.id)
  const Input = inputOf(ui)
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" columnGap={2}>
        <Text bold color="cyan">Quick menu</Text>
        <Button key="expand-all" label="Expand all" hotkey="e" onPress={() => void foldAll($, ids, false)} />
        <Button key="collapse-all" label="Collapse all" hotkey="c" onPress={() => void foldAll($, ids, true)} />
        <Text dimColor>{`${pluralOf(sectionBlocks.length, 'section')} · ${pluralOf(commandTotal, 'command')} · ${pluralOf(settingTotal, 'setting')}`}</Text>
      </Box>
      {d.favs.length === 0 && <Text dimColor>Press ☆ on a row to pin it to the band.</Text>}
      {Input && hasFields && (
        <Input
          key="filter"
          placeholder="filter…"
          value={d.filterText}
          onInput={(value: string) => void setFilter($, value)}
          onSubmit={(value: string) => void setFilter($, value)}
        />
      )}
      {sectionBlocks.length === 0 && (
        <Text dimColor>{d.filter === '' ? 'Quick menu: nothing here yet.' : `No match for "${d.filter}".`}</Text>
      )}
      {d.blocks.map(b => renderBlock($, ui, b, d, { hasFields, columns }))}
      {p.length > 0 && (
        <Box key="problems" flexDirection="column">
          <Text bold>Problems</Text>
          {p.map((x, i) => (
            <Text key={String(i)} color="red">{`  ${x.plugin}: ${x.message}`}</Text>
          ))}
        </Box>
      )}
    </Box>
  )
}

/** The band's menu button label with the pane's state: ▾ open, ▸ closed. ≣: one cell in every width table. */
const menuLabelFor = (isOpen: boolean): string => `≣ menu ${isOpen ? '▾' : '▸'}`

/** What a band button does when pressed; plain data, so no closure over `$` is stored. */
type BandAction =
  | { kind: 'run'; plugin: string; c: SectionCommand }
  | { kind: 'toggle'; row: ConfigRow }
  | { kind: 'open' }

type BandItem = { label: string; action: BandAction; isOwn: boolean; digit?: number }

async function pressBandItem($: EngineInterface, action: BandAction): Promise<void> {
  switch (action.kind) {
    case 'run':
      return pressCommand($, action.plugin, action.c)
    case 'toggle':
      return writeSetting($, action.row, !action.row.value)
    case 'open':
      return openPane($)
  }
}

function bandItem(
  f: Favourite,
  known: readonly MenuSection[],
  rows: readonly ConfigRow[],
  state: RowState,
): BandItem | null {
  if (f.kind === 'command') {
    const c = findFavCommand(f, known)
    if (!c || !c.isAvailable) return null
    return {
      label: commandLabel(f.plugin, c, state),
      action: { kind: 'run', plugin: f.plugin, c },
      isOwn: runsTag(f.plugin, c) === null,
    }
  }
  const r = rows.find(x => x.key === f.key)
  if (!r) return null
  if (r.kind === 'boolean' && !r.isLocked) {
    return { label: `${r.label}: ${r.value ? 'on' : 'off'}`, action: { kind: 'toggle', row: r }, isOwn: false }
  }
  return { label: r.label, action: { kind: 'open' }, isOwn: false }
}

/** Opens the pane; when the terminal is too narrow to place it, says why and lets the band carry the menu. */
async function openPane($: EngineInterface): Promise<void> {
  // A reopened pane starts without the notes of earlier writes.
  await update($, rowState, s => ({ ...s, notes: {} }))
  // Not awaited: the pane opens at once and redraws when the fresh listing lands.
  void refreshListing($).then(listed => listed && $.ui.invalidate('ui.render'))
  const opened = await $.ui.open({ id: PANE_ID, title: 'Quick menu', focus: true, columns: PANE_COLUMNS, closeOnEscape: true })
  await update($, unplaced, () => !opened.isPlaced)
  if (!opened.isPlaced) $.ui.toast(`Quick menu: ${opened.reason}. Showing it above the prompt instead.`)
  $.ui.invalidate('ui.render')
}

/** Closes the pane, and the band's section list that stood in for it. */
async function closePane($: EngineInterface): Promise<void> {
  await $.ui.close({ id: PANE_ID })
  await update($, unplaced, () => false)
  $.ui.invalidate('ui.render')
}

/** True while the engine lists the pane as open: asked each time, since the person can close it with ×, Esc or a key. */
async function isPaneOpen($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(x => x.id === PANE_ID)
  } catch {
    return false
  }
}

/** The band button: closes the pane when it is open, opens it otherwise. */
async function togglePane($: EngineInterface): Promise<void> {
  if (await isPaneOpen($)) await closePane($)
  else await openPane($)
}

/** True while the pane was refused for width and is still not drawn. */
async function isUnplaced($: EngineInterface): Promise<boolean> {
  if (!(await read($, unplaced))) return false
  try {
    const pane = (await $.ui.panes()).find(x => x.id === PANE_ID)
    return !pane?.isPlaced
  } catch {
    return true
  }
}

/** The folded section list in the band: the same header buttons, at most `budget` rows. */
function renderBandMenu($: EngineInterface, ui: Ui, d: MenuData, budget: number, columns: number) {
  const out = []
  let left = budget
  for (const b of d.blocks) {
    const need = blockRows(b, isBlockOpen(d, b.id), d)
    if (left < 1) break
    out.push(renderBlock($, ui, b, d, { hasFields: true, columns, showBody: need <= left }))
    left -= Math.min(need, left)
  }
  return out
}

async function renderBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, next: () => unknown): Promise<RenderElement> {
  if (e.props.hasSurvey) return next() as Promise<RenderElement>
  if (e.surface !== 'terminal' && e.surface !== 'desktop') return next() as Promise<RenderElement>
  const ui = $.ui.resolve(e)
  const { Box, Button, Text } = ui
  const d = await loadMenu($)
  const menuLabel = menuLabelFor(await isPaneOpen($))
  let used = width(menuLabel) + MENU_BUTTON_CHROME + BAND_RESERVE
  const items: BandItem[] = []
  for (const [position, f] of d.favs.entries()) {
    const item = bandItem(f, d.all, d.rows, d.state)
    if (!item) continue
    // The digit is the favourite's own place in the pinned list, so a gap never renumbers the others.
    const digit = bandHotkeys && item.isOwn && position < 9 ? position + 1 : undefined
    used += width(item.label) + (digit === undefined ? 0 : DIGIT_CELLS) + BUTTON_GAP
    if (used > e.props.bodyColumns) break
    items.push(digit === undefined ? item : { ...item, digit })
  }
  const menu = (await isUnplaced($)) ? renderBandMenu($, ui, d, e.props.maxRows - 2, e.props.bodyColumns) : null
  const below = (await next()) as RenderNode | null | undefined
  return (
    <Box flexDirection="column">
      <Box columnGap={1}>
        <Button key="band:menu" label={menuLabel} hotkey="m" onPress={() => void togglePane($)} />
        {items.length > 0 && <Text dimColor>│</Text>}
        {items.map((item, i) => (
          <Button
            key={`band:${i + 1}`}
            label={item.label}
            plain
            {...(item.digit !== undefined && { hotkey: String(item.digit) })}
            onPress={() => void pressBandItem($, item.action)}
          />
        ))}
      </Box>
      {menu && (
        <Box key="band:close-row">
          <Button key="band:close" label="Close" hotkey="x" onPress={() => void closePane($)} />
        </Box>
      )}
      {menu}
      {below}
    </Box>
  )
}

export const register: Register = (on, options) => {
  bandHotkeys = options.bandHotkeys === true
  on('plugin.register', async ($, e, next) => {
    if (e.provenance.endsWith('@inline')) {
      inlineRoots.set(e.name, e.root)
      await update($, inlineRootState, m => ({ ...m, [e.name]: e.root }))
    }
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    sessionCwd = e.cwd
    // A module instance that sees a second session.start is in a new session, not a reload (a reload makes a new instance).
    if (sessionStarted) {
      inlineRoots.clear()
      await update($, inlineRootState, () => ({}))
    }
    sessionStarted = true
    await update($, rowState, () => ({ queued: {}, notes: {}, armed: DISARMED }))
    await update($, unplaced, () => false)
    await update($, filter, () => '')
    await putEditor($, '')
    await loadFavourites($)
    await loadFolds($)
    await $.command.register({
      name: MENU_COMMAND,
      description: `Open the quick menu (${REFRESH}: discover plugin menus again)`,
      argumentHint: `[${REFRESH}]`,
    })
    // After next(e): the plugins beneath register their commands in their own session.start, and discovery marks
    // a command missing from $.command.list() unavailable. Not awaited: the session does not wait on file reads.
    const result = await next(e)
    startDiscovery($)
    return result
  })

  on('command.run', { command: MENU_COMMAND }, ($, e) => openMenu($, e.args ?? ''))

  // Observed only: whoever closes the pane (×, Esc, a key, this plugin), the band redraws with the new label.
  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE_ID) $.ui.invalidate('ui.render')
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e) => renderMenu($, e))

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => renderBand($, e, () => next(e)))
}
