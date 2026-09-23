"""
migrate_solutions.py
---------------------
One-time migration: moves existing LeetCode solutions from flat
`solutions/NNNN-slug/` to the platform-scoped `solutions/leetcode/NNNN-slug/`
directory structure, and backfills `platform: "leetcode"` in
`data/submissions.json` for all existing records.

Requirements (CORE-01, CORE-03):
    - solutions/leetcode/ created if not already present
    - Each `solutions/NNNN-slug/` moved under `solutions/leetcode/`
    - `data/submissions.json` entries receive `platform: "leetcode"` if missing

Usage:
    python scripts/migrate_solutions.py [--dry-run]

Safe to run multiple times; already-migrated paths are skipped gracefully.
"""

from __future__ import annotations

import argparse
import json
import logging
import shutil
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

ROOT_DIR        = Path(__file__).parent.parent
SOLUTIONS_DIR   = ROOT_DIR / "solutions"
SUBMISSIONS_DB  = ROOT_DIR / "data" / "submissions.json"


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def is_problem_folder(path: Path) -> bool:
    """
    Detect if a directory looks like a problem solution folder.
    Pattern: starts with 4 digits followed by a dash (e.g. 0001-two-sum).
    """
    return path.is_dir() and len(path.name) >= 5 and path.name[:4].isdigit() and path.name[4] == "-"


def load_submissions() -> list[dict]:
    if not SUBMISSIONS_DB.exists():
        logger.warning("No submissions.json found at %s", SUBMISSIONS_DB)
        return []
    with open(SUBMISSIONS_DB, "r", encoding="utf-8") as f:
        return json.load(f)


def save_submissions(data: list[dict]) -> None:
    with open(SUBMISSIONS_DB, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    logger.info("Saved %d submissions to %s", len(data), SUBMISSIONS_DB)


# ──────────────────────────────────────────────────────────────────────────────
# Migration logic
# ──────────────────────────────────────────────────────────────────────────────

def migrate_solution_dirs(dry_run: bool = False) -> int:
    """
    Move all top-level problem folders in solutions/ to solutions/leetcode/.
    Returns count of folders moved.
    """
    if not SOLUTIONS_DIR.exists():
        logger.info("solutions/ directory does not exist — nothing to migrate.")
        return 0

    lc_dir = SOLUTIONS_DIR / "leetcode"
    if not dry_run:
        lc_dir.mkdir(parents=True, exist_ok=True)

    moved = 0
    for child in sorted(SOLUTIONS_DIR.iterdir()):
        if not is_problem_folder(child):
            continue  # skip platform subdirectories (leetcode/, codeforces/, etc.) and files

        dest = lc_dir / child.name

        if dest.exists():
            logger.info("Skip (already migrated): %s -> %s", child.name, dest)
            continue

        if dry_run:
            logger.info("[DRY RUN] Would move: %s -> %s", child, dest)
        else:
            shutil.move(str(child), str(dest))
            logger.info("Moved: %s -> %s", child.name, dest)

        moved += 1

    return moved


def backfill_platform_field(dry_run: bool = False) -> int:
    """
    Ensure every record in data/submissions.json has a 'platform' field.
    Defaults to 'leetcode' for all records that don't have one.
    Returns count of records updated.
    """
    submissions = load_submissions()
    updated = 0

    for sub in submissions:
        if "platform" not in sub:
            sub["platform"] = "leetcode"
            updated += 1

    if updated > 0:
        if dry_run:
            logger.info("[DRY RUN] Would backfill 'platform' on %d records", updated)
        else:
            save_submissions(submissions)
            logger.info("Backfilled 'platform' field on %d records", updated)
    else:
        logger.info("All submissions already have 'platform' field — no backfill needed.")

    return updated


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")

    parser = argparse.ArgumentParser(
        description=(
            "Migrate existing LeetCode solutions to platform-scoped directories "
            "and backfill the 'platform' field in submissions.json."
        )
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without writing anything.",
    )
    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("CodeStreak Solution Migration (Phase 1 -- CORE-01 / CORE-03)")
    logger.info("=" * 60)

    if args.dry_run:
        logger.info("[DRY RUN mode -- no files will be modified]")

    # 1. Move solution folders
    logger.info("\nStep 1: Migrating solution directories...")
    moved = migrate_solution_dirs(dry_run=args.dry_run)
    logger.info("Directories moved: %d", moved)

    # 2. Backfill platform field in submissions DB
    logger.info("\nStep 2: Backfilling platform field in submissions.json...")
    updated = backfill_platform_field(dry_run=args.dry_run)
    logger.info("Records updated: %d", updated)

    logger.info("\nMigration complete!")
    if args.dry_run:
        logger.info("    (No changes written -- remove --dry-run to apply.)")
