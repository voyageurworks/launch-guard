// Monthly macOS report: reads the macOS workflow's recent runs, summarizes what really happened on macOS, and (when run by
// the monthly workflow) posts the summary as a comment on the repository's open "macOS CI:" tracking issue.
//
// It states facts only: counts, job names, run links and a fixed-wording status. Nothing from a repository's content is
// printed. The same script is used in every Voyageur Works repository.
//   QUIET            no real macOS failure and no run where macOS went unverified, in the last 30 days
//   WATCH            no real failure, but at least one run where no macOS job passed (no runner was assigned)
//   NEEDS ATTENTION  a macOS job really failed, or there were no macOS runs at all (the workflow may be disabled)
// "Recommend closing" needs 60 days with at least 4 runs, no failure and no run where macOS went unverified.
const GATE = "macOS result";
const DAY = 86_400_000;
const MARKER = "Monthly macOS report";

/** Splits a run's jobs into the macOS jobs by outcome. The gate job itself is never a macOS job. */
function classify(jobs) {
  const mac = jobs.filter((j) => j.name !== GATE);
  return {
    passed: mac.filter((j) => j.conclusion === "success"),
    failed: mac.filter((j) => j.conclusion === "failure"),
    skipped: mac.filter((j) => j.conclusion === "skipped"),
    noRunner: mac.filter((j) => j.conclusion !== "success" && j.conclusion !== "failure" && j.conclusion !== "skipped"),
  };
}

/** @param {Array<{id:number,event:string,created_at:string,html_url:string,jobs:Array<{name:string,conclusion:string|null}>}>} runs */
export function summarize(runs, now = new Date()) {
  const within = (days) => runs.filter((r) => now.getTime() - new Date(r.created_at).getTime() <= days * DAY);
  const runs30 = within(30);
  const runs60 = within(60);
  const info = (r) => ({ run: r, ...classify(r.jobs) });
  const i30 = runs30.map(info);
  const i60 = runs60.map(info);

  const notVerified = (list) => list.filter((x) => x.passed.length === 0);
  const failedRuns = (list) => list.filter((x) => x.failed.length > 0);
  const notVerified30 = notVerified(i30);
  const failed30 = failedRuns(i30);
  const notVerified60 = notVerified(i60);
  const failed60 = failedRuns(i60);

  let status = "QUIET";
  if (runs30.length === 0 || failed30.length > 0) status = "NEEDS ATTENTION";
  else if (notVerified30.length > 0) status = "WATCH";
  // Enough evidence means the runs really cover the 60 days: a young repository with many recent runs does not qualify.
  const spanDays = runs60.length === 0 ? 0 : Math.floor((now.getTime() - Math.min(...runs60.map((r) => new Date(r.created_at).getTime()))) / DAY);
  const recommendClose = status === "QUIET" && runs60.length >= 4 && spanDays >= 55 && failed60.length === 0 && notVerified60.length === 0;

  const totals = { passed: 0, failed: 0, noRunner: 0, skipped: 0 };
  const perJob = new Map();
  for (const x of i30) {
    for (const key of ["passed", "failed", "noRunner", "skipped"]) {
      totals[key] += x[key].length;
      for (const j of x[key]) {
        if (key === "skipped") continue;
        const row = perJob.get(j.name) ?? { passed: 0, failed: 0, noRunner: 0 };
        row[key]++;
        perJob.set(j.name, row);
      }
    }
  }
  const byEvent = {};
  for (const r of runs30) byEvent[r.event] = (byEvent[r.event] ?? 0) + 1;
  const date = now.toISOString().slice(0, 10);
  const link = (r) => `[run ${r.id}](${r.html_url}) (${r.event}, ${r.created_at.slice(0, 10)})`;

  const lines = [`## ${MARKER} (${date} UTC)`, "", `**Status: ${status}**`, ""];
  if (runs30.length === 0) {
    lines.push("No macOS runs in the last 30 days: the macOS workflow may be disabled (GitHub turns scheduled workflows off after 60 days without repository activity) or no pull requests were opened. Check the Actions tab.", "");
  } else {
    lines.push(
      `Last 30 days: ${runs30.length} macOS run(s) (${Object.entries(byEvent).map(([e, n]) => `${e} ${n}`).join(", ")}).`,
      `macOS jobs: passed ${totals.passed}, failed ${totals.failed}, no runner ${totals.noRunner}.`,
      "",
      "| Job | Passed | Failed | No runner |",
      "| --- | --- | --- | --- |",
      ...[...perJob.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, r]) => `| ${name} | ${r.passed} | ${r.failed} | ${r.noRunner} |`),
      "",
    );
    if (totals.skipped > 0) lines.push(`Skipped on purpose (conditional jobs): ${totals.skipped}.`, "");
  }
  if (failed30.length > 0) {
    lines.push("**Real macOS failures (a macOS job ran and failed):**", ...failed30.map((x) => `- ${link(x.run)}: ${x.failed.map((j) => j.name).join(", ")}`), "");
  }
  if (notVerified30.length > 0) {
    lines.push("**Runs where macOS was NOT verified (no macOS job passed, so no Mac was available):**", ...notVerified30.slice(0, 10).map((x) => `- ${link(x.run)}`), "");
  }
  if (recommendClose) {
    lines.push(`Recommend closing this issue: ${runs60.length} macOS runs in 60 days, no real failure and no run where macOS went unverified. The maintainer decides.`);
  } else if (status === "QUIET") {
    lines.push(`Quiet, but not yet enough evidence to recommend closing (needs runs spanning 60 days, at least 4 of them, no failure and no unverified run; the runs so far span only ${spanDays} days).`);
  } else if (status === "WATCH") {
    lines.push("Watch: GitHub gave no Mac for some runs. Re-run those by hand later (never in a loop); nothing is failing.");
  } else {
    lines.push("Needs attention: look at the runs above. This issue stays open.");
  }
  // The facts file is read by an automatic monthly reviewer, so it holds only fixed words and numbers: never a job name, title or any other text.
  const facts = { schema: 1, generated: date, status, passed: totals.passed, failed: totals.failed, noRunner: totals.noRunner, unverifiedRuns: notVerified30.length, recommendClose };
  return { status, recommendClose, notVerified30: notVerified30.length, failed30: failed30.length, facts, markdown: lines.join("\n") };
}

/** The number of the open "macOS CI:" tracking issue, ignoring pull requests, or null. */
export function pickIssue(issues) {
  const hit = issues.find((i) => !i.pull_request && /^macOS CI:/.test(i.title));
  return hit ? hit.number : null;
}

async function api(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${init.method ?? "GET"} ${path.split("?")[0]} failed: ${res.status}`);
  return res.json();
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const workflow = process.env.WORKFLOW ?? "macos.yml";
  const post = process.env.POST !== "false";
  if (!repo) throw new Error("GITHUB_REPOSITORY is required");
  if (post && !process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is required to post the comment");
  const since = new Date(Date.now() - 60 * DAY).toISOString().slice(0, 10);
  const listed = await api(`/repos/${repo}/actions/workflows/${workflow}/runs?status=completed&created=%3E%3D${since}&per_page=100`);
  const runs = [];
  for (const r of listed.workflow_runs.slice(0, 120)) {
    const j = await api(`/repos/${repo}/actions/runs/${r.id}/jobs?per_page=100&filter=latest`);
    runs.push({ id: r.id, event: r.event, created_at: r.created_at, html_url: r.html_url, jobs: j.jobs.map((x) => ({ name: x.name, conclusion: x.conclusion })) });
  }
  const result = summarize(runs);
  console.log(result.markdown);
  if (process.env.FACTS_OUT) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.env.FACTS_OUT, `${JSON.stringify(result.facts, null, 2)}\n`);
    console.log(`\nFacts written to ${process.env.FACTS_OUT}.`);
  }
  if (!post) return;
  const number = pickIssue(await api(`/repos/${repo}/issues?state=open&per_page=100`));
  if (number === null) throw new Error("no open issue whose title starts with 'macOS CI:' was found");
  await api(`/repos/${repo}/issues/${number}/comments`, { method: "POST", body: JSON.stringify({ body: result.markdown }), headers: { "content-type": "application/json" } });
  console.log(`\nPosted to issue #${number}.`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  main().catch((err) => {
    console.error(String(err?.message ?? err));
    process.exit(1);
  });
}
