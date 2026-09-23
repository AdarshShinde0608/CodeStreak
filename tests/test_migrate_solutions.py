"""Regression tests for platform-scoped solution migration."""

from __future__ import annotations

import json

from scripts.migrate_solutions import backfill_platform_field, migrate_solution_dirs


def test_migrate_solution_dirs_supports_dry_run_and_is_idempotent(tmp_path):
    solutions_dir = tmp_path / "solutions"
    legacy_dir = solutions_dir / "0001-two-sum"
    legacy_dir.mkdir(parents=True)
    (legacy_dir / "solution.java").write_text("class Solution {}", encoding="utf-8")

    assert migrate_solution_dirs(solutions_dir, dry_run=True) == 1
    assert legacy_dir.exists()
    assert not (solutions_dir / "leetcode" / "0001-two-sum").exists()

    assert migrate_solution_dirs(solutions_dir) == 1
    assert (solutions_dir / "leetcode" / "0001-two-sum" / "solution.java").exists()
    assert migrate_solution_dirs(solutions_dir) == 0


def test_backfill_platform_field_targets_explicit_database(tmp_path):
    database = tmp_path / "data" / "submissions.json"
    database.parent.mkdir()
    database.write_text(
        json.dumps([
            {"submission_id": "1"},
            {"submission_id": "2", "platform": "codeforces"},
        ]),
        encoding="utf-8",
    )

    assert backfill_platform_field(database) == 1
    records = json.loads(database.read_text(encoding="utf-8"))
    assert records[0]["platform"] == "leetcode"
    assert records[1]["platform"] == "codeforces"