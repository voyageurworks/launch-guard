import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeDir, makeRepo } from "../testRepos.js";
import { checkReachability, remoteEnv } from "./reachability.js";

const SLOW = 120_000;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("remoteEnv", () => {
  it("never allows a prompt", () => {
    for (const [cmd, gitSsh] of [["", ""], ["", "/usr/bin/ssh"], ["ssh -i k", ""], ["plink -batch", ""]] as const) {
      const env = remoteEnv(cmd, gitSsh);
      expect(env.GIT_TERMINAL_PROMPT).toBe("0");
      expect(env.GIT_ASKPASS).toBe("");
    }
  });

  it("uses plain ssh in batch mode when the user set nothing", () => {
    expect(remoteEnv("", "").GIT_SSH_COMMAND).toBe("ssh -o BatchMode=yes");
    expect(remoteEnv("   ", "  ").GIT_SSH_COMMAND).toBe("ssh -o BatchMode=yes");
  });

  it("keeps the user's ssh options and puts batch mode first, so their own -o cannot undo it", () => {
    expect(remoteEnv("ssh -i /keys/id -p 2222", "").GIT_SSH_COMMAND).toBe("ssh -o BatchMode=yes -i /keys/id -p 2222");
    expect(remoteEnv("SSH.EXE -F cfg", "").GIT_SSH_COMMAND).toBe("SSH.EXE -o BatchMode=yes -F cfg");
    expect(remoteEnv("ssh -o BatchMode=no", "").GIT_SSH_COMMAND).toBe("ssh -o BatchMode=yes -o BatchMode=no");
  });

  it("recognises ssh given as a path, quoted or not, and keeps spaces in it", () => {
    expect(remoteEnv("/usr/bin/ssh -F c", "").GIT_SSH_COMMAND).toBe("/usr/bin/ssh -o BatchMode=yes -F c");
    expect(remoteEnv("C:/Windows/System32/OpenSSH/ssh.exe -F c", "").GIT_SSH_COMMAND).toBe("C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes -F c");
    expect(remoteEnv('"C:/Program Files/Git/usr/bin/ssh.exe" -F c', "").GIT_SSH_COMMAND).toBe('"C:/Program Files/Git/usr/bin/ssh.exe" -o BatchMode=yes -F c');
    expect(remoteEnv("'/opt/my tools/ssh'", "").GIT_SSH_COMMAND).toBe("'/opt/my tools/ssh' -o BatchMode=yes");
  });

  it("treats a lone GIT_SSH program the same way", () => {
    expect(remoteEnv("", "/usr/bin/ssh").GIT_SSH_COMMAND).toBe('"/usr/bin/ssh" -o BatchMode=yes');
    expect(remoteEnv("", "C:\\Program Files\\Git\\usr\\bin\\ssh.exe").GIT_SSH_COMMAND).toBe('"C:\\Program Files\\Git\\usr\\bin\\ssh.exe" -o BatchMode=yes');
    // Other programs are handed over as GIT_SSH_COMMAND too: it outranks the repository's own core.sshCommand, GIT_SSH does not.
    expect(remoteEnv("", "/opt/plink").GIT_SSH_COMMAND).toBe('"/opt/plink"');
    expect(remoteEnv("", 'odd"name').GIT_SSH_COMMAND).toBe("ssh -o BatchMode=yes");
  });

  it("passes any other program through unchanged", () => {
    expect(remoteEnv("plink -batch -i k.ppk", "").GIT_SSH_COMMAND).toBe("plink -batch -i k.ppk");
    expect(remoteEnv("/opt/ssh-wrapper --x", "").GIT_SSH_COMMAND).toBe("/opt/ssh-wrapper --x");
    expect(remoteEnv("sshpass -p x ssh", "").GIT_SSH_COMMAND).toBe("sshpass -p x ssh");
  });
});

/** A stand-in for ssh: records that git called it, then fails like an unreachable host. */
function fakeSsh(): { dir: ReturnType<typeof makeDir>; command: string; marker: string } {
  const dir = makeDir("lg-fakessh-");
  dir.write("fake-ssh.mjs", `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(join(dir.root, "called.txt"))}, process.argv.slice(2).join(" "));\nprocess.exit(255);\n`);
  const script = join(dir.root, "fake-ssh.mjs").split("\\").join("/");
  return { dir, command: `node "${script}"`, marker: join(dir.root, "called.txt") };
}

describe("the user's own ssh setting is used for the remote check", () => {
  it("honours GIT_SSH_COMMAND", () => {
    const fake = fakeSsh();
    const repo = makeRepo();
    try {
      repo.commit("one", { "a.txt": "x\n" });
      repo.git("remote", "add", "origin", "ssh://git@example.invalid/x.git");
      vi.stubEnv("GIT_SSH_COMMAND", fake.command);
      const found = checkReachability(repo.root);
      expect(existsSync(fake.marker)).toBe(true);
      expect(found).toContainEqual({ category: "reachability", severity: "info", file: "remote", line: null, label: "remote not checked", entry: null });
      expect(found.some((f) => f.severity === "block")).toBe(false);
    } finally {
      repo.cleanup();
      fake.dir.cleanup();
    }
  }, SLOW);

  it("honours the user's global core.sshCommand when the environment has none", () => {
    const fake = fakeSsh();
    const repo = makeRepo();
    try {
      repo.commit("one", { "a.txt": "x\n" });
      repo.git("remote", "add", "origin", "ssh://git@example.invalid/x.git");
      fake.dir.write("gitconfig", `[core]\n\tsshCommand = ${fake.command.split("\\").join("\\\\").split('"').join('\\"')}\n`);
      vi.stubEnv("GIT_SSH_COMMAND", undefined);
      vi.stubEnv("GIT_CONFIG_GLOBAL", join(fake.dir.root, "gitconfig"));
      checkReachability(repo.root);
      expect(existsSync(fake.marker)).toBe(true);
    } finally {
      repo.cleanup();
      fake.dir.cleanup();
    }
  }, SLOW);

  it("never runs a core.sshCommand that only the scanned repository's own config sets", () => {
    const fake = fakeSsh();
    const repo = makeRepo();
    const empty = makeDir("lg-emptycfg-");
    try {
      repo.commit("one", { "a.txt": "x\n" });
      repo.git("remote", "add", "origin", "ssh://git@example.invalid/x.git");
      repo.git("config", "core.sshCommand", fake.command);
      empty.write("gitconfig", "");
      vi.stubEnv("GIT_SSH_COMMAND", undefined);
      vi.stubEnv("GIT_SSH", undefined);
      vi.stubEnv("GIT_CONFIG_GLOBAL", join(empty.root, "gitconfig"));
      vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
      checkReachability(repo.root);
      expect(existsSync(fake.marker)).toBe(false);
    } finally {
      repo.cleanup();
      fake.dir.cleanup();
      empty.cleanup();
    }
  }, SLOW);

  it("follows an include in the user's global config (the per-folder identity setup)", () => {
    const fake = fakeSsh();
    const repo = makeRepo();
    try {
      repo.commit("one", { "a.txt": "x\n" });
      repo.git("remote", "add", "origin", "ssh://git@example.invalid/x.git");
      fake.dir.write("included", `[core]\n\tsshCommand = ${fake.command.split("\\").join("\\\\").split('"').join('\\"')}\n`);
      fake.dir.write("gitconfig", `[include]\n\tpath = ${join(fake.dir.root, "included").split("\\").join("/")}\n`);
      vi.stubEnv("GIT_SSH_COMMAND", undefined);
      vi.stubEnv("GIT_CONFIG_GLOBAL", join(fake.dir.root, "gitconfig"));
      checkReachability(repo.root);
      expect(existsSync(fake.marker)).toBe(true);
    } finally {
      repo.cleanup();
      fake.dir.cleanup();
    }
  }, SLOW);

  it("with GIT_SSH set to another program, the repository's own core.sshCommand still never runs", () => {
    const mine = fakeSsh();
    const theirs = fakeSsh();
    const repo = makeRepo();
    const empty = makeDir("lg-emptycfg-");
    try {
      repo.commit("one", { "a.txt": "x\n" });
      repo.git("remote", "add", "origin", "ssh://git@example.invalid/x.git");
      repo.git("config", "core.sshCommand", theirs.command);
      empty.write("gitconfig", "");
      vi.stubEnv("GIT_SSH_COMMAND", undefined);
      vi.stubEnv("GIT_SSH", join(mine.dir.root, "fake-ssh.cmd"));
      vi.stubEnv("GIT_CONFIG_GLOBAL", join(empty.root, "gitconfig"));
      vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
      checkReachability(repo.root);
      expect(existsSync(theirs.marker)).toBe(false);
    } finally {
      repo.cleanup();
      mine.dir.cleanup();
      theirs.dir.cleanup();
      empty.cleanup();
    }
  }, SLOW);

  it("does not call it with --offline", () => {
    const fake = fakeSsh();
    const repo = makeRepo();
    try {
      repo.commit("one", { "a.txt": "x\n" });
      repo.git("remote", "add", "origin", "ssh://git@example.invalid/x.git");
      vi.stubEnv("GIT_SSH_COMMAND", fake.command);
      checkReachability(repo.root, { offline: true });
      expect(existsSync(fake.marker)).toBe(false);
    } finally {
      repo.cleanup();
      fake.dir.cleanup();
    }
  }, SLOW);
});
