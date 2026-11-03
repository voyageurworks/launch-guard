---
name: launch-guard
description: Use before making a private repository public, or when asked whether a repo is safe to publish. Scans for secrets, personal details, restricted terms and old commits that would stay reachable, without ever printing private data.
---

# launch-guard

A check to run before a private repository goes public. It never edits repository files, rewrites history or pushes. The only network use is a read-only `git ls-remote` against the configured remotes (pass `--offline` to skip it), and the only file it writes is the template from `--init-list`.

## Run it

```
node <this skill's directory>/launch-guard.mjs <repo path>
```

This skill works for both Claude Code and Codex: it is plain markdown with `name` and `description` frontmatter, so copy the whole folder into either tool's skills directory.

Needs Node 22 or newer. Read only the tool's output. The last line is `RESULT: PASS` or `RESULT: FAIL`. Add `--json` for the same report as a JSON document (a `result` field of `pass` or `fail` replaces that line); the findings and the exit code are identical. `--pack` checks what `npm pack` would publish instead of the repository (it runs `npm pack --ignore-scripts` in a temp folder, never publishes, and deletes the temp folder); use it before `npm publish`, and build first if the published files are generated. `--print-hook` only prints a git pre-push hook for the user to save themselves: never write it into their repository for them.

## Hard rules about the private list

The private list holds the owner's personal and restricted terms (names, addresses, school, family, codewords). It lives outside every repo, by default at `~/.config/launch-guard/private-list.txt`.

- NEVER open, cat, grep, search or print the private list file, in any tool or any way, even to "check" it.
- Never ask the user to type or paste names, addresses, school, family or restricted terms into chat. Do not ask for values at all.
- If there is no private list, the report says checks were skipped. Run `node <this skill's directory>/launch-guard.mjs --init-list`, then tell the user to fill the file in with their own editor and rerun. Do not ask for any values.

Skill text is advice; a Claude Code permission rule is what enforces it. Recommend the owner add a permission rule that denies reads of the list's path (the README section "Stop your assistant reading the list" explains how). The tool never changes anyone's settings.

## Reading the report

Each finding shows a level, a category, a location (file and line), a fixed label and sometimes a list entry number. It never shows the matched text.

- `block` makes the result FAIL. `warn` should be looked at. `info` is a note (for example a skipped file or a missing private list). Only `block` fails the run.
- `RESULT: PASS` means no blocking findings. It is not a promise the repo is safe.

## What to do with findings

- `secret`, `personal` and `restricted`: give the user the location (file and line) and let them edit it. Do not open the flagged file, and do not repeat or guess the matched value.
- Other categories (basics, history, reachability): you may help fix. Read only the flagged line, never more of the file than needed.
- `history` and `reachability` findings labelled "recommend a fresh repository": recommend publishing from a fresh repository with no old history. Never claim that a history rewrite is enough.
- `nested repository not scanned` (an info): an untracked folder inside the repository is its own git repository. Suggest scanning it separately or keeping it out of the folder being published.
- `submodule not scanned` (an info): the repository has submodules, which are separate repositories. Suggest running the tool inside each one.
- `unreachable object` (a warn, one line with a count): staging, amend, rebase and stash leave these in git; they are local and not pushed. To clear them, run `git reflog expire --expire-unreachable=now --all` and then `git gc --prune=now` (`git gc` alone keeps commits the reflog still references, such as those left by an amend or rebase). It is a prompt to check, not proof of a leak.
- `remote not checked`: the hidden pull-request ref check may not run for private HTTPS remotes, because the tool never prompts for credentials. Suggest running it from a shell where git already has credentials, or, if the repo was ever pushed with sensitive content, treating it as needing a fresh repository.
- `not a repository root`: the folder is a plain folder or a subfolder of another repository, so history and old-commit checks were skipped. Rerun on the repository's top folder.
- Findings in test files are only lowered for secrets and profile paths; list matches (personal, restricted, paths) always stay block.
- Rerun the tool after the user's fixes and report the new RESULT line.
