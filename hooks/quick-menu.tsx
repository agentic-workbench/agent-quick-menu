import type { EngineInterface, Register } from 'claude-code'

export const PANE_ID = 'quick-menu'

async function openMenu($: EngineInterface): Promise<{ text: string }> {
  await $.ui.open({ id: PANE_ID, title: 'Quick menu', focus: true, columns: 100 })
  return { text: 'Quick menu opened' }
}

function renderMenu($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0]) {
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      <Text dimColor>Quick menu: nothing here yet.</Text>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'menu',
      description: 'Open the quick menu',
      argumentHint: '',
    })
    return next(e)
  })

  on('command.run', { command: 'menu' }, $ => openMenu($))

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e) => renderMenu($, e))
}
