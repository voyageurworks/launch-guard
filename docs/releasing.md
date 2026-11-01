# Releasing

Maintainer notes. **Nothing is published yet.** No npm package exists and no release has been made. A release happens only when the owner does the steps below; the files in this repository do not publish anything by themselves.

Releases are meant to publish to npm as `@voyageurworks/launch-guard` from GitHub Actions (`.github/workflows/release.yml`), with provenance and no stored token.

## One-time setup (needs the maintainer's own npm account)

1. Create an npm account and turn on two-factor authentication.
2. Create the `voyageurworks` npm organization (free for public packages), or use a user named `voyageurworks`. The scope in `package.json` must match.
3. Publish the first version by hand, because trusted publishing is configured on an existing package:
   ```sh
   npm login
   npm publish --access public
   ```
4. On npmjs.com open the package, Settings, Trusted Publisher, and choose GitHub Actions: organization `voyageurworks`, repository `launch-guard`, workflow `release.yml`. From then on no npm token is needed.

The workflow runs on every published GitHub release that is not a prerelease (prereleases are skipped). If npm already has the exact version in `package.json` (the first version, published by hand), the workflow says so in a notice and skips every later step, so creating the GitHub release for that version does not fail. It does fail if a release is created for a new version before the one-time npm trusted-publishing setup above is finished. That failure is harmless: the package just is not published. Start trusted-publishing releases with the next version (0.1.1). Nothing is published until the owner does these steps. Before publishing, the workflow checks that the runner's npm is 11.5.1 or later (needed for trusted publishing) and stops with a clear message if it is not.

## Why no token is stored

The release workflow asks GitHub for a short-lived identity token (`id-token: write`) and npm accepts it for this repository and workflow only (trusted publishing). There is no long-lived npm token in the repository settings to leak or rotate, and the published package carries a provenance statement linking it to the commit and workflow that built it.

## Each release

1. Update `version` in `package.json`, put the release date on the matching heading in `CHANGELOG.md` (the first release reads `0.1.0 - unreleased` until then), run `pnpm build` so the committed bundle `skill/launch-guard.mjs` is current, commit, and wait for CI to pass on `main`.
2. Create a GitHub release whose tag is `v` plus the version (for example `v0.1.0`). The `Release` workflow checks that the tag matches `package.json`, runs the checks, build and tests, checks that the committed bundle is current, and publishes.

## Check before publishing

`npm pack --dry-run` lists exactly what goes into the package. `npm publish --dry-run` runs the whole publish except the upload.
