"""
tests/test_streak.py
--------------------
Comprehensive unit tests for the streak calculation engine.

Test matrix (from roadmap):
    ✅  1 day
    ✅  2 consecutive days
    ✅  Month boundary
    ✅  Year boundary (Dec 31 → Jan 1)
    ✅  Leap year (Feb 28 → Feb 29)
    ✅  Multiple problems / day
    ✅  Missed day (streak broken)
    ✅  No submissions
    ✅  Future timestamps (should be ignored)
    ✅  Timezone differences
    ✅  Longest streak across multiple runs
"""

from __future__ import annotations

import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
import pytz

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from calculate_streak import (
    build_daily_activity,
    calculate_current_streak,
    calculate_longest_streak,
    calculate_streak,
)


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

IST = pytz.timezone("Asia/Kolkata")
UTC = pytz.utc


def make_submission(slug: str, utc_dt: datetime) -> dict:
    """Create a minimal submission dict for testing."""
    return {
        "submission_id": f"test-{slug}-{utc_dt.timestamp():.0f}",
        "problem": {"slug": slug, "id": 1, "title": slug, "difficulty": "Easy", "topics": [], "url": ""},
        "language": "python3",
        "status": "Accepted",
        "submitted_at": utc_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "runtime": None,
        "memory": None,
        "runtime_percentile": None,
        "memory_percentile": None,
        "code": "",
    }


def utc(year: int, month: int, day: int, hour: int = 12) -> datetime:
    """Helper to create a UTC datetime."""
    return datetime(year, month, day, hour, 0, 0, tzinfo=timezone.utc)


# ──────────────────────────────────────────────────────────────────────────────
# build_daily_activity tests
# ──────────────────────────────────────────────────────────────────────────────

class TestBuildDailyActivity:

    def test_no_submissions(self):
        activity = build_daily_activity([], IST)
        assert activity == {}

    def test_single_submission(self):
        subs = [make_submission("two-sum", utc(2026, 8, 14, 10))]
        activity = build_daily_activity(subs, IST)
        # 2026-08-14 10:00 UTC = 2026-08-14 15:30 IST → same calendar day
        assert date(2026, 8, 14) in activity
        assert activity[date(2026, 8, 14)] == 1

    def test_multiple_problems_same_day(self):
        """3 different problems on the same day should count as 3 problems but 1 active day."""
        subs = [
            make_submission("two-sum",        utc(2026, 8, 14, 9)),
            make_submission("valid-anagram",   utc(2026, 8, 14, 11)),
            make_submission("binary-search",   utc(2026, 8, 14, 15)),
        ]
        activity = build_daily_activity(subs, IST)
        assert len(activity) == 1
        assert activity[date(2026, 8, 14)] == 3

    def test_duplicate_problem_same_day(self):
        """Same problem submitted twice in one day counts only once (unique slug per day)."""
        subs = [
            make_submission("two-sum", utc(2026, 8, 14, 9)),
            make_submission("two-sum", utc(2026, 8, 14, 11)),
        ]
        activity = build_daily_activity(subs, IST)
        assert activity[date(2026, 8, 14)] == 1

    def test_future_timestamp_ignored(self):
        """Future submissions must be ignored."""
        future = datetime.now(timezone.utc) + timedelta(days=10)
        subs = [make_submission("future-problem", future)]
        activity = build_daily_activity(subs, IST)
        assert len(activity) == 0

    def test_timezone_boundary_ist(self):
        """
        A submission at 2026-08-13 23:00 UTC = 2026-08-14 04:30 IST
        should be counted as Aug 14 in IST, not Aug 13.
        """
        subs = [make_submission("two-sum", utc(2026, 8, 13, 23))]   # UTC
        activity = build_daily_activity(subs, IST)
        assert date(2026, 8, 14) in activity
        assert date(2026, 8, 13) not in activity

    def test_month_boundary(self):
        subs = [
            make_submission("p1", utc(2026, 7, 31, 10)),
            make_submission("p2", utc(2026, 8,  1, 10)),
        ]
        activity = build_daily_activity(subs, IST)
        assert date(2026, 7, 31) in activity
        assert date(2026, 8, 1)  in activity

    def test_year_boundary(self):
        subs = [
            make_submission("p1", utc(2025, 12, 31, 10)),
            make_submission("p2", utc(2026,  1,  1, 10)),
        ]
        activity = build_daily_activity(subs, IST)
        assert date(2025, 12, 31) in activity
        assert date(2026, 1,  1)  in activity

    def test_leap_year_feb29(self):
        subs = [
            make_submission("p1", utc(2024, 2, 28, 10)),
            make_submission("p2", utc(2024, 2, 29, 10)),   # 2024 is a leap year
        ]
        activity = build_daily_activity(subs, IST)
        assert date(2024, 2, 28) in activity
        assert date(2024, 2, 29) in activity


# ──────────────────────────────────────────────────────────────────────────────
# calculate_current_streak tests
# ──────────────────────────────────────────────────────────────────────────────

class TestCurrentStreak:

    def test_no_submissions(self):
        streak, start = calculate_current_streak(set(), date(2026, 8, 14))
        assert streak == 0
        assert start is None

    def test_single_day_today(self):
        today = date(2026, 8, 14)
        streak, start = calculate_current_streak({today}, today)
        assert streak == 1
        assert start == today

    def test_two_consecutive_days(self):
        today = date(2026, 8, 14)
        yesterday = date(2026, 8, 13)
        streak, start = calculate_current_streak({yesterday, today}, today)
        assert streak == 2
        assert start == yesterday

    def test_missed_today_returns_zero(self):
        """If today has no submission, current streak is 0 regardless of history."""
        today = date(2026, 8, 14)
        yesterday = date(2026, 8, 13)
        streak, start = calculate_current_streak({yesterday}, today)
        assert streak == 0
        assert start is None

    def test_consecutive_5_days(self):
        today = date(2026, 8, 14)
        active = {today - timedelta(days=i) for i in range(5)}
        streak, start = calculate_current_streak(active, today)
        assert streak == 5

    def test_gap_in_middle(self):
        today = date(2026, 8, 14)
        # Active: Aug 14, Aug 13, GAP, Aug 11, Aug 10
        active = {
            date(2026, 8, 14),
            date(2026, 8, 13),
            date(2026, 8, 11),
            date(2026, 8, 10),
        }
        streak, start = calculate_current_streak(active, today)
        assert streak == 2   # only Aug 13-14 count

    def test_month_boundary_continuous(self):
        today = date(2026, 9, 1)
        active = {
            date(2026, 9, 1),
            date(2026, 8, 31),
            date(2026, 8, 30),
        }
        streak, start = calculate_current_streak(active, today)
        assert streak == 3

    def test_year_boundary_continuous(self):
        today = date(2026, 1, 1)
        active = {
            date(2026, 1, 1),
            date(2025, 12, 31),
            date(2025, 12, 30),
        }
        streak, start = calculate_current_streak(active, today)
        assert streak == 3

    def test_leap_year_continuous(self):
        today = date(2024, 3, 1)
        active = {
            date(2024, 3, 1),
            date(2024, 2, 29),
            date(2024, 2, 28),
        }
        streak, start = calculate_current_streak(active, today)
        assert streak == 3


# ──────────────────────────────────────────────────────────────────────────────
# calculate_longest_streak tests
# ──────────────────────────────────────────────────────────────────────────────

class TestLongestStreak:

    def test_no_submissions(self):
        longest, s, e = calculate_longest_streak(set())
        assert longest == 0

    def test_single_day(self):
        longest, s, e = calculate_longest_streak({date(2026, 8, 14)})
        assert longest == 1
        assert s == date(2026, 8, 14)
        assert e == date(2026, 8, 14)

    def test_two_separate_runs(self):
        """Longest streak should pick the best run."""
        active = {
            date(2026, 1, 1),
            date(2026, 1, 2),
            date(2026, 1, 3),
            # gap
            date(2026, 2, 1),
            date(2026, 2, 2),
        }
        longest, s, e = calculate_longest_streak(active)
        assert longest == 3
        assert s == date(2026, 1, 1)
        assert e == date(2026, 1, 3)

    def test_all_consecutive(self):
        active = {date(2026, 8, 10) + timedelta(days=i) for i in range(7)}
        longest, s, e = calculate_longest_streak(active)
        assert longest == 7

    def test_month_boundary_longest(self):
        active = {
            date(2026, 7, 30),
            date(2026, 7, 31),
            date(2026, 8, 1),
            date(2026, 8, 2),
        }
        longest, _, _ = calculate_longest_streak(active)
        assert longest == 4


# ──────────────────────────────────────────────────────────────────────────────
# Integration: calculate_streak
# ──────────────────────────────────────────────────────────────────────────────

class TestCalculateStreakIntegration:

    def _today_ist(self) -> date:
        return datetime.now(IST).date()

    def test_empty(self):
        result = calculate_streak([], tz_name="Asia/Kolkata")
        assert result["currentStreak"] == 0
        assert result["longestStreak"] == 0
        assert result["lastSolvedDate"] is None
        assert result["totalActiveDays"] == 0

    def test_today_single_submission(self):
        # Submit 5 minutes ago in UTC
        recent_utc = datetime.now(timezone.utc) - timedelta(minutes=5)

        subs = [make_submission("two-sum", recent_utc)]
        result = calculate_streak(subs, tz_name="Asia/Kolkata", daily_goal=1)
        assert result["currentStreak"] == 1
        assert result["longestStreak"] == 1
        assert result["dailyGoalMet"] is True

    def test_daily_goal_not_met(self):
        recent_utc = datetime.now(timezone.utc) - timedelta(minutes=5)
        subs = [make_submission("p1", recent_utc)]
        result = calculate_streak(subs, tz_name="Asia/Kolkata", daily_goal=3)
        assert result["todaySolved"] == 1
        assert result["dailyGoalMet"] is False

    def test_generatedAt_present(self):
        result = calculate_streak([], tz_name="Asia/Kolkata")
        assert "generatedAt" in result
        assert result["generatedAt"].endswith("Z")
