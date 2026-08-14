# CodeStreak — Automated LeetCode Progress & GitHub Analytics

> An automated system that syncs accepted LeetCode solutions to GitHub and maintains coding streaks, statistics, achievements, analytics, and a progress dashboard.

---

## 1. Project Overview

CodeStreak is a personal automation platform for tracking daily LeetCode practice.

The core workflow is:

```text
Solve Problem on LeetCode
        ↓
Accepted Submission
        ↓
CodeStreak detects submission
        ↓
Save solution to GitHub
        ↓
Update statistics
        ↓
Calculate streak
        ↓
Generate dashboard
        ↓
Commit updated data to GitHub
```

The goal is not to create another basic LeetCode-to-GitHub copier. Existing projects already solve that problem. CodeStreak adds a personalized analytics and progress layer on top of automatic synchronization.

---

# 2. Problem Statement

Developers often solve LeetCode problems regularly but their progress is scattered across LeetCode and GitHub.

A normal solutions repository does not automatically provide:

- Daily coding streak
- Longest streak
- Problems solved per day/week/month
- Difficulty distribution
- Language statistics
- Topic statistics
- Daily goals
- Achievements
- Progress visualization
- Automated GitHub README dashboard
- Long-term learning analytics

CodeStreak solves this by automatically collecting accepted submissions and converting them into structured GitHub data and a continuously updated progress dashboard.

---

# 3. Project Goals

## Primary Goals

1. Automatically detect accepted LeetCode submissions.
2. Save solutions into an organized GitHub repository.
3. Prevent duplicate solutions.
4. Maintain structured submission data.
5. Calculate daily and historical streaks.
6. Generate statistics automatically.
7. Update a GitHub README dashboard.
8. Run the entire synchronization process using GitHub Actions.

## Secondary Goals

- Track programming languages.
- Track LeetCode topics.
- Track runtime and memory performance.
- Track milestones and achievements.
- Generate activity heatmaps.
- Provide learning recommendations.
- Add optional AI-powered analysis.

---

# 4. Existing Solutions & Research

Several existing projects already provide parts of this functionality.

## LeetSync

LeetSync automatically synchronizes accepted LeetCode submissions to GitHub and organizes solutions.

Repository:

https://github.com/LeetSync/LeetSync

## LeetHub

LeetHub automatically pushes LeetCode solutions to GitHub.

Repository:

https://github.com/QasimWani/LeetHub

## LeetHub 2.0

LeetHub 2.0 provides an updated approach for automatically syncing LeetCode solutions.

Chrome Web Store:

https://chromewebstore.google.com/detail/leethub-v2/mhanfgfagplhgemhjfeolkkdidbakocm

## LeetStash

LeetStash focuses on storing LeetCode solutions and generating documentation/statistics.

Chrome Web Store:

https://chromewebstore.google.com/detail/leetstash/ombmgeadbbffipkgmbfjmfpdfgpgodid

## WikiLeet

WikiLeet generates a wiki-style representation of LeetCode solutions.

Repository:

https://github.com/Zanger67/WikiLeet

## LeetCode Statistics

Projects such as LeetCode Stats Card demonstrate that LeetCode profile information can be presented in GitHub README files.

https://github-readme-leetcode-stats.vercel.app/

## Research Conclusion

Automatic LeetCode-to-GitHub synchronization is already a solved problem.

Therefore, CodeStreak should differentiate itself through:

- Streak tracking
- Analytics
- Achievements
- Progress visualization
- Daily goals
- Topic analysis
- Automated dashboard generation
- Optional AI-powered recommendations

---

# 5. Core Features

## 5.1 Automatic Solution Sync

After an accepted LeetCode submission:

```text
LeetCode
   ↓
Accepted
   ↓
CodeStreak
   ↓
GitHub Repository
```

Example:

```text
solutions/
└── 0001-two-sum/
    ├── solution.py
    └── README.md
```

---

# 6. Solution Documentation

Each problem can contain:

```text
# Two Sum

Problem Number: 1
Difficulty: Easy
Language: Python
Date Solved: 2026-08-14

## Approach

Use a hash map to store previously seen values.

## Complexity

Time: O(n)
Space: O(n)

## LeetCode

Problem link
```

The documentation can initially be generated from metadata and later enhanced with optional AI.

---

# 7. Statistics Engine

The statistics engine maintains data such as:

```json
{
  "totalSolved": 386,
  "easy": 142,
  "medium": 198,
  "hard": 46,
  "currentStreak": 24,
  "longestStreak": 47,
  "dailyGoal": 1
}
```

Statistics include:

- Total solved
- Easy solved
- Medium solved
- Hard solved
- Problems per day
- Problems per week
- Problems per month
- Problems per year
- Language distribution
- Topic distribution
- First solved date
- Latest solved date

---

# 8. Daily Streak Engine

The streak is based on accepted LeetCode submissions, not GitHub commits.

Example:

```text
Aug 10  ✅
Aug 11  ✅
Aug 12  ✅
Aug 13  ✅
Aug 14  ✅
```

Result:

```text
Current Streak: 5 days
```

If the next day has no accepted solution:

```text
Aug 14  ✅
Aug 15  ❌

Current Streak: 0
Longest Streak: 5
```

## Multiple Problems Per Day

If three problems are solved:

```text
Aug 14

✅ Two Sum
✅ Valid Anagram
✅ Binary Search
```

The day counts once toward the streak but three problems toward the total.

---

# 9. Daily Goals

Users can configure:

```text
Daily Goal: 1 problem
Weekly Goal: 7 problems
```

Dashboard:

```text
Today's Progress
----------------
Solved: 2
Goal:   1
Status: COMPLETED
```

---

# 10. GitHub README Dashboard

The generated README can contain:

```text
# 🧠 LeetCode Journey

Automated LeetCode progress tracker

🔥 Current Streak      24
🏆 Longest Streak      47
✅ Total Solved        386
📅 This Year           214

## Difficulty

Easy       142
Medium     198
Hard        46

## Languages

Python     142
C++        121
Java        73
SQL         50

## Today's Progress

Problems solved: 2
Daily goal: 1
Status: COMPLETED

## Recent Problems

| # | Problem | Difficulty | Language |
|---|---------|------------|----------|
| 217 | Contains Duplicate | Easy | Python |
| 238 | Product Except Self | Medium | C++ |
| 76 | Minimum Window Substring | Hard | Python |
```

The README is generated automatically and should not require manual editing.

---

# 11. Activity Heatmap

CodeStreak can generate a GitHub-style activity heatmap.

Example data:

```json
{
  "2026-08-10": 1,
  "2026-08-11": 2,
  "2026-08-12": 1,
  "2026-08-13": 3,
  "2026-08-14": 2
}
```

This can be rendered into an SVG and embedded into the README.

---

# 12. Topic Analytics

Problems can be categorized by topics such as:

- Array
- String
- Hash Table
- Linked List
- Stack
- Queue
- Tree
- Graph
- DFS
- BFS
- Dynamic Programming
- Greedy
- Binary Search
- Backtracking
- Heap
- Trie
- Sliding Window
- Two Pointers

Example:

```text
Topics

Arrays              82
Dynamic Programming 47
Hash Table           43
Trees                31
Graphs               27
Strings              25
Binary Search        19
```

This helps identify strong and weak areas.

---

# 13. Language Analytics

Track languages used to solve problems.

Example:

```text
Python     42%
C++        34%
Java       18%
SQL         6%
```

This can show how the user's problem-solving language preferences change over time.

---

# 14. Runtime & Memory Analytics

For submissions where LeetCode provides performance information, store:

```yaml
time_complexity: O(n)
space_complexity: O(n)
runtime: 42 ms
memory: 18.2 MB
runtime_percentile: 85.2
memory_percentile: 71.4
```

Future statistics:

```text
Average Runtime
Average Memory
Runtime Percentile
Memory Percentile
```

Complexity analysis can be added in a later phase.

---

# 15. Achievements

CodeStreak can automatically unlock achievements.

Examples:

```text
🎯 First Problem
🏆 10 Problems
🏆 25 Problems
🏆 50 Problems
🏆 100 Problems
🏆 250 Problems
🏆 500 Problems
🏆 1000 Problems

🔥 7 Day Streak
🔥 30 Day Streak
🔥 100 Day Streak
🔥 365 Day Streak
```

Example dashboard:

```text
Achievements

🏆 100 Problems       ✅
🏆 250 Problems       ✅
🏆 500 Problems       🔒

🔥 7 Day Streak       ✅
🔥 30 Day Streak      🔒
🔥 100 Day Streak     🔒
```

---

# 16. Submission Data Model

Each accepted submission should be normalized into a common structure.

Example:

```json
{
  "id": "123456789",
  "problem": {
    "id": 1,
    "title": "Two Sum",
    "slug": "two-sum",
    "difficulty": "Easy"
  },
  "language": "python3",
  "submittedAt": "2026-08-14T18:32:10Z",
  "status": "Accepted",
  "runtime": "42 ms",
  "memory": "18.2 MB",
  "runtimePercentile": 85.2,
  "memoryPercentile": 71.4
}
```

---

# 17. Duplicate Prevention

Duplicate handling is critical.

Example:

```text
Two Sum

❌ Wrong Answer
❌ Wrong Answer
❌ Time Limit
✅ Accepted
```

This represents:

```text
1 solved problem
```

not four solved problems.

The system should use a unique submission/problem identifier and maintain an internal record of already processed submissions.

---

# 18. Source of Truth

GitHub commits should not be treated as the primary statistics database.

Recommended architecture:

```text
LeetCode
   ↓
data/submissions.json
   ↓
Statistics Engine
   ↓
Generated README
```

GitHub commits act as the audit/history layer.

For the initial version, JSON is sufficient.

If the dataset becomes significantly larger:

```text
JSON
 ↓
SQLite
```

---

# 19. Repository Architecture

Recommended repository:

```text
leetcode-journey/
│
├── README.md
│
├── solutions/
│   ├── 0001-two-sum/
│   │   ├── solution.py
│   │   └── README.md
│   │
│   ├── 0002-add-two-numbers/
│   │   ├── solution.cpp
│   │   └── README.md
│   │
│   └── ...
│
├── data/
│   ├── submissions.json
│   ├── daily.json
│   ├── statistics.json
│   ├── streak.json
│   └── achievements.json
│
├── scripts/
│   ├── fetch_submissions.py
│   ├── process_submission.py
│   ├── calculate_stats.py
│   ├── calculate_streak.py
│   ├── generate_readme.py
│   └── generate_heatmap.py
│
├── tests/
│   ├── test_streak.py
│   ├── test_statistics.py
│   └── test_parser.py
│
├── assets/
│   ├── heatmap.svg
│   ├── difficulty.svg
│   ├── languages.svg
│   └── progress.svg
│
├── .github/
│   └── workflows/
│       ├── sync.yml
│       └── tests.yml
│
├── config.yml
├── requirements.txt
└── LICENSE
```

---

# 20. Technology Stack

| Component | Technology |
|---|---|
| Automation | GitHub Actions |
| Backend/Scripts | Python |
| Initial database | JSON |
| Future database | SQLite |
| Repository | GitHub |
| GitHub integration | GitHub REST API |
| LeetCode integration | LeetCode data/API adapter |
| Testing | pytest |
| Dashboard | Markdown + SVG |
| Scheduling | GitHub Actions cron |
| Optional AI | OpenAI/Gemini-compatible API |

GitHub Actions is designed for repository automation and supports scheduled workflows.

GitHub's REST API supports repository content operations, allowing automation to create and update files.

---

# 21. LeetCode Integration Research

This is the most important technical risk.

Existing tools such as LeetSync demonstrate that accepted LeetCode submissions can be retrieved and synchronized with GitHub.

Some existing GitHub Action implementations use LeetCode session information and CSRF-related credentials to retrieve submission data.

Therefore, the project should avoid tightly coupling the entire system to one undocumented endpoint or authentication mechanism.

Recommended architecture:

```text
              ┌────────────────────┐
              │ LeetCode Data      │
              │ Adapter            │
              └─────────┬──────────┘
                        │
                  Normalized Data
                        │
                        ▼
              ┌────────────────────┐
              │ CodeStreak Engine  │
              └─────────┬──────────┘
                        │
            ┌───────────┼───────────┐
            ▼           ▼           ▼
          Stats       Streak      GitHub
```

If LeetCode changes its interface later, only the adapter should need modification.

---

# 22. Sync Algorithm

The synchronization process:

```text
START
  │
  ▼
Authenticate
  │
  ▼
Fetch recent submissions
  │
  ▼
Filter Accepted submissions
  │
  ▼
Check existing submission IDs
  │
  ├── Existing → Skip
  │
  └── New
       │
       ▼
   Fetch problem metadata
       │
       ▼
   Save solution
       │
       ▼
   Update submission database
       │
       ▼
   Calculate statistics
       │
       ▼
   Calculate streak
       │
       ▼
   Update achievements
       │
       ▼
   Generate README
       │
       ▼
   Generate charts
       │
       ▼
   Commit changes
       │
       ▼
      DONE
```

---

# 23. GitHub Actions

## sync.yml

Purpose:

```text
Schedule
   ↓
Fetch submissions
   ↓
Process submissions
   ↓
Update repository
```

The workflow can run periodically using GitHub Actions scheduled workflows.

## tests.yml

Purpose:

```text
Push / Pull Request
       ↓
Install Python
       ↓
Run pytest
       ↓
Pass / Fail
```

---

# 24. Security

Credentials must never be committed to the repository.

Use GitHub Secrets for sensitive values such as:

```text
LEETCODE_SESSION
LEETCODE_CSRF_TOKEN
GH_TOKEN
```

The GitHub token should have only the permissions required by the workflow.

Secrets should be accessed through GitHub Actions environment variables.

---

# 25. Streak Calculation Algorithm

Pseudo-logic:

```text
Get all dates containing at least one accepted submission

Sort dates descending

Start from today's date

If today has a submission:
    current streak starts at 1
Else:
    current streak is 0

Move backward one day at a time

If previous day has a submission:
    increment streak
Else:
    stop

Compare all consecutive date ranges
Store longest streak
```

Important edge cases:

- Multiple problems on one day
- Month changes
- Year changes
- Leap years
- Missing days
- Today's timezone
- First-ever submission
- No submissions
- Future timestamps

---

# 26. Timezone Handling

The streak calculation must use a configurable timezone.

Recommended default:

```text
Asia/Kolkata
```

The system should convert submission timestamps into the configured local date before calculating daily activity.

The timezone should be configurable rather than hardcoded into the core engine.

---

# 27. Phase-by-Phase Development Roadmap

## Phase 0 — Research & Architecture

### Tasks

- Study current LeetCode submission data access.
- Evaluate API/session approaches.
- Study LeetSync and LeetHub architectures.
- Decide authentication strategy.
- Define normalized submission schema.
- Design repository structure.
- Define security model.

### Deliverables

```text
Architecture document
Data schema
Authentication strategy
Repository structure
```

---

# Phase 1 — Basic Synchronization

### Build

```text
LeetCode
   ↓
Fetcher
   ↓
Accepted Submission
   ↓
GitHub
```

### Features

- Fetch submissions.
- Detect accepted submissions.
- Fetch problem metadata.
- Fetch submitted code.
- Create solution folders.
- Save source files.
- Prevent duplicates.

### Milestone

> Solve one problem on LeetCode and have it automatically appear in GitHub.

---

# Phase 2 — Statistics Engine

Implement:

```text
calculate_stats.py
```

Track:

- Total solved
- Easy
- Medium
- Hard
- Problems per day
- Problems per week
- Problems per month
- Problems per year
- Languages
- Topics
- First solved date
- Latest solved date

---

# Phase 3 — Streak Engine

Implement:

```text
calculate_streak.py
```

Track:

- Current streak
- Longest streak
- Daily activity
- Missed days
- Daily goal
- Weekly goal

### Required tests

```text
1 day
2 consecutive days
Month boundary
Year boundary
Leap year
Multiple problems/day
Missed day
No submissions
Timezone differences
```

---

# Phase 4 — README Dashboard

Implement:

```text
generate_readme.py
```

Automatically generate:

- Total solved
- Difficulty statistics
- Current streak
- Longest streak
- Recent problems
- Daily progress
- Milestones
- Language statistics

The README should be generated from structured data rather than manually edited.

---

# Phase 5 — Visualization

Generate:

```text
assets/
├── heatmap.svg
├── difficulty.svg
├── languages.svg
└── progress.svg
```

Embed the generated SVGs into README.md.

---

# Phase 6 — Advanced Analytics

Add:

## Topic analysis

```text
Arrays        82
DP            47
Graphs        27
Trees         31
```

## Performance

```text
Average Runtime
Average Memory
Runtime Percentile
Memory Percentile
```

## Progress

```text
Monthly Problems

Jan   21
Feb   28
Mar   34
Apr   19
May   41
Jun   37
Jul   32
Aug   22
```

---

# Phase 7 — Achievement System

Create:

```text
achievements.json
```

Automatically unlock achievements for:

- First problem
- 10 problems
- 25 problems
- 50 problems
- 100 problems
- 250 problems
- 500 problems
- 1000 problems
- 7-day streak
- 30-day streak
- 100-day streak
- 365-day streak
- Yearly problem milestones

---

# Phase 8 — AI Analytics

AI should be optional and should not be required for the core application.

Possible features:

## Learning analysis

```text
Your recent solutions show:

• Strong performance in arrays.
• Limited dynamic programming practice.
• Low graph problem exposure.
• Improving average complexity.
```

## Recommended topic

```text
Recommended Topic:
Dynamic Programming

Reason:
Only 8 DP problems solved in
the last 60 days.
```

## Daily learning summary

```text
Problems solved: 2

Main concepts:
• Hash Maps
• Sliding Window

Suggested revision:
• Two Pointer technique
```

---

# 28. Final Architecture

```text
                       LEETCODE
                           │
                           ▼
                  ┌─────────────────┐
                  │ Submission      │
                  │ Adapter         │
                  └────────┬────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │ Normalizer      │
                  └────────┬────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │ Submission DB   │
                  │ JSON / SQLite   │
                  └────────┬────────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
       Statistics       Streaks       Analytics
            │              │              │
            └──────────────┼──────────────┘
                           ▼
                  ┌─────────────────┐
                  │ Dashboard       │
                  │ Generator       │
                  └────────┬────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   GitHub    │
                    │             │
                    │ README      │
                    │ Solutions   │
                    │ Charts      │
                    │ Data        │
                    └──────┬──────┘
                           │
                           ▼
                    GitHub Actions
```

---

# 29. MVP Scope

The first release should contain only:

1. LeetCode submission fetcher
2. Accepted submission detection
3. GitHub solution synchronization
4. Duplicate prevention
5. Submission database
6. Daily statistics
7. Current streak
8. Longest streak
9. Automatic README generation
10. GitHub Actions automation

After this is stable:

```text
MVP
 ↓
Analytics
 ↓
Heatmap
 ↓
Achievements
 ↓
Topic analysis
 ↓
AI recommendations
```

---

# 30. Future Enhancements

Possible future features:

- Web dashboard
- Mobile-friendly dashboard
- Interactive charts
- LeetCode contest tracking
- Rating history
- NeetCode 150 progress
- Blind 75 progress
- Company-wise problem tracking
- Interview preparation mode
- Difficulty recommendations
- Weak-topic detection
- AI-generated explanations
- AI code review
- Daily problem recommendations
- Weekly progress reports
- Email/Discord notifications
- Telegram notifications
- GitHub profile integration
- SQLite/PostgreSQL backend
- Docker deployment

---

# 31. Portfolio Value

CodeStreak demonstrates several real-world engineering skills:

- API integration
- Authentication
- Data processing
- GitHub REST API
- GitHub Actions
- CI/CD
- Automation
- Python
- JSON/SQLite data management
- Algorithmic analytics
- Data visualization
- Testing
- Security
- Optional AI integration

This makes it more valuable as a portfolio project than simply maintaining a LeetCode solutions repository.

---

# 32. Project Identity

## Name

**CodeStreak**

## Full Title

**CodeStreak — Automated LeetCode Progress & GitHub Analytics**

## Short Description

> An automated system that syncs accepted LeetCode solutions to GitHub and maintains coding streaks, statistics, achievements, analytics, and a continuously updated progress dashboard.

## Core Idea

```text
Solve → Sync → Analyze → Track → Improve
```

---

# 33. Recommended Development Order

The project should be implemented in this exact order:

```text
1. Repository initialization
        ↓
2. Data schema
        ↓
3. LeetCode adapter
        ↓
4. Submission fetcher
        ↓
5. Accepted submission filter
        ↓
6. Duplicate detection
        ↓
7. GitHub solution writer
        ↓
8. Statistics engine
        ↓
9. Streak engine
        ↓
10. Unit tests
        ↓
11. README generator
        ↓
12. GitHub Actions
        ↓
13. Heatmap
        ↓
14. Achievements
        ↓
15. Topic analytics
        ↓
16. Performance analytics
        ↓
17. Optional AI layer
```

---

# 34. Final Vision

The finished CodeStreak repository should behave like a personal automated coding journal.

You should not have to manually:

- Copy solutions
- Create folders
- Update README
- Count solved problems
- Calculate streaks
- Update statistics
- Create charts
- Track milestones

The intended workflow is simply:

```text
                 YOU
                  │
                  ▼
          Solve LeetCode Problem
                  │
                  ▼
              Accepted
                  │
                  ▼
            CODESTREAK
                  │
        ┌─────────┼─────────┐
        ▼         ▼         ▼
      Save      Analyze   Track
      Code      Stats     Streak
        │         │         │
        └─────────┼─────────┘
                  ▼
               GitHub
                  │
        ┌─────────┼─────────┐
        ▼         ▼         ▼
    Solutions  Dashboard  Analytics
```

The core principle is:

> **Zero manual maintenance after initial setup.**

---

# 35. Research References

The architecture and feasibility research should be validated against current official documentation and existing implementations during development.

- GitHub Actions Documentation: https://docs.github.com/en/actions
- GitHub REST API Documentation: https://docs.github.com/en/rest
- GitHub Repository Contents API: https://docs.github.com/en/rest/repos/contents
- GitHub Commits API: https://docs.github.com/en/rest/commits
- LeetSync: https://github.com/LeetSync/LeetSync
- LeetHub: https://github.com/QasimWani/LeetHub
- WikiLeet: https://github.com/Zanger67/WikiLeet
- LeetCode Stats Card: https://github-readme-leetcode-stats.vercel.app/

> **Note:** LeetCode's internal APIs, authentication mechanisms, and anti-automation behavior can change. The LeetCode integration should therefore be isolated behind an adapter and tested against the current interface before deployment.
