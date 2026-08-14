"""
generate_heatmap.py
-------------------
SVG visualization generator for CodeStreak.

Generates:
    assets/heatmap.svg    — GitHub-style activity heatmap (last 52 weeks)
    assets/difficulty.svg — Bar chart of Easy / Medium / Hard
    assets/languages.svg  — Bar chart of top languages

All SVGs are self-contained (no external dependencies at render time)
and safe to embed directly in GitHub README.md files.

Usage:
    python scripts/generate_heatmap.py
"""

from __future__ import annotations

import json
import logging
import math
from datetime import date, datetime, timedelta
from pathlib import Path

logger = logging.getLogger(__name__)

ROOT_DIR        = Path(__file__).parent.parent
STATISTICS_FILE = ROOT_DIR / "data" / "statistics.json"
STREAK_FILE     = ROOT_DIR / "data" / "streak.json"
ASSETS_DIR      = ROOT_DIR / "assets"


# ──────────────────────────────────────────────────────────────────────────────
# Colour palettes
# ──────────────────────────────────────────────────────────────────────────────

HEATMAP_COLOURS = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"]
# index 0 = no activity, 1-4 = increasing activity

DIFFICULTY_COLOURS = {
    "Easy":   "#00b8a3",
    "Medium": "#ffc01e",
    "Hard":   "#ff375f",
}

LANG_COLOUR = "#58a6ff"


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def load_json(path: Path) -> dict:
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def activity_colour(count: int, max_count: int) -> str:
    if count == 0 or max_count == 0:
        return HEATMAP_COLOURS[0]
    ratio = count / max_count
    idx = math.ceil(ratio * 4)
    return HEATMAP_COLOURS[min(idx, 4)]


# ──────────────────────────────────────────────────────────────────────────────
# Heatmap SVG
# ──────────────────────────────────────────────────────────────────────────────

def generate_heatmap_svg(daily_activity: dict[str, int]) -> str:
    """
    Generate a GitHub-style contribution heatmap for the last 52 weeks.
    Each cell is a 10x10 square with 2px gap.
    """
    CELL = 11   # cell size + gap
    WEEKS = 52
    today = date.today()

    # Align to the start of the current week (Monday)
    start_date = today - timedelta(weeks=WEEKS - 1)
    start_date -= timedelta(days=start_date.weekday())  # back to Monday

    # Build week columns
    days: list[tuple[date, int]] = []
    d = start_date
    while d <= today:
        count = daily_activity.get(d.isoformat(), 0)
        days.append((d, count))
        d += timedelta(days=1)

    max_count = max((c for _, c in days), default=1) or 1

    # SVG dimensions
    width  = WEEKS * CELL + 20
    height = 7 * CELL + 30
    cells_svg = []

    for i, (day, count) in enumerate(days):
        week = i // 7
        dow  = i % 7        # 0=Mon … 6=Sun
        x = week * CELL + 10
        y = dow  * CELL + 20
        colour = activity_colour(count, max_count)
        tip = f"{day.isoformat()}: {count} problem(s)"
        cells_svg.append(
            f'  <rect x="{x}" y="{y}" width="10" height="10" rx="2" ry="2" '
            f'fill="{colour}"><title>{tip}</title></rect>'
        )

    # Day-of-week labels (Mon, Wed, Fri)
    labels = ""
    for dow, name in [(0, "Mon"), (2, "Wed"), (4, "Fri")]:
        y = dow * CELL + 30
        labels += f'  <text x="2" y="{y}" font-size="9" fill="#8b949e" font-family="monospace">{name}</text>\n'

    cells = "\n".join(cells_svg)

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <rect width="{width}" height="{height}" fill="#0d1117" rx="6"/>
  <text x="10" y="13" font-size="11" fill="#8b949e" font-family="monospace">Activity — last 52 weeks</text>
{labels}
{cells}
</svg>"""


# ──────────────────────────────────────────────────────────────────────────────
# Difficulty bar chart SVG
# ──────────────────────────────────────────────────────────────────────────────

def generate_difficulty_svg(easy: int, medium: int, hard: int) -> str:
    total = easy + medium + hard or 1
    bars = [
        ("Easy",   easy,   DIFFICULTY_COLOURS["Easy"]),
        ("Medium", medium, DIFFICULTY_COLOURS["Medium"]),
        ("Hard",   hard,   DIFFICULTY_COLOURS["Hard"]),
    ]
    BAR_WIDTH = 220
    ROW_H = 30
    height = len(bars) * ROW_H + 40

    rows = []
    for i, (label, value, colour) in enumerate(bars):
        y = i * ROW_H + 30
        bar_len = int(BAR_WIDTH * value / total)
        pct = f"{value / total * 100:.1f}%"
        rows.append(
            f'  <text x="10" y="{y + 13}" font-size="11" fill="#c9d1d9" font-family="monospace">{label:<7}</text>\n'
            f'  <rect x="70" y="{y}" width="{bar_len}" height="18" rx="3" fill="{colour}"/>\n'
            f'  <rect x="70" y="{y}" width="{BAR_WIDTH}" height="18" rx="3" fill="none" stroke="#30363d"/>\n'
            f'  <text x="{70 + bar_len + 6}" y="{y + 13}" font-size="11" fill="#8b949e" font-family="monospace">{value} ({pct})</text>'
        )

    rows_svg = "\n".join(rows)
    width = BAR_WIDTH + 160

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <rect width="{width}" height="{height}" fill="#0d1117" rx="6"/>
  <text x="10" y="18" font-size="12" fill="#8b949e" font-family="monospace" font-weight="bold">Difficulty Distribution</text>
{rows_svg}
</svg>"""


# ──────────────────────────────────────────────────────────────────────────────
# Languages bar chart SVG
# ──────────────────────────────────────────────────────────────────────────────

def generate_languages_svg(by_language: dict[str, int], top_n: int = 6) -> str:
    if not by_language:
        by_language = {}

    items = sorted(by_language.items(), key=lambda x: x[1], reverse=True)[:top_n]
    total = sum(v for _, v in items) or 1
    BAR_WIDTH = 220
    ROW_H = 30
    height = len(items) * ROW_H + 40

    rows = []
    for i, (lang, value) in enumerate(items):
        y = i * ROW_H + 30
        bar_len = int(BAR_WIDTH * value / total)
        pct = f"{value / total * 100:.1f}%"
        label = lang[:7] if len(lang) > 7 else lang
        rows.append(
            f'  <text x="10" y="{y + 13}" font-size="11" fill="#c9d1d9" font-family="monospace">{label:<7}</text>\n'
            f'  <rect x="70" y="{y}" width="{bar_len}" height="18" rx="3" fill="{LANG_COLOUR}"/>\n'
            f'  <rect x="70" y="{y}" width="{BAR_WIDTH}" height="18" rx="3" fill="none" stroke="#30363d"/>\n'
            f'  <text x="{70 + bar_len + 6}" y="{y + 13}" font-size="11" fill="#8b949e" font-family="monospace">{value} ({pct})</text>'
        )

    rows_svg = "\n".join(rows)
    width = BAR_WIDTH + 160

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <rect width="{width}" height="{height}" fill="#0d1117" rx="6"/>
  <text x="10" y="18" font-size="12" fill="#8b949e" font-family="monospace" font-weight="bold">Language Distribution</text>
{rows_svg}
</svg>"""


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def generate_all() -> None:
    ASSETS_DIR.mkdir(exist_ok=True)

    stats  = load_json(STATISTICS_FILE)
    streak = load_json(STREAK_FILE)

    daily_activity = {k: v for k, v in streak.get("dailyActivity", {}).items()}

    # Heatmap
    heatmap_svg = generate_heatmap_svg(daily_activity)
    (ASSETS_DIR / "heatmap.svg").write_text(heatmap_svg, encoding="utf-8")
    logger.info("Generated heatmap.svg")

    # Difficulty
    diff_svg = generate_difficulty_svg(
        easy=stats.get("easy", 0),
        medium=stats.get("medium", 0),
        hard=stats.get("hard", 0),
    )
    (ASSETS_DIR / "difficulty.svg").write_text(diff_svg, encoding="utf-8")
    logger.info("Generated difficulty.svg")

    # Languages
    lang_svg = generate_languages_svg(stats.get("byLanguage", {}))
    (ASSETS_DIR / "languages.svg").write_text(lang_svg, encoding="utf-8")
    logger.info("Generated languages.svg")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    generate_all()
