# Contributing

1. `pnpm install`
2. `pnpm check` (types), `pnpm test` (the whole suite; it creates temporary git repositories, so allow a few minutes) and `pnpm build`.
3. Write the failing test first, then the change.

## Golden rule: fake values only

launch-guard exists so that private data never gets printed, so its own repository must never hold any. Tests and fixtures use obviously fake values only: made-up words that start with `zq-`, and fake keys built by concatenation (for example `"AKI" + "A" + "ZQSENTINEL7731" + "XY"`) so no file contains a key-shaped string. Never use real names, addresses, keys, tokens or paths, not even your own, "just for a test".

The leak tests in `src/leak.test.ts` plant such values in test repositories and check that none of them appears in any output or error. They must keep passing; do not weaken or skip them.

## The committed bundle

`skill/launch-guard.mjs` is the script people copy. It is built from `src/` and committed. When you change source, run `pnpm build` and commit the rebuilt file; a test and CI both fail if it is stale.

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in a public issue. Maintainers: see [docs/releasing.md](docs/releasing.md).
