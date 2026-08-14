"""
calculate_stats.py
------------------
Statistics engine for CodeStreak.

Reads data/submissions.json and computes comprehensive statistics,
writing results to data/statistics.json.

Statistics computed:
    - Total solved (unique problems)
    - Easy / Medium / Hard counts
    - Problems per language
    - Problems per topic
    - Daily / weekly / monthly / yearly activity
    - First solved date
    - Latest solved date

Usage:
    python scripts/calculate_stats.py
"""

from __future__ import annotations

import json
import logging
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import pytz
import yaml

logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).parent.parent
SUBMISSIONS_DB  = ROOT_DIR / "data" / "submissions.json"
STATISTICS_FILE = ROOT_DIR / "data" / "statistics.json"
CONFIG_FILE     = ROOT_DIR / "config.yml"


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def load_config() -> dict:
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, "r") as f:
            return yaml.safe_load(f) or {}
    return {}


def load_submissions() -> list[dict]:
    if not SUBMISSIONS_DB.exists():
        return []
    with open(SUBMISSIONS_DB, "r", encoding="utf-8") as f:
        return json.load(f)


def parse_utc(iso_str: str) -> datetime:
    """Parse an ISO-8601 UTC string into a timezone-aware datetime."""
    return datetime.strptime(iso_str, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def to_local_date(iso_str: str, tz: pytz.BaseTzInfo) -> str:
    """Convert an ISO-8601 UTC string to a local date string YYYY-MM-DD."""
    dt_utc = parse_utc(iso_str)
    dt_local = dt_utc.astimezone(tz)
    return dt_local.strftime("%Y-%m-%d")


def week_key(date_str: str) -> str:
    """Return ISO week key e.g. '2026-W33' from a YYYY-MM-DD string."""
    d = datetime.strptime(date_str, "%Y-%m-%d").date()
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def month_key(date_str: str) -> str:
    """Return 'YYYY-MM' from a YYYY-MM-DD string."""
    return date_str[:7]


def year_key(date_str: str) -> str:
    """Return 'YYYY' from a YYYY-MM-DD string."""
    return date_str[:4]


# ──────────────────────────────────────────────────────────────────────────────
# Core calculation
# ──────────────────────────────────────────────────────────────────────────────

def calculate_statistics(submissions: list[dict], tz_name: str = "Asia/Kolkata") -> dict:
    """
    Compute all statistics from a list of submission dicts.
    Uses tz_name for localizing timestamps to dates.
    Returns a statistics dict ready to be saved as JSON.
    """
    tz = pytz.timezone(tz_name)

    # Deduplicate by problem slug (keep the first/earliest accepted per problem)
    seen_slugs: dict[str, dict] = {}   # slug -> earliest submission
    for sub in sorted(submissions, key=lambda s: s["submitted_at"]):
        slug = sub["problem"]["slug"]
        if slug not in seen_slugs:
            seen_slugs[slug] = sub

    unique_submissions = list(seen_slugs.values())

    # Counters
    total_solved = len(unique_submissions)
    by_difficulty: dict[str, int] = defaultdict(int)
    by_language:   dict[str, int] = defaultdict(int)
    by_topic:      dict[str, int] = defaultdict(int)
    per_day:       dict[str, int] = defaultdict(int)
    per_week:      dict[str, int] = defaultdict(int)
    per_month:     dict[str, int] = defaultdict(int)
    per_year:      dict[str, int] = defaultdict(int)
    dates: list[str] = []

    for sub in unique_submissions:
        diff = sub["problem"].get("difficulty", "Unknown").lower()
        by_difficulty[diff] += 1

        lang = sub.get("language", "unknown").lower()
        by_language[lang] += 1

        for topic in sub["problem"].get("topics", []):
            by_topic[topic] += 1

        local_date = to_local_date(sub["submitted_at"], tz)
        dates.append(local_date)
        per_day[local_date]        += 1
        per_week[week_key(local_date)]  += 1
        per_month[month_key(local_date)] += 1
        per_year[year_key(local_date)]   += 1

    first_solved  = min(dates) if dates else None
    latest_solved = max(dates) if dates else None

    return {
        "totalSolved": total_solved,
        "easy":   by_difficulty.get("easy",   0),
        "medium": by_difficulty.get("medium", 0),
        "hard":   by_difficulty.get("hard",   0),
        "byLanguage": dict(sorted(by_language.items(), key=lambda x: x[1], reverse=True)),
        "byTopic":    dict(sorted(by_topic.items(),    key=lambda x: x[1], reverse=True)),
        "perDay":     dict(sorted(per_day.items())),
        "perWeek":    dict(sorted(per_week.items())),
        "perMonth":   dict(sorted(per_month.items())),
        "perYear":    dict(sorted(per_year.items())),
        "firstSolved":  first_solved,
        "latestSolved": latest_solved,
        "generatedAt":  datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def save_statistics(stats: dict) -> None:
    with open(STATISTICS_FILE, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)
    logger.info("Statistics saved to %s", STATISTICS_FILE)


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    config = load_config()
    tz_name = config.get("timezone", "Asia/Kolkata")

    subs = load_submissions()
    logger.info("Loaded %d submissions", len(subs))

    stats = calculate_statistics(subs, tz_name=tz_name)
    save_statistics(stats)

    logger.info(
        "Stats: total=%d easy=%d medium=%d hard=%d",
        stats["totalSolved"], stats["easy"], stats["medium"], stats["hard"],
    )
