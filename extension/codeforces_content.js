/**
 * codeforces_content.js — CodeStreak Codeforces Content Script
 *
 * Runs on codeforces.com pages. Detects accepted submission verdicts
 * and sends SUBMISSION_ACCEPTED to background.js for GitHub commit.
 *
 * Implements: CF-04
 *
 * Trigger points:
 *   1. /contest/<id>/submission/<id> pages — direct submission result page
 *   2. /problemset/status page — user's recent submission list
 *   3. DOM mutation observer — for SPA navigation on result pages
 */

(function () {
  "use strict";

  if (window.__codestreakCfInjected) return;
  window.__codestreakCfInjected = true;

  console.log("[CodeStreak CF] Content script initialized on", window.location.href);

  const _processedIds = new Set();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function getCurrentUrl() { return window.location.href; }

  /** Extract contest ID from URL like /contest/1234/... or /problemset/problem/1234/A */
  function extractContestId(url) {
    const m = url.match(/\/contest\/(\d+)/) || url.match(/\/problemset\/problem\/(\d+)/);
    return m ? m[1] : null;
  }

  /** Extract problem index from URL like /problem/A or /problem/B1 */
  function extractProblemIndex(url) {
    const m = url.match(/\/problem\/([A-Z]\d*)/) || url.match(/\/problems\/([A-Z]\d*)/i);
    return m ? m[1].toUpperCase() : null;
  }

  /** Extract submission ID from URL */
  function extractSubmissionId(url) {
    const m = url.match(/\/submission\/(\d+)/) || url.match(/\/submissions\/(\d+)/);
    return m ? m[1] : null;
  }

  /** Map CF language labels to canonical slugs */
  function normalizeCfLanguage(lang) {
    if (!lang) return "cpp";
    const l = lang.toLowerCase();
    if (l.includes("c++")) return "cpp";
    if (l.includes("python")) return "python3";
    if (l.includes("java")) return "java";
    if (l.includes("kotlin")) return "kotlin";
    if (l.includes("go")) return "golang";
    if (l.includes("rust")) return "rust";
    if (l.includes("c#") || l.includes("csharp")) return "csharp";
    if (l.startsWith("c")) return "c";
    return l.replace(/\s+/g, "_");
  }

  /** Extract source code from the Codeforces submission detail page */
  function extractCfCode() {
    // Submission detail view
    const pre = document.querySelector("#program-source-text")
      || document.querySelector(".program-source")
      || document.querySelector("pre.prettyprint");
    if (pre) return pre.textContent || pre.innerText || "";
    return "";
  }

  /** Extract problem info from the Codeforces page */
  function extractProblemInfo() {
    const url = getCurrentUrl();
    const contestId = extractContestId(url);
    const index     = extractProblemIndex(url);

    // Title from page header
    const titleEl = document.querySelector(".problem-statement .title")
      || document.querySelector("div.title");
    const title = titleEl?.textContent?.trim() || "";

    // Rating not reliably available on result pages — will be fetched via API
    return { contestId, index, title };
  }

  /** Check if the verdict element on this page shows "Accepted" */
  function isAccepted() {
    // Submission result page
    const verdictEl = document.querySelector(".verdict-accepted")
      || document.querySelector('[class*="verdict-accepted"]');
    if (verdictEl) return true;

    // Status page rows
    const accepted = document.querySelectorAll(".verdict-accepted");
    return accepted.length > 0;
  }

  /** Extract language from submission row or detail page */
  function extractLanguage() {
    const langEl = document.querySelector(".language-icon + span")
      || document.querySelector(".cell-lang")
      || document.querySelector('[name="sourceFileType"]');
    return langEl?.textContent?.trim() || "cpp";
  }

  // ── Main detection logic ──────────────────────────────────────────────────

  function handleAcceptedSubmission(submissionId) {
    if (_processedIds.has(submissionId)) return;
    _processedIds.add(submissionId);

    const url = getCurrentUrl();
    const { contestId, index, title } = extractProblemInfo();

    if (!contestId || !index) {
      console.log("[CodeStreak CF] Could not extract contest/problem info from URL:", url);
      return;
    }

    const slug    = `${contestId}-${index}`.toLowerCase();
    const probId  = `${contestId}${index}`;
    const langRaw = extractLanguage();
    const lang    = normalizeCfLanguage(langRaw);
    const code    = extractCfCode();
    const probUrl = `https://codeforces.com/contest/${contestId}/problem/${index}`;

    const submission = {
      submission_id: submissionId || `cf_${contestId}_${index}_${Date.now()}`,
      platform: "codeforces",
      problem: {
        id: probId,
        title: title || `Problem ${index}`,
        slug: slug,
        difficulty: "Unknown",   // Rating/difficulty enriched via API in background
        topics: [],
        url: probUrl,
      },
      language: lang,
      status: "Accepted",
      submitted_at: new Date().toISOString().replace(/\.\d+/, ""),
      code: code,
      runtime: null,
      memory: null,
    };

    console.log("[CodeStreak CF] Sending accepted submission to background:", submission.problem.title);

    chrome.runtime.sendMessage(
      { type: "SUBMISSION_ACCEPTED", submission },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[CodeStreak CF] Error:", chrome.runtime.lastError.message);
        } else {
          console.log("[CodeStreak CF] Synced:", response);
        }
      }
    );
  }

  // ── Page scan ─────────────────────────────────────────────────────────────

  function scanPage() {
    const url = getCurrentUrl();

    // Only act on relevant pages
    const isSubmissionPage = /codeforces\.com\/(contest\/\d+\/submission\/\d+|submissions\/\d+)/.test(url);
    const isStatusPage     = /codeforces\.com\/(problemset\/status|contest\/\d+\/my)/.test(url);

    if (!isSubmissionPage && !isStatusPage) return;

    if (isAccepted()) {
      const sid = extractSubmissionId(url) || `cf_dom_${Date.now()}`;
      handleAcceptedSubmission(sid);
    }
  }

  // ── MutationObserver for SPA navigation ───────────────────────────────────

  let _lastScan = 0;
  const observer = new MutationObserver(() => {
    const now = Date.now();
    if (now - _lastScan < 2000) return;
    _lastScan = now;
    scanPage();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Initial scan
  setTimeout(scanPage, 1000);
  setTimeout(scanPage, 3000); // retry after dynamic content loads
})();
