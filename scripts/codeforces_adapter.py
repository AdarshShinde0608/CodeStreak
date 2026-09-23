"""
codeforces_adapter.py
---------------------
Isolated adapter for all Codeforces HTTP communication.

This is the ONLY file that should know about Codeforces' REST API structure.
If Codeforces changes its endpoints or response format, only this file changes.

Authentication:
    Codeforces submissions API is publicly accessible for most fields.
    For private submissions, an API key is needed (supported but optional).

    Set via environment variables:
        CF_HANDLE          -- Codeforces username/handle (REQUIRED)
        CF_API_KEY         -- API key (optional, for private data)
        CF_API_SECRET      -- API secret (optional, paired with CF_API_KEY)

Rate limiting:
    Codeforces enforces < 5 requests/second.
    This adapter uses a 0.25s inter-request delay (= 4 req/sec max).

Requirements:
    CF-01: Fetch accepted submissions via user.status with rate-limiting
    CF-02: Normalize problem metadata (contest ID, index, name, rating, tags)
    CF-03: Map numeric ratings (800-3500) to Easy / Medium / Hard tiers
"""

from __future__ import annotations

import os
import time
import hashlib
import logging
import random
import string
from dataclasses import dataclass, field
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────────────

CF_API_BASE    = "https://codeforces.com/api"
REQUEST_DELAY  = 0.25    # seconds between requests — keeps us under 5 req/s  (CF-01)
MAX_RETRIES    = 3
RETRY_DELAY    = 2.0


# ──────────────────────────────────────────────────────────────────────────────
# Difficulty mapping  (CF-03)
# ──────────────────────────────────────────────────────────────────────────────

def rating_to_difficulty(rating: Optional[int]) -> str:
    """
    Map a Codeforces numeric problem rating to a normalized difficulty tier.

    Tiers (heuristic, widely used in competitive programming community):
        Easy   : <= 1400
        Medium : 1401 - 2099
        Hard   : >= 2100
        Unknown: no rating available
    """
    if rating is None:
        return "Unknown"
    if rating <= 1400:
        return "Easy"
    if rating <= 2099:
        return "Medium"
    return "Hard"


# ──────────────────────────────────────────────────────────────────────────────
# Data models
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class CFProblem:
    """Normalized Codeforces problem metadata (CF-02)."""
    contest_id: int            # e.g. 1234
    index: str                 # e.g. "A", "B", "C1"
    title: str                 # e.g. "Two Sum"
    rating: Optional[int]      # Numeric rating e.g. 1400 (preserved)
    difficulty: str            # "Easy" | "Medium" | "Hard" | "Unknown"  (CF-03)
    tags: list[str] = field(default_factory=list)
    # Canonical unified fields (matches LeetCode schema)
    id: str = ""               # "{contest_id}{index}" e.g. "1234A"
    slug: str = ""             # "{contest_id}-{index}" e.g. "1234-A"
    url: str = ""

    def __post_init__(self) -> None:
        self.id   = f"{self.contest_id}{self.index}"
        self.slug = f"{self.contest_id}-{self.index}".lower()
        self.url  = f"https://codeforces.com/contest/{self.contest_id}/problem/{self.index}"


@dataclass
class CFSubmission:
    """Normalized Codeforces accepted submission (canonical schema)."""
    submission_id: str
    problem: CFProblem
    language: str         # e.g. "GNU C++17", "Python 3", "Java 11"
    status: str           # "Accepted"
    submitted_at: str     # ISO-8601 UTC e.g. "2026-08-14T18:32:10Z"
    platform: str = "codeforces"
    code: str = ""        # Source code (not available via public API without auth)
    runtime: Optional[str] = None   # e.g. "62 ms"
    memory: Optional[str] = None    # e.g. "14400 KB"

    def to_canonical_dict(self) -> dict:
        """Convert to the canonical submission dict used by process_submission.py."""
        return {
            "submission_id": self.submission_id,
            "platform": self.platform,
            "problem": {
                "id": self.problem.id,
                "title": self.problem.title,
                "slug": self.problem.slug,
                "difficulty": self.problem.difficulty,
                "rating": self.problem.rating,        # extra: preserved numeric rating
                "topics": self.problem.tags,
                "url": self.problem.url,
            },
            "language": self.language,
            "status": self.status,
            "submitted_at": self.submitted_at,
            "code": self.code,
            "runtime": self.runtime,
            "memory": self.memory,
        }


# ──────────────────────────────────────────────────────────────────────────────
# Language normalizer
# ──────────────────────────────────────────────────────────────────────────────

# Maps Codeforces verbose language names to short canonical slugs
_CF_LANG_MAP: dict[str, str] = {
    "gnu c++17":          "cpp",
    "gnu c++14":          "cpp",
    "gnu c++17 (64)":     "cpp",
    "microsoft visual c++ 2017": "cpp",
    "gcc 9.2.0":          "c",
    "python 3":           "python3",
    "pypy 3":             "python3",
    "java 11":            "java",
    "java 17":            "java",
    "kotlin 1.7":         "kotlin",
    "kotlin":             "kotlin",
    "javascript":         "javascript",
    "node.js":            "javascript",
    "go":                 "golang",
    "rust 2021":          "rust",
    "csharp":             "csharp",
    "mono c#":            "csharp",
    "d":                  "d",
    "ocaml":              "ocaml",
    "haskell":            "haskell",
    "pascal":             "pascal",
    "delphi":             "pascal",
}

LANGUAGE_EXTENSIONS: dict[str, str] = {
    "cpp":        "cpp",
    "c":          "c",
    "python3":    "py",
    "java":       "java",
    "kotlin":     "kt",
    "javascript": "js",
    "golang":     "go",
    "rust":       "rs",
    "csharp":     "cs",
    "d":          "d",
    "ocaml":      "ml",
    "haskell":    "hs",
    "pascal":     "pas",
}


def normalize_language(cf_lang: str) -> str:
    """Normalize a Codeforces verbose language label to a short slug."""
    key = cf_lang.lower().strip()
    return _CF_LANG_MAP.get(key, key.replace(" ", "_"))


def get_extension(language: str) -> str:
    """Return file extension for a normalized Codeforces language slug."""
    return LANGUAGE_EXTENSIONS.get(language.lower(), "txt")


# ──────────────────────────────────────────────────────────────────────────────
# API client
# ──────────────────────────────────────────────────────────────────────────────

class CodeforcesAdapter:
    """
    Client for the Codeforces REST API.

    Usage:
        adapter = CodeforcesAdapter(handle="tourist")
        submissions = adapter.get_accepted_submissions()
        for sub in submissions:
            print(sub.problem.title, sub.problem.difficulty)
    """

    def __init__(
        self,
        handle: Optional[str] = None,
        api_key: Optional[str] = None,
        api_secret: Optional[str] = None,
        max_retries: int = MAX_RETRIES,
        retry_delay: float = RETRY_DELAY,
    ) -> None:
        self.handle     = handle or os.environ.get("CF_HANDLE", "").strip()
        self.api_key    = api_key or os.environ.get("CF_API_KEY", "").strip()
        self.api_secret = api_secret or os.environ.get("CF_API_SECRET", "").strip()
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self._last_request_time: float = 0.0

        if not self.handle:
            raise ValueError(
                "CF_HANDLE is required. Set it via the CF_HANDLE environment variable "
                "or pass it directly to CodeforcesAdapter(handle=...)."
            )

        self._session = requests.Session()
        self._session.headers.update({
            "User-Agent": (
                "CodeStreak/1.0 (https://github.com/AdarshShinde0608/CodeStreak) "
                "Python-requests"
            ),
        })

    # ──────────────────────────────────────────────────────────────────────
    # Internal helpers
    # ──────────────────────────────────────────────────────────────────────

    def _rate_limit(self) -> None:
        """Sleep to ensure we stay under 4 requests/second (CF-01)."""
        elapsed = time.time() - self._last_request_time
        if elapsed < REQUEST_DELAY:
            time.sleep(REQUEST_DELAY - elapsed)
        self._last_request_time = time.time()

    def _build_auth_params(self, method: str, params: dict) -> dict:
        """
        Append API key + HMAC-SHA512 signature if credentials are available.
        Required for accessing private submission data.
        """
        if not self.api_key or not self.api_secret:
            return params

        import hmac, hashlib
        rand = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
        time_val = str(int(time.time()))

        params = dict(params)
        params["apiKey"] = self.api_key
        params["time"]   = time_val

        sorted_params = "&".join(f"{k}={v}" for k, v in sorted(params.items()))
        sig_str = f"{rand}/{method}?{sorted_params}#{self.api_secret}"
        sig = hmac.new(
            self.api_secret.encode(),
            sig_str.encode(),
            hashlib.sha512,
        ).hexdigest()

        params["apiSig"] = f"{rand}{sig}"
        return params

    def _get(self, method: str, params: Optional[dict] = None) -> dict:
        """Make an authenticated GET request to the Codeforces API with retries."""
        params = params or {}
        params = self._build_auth_params(method, params)

        url = f"{CF_API_BASE}/{method}"

        for attempt in range(1, self.max_retries + 1):
            self._rate_limit()
            try:
                resp = self._session.get(url, params=params, timeout=15)
                resp.raise_for_status()
                data = resp.json()

                if data.get("status") == "OK":
                    return data.get("result", {})

                # CF API-level error
                comment = data.get("comment", "Unknown error")
                raise RuntimeError(f"Codeforces API error: {comment}")

            except RuntimeError:
                raise
            except Exception as exc:
                logger.warning(
                    "CF API %s attempt %d/%d failed: %s",
                    method, attempt, self.max_retries, exc,
                )
                if attempt < self.max_retries:
                    time.sleep(self.retry_delay * attempt)

        raise RuntimeError(f"CF API {method} failed after {self.max_retries} attempts")

    # ──────────────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────────────

    def get_user_submissions(self, count: int = 100) -> list[dict]:
        """
        Fetch raw user submissions from Codeforces API.
        Returns a list of raw submission dicts (CF-01).
        """
        logger.info("Fetching up to %d submissions for user: %s", count, self.handle)
        return self._get("user.status", {"handle": self.handle, "count": count})

    def get_accepted_submissions(self, count: int = 100) -> list[dict]:
        """Return only Accepted (verdict='OK') submissions."""
        raw = self.get_user_submissions(count=count)
        accepted = [s for s in raw if s.get("verdict") == "OK"]
        logger.info(
            "Found %d accepted out of %d total submissions",
            len(accepted), len(raw)
        )
        return accepted

    def normalize_submission(self, raw: dict) -> CFSubmission:
        """
        Convert a raw Codeforces submission dict to a normalized CFSubmission.
        Implements CF-02 (metadata normalization) and CF-03 (rating -> tier mapping).
        """
        import datetime

        sid = str(raw.get("id", ""))
        prob = raw.get("problem", {})

        contest_id  = prob.get("contestId", 0)
        index       = prob.get("index", "A")
        title       = prob.get("name", "")
        rating      = prob.get("rating")           # numeric e.g. 1400 (CF-03)
        tags        = prob.get("tags", [])
        difficulty  = rating_to_difficulty(rating) # CF-03

        # Timestamp: CF returns Unix epoch seconds
        ts = raw.get("creationTimeSeconds", 0)
        submitted_at = datetime.datetime.utcfromtimestamp(ts).strftime("%Y-%m-%dT%H:%M:%SZ")

        # Language normalization
        lang_raw = raw.get("programmingLanguage", "unknown")
        language = normalize_language(lang_raw)

        # Runtime and memory
        time_ms   = raw.get("timeConsumedMillis")
        mem_bytes = raw.get("memoryConsumedBytes")
        runtime = f"{time_ms} ms"   if time_ms   is not None else None
        memory  = f"{mem_bytes // 1024} KB" if mem_bytes is not None else None

        problem = CFProblem(
            contest_id=contest_id,
            index=index,
            title=title,
            rating=rating,
            difficulty=difficulty,
            tags=tags,
        )

        return CFSubmission(
            submission_id=sid,
            problem=problem,
            language=language,
            status="Accepted",
            submitted_at=submitted_at,
            runtime=runtime,
            memory=memory,
        )

    def get_normalized_accepted_submissions(self, count: int = 100) -> list[CFSubmission]:
        """
        Fetch and normalize all accepted submissions for the configured handle.
        Returns a list of CFSubmission objects ready for use by process_submission.py.
        """
        raw_subs = self.get_accepted_submissions(count=count)
        normalized: list[CFSubmission] = []

        for raw in raw_subs:
            try:
                sub = self.normalize_submission(raw)
                normalized.append(sub)
            except Exception as exc:
                logger.warning("Failed to normalize submission %s: %s", raw.get("id"), exc)

        # Deduplicate: keep latest submission per problem (contest_id + index + language)
        seen: dict[str, CFSubmission] = {}
        for sub in sorted(normalized, key=lambda s: s.submitted_at, reverse=True):
            key = f"{sub.problem.contest_id}:{sub.problem.index}:{sub.language}"
            if key not in seen:
                seen[key] = sub

        deduped = list(seen.values())
        logger.info("Returning %d unique accepted solutions", len(deduped))
        return deduped


# ──────────────────────────────────────────────────────────────────────────────
# CLI (standalone testing)
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    import json

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    parser = argparse.ArgumentParser(description="Fetch Codeforces accepted submissions")
    parser.add_argument("--handle", default=os.environ.get("CF_HANDLE", ""), help="Codeforces handle")
    parser.add_argument("--count", type=int, default=50, help="Max submissions to fetch")
    parser.add_argument("--output", default="-", help="Output JSON file path (- for stdout)")
    args = parser.parse_args()

    adapter = CodeforcesAdapter(handle=args.handle)
    subs = adapter.get_normalized_accepted_submissions(count=args.count)

    canonical = [s.to_canonical_dict() for s in subs]

    output = json.dumps(canonical, indent=2, ensure_ascii=False)
    if args.output == "-":
        print(output)
    else:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output)
        logger.info("Wrote %d submissions to %s", len(canonical), args.output)
