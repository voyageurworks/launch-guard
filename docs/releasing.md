# Releasing

Maintainer notes. Releases publish to npm as `@voyageurworks/launch-guard` from GitHub Actions (`.github/workflows/release.yml`), with provenance and no stored token. The first version was published by hand; every later one goes through the workflow below.

## One-time setup (needs the maintainer's own npm account)

1. Publish the first version by hand, because trusted publishing is configured on an existing package: `npm login`, then `npm publish --access public`.
2. In the GitHub repository, Settings, Environments: create `npm-publish`, add yourself as **required reviewer**, and limit deployments to the tag pattern `v*`.
3. On npmjs.com open the package, Settings, Trusted Publisher, GitHub Actions: organization `voyageurworks`, repository `launch-guard`, workflow `release.yml`, **Environment name `npm-publish`**, and tick **Allow npm publish** (the workflow runs `npm publish`; unticked, npm would stage every version for manual approval instead). npm asks for your two-factor method when you save it. With the environment name set, npm refuses any publish that did not pass the environment's approval, even from a modified workflow.
4. Package Settings, Publishing access: **Require two-factor authentication and disallow bypass 2fa tokens**.

## How a release is protected

- `verify` job: read-only token. Installs with a frozen lockfile, checks, builds, tests and packs the tarball. It cannot reach npm.
- `publish` job: the only job with `id-token: write`. It waits for your approval in the `npm-publish` environment, installs nothing, runs no repository code and publishes only the tarball `verify` built.
- `release.yml` runs only for non-prerelease releases of `voyageurworks/launch-guard` itself; tags named `v*` cannot be moved or deleted (repository ruleset); only GitHub-owned actions, pinned by commit SHA, are allowed to run.
- Treat any change to `.github/workflows/` as sensitive and read it before merging.

If npm already has the tagged version (the hand-published first one), the workflow notes that and skips both the build steps and the publish.

## Each release

1. Update `version` in `package.json` and the date in `CHANGELOG.md`; run `pnpm build` so the committed bundle `skill/launch-guard.mjs` is current (the release checks it), commit, and wait for CI to pass on `main`.
2. Create a GitHub release whose tag is `v` plus the version (for example `v1.0.1`).
3. Open the `Release` run in the Actions tab, check that it is the version you meant, and approve the `npm-publish` deployment.

## Check before publishing

`npm pack --dry-run` lists exactly what goes into the package.
