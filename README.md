# CodeStreak 🔥

> Automated LeetCode progress tracker — syncs accepted solutions to GitHub, tracks streaks, statistics, achievements, and generates a progress dashboard.

## Architecture

```
CodeStreak (this repo)          leetcode-journey (target repo)
──────────────────────          ──────────────────────────────
scripts/                        README.md  ← auto-generated dashboard
├── main.py                     solutions/
├── leetcode_adapter.py         ├── 0001-two-sum/
├── fetch_submissions.py        │   ├── solution.py
├── process_submission.py       │   └── README.md
├── calculate_stats.py          └── ...
├── calculate_streak.py         data/
├── calculate_achievements.py   ├── submissions.json
├── generate_readme.py          ├── statistics.json
└── generate_heatmap.py         ├── streak.json
                                └── achievements.json
.github/workflows/              assets/
├── sync.yml (runs pipeline)    ├── heatmap.svg
└── tests.yml (CI)              ├── difficulty.svg
                                └── languages.svg
config.yml
requirements.txt
```

## Setup

### 1. Fork / clone this repo

```bash
git clone https://github.com/YOUR_USERNAME/CodeStreak.git
```

### 2. Create the `leetcode-journey` target repo

Create a **separate public repository** on GitHub named `leetcode-journey`.
This is where your solutions and dashboard will live.

### 3. Edit `config.yml`

```yaml
timezone: Asia/Kolkata    # Your local timezone
daily_goal: 1
weekly_goal: 7
github_username: your-username
repo_name: CodeStreak
```

### 4. Add GitHub Secrets

Go to **CodeStreak repo → Settings → Secrets and variables → Actions** and add:

| Secret | Description |
|--------|-------------|
| `LEETCODE_SESSION` | Value of your `LEETCODE_SESSION` browser cookie |
| `LEETCODE_CSRF_TOKEN` | Value of your `csrftoken` browser cookie |
| `GH_TOKEN` | GitHub Personal Access Token with `repo` scope |

#### How to get LeetCode cookies

1. Open [leetcode.com](https://leetcode.com) and log in
2. Open DevTools → Application → Cookies → `https://leetcode.com`
3. Copy the value of `LEETCODE_SESSION`
4. Copy the value of `csrftoken`

### 5. Enable GitHub Actions

Go to **Actions** tab and enable workflows.
The sync workflow runs automatically every 4 hours.

You can also trigger it manually: **Actions → CodeStreak Sync → Run workflow**.

## Running Locally

```bash
pip install -r requirements.txt

# Set credentials
export LEETCODE_SESSION=your_session
export LEETCODE_CSRF_TOKEN=your_csrf_token

# Dry run (no file writes)
python scripts/main.py --dry-run

# Full run
python scripts/main.py
```

## Running Tests

```bash
pytest tests/ -v
```

## Project Structure

| File | Purpose |
|------|---------|
| `scripts/main.py` | Pipeline orchestrator |
| `scripts/leetcode_adapter.py` | All LeetCode API calls (isolated) |
| `scripts/fetch_submissions.py` | Fetch & filter new accepted submissions |
| `scripts/process_submission.py` | Save solutions, update submission DB |
| `scripts/calculate_stats.py` | Statistics engine |
| `scripts/calculate_streak.py` | Streak engine (timezone-aware) |
| `scripts/calculate_achievements.py` | Achievement system |
| `scripts/generate_readme.py` | README dashboard generator |
| `scripts/generate_heatmap.py` | SVG chart generator |
| `config.yml` | User configuration |

## Roadmap

See [CodeStreak_Roadmap.md](CodeStreak_Roadmap.md) for the full phase-by-phase plan.

---

*Zero manual maintenance after initial setup.*
"# CodeStreak" 
