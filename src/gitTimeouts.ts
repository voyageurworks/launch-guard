/**
 * Upper bounds for the synchronous git calls. A git that hangs would otherwise freeze the tool with no output;
 * with a bound, the call fails and the caller shows its normal visible fallback (a note, never a silent pass).
 */

/** Quick read-only calls: rev-parse, ls-files, for-each-ref, rev-list, reflog, symbolic-ref, remote. */
export const GIT_QUICK_TIMEOUT_MS = 60_000;
/** One `git log -p` batch of commits, and `git fsck`: these read a lot of data. */
export const GIT_HEAVY_TIMEOUT_MS = 120_000;
/** True for the error Node raises when a child outlives its `timeout` (and is killed). */
export const isTimeout = (err: unknown): boolean => (err as NodeJS.ErrnoException | null)?.code === "ETIMEDOUT";
