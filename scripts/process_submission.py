"""
process_submission.py
---------------------
Handles saving a new accepted submission to the repository.

For each new submission:
    1. Creates solutions/NNNN-slug/ folder
    2. Writes solution.<ext> (source code)
    3. Writes solutions/NNNN-slug/README.md (auto-generated from metadata)
    4. Appends the submission record to data/submissions.json

Usage:
    Called by main.py with the list of new submission dicts from fetch_submissions.py
    
    Can also be run standalone:
        python scripts/process_submission.py  # reads new_submissions.json from /tmp
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from leetcode_adapter import get_extension

logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).parent.parent
SOLUTIONS_DIR = ROOT_DIR / "solutions"
SUBMISSIONS_DB = ROOT_DIR / "data" / "submissions.json"


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def slugify_folder(problem_id: int, slug: str) -> str:
    """
    Convert a problem id + slug into a zero-padded folder name.
    e.g. (1, "two-sum")  ->  "0001-two-sum"
    """
    return f"{problem_id:04d}-{slug}"


def build_solution_readme(sub: dict) -> str:
    """Generate a README.md for a single problem solution."""
    problem = sub["problem"]
    date_solved = sub["submitted_at"][:10]   # "2026-08-14"
    lang_display = sub["language"].title().replace("python3", "Python").replace("cpp", "C++")

    runtime_line = f"- **Runtime**: {sub['runtime']}" if sub.get("runtime") else ""
    memory_line  = f"- **Memory**: {sub['memory']}"  if sub.get("memory")  else ""
    perf_section = ""
    if runtime_line or memory_line:
        perf_section = f"""
## Performance

{runtime_line}
{memory_line}
""".strip()

    topics = problem.get("topics", [])
    topics_line = ", ".join(topics) if topics else "—"

    return f"""# {problem['title']}

| Field | Value |
|-------|-------|
| **Problem #** | {problem['id']} |
| **Difficulty** | {problem['difficulty']} |
| **Language** | {lang_display} |
| **Topics** | {topics_line} |
| **Date Solved** | {date_solved} |
| **LeetCode** | [Link]({problem['url']}) |

## Approach

> _Add your approach notes here._

## Complexity

- **Time**: O(?)
- **Space**: O(?)

{perf_section}
""".strip() + "\n"


def load_submissions_db() -> list[dict]:
    """Load existing submissions list from JSON."""
    if not SUBMISSIONS_DB.exists():
        return []
    with open(SUBMISSIONS_DB, "r", encoding="utf-8") as f:
        return json.load(f)


def save_submissions_db(submissions: list[dict]) -> None:
    """Persist updated submissions list to JSON (sorted by date, newest first)."""
    submissions_sorted = sorted(submissions, key=lambda s: s["submitted_at"], reverse=True)
    with open(SUBMISSIONS_DB, "w", encoding="utf-8") as f:
        json.dump(submissions_sorted, f, indent=2, ensure_ascii=False)
    logger.info("Saved %d submissions to %s", len(submissions_sorted), SUBMISSIONS_DB)


# ──────────────────────────────────────────────────────────────────────────────
# Main processing
# ──────────────────────────────────────────────────────────────────────────────

def process_submission(sub: dict, dry_run: bool = False) -> bool:
    """
    Process a single new submission.
    Creates folder structure, writes files, returns True on success.
    """
    problem = sub["problem"]
    folder_name = slugify_folder(problem["id"], problem["slug"])
    solution_dir = SOLUTIONS_DIR / folder_name
    ext = get_extension(sub["language"])
    solution_file = solution_dir / f"solution.{ext}"
    readme_file   = solution_dir / "README.md"

    if dry_run:
        logger.info("[DRY RUN] Would create %s", solution_dir)
        return True

    solution_dir.mkdir(parents=True, exist_ok=True)

    # Write solution source
    if solution_file.exists():
        logger.info("Solution file already exists, skipping write: %s", solution_file)
    else:
        with open(solution_file, "w", encoding="utf-8") as f:
            f.write(sub.get("code", "# Solution code not available\n"))
        logger.info("Wrote solution: %s", solution_file)

    # Write/overwrite README (always update with latest metadata)
    with open(readme_file, "w", encoding="utf-8") as f:
        f.write(build_solution_readme(sub))
    logger.info("Wrote README: %s", readme_file)

    return True


def process_all(new_submissions: list[dict], dry_run: bool = False) -> int:
    """
    Process all new submissions, updating the submissions DB.
    Returns number of successfully processed submissions.
    """
    if not new_submissions:
        logger.info("No new submissions to process.")
        return 0

    existing = load_submissions_db()
    existing_ids = {s["submission_id"] for s in existing}
    processed = 0

    for sub in new_submissions:
        sid = sub["submission_id"]
        if sid in existing_ids:
            logger.warning("Submission %s already in DB, skipping.", sid)
            continue

        try:
            success = process_submission(sub, dry_run=dry_run)
            if success:
                existing.append(sub)
                existing_ids.add(sid)
                processed += 1
                logger.info(
                    "✅  Processed: #%d %s (%s)",
                    sub["problem"]["id"],
                    sub["problem"]["title"],
                    sub["language"],
                )
        except Exception as exc:
            logger.error("Failed to process submission %s: %s", sid, exc)

    if not dry_run:
        save_submissions_db(existing)

    logger.info("Processed %d new submission(s)", processed)
    return processed


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Process new LeetCode submissions")
    parser.add_argument(
        "--input",
        default="-",
        help="Path to JSON file with new submissions, or '-' for stdin (default: stdin)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Don't write any files")
    args = parser.parse_args()

    if args.input == "-":
        raw = sys.stdin.read()
    else:
        raw = Path(args.input).read_text(encoding="utf-8")

    submissions = json.loads(raw)
    count = process_all(submissions, dry_run=args.dry_run)
    print(f"Processed: {count} submission(s)")
