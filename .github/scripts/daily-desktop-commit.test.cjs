const assert = require("node:assert/strict");
const test = require("node:test");

const { selectDailyDesktopCommit } = require("./daily-desktop-commit.cjs");

const context = { repo: { owner: "fork-owner", repo: "repo" }, runId: 42 };

function githubWithActivity(...pages) {
  return {
    rest: {
      actions: {
        async getWorkflowRun() {
          return { data: { created_at: "2026-11-27T16:15:00Z" } };
        },
      },
    },
    paginate: {
      async *iterator() {
        for (const data of pages) yield { data };
      },
    },
  };
}

function activity(timestamp, after, activity_type = "push") {
  return { timestamp, before: "previous-sha", after, activity_type };
}

test("builds the manually selected commit on the Beijing day the run was requested", async () => {
  const github = githubWithActivity();
  github.paginate.iterator = () => {
    throw new Error("manual builds do not need repository activity");
  };

  assert.deepEqual(
    await selectDailyDesktopCommit(github, {
      ...context,
      eventName: "workflow_dispatch",
      sha: "selected-branch-sha",
    }),
    { date: "2026-11-28", sha: "selected-branch-sha" },
  );
});

test("selects the last main update within the previous Beijing day", async () => {
  const github = githubWithActivity(
    [activity("2026-11-27T16:01:00Z", "today"), activity("2026-11-27T16:00:00Z", "midnight")],
    [
      activity("2026-11-27T15:59:00Z", "last-yesterday", "pr_merge"),
      activity("2026-11-26T16:00:00Z", "start-of-yesterday"),
    ],
  );

  assert.deepEqual(await selectDailyDesktopCommit(github, context), {
    date: "2026-11-27",
    sha: "last-yesterday",
  });
});

test("leaves the build skipped when the day has no new commit on main", async () => {
  const github = githubWithActivity([
    activity("2026-11-27T16:01:00Z", "today"),
    activity("2026-11-27T15:00:00Z", "branch-created", "branch_creation"),
    activity("2026-11-26T15:59:00Z", "two-days-ago"),
  ]);

  assert.deepEqual(await selectDailyDesktopCommit(github, context), {
    date: "2026-11-27",
    sha: "",
  });
});

test("ignores a force push that only removes commits from main", async () => {
  const github = githubWithActivity([activity("2026-11-27T15:00:00Z", "older-sha", "force_push")]);
  github.rest.repos = {
    async compareCommitsWithBasehead() {
      return { data: { ahead_by: 0 } };
    },
  };

  assert.deepEqual(await selectDailyDesktopCommit(github, context), {
    date: "2026-11-27",
    sha: "",
  });
});

test("reports a failed activity lookup instead of skipping the build", async () => {
  const github = githubWithActivity();
  github.paginate.iterator = () => {
    throw new Error("activity API unavailable");
  };

  await assert.rejects(selectDailyDesktopCommit(github, context), /activity API unavailable/);
});
