# Contributing

## Branches

- `develop` is where work happens. `main` carries releases.
- Branch from `develop` and open pull requests into `develop`. `develop` is merged into `main` for a release.
- Releases are tagged (`v0.1.0`, ...) and listed in [CHANGELOG.md](CHANGELOG.md). `plugin.json` has no version field on purpose, so an install follows the commit of the branch it tracks: `main` is releases, `develop` is the latest.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(menu): ...`, `fix(band): ...`, `docs: ...`, `chore: ...`. Keep the subject short and in the imperative.

## Checks

```
make check
```

This runs `claude plugin validate .` and `claude plugin test .` when `claude` is on PATH, and `tsc --noEmit` when `tsc` is on PATH. Each is skipped where absent, so install both before sending a PR. CI only checks the JSON files (`node scripts/check-json.mjs`), because `claude` is not available there.

## Running the mod

```
claude --plugin-dir .
```

Run `/reload-plugins` in a running session after an edit.

`tsc` needs the plugin API types in `.claude-plugin/types/`, which is gitignored. Claude Code lays them there when it loads the plugin, so run `claude --plugin-dir .` once in a fresh checkout before `tsc` or `make check`.

## Tests

Tests live in `hooks/quick-menu.test.tsx` and use the test kit from `claude-code/testing`:

```tsx
import { describe, expect, test } from 'claude-code/testing'
```

Add a `test(...)` to the matching `describe` block, reuse the helpers at the top of the file, and run `claude plugin test .` (or `make check`). A behaviour change comes with a test.

## The menu file convention

Changes to the `.claude-plugin/quick-menu.json` format go through `schema/quick-menu.schema.json` and `docs/convention.md` together.

## Conduct

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
