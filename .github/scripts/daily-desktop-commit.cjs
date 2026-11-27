const DAY_MS = 24 * 60 * 60 * 1000;
const BEIJING_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const MAIN_UPDATES = new Set(["push", "force_push", "pr_merge", "merge_queue_merge"]);

async function selectDailyDesktopCommit(github, context) {
  // Use the original run's creation time so a rerun uses the same day.
  const { data: run } = await github.rest.actions.getWorkflowRun({
    ...context.repo,
    run_id: context.runId,
  });
  const manual = context.eventName === "workflow_dispatch";
  const date = new Date(Date.parse(run.created_at) + BEIJING_UTC_OFFSET_MS - (manual ? 0 : DAY_MS))
    .toISOString()
    .slice(0, 10);
  if (manual) return { date, sha: context.sha };

  const start = Date.parse(`${date}T00:00:00+08:00`);
  const end = start + DAY_MS;

  const pages = github.paginate.iterator("GET /repos/{owner}/{repo}/activity", {
    ...context.repo,
    direction: "desc",
    ref: "refs/heads/main",
    per_page: 100,
  });
  for await (const { data } of pages) {
    for (const activity of data) {
      const time = Date.parse(activity.timestamp);
      if (time < start) return { date, sha: "" };
      const inBuildDay = time >= start && time < end;
      if (
        !inBuildDay ||
        !MAIN_UPDATES.has(activity.activity_type) ||
        !activity.after ||
        activity.after === activity.before
      ) {
        continue;
      }
      if (activity.activity_type === "force_push") {
        const { data: comparison } = await github.rest.repos.compareCommitsWithBasehead({
          ...context.repo,
          basehead: `${activity.before}...${activity.after}`,
        });
        if (comparison.ahead_by === 0) continue;
      }
      return { date, sha: activity.after };
    }
  }
  return { date, sha: "" };
}

module.exports = { selectDailyDesktopCommit };
