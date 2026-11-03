import { describe, expect, it } from "vitest";
import { classifyLine } from "./secrets.js";

// Every fixture is built at run time so this file holds nothing key-shaped.
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const RAND = "k7Qz9XmP2vLw4RtYb8NcD3fGh6Js"; // random-looking filler, no real meaning

describe(".npmrc credentials", () => {
  it.each([
    ["registry token", `//registry.npmjs.org/:_auth` + `Token=${RAND}`],
    ["uuid style token", `//registry.example.org/:_auth` + `Token=` + "3f2a9c1e-8b4d-4e6f-a1c2-5d7e9f0a1b2c"],
    ["unscoped token", `_auth` + `Token=${RAND}`],
    ["base64 login", `_auth` + `=${b64("someuser:" + RAND)}`],
    ["scoped base64 login", `//registry.example.org/:_auth` + `=${b64("someuser:" + RAND)}`],
    ["password line", `//registry.example.org/:_pass` + `word=${b64(RAND)}`],
  ])("flags %s", (_n, line) => {
    expect(classifyLine(line)).toBe("secret format");
  });

  it.each([
    ["environment variable", `//registry.npmjs.org/:_auth` + "Token=${NPM_TOKEN}"],
    ["bare environment variable", `_auth` + "Token=$NPM_TOKEN"],
    ["empty", `_auth` + `Token=`],
    ["placeholder", `_auth` + `Token=your-token-here`],
    ["short", `_auth` + `Token=abc`],
  ])("does not flag %s", (_n, line) => {
    expect(classifyLine(line)).toBeNull();
  });

  it("does not treat a longer name that only ends the same way as an .npmrc line (the keyword rule may still judge it)", () => {
    expect(classifyLine(`my_auth` + `Token=${RAND}`)).not.toBe("secret format");
    expect(classifyLine(`my_auth` + `=${b64("someuser:" + RAND)}`)).not.toBe("secret format");
  });
});

describe("Docker config auth", () => {
  it("flags a base64 user:password in an auth field", () => {
    expect(classifyLine(`      "auth": "${b64("deploy:" + RAND)}"`)).toBe("secret format");
  });

  it("does not flag an auth field that is not user:password, or a placeholder login", () => {
    expect(classifyLine(`"auth": "${b64("justonewordwithnocolon" + RAND)}"`)).toBeNull();
    expect(classifyLine(`"auth": "${b64("user:password")}"`)).toBeNull();
    expect(classifyLine(`"auth": ""`)).toBeNull();
    expect(classifyLine(`"auth": "short"`)).toBeNull();
  });
});

describe("connection strings with a password field", () => {
  it("flags Server=...;Password=... even when the password is short", () => {
    expect(classifyLine(`Server=db.internal;Database=app;User Id=svc;Pass` + `word=Tr0ub4dor9;`)).toBe("secret format");
    expect(classifyLine(`jdbc:sqlserver://db.internal:1433;databaseName=app;user=svc;pass` + `word=Tr0ub4dor9;`)).not.toBeNull();
  });

  it("does not flag placeholders, templates, empty values or lines with no host-like field", () => {
    expect(classifyLine(`Server=db;Pass` + `word=password;`)).toBeNull();
    expect(classifyLine(`Server=db;Pass` + `word={DB_PASSWORD};`)).toBeNull();
    expect(classifyLine(`Server=db;Pass` + `word=${"${DB_PASSWORD}"};`)).toBeNull();
    expect(classifyLine(`Server=db;Pass` + `word=;`)).toBeNull();
    expect(classifyLine(`Pass` + `word=Tr0ub4dor9`)).toBeNull(); // no connection-string context: left to the keyword rule
  });
});

describe("existing coverage that the new rules rely on (kept as regression tests)", () => {
  it("still flags URL credentials, a private key block and a kubeconfig key", () => {
    expect(classifyLine(`mongodb+srv://svc:${RAND}@cluster.example.net/app`)).toBe("secret format");
    expect(classifyLine(`"private_key": "-----BEGIN ` + `PRIVATE KEY-----\\nMIIE"`)).toBe("secret format");
    expect(classifyLine(`    client-key-data: ${b64("-----BEGIN RSA " + "PRIVATE KEY-----" + RAND)}`)).not.toBeNull();
    expect(classifyLine(`    to` + `ken: ${RAND}`)).toBe("secret near keyword");
  });
});

describe("more provider token formats", () => {
  const cases: Array<[string, string]> = [
    ["PyPI", "pypi-" + "AgEIcHlwaS5vcmc" + "A".repeat(10) + "k7Qz9XmP2vLw4RtYb8NcD3fGh6Js" + "x1y2z3".repeat(3)],
    ["Docker personal access token", "dckr_" + "pat_" + "k7Qz9XmP2vLw4RtYb8NcD3fG"],
    ["Databricks", "dapi" + "0123456789abcdef0123456789abcdef"],
    ["Linear", "lin_" + "api_" + "k7Qz9XmP2vLw4RtYb8NcD3fGh6Js1a2b3c4d5e6f"],
    ["Grafana service account", "gl" + "sa_" + "k7Qz9XmP2vLw4RtYb8NcD3fGh6Js1a2b" + "_0a1b2c3d"],
    ["Postman", "PM" + "AK-" + "0123456789abcdef01234567" + "-" + "0123456789abcdef0123456789abcdef01"],
    ["NuGet", "oy" + "2" + "abcdefghijklmnopqrstuvwxyz234567abcdefghijk"],
  ];
  it.each(cases)("flags a %s token", (_n, token) => {
    expect(classifyLine(`value = "${token}"`)).toBe("secret format");
  });

  it("does not flag the bare prefixes", () => {
    for (const p of ["pypi-", "dapi", "lin_" + "api_", "gl" + "sa_", "PM" + "AK-", "dckr_" + "pat_"]) expect(classifyLine(p)).toBeNull();
  });
});
