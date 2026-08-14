"""
generate_readme.py
------------------
README dashboard generator for CodeStreak.

Reads data/statistics.json, data/streak.json, data/achievements.json,
and data/submissions.json, then generates a fully-formatted README.md
for the leetcode-journey repository.

The README is 100% auto-generated — it should never be edited manually.

Usage:
    python scripts/generate_readme.py
    
    Writes README.md to ROOT_DIR (the target repo root by default).
    Set TARGET_DIR env var to override.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)

ROOT_DIR          = Path(__file__).parent.parent
STATISTICS_FILE   = ROOT_DIR / "data" / "statistics.json"
STREAK_FILE       = ROOT_DIR / "data" / "streak.json"
ACHIEVEMENTS_FILE = ROOT_DIR / "data" / "achievements.json"
SUBMISSIONS_DB    = ROOT_DIR / "data" / "submissions.json"
CONFIG_FILE       = ROOT_DIR / "config.yml"

# Output location — override via TARGET_DIR env var for cross-repo workflows
OUTPUT_README = Path(os.environ.get("TARGET_DIR", str(ROOT_DIR))) / "README.md"


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def load_json(path: Path) -> dict | list:
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def load_config() -> dict:
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, "r") as f:
            return yaml.safe_load(f) or {}
    return {}


def lang_display(lang: str) -> str:
    """Make a language identifier human-readable."""
    mapping = {
        "python3": "Python", "python": "Python", "cpp": "C++",
        "java": "Java", "javascript": "JavaScript", "typescript": "TypeScript",
        "csharp": "C#", "golang": "Go", "kotlin": "Kotlin", "rust": "Rust",
        "swift": "Swift", "mysql": "SQL", "mssql": "SQL",
    }
    return mapping.get(lang.lower(), lang.title())


def diff_badge(difficulty: str) -> str:
    badges = {"Easy": "🟢", "Medium": "🟡", "Hard": "🔴", "Unknown": "⚪"}
    return badges.get(difficulty, "⚪")


def progress_bar(value: int, goal: int, width: int = 20) -> str:
    """ASCII progress bar."""
    if goal == 0:
        return "─" * width
    pct = min(value / goal, 1.0)
    filled = int(pct * width)
    bar = "█" * filled + "░" * (width - filled)
    return bar


# ──────────────────────────────────────────────────────────────────────────────
# Section builders
# ──────────────────────────────────────────────────────────────────────────────

def section_header(stats: dict, streak: dict, github_username: str, repo_name: str) -> str:
    total       = stats.get("totalSolved", 0)
    cur_streak  = streak.get("currentStreak", 0)
    long_streak = streak.get("longestStreak", 0)
    today_count = streak.get("todaySolved", 0)
    daily_goal  = streak.get("dailyGoal", 1)
    goal_status = "✅ GOAL MET" if streak.get("dailyGoalMet") else f"{today_count}/{daily_goal}"
    this_year   = stats.get("perYear", {}).get(str(datetime.now().year), 0)

    return f"""<div align="center">

# 🧠 LeetCode Journey

*Automated progress tracker powered by [CodeStreak](https://github.com/{github_username}/{repo_name})*

---

| 🔥 Current Streak | 🏆 Longest Streak | ✅ Total Solved | 📅 This Year |
|:-----------------:|:-----------------:|:--------------:|:------------:|
| **{cur_streak} days** | **{long_streak} days** | **{total}** | **{this_year}** |

> **Today:** {goal_status}

</div>

---
"""


def section_difficulty(stats: dict) -> str:
    easy   = stats.get("easy",   0)
    medium = stats.get("medium", 0)
    hard   = stats.get("hard",   0)
    total  = easy + medium + hard or 1

    def pct(n): return f"{n / total * 100:.1f}%"

    return f"""## 📊 Difficulty Breakdown

| Difficulty | Count | Percentage |
|:----------:|:-----:|:----------:|
| 🟢 Easy    | {easy}   | {pct(easy)}   |
| 🟡 Medium  | {medium} | {pct(medium)} |
| 🔴 Hard    | {hard}   | {pct(hard)}   |

![Difficulty](assets/difficulty.svg)

---
"""


def section_languages(stats: dict, top_n: int = 6) -> str:
    by_lang = stats.get("byLanguage", {})
    if not by_lang:
        return ""

    items  = sorted(by_lang.items(), key=lambda x: x[1], reverse=True)[:top_n]
    total  = sum(v for _, v in items) or 1
    rows   = "\n".join(
        f"| {lang_display(lang)} | {count} | {count / total * 100:.1f}% |"
        for lang, count in items
    )

    return f"""## 🌐 Languages

| Language | Problems | % |
|:--------:|:--------:|:-:|
{rows}

![Languages](assets/languages.svg)

---
"""


def section_topics(stats: dict, top_n: int = 10) -> str:
    by_topic = stats.get("byTopic", {})
    if not by_topic:
        return ""

    items = sorted(by_topic.items(), key=lambda x: x[1], reverse=True)[:top_n]
    rows  = "\n".join(f"| {topic} | {count} |" for topic, count in items)

    return f"""## 🗂️ Top Topics

| Topic | Problems |
|:-----:|:--------:|
{rows}

---
"""


def section_streak(streak: dict) -> str:
    cur_streak  = streak.get("currentStreak",  0)
    long_streak = streak.get("longestStreak",  0)
    total_days  = streak.get("totalActiveDays", 0)
    streak_start = streak.get("streakStartDate") or "—"
    last_solved  = streak.get("lastSolvedDate")  or "—"
    daily_goal   = streak.get("dailyGoal", 1)
    today_count  = streak.get("todaySolved", 0)
    bar          = progress_bar(today_count, daily_goal)

    return f"""## 🔥 Streak Details

| Metric | Value |
|:------:|:-----:|
| Current Streak | **{cur_streak} days** |
| Longest Streak | **{long_streak} days** |
| Total Active Days | **{total_days}** |
| Streak Since | {streak_start} |
| Last Solved | {last_solved} |

**Today's Progress:** `[{bar}]` {today_count}/{daily_goal}

![Activity Heatmap](assets/heatmap.svg)

---
"""


def section_recent(submissions: list[dict], n: int = 10) -> str:
    if not submissions:
        return ""

    recent = sorted(submissions, key=lambda s: s["submitted_at"], reverse=True)[:n]
    rows   = []
    for sub in recent:
        p    = sub["problem"]
        date = sub["submitted_at"][:10]
        badge = diff_badge(p.get("difficulty", ""))
        lang  = lang_display(sub.get("language", ""))
        link  = f"[{p['title']}]({p['url']})"
        rows.append(f"| {p['id']} | {link} | {badge} {p.get('difficulty','')} | {lang} | {date} |")

    rows_md = "\n".join(rows)
    return f"""## 🕐 Recent Submissions

| # | Problem | Difficulty | Language | Date |
|:-:|:-------:|:----------:|:--------:|:----:|
{rows_md}

---
"""


def section_achievements(achievements: dict) -> str:
    unlocked = achievements.get("unlocked", [])
    locked   = achievements.get("locked",   [])

    if not unlocked and not locked:
        return ""

    rows = []
    for a in unlocked:
        date_str = a.get("unlockedAt", "")[:10] if a.get("unlockedAt") else ""
        rows.append(f"| {a['emoji']} {a['title']} | ✅ Unlocked | {date_str} |")
    for a in locked:
        rows.append(f"| {a['emoji']} {a['title']} | 🔒 Locked | — |")

    rows_md = "\n".join(rows)
    return f"""## 🏆 Achievements

| Achievement | Status | Date |
|:-----------:|:------:|:----:|
{rows_md}

---
"""


def section_footer(config: dict) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    username = config.get("github_username", "")
    repo     = config.get("repo_name", "CodeStreak")

    return f"""<div align="center">

*Auto-generated by [CodeStreak](https://github.com/{username}/{repo}) · Last updated: {now}*

</div>
"""


# ──────────────────────────────────────────────────────────────────────────────
# Main generator
# ──────────────────────────────────────────────────────────────────────────────

def generate_readme() -> str:
    config       = load_config()
    stats        = load_json(STATISTICS_FILE) or {}
    streak       = load_json(STREAK_FILE)     or {}
    achievements = load_json(ACHIEVEMENTS_FILE) or {}
    submissions  = load_json(SUBMISSIONS_DB)  or []

    github_username = config.get("github_username", "your-username")
    repo_name       = config.get("repo_name", "CodeStreak")

    parts = [
        section_header(stats, streak, github_username, repo_name),
        section_difficulty(stats),
        section_languages(stats),
        section_topics(stats),
        section_streak(streak),
        section_recent(submissions),
        section_achievements(achievements),
        section_footer(config),
    ]

    return "\n".join(p for p in parts if p)


def save_readme(content: str) -> None:
    OUTPUT_README.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_README, "w", encoding="utf-8") as f:
        f.write(content)
    logger.info("README written to %s", OUTPUT_README)


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    readme = generate_readme()
    save_readme(readme)
    logger.info("README generation complete.")
