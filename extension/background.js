/**
 * background.js — CodeStreak Service Worker
 *
 * Handles all GitHub API calls. Triggered by messages from content.js.
 *
 * On SUBMISSION_ACCEPTED:
 *   1. Load settings (token, username, repos) from chrome.storage.sync
 *   2. Check if submission already exists in submissions.json (dedup)
 *   3. Commit solution file to leetcode-journey repo
 *   4. Update data/submissions.json in leetcode-journey
 *   5. Trigger workflow_dispatch on CodeStreak repo (process.yml)
 *      → This regenerates stats, streak, achievements, README, SVGs
 *   6. Show a notification
 */

"use strict";

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SUBMISSION_ACCEPTED") {
    handleAccepted(message.submission)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => {
        console.error("[CodeStreak BG] Error:", err);
        sendResponse({ ok: false, error: err.message });
      });
    return true; // async response
  }
});

// ── Main handler ──────────────────────────────────────────────────────────────

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
  if (existingIds.has(submission.submission_id)) {
    console.log("[CodeStreak BG] Already synced:", submission.submission_id);
    return { status: "duplicate" };
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

  await github.upsertFile(targetRepo, codePath, submission.code || "# Code not available\n",
    `✅ Add solution: ${submission.problem.title}`);

  await github.upsertFile(targetRepo, readmePath, buildReadme(submission),
    `📝 Add README: ${submission.problem.title}`);

  // 3. Update submissions.json
  const submissions = await fetchSubmissionsDB(github, targetRepo);
  submissions.push(submission);
  await github.upsertFile(
    targetRepo,
    "data/submissions.json",
    JSON.stringify(submissions, null, 2),
    `📊 Update submissions.json — ${submission.problem.title}`
  );

  // 4. Trigger process workflow on CodeStreak engine repo
  try {
    await github.triggerWorkflow(engineRepo, "process.yml");
    console.log("[CodeStreak BG] Workflow triggered on", engineRepo);
  } catch (err) {
    console.warn("[CodeStreak BG] Could not trigger workflow:", err.message);
    // Non-fatal — solution is still saved
  }

  showNotification(
    `✅ ${submission.problem.title} synced!`,
    `Difficulty: ${submission.problem.difficulty} · Language: ${submission.language} · Dashboard updating…`
  );

  return { status: "synced", problem: submission.problem.title };
}

// ── GitHub API helper class ───────────────────────────────────────────────────

class GitHubAPI {
  constructor(token) {
    this.token = token;
    this.base  = "https://api.github.com";
  }

  async request(method, path, body = null) {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept:        "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`GitHub API ${method} ${path} → ${res.status}: ${err.message || res.statusText}`);
    }

    // 204 No Content
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
    const encoded  = btoa(unescape(encodeURIComponent(content))); // UTF-8 safe base64

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
        githubToken:    "",
        githubUsername: "",
        targetRepo:     "leetcode-journey",
        engineRepo:     "CodeStreak",
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
  const p       = sub.problem;
  const date    = sub.submitted_at?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const topics  = p.topics?.join(", ") || "—";
  const runtime = sub.runtime ? `- **Runtime**: ${sub.runtime}` : "";
  const memory  = sub.memory  ? `- **Memory**: ${sub.memory}`   : "";
  const perf    = (runtime || memory)
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
    type:    "basic",
    iconUrl: "icons/icon48.png",
    title,
    message,
  });
}

console.log("[CodeStreak] Background service worker started.");
