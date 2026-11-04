// A real-user smoke test: pack this project, install the tarball into a clean folder, and run the installed
// `launch-guard` command on a throwaway package, the way a person would. Run after `pnpm build`. Works on any system;
// the macOS workflow runs it so that "macOS passed" means the tool works on a real Mac, not just that unit tests ran.
// Uses a fake key built at run time and an empty home, so it reads nothing private and prints nothing secret.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const windows = process.platform === "win32";
const root = process.cwd();
const work = mkdtempSync(join(tmpdir(), "lg-smoke-"));
const home = join(work, "home");
const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData"), XDG_CONFIG_HOME: join(home, ".config") };
mkdirSync(home);

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

function run(command, args, options = {}) {
  // npm and the installed command are .cmd shims on Windows, which Node can only start through a shell. A shell joins
  // the arguments into one line, so an argument with a space (a path, or a label like "secret format") must be quoted.
  const argv = windows ? args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args;
  const cmd = windows && /\s/.test(command) ? `"${command}"` : command;
  return spawnSync(cmd, argv, { encoding: "utf8", env, windowsHide: true, shell: windows, timeout: 180_000, ...options });
}

try {
  console.log(`machine: ${process.platform} ${process.arch}, node ${process.version}`);

  const pack = run("npm", ["pack", "--ignore-scripts", "--pack-destination", work], { cwd: root });
  const tgz = readdirSync(work).find((n) => n.endsWith(".tgz"));
  check(pack.status === 0 && tgz !== undefined, "npm pack builds the tarball");
  if (!tgz) throw new Error("no tarball");

  const consumer = join(work, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), '{"name":"consumer","version":"1.0.0","private":true}\n');
  const install = run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(work, tgz)], { cwd: consumer });
  check(install.status === 0, "the tarball installs into a clean folder");

  const bin = join(consumer, "node_modules", ".bin", "launch-guard");
  const help = run(bin, ["--help"], { cwd: consumer });
  check(help.status === 0 && /Usage: launch-guard/.test(help.stdout), "the installed command starts and prints its usage");

  // A package that would leak: a fake key built at run time and an assistant folder.
  const key = "AKI" + "A" + "ZQSMOKETEST7731" + "X"; // AKIA plus exactly 16 characters, so it is key-shaped
  const bad = join(work, "bad-pkg");
  mkdirSync(join(bad, ".claude"), { recursive: true });
  writeFileSync(join(bad, "package.json"), '{"name":"bad","version":"1.0.0"}\n');
  writeFileSync(join(bad, "index.js"), `module.exports = { aws: "${key}" };\n`);
  writeFileSync(join(bad, ".claude", "settings.local.json"), "{}\n");
  const leak = run(bin, [bad, "--pack", "--offline"], { cwd: consumer });
  const leakOut = `${leak.stdout}${leak.stderr}`;
  check(leak.status === 1, "--pack exits 1 for a package that would leak");
  check(/secret format/.test(leakOut) && /agent folder in package/.test(leakOut), "--pack reports the key and the assistant folder");
  check(!leakOut.includes(key), "the report never prints the key");

  // A clean package passes.
  const good = join(work, "good-pkg");
  mkdirSync(good);
  writeFileSync(join(good, "package.json"), '{"name":"good","version":"1.0.0","files":["index.js"]}\n');
  writeFileSync(join(good, "index.js"), "module.exports = 1;\n");
  const clean = run(bin, [good, "--pack", "--offline"], { cwd: consumer });
  check(clean.status === 0 && /RESULT: PASS/.test(clean.stdout), "--pack passes a clean package");

  const explain = run(bin, ["--explain", "secret format"], { cwd: consumer });
  check(explain.status === 0 && /What to do:/.test(explain.stdout), "--explain prints guidance");
} catch (err) {
  failures.push(String(err?.message ?? err));
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

if (failures.length > 0) {
  console.error(`\nsmoke test FAILED (${failures.length}): ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\nsmoke test passed");
