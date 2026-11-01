import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { makeBareRemote, makeRepo } from "../testRepos.js";
import { checkReachability } from "./reachability.js";

const SLOW = 120_000;

describe("checkReachability", () => {
  it("flags refs/original left by a history rewrite", () => {
    const repo = makeRepo();
    try {
      repo.commit("one", { "a.txt": "x" });
      repo.git("update-ref", "refs/original/refs/heads/main", "HEAD");
      const found = checkReachability(repo.root).filter((f) => f.label === "recommend a fresh repository");
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ category: "reachability", severity: "block", line: null, entry: null });
      expect(found[0].file).toMatch(/^ref #\d+$/);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("flags unreachable commits, extra tags and stash without printing names or ids", () => {
    const repo = makeRepo();
    try {
      repo.commit("one", { "a.txt": "x" });
      const orphan = repo.git("commit-tree", "HEAD^{tree}", "-m", "orphan").trim();
      repo.git("tag", "zq-sentinel-tag");
      const found = checkReachability(repo.root);
      expect(found.some((f) => f.severity === "warn" && f.label === "unreachable object" && /^\d+ objects?$/.test(f.file))).toBe(true);
      expect(found.some((f) => f.severity === "block")).toBe(false);
      expect(found.some((f) => f.severity === "warn" && f.label === "extra ref" && /^ref #\d+$/.test(f.file))).toBe(true);
      const text = JSON.stringify(found);
      expect(text).not.toContain("zq-sentinel-tag");
      expect(text).not.toContain(orphan);
      expect(text).not.toContain(orphan.slice(0, 7));
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("a re-staged file leaves an unreachable blob that only warns", () => {
    const repo = makeRepo();
    try {
      repo.commit("one", { "a.txt": "x" });
      repo.write("a.txt", "second version");
      repo.git("add", "a.txt");
      repo.write("a.txt", "third version");
      repo.git("add", "a.txt");
      const found = checkReachability(repo.root);
      const objects = found.filter((f) => f.label === "unreachable object");
      expect(objects.length).toBeGreaterThan(0);
      for (const f of objects) expect(f).toMatchObject({ category: "reachability", severity: "warn", line: null, entry: null });
      expect(found.some((f) => f.severity === "block")).toBe(false);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("flags pull-request refs on the remote", () => {
    const repo = makeRepo();
    const bare = makeBareRemote();
    try {
      repo.commit("one", { "a.txt": "x" });
      repo.git("remote", "add", "origin", bare.root);
      repo.git("push", "-q", "origin", "HEAD");
      bare.git("update-ref", "refs/pull/1/head", repo.git("rev-parse", "HEAD").trim());
      const found = checkReachability(repo.root);
      const hit = found.filter((f) => f.label === "recommend a fresh repository");
      expect(hit).toHaveLength(1);
      expect(hit[0]).toMatchObject({ severity: "block", category: "reachability" });
      expect(hit[0].file).toMatch(/^remote ref #\d+$/);
      const text = JSON.stringify(found);
      expect(text).not.toContain(basename(bare.root));
      expect(text).not.toContain(JSON.stringify(bare.root).slice(1, -1));
    } finally {
      repo.cleanup();
      bare.cleanup();
    }
  }, SLOW);

  it("offline mode never contacts the remote and says so", () => {
    const repo = makeRepo();
    const bare = makeBareRemote();
    try {
      repo.commit("one", { "a.txt": "x" });
      repo.git("remote", "add", "origin", bare.root);
      repo.git("push", "-q", "origin", "HEAD");
      bare.git("update-ref", "refs/pull/1/head", repo.git("rev-parse", "HEAD").trim());
      const found = checkReachability(repo.root, { offline: true });
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ category: "reachability", severity: "info", label: "remote not checked" });
    } finally {
      repo.cleanup();
      bare.cleanup();
    }
  }, SLOW);

  it("an unreachable remote gives an info finding without error text", () => {
    const repo = makeRepo();
    try {
      repo.commit("one", { "a.txt": "x" });
      repo.git("remote", "add", "origin", "/nonexistent/zq-sentinel-remote");
      const found = checkReachability(repo.root);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ severity: "info", label: "remote not checked" });
      expect(JSON.stringify(found)).not.toContain("zq-sentinel-remote");
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("no remote gives an info finding, not a pass", () => {
    const repo = makeRepo();
    try {
      repo.commit("one", { "a.txt": "x" });
      const found = checkReachability(repo.root);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ category: "reachability", severity: "info", label: "no remote" });
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("clean fresh repo gives no findings", () => {
    const repo = makeRepo();
    const bare = makeBareRemote();
    try {
      repo.commit("one", { "a.txt": "x" });
      repo.git("remote", "add", "origin", bare.root);
      repo.git("push", "-q", "origin", "HEAD");
      expect(checkReachability(repo.root)).toEqual([]);
    } finally {
      repo.cleanup();
      bare.cleanup();
    }
  }, SLOW);
});
