/**
 * content.js — CodeStreak Content Script
 *
 * Runs on every LeetCode page. Responsibilities:
 *   1. Listen for submission events posted from injected.js (MAIN world)
 *   2. Observe DOM mutations for "Accepted" submission banners
 *   3. Extract code + metadata and send SUBMISSION_ACCEPTED to background.js
 */

(function () {
  "use strict";

  if (window.__codestreakInjected) return;
  window.__codestreakInjected = true;

  console.log("[CodeStreak] Content script initialized on", window.location.href);

  // ── Inject script fallback (ensures injected.js is running in page context) ──
  function ensureInjectedScript() {
    try {
      const scriptUrl = chrome.runtime.getURL("injected.js");
      if (!document.querySelector(`script[src="${scriptUrl}"]`)) {
        const s = document.createElement("script");
        s.src = scriptUrl;
        s.onload = () => s.remove();
        (document.head || document.documentElement).appendChild(s);
      }
    } catch (_) {}
  }
  ensureInjectedScript();

  // ── Dedup: track processed submission IDs in this session ─────────────────
  const _processedIds = new Set();

  // ── Listen for messages from injected.js (MAIN world) ─────────────────────
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type === "CODESTREAK_ACCEPTED_SUBMISSION") {
      const { data, checkUrl, submissionId, slug, code, language } = event.data.payload || {};
      const sid = String(submissionId || data?.submission_id || extractIdFromUrl(checkUrl || ""));
      if (!sid || _processedIds.has(sid)) return;
      _processedIds.add(sid);

      console.log("[CodeStreak] Received accepted submission event from page:", sid, slug);

      setTimeout(() => {
        const submission = buildSubmission(data || {}, sid, slug, code, language);
        if (submission) {
          forwardToBackground(submission);
        }
      }, 500);
    }
  });

  // ── DOM MutationObserver Fallback for "Accepted" banner ───────────────────
  let _lastDomScanTime = 0;
  const observer = new MutationObserver(() => {
    const now = Date.now();
    if (now - _lastDomScanTime < 2000) return;

    const acceptedEl = document.querySelector('[data-e2e-locator="submission-result"]')
      || document.querySelector('.text-green-s')
      || document.querySelector('span[class*="text-success"]');

    if (acceptedEl && acceptedEl.textContent.includes("Accepted")) {
      _lastDomScanTime = now;
      const slug = extractSlugFromUrl(window.location.href);
      if (slug) {
        console.log("[CodeStreak DOM] Detected 'Accepted' banner on page for slug:", slug);
        const sid = "dom_" + now;
        if (!_processedIds.has(sid) && _processedIds.size === 0) {
          const submission = buildSubmission({}, sid, slug);
          if (submission) {
            forwardToBackground(submission);
          }
        }
      }
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  // ── Send to background.js ────────────────────────────────────────────────
  function forwardToBackground(submission) {
    console.log("[CodeStreak] Sending to background:", submission);
    chrome.runtime.sendMessage(
      { type: "SUBMISSION_ACCEPTED", submission },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[CodeStreak] Background message error:", chrome.runtime.lastError.message);
        } else {
          console.log("[CodeStreak] Background response:", response);
        }
      }
    );
  }

  // ── Build normalized submission object ────────────────────────────────────
  function buildSubmission(data = {}, submissionId = "", passedSlug = "", passedCode = "", passedLang = "") {
    const slug = passedSlug || extractSlugFromUrl(window.location.href);
    if (!slug) return null;

    const titleEl = document.querySelector('[data-cy="question-title"]')
      || document.querySelector(".mr-2.text-label-1")
      || document.querySelector("div.flex.items-start > div > a");
    const diffEl = document.querySelector('[diff]') || findDifficultyElement();

    const title = titleEl?.textContent?.trim() || data.title || slug.replace(/-/g, " ");
    const difficulty = normalizeDifficulty(diffEl?.textContent?.trim() || data.difficulty || "");
    const language = normalizeLanguage(passedLang || data.lang || data.pretty_lang || "unknown");
    const code = passedCode || data.code || extractCodeFromEditor() || "";
    const runtime = data.status_runtime || data.runtime || null;
    const memory = data.status_memory || data.memory || null;

    return {
      submission_id: submissionId || String(Date.now()),
      problem: {
        id: extractProblemId() || data.question_id || 0,
        title: title,
        slug: slug,
        difficulty: difficulty,
        topics: extractTopics(),
        url: `https://leetcode.com/problems/${slug}/`,
      },
      language: language,
      status: "Accepted",
      submitted_at: new Date().toISOString().replace(".000", "").replace(/\.\d+/, ""),
      runtime: runtime,
      memory: memory,
      runtime_percentile: data.runtime_percentile ?? null,
      memory_percentile: data.memory_percentile ?? null,
      code: code,
    };
  }

  // ── DOM extraction helpers ────────────────────────────────────────────────

  function extractSlugFromUrl(url) {
    if (!url) return null;
    const match = url.match(/leetcode\.com\/problems\/([^/]+)/) || url.match(/\/problems\/([^/]+)/);
    return match ? match[1] : null;
  }

  function extractIdFromUrl(url) {
    if (!url) return "";
    const match = url.match(/\/submissions\/detail\/(\d+)/);
    return match ? match[1] : "";
  }

  function extractProblemId() {
    const h4 = document.querySelector('a[href*="/problems/"]');
    if (h4) {
      const text = h4.textContent.trim();
      const match = text.match(/^(\d+)\./);
      if (match) return parseInt(match[1], 10);
    }
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
    if (lower.includes("easy")) return "Easy";
    if (lower.includes("medium")) return "Medium";
    if (lower.includes("hard")) return "Hard";
    return "Unknown";
  }

  function normalizeLanguage(lang) {
    const map = {
      python: "python3",
      python3: "python3",
      "c++": "cpp",
      c: "c",
      java: "java",
      javascript: "javascript",
      typescript: "typescript",
      "c#": "csharp",
      go: "golang",
      kotlin: "kotlin",
      swift: "swift",
      rust: "rust",
      ruby: "ruby",
      scala: "scala",
      php: "php",
      mysql: "mysql",
      bash: "bash",
    };
    return map[lang.toLowerCase()] || lang.toLowerCase();
  }

  function extractCodeFromEditor() {
    const lines = document.querySelectorAll(".view-line");
    if (lines.length > 0) {
      return Array.from(lines)
        .map((l) => l.textContent)
        .join("\n");
    }
    const cm = document.querySelector(".CodeMirror");
    if (cm?.CodeMirror) {
      return cm.CodeMirror.getValue();
    }
    return "";
  }

  function extractTopics() {
    const tags = document.querySelectorAll('a[href*="/tag/"] span, [class*="topic-tag"]');
    return Array.from(tags)
      .map((t) => t.textContent.trim())
      .filter(Boolean);
  }
})();
