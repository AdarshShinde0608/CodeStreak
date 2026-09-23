"""
calculate_streak.py
-------------------
Universal streak engine for CodeStreak (multi-platform).

Reads data/submissions.json and computes:
    - Current streak (consecutive days up to today, across ALL platforms)
    - Longest streak (all-time)
    - Daily activity map (by date, cumulative across all platforms)
    - Per-platform activity maps
    - Total active days
    - Whether today's / this week's goal is met

A day counts as active if ANY accepted submission was recorded across
any enabled platform (LeetCode, Codeforces, GeeksforGeeks, CodeChef).

Edge cases handled:
    - Multiple problems on one day (counts as 1 streak day)
    - Month / year / leap-year boundaries
    - Timezone-aware date calculation (from config.yml)
    - Missing days in the middle
    - No submissions
    - Future timestamps
    - First-ever submission

Usage:
    python scripts/calculate_streak.py
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytz
import yaml

logger = logging.getLogger(__name__)

ROOT_DIR        = Path(__file__).parent.parent
SUBMISSIONS_DB  = ROOT_DIR / "data" / "submissions.json"
STREAK_FILE     = ROOT_DIR / "data" / "streak.json"
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
    return datetime.strptime(iso_str, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def to_local_date(iso_str: str, tz: pytz.BaseTzInfo) -> date:
    """Convert ISO-8601 UTC string to a local calendar date."""
    dt_utc = parse_utc(iso_str)
    dt_local = dt_utc.astimezone(tz)
    return dt_local.date()


def build_daily_activity(submissions: list[dict], tz: pytz.BaseTzInfo) -> tuple[dict[date, int], dict[str, dict[date, int]]]:
    """
    Build a map of { local_date: problem_count } from submissions,
    and a nested map of { platform: { local_date: problem_count } }.
    Counts unique problem slugs per day (globally and per platform).
    """
    global_day_slugs: dict[date, set[str]] = defaultdict(set)
    platform_day_slugs: dict[str, dict[date, set[str]]] = defaultdict(lambda: defaultdict(set))

    for sub in submissions:
        # Guard against future timestamps
        try:
            dt_utc = parse_utc(sub["submitted_at"])
        except ValueError:
            continue
        if dt_utc > datetime.now(timezone.utc):
            logger.debug("Skipping future submission: %s", sub["submitted_at"])
            continue

        local_d = to_local_date(sub["submitted_at"], tz)
        platform = sub.get("platform", "leetcode")
        slug = sub["problem"]["slug"]
        
        # We prefix the slug with platform to ensure global uniqueness 
        # (e.g. two-sum on LC vs two-sum on CodeChef)
        global_slug = f"{platform}:{slug}"

        global_day_slugs[local_d].add(global_slug)
        platform_day_slugs[platform][local_d].add(slug)

    global_activity = {d: len(slugs) for d, slugs in global_day_slugs.items()}
    platform_activity = {
        plat: {d: len(slugs) for d, slugs in plat_days.items()}
        for plat, plat_days in platform_day_slugs.items()
    }

    return global_activity, platform_activity


# ──────────────────────────────────────────────────────────────────────────────
# Streak algorithms
# ──────────────────────────────────────────────────────────────────────────────

def calculate_current_streak(active_dates: set[date], today: date) -> tuple[int, date | None]:
    """
    Calculate the current streak ending at today (or yesterday if today has no submission).

    Returns:
        (current_streak_length, streak_start_date)
    """
    if not active_dates:
        return 0, None

    streak = 0
    streak_start: date | None = None

    # Start from today; if today has no submission, streak is already 0
    check = today
    if check not in active_dates:
        # Streak broken: check if yesterday was the last active day
        # (we still compute streak = 0, start = None)
        return 0, None

    # Walk backwards while consecutive days are active
    while check in active_dates:
        streak += 1
        streak_start = check
        check -= timedelta(days=1)

    return streak, streak_start


def calculate_longest_streak(active_dates: set[date]) -> tuple[int, date | None, date | None]:
    """
    Calculate the all-time longest streak.

    Returns:
        (longest_streak_length, start_date, end_date)
    """
    if not active_dates:
        return 0, None, None

    sorted_dates = sorted(active_dates)
    best = 1
    best_start = sorted_dates[0]
    best_end   = sorted_dates[0]
    cur = 1
    cur_start  = sorted_dates[0]

    for i in range(1, len(sorted_dates)):
        if sorted_dates[i] - sorted_dates[i - 1] == timedelta(days=1):
            cur += 1
            if cur > best:
                best = cur
                best_start = cur_start
                best_end   = sorted_dates[i]
        else:
            cur = 1
            cur_start = sorted_dates[i]

    return best, best_start, best_end


# ──────────────────────────────────────────────────────────────────────────────
# Core entry point
# ──────────────────────────────────────────────────────────────────────────────

def calculate_streak(
    submissions: list[dict],
    tz_name: str = "Asia/Kolkata",
    daily_goal: int = 1,
    weekly_goal: int = 7,
) -> dict:
    """
    Compute full streak data from a list of submission dicts.
    Returns a dict ready to be saved as data/streak.json.
    """
    tz = pytz.timezone(tz_name)
    today = datetime.now(tz).date()

    daily_activity, platform_activity = build_daily_activity(submissions, tz)
    active_dates = set(daily_activity.keys())

    # Current streak
    current_streak, streak_start = calculate_current_streak(active_dates, today)

    # Longest streak
    longest, ls_start, ls_end = calculate_longest_streak(active_dates)

    # Last solved date
    last_solved = max(active_dates).isoformat() if active_dates else None

    # Total active days
    total_active = len(active_dates)

    # Daily goal met (today)
    today_count = daily_activity.get(today, 0)
    daily_goal_met = today_count >= daily_goal

    # Weekly goal: count unique dates in the current ISO week
    week_start = today - timedelta(days=today.weekday())
    week_end   = week_start + timedelta(days=6)
    weekly_count = sum(
        1 for d in active_dates if week_start <= d <= week_end
    )
    weekly_goal_met = weekly_count >= weekly_goal

    platform_activity_iso = {
        plat: {d.isoformat(): count for d, count in sorted(plat_days.items())}
        for plat, plat_days in platform_activity.items()
    }

    return {
        "currentStreak":   current_streak,
        "longestStreak":   longest,
        "lastSolvedDate":  last_solved,
        "streakStartDate": streak_start.isoformat() if streak_start else None,
        "longestStreakStart": ls_start.isoformat() if ls_start else None,
        "longestStreakEnd":   ls_end.isoformat()   if ls_end   else None,
        "dailyActivity":   {d.isoformat(): count for d, count in sorted(daily_activity.items())},
        "platformActivity": platform_activity_iso,
        "totalActiveDays": total_active,
        "todaySolved":     today_count,
        "dailyGoal":       daily_goal,
        "dailyGoalMet":    daily_goal_met,
        "weeklyGoal":      weekly_goal,
        "weeklyGoalMet":   weekly_goal_met,
        "generatedAt":     datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def save_streak(streak_data: dict) -> None:
    with open(STREAK_FILE, "w", encoding="utf-8") as f:
        json.dump(streak_data, f, indent=2, ensure_ascii=False)
    logger.info("Streak data saved to %s", STREAK_FILE)


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    config = load_config()

    subs = load_submissions()
    logger.info("Loaded %d submissions", len(subs))

    streak_data = calculate_streak(
        subs,
        tz_name=config.get("timezone", "Asia/Kolkata"),
        daily_goal=config.get("daily_goal", 1),
        weekly_goal=config.get("weekly_goal", 7),
    )
    save_streak(streak_data)

    logger.info(
        "Streak: current=%d longest=%d last_solved=%s",
        streak_data["currentStreak"],
        streak_data["longestStreak"],
        streak_data["lastSolvedDate"],
    )
