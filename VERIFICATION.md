# Verification record

Date: October 27, 2026. Version: `0.2.0` preview.

## Live checks completed (anonymous read-only)

Using the extension's actual HTTPS/GraphQL client (`src/api.js`), without credentials:

- ** October 26, 2026**:
  - `question(titleSlug: "two-sum")` returned displayed number `1`, internal ID `1`, the full description, the `Solution` C++ starter containing `twoSum`, and three example input pairs (`enableRunCode: true`).
  - `questionList` search for `1` included an exact displayed-number match for `1` with slug `two-sum`.
- **October 26–27, 2026**:
  - `questionList(categorySlug: "", limit: 2, skip: 0, filters: { tags: ["array"], difficulty: EASY })` returned a validated filtered list with `total: 448`.
  - `questionTopicTags { edges { node { name slug } } }` returned `75` validated topics (whereas root `topicTags` returned empty and is not used).
  - `activeDailyCodingChallengeQuestion` returned the dated Daily Challenge (`2026-10-27`, slug `create-grid-with-exactly-one-path`, link `/problems/create-grid-with-exactly-one-path/`).

These read-only checks do not establish whether authenticated write endpoints or authenticated progress filters will accept this client on a live account.

## Automated checks

`D:\Software\Node\node.exe --test test/*.test.js` and `D:\Software\Node\node.exe scripts/check.js` were executed against the 0.2.0 codebase:

- **38 total tests across 3 test files (`test/core.test.js`, `test/discovery-api.test.js`, `test/extension.test.js`): 37 passed, 0 failed, 1 skipped.**
  - `test/discovery-api.test.js` (10 passed): covers `listProblems` GraphQL variable mapping, default bounded paging and empty results, `search` compatibility, strict `null`/`ac`/`notac` status validation (rejecting unknown/missing statuses with `PROTOCOL`), retention of nonnumeric frontend IDs (`supported: false`) with `UNSUPPORTED` rejection on open, strict `account()` boolean and bounded username verification, filter/paging/query/topic boundary validation, `questionTopicTags` connection validation, `activeDailyCodingChallengeQuestion` date/link/slug validation, and malformed/GraphQL/HTTP error handling.
  - `test/extension.test.js` (13 passed): covers dirty editor snapshot submission, rejection of unrelated C++ editors, offline local reopen without overwrite, custom input buffer execution, connect/disconnect secret storage, no startup network calls, anonymous first-use sidebar loading with corrupt stored secrets, unsupported ID rejection in the sidebar, search/difficulty/multi-topic/progress filters and pagination reset, out-of-order response invalidation, Daily Challenge server date and stale-refresh retry rows, immediate return of `Open LeetCode Sign-in` vs separate `Advanced: Import Session`, preservation of prior credentials/state on failed replacement import, `unavailable` vs `expired` account states, cross-window `secrets.onDidChange` invalidation and account switching, and post-submit/post-resume progress refresh without failing on refresh errors.
  - `test/core.test.js` (14 passed, 1 skipped): covers fixed-origin HTTPS transport, CSRF headers, redirect rejection, error sanitization, C++ test/submit payloads, solution persistence, path-traversal and outside-file rejection (running unconditionally on Windows), pending-job lock and recovery across reloads/windows, timeout/cancellation preservation, HTML description sanitization, test vs submission verdict formatting, and 0.2.0 VSIX/source ZIP build and archive inspection. The symlink-creation test (`linked files cannot be selected as solutions or inputs`) is explicitly skipped on this Windows host because unprivileged `fs.symlink` returns `EPERM`.
- **`scripts/check.js`**: Passed syntax verification (`node --check`) for all JS files in `src/`, `test/`, and `scripts/`, verified that all 28 contributed commands in `package.json` are registered in `src/extension.js`, verified Activity Bar view container and `media/leetcode.svg` icon existence, and verified all allowlisted package paths.
- **`scripts/package.js`**: Built and verified `dist/leetcode-inside-vscode-0.2.0.vsix` and `dist/leetcode-inside-vscode-0.2.0-source.zip` using Node's built-in `zlib`, confirming forward-slash entry paths, CRC-32/size integrity, inclusion of all runtime/source allowlisted files, and exclusion of `.git`, `dist`, and credential/environment files.

## Required manual acceptance checks — not yet completed

Desktop VS Code Extension Host rendering and authenticated account operations have not been executed in this environment. Verify manually in desktop VS Code **1.93+**:

- [ ] Install `dist/leetcode-inside-vscode-0.2.0.vsix` in desktop VS Code and confirm the **LeetCode** Activity Bar icon and sidebar render in light and dark themes.
- [ ] Expand the sidebar while signed out; confirm **Daily Challenge** and **Browse Problems** load anonymously and clicking a problem opens its description beside a C++ editor.
- [ ] Test **Search**, **Difficulty**, and **Topics** filters and **Next Page** / **Previous Page** in the sidebar.
- [ ] Click **Open LeetCode Sign-in** and confirm it opens the browser login page without claiming VS Code is connected.
- [ ] Connect a personal account via **Advanced: Import Session**; confirm the sidebar shows `Verified: <username>` and unlocks the **Progress** filter (`All`, `Solved`, `Attempted`, `Not started`).
- [ ] Run examples, custom inputs, and an official submission; confirm visible sidebar progress updates after submission and that the submission ID appears in your LeetCode submission history.
- [ ] Save code, close VS Code, disconnect network, reopen, and click the problem under **Local Problems**; confirm offline reopen preserves saved C++ code.
