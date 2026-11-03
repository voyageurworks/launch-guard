# Using launch-guard in CI and in a git hook

launch-guard is report-only, so it is safe to run anywhere: it never changes the repository, and its output holds no secret, no list value and no commit message.

## What a CI run can and cannot check

A CI runner has no private list (that file lives only on your own machine, on purpose). So a CI run still checks:

- secrets in files and in the whole git history,
- old commits that may still be reachable,
- the basics (licence, security policy, CI, funding file, user-profile paths in assistant files).

It skips the personal and restricted checks and says so in an info line. Run those on your own machine before you go public.

Two settings matter:

- **Fetch the full history** (`fetch-depth: 0`). The history check reads every commit; a shallow clone gives an incomplete answer and the report says so.
- **Use `--offline`.** A runner has nothing to gain from the remote check, and the default credentials of a runner are not meant for `git ls-remote` against other remotes.

## GitHub Actions

Save as `.github/workflows/launch-guard.yml`. Pin actions by commit SHA and keep them current (Dependabot can do that for you); the SHAs below are the ones this project uses.

```yaml
name: launch-guard

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  scan:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 22
      # Path of launch-guard.mjs inside your repository (copy the skill/ folder in), or run it from a checkout of this project.
      - run: node tools/launch-guard/launch-guard.mjs . --offline
```

The job fails (exit code 1) only on a blocking finding. To keep the report for other tools, add `--json` and save the output:

```sh
node tools/launch-guard/launch-guard.mjs . --offline --json > launch-guard.json
```

The report holds file names and line numbers of the scanned repository. Treat it like the repository itself: if the repository is private, so is the report.

This project runs the same job on itself (see `.github/workflows/ci.yml`, job `self-scan`).

## Checking the package before `npm publish`

`--pack` scans what `npm pack` would upload (see the README). In a release job, run it after the build step and before the publish step, so a leaky package stops the release. It needs npm on the runner (the `setup-node` step provides it) and no full history:

```yaml
  pack-check:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 22
      # Build first if the published files are generated: --pack never runs your scripts.
      - run: npm ci --ignore-scripts && npm run build
      - run: npx -y @voyageurworks/launch-guard-pack . --pack --offline
```

The step fails (exit 1) only on a blocking finding, and exits 2 with one fixed message if the package cannot be built or read. Add `--json` to keep the report. As with the other runs, a runner has no private list, so only the secret scanner and the package rules apply there; run it on your own machine to apply your list to the package too.

## A git pre-push hook

```sh
node skill/launch-guard.mjs --print-hook
```

prints a short script. Save it as `.git/hooks/pre-push`, make it executable (`chmod +x`), and put the real path of `launch-guard.mjs` where it says `/path/to/launch-guard.mjs`. A blocking finding, or a setup problem (exit code 2), then stops the push. On the machine that holds your private list, the hook uses it, so the personal and restricted checks run too.

launch-guard does not install the hook itself: it never writes inside a repository. The hook scans the whole working tree and history on each push, so on a very large repository you may prefer to run it by hand before going public.
