// Decides the result of the macOS workflow from the conclusions of its jobs. Run by the "macOS result" job.
//
// Rule: "macOS passed" means the tool works on a real Mac. So a macOS job that ran and FAILED blocks the merge, on any
// architecture. When GitHub assigns no Mac at all, nothing is known: the gate passes (a runner shortage must never force
// an administrator override) but says loudly that macOS was NOT verified on this commit. It never passes silently.
import { appendFileSync, readFileSync } from "node:fs";

const SELF = "macOS result";

/** Jobs from `gh api .../jobs --paginate --jq '.jobs[]'` (one JSON object per line) or one {"jobs": [...]} document. */
export function parseJobs(text) {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  if (trimmed.startsWith("{") && trimmed.includes('"jobs"') && !trimmed.includes("\n")) {
    const doc = JSON.parse(trimmed);
    if (Array.isArray(doc.jobs)) return doc.jobs;
  }
  return trimmed
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

const list = (jobs) => (jobs.length === 0 ? "none" : jobs.map((j) => `\`${j.name}\``).join(", "));

/** @returns {{code: 0 | 1, level: "error" | "warning" | "notice" | "none", title: string, summary: string}} */
export function decide(allJobs, selfName = SELF) {
  const jobs = allJobs.filter((j) => j.name !== selfName);
  const passed = jobs.filter((j) => j.conclusion === "success");
  const failed = jobs.filter((j) => j.conclusion === "failure");
  // A job the workflow skipped on purpose (a conditional job such as "only on a tag") is not a gap; cancelled or unfinished
  // jobs are (no runner was assigned).
  const skipped = jobs.filter((j) => j.conclusion === "skipped");
  const notRun = jobs.filter((j) => j.conclusion !== "success" && j.conclusion !== "failure" && j.conclusion !== "skipped");

  const lines = [
    "### macOS result",
    "",
    `- Passed on macOS: ${list(passed)}`,
    `- **Failed** on macOS: ${list(failed)}`,
    `- Not run (no runner was assigned, or the job was cancelled): ${list(notRun)}`,
    ...(skipped.length > 0 ? [`- Skipped on purpose (a conditional job): ${list(skipped)}`] : []),
    "",
  ];

  if (failed.length > 0) {
    return {
      code: 1,
      level: "error",
      title: "macOS tests failed",
      summary: [...lines, "A macOS job ran and failed, so this change may not work on a Mac. Fix it or look at the failing job."].join("\n"),
    };
  }
  if (passed.length === 0) {
    return {
      code: 0,
      level: "warning",
      title: "macOS was NOT run on this commit",
      summary: [
        ...lines,
        "**This change is not verified on macOS.** GitHub assigned no macOS runner (or there are no macOS jobs), so nothing was tested on a Mac.",
        "This check passes so that a runner shortage does not block merging, but the gap is real: say so in the release notes and re-run the macOS workflow by hand later.",
      ].join("\n"),
    };
  }
  if (notRun.length > 0) {
    return {
      code: 0,
      level: "notice",
      title: "macOS passed, but some jobs were not run",
      summary: [...lines, "macOS passed where it ran. The jobs listed as not run have no result for this commit."].join("\n"),
    };
  }
  return { code: 0, level: "none", title: "macOS passed", summary: [...lines, "Every macOS job that ran passed."].join("\n") };
}

/** Prints GitHub annotations and the job summary, and returns the exit code. */
export function report(result, summaryFile = process.env.GITHUB_STEP_SUMMARY) {
  if (result.level === "error") console.log(`::error title=${result.title}::${result.title}. See the job summary.`);
  else if (result.level === "warning") console.log(`::warning title=${result.title}::${result.title}. See the job summary.`);
  else if (result.level === "notice") console.log(`::notice title=${result.title}::${result.title}.`);
  console.log(result.summary);
  if (summaryFile) appendFileSync(summaryFile, `${result.summary}\n`);
  return result.code;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/macos-gate.mjs <jobs file>");
    process.exit(2);
  }
  process.exit(report(decide(parseJobs(readFileSync(file, "utf8")))));
}
