import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";

/** Thrown for any archive that is damaged, over a limit or in a form this reader does not accept. Carries no archive text. */
export class TarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TarError";
  }
}

export interface TarLimits {
  /** Sum of all file sizes after decompression. */
  maxTotalBytes: number;
  /** Entries that are files or links (directories and metadata headers are free). */
  maxFiles: number;
}

export const DEFAULT_TAR_LIMITS: TarLimits = { maxTotalBytes: 256 * 1024 * 1024, maxFiles: 50_000 };

export interface TarOptions extends TarLimits {
  /**
   * Also refuse names that are only a problem on Windows (device names such as aux or nul, ':' and the characters
   * < > " | ? *, a trailing dot or space). Default: true on Windows only, so a real file named lib/aux.js is still
   * unpacked and scanned elsewhere. Traversal, absolute paths, drive letters, backslashes and control characters
   * are refused on every system.
   */
  windowsNames: boolean;
}

export interface ExtractResult {
  /** Safe, forward-slash paths of the files written under the destination (package prefix removed). */
  files: string[];
  /** Symlinks, hard links and special files. They are never created; the names are listed so they can be reported. */
  links: string[];
  /** Entries refused because the name could climb out of the folder or is not a portable file name. Never listed by name. */
  unsafe: number;
}

const BLOCK = 512;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const BAD_CHARS = /[\u0000-\u001f\\]/;
const WINDOWS_BAD_CHARS = /[<>:"|?*]/;

function readString(buf: Buffer, start: number, len: number): string {
  const slice = buf.subarray(start, start + len);
  const nul = slice.indexOf(0);
  return (nul === -1 ? slice : slice.subarray(0, nul)).toString("utf8");
}

function readOctal(buf: Buffer, start: number, len: number): number {
  if ((buf[start]! & 0x80) !== 0) throw new TarError("unsupported size encoding");
  const text = readString(buf, start, len).trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) throw new TarError("bad number in header");
  return parseInt(text, 8);
}

function checksumOk(header: Buffer): boolean {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i]!;
  let stored: number;
  try {
    stored = readOctal(header, 148, 8);
  } catch {
    return false;
  }
  return stored === sum;
}

/** Parses pax records ("<len> key=value\n"). Unknown keys are ignored. */
function parsePax(data: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let pos = 0;
  while (pos < data.length) {
    const space = data.indexOf(0x20, pos);
    if (space === -1) throw new TarError("bad pax record");
    const len = Number(data.subarray(pos, space).toString("ascii"));
    if (!Number.isInteger(len) || len <= space - pos + 1 || pos + len > data.length) throw new TarError("bad pax record");
    const record = data.subarray(space + 1, pos + len - 1).toString("utf8");
    const eq = record.indexOf("=");
    if (eq > 0) out.set(record.slice(0, eq), record.slice(eq + 1));
    pos += len;
  }
  return out;
}

/**
 * Turns an archive name into a safe relative path with the leading `package/` folder removed.
 * Returns "" for a directory-like or empty name and null for an unsafe one.
 */
function safeName(raw: string, windowsNames: boolean): string | null {
  if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) return null;
  const segments: string[] = [];
  for (const s of raw.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") return null;
    if (BAD_CHARS.test(s)) return null;
    segments.push(s);
  }
  segments.shift(); // the package folder (npm always uses "package")
  if (windowsNames) {
    for (const s of segments) {
      if (WINDOWS_BAD_CHARS.test(s) || WINDOWS_RESERVED.test(s.split(".")[0]!) || /[. ]$/.test(s)) return null;
    }
  }
  return segments.join("/");
}

/**
 * Unpacks an npm-style .tgz into `dest` without trusting it: no links are created, no name may leave `dest`, and the
 * decompressed size and file count are capped. Damaged or over-limit archives throw `TarError`.
 */
export function extractTarball(tgz: Buffer, dest: string, options: Partial<TarOptions> = {}): ExtractResult {
  const { maxTotalBytes, maxFiles, windowsNames } = { ...DEFAULT_TAR_LIMITS, windowsNames: process.platform === "win32", ...options };
  let tar: Buffer;
  try {
    tar = gunzipSync(tgz, { maxOutputLength: maxTotalBytes + (maxFiles + 16) * 2048 });
  } catch {
    throw new TarError("not a readable gzip archive");
  }

  const root = resolve(dest);
  const files = new Set<string>();
  const links = new Set<string>();
  let unsafe = 0;
  let total = 0;
  let count = 0;
  let pending: { path?: string; linkpath?: string; size?: number } = {};
  let pos = 0;

  while (pos < tar.length) {
    if (tar.length - pos < BLOCK) throw new TarError("truncated archive");
    const header = tar.subarray(pos, pos + BLOCK);
    if (header.every((b) => b === 0)) break;
    if (!checksumOk(header)) throw new TarError("bad header checksum");
    pos += BLOCK;

    const type = String.fromCharCode(header[156]!);
    let size = readOctal(header, 124, 12);
    if (pending.size !== undefined && type !== "x" && type !== "g" && type !== "L" && type !== "K") size = pending.size;
    if (pos + size > tar.length) throw new TarError("truncated archive");
    const body = tar.subarray(pos, pos + size);
    pos += Math.ceil(size / BLOCK) * BLOCK;

    if (type === "x") {
      const pax = parsePax(body);
      const sizeText = pax.get("size");
      pending = { path: pax.get("path"), linkpath: pax.get("linkpath"), size: sizeText === undefined ? undefined : Number(sizeText) };
      if (pending.size !== undefined && (!Number.isInteger(pending.size) || pending.size < 0)) throw new TarError("bad pax size");
      continue;
    }
    if (type === "g") continue;
    if (type === "L") {
      pending.path = readString(body, 0, body.length);
      continue;
    }
    if (type === "K") {
      pending.linkpath = readString(body, 0, body.length);
      continue;
    }

    let name = pending.path;
    if (name === undefined) {
      name = readString(header, 0, 100);
      const prefix = readString(header, 345, 155);
      if (prefix !== "" && readString(header, 257, 5) === "ustar") name = `${prefix}/${name}`;
    }
    pending = {};

    const clean = safeName(name, windowsNames);
    if (clean === null) {
      unsafe++;
      continue;
    }
    if (type === "5") continue;
    if (clean === "") continue;

    const isFile = type === "0" || type === "\0" || type === "7";
    if (++count > maxFiles) throw new TarError("too many files");
    if (!isFile) {
      links.add(clean);
      continue;
    }
    total += size;
    if (total > maxTotalBytes) throw new TarError("archive is too large");

    const target = join(root, ...clean.split("/"));
    if (!target.startsWith(root + sep)) {
      unsafe++;
      continue;
    }
    try {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, body);
    } catch {
      // A file where a folder is needed (or the reverse) is a hostile or broken layout: refuse the entry.
      unsafe++;
      continue;
    }
    files.add(clean);
  }
  return { files: [...files], links: [...links], unsafe };
}
