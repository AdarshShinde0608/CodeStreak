/**
 * background.js — CodeStreak Service Worker
 *
 * Handles all GitHub API calls and LeetCode API queries.
 *
 * Features:
 *   1. Event-based automatic sync (when content script detects an accepted submission)
 *   2. Manual Scan & Sync (fetches recent accepted submissions directly via browser session)
 *   3. LeetCode Submissions Log viewer
 *   4. Direct GitHub commits + triggering process.yml workflow
 */

"use strict";

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SUBMISSION_ACCEPTED") {
    handleAccepted(message.submission)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => {
        console.error("[CodeStreak BG] Error in SUBMISSION_ACCEPTED:", err);
        sendResponse({ ok: false, error: err.message });
      });
    return true; // async
  }

  if (message.type === "CHECK_LEETCODE_AUTH") {
    checkLeetCodeAuth()
      .then((status) => sendResponse({ ok: true, ...status }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "GET_SUBMISSION_LOGS") {
    getSubmissionLogs(message.limit || 20)
      .then((data) => sendResponse({ ok: true, ...data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "SYNC_RECENT_SUBMISSIONS") {
    syncRecentSubmissions(message.limit || 20)
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// ── Event-based handler (Real-time on solve) ──────────────────────────────────

async function handleAccepted(submission) {
  const settings = await loadSettings();

  if (!settings.githubToken) {
    showNotification("⚠️ CodeStreak not configured", "Open the extension popup and enter your GitHub token.");
    throw new Error("GitHub token not configured");
  }

  const github = new GitHubAPI(settings.githubToken);
  const targetRepo = `${settings.githubUsername}/${settings.targetRepo}`;
  const engineRepo = `${settings.githubUsername}/${settings.engineRepo}`;

  // 1. Dedup check
  const existingIds = await getExistingSubmissionIds(github, targetRepo);
  if (existingIds.has(String(submission.submission_id))) {
    console.log("[CodeStreak BG] Already synced:", submission.submission_id);
    return { status: "duplicate", message: "Already synced" };
  }

  showNotification(
    "🔄 CodeStreak syncing…",
    `Saving ${submission.problem.title} (${submission.problem.difficulty})`
  );

  // 2. Commit solution file
  const folderName = slugifyFolder(submission.problem.id, submission.problem.slug);
  const ext        = getExtension(submission.language);
  const codePath   = `solutions/${folderName}/solution.${ext}`;
  const readmePath = `solutions/${folderName}/README.md`;

  await github.upsertFile(
    targetRepo,
    codePath,
    submission.code || "# Code not available\n",
    `✅ Add solution: ${submission.problem.title}`
  );

  await github.upsertFile(
    targetRepo,
    readmePath,
    buildReadme(submission),
    `📝 Add README: ${submission.problem.title}`
  );

  // 3. Update submissions.json
  const submissions = await fetchSubmissionsDB(github, targetRepo);
  submissions.push(submission);
  await github.upsertFile(
    targetRepo,
    "data/submissions.json",
    JSON.stringify(submissions, null, 2),
    `📊 Update submissions.json — ${submission.problem.title}`
  );

  // 4. Update local storage statistics
  await updateLocalStats(submission, submissions.length);

  // 5. Trigger process workflow on CodeStreak engine repo
  try {
    await github.triggerWorkflow(engineRepo, "process.yml");
    console.log("[CodeStreak BG] Workflow process.yml triggered on", engineRepo);
  } catch (err) {
    console.warn("[CodeStreak BG] Could not trigger process.yml workflow:", err.message);
  }

  showNotification(
    `✅ ${submission.problem.title} synced!`,
    `Difficulty: ${submission.problem.difficulty} · Language: ${submission.language} · Dashboard updating…`
  );

  return { status: "synced", problem: submission.problem.title };
}

// ── LeetCode API Direct Access (Research & Implementation) ────────────────────

const GRAPHQL_URL = "https://leetcode.com/graphql/";
const SUBMISSIONS_URL = "https://leetcode.com/api/submissions/";

/**
 * Check if the browser currently has an active, authenticated LeetCode session.
 */
async function checkLeetCodeAuth() {
  try {
    const res = await fetch(SUBMISSIONS_URL + "?offset=0&limit=1", {
      credentials: "include",
    });

    if (res.status === 403 || res.status === 401) {
      return { isSignedIn: false, username: null };
    }

    if (res.ok) {
      const data = await res.json();
      return {
        isSignedIn: data.user_name ? true : true,
        username: data.user_name || "LeetCode User",
        totalSubmissions: data.count || 0,
      };
    }
  } catch (err) {
    console.warn("[CodeStreak BG] checkLeetCodeAuth error:", err);
  }
  return { isSignedIn: false, username: null };
}

/**
 * Fetch raw recent submissions from LeetCode using the active browser session.
 */
async function fetchRecentSubmissionsRaw(limit = 20) {
  const url = `${SUBMISSIONS_URL}?offset=0&limit=${limit}`;
  const res = await fetch(url, { credentials: "include" });

  if (!res.ok) {
    if (res.status === 403 || res.status === 401) {
      throw new Error("Please log in to leetcode.com in your browser first.");
    }
    throw new Error(`LeetCode submissions API returned HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.submissions_dump || [];
}

/**
 * Fetch problem metadata (frontend ID, difficulty, topics) via LeetCode GraphQL.
 */
async function fetchProblemMetadata(slug) {
  const query = `
    query problemDetail($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionFrontendId
        title
        titleSlug
        difficulty
        topicTags {
          name
        }
      }
    }
  `;

  try {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ query, variables: { titleSlug: slug } }),
    });

    if (!res.ok) return null;
    const json = await res.json();
    const q = json?.data?.question;
    if (!q) return null;

    return {
      id: parseInt(q.questionFrontendId, 10) || 0,
      title: q.title || slug.replace(/-/g, " "),
      slug: q.titleSlug || slug,
      difficulty: q.difficulty || "Unknown",
      topics: (q.topicTags || []).map((t) => t.name),
      url: `https://leetcode.com/problems/${slug}/`,
    };
  } catch (err) {
    console.warn("[CodeStreak BG] fetchProblemMetadata error:", err);
    return null;
  }
}

/**
 * Fetch detailed submission info (code, runtime, memory) via GraphQL.
 */
async function fetchSubmissionDetail(submissionId) {
  const query = `
    query submissionDetails($submissionId: Int!) {
      submissionDetails(submissionId: $submissionId) {
        runtime
        runtimePercentile
        memory
        memoryPercentile
        code
        lang {
          name
          verboseName
        }
      }
    }
  `;

  try {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ query, variables: { submissionId: parseInt(submissionId, 10) } }),
    });

    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.submissionDetails || null;
  } catch (err) {
    console.warn("[CodeStreak BG] fetchSubmissionDetail error:", err);
    return null;
  }
}

/**
 * Get submission logs combined with their GitHub sync status.
 */
async function getSubmissionLogs(limit = 20) {
  const settings = await loadSettings();
  let existingIds = new Set();

  if (settings.githubToken && settings.githubUsername) {
    try {
      const github = new GitHubAPI(settings.githubToken);
      const targetRepo = `${settings.githubUsername}/${settings.targetRepo}`;
      existingIds = await getExistingSubmissionIds(github, targetRepo);
    } catch (e) {
      console.warn("[CodeStreak BG] Could not fetch existing IDs for logs:", e.message);
    }
  }

  const rawList = await fetchRecentSubmissionsRaw(limit);

  const logs = rawList.map((item) => {
    const sid = String(item.id);
    const isAccepted = item.status_display === "Accepted";
    const isSynced = existingIds.has(sid);

    return {
      id: sid,
      title: item.title,
      slug: item.title_slug,
      status: item.status_display,
      isAccepted,
      isSynced,
      lang: item.lang,
      runtime: item.runtime,
      memory: item.memory,
      time: item.time,
      timestamp: item.timestamp,
    };
  });

  return { logs, total: logs.length };
}

/**
 * Scan LeetCode for accepted submissions and sync any missing ones to GitHub.
 */
async function syncRecentSubmissions(limit = 20) {
  const settings = await loadSettings();

  if (!settings.githubToken || !settings.githubUsername) {
    throw new Error("GitHub settings not configured. Please enter your GitHub token and username.");
  }

  const github = new GitHubAPI(settings.githubToken);
  const targetRepo = `${settings.githubUsername}/${settings.targetRepo}`;
  const engineRepo = `${settings.githubUsername}/${settings.engineRepo}`;

  // 1. Fetch existing GitHub submissions
  const existingSubmissions = await fetchSubmissionsDB(github, targetRepo);
  const existingIds = new Set(existingSubmissions.map((s) => String(s.submission_id)));

  // 2. Fetch LeetCode recent submissions
  const rawList = await fetchRecentSubmissionsRaw(limit);
  const acceptedList = rawList.filter((s) => s.status_display === "Accepted");

  const newSubmissionsToSync = acceptedList.filter((s) => !existingIds.has(String(s.id)));

  if (newSubmissionsToSync.length === 0) {
    return {
      syncedCount: 0,
      alreadySyncedCount: acceptedList.length,
      message: "Everything is up to date! No new accepted submissions found.",
    };
  }

  showNotification(
    "🔄 CodeStreak Syncing…",
    `Found ${newSubmissionsToSync.length} new accepted submission(s). Syncing now…`
  );

  let syncedCount = 0;

  for (const raw of newSubmissionsToSync) {
    const sid = String(raw.id);
    const slug = raw.title_slug;

    // Fetch question metadata
    let problemMeta = await fetchProblemMetadata(slug);
    if (!problemMeta) {
      problemMeta = {
        id: 0,
        title: raw.title || slug.replace(/-/g, " "),
        slug: slug,
        difficulty: "Unknown",
        topics: [],
        url: `https://leetcode.com/problems/${slug}/`,
      };
    }

    // Fetch code from details or dump
    let code = raw.code || "";
    let runtimePercentile = null;
    let memoryPercentile = null;

    if (!code) {
      const details = await fetchSubmissionDetail(sid);
      if (details) {
        code = details.code || "";
        runtimePercentile = details.runtimePercentile || null;
        memoryPercentile = details.memoryPercentile || null;
      }
    }

    const isoDate = raw.timestamp
      ? new Date(raw.timestamp * 1000).toISOString().replace(/\.\d+/, "")
      : new Date().toISOString().replace(/\.\d+/, "");

    const normalized = {
      submission_id: sid,
      problem: problemMeta,
      language: raw.lang || "unknown",
      status: "Accepted",
      submitted_at: isoDate,
      runtime: raw.runtime || null,
      memory: raw.memory || null,
      runtime_percentile: runtimePercentile,
      memory_percentile: memoryPercentile,
      code: code,
    };

    // Commit solution files to leetcode-journey
    const folderName = slugifyFolder(problemMeta.id, problemMeta.slug);
    const ext = getExtension(raw.lang);
    const codePath = `solutions/${folderName}/solution.${ext}`;
    const readmePath = `solutions/${folderName}/README.md`;

    try {
      await github.upsertFile(
        targetRepo,
        codePath,
        code || "# Code not available\n",
        `✅ Add solution: ${problemMeta.title}`
      );

      await github.upsertFile(
        targetRepo,
        readmePath,
        buildReadme(normalized),
        `📝 Add README: ${problemMeta.title}`
      );

      existingSubmissions.push(normalized);
      existingIds.add(sid);
      syncedCount++;
    } catch (err) {
      console.error(`[CodeStreak BG] Failed to sync ${problemMeta.title}:`, err);
    }
  }

  // Save updated submissions.json
  if (syncedCount > 0) {
    await github.upsertFile(
      targetRepo,
      "data/submissions.json",
      JSON.stringify(existingSubmissions, null, 2),
      `📊 Sync ${syncedCount} new submission(s) from LeetCode`
    );

    // Update local stats
    const lastSub = newSubmissionsToSync[0];
    await updateLocalStats(lastSub, existingSubmissions.length);

    // Trigger process.yml
    try {
      await github.triggerWorkflow(engineRepo, "process.yml");
    } catch (err) {
      console.warn("[CodeStreak BG] Workflow trigger warning:", err.message);
    }

    showNotification(
      `🎉 ${syncedCount} Problem(s) Synced!`,
      `Successfully updated ${targetRepo} and regenerated dashboard.`
    );
  }

  return {
    syncedCount,
    totalAccepted: acceptedList.length,
    message: `Successfully synced ${syncedCount} new problem(s)!`,
  };
}

// ── GitHub API helper class ───────────────────────────────────────────────────

class GitHubAPI {
  constructor(token) {
    this.token = token;
    this.base = "https://api.github.com";
  }

  async request(method, path, body = null) {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`GitHub API ${method} ${path} → ${res.status}: ${err.message || res.statusText}`);
    }

    if (res.status === 204) return null;
    return res.json();
  }

  async getFile(repo, path) {
    try {
      return await this.request("GET", `/repos/${repo}/contents/${path}`);
    } catch (err) {
      if (err.message.includes("404")) return null;
      throw err;
    }
  }

  async upsertFile(repo, path, content, message) {
    const existing = await this.getFile(repo, path);
    const encoded = btoa(unescape(encodeURIComponent(content))); // UTF-8 safe base64

    const body = { message, content: encoded };
    if (existing?.sha) body.sha = existing.sha;

    return this.request("PUT", `/repos/${repo}/contents/${path}`, body);
  }

  async triggerWorkflow(repo, workflowFile, inputs = {}) {
    return this.request("POST", `/repos/${repo}/actions/workflows/${workflowFile}/dispatches`, {
      ref: "main",
      inputs,
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      {
        githubToken: "",
        githubUsername: "",
        targetRepo: "leetcode-journey",
        engineRepo: "CodeStreak",
      },
      resolve
    );
  });
}

async function updateLocalStats(lastSubmission, totalCount) {
  const p = lastSubmission.problem || lastSubmission;
  return new Promise((resolve) => {
    chrome.storage.sync.set(
      {
        syncCount: totalCount,
        lastSyncTime: new Date().toISOString(),
        lastProblemTitle: p.title || p.slug,
        lastProblemDiff: p.difficulty || "Easy",
        lastProblemLang: lastSubmission.language || lastSubmission.lang || "python3",
      },
      resolve
    );
  });
}

async function fetchSubmissionsDB(github, repo) {
  const file = await github.getFile(repo, "data/submissions.json");
  if (!file) return [];
  try {
    const decoded = decodeURIComponent(escape(atob(file.content.replace(/\n/g, ""))));
    return JSON.parse(decoded);
  } catch {
    return [];
  }
}

async function getExistingSubmissionIds(github, repo) {
  const subs = await fetchSubmissionsDB(github, repo);
  return new Set(subs.map((s) => String(s.submission_id)));
}

function slugifyFolder(id, slug) {
  return `${String(id).padStart(4, "0")}-${slug}`;
}

const LANG_EXT = {
  python: "py", python3: "py", c: "c", cpp: "cpp", java: "java",
  javascript: "js", typescript: "ts", csharp: "cs", golang: "go",
  kotlin: "kt", swift: "swift", rust: "rs", ruby: "rb", scala: "scala",
  php: "php", mysql: "sql", mssql: "sql", oraclesql: "sql", bash: "sh",
};

function getExtension(lang) {
  return LANG_EXT[lang?.toLowerCase()] || "txt";
}

function buildReadme(sub) {
  const p = sub.problem;
  const date = sub.submitted_at?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const topics = p.topics?.join(", ") || "—";
  const runtime = sub.runtime ? `- **Runtime**: ${sub.runtime}` : "";
  const memory = sub.memory ? `- **Memory**: ${sub.memory}` : "";
  const perf = (runtime || memory)
    ? `\n## Performance\n\n${[runtime, memory].filter(Boolean).join("\n")}\n`
    : "";

  return `# ${p.title}

| Field | Value |
|-------|-------|
| **Problem #** | ${p.id} |
| **Difficulty** | ${p.difficulty} |
| **Language** | ${sub.language} |
| **Topics** | ${topics} |
| **Date Solved** | ${date} |
| **LeetCode** | [Link](${p.url}) |

## Approach

> _Add your approach notes here._

## Complexity

- **Time**: O(?)
- **Space**: O(?)
${perf}`;
}

function showNotification(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title,
    message,
  });
}

console.log("[CodeStreak] Background service worker initialized with Manual Sync & Live Interception.");
