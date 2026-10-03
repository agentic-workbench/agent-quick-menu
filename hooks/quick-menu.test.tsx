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

const HOME = '/home/u'
const REGISTRY = `${HOME}/.claude/plugins/installed_plugins.json`

type World = {
  enabled?: Record<string, boolean>
  registry?: Record<string, { installPath: string }[]>
  files?: Record<string, string>
  env?: Record<string, string>
  commands?: string[]
  rows?: Record<string, unknown>[]
  run?: (e: { command: string; args?: string }) => unknown
  set?: (e: { key: string; value: unknown }) => unknown
}

function stub(on: any, w: World) {
  const files = (): Record<string, string> => ({
    ...w.files,
    ...(w.registry && { [REGISTRY]: JSON.stringify({ version: 2, plugins: w.registry }) }),
  })
  const env = (): Record<string, string> => ({ HOME, ...w.env })
  on('session.start', () => ({ cwd: '/tmp' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('settings.read', () => ({ value: { enabledPlugins: w.enabled ?? {} } }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: env()[e.name] }))
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: e.path in files() }))
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const f = files()
    if (!(e.path in f)) throw new Error(`ENOENT ${e.path}`)
    return { value: f[e.path] }
  })
  on('command.list', () => ({
    value: (w.commands ?? []).map(name => ({ name, description: '', source: 'plugin' })),
  }))
  on('config.list', () => ({ value: w.rows ?? [] }))
  on('command.run', (_$: unknown, e: { command: string; args?: string }) => {
    if (e.command === 'menu') return undefined
    return w.run ? w.run(e) : { text: 'ok' }
  })
  on('config.set', (_$: unknown, e: { key: string; value: unknown }) =>
    w.set ? w.set(e) : { value: e.value },
  )
}

async function start($: any) {
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
}

async function paneText($: any): Promise<any> {
  return $.ui.mount({
    plugin: 'agent-quick-menu',
    surface: 'terminal',
    component: 'Pane',
    props: PANE_PROPS,
    requestId: 'quick-menu',
  })
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
    expect(await ui.find({ text: /Alpha/ })).toBeDefined()
    expect(await ui.find({ key: 'cmd:alpha:a-run:--all' })).toBeDefined()
    expect(await ui.find({ text: /Gone \(not available\)/ })).toBeDefined()
    expect(await ui.find({ key: 'cmd:alpha:a-run:--all' })).toBeDefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(1)
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
    expect(await ui.find({ text: /^cfg$/ })).toBeDefined()
    expect(await ui.find({ key: 'set:cfg.token' })).toBeDefined()
    expect(await ui.find({ key: 'set:cfg.mode' })).toBeDefined()
    expect(await ui.find({ key: 'set:other.x' })).toBeUndefined()
    expect(await ui.find({ text: /bare/ })).toBeUndefined()
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
    expect(await ui.find({ text: /^devone$/ })).toBeDefined()
    expect(await ui.find({ text: /two: cannot identify plugin dir/ })).toBeDefined()
  })

  test('/menu refresh reruns discovery', async ($, on) => {
    const world: World = { enabled: {}, registry: {} }
    stub(on, world)
    await start($)
    const before = await $.command.run({ command: 'menu', args: 'refresh' })
    expect(before.text).toMatch(/0 sections/)
    world.enabled = { 'late@m': true }
    world.registry = { 'late@m': [{ installPath: '/p/late' }] }
    world.files = { '/p/late/.claude-plugin/quick-menu.json': file({ version: 1 }) }
    const after = await $.command.run({ command: 'menu', args: 'refresh' })
    expect(after.text).toMatch(/1 sections, 0 problems/)
  })
})

const ALPHA = {
  enabled: { 'alpha@mk': true },
  registry: { 'alpha@mk': [{ installPath: '/p/alpha' }] },
}
const alphaFile = (o: unknown) => ({ '/p/alpha/.claude-plugin/quick-menu.json': file(o) })

describe('commands', () => {
  test('press runs $.command.run with command and args, shows queued, then toasts the first line', async ($, on) => {
    let release: (v: unknown) => void = () => {}
    const calls: unknown[] = []
    const toasts: string[] = []
    on('ui.toast', (_$: unknown, e: { text: string }) => {
      toasts.push(e.text)
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

  test('an unavailable command shows "not available" and has no action', async ($, on) => {
    stub(on, { ...ALPHA, files: alphaFile({ version: 1, commands: [{ command: 'gone' }] }), commands: [] })
    await start($)
    const ui = await paneText($)
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
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
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  })

  test('settings follow the file list order and skip unlisted rows', async ($, on) => {
    stub(on, {
      ...ALPHA,
      files: alphaFile({ version: 1, settings: ['b', 'a'] }),
      rows: [row('alpha.a'), row('alpha.b'), row('alpha.c')],
    })
    await start($)
    const ui = await paneText($)
    const keys = (await ui.findAll({ type: 'Input' })).map((x: any) => x.key)
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
    const heads = (await ui.findAll({ type: 'Text' }))
      .map((x: any) => x.text as string)
      .filter(t => ['Alpha', 'Zed', 'cfg', 'Claude Code', 'Problems'].includes(t))
    expect(heads).toEqual(['Alpha', 'Zed', 'cfg', 'Claude Code', 'Problems'])
    expect(await ui.find({ key: 'set:theme' })).toBeDefined()
  })
})
