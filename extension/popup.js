/**
 * popup.js — CodeStreak Extension Popup Logic
 */

"use strict";

// ── DOM refs ──────────────────────────────────────────────────────────────────
const statusDot           = document.getElementById("statusDot");
const statusText          = document.getElementById("statusText");
const lcStatusText        = document.getElementById("lcStatusText");
const lcLoginBtn          = document.getElementById("lcLoginBtn");

const manualSyncBtn       = document.getElementById("manualSyncBtn");
const toggleLogsBtn       = document.getElementById("toggleLogsBtn");
const syncProgressBox     = document.getElementById("syncProgressBox");
const syncProgressText    = document.getElementById("syncProgressText");
const syncCountBadge      = document.getElementById("syncCountBadge");

const submissionsLogPanel = document.getElementById("submissionsLogPanel");
const logList             = document.getElementById("logList");
const closeLogsBtn        = document.getElementById("closeLogsBtn");

const statsBar            = document.getElementById("statsBar");
const statSynced          = document.getElementById("statSynced");
const statStreak          = document.getElementById("statStreak");
const statLast            = document.getElementById("statLast");

const lastProblem         = document.getElementById("lastProblem");
const lastProblemTitle    = document.getElementById("lastProblemTitle");
const lastProblemDiff     = document.getElementById("lastProblemDiff");
const lastProblemLang     = document.getElementById("lastProblemLang");

const toggleSettingsBtn   = document.getElementById("toggleSettingsBtn");
const accordionArrow      = document.getElementById("accordionArrow");
const settingsForm        = document.getElementById("settingsForm");

const githubTokenEl       = document.getElementById("githubToken");
const githubUsernameEl    = document.getElementById("githubUsername");
const targetRepoEl        = document.getElementById("targetRepo");
const engineRepoEl        = document.getElementById("engineRepo");
const autoSyncEl          = document.getElementById("autoSync");
const showNotifEl         = document.getElementById("showNotifications");
const revealBtn           = document.getElementById("revealBtn");
const saveBtn             = document.getElementById("saveBtn");
const testBtn             = document.getElementById("testBtn");
const toast               = document.getElementById("toast");

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await refreshStatus();
  await refreshLeetCodeStatus();
  await loadRecentActivity();
});

// ── Load settings ─────────────────────────────────────────────────────────────

async function loadSettings() {
  const defaults = {
    githubToken:       "",
    githubUsername:    "",
    targetRepo:        "leetcode-journey",
    engineRepo:        "CodeStreak",
    autoSync:          true,
    showNotifications: true,
  };

  const settings = await storageGet(defaults);
  githubTokenEl.value    = settings.githubToken    || "";
  githubUsernameEl.value = settings.githubUsername  || "";
  targetRepoEl.value     = settings.targetRepo      || "leetcode-journey";
  engineRepoEl.value     = settings.engineRepo      || "CodeStreak";
  autoSyncEl.checked     = settings.autoSync        !== false;
  showNotifEl.checked    = settings.showNotifications !== false;

  // Auto-open settings if not configured
  if (!settings.githubToken || !settings.githubUsername) {
    openSettingsAccordion();
  }
}

// ── LeetCode Authentication Status ────────────────────────────────────────────

async function refreshLeetCodeStatus() {
  lcStatusText.textContent = "Checking active session…";
  lcStatusText.className   = "lc-status";
  lcLoginBtn.style.display = "none";

  chrome.runtime.sendMessage({ type: "CHECK_LEETCODE_AUTH" }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      lcStatusText.textContent = "Could not reach LeetCode";
      lcStatusText.className   = "lc-status offline";
      lcLoginBtn.style.display = "inline-block";
      return;
    }

    if (response.isSignedIn) {
      lcStatusText.textContent = `Logged in as @${response.username || "user"}`;
      lcStatusText.className   = "lc-status online";
      lcLoginBtn.style.display = "none";
    } else {
      lcStatusText.textContent = "Not logged in to LeetCode";
      lcStatusText.className   = "lc-status offline";
      lcLoginBtn.style.display = "inline-block";
    }
  });
}

// ── GitHub Status ─────────────────────────────────────────────────────────────

async function refreshStatus() {
  const settings = await storageGet({ githubToken: "", githubUsername: "" });

  if (!settings.githubToken || !settings.githubUsername) {
    setStatus("warning", "GitHub Not Configured");
    return;
  }

  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${settings.githubToken}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (res.ok) {
      setStatus("active", "GitHub Ready");
    } else {
      setStatus("error", "Invalid Token");
    }
  } catch {
    setStatus("error", "No Connection");
  }
}

// ── Activity and stats ────────────────────────────────────────────────────────

async function loadRecentActivity() {
  const data = await storageGet({
    syncCount:        0,
    currentStreak:    0,
    lastSyncTime:     null,
    lastProblemTitle: null,
    lastProblemDiff:  null,
    lastProblemLang:  null,
  });

  if (data.syncCount > 0) {
    syncCountBadge.textContent = `${data.syncCount} Synced`;
    statsBar.style.display     = "flex";
    statSynced.textContent     = data.syncCount;
    statStreak.textContent     = data.currentStreak ? `${data.currentStreak}🔥` : "0";
    statLast.textContent       = data.lastSyncTime ? timeAgo(data.lastSyncTime) : "—";
  }

  if (data.lastProblemTitle) {
    lastProblem.style.display     = "block";
    lastProblemTitle.textContent  = data.lastProblemTitle;
    lastProblemDiff.textContent   = data.lastProblemDiff || "";
    lastProblemDiff.className     = `badge ${data.lastProblemDiff || ""}`;
    lastProblemLang.textContent   = data.lastProblemLang || "";
  }
}

// ── Manual Scan & Sync Button ─────────────────────────────────────────────────

manualSyncBtn.addEventListener("click", async () => {
  const settings = await storageGet({ githubToken: "", githubUsername: "" });
  if (!settings.githubToken || !settings.githubUsername) {
    showToast("⚠️ Configure GitHub settings first", "error");
    openSettingsAccordion();
    return;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isGfgPage = /https:\/\/(?:www\.)?geeksforgeeks\.org\/problems\//i.test(activeTab?.url || "");

  // UI loading state
  manualSyncBtn.disabled           = true;
  manualSyncBtn.innerHTML          = `<span class="btn-icon">⏳</span> Syncing…`;
  syncProgressBox.style.display    = "flex";
  syncProgressText.textContent     = isGfgPage
    ? "Checking current GFG submission…"
    : "Connecting to LeetCode API…";

  if (isGfgPage) {
    chrome.tabs.sendMessage(activeTab.id, { type: "SYNC_CURRENT_GFG" }, async (res) => {
      manualSyncBtn.disabled  = false;
      manualSyncBtn.innerHTML = `<span class="btn-icon">🔄</span> Scan & Sync`;
      syncProgressBox.style.display = "none";

      if (chrome.runtime.lastError || !res?.ok) {
        const connectionError = chrome.runtime.lastError?.message?.includes("Receiving end does not exist");
        const errMsg = res?.error || (connectionError
          ? "GFG page connection unavailable. Reload the GFG problem page and try again."
          : chrome.runtime.lastError?.message || "GFG sync failed");
        showToast(`❌ ${errMsg}`, "error");
        return;
      }

      showToast(res.accepted ? "🎉 GFG submission sent for sync!" : "✅ No accepted GFG submission found", res.accepted ? "success" : "info");
      if (res.accepted) await loadRecentActivity();
    });
    return;
  }

  chrome.runtime.sendMessage({ type: "SYNC_RECENT_SUBMISSIONS", limit: 50 }, async (res) => {
    manualSyncBtn.disabled  = false;
    manualSyncBtn.innerHTML = `<span class="btn-icon">🔄</span> Scan & Sync LeetCode`;
    syncProgressBox.style.display = "none";

    if (chrome.runtime.lastError || !res?.ok) {
      const errMsg = res?.error || chrome.runtime.lastError?.message || "Sync failed";
      showToast(`❌ ${errMsg}`, "error");
      return;
    }

    if (res.syncedCount > 0) {
      showToast(`🎉 Synced ${res.syncedCount} new problem(s)!`, "success");
    } else {
      showToast(`✅ All caught up! (${res.alreadySyncedCount || 0} already synced)`, "success");
    }

    await loadRecentActivity();
    await refreshLeetCodeStatus();
    if (submissionsLogPanel.style.display === "flex") {
      await loadSubmissionLogs();
    }
  });
});

// ── Submissions Log Viewer ───────────────────────────────────────────────────

toggleLogsBtn.addEventListener("click", async () => {
  if (submissionsLogPanel.style.display === "flex") {
    submissionsLogPanel.style.display = "none";
  } else {
    submissionsLogPanel.style.display = "flex";
    await loadSubmissionLogs();
  }
});

closeLogsBtn.addEventListener("click", () => {
  submissionsLogPanel.style.display = "none";
});

async function loadSubmissionLogs() {
  logList.innerHTML = `<div class="log-empty">Fetching submissions from LeetCode…</div>`;

  chrome.runtime.sendMessage({ type: "GET_SUBMISSION_LOGS", limit: 50 }, (res) => {
    if (chrome.runtime.lastError || !res?.ok) {
      const msg = res?.error || "Could not load submission logs. Ensure you are logged into LeetCode.";
      logList.innerHTML = `<div class="log-empty" style="color:var(--red)">${msg}</div>`;
      return;
    }

    const logs = res.logs || [];
    if (logs.length === 0) {
      logList.innerHTML = `<div class="log-empty">No recent submissions found on LeetCode.</div>`;
      return;
    }

    logList.innerHTML = "";
    for (const item of logs) {
      const row = document.createElement("div");
      row.className = "log-item";

      let badgeClass = "other";
      let badgeText  = item.status || "Unknown";

      if (item.isSynced) {
        badgeClass = "synced";
        badgeText  = "Synced ✅";
      } else if (item.isAccepted) {
        badgeClass = "accepted";
        badgeText  = "Accepted ⚡";
      }

      row.innerHTML = `
        <div class="log-item-left">
          <div class="log-item-title" title="${item.title}">${item.title}</div>
          <div class="log-item-sub">${item.lang || "code"} · ${item.time || "recently"}</div>
        </div>
        <span class="log-status-badge ${badgeClass}">${badgeText}</span>
      `;
      logList.appendChild(row);
    }
  });
}

// ── Settings Accordion ────────────────────────────────────────────────────────

toggleSettingsBtn.addEventListener("click", () => {
  const isHidden = settingsForm.style.display === "none";
  if (isHidden) {
    openSettingsAccordion();
  } else {
    closeSettingsAccordion();
  }
});

function openSettingsAccordion() {
  settingsForm.style.display   = "flex";
  accordionArrow.style.transform = "rotate(180deg)";
}

function closeSettingsAccordion() {
  settingsForm.style.display   = "none";
  accordionArrow.style.transform = "rotate(0deg)";
}

// ── Save settings ─────────────────────────────────────────────────────────────

settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const settings = {
    githubToken:       githubTokenEl.value.trim(),
    githubUsername:    githubUsernameEl.value.trim(),
    targetRepo:        targetRepoEl.value.trim() || "leetcode-journey",
    engineRepo:        engineRepoEl.value.trim() || "CodeStreak",
    autoSync:          autoSyncEl.checked,
    showNotifications: showNotifEl.checked,
  };

  await storageSet(settings);
  await refreshStatus();
  showToast("✅ Settings saved!", "success");
});

// ── Test connection ───────────────────────────────────────────────────────────

testBtn.addEventListener("click", async () => {
  testBtn.textContent = "Testing…";
  testBtn.disabled    = true;

  const token    = githubTokenEl.value.trim();
  const username = githubUsernameEl.value.trim();
  const target   = targetRepoEl.value.trim() || "leetcode-journey";

  if (!token || !username) {
    showToast("⚠️ Enter token and username first", "error");
    testBtn.textContent = "Test Connection";
    testBtn.disabled    = false;
    return;
  }

  try {
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!userRes.ok) throw new Error("Invalid GitHub token");

    const user = await userRes.json();
    if (user.login.toLowerCase() !== username.toLowerCase()) {
      throw new Error(`Token belongs to '@${user.login}', not '@${username}'`);
    }

    const repoRes = await fetch(`https://api.github.com/repos/${username}/${target}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!repoRes.ok) {
      throw new Error(`Cannot access '${username}/${target}'. Does the repo exist?`);
    }

    setStatus("active", "GitHub Ready");
    showToast(`✅ Connected as @${user.login}`, "success");
  } catch (err) {
    setStatus("error", "Error");
    showToast(`❌ ${err.message}`, "error");
  } finally {
    testBtn.textContent = "Test Connection";
    testBtn.disabled    = false;
  }
});

// ── Reveal token ──────────────────────────────────────────────────────────────

revealBtn.addEventListener("click", () => {
  const isPassword = githubTokenEl.type === "password";
  githubTokenEl.type = isPassword ? "text" : "password";
  revealBtn.textContent = isPassword ? "🙈" : "👁";
});

// ── Utilities ─────────────────────────────────────────────────────────────────

function setStatus(type, text) {
  statusDot.className    = `status-dot ${type}`;
  statusText.textContent = text;
}

let _toastTimer = null;
function showToast(message, type = "") {
  toast.textContent = message;
  toast.className   = `toast ${type} show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { toast.className = `toast ${type}`; }, 3500);
}

function timeAgo(isoStr) {
  const diff  = Date.now() - new Date(isoStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 1)  return "just now";
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function storageGet(defaults) {
  return new Promise((resolve) => chrome.storage.sync.get(defaults, resolve));
}

function storageSet(data) {
  return new Promise((resolve) => chrome.storage.sync.set(data, resolve));
}
