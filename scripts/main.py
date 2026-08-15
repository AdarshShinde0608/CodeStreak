"""
main.py
-------
Main orchestrator for CodeStreak sync pipeline.

Runs the full pipeline in order:
    1. Fetch new accepted submissions from LeetCode
    2. Process each submission (save to solutions/, update DB)
    3. Calculate statistics
    4. Calculate streak
    5. Update achievements
    6. Generate README dashboard
    7. Generate SVG charts

This script is called by the GitHub Actions sync workflow.

Usage:
    python scripts/main.py [--dry-run]

Environment variables required:
    LEETCODE_SESSION       — LeetCode session cookie
    LEETCODE_CSRF_TOKEN    — LeetCode CSRF token

Optional:
    TARGET_DIR             — Override output directory for README (cross-repo mode)
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import traceback
from pathlib import Path

import yaml

# Ensure scripts/ is on path
sys.path.insert(0, str(Path(__file__).parent))

logger = logging.getLogger(__name__)

ROOT_DIR    = Path(__file__).parent.parent
CONFIG_FILE = ROOT_DIR / "config.yml"


def load_config() -> dict:
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, "r") as f:
            return yaml.safe_load(f) or {}
    return {}


def run_pipeline(dry_run: bool = False) -> None:
    config = load_config()
    fetch_limit = config.get("fetch_limit", 20)
    tz_name     = config.get("timezone", "Asia/Kolkata")
    daily_goal  = config.get("daily_goal", 1)
    weekly_goal = config.get("weekly_goal", 7)

    # ── Step 1: Fetch new submissions ─────────────────────────────────────────
    logger.info("=" * 60)
    logger.info("STEP 1: Fetching new submissions from LeetCode")
    logger.info("=" * 60)

    import os
    leetcode_session = os.environ.get("LEETCODE_SESSION", "").strip()
    new_submissions = []
    processed = 0

    if not leetcode_session:
        logger.info("ℹ️  LEETCODE_SESSION not set. Skipping direct LeetCode fetch.")
        logger.info("    (Submissions are synced directly via the CodeStreak Browser Extension)")
    else:
        try:
            from fetch_submissions import fetch_new_submissions
            new_submissions = fetch_new_submissions(fetch_limit=fetch_limit)
            logger.info("New submissions found: %d", len(new_submissions))
        except Exception as exc:
            logger.warning("Could not fetch remote submissions: %s", exc)

    # ── Step 2: Process submissions ───────────────────────────────────────────
    if new_submissions:
        logger.info("=" * 60)
        logger.info("STEP 2: Processing submissions")
        logger.info("=" * 60)

        from process_submission import process_all
        processed = process_all(new_submissions, dry_run=dry_run)
        logger.info("Processed: %d", processed)

    # ── Step 3: Calculate statistics ──────────────────────────────────────────
    logger.info("=" * 60)
    logger.info("STEP 3: Calculating statistics")
    logger.info("=" * 60)

    from calculate_stats import load_submissions, calculate_statistics, save_statistics
    subs  = load_submissions()
    stats = calculate_statistics(subs, tz_name=tz_name)
    if not dry_run:
        save_statistics(stats)
    logger.info(
        "Stats: total=%d easy=%d medium=%d hard=%d",
        stats["totalSolved"], stats["easy"], stats["medium"], stats["hard"],
    )

    # ── Step 4: Calculate streak ──────────────────────────────────────────────
    logger.info("=" * 60)
    logger.info("STEP 4: Calculating streak")
    logger.info("=" * 60)

    from calculate_streak import calculate_streak, save_streak
    streak_data = calculate_streak(subs, tz_name=tz_name, daily_goal=daily_goal, weekly_goal=weekly_goal)
    if not dry_run:
        save_streak(streak_data)
    logger.info(
        "Streak: current=%d longest=%d",
        streak_data["currentStreak"], streak_data["longestStreak"],
    )

    # ── Step 5: Update achievements ───────────────────────────────────────────
    logger.info("=" * 60)
    logger.info("STEP 5: Updating achievements")
    logger.info("=" * 60)

    from calculate_achievements import calculate_achievements, save_achievements
    achievements = calculate_achievements(stats, streak_data)
    if not dry_run:
        save_achievements(achievements)

    # ── Step 6: Generate README ───────────────────────────────────────────────
    logger.info("=" * 60)
    logger.info("STEP 6: Generating README dashboard")
    logger.info("=" * 60)

    from generate_readme import generate_readme, save_readme
    readme_content = generate_readme()
    if not dry_run:
        save_readme(readme_content)
    else:
        logger.info("[DRY RUN] README preview (first 20 lines):")
        for line in readme_content.splitlines()[:20]:
            logger.info("  %s", line)

    # ── Step 7: Generate SVG charts ───────────────────────────────────────────
    logger.info("=" * 60)
    logger.info("STEP 7: Generating SVG charts")
    logger.info("=" * 60)

    if not dry_run:
        from generate_heatmap import generate_all
        generate_all()

    logger.info("=" * 60)
    logger.info("✅  Pipeline complete. Processed %d new submission(s).", processed)
    logger.info("=" * 60)


def main() -> None:
    parser = argparse.ArgumentParser(description="CodeStreak sync pipeline")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run the pipeline without writing any files",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable debug-level logging",
    )
    args = parser.parse_args()

    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-8s %(message)s",
        datefmt="%H:%M:%S",
    )

    try:
        run_pipeline(dry_run=args.dry_run)
    except Exception as exc:
        logger.error("Pipeline failed: %s", exc)
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
