/**
 * popup.js — CodeStreak Extension Popup Logic
 */

"use strict";

// ── DOM refs ──────────────────────────────────────────────────────────────────
const statusDot         = document.getElementById("statusDot");
const statusText        = document.getElementById("statusText");
const statsBar          = document.getElementById("statsBar");
const statSynced        = document.getElementById("statSynced");
const statStreak        = document.getElementById("statStreak");
const statLast          = document.getElementById("statLast");
const lastProblem       = document.getElementById("lastProblem");
const lastProblemTitle  = document.getElementById("lastProblemTitle");
const lastProblemDiff   = document.getElementById("lastProblemDiff");
const lastProblemLang   = document.getElementById("lastProblemLang");

const githubTokenEl     = document.getElementById("githubToken");
const githubUsernameEl  = document.getElementById("githubUsername");
const targetRepoEl      = document.getElementById("targetRepo");
const engineRepoEl      = document.getElementById("engineRepo");
const autoSyncEl        = document.getElementById("autoSync");
const showNotifEl       = document.getElementById("showNotifications");
const revealBtn         = document.getElementById("revealBtn");
const saveBtn           = document.getElementById("saveBtn");
const testBtn           = document.getElementById("testBtn");
const settingsForm      = document.getElementById("settingsForm");
const toast             = document.getElementById("toast");

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await refreshStatus();
  await loadRecentActivity();
});

// ── Load settings from storage ────────────────────────────────────────────────

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
}

// ── Refresh status pill ───────────────────────────────────────────────────────

async function refreshStatus() {
  const settings = await storageGet({ githubToken: "", githubUsername: "" });

  if (!settings.githubToken || !settings.githubUsername) {
    setStatus("warning", "Not configured");
    return;
  }

  // Test GitHub token silently
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${settings.githubToken}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (res.ok) {
      setStatus("active", "Ready");
    } else {
      setStatus("error", "Invalid token");
    }
  } catch {
    setStatus("error", "No connection");
  }
}

// ── Load recent activity from storage ────────────────────────────────────────

async function loadRecentActivity() {
  const data = await storageGet({
    syncCount:    0,
    currentStreak: 0,
    lastSyncTime:  null,
    lastProblemTitle: null,
    lastProblemDiff:  null,
    lastProblemLang:  null,
  });

  if (data.syncCount > 0) {
    statsBar.style.display  = "flex";
    statSynced.textContent  = data.syncCount;
    statStreak.textContent  = data.currentStreak ? `${data.currentStreak}🔥` : "0";
    statLast.textContent    = data.lastSyncTime  ? timeAgo(data.lastSyncTime) : "—";
  }

  if (data.lastProblemTitle) {
    lastProblem.style.display   = "block";
    lastProblemTitle.textContent = data.lastProblemTitle;
    lastProblemDiff.textContent  = data.lastProblemDiff  || "";
    lastProblemDiff.className    = `badge ${data.lastProblemDiff || ""}`;
    lastProblemLang.textContent  = data.lastProblemLang  || "";
  }
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
  testBtn.disabled = true;

  const token    = githubTokenEl.value.trim();
  const username = githubUsernameEl.value.trim();
  const target   = targetRepoEl.value.trim() || "leetcode-journey";

  if (!token || !username) {
    showToast("⚠️ Enter token and username first", "error");
    testBtn.textContent = "Test Connection";
    testBtn.disabled = false;
    return;
  }

  try {
    // 1. Check user
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!userRes.ok) throw new Error("Invalid GitHub token");

    const user = await userRes.json();
    if (user.login.toLowerCase() !== username.toLowerCase()) {
      throw new Error(`Token belongs to '${user.login}', not '${username}'`);
    }

    // 2. Check target repo access
    const repoRes = await fetch(`https://api.github.com/repos/${username}/${target}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!repoRes.ok) {
      throw new Error(`Cannot access '${username}/${target}'. Does the repo exist?`);
    }

    setStatus("active", "Ready");
    showToast(`✅ Connected as @${user.login}`, "success");
  } catch (err) {
    setStatus("error", "Error");
    showToast(`❌ ${err.message}`, "error");
  } finally {
    testBtn.textContent = "Test Connection";
    testBtn.disabled = false;
  }
});

// ── Reveal/hide token ─────────────────────────────────────────────────────────

revealBtn.addEventListener("click", () => {
  const isPassword = githubTokenEl.type === "password";
  githubTokenEl.type = isPassword ? "text" : "password";
  revealBtn.textContent = isPassword ? "🙈" : "👁";
});

// ── Utilities ─────────────────────────────────────────────────────────────────

function setStatus(type, text) {
  statusDot.className  = `status-dot ${type}`;
  statusText.textContent = text;
}

let _toastTimer = null;
function showToast(message, type = "") {
  toast.textContent  = message;
  toast.className    = `toast ${type} show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { toast.className = `toast ${type}`; }, 3000);
}

function timeAgo(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
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
