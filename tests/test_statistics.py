"""
tests/test_statistics.py
------------------------
Unit tests for the statistics calculation engine.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from calculate_stats import calculate_statistics


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def make_sub(
    slug: str,
    difficulty: str = "Easy",
    language: str = "python3",
    topics: list[str] | None = None,
    utc_str: str = "2026-08-14T12:00:00Z",
) -> dict:
    return {
        "submission_id": f"test-{slug}",
        "problem": {
            "id": hash(slug) % 10000,
            "title": slug.replace("-", " ").title(),
            "slug": slug,
            "difficulty": difficulty,
            "topics": topics or [],
            "url": f"https://leetcode.com/problems/{slug}/",
        },
        "language": language,
        "status": "Accepted",
        "submitted_at": utc_str,
        "runtime": None,
        "memory": None,
        "runtime_percentile": None,
        "memory_percentile": None,
        "code": "",
    }


# ──────────────────────────────────────────────────────────────────────────────
# Tests
# ──────────────────────────────────────────────────────────────────────────────

class TestCalculateStatistics:

    def test_empty_submissions(self):
        stats = calculate_statistics([])
        assert stats["totalSolved"] == 0
        assert stats["easy"] == 0
        assert stats["medium"] == 0
        assert stats["hard"] == 0
        assert stats["firstSolved"] is None
        assert stats["latestSolved"] is None

    def test_single_submission(self):
        subs = [make_sub("two-sum", "Easy", "python3", ["Array", "Hash Table"])]
        stats = calculate_statistics(subs)
        assert stats["totalSolved"] == 1
        assert stats["easy"] == 1
        assert stats["medium"] == 0
        assert stats["hard"] == 0

    def test_difficulty_counts(self):
        subs = [
            make_sub("p1", "Easy"),
            make_sub("p2", "Easy"),
            make_sub("p3", "Medium"),
            make_sub("p4", "Hard"),
        ]
        stats = calculate_statistics(subs)
        assert stats["easy"]   == 2
        assert stats["medium"] == 1
        assert stats["hard"]   == 1
        assert stats["totalSolved"] == 4

    def test_deduplication_by_slug(self):
        """Same problem submitted multiple times should count as 1."""
        subs = [
            make_sub("two-sum", utc_str="2026-08-10T10:00:00Z"),
            make_sub("two-sum", utc_str="2026-08-12T10:00:00Z"),   # duplicate
            make_sub("two-sum", utc_str="2026-08-14T10:00:00Z"),   # duplicate
        ]
        stats = calculate_statistics(subs)
        assert stats["totalSolved"] == 1

    def test_language_distribution(self):
        subs = [
            make_sub("p1", language="python3"),
            make_sub("p2", language="python3"),
            make_sub("p3", language="cpp"),
        ]
        stats = calculate_statistics(subs)
        assert stats["byLanguage"]["python3"] == 2
        assert stats["byLanguage"]["cpp"] == 1

    def test_topic_distribution(self):
        subs = [
            make_sub("p1", topics=["Array", "Hash Table"]),
            make_sub("p2", topics=["Array", "Sliding Window"]),
            make_sub("p3", topics=["Tree"]),
        ]
        stats = calculate_statistics(subs)
        assert stats["byTopic"]["Array"] == 2
        assert stats["byTopic"]["Hash Table"] == 1
        assert stats["byTopic"]["Sliding Window"] == 1
        assert stats["byTopic"]["Tree"] == 1

    def test_first_and_latest_solved(self):
        subs = [
            make_sub("p1", utc_str="2026-01-01T10:00:00Z"),
            make_sub("p2", utc_str="2026-08-14T10:00:00Z"),
            make_sub("p3", utc_str="2026-04-15T10:00:00Z"),
        ]
        stats = calculate_statistics(subs)
        assert stats["firstSolved"]  == "2026-01-01"
        assert stats["latestSolved"] == "2026-08-14"

    def test_per_day_counts(self):
        subs = [
            make_sub("p1", utc_str="2026-08-14T10:00:00Z"),
            make_sub("p2", utc_str="2026-08-14T12:00:00Z"),  # same day
            make_sub("p3", utc_str="2026-08-15T10:00:00Z"),
        ]
        stats = calculate_statistics(subs, tz_name="UTC")
        assert stats["perDay"]["2026-08-14"] == 2
        assert stats["perDay"]["2026-08-15"] == 1

    def test_per_month_counts(self):
        subs = [
            make_sub("p1", utc_str="2026-07-01T10:00:00Z"),
            make_sub("p2", utc_str="2026-07-15T10:00:00Z"),
            make_sub("p3", utc_str="2026-08-01T10:00:00Z"),
        ]
        stats = calculate_statistics(subs, tz_name="UTC")
        assert stats["perMonth"]["2026-07"] == 2
        assert stats["perMonth"]["2026-08"] == 1

    def test_per_year_counts(self):
        subs = [
            make_sub("p1", utc_str="2025-12-31T10:00:00Z"),
            make_sub("p2", utc_str="2026-01-01T10:00:00Z"),
            make_sub("p3", utc_str="2026-06-01T10:00:00Z"),
        ]
        stats = calculate_statistics(subs, tz_name="UTC")
        assert stats["perYear"]["2025"] == 1
        assert stats["perYear"]["2026"] == 2

    def test_generated_at_present(self):
        stats = calculate_statistics([])
        assert stats["generatedAt"] is not None
        assert stats["generatedAt"].endswith("Z")

    def test_language_sorted_by_count(self):
        subs = [
            make_sub("p1", language="java"),
            make_sub("p2", language="python3"),
            make_sub("p3", language="python3"),
            make_sub("p4", language="python3"),
            make_sub("p5", language="cpp"),
            make_sub("p6", language="cpp"),
        ]
        stats = calculate_statistics(subs)
        langs = list(stats["byLanguage"].keys())
        assert langs[0] == "python3"  # most used first
