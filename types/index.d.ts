/** Schema version of the menu file a plugin ships at `.claude-plugin/quick-menu.json`. */
export type QuickMenuVersion = 1

declare module 'claude-code' {
  interface PluginState {
    'agent-quick-menu': {
      /** Reserved: state arrives with the discovery and favourites tasks. */
      version: 1
    }
  }
}
