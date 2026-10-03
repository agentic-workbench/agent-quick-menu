# Development entry points.
.PHONY: check

TSC ?= tsc

# The mod is validated and tested by Claude Code itself, and type-checked by tsc; each is skipped where absent.
check:
	@if command -v claude >/dev/null 2>&1; then claude plugin validate . && claude plugin test .; else echo "check: skipped (claude not on PATH)"; fi
	@if command -v $(TSC) >/dev/null 2>&1; then $(TSC) --noEmit -p .; else echo "check: tsc skipped (not on PATH)"; fi
