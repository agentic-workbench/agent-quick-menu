import { describe, expect, test } from 'claude-code/testing'

import { validateMenuFile } from './quick-menu'

const PANE_PROPS = {
  title: 'Quick menu',
  isFocused: true,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, max: 0 },
  view: { rows: 24, columns: 100 },
} as never

declare const setTimeout: (fn: (...a: any[]) => void, ms: number) => unknown

const HOME = '/home/u'
const REGISTRY = `${HOME}/.claude/plugins/installed_plugins.json`

type World = {
  enabled?: Record<string, boolean>
  registry?: Record<string, Record<string, unknown>[]>
  files?: Record<string, string>
  env?: Record<string, string>
  commands?: string[]
  pluginCommands?: { name: string; plugin: string; description?: string }[]
  rows?: Record<string, unknown>[]
  run?: (e: { command: string; args?: string }) => unknown
  set?: (e: { key: string; value: unknown }) => unknown
  open?: (e: unknown) => void
  placed?: false
  store?: Map<string, unknown>
  /** The menu's own quick-menu.json, answered for the one path outside `files` ending in it (the plugin's own root). */
  self?: string
  /** Runs inside the stub's session.start, as a plugin beneath registering its commands there. */
  onStart?: () => void
  /** Delays `$.command.list()` by this many ms (a slow discovery). */
  listDelay?: number
}

const MENU_FILE = '/.claude-plugin/quick-menu.json'

function stub(on: any, w: World) {
  const files = (): Record<string, string> => ({
    ...w.files,
    ...(w.registry && { [REGISTRY]: JSON.stringify({ version: 2, plugins: w.registry }) }),
  })
  const env = (): Record<string, string> => ({ HOME, ...w.env })
  on('session.start', () => (w.onStart?.(), { cwd: '/tmp' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', (_$: unknown, e: unknown) => (
    w.open?.(e),
    { value: w.placed === false ? { isPlaced: false, reason: 'terminal too narrow' } : { isPlaced: true } }
  ))
  on('ui.panes', () => ({ value: [] }))
  const store = w.store ?? new Map<string, unknown>()
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('settings.read', () => ({ value: { enabledPlugins: w.enabled ?? {} } }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: env()[e.name] }))
  const isSelf = (path: string): boolean => w.self !== undefined && !(path in files()) && path.endsWith(MENU_FILE)
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: e.path in files() || isSelf(e.path) }))
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (isSelf(e.path)) return { value: w.self }
    const f = files()
    if (!(e.path in f)) throw new Error(`ENOENT ${e.path}`)
    return { value: f[e.path] }
  })
  on('command.list', async () => {
    if (w.listDelay) await new Promise(r => setTimeout(r, w.listDelay as number))
    return { value: [
      ...(w.commands ?? []).map(name => ({ name, description: '', source: 'plugin' })),
      ...(w.pluginCommands ?? []).map(c => ({ description: '', source: 'plugin', ...c })),
    ] }
  })
  on('config.list', () => ({ value: w.rows ?? [] }))
  on('command.run', (_$: unknown, e: { command: string; args?: string }) => {
    if (e.command === 'menu') return undefined
    return w.run ? w.run(e) : { text: 'ok' }
  })
  on('config.set', (_$: unknown, e: { key: string; value: unknown }) =>
    w.set ? w.set(e) : { value: e.value },
  )
}

async function start($: any, cwd = '/tmp') {
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true })
}

/** The pane as first drawn: sections at their default fold. */
async function foldedPane($: any): Promise<any> {
  return $.ui.mount({
    plugin: 'agent-quick-menu',
    surface: 'terminal',
    component: 'Pane',
    props: PANE_PROPS,
    requestId: 'quick-menu',
  })
}

/** The pane with every section expanded, as most tests read it. */
async function paneText($: any, surface = 'terminal'): Promise<any> {
  const ui = await $.ui.mount({
    plugin: 'agent-quick-menu',
    surface,
    component: 'Pane',
    props: PANE_PROPS,
    requestId: 'quick-menu',
  })
  await ui.press({ key: 'expand-all' })
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
    const ui = await paneText($)
    expect(await ui.find({ text: /▾ Alpha/ })).toBeDefined()
    expect(await ui.find({ key: 'cmd:alpha:a-run:--all' })).toBeDefined()
    expect(await ui.find({ text: /Gone \(not available\)/ })).toBeDefined()
    expect(await ui.find({ key: 'cmd:alpha:a-run:--all' })).toBeDefined()
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
    const ui = await paneText($)
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
    const ui = await paneText($)
    expect(await ui.find({ text: /▾ cfg$/ })).toBeDefined()
    expect(await ui.find({ key: 'set:cfg.token' })).toBeDefined()
    expect(await ui.find({ key: 'set:cfg.mode' })).toBeDefined()
    expect(await ui.find({ key: 'set:other.x' })).toBeDefined()
    expect(await ui.find({ text: /bare/ })).toBeUndefined()
  })

  test('the registry is read from CLAUDE_CONFIG_DIR when set', async ($, on) => {
    stub(on, {
      enabled: { 'alpha@mk': true },
      env: { CLAUDE_CONFIG_DIR: '/cfg' },
      files: {
        '/cfg/plugins/installed_plugins.json': file({
          version: 2,
          plugins: { 'alpha@mk': [{ scope: 'user', installPath: '/p/alpha' }] },
        }),
        '/p/alpha/.claude-plugin/quick-menu.json': file({ version: 1, title: 'FromCfgDir' }),
      },
    })
    await start($)
    const ui = await paneText($)
    expect(await ui.find({ text: /▾ FromCfgDir$/ })).toBeDefined()
    expect(await ui.find({ text: /installed_plugins/ })).toBeUndefined()
  })

  test('the install entry is the project or local one for the cwd, else user, else the first', async ($, on) => {
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
      const ui = await paneText($)
      const labels = (await ui.findAll({ type: 'Button' })).map((b: any) => String(b.props.label).replace(/^. /, ''))
      await ui.unmount()
      return labels
    }
    expect(await titles('/work')).toContain('work')
    world.registry = { 'alpha@mk': [mixed[0]!, mixed[1]!] }
    expect(await titles('/nowhere')).toContain('user')
    world.registry = { 'alpha@mk': [mixed[0]!, mixed[2]!] }
    expect(await titles('/nowhere')).toContain('other')
  })

  test('a builtin plugin with rows gets a settings-only section without a registry entry', async ($, on) => {
    stub(on, {
      rows: [row('inline.opt', { provider: { plugin: 'inline', tier: 'core' } }), row('theme')],
    })
    await start($)
    const ui = await paneText($)
    expect(await ui.find({ text: /▾ inline$/ })).toBeDefined()
    expect(await ui.find({ key: 'set:inline.opt' })).toBeDefined()
  })

  test('CLAUDE_CODE_PLUGIN_DIRS roots are discovered by their plugin.json name', async ($, on) => {
    stub(on, {
      registry: {},
      env: { CLAUDE_CODE_PLUGIN_DIRS: '/dev/one:/dev/two' },
      files: {
        '/dev/one/.claude-plugin/plugin.json': file({ name: 'devone' }),
        '/dev/one/.claude-plugin/quick-menu.json': file({ version: 1, commands: [{ command: 'x' }] }),
      },
    })
    await start($)
    const ui = await paneText($)
    expect(await ui.find({ text: /▾ devone$/ })).toBeDefined()
    expect(await ui.find({ text: /two: cannot identify plugin dir/ })).toBeDefined()
  })

  test('/menu refresh reruns discovery and toasts the counts when it lands', async ($, on) => {
    const toasts: string[] = []
    on('ui.toast', (_$: any, e: any, next: any) => (toasts.push(e.text), next(e)))
    const world: World = { enabled: {}, registry: {} }
    stub(on, world)
    await start($)
    const before = await $.command.run({ command: 'menu', args: 'refresh' } as never)
    expect(before.text).toMatch(/discovering/)
    await new Promise(r => setTimeout(r, 50))
    expect(toasts.at(-1)).toMatch(/0 sections/)
    world.enabled = { 'late@m': true }
    world.registry = { 'late@m': [{ installPath: '/p/late' }] }
    world.files = { '/p/late/.claude-plugin/quick-menu.json': file({ version: 1 }) }
    await $.command.run({ command: 'menu', args: 'refresh' } as never)
    await new Promise(r => setTimeout(r, 50))
    expect(toasts.at(-1)).toMatch(/1 sections, 0 problems/)
  })
})

const ALPHA = {
  enabled: { 'alpha@mk': true },
  registry: { 'alpha@mk': [{ installPath: '/p/alpha' }] },
}
const alphaFile = (o: unknown) => ({ '/p/alpha/.claude-plugin/quick-menu.json': file(o) })

describe('commands', () => {
  test('press runs $.command.run with command and args, shows queued, then toasts the first line', async ($, on) => {
    let release: (v?: unknown) => void = () => {}
    const calls: unknown[] = []
    const toasts: string[] = []
    on('ui.toast', (_$: any, e: any, next: any) => {
      toasts.push(e.text)
      return next(e)
    })
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
    const ui = await paneText($)
    const pressed = ui.press({ key: 'cmd:alpha:go:--all' })
    await new Promise(r => setTimeout(r, 20))
    expect(calls).toMatchObject([{ command: 'go', args: '--all' }])
    expect(await ui.find({ text: /queued/ })).toBeDefined()
    release({ text: 'first line\nsecond' })
    await pressed
    await new Promise(r => setTimeout(r, 100))
    expect(toasts).toEqual(['first line'])
    expect(await ui.find({ text: /queued/ })).toBeUndefined()
  })

  test('two quick presses run the command once', async ($, on) => {
    let release: (v?: unknown) => void = () => {}
    const calls: unknown[] = []
    stub(on, {
      ...ALPHA,
      files: alphaFile({ version: 1, commands: [{ command: 'go' }] }),
      commands: ['go'],
      run: e => (calls.push(e), new Promise(res => (release = res))),
    })
    await start($)
    const ui = await paneText($)
    const first = ui.press({ key: 'cmd:alpha:go:' })
    const second = ui.press({ key: 'cmd:alpha:go:' })
    await new Promise(r => setTimeout(r, 20))
    release({ text: 'ok' })
    await Promise.all([first, second])
    await new Promise(r => setTimeout(r, 100))
    expect(calls).toHaveLength(1)
  })

  test('a hot reload (session.start again) clears the queued state', async ($, on) => {
    const calls: unknown[] = []
    stub(on, {
      ...ALPHA,
      files: alphaFile({ version: 1, commands: [{ command: 'go' }] }),
      commands: ['go'],
      run: e => (calls.push(e), new Promise(res => setTimeout(() => res({ text: '' }), 60))),
    })
    await start($)
    const ui = await paneText($)
    void ui.press({ key: 'cmd:alpha:go:' })
    await new Promise(r => setTimeout(r, 20))
    expect(await ui.find({ text: /queued/ })).toBeDefined()
    await start($)
    expect(await ui.find({ text: /queued/ })).toBeUndefined()
    await new Promise(r => setTimeout(r, 150))
  })

  test('an unavailable command shows "not available" and has no action', async ($, on) => {
    stub(on, { ...ALPHA, files: alphaFile({ version: 1, commands: [{ command: 'gone' }] }), commands: [] })
    await start($)
    const ui = await paneText($)
    expect(await realButtons(ui)).toHaveLength(0)
    expect(await ui.find({ text: /gone \(not available\)/ })).toBeDefined()
  })
})

describe('settings', () => {
  const setup = (rows: Record<string, unknown>[], extra: Partial<World> = {}) => ({
    ...ALPHA,
    files: alphaFile({ version: 1 }),
    rows,
    ...extra,
  })

  test('boolean toggles, choice selects, text and number inputs write via $.config.set', async ($, on) => {
    const sets: unknown[] = []
    stub(
      on,
      setup(
        [
          row('alpha.flag', { kind: 'boolean', value: false }),
          row('alpha.mode', { kind: 'choice', value: 'a', options: ['a', 'b'] }),
          row('alpha.name', { kind: 'text', value: 'x' }),
          row('alpha.count', { kind: 'number', value: 1 }),
        ],
        { set: e => (sets.push(e), { value: e.value }) },
      ),
    )
    await start($)
    const ui = await paneText($)
    await ui.press({ key: 'set:alpha.flag' })
    await ui.select({ key: 'set:alpha.mode', value: 'b' })
    await ui.input({ key: 'set:alpha.name', text: 'hello' })
    await ui.input({ key: 'set:alpha.count', text: '42' })
    expect(sets).toMatchObject([
      { key: 'alpha.flag', value: true },
      { key: 'alpha.mode', value: 'b' },
      { key: 'alpha.name', value: 'hello' },
      { key: 'alpha.count', value: 42 },
    ])
  })

  test('on mobile, without Select and Input, choice, text and number rows are read-only text', async ($, on) => {
    stub(
      on,
      setup([
        row('alpha.mode', { kind: 'choice', value: 'a', options: ['a', 'b'] }),
        row('alpha.name', { kind: 'text', value: 'x' }),
        row('alpha.count', { kind: 'number', value: 1 }),
      ]),
    )
    await start($)
    const ui = await paneText($, 'mobile')
    expect(await ui.find({ text: /mode\s+a/ })).toBeDefined()
    expect(await ui.find({ text: /name\s+x/ })).toBeDefined()
    expect(await ui.find({ text: /count\s+1/ })).toBeDefined()
    expect(await ui.findAll({ type: 'Input' })).toHaveLength(0)
  })

  test('an invalid number shows an error and does not call set', async ($, on) => {
    const sets: unknown[] = []
    stub(on, setup([row('alpha.count', { kind: 'number', value: 1 })], { set: e => (sets.push(e), { value: e.value }) }))
    await start($)
    const ui = await paneText($)
    await ui.input({ key: 'set:alpha.count', text: 'abc' })
    expect(sets).toEqual([])
    expect(await ui.find({ text: /not a number/ })).toBeDefined()
  })

  test('a deny reason is shown beside the row', async ($, on) => {
    stub(on, setup([row('alpha.flag', { kind: 'boolean', value: false })], { set: () => ({ deny: 'policy says no' }) }))
    await start($)
    const ui = await paneText($)
    await ui.press({ key: 'set:alpha.flag' })
    expect(await ui.find({ text: /policy says no/ })).toBeDefined()
  })

  test('a locked row shows "managed" and has no editor', async ($, on) => {
    stub(on, setup([row('alpha.flag', { kind: 'boolean', value: true, isLocked: true })]))
    await start($)
    const ui = await paneText($)
    expect(await ui.find({ text: /managed/ })).toBeDefined()
    expect(await realButtons(ui)).toHaveLength(0)
  })

  test('settings follow the file list order and skip unlisted rows', async ($, on) => {
    stub(on, {
      ...ALPHA,
      files: alphaFile({ version: 1, settings: ['b', 'a'] }),
      rows: [row('alpha.a'), row('alpha.b'), row('alpha.c')],
    })
    await start($)
    const ui = await paneText($)
    const keys = (await ui.findAll({ type: 'Input' })).map((x: any) => x.key).filter((k: string) => k !== 'filter')
    expect(keys).toEqual(['set:alpha.b', 'set:alpha.a'])
  })
})

describe('sections', () => {
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
    const ui = await paneText($)
    const heads = (await ui.findAll({ type: 'Button' }))
      .concat(await ui.findAll({ type: 'Text' }))
      .map((x: any) => x.text as string)
      .filter((t: string) => ['▾ Alpha', '▾ Zed', '▾ cfg', '▾ Claude Code', 'Problems'].includes(t))
    expect(heads).toEqual(['▾ Alpha', '▾ Zed', '▾ cfg', '▾ Claude Code', 'Problems'])
    expect(await ui.find({ key: 'set:theme' })).toBeDefined()
  })
})

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

const textsOf = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((x: any) => x.text as string)

describe('favourites', () => {
  test('pinning and unpinning writes through $.store and survives a fresh session.start', async ($, on) => {
    const store = new Map<string, unknown>()
    stub(on, FAV_WORLD({ store }))
    await start($)
    const ui = await paneText($)
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
    const ui = await paneText($)
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
    const ui = await paneText($)
    const heads = (await ui.findAll({ type: 'Button' })).map((x: any) => x.text as string)
    expect(heads.filter((t: string) => t.includes('Favourites') || t.includes('alpha'))).toEqual(['▾ Favourites', '▾ alpha'])
    const keys = (await ui.findAll({})).map((x: any) => x.key as string).filter((k: string) => k?.startsWith('fav:') && !k.includes('star'))
    expect(keys).toEqual(['fav:set:alpha.name', 'fav:cmd:alpha:stop:'])
  })

  test('a favourite whose source is gone shows "gone" and can only be removed', async ($, on) => {
    const store = new Map<string, unknown>([['favourites', [{ kind: 'command', plugin: 'alpha', key: 'vanished' }]]])
    stub(on, FAV_WORLD({ store }))
    await start($)
    const ui = await paneText($)
    expect(await ui.find({ text: /vanished \(gone\)/ })).toBeDefined()
    const pinned = (await ui.findAll({ type: 'Button' })).filter((b: any) => String(b.key).startsWith('fav:'))
    expect(pinned.map((b: any) => b.text)).toEqual(['★'])
    await ui.press({ key: pinned[0].key })
    expect(store.get('favourites')).toEqual([])
    expect(await ui.find({ text: /gone/ })).toBeUndefined()
  })
})

const emptyBase = (on: any) =>
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

describe('band', () => {
  const pin = () => [
    { kind: 'command', plugin: 'alpha', key: 'go --all' },
    { kind: 'setting', plugin: 'alpha', key: 'alpha.flag' },
  ]

  test('shows the menu button and favourites in order with digit hotkeys', async ($, on) => {
    const store = new Map<string, unknown>([['favourites', pin()]])
    stub(on, FAV_WORLD({ store }))
    emptyBase(on)
    await start($)
    const ui = await mountBand($)
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map((b: any) => [b.props.label, b.props.hotkey])).toEqual([
      ['☰ menu', 'm'],
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

  test('a boolean favourite toggles via $.config.set', async ($, on) => {
    const sets: unknown[] = []
    const store = new Map<string, unknown>([['favourites', pin()]])
    stub(on, FAV_WORLD({ store, set: e => (sets.push(e), { value: e.value }) }))
    emptyBase(on)
    await start($)
    const ui = await mountBand($)
    await ui.press({ key: 'band:2' })
    expect(sets).toMatchObject([{ key: 'alpha.flag', value: true }])
  })

  test('band width counts code points and keeps 4 cells for [-]', async ($, on) => {
    const fav = [
      { kind: 'command', plugin: 'alpha', key: 'go --all' },
      { kind: 'command', plugin: 'alpha', key: 'stop' },
    ]
    const store = new Map<string, unknown>([['favourites', fav]])
    stub(on, FAV_WORLD({ store }))
    emptyBase(on)
    await start($)
    // menu: 6 + 5 = 11, divider 2, reserve 4 -> 17; Go: 2 + 3 (digit) + 2 = 7 -> 24; stop: 4 + 3 + 2 = 9 -> 33.
    const labels = async (columns: number) =>
      (await (await mountBand($, { ...(BAND_PROPS as object), bodyColumns: columns })).findAll({ type: 'Button' })).map(
        (b: any) => b.props.label,
      )
    expect(await labels(33)).toEqual(['☰ menu', 'Go', 'stop'])
    expect(await labels(32)).toEqual(['☰ menu', 'Go'])
    expect(await labels(23)).toEqual(['☰ menu'])
  })

  test('only command favourites get digit hotkeys', async ($, on) => {
    const store = new Map<string, unknown>([['favourites', [
      { kind: 'setting', plugin: 'alpha', key: 'alpha.flag' },
      { kind: 'command', plugin: 'alpha', key: 'stop' },
    ]]])
    stub(on, FAV_WORLD({ store }))
    emptyBase(on)
    await start($)
    const ui = await mountBand($)
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map((b: any) => b.props.hotkey)).toEqual(['m', undefined, '1'])
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
    const ui = await foldedPane($)
    const labels = (await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)
    expect(labels).toContain('▾ Favourites')
    expect(labels).toContain('▸ alpha')
    expect(labels).toContain('▸ Claude Code')
    expect(await ui.find({ key: 'fav:cmd:alpha:stop:' })).toBeDefined()
    expect(await ui.find({ key: 'cmd:alpha:go:--all' })).toBeUndefined()
    expect(await ui.find({ key: 'set:theme' })).toBeUndefined()
  })

  test('a header toggles its section and the state persists in $.store and across session.start', async ($, on) => {
    const store = new Map<string, unknown>()
    stub(on, FOLD({ store }))
    await start($)
    const ui = await foldedPane($)
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
    const ui = await foldedPane($)
    store.set('folded', { engine: false })
    await ui.press({ key: 'fold:plugin:alpha' })
    expect(store.get('folded')).toEqual({ engine: false, 'plugin:alpha': false })
  })

  test('Expand all and Collapse all carry the hotkeys e and c and set every section', async ($, on) => {
    const store = new Map<string, unknown>([['favourites', [{ kind: 'command', plugin: 'alpha', key: 'stop' }]]])
    stub(on, FOLD({ store }))
    await start($)
    const ui = await foldedPane($)
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

  test('the commands of a section sit in one wrapping row', async ($, on) => {
    stub(on, FOLD())
    await start($)
    const ui = await paneText($)
    const rows = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.flexWrap === 'wrap')
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('commands')
    const labels = (await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)
    expect(labels.filter((l: string) => l === 'Go' || l === 'stop')).toEqual(['Go', 'stop'])
  })

  test('setting labels are padded to the longest label of their section', async ($, on) => {
    stub(on, FOLD())
    await start($)
    const ui = await paneText($)
    const flag = await ui.find({ key: 'set:alpha.flag' })
    const name = await ui.find({ key: 'set:alpha.longer_name' })
    expect(flag.props.label).toBe('off')
    expect(await ui.find({ text: 'flag         ' })).toBeDefined()
    expect(name.props.label).toBe('longer_name  ')
  })

  test('a locked row is dim and says managed', async ($, on) => {
    stub(on, { ...FOLD(), rows: [row('alpha.flag', { kind: 'boolean', value: true, isLocked: true })] })
    await start($)
    const ui = await paneText($)
    const t = (await ui.findAll({ type: 'Text' })).find((x: any) => /managed/.test(x.text))
    expect(t.props.dimColor).toBe(true)
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

describe('narrow terminal', () => {
  const NARROW = (extra: Partial<World> = {}): World => ({ ...FAV_WORLD(extra), placed: false })

  test('an unplaced pane toasts why and the band shows the section headers', async ($, on) => {
    const toasts: string[] = []
    on('ui.toast', (_$: any, e: any, next: any) => (toasts.push(e.text), next(e)))
    stub(on, NARROW())
    emptyBase(on)
    await start($)
    const ui = await mountBand($, { ...(BAND_PROPS as object), maxRows: 6 })
    expect(await ui.find({ key: 'fold:plugin:alpha' })).toBeUndefined()
    await ui.press({ key: 'band:menu' })
    expect(toasts.join()).toMatch(/terminal too narrow/)
    const fresh = await mountBand($, { ...(BAND_PROPS as object), maxRows: 6 })
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
    expect(heads).toHaveLength(2)
  })

  test('a placed pane leaves the band to its one line', async ($, on) => {
    stub(on, FAV_WORLD())
    emptyBase(on)
    await start($)
    await (await mountBand($)).press({ key: 'band:menu' })
    const ui = await mountBand($)
    expect(await ui.find({ key: 'fold:plugin:alpha' })).toBeUndefined()
  })
})

describe('live feedback round 1', () => {
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
    const ui = await paneText($)
    expect(await ui.find({ text: /▾ repo-tools$/ })).toBeDefined()
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
      env: { CLAUDE_CODE_PLUGIN_DIRS: '/dev/one' },
      files: {
        '/dev/one/.claude-plugin/plugin.json': file({ name: 'devone' }),
        '/dev/one/.claude-plugin/quick-menu.json': file({ version: 1, commands: [{ command: 'x' }] }),
      },
      pluginCommands: [{ name: 'x', plugin: 'devone' }],
    })
    await start($)
    const ui = await paneText($)
    expect((await ui.findAll({ type: 'Button' })).filter((b: any) => /devone$/.test(String(b.props.label)))).toHaveLength(1)
    expect(await ui.find({ text: /CLAUDE_CODE_PLUGIN_DIRS to read/ })).toBeUndefined()
  })

  test('every setting row has the same shape: a plain label, then the value; a boolean is a small toggle', async ($, on) => {
    stub(on, {
      ...ALPHA,
      files: alphaFile({ version: 1 }),
      rows: [
        row('alpha.flag', { kind: 'boolean', value: true }),
        row('alpha.mode', { kind: 'choice', value: 'a', options: ['a', 'b'] }),
        row('alpha.fixed', { kind: 'boolean', value: false, isLocked: true }),
      ],
    })
    await start($)
    const ui = await paneText($)
    const flag = await ui.find({ key: 'set:alpha.flag' })
    expect(flag.type).toBe('Button')
    expect(flag.props.label).toBe('on')
    expect(await ui.find({ text: /^flag\s+$/ })).toBeDefined()
    expect((await ui.find({ key: 'set:alpha.mode' })).props.label).toMatch(/^mode\s+$/)
    expect(await ui.find({ text: /fixed\s+false\s+managed/ })).toBeDefined()
  })

  test('the filter hides rows and sections, opens matches, and the counts follow', async ($, on) => {
    const SET = (n: string, extra = {}) => row(n, extra)
    stub(on, {
      enabled: { 'alpha@mk': true },
      registry: { 'alpha@mk': [{ installPath: '/p/alpha' }] },
      files: {
        '/p/alpha/.claude-plugin/quick-menu.json': file({ version: 1, commands: [{ command: 'go', label: 'Go' }] }),
      },
      commands: ['go'],
      rows: [
        SET('alpha.Flag', { kind: 'boolean', value: true }),
        SET('alpha.other', { kind: 'text', value: 'x' }),
        SET('theme', { kind: 'text', value: 'dark' }),
        SET('autoCompact', { kind: 'boolean', value: true, label: 'Auto-compact' }),
      ],
    })
    await start($)
    const ui = await foldedPane($)
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
    const ui = await foldedPane($)
    const labels = (await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)
    expect(labels).toContain('▸ alpha')
    expect(labels).toContain('▸ agents-md')
    expect(labels).toContain('▸ shiny')
    const tags = (await ui.findAll({ type: 'Text' })).filter((t: any) => t.text === 'built-in')
    expect(tags).toHaveLength(1)
    expect(tags[0].props.dimColor).toBe(true)
  })
})

const SELF_FILE = file({
  version: 1,
  title: 'Quick menu',
  commands: [{ command: 'menu', label: 'Refresh', args: 'refresh' }],
  settings: [],
})

describe('live feedback round 2', () => {
  test('a row naming /menu is answered by the menu itself, not by $.command.run (the engine skips own hooks on re-entry)', async ($, on) => {
    const toasts: string[] = []
    const runs: { command: string }[] = []
    on('ui.toast', (_$: any, e: any, next: any) => (toasts.push(e.text), next(e)))
    stub(on, {
      registry: {},
      self: SELF_FILE,
      pluginCommands: [{ name: 'menu', plugin: 'agent-quick-menu' }],
      run: e => (runs.push(e), { text: 'agent-quick-menu registered /menu but no command.run hook answered it' }),
    })
    await start($)
    const ui = await paneText($)
    await ui.press({ key: 'cmd:agent-quick-menu:menu:refresh' })
    await new Promise(r => setTimeout(r, 50))
    expect(runs.filter(r => r.command === 'menu')).toHaveLength(0)
    expect(toasts.join('\n')).not.toMatch(/no command\.run hook answered/)
    expect(toasts.at(-1)).toMatch(/Quick menu refreshed: \d+ sections/)
    expect(toasts.filter(t => /discovering/.test(t))).toHaveLength(0)
  })

  test('/menu answers at once while a slow discovery is still running', async ($, on) => {
    stub(on, { registry: {}, listDelay: 400 })
    await start($)
    const t0 = Date.now()
    const opened = await $.command.run({ command: 'menu' } as never)
    expect(opened.text).toBe('Quick menu opened')
    expect(Date.now() - t0).toBeLessThan(300)
    const refreshed = await $.command.run({ command: 'menu', args: 'refresh' } as never)
    expect(refreshed.text).toMatch(/discovering/)
    expect(Date.now() - t0).toBeLessThan(300)
    await new Promise(r => setTimeout(r, 900))
  })

  // The test kit raises no plugin.register, so the --plugin-dir root comes in through CLAUDE_CODE_PLUGIN_DIRS, ranked with it.
  test('a --plugin-dir root shadows the installed copy of the same plugin, and its menu file is read', async ($, on) => {
    stub(on, {
      enabled: { 'repo-tools@mk': true },
      registry: { 'repo-tools@mk': [{ scope: 'user', installPath: '/p/rt-installed' }] },
      env: { CLAUDE_CODE_PLUGIN_DIRS: '/dev/rt' },
      files: {
        '/dev/rt/.claude-plugin/plugin.json': file({ name: 'repo-tools' }),
        '/dev/rt/.claude-plugin/quick-menu.json': file({
          version: 1,
          title: 'repo-tools',
          commands: [{ command: 'rt-status', label: 'Status' }, { command: 'rt-pull', label: 'Pull all', args: '--all' }],
        }),
      },
      commands: ['rt-status', 'rt-pull'],
    })
    await start($)
    const ui = await paneText($)
    expect(await ui.find({ text: /▾ repo-tools$/ })).toBeDefined()
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
    const ui = await paneText($)
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
    const ui = await paneText($)
    expect(await ui.find({ text: /▾ Quick menu$/ })).toBeDefined()
    expect((await ui.find({ key: 'cmd:agent-quick-menu:menu:refresh' })).props.label).toBe('Refresh')
    expect(await ui.find({ key: 'cmd:agent-quick-menu:menu:' })).toBeUndefined()
    expect(await ui.find({ text: /loaded with --plugin-dir/ })).toBeUndefined()
  })
})
