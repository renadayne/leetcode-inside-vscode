# Verification record

Date: October 27, 2026. Version: `0.3.0` preview.

## Live checks completed (anonymous read-only)

Using the extension's actual HTTPS/GraphQL client (`src/api.js`), without credentials:

- **October 26, 2026**:
  - `question(titleSlug: "two-sum")` returned displayed number `1`, internal ID `1`, the full description, the `Solution` C++ starter containing `twoSum`, and three example input pairs (`enableRunCode: true`).
  - `questionList` search for `1` included an exact displayed-number match for `1` with slug `two-sum`.
- **October 26–27, 2026**:
  - `questionList(categorySlug: "", limit: 2, skip: 0, filters: { tags: ["array"], difficulty: EASY })` returned a validated filtered list with `total: 448`.
  - `questionTopicTags { edges { node { name slug } } }` returned `75` validated topics (whereas root `topicTags` returned empty and is not used).
  - `activeDailyCodingChallengeQuestion` returned the dated Daily Challenge (`2026-10-27`, slug `create-grid-with-exactly-one-path`, link `/problems/create-grid-with-exactly-one-path/`).

These read-only checks do not establish whether authenticated write endpoints or authenticated progress filters will accept this client on a live account.

## Automated checks

`node --test test/*.test.js` and `node scripts/check.js` were executed against the 0.3.0 codebase:

- **47 total tests across 3 test files (`test/core.test.js`, `test/discovery-api.test.js`, `test/extension.test.js`): 46 passed, 0 failed, 1 skipped.**
  - `test/discovery-api.test.js` (10 passed): covers `listProblems` GraphQL variable mapping, default bounded paging and empty results, `search` compatibility, strict `null`/`ac`/`notac` status validation (rejecting unknown/missing statuses with `PROTOCOL`), retention of nonnumeric frontend IDs (`supported: false`) with `UNSUPPORTED` rejection on open, strict `account()` boolean and bounded username verification, filter/paging/query/topic boundary validation, `questionTopicTags` connection validation, `activeDailyCodingChallengeQuestion` date/link/slug validation, and malformed/GraphQL/HTTP error handling.
  - `test/extension.test.js` (22 passed): covers dirty editor snapshot submission, rejection of unrelated C++ editors, offline local reopen without overwrite, custom input buffer execution, connect/disconnect secret storage, no startup network calls, anonymous first-use sidebar loading with corrupt stored secrets, unsupported ID rejection, search/difficulty/multi-topic/progress filters and pagination reset, out-of-order response invalidation, Daily Challenge server date and stale-refresh retry rows, immediate return of `Open LeetCode Sign-in` vs separate `Advanced: Import Session`, preservation of prior credentials/state on failed replacement import, `unavailable` vs `expired` account states, cross-window `secrets.onDidChange` invalidation and account switching, post-submit/post-resume progress refresh, and full **OpenGUI (`lc.openGUI`) G1–G4 coverage**: single reusable `WebviewPanel` with one-time `webview.html` initialization (`htmlWriteCount === 1`), strict CSP and bundled asset loading, XSS escaping and zero secret exposure, allowlisted message validation and malformed payload rejection, Daily/catalog/local click-to-open, synchronized filters/chips/pagination, explicit selected solution target retention when webview/custom-input is focused, closed/missing target rejection without running another open file, realistic readonly-getter `TextDocument` reopening via `openProblem` and `openCode` at the `workspace.openTextDocument` boundary without mutating `TextDocument.isClosed`, duplicate request blocking while busy, pending result retrieval/clearing, Account actions (`openSignIn`, `checkSession`, `importSession`, `disconnect`), and Command Palette visibility rules.
  - `test/core.test.js` (14 passed, 1 skipped): covers fixed-origin HTTPS transport, CSRF headers, redirect rejection, error sanitization, C++ test/submit payloads, solution persistence, path-traversal and outside-file rejection (running unconditionally on Windows), pending-job lock and recovery across reloads/windows, timeout/cancellation preservation, HTML description sanitization, test vs submission verdict formatting, and `0.3.0` VSIX/source ZIP build and archive inspection (including `media/dashboard.css`, `media/dashboard.js`, `src/dashboard.js`, and CSS VSIX content type). The symlink-creation test (`linked files cannot be selected as solutions or inputs`) is explicitly skipped on this Windows host because unprivileged `fs.symlink` returns `EPERM`.
- **`scripts/check.js`**: Passed syntax verification (`node --check`) for all JS files in `src/`, `test/`, `scripts/`, and `media/`, verified that all 29 contributed commands in `package.json` (including `lc.openGUI`) are registered in `src/extension.js`, verified `contributes.menus.commandPalette` visibility rules, verified Activity Bar view container and `media/leetcode.svg` / `media/dashboard.css` / `media/dashboard.js` assets, and verified all allowlisted package paths.
- **`scripts/package.js`**: Built and verified `leetcode-inside-vscode-0.3.0.vsix` and `leetcode-inside-vscode-0.3.0-source.zip` using Node's built-in `zlib`, confirming forward-slash entry paths, CRC-32/size integrity, inclusion of all runtime/source allowlisted files (including dashboard source and media assets), and exclusion of `.git`, `dist`, and credential/environment files.

## Desktop Extension Development Host checks (partial — anonymous, no credentials used)

In an isolated VS Code Extension Development Host (**October 27, 2026**):

- [x] **OpenGUI launch & anonymous discovery**: Running **LeetCode: OpenGUI** (`lc.openGUI`) opens the dashboard and loads the **Daily Challenge** and **Browse Problems** catalog anonymously.
- [x] **Explore search**: Searching `two sum` in **Explore** filters and renders matching catalog results.
- [x] **Account navigation (`signed_out`)**: Switching to the **Account** destination renders the explicit `Signed out` state and controls without credentials.
- [x] **Problem description panel on Open**: Clicking **Open** on a problem opens the script-free problem description webview (`lc.problem`).
- [x] **Solution C++ editor and Open Code after fix**: After reloading the isolated Extension Development Host, Open Local on Two Sum opened its C++ editor beside the script-free description. Open Code then revealed the same solution without error. The readonly-property writes were removed by Antigravity and guarded by realistic getter-only document mocks.

## Remaining manual acceptance checks

Verify in desktop VS Code **1.93+**:

- [ ] Check repeated OpenGUI reveal and close/reopen in a desktop session (covered by automated lifecycle tests).
- [x] Moving focus back to the dashboard retained the displayed Two Sum target and file name. A narrow split editor wrapped controls correctly; ArrowRight moved from My Problems to Account; dashboard text and controls rendered in the default dark, Light Modern and Dark High Contrast themes. Unsaved-buffer execution remains verified with mocks only.
- [ ] In **Account**, click **Open LeetCode Sign-in** and confirm it opens the browser login page without claiming VS Code is connected.
- [ ] Connect a personal account via **Advanced: Import Session** (native masked input boxes); confirm both the dashboard and sidebar show `Verified: <username>` and unlock the **Account Progress** filter (`All`, `Solved`, `Attempted`, `Not started`).
- [ ] From the dashboard **Current Problem** bar, run examples, custom inputs, and an official submission; confirm unsaved editor changes are sent, the in-GUI result summary and **LeetCode Results** Output channel update, visible progress refreshes after submission, and the submission ID appears in your LeetCode submission history.
- [ ] Save code, close VS Code, disconnect network, reopen, and open the problem from **My Problems** (or sidebar **Local Problems**); confirm offline reopen preserves saved C++ code.
