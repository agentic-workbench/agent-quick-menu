# Development entry points.
.PHONY: check

# tsc from PATH, else the TypeScript 5 package through npx.
TSC ?= $(shell command -v tsc 2>/dev/null || echo npx -y -p typescript@5 tsc)

# The JSON files and the menu schema are checked always; the mod is validated and tested by Claude Code itself (skipped
# without `claude`) and type-checked by tsc against the API types Claude Code lays in .claude-plugin/types/ (skipped until it has).
check:
	@node scripts/check-json.mjs
	@if command -v claude >/dev/null 2>&1; then claude plugin validate . && claude plugin validate .claude-plugin/plugin.json && claude plugin test .; else echo "check: claude checks skipped (claude not on PATH)"; fi
	@if [ -f .claude-plugin/types/tsconfig.json ]; then $(TSC) --noEmit -p .; else echo "check: tsc skipped (.claude-plugin/types/tsconfig.json missing; run claude --plugin-dir . once to lay the types)"; fi
