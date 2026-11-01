import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";
import { isEnvFile, listRepoFiles } from "./files.js";
import { scanBasics } from "./scan/basics.js";
import { scanSecrets } from "./scan/secrets.js";
import { scanTerms } from "./scan/terms.js";
import { makeDir, makeRepo } from "./testRepos.js";
import { loadDenyList } from "./denylist.js";

// Wraps the real listRepoFiles so calls can be counted; every consumer imports it from this module.
vi.mock("./files.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./files.js")>();
  return { ...real, listRepoFiles: vi.fn(real.listRepoFiles) };
});

const SLOW = 120_000;
const spy = vi.mocked(listRepoFiles);

function capture() {
  const out: string[] = [];
  return { io: { out: (s: string) => void out.push(s), err: (s: string) => void out.push(s) }, text: () => out.join("") };
}

afterEach(() => {
  spy.mockClear();
  vi.unstubAllEnvs();
});

describe("one file listing per run", () => {
  it("main lists the repository exactly once and still never opens .env files", async () => {
    const home = makeDir("lg-home-");
    vi.stubEnv("HOME", home.root);
    vi.stubEnv("USERPROFILE", home.root);
    const list = makeDir("lg-list-");
    const repo = makeRepo();
    try {
      list.write("private-list.txt", "restricted|zqonce8841\n");
      repo.commit("init", {
        "a.txt": "zqonce8841 appears here\n",
        // A NUL byte: if .env were opened for the binary sniff it would be reported as skipped (binary).
        ".env": "TOKEN=x\0y\n",
        "bin.dat": "a\0b",
      });
      const c = capture();
      const code = await main([repo.root, "--offline", "--list", `${list.root}/private-list.txt`], c.io);
      expect(code).toBe(1);
      expect(spy, "listRepoFiles call count").toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![1]).toBe(isEnvFile);
      const listed = spy.mock.results[0]!.value as { path: string; skipped?: string }[];
      expect(listed.find((f) => f.path === ".env")).toEqual({ path: ".env" });
      expect(listed.find((f) => f.path === "bin.dat")?.skipped).toBe("binary");
      expect(c.text()).toContain("file skipped");
      expect(c.text()).toContain("bin.dat");
    } finally {
      repo.cleanup();
      list.cleanup();
      home.cleanup();
    }
  }, SLOW);

  it("scanners given a listing return exactly what they return when they list themselves", () => {
    const list = makeDir("lg-list-");
    const repo = makeRepo();
    try {
      list.write("private-list.txt", "restricted|zqonce8841\npersonal|zqperson8841\n");
      repo.commit("init", {
        "a.txt": `zqonce8841 and ${"AKI" + "A"}${"ZQONCE8841SENT"}XY\n`,
        "docs/b.md": "zqperson8841\n",
        ".env": "SECRET=zz\n",
      });
      const listFile = `${list.root}/private-list.txt`;
      const entries = loadDenyList(listFile).entries;
      const files = listRepoFiles(repo.root, isEnvFile);
      spy.mockClear();
      expect(scanSecrets(repo.root, entries, files)).toEqual(scanSecrets(repo.root, entries));
      expect(scanTerms(repo.root, entries, listFile, files)).toEqual(scanTerms(repo.root, entries, listFile));
      expect(scanBasics(repo.root, entries, files)).toEqual(scanBasics(repo.root, entries));
      // The first call of each pair listed nothing itself; only the three no-listing calls did.
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      repo.cleanup();
      list.cleanup();
    }
  }, SLOW);
});
