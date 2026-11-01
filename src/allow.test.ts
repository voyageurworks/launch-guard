import { describe, expect, it } from "vitest";
import { downgrade, isAllowed } from "./allow.js";

describe("isAllowed", () => {
  it("allow comment without a reason does not allow", () => {
    expect(isAllowed("const a = 1; // launch-guard-allow:", "")).toBe(false);
    expect(isAllowed("const a = 1; // launch-guard-allow:   ", "")).toBe(false);
    expect(isAllowed("const a = 1;", "// launch-guard-allow:")).toBe(false);
  });

  it("allow comment with a reason allows that line only", () => {
    expect(isAllowed("const a = 1; // launch-guard-allow: sample value", "")).toBe(true);
    expect(isAllowed("const a = 1;", "# launch-guard-allow: sample value")).toBe(true);
    // a marker trailing code does not leak onto the next line
    expect(isAllowed("const b = 2;", "const a = 1; // launch-guard-allow: x")).toBe(false);
    // a comment-only line allows the line right after it, not the one after that
    const lines = ["// launch-guard-allow: sample", "const a = 1;", "const b = 2;"];
    const at = (i: number): boolean => isAllowed(lines[i]!, lines[i - 1] ?? "");
    expect([at(1), at(2)]).toEqual([true, false]);
  });
});

describe("downgrade", () => {
  it("fixture paths downgrade block to warn", () => {
    expect(downgrade("test/a.ts", "block")).toBe("warn");
    expect(downgrade("tests/a.ts", "block")).toBe("warn");
    expect(downgrade("src/fixtures/a.json", "block")).toBe("warn");
    expect(downgrade("docs/examples/a.md", "block")).toBe("warn");
    expect(downgrade("pkg\\test\\a.ts", "block")).toBe("warn");
  });

  it("test files by name downgrade block to warn", () => {
    for (const p of [
      "src/note.test.ts",
      "a.spec.js",
      "x.test.tsx",
      "src/Note.TEST.ts",
      "pkg/foo_test.go",
      "pkg/test_foo.py",
      "src/__tests__/a.ts",
      "src/__fixtures__/a.json",
      "src/__mocks__/a.ts",
      "pkg/testdata/a.txt",
      "src/spec/a.rb",
      "src/specs/a.rb",
      "src\\note.test.ts",
      "src\\__tests__\\a.ts",
      "pkg\\testdata\\a.txt",
      "Pkg/Tests/a.ts",
      "Pkg/TestData/a.txt",
    ]) {
      expect(downgrade(p, "block"), p).toBe("warn");
    }
  });

  it("ordinary names that merely contain the letters stay block", () => {
    for (const p of [
      "src/latest.ts",
      "src/contest.ts",
      "src/attest.ts",
      "src/testament.ts",
      "src/protest.ts",
      "prospect.ts",
      "inspector.ts",
      "src/test.ts",
      "src/mytest.ts",
      "src/a.test",
      "src/atest_foo.py",
      "src/spec.ts",
      "src/specs.ts",
      "src/aspec/a.ts",
      "src\\latest.ts",
    ]) {
      expect(downgrade(p, "block"), p).toBe("block");
    }
  });

  it("never lowers a sensitive extension or an .env name, even inside test paths", () => {
    for (const p of [
      "prod_test.pem",
      "x.spec.env",
      "test_deploy.key",
      "tests/server.key",
      "spec/a.p12",
      "specs/a.pfx",
      "test/a.crt",
      "test/a.cer",
      "fixtures/a.jks",
      "fixtures/a.keystore",
      "test/a.asc",
      "test/a.gpg",
      "test/a.ppk",
      "test/a.kdbx",
      "test/a.PEM",
      "tests/.env",
      "tests/.env.local",
      "docs/examples/.env.production",
    ]) {
      expect(downgrade(p, "block"), p).toBe("block");
    }
    expect(downgrade("tests/a.ts", "block")).toBe("warn");
  });

  it("leaves other paths and other severities alone", () => {
    expect(downgrade("src/note.test.ts", "info")).toBe("info");
    expect(downgrade("src/note.test.ts", "warn")).toBe("warn");
    expect(downgrade("src/a.ts", "block")).toBe("block");
    expect(downgrade("src/latest/a.ts", "block")).toBe("block");
    expect(downgrade("test/a.ts", "info")).toBe("info");
    expect(downgrade("test/a.ts", "warn")).toBe("warn");
  });
});
