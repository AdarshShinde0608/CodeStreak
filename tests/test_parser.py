"""
tests/test_parser.py
--------------------
Tests for submission normalization / processing helpers.

Tests:
    - slugify_folder
    - build_solution_readme
    - get_extension (language → file extension)
    - submission_to_dict round-trip
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from leetcode_adapter import get_extension
from process_submission import slugify_folder, build_solution_readme


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

SAMPLE_SUB = {
    "submission_id": "123456789",
    "problem": {
        "id": 1,
        "title": "Two Sum",
        "slug": "two-sum",
        "difficulty": "Easy",
        "topics": ["Array", "Hash Table"],
        "url": "https://leetcode.com/problems/two-sum/",
    },
    "language": "python3",
    "status": "Accepted",
    "submitted_at": "2026-08-14T12:30:00Z",
    "runtime": "42 ms",
    "memory": "18.2 MB",
    "runtime_percentile": 85.2,
    "memory_percentile": 71.4,
    "code": "class Solution:\n    def twoSum(self, nums, target):\n        pass\n",
}


# ──────────────────────────────────────────────────────────────────────────────
# slugify_folder
# ──────────────────────────────────────────────────────────────────────────────

class TestSlugifyFolder:

    def test_basic(self):
        assert slugify_folder(1, "two-sum") == "0001-two-sum"

    def test_four_digit_id(self):
        assert slugify_folder(1234, "some-problem") == "1234-some-problem"

    def test_five_digit_id(self):
        # IDs over 9999 should not be truncated
        assert slugify_folder(10001, "hard-problem") == "10001-hard-problem"

    def test_zero_padded(self):
        assert slugify_folder(7, "valid-parentheses") == "0007-valid-parentheses"

    def test_three_digit(self):
        assert slugify_folder(100, "same-tree") == "0100-same-tree"


# ──────────────────────────────────────────────────────────────────────────────
# get_extension
# ──────────────────────────────────────────────────────────────────────────────

class TestGetExtension:

    def test_python3(self):
        assert get_extension("python3") == "py"

    def test_python(self):
        assert get_extension("python") == "py"

    def test_cpp(self):
        assert get_extension("cpp") == "cpp"

    def test_java(self):
        assert get_extension("java") == "java"

    def test_javascript(self):
        assert get_extension("javascript") == "js"

    def test_typescript(self):
        assert get_extension("typescript") == "ts"

    def test_golang(self):
        assert get_extension("golang") == "go"

    def test_rust(self):
        assert get_extension("rust") == "rs"

    def test_mysql(self):
        assert get_extension("mysql") == "sql"

    def test_mssql(self):
        assert get_extension("mssql") == "sql"

    def test_csharp(self):
        assert get_extension("csharp") == "cs"

    def test_bash(self):
        assert get_extension("bash") == "sh"

    def test_unknown_language(self):
        assert get_extension("brainfuck") == "txt"

    def test_case_insensitive(self):
        assert get_extension("Python3") == "py"
        assert get_extension("CPP") == "cpp"


# ──────────────────────────────────────────────────────────────────────────────
# build_solution_readme
# ──────────────────────────────────────────────────────────────────────────────

class TestBuildSolutionReadme:

    def test_contains_problem_title(self):
        readme = build_solution_readme(SAMPLE_SUB)
        assert "Two Sum" in readme

    def test_contains_difficulty(self):
        readme = build_solution_readme(SAMPLE_SUB)
        assert "Easy" in readme

    def test_contains_date(self):
        readme = build_solution_readme(SAMPLE_SUB)
        assert "2026-08-14" in readme

    def test_contains_topics(self):
        readme = build_solution_readme(SAMPLE_SUB)
        assert "Array" in readme
        assert "Hash Table" in readme

    def test_contains_leetcode_link(self):
        readme = build_solution_readme(SAMPLE_SUB)
        assert "https://leetcode.com/problems/two-sum/" in readme

    def test_contains_runtime(self):
        readme = build_solution_readme(SAMPLE_SUB)
        assert "42 ms" in readme

    def test_contains_memory(self):
        readme = build_solution_readme(SAMPLE_SUB)
        assert "18.2 MB" in readme

    def test_no_runtime_section_when_missing(self):
        sub = {**SAMPLE_SUB, "runtime": None, "memory": None}
        readme = build_solution_readme(sub)
        assert "Performance" not in readme

    def test_ends_with_newline(self):
        readme = build_solution_readme(SAMPLE_SUB)
        assert readme.endswith("\n")

    def test_empty_topics(self):
        sub = {**SAMPLE_SUB, "problem": {**SAMPLE_SUB["problem"], "topics": []}}
        readme = build_solution_readme(sub)
        assert "—" in readme   # placeholder for no topics
