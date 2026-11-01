#!/usr/bin/env node
import { main } from "./cli.js";

// A closed pipe must not turn into an uncaught error (and a stack trace); main still decides the exit code.
process.stdout.on("error", () => undefined);
process.stderr.on("error", () => undefined);

process.exitCode = await main(process.argv.slice(2), {
  out: (s) => void process.stdout.write(s),
  err: (s) => void process.stderr.write(s),
});
