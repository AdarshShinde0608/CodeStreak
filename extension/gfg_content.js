/**
 * gfg_content.js — CodeStreak GeeksforGeeks Content Script
 *
 * Runs on geeksforgeeks.org problem pages. Detects accepted verdicts
 * and extracts code and metadata for GitHub sync.
 *
 * Implements: GFG-01, GFG-02, GFG-03
 *
 * Trigger points:
 *   1. "Correct Answer" / "Accepted" verdict on /problems/* pages
 *   2. DOM mutation observer on the result/verdict area
 */

(function () {
  "use strict";

  if (window.__codestreakGfgInjected) return;
  window.__codestreakGfgInjected = true;

  console.log("[CodeStreak GFG] Content script initialized on", window.location.href);

  const _processedKeys = new Set();
  let _lastScan = 0;

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Extract problem slug from GFG URL: /problems/slug-name/... */
  function extractGfgSlug(url) {
    const m = url.match(/geeksforgeeks\.org\/problems\/([^/]+)/);
    return m ? m[1] : null;
  }

  /** Normalize GFG difficulty labels */
  function normalizeGfgDifficulty(raw) {
    if (!raw) return "Unknown";
    const l = raw.toLowerCase();
    if (l.includes("easy") || l.includes("school") || l.includes("basic")) return "Easy";
    if (l.includes("medium")) return "Medium";
    if (l.includes("hard")) return "Hard";
    return "Unknown";
  }

  /** Normalize GFG language labels */
  function normalizeGfgLanguage(lang) {
    if (!lang) return "cpp";
    const l = lang.toLowerCase();
    if (l.includes("c++") || l.includes("cpp")) return "cpp";
    if (l.includes("python")) return "python3";
    if (l.includes("java")) return "java";
    if (l.includes("javascript") || l.includes("js")) return "javascript";
    if (l.startsWith("c")) return "c";
    return l.replace(/\s+/g, "_");
  }

  /** Extract code from Monaco / CodeMirror / Ace editor on GFG */
  function extractGfgCode() {
    // Monaco editor (most common on modern GFG)
    if (window.monaco?.editor) {
      const models = window.monaco.editor.getModels();
      if (models.length > 0) return models[0].getValue();
    }

    // CodeMirror instance
    const cm = document.querySelector(".CodeMirror");
    if (cm?.CodeMirror) return cm.CodeMirror.getValue();

    // Ace editor
    if (window.ace) {
      try {
        const aceEl = document.querySelector(".ace_editor");
        if (aceEl) {
          const aceEditor = window.ace.edit(aceEl);
          return aceEditor.getValue();
        }
      } catch (_) {}
    }

    // Fallback: textarea
    const ta = document.querySelector("textarea.editor-input, textarea#solution");
    if (ta) return ta.value;

    // Last resort: grab visible editor lines
    const lines = document.querySelectorAll(".view-line, .ace_line");
    if (lines.length > 0) {
      return Array.from(lines).map(l => l.textContent).join("\n");
    }

    return "";
  }

  /** Check if the current page shows an accepted verdict */
  function isGfgAccepted() {
    // Common GFG accepted indicators
    const indicators = [
      '[class*="accepted"]',
      '[class*="Accepted"]',
      '.correct-answer',
      '.verdict-accepted',
    ];
    for (const sel of indicators) {
      const el = document.querySelector(sel);
      if (el && el.textContent.match(/correct|accepted/i)) return true;
    }

    // Check all text elements for "Correct Answer" or "Problem Solved"
    const allText = document.body?.textContent || "";
    return /Correct Answer|Problem Solved|Test Cases Passed.*\d+\/\d+.*100%/i.test(allText)
      && !/Wrong Answer|Time Limit|Runtime Error/i.test(allText.slice(0, 500));
  }

  // ── Main extraction ───────────────────────────────────────────────────────

  function handleGfgAccepted() {
    const url  = window.location.href;
    const slug = extractGfgSlug(url);
    if (!slug) return;

    const key = `gfg:${slug}:${Date.now()}`;
    // Debounce: only fire once per 5 seconds per slug
    const dedupKey = `gfg:${slug}`;
    if (_processedKeys.has(dedupKey)) return;
    _processedKeys.add(dedupKey);
    setTimeout(() => _processedKeys.delete(dedupKey), 5000);

    // Title: problem heading
    const titleEl = document.querySelector("h1, .problem-title, [class*='problem-heading']");
    const title = titleEl?.textContent?.trim() || slug.replace(/-/g, " ");

    // Difficulty
    const diffEl = document.querySelector('[class*="difficulty"], [class*="Difficulty"]');
    const difficulty = normalizeGfgDifficulty(diffEl?.textContent?.trim());

    // Language from dropdown
    const langEl = document.querySelector(
      'select[name="language"], [class*="language-dropdown"] option:checked, .select-language'
    );
    const language = normalizeGfgLanguage(langEl?.textContent?.trim() || langEl?.value || "");

    // Tags / topics
    const tagEls = document.querySelectorAll('[class*="tag"], [class*="topic"], [class*="category"]');
    const topics = Array.from(tagEls)
      .map(t => t.textContent.trim())
      .filter(t => t.length > 1 && t.length < 40);

    const code = extractGfgCode();

    const submission = {
      submission_id: `gfg_${slug}_${Date.now()}`,
      platform: "geeksforgeeks",
      problem: {
        id: slug,           // GFG doesn't use numeric IDs; slug IS the ID
        title: title,
        slug: slug,
        difficulty: difficulty,
        topics: topics,
        url: `https://practice.geeksforgeeks.org/problems/${slug}/`,
      },
      language: language,
      status: "Accepted",
      submitted_at: new Date().toISOString().replace(/\.\d+/, ""),
      code: code,
      runtime: null,
      memory: null,
    };

    console.log("[CodeStreak GFG] Sending accepted submission:", submission.problem.title);

    chrome.runtime.sendMessage(
      { type: "SUBMISSION_ACCEPTED", submission },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[CodeStreak GFG] Error:", chrome.runtime.lastError.message);
        } else {
          console.log("[CodeStreak GFG] Synced:", response);
        }
      }
    );
  }

  // ── MutationObserver ──────────────────────────────────────────────────────

  const observer = new MutationObserver(() => {
    const now = Date.now();
    if (now - _lastScan < 2000) return;
    _lastScan = now;

    // Only check on problem pages
    if (!/geeksforgeeks\.org\/problems\//.test(window.location.href)) return;
    if (isGfgAccepted()) handleGfgAccepted();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Initial check
  setTimeout(() => {
    if (/geeksforgeeks\.org\/problems\//.test(window.location.href)) {
      if (isGfgAccepted()) handleGfgAccepted();
    }
  }, 2000);
})();
