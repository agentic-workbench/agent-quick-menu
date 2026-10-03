# Privacy

agent-quick-menu runs entirely inside Claude Code on your machine.

- It collects no data and sends nothing over the network. It contains no analytics and names no hosts.
- It reads only what it needs to draw the menu: Claude Code's settings (`enabledPlugins`), the plugin registry `installed_plugins.json`, the environment variables `CLAUDE_CONFIG_DIR`, `HOME`, `USERPROFILE` and `CLAUDE_CODE_PLUGIN_DIRS`, and each plugin's `.claude-plugin/quick-menu.json`. It reads no credentials.
- It keeps your favourites and folded sections in Claude Code's plugin store on your machine. Uninstalling the plugin removes nothing else.
- A command you run from the menu, or a setting you change with it, does what that command or setting does; see the README section "What this plugin does on your machine".

Questions: open an issue at https://github.com/agentic-workbench/agent-quick-menu/issues.
