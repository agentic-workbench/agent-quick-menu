import { describe, expect, test } from 'claude-code/testing'

const PANE_PROPS = {
  title: 'Quick menu',
  isFocused: true,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, max: 0 },
  view: { rows: 24, columns: 100 },
} as never

describe('menu command', () => {
  test('/menu opens the quick-menu pane', async ($, on) => {
    const opened: unknown[] = []
    on('ui.open', (_$: unknown, e: unknown) => {
      opened.push(e)
      return { value: { isPlaced: true } }
    })
    const res = await $.command.run({ command: 'menu', args: '' })
    expect(res.text).toMatch(/Quick menu/)
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({ id: 'quick-menu', title: 'Quick menu', focus: true, columns: 100 })
    const ui = await $.ui.mount({
      plugin: 'agent-quick-menu',
      surface: 'terminal',
      component: 'Pane',
      props: PANE_PROPS,
      requestId: 'quick-menu',
    })
    expect(await ui.find({ text: /nothing here yet/ })).toBeDefined()
  })
})
