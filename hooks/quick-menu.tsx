import { atom, read, update } from 'claude-code'
import type { CommandInfo, ConfigRow, ConfigValue, Elements, EngineInterface, Register, RenderElement, RenderNode } from 'claude-code'

import type { Favourite, MenuCommand, MenuFile, MenuProblem, MenuSection, SectionCommand } from '../types'

export const PANE_ID = 'quick-menu'
const MENU_FILE = '.claude-plugin/quick-menu.json'
const BUILTIN_PREFIX = 'cc-plugin-'

const sections = atom({ plugin: 'agent-quick-menu', key: 'sections' } as const, [] as MenuSection[])
const problems = atom({ plugin: 'agent-quick-menu', key: 'problems' } as const, [] as MenuProblem[])

const favourites = atom({ plugin: 'agent-quick-menu', key: 'favourites' } as const, [] as Favourite[])
const folded = atom({ plugin: 'agent-quick-menu', key: 'folded' } as const, {} as Record<string, boolean>)
const unplaced = atom({ plugin: 'agent-quick-menu', key: 'unplaced' } as const, false)
const filter = atom({ plugin: 'agent-quick-menu', key: 'filter' } as const, '')

type Validation = { ok: true; value: MenuFile } | { ok: false; error: string }

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function validateCommand(c: unknown, i: number): { ok: true; value: MenuCommand } | { ok: false; error: string } {
  if (!isObject(c)) return { ok: false, error: `commands[${i}] must be an object` }
  if (typeof c.command !== 'string' || c.command.trim() === '') {
    return { ok: false, error: `commands[${i}].command must be a non-empty string` }
  }
  const value: MenuCommand = { command: c.command }
  for (const key of ['label', 'args', 'description'] as const) {
    const field = c[key]
    if (field === undefined) continue
    if (typeof field !== 'string') return { ok: false, error: `commands[${i}].${key} must be a string` }
    value[key] = field
  }
  return { ok: true, value }
}

/** Checks a parsed menu file against the convention (version 1). */
export function validateMenuFile(json: unknown): Validation {
  if (!isObject(json)) return { ok: false, error: 'menu file must be a JSON object' }
  if (json.version !== 1) return { ok: false, error: `unsupported version ${JSON.stringify(json.version)} (expected 1)` }
  if (json.title !== undefined && typeof json.title !== 'string') return { ok: false, error: 'title must be a string' }
  let commands: MenuCommand[] = []
  if (json.commands !== undefined) {
    if (!Array.isArray(json.commands)) return { ok: false, error: 'commands must be an array' }
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
    settings = [...(json.settings as string[])]
  }
  return { ok: true, value: { version: 1, title: json.title as string | undefined, commands, settings } }
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

async function readJson($: EngineInterface, path: string): Promise<unknown> {
  const raw = await $.fs.read(path)
  return JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
}

type Target = { name: string; root: string }

let sessionCwd = ''

/**
 * Roots of `--plugin-dir` plugins, learned from `plugin.register` (the only place the types hand out another plugin's `root`).
 * `plugin.register` fires once per load of the other plugin, never again when this module reloads, so the roots are kept in
 * `$.state` (which outlives a reload) as well as here (which outlives a new session in the same process).
 */
const inlineRoots = new Map<string, string>()
const inlineRootState = atom({ plugin: 'agent-quick-menu', key: 'inlineRoots' } as const, {} as Record<string, string>)

/** The plugin name without its `@<marketplace>` suffix. */
const bareName = (id: string): string => id.split('@')[0] ?? id

const PLUGIN_DIR_NOTE = 'loaded with --plugin-dir: set CLAUDE_CODE_PLUGIN_DIRS to read its quick-menu.json'

/** Plugins whose commands are not claimed by a built-in prefix or the engine. */
const isForeign = (name: string): boolean => name !== 'engine' && !name.startsWith(BUILTIN_PREFIX)

/** The install entry for this session: a project or local one for the cwd, else the user one, else the first. */
function chooseEntry(entries: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(entries)) return undefined
  const objects = entries.filter(isObject)
  const here = objects.find(
    x => (x.scope === 'project' || x.scope === 'local') && sessionCwd !== '' && x.projectPath === sessionCwd,
  )
  return here ?? objects.find(x => x.scope === 'user') ?? objects[0]
}

async function registryTargets($: EngineInterface, found: MenuProblem[]): Promise<Target[]> {
  let enabled: string[] = []
  try {
    const settings = (await $.settings.read()) as { enabledPlugins?: Record<string, unknown> }
    enabled = Object.entries(settings.enabledPlugins ?? {})
      .filter(([, on]) => on === true)
      .map(([id]) => id)
  } catch (err) {
    found.push({ plugin: 'settings', message: `cannot read settings: ${message(err)}` })
  }
  if (enabled.length === 0) return []
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  const base = configDir ? configDir : `${(await $.env.get('HOME')) ?? ''}/.claude`
  const registryPath = `${base}/plugins/installed_plugins.json`
  let plugins: Record<string, unknown> = {}
  try {
    const json = await readJson($, registryPath)
    if (isObject(json) && isObject(json.plugins)) plugins = json.plugins
  } catch (err) {
    found.push({ plugin: 'installed_plugins.json', message: `cannot read ${registryPath}: ${message(err)}` })
    return []
  }
  const targets: Target[] = []
  for (const id of enabled) {
    const entry = chooseEntry(plugins[id])
    if (entry && typeof entry.installPath === 'string') {
      targets.push({ name: id.split('@')[0] ?? id, root: entry.installPath })
    }
  }
  return targets
}

/** `--plugin-dir` folders: `CLAUDE_CODE_PLUGIN_DIRS`, then the roots `plugin.register` handed out. */
async function dirTargets($: EngineInterface, found: MenuProblem[]): Promise<Target[]> {
  const raw = await $.env.get('CLAUDE_CODE_PLUGIN_DIRS')
  const targets: Target[] = []
  for (const root of (raw ?? '').split(':').filter(Boolean)) {
    try {
      const manifest = await readJson($, `${root}/.claude-plugin/plugin.json`)
      const name = isObject(manifest) ? manifest.name : undefined
      if (typeof name !== 'string' || name === '') throw new Error('plugin.json has no name')
      targets.push({ name, root })
    } catch (err) {
      found.push({ plugin: root, message: `cannot identify plugin dir: ${message(err)}` })
    }
  }
  let kept: Record<string, string> = {}
  try {
    kept = await read($, inlineRootState)
  } catch {
    kept = {}
  }
  for (const [name, root] of [...inlineRoots, ...Object.entries(kept)]) targets.push({ name, root })
  return targets
}

async function readMenuFile(
  $: EngineInterface,
  target: Target,
  found: MenuProblem[],
): Promise<MenuFile | null> {
  const path = `${target.root}/${MENU_FILE}`
  try {
    if (!(await $.fs.exists(path))) return null
    const result = validateMenuFile(await readJson($, path))
    if (result.ok) return result.value
    found.push({ plugin: target.name, message: `${path}: ${result.error}` })
  } catch (err) {
    found.push({ plugin: target.name, message: `${path}: ${message(err)}` })
  }
  return null
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

/**
 * Reads every enabled plugin's menu file and builds the file sections; failures become problems.
 * The first root per name wins: this plugin's own (`$.plugin.root`, which `plugin.register` never hands it), then the
 * `--plugin-dir` folders, then the installed copies they shadow.
 */
export async function discover($: EngineInterface): Promise<{ sections: MenuSection[]; problems: MenuProblem[] }> {
  const found: MenuProblem[] = []
  const all = [
    { name: $.plugin.name, root: $.plugin.root },
    ...(await dirTargets($, found)),
    ...(await registryTargets($, found)),
  ]
  const targets = all.filter((t, i) => all.findIndex(o => o.name === t.name) === i)

  let listed: CommandInfo[] = []
  try {
    listed = await $.command.list()
  } catch (err) {
    found.push({ plugin: 'commands', message: `cannot list commands: ${message(err)}` })
  }

  const available = new Set(listed.map(c => c.name))
  const result: MenuSection[] = []
  for (const target of targets) {
    const file = await readMenuFile($, target, found)
    if (file) {
      result.push({
        plugin: target.name,
        title: file.title ?? target.name,
        commands: file.commands.map(c => ({
          command: c.command,
          label: c.label ?? c.command,
          ...(c.args !== undefined && { args: c.args }),
          ...(c.description !== undefined && { description: c.description }),
          isAvailable: available.has(c.command),
        })),
        settings: file.settings,
        source: 'file',
      })
    }
  }
  result.push(...commandSections(listed, targets))
  result.sort((a, b) => a.title.localeCompare(b.title))
  return { sections: result, problems: found }
}

let discoveryRun = 0

/** Discovers and stores the sections; a run overtaken by a later one leaves the later one's answer standing. */
async function runDiscovery($: EngineInterface): Promise<{ sections: number; problems: number } | null> {
  const run = ++discoveryRun
  const found = await discover($)
  if (run !== discoveryRun) return null
  await update($, sections, () => found.sections)
  await update($, problems, () => found.problems)
  $.ui.invalidate('ui.render')
  return { sections: found.sections.length, problems: found.problems.length }
}

/** Starts a discovery without holding the dispatch that asked for it; `done` gets its counts, failures a toast. */
function startDiscovery($: EngineInterface, done?: (counts: { sections: number; problems: number }) => void): void {
  void runDiscovery($).then(
    counts => counts && done?.(counts),
    err => $.ui.toast(toastLine(`Quick menu: discovery failed: ${message(err)}`)),
  )
}

/** `/menu`: opens the pane, or starts a refresh, and answers at once; discovery runs on its own and redraws when it lands. */
async function openMenu($: EngineInterface, args: string): Promise<{ text: string }> {
  if (args.trim() === 'refresh') {
    startDiscovery($, c => $.ui.toast(`Quick menu refreshed: ${c.sections} sections, ${c.problems} problems`))
    return { text: 'Quick menu: discovering plugin menus again' }
  }
  await openPane($)
  return { text: 'Quick menu opened' }
}

/** Commands this plugin registers; the menu answers them itself (runAny). */
const OWN_COMMANDS = new Set(['menu'])

/**
 * Runs a command a row or the band names. This plugin's own are answered here: the engine leaves a plugin's own hooks
 * out of the `command.run` its own `$.command.run` raises (re-entry), so that call would reach the engine's
 * "registered /menu but no command.run hook answered it".
 */
async function runAny($: EngineInterface, c: SectionCommand): Promise<{ text?: string }> {
  if (OWN_COMMANDS.has(c.command)) {
    const answer = await openMenu($, c.args ?? '')
    // A refresh toasts its counts when discovery lands; a toast now would push that one out (toasts are spaced 2 s).
    return (c.args ?? '').trim() === 'refresh' ? {} : answer
  }
  return $.command.run({ command: c.command, ...(c.args !== undefined && { args: c.args }) })
}

type Note = { kind: 'deny' | 'error'; text: string }
type RowState = { queued: Record<string, true>; notes: Record<string, Note> }

const rowState = atom({ plugin: 'agent-quick-menu', key: 'rowState' } as const, {
  queued: {},
  notes: {},
} as RowState)

const commandKey = (plugin: string, c: SectionCommand): string => `cmd:${plugin}:${c.command}:${c.args ?? ''}`
const settingKey = (key: string): string => `set:${key}`

const toastLine = (text: string): string => (text.split('\n')[0] ?? '').slice(0, 200)

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

async function writeSetting($: EngineInterface, row: ConfigRow, value: ConfigValue): Promise<void> {
  const id = settingKey(row.key)
  await setNote($, id, null)
  try {
    const result = await $.config.set({ key: row.key, value })
    if (result.deny !== undefined) await setNote($, id, { kind: 'deny', text: result.deny })
  } catch (err) {
    await setNote($, id, { kind: 'error', text: message(err) })
  }
  $.ui.invalidate('ui.render')
}

async function submitNumber($: EngineInterface, row: ConfigRow, raw: string): Promise<void> {
  const n = Number(raw)
  if (raw.trim() === '' || !Number.isFinite(n)) {
    await setNote($, settingKey(row.key), { kind: 'error', text: `"${raw}" is not a number` })
    $.ui.invalidate('ui.render')
    return
  }
  await writeSetting($, row, n)
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

async function storedFavourites($: EngineInterface): Promise<Favourite[]> {
  try {
    const stored: unknown = await $.store.get('favourites')
    return isFavourites(stored) ? stored : []
  } catch {
    return []
  }
}

async function loadFavourites($: EngineInterface): Promise<void> {
  const stored = await storedFavourites($)
  await update($, favourites, () => stored)
}

async function toggleFavourite($: EngineInterface, f: Favourite): Promise<void> {
  const list = await storedFavourites($)
  const changed = isFavourite(list, f) ? list.filter(x => !sameFav(x, f)) : [...list, f]
  await $.store.set('favourites', changed)
  await update($, favourites, () => changed)
  $.ui.invalidate('ui.render')
}

/** `hasFields`: the surface draws Input and Select (the mobile table has neither; its stand-ins draw nothing). `pad`: the section's longest setting label. */
type FavCtx = { list: readonly Favourite[]; prefix: string; hasFields: boolean; pad: number }

function renderStar($: EngineInterface, ui: Ui, f: Favourite, id: string, fav: FavCtx) {
  const { Button } = ui
  const pinned = isFavourite(fav.list, f)
  return (
    <Button
      key={`${fav.prefix}star:${id}`}
      label={pinned ? '★' : '☆'}
      plain
      dimColor
      onPress={() => void toggleFavourite($, f)}
    />
  )
}

const pad = (text: string, to: number): string => text + ' '.repeat(Math.max(0, to - width(text)))

function renderSetting(
  $: EngineInterface,
  ui: Ui,
  row: ConfigRow,
  plugin: string,
  notes: Record<string, Note>,
  fav: FavCtx,
) {
  const { Box, Text, Button } = ui
  const { Select, Input } = ui as Partial<Pick<Elements['terminal'], 'Select' | 'Input'>>
  const id = fav.prefix + settingKey(row.key)
  const note = notes[settingKey(row.key)]
  const shown = Array.isArray(row.value) ? row.value.join(', ') : String(row.value)
  const label = pad(row.label, fav.pad)
  let control
  if (row.isLocked) {
    control = <Text key={id} dimColor>{`${label}  ${shown}  managed`}</Text>
  } else if (row.kind === 'boolean') {
    control = (
      <Box key={`bool:${id}`} flexDirection="row">
        <Text>{`${label}  `}</Text>
        <Button key={id} label={row.value ? 'on' : 'off'} onPress={() => void writeSetting($, row, !row.value)} />
      </Box>
    )
  } else if (row.kind === 'choice' && row.options && row.options.length > 0 && Select && fav.hasFields) {
    control = (
      <Select
        key={id}
        label={`${label}  `}
        options={row.options.map(value => ({ value }))}
        value={shown}
        onSelect={(value: string) => void writeSetting($, row, value)}
      />
    )
  } else if (Input && fav.hasFields) {
    control = (
      <Input
        key={id}
        label={`${label}  `}
        value={shown}
        onSubmit={(value: string) => void (row.kind === 'number' ? submitNumber($, row, value) : writeSetting($, row, value))}
      />
    )
  } else {
    control = <Text key={id}>{`${label}  ${shown}`}</Text>
  }
  return (
    <Box key={`row:${id}`} flexDirection="row">
      {renderStar($, ui, { kind: 'setting', plugin, key: row.key }, settingKey(row.key), fav)}
      <Text> </Text>
      {control}
      {note && <Text color="red">{`  ${note.text}`}</Text>}
    </Box>
  )
}

function renderCommand(
  $: EngineInterface,
  ui: Ui,
  plugin: string,
  c: SectionCommand,
  state: RowState,
  fav: FavCtx,
) {
  const { Box, Text, Button } = ui
  const rid = commandKey(plugin, c)
  const id = fav.prefix + rid
  return (
    <Box key={`row:${id}`} flexDirection="row">
      {renderStar($, ui, { kind: 'command', plugin, key: favCommandKey(c) }, rid, fav)}
      <Text> </Text>
      {c.isAvailable ? (
        <Button key={id} label={c.label} onPress={() => void runCommand($, plugin, c)} />
      ) : (
        <Text key={id} dimColor>{`${c.label} (not available)`}</Text>
      )}
      {state.queued[rid] && <Text dimColor> queued</Text>}
    </Box>
  )
}

function settingRows(section: MenuSection, rows: readonly ConfigRow[]): ConfigRow[] {
  const own = rows.filter(r => r.provider.plugin === section.plugin)
  if (section.settings === null) return own
  const out: ConfigRow[] = []
  for (const field of section.settings) {
    const row = own.find(r => r.key === `${section.plugin}.${field}`)
    if (row) out.push(row)
  }
  return out
}

function findFavCommand(f: Favourite, found: readonly MenuSection[]): SectionCommand | undefined {
  return found.find(x => x.plugin === f.plugin)?.commands.find(c => favCommandKey(c) === f.key)
}

function renderFavourite(
  $: EngineInterface,
  ui: Ui,
  f: Favourite,
  found: readonly MenuSection[],
  rows: readonly ConfigRow[],
  state: RowState,
  fav: FavCtx,
) {
  if (f.kind === 'command') {
    const c = findFavCommand(f, found)
    if (c) return renderCommand($, ui, f.plugin, c, state, fav)
  } else {
    const r = rows.find(x => x.key === f.key)
    if (r) return renderSetting($, ui, r, f.plugin, state.notes, fav)
  }
  const { Box, Text } = ui
  return (
    <Box key={`row:${fav.prefix}gone:${f.kind}:${f.plugin}:${f.key}`} flexDirection="row">
      {renderStar($, ui, f, `${f.kind}:${f.plugin}:${f.key}`, fav)}
      <Text> </Text>
      <Text dimColor>{`${f.key} (gone)`}</Text>
    </Box>
  )
}

/** Settings-only sections: plugins with rows but no menu file section, built at draw time. */
function configSections(rows: readonly ConfigRow[], filed: readonly MenuSection[]): MenuSection[] {
  const names = new Set(rows.map(r => r.provider.plugin).filter(n => n !== 'engine' && !filed.some(x => x.plugin === n)))
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
  filter: string
  blocks: Block[]
}

const FAV_ID = 'favourites'
const ENGINE_ID = 'engine'
const pluralOf = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/** Folded unless the map says otherwise; only the pinned list starts open. */
const isFolded = (folded: Record<string, boolean>, id: string): boolean => folded[id] ?? id !== FAV_ID

function isFolds(v: unknown): v is Record<string, boolean> {
  return isObject(v) && Object.values(v).every(x => typeof x === 'boolean')
}

async function storedFolds($: EngineInterface): Promise<Record<string, boolean>> {
  try {
    const stored: unknown = await $.store.get('folded')
    return isFolds(stored) ? stored : {}
  } catch {
    return {}
  }
}

async function loadFolds($: EngineInterface): Promise<void> {
  const stored = await storedFolds($)
  await update($, folded, () => stored)
}

async function writeFolds($: EngineInterface, change: (stored: Record<string, boolean>) => Record<string, boolean>): Promise<void> {
  const next = change(await storedFolds($))
  await $.store.set('folded', next)
  await update($, folded, () => next)
  $.ui.invalidate('ui.render')
}

const toggleFold = ($: EngineInterface, id: string): Promise<void> =>
  writeFolds($, stored => ({ ...stored, [id]: !isFolded(stored, id) }))

const foldAll = ($: EngineInterface, ids: readonly string[], isFold: boolean): Promise<void> =>
  writeFolds($, stored => ({ ...stored, ...Object.fromEntries(ids.map(id => [id, isFold])) }))

async function loadMenu($: EngineInterface): Promise<MenuData> {
  const [s, state, favs, folds, needle] = [
    await read($, sections),
    await read($, rowState),
    await read($, favourites),
    await read($, folded),
    (await read($, filter)).trim().toLowerCase(),
  ]
  let rows: ConfigRow[] = []
  try {
    rows = await $.config.list()
  } catch {
    rows = []
  }
  const all = [...s, ...configSections(rows, s)]
  const blocks: Block[] = []
  const hasText = (needle2: string, ...texts: string[]): boolean => texts.some(t => t.toLowerCase().includes(needle2))
  const keepRow = (r: ConfigRow): boolean => needle === '' || hasText(needle, r.label, r.key)
  const keepCommand = (c: SectionCommand): boolean => needle === '' || hasText(needle, c.label, c.command)
  const keepFav = (f: Favourite): boolean => {
    if (needle === '') return true
    if (f.kind === 'command') {
      const c = findFavCommand(f, all)
      return c ? keepCommand(c) : hasText(needle, f.key)
    }
    const r = rows.find(x => x.key === f.key)
    return r ? keepRow(r) : hasText(needle, f.key)
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
  const engineRows = rows.filter(r => r.provider.plugin === 'engine')
  if (engineRows.length > 0) push({ id: ENGINE_ID, plugin: 'engine', title: 'Claude Code', commands: [], rows: engineRows })
  return { all, rows, state, favs, folded: folds, filter: needle, blocks }
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

/** Rows a block takes: its header, plus a wrapped command row (counted as one) and a row per setting when open. */
function blockRows(b: Block, isOpen: boolean): number {
  if (!isOpen) return 1
  if (b.favs) return 1 + b.favs.length
  return 1 + (b.note ? 1 : 0) + (b.commands.length > 0 ? 1 : 0) + b.rows.length
}

function renderBlock($: EngineInterface, ui: Ui, b: Block, d: MenuData, hasFields: boolean, showBody = true) {
  const { Box, Text, Button } = ui
  const isOpen = isBlockOpen(d, b.id)
  const labelRows = b.favs
    ? b.favs.flatMap(f => (f.kind === 'setting' ? d.rows.filter(r => r.key === f.key) : []))
    : b.rows
  const widest = Math.max(0, ...labelRows.map(r => width(r.label)))
  const fav = (prefix: string): FavCtx => ({ list: d.favs, prefix, hasFields, pad: widest })
  let body: RenderNode[] | null = null
  if (!showBody) {
    body = null
  } else if (isOpen && b.favs) {
    body = b.favs.map(f => renderFavourite($, ui, f, d.all, d.rows, d.state, fav('fav:')))
  } else if (isOpen) {
    body = [
      ...(b.note ? [<Text key={`note:${b.id}`} dimColor>{b.note}</Text>] : []),
      ...(b.commands.length > 0
        ? [
            <Box key="commands" flexDirection="row" flexWrap="wrap" columnGap={2}>
              {b.commands.map(c => renderCommand($, ui, b.plugin, c, d.state, fav('')))}
            </Box>,
          ]
        : []),
      ...b.rows.map(r => renderSetting($, ui, r, b.plugin, d.state.notes, fav(''))),
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
      {body && body.length > 0 && (
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

async function renderMenu($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0]) {
  const ui = $.ui.resolve(e)
  const { Box, Text, Button } = ui
  const p = await read($, problems)
  const d = await loadMenu($)
  const hasFields = e.surface !== 'mobile'
  const sectionBlocks = d.blocks.filter(b => b.id !== FAV_ID)
  const commandTotal = sectionBlocks.reduce((n, b) => n + b.commands.length, 0)
  const settingTotal = sectionBlocks.reduce((n, b) => n + b.rows.length, 0)
  const ids = d.blocks.map(b => b.id)
  const { Input } = ui as Partial<Pick<Elements['terminal'], 'Input'>>
  const filterText = await read($, filter)
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" columnGap={2}>
        <Text bold color="cyan">Quick menu</Text>
        <Button key="expand-all" label="Expand all" hotkey="e" onPress={() => void foldAll($, ids, false)} />
        <Button key="collapse-all" label="Collapse all" hotkey="c" onPress={() => void foldAll($, ids, true)} />
        <Text dimColor>{`${pluralOf(sectionBlocks.length, 'section')} · ${pluralOf(commandTotal, 'command')} · ${pluralOf(settingTotal, 'setting')}`}</Text>
      </Box>
      {Input && hasFields && (
        <Input
          key="filter"
          placeholder="filter…"
          value={filterText}
          onInput={(value: string) => void setFilter($, value)}
          onSubmit={(value: string) => void setFilter($, value)}
        />
      )}
      {sectionBlocks.length === 0 && (
        <Text dimColor>{d.filter === '' ? 'Quick menu: nothing here yet.' : `No match for "${d.filter}".`}</Text>
      )}
      {d.blocks.map(b => renderBlock($, ui, b, d, hasFields))}
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

type BandEvent = Parameters<EngineInterface['ui']['resolve']>[0] & {
  props: { hasSurvey: boolean; bodyColumns: number; maxRows: number }
}

type BandItem = { label: string; onPress: () => void; isCommand: boolean; digit?: number }

/** Display width of a label in cells: code points, not UTF-16 units. */
function width(text: string): number {
  return [...text].length
}

function bandItem(
  $: EngineInterface,
  f: Favourite,
  found: readonly MenuSection[],
  rows: readonly ConfigRow[],
): BandItem | null {
  if (f.kind === 'command') {
    const c = findFavCommand(f, found)
    if (!c || !c.isAvailable) return null
    return { label: c.label, onPress: () => void runCommand($, f.plugin, c), isCommand: true }
  }
  const r = rows.find(x => x.key === f.key)
  if (!r) return null
  if (r.kind === 'boolean' && !r.isLocked) {
    return {
      label: `${r.label}: ${r.value ? 'on' : 'off'}`,
      onPress: () => void writeSetting($, r, !r.value),
      isCommand: false,
    }
  }
  return { label: r.label, onPress: () => void openPane($), isCommand: false }
}

/** Opens the pane; when the terminal is too narrow to place it, says why and lets the band carry the menu. */
async function openPane($: EngineInterface): Promise<void> {
  const opened = await $.ui.open({ id: PANE_ID, title: 'Quick menu', focus: true, columns: 100, closeOnEscape: true })
  await update($, unplaced, () => !opened.isPlaced)
  if (!opened.isPlaced) $.ui.toast(`Quick menu: ${opened.reason}. Showing it above the prompt instead.`)
  $.ui.invalidate('ui.render')
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
function renderBandMenu($: EngineInterface, ui: Ui, d: MenuData, budget: number) {
  const out = []
  let left = budget
  for (const b of d.blocks) {
    const need = blockRows(b, isBlockOpen(d, b.id))
    if (left < 1) break
    out.push(renderBlock($, ui, b, d, true, need <= left))
    left -= Math.min(need, left)
  }
  return out
}

async function renderBand($: EngineInterface, e: BandEvent, next: () => unknown): Promise<RenderElement> {
  if (e.props.hasSurvey) return next() as Promise<RenderElement>
  if (e.surface !== 'terminal' && e.surface !== 'desktop') return next() as Promise<RenderElement>
  const { Box, Button, Text } = $.ui.resolve(e)
  const d = await loadMenu($)
  const menuLabel = '☰ menu'
  // The menu button takes its label plus 5 cells, the divider 2, a plain button its label, 3 for a digit and 2 apart; 4 stay free for the engine's `[-]`.
  let used = width(menuLabel) + 5 + 2 + 4
  const items: BandItem[] = []
  for (const f of d.favs) {
    const item = bandItem($, f, d.all, d.rows)
    if (!item) continue
    const digits = items.filter(x => x.isCommand).length
    const digit = item.isCommand && digits < 9 ? digits + 1 : undefined
    used += width(item.label) + (digit === undefined ? 0 : 3) + 2
    if (used > e.props.bodyColumns) break
    items.push(digit === undefined ? item : { ...item, digit })
  }
  const menu = (await isUnplaced($)) ? renderBandMenu($, $.ui.resolve(e), d, e.props.maxRows - 1) : null
  const below = (await next()) as RenderNode | null | undefined
  return (
    <Box flexDirection="column">
      <Box columnGap={1}>
        <Button key="band:menu" label={menuLabel} hotkey="m" onPress={() => void openPane($)} />
        {items.length > 0 && <Text dimColor>│</Text>}
        {items.map((item, i) => (
          <Button
            key={`band:${i + 1}`}
            label={item.label}
            plain
            {...(item.digit !== undefined && { hotkey: String(item.digit) })}
            onPress={item.onPress}
          />
        ))}
      </Box>
      {menu}
      {below}
    </Box>
  )
}

export const register: Register = on => {
  on('plugin.register', async ($, e, next) => {
    if (e.provenance.endsWith('@inline')) {
      inlineRoots.set(e.name, e.root)
      await update($, inlineRootState, m => ({ ...m, [e.name]: e.root }))
    }
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    sessionCwd = e.cwd
    await update($, rowState, () => ({ queued: {}, notes: {} }))
    await update($, unplaced, () => false)
    await update($, filter, () => '')
    await loadFavourites($)
    await loadFolds($)
    await $.command.register({
      name: 'menu',
      description: 'Open the quick menu (refresh: discover plugin menus again)',
      argumentHint: '[refresh]',
    })
    // After next(e): the plugins beneath register their commands in their own session.start, and discovery marks
    // a command missing from $.command.list() unavailable. Not awaited: the session does not wait on file reads.
    const result = await next(e)
    startDiscovery($)
    return result
  })

  on('command.run', { command: 'menu' }, ($, e) => openMenu($, e.args ?? ''))

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e) => renderMenu($, e))

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => renderBand($, e, () => next(e)))
}
