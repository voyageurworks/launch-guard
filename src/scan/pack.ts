import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isEnvFile } from "../files.js";
import type { RepoFile } from "../files.js";
import type { Finding, Label, Severity } from "../types.js";
import { isAiFile } from "./basics.js";

const AGENT_DIRS = new Set([".claude", ".codex", ".cursor", ".gemini", ".windsurf"]);
const SSH_KEY = /^id_(?:rsa|dsa|ecdsa|ed25519)$/;
const MAX_MAP_BYTES = 64 * 1024 * 1024;
const MAX_KEY_BYTES = 1024 * 1024;

function make(severity: Severity, file: string, label: Label): Finding {
  return { category: "package", severity, file, line: null, label, entry: null };
}

/** True for a session or transcript file, decided from the name alone. */
function isSessionFile(name: string): boolean {
  return /(?:session|transcript)/.test(name) && /\.(?:md|json|jsonl)$/.test(name);
}

/** True when the file text holds a private-key header. Returns a flag only, never any text. */
function holdsPrivateKey(full: string): boolean {
  try {
    if (statSync(full).size > MAX_KEY_BYTES) return false;
    return readFileSync(full, "utf8").includes("PRIVATE KEY");
  } catch {
    return false;
  }
}

/** True when a source map embeds source text; null when it is not valid JSON or cannot be read. */
function mapEmbedsSources(full: string): boolean | null {
  try {
    if (statSync(full).size > MAX_MAP_BYTES) return null;
    const parsed: unknown = JSON.parse(readFileSync(full, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const content = (parsed as { sourcesContent?: unknown }).sourcesContent;
    return Array.isArray(content) && content.some((c) => typeof c === "string" && c !== "");
  } catch {
    return null;
  }
}

/**
 * Rules for what a package must not ship, decided from file names and (for source maps and PEM files) a yes/no
 * look inside. Findings carry the path inside the package, fixed text and never any file content.
 */
export function scanPackageFiles(root: string, files: RepoFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const f of files) {
    const path = f.path;
    const parts = path.toLowerCase().split("/");
    const name = parts[parts.length - 1]!;
    const dirs = parts.slice(0, -1);
    const bundled = dirs.includes("node_modules");
    const full = join(root, path);

    if (dirs.some((d) => AGENT_DIRS.has(d)) || name === "settings.local.json") {
      findings.push(make("block", path, "agent folder in package"));
    } else if (!bundled && isSessionFile(name)) {
      findings.push(make("block", path, "agent file in package"));
    } else if (!bundled && isAiFile(path)) {
      findings.push(make("warn", path, "agent file in package"));
    }
    if (isEnvFile(path)) findings.push(make("block", path, "env file in package"));
    if (name === ".npmrc") findings.push(make("block", path, ".npmrc in package"));
    if (dirs.includes(".git") || name === ".git") findings.push(make("block", path, "git data in package"));

    if (SSH_KEY.test(name) || name.endsWith(".p12") || name.endsWith(".pfx")) {
      findings.push(make("block", path, "private key file in package"));
    } else if (name.endsWith(".pem") || name.endsWith(".key")) {
      findings.push(
        holdsPrivateKey(full) ? make("block", path, "private key file in package") : make("warn", path, "key or certificate file in package"),
      );
    }

    if (name.endsWith(".map")) {
      const embeds = mapEmbedsSources(full);
      if (embeds === null) findings.push(make("warn", path, "source map in package"));
      else if (embeds) findings.push(make("warn", path, "source map with sources"));
    }
  }
  return findings;
}

/**
 * Reads the packed package.json for two yes/no facts: whether a `files` list limits what ships (an `.npmignore` in
 * the source folder counts too), and whether an install-time script will run on the consumer's machine.
 */
export function scanPackageManifest(root: string, sourceRoot: string): Finding[] {
  let manifest: { files?: unknown; scripts?: unknown };
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
    manifest = parsed as typeof manifest;
  } catch {
    return [];
  }
  const findings: Finding[] = [];
  if (!Array.isArray(manifest.files) && !existsSync(join(sourceRoot, ".npmignore"))) {
    findings.push(make("warn", "package.json", "no files list in package"));
  }
  const scripts = manifest.scripts;
  if (typeof scripts === "object" && scripts !== null) {
    const s = scripts as Record<string, unknown>;
    if (["install", "preinstall", "postinstall"].some((k) => typeof s[k] === "string")) {
      findings.push(make("warn", "package.json", "install script in package"));
    }
  }
  return findings;
}
