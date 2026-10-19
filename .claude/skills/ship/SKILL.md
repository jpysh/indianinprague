---
name: ship
description: Take one change on guldaarbazaar.com from issue to live. Use for any fix or feature before opening a pull request.
---
1. **Issue first.** `gh issue create` in plain prose, under 2,000 characters; use the number it prints.
2. **Own branch** from `origin/main` in a worktree. Other sessions edit this repo at the same time.
3. **Build it**, then run every build step yourself, never hand the owner a command: the generator you touched (`build-shop.mjs`, `build-diaries.mjs`, ...), `node scripts/bump-assets.mjs` after any change under `assets/`, then `node scripts/build-dist.mjs` (no flag: it is the cloud path and fails on dead links; a second run must make no diff).
4. **Verify as a shopper** in the browser pane (`site-root` in `.claude/launch.json`) at the mobile preset: read the text, tap the thing, count the taps. A shop CSS change also needs WebKit at iPhone width (CLAUDE.md). A motion change: check with JavaScript off.
5. **PR** (body under 2,000 characters: what changed, why, the source consulted, what was verified, what was skipped; end with the attribution line). Merge it yourself with `gh pr merge N --squash` when steps 3 and 4 passed and nothing in it is an owner's call (CLAUDE.md, Autopilot); merging to `main` deploys. Otherwise leave it open and add one line to the owner issue.
6. Close the issue with the PR. About 3 minutes after a merge, check the live page once on guldaarbazaar.com.
