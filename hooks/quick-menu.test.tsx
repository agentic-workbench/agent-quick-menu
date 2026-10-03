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
  rows?: { key: string }[]
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
    expect(await ui.find({ text: /\/a-run --all a-run$/ })).toBeDefined()
    expect(await ui.find({ text: /Gone \(not available\)/ })).toBeDefined()
    expect(await ui.find({ text: /settings: mode/ })).toBeDefined()
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
      rows: [{ key: 'cfg.token' }, { key: 'cfg.mode' }, { key: 'other.x' }, { key: 'theme' }],
    })
    await start($)
    const ui = await paneText($)
    expect(await ui.find({ text: /^cfg$/ })).toBeDefined()
    expect(await ui.find({ text: /settings: token, mode/ })).toBeDefined()
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
