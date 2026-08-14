"""
fetch_submissions.py
--------------------
Entry point for fetching new accepted LeetCode submissions.

Workflow:
    1. Load existing submission IDs from data/submissions.json (dedup set)
    2. Call LeetCode adapter to get recent accepted submissions
    3. Filter out already-processed submissions
    4. Return only NEW submissions

Usage (standalone):
    python scripts/fetch_submissions.py
    
    Returns JSON list of new submissions to stdout.
    Called by main.py / GitHub Actions.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path

# Ensure scripts/ is importable regardless of cwd
sys.path.insert(0, str(Path(__file__).parent))

from leetcode_adapter import LeetCodeAdapter, Submission

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Paths
# ──────────────────────────────────────────────────────────────────────────────

ROOT_DIR = Path(__file__).parent.parent
SUBMISSIONS_DB = ROOT_DIR / "data" / "submissions.json"


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def load_existing_ids() -> set[str]:
    """Load the set of already-processed submission IDs from the JSON DB."""
    if not SUBMISSIONS_DB.exists():
        return set()
    with open(SUBMISSIONS_DB, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {entry["submission_id"] for entry in data}


def submission_to_dict(sub: Submission) -> dict:
    """Convert a Submission dataclass to a JSON-serializable dict."""
    return {
        "submission_id": sub.submission_id,
        "problem": {
            "id": sub.problem.id,
            "title": sub.problem.title,
            "slug": sub.problem.slug,
            "difficulty": sub.problem.difficulty,
            "topics": sub.problem.topics,
            "url": sub.problem.url,
        },
        "language": sub.language,
        "status": sub.status,
        "submitted_at": sub.submitted_at,
        "runtime": sub.runtime,
        "memory": sub.memory,
        "runtime_percentile": sub.runtime_percentile,
        "memory_percentile": sub.memory_percentile,
        "code": sub.code,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Main fetch function
# ──────────────────────────────────────────────────────────────────────────────

def fetch_new_submissions(fetch_limit: int = 20) -> list[dict]:
    """
    Fetch new (not yet processed) accepted submissions from LeetCode.
    Returns a list of normalized submission dicts ready to be saved.
    """
    existing_ids = load_existing_ids()
    logger.info("Loaded %d existing submission IDs", len(existing_ids))

    adapter = LeetCodeAdapter()
    raw_accepted = adapter.get_recent_accepted_submissions(limit=fetch_limit)

    new_submissions: list[dict] = []
    for raw in raw_accepted:
        sid = str(raw.get("id", ""))
        if sid in existing_ids:
            logger.debug("Skipping already-processed submission: %s", sid)
            continue

        logger.info("Processing new submission: %s (%s)", sid, raw.get("title", ""))
        try:
            normalized = adapter.build_normalized_submission(raw)
            new_submissions.append(submission_to_dict(normalized))
            existing_ids.add(sid)   # prevent in-run duplicates
        except Exception as exc:
            logger.error("Failed to normalize submission %s: %s", sid, exc)

    logger.info("Found %d new submission(s)", len(new_submissions))
    return new_submissions


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import yaml

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    config_path = ROOT_DIR / "config.yml"
    config: dict = {}
    if config_path.exists():
        with open(config_path, "r") as f:
            config = yaml.safe_load(f) or {}

    limit = config.get("fetch_limit", 20)
    new_subs = fetch_new_submissions(fetch_limit=limit)
    print(json.dumps(new_subs, indent=2, ensure_ascii=False))
