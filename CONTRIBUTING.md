# Contributing

## Branches

- `develop` is where work happens. `main` carries releases.
- Branch from `develop` and open pull requests into `develop`. `develop` is merged into `main` for a release.
- Every change reaches `develop` and `main` through a pull request; neither branch takes direct pushes. Pull requests into `develop` are squash-merged, so the pull request title becomes the commit subject and the CHANGELOG line.
- Releases follow [semantic versioning](https://semver.org) and are automatic. A pull request from `develop` into `main` makes the `release / version` check (the reusable workflow in [agentic-workbench/workflows](https://github.com/agentic-workbench/workflows)) run `scripts/release.mjs prepare`, which pushes a `chore(release): <version>` commit to `develop` with the bumped `version` in `.claude-plugin/plugin.json` and the CHANGELOG section. Merging that pull request (a merge commit) tags `v<version>` and publishes the GitHub release. Before 1.0 a breaking change (`type!:`) raises the minor and anything else the patch. Claude Code updates an install only when `version` changes. To try unreleased work, run it with `claude --plugin-dir .`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) for commits and pull request titles: `feat(menu): ...`, `fix(band): ...`, `docs: ...`, `chore: ...`. Keep the subject short and in the imperative. `feat` lands under Added, `fix` under Fixed, everything else under Changed.

## Checks

```
make check
```

This runs `node scripts/check-json.mjs`, then `claude plugin validate .` and `claude plugin test .` when `claude` is on PATH, then `tsc --noEmit` with `tsc` from PATH or else TypeScript 5 through `npx`. The claude checks are skipped without `claude`, and tsc is skipped, with a message, until the API types exist (see below), so install `claude` before sending a PR. CI only runs `node scripts/check-json.mjs`, because `claude` is not available there.

## Running the mod

```
claude --plugin-dir .
```

Run `/reload-plugins` in a running session after an edit.

`tsc` needs the plugin API types in `.claude-plugin/types/`, which is gitignored. Claude Code lays them there when it loads the plugin, so run `claude --plugin-dir .` once in a fresh checkout; until then `make check` skips tsc with a message.

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
