import { gzipSync } from "node:zlib";

/** Test helper only (excluded from the build): builds small .tgz buffers by hand, including odd and hostile ones. */
export interface TarEntry {
  name: string;
  /** Default "0" (file). "5" directory, "1" hard link, "2" symlink, "x" pax header, "L" GNU long name. */
  type?: string;
  data?: string | Buffer;
  linkname?: string;
  /** Overrides the size field written in the header (for truncation tests). */
  sizeField?: number;
  /** Writes a wrong checksum. */
  badChecksum?: boolean;
  prefix?: string;
}

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, "0") + "\0";
}

function header(e: TarEntry, size: number): Buffer {
  const b = Buffer.alloc(512);
  b.write(e.name, 0, 100, "utf8");
  b.write(octal(0o644, 8), 100, 8, "ascii");
  b.write(octal(0, 8), 108, 8, "ascii");
  b.write(octal(0, 8), 116, 8, "ascii");
  b.write(octal(e.sizeField ?? size, 12), 124, 12, "ascii");
  b.write(octal(0, 12), 136, 12, "ascii");
  b.write("        ", 148, 8, "ascii");
  b.write(e.type ?? "0", 156, 1, "ascii");
  if (e.linkname) b.write(e.linkname, 157, 100, "utf8");
  b.write("ustar\0", 257, 6, "ascii");
  b.write("00", 263, 2, "ascii");
  if (e.prefix) b.write(e.prefix, 345, 155, "utf8");
  let sum = 0;
  for (const v of b) sum += v;
  if (e.badChecksum) sum += 1;
  b.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return b;
}

/** A raw (uncompressed) tar archive. */
export function makeTar(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const data = e.data === undefined ? Buffer.alloc(0) : Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, "utf8");
    parts.push(header(e, data.length));
    if (data.length > 0) {
      parts.push(data, Buffer.alloc((512 - (data.length % 512)) % 512));
    }
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

export function makeTgz(entries: TarEntry[]): Buffer {
  return gzipSync(makeTar(entries));
}

/** One pax record: "<len> key=value\n" where len counts the whole record including its own digits. */
export function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return `${len}${body}`;
}
