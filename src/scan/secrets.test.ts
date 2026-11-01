import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyLine, scanSecrets } from "./secrets.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
    openSync: vi.fn(actual.openSync),
    readSync: vi.fn(actual.readSync),
  };
});

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
  vi.mocked(fs.readFileSync).mockClear();
  vi.mocked(fs.openSync).mockClear();
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "lg-secrets-"));
  dirs.push(d);
  return d;
}

function plant(name: string, text: string): string {
  const root = tmp();
  writeFileSync(join(root, name), text);
  return root;
}

// Fake keys are built by concatenation so this file holds nothing key-shaped.
const SENT = "ZQSENTINEL7731";
const fakes: Record<string, string> = {
  aws: "AKI" + "A" + SENT + "XY",
  github: "gh" + "p_" + SENT + "abcdefghijklmnopqrstuv",
  slack: "xo" + "xb-" + SENT + "-abcdef",
  stripe: "sk_" + "live_" + SENT + "abcdef",
  google: "AI" + "za" + SENT + "abcdefghijklmnopqrstuvwxy",
  npm: "np" + "m_" + SENT + "abcdefghijklmnopqrstuv",
  privateKey: "-----BEGIN " + "RSA PRIVATE KEY-----",
  jwt: "ey" + "J" + SENT + "abc." + "ey" + "J" + SENT + "def." + SENT + "ghi",
  anthropic: "sk-" + "ant-" + SENT + "abcdefghij_klm-nop",
  openaiProject: "sk-" + "proj-" + SENT + "abcdefghij_klm-nop",
  openaiLegacy: "sk-" + SENT + "abcdefghijklmnopqrstuvwxyz0123",
  huggingFace: "hf" + "_" + SENT + "abcdefghijklmnopqrstuvwx",
  gitlab: "glp" + "at-" + SENT + "abcdefghij_klm",
  sendgrid: "S" + "G." + SENT + "abcdefghij_kl" + "." + SENT + "abcdefghij-kl",
  stripeRestricted: "rk_" + "live_" + SENT + "abcdefghij",
  pgpKey: "-----BEGIN " + "PGP PRIVATE KEY BLOCK-----",
  urlCredentials: "postgres://" + "zquser:" + SENT + "pw@db.example.invalid:5432/app",
};
// Mixed-case, 32 distinct characters: high entropy, no placeholder words.
const HIGH_ENTROPY = "q8Zr3KxT9vLm2WpYb7NcD4hJf6GsA1eU";

// Placeholder fixtures are assembled at runtime so this file holds no keyword = "value" pair that scanners match.
function pair(key: string, value: string, sep = " = "): string {
  return `${key}${sep}"${value}"`;
}

function windows(s: string, n = 4): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= s.length; i++) out.push(s.slice(i, i + n));
  return out;
}

describe("scanSecrets", () => {
  for (const [name, fake] of Object.entries(fakes)) {
    it(`finds a fake provider key by format: ${name}`, () => {
      const root = plant("keys.txt", `first line\nvalue = ${fake}\n`);
      expect(scanSecrets(root)).toEqual([
        { category: "secret", severity: "block", file: "keys.txt", line: 2, label: "secret format", entry: null },
      ]);
    });
  }

  it("downgrades a secret in a test file by name to warn, not in an ordinary file", () => {
    const root = plant("x.test.ts", `a\n${fakes.privateKey}\n`);
    writeFileSync(join(root, "x.ts"), `a\n${fakes.privateKey}\n`);
    expect(scanSecrets(root)).toEqual(
      expect.arrayContaining([
        { category: "secret", severity: "warn", file: "x.test.ts", line: 2, label: "secret format", entry: null },
        { category: "secret", severity: "block", file: "x.ts", line: 2, label: "secret format", entry: null },
      ]),
    );
  });

  it("finds a high-entropy value next to the word token", () => {
    const root = plant("app.ts", `const token = "${HIGH_ENTROPY}";\n`);
    expect(scanSecrets(root)).toEqual([
      { category: "secret", severity: "block", file: "app.ts", line: 1, label: "secret near keyword", entry: null },
    ]);
  });

  it("flags a tracked .env file by name and never opens it", () => {
    const root = plant(".env.production", `API_TOKEN=${HIGH_ENTROPY}\n`);
    writeFileSync(join(root, ".env.example"), "API_TOKEN=changeme\n");
    vi.mocked(fs.readFileSync).mockClear();
    vi.mocked(fs.openSync).mockClear();
    const findings = scanSecrets(root);
    expect(findings).toEqual([
      { category: "secret", severity: "block", file: ".env.production", line: null, label: "tracked env file", entry: null },
    ]);
    const touched = [...vi.mocked(fs.readFileSync).mock.calls, ...vi.mocked(fs.openSync).mock.calls].map((c) =>
      String(c[0]),
    );
    expect(touched.some((p) => /\.env\.production$/.test(p))).toBe(false);
  });

  it("flags a nested .env file by name", () => {
    const root = tmp();
    mkdirSync(join(root, "app"));
    writeFileSync(join(root, "app", ".env"), "X=1\n");
    expect(scanSecrets(root).map((f) => f.file)).toEqual(["app/.env"]);
  });

  it("placeholder values such as xxx or changeme are not flagged", () => {
    const root = plant(
      "config.ts",
      [
        pair("const token", "x".repeat(28)) + ";",
        pair("password", ["change", "me-", "change", "me-", "change", "me1"].join(""), ": "),
        pair("api_key", ["your-key-", "here-your-", "key-here"].join("")),
        "secret = <token-token-token-token>",
        pair("token", "${SOME_LONG_" + "TOKEN_VARIABLE}"),
        "const secret = process.env." + "SOME_LONG_SECRET_NAME;",
        pair("key", ["exam", "ple-", "q8Zr3KxT9vLm2WpYb7Nc"].join("")),
        pair("token", ["dum", "my-", "q8Zr3KxT9vLm2WpYb7NcD"].join("")),
        pair("password", "0".repeat(26)),
      ].join("\n"),
    );
    expect(scanSecrets(root)).toEqual([]);
  });

  it("does not flag look-alikes of the newer key formats or placeholder URL credentials", () => {
    const root = plant(
      "notes.md",
      [
        "ask-" + "1234567890123456789012345678901234567890", // not at a word boundary
        "task-" + "q8Zr3KxT9vLm2WpYb7NcD4hJf6GsA1eU99",
        "sk-" + "abcdefghijklmnopqrstuvwxyzabcdefgh", // 32+ letters, no digit
        "sk-" + "ant-short",
        "hf" + "_short",
        "glp" + "at-short",
        "S" + "G.short.short",
        "rk_" + "live_short",
        "-----BEGIN " + "PGP PUBLIC KEY BLOCK-----",
        "postgres://" + "user:password@localhost/db",
        "postgres://" + "user:pass@localhost/db",
        "postgres://" + "app:<password>@localhost/db",
        "postgres://" + "app:${DB_PASSWORD}@localhost/db",
        "postgres://" + "app:xxxxxxxx@localhost/db",
        "postgres://" + "app:changeme@localhost/db",
        "postgres://" + "admin:admin@localhost/db",
        "postgres://" + "app:abc@localhost/db", // under 4 characters
        "https://" + "user:secret@host.example.invalid/x.git",
        "https://" + "user:token123@host.example.invalid/x.git",
        "https://" + "user:q8Zr3KxT9@host.example.invalid/x.git", // 9 characters: below the length floor
        "https://" + "user:$DB_PASS@host.example.invalid/x.git",
        "https://" + "user:${DB_PASS}@host.example.invalid/x.git",
        "https://" + "user:<password>@host.example.invalid/x.git",
        "http://" + "user:<password>@127.0.0.1:1/none.git",
        "https://" + "user:mypassword-mypassword@host.example.invalid/x.git",
        "https://" + "user:aaaaaaaaaaaaaaaa@host.example.invalid/x.git",
        "https://" + "example.com:8080/path",
        "ssh://" + "git@github.com/owner/repo",
        "https://" + "example.com/a@b",
      ].join("\n"),
    );
    expect(scanSecrets(root)).toEqual([]);
  });

  it("a token-like URL password is reported, even one that starts with a dollar sign", () => {
    for (const pw of ["q8Zr3KxT9vLm2WpYb7Nc", "$" + "q8Zr3-KxT9vLm2.WpY"]) {
      expect(classifyLine("git clone https://" + "user:" + pw + "@host.example.invalid/x.git")).toBe("secret format");
    }
  });

  it("a random URL password that merely contains test or demo inside an alphanumeric run is still reported", () => {
    // Only a whole word between non-alphanumeric separators counts as a placeholder; 20 mixed-case characters do not.
    const withTest = "q8Zr3Kx" + "te" + "st" + "Lm2WpYb7N";
    const withDemo = "Wp3Yb7N" + "de" + "mo" + "Kx9Zr2Lq5";
    for (const pw of [withTest, withDemo]) {
      expect(pw).toHaveLength(20);
      expect(classifyLine("git clone https://" + "user:" + pw + "@host.example.invalid/x.git")).toBe("secret format");
    }
    // The same word as a separate piece is a placeholder and stays quiet.
    expect(classifyLine("git clone https://" + "user:" + "q8Zr3Kx-" + "test" + "-Lm2WpYb7N" + "@host.example.invalid/x.git")).toBeNull();
  });

  it("new patterns do not backtrack catastrophically on long adversarial lines", () => {
    const n = 200_000;
    const lines = [
      "sk-".repeat(n / 3),
      "sk-" + "a1".repeat(n / 2),
      "sk-ant-" + "a_-".repeat(n / 3),
      "hf_" + "a".repeat(n),
      "glpat-" + "a-".repeat(n / 2),
      "SG." + "a_".repeat(n / 2),
      "SG." + "a".repeat(16) + "." + "a".repeat(n),
      "rk_live_" + "a".repeat(n),
      "-----BEGIN PGP PRIVATE KEY".repeat(n / 25),
      "a".repeat(n) + "://",
      "http://" + "a:".repeat(n / 2),
      "http://" + "a".repeat(n) + ":" + "b".repeat(n),
      "x://".repeat(n / 4),
    ];
    const started = Date.now();
    for (const line of lines) classifyLine(line);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("does not flag plain prose or short values", () => {
    const root = plant("a.md", 'token = "abc123"\nThe secret of good code is naming.\n');
    expect(scanSecrets(root)).toEqual([]);
  });

  it("honours launch-guard-allow with a reason", () => {
    const root = plant("a.ts", `const token = "${HIGH_ENTROPY}"; // launch-guard-allow: test double\n`);
    expect(scanSecrets(root)).toEqual([]);
  });

  it("downgrades findings under test directories to warn", () => {
    const root = tmp();
    mkdirSync(join(root, "tests"));
    writeFileSync(join(root, "tests", "a.ts"), `x = ${fakes.aws}\n`);
    expect(scanSecrets(root).map((f) => f.severity)).toEqual(["warn"]);
  });

  it("keeps block for key files and tracked env files even under test paths", () => {
    const root = tmp();
    mkdirSync(join(root, "tests"));
    writeFileSync(join(root, "prod_test.pem"), `x = ${fakes.aws}\n`);
    writeFileSync(join(root, "tests", "server.key"), `x = ${fakes.aws}\n`);
    writeFileSync(join(root, "tests", ".env.local"), "A=1\n");
    const found = scanSecrets(root);
    expect(found).toHaveLength(3);
    expect(found.every((f) => f.severity === "block")).toBe(true);
  });

  it("reports one finding per line", () => {
    const root = plant("a.ts", `token = "${fakes.github}"\n`);
    expect(scanSecrets(root)).toHaveLength(1);
  });

  it("no four-character window of the secret appears anywhere in the findings", () => {
    const secrets = [...Object.values(fakes).filter((s) => !s.startsWith("-----")), HIGH_ENTROPY];
    const root = tmp();
    secrets.forEach((s, i) => writeFileSync(join(root, `f${i}.dat`), `token = "${s}"\n`));
    const findings = scanSecrets(root);
    expect(findings.length).toBe(secrets.length);
    const out = JSON.stringify(findings);
    for (const s of secrets) {
      for (const w of windows(s)) expect(out.includes(w), `window ${w}`).toBe(false);
    }
  });
});
