# Development entry points.
.PHONY: check

# The mod is validated and tested by Claude Code itself; skipped where it is absent.
check:
	@if command -v claude >/dev/null 2>&1; then claude plugin validate . && claude plugin test .; else echo "check: skipped (claude not on PATH)"; fi
