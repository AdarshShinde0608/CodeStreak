"""Regression tests for the Codeforces adapter and canonical integration."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from codeforces_adapter import CodeforcesAdapter, rating_to_difficulty
from process_submission import slugify_folder


def test_rating_to_difficulty_preserves_expected_boundaries():
    assert rating_to_difficulty(None) == "Unknown"
    assert rating_to_difficulty(800) == "Easy"
    assert rating_to_difficulty(1400) == "Easy"
    assert rating_to_difficulty(1401) == "Medium"
    assert rating_to_difficulty(2099) == "Medium"
    assert rating_to_difficulty(2100) == "Hard"


def test_normalize_submission_maps_codeforces_metadata():
    adapter = CodeforcesAdapter(handle="sample", max_retries=1)
    raw = {
        "id": 987654,
        "creationTimeSeconds": 1770000000,
        "programmingLanguage": "GNU C++17",
        "timeConsumedMillis": 42,
        "memoryConsumedBytes": 147456,
        "verdict": "OK",
        "problem": {
            "contestId": 1234,
            "index": "A",
            "name": "Two Sum",
            "rating": 1400,
            "tags": [" brute force ", "math"],
        },
    }

    submission = adapter.normalize_submission(raw)
    canonical = submission.to_canonical_dict()

    assert canonical["platform"] == "codeforces"
    assert canonical["submission_id"] == "987654"
    assert canonical["problem"]["id"] == "1234A"
    assert canonical["problem"]["slug"] == "1234-a"
    assert canonical["problem"]["rating"] == 1400
    assert canonical["problem"]["difficulty"] == "Easy"
    assert canonical["problem"]["topics"] == [" brute force ", "math"]
    assert canonical["language"] == "cpp"
    assert canonical["runtime"] == "42 ms"
    assert canonical["memory"] == "144 KB"


def test_get_user_submissions_uses_user_status_endpoint():
    adapter = CodeforcesAdapter(handle="sample", max_retries=1)
    adapter._session.get = Mock(
        return_value=Mock(
            json=lambda: {"status": "OK", "result": [{"id": 1, "verdict": "OK"}]},
            raise_for_status=lambda: None,
        )
    )

    assert adapter.get_user_submissions(count=7) == [{"id": 1, "verdict": "OK"}]
    request = adapter._session.get.call_args
    assert request.args[0].endswith("/user.status")
    assert request.kwargs["params"] == {"handle": "sample", "count": 7}


def test_slugify_folder_supports_codeforces_string_ids():
    assert slugify_folder("1234A", "two-sum") == "1234A-two-sum"
