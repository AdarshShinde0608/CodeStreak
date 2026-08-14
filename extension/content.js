/**
 * content.js — CodeStreak Content Script
 *
 * Runs on every LeetCode page. Responsibilities:
 *   1. Intercept LeetCode's fetch calls to detect accepted submissions
 *   2. Extract the submitted code + problem metadata from the page
 *   3. Forward the normalized submission to the background service worker
 *
 * LeetCode SPA flow when you submit:
 *   POST /problems/{slug}/submit/          → returns { submission_id }
 *   GET  /submissions/detail/{id}/check/   → polls until status is set
 *        When status_display === "Accepted", we capture it.
 */

(function () {
  "use strict";

  // ── Prevent double-injection on SPA navigations ─────────────────────────
  if (window.__codestreakInjected) return;
  window.__codestreakInjected = true;

  // ── Patch window.fetch to intercept LeetCode submission results ──────────
  const _originalFetch = window.fetch.bind(window);

  window.fetch = async function (...args) {
    const response = await _originalFetch(...args);

    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url ?? "";

      // LeetCode submission check endpoint pattern
      if (
        url.includes("/submissions/detail/") &&
        url.includes("/check/")
      ) {
        const clone = response.clone();
        const data = await clone.json().catch(() => null);

        if (data && data.status_display === "Accepted") {
          console.log("[CodeStreak] ✅ Accepted submission detected!", data);
          handleAccepted(data, url);
        }
      }
    } catch (err) {
      // Never break the page
      console.warn("[CodeStreak] fetch intercept error:", err);
    }

    return response;
  };

  // ── Also patch XMLHttpRequest for fallback ────────────────────────────────
  const _originalXHROpen = XMLHttpRequest.prototype.open;
  const _originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__csUrl = url;
    return _originalXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      try {
        if (
          this.__csUrl &&
          this.__csUrl.includes("/submissions/detail/") &&
          this.__csUrl.includes("/check/")
        ) {
          const data = JSON.parse(this.responseText);
          if (data && data.status_display === "Accepted") {
            console.log("[CodeStreak] ✅ (XHR) Accepted!", data);
            handleAccepted(data, this.__csUrl);
          }
        }
      } catch (_) {}
    });
    return _originalXHRSend.apply(this, args);
  };

  // ── Dedup: track processed submission IDs in this session ─────────────────
  const _processedIds = new Set();

  // ── Main handler ──────────────────────────────────────────────────────────
  function handleAccepted(data, checkUrl) {
    const submissionId = String(data.submission_id || extractIdFromUrl(checkUrl));
    if (_processedIds.has(submissionId)) return;
    _processedIds.add(submissionId);

    // Short delay to allow DOM to finish rendering the result page
    setTimeout(() => {
      const submission = buildSubmission(data, submissionId);
      if (!submission) {
        console.warn("[CodeStreak] Could not build submission object");
        return;
      }

      console.log("[CodeStreak] Sending to background:", submission);
      chrome.runtime.sendMessage(
        { type: "SUBMISSION_ACCEPTED", submission },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn("[CodeStreak] Background error:", chrome.runtime.lastError.message);
          } else {
            console.log("[CodeStreak] Background response:", response);
          }
        }
      );
    }, 800);
  }

  // ── Build normalized submission object from page data ─────────────────────
  function buildSubmission(data, submissionId) {
    const slug = extractSlugFromUrl(window.location.href);
    if (!slug) return null;

    // Problem metadata from the page
    const titleEl    = document.querySelector('[data-cy="question-title"]')
                    || document.querySelector(".mr-2.text-label-1")
                    || document.querySelector("div.flex.items-start > div > a");
    const diffEl     = document.querySelector('[diff]')
                    || findDifficultyElement();

    const title      = titleEl?.textContent?.trim() || slug.replace(/-/g, " ");
    const difficulty = normalizeDifficulty(diffEl?.textContent?.trim() || data.difficulty || "");
    const language   = normalizeLanguage(data.lang || data.pretty_lang || "unknown");
    const code       = data.code || extractCodeFromEditor() || "";
    const runtime    = data.status_runtime || null;
    const memory     = data.status_memory  || null;

    return {
      submission_id: submissionId,
      problem: {
        id:         extractProblemId(),
        title:      title,
        slug:       slug,
        difficulty: difficulty,
        topics:     extractTopics(),
        url:        `https://leetcode.com/problems/${slug}/`,
      },
      language:            language,
      status:              "Accepted",
      submitted_at:        new Date().toISOString().replace(".000", "").replace(/\.\d+/, ""),
      runtime:             runtime,
      memory:              memory,
      runtime_percentile:  data.runtime_percentile  ?? null,
      memory_percentile:   data.memory_percentile   ?? null,
      code:                code,
    };
  }

  // ── DOM extraction helpers ────────────────────────────────────────────────

  function extractSlugFromUrl(url) {
    const match = url.match(/leetcode\.com\/problems\/([^/]+)/);
    return match ? match[1] : null;
  }

  function extractIdFromUrl(url) {
    const match = url.match(/\/submissions\/detail\/(\d+)/);
    return match ? match[1] : String(Date.now());
  }

  function extractProblemId() {
    // Try to get it from the page title like "1. Two Sum"
    const h4 = document.querySelector('a[href*="/problems/"]');
    if (h4) {
      const text = h4.textContent.trim();
      const match = text.match(/^(\d+)\./);
      if (match) return parseInt(match[1], 10);
    }
    // Fallback: look for number in breadcrumb
    const breadcrumb = document.querySelector('[class*="question-title"]');
    if (breadcrumb) {
      const m = breadcrumb.textContent.match(/^(\d+)\./);
      if (m) return parseInt(m[1], 10);
    }
    return 0;
  }

  function findDifficultyElement() {
    const selectors = [
      '[class*="difficulty"]',
      'span.text-difficulty-easy',
      'span.text-difficulty-medium',
      'span.text-difficulty-hard',
      '[class*="Easy"]',
      '[class*="Medium"]',
      '[class*="Hard"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function normalizeDifficulty(raw) {
    if (!raw) return "Unknown";
    const lower = raw.toLowerCase();
    if (lower.includes("easy"))   return "Easy";
    if (lower.includes("medium")) return "Medium";
    if (lower.includes("hard"))   return "Hard";
    return "Unknown";
  }

  function normalizeLanguage(lang) {
    const map = {
      "python":     "python3",
      "python3":    "python3",
      "c++":        "cpp",
      "c":          "c",
      "java":       "java",
      "javascript": "javascript",
      "typescript": "typescript",
      "c#":         "csharp",
      "go":         "golang",
      "kotlin":     "kotlin",
      "swift":      "swift",
      "rust":       "rust",
      "ruby":       "ruby",
      "scala":      "scala",
      "php":        "php",
      "mysql":      "mysql",
      "bash":       "bash",
    };
    return map[lang.toLowerCase()] || lang.toLowerCase();
  }

  function extractCodeFromEditor() {
    // Monaco editor stores its content — try the view lines
    const lines = document.querySelectorAll('.view-line');
    if (lines.length > 0) {
      return Array.from(lines).map(l => l.textContent).join('\n');
    }
    // CodeMirror fallback
    const cm = document.querySelector('.CodeMirror');
    if (cm?.CodeMirror) {
      return cm.CodeMirror.getValue();
    }
    return "";
  }

  function extractTopics() {
    // LeetCode sometimes shows topic tags on the problem page
    const tags = document.querySelectorAll('a[href*="/tag/"] span, [class*="topic-tag"]');
    return Array.from(tags).map(t => t.textContent.trim()).filter(Boolean);
  }

  console.log("[CodeStreak] Content script loaded on", window.location.href);
})();
