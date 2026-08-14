"""
leetcode_adapter.py
-------------------
Isolated adapter for all LeetCode HTTP communication.

This is the ONLY file that should know about LeetCode's internal API.
If LeetCode changes its endpoints or auth mechanism, only this file changes.

Authentication:
    Uses LEETCODE_SESSION cookie + csrftoken (same approach as LeetSync/LeetHub).
    Pass credentials via environment variables:
        LEETCODE_SESSION   — value of the 'LEETCODE_SESSION' cookie
        LEETCODE_CSRF_TOKEN — value of the 'csrftoken' cookie
"""

from __future__ import annotations

import os
import time
import logging
from dataclasses import dataclass, field
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Data models
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class Problem:
    """Normalized LeetCode problem metadata."""
    id: int
    title: str
    slug: str
    difficulty: str          # "Easy" | "Medium" | "Hard"
    topics: list[str] = field(default_factory=list)
    url: str = ""


@dataclass
class Submission:
    """Normalized LeetCode accepted submission."""
    submission_id: str
    problem: Problem
    language: str            # e.g. "python3", "cpp", "java"
    status: str              # "Accepted" (we only store accepted ones)
    submitted_at: str        # ISO-8601 UTC string e.g. "2026-08-14T18:32:10Z"
    code: str = ""
    runtime: Optional[str] = None          # e.g. "42 ms"
    memory: Optional[str] = None           # e.g. "18.2 MB"
    runtime_percentile: Optional[float] = None
    memory_percentile: Optional[float] = None


# ──────────────────────────────────────────────────────────────────────────────
# Language extension map
# ──────────────────────────────────────────────────────────────────────────────

LANGUAGE_EXTENSIONS: dict[str, str] = {
    "python":     "py",
    "python3":    "py",
    "c":          "c",
    "cpp":        "cpp",
    "java":       "java",
    "javascript": "js",
    "typescript": "ts",
    "csharp":     "cs",
    "golang":     "go",
    "kotlin":     "kt",
    "swift":      "swift",
    "rust":       "rs",
    "ruby":       "rb",
    "scala":      "scala",
    "php":        "php",
    "mysql":      "sql",
    "mssql":      "sql",
    "oraclesql":  "sql",
    "bash":       "sh",
    "erlang":     "erl",
    "elixir":     "ex",
    "racket":     "rkt",
}


def get_extension(language: str) -> str:
    """Return the file extension for a given LeetCode language string."""
    return LANGUAGE_EXTENSIONS.get(language.lower(), "txt")


# ──────────────────────────────────────────────────────────────────────────────
# LeetCode GraphQL queries
# ──────────────────────────────────────────────────────────────────────────────

GRAPHQL_URL = "https://leetcode.com/graphql/"
SUBMISSIONS_URL = "https://leetcode.com/api/submissions/"

PROBLEM_DETAIL_QUERY = """
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
"""

SUBMISSION_DETAIL_QUERY = """
query submissionDetails($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) {
    runtime
    runtimePercentile
    memoryUsage
    memoryPercentile
    code
    lang {
      name
    }
  }
}
"""


# ──────────────────────────────────────────────────────────────────────────────
# Adapter class
# ──────────────────────────────────────────────────────────────────────────────

class LeetCodeAdapter:
    """
    Handles all communication with LeetCode.

    Usage:
        adapter = LeetCodeAdapter()
        submissions = adapter.get_recent_accepted_submissions(limit=20)
        metadata = adapter.get_problem_metadata("two-sum")
    """

    BASE_URL = "https://leetcode.com"

    def __init__(
        self,
        session_token: Optional[str] = None,
        csrf_token: Optional[str] = None,
        retry_count: int = 3,
        retry_delay: float = 2.0,
    ) -> None:
        self.session_token = session_token or os.environ.get("LEETCODE_SESSION", "")
        self.csrf_token = csrf_token or os.environ.get("LEETCODE_CSRF_TOKEN", "")

        if not self.session_token:
            raise ValueError(
                "LEETCODE_SESSION is required. "
                "Set it via the environment variable LEETCODE_SESSION or pass it directly."
            )
        if not self.csrf_token:
            raise ValueError(
                "LEETCODE_CSRF_TOKEN is required. "
                "Set it via the environment variable LEETCODE_CSRF_TOKEN or pass it directly."
            )

        self.retry_count = retry_count
        self.retry_delay = retry_delay
        self._session = self._build_session()

    def _build_session(self) -> requests.Session:
        """Create an authenticated requests.Session."""
        s = requests.Session()
        s.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/125.0.0.0 Safari/537.36"
            ),
            "Referer": "https://leetcode.com/",
            "x-csrftoken": self.csrf_token,
            "Content-Type": "application/json",
        })
        s.cookies.set("LEETCODE_SESSION", self.session_token, domain="leetcode.com")
        s.cookies.set("csrftoken", self.csrf_token, domain="leetcode.com")
        return s

    # ──────────────────────────────────────────────────────────────────────
    # Internal helpers
    # ──────────────────────────────────────────────────────────────────────

    def _get(self, url: str, params: Optional[dict] = None) -> dict:
        """HTTP GET with retries."""
        for attempt in range(1, self.retry_count + 1):
            try:
                resp = self._session.get(url, params=params, timeout=15)
                resp.raise_for_status()
                return resp.json()
            except Exception as exc:
                logger.warning("GET %s attempt %d/%d failed: %s", url, attempt, self.retry_count, exc)
                if attempt < self.retry_count:
                    time.sleep(self.retry_delay * attempt)
        raise RuntimeError(f"Failed to GET {url} after {self.retry_count} attempts")

    def _graphql(self, query: str, variables: Optional[dict] = None) -> dict:
        """GraphQL POST with retries."""
        payload = {"query": query, "variables": variables or {}}
        for attempt in range(1, self.retry_count + 1):
            try:
                resp = self._session.post(GRAPHQL_URL, json=payload, timeout=15)
                resp.raise_for_status()
                return resp.json()
            except Exception as exc:
                logger.warning("GraphQL attempt %d/%d failed: %s", attempt, self.retry_count, exc)
                if attempt < self.retry_count:
                    time.sleep(self.retry_delay * attempt)
        raise RuntimeError(f"GraphQL query failed after {self.retry_count} attempts")

    # ──────────────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────────────

    def get_recent_submissions(self, limit: int = 20) -> list[dict]:
        """
        Fetch raw recent submissions from LeetCode.
        Returns a list of raw submission dicts (not normalized).
        """
        logger.info("Fetching %d recent submissions…", limit)
        data = self._get(SUBMISSIONS_URL, params={"limit": limit, "offset": 0})
        return data.get("submissions_dump", [])

    def get_recent_accepted_submissions(self, limit: int = 20) -> list[dict]:
        """Return only accepted submissions from recent history."""
        raw = self.get_recent_submissions(limit=limit)
        accepted = [s for s in raw if s.get("status_display") == "Accepted"]
        logger.info("Found %d accepted out of %d recent submissions", len(accepted), len(raw))
        return accepted

    def get_problem_metadata(self, slug: str) -> Problem:
        """
        Fetch problem metadata (id, title, difficulty, topics) by slug.
        e.g. slug = "two-sum"
        """
        logger.info("Fetching metadata for problem: %s", slug)
        result = self._graphql(PROBLEM_DETAIL_QUERY, {"titleSlug": slug})
        q = result.get("data", {}).get("question", {})
        if not q:
            raise ValueError(f"Could not fetch metadata for problem slug: {slug}")

        topics = [tag["name"] for tag in q.get("topicTags", [])]
        return Problem(
            id=int(q.get("questionFrontendId", 0)),
            title=q.get("title", ""),
            slug=q.get("titleSlug", slug),
            difficulty=q.get("difficulty", "Unknown"),
            topics=topics,
            url=f"https://leetcode.com/problems/{slug}/",
        )

    def get_submission_detail(self, submission_id: str | int) -> dict:
        """
        Fetch detailed submission info (code, runtime, memory, percentiles).
        Returns raw dict from LeetCode GraphQL.
        """
        logger.info("Fetching submission detail: %s", submission_id)
        result = self._graphql(SUBMISSION_DETAIL_QUERY, {"submissionId": int(submission_id)})
        return result.get("data", {}).get("submissionDetails", {}) or {}

    def build_normalized_submission(self, raw: dict) -> Submission:
        """
        Convert a raw LeetCode submission dict (from /api/submissions/)
        into a normalized Submission object, fetching detail & metadata as needed.
        """
        import datetime

        submission_id = str(raw.get("id", ""))
        slug = raw.get("title_slug", "")
        lang = raw.get("lang", "unknown")

        # Timestamp: LeetCode returns Unix timestamp
        ts = raw.get("timestamp", 0)
        submitted_at = datetime.datetime.utcfromtimestamp(ts).strftime("%Y-%m-%dT%H:%M:%SZ")

        # Fetch details (code + performance)
        detail = self.get_submission_detail(submission_id)
        code = detail.get("code", raw.get("code", ""))
        runtime = detail.get("runtime")
        memory = detail.get("memoryUsage")
        runtime_pct = detail.get("runtimePercentile")
        memory_pct = detail.get("memoryPercentile")

        # Normalize language from detail if available
        lang_detail = detail.get("lang", {})
        if isinstance(lang_detail, dict):
            lang = lang_detail.get("name", lang)

        # Fetch problem metadata
        problem = self.get_problem_metadata(slug)

        return Submission(
            submission_id=submission_id,
            problem=problem,
            language=lang,
            status="Accepted",
            submitted_at=submitted_at,
            code=code,
            runtime=runtime,
            memory=memory,
            runtime_percentile=runtime_pct,
            memory_percentile=memory_pct,
        )
