import { atom, read, update } from 'claude-code'
import type { ConfigRow, ConfigValue, EngineInterface, Register } from 'claude-code'

import type { Favourite, MenuCommand, MenuFile, MenuProblem, MenuSection, SectionCommand } from '../types'

export const PANE_ID = 'quick-menu'
const MENU_FILE = '.claude-plugin/quick-menu.json'

const sections = atom({ plugin: 'agent-quick-menu', key: 'sections' } as const, [] as MenuSection[])
const problems = atom({ plugin: 'agent-quick-menu', key: 'problems' } as const, [] as MenuProblem[])

const favourites = atom({ plugin: 'agent-quick-menu', key: 'favourites' } as const, [] as Favourite[])

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
  const home = await $.env.get('HOME')
  const registryPath = `${home ?? ''}/.claude/plugins/installed_plugins.json`
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
    const entries = plugins[id]
    const entry = Array.isArray(entries) ? entries.at(-1) : undefined
    if (isObject(entry) && typeof entry.installPath === 'string') {
      targets.push({ name: id.split('@')[0], root: entry.installPath })
    }
  }
  return targets
}

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

function fieldsOf(rows: readonly { key: string }[], plugin: string): string[] {
  return rows.filter(r => r.key.startsWith(`${plugin}.`)).map(r => r.key.slice(plugin.length + 1))
}

/** Reads every enabled plugin's menu file and builds the sections; failures become problems. */
export async function discover($: EngineInterface): Promise<{ sections: MenuSection[]; problems: MenuProblem[] }> {
  const found: MenuProblem[] = []
  const all = [...(await registryTargets($, found)), ...(await dirTargets($, found))]
  const targets = all.filter((t, i) => all.findIndex(o => o.name === t.name) === i)

  let available = new Set<string>()
  try {
    available = new Set((await $.command.list()).map(c => c.name))
  } catch (err) {
    found.push({ plugin: 'commands', message: `cannot list commands: ${message(err)}` })
  }
  let rows: readonly { key: string }[] = []
  try {
    rows = await $.config.list()
  } catch (err) {
    found.push({ plugin: 'config', message: `cannot list settings: ${message(err)}` })
  }

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
      continue
    }
    const fields = fieldsOf(rows, target.name)
    if (fields.length > 0) {
      result.push({ plugin: target.name, title: target.name, commands: [], settings: fields, source: 'config' })
    }
  }
  result.sort((a, b) => (a.source === b.source ? a.title.localeCompare(b.title) : a.source === 'file' ? -1 : 1))
  return { sections: result, problems: found }
}

async function runDiscovery($: EngineInterface): Promise<void> {
  const found = await discover($)
  await update($, sections, () => found.sections)
  await update($, problems, () => found.problems)
}

async function openMenu($: EngineInterface, args: string): Promise<{ text: string }> {
  if (args.trim() === 'refresh') {
    await runDiscovery($)
    const [s, p] = [await read($, sections), await read($, problems)]
    return { text: `Quick menu refreshed: ${s.length} sections, ${p.length} problems` }
  }
  await openPane($)
  return { text: 'Quick menu opened' }
}

type Note = { kind: 'deny' | 'error'; text: string }
type RowState = { queued: Record<string, true>; notes: Record<string, Note> }

const rowState = atom({ plugin: 'agent-quick-menu', key: 'rowState' } as const, {
  queued: {},
  notes: {},
} as RowState)

const commandKey = (plugin: string, c: SectionCommand): string => `cmd:${plugin}:${c.command}:${c.args ?? ''}`
const settingKey = (key: string): string => `set:${key}`

const toastLine = (text: string): string => text.split('\n')[0].slice(0, 200)

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
  if ((await read($, rowState)).queued[id]) return
  await setQueued($, id, true)
  $.ui.invalidate('ui.render')
  try {
    const result = await $.command.run({ command: c.command, ...(c.args !== undefined && { args: c.args }) })
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

async function loadFavourites($: EngineInterface): Promise<void> {
  let stored: unknown
  try {
    stored = await $.store.get('favourites')
  } catch {
    stored = undefined
  }
  await update($, favourites, () => (isFavourites(stored) ? stored : []))
}

async function toggleFavourite($: EngineInterface, f: Favourite): Promise<void> {
  await update($, favourites, list => (isFavourite(list, f) ? list.filter(x => !sameFav(x, f)) : [...list, f]))
  await $.store.set('favourites', await read($, favourites))
  $.ui.invalidate('ui.render')
}

type FavCtx = { list: readonly Favourite[]; prefix: string }

function renderStar($: EngineInterface, ui: Ui, f: Favourite, id: string, fav: FavCtx) {
  const { Button } = ui
  return (
    <Button
      key={`${fav.prefix}star:${id}`}
      label={isFavourite(fav.list, f) ? '★' : '☆'}
      onPress={() => void toggleFavourite($, f)}
    />
  )
}

function renderSetting(
  $: EngineInterface,
  ui: Ui,
  row: ConfigRow,
  plugin: string,
  notes: Record<string, Note>,
  fav: FavCtx,
) {
  const { Box, Text, Button, Select, Input } = ui
  const id = fav.prefix + settingKey(row.key)
  const note = notes[settingKey(row.key)]
  const shown = Array.isArray(row.value) ? row.value.join(', ') : String(row.value)
  let control
  if (row.isLocked) {
    control = <Text key={id}>{`${row.label}: ${shown} (managed)`}</Text>
  } else if (row.kind === 'boolean') {
    control = (
      <Button
        key={id}
        label={`${row.label}: ${row.value ? 'on' : 'off'}`}
        onPress={() => void writeSetting($, row, !row.value)}
      />
    )
  } else if (row.kind === 'choice' && row.options && row.options.length > 0) {
    control = (
      <Select
        key={id}
        label={`${row.label}: `}
        options={row.options.map(value => ({ value }))}
        value={shown}
        onSelect={value => void writeSetting($, row, value)}
      />
    )
  } else {
    control = (
      <Input
        key={id}
        label={`${row.label}: `}
        value={shown}
        onSubmit={value => void (row.kind === 'number' ? submitNumber($, row, value) : writeSetting($, row, value))}
      />
    )
  }
  return (
    <Box key={`row:${id}`} flexDirection="row">
      {renderStar($, ui, { kind: 'setting', plugin, key: row.key }, settingKey(row.key), fav)}
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
      {c.isAvailable ? (
        <Button key={id} label={c.label} onPress={() => void runCommand($, plugin, c)} />
      ) : (
        <Text key={id} dimColor>{`${c.label} (not available)`}</Text>
      )}
      {state.queued[rid] && <Text dimColor>  queued</Text>}
      {c.description && <Text dimColor>{`  ${c.description}`}</Text>}
    </Box>
  )
}

function settingRows(section: MenuSection, rows: readonly ConfigRow[]): ConfigRow[] {
  const own = rows.filter(r => r.key.startsWith(`${section.plugin}.`))
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
      <Text dimColor>{`${f.key} (gone)`}</Text>
    </Box>
  )
}

async function renderMenu($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0]) {
  const ui = $.ui.resolve(e)
  const { Box, Text } = ui
  const [s, p, state] = [await read($, sections), await read($, problems), await read($, rowState)]
  let rows: ConfigRow[] = []
  try {
    rows = await $.config.list()
  } catch {
    rows = []
  }
  const engineRows = rows.filter(r => r.provider.plugin === 'engine')
  const favs = await read($, favourites)
  const own: FavCtx = { list: favs, prefix: '' }
  const pinned: FavCtx = { list: favs, prefix: 'fav:' }
  return (
    <Box flexDirection="column">
      {favs.length > 0 && (
        <Box key="favourites" flexDirection="column">
          <Text bold>Favourites</Text>
          {favs.map(f => renderFavourite($, ui, f, s, rows, state, pinned))}
        </Box>
      )}
      {s.length === 0 && engineRows.length === 0 && <Text dimColor>Quick menu: nothing here yet.</Text>}
      {s.map(section => (
        <Box key={section.plugin} flexDirection="column">
          <Text bold>{section.title}</Text>
          {section.commands.map(c => renderCommand($, ui, section.plugin, c, state, own))}
          {settingRows(section, rows).map(r => renderSetting($, ui, r, section.plugin, state.notes, own))}
        </Box>
      ))}
      {engineRows.length > 0 && (
        <Box key="claude-code" flexDirection="column">
          <Text bold>Claude Code</Text>
          {engineRows.map(r => renderSetting($, ui, r, 'engine', state.notes, own))}
        </Box>
      )}
      {p.length > 0 && <Text bold>Problems</Text>}
      {p.map((x, i) => (
        <Text key={i} color="red">{`  ${x.plugin}: ${x.message}`}</Text>
      ))}
    </Box>
  )
}

type BandEvent = Parameters<EngineInterface['ui']['resolve']>[0] & {
  props: { hasSurvey: boolean; bodyColumns: number }
}

type BandItem = { label: string; onPress: () => void }

function bandItem(
  $: EngineInterface,
  f: Favourite,
  found: readonly MenuSection[],
  rows: readonly ConfigRow[],
): BandItem | null {
  if (f.kind === 'command') {
    const c = findFavCommand(f, found)
    if (!c || !c.isAvailable) return null
    return { label: c.label, onPress: () => void runCommand($, f.plugin, c) }
  }
  const r = rows.find(x => x.key === f.key)
  if (!r) return null
  if (r.kind === 'boolean' && !r.isLocked) {
    return { label: `${r.label}: ${r.value ? 'on' : 'off'}`, onPress: () => void writeSetting($, r, !r.value) }
  }
  return { label: r.label, onPress: () => void openPane($) }
}

async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE_ID, title: 'Quick menu', focus: true, columns: 100 })
}

async function renderBand($: EngineInterface, e: BandEvent, next: () => unknown) {
  if (e.props.hasSurvey) return next()
  if (e.surface !== 'terminal' && e.surface !== 'desktop') return next()
  const { Box, Button } = $.ui.resolve(e)
  const [favs, found] = [await read($, favourites), await read($, sections)]
  let rows: ConfigRow[] = []
  try {
    rows = await $.config.list()
  } catch {
    rows = []
  }
  const menuLabel = '☰ menu'
  let used = menuLabel.length + 2
  const items: BandItem[] = []
  for (const f of favs) {
    const item = bandItem($, f, found, rows)
    if (!item) continue
    used += item.label.length + 3
    if (used > e.props.bodyColumns) break
    items.push(item)
  }
  const below = await next()
  return (
    <Box flexDirection="column">
      <Box>
        <Button key="band:menu" label={menuLabel} hotkey="m" onPress={() => void openPane($)} />
        {items.map((item, i) => (
          <Button
            key={`band:${i + 1}`}
            label={item.label}
            {...(i < 9 && { hotkey: String(i + 1) })}
            onPress={item.onPress}
          />
        ))}
      </Box>
      {below !== undefined && below !== null && below}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'menu',
      description: 'Open the quick menu (refresh: discover plugin menus again)',
      argumentHint: '[refresh]',
    })
    await runDiscovery($)
    await loadFavourites($)
    return next(e)
  })

  on('command.run', { command: 'menu' }, ($, e) => openMenu($, e.args ?? ''))

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e) => renderMenu($, e))

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => renderBand($, e, () => next(e)))
}
