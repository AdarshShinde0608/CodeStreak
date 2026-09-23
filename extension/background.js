/**
 * background.js — CodeStreak Service Worker
 *
 * Full-featured LeetCode to GitHub Sync & Real-Time Dashboard Generator.
 *
 * Features:
 *   1. Event-based automatic sync (captures submissions on submit)
 *   2. Manual Scan & Sync (scans recent submissions via active browser session)
 *   3. Direct Generation of README.md, SVGs, statistics.json, streak.json, achievements.json
 *      -> Instantly pushes the full updated dashboard directly to leetcode-journey!
 *   4. Triggers process.yml workflow on CodeStreak as secondary verification
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
    return true;
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

  // Enrich metadata if needed
  if (!submission.problem.id || submission.problem.difficulty === "Unknown" || !submission.problem.topics?.length) {
    try {
      const meta = await fetchProblemMetadata(submission.problem.slug);
      if (meta) {
        if (meta.id) submission.problem.id = meta.id;
        if (meta.title) submission.problem.title = meta.title;
        if (meta.difficulty && meta.difficulty !== "Unknown") submission.problem.difficulty = meta.difficulty;
        if (meta.topics?.length) submission.problem.topics = meta.topics;
      }
    } catch (_) {}
  }

  // Enrich code if needed
  if (!submission.code && submission.submission_id && !submission.submission_id.startsWith("dom_")) {
    try {
      const details = await fetchSubmissionDetail(submission.submission_id);
      if (details) {
        if (details.code) submission.code = details.code;
        if (details.runtimePercentile) submission.runtime_percentile = details.runtimePercentile;
        if (details.memoryPercentile) submission.memory_percentile = details.memoryPercentile;
      }
    } catch (_) {}
  }

  showNotification(
    "🔄 CodeStreak syncing…",
    `Saving ${submission.problem.title} (${formatLangName(submission.language)})`
  );

  // 1. Fetch existing submissions from target repo
  const existingSubmissions = await fetchSubmissionsDB(github, targetRepo);

  // Update or append in submissions list
  // Match by (problem slug AND language) to ensure latest code is kept for each language
  const subIndex = existingSubmissions.findIndex(
      (s) => normalizePlatform(s.platform) === normalizePlatform(submission.platform) &&
        (s.problem?.slug === submission.problem.slug || String(s.problem?.id) === String(submission.problem.id)) &&
           (s.language?.toLowerCase() === submission.language?.toLowerCase())
  );

  if (subIndex >= 0) {
    existingSubmissions[subIndex] = submission;
    console.log(`[CodeStreak BG] Updated existing solution: ${submission.problem.title} (${submission.language})`);
  } else {
    existingSubmissions.push(submission);
    console.log(`[CodeStreak BG] Added new solution: ${submission.problem.title} (${submission.language})`);
  }

  // 2. Commit solution file & solution README
  const platform    = normalizePlatform(submission.platform);
  const folderName = slugifyFolder(submission.problem.id, submission.problem.slug, platform);
  const ext        = getExtension(submission.language);
  const codePath   = `solutions/${platform}/${folderName}/solution.${ext}`;
  const readmePath = `solutions/${platform}/${folderName}/README.md`;

  // Always write/update the solution file with the latest code for this language
  await github.upsertFile(
    targetRepo,
    codePath,
    submission.code || "# Code not available\n",
    `✅ Update solution: ${submission.problem.title} (${formatLangName(submission.language)})`
  );

  // Update README listing all available language solutions for this problem
  await github.upsertFile(
    targetRepo,
    readmePath,
    buildProblemReadme(submission, existingSubmissions),
    `📝 Update README: ${submission.problem.title}`
  );

  // 3. Regenerate and push full dashboard (README.md, data files, SVGs)
  await pushCompleteDashboard(github, settings, existingSubmissions);

  // 4. Update local storage statistics
  await updateLocalStats(submission, existingSubmissions.length);

  // 5. Trigger process workflow on engine repo (background verification)
  try {
    await github.triggerWorkflow(engineRepo, "process.yml");
  } catch (err) {
    console.warn("[CodeStreak BG] Workflow trigger warning:", err.message);
  }

  showNotification(
    `✅ ${submission.problem.title} synced!`,
    `Dashboard updated in ${settings.targetRepo}`
  );

  return { status: "synced", problem: submission.problem.title };
}

// ── Manual Scan & Sync Submissions ────────────────────────────────────────────

async function syncRecentSubmissions(limit = 50) {
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

  // 2. Fetch LeetCode recent submissions via browser session
  const rawList = await fetchRecentSubmissionsRaw(limit);
  const acceptedList = rawList.filter((s) => s.status_display === "Accepted");

  let syncedCount = 0;

  for (const raw of acceptedList) {
    const sid = String(raw.id);
    const slug = raw.title_slug;
    const lang = raw.lang || "unknown";

    // Find if already present for this problem and language
    const existingIndex = existingSubmissions.findIndex(
      (s) => (s.problem?.slug === slug) && (s.language?.toLowerCase() === lang.toLowerCase())
    );

    // If already exists with the exact same submission_id, skip re-uploading file
    if (existingIndex >= 0 && String(existingSubmissions[existingIndex].submission_id) === sid) {
      continue;
    }

    // Fetch question metadata if needed
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

    // Fetch code from details or raw dump
    let code = raw.code || "";
    let runtimePercentile = null;
    let memoryPercentile = null;

    const details = await fetchSubmissionDetail(sid);
    if (details) {
      if (details.code) code = details.code;
      runtimePercentile = details.runtimePercentile || null;
      memoryPercentile = details.memoryPercentile || null;
    }

    const isoDate = raw.timestamp
      ? new Date(raw.timestamp * 1000).toISOString().replace(/\.\d+/, "")
      : new Date().toISOString().replace(/\.\d+/, "");

    const normalized = {
      submission_id: sid,
      problem: problemMeta,
      platform: "leetcode",
      language: lang,
      status: "Accepted",
      submitted_at: isoDate,
      runtime: raw.runtime || null,
      memory: raw.memory || null,
      runtime_percentile: runtimePercentile,
      memory_percentile: memoryPercentile,
      code: code,
    };

    // Commit solution files to leetcode-journey (platform-scoped)
    const platform = normalizePlatform(normalized.platform);
    const folderName = slugifyFolder(problemMeta.id, problemMeta.slug, platform);
    const ext = getExtension(lang);
    const codePath = `solutions/${platform}/${folderName}/solution.${ext}`;
    const readmePath = `solutions/${platform}/${folderName}/README.md`;

    try {
      // Write / update solution file
      await github.upsertFile(
        targetRepo,
        codePath,
        code || "# Code not available\n",
        `✅ Update solution: ${problemMeta.title} (${formatLangName(lang)})`
      );

      if (existingIndex >= 0) {
        existingSubmissions[existingIndex] = normalized;
      } else {
        existingSubmissions.push(normalized);
      }
      existingIds.add(sid);

      // Write / update problem README
      await github.upsertFile(
        targetRepo,
        readmePath,
        buildProblemReadme(normalized, existingSubmissions),
        `📝 Update README: ${problemMeta.title}`
      );

      syncedCount++;
    } catch (err) {
      console.error(`[CodeStreak BG] Failed to sync ${problemMeta.title}:`, err);
    }
  }

  // 3. Regenerate and commit full dashboard (README.md, data files, and SVGs)
  if (existingSubmissions.length > 0) {
    await pushCompleteDashboard(github, settings, existingSubmissions);
  }

  // 4. Update local storage stats
  const lastSub = existingSubmissions[existingSubmissions.length - 1];
  if (lastSub) {
    await updateLocalStats(lastSub, existingSubmissions.length);
  }

  // 5. Trigger process.yml
  try {
    await github.triggerWorkflow(engineRepo, "process.yml");
  } catch (err) {
    console.warn("[CodeStreak BG] Workflow trigger warning:", err.message);
  }

  showNotification(
    `🎉 Sync Complete!`,
    syncedCount > 0 ? `Synced/updated ${syncedCount} solution(s) in ${targetRepo}` : `Dashboard is fully up-to-date!`
  );

  return {
    syncedCount,
    totalAccepted: acceptedList.length,
    message: `Successfully synced ${syncedCount} problem solution(s) and updated your dashboard!`,
  };
}

// ── Complete Dashboard Generator & Pusher (JavaScript Native) ─────────────────

async function pushCompleteDashboard(github, settings, submissions) {
  const targetRepo = `${settings.githubUsername}/${settings.targetRepo}`;
  const username   = settings.githubUsername;
  const engineRepo = settings.engineRepo || "CodeStreak";

  // 1. Calculate Stats, Streak, Achievements
  const stats        = calculateStats(submissions);
  const streak       = calculateStreak(submissions);
  const achievements = calculateAchievements(stats, streak);

  // 2. Generate Main README.md content
  const readmeMd = generateMainReadme(stats, streak, achievements, submissions, username, engineRepo);

  // 3. Generate SVGs
  const difficultySvg = generateDifficultySvg(stats.easy, stats.medium, stats.hard);
  const languagesSvg  = generateLanguagesSvg(stats.byLanguage);
  const heatmapSvg    = generateHeatmapSvg(streak.dailyActivity);

  // 4. Commit all files to leetcode-journey
  const filesToCommit = [
    { path: "README.md", content: readmeMd, msg: "📊 Update dashboard README" },
    { path: "data/submissions.json", content: JSON.stringify(submissions, null, 2), msg: "📊 Update submissions.json" },
    { path: "data/statistics.json", content: JSON.stringify(stats, null, 2), msg: "📊 Update statistics.json" },
    { path: "data/streak.json", content: JSON.stringify(streak, null, 2), msg: "📊 Update streak.json" },
    { path: "data/achievements.json", content: JSON.stringify(achievements, null, 2), msg: "📊 Update achievements.json" },
    { path: "assets/difficulty.svg", content: difficultySvg, msg: "📊 Update difficulty.svg" },
    { path: "assets/languages.svg", content: languagesSvg, msg: "📊 Update languages.svg" },
    { path: "assets/heatmap.svg", content: heatmapSvg, msg: "📊 Update heatmap.svg" },
  ];

  for (const file of filesToCommit) {
    try {
      await github.upsertFile(targetRepo, file.path, file.content, file.msg);
    } catch (e) {
      console.warn(`[CodeStreak BG] Failed to commit ${file.path}:`, e.message);
    }
  }

  console.log("[CodeStreak BG] Full dashboard files committed directly to", targetRepo);
}

// ── Pure JS Statistics Engine ─────────────────────────────────────────────────

function calculateStats(submissions) {
  // Deduplicate by problem slug for total solved and difficulty counts
  const seenProblems = new Map();
  const sorted = [...submissions].sort((a, b) => (a.submitted_at > b.submitted_at ? 1 : -1));

  for (const sub of sorted) {
    const platform = normalizePlatform(sub.platform);
    const slug = sub.problem?.slug || String(sub.submission_id);
    const key = `${platform}:${slug}`;
    if (!seenProblems.has(key)) {
      seenProblems.set(key, sub);
    }
  }

  const uniqueSubs = Array.from(seenProblems.values());
  const byDifficulty = { easy: 0, medium: 0, hard: 0 };
  const byLanguage   = {};
  const byTopic      = {};
  const byPlatform   = {};
  const perDay       = {};
  const perMonth     = {};
  const perYear      = {};
  const dates        = [];

  for (const sub of uniqueSubs) {
    const platform = normalizePlatform(sub.platform);
    byPlatform[platform] = (byPlatform[platform] || 0) + 1;
    const diff = (sub.problem?.difficulty || "Easy").toLowerCase();
    if (byDifficulty[diff] !== undefined) byDifficulty[diff]++;

    for (const t of sub.problem?.topics || []) {
      byTopic[t] = (byTopic[t] || 0) + 1;
    }

    const localDate = sub.submitted_at?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    dates.push(localDate);
    perDay[localDate] = (perDay[localDate] || 0) + 1;

    const mKey = localDate.slice(0, 7);
    perMonth[mKey] = (perMonth[mKey] || 0) + 1;

    const yKey = localDate.slice(0, 4);
    perYear[yKey] = (perYear[yKey] || 0) + 1;
  }

  // Count each distinct (slug, language) solve for language distribution
  const seenLangSolves = new Set();
  for (const sub of submissions) {
    const platform = normalizePlatform(sub.platform);
    const slug = sub.problem?.slug || String(sub.submission_id);
    const lang = (sub.language || "unknown").toLowerCase();
    const key = `${platform}:${slug}:${lang}`;
    if (!seenLangSolves.has(key)) {
      seenLangSolves.add(key);
      byLanguage[lang] = (byLanguage[lang] || 0) + 1;
    }
  }

  // Sort language and topics by frequency
  const sortedLang = Object.fromEntries(Object.entries(byLanguage).sort((a, b) => b[1] - a[1]));
  const sortedTopic = Object.fromEntries(Object.entries(byTopic).sort((a, b) => b[1] - a[1]));

  return {
    totalSolved: uniqueSubs.length,
    easy: byDifficulty.easy,
    medium: byDifficulty.medium,
    hard: byDifficulty.hard,
    byLanguage: sortedLang,
    byPlatform,
    byTopic: sortedTopic,
    perDay,
    perMonth,
    perYear,
    firstSolved: dates.length ? dates.sort()[0] : null,
    latestSolved: dates.length ? dates.sort()[dates.length - 1] : null,
    generatedAt: new Date().toISOString(),
  };
}

// ── Pure JS Streak Engine ─────────────────────────────────────────────────────

function calculateStreak(submissions, dailyGoal = 1) {
  const dailyActivity = {};
  const todayStr = new Date().toISOString().slice(0, 10);

  for (const sub of submissions) {
    const d = sub.submitted_at?.slice(0, 10) || todayStr;
    dailyActivity[d] = (dailyActivity[d] || 0) + 1;
  }

  const activeDates = Object.keys(dailyActivity).sort();
  const activeDateSet = new Set(activeDates);

  // Current streak
  let currentStreak = 0;
  let streakStartDate = null;
  let check = new Date();

  // If today has submission, count from today; else check yesterday
  let checkStr = check.toISOString().slice(0, 10);
  if (!activeDateSet.has(checkStr)) {
    check.setDate(check.getDate() - 1);
    checkStr = check.toISOString().slice(0, 10);
  }

  while (activeDateSet.has(checkStr)) {
    currentStreak++;
    streakStartDate = checkStr;
    check.setDate(check.getDate() - 1);
    checkStr = check.toISOString().slice(0, 10);
  }

  // Longest streak
  let longestStreak = 0;
  let cur = 0;
  let prevDate = null;

  for (const dStr of activeDates) {
    const curDate = new Date(dStr + "T00:00:00Z");
    if (prevDate) {
      const diffDays = Math.round((curDate - prevDate) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        cur++;
      } else {
        cur = 1;
      }
    } else {
      cur = 1;
    }
    prevDate = curDate;
    if (cur > longestStreak) longestStreak = cur;
  }

  const todayCount = dailyActivity[todayStr] || 0;

  return {
    currentStreak,
    longestStreak,
    lastSolvedDate: activeDates.length ? activeDates[activeDates.length - 1] : null,
    streakStartDate,
    dailyActivity,
    totalActiveDays: activeDates.length,
    todaySolved: todayCount,
    dailyGoal,
    dailyGoalMet: todayCount >= dailyGoal,
    generatedAt: new Date().toISOString(),
  };
}

// ── Pure JS Achievements Engine ───────────────────────────────────────────────

function calculateAchievements(stats, streak) {
  const allAchievements = [
    { id: "first_problem", title: "First Problem", emoji: "🎯", description: "Solve your first problem", type: "problems", threshold: 1 },
    { id: "problems_10", title: "10 Problems", emoji: "🏆", description: "Solve 10 problems", type: "problems", threshold: 10 },
    { id: "problems_25", title: "25 Problems", emoji: "🏆", description: "Solve 25 problems", type: "problems", threshold: 25 },
    { id: "problems_50", title: "50 Problems", emoji: "🏆", description: "Solve 50 problems", type: "problems", threshold: 50 },
    { id: "problems_100", title: "100 Problems", emoji: "🏆", description: "Solve 100 problems", type: "problems", threshold: 100 },
    { id: "problems_250", title: "250 Problems", emoji: "🏆", description: "Solve 250 problems", type: "problems", threshold: 250 },
    { id: "problems_500", title: "500 Problems", emoji: "🏆", description: "Solve 500 problems", type: "problems", threshold: 500 },
    { id: "problems_1000", title: "1000 Problems", emoji: "🏆", description: "Solve 1000 problems", type: "problems", threshold: 1000 },
    { id: "streak_7", title: "Week Warrior", emoji: "🔥", description: "Maintain a 7-day streak", type: "streak", threshold: 7 },
    { id: "streak_30", title: "Month Master", emoji: "🔥", description: "Maintain a 30-day streak", type: "streak", threshold: 30 },
    { id: "streak_100", title: "Century Coder", emoji: "🔥", description: "Maintain a 100-day streak", type: "streak", threshold: 100 },
    { id: "streak_365", title: "Year of Code", emoji: "🔥", description: "Maintain a 365-day streak", type: "streak", threshold: 365 },
  ];

  const totalSolved = stats.totalSolved || 0;
  const bestStreak = Math.max(streak.currentStreak || 0, streak.longestStreak || 0);

  const unlocked = [];
  const locked = [];
  const now = new Date().toISOString();

  for (const a of allAchievements) {
    let earned = false;
    if (a.type === "problems") earned = totalSolved >= a.threshold;
    if (a.type === "streak") earned = bestStreak >= a.threshold;

    if (earned) {
      unlocked.push({ ...a, unlockedAt: now });
    } else {
      locked.push(a);
    }
  }

  return { unlocked, locked, generatedAt: now };
}

// ── Pure JS Main README Generator ─────────────────────────────────────────────

function generateMainReadme(stats, streak, achievements, submissions, username, engineRepo) {
  const total = stats.totalSolved || 0;
  const curStreak = streak.currentStreak || 0;
  const longStreak = streak.longestStreak || 0;
  const thisYear = stats.perYear?.[new Date().getFullYear()] || total;
  const todayCount = streak.todaySolved || 0;
  const dailyGoal = streak.dailyGoal || 1;
  const goalStatus = streak.dailyGoalMet ? "✅ GOAL MET" : `${todayCount}/${dailyGoal}`;

  const easy = stats.easy || 0;
  const medium = stats.medium || 0;
  const hard = stats.hard || 0;
  const totalDiff = easy + medium + hard || 1;
  const easyPct = ((easy / totalDiff) * 100).toFixed(1);
  const medPct = ((medium / totalDiff) * 100).toFixed(1);
  const hardPct = ((hard / totalDiff) * 100).toFixed(1);

  // Languages Table
  const langEntries = Object.entries(stats.byLanguage || {}).slice(0, 6);
  const totalLangCount = langEntries.reduce((acc, [, c]) => acc + c, 0) || 1;
  const langRows = langEntries
    .map(([lang, count]) => `| ${formatLangName(lang)} | ${count} | ${((count / totalLangCount) * 100).toFixed(1)}% |`)
    .join("\n");

  // Topics Table
  const topicEntries = Object.entries(stats.byTopic || {}).slice(0, 10);
  const topicRows = topicEntries.map(([t, count]) => `| ${t} | ${count} |`).join("\n");

  const platformRows = Object.entries(stats.byPlatform || {})
    .map(([platform, count]) => `| ${platform} | ${count} |`)
    .join("\n");

  // Recent Problems
  const recentSubs = [...submissions].sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1)).slice(0, 10);
  const recentRows = recentSubs
    .map((s) => {
      const p = s.problem;
      const badge = p.difficulty === "Easy" ? "🟢 Easy" : p.difficulty === "Medium" ? "🟡 Medium" : "🔴 Hard";
      return `| ${p.id || "—"} | ${normalizePlatform(s.platform)} | [${p.title}](${p.url || "#"}) | ${badge} | ${formatLangName(s.language)} | ${s.submitted_at?.slice(0, 10) || "—"} |`;
    })
    .join("\n");

  // Achievements
  const achRows = [
    ...(achievements.unlocked || []).map((a) => `| ${a.emoji} ${a.title} | ✅ Unlocked | ${a.unlockedAt?.slice(0, 10) || "—"} |`),
    ...(achievements.locked || []).map((a) => `| ${a.emoji} ${a.title} | 🔒 Locked | — |`),
  ].join("\n");

  const nowStr = new Date().toUTCString();

  return `<div align="center">

# 🧠 LeetCode Journey

*Automated progress tracker powered by [CodeStreak](https://github.com/${username}/${engineRepo})*

---

| 🔥 Current Streak | 🏆 Longest Streak | ✅ Total Solved | 📅 This Year |
|:-----------------:|:-----------------:|:--------------:|:------------:|
| **${curStreak} days** | **${longStreak} days** | **${total}** | **${thisYear}** |

> **Today's Status:** ${goalStatus}

</div>

---

## 📊 Difficulty Breakdown

| Difficulty | Count | Percentage |
|:----------:|:-----:|:----------:|
| 🟢 Easy    | ${easy} | ${easyPct}% |
| 🟡 Medium  | ${medium} | ${medPct}% |
| 🔴 Hard    | ${hard} | ${hardPct}% |

![Difficulty](assets/difficulty.svg)

---

## 🌐 Languages

| Language | Problems | % |
|:--------:|:--------:|:-:|
${langRows || "| None | 0 | 0% |"}

![Languages](assets/languages.svg)

---

## 🧩 Platforms

| Platform | Problems |
|:--------:|:--------:|
${platformRows || "| None | 0 |"}

---

${topicRows ? `## 🗂️ Top Topics\n\n| Topic | Problems |\n|:-----:|:--------:|\n${topicRows}\n\n---\n` : ""}

## 🔥 Streak Details

| Metric | Value |
|:------:|:-----:|
| Current Streak | **${curStreak} days** |
| Longest Streak | **${longStreak} days** |
| Total Active Days | **${streak.totalActiveDays || 0}** |
| Streak Since | ${streak.streakStartDate || "—"} |
| Last Solved | ${streak.lastSolvedDate || "—"} |

![Activity Heatmap](assets/heatmap.svg)

---

## 🕐 Recent Submissions

| # | Platform | Problem | Difficulty | Language | Date |
|:-:|:--------:|:-------:|:----------:|:--------:|:----:|
${recentRows || "| — | — | No submissions yet | — | — | — |"}

---

## 🏆 Achievements

| Achievement | Status | Date |
|:-----------:|:------:|:----:|
${achRows}

---

<div align="center">

*Auto-generated by [CodeStreak](https://github.com/${username}/${engineRepo}) · Last updated: ${nowStr}*

</div>
`;
}

// ── SVG Generators ────────────────────────────────────────────────────────────

function generateDifficultySvg(easy = 0, medium = 0, hard = 0) {
  const total = easy + medium + hard || 1;
  const bars = [
    { label: "Easy", val: easy, color: "#00b8a3" },
    { label: "Medium", val: medium, color: "#ffc01e" },
    { label: "Hard", val: hard, color: "#ff375f" },
  ];
  const BAR_WIDTH = 220;
  const ROW_H = 30;
  const height = bars.length * ROW_H + 40;
  const width = BAR_WIDTH + 160;

  const rows = bars
    .map((b, i) => {
      const y = i * ROW_H + 30;
      const barLen = Math.round((BAR_WIDTH * b.val) / total);
      const pct = ((b.val / total) * 100).toFixed(1) + "%";
      return `  <text x="10" y="${y + 13}" font-size="11" fill="#c9d1d9" font-family="monospace">${b.label.padEnd(7)}</text>
  <rect x="70" y="${y}" width="${barLen}" height="18" rx="3" fill="${b.color}"/>
  <rect x="70" y="${y}" width="${BAR_WIDTH}" height="18" rx="3" fill="none" stroke="#30363d"/>
  <text x="${70 + barLen + 6}" y="${y + 13}" font-size="11" fill="#8b949e" font-family="monospace">${b.val} (${pct})</text>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 {width} {height}">
  <rect width="${width}" height="${height}" fill="#0d1117" rx="6"/>
  <text x="10" y="18" font-size="12" fill="#8b949e" font-family="monospace" font-weight="bold">Difficulty Distribution</text>
${rows}
</svg>`;
}

function generateLanguagesSvg(byLanguage = {}) {
  const items = Object.entries(byLanguage).slice(0, 6);
  const total = items.reduce((acc, [, v]) => acc + v, 0) || 1;
  const BAR_WIDTH = 220;
  const ROW_H = 30;
  const height = Math.max(items.length * ROW_H + 40, 70);
  const width = BAR_WIDTH + 160;

  const rows = items
    .map(([lang, val], i) => {
      const y = i * ROW_H + 30;
      const barLen = Math.round((BAR_WIDTH * val) / total);
      const pct = ((val / total) * 100).toFixed(1) + "%";
      const lbl = lang.length > 7 ? lang.slice(0, 7) : lang.padEnd(7);
      return `  <text x="10" y="${y + 13}" font-size="11" fill="#c9d1d9" font-family="monospace">${lbl}</text>
  <rect x="70" y="${y}" width="${barLen}" height="18" rx="3" fill="#58a6ff"/>
  <rect x="70" y="${y}" width="${BAR_WIDTH}" height="18" rx="3" fill="none" stroke="#30363d"/>
  <text x="${70 + barLen + 6}" y="${y + 13}" font-size="11" fill="#8b949e" font-family="monospace">${val} (${pct})</text>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 {width} {height}">
  <rect width="${width}" height="${height}" fill="#0d1117" rx="6"/>
  <text x="10" y="18" font-size="12" fill="#8b949e" font-family="monospace" font-weight="bold">Language Distribution</text>
${rows}
</svg>`;
}

function generateHeatmapSvg(dailyActivity = {}) {
  const CELL = 11;
  const WEEKS = 52;
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - WEEKS * 7);

  const days = [];
  const cur = new Date(start);
  while (cur <= today) {
    const dStr = cur.toISOString().slice(0, 10);
    days.push({ date: dStr, count: dailyActivity[dStr] || 0 });
    cur.setDate(cur.getDate() + 1);
  }

  const maxCount = Math.max(...days.map((d) => d.count), 1);
  const colors = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];

  const width = WEEKS * CELL + 30;
  const height = 7 * CELL + 35;

  const cellsSvg = days
    .map((d, i) => {
      const week = Math.floor(i / 7);
      const dow = i % 7;
      const x = week * CELL + 15;
      const y = dow * CELL + 22;
      const ratio = d.count / maxCount;
      const cIdx = d.count === 0 ? 0 : Math.min(Math.ceil(ratio * 4), 4);
      const color = colors[cIdx];
      return `  <rect x="${x}" y="${y}" width="10" height="10" rx="2" ry="2" fill="${color}"><title>${d.date}: ${d.count} problem(s)</title></rect>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#0d1117" rx="6"/>
  <text x="10" y="14" font-size="11" fill="#8b949e" font-family="monospace">Activity — last 52 weeks</text>
${cellsSvg}
</svg>`;
}

// ── LeetCode API Direct Access ────────────────────────────────────────────────

const GRAPHQL_URL = "https://leetcode.com/graphql/";
const SUBMISSIONS_URL = "https://leetcode.com/api/submissions/";

async function checkLeetCodeAuth() {
  try {
    const res = await fetch(SUBMISSIONS_URL + "?offset=0&limit=1", { credentials: "include" });
    if (res.status === 403 || res.status === 401) return { isSignedIn: false, username: null };
    if (res.ok) {
      const data = await res.json();
      return { isSignedIn: true, username: data.user_name || "LeetCode User" };
    }
  } catch (err) {
    console.warn("[CodeStreak BG] checkLeetCodeAuth error:", err);
  }
  return { isSignedIn: false, username: null };
}

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
    return null;
  }
}

async function fetchSubmissionDetail(submissionId) {
  const query = `
    query submissionDetails($submissionId: Int!) {
      submissionDetails(submissionId: $submissionId) {
        runtime
        runtimePercentile
        memory
        memoryPercentile
        code
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
    return null;
  }
}

async function getSubmissionLogs(limit = 20) {
  const settings = await loadSettings();
  let existingIds = new Set();

  if (settings.githubToken && settings.githubUsername) {
    try {
      const github = new GitHubAPI(settings.githubToken);
      const targetRepo = `${settings.githubUsername}/${settings.targetRepo}`;
      const subs = await fetchSubmissionsDB(github, targetRepo);
      existingIds = new Set(subs.map((s) => String(s.submission_id)));
    } catch (e) {}
  }

  const rawList = await fetchRecentSubmissionsRaw(limit);
  const logs = rawList.map((item) => ({
    id: String(item.id),
    title: item.title,
    slug: item.title_slug,
    status: item.status_display,
    isAccepted: item.status_display === "Accepted",
    isSynced: existingIds.has(String(item.id)),
    lang: item.lang,
    time: item.time,
  }));

  return { logs, total: logs.length };
}

// ── GitHub API Class ──────────────────────────────────────────────────────────

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
    const encoded = btoa(unescape(encodeURIComponent(content)));

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

function normalizePlatform(platform) {
  const value = String(platform || "leetcode").toLowerCase().trim();
  return value.replace(/[^a-z0-9-]/g, "") || "leetcode";
}

function slugifyFolder(id, slug, platform = "leetcode") {
  const safeId = String(id ?? "").trim();
  const safeSlug = String(slug || "problem").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (normalizePlatform(platform) === "geeksforgeeks" && safeId.toLowerCase() === safeSlug) {
    return safeSlug;
  }
  if (/^\d+$/.test(safeId)) return `${safeId.padStart(4, "0")}-${safeSlug}`;
  return `${safeId || "problem"}-${safeSlug}`;
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

function formatLangName(lang = "") {
  const map = {
    python3: "Python", python: "Python", cpp: "C++", java: "Java",
    javascript: "JavaScript", typescript: "TypeScript", csharp: "C#",
    golang: "Go", kotlin: "Kotlin", rust: "Rust", mysql: "SQL",
  };
  return map[lang.toLowerCase()] || lang;
}

function buildProblemReadme(sub, allSubmissions = []) {
  const p = sub.problem;
  const platform = normalizePlatform(sub.platform);
  const date = sub.submitted_at?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const topics = p.topics?.join(", ") || "—";
  const runtime = sub.runtime ? `- **Runtime**: ${sub.runtime}` : "";
  const memory = sub.memory ? `- **Memory**: ${sub.memory}` : "";
  const perf = (runtime || memory) ? `\n## Performance\n\n${[runtime, memory].filter(Boolean).join("\n")}\n` : "";

  // Check if there are multiple language submissions for this problem
  const problemSubs = allSubmissions.filter(
    (s) => normalizePlatform(s.platform) === platform &&
      (s.problem?.slug === p.slug || String(s.problem?.id) === String(p.id))
  );

  let solutionsTable = "";
  if (problemSubs.length > 1) {
    const rows = problemSubs.map((s) => {
      const ext = getExtension(s.language);
      const lName = formatLangName(s.language);
      const sDate = s.submitted_at?.slice(0, 10) || "—";
      const sRun = s.runtime || "—";
      const sMem = s.memory || "—";
      return `| ${lName} | [solution.${ext}](solution.${ext}) | ${sDate} | ${sRun} | ${sMem} |`;
    });
    solutionsTable = `\n## Available Solutions\n\n| Language | Source Code | Date Solved | Runtime | Memory |\n|:---|:---|:---|:---|:---|\n${rows.join("\n")}\n`;
  }

  const platformLabels = {
    leetcode: "LeetCode",
    geeksforgeeks: "GeeksforGeeks",
    codeforces: "Codeforces",
    codechef: "CodeChef",
  };
  const platformLabel = platformLabels[platform] || platform;

  return `# ${p.title}

| Field | Value |
|-------|-------|
| **Problem #** | ${p.id} |
| **Difficulty** | ${p.difficulty} |
| **Language** | ${formatLangName(sub.language)} |
| **Topics** | ${topics} |
| **Date Solved** | ${date} |
| **Platform** | ${platformLabel} |
| **${platformLabel}** | [Link](${p.url}) |
${solutionsTable}
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

console.log("[CodeStreak] Real-time Dashboard Engine initialized.");
