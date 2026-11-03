#!/usr/bin/env node

// dist/cli.js
import { execFileSync as execFileSync5 } from "node:child_process";
import { existsSync as existsSync5, mkdirSync as mkdirSync4, readdirSync as readdirSync3, realpathSync as realpathSync3, statSync as statSync3, writeFileSync as writeFileSync3 } from "node:fs";
import { basename as basename2, dirname as dirname2, join as join10, resolve as resolve3 } from "node:path";

// dist/denylist.js
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
function defaultDenyListPath() {
  return join(homedir(), ".config", "launch-guard", "private-list.txt");
}
function loadDenyList(file) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    const missing = err?.code === "ENOENT";
    return { entries: [], problem: missing ? "private list not found" : "private list unreadable" };
  }
  const entries = [];
  const invalid = [];
  raw.replace(/^﻿/, "").normalize("NFC").split(/\r?\n/).forEach((line, i) => {
    const entry = i + 1;
    if (line.trim() === "" || line.startsWith("#"))
      return;
    const sep2 = line.indexOf("|");
    const kind = sep2 < 0 ? "" : line.slice(0, sep2).trim();
    const source = sep2 < 0 ? "" : line.slice(sep2 + 1);
    if (kind !== "personal" && kind !== "restricted" || source === "") {
      invalid.push(entry);
      return;
    }
    try {
      const pattern = new RegExp(source, "iu");
      if (pattern.test(""))
        invalid.push(entry);
      else
        entries.push({ kind, pattern, entry });
    } catch {
      invalid.push(entry);
    }
  });
  const problem = invalid.length ? invalid.map((n) => `entry ${n} invalid`).join("; ") : null;
  return { entries, problem };
}
var ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b./g;
var CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;
function cleanText(text) {
  return text.replace(ANSI, "").replace(CONTROL, "").normalize("NFC");
}
function stripHome(p) {
  const home = homedir().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!home)
    return p;
  const n = p.replace(/\\/g, "/");
  const same = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (n.length >= home.length && same(n.slice(0, home.length), home) && (n.length === home.length || n[home.length] === "/")) {
    return "~" + n.slice(home.length);
  }
  return n;
}
function displayPath(p, entries) {
  const text = stripHome(cleanText(p));
  const spans = [];
  for (const e of entries) {
    for (const m of text.matchAll(new RegExp(e.pattern.source, "giu"))) {
      if (m[0] !== "")
        spans.push([m.index, m.index + m[0].length]);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  let out = "";
  let at = 0;
  for (const [start, end] of spans) {
    if (end <= at)
      continue;
    out += text.slice(at, Math.max(start, at)) + "[redacted]";
    at = end;
  }
  return out + text.slice(at);
}

// dist/gitTimeouts.js
var GIT_QUICK_TIMEOUT_MS = 6e4;
var GIT_HEAVY_TIMEOUT_MS = 12e4;
var isTimeout = (err) => err?.code === "ETIMEDOUT";

// dist/files.js
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, lstatSync, openSync, readSync, readdirSync } from "node:fs";
import { basename, join as join2 } from "node:path";
var SKIP_DIRS = /* @__PURE__ */ new Set([".git", "node_modules", "dist"]);
var MAX_BYTES = 1024 * 1024;
var SNIFF_BYTES = 8192;
var ENV_FILE = /^\.env/i;
var ENV_TEMPLATES = /* @__PURE__ */ new Set([".env.example", ".env.sample", ".env.template"]);
function isEnvFile(path) {
  const name = basename(path).toLowerCase();
  return ENV_FILE.test(name) && !ENV_TEMPLATES.has(name);
}
function hasNul(file) {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(SNIFF_BYTES);
    const n = readSync(fd, buf, 0, SNIFF_BYTES, 0);
    return buf.subarray(0, n).includes(0);
  } finally {
    closeSync(fd);
  }
}
function gitPaths(root) {
  if (!existsSync(join2(root, ".git")))
    return null;
  try {
    const out = execFileSync("git", ["-c", "core.fsmonitor=false", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      timeout: GIT_QUICK_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"]
    });
    return [...new Set(out.split("\0").filter((p) => p !== ""))];
  } catch {
    return null;
  }
}
function listRepoFiles(root, neverOpen, options = {}) {
  const classify = (path) => {
    const full = join2(root, path);
    try {
      const st = lstatSync(full);
      if (st.isSymbolicLink())
        return { path, skipped: "symlink" };
      if (!st.isFile())
        return void 0;
      if (st.size > MAX_BYTES)
        return { path, skipped: "large" };
      if (neverOpen?.(path))
        return { path };
      return hasNul(full) ? { path, skipped: "binary" } : { path };
    } catch (err) {
      if (err?.code === "ENOENT")
        return void 0;
      return { path, skipped: "unreadable" };
    }
  };
  const listed = options.includeAll ? null : gitPaths(root);
  if (listed) {
    const out2 = [];
    for (const path of listed) {
      const f = classify(path);
      if (f)
        out2.push(f);
    }
    return out2;
  }
  const out = [];
  const walk = (rel) => {
    let entries;
    try {
      entries = readdirSync(join2(root, rel), { withFileTypes: true });
    } catch {
      if (rel)
        out.push({ path: rel, skipped: "unreadable" });
      return;
    }
    for (const entry of entries) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      let isDir = false;
      try {
        isDir = lstatSync(join2(root, path)).isDirectory();
      } catch {
      }
      if (isDir) {
        if (options.includeAll || !SKIP_DIRS.has(entry.name))
          walk(path);
        continue;
      }
      const f = classify(path);
      if (f)
        out.push(f);
    }
  };
  walk("");
  return out;
}

// dist/explain.js
var EXPLAIN = {
  "secret format": "A string shaped like a known key or token\nWhat to do: Remove it from the file, then treat the key as exposed and replace it at its provider",
  "secret near keyword": "A long random-looking value next to a word like key, token or password\nWhat to do: Check the line yourself; remove it, or mark it allowed if it is harmless (see below)",
  "personal detail": "A `personal` entry from your list matches in a file\nWhat to do: Edit the line yourself",
  "restricted term": "A `restricted` entry from your list matches in a file\nWhat to do: Edit the line yourself",
  "path matches list": "A file or folder name matches your list (shown as `[redacted]`)\nWhat to do: Rename it",
  "tracked env file": "A `.env` file is tracked by git (its contents are never read)\nWhat to do: Stop tracking it and keep it out of the repo; replace any secrets in it",
  "list inside repo": "Your private list is inside the folder being scanned\nWhat to do: Move it out of the repo",
  "secret in history": "A secret appears in an old version of a file\nWhat to do: See the note on history below",
  "term in history": "A list entry appears in an old commit, message, author or ref name\nWhat to do: See the note on history below",
  "history incomplete": "The tool could not look at part of the history\nWhat to do: Informational; the check for that part did not run",
  "no commits": "The tool could not look at part of the history\nWhat to do: Informational; the check for that part did not run",
  "recommend a fresh repository": "A rewrite leftover (`refs/original`) or a hidden pull-request ref on a remote would stay reachable\nWhat to do: Publish from a brand-new repository with no old history",
  "extra ref": "A branch, tag or stash beyond the current branch\nWhat to do: Check whether it should be public",
  "unreachable object": "Git still holds an object that no branch reaches. Staging, amending, rebasing and `git stash drop` all leave these until git cleans up. They are local and a push does not publish them\nWhat to do: A warn, not proof of a leak: check that nothing sensitive was in the file you changed. To clear them, run `git reflog expire --expire-unreachable=now --all`, then `git gc --prune=now` (`git gc --prune=now` alone only clears re-staged blobs and dropped stash entries, because the reflog still holds commits left by an amend or rebase)",
  "not a repository root": "The folder is not the top level of a git repository (a plain folder, or a subfolder of another repository), so the history and old-commit checks did not run\nWhat to do: Run the tool on the repository's top folder",
  "no remote": "The tool could not look at part of the history\nWhat to do: Informational; the check for that part did not run",
  "remote not checked": "The hidden pull-request ref check did not run: `--offline` was given, or git could not reach the remote without a prompt. The tool never asks for a password, so a private HTTPS remote that needs credentials will often land here\nWhat to do: Run the tool from a shell where git already has credentials for that remote (without `--offline`). If the repository was ever pushed with sensitive content, treat it as needing a fresh repository",
  "user profile path": "A file holds an absolute path into a user profile folder\nWhat to do: Replace it with a relative path or a placeholder",
  "missing LICENSE": "A basics file is absent\nWhat to do: Add one",
  "missing SECURITY": "A basics file is absent\nWhat to do: Add one",
  "missing CI": "A basics file is absent\nWhat to do: Add one",
  "funding file active": "A funding file is switched on\nWhat to do: Make sure that is what you want before going public",
  "checks skipped: no private list": "The personal and restricted checks had nothing to use\nWhat to do: Create and fill in your list",
  "private list has no entries": "The personal and restricted checks had nothing to use\nWhat to do: Create and fill in your list",
  "file skipped": "A file was too large, binary, a symlink or unreadable, so it was not read\nWhat to do: Look at it yourself if it matters",
  "more files skipped": "A file was too large, binary, a symlink or unreadable, so it was not read\nWhat to do: Look at it yourself if it matters",
  "submodule not scanned": "The repository has submodules (another repository each). Their files and history are not part of this scan\nWhat to do: Run the tool inside each submodule before you publish",
  "nested repository not scanned": "An untracked folder inside the repository is itself a git repository. Its files and history are not part of this scan, and a plain `git add` would not publish them\nWhat to do: Scan it on its own, or keep it out of the folder you publish",
  "agent folder in package": "`--pack`: the tarball would contain an assistant folder, a `settings.local.json`, a session file or an instruction file\nWhat to do: Keep it out with a `files` list in `package.json` or an `.npmignore`, then pack again",
  "agent file in package": "`--pack`: the tarball would contain an assistant folder, a `settings.local.json`, a session file or an instruction file\nWhat to do: Keep it out with a `files` list in `package.json` or an `.npmignore`, then pack again",
  "env file in package": "`--pack`: the tarball would contain an `.env*` file, an `.npmrc` or a `.git` folder (contents are never read)\nWhat to do: Exclude it as above; treat anything secret in it as exposed",
  ".npmrc in package": "`--pack`: the tarball would contain an `.env*` file, an `.npmrc` or a `.git` folder (contents are never read)\nWhat to do: Exclude it as above; treat anything secret in it as exposed",
  "git data in package": "`--pack`: the tarball would contain an `.env*` file, an `.npmrc` or a `.git` folder (contents are never read)\nWhat to do: Exclude it as above; treat anything secret in it as exposed",
  "private key file in package": "`--pack`: a key bundle or a `.pem`/`.key` file would ship\nWhat to do: Remove a private key and replace it; check that a certificate is meant to be public",
  "key or certificate file in package": "`--pack`: a key bundle or a `.pem`/`.key` file would ship\nWhat to do: Remove a private key and replace it; check that a certificate is meant to be public",
  "source map with sources": "`--pack`: a `.map` file would ship with your source text inside, or is not valid JSON\nWhat to do: Turn off `sourcesContent` or do not publish maps",
  "source map in package": "`--pack`: a `.map` file would ship with your source text inside, or is not valid JSON\nWhat to do: Turn off `sourcesContent` or do not publish maps",
  "no files list in package": "`--pack`: `package.json` has no `files` list and the source folder has no `.npmignore`\nWhat to do: Add a `files` list so only what you name ships",
  "install script in package": "`--pack`: an `install`, `preinstall` or `postinstall` script runs on every consumer's machine\nWhat to do: Check that you mean it",
  "unsafe path in package": "`--pack`: the tarball held a link (not created) or a name that could leave the folder (not written)\nWhat to do: Look at how the package is built",
  "link in package": "`--pack`: the tarball held a link (not created) or a name that could leave the folder (not written)\nWhat to do: Look at how the package is built",
  "packed without running scripts": "`--pack` notes: scripts did not run, git history is not in a package, and how many files and bytes would ship\nWhat to do: Informational",
  "package contents": "`--pack` notes: scripts did not run, git history is not in a package, and how many files and bytes would ship\nWhat to do: Informational",
  "history not part of a package": "`--pack` notes: scripts did not run, git history is not in a package, and how many files and bytes would ship\nWhat to do: Informational"
};
function explainLabel(label) {
  return Object.prototype.hasOwnProperty.call(EXPLAIN, label) ? EXPLAIN[label] : null;
}

// dist/pack/build.js
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync as existsSync2, lstatSync as lstatSync2, mkdirSync, mkdtempSync, readFileSync as readFileSync2, readdirSync as readdirSync2, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join3 } from "node:path";
var NPM_PACK_TIMEOUT_MS = 12e4;
var PACK_SCRIPTS = ["prepublish", "prepublishOnly", "prepack", "prepare", "postpack", "publish", "postpublish"];
var COPY_MAX_FILES = 5e4;
var COPY_MAX_BYTES = 256 * 1024 * 1024;
function readManifest(cwd) {
  try {
    const parsed = JSON.parse(readFileSync2(join3(cwd, "package.json"), "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function definesPackScripts(manifest) {
  const scripts = manifest.scripts;
  return typeof scripts === "object" && scripts !== null && PACK_SCRIPTS.some((k) => k in scripts);
}
function copySanitized(src, dst, manifest) {
  let files = 0;
  let bytes = 0;
  const walk = (rel) => {
    for (const entry of readdirSync2(join3(src, rel), { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules")
        continue;
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      const st = lstatSync2(join3(src, path));
      if (st.isSymbolicLink())
        continue;
      if (st.isDirectory()) {
        mkdirSync(join3(dst, path));
        if (!walk(path))
          return false;
      } else if (st.isFile()) {
        files++;
        bytes += st.size;
        if (files > COPY_MAX_FILES || bytes > COPY_MAX_BYTES)
          return false;
        copyFileSync(join3(src, path), join3(dst, path));
      }
    }
    return true;
  };
  if (!walk(""))
    return false;
  const scripts = { ...manifest.scripts };
  for (const key of PACK_SCRIPTS)
    delete scripts[key];
  writeFileSync(join3(dst, "package.json"), JSON.stringify({ ...manifest, scripts }, null, 2) + "\n");
  const modules = join3(src, "node_modules");
  if (existsSync2(modules)) {
    try {
      symlinkSync(realpathSync(modules), join3(dst, "node_modules"), "junction");
    } catch {
    }
  }
  return true;
}
function runNpmPack(cwd, destDir, timeoutMs = NPM_PACK_TIMEOUT_MS) {
  try {
    if (!statSync(cwd).isDirectory())
      return null;
    if (!statSync(join3(cwd, "package.json")).isFile())
      return null;
  } catch {
    return null;
  }
  const manifest = readManifest(cwd);
  if (manifest === null)
    return null;
  let copy = null;
  try {
    let packCwd = cwd;
    if (definesPackScripts(manifest)) {
      copy = mkdtempSync(join3(tmpdir(), "lg-packsrc-"));
      if (!copySanitized(cwd, copy, manifest))
        return null;
      packCwd = copy;
    }
    return spawnPack(packCwd, destDir, timeoutMs);
  } catch {
    return null;
  } finally {
    if (copy !== null)
      rmSync(copy, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
function spawnPack(cwd, destDir, timeoutMs) {
  const args = ["pack", "--ignore-scripts", "--pack-destination", destDir];
  const windows = process.platform === "win32";
  const command = windows ? process.env.ComSpec ?? "cmd.exe" : "npm";
  const argv = windows ? ["/d", "/s", "/c", "npm", ...args] : args;
  const result = spawnSync(command, argv, {
    cwd,
    timeout: timeoutMs,
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
    env: {
      ...process.env,
      npm_config_ignore_scripts: "true",
      npm_config_update_notifier: "false",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_logs_max: "0"
    }
  });
  if (result.error || result.status !== 0)
    return null;
  try {
    const tarballs = readdirSync2(destDir).filter((n) => n.endsWith(".tgz"));
    return tarballs.length === 1 ? join3(destDir, tarballs[0]) : null;
  } catch {
    return null;
  }
}

// dist/pack/run.js
import { lstatSync as lstatSync3, mkdirSync as mkdirSync3, mkdtempSync as mkdtempSync2, readFileSync as readFileSync5, rmSync as rmSync2 } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import { join as join7 } from "node:path";

// dist/scan/basics.js
import { execFileSync as execFileSync2 } from "node:child_process";
import { existsSync as existsSync3, readFileSync as readFileSync3 } from "node:fs";
import { join as join4 } from "node:path";

// dist/allow.js
var ALLOW = /launch-guard-allow:\s*\S/;
var FIXTURE_DIRS = /* @__PURE__ */ new Set(["test", "tests", "fixtures", "__tests__", "__fixtures__", "__mocks__", "testdata", "spec", "specs"]);
var TEST_FILE = /(?:\.(?:test|spec)\.[^.]+|_test\.[^.]+|^test_.+)$/;
var SENSITIVE_EXT = /* @__PURE__ */ new Set(["pem", "key", "p12", "pfx", "env", "crt", "cer", "jks", "keystore", "asc", "gpg", "ppk", "kdbx"]);
var COMMENT_ONLY = /^\s*(\/\/|#|\/\*|<!--|\*)/;
function isAllowed(line, previousLine) {
  return ALLOW.test(line) || COMMENT_ONLY.test(previousLine) && ALLOW.test(previousLine);
}
function downgrade(file, severity) {
  if (severity !== "block")
    return severity;
  const parts = file.toLowerCase().split(/[\\/]+/);
  const name = parts[parts.length - 1] ?? "";
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  if (name.startsWith(".env") || SENSITIVE_EXT.has(ext))
    return severity;
  const isTestFile = TEST_FILE.test(name);
  const inFixtureDir = parts.slice(0, -1).some((p) => FIXTURE_DIRS.has(p));
  const inExamples = parts.some((p, i) => p === "docs" && parts[i + 1] === "examples");
  return inFixtureDir || inExamples || isTestFile ? "warn" : severity;
}

// dist/scan/basics.js
var AI_NAMES = /* @__PURE__ */ new Set(["claude.md", "agents.md", "gemini.md", ".cursorrules"]);
var AI_DIRS = /* @__PURE__ */ new Set([".claude", ".codex", ".cursor", ".windsurf"]);
function isAiFile(path) {
  const parts = path.toLowerCase().split("/");
  const name = parts[parts.length - 1];
  const dirs = parts.slice(0, -1);
  if (AI_NAMES.has(name))
    return true;
  if (path.toLowerCase() === ".github/copilot-instructions.md")
    return true;
  if (dirs.some((d) => AI_DIRS.has(d) || d === "memory"))
    return true;
  return /(?:session|transcript)/.test(name) && /\.(?:md|json|jsonl)$/.test(name);
}
var WIN_PROFILE = /(?<![A-Za-z0-9_])[a-z]:[\\/]+users[\\/]+(?:(all users)(?!\w)|([^\\/\s"'`<>()[\],;]+))/gi;
var POSIX_PROFILE = /(?<=^|[\s"'`(\[=,<])(?:\/Users\/|\/home\/)([^\\/\s"'`<>()[\],;]+)/g;
var PLACEHOLDERS = new Set([
  "%username%",
  "$user",
  "${user}",
  "~",
  "username",
  "user",
  "you",
  "yourname",
  "your-name",
  "example",
  "me",
  "public",
  "default",
  "all users",
  "runner",
  "vscode",
  "node"
].map((s) => s.toLowerCase()));
function hasProfilePath(line) {
  const names = [];
  for (const m of line.matchAll(WIN_PROFILE))
    if (!m[1])
      names.push(m[2]);
  for (const m of line.matchAll(POSIX_PROFILE))
    names.push(m[1]);
  return names.some((n) => {
    const raw = n.toLowerCase();
    const trimmed = raw.replace(/[.:]+$/, "");
    return trimmed !== "" && !PLACEHOLDERS.has(raw) && !PLACEHOLDERS.has(trimmed);
  });
}
function hasNestedRepo(root) {
  try {
    const untracked = execFileSync2("git", ["-c", "core.fsmonitor=false", "ls-files", "-z", "--others", "--exclude-standard"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      timeout: GIT_QUICK_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"]
    });
    return untracked.split("\0").some((p) => p.endsWith("/") && existsSync3(join4(root, p, ".git")));
  } catch {
    return false;
  }
}
function hasGitlink(root) {
  try {
    const index = execFileSync2("git", ["-c", "core.fsmonitor=false", "ls-files", "-s"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: GIT_QUICK_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"]
    });
    return index.split(/\r?\n/).some((l) => l.startsWith("160000 "));
  } catch {
    return false;
  }
}
function scanBasics(root, entries = [], listing) {
  const files = listing ?? listRepoFiles(root, isEnvFile);
  const findings = scanAiFiles(root, entries, files);
  const lower = new Set(files.map((f) => f.path.toLowerCase()));
  return findings.concat(scanRepoBasics(root, files, lower));
}
function scanAiFiles(root, entries, files) {
  const findings = [];
  for (const f of files) {
    if (f.skipped || isEnvFile(f.path) || !isAiFile(f.path))
      continue;
    let text;
    try {
      text = readFileSync3(join4(root, f.path), "utf8");
    } catch {
      continue;
    }
    const shown = displayPath(f.path, entries);
    const lines2 = text.split(/\r?\n/);
    lines2.forEach((line, i) => {
      const previous = i > 0 ? lines2[i - 1] : "";
      if (isAllowed(line, previous) || !hasProfilePath(line))
        return;
      findings.push({
        category: "basics",
        severity: downgrade(f.path, "block"),
        file: shown,
        line: i + 1,
        label: "user profile path",
        entry: null
      });
    });
  }
  return findings;
}
function scanRepoBasics(root, files, lower) {
  const findings = [];
  if (lower.has(".gitmodules") || hasGitlink(root)) {
    findings.push({ category: "basics", severity: "info", file: "submodules", line: null, label: "submodule not scanned", entry: null });
  }
  if (hasNestedRepo(root)) {
    findings.push({ category: "basics", severity: "info", file: "nested repositories", line: null, label: "nested repository not scanned", entry: null });
  }
  const warn = (file, label) => {
    findings.push({ category: "basics", severity: "warn", file, line: null, label, entry: null });
  };
  const licenseNames = ["license", "license.md", "license.txt", "copying", "copying.md"];
  if (!licenseNames.some((n) => lower.has(n)))
    warn("LICENSE", "missing LICENSE");
  if (!["security.md", ".github/security.md", "docs/security.md"].some((n) => lower.has(n)))
    warn("SECURITY", "missing SECURITY");
  if (![...lower].some((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)))
    warn("CI", "missing CI");
  const funding = files.find((f) => !f.skipped && /^\.github\/funding\.ya?ml$/i.test(f.path));
  if (funding) {
    try {
      const lines2 = readFileSync3(join4(root, funding.path), "utf8").split(/\r?\n/);
      const first = lines2.findIndex((l) => l.trim() !== "" && !l.trim().startsWith("#"));
      if (first >= 0) {
        findings.push({
          category: "basics",
          severity: "warn",
          file: ".github/FUNDING.yml",
          line: first + 1,
          label: "funding file active",
          entry: null
        });
      }
    } catch {
    }
  }
  return findings;
}

// dist/scan/pack.js
import { existsSync as existsSync4, readFileSync as readFileSync4, statSync as statSync2 } from "node:fs";
import { join as join5 } from "node:path";
var AGENT_DIRS = /* @__PURE__ */ new Set([".claude", ".codex", ".cursor", ".gemini", ".windsurf"]);
var SSH_KEY = /^id_(?:rsa|dsa|ecdsa|ed25519)$/;
var MAX_MAP_BYTES = 64 * 1024 * 1024;
var MAX_KEY_BYTES = 1024 * 1024;
function make(severity, file, label) {
  return { category: "package", severity, file, line: null, label, entry: null };
}
function isSessionFile(name) {
  return /(?:session|transcript)/.test(name) && /\.(?:md|json|jsonl)$/.test(name);
}
function holdsPrivateKey(full) {
  try {
    if (statSync2(full).size > MAX_KEY_BYTES)
      return false;
    return readFileSync4(full, "utf8").includes("PRIVATE KEY");
  } catch {
    return false;
  }
}
function mapEmbedsSources(full) {
  try {
    if (statSync2(full).size > MAX_MAP_BYTES)
      return null;
    const parsed = JSON.parse(readFileSync4(full, "utf8"));
    if (typeof parsed !== "object" || parsed === null)
      return null;
    const content = parsed.sourcesContent;
    return Array.isArray(content) && content.some((c) => typeof c === "string" && c !== "");
  } catch {
    return null;
  }
}
function scanPackageFiles(root, files) {
  const findings = [];
  for (const f of files) {
    const path = f.path;
    const parts = path.toLowerCase().split("/");
    const name = parts[parts.length - 1];
    const dirs = parts.slice(0, -1);
    const bundled = dirs.includes("node_modules");
    const full = join5(root, path);
    if (dirs.some((d) => AGENT_DIRS.has(d)) || name === "settings.local.json") {
      findings.push(make("block", path, "agent folder in package"));
    } else if (!bundled && isSessionFile(name)) {
      findings.push(make("block", path, "agent file in package"));
    } else if (!bundled && isAiFile(path)) {
      findings.push(make("warn", path, "agent file in package"));
    }
    if (isEnvFile(path))
      findings.push(make("block", path, "env file in package"));
    if (name === ".npmrc")
      findings.push(make("block", path, ".npmrc in package"));
    if (dirs.includes(".git") || name === ".git")
      findings.push(make("block", path, "git data in package"));
    if (SSH_KEY.test(name) || name.endsWith(".p12") || name.endsWith(".pfx")) {
      findings.push(make("block", path, "private key file in package"));
    } else if (name.endsWith(".pem") || name.endsWith(".key")) {
      findings.push(holdsPrivateKey(full) ? make("block", path, "private key file in package") : make("warn", path, "key or certificate file in package"));
    }
    if (name.endsWith(".map")) {
      const embeds = mapEmbedsSources(full);
      if (embeds === null)
        findings.push(make("warn", path, "source map in package"));
      else if (embeds)
        findings.push(make("warn", path, "source map with sources"));
    }
  }
  return findings;
}
function scanPackageManifest(root, sourceRoot) {
  let manifest;
  try {
    const parsed = JSON.parse(readFileSync4(join5(root, "package.json"), "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return [];
    manifest = parsed;
  } catch {
    return [];
  }
  const findings = [];
  if (!Array.isArray(manifest.files) && !existsSync4(join5(sourceRoot, ".npmignore"))) {
    findings.push(make("warn", "package.json", "no files list in package"));
  }
  const scripts = manifest.scripts;
  if (typeof scripts === "object" && scripts !== null) {
    const s = scripts;
    if (["install", "preinstall", "postinstall"].some((k) => typeof s[k] === "string")) {
      findings.push(make("warn", "package.json", "install script in package"));
    }
  }
  return findings;
}

// dist/skipped.js
var MAX_SKIPPED_NOTES = 25;
function skippedNotes(files, entries) {
  const skipped = files.filter((f) => f.skipped !== void 0);
  const notes = skipped.slice(0, MAX_SKIPPED_NOTES).map((f) => ({
    category: "basics",
    severity: "info",
    file: displayPath(f.path, entries),
    line: null,
    label: "file skipped",
    entry: null
  }));
  if (skipped.length > MAX_SKIPPED_NOTES) {
    notes.push({ category: "basics", severity: "info", file: "files", line: null, label: "more files skipped", entry: null });
  }
  return notes;
}

// dist/pack/tar.js
import { mkdirSync as mkdirSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname, join as join6, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
var TarError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "TarError";
  }
};
var DEFAULT_TAR_LIMITS = { maxTotalBytes: 256 * 1024 * 1024, maxFiles: 5e4 };
var BLOCK = 512;
var WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
var BAD_CHARS = /[\u0000-\u001f\\]/;
var WINDOWS_BAD_CHARS = /[<>:"|?*]/;
function readString(buf, start, len) {
  const slice = buf.subarray(start, start + len);
  const nul = slice.indexOf(0);
  return (nul === -1 ? slice : slice.subarray(0, nul)).toString("utf8");
}
function readOctal(buf, start, len) {
  if ((buf[start] & 128) !== 0)
    throw new TarError("unsupported size encoding");
  const text = readString(buf, start, len).trim();
  if (text === "")
    return 0;
  if (!/^[0-7]+$/.test(text))
    throw new TarError("bad number in header");
  return parseInt(text, 8);
}
function checksumOk(header) {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++)
    sum += i >= 148 && i < 156 ? 32 : header[i];
  let stored;
  try {
    stored = readOctal(header, 148, 8);
  } catch {
    return false;
  }
  return stored === sum;
}
function parsePax(data) {
  const out = /* @__PURE__ */ new Map();
  let pos = 0;
  while (pos < data.length) {
    const space = data.indexOf(32, pos);
    if (space === -1)
      throw new TarError("bad pax record");
    const len = Number(data.subarray(pos, space).toString("ascii"));
    if (!Number.isInteger(len) || len <= space - pos + 1 || pos + len > data.length)
      throw new TarError("bad pax record");
    const record = data.subarray(space + 1, pos + len - 1).toString("utf8");
    const eq = record.indexOf("=");
    if (eq > 0)
      out.set(record.slice(0, eq), record.slice(eq + 1));
    pos += len;
  }
  return out;
}
function safeName(raw, windowsNames) {
  if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw))
    return null;
  const segments = [];
  for (const s of raw.split("/")) {
    if (s === "" || s === ".")
      continue;
    if (s === "..")
      return null;
    if (BAD_CHARS.test(s))
      return null;
    segments.push(s);
  }
  segments.shift();
  if (windowsNames) {
    for (const s of segments) {
      if (WINDOWS_BAD_CHARS.test(s) || WINDOWS_RESERVED.test(s.split(".")[0]) || /[. ]$/.test(s))
        return null;
    }
  }
  return segments.join("/");
}
function extractTarball(tgz, dest, options = {}) {
  const { maxTotalBytes, maxFiles, windowsNames } = { ...DEFAULT_TAR_LIMITS, windowsNames: process.platform === "win32", ...options };
  let tar;
  try {
    tar = gunzipSync(tgz, { maxOutputLength: maxTotalBytes + (maxFiles + 16) * 2048 });
  } catch {
    throw new TarError("not a readable gzip archive");
  }
  const root = resolve(dest);
  const files = /* @__PURE__ */ new Set();
  const links = /* @__PURE__ */ new Set();
  let unsafe = 0;
  let total = 0;
  let count = 0;
  let pending = {};
  let pos = 0;
  while (pos < tar.length) {
    if (tar.length - pos < BLOCK)
      throw new TarError("truncated archive");
    const header = tar.subarray(pos, pos + BLOCK);
    if (header.every((b) => b === 0))
      break;
    if (!checksumOk(header))
      throw new TarError("bad header checksum");
    pos += BLOCK;
    const type = String.fromCharCode(header[156]);
    let size = readOctal(header, 124, 12);
    if (pending.size !== void 0 && type !== "x" && type !== "g" && type !== "L" && type !== "K")
      size = pending.size;
    if (pos + size > tar.length)
      throw new TarError("truncated archive");
    const body = tar.subarray(pos, pos + size);
    pos += Math.ceil(size / BLOCK) * BLOCK;
    if (type === "x") {
      const pax = parsePax(body);
      const sizeText = pax.get("size");
      pending = { path: pax.get("path"), linkpath: pax.get("linkpath"), size: sizeText === void 0 ? void 0 : Number(sizeText) };
      if (pending.size !== void 0 && (!Number.isInteger(pending.size) || pending.size < 0))
        throw new TarError("bad pax size");
      continue;
    }
    if (type === "g")
      continue;
    if (type === "L") {
      pending.path = readString(body, 0, body.length);
      continue;
    }
    if (type === "K") {
      pending.linkpath = readString(body, 0, body.length);
      continue;
    }
    let name = pending.path;
    if (name === void 0) {
      name = readString(header, 0, 100);
      const prefix = readString(header, 345, 155);
      if (prefix !== "" && readString(header, 257, 5) === "ustar")
        name = `${prefix}/${name}`;
    }
    pending = {};
    const clean = safeName(name, windowsNames);
    if (clean === null) {
      unsafe++;
      continue;
    }
    if (type === "5")
      continue;
    if (clean === "")
      continue;
    const isFile = type === "0" || type === "\0" || type === "7";
    if (++count > maxFiles)
      throw new TarError("too many files");
    if (!isFile) {
      links.add(clean);
      continue;
    }
    total += size;
    if (total > maxTotalBytes)
      throw new TarError("archive is too large");
    const target = join6(root, ...clean.split("/"));
    if (!target.startsWith(root + sep)) {
      unsafe++;
      continue;
    }
    try {
      mkdirSync2(dirname(target), { recursive: true });
      writeFileSync2(target, body);
    } catch {
      unsafe++;
      continue;
    }
    files.add(clean);
  }
  return { files: [...files], links: [...links], unsafe };
}

// dist/pack/run.js
function note(severity, file, label) {
  return { category: "package", severity, file, line: null, label, entry: null };
}
function formatSize(bytes) {
  if (bytes < 1024)
    return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
function scanPackage(sourceRoot, entries, deps) {
  const work = mkdtempSync2(join7(tmpdir2(), "lg-pack-"));
  try {
    const tgzDir = join7(work, "tgz");
    const pkgDir = join7(work, "pkg");
    mkdirSync3(tgzDir);
    mkdirSync3(pkgDir);
    const tgzPath = deps.pack(sourceRoot, tgzDir);
    if (tgzPath === null)
      return { ok: false, reason: "build" };
    let extracted;
    try {
      extracted = extractTarball(readFileSync5(tgzPath), pkgDir);
    } catch (err) {
      if (err instanceof TarError)
        return { ok: false, reason: "read" };
      throw err;
    }
    const files = listRepoFiles(pkgDir, isEnvFile, { includeAll: true });
    const found = [
      ...deps.secrets(pkgDir, entries, files),
      ...entries.length > 0 ? deps.terms(pkgDir, entries, void 0, files) : [],
      ...scanPackageFiles(pkgDir, files),
      ...scanPackageManifest(pkgDir, sourceRoot),
      ...scanAiFiles(pkgDir, entries, files)
    ].map((f) => f.category === "package" ? { ...f, file: displayPath(f.file, entries) } : f);
    for (const link of extracted.links)
      found.push(note("info", displayPath(link, entries), "link in package"));
    if (extracted.unsafe > 0)
      found.push(note("warn", "package", "unsafe path in package"));
    found.push(...skippedNotes(files, entries));
    let bytes = 0;
    for (const f of extracted.files) {
      try {
        bytes += lstatSync3(join7(pkgDir, ...f.split("/"))).size;
      } catch {
      }
    }
    found.push(note("info", "npm pack", "packed without running scripts"));
    found.push(note("info", "history", "history not part of a package"));
    found.push(note("info", `${extracted.files.length} files, ${formatSize(bytes)} unpacked`, "package contents"));
    return { ok: true, findings: found };
  } finally {
    rmSync2(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

// dist/report.js
var ORDER = ["block", "warn", "info"];
function exitCode(findings, failOn = "block") {
  return findings.some((f) => f.severity === "block" || failOn === "warn" && f.severity === "warn") ? 1 : 0;
}
function renderLine(f) {
  const where = f.line === null ? f.file : `${f.file}:${f.line}`;
  const entry = f.entry === null ? "" : ` (list entry ${f.entry})`;
  return `  ${where} ${f.label}${entry}`;
}
function renderJson(findings, failOn = "block") {
  const counts = { block: 0, warn: 0, info: 0 };
  for (const f of findings)
    counts[f.severity]++;
  const picked = ORDER.flatMap((severity) => findings.filter((f) => f.severity === severity)).map((f) => ({
    category: f.category,
    severity: f.severity,
    file: f.file,
    line: f.line,
    label: f.label,
    entry: f.entry
  }));
  const report = { version: 1, result: exitCode(findings, failOn) === 1 ? "fail" : "pass", counts, findings: picked };
  return `${JSON.stringify(report, null, 2)}
`;
}
function renderReport(findings) {
  if (findings.length === 0)
    return "No findings.\n";
  const out = [];
  for (const severity of ORDER) {
    const group = findings.filter((f) => f.severity === severity);
    if (group.length === 0)
      continue;
    out.push(`${severity.toUpperCase()} (${group.length})`, ...group.map(renderLine), "");
  }
  return out.join("\n");
}

// dist/scan/history.js
import { execFileSync as execFileSync3 } from "node:child_process";
import { randomBytes } from "node:crypto";

// dist/scan/secrets.js
import { readFileSync as readFileSync6 } from "node:fs";
import { join as join8 } from "node:path";
var ENTROPY_THRESHOLD = 3.5;
var MIN_VALUE_LENGTH = 20;
var KNOWN_FORMATS = [
  /\bAKIA[0-9A-Z]{16}\b/,
  // AWS access key id
  /\b(?:gh[pos]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/,
  // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  // Slack tokens
  /\bsk_live_[A-Za-z0-9]{10,}/,
  // Stripe live keys
  /\bAIza[0-9A-Za-z_-]{35}/,
  // Google API keys
  /\bnpm_[A-Za-z0-9]{36}\b/,
  // npm tokens
  /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/,
  // private key blocks
  /-{5}BEGIN PGP PRIVATE KEY BLOCK-{5}/,
  // PGP private key blocks (written with a quantifier so this file does not match its own rule)
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/,
  // JWT-shaped strings (the lookbehind keeps a run of "eyJ-" from backtracking quadratically)
  /(?<![A-Za-z0-9_])sk-ant-[A-Za-z0-9_-]{20,}/,
  // Anthropic keys
  /(?<![A-Za-z0-9_])sk-proj-[A-Za-z0-9_-]{20,}/,
  // OpenAI project keys
  /(?<![A-Za-z0-9_])sk-(?=[A-Za-z]*\d)[A-Za-z0-9]{32,}/,
  // OpenAI legacy keys (must hold a digit)
  /\bhf_[A-Za-z0-9]{30,}/,
  // Hugging Face tokens
  /\bglpat-[A-Za-z0-9_-]{20,}/,
  // GitLab personal access tokens
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/,
  // SendGrid keys
  /\brk_live_[A-Za-z0-9]{16,}/,
  // Stripe restricted keys
  /\bwhsec_[A-Za-z0-9]{20,}/,
  // Stripe webhook signing secrets
  /hooks\.slack\.com\/services\/T[A-Z0-9]{6,}\/B[A-Z0-9]{6,}\/[A-Za-z0-9]{20,}/,
  // Slack incoming-webhook URLs
  /\bSK[0-9a-f]{32}\b/,
  // Twilio API key secrets
  /\bkey-[0-9a-f]{32}\b/,
  // Mailgun keys
  /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/,
  // Telegram bot tokens
  /\b[MN][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,38}\b/,
  // Discord bot tokens
  /\bya29\.[A-Za-z0-9_-]{20,}/,
  // Google OAuth access tokens
  /\bdop_v1_[a-f0-9]{64}\b/,
  // DigitalOcean tokens
  /\bshp(?:at|ca|pa|ss)_[a-f0-9]{32}\b/,
  // Shopify tokens
  /\bAccountKey=[A-Za-z0-9+/]{40,}={0,2}/,
  // Azure storage connection strings
  /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/,
  // PyPI upload tokens
  /\bdckr_pat_[A-Za-z0-9_-]{20,}/,
  // Docker personal access tokens
  /\bdapi[a-f0-9]{32}\b/,
  // Databricks personal access tokens
  /\blin_api_[A-Za-z0-9]{40}\b/,
  // Linear API keys
  /\bglsa_[A-Za-z0-9]{32}_[a-f0-9]{8}\b/,
  // Grafana service account tokens
  /\bPMAK-[a-f0-9]{24}-[a-f0-9]{34}\b/,
  // Postman API keys
  /\boy2[a-z2-7]{43}\b/
  // NuGet API keys
];
var CREDENTIAL_PLACEHOLDERS = /* @__PURE__ */ new Set(["password", "passwd", "pass", "secret", "token", "changeme", "example", "your-token-here", "redacted"]);
var TEMPLATE_VALUE = /^(?:\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\{[^{}]*\}|<[^<>]*>|%[^%]+%|\*+|x{3,})$/i;
function isTemplateOrPlaceholder(value) {
  const v = value.trim();
  return v === "" || TEMPLATE_VALUE.test(v) || PLACEHOLDER.test(v) || CREDENTIAL_PLACEHOLDERS.has(v.toLowerCase());
}
var NPMRC_CREDENTIAL = /(?<![A-Za-z0-9])_(?:authToken|auth|password)\s{0,10}=\s{0,10}["']?([^\s"']+)/gi;
var NPMRC_MIN_VALUE = 8;
var DOCKER_AUTH = /"auth"\s{0,10}:\s{0,10}"([A-Za-z0-9+/]{12,}={0,2})"/g;
var CONNECTION_CONTEXT = /\b(?:server|data source|host|hostname|addr|address|initial catalog|database|databasename)\s{0,5}=/i;
var CONNECTION_PASSWORD = /\b(?:password|pwd)\s{0,5}=\s{0,5}([^;"'\s]{6,})/gi;
function hasCredentialConfig(line) {
  for (const m of line.matchAll(NPMRC_CREDENTIAL)) {
    if (m[1].length >= NPMRC_MIN_VALUE && !isTemplateOrPlaceholder(m[1]))
      return true;
  }
  for (const m of line.matchAll(DOCKER_AUTH)) {
    const decoded = Buffer.from(m[1], "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon <= 0 || /[\u0000-\u0008\u000e-\u001f]/.test(decoded))
      continue;
    const password = decoded.slice(colon + 1);
    if (password.length >= 4 && !isTemplateOrPlaceholder(password))
      return true;
  }
  if (CONNECTION_CONTEXT.test(line)) {
    for (const m of line.matchAll(CONNECTION_PASSWORD))
      if (!isTemplateOrPlaceholder(m[1]))
        return true;
  }
  return false;
}
var AUTH_HEADER = /\b(?:bearer|basic)\s+([A-Za-z0-9._~+/=-]{24,})/gi;
var RFC_BASIC_SAMPLE = "QWxhZGRpbjpvcGVuIHNlc2FtZQ==";
var URL_CREDENTIALS = /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:\/\/([^\s:/@]+):([^\s@/]{4,})@/g;
var URL_PLACEHOLDER_WORDS = /* @__PURE__ */ new Set([
  "password",
  "pass",
  "passwd",
  "pwd",
  "user",
  "username",
  "secret",
  "token",
  "example",
  "sample",
  "demo",
  "test",
  "testing",
  "foobar",
  "hunter2",
  "mypassword",
  "mysecret",
  "mytoken",
  "abc123",
  "password1",
  "letmein",
  "qwerty",
  "changeme",
  "redacted",
  "hidden",
  "masked",
  "dummy"
]);
var URL_MIN_PASSWORD = 12;
var URL_MIN_ENTROPY = 3;
var ENV_REFERENCE = /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/;
var KEYWORDS = "key|token|password|secret|passwd|credential|passphrase|(?<![A-Za-z])pwd";
var AFTER_KEYWORD = "[\\w.-]{0,40}";
var GAP = "\\s{0,200}";
var NEAR_KEYWORD = new RegExp(`(?:${KEYWORDS})${AFTER_KEYWORD}["']?${GAP}[:=]${GAP}["']?([A-Za-z0-9+/_.=-]{${MIN_VALUE_LENGTH},})`, "gi");
var PLACEHOLDER = /x{4,}|0{4,}|changeme|your[-_ ]?(?:key|token|secret|password)|example|dummy|process\.env|\$\{|<[^<>]*>/i;
function entropy(s) {
  const counts = /* @__PURE__ */ new Map();
  for (const ch of s)
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}
function hasUrlCredentials(line) {
  for (const m of line.matchAll(URL_CREDENTIALS)) {
    const original = m[2];
    const password = original.toLowerCase();
    if (original.length < URL_MIN_PASSWORD || ENV_REFERENCE.test(original))
      continue;
    if (password === m[1].toLowerCase() || /^(.)\1*$/.test(password) || /^[*.#_-]+$/.test(password))
      continue;
    if (URL_PLACEHOLDER_WORDS.has(password) || password.split(/[^a-z0-9]+/).some((w) => URL_PLACEHOLDER_WORDS.has(w)))
      continue;
    if (PLACEHOLDER.test(password) || entropy(original) < URL_MIN_ENTROPY)
      continue;
    return true;
  }
  return false;
}
var NEAR_KEYWORD_QUOTED = new RegExp(`(?:${KEYWORDS})${AFTER_KEYWORD}["']?${GAP}[:=]${GAP}["']([^"'\\s]{${MIN_VALUE_LENGTH},})["']`, "gi");
function looksLikeSecretValue(value) {
  if (!value || PLACEHOLDER.test(value))
    return false;
  if (value.endsWith("...") || value === RFC_BASIC_SAMPLE)
    return false;
  if (!/\d/.test(value) || !/[A-Za-z]/.test(value))
    return false;
  return entropy(value) > ENTROPY_THRESHOLD;
}
function keywordValueIsSecret(text) {
  for (const re of [NEAR_KEYWORD, NEAR_KEYWORD_QUOTED, AUTH_HEADER]) {
    for (const m of text.matchAll(re))
      if (looksLikeSecretValue(m[1]))
        return true;
  }
  return false;
}
function classifyLine(line) {
  if (KNOWN_FORMATS.some((re) => re.test(line)) || hasUrlCredentials(line) || hasCredentialConfig(line))
    return "secret format";
  return keywordValueIsSecret(line) ? "secret near keyword" : null;
}
var KEY_WITHOUT_VALUE = new RegExp(`(?:${KEYWORDS})${AFTER_KEYWORD}["']?${GAP}[:=]${GAP}(?:[>|][+-]?|\\\\|["'])?$`, "i");
var KEYWORD_ASSIGNMENT = new RegExp(`(?:${KEYWORDS})${AFTER_KEYWORD}["']?${GAP}[:=]`, "i");
var FILLER = /^(?:[>|][+-]?|\\|["']|\+|,)?$/;
var isFiller = (line) => {
  const t = line.trim();
  return FILLER.test(t) || t.startsWith("#") || t.startsWith("//");
};
var VALUE_INDICATOR = /(?:[>|][+-]?|\\|["'])$/;
var WRAP_END = /(["']?)(\s{0,20})(\+|\\)$/;
function isValueTokenLine(line) {
  let t = line.trim();
  for (const marker of [" #", " //"]) {
    const at = t.indexOf(marker);
    if (at >= 0)
      t = t.slice(0, at).trimEnd();
  }
  if (/[,;+\\]$/.test(t))
    t = t.slice(0, -1).trimEnd();
  if (t.startsWith("+"))
    t = t.slice(1).trimStart();
  const quoted = /^["']/.test(t);
  if (quoted)
    t = t.slice(1);
  if (/["']$/.test(t))
    t = t.slice(0, -1);
  if (t === "" || /[\s"']/.test(t) || t.endsWith(":"))
    return false;
  return quoted || !/=[^=]/.test(t);
}
var MAX_STATEMENT_LINES = 4;
var StatementTracker = class {
  pending = "";
  lines = 0;
  /** The last complete keyword assignment, kept so a following line that starts with `+` can extend it (Java style). */
  last = "";
  lastLines = 0;
  classify(line) {
    let label = classifyLine(line);
    if (this.pending === "" && this.last !== "" && line.trim().startsWith("+") && isValueTokenLine(line) && this.lastLines < MAX_STATEMENT_LINES) {
      const joined = this.last.replace(/["'];?\s*$/, "") + line.trim().replace(/^\+\s*/, "").replace(/^["']/, "");
      if (!label && keywordValueIsSecret(joined))
        label = "secret near keyword";
      this.last = joined;
      this.lastLines++;
      return label;
    }
    if (this.pending !== "" && !isFiller(line) && isValueTokenLine(line)) {
      if (!label && keywordValueIsSecret(this.join(line)))
        label = "secret near keyword";
    }
    this.advance(line);
    return label;
  }
  join(line) {
    const above = this.pending.trimEnd();
    const next = line.trim().replace(/^\+\s*/, "");
    const wrap = WRAP_END.exec(above);
    if (wrap) {
      const gap = wrap[3] === "\\" && wrap[2] !== "" ? " " : "";
      return above.slice(0, wrap.index).trimEnd() + gap + next.replace(/^["']/, "");
    }
    return `${above.replace(VALUE_INDICATOR, "").trimEnd()} ${next}`;
  }
  advance(line) {
    if (isFiller(line)) {
      if (this.pending !== "" && ++this.lines >= MAX_STATEMENT_LINES) {
        this.pending = "";
        this.lines = 0;
      }
      return;
    }
    const text = this.pending !== "" && isValueTokenLine(line) ? this.join(line) : line;
    const open = KEY_WITHOUT_VALUE.test(text.trimEnd()) || WRAP_END.test(text.trimEnd()) && KEYWORD_ASSIGNMENT.test(text);
    this.last = !open && KEYWORD_ASSIGNMENT.test(text) ? text : "";
    this.lastLines = 1;
    if (open && this.lines + 1 < MAX_STATEMENT_LINES) {
      this.pending = text;
      this.lines++;
    } else {
      this.pending = "";
      this.lines = 0;
    }
  }
};
function scanSecrets(root, entries = [], listing) {
  const findings = [];
  for (const f of listing ?? listRepoFiles(root, isEnvFile)) {
    const shown = displayPath(f.path, entries);
    if (isEnvFile(f.path)) {
      findings.push({
        category: "secret",
        severity: downgrade(f.path, "block"),
        file: shown,
        line: null,
        label: "tracked env file",
        entry: null
      });
      continue;
    }
    if (f.skipped)
      continue;
    let text;
    try {
      text = readFileSync6(join8(root, f.path), "utf8");
    } catch {
      continue;
    }
    const lines2 = text.split(/\r?\n/);
    const tracker = new StatementTracker();
    lines2.forEach((line, i) => {
      const previous = i > 0 ? lines2[i - 1] : "";
      const label = tracker.classify(line);
      if (isAllowed(line, previous) || !label)
        return;
      findings.push({
        category: "secret",
        severity: downgrade(f.path, "block"),
        file: shown,
        line: i + 1,
        label,
        entry: null
      });
    });
  }
  return findings;
}

// dist/scan/terms.js
import { readFileSync as readFileSync7, realpathSync as realpathSync2 } from "node:fs";
import { isAbsolute, join as join9, relative, resolve as resolve2 } from "node:path";
function real(p) {
  try {
    return realpathSync2(p);
  } catch {
    return resolve2(p);
  }
}
function insideRepo(root, file) {
  let rel = relative(real(root), real(file));
  if (process.platform === "win32" && /^[a-z]:/i.test(rel))
    return null;
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel))
    return null;
  rel = rel.replace(/\\/g, "/");
  return rel;
}
function matchingEntries(text, entries) {
  const t = text.normalize("NFC");
  return entries.filter((e) => e.pattern.test(t));
}
function scanTerms(root, entries, listFile, listing) {
  const findings = [];
  const listRel = listFile ? insideRepo(root, listFile) : null;
  if (listRel !== null) {
    findings.push({
      category: "basics",
      severity: "block",
      file: displayPath(listRel, entries),
      line: null,
      label: "list inside repo",
      entry: null
    });
  }
  if (entries.length === 0)
    return findings;
  for (const f of listing ?? listRepoFiles(root, isEnvFile)) {
    const shown = displayPath(f.path, entries);
    const cleanPath = cleanText(f.path);
    for (const e of entries) {
      if (e.pattern.test(cleanPath)) {
        findings.push({
          category: e.kind,
          severity: "block",
          file: shown,
          line: null,
          label: "path matches list",
          entry: e.entry
        });
      }
    }
    if (f.skipped || f.path === listRel || isEnvFile(f.path))
      continue;
    let text;
    try {
      text = readFileSync7(join9(root, f.path), "utf8").normalize("NFC");
    } catch {
      continue;
    }
    const lines2 = text.split(/\r?\n/);
    lines2.forEach((line, i) => {
      const previous = i > 0 ? lines2[i - 1] : "";
      if (isAllowed(line, previous))
        return;
      for (const e of matchingEntries(line, entries)) {
        findings.push({
          category: e.kind,
          severity: "block",
          file: shown,
          line: i + 1,
          label: e.kind === "personal" ? "personal detail" : "restricted term",
          entry: e.entry
        });
      }
    });
  }
  return findings;
}

// dist/scan/history.js
var BATCH = 100;
var MAX_BUFFER = 256 * 1024 * 1024;
var SEP = "\0";
var FULL_SHA = /^[0-9a-f]{40,64}$/;
var SHORT_SHA = /^[0-9a-f]{4,64}$/;
function git(root, args, maxBuffer, timeout = GIT_QUICK_TIMEOUT_MS) {
  return execFileSync3("git", ["-c", "core.quotePath=false", "-c", "log.showSignature=false", "-c", "core.fsmonitor=false", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer,
    timeout,
    stdio: ["ignore", "pipe", "ignore"]
  });
}
function supportsRemerge(root) {
  try {
    const m = /(\d+)\.(\d+)/.exec(git(root, ["version"], 1024 * 1024));
    return m !== null && (Number(m[1]) > 2 || Number(m[1]) === 2 && Number(m[2]) >= 36);
  } catch {
    return false;
  }
}
function note2(severity, label) {
  return { category: "history", severity, file: "history", line: null, label, entry: null };
}
function hit(file, label, entry, line, path) {
  return {
    category: "history",
    severity: path === void 0 ? "block" : downgrade(path, "block"),
    file,
    line,
    label,
    entry
  };
}
function newPath(header) {
  let p = header.replace(/\t.*$/, "");
  if (p === "/dev/null")
    return null;
  if (p.startsWith('"') && p.endsWith('"'))
    p = p.slice(1, -1);
  return p.startsWith("b/") ? p.slice(2) : p;
}
function scanText(text, where, entries, out) {
  const tracker = new StatementTracker();
  if (text.split(/\r?\n/).map((l) => tracker.classify(l)).some((label) => label !== null)) {
    out.push(hit(where, "secret in history", null, null));
  }
  for (const e of matchingEntries(text, entries))
    out.push(hit(where, "term in history", e.entry, null));
}
var RAW_LINE = /^:\d{6} \d{6} [0-9a-f]+\.* [0-9a-f]+\.* ([A-Z])\d*\t(.*)$/;
function scanPatch(sha, patch, entries, out) {
  let path = null;
  let oldLeft = 0;
  let newLeft = 0;
  let lineNo = 0;
  let previous = "";
  let tracker = new StatementTracker();
  for (const raw of patch) {
    if (oldLeft > 0 || newLeft > 0) {
      const kind = raw[0];
      const text = raw.slice(1);
      if (kind === "+") {
        newLeft--;
        const n = lineNo++;
        const label = tracker.classify(text);
        if (path !== null && !isAllowed(text, previous)) {
          if (label !== null) {
            out.push(hit(`${sha}:${displayPath(path, entries)}`, "secret in history", null, n, path));
          }
          for (const e of matchingEntries(text, entries)) {
            out.push(hit(`${sha}:${displayPath(path, entries)}`, "term in history", e.entry, n));
          }
        }
      } else if (kind === "-") {
        oldLeft--;
      } else if (kind === " ") {
        oldLeft--;
        newLeft--;
        lineNo++;
        tracker.classify(text);
      }
      if (kind !== "\\")
        previous = text;
      continue;
    }
    const rawLine = RAW_LINE.exec(raw);
    if (rawLine) {
      if (rawLine[1] !== "D") {
        let p = rawLine[2].split("	").pop() ?? "";
        if (p.startsWith('"') && p.endsWith('"'))
          p = p.slice(1, -1);
        for (const e of matchingEntries(cleanText(p), entries)) {
          out.push(hit(`${sha}:${displayPath(p, entries)}`, "path matches list", e.entry, null));
        }
      }
    } else if (raw.startsWith("diff --git ")) {
      path = null;
    } else if (raw.startsWith("+++ ")) {
      path = newPath(raw.slice(4));
    } else {
      const m = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
      if (m) {
        oldLeft = m[1] === void 0 ? 1 : Number(m[1]);
        newLeft = m[3] === void 0 ? 1 : Number(m[3]);
        lineNo = Number(m[2]);
        previous = "";
        tracker = new StatementTracker();
      }
    }
  }
}
function scanHistory(root, entries, options = {}) {
  const maxBuffer = options.maxBuffer ?? MAX_BUFFER;
  const batchSize = Math.max(1, options.batch ?? BATCH);
  let shallow;
  let shas;
  try {
    shallow = git(root, ["rev-parse", "--is-shallow-repository"], maxBuffer).trim() === "true";
    shas = git(root, ["rev-list", "--all", "--reflog"], maxBuffer).split(/\r?\n/).filter((s) => s !== "");
  } catch {
    return [note2("info", "history incomplete")];
  }
  if (shas.some((s) => !FULL_SHA.test(s)))
    return [note2("info", "history incomplete")];
  if (shas.length === 0)
    return [note2("info", "no commits")];
  const out = [];
  let incomplete = shallow;
  try {
    const refs = git(root, ["for-each-ref", "--format=%(refname)"], maxBuffer).split(/\r?\n/).filter((r) => r !== "");
    refs.forEach((ref, i) => {
      for (const e of matchingEntries(ref, entries))
        out.push(hit(`ref #${i + 1}`, "term in history", e.entry, null));
    });
  } catch {
    incomplete = true;
  }
  try {
    const subjects = git(root, ["reflog", "show", "--all", "--format=%gs"], maxBuffer).split(/\r?\n/).filter((s) => s !== "");
    subjects.forEach((subject, i) => {
      for (const e of matchingEntries(subject, entries))
        out.push(hit(`reflog #${i + 1}`, "term in history", e.entry, null));
    });
  } catch {
    incomplete = true;
  }
  const nonce = randomBytes(16).toString("hex");
  const START = `@@START-${nonce}@@`;
  const END = `@@END-${nonce}@@`;
  const remerge = supportsRemerge(root);
  if (!remerge)
    incomplete = true;
  const args = (list) => [
    // Pinned so the user's own git config cannot change what is parsed (no root-commit diff, blank-line trimming, fewer context lines).
    "-c",
    "diff.noprefix=false",
    "-c",
    "diff.mnemonicPrefix=false",
    "-c",
    "diff.suppressBlankEmpty=false",
    "log",
    "--no-walk",
    "--root",
    "-U3",
    "-p",
    "--raw",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    ...remerge ? ["--remerge-diff"] : [],
    "--src-prefix=a/",
    "--dst-prefix=b/",
    `--format=${START}%h%x00%an%x00%ae%x00%cn%x00%ce%x00%B${END}`,
    ...list
  ];
  try {
    const tags = git(root, ["for-each-ref", "refs/tags", `--format=${START}%(objecttype)%00%(taggername)%00%(taggeremail)%00%(contents)${END}`], maxBuffer);
    tags.split(START).slice(1).forEach((record, i) => {
      const endAt = record.indexOf(END);
      if (endAt < 0) {
        incomplete = true;
        return;
      }
      const [kind, name, email, ...rest] = record.slice(0, endAt).split(SEP);
      if (kind !== "tag")
        return;
      const where = `tag #${i + 1}`;
      const tagger = /* @__PURE__ */ new Set();
      for (const field of [name ?? "", email ?? ""])
        for (const e of matchingEntries(field, entries))
          tagger.add(e.entry);
      for (const entry of [...tagger].sort((a, b) => a - b))
        out.push(hit(where, "term in history", entry, null));
      scanText(rest.join(SEP), where, entries, out);
    });
  } catch {
    incomplete = true;
  }
  let timedOut = false;
  const scanBatch = (list) => {
    let text;
    try {
      text = git(root, args(list), maxBuffer, GIT_HEAVY_TIMEOUT_MS);
    } catch (err) {
      if (isTimeout(err))
        timedOut = true;
      return -1;
    }
    let bad = 0;
    let seen = 0;
    for (const record of text.split(START).slice(1)) {
      seen++;
      const endAt = record.indexOf(END);
      const header = endAt < 0 ? [] : record.slice(0, endAt).split(SEP);
      if (endAt < 0 || header.length < 6 || !SHORT_SHA.test(header[0])) {
        bad++;
        continue;
      }
      const [sha, an, ae, cn, ce, ...rest] = header;
      const authorEntries = /* @__PURE__ */ new Set();
      for (const field of [an, ae, cn, ce])
        for (const e of matchingEntries(field, entries))
          authorEntries.add(e.entry);
      for (const entry of [...authorEntries].sort((a, b) => a - b))
        out.push(hit(`${sha}:author`, "term in history", entry, null));
      scanText(rest.join(SEP), `${sha}:message`, entries, out);
      scanPatch(sha, record.slice(endAt + END.length).split(/\r?\n/), entries, out);
    }
    return bad + Math.max(0, list.length - seen);
  };
  for (let at = 0; at < shas.length; at += batchSize) {
    const slice = shas.slice(at, at + batchSize);
    const result = scanBatch(slice);
    if (result === 0)
      continue;
    if (timedOut) {
      incomplete = true;
      break;
    }
    if (slice.length === 1) {
      incomplete = true;
      continue;
    }
    for (const sha of slice) {
      if (scanBatch([sha]) !== 0)
        incomplete = true;
      if (timedOut)
        break;
    }
    if (timedOut)
      break;
  }
  const seenKeys = /* @__PURE__ */ new Set();
  const unique = out.filter((f) => {
    const key = `${f.file}|${f.line}|${f.label}|${f.entry}`;
    if (seenKeys.has(key))
      return false;
    seenKeys.add(key);
    return true;
  });
  if (incomplete)
    unique.unshift(note2("info", "history incomplete"));
  return unique;
}

// dist/scan/reachability.js
import { execFileSync as execFileSync4 } from "node:child_process";
var MAX_BUFFER2 = 64 * 1024 * 1024;
var REMOTE_TIMEOUT_MS = 2e4;
function git2(root, args, env, timeout = GIT_QUICK_TIMEOUT_MS) {
  return execFileSync4("git", ["-c", "core.quotePath=false", "-c", "core.fsmonitor=false", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER2,
    stdio: ["ignore", "pipe", "ignore"],
    ...env ? { env: { ...process.env, ...env } } : {},
    timeout
  });
}
function finding(severity, file, label) {
  return { category: "reachability", severity, file, line: null, label, entry: null };
}
var lines = (text) => text.split(/\r?\n/).filter((l) => l !== "");
function remoteEnv(sshCommand, gitSsh) {
  const env = { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" };
  const command = sshCommand.trim();
  if (command === "") {
    const program2 = gitSsh.trim();
    if (program2 === "")
      env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
    else if (program2.includes('"'))
      env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
    else {
      env.GIT_SSH_COMMAND = isPlainSsh(program2) ? `"${program2}" -o BatchMode=yes` : `"${program2}"`;
    }
    return env;
  }
  const { program, end } = splitProgram(command);
  env.GIT_SSH_COMMAND = isPlainSsh(program) ? `${command.slice(0, end)} -o BatchMode=yes${command.slice(end)}` : command;
  return env;
}
function splitProgram(command) {
  const quote = command[0] === '"' || command[0] === "'" ? command[0] : "";
  if (quote !== "") {
    const close = command.indexOf(quote, 1);
    if (close > 0)
      return { program: command.slice(1, close), end: close + 1 };
  }
  const word = /^\S*/.exec(command)?.[0] ?? "";
  return { program: word, end: word.length };
}
function isPlainSsh(program) {
  return /^ssh(?:\.exe)?$/i.test(program.split(/[\\/]/).pop() ?? "");
}
function userSshCommand(root) {
  const fromEnv = process.env.GIT_SSH_COMMAND;
  if (fromEnv !== void 0 && fromEnv.trim() !== "")
    return fromEnv;
  for (const scope of ["--global", "--system"]) {
    try {
      const value = git2(root, ["config", scope, "--includes", "--get", "core.sshCommand"]).trim();
      if (value !== "")
        return value;
    } catch {
    }
  }
  return "";
}
function checkReachability(root, options = {}) {
  const out = [];
  let refs;
  let current;
  let currentUnknown = false;
  try {
    refs = lines(git2(root, ["for-each-ref", "--format=%(refname)"]));
  } catch {
    return [finding("info", "reachability", "history incomplete")];
  }
  try {
    current = git2(root, ["symbolic-ref", "-q", "HEAD"]).trim() || null;
  } catch (err) {
    current = null;
    if (isTimeout(err))
      currentUnknown = true;
  }
  if (currentUnknown)
    out.push(finding("info", "reachability", "history incomplete"));
  refs.forEach((ref, i) => {
    const file = `ref #${i + 1}`;
    if (ref.startsWith("refs/original/")) {
      out.push(finding("block", file, "recommend a fresh repository"));
    } else if (ref === "refs/stash") {
      out.push(finding("warn", file, "extra ref"));
    } else if (ref.startsWith("refs/heads/") && currentUnknown) {
    } else if ((ref.startsWith("refs/tags/") || ref.startsWith("refs/heads/")) && ref !== current) {
      out.push(finding("warn", file, "extra ref"));
    }
  });
  try {
    const fsck = lines(git2(root, ["fsck", "--unreachable", "--no-reflogs", "--no-progress"], void 0, GIT_HEAVY_TIMEOUT_MS));
    let n2 = 0;
    for (const line of fsck) {
      const type = line.split(" ")[1];
      if (line.startsWith("unreachable ") && (type === "commit" || type === "blob"))
        n2++;
    }
    if (n2 > 0)
      out.push(finding("warn", `${n2} object${n2 === 1 ? "" : "s"}`, "unreachable object"));
  } catch {
    out.push(finding("info", "reachability", "history incomplete"));
  }
  let remotes;
  try {
    remotes = lines(git2(root, ["remote"]));
  } catch {
    out.push(finding("info", "remote", "remote not checked"));
    return out;
  }
  if (remotes.length === 0) {
    out.push(finding("info", "remote", "no remote"));
    return out;
  }
  if (options.offline) {
    out.push(finding("info", "remote", "remote not checked"));
    return out;
  }
  const env = remoteEnv(userSshCommand(root), process.env.GIT_SSH ?? "");
  let unchecked = false;
  let n = 0;
  for (const remote of remotes) {
    try {
      const listing = git2(root, ["-c", "credential.helper=", "-c", "protocol.ext.allow=never", "ls-remote", "--refs", "--", remote], env, REMOTE_TIMEOUT_MS);
      for (const l of lines(listing)) {
        const ref = l.split("	")[1] ?? "";
        if (ref.startsWith("refs/pull/") || ref.startsWith("refs/merge-requests/")) {
          out.push(finding("block", `remote ref #${++n}`, "recommend a fresh repository"));
        }
      }
    } catch {
      unchecked = true;
    }
  }
  if (unchecked)
    out.push(finding("info", "remote", "remote not checked"));
  return out;
}

// dist/cli.js
var REAL = {
  listFiles: (root) => listRepoFiles(root, isEnvFile),
  secrets: scanSecrets,
  terms: scanTerms,
  history: scanHistory,
  reachability: (root, offline) => checkReachability(root, { offline }),
  basics: scanBasics,
  isRepoRoot,
  pack: runNpmPack
};
var USAGE = [
  "Usage: launch-guard [path] [--list <file>] [--offline] [--json] [--pack] [--fail-on <block|warn>] [--init-list [file]] [--print-hook] [--explain <label>] [--help]",
  "",
  "Scans a git repository before it goes public and reports secrets, personal",
  "details, restricted terms and reachable old commits. It does not print a secret,",
  "any part of one, or a value from the private list.",
  "",
  "The only network use is a read-only `git ls-remote` against your configured",
  "remotes (skip it with --offline). The only file it writes is the template from",
  "--init-list.",
  "",
  "  path          repository to scan (default: the current directory)",
  "  --list <file> private list of personal and restricted patterns, kept outside the repo",
  "                (default: ~/.config/launch-guard/private-list.txt)",
  "  --offline     do not contact any remote (skips the hidden pull-request ref check)",
  "  --json        print the report as JSON (same fields, still no private data) instead of text",
  "  --fail-on <block|warn>",
  "                the lowest level that fails the run (default block); warn also fails on warnings",
  "  --pack        scan what `npm pack` would ship instead of the repository: it builds the tarball in a temp folder",
  "                (it does not run lifecycle scripts and never publishes), scans its contents, then deletes it;",
  "                git history is not part of a package, so the history and remote checks are skipped",
  "  --init-list [file]",
  "                write a template private list (comment lines only) for you to fill in with",
  "                your own editor; refuses to overwrite a file or to write inside a git repo",
  "  --print-hook  print a git pre-push hook script to the screen; it writes nothing, you save it yourself",
  "  --explain <label>",
  "                print what a report label means and what to do about it (the label is the text in a finding,",
  '                for example "secret format"); an unknown label lists the known ones',
  "  --help        show this text",
  "",
  "Exit codes: 0 no blocking findings, 1 at least one blocking finding, 2 usage or setup problem.",
  ""
].join("\n");
var HINT = "Usage: launch-guard [path] [--list <file>] [--offline] [--json] [--pack] [--fail-on <block|warn>] [--init-list [file]] [--print-hook] [--explain <label>] [--help]\n";
var FAIL_LABEL = `launch-guard: unknown label. Known labels:
${Object.keys(EXPLAIN).map((l) => `  ${l}`).join("\n")}
`;
var FAIL_PATH = "launch-guard: the target path is not a readable directory.\n";
var FAIL_PACK_BUILD = "launch-guard: the package could not be built.\n";
var FAIL_PACK_READ = "launch-guard: the package could not be read.\n";
var FAIL_LIST = "launch-guard: the private list is missing, unreadable or invalid.\n";
var FAIL_ARGS = `launch-guard: unrecognised or incomplete arguments.
${HINT}`;
var FAIL_RUN = "launch-guard: the scan could not be completed.\n";
var FAIL_EXISTS = "launch-guard: that file already exists, so it was left unchanged.\n";
var FAIL_IN_REPO = "launch-guard: the private list must live outside any git repository; choose another location.\n";
var FAIL_INIT = "launch-guard: the template could not be written.\n";
var TEMPLATE = [
  "# launch-guard private list. Keep this file outside every git repository.",
  "# Fill it in with your own editor. Do not paste its contents into a chat.",
  "# One entry per line, in this format:",
  "# format: kind|regex   (kind is personal or restricted)",
  "# Lines starting with # and blank lines are ignored.",
  "# Examples, delete the leading # and replace with your own terms:",
  "# personal|zq-example-name",
  "# personal|zq-example-street",
  "# restricted|zq-example-codeword",
  ""
].join("\n");
var HOOK = [
  "#!/bin/sh",
  "# launch-guard pre-push hook. Save this as .git/hooks/pre-push and make it executable (chmod +x).",
  "# Replace the path with the place you keep launch-guard.mjs. Git runs hooks from the top of the repository.",
  "# Any non-zero result stops the push: 1 means a blocking finding, 2 means the tool could not run.",
  'node "/path/to/launch-guard.mjs" . --offline || exit 1',
  ""
].join("\n");
function parseArgs(argv) {
  let path = null;
  let list = null;
  let init;
  let offline = false;
  let json = false;
  let hook = false;
  let pack = false;
  let failOn = null;
  let explain = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h")
      return { help: true };
    if (a === "--offline") {
      if (offline)
        return null;
      offline = true;
      continue;
    }
    if (a === "--json") {
      if (json)
        return null;
      json = true;
      continue;
    }
    if (a === "--explain") {
      const v = argv[++i];
      if (explain !== null || v === void 0 || v === "")
        return null;
      explain = v;
      continue;
    }
    if (a === "--fail-on") {
      const v = argv[++i];
      if (failOn !== null || v !== "block" && v !== "warn")
        return null;
      failOn = v;
      continue;
    }
    if (a === "--pack") {
      if (pack)
        return null;
      pack = true;
      continue;
    }
    if (a === "--print-hook") {
      if (hook)
        return null;
      hook = true;
      continue;
    }
    if (a === "--init-list") {
      if (init !== void 0)
        return null;
      const v = argv[i + 1];
      if (v !== void 0 && !v.startsWith("-")) {
        init = v;
        i++;
      } else {
        init = null;
      }
      continue;
    }
    if (a === "--list") {
      const v = argv[++i];
      if (v === void 0 || v === "" || list !== null)
        return null;
      list = v;
    } else if (a.startsWith("-") || path !== null) {
      return null;
    } else {
      path = a;
    }
  }
  if (hook) {
    return init !== void 0 || path !== null || list !== null || offline || json || pack || failOn !== null || explain !== null ? null : { help: false, hook: true };
  }
  if (init !== void 0 && (path !== null || list !== null || offline || json || pack || failOn !== null || explain !== null))
    return null;
  if (explain !== null && (path !== null || list !== null || offline || json || pack || failOn !== null))
    return null;
  return { help: false, hook: false, init, path: path ?? ".", list, offline, json, pack, failOn: failOn ?? "block", explain };
}
function insideGitRepo(p) {
  let dir = dirname2(resolve3(p));
  for (; ; ) {
    if (existsSync5(join10(dir, ".git")))
      return true;
    const up = dirname2(dir);
    if (up === dir)
      return false;
    dir = up;
  }
}
function initList(target, io) {
  const file = resolve3(target);
  if (existsSync5(file)) {
    io.err(FAIL_EXISTS);
    return 2;
  }
  if (insideGitRepo(file)) {
    io.err(FAIL_IN_REPO);
    return 2;
  }
  try {
    mkdirSync4(dirname2(file), { recursive: true });
    writeFileSync3(file, TEMPLATE, { flag: "wx" });
  } catch {
    io.err(FAIL_INIT);
    return 2;
  }
  const shown = displayPath(file, []);
  const where = shown.startsWith("~") ? shown : `${basename2(file)} (in the folder you chose)`;
  io.out([
    `Created a template private list at ${where}`,
    "Fill it in with your own editor, one pattern per line.",
    "Do not paste its contents into a chat, and do not ask an assistant to open it.",
    "Then run launch-guard again.",
    ""
  ].join("\n"));
  return 0;
}
function isRepoRoot(root) {
  try {
    const top = execFileSync5("git", ["rev-parse", "--show-toplevel"], {
      cwd: root,
      encoding: "utf8",
      timeout: GIT_QUICK_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (top === "")
      return false;
    const norm = (p) => {
      const r = resolve3(realpathSync3.native(p));
      return process.platform === "win32" ? r.toLowerCase() : r;
    };
    return norm(top) === norm(root);
  } catch {
    return false;
  }
}
function isReadableDir(p) {
  try {
    if (!statSync3(p).isDirectory())
      return false;
    readdirSync3(p);
    return true;
  } catch {
    return false;
  }
}
function note3(severity, label, file = "list") {
  return { category: "basics", severity, file, line: null, label, entry: null };
}
async function main(argv, io, scanners = REAL) {
  try {
    return await run(argv, io, scanners);
  } catch {
    try {
      io.err(FAIL_RUN);
    } catch {
    }
    return 2;
  }
}
async function run(argv, io, scanners) {
  const args = parseArgs(argv);
  if (args === null) {
    io.err(FAIL_ARGS);
    return 2;
  }
  if (args.help) {
    io.out(USAGE);
    return 0;
  }
  if (args.hook) {
    io.out(HOOK);
    return 0;
  }
  if (args.explain !== null) {
    const text = explainLabel(args.explain);
    if (text === null) {
      io.err(FAIL_LABEL);
      return 2;
    }
    io.out(`${text}
`);
    return 0;
  }
  if (args.init !== void 0)
    return initList(args.init ?? defaultDenyListPath(), io);
  const root = resolve3(args.path);
  if (!isReadableDir(root)) {
    io.err(FAIL_PATH);
    return 2;
  }
  const findings = [];
  let entries = [];
  let listFile;
  const explicit = args.list !== null;
  const file = explicit ? resolve3(args.list) : defaultDenyListPath();
  if (explicit || existsSync5(file)) {
    const loaded = loadDenyList(file);
    if (loaded.problem !== null) {
      io.err(FAIL_LIST);
      return 2;
    }
    entries = loaded.entries;
    listFile = file;
    if (entries.length === 0)
      findings.push(note3("warn", "private list has no entries"));
  } else {
    findings.push(note3("info", "checks skipped: no private list"));
  }
  if (args.pack) {
    const outcome = scanPackage(root, entries, {
      pack: scanners.pack ?? runNpmPack,
      secrets: scanners.secrets,
      terms: scanners.terms
    });
    if (!outcome.ok) {
      io.err(outcome.reason === "build" ? FAIL_PACK_BUILD : FAIL_PACK_READ);
      return 2;
    }
    findings.push(...outcome.findings);
  } else {
    const files = scanners.listFiles(root);
    findings.push(...scanners.secrets(root, entries, files));
    if (entries.length > 0)
      findings.push(...scanners.terms(root, entries, listFile, files));
    const isRoot = scanners.isRepoRoot?.(root) ?? true;
    if (isRoot) {
      findings.push(...scanners.history(root, entries));
      findings.push(...scanners.reachability(root, args.offline));
    } else {
      findings.push(note3("warn", "not a repository root", "repository"));
    }
    findings.push(...scanners.basics(root, entries, files));
    findings.push(...skippedNotes(files, entries));
  }
  const code = exitCode(findings, args.failOn);
  if (args.json) {
    io.out(renderJson(findings, args.failOn));
    return code;
  }
  io.out(renderReport(findings));
  io.out(`RESULT: ${code === 1 ? "FAIL" : "PASS"}
`);
  return code;
}

// dist/main.js
process.stdout.on("error", () => void 0);
process.stderr.on("error", () => void 0);
process.exitCode = await main(process.argv.slice(2), {
  out: (s) => void process.stdout.write(s),
  err: (s) => void process.stderr.write(s)
});
