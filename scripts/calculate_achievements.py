"""
calculate_achievements.py
--------------------------
Achievement system for CodeStreak.

Reads data/statistics.json and data/streak.json,
compares against thresholds, and unlocks achievements,
writing results to data/achievements.json.

Achievements:
    Problem milestones: 1, 10, 25, 50, 100, 250, 500, 1000
    Streak milestones:  7, 30, 100, 365 days

Usage:
    python scripts/calculate_achievements.py
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

ROOT_DIR           = Path(__file__).parent.parent
STATISTICS_FILE    = ROOT_DIR / "data" / "statistics.json"
STREAK_FILE        = ROOT_DIR / "data" / "streak.json"
ACHIEVEMENTS_FILE  = ROOT_DIR / "data" / "achievements.json"

# ──────────────────────────────────────────────────────────────────────────────
# Achievement definitions (single source of truth)
# ──────────────────────────────────────────────────────────────────────────────

ALL_ACHIEVEMENTS = [
    {"id": "first_problem",  "title": "First Problem",  "emoji": "🎯", "description": "Solve your first problem",   "type": "problems", "threshold": 1},
    {"id": "problems_10",    "title": "10 Problems",    "emoji": "🏆", "description": "Solve 10 problems",          "type": "problems", "threshold": 10},
    {"id": "problems_25",    "title": "25 Problems",    "emoji": "🏆", "description": "Solve 25 problems",          "type": "problems", "threshold": 25},
    {"id": "problems_50",    "title": "50 Problems",    "emoji": "🏆", "description": "Solve 50 problems",          "type": "problems", "threshold": 50},
    {"id": "problems_100",   "title": "100 Problems",   "emoji": "🏆", "description": "Solve 100 problems",         "type": "problems", "threshold": 100},
    {"id": "problems_250",   "title": "250 Problems",   "emoji": "🏆", "description": "Solve 250 problems",         "type": "problems", "threshold": 250},
    {"id": "problems_500",   "title": "500 Problems",   "emoji": "🏆", "description": "Solve 500 problems",         "type": "problems", "threshold": 500},
    {"id": "problems_1000",  "title": "1000 Problems",  "emoji": "🏆", "description": "Solve 1000 problems",        "type": "problems", "threshold": 1000},
    {"id": "streak_7",       "title": "Week Warrior",   "emoji": "🔥", "description": "Maintain a 7-day streak",    "type": "streak",   "threshold": 7},
    {"id": "streak_30",      "title": "Month Master",   "emoji": "🔥", "description": "Maintain a 30-day streak",   "type": "streak",   "threshold": 30},
    {"id": "streak_100",     "title": "Century Coder",  "emoji": "🔥", "description": "Maintain a 100-day streak",  "type": "streak",   "threshold": 100},
    {"id": "streak_365",     "title": "Year of Code",   "emoji": "🔥", "description": "Maintain a 365-day streak",  "type": "streak",   "threshold": 365},
]


# ──────────────────────────────────────────────────────────────────────────────
# Core
# ──────────────────────────────────────────────────────────────────────────────

def load_json(path: Path) -> dict:
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def calculate_achievements(stats: dict, streak: dict) -> dict:
    """
    Compare current progress against achievement thresholds.
    Returns updated achievements dict with 'unlocked' and 'locked' lists.
    """
    total_solved   = stats.get("totalSolved", 0)
    current_streak = streak.get("currentStreak", 0)
    longest_streak = streak.get("longestStreak", 0)
    best_streak    = max(current_streak, longest_streak)

    # Load existing unlocked achievements to preserve unlock timestamps
    existing = load_json(ACHIEVEMENTS_FILE)
    already_unlocked_ids = {a["id"]: a for a in existing.get("unlocked", [])}

    unlocked = []
    locked   = []
    now_str  = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    newly_unlocked_count = 0

    for ach in ALL_ACHIEVEMENTS:
        atype = ach["type"]
        threshold = ach["threshold"]

        if atype == "problems":
            earned = total_solved >= threshold
        elif atype == "streak":
            earned = best_streak >= threshold
        else:
            earned = False

        if earned:
            if ach["id"] in already_unlocked_ids:
                # Preserve original unlock timestamp
                unlocked.append(already_unlocked_ids[ach["id"]])
            else:
                entry = {**ach, "unlockedAt": now_str}
                unlocked.append(entry)
                newly_unlocked_count += 1
                logger.info("🎉 Achievement unlocked: %s %s", ach["emoji"], ach["title"])
        else:
            locked.append(ach)

    logger.info(
        "Achievements: %d unlocked (%d new), %d locked",
        len(unlocked), newly_unlocked_count, len(locked)
    )

    return {
        "unlocked": unlocked,
        "locked":   locked,
        "generatedAt": now_str,
    }


def save_achievements(data: dict) -> None:
    with open(ACHIEVEMENTS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    logger.info("Achievements saved to %s", ACHIEVEMENTS_FILE)


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    stats  = load_json(STATISTICS_FILE)
    streak = load_json(STREAK_FILE)

    achievements = calculate_achievements(stats, streak)
    save_achievements(achievements)
