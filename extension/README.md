# CodeStreak Extension

A Chrome/Edge/Brave browser extension that makes CodeStreak **fully automated** — no session cookies, no manual steps.

## How It Works

```
You solve a problem on LeetCode
         ↓
Extension detects "Accepted" (intercepts LeetCode's own API response)
         ↓
Extension reads code + metadata directly from the page
         ↓
Extension commits solution to leetcode-journey via GitHub API
         ↓
Extension triggers process.yml on CodeStreak
         ↓
GitHub Actions regenerates stats, streak, README, SVG charts
         ↓
Your leetcode-journey dashboard is updated ✅
```

**No LeetCode session cookies needed. One-time GitHub token setup.**

## Installation

### Chrome / Brave / Edge (Developer Mode)

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder inside your `CodeStreak` directory

The 🔥 CodeStreak icon will appear in your toolbar.

## Setup (One Time)

1. Click the CodeStreak icon in your toolbar
2. Enter your **GitHub Personal Access Token**
   - [Create one here](https://github.com/settings/tokens/new)
   - Required scopes: `repo` + `workflow`
3. Enter your **GitHub Username**
4. Confirm the repo names (`leetcode-journey` + `CodeStreak`)
5. Click **Test Connection** to verify
6. Click **Save Settings**

That's it. Now just solve LeetCode problems — everything syncs automatically.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Chrome Extension MV3 manifest |
| `content.js` | Intercepts LeetCode submission results |
| `background.js` | Handles GitHub API calls (service worker) |
| `popup.html/css/js` | Extension settings UI |
| `icons/` | Extension icons (16, 48, 128px) |

## Permissions Used

| Permission | Why |
|------------|-----|
| `storage` | Store GitHub token + settings locally |
| `notifications` | Notify when a problem is synced |
| `scripting` | Inject content script into LeetCode |
| `https://leetcode.com/*` | Intercept submission result API |
| `https://api.github.com/*` | Commit solutions to GitHub |

> Your GitHub token is stored in `chrome.storage.sync` (encrypted by Chrome). It is **never** sent anywhere except the GitHub API.
