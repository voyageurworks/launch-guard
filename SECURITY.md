# Security policy

## Reporting a vulnerability

Please report it privately, not in a public issue. Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. It is turned on for the project's repository, `https://github.com/voyageurworks/launch-guard-pack`.

Please do not put real secrets, personal details or the contents of your private list in a report. A description of the steps, or a made-up example that shows the same behaviour, is enough.

## Supported versions

Only the latest 0.x release is supported. Fixes go into a new release; older ones are not patched.

## What counts as a vulnerability

launch-guard's central promise is that it never prints private data: no part of a secret, no value from your private list, no author, email, commit message or branch name, and no path text taken from the private list. It never edits files in your repository, rewrites history or pushes. Its only network use is a read-only `git ls-remote` against your configured remotes (skipped with `--offline`), and the only file it writes is the template from `--init-list`.

Anything that breaks that promise is a security bug, even if it looks small. For example:

- the output shows a secret, or any part of one, or text taken from your private list;
- an error message, stack trace or log line shows a path or file content;
- the tool writes a file other than the `--init-list` template, changes a repository, or contacts a network other than the read-only `git ls-remote` against your configured remotes;
- a crafted file name or file content makes the report print something it should not.

Missed detections (a real secret the scanner did not flag) and false alarms are ordinary bugs; please report those as normal issues using made-up examples.
