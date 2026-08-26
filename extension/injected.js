/**
 * injected.js — CodeStreak Main World Script
 *
 * Runs directly in the web page execution context (MAIN world).
 * Intercepts LeetCode fetch & XMLHttpRequest calls to detect accepted submissions
 * and extracts the submitted code directly from Monaco Editor / submit payload.
 */

(function () {
  "use strict";

  if (window.__codestreakMainInjected) return;
  window.__codestreakMainInjected = true;

  console.log("[CodeStreak Main] Injected into page context.");

  let _lastSubmittedCode = "";
  let _lastSubmittedLang = "";
  let _lastSubmittedSlug = "";
  const _processedSubmissionIds = new Set();

  function getMonacoCode() {
    try {
      if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels();
        if (models && models.length > 0) {
          return models[0].getValue();
        }
      }
    } catch (_) {}
    return "";
  }

  function extractSlugFromUrl(url) {
    if (!url) return "";
    const match = url.match(/leetcode\.com\/problems\/([^/]+)/) || url.match(/\/problems\/([^/]+)/);
    return match ? match[1] : "";
  }

  function notifyAccepted(data, checkUrl) {
    const submissionId = String(data.submission_id || data.id || "");
    if (submissionId && _processedSubmissionIds.has(submissionId)) {
      return;
    }
    if (submissionId) {
      _processedSubmissionIds.add(submissionId);
    }

    const currentSlug = extractSlugFromUrl(window.location.href) || _lastSubmittedSlug;
    const monacoCode = getMonacoCode();
    const finalCode = data.code || _lastSubmittedCode || monacoCode || "";
    const finalLang = data.lang || data.pretty_lang || _lastSubmittedLang || "";

    console.log("[CodeStreak Main] 🚀 Dispatching accepted submission event:", {
      submissionId,
      slug: currentSlug,
      hasCode: !!finalCode,
    });

    window.postMessage(
      {
        type: "CODESTREAK_ACCEPTED_SUBMISSION",
        payload: {
          data,
          checkUrl,
          submissionId,
          slug: currentSlug,
          code: finalCode,
          language: finalLang,
        },
      },
      "*"
    );
  }

  // ── 1. Intercept window.fetch ───────────────────────────────────────────────
  const _origFetch = window.fetch.bind(window);

  window.fetch = async function (...args) {
    const requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url || "";

    // Track submit POST payload if available
    try {
      if (requestUrl.includes("/submit/") && args[1] && args[1].body) {
        const parsed = JSON.parse(args[1].body);
        if (parsed.typed_code) _lastSubmittedCode = parsed.typed_code;
        if (parsed.lang) _lastSubmittedLang = parsed.lang;
        _lastSubmittedSlug = extractSlugFromUrl(requestUrl) || extractSlugFromUrl(window.location.href);
      }
    } catch (_) {}

    const response = await _origFetch(...args);

    try {
      // Check polling endpoint: /submissions/detail/{id}/check/
      if (requestUrl.includes("/submissions/detail/") && requestUrl.includes("/check/")) {
        const clone = response.clone();
        const data = await clone.json().catch(() => null);

        if (data && (data.status_display === "Accepted" || data.status_code === 10)) {
          notifyAccepted(data, requestUrl);
        }
      }

      // Check GraphQL responses that might contain submission details
      if (requestUrl.includes("/graphql")) {
        const clone = response.clone();
        const data = await clone.json().catch(() => null);

        if (data?.data?.submissionDetails?.statusDisplay === "Accepted") {
          notifyAccepted(data.data.submissionDetails, requestUrl);
        }
      }
    } catch (err) {
      console.warn("[CodeStreak Main] fetch hook error:", err);
    }

    return response;
  };

  // ── 2. Intercept XMLHttpRequest ───────────────────────────────────────────
  const _origXHROpen = XMLHttpRequest.prototype.open;
  const _origXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__csUrl = url;
    this.__csMethod = method;
    return _origXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body, ...rest) {
    try {
      if (this.__csUrl && this.__csUrl.includes("/submit/") && body) {
        const parsed = JSON.parse(body);
        if (parsed.typed_code) _lastSubmittedCode = parsed.typed_code;
        if (parsed.lang) _lastSubmittedLang = parsed.lang;
        _lastSubmittedSlug = extractSlugFromUrl(this.__csUrl) || extractSlugFromUrl(window.location.href);
      }
    } catch (_) {}

    this.addEventListener("load", function () {
      try {
        if (
          this.__csUrl &&
          this.__csUrl.includes("/submissions/detail/") &&
          this.__csUrl.includes("/check/")
        ) {
          const data = JSON.parse(this.responseText);
          if (data && (data.status_display === "Accepted" || data.status_code === 10)) {
            notifyAccepted(data, this.__csUrl);
          }
        }
      } catch (_) {}
    });

    return _origXHRSend.call(this, body, ...rest);
  };
})();
