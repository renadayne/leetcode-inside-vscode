# LeetCode Inside VS Code

A small, inspectable VS Code extension for personal C++ practice on **leetcode.com**. It provides a native Activity Bar sidebar for anonymous problem discovery, the Daily Challenge, topic/difficulty filtering, local solution management, and LeetCode's remote interpreter and judge. It has **zero runtime npm dependencies** and does not invoke a local C++ compiler or create compilation artifacts.

**Status: 0.2.0 personal preview, not an end-to-end verified release.** Live anonymous retrieval of problem 1 (`two-sum`), filtered problem listings (`Array` + `Easy`, total `448`), the `75`-topic catalog (`questionTopicTags`), and the dated Daily Challenge (`2026-10-27` · `create-grid-with-exactly-one-path`) was verified on October 26–27, 2026. Authenticated progress, remote execution, official submission, submission-history visibility, and desktop VS Code Extension Host rendering still require manual verification with your own account. The API uses undocumented web endpoints and can be blocked by LeetCode browser verification. No mock result is used by the installed extension.

## Install locally

1. Extract the supplied bundle. In VS Code **1.93 or later**, run **Extensions: Install from VSIX…** from the Command Palette and select `leetcode-inside-vscode-0.2.0.vsix`.
2. Reload if VS Code requests it.
3. Click the **LeetCode** icon in the Activity Bar to open the sidebar.
4. Browse the **Daily Challenge** or **Browse Problems** (filter by search keyword, topics, or difficulty) and click any supported numbered problem to open its description beside a C++ editor.
5. To run remote tests, submit solutions, or filter by your account progress, connect your session in the **Account** section and use **Run Examples on LeetCode** or **Submit to LeetCode** above the solution editor. Results appear in the bottom **LeetCode Results** Output panel.

Alternatively, if the VS Code CLI is installed:

```sh
code --install-extension leetcode-inside-vscode-0.2.0.vsix
```

No Marketplace publication, Node installation, local compiler, build system, debugger, browser extension, or companion server is needed to use the packaged extension. Browser-only VS Code is not supported. C++ language tooling is optional for editor completion; it is not used for execution.

## Sidebar and everyday workflow

The **LeetCode** Activity Bar view requires no command-palette knowledge for normal discovery:

1. **Account**: Shows the exact session state (**Signed out**, **Session stored (unverified)**, **Verified: `<username>`**, **Session expired — reconnect needed**, or **Verification unavailable**) with clickable rows for **Open LeetCode Sign-in**, **Check Saved Session**, **Advanced: Import Session**, and **Disconnect Account**.
2. **Daily Challenge**: Displays the server-provided date (`YYYY-MM-DD`), problem number, title, difficulty, and verified progress when connected. If a subsequent refresh fails, the cached challenge is explicitly marked `(stale)` with its date and a retry row rather than being labeled "today".
3. **Browse Problems**: Clickable rows for **Search**, **Difficulty** (`Any`, `Easy`, `Medium`, `Hard`), **Topics** (multi-select up to 20 tags), **Progress** (`All`, `Solved`, `Attempted`, `Not started` — available only when a session is verified), **Clear Filters**, **Refresh Problem List**, and **Previous Page** / **Next Page** (50 problems per page). Nonnumeric problem IDs (such as regional `LCP` items) remain visible in the catalog so counts stay accurate and are labeled **Unsupported ID** for the numbered C++ workflow.
4. **Local Problems**: Lists saved solutions in your local extension storage, labeled **Available locally** (never claiming remote solved status). Clicking a local problem reopens its cached description and C++ file offline without overwriting your work.

Editor and remote actions:

- Clicking a problem row (or running **LeetCode: Open Problem**) opens a script-free HTML description beside a native C++ editor. Existing solution files are reopened without replacing their code. Remote images are omitted and LaTeX may remain as source text; problems that depend on diagrams may need the website.
- **Run Examples on LeetCode** sends the problem's supplied example test input to LeetCode's remote interpreter.
- **Edit Custom Test Input** creates a separate input file seeded with the examples. Use LeetCode's raw input syntax: one argument per line, then repeat arguments for more test cases. Return to the solution editor and choose **Run Custom Input**. Unsaved input edits are included.
- **Submit to LeetCode** sends an official submission for the selected solution. Verdict, runtime, memory, actual/expected output, compiler errors, and failing input are shown when LeetCode returns them. After a completed official submission (or resumed pending submission), visible sidebar progress refreshes automatically if the sidebar is active, without turning a refresh error into a submission failure. Running examples never marks a problem remotely solved.

Run and Submit capture the selected registered solution's text and editor version when invoked, including unsaved edits. Switching editors or typing during authentication/polling does not change that snapshot. **Use Ctrl+S / Cmd+S to save your code locally**; remote actions do not automatically save the editor buffer.

## Managed-device authentication boundary

This extension is designed to be safe for a managed computer. It avoids browser companion extensions, browser automation, cookie-database scraping, persistent local servers, unofficial proxies, and changes to device security settings. It does not claim that network activity is hidden from an employer or network monitoring.

Because LeetCode provides no public OAuth grant for this extension, opening the official login page in your browser cannot automatically grant VS Code access to browser cookies. **Automatic browser-to-VS Code session transfer is explicitly deferred** until a supported or organization-approved mechanism exists.

- **Anonymous discovery works immediately**: Daily Challenge, problem browsing, search, topic filters, difficulty filters, and opening free problems work without an account. Malformed or expired stored secrets do not block anonymous discovery.
- **Open LeetCode Sign-in**: Opens `https://leetcode.com/accounts/login/` in your default browser and returns immediately. It never prompts for cookies or marks VS Code connected.
- **Check Saved Session**: Verifies a previously stored session in VS Code **SecretStorage** against LeetCode (`isSignedIn === true` and a valid username).
- **Advanced: Import Session**: Fallback that prompts for `LEETCODE_SESSION` and `csrftoken` cookie values in separate masked fields:
  1. Sign in at `https://leetcode.com` in your browser.
  2. Open browser Developer Tools (**Application → Storage → Cookies → https://leetcode.com** in Chromium, or **Storage → Cookies** in Firefox).
  3. Copy only each cookie's value into its masked field. Never paste your password, and never paste cookies into chat, source files, settings, or a terminal.
  4. The extension verifies the session with LeetCode before storing it in **SecretStorage**. If verification of a replacement fails, your previous saved credentials and state are preserved.
- **Ambiguous errors vs expiry**: A network error, HTTP redirect, or HTTP 403 anti-bot challenge marks verification **unavailable** while preserving stored secrets. Only a positive authentication rejection (`HTTP 401` or `isSignedIn: false`) marks the session **expired**.
- **Disconnect Account**: Removes the saved session from VS Code and clears account-specific progress and filters. It does not log the browser out, revoke LeetCode's session, or cancel queued judge work.

## Pending operations and failures

Only one remote operation can be pending for this installation's solution directory, including across VS Code windows. Once a request is sent, the extension never automatically repeats it. Polling waits for up to two minutes, with a 20-second timeout per HTTP request.

If polling times out, the connection fails, you cancel waiting, or VS Code restarts, use **Retrieve Pending Result**. Cancellation stops waiting in VS Code; it cannot cancel LeetCode's judge. If a request might have reached LeetCode but no operation ID was received, check your LeetCode submission history before using **Clear Pending Operation**.

## Local files and privacy

Solutions live under this extension's VS Code global storage directory in `solutions/`, separate from your open workspace. **Open Local Solutions Folder** reveals it.

| File | Purpose |
| --- | --- |
| `1.two-sum.cpp` | Your saved C++ code |
| `1.two-sum.cpp.json` | Cached description, starter, metadata, and example input (remote solve status stripped) |
| `1.two-sum.cpp.input.txt` | Your optional custom test input |
| `pending.json` | Unfinished operation ID, account name, version, hash, and recovery metadata |
| `last-result.json` | Last completed LeetCode result |
| `completed-<uuid>.json` | Small completion marker preventing two windows from releasing the same pending record |

All extension HTTP requests go to **https://leetcode.com**, with redirects disabled. No requests run on startup activation. Credentials are excluded from local files and extension logs.

## Develop, inspect, and package

Open the source folder in VS Code and press **F5** to launch an Extension Development Host. No dependency installation or compile step is required. All checks and packaging run with **Node 20+** (`scripts/package.js` is a dependency-free Node packager):

```sh
npm test
npm run check
npm run smoke:live
npm run package
```

`npm test` uses deterministic fake LeetCode responses and a VS Code API test double. `smoke:live` makes read-only anonymous requests to LeetCode. `package` builds `dist/leetcode-inside-vscode-0.2.0.vsix` and `dist/leetcode-inside-vscode-0.2.0-source.zip` from an explicit file allowlist and verifies every archive entry.

Small modules keep the boundary easy to audit: `api.js` owns fixed-origin HTTPS and input/response validation; `discovery.js` owns filter/page/account state and request generations; `explorer.js` owns synchronous TreeView presentation; `store.js` owns local files; `jobs.js` owns pending-operation recovery; `render.js` owns description/results formatting; `extension.js` owns VS Code command and lifecycle integration.

See [VERIFICATION.md](VERIFICATION.md) for evidence and the remaining live acceptance checklist, and [SECURITY.md](SECURITY.md) for the trust model.

## References

- [VS Code Tree View API guide](https://code.visualstudio.com/api/extension-guides/tree-view)
- [VS Code SecretStorage API reference](https://code.visualstudio.com/api/references/vscode-api#SecretStorage)
- [VS Code webview security guidance](https://code.visualstudio.com/api/extension-guides/webview)
- [Installing a local VSIX](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace#_install-from-a-vsix)
