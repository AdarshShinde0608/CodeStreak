/**
 * codechef_content.js — CodeStreak CodeChef Content Script
 *
 * Runs on codechef.com problem and contest pages.
 * Detects accepted verdicts and extracts code + problem metadata.
 *
 * Implements: CC-01, CC-02, CC-03
 *
 * Trigger points:
 *   1. Submission status response on /problems/* pages
 *   2. Accepted verdict in submission result modal/page
 *   3. DOM observer for SPA verdict updates
 */

(function () {
  "use strict";

  if (window.__codestreakCcInjected) return;
  window.__codestreakCcInjected = true;

  console.log("[CodeStreak CC] Content script initialized on", window.location.href);

  const _processedKeys = new Set();
  let _lastScan = 0;

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Extract problem code from CodeChef URL: /problems/PROBCODE or /CONTEST/problems/PROBCODE */
  function extractCcProblemCode(url) {
    // Practice: /problems/PROBLEMCODE
    const practice = url.match(/codechef\.com\/problems\/([A-Z0-9]+)/i);
    if (practice) return practice[1].toUpperCase();

    // Contest: /CONTESTCODE/problems/PROBLEMCODE
    const contest = url.match(/codechef\.com\/[A-Z0-9]+\/problems\/([A-Z0-9]+)/i);
    if (contest) return contest[1].toUpperCase();

    return null;
  }

  /** Extract contest code from URL (null for practice problems) */
  function extractCcContestCode(url) {
    const m = url.match(/codechef\.com\/([A-Z0-9]+)\/problems\//i);
    return m ? m[1].toUpperCase() : null;
  }

  /** Normalize CodeChef language labels */
  function normalizeCcLanguage(lang) {
    if (!lang) return "cpp";
    const l = lang.toLowerCase();
    if (l.includes("c++") || l.includes("cpp")) return "cpp";
    if (l.includes("python") || l.includes("py")) return "python3";
    if (l.includes("java") && !l.includes("javascript")) return "java";
    if (l.includes("javascript") || l.includes("node")) return "javascript";
    if (l.includes("go") && !l.includes("golang")) return "golang";
    if (l.includes("rust")) return "rust";
    if (l.includes("c#") || l.includes("csharp")) return "csharp";
    if (l.startsWith("c")) return "c";
    return l.replace(/\s+/g, "_");
  }

  /** Extract code from CodeChef IDE (Monaco / CodeMirror / ACE / textarea) */
  function extractCcCode() {
    // Monaco editor (used in newer CodeChef)
    if (window.monaco?.editor) {
      const models = window.monaco.editor.getModels();
      if (models.length > 0) return models[0].getValue();
    }

    // CodeMirror
    const cm = document.querySelector(".CodeMirror");
    if (cm?.CodeMirror) return cm.CodeMirror.getValue();

    // Ace editor
    if (window.ace) {
      try {
        const aceEl = document.querySelector(".ace_editor");
        if (aceEl) return window.ace.edit(aceEl).getValue();
      } catch (_) {}
    }

    // Textarea fallback
    const ta = document.querySelector("textarea#editor, textarea.ide-editor, textarea[name='source']");
    if (ta) return ta.value;

    // Grab visible lines
    const lines = document.querySelectorAll(".view-line, .ace_line");
    if (lines.length > 0) return Array.from(lines).map(l => l.textContent).join("\n");

    return "";
  }

  /** Check if the current page / modal shows an accepted verdict */
  function isCcAccepted() {
    // Result text checks
    const resultEl = document.querySelector(
      '[class*="success"], [class*="accepted"], [class*="AC"], .verdict-success'
    );
    if (resultEl && resultEl.textContent.match(/accepted|correct|AC/i)) return true;

    // Score table on submission status page: "AC" in verdict column
    const verdictCells = document.querySelectorAll("td.verdict, td[class*='verdict'], .submission-verdict");
    for (const cell of verdictCells) {
      if (cell.textContent.trim().toUpperCase() === "AC") return true;
    }

    return false;
  }

  /** Normalize CodeChef difficulty */
  function normalizeCcDifficulty(raw) {
    if (!raw) return "Unknown";
    const l = raw.toLowerCase();
    if (l.includes("beginner") || l.includes("easy") || l.includes("cakewalk")) return "Easy";
    if (l.includes("medium") || l.includes("simple")) return "Medium";
    if (l.includes("hard") || l.includes("challenge") || l.includes("expert")) return "Hard";
    return "Unknown";
  }

  // ── Main detection ────────────────────────────────────────────────────────

  function handleCcAccepted() {
    const url         = window.location.href;
    const problemCode = extractCcProblemCode(url);
    if (!problemCode) return;

    const dedupKey = `cc:${problemCode}`;
    if (_processedKeys.has(dedupKey)) return;
    _processedKeys.add(dedupKey);
    setTimeout(() => _processedKeys.delete(dedupKey), 5000);

    const contestCode = extractCcContestCode(url);

    // Title
    const titleEl = document.querySelector("h1.problem-title, h1, [class*='problem-title']");
    const title = titleEl?.textContent?.trim() || problemCode;

    // Difficulty
    const diffEl = document.querySelector(
      '[class*="difficulty"], [class*="level"], [data-difficulty]'
    );
    const difficulty = normalizeCcDifficulty(diffEl?.textContent?.trim() || diffEl?.dataset?.difficulty);

    // Language from selector
    const langEl = document.querySelector(
      "select#language, select[name='language'], [class*='language-select'] option:checked"
    );
    const language = normalizeCcLanguage(langEl?.textContent?.trim() || langEl?.value || "");

    const code = extractCcCode();
    const slug = problemCode.toLowerCase();

    // Compose URL
    const problemUrl = contestCode
      ? `https://www.codechef.com/${contestCode}/problems/${problemCode}`
      : `https://www.codechef.com/problems/${problemCode}`;

    const submission = {
      submission_id: `cc_${problemCode}_${Date.now()}`,
      platform: "codechef",
      problem: {
        id: problemCode,
        title: title,
        slug: slug,
        difficulty: difficulty,
        topics: [],
        url: problemUrl,
        contest: contestCode || null,   // CC-03: contest/practice tag
      },
      language: language,
      status: "Accepted",
      submitted_at: new Date().toISOString().replace(/\.\d+/, ""),
      code: code,
      runtime: null,
      memory: null,
    };

    console.log("[CodeStreak CC] Sending accepted submission:", submission.problem.title);

    chrome.runtime.sendMessage(
      { type: "SUBMISSION_ACCEPTED", submission },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[CodeStreak CC] Error:", chrome.runtime.lastError.message);
        } else {
          console.log("[CodeStreak CC] Synced:", response);
        }
      }
    );
  }

  // ── MutationObserver ──────────────────────────────────────────────────────

  const observer = new MutationObserver(() => {
    const now = Date.now();
    if (now - _lastScan < 2000) return;
    _lastScan = now;

    if (!/codechef\.com/.test(window.location.href)) return;
    if (isCcAccepted()) handleCcAccepted();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Initial check
  setTimeout(() => {
    if (/codechef\.com/.test(window.location.href) && isCcAccepted()) {
      handleCcAccepted();
    }
  }, 2000);
})();
