"""
process_submission.py
---------------------
Handles saving a new accepted submission to the repository.

For each new submission:
    1. Creates solutions/<platform>/NNNN-slug/ folder  (CORE-01)
    2. Writes solution.<ext> (source code)
    3. Writes solutions/<platform>/NNNN-slug/README.md (auto-generated from metadata)
    4. Appends the submission record to data/submissions.json  (CORE-02)

Platform values: "leetcode" | "codeforces" | "geeksforgeeks" | "codechef"

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

def slugify_folder(problem_id: int | str, slug: str) -> str:
    """
    Convert a problem id + slug into a stable folder name.

    Numeric IDs retain the original LeetCode zero-padding convention, while
    platform-specific IDs such as Codeforces' ``1234A`` are preserved.
    """
    if isinstance(problem_id, int):
        return f"{problem_id:04d}-{slug}"
    if problem_id.isdigit():
        return f"{int(problem_id):04d}-{slug}"
    return f"{problem_id}-{slug}"


def build_solution_readme(sub: dict, solution_dir: Path | None = None) -> str:
    """Generate a README.md for a problem solution, including all available language solutions."""
    problem = sub["problem"]
    platform = sub.get("platform", "leetcode")
    date_solved = sub["submitted_at"][:10]   # "2026-08-14"
    lang_display = sub["language"].title().replace("python3", "Python").replace("cpp", "C++")

    # Platform display label and URL
    platform_labels = {
        "leetcode":     ("LeetCode",     problem.get("url", "")),
        "codeforces":   ("Codeforces",   problem.get("url", "")),
        "geeksforgeeks":("GeeksforGeeks",problem.get("url", "")),
        "codechef":     ("CodeChef",     problem.get("url", "")),
    }
    plat_label, plat_url = platform_labels.get(platform, (platform.title(), problem.get("url", "")))

    # If multiple language files exist in the solution directory, list them all
    solutions_table = ""
    if solution_dir and solution_dir.exists():
        solution_files = sorted(solution_dir.glob("solution.*"))
        if len(solution_files) > 1:
            rows = []
            for f in solution_files:
                ext = f.suffix.lstrip(".").lower()
                lang_name = ext.upper()
                if ext in ("py", "python"): lang_name = "Python"
                elif ext in ("cpp", "cc", "cxx"): lang_name = "C++"
                elif ext == "java": lang_name = "Java"
                elif ext in ("js", "javascript"): lang_name = "JavaScript"
                elif ext in ("ts", "typescript"): lang_name = "TypeScript"
                elif ext in ("go", "golang"): lang_name = "Go"
                elif ext in ("rs", "rust"): lang_name = "Rust"
                elif ext in ("cs", "csharp"): lang_name = "C#"
                rows.append(f"| {lang_name} | [{f.name}]({f.name}) |")
            if rows:
                solutions_table = f"\n## Available Solutions\n\n| Language | Source Code |\n|:---|:---|\n" + "\n".join(rows) + "\n"

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
    plat_link = f"[Link]({plat_url})" if plat_url else "—"

    return f"""# {problem['title']}

| Field | Value |
|-------|-------|
| **Problem #** | {problem['id']} |
| **Platform** | {plat_label} |
| **Difficulty** | {problem['difficulty']} |
| **Language** | {lang_display} |
| **Topics** | {topics_line} |
| **Date Solved** | {date_solved} |
| **{plat_label}** | {plat_link} |
{solutions_table}
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
    Process a single submission.
    Creates platform-scoped folder structure (solutions/<platform>/NNNN-slug/),
    writes/updates solution file for the specific language,
    and regenerates the problem README with latest metadata and solution links.
    """
    problem = sub["problem"]
    platform = sub.get("platform", "leetcode")  # default to leetcode for backward compat
    folder_name = slugify_folder(problem["id"], problem["slug"])
    solution_dir = SOLUTIONS_DIR / platform / folder_name
    ext = get_extension(sub["language"])
    solution_file = solution_dir / f"solution.{ext}"
    readme_file   = solution_dir / "README.md"

    if dry_run:
        logger.info("[DRY RUN] Would create/update %s", solution_dir)
        return True

    solution_dir.mkdir(parents=True, exist_ok=True)

    # Always write / replace solution file with the latest submitted code for this language
    with open(solution_file, "w", encoding="utf-8") as f:
        f.write(sub.get("code", "# Solution code not available\n"))
    logger.info("Wrote/updated solution: %s", solution_file)

    # Write / update README with latest metadata & all language implementations
    with open(readme_file, "w", encoding="utf-8") as f:
        f.write(build_solution_readme(sub, solution_dir))
    logger.info("Wrote/updated README: %s", readme_file)

    return True


def process_all(new_submissions: list[dict], dry_run: bool = False) -> int:
    """
    Process all submissions, updating the submissions DB.
    Always updates or replaces existing code with the latest submission.
    Returns number of successfully processed submissions.
    """
    if not new_submissions:
        logger.info("No new submissions to process.")
        return 0

    existing = load_submissions_db()
    id_map = {str(s["submission_id"]): i for i, s in enumerate(existing)}
    processed = 0

    for sub in new_submissions:
        sid = str(sub["submission_id"])
        try:
            success = process_submission(sub, dry_run=dry_run)
            if success:
                if sid in id_map:
                    existing[id_map[sid]] = sub
                else:
                    existing.append(sub)
                    id_map[sid] = len(existing) - 1
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

    logger.info("Processed %d submission(s)", processed)
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
