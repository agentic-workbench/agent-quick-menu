import { describe, expect, mock, test } from 'claude-code/testing'

import { validateMenuFile } from './quick-menu'

const PANE_PROPS = {
  title: 'Quick menu',
  isFocused: true,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, max: 0 },
  view: { rows: 24, columns: 100 },
}

const HOME = '/home/u'
const REGISTRY = `${HOME}/.claude/plugins/installed_plugins.json`

type World = {
  enabled?: Record<string, boolean>
  registry?: Record<string, Record<string, unknown>[]>
  files?: Record<string, string>
  vars?: Record<string, string>
  commands?: string[]
  pluginCommands?: { name: string; plugin: string; description?: string }[]
  rows?: Record<string, unknown>[]
  run?: (e: { command: string; args?: string }) => unknown
  set?: (e: { key: string; value: string }) => { value?: string; deny?: string }
  /** `/config` answers `{}`, as an interactive session's `$.command.run` does: its text goes to the transcript only. */
  silentConfig?: boolean
  open?: (e: unknown) => void
  placed?: false
  store?: Map<string, unknown>
  /** The menu's own quick-menu.json, answered for the one path outside `files` ending in it (the plugin's own root). */
  self?: string
  /** Runs inside the stub's session.start, as a plugin beneath registering its commands there. */
  onStart?: () => void
  /** The plugin `commands` belong to in `$.command.list()`; default `alpha@mk`. */
  commandOwner?: string
  /** `$.store.set` fails with this message. */
  storeFails?: string
  /** Names `$.command.list()` reports as built-in commands. */
  builtins?: string[]
  /** What `$.fs.stat` answers for a path, over a regular file the size of its content. */
  stat?: Record<string, { kind?: string; isLink?: boolean; size?: number }>
  /** `$.command.list()` waits for this before it answers (a slow discovery), e.g. `() => clock.sleep(400)`. */
  listWait?: () => Promise<void>
  /** What `$.ui.panes()` lists; none by default. */
  panes?: () => { id: string; isPlaced?: boolean }[]
}

const MENU_FILE = '/.claude-plugin/quick-menu.json'

function stub(on: any, w: World) {
  // A real registry entry carries its scope; the fixtures leave it out when it does not matter, meaning the user scope.
  const registry = () =>
    Object.fromEntries(
      Object.entries(w.registry ?? {}).map(([id, entries]) => [id, entries.map(x => ({ scope: 'user', ...x }))]),
    )
  const files = (): Record<string, string> => ({
    ...w.files,
    ...(w.registry && { [REGISTRY]: JSON.stringify({ version: 2, plugins: registry() }) }),
  })
  const vars = (): Record<string, string> => ({ HOME, ...w.vars })
  on('session.start', () => (w.onStart?.(), { cwd: '/tmp' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', (_$: unknown, e: unknown) => (
    w.open?.(e),
    { value: w.placed === false ? { isPlaced: false, reason: 'terminal too narrow' } : { isPlaced: true } }
  ))
  on('ui.panes', () => ({ value: w.panes?.() ?? [] }))
  const store = w.store ?? new Map<string, unknown>()
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    if (w.storeFails) throw new Error(w.storeFails)
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('settings.read', () => ({ value: { enabledPlugins: w.enabled ?? {} } }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: vars()[e.name] }))
  const isSelf = (path: string): boolean => w.self !== undefined && !(path in files()) && path.endsWith(MENU_FILE)
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: e.path in files() || isSelf(e.path) }))
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    const content = isSelf(e.path) ? (w.self as string) : files()[e.path]
    return { value: { kind: 'file', size: content?.length ?? 0, mtimeMs: 0, isLink: false, ...w.stat?.[e.path] } }
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (isSelf(e.path)) return { value: w.self }
    const f = files()
    if (!(e.path in f)) throw new Error(`ENOENT ${e.path}`)
    return { value: f[e.path] }
  })
  on('command.list', async () => {
    await w.listWait?.()
    return { value: [
      ...(w.commands ?? []).map(name => ({ name, description: '', source: 'plugin', plugin: w.commandOwner ?? 'alpha@mk' })),
      ...(w.builtins ?? []).map(name => ({ name, description: '', source: 'builtin' })),
      ...(w.pluginCommands ?? []).map(c => ({ description: '', source: 'plugin', ...c })),
    ] }
  })
  on('config.list', () => ({ value: w.rows ?? [] }))
  on('command.run', (_$: unknown, e: { command: string; args?: string }) => {
    if (e.command === 'menu') return undefined
    // `/config key=value`: the value arrives as bare text; a refusal is answered as text, a write as "Set <key> to <value>".
    if (e.command === 'config') {
      const at = (e.args ?? '').indexOf('=')
      const set = { key: (e.args ?? '').slice(0, at), value: (e.args ?? '').slice(at + 1) }
      const out = w.set ? w.set(set) : { value: set.value }
      // A write lands in the row, as `$.config.list()` reads it afterwards, in the row's kind.
      if (out.deny === undefined && w.rows) {
        const written = out.value ?? set.value
        w.rows = w.rows.map(r =>
          r.key !== set.key
            ? r
            : { ...r, value: r.kind === 'boolean' ? written === 'true' : r.kind === 'number' ? Number(written) : written },
        )
      }
      if (w.silentConfig) return {}
      return { text: out.deny !== undefined ? out.deny : `Set ${set.key} to ${set.value}` }
    }
    return w.run ? w.run(e) : { text: 'ok' }
  })
}

async function start($: any, cwd = '/tmp') {
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true })
}

/** The pane on `surface`, `columns` wide; every section expanded unless `expand` is false (its default fold). */
async function mountPane(
  $: any,
  { surface = 'terminal', columns, expand = true }: { surface?: string; columns?: number; expand?: boolean } = {},
): Promise<any> {
  const ui = await $.ui.mount({
    plugin: 'agent-quick-menu',
    surface,
    component: 'Pane',
    props: { ...PANE_PROPS, ...(columns !== undefined && { bodyColumns: columns }) } as never,
    requestId: 'quick-menu',
  })
  if (expand) await ui.press({ key: 'expand-all' })
  return ui
}

const row = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  label: key.split('.').pop() as string,
  kind: 'text',
  value: '',
  provider: { plugin: key.includes('.') ? key.split('.')[0] : 'engine', tier: 'core' },
  isLocked: false,
  ...extra,
})

const realButtons = async (ui: any) =>
  (await ui.findAll({ type: 'Button' })).filter((b: any) => !/star:|^fold:|^(expand|collapse)-all$/.test(String(b.key)))

const file = (o: unknown) => JSON.stringify(o)

/** A `set` for the stub that records each `/config key=value` write and accepts it. */
const recordSets = () => {
  const sets: { key: string; value: string }[] = []
  return { sets, set: (e: { key: string; value: string }) => (sets.push(e), { value: e.value }) }
}

/** The menu's own quick-menu.json. */
const SELF_FILE = file({
  version: 1,
  title: 'Quick menu',
  commands: [{ command: 'menu', label: 'Refresh', args: 'refresh' }],
  settings: [],
})

const ALPHA = {
  enabled: { 'alpha@mk': true },
  registry: { 'alpha@mk': [{ installPath: '/p/alpha' }] },
}
const alphaFile = (o: unknown) => ({ '/p/alpha/.claude-plugin/quick-menu.json': file(o) })

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 3,
  bodyColumns: 100,
  scroll: { offset: 0, max: 0 },
  view: { rows: 24, columns: 100 },
} as never

async function mountBand($: any, props: unknown = BAND_PROPS, surface = 'terminal') {
  return $.ui.mount({ plugin: 'agent-quick-menu', surface, component: 'AbovePrompt', props })
}

const FAV_WORLD = (extra: Partial<World> = {}): World => ({
  ...ALPHA,
  files: alphaFile({ version: 1, commands: [{ command: 'go', label: 'Go', args: '--all' }, { command: 'stop' }] }),
  commands: ['go', 'stop'],
  rows: [row('alpha.flag', { kind: 'boolean', value: false }), row('alpha.name', { value: 'x' })],
  ...extra,
})

/** Every Text, and each section title (the fold button's label without its chevron), in drawing order. */
const textsOf = async (ui: any): Promise<string[]> =>
  (await ui.findAll({ text: /[\s\S]/ }))
    .filter((x: any) => x.type === 'Text' || (x.type === 'Button' && String(x.key).startsWith('fold:')))
    .map((x: any) => (x.type === 'Text' ? x.text : String(x.props.label).slice(2)) as string)
/** A section title: its fold button (the label is `▾ title`). */
const titleOf = async (ui: any, re: RegExp): Promise<any> =>
  (await ui.findAll({ type: 'Button' })).find((b: any) => String(b.key).startsWith('fold:') && re.test(String(b.props.label).slice(2)))

const emptyBase = (on: any) =>
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

const toastsOf = (on: any): string[] => {
  const toasts: string[] = []
  on('ui.toast', (_$: any, e: any, next: any) => (toasts.push(e.text), next(e)))
  return toasts
}

describe('validateMenuFile', () => {
  test('accepts a full file and defaults', () => {
    const r = validateMenuFile({
      version: 1,
      title: 'T',
      commands: [{ command: 'a', label: 'A', args: '-x', description: 'd' }],
      settings: ['s'],
    })
    expect(r).toEqual({
      ok: true,
      value: { version: 1, title: 'T', commands: [{ command: 'a', label: 'A', args: '-x', description: 'd' }], settings: ['s'] },
    })
    expect(validateMenuFile({ version: 1 })).toMatchObject({ ok: true, value: { commands: [], settings: null } })
  })

  test('rejects wrong version, bad types and bad command entries', () => {
    expect(validateMenuFile({ version: 2 })).toMatchObject({ ok: false, error: expect.stringMatching(/version/) })
    expect(validateMenuFile([])).toMatchObject({ ok: false })
    expect(validateMenuFile({ version: 1, title: 3 })).toMatchObject({ ok: false })
    expect(validateMenuFile({ version: 1, commands: {} })).toMatchObject({ ok: false })
    expect(validateMenuFile({ version: 1, commands: [{ command: '' }] })).toMatchObject({ ok: false })
    expect(validateMenuFile({ version: 1, commands: [{ label: 'x' }] })).toMatchObject({ ok: false })
    expect(validateMenuFile({ version: 1, commands: [{ command: 'a', args: 1 }] })).toMatchObject({ ok: false })
    expect(validateMenuFile({ version: 1, settings: [1] })).toMatchObject({ ok: false })
  })
})

describe('discovery', () => {
  test('stubbed settings, registry and files produce sections, flagging unavailable commands', async ($, on) => {
    stub(on, {
      enabled: { 'alpha@mk': true, 'off@mk': false },
      registry: { 'alpha@mk': [{ installPath: '/p/alpha' }], 'off@mk': [{ installPath: '/p/off' }] },
      files: {
        '/p/alpha/.claude-plugin/quick-menu.json': file({
          version: 1,
          title: 'Alpha',
          commands: [{ command: 'a-run', args: '--all' }, { command: 'gone', label: 'Gone' }],
          settings: ['mode'],
        }),
        '/p/off/.claude-plugin/quick-menu.json': file({ version: 1 }),
      },
      commands: ['a-run'],
    })
    await start($)
    const ui = await mountPane($)
    expect(await titleOf(ui, /^Alpha/)).toBeDefined()
    expect(await ui.find({ key: 'cmd:alpha:a-run:--all' })).toBeDefined()
    expect(await ui.find({ text: /Gone \(not available\)/ })).toBeDefined()
    expect(await realButtons(ui)).toHaveLength(1)
    expect(await ui.find({ text: /off/ })).toBeUndefined()
  })

  test('invalid JSON, wrong version and bad command entry become problems', async ($, on) => {
    stub(on, {
      enabled: { 'a@m': true, 'b@m': true, 'c@m': true },
      registry: {
        'a@m': [{ installPath: '/p/a' }],
        'b@m': [{ installPath: '/p/b' }],
        'c@m': [{ installPath: '/p/c' }],
      },
      files: {
        '/p/a/.claude-plugin/quick-menu.json': '{not json',
        '/p/b/.claude-plugin/quick-menu.json': file({ version: 9 }),
        '/p/c/.claude-plugin/quick-menu.json': file({ version: 1, commands: [{ label: 'x' }] }),
      },
    })
    await start($)
    const ui = await mountPane($)
    expect(await ui.find({ text: /Problems/ })).toBeDefined()
    expect(await ui.find({ text: /a: .*quick-menu\.json/ })).toBeDefined()
    expect(await ui.find({ text: /b: .*unsupported version 9/ })).toBeDefined()
    expect(await ui.find({ text: /c: .*commands\[0\]\.command/ })).toBeDefined()
  })

  test('a plugin without a file but with userConfig rows gets a settings-only section', async ($, on) => {
    stub(on, {
      enabled: { 'cfg@m': true, 'bare@m': true },
      registry: { 'cfg@m': [{ installPath: '/p/cfg' }], 'bare@m': [{ installPath: '/p/bare' }] },
      rows: [row('cfg.token'), row('cfg.mode'), row('other.x'), row('theme')],
    })
    await start($)
    const ui = await mountPane($)
    expect(await titleOf(ui, /^cfg$/)).toBeDefined()
    expect(await ui.find({ key: 'set:cfg.token' })).toBeDefined()
    expect(await ui.find({ key: 'set:cfg.mode' })).toBeDefined()
    expect(await ui.find({ key: 'set:other.x' })).toBeDefined()
    expect(await ui.find({ text: /bare/ })).toBeUndefined()
  })

  test('the registry is read from CLAUDE_CONFIG_DIR when set', async ($, on) => {
    stub(on, {
      enabled: { 'alpha@mk': true },
      vars: { CLAUDE_CONFIG_DIR: '/cfg' },
      files: {
        '/cfg/plugins/installed_plugins.json': file({
          version: 2,
          plugins: { 'alpha@mk': [{ scope: 'user', installPath: '/p/alpha' }] },
        }),
        '/p/alpha/.claude-plugin/quick-menu.json': file({ version: 1, title: 'FromCfgDir' }),
      },
    })
    await start($)
    const ui = await mountPane($)
    expect(await titleOf(ui, /^FromCfgDir · alpha$/)).toBeDefined()
    expect(await ui.find({ text: /installed_plugins/ })).toBeUndefined()
  })

  test('the install entry is the project or local one for the cwd, else the user one, else none', async ($, on) => {
    const mixed: Record<string, unknown>[] = [
      { scope: 'project', projectPath: '/other', installPath: '/p/other' },
      { scope: 'user', installPath: '/p/user' },
      { scope: 'local', projectPath: '/work', installPath: '/p/work' },
    ]
    const world: World = {
      enabled: { 'alpha@mk': true },
      registry: { 'alpha@mk': mixed },
      files: Object.fromEntries(
        ['other', 'user', 'work'].map(n => [`/p/${n}/.claude-plugin/quick-menu.json`, file({ version: 1, title: n })]),
      ),
    }
    stub(on, world)
    const titles = async (cwd: string) => {
      await start($, cwd)
      const ui = await mountPane($)
      const labels = await textsOf(ui)
      await ui.unmount()
      return labels
    }
    expect(await titles('/work')).toContain('work · alpha')
    world.registry = { 'alpha@mk': [mixed[0]!, mixed[1]!] }
    expect(await titles('/nowhere')).toContain('user · alpha')
    // No user entry and none for this cwd: the plugin is not read from a project it was installed for elsewhere.
    world.registry = { 'alpha@mk': [mixed[0]!, mixed[2]!] }
    expect((await titles('/nowhere')).filter((t: string) => t.includes('alpha'))).toEqual([])
  })

  test('a builtin plugin with rows gets a settings-only section without a registry entry', async ($, on) => {
    stub(on, {
      rows: [row('inline.opt', { provider: { plugin: 'inline', tier: 'core' } }), row('theme')],
    })
    await start($)
    const ui = await mountPane($)
    expect(await titleOf(ui, /^inline$/)).toBeDefined()
    expect(await ui.find({ key: 'set:inline.opt' })).toBeDefined()
  })

  test('CLAUDE_CODE_PLUGIN_DIRS roots are discovered by their plugin.json name', async ($, on) => {
    stub(on, {
      registry: {},
      vars: { CLAUDE_CODE_PLUGIN_DIRS: '/dev/one:/dev/two' },
      files: {
        '/dev/one/.claude-plugin/plugin.json': file({ name: 'devone' }),
        '/dev/one/.claude-plugin/quick-menu.json': file({ version: 1, commands: [{ command: 'x' }] }),
      },
    })
    await start($)
    const ui = await mountPane($)
    expect(await titleOf(ui, /^devone$/)).toBeDefined()
    expect(await ui.find({ text: /two: cannot identify plugin dir/ })).toBeDefined()
  })

  test('CLAUDE_CODE_PLUGIN_DIRS splits on ; when one is present', async ($, on) => {
    stub(on, {
      registry: {},
      vars: { CLAUDE_CODE_PLUGIN_DIRS: '/dev/one;/dev/two:x' },
      files: {
        '/dev/one/.claude-plugin/plugin.json': file({ name: 'devone' }),
        '/dev/one/.claude-plugin/quick-menu.json': file({ version: 1, commands: [{ command: 'x' }] }),
      },
    })
    await start($)
    const ui = await mountPane($)
    expect(await titleOf(ui, /^devone$/)).toBeDefined()
    expect(await ui.find({ text: /\/dev\/two:x: cannot identify plugin dir/ })).toBeDefined()
  })

  test('/menu refresh reruns discovery and toasts the counts when it lands', async ($, on) => {
    const clock = mock.clock(on)
    const toasts = toastsOf(on)
    const world: World = { enabled: {}, registry: {} }
    stub(on, world)
    await start($)
    const before = await $.command.run({ command: 'menu', args: 'refresh' } as never)
    expect(before.text).toMatch(/discovering/)
    await clock.settle()
    expect(toasts.at(-1)).toMatch(/0 sections/)
    world.enabled = { 'late@m': true }
    world.registry = { 'late@m': [{ installPath: '/p/late' }] }
    world.files = { '/p/late/.claude-plugin/quick-menu.json': file({ version: 1 }) }
    await $.command.run({ command: 'menu', args: 'refresh' } as never)
    await clock.settle()
    expect(toasts.at(-1)).toMatch(/1 sections, 0 problems/)
  })

  test('a --plugin-dir plugin without a known root is listed from $.command.list() with its commands only', async ($, on) => {
    const runs: unknown[] = []
    stub(on, {
      registry: {},
      pluginCommands: [
        { name: 'rt-status', plugin: 'repo-tools', description: 'Status' },
        { name: 'rt-pull', plugin: 'repo-tools@inline' },
        { name: 'x', plugin: 'cc-plugin-agents-md' },
      ],
      run: e => (runs.push(e), { text: 'ok' }),
    })
    await start($)
    const ui = await mountPane($)
    expect(await ui.find({ key: 'fold:plugin:repo-tools' })).toBeDefined()
    expect(await ui.find({ key: 'cmd:repo-tools:rt-status:' })).toBeDefined()
    expect(await ui.find({ key: 'cmd:repo-tools:rt-pull:' })).toBeDefined()
    expect(await ui.find({ text: /CLAUDE_CODE_PLUGIN_DIRS to read its quick-menu\.json/ })).toBeDefined()
    expect(await ui.find({ text: /agents-md/ })).toBeUndefined()
    await ui.press({ key: 'cmd:repo-tools:rt-status:' })
    expect(runs).toMatchObject([{ command: 'rt-status' }])
  })

  test('a plugin whose menu file was read through CLAUDE_CODE_PLUGIN_DIRS is not listed twice', async ($, on) => {
    stub(on, {
      registry: {},
      vars: { CLAUDE_CODE_PLUGIN_DIRS: '/dev/one' },
      files: {
        '/dev/one/.claude-plugin/plugin.json': file({ name: 'devone' }),
        '/dev/one/.claude-plugin/quick-menu.json': file({ version: 1, commands: [{ command: 'x' }] }),
      },
      pluginCommands: [{ name: 'x', plugin: 'devone' }],
    })
    await start($)
    const ui = await mountPane($)
    expect((await textsOf(ui)).filter(t => t === 'devone')).toHaveLength(1)
    expect(await ui.find({ text: /CLAUDE_CODE_PLUGIN_DIRS to read/ })).toBeUndefined()
  })

  // The test kit raises no plugin.register, so the --plugin-dir root comes in through CLAUDE_CODE_PLUGIN_DIRS, ranked with it.
  test('a --plugin-dir root shadows the installed copy of the same plugin, and its menu file is read', async ($, on) => {
    stub(on, {
      enabled: { 'repo-tools@mk': true },
      registry: { 'repo-tools@mk': [{ scope: 'user', installPath: '/p/rt-installed' }] },
      vars: { CLAUDE_CODE_PLUGIN_DIRS: '/dev/rt' },
      files: {
        '/dev/rt/.claude-plugin/plugin.json': file({ name: 'repo-tools' }),
        '/dev/rt/.claude-plugin/quick-menu.json': file({
          version: 1,
          title: 'repo-tools',
          commands: [{ command: 'rt-status', label: 'Status' }, { command: 'rt-pull', label: 'Pull all', args: '--all' }],
        }),
      },
      commands: ['rt-status', 'rt-pull'],
      commandOwner: 'repo-tools@mk',
    })
    await start($)
    const ui = await mountPane($)
    expect(await ui.find({ key: 'fold:plugin:repo-tools' })).toBeDefined()
    expect(await ui.find({ key: 'cmd:repo-tools:rt-status:' })).toBeDefined()
    expect(await ui.find({ key: 'cmd:repo-tools:rt-pull:--all' })).toBeDefined()
    expect(await ui.find({ text: /CLAUDE_CODE_PLUGIN_DIRS/ })).toBeUndefined()
  })

  test('commands a plugin beneath registers in its own session.start are available, not "not available"', async ($, on) => {
    const world: World = {
      ...ALPHA,
      files: alphaFile({ version: 1, commands: [{ command: 'late', label: 'Late' }] }),
      commands: [],
    }
    world.onStart = () => {
      world.commands = ['late']
    }
    stub(on, world)
    await start($)
    const ui = await mountPane($)
    expect(await ui.find({ key: 'cmd:alpha:late:' })).toBeDefined()
    expect(await ui.find({ text: /not available/ })).toBeUndefined()
  })

  test('a command registered after discovery is available once the pane is opened', async ($, on) => {
    const clock = mock.clock(on)
    const world: World = {
      ...ALPHA,
      files: alphaFile({ version: 1, commands: [{ command: 'late', label: 'Late' }] }),
      commands: [],
    }
    stub(on, world)
    await start($)
    await clock.settle()
    const ui = await mountPane($)
    expect(await ui.find({ text: /Late \(not available\)/ })).toBeDefined()
    world.commands = ['late']
    await $.command.run({ command: 'menu' } as never)
    await clock.settle()
    expect(await ui.find({ key: 'cmd:alpha:late:' })).toBeDefined()
    expect(await ui.find({ text: /not available/ })).toBeUndefined()
  })

  test('the menu reads its own quick-menu.json from $.plugin.root, with no --plugin-dir note', async ($, on) => {
    stub(on, {
      registry: {},
      self: SELF_FILE,
      pluginCommands: [{ name: 'menu', plugin: 'agent-quick-menu' }],
    })
    await start($)
    const ui = await mountPane($)
    expect(await titleOf(ui, /^Quick menu · agent-quick-menu$/)).toBeDefined()
    expect((await ui.find({ key: 'cmd:agent-quick-menu:menu:refresh' })).props.label).toBe('Refresh')
    expect(await ui.find({ key: 'cmd:agent-quick-menu:menu:' })).toBeUndefined()
    expect(await ui.find({ text: /loaded with --plugin-dir/ })).toBeUndefined()
  })
})

describe('commands', () => {
  test('press runs $.command.run with command and args, shows queued, then toasts the first line', async ($, on) => {
    const clock = mock.clock(on)
    let release: (v?: unknown) => void = () => {}
    const calls: unknown[] = []
    const toasts = toastsOf(on)
    stub(on, {
      ...ALPHA,
      files: alphaFile({ version: 1, commands: [{ command: 'go', args: '--all', description: 'does it' }] }),
      commands: ['go'],
      run: e => {
        calls.push(e)
        return new Promise(res => {
          release = res
        })
      },
    })
    await start($)
    const ui = await mountPane($)
    const pressed = ui.press({ key: 'cmd:alpha:go:--all' })
    await clock.settle()
    expect(calls).toMatchObject([{ command: 'go', args: '--all' }])
    expect(await ui.find({ text: /queued/ })).toBeDefined()
    release({ text: 'first line\nsecond' })
    await pressed
    await clock.settle()
    expect(toasts).toEqual(['first line'])
    expect(await ui.find({ text: /queued/ })).toBeUndefined()
  })

  test('two quick presses run the command once', async ($, on) => {
    const clock = mock.clock(on)
    let release: (v?: unknown) => void = () => {}
    const calls: unknown[] = []
    stub(on, {
      ...ALPHA,
      files: alphaFile({ version: 1, commands: [{ command: 'go' }] }),
      commands: ['go'],
      run: e => (calls.push(e), new Promise(res => (release = res))),
    })
    await start($)
    const ui = await mountPane($)
    const first = ui.press({ key: 'cmd:alpha:go:' })
    const second = ui.press({ key: 'cmd:alpha:go:' })
    await clock.settle()
    release({ text: 'ok' })
    await Promise.all([first, second])
    await clock.settle()
    expect(calls).toHaveLength(1)
  })

  test('a hot reload (session.start again) clears the queued state', async ($, on) => {
    const clock = mock.clock(on)
    const calls: unknown[] = []
    stub(on, {
      ...ALPHA,
      files: alphaFile({ version: 1, commands: [{ command: 'go' }] }),
      commands: ['go'],
      run: e => (calls.push(e), clock.sleep(60).then(() => ({ text: '' }))),
    })
    await start($)
    const ui = await mountPane($)
    void ui.press({ key: 'cmd:alpha:go:' })
    await clock.settle()
    expect(await ui.find({ text: /queued/ })).toBeDefined()
    await start($)
    expect(await ui.find({ text: /queued/ })).toBeUndefined()
    await clock.advance(150)
  })

  test('an unavailable command shows "not available" and has no action', async ($, on) => {
    stub(on, { ...ALPHA, files: alphaFile({ version: 1, commands: [{ command: 'gone' }] }), commands: [] })
    await start($)
    const ui = await mountPane($)
    expect(await realButtons(ui)).toHaveLength(0)
    expect(await ui.find({ text: /gone \(not available\)/ })).toBeDefined()
  })

  test('a row naming /menu is answered by the menu itself, not by $.command.run (the engine skips own hooks on re-entry)', async ($, on) => {
    const clock = mock.clock(on)
    const toasts = toastsOf(on)
    const runs: { command: string }[] = []
    stub(on, {
      registry: {},
      self: SELF_FILE,
      pluginCommands: [{ name: 'menu', plugin: 'agent-quick-menu' }],
      run: e => (runs.push(e), { text: 'agent-quick-menu registered /menu but no command.run hook answered it' }),
    })
    await start($)
    const ui = await mountPane($)
    await ui.press({ key: 'cmd:agent-quick-menu:menu:refresh' })
    await clock.settle()
    expect(runs.filter(r => r.command === 'menu')).toHaveLength(0)
    expect(toasts.join('\n')).not.toMatch(/no command\.run hook answered/)
    expect(toasts.at(-1)).toMatch(/Quick menu refreshed: \d+ sections/)
    expect(toasts.filter(t => /discovering/.test(t))).toHaveLength(0)
  })

  test('/menu answers at once while a slow discovery is still running', async ($, on) => {
    const clock = mock.clock(on)
    const toasts = toastsOf(on)
    stub(on, { registry: {}, listWait: () => clock.sleep(400) })
    await start($)
    // The clock is held: an answer that waited for the discovery would never arrive.
    const opened = await $.command.run({ command: 'menu' } as never)
    expect(opened.text).toBe('Quick menu opened')
    const refreshed = await $.command.run({ command: 'menu', args: 'refresh' } as never)
    expect(refreshed.text).toMatch(/discovering/)
    expect(toasts).toEqual([])
    // Discovery lists the commands twice (the second time to mark them against a fresh listing).
    await clock.advance(800)
    expect(toasts.at(-1)).toMatch(/Quick menu refreshed: \d+ sections/)
  })
})

describe('settings', () => {
  const setup = (rows: Record<string, unknown>[], extra: Partial<World> = {}) => ({
    ...ALPHA,
    files: alphaFile({ version: 1 }),
    rows,
    ...extra,
  })

  test('boolean, choice, text and number rows write via `/config key=value`', async ($, on) => {
    const { sets, set } = recordSets()
    stub(
      on,
      setup(
        [
          row('alpha.flag', { kind: 'boolean', value: false }),
          row('alpha.mode', { kind: 'choice', value: 'a', options: ['a', 'b'] }),
          row('alpha.name', { kind: 'text', value: 'x' }),
          row('alpha.count', { kind: 'number', value: 1 }),
        ],
        { set },
      ),
    )
    await start($)
    const ui = await mountPane($)
    await ui.press({ key: 'set:alpha.flag' })
    await ui.press({ key: 'set:alpha.mode' })
    await ui.press({ key: 'set:alpha.mode:b' })
    await ui.press({ key: 'set:alpha.name' })
    await ui.input({ key: 'set:alpha.name', text: 'hello' })
    await ui.press({ key: 'set:alpha.count' })
    await ui.input({ key: 'set:alpha.count', text: '42' })
    expect(sets).toMatchObject([
      { key: 'alpha.flag', value: 'true' },
      { key: 'alpha.mode', value: 'b' },
      { key: 'alpha.name', value: 'hello' },
      { key: 'alpha.count', value: '42' },
    ])
  })

  test('a choice row is folded to `value ▾`; a press opens inline option Buttons, one picker at a time', async ($, on) => {
    stub(
      on,
      setup([
        row('alpha.mode', { kind: 'choice', value: 'a', options: ['a', 'b', 'c'] }),
        row('alpha.other', { kind: 'choice', value: 'x', options: ['x', 'y'] }),
      ]),
    )
    await start($)
    const ui = await mountPane($)
    expect((await ui.find({ key: 'set:alpha.mode' })).props.label).toBe('a ▾')
    expect(await ui.find({ text: /^mode\s+$/ })).toBeDefined()
    await ui.press({ key: 'set:alpha.mode' })
    expect((await ui.find({ key: 'set:alpha.mode' })).props.label).toBe('a ▴')
    for (const [k, label] of [['a', '● a'], ['b', '○ b'], ['c', '○ c']]) {
      const b = await ui.find({ key: `set:alpha.mode:${k}` })
      expect([b.type, b.props.label]).toEqual(['Button', label])
    }
    // Opening another row folds the first.
    await ui.press({ key: 'set:alpha.other' })
    expect((await ui.find({ key: 'set:alpha.mode' })).props.label).toBe('a ▾')
    expect(await ui.findAll({ key: 'set:alpha.mode:b' })).toHaveLength(0)
    expect(await ui.findAll({ key: 'set:alpha.other:y' })).toHaveLength(1)
  })

  test('pressing the current option only collapses; another option writes once and collapses', async ($, on) => {
    const { sets, set } = recordSets()
    stub(on, setup([row('alpha.mode', { kind: 'choice', value: 'a', options: ['a', 'b'] })], { set }))
    await start($)
    const ui = await mountPane($)
    await ui.press({ key: 'set:alpha.mode' })
    await ui.press({ key: 'set:alpha.mode:a' })
    expect(sets).toHaveLength(0)
    expect((await ui.find({ key: 'set:alpha.mode' })).props.label).toBe('a ▾')
    expect(await ui.findAll({ key: 'set:alpha.mode:b' })).toHaveLength(0)
    await ui.press({ key: 'set:alpha.mode' })
    await ui.press({ key: 'set:alpha.mode:b' })
    expect(sets).toMatchObject([{ key: 'alpha.mode', value: 'b' }])
    expect((await ui.find({ key: 'set:alpha.mode' })).props.label).toBe('b ▾')
    expect(await ui.findAll({ key: 'set:alpha.mode:a' })).toHaveLength(0)
  })

  test('pressing the open row\'s value collapses it without writing', async ($, on) => {
    const { sets, set } = recordSets()
    stub(on, setup([row('alpha.mode', { kind: 'choice', value: 'a', options: ['a', 'b'] })], { set }))
    await start($)
    const ui = await mountPane($)
    await ui.press({ key: 'set:alpha.mode' })
    await ui.press({ key: 'set:alpha.mode' })
    expect((await ui.find({ key: 'set:alpha.mode' })).props.label).toBe('a ▾')
    expect(sets).toHaveLength(0)
  })

  test('on mobile, choice, text and number rows are read-only text', async ($, on) => {
    stub(
      on,
      setup([
        row('alpha.mode', { kind: 'choice', value: 'a', options: ['a', 'b'] }),
        row('alpha.name', { kind: 'text', value: 'x' }),
        row('alpha.count', { kind: 'number', value: 1 }),
      ]),
    )
    await start($)
    const ui = await mountPane($, { surface: 'mobile' })
    expect(await ui.find({ text: /mode\s+a/ })).toBeDefined()
    expect(await ui.find({ text: /name\s+x/ })).toBeDefined()
    expect(await ui.find({ text: /count\s+1/ })).toBeDefined()
    expect(await ui.findAll({ type: 'Input' })).toHaveLength(0)
  })

  test('a deny reason is shown beside the row', async ($, on) => {
    stub(on, setup([row('alpha.flag', { kind: 'boolean', value: false })], { set: () => ({ deny: 'policy says no' }) }))
    await start($)
    const ui = await mountPane($)
    await ui.press({ key: 'set:alpha.flag' })
    expect(await ui.find({ text: /policy says no/ })).toBeDefined()
  })

  test('writing the value a row already holds is no refusal and shows no note', async ($, on) => {
    stub(on, setup([row('alpha.name', { kind: 'text', value: 'x' })], { set: () => ({ deny: 'alpha.name is not changed' }) }))
    await start($)
    const ui = await mountPane($)
    await ui.press({ key: 'set:alpha.name' })
    await ui.input({ key: 'set:alpha.name', text: 'x' })
    expect(await ui.findAll({ text: /not changed/ })).toHaveLength(0)
  })

  // An interactive session's `$.command.run` resolves `{}` for `/config`: the row read back decides.
  test('a write that lands shows no note when /config answers no text (interactive)', async ($, on) => {
    stub(
      on,
      setup(
        [
          row('alpha.flag', { kind: 'boolean', value: false }),
          row('alpha.mode', { kind: 'choice', value: 'a', options: ['a', 'b'] }),
          row('alpha.name', { kind: 'text', value: 'x' }),
          row('alpha.count', { kind: 'number', value: 1 }),
        ],
        { silentConfig: true },
      ),
    )
    await start($)
    const ui = await mountPane($)
    await ui.press({ key: 'set:alpha.flag' })
    await ui.press({ key: 'set:alpha.mode' })
    await ui.press({ key: 'set:alpha.mode:b' })
    await ui.press({ key: 'set:alpha.name' })
    await ui.input({ key: 'set:alpha.name', text: 'y' })
    await ui.press({ key: 'set:alpha.count' })
    await ui.input({ key: 'set:alpha.count', text: '2' })
    // The same value again: nothing to refuse.
    await ui.press({ key: 'set:alpha.name' })
    await ui.input({ key: 'set:alpha.name', text: 'y' })
    expect(await ui.findAll({ text: /not changed/ })).toHaveLength(0)
    expect((await ui.findAll({ type: 'Text' })).filter((t: any) => t.props.color === 'red')).toHaveLength(0)
  })

  test('a write the row does not take shows "not changed" when /config answers no text', async ($, on) => {
    stub(on, setup([row('alpha.flag', { kind: 'boolean', value: false })], { silentConfig: true, set: () => ({ deny: 'no' }) }))
    await start($)
    const ui = await mountPane($)
    await ui.press({ key: 'set:alpha.flag' })
    expect(await ui.find({ text: /not changed/ })).toBeDefined()
  })

  test('a value a config.set hook clamped is a write, not a refusal', async ($, on) => {
    stub(on, setup([row('alpha.count', { kind: 'number', value: 1 })], { silentConfig: true, set: () => ({ value: '10' }) }))
    await start($)
    const ui = await mountPane($)
    await ui.press({ key: 'set:alpha.count' })
    await ui.input({ key: 'set:alpha.count', text: '99' })
    expect(await ui.findAll({ text: /not changed/ })).toHaveLength(0)
  })

  test('a row\'s note clears on its next successful write', async ($, on) => {
    let refuse = true
    stub(on, setup([row('alpha.flag', { kind: 'boolean', value: false })], { set: e => (refuse ? { deny: 'policy says no' } : { value: e.value }) }))
    await start($)
    const ui = await mountPane($)
    await ui.press({ key: 'set:alpha.flag' })
    expect(await ui.find({ text: /policy says no/ })).toBeDefined()
    refuse = false
    await ui.press({ key: 'set:alpha.flag' })
    expect(await ui.findAll({ text: /policy says no/ })).toHaveLength(0)
  })

  test('a row\'s note is not drawn once the row shows another value', async ($, on) => {
    const world = setup([row('alpha.flag', { kind: 'boolean', value: false })], { set: () => ({ deny: 'policy says no' }) })
    stub(on, world)
    await start($)
    const ui = await mountPane($)
    await ui.press({ key: 'set:alpha.flag' })
    expect(await ui.find({ text: /policy says no/ })).toBeDefined()
    // Changed elsewhere (the /config menu, another plugin): the next draw shows the new value without the old note.
    world.rows = [row('alpha.flag', { kind: 'boolean', value: true })]
    await ui.press({ key: 'expand-all' })
    expect(await ui.findAll({ text: /policy says no/ })).toHaveLength(0)
  })

  test('reopening the pane clears the notes of earlier writes', async ($, on) => {
    stub(on, setup([row('alpha.flag', { kind: 'boolean', value: false })], { set: () => ({ deny: 'policy says no' }) }))
    await start($)
    const ui = await mountPane($)
    await ui.press({ key: 'set:alpha.flag' })
    expect(await ui.find({ text: /policy says no/ })).toBeDefined()
    await $.command.run({ command: 'menu' } as never)
    await ui.press({ key: 'expand-all' })
    expect(await ui.findAll({ text: /policy says no/ })).toHaveLength(0)
  })

  test('a text value with spaces is written bare, after the first `=`', async ($, on) => {
    const { sets, set } = recordSets()
    stub(on, setup([row('alpha.name', { kind: 'text', value: 'x' })], { set }))
    await start($)
    const ui = await mountPane($)
    await ui.press({ key: 'set:alpha.name' })
    await ui.input({ key: 'set:alpha.name', text: 'a b=c' })
    expect(sets).toEqual([{ key: 'alpha.name', value: 'a b=c' }])
  })

  describe('text and number editing', () => {
    const edited = (extra: Partial<World> = {}) => {
      const { sets, set } = recordSets()
      const world = setup(
        [row('alpha.name', { kind: 'text', value: 'x' }), row('alpha.count', { kind: 'number', value: 1 })],
        { set, ...extra },
      )
      return { sets, world }
    }

    test('a value is a `value ✎` button; pressing opens an Input with save and cancel, one editor at a time', async ($, on) => {
      stub(on, edited().world)
      await start($)
      const ui = await mountPane($)
      expect((await ui.find({ key: 'set:alpha.name' })).props.label).toBe('x ✎')
      expect(await ui.findAll({ type: 'Input' })).toHaveLength(1)
      await ui.press({ key: 'set:alpha.name' })
      const input = await ui.find({ key: 'set:alpha.name' })
      expect([input.type, input.props.value]).toEqual(['Input', 'x'])
      expect(await ui.find({ key: 'set:alpha.name:save' })).toBeDefined()
      expect(await ui.find({ key: 'set:alpha.name:cancel' })).toBeDefined()
      await ui.press({ key: 'set:alpha.count' })
      expect((await ui.find({ key: 'set:alpha.name' })).props.label).toBe('x ✎')
      expect((await ui.find({ key: 'set:alpha.count' })).type).toBe('Input')
    })

    test('cancel discards the typed text, closes and writes nothing', async ($, on) => {
      const { sets, world } = edited()
      stub(on, world)
      await start($)
      const ui = await mountPane($)
      await ui.press({ key: 'set:alpha.name' })
      await ui.input({ key: 'set:alpha.name', text: 'typed', kind: 'change' })
      await ui.press({ key: 'set:alpha.name:cancel' })
      expect(sets).toEqual([])
      expect((await ui.find({ key: 'set:alpha.name' })).props.label).toBe('x ✎')
      await ui.press({ key: 'set:alpha.name' })
      expect((await ui.find({ key: 'set:alpha.name' })).props.value).toBe('x')
    })

    test('save writes the typed text once and closes', async ($, on) => {
      const { sets, world } = edited()
      stub(on, world)
      await start($)
      const ui = await mountPane($)
      await ui.press({ key: 'set:alpha.name' })
      await ui.input({ key: 'set:alpha.name', text: 'typed', kind: 'change' })
      await ui.press({ key: 'set:alpha.name:save' })
      expect(sets).toEqual([{ key: 'alpha.name', value: 'typed' }])
      expect((await ui.find({ key: 'set:alpha.name' })).props.label).toBe('typed ✎')
    })

    test('saving the unchanged value closes without a /config call', async ($, on) => {
      const { sets, world } = edited()
      stub(on, world)
      await start($)
      const ui = await mountPane($)
      await ui.press({ key: 'set:alpha.name' })
      await ui.press({ key: 'set:alpha.name:save' })
      await ui.press({ key: 'set:alpha.count' })
      await ui.input({ key: 'set:alpha.count', text: '1' })
      expect(sets).toEqual([])
      expect((await ui.find({ key: 'set:alpha.name' })).props.label).toBe('x ✎')
      expect((await ui.find({ key: 'set:alpha.count' })).props.label).toBe('1 ✎')
    })

    test('an invalid number says so inline and the editor stays open', async ($, on) => {
      const { sets, world } = edited()
      stub(on, world)
      await start($)
      const ui = await mountPane($)
      await ui.press({ key: 'set:alpha.count' })
      await ui.input({ key: 'set:alpha.count', text: 'abc' })
      expect(sets).toEqual([])
      expect(await ui.find({ text: /"abc" is not a number/ })).toBeDefined()
      expect((await ui.find({ key: 'set:alpha.count' })).type).toBe('Input')
      await ui.press({ key: 'set:alpha.count:cancel' })
      expect(await ui.findAll({ text: /not a number/ })).toHaveLength(0)
    })
  })

  test('settings follow the file list order and skip unlisted rows', async ($, on) => {
    stub(on, {
      ...ALPHA,
      files: alphaFile({ version: 1, settings: ['b', 'a'] }),
      rows: [row('alpha.a'), row('alpha.b'), row('alpha.c')],
    })
    await start($)
    const ui = await mountPane($)
    const keys = (await ui.findAll({ type: 'Button' })).map((x: any) => String(x.key)).filter((k: string) => k.startsWith('set:'))
    expect(keys).toEqual(['set:alpha.b', 'set:alpha.a'])
  })

  test('read-only and input rows draw the label and the value with no colon between', async ($, on) => {
    stub(on, {
      ...ALPHA,
      files: alphaFile({ version: 1 }),
      rows: [
        row('alpha.name', { label: 'Auto-update channel', value: 'latest' }),
        row('alpha.lang', { label: 'Language', value: 'Default (English)', isLocked: true }),
      ],
    })
    await start($)
    const ui = await mountPane($)
    expect((await ui.findAll({ type: 'Input' })).filter((x: any) => x.key !== 'filter').every((x: any) => x.props.label === undefined)).toBe(true)
    const texts = await textsOf(ui)
    expect(texts.some(t => /^Auto-update channel\s+$/.test(t))).toBe(true)
    expect(texts.some(t => t.includes(':') && /Language|latest/.test(t))).toBe(false)
    const mobile = await mountPane($, { surface: 'mobile' })
    expect((await textsOf(mobile)).some(t => /^Auto-update channel\s+latest$/.test(t))).toBe(true)
  })

  test('a boolean is a green ● and "on", or a gray ○ and "off"', async ($, on) => {
    stub(on, {
      ...ALPHA,
      files: alphaFile({ version: 1 }),
      rows: [
        row('alpha.flag', { kind: 'boolean', value: true }),
        row('alpha.off', { kind: 'boolean', value: false }),
      ],
    })
    await start($)
    const ui = await mountPane($)
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.find((t: any) => t.text === '●').props.color).toBe('green')
    expect(texts.find((t: any) => t.text === '○').props.color).toBe('gray')
    const flag = await ui.find({ key: 'set:alpha.flag' })
    expect([flag.type, flag.props.label]).toEqual(['Button', 'on'])
    expect((await ui.find({ key: 'set:alpha.off' })).props.label).toBe('off')
    expect(await ui.find({ text: /^flag\s+$/ })).toBeDefined()
  })

  test('a locked row is dim: label, value, "managed", then the description; it has no editor', async ($, on) => {
    stub(on, setup([row('alpha.fixed', { kind: 'boolean', value: false, isLocked: true, description: 'Set by policy' })]))
    await start($)
    const ui = await mountPane($)
    expect(await realButtons(ui)).toHaveLength(0)
    const locked = (await ui.findAll({ type: 'Text' })).find((x: any) => /fixed\s+false\s+managed/.test(x.text))
    expect(locked.props.dimColor).toBe(true)
    const texts = await textsOf(ui)
    expect(texts[texts.indexOf('Set by policy') - 1]).toBe(' · ')
  })

  test('settings of a marketplace plugin are matched through the bare name', async ($, on) => {
    stub(on, FAV_WORLD({
      rows: [row('alpha.flag', { kind: 'boolean', value: false, provider: { plugin: 'alpha@mk', tier: 'core' } })],
    }))
    emptyBase(on)
    await start($)
    const ui = await mountPane($)
    expect(await ui.find({ key: 'star:set:alpha.flag' })).toBeDefined()
    expect((await ui.findAll({ type: 'Button' })).filter((b: any) => String(b.key).startsWith('fold:'))).toHaveLength(1)
  })
})

describe('sections', () => {
  const setup = (rows: Record<string, unknown>[]): World => ({ ...ALPHA, files: alphaFile({ version: 1 }), rows })

  test('Claude Code lists engine rows; order is files, settings-only, Claude Code, Problems', async ($, on) => {
    stub(on, {
      enabled: { 'zed@m': true, 'cfg@m': true, 'bad@m': true, 'alpha@m': true },
      registry: {
        'zed@m': [{ installPath: '/p/zed' }],
        'cfg@m': [{ installPath: '/p/cfg' }],
        'bad@m': [{ installPath: '/p/bad' }],
        'alpha@m': [{ installPath: '/p/alpha' }],
      },
      files: {
        '/p/zed/.claude-plugin/quick-menu.json': file({ version: 1, title: 'Zed' }),
        '/p/alpha/.claude-plugin/quick-menu.json': file({ version: 1, title: 'Alpha' }),
        '/p/bad/.claude-plugin/quick-menu.json': '{x',
      },
      rows: [row('cfg.k'), row('theme', { kind: 'choice', value: 'dark', options: ['dark', 'light'] })],
    })
    await start($)
    const ui = await mountPane($)
    const heads = (await textsOf(ui))
      .filter((t: string) => ['Alpha', 'Zed', 'cfg', 'Claude Code', 'Problems'].includes(t))
    expect(heads).toEqual(['Alpha', 'Zed', 'cfg', 'Claude Code', 'Problems'])
    expect(await ui.find({ key: 'set:theme' })).toBeDefined()
  })

  test('a section header is a primary button', async ($, on) => {
    stub(on, setup([row('alpha.flag', { kind: 'boolean', value: true })]))
    await start($)
    const ui = await mountPane($)
    const head = await titleOf(ui, /^alpha$/)
    expect(head.props.variant).toBe('primary')
    expect(head.props.plain).toBeUndefined()
  })

  test('section titles lose @marketplace; built-in plugins lose cc-plugin- and carry a dim built-in tag', async ($, on) => {
    stub(on, {
      enabled: { 'alpha@mk': true },
      registry: { 'alpha@mk': [{ installPath: '/p/alpha' }] },
      files: { '/p/alpha/.claude-plugin/quick-menu.json': file({ version: 1 }) },
      rows: [
        row('cc-plugin-agents-md.on', { provider: { plugin: 'cc-plugin-agents-md', tier: 'builtin' } }),
        row('shiny@mk.opt', { provider: { plugin: 'shiny@mk', tier: 'user' } }),
      ],
    })
    await start($)
    const ui = await mountPane($, { expand: false })
    const labels = (await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)
    const titles = await textsOf(ui)
    expect(titles).toContain('alpha')
    expect(titles).toContain('agents-md')
    expect(titles).toContain('shiny')
    expect(labels.filter((l: string) => l.startsWith('▸ '))).toHaveLength(3)
    const tags = (await ui.findAll({ type: 'Text' })).filter((t: any) => t.text === 'built-in')
    expect(tags).toHaveLength(1)
    expect(tags[0].props.dimColor).toBe(true)
  })
})

describe('favourites', () => {
  test('pinning and unpinning writes through $.store and survives a fresh session.start', async ($, on) => {
    const store = new Map<string, unknown>()
    stub(on, FAV_WORLD({ store }))
    await start($)
    const ui = await mountPane($)
    await ui.press({ key: 'star:cmd:alpha:go:--all' })
    await ui.press({ key: 'star:set:alpha.flag' })
    const pinned = [
      { kind: 'command', plugin: 'alpha', key: 'go --all' },
      { kind: 'setting', plugin: 'alpha', key: 'alpha.flag' },
    ]
    expect(store.get('favourites')).toEqual(pinned)
    await start($)
    expect(store.get('favourites')).toEqual(pinned)
    expect(await ui.find({ key: 'fav:cmd:alpha:go:--all' })).toBeDefined()
    await ui.press({ key: 'fav:star:cmd:alpha:go:--all' })
    expect(store.get('favourites')).toEqual([pinned[1]])
  })

  test('a pin made by another session is not lost by a toggle here', async ($, on) => {
    const store = new Map<string, unknown>()
    stub(on, FAV_WORLD({ store }))
    await start($)
    const ui = await mountPane($)
    const other = { kind: 'command', plugin: 'alpha', key: 'stop' }
    store.set('favourites', [other])
    await ui.press({ key: 'star:set:alpha.flag' })
    expect(store.get('favourites')).toEqual([other, { kind: 'setting', plugin: 'alpha', key: 'alpha.flag' }])
  })

  test('the Favourites section comes first and keeps pin order', async ($, on) => {
    const store = new Map<string, unknown>([['favourites', [
      { kind: 'setting', plugin: 'alpha', key: 'alpha.name' },
      { kind: 'command', plugin: 'alpha', key: 'stop' },
    ]]])
    stub(on, FAV_WORLD({ store }))
    await start($)
    const ui = await mountPane($)
    const heads = await textsOf(ui)
    expect(heads.filter((t: string) => t.includes('Favourites') || t.includes('alpha'))).toEqual(['Favourites', 'alpha'])
    const keys = (await ui.findAll({})).map((x: any) => x.key as string).filter((k: string) => k?.startsWith('fav:') && !k.includes('star'))
    expect(keys).toEqual(['fav:set:alpha.name', 'fav:cmd:alpha:stop:'])
  })

  test('a favourite whose source is gone shows "gone" and can only be removed', async ($, on) => {
    const store = new Map<string, unknown>([['favourites', [{ kind: 'command', plugin: 'alpha', key: 'vanished' }]]])
    stub(on, FAV_WORLD({ store }))
    await start($)
    const ui = await mountPane($)
    expect(await ui.find({ text: /vanished \(gone\)/ })).toBeDefined()
    const pinned = (await ui.findAll({ type: 'Button' })).filter((b: any) => String(b.key).startsWith('fav:'))
    expect(pinned.map((b: any) => b.text)).toEqual(['★'])
    await ui.press({ key: pinned[0].key })
    expect(store.get('favourites')).toEqual([])
    expect(await ui.find({ text: /gone/ })).toBeUndefined()
  })

  test('a pinned star is undimmed and an unpinned one dim', async ($, on) => {
    const store = new Map<string, unknown>([['favourites', [{ kind: 'command', plugin: 'alpha', key: 'stop' }]]])
    stub(on, FAV_WORLD({ store }))
    await start($)
    const ui = await mountPane($)
    const stars = (await ui.findAll({ type: 'Button' })).filter((b: any) => /star:/.test(String(b.key)))
    for (const b of stars) expect(b.props.dimColor === true).toBe(b.props.label === '☆')
    expect(stars.some((b: any) => b.props.label === '★')).toBe(true)
    expect(stars.some((b: any) => b.props.label === '☆')).toBe(true)
  })

  test('without favourites the pane hints at the star', async ($, on) => {
    stub(on, FAV_WORLD())
    emptyBase(on)
    await start($)
    const ui = await mountPane($)
    expect((await textsOf(ui)).join('\n')).toMatch(/Press ☆ on a row to pin it to the band/)
    await ui.press({ key: 'star:cmd:alpha:go:--all' })
    expect((await textsOf(ui)).join('\n')).not.toMatch(/Press ☆/)
  })
})

describe('filter', () => {
  test('the filter hides rows and sections, opens matches, and the counts follow', async ($, on) => {
    stub(on, {
      enabled: { 'alpha@mk': true },
      registry: { 'alpha@mk': [{ installPath: '/p/alpha' }] },
      files: {
        '/p/alpha/.claude-plugin/quick-menu.json': file({ version: 1, commands: [{ command: 'go', label: 'Go' }] }),
      },
      commands: ['go'],
      rows: [
        row('alpha.Flag', { kind: 'boolean', value: true }),
        row('alpha.other', { kind: 'text', value: 'x' }),
        row('theme', { kind: 'text', value: 'dark' }),
        row('autoCompact', { kind: 'boolean', value: true, label: 'Auto-compact' }),
      ],
    })
    await start($)
    const ui = await mountPane($, { expand: false })
    const input = await ui.find({ key: 'filter' })
    expect(input.props.placeholder).toBe('filter…')
    await ui.input({ key: 'filter', text: 'FLAG' })
    expect(await ui.find({ key: 'set:alpha.Flag' })).toBeDefined()
    expect(await ui.find({ key: 'set:alpha.other' })).toBeUndefined()
    expect(await ui.find({ key: 'cmd:alpha:go:' })).toBeUndefined()
    expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)).not.toContain('▸ Claude Code')
    expect(await ui.find({ text: /1 section · 0 commands · 1 setting/ })).toBeDefined()
    await ui.input({ key: 'filter', text: 'compact' })
    expect(await ui.find({ key: 'set:autoCompact' })).toBeDefined()
    expect(await ui.find({ key: 'set:alpha.Flag' })).toBeUndefined()
    await ui.input({ key: 'filter', text: 'autocompact' })
    expect(await ui.find({ key: 'set:autoCompact' })).toBeDefined()
    await ui.input({ key: 'filter', text: 'zzz' })
    expect(await ui.find({ text: /No match/ })).toBeDefined()
    await ui.input({ key: 'filter', text: '' })
    expect(await ui.find({ key: 'set:autoCompact' })).toBeUndefined()
  })

  test('the filter matches a setting description', async ($, on) => {
    stub(on, {
      ...ALPHA,
      files: alphaFile({ version: 1 }),
      rows: [row('alpha.mode', { value: 'fast', description: 'Picks the speed of the run' })],
    })
    await start($)
    const ui = await mountPane($, { expand: false })
    await ui.input({ key: 'filter', text: 'SPEED' })
    expect(await ui.find({ key: 'set:alpha.mode' })).toBeDefined()
    await ui.input({ key: 'filter', text: 'nonsense' })
    expect(await ui.find({ key: 'set:alpha.mode' })).toBeUndefined()
  })

  test('the filter matches a command label as well as its name', async ($, on) => {
    stub(on, {
      ...ALPHA,
      files: alphaFile({ version: 1, commands: [{ command: 'go', label: 'Launch' }, { command: 'stop' }] }),
      commands: ['go', 'stop'],
    })
    await start($)
    const ui = await mountPane($, { expand: false })
    await ui.input({ key: 'filter', text: 'LAUNCH' })
    expect(await ui.find({ key: 'cmd:alpha:go:' })).toBeDefined()
    expect(await ui.find({ key: 'cmd:alpha:stop:' })).toBeUndefined()
    await ui.input({ key: 'filter', text: 'stop' })
    expect(await ui.find({ key: 'cmd:alpha:stop:' })).toBeDefined()
    expect(await ui.find({ key: 'cmd:alpha:go:' })).toBeUndefined()
  })
})

describe('band', () => {
  const pin = () => [
    { kind: 'command', plugin: 'alpha', key: 'go --all' },
    { kind: 'setting', plugin: 'alpha', key: 'alpha.flag' },
  ]

  test('shows the menu button and favourites in order with digit hotkeys when bandHotkeys is on', { options: { bandHotkeys: true } }, async ($, on) => {
    const store = new Map<string, unknown>([['favourites', pin()]])
    stub(on, FAV_WORLD({ store }))
    emptyBase(on)
    await start($)
    const ui = await mountBand($)
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map((b: any) => [b.props.label, b.props.hotkey])).toEqual([
      ['≣ menu ▸', 'm'],
      ['Go', '1'],
      ['flag: off', undefined],
    ])
  })

  test('a command favourite runs through $.command.run', async ($, on) => {
    const calls: unknown[] = []
    const store = new Map<string, unknown>([['favourites', pin()]])
    stub(on, FAV_WORLD({ store, run: e => (calls.push(e), { text: 'ok' }) }))
    emptyBase(on)
    await start($)
    const ui = await mountBand($)
    await ui.press({ key: 'band:1' })
    expect(calls).toMatchObject([{ command: 'go', args: '--all' }])
  })

  test('a boolean favourite toggles via `/config key=value`', async ($, on) => {
    const { sets, set } = recordSets()
    const store = new Map<string, unknown>([['favourites', pin()]])
    stub(on, FAV_WORLD({ store, set }))
    emptyBase(on)
    await start($)
    const ui = await mountBand($)
    await ui.press({ key: 'band:2' })
    expect(sets).toMatchObject([{ key: 'alpha.flag', value: 'true' }])
  })

  test('band width counts code points and keeps 4 cells for [-]', { options: { bandHotkeys: true } }, async ($, on) => {
    const fav = [
      { kind: 'command', plugin: 'alpha', key: 'go --all' },
      { kind: 'command', plugin: 'alpha', key: 'stop' },
    ]
    const store = new Map<string, unknown>([['favourites', fav]])
    stub(on, FAV_WORLD({ store }))
    emptyBase(on)
    await start($)
    // menu: 8 + 5 = 13, divider 2, reserve 4 -> 19; Go: 2 + 3 (digit) + 2 = 7 -> 26; stop: 4 + 3 + 2 = 9 -> 35.
    const labels = async (columns: number) =>
      (await (await mountBand($, { ...(BAND_PROPS as object), bodyColumns: columns })).findAll({ type: 'Button' })).map(
        (b: any) => b.props.label,
      )
    expect(await labels(35)).toEqual(['≣ menu ▸', 'Go', 'stop'])
    expect(await labels(34)).toEqual(['≣ menu ▸', 'Go'])
    expect(await labels(25)).toEqual(['≣ menu ▸'])
  })

  test('digit hotkeys sit on own-plugin commands, at the favourite\'s fixed position', { options: { bandHotkeys: true } }, async ($, on) => {
    const store = new Map<string, unknown>([['favourites', [
      { kind: 'setting', plugin: 'alpha', key: 'alpha.flag' },
      { kind: 'command', plugin: 'alpha', key: 'stop' },
    ]]])
    stub(on, FAV_WORLD({ store }))
    emptyBase(on)
    await start($)
    const ui = await mountBand($)
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map((b: any) => b.props.hotkey)).toEqual(['m', undefined, '2'])
  })

  test('the menu button opens the pane', async ($, on) => {
    const opened: unknown[] = []
    stub(on, FAV_WORLD({ open: e => opened.push(e) }))
    emptyBase(on)
    await start($)
    const ui = await mountBand($)
    await ui.press({ key: 'band:menu' })
    expect(opened).toMatchObject([{ id: 'quick-menu', focus: true }])
  })

  test("the band keeps next(e)'s tree", async ($, on) => {
    stub(on, FAV_WORLD())
    on('ui.render', ($: any, e: any) => {
      const { Text } = $.ui.resolve(e)
      return <Text>cache 4:00</Text>
    })
    await start($)
    const ui = await mountBand($)
    expect(await ui.find({ text: /cache 4:00/ })).toBeDefined()
    expect(await ui.find({ key: 'band:menu' })).toBeDefined()
  })

  test('with no favourites the band row holds the menu button alone, its label one cell per character', async ($, on) => {
    stub(on, FAV_WORLD())
    emptyBase(on)
    await start($)
    const ui = await mountBand($)
    expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)).toEqual(['≣ menu ▸'])
    expect(await textsOf(ui)).toEqual([])
    // No East Asian Wide glyph (☰ U+2630 is one): the engine and a terminal on older Unicode tables disagree on its width.
    expect([...'≣ menu ▸▾'].every(ch => !/[\u1100-\u115f\u2630-\u2637\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uff60]/.test(ch))).toBe(true)
  })

  test('a favourite naming /menu refresh is answered by the menu itself, not queued through $.command.run', async ($, on) => {
    const clock = mock.clock(on)
    const runs: { command: string }[] = []
    const toasts = toastsOf(on)
    const store = new Map<string, unknown>([['favourites', [{ kind: 'command', plugin: 'agent-quick-menu', key: 'menu refresh' }]]])
    stub(on, {
      registry: {},
      self: SELF_FILE,
      store,
      pluginCommands: [{ name: 'menu', plugin: 'agent-quick-menu' }],
      run: e => (runs.push(e), { text: 'agent-quick-menu registered /menu but no command.run hook answered it' }),
    })
    emptyBase(on)
    await start($)
    const ui = await mountBand($)
    expect((await ui.find({ key: 'band:1' })).props.label).toBe('Refresh')
    await ui.press({ key: 'band:1' })
    await clock.settle()
    expect(runs.filter(r => r.command === 'menu')).toHaveLength(0)
    expect(toasts.join('\n')).not.toMatch(/no command\.run hook answered/)
    expect(toasts.at(-1)).toMatch(/Quick menu refreshed/)
  })

  test('a survey leaves only next(e)', async ($, on) => {
    stub(on, FAV_WORLD())
    on('ui.render', ($: any, e: any) => {
      const { Text } = $.ui.resolve(e)
      return <Text>survey</Text>
    })
    await start($)
    const ui = await mountBand($, { ...(BAND_PROPS as object), hasSurvey: true })
    expect(await ui.find({ text: /survey/ })).toBeDefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  })
})

describe('folding', () => {
  const FOLD = (extra: Partial<World> = {}): World => ({
    ...FAV_WORLD(extra),
    rows: [
      row('alpha.flag', { kind: 'boolean', value: false, label: 'flag' }),
      row('alpha.longer_name', { value: 'x', label: 'longer_name' }),
      row('theme', { kind: 'choice', value: 'dark', options: ['dark', 'light'] }),
    ],
  })

  test('defaults: Favourites open, every other section folded', async ($, on) => {
    const store = new Map<string, unknown>([['favourites', [{ kind: 'command', plugin: 'alpha', key: 'stop' }]]])
    stub(on, FOLD({ store }))
    await start($)
    const ui = await mountPane($, { expand: false })
    const labels = (await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)
    expect(labels.filter((l: string) => /^[▾▸] /.test(l))).toEqual(['▾ Favourites', '▸ alpha', '▸ Claude Code'])
    expect(await ui.find({ key: 'fav:cmd:alpha:stop:' })).toBeDefined()
    expect(await ui.find({ key: 'cmd:alpha:go:--all' })).toBeUndefined()
    expect(await ui.find({ key: 'set:theme' })).toBeUndefined()
  })

  test('a header toggles its section and the state persists in $.store and across session.start', async ($, on) => {
    const store = new Map<string, unknown>()
    stub(on, FOLD({ store }))
    await start($)
    const ui = await mountPane($, { expand: false })
    await ui.press({ key: 'fold:plugin:alpha' })
    expect(store.get('folded')).toEqual({ 'plugin:alpha': false })
    expect(await ui.find({ key: 'cmd:alpha:go:--all' })).toBeDefined()
    expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)).toContain('▾ alpha')
    await start($)
    expect(await ui.find({ key: 'cmd:alpha:go:--all' })).toBeDefined()
    await ui.press({ key: 'fold:plugin:alpha' })
    expect(store.get('folded')).toEqual({ 'plugin:alpha': true })
    expect(await ui.find({ key: 'cmd:alpha:go:--all' })).toBeUndefined()
  })

  test('a fold made by another session is not lost by a toggle here', async ($, on) => {
    const store = new Map<string, unknown>()
    stub(on, FOLD({ store }))
    await start($)
    const ui = await mountPane($, { expand: false })
    store.set('folded', { engine: false })
    await ui.press({ key: 'fold:plugin:alpha' })
    expect(store.get('folded')).toEqual({ engine: false, 'plugin:alpha': false })
  })

  test('Expand all and Collapse all carry the hotkeys e and c and set every section', async ($, on) => {
    const store = new Map<string, unknown>([['favourites', [{ kind: 'command', plugin: 'alpha', key: 'stop' }]]])
    stub(on, FOLD({ store }))
    await start($)
    const ui = await mountPane($, { expand: false })
    const hotkeys = (await ui.findAll({ type: 'Button' })).filter((b: any) => b.props.hotkey).map((b: any) => [b.props.label, b.props.hotkey])
    expect(hotkeys).toEqual([['Expand all', 'e'], ['Collapse all', 'c']])
    await ui.press({ key: 'expand-all' })
    expect(store.get('folded')).toEqual({ favourites: false, 'plugin:alpha': false, engine: false })
    expect(await ui.find({ key: 'set:theme' })).toBeDefined()
    await ui.press({ key: 'collapse-all' })
    expect(store.get('folded')).toEqual({ favourites: true, 'plugin:alpha': true, engine: true })
    expect(await ui.find({ key: 'set:theme' })).toBeUndefined()
    expect(await ui.find({ key: 'fav:cmd:alpha:stop:' })).toBeUndefined()
  })

  test('the commands of a section sit one per line, hints aligned', async ($, on) => {
    stub(on, FOLD())
    await start($)
    const ui = await mountPane($)
    const col = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.key === 'commands')
    expect(col).toHaveLength(1)
    expect(col[0].props.flexDirection).toBe('column')
    const rows = (await ui.findAll({ type: 'Box' })).filter((b: any) => String(b.key).startsWith('row:cmd:alpha:'))
    expect(rows).toHaveLength(2)
    expect((await textsOf(ui)).filter(t => t.startsWith('/'))).toHaveLength(2)
    const gaps = (await textsOf(ui)).filter(t => /^ +$/.test(t) && t.length >= 2)
    // 'Go' (2) and 'stop' (4): the shorter label is padded by 2 more cells than the longer
    expect(gaps.map(t => t.length).sort()).toEqual(expect.arrayContaining([2, 4]))
    const labels = (await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)
    expect(labels.filter((l: string) => l === 'Go' || l === 'stop')).toEqual(['Go', 'stop'])
  })

  test('setting labels are padded to the longest label of their section', async ($, on) => {
    stub(on, FOLD())
    await start($)
    const ui = await mountPane($)
    const flag = await ui.find({ key: 'set:alpha.flag' })
    expect(flag.props.label).toBe('off')
    expect(await ui.find({ text: 'flag         ' })).toBeDefined()
    expect(await ui.find({ text: 'longer_name  ' })).toBeDefined()
  })

  test('the pane opens with closeOnEscape', async ($, on) => {
    const opened: unknown[] = []
    stub(on, FOLD({ open: e => opened.push(e) }))
    emptyBase(on)
    await start($)
    await (await mountBand($)).press({ key: 'band:menu' })
    expect(opened).toMatchObject([{ id: 'quick-menu', closeOnEscape: true }])
  })
})

describe('band menu toggle', () => {
  const menuLabel = async ($: any) => (await (await mountBand($)).find({ key: 'band:menu' })).props.label

  test('the button opens the pane when closed and closes it when open', async ($, on) => {
    const opened: unknown[] = []
    const closed: unknown[] = []
    let up = false
    stub(on, FAV_WORLD({ open: e => (opened.push(e), (up = true)), panes: () => (up ? [{ id: 'quick-menu', isPlaced: true }] : []) }))
    on('ui.close', (_$: any, e: any) => (closed.push(e), (up = false), { value: undefined }))
    emptyBase(on)
    await start($)
    await (await mountBand($)).press({ key: 'band:menu' })
    expect(opened).toHaveLength(1)
    expect(closed).toHaveLength(0)
    await (await mountBand($)).press({ key: 'band:menu' })
    expect(opened).toHaveLength(1)
    expect(closed).toMatchObject([{ id: 'quick-menu' }])
    await (await mountBand($)).press({ key: 'band:menu' })
    expect(opened).toHaveLength(2)
  })

  test('the label shows ▾ while the pane is open and ▸ once the engine closed it', async ($, on) => {
    let up = false
    stub(on, FAV_WORLD({ open: () => (up = true), panes: () => (up ? [{ id: 'quick-menu', isPlaced: true }] : []) }))
    emptyBase(on)
    await start($)
    expect(await menuLabel($)).toBe('≣ menu ▸')
    await (await mountBand($)).press({ key: 'band:menu' })
    expect(await menuLabel($)).toBe('≣ menu ▾')
    // Closed by × or Esc: the engine's record no longer lists the pane.
    up = false
    expect(await menuLabel($)).toBe('≣ menu ▸')
  })

  test('another pane does not count as open', async ($, on) => {
    stub(on, FAV_WORLD({ panes: () => [{ id: 'other', isPlaced: true }] }))
    emptyBase(on)
    await start($)
    expect(await menuLabel($)).toBe('≣ menu ▸')
  })
})

describe('narrow terminal', () => {
  const NARROW = (extra: Partial<World> = {}): World => ({ ...FAV_WORLD(extra), placed: false })

  test('an unplaced pane toasts why and the band shows the section headers', async ($, on) => {
    const toasts = toastsOf(on)
    stub(on, NARROW())
    emptyBase(on)
    await start($)
    const ui = await mountBand($, { ...(BAND_PROPS as object), maxRows: 6 })
    expect(await ui.find({ key: 'fold:plugin:alpha' })).toBeUndefined()
    await ui.press({ key: 'band:menu' })
    expect(toasts.join()).toMatch(/terminal too narrow/)
    const fresh = await mountBand($, { ...(BAND_PROPS as object), maxRows: 8 })
    expect((await fresh.find({ key: 'fold:plugin:alpha' })).props.label).toBe('▸ alpha')
    await fresh.press({ key: 'fold:plugin:alpha' })
    expect(await fresh.find({ key: 'cmd:alpha:go:--all' })).toBeDefined()
  })

  test('the band menu stays within maxRows', async ($, on) => {
    stub(on, NARROW({ rows: [row('b.x'), row('c.x'), row('d.x'), row('e.x')] }))
    emptyBase(on)
    await start($)
    await (await mountBand($)).press({ key: 'band:menu' })
    const ui = await mountBand($, { ...(BAND_PROPS as object), maxRows: 3 })
    const heads = (await ui.findAll({ type: 'Button' })).filter((b: any) => String(b.key).startsWith('fold:'))
    expect(heads).toHaveLength(1)
    // The menu button row, the Close row and the section headers together stay within maxRows.
    expect(2 + heads.length).toBeLessThanOrEqual(3)
  })

  test('a placed pane leaves the band to its one line', async ($, on) => {
    stub(on, FAV_WORLD())
    emptyBase(on)
    await start($)
    await (await mountBand($)).press({ key: 'band:menu' })
    const ui = await mountBand($)
    expect(await ui.find({ key: 'fold:plugin:alpha' })).toBeUndefined()
  })

  test('the band fallback carries a Close button', async ($, on) => {
    const closed: unknown[] = []
    on('ui.close', (_$: any, e: any) => (closed.push(e), { value: undefined }))
    stub(on, { ...FAV_WORLD(), placed: false })
    emptyBase(on)
    await start($)
    await (await mountBand($)).press({ key: 'band:menu' })
    const ui = await mountBand($, { ...(BAND_PROPS as object), maxRows: 6 })
    await ui.press({ key: 'band:close' })
    expect(closed).toMatchObject([{ id: 'quick-menu' }])
  })
})

describe('security: what a button runs', () => {
  const FOREIGN = {
    ...ALPHA,
    files: alphaFile({
      version: 1,
      commands: [
        { command: 'go', args: '--all' },
        { command: 'clear', label: 'Clear' },
        { command: 'beta-run', label: 'Beta' },
      ],
    }),
    commands: ['go'],
    builtins: ['clear'],
    pluginCommands: [{ name: 'beta-run', plugin: 'beta@mk' }],
  }

  test('each command shows /command args dimmed, clipped to 60; foreign ones carry a tag', async ($, on) => {
    const long = 'x'.repeat(100)
    stub(on, { ...FOREIGN, files: alphaFile({ version: 1, commands: [{ command: 'go', args: long.slice(0, 90) }, { command: 'clear' }, { command: 'beta-run' }] }) })
    await start($)
    const ui = await mountPane($)
    const texts = await textsOf(ui)
    const clipped = texts.find(t => t.startsWith('/go '))!
    expect([...clipped.trim()]).toHaveLength(60)
    expect(clipped.endsWith('…')).toBe(true)
    expect(texts).toContain('/clear')
    expect(texts).toContain(' runs a built-in')
    expect(texts).toContain(' runs beta')
    expect(texts.filter(t => t.includes('runs ')).length).toBe(2)
  })

  const describedWorld = (): World => ({
    ...FOREIGN,
    commands: ['go'],
    files: alphaFile({ version: 1, commands: [{ command: 'go', label: 'Go', description: 'Runs the whole thing now '.repeat(6) }] }),
  })
  const textsAt = async ($: any, columns: number) => textsOf(await mountPane($, { columns }))

  test('a command description is dim text after the hint, clipped so the row fits one line', async ($, on) => {
    stub(on, describedWorld())
    await start($)
    const ui = await mountPane($, { columns: 60 })
    const texts = await textsOf(ui)
    const wide = texts.find(t => t.includes('Runs the whole'))!
    expect(wide).toBeDefined()
    // star and space 2, `[ Go ]` 6, ` /go` 4, ` · ` 3, then the help text itself
    expect(15 + [...wide].length).toBeLessThanOrEqual(60)
    expect(wide.endsWith('…')).toBe(true)
    const t = (await ui.findAll({ type: 'Text' })).find((x: any) => /Runs the whole/.test(x.text))
    expect(t.props).toMatchObject({ dimColor: true, italic: true, wrap: 'truncate-end' })
    expect(texts[texts.indexOf(wide) - 1]).toBe(' · ')
  })

  test('a command description is dropped when the width is short', async ($, on) => {
    stub(on, describedWorld())
    await start($)
    expect((await textsAt($, 18)).some(t => t.includes('Runs'))).toBe(false)
  })

  const settingWorld = (extra: Record<string, unknown> = {}): World => ({
    ...FOREIGN,
    files: alphaFile({ version: 1 }),
    rows: [row('alpha.mode', { value: 'fast', description: 'Picks the speed of the whole run '.repeat(4), ...extra })],
  })

  test('a setting description is dim text after the value, clipped to the pane width', async ($, on) => {
    stub(on, settingWorld())
    await start($)
    const ui = await mountPane($, { columns: 70 })
    const wide = (await textsOf(ui)).find(t => t.includes('Picks the speed'))!
    expect(wide).toBeDefined()
    expect([...wide].length).toBeLessThanOrEqual(70)
    expect(wide.endsWith('…')).toBe(true)
    const t = (await ui.findAll({ type: 'Text' })).find((x: any) => /Picks the speed/.test(x.text))
    expect(t.props).toMatchObject({ dimColor: true, italic: true, wrap: 'truncate-end' })
    const texts = await textsOf(ui)
    expect(texts[texts.indexOf(wide) - 1]).toBe(' · ')
  })

  test('a setting description is dropped when under 8 cells remain', async ($, on) => {
    stub(on, settingWorld())
    await start($)
    expect((await textsAt($, 20)).some(t => t.includes('Picks'))).toBe(false)
  })

  test('a built-in or another plugin\'s command needs a second press within 5 s, in the pane and the band', async ($, on) => {
    const clock = mock.clock(on)
    const calls: { command: string }[] = []
    const store = new Map<string, unknown>([['favourites', [{ kind: 'command', plugin: 'alpha', key: 'clear' }]]])
    stub(on, { ...FOREIGN, store, run: e => (calls.push(e), { text: 'ok' }) })
    emptyBase(on)
    await start($)
    const ui = await mountPane($)
    await ui.press({ key: 'cmd:alpha:clear:' })
    expect(calls).toHaveLength(0)
    expect((await ui.find({ key: 'cmd:alpha:clear:' })).props.label).toBe('press again: /clear')
    const band = await mountBand($)
    expect((await band.find({ key: 'band:1' })).props.label).toBe('press again: /clear')
    await ui.press({ key: 'cmd:alpha:clear:' })
    await clock.settle()
    expect(calls).toMatchObject([{ command: 'clear' }])
    expect((await ui.find({ key: 'cmd:alpha:clear:' })).props.label).toBe('Clear')
    // Armed in the band, run from the band; after 5 s the arming is gone.
    await band.press({ key: 'band:1' })
    expect(calls).toHaveLength(1)
    await clock.advance(5001)
    await band.press({ key: 'band:1' })
    expect(calls).toHaveLength(1)
    await band.press({ key: 'band:1' })
    await clock.settle()
    expect(calls).toHaveLength(2)
  })

  test('a plugin\'s own command runs on one press', async ($, on) => {
    const calls: { command: string }[] = []
    stub(on, { ...FOREIGN, run: e => (calls.push(e), { text: 'ok' }) })
    await start($)
    const ui = await mountPane($)
    await ui.press({ key: 'cmd:alpha:go:--all' })
    expect(calls).toMatchObject([{ command: 'go', args: '--all' }])
  })
})

describe('security: menu file input', () => {
  const bad = (o: unknown) => validateMenuFile({ version: 1, ...(o as object) })

  test('control, line, bidi and zero-width characters are rejected in every string', () => {
    for (const ch of ['\n', '\u0007', '\u2028', '\u202e', '\u200b', '\u2066', '\ufeff']) {
      expect(bad({ title: `a${ch}b` })).toMatchObject({ ok: false })
      expect(bad({ commands: [{ command: `a${ch}b` }] })).toMatchObject({ ok: false })
      expect(bad({ commands: [{ command: 'a', label: `a${ch}b` }] })).toMatchObject({ ok: false })
      expect(bad({ commands: [{ command: 'a', args: `a${ch}b` }] })).toMatchObject({ ok: false })
      expect(bad({ commands: [{ command: 'a', description: `a${ch}b` }] })).toMatchObject({ ok: false })
      expect(bad({ settings: [`a${ch}b`] })).toMatchObject({ ok: false })
    }
  })

  test('tag characters and variation selectors are rejected', () => {
    for (const ch of ['\u{E0041}', '\u{E007F}', '\ufe0f', '\u{E0100}', '\u00ad', '\u180e']) {
      expect(bad({ commands: [{ command: 'a', args: `x${ch}y` }] })).toMatchObject({ ok: false })
      expect(bad({ title: `x${ch}y` })).toMatchObject({ ok: false })
    }
  })

  test('lengths count code points, not UTF-16 units', () => {
    const emoji = (n: number) => '\u{1F600}'.repeat(n)
    expect(bad({ title: emoji(60) })).toMatchObject({ ok: true })
    expect(bad({ title: emoji(61) })).toMatchObject({ ok: false })
  })

  test('length limits and counts', () => {
    const ok = (n: number) => 'x'.repeat(n)
    expect(bad({ title: ok(60) })).toMatchObject({ ok: true })
    expect(bad({ title: ok(61) })).toMatchObject({ ok: false })
    expect(bad({ commands: [{ command: ok(64), label: ok(40), args: ok(500), description: ok(200) }] })).toMatchObject({ ok: true })
    for (const c of [{ command: ok(65) }, { command: 'a', label: ok(41) }, { command: 'a', args: ok(501) }, { command: 'a', description: ok(201) }]) {
      expect(bad({ commands: [c] })).toMatchObject({ ok: false })
    }
    expect(bad({ commands: [{ command: 'a', label: '   ' }] })).toMatchObject({ ok: false })
    expect(bad({ title: '   ' })).toMatchObject({ ok: false })
    expect(bad({ settings: [ok(64)] })).toMatchObject({ ok: true })
    expect(bad({ settings: [ok(65)] })).toMatchObject({ ok: false })
    expect(bad({ settings: [''] })).toMatchObject({ ok: false })
    expect(bad({ commands: Array.from({ length: 50 }, () => ({ command: 'a' })) })).toMatchObject({ ok: true })
    expect(bad({ commands: Array.from({ length: 51 }, () => ({ command: 'a' })) })).toMatchObject({ ok: false })
    expect(bad({ settings: Array.from({ length: 51 }, () => 's') })).toMatchObject({ ok: false })
  })

  test('titles may not pose as the menu, Claude Code or another plugin', () => {
    for (const t of ['Claude Code', 'favourites', 'BUILT-IN']) expect(bad({ title: t })).toMatchObject({ ok: false })
    expect(validateMenuFile({ version: 1, title: 'Beta' }, ['beta'])).toMatchObject({ ok: false })
    expect(validateMenuFile({ version: 1, title: 'Alpha' }, ['beta'])).toMatchObject({ ok: true })
  })

  test('problems are generic for bad JSON, clipped to 300 and free of bad characters; the version echo is clipped', async ($, on) => {
    stub(on, {
      enabled: { 'a@m': true, 'b@m': true, 'c@m': true },
      registry: { 'a@m': [{ installPath: '/p/a' }], 'b@m': [{ installPath: '/p/b' }], 'c@m': [{ installPath: '/p/c' }] },
      files: {
        '/p/a/.claude-plugin/quick-menu.json': '{"version": 1, "secret": oops',
        '/p/b/.claude-plugin/quick-menu.json': file({ version: 'v'.repeat(500) }),
        '/p/c/.claude-plugin/quick-menu.json': file({ version: 1, commands: [{ command: 'a\u202eb' }] }),
      },
    })
    await start($)
    const ui = await mountPane($)
    const lines = (await textsOf(ui)).filter(t => t.includes('quick-menu.json'))
    expect(lines).toHaveLength(3)
    expect(lines.every(t => t.length <= 300 + 20 && !/[\u202e]/.test(t))).toBe(true)
    expect(lines.find(t => t.includes('/p/a/'))).toMatch(/not valid JSON$/)
    expect(lines.find(t => t.includes('/p/a/'))).not.toMatch(/oops|secret/)
    expect(lines.find(t => t.includes('/p/b/'))!.length).toBeLessThan(150)
  })

  test('the file must be a regular file, not a link, of at most 64 KiB; the rest is skipped with a problem', async ($, on) => {
    const path = (n: string) => `/p/${n}/.claude-plugin/quick-menu.json`
    stub(on, {
      enabled: { 'a@m': true, 'b@m': true, 'c@m': true },
      registry: { 'a@m': [{ installPath: '/p/a' }], 'b@m': [{ installPath: '/p/b' }], 'c@m': [{ installPath: '/p/c' }] },
      files: { [path('a')]: file({ version: 1, title: 'A' }), [path('b')]: file({ version: 1, title: 'B' }), [path('c')]: file({ version: 1, title: 'C' }) },
      stat: { [path('a')]: { isLink: true }, [path('b')]: { size: 64 * 1024 + 1 }, [path('c')]: { kind: 'dir' } },
    })
    await start($)
    const ui = await mountPane($)
    const texts = await textsOf(ui)
    expect(texts.filter(t => /regular file|larger than 64 KiB/.test(t))).toHaveLength(3)
    expect(await ui.find({ text: /^[ABC] · / })).toBeUndefined()
  })

  test('at most 30 commands are drawn per section, then "+k more"', async ($, on) => {
    const commands = Array.from({ length: 35 }, (_, i) => ({ command: `c${i}` }))
    stub(on, { ...ALPHA, files: alphaFile({ version: 1, commands }), commands: commands.map(c => c.command) })
    await start($)
    const ui = await mountPane($)
    expect(await realButtons(ui)).toHaveLength(30)
    expect(await textsOf(ui)).toContain('+5 more')
  })

  test('a title that differs from the plugin name is shown with it', async ($, on) => {
    stub(on, { ...ALPHA, files: alphaFile({ version: 1, title: 'Fancy' }) })
    await start($)
    const ui = await mountPane($)
    expect(await titleOf(ui, /^Fancy · alpha$/)).toBeDefined()
  })
})

describe('security: digit hotkeys', () => {
  const favs = [
    { kind: 'command', plugin: 'alpha', key: 'gone' },
    { kind: 'command', plugin: 'alpha', key: 'clear' },
    { kind: 'command', plugin: 'alpha', key: 'go --all' },
  ]
  const world = (): World => ({
    ...ALPHA,
    files: alphaFile({ version: 1, commands: [{ command: 'go', args: '--all' }, { command: 'clear' }] }),
    commands: ['go'],
    builtins: ['clear'],
    store: new Map<string, unknown>([['favourites', favs]]),
  })

  test('off by default', async ($, on) => {
    stub(on, world())
    emptyBase(on)
    await start($)
    const ui = await mountBand($)
    expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.props.hotkey)).toEqual(['m', undefined, undefined])
  })

  test('on: the digit is the pinned position, gaps and foreign commands included', { options: { bandHotkeys: true } }, async ($, on) => {
    stub(on, world())
    emptyBase(on)
    await start($)
    const ui = await mountBand($)
    expect((await ui.findAll({ type: 'Button' })).map((b: any) => [b.props.label, b.props.hotkey])).toEqual([
      ['≣ menu ▸', 'm'],
      ['clear', undefined],
      ['go', '3'],
    ])
  })
})

describe('security: paths', () => {
  test('a relative installPath is skipped with a problem', async ($, on) => {
    stub(on, { ...ALPHA, registry: { 'alpha@mk': [{ installPath: 'p/alpha' }] }, files: alphaFile({ version: 1, title: 'Alpha' }) })
    await start($)
    const ui = await mountPane($)
    expect(await titleOf(ui, /^Alpha/)).toBeUndefined()
    expect(await ui.find({ text: /installPath is not absolute/ })).toBeDefined()
  })

  test('a relative CLAUDE_CONFIG_DIR skips the registry with a problem', async ($, on) => {
    stub(on, { enabled: { 'alpha@mk': true }, vars: { CLAUDE_CONFIG_DIR: 'cfg' } })
    await start($)
    const ui = await mountPane($)
    expect(await ui.find({ text: /CLAUDE_CONFIG_DIR: must be an absolute path/ })).toBeDefined()
  })

  test('no HOME skips the registry without a problem line', async ($, on) => {
    stub(on, { ...ALPHA, vars: { HOME: '' }, files: alphaFile({ version: 1, title: 'Alpha' }) })
    await start($)
    const ui = await mountPane($)
    expect(await titleOf(ui, /^Alpha/)).toBeUndefined()
    expect(await ui.find({ text: /Problems/ })).toBeUndefined()
  })

  test('USERPROFILE stands in for an empty HOME', async ($, on) => {
    stub(on, { ...ALPHA, vars: { HOME: '', USERPROFILE: HOME }, files: alphaFile({ version: 1, title: 'Alpha' }) })
    await start($)
    const ui = await mountPane($)
    expect(await titleOf(ui, /^Alpha/)).toBeDefined()
  })

  test('a relative CLAUDE_CODE_PLUGIN_DIRS root is a problem, not read', async ($, on) => {
    stub(on, { registry: {}, vars: { CLAUDE_CODE_PLUGIN_DIRS: 'rel/dir' } })
    await start($)
    const ui = await mountPane($)
    expect(await ui.find({ text: /rel\/dir: cannot identify plugin dir: not an absolute path/ })).toBeDefined()
  })
})

describe('security: favourites and the store', () => {
  test('at most 50 favourites; the 51st press toasts', async ($, on) => {
    const toasts = toastsOf(on)
    const full = Array.from({ length: 50 }, (_, i) => ({ kind: 'command', plugin: 'alpha', key: `k${i}` }))
    const store = new Map<string, unknown>([['favourites', full]])
    stub(on, FAV_WORLD({ store }))
    await start($)
    const ui = await mountPane($)
    await ui.press({ key: 'star:cmd:alpha:go:--all' })
    expect((store.get('favourites') as unknown[]).length).toBe(50)
    expect(toasts.join('\n')).toMatch(/at most 50 favourites/)
  })

  test('a failing $.store.set toasts instead of throwing, for a pin and for a fold', async ($, on) => {
    const toasts = toastsOf(on)
    const w = FAV_WORLD()
    stub(on, w)
    await start($)
    const ui = await mountPane($)
    w.storeFails = 'disk full'
    await ui.press({ key: 'star:cmd:alpha:go:--all' })
    await ui.press({ key: 'collapse-all' })
    expect(toasts.filter(t => /cannot save favourites: /.test(t))).toHaveLength(1)
    expect(toasts.filter(t => /cannot save folded: /.test(t))).toHaveLength(1)
    expect(await ui.find({ key: 'fav:cmd:alpha:go:--all' })).toBeUndefined()
  })
})
