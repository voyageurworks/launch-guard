import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../cli.js";
import { makeDir, makeRepo } from "../testRepos.js";
import { scanBasics } from "./basics.js";
import { StatementTracker, classifyLine, scanSecrets } from "./secrets.js";

const SLOW = 120_000;
afterEach(() => vi.unstubAllEnvs());

// Every secret-shaped value below is assembled from pieces, so this file holds nothing key-shaped.
const VALUE = ["Zq8", "Lm2", "Xv9", "Kp4", "Rt7", "Wn5", "Hb3"].join(""); // 21 characters
const SYMBOLS = "!#$%^&*";
const HEX32 = "0123456789abcdef".repeat(2);
const HEX64 = HEX32 + HEX32;
const SECRET = "secret near keyword";

/** Feeds the lines to one tracker in order and returns every label. */
function run(lines: string[]): (string | null)[] {
  const tracker = new StatementTracker();
  return lines.map((l) => tracker.classify(l));
}
const last = (lines: string[]) => run(lines).at(-1);

describe("a secret whose value is on a later line than its key", () => {
  it("is found after a bare key, a block marker, a continuation or an opening quote", () => {
    expect(last(["API_KEY=", `  "${VALUE}"`])).toBe(SECRET);
    expect(last(["token: >-", `  ${VALUE}`])).toBe(SECRET);
    expect(last(["token: |", `  ${VALUE}`])).toBe(SECRET);
    expect(last(["password = \\", `  ${VALUE}`])).toBe(SECRET);
    expect(last(['secret: "', `${VALUE}"`])).toBe(SECRET);
    expect(last(['  "credential":', `    "${VALUE}",`])).toBe(SECRET);
    expect(last(["passphrase:", `  ${VALUE}`])).toBe(SECRET);
  });

  it("is found through a marker line of its own, a blank line, or both", () => {
    expect(last(["password:", "  >-", `  ${VALUE}`])).toBe(SECRET);
    expect(last(["password:", "", `  ${VALUE}`])).toBe(SECRET);
    expect(last(["password:", "  |", "", `  ${VALUE}`])).toBe(SECRET);
  });

  it("is found when the value itself is split with + or a backslash, over two, three or four lines", () => {
    const [a, b, c, d] = [VALUE.slice(0, 5), VALUE.slice(5, 10), VALUE.slice(10, 15), VALUE.slice(15)];
    expect(last([`token = "${VALUE.slice(0, 11)}" +`, `  "${VALUE.slice(11)}"`])).toBe(SECRET);
    expect(last([`const token = "${a}${b}" +`, `  "${c}" +`, `  "${d}";`])).toBe(SECRET);
    expect(last([`export API_TOKEN=${a}\\`, `${b}\\`, `${c}${d}`])).toBe(SECRET);
    expect(last([`token = "${a}" +`, `"${b}" +`, `"${c}" +`, `"${d}"`])).toBe(SECRET);
  });

  it("reports the line where the value ends, once", () => {
    const labels = run(["key: >-", `  ${VALUE}`, "other: 1"]);
    expect(labels).toEqual([null, SECRET, null]);
  });

  it("stays quiet for ordinary neighbours and placeholders", () => {
    expect(last([`  ${VALUE}`])).toBeNull();
    expect(last(["name: something", `  ${VALUE}`])).toBeNull();
    expect(last(["password:", "  something plain"])).toBeNull();
    expect(last(["token:", "  ${SECRET_FROM_ENV_VARIABLE_12345}"])).toBeNull();
    expect(last(["password:", "  your-password-goes-here-12345"])).toBeNull();
  });

  it("does not join a YAML child key or a list item onto a keyword line above it", () => {
    expect(last(["secrets:", "  DB_PASSWORD_PRODUCTION_ENVIRONMENT1: x"])).toBeNull();
    expect(last(["secrets:", "  DB_PASSWORD_PRODUCTION_ENVIRONMENT1:"])).toBeNull();
    expect(last(["secrets:", "  - DB_PASSWORD_PRODUCTION_ENVIRONMENT1"])).toBeNull();
    expect(last(["token:", "Please set this to a value from your provider's console."])).toBeNull();
  });

  it("does not follow a statement past four lines or past an unrelated line", () => {
    const pieces = Array.from({ length: 6 }, (_, i) => VALUE.slice(i * 3, i * 3 + 4));
    expect(last([`token = "${pieces[0]}" +`, ...pieces.slice(1, 5).map((p) => `"${p}" +`), `"${pieces[5]}"`])).toBeNull();
    expect(last(["password:", "value: 1", `  ${VALUE}`])).toBeNull();
  });

  it("follows a value that holds a colon, carries a trailing comment, or has a comment line above it", () => {
    expect(last(["const credentials =", `  'svc-deploy:${VALUE}';`])).toBe(SECRET);
    expect(last(["password: >-", `  ${VALUE}  # prod`])).toBe(SECRET);
    expect(last(["token:", "  #prod", `  ${VALUE}`])).toBe(SECRET);
    expect(last(["token:", "  // staging", `  ${VALUE}`])).toBe(SECRET);
    expect(last(["token = 'abc' +", `  + '${VALUE}'`])).toBe(SECRET);
  });

  it("follows a quoted value that holds an equals sign, a Java-style leading +, and a trailing // comment", () => {
    expect(last(["password:", `"${VALUE.slice(0, 11)}=${VALUE.slice(11)}"`])).toBe(SECRET);
    expect(last([`token = "${VALUE.slice(0, 11)}"`, `    + "${VALUE.slice(11)}";`])).toBe(SECRET);
    expect(last([`token = "${VALUE.slice(0, 7)}"`, `    + "${VALUE.slice(7, 14)}"`, `    + "${VALUE.slice(14)}";`])).toBe(SECRET);
    expect(last(["password:", `  "${VALUE}" // prod`])).toBe(SECRET);
  });

  it("does not join a leading + onto an unrelated line", () => {
    expect(last(["const total = count", `  + ${VALUE}`])).toBeNull();
    expect(last(["name = 'x'", "other = 1", `  + "${VALUE}"`])).toBeNull();
  });

  it("does not glue the next shell argument onto a closed quoted one", () => {
    expect(last(["kubectl create secret generic x --from-literal=db-password='s3cr3t' \\", "  --namespace=production-environment-1234567"])).toBeNull();
    expect(last(["docker run -e API_TOKEN='abc123' \\", "  registry.example.com/team/app-image:1.2.3-build456"])).toBeNull();
  });

  it("does not treat the next NAME=value line of an .env.example as the value", () => {
    expect(last(["OPENAI_API_KEY=", "OPENAI_MODEL=gpt-4o-mini-2024-07-18"])).toBeNull();
  });

  it("stops following after the line budget even when the lines in between are blank", () => {
    expect(last(["password:", "", `  ${VALUE}`])).toBe(SECRET);
    expect(last(["password:", "", "", `  ${VALUE}`])).toBe(SECRET);
    expect(last(["password:", "", "", "", `  ${VALUE}`])).toBeNull();
  });

  it("keeps working after a statement ends (state resets)", () => {
    expect(run(["token = 'short'", `  ${VALUE}`])).toEqual([null, null]);
    expect(run(["token:", "  >", `  ${VALUE}`, `  ${VALUE}`]).slice(2)).toEqual([SECRET, null]);
  });
});

describe("a quoted secret that contains symbols", () => {
  it("is found, and a short or placeholder quoted value is not", () => {
    expect(classifyLine(`password = "${VALUE}${SYMBOLS}"`)).toBe(SECRET);
    expect(classifyLine(`const token = '${VALUE}@${SYMBOLS}';`)).toBe(SECRET);
    expect(classifyLine(`password = "a${SYMBOLS}b"`)).toBeNull();
    expect(classifyLine(`password = "your-password-goes-here-${SYMBOLS}"`)).toBeNull();
  });
});

describe("more provider formats", () => {
  const cases: [string, string][] = [
    ["Stripe webhook secret", "whsec" + "_" + "Zq8Lm2Xv9Kp4Rt7Wn5Hb3Vc6"],
    ["Slack webhook URL", "https://hooks.slack.com/services/" + "T0ABCDEF12" + "/" + "B0ABCDEF12" + "/" + "Ab3dEf6hIj9kLm2nOp5qRs8t"],
    ["Twilio key", "S" + "K" + HEX32],
    ["Mailgun key", "key" + "-" + HEX32],
    ["Telegram bot token", "123456789" + ":" + "AA" + ["Hq3", "Zx8", "Lm2", "Kp4", "Rt7", "Wn5", "Hb3", "Vc6", "Yd9", "Fg1", "Js0"].join("")],
    ["Discord bot token", "M" + "Zq8Lm2Xv9Kp4Rt7Wn5Hb3Vc" + "." + "Yd9Fg1" + "." + "Js0Zq8Lm2Xv9Kp4Rt7Wn5Hb3Vc6"],
    ["Google OAuth token", "ya29" + "." + "Zq8Lm2Xv9Kp4Rt7Wn5Hb3Vc6Yd"],
    ["DigitalOcean token", "dop" + "_v1_" + HEX64],
    ["Shopify token", "shp" + "at_" + HEX32],
    ["Azure storage key", "AccountKey" + "=" + "Zq8Lm2Xv9Kp4Rt7Wn5Hb3Vc6Yd9Fg1Js0Zq8Lm2Xv9Kp4" + "=="],
  ];
  for (const [name, value] of cases) {
    it(`finds a ${name} anywhere on a line, with no keyword`, () => {
      expect(classifyLine(`value is ${value} here`)).toBe("secret format");
    });
  }

  it("ignores near misses", () => {
    expect(classifyLine("key" + "-" + HEX32.slice(1))).toBeNull();
    expect(classifyLine("S" + "K" + HEX32.slice(1))).toBeNull();
    expect(classifyLine("whsec" + "_" + "short")).toBeNull();
    expect(classifyLine("dop" + "_v1_" + HEX64.slice(1))).toBeNull();
    expect(classifyLine("12345:" + "AA" + "short")).toBeNull();
  });
});

describe("every match on a line is judged, and common look-alikes are not", () => {
  it("finds a real secret that follows a harmless keyword value on the same line", () => {
    expect(classifyLine(`{"publicKey":"example-pub-key-12345678","secretKey":"${VALUE}"}`)).toBe(SECRET);
    expect(classifyLine(`key=example-pub-key-12345678 token=${VALUE}`)).toBe(SECRET);
  });

  it("does not take pwd inside a longer word, an RFC sample or a truncated example", () => {
    expect(classifyLine("OLDPWD_DIR=/var/lib/app-2024/data/build-cache")).toBeNull();
    expect(classifyLine("Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==")).toBeNull();
    expect(classifyLine("Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGci...")).toBeNull();
  });
});

describe("an Authorization header and other keywords", () => {
  it("finds a bearer or basic credential", () => {
    expect(classifyLine(`Authorization: Bearer ${VALUE}Js0`)).toBe(SECRET);
    expect(classifyLine(`curl -H "authorization: basic ${VALUE}Js0=="`)).toBe(SECRET);
  });

  it("ignores prose, placeholders and plain words", () => {
    expect(classifyLine("Bearer authentication is required for this endpoint")).toBeNull();
    expect(classifyLine("Authorization: Bearer ${TOKEN}")).toBeNull();
    expect(classifyLine("Authorization: Bearer abcdefghijklmnopqrstuvwxyzabcdef")).toBeNull();
    expect(classifyLine("Authorization: Bearer <your-token-here-12345678>")).toBeNull();
  });

  it("knows passphrase and pwd", () => {
    expect(classifyLine(`passphrase = "${VALUE}"`)).toBe(SECRET);
    expect(classifyLine(`PWD=${VALUE}`)).toBe(SECRET);
  });
});

describe("hostile input cannot make the scan crawl", () => {
  const N = 100_000;
  const hostile: Record<string, string> = {
    "repeated keywords": "key".repeat(N / 3),
    "spaces then text": "password:" + " ".repeat(N) + "x",
    "spaces inside": "password:" + " ".repeat(N / 2) + "x" + " ".repeat(N / 2) + "key=",
    "repeated bearer": "bearer ".repeat(N / 7),
    "repeated key colon": "key: ".repeat(N / 5),
    "a long run of one letter": "a".repeat(N),
    "plus run": 'token = "a" ' + "+".repeat(N),
    "markers": "password: " + ">-|".repeat(N / 3),
    "quotes": "secret=" + '"'.repeat(N),
    "a run of eyJ-": "eyJ-".repeat(N / 4),
    "a run of eyJ with dots": ("eyJ" + "a".repeat(6) + ".").repeat(N / 10),
    "angle brackets in a closed quoted value": 'key="' + "<a".repeat(N / 2) + '"',
    "angle brackets in a url password": "https://user:" + "<a".repeat(N / 2) + "@h",
  };
  for (const [name, line] of Object.entries(hostile)) {
    it(`handles ${name} in well under a second`, () => {
      const tracker = new StatementTracker();
      const start = performance.now();
      classifyLine(line);
      tracker.classify(line);
      tracker.classify(line);
      tracker.classify(`  ${VALUE}`);
      expect(performance.now() - start).toBeLessThan(3000);
    });
  }

  it("the whole tool finishes on a 900 KB one-line file in every kind of file it reads", async () => {
    const repo = makeRepo();
    const home = makeDir("lg-home-");
    try {
      const line = Object.values(hostile).join(" ").slice(0, 900_000);
      repo.commit("one", { LICENSE: "MIT\n", "SECURITY.md": "x\n", ".github/workflows/ci.yml": "name: ci\n", "CLAUDE.md": line, "data.txt": line });
      vi.stubEnv("HOME", home.root);
      vi.stubEnv("USERPROFILE", home.root);
      const start = performance.now();
      const out: string[] = [];
      await main([repo.root, "--offline"], { out: (s) => void out.push(s), err: (s) => void out.push(s) });
      expect(performance.now() - start).toBeLessThan(30_000);
      expect(out.join("")).toContain("RESULT:");
    } finally {
      repo.cleanup();
      home.cleanup();
    }
  }, SLOW);
});

describe("scanSecrets over a file", () => {
  it("reports the line where a split secret ends and nothing from the secret", () => {
    const dir = makeDir("lg-shape-");
    try {
      dir.write("conf.yml", `name: demo\npassword:\n  >-\n  ${VALUE}\nother: 1\n`);
      const found = scanSecrets(dir.root, []);
      expect(found).toEqual([{ category: "secret", severity: "block", file: "conf.yml", line: 4, label: SECRET, entry: null }]);
      expect(JSON.stringify(found)).not.toContain(VALUE);
    } finally {
      dir.cleanup();
    }
  });

  it("an allow comment on the line above the value still silences it", () => {
    const dir = makeDir("lg-shape-");
    try {
      dir.write("conf.yml", `password:\n  # launch-guard-allow: documented example\n  ${VALUE}\n`);
      expect(scanSecrets(dir.root, [])).toEqual([]);
    } finally {
      dir.cleanup();
    }
  });
});

describe("nested repositories", () => {
  function nested(repo: ReturnType<typeof makeRepo>, name: string): void {
    repo.write(`${name}/readme.txt`, "x\n");
    execFileSync("git", ["init", "-q"], { cwd: join(repo.root, name), stdio: "ignore" });
  }
  const notes = (root: string) => scanBasics(root).filter((f) => f.label === "nested repository not scanned");

  it("notes an untracked folder that is its own repository, however deep", () => {
    const repo = makeRepo();
    try {
      repo.commit("one", { "a.txt": "x\n" });
      nested(repo, "inner");
      expect(notes(repo.root)).toEqual([{ category: "basics", severity: "info", file: "nested repositories", line: null, label: "nested repository not scanned", entry: null }]);
    } finally {
      repo.cleanup();
    }
    const deep = makeRepo();
    try {
      deep.commit("one", { "a.txt": "x\n" });
      nested(deep, "tools/vendor/inner");
      expect(notes(deep.root)).toHaveLength(1);
    } finally {
      deep.cleanup();
    }
  }, SLOW);

  it("says nothing for a plain folder, an ignored repository, or no nested repository at all", () => {
    const repo = makeRepo();
    try {
      repo.commit("one", { "a.txt": "x\n", ".gitignore": "ignored/\n" });
      repo.write("plain/file.txt", "x\n");
      nested(repo, "ignored");
      expect(notes(repo.root)).toEqual([]);
    } finally {
      repo.cleanup();
    }
  }, SLOW);
});

describe("nothing secret reaches the output, end to end", () => {
  it("a split secret, a tag, a merge resolution and a nested repo leave no value in the report", async () => {
    const repo = makeRepo();
    const home = makeDir("lg-home-");
    try {
      repo.commit("base", { "f.txt": "a\n", LICENSE: "MIT\n", "SECURITY.md": "x\n", ".github/workflows/ci.yml": "name: ci\n" });
      repo.git("checkout", "-q", "-b", "side");
      repo.commit("side", { "f.txt": "side\n" });
      repo.git("checkout", "-q", "-");
      repo.commit("main", { "f.txt": "main\n" });
      try {
        repo.git("merge", "--no-commit", "--no-ff", "side");
      } catch {
        // the conflict is the point
      }
      repo.write("f.txt", `resolved\npassword:\n  >-\n  ${VALUE}\n`);
      repo.git("add", "f.txt");
      repo.git("commit", "-q", "-m", "merge side");
      repo.git("tag", "-a", "zq-tag-name-7731", "-m", `notes token = "${VALUE}${SYMBOLS}"`);
      repo.write("conf/app.yml", `api_key: >\n  ${VALUE}\n`);
      repo.write("inner/readme.txt", "x\n");
      execFileSync("git", ["init", "-q"], { cwd: join(repo.root, "inner"), stdio: "ignore" });
      vi.stubEnv("HOME", home.root);
      vi.stubEnv("USERPROFILE", home.root);
      const out: string[] = [];
      const code = await main([repo.root, "--offline"], { out: (s) => void out.push(s), err: (s) => void out.push(s) });
      const text = out.join("");
      expect(code).toBe(1);
      for (const forbidden of [VALUE, VALUE.slice(0, 11), VALUE.slice(10), "zq-tag-name-7731", SYMBOLS]) expect(text).not.toContain(forbidden);
      expect(text).toContain("conf/app.yml:2 secret near keyword");
      expect(text).toContain("tag #1 secret in history");
      expect(text).toContain("nested repository not scanned");
    } finally {
      repo.cleanup();
      home.cleanup();
    }
  }, SLOW);
});
