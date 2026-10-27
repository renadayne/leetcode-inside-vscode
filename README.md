# LeetCode Inside VS Code

A small, inspectable VS Code extension for personal C++ practice on **leetcode.com**. Run **LeetCode: OpenGUI** (`lc.openGUI`) once to open a unified, click-driven dashboard tab for anonymous problem discovery, the Daily Challenge, search and multi-topic/difficulty/progress filtering, local C++ solution management, account connection, and LeetCode's remote interpreter and judge—alongside a synchronized Activity Bar sidebar. It has **zero runtime npm dependencies** and does not invoke a local C++ compiler or create compilation artifacts.

**Status: 0.3.0 personal preview, not an end-to-end verified release.** Live anonymous retrieval of problem 1 (`two-sum`), filtered problem listings (`Array` + `Easy`, total `448`), the `75`-topic catalog (`questionTopicTags`), and the dated Daily Challenge (`2026-10-27` · `create-grid-with-exactly-one-path`) was verified on October 26–27, 2026. Authenticated progress, remote execution, official submission, submission-history visibility, and desktop VS Code Extension Host rendering still require manual verification with your own account. The API uses undocumented web endpoints and can be blocked by LeetCode browser verification. No mock result is used by the installed extension.

## Install locally

1. Extract the supplied bundle. In VS Code **1.93 or later**, run **Extensions: Install from VSIX…** from the Command Palette and select `leetcode-inside-vscode-0.3.0.vsix`.
2. Reload if VS Code requests it.
3. Run **LeetCode: OpenGUI** from the Command Palette (or click the **LeetCode** icon in the Activity Bar) to open the unified dashboard tab.
4. In the **Explore** tab, browse the dated **Daily Challenge** or filter the catalog by title/number, difficulty, and topics, then click **Open** on any supported numbered problem to open its description beside a C++ editor.
5. In the **Current Problem** bar at the top of the dashboard (or above the C++ editor), use **Run Examples**, **Edit Custom Input** / **Run Custom Input**, or **Submit** once you have connected your account in the **Account** tab. Summary verdicts appear directly in the dashboard and full output appears in the **LeetCode Results** Output panel.

Alternatively, if the VS Code CLI is installed:

```sh
code --install-extension leetcode-inside-vscode-0.3.0.vsix
```

No Marketplace publication, Node installation, local compiler, build system, debugger, browser extension, or companion server is needed to use the packaged extension. Browser-only VS Code is not supported. C++ language tooling is optional for editor completion; it is not used for execution.

## Unified OpenGUI dashboard and synchronized sidebar

Running **LeetCode: OpenGUI** (`lc.openGUI`) opens—or reveals if already open—a single reusable dashboard tab backed by bundled local HTML/CSS/JS assets and shared state with the **LeetCode** Activity Bar sidebar:

- **Current Problem bar**: Explicitly identifies the selected problem and local C++ filename (including unsaved-edit and closed-editor indicators). Moving focus from the C++ editor to the dashboard webview or custom input file never changes which solution **Run Examples**, **Run Custom Input**, or **Submit** targets. Provides **Open Code**, **View Description**, **Run Examples**, **Edit Custom Input**, **Run Custom Input**, **Submit**, **Results**, and under **More Actions**: **Retrieve Pending Result**, **Clear Pending Operation**, and **Open Solutions Folder**, plus an in-GUI latest result summary and pending-operation banner.
- **Explore tab**:
  - **Daily Challenge**: Displays the server-provided date (`YYYY-MM-DD`), problem number, title, difficulty, and verified progress when connected. If a subsequent refresh fails, the cached challenge is explicitly marked `(stale)` with its date and a retry button rather than being labeled "today".
  - **Browse Problems**: Search by title or problem number on `Enter` or **Search**; filter by **Difficulty** (`Any`, `Easy`, `Medium`, `Hard`), **Topics** (multi-select up to 20 tags), and **Account Progress** (`All`, `Solved`, `Attempted`, `Not started` — enabled when verified); remove individual filter chips or **Clear Filters**; and page through 50 problems per page. Nonnumeric problem IDs (such as regional `LCP` items) remain visible so counts stay accurate and are labeled **Unsupported ID**.
- **My Problems tab**: Lists saved C++ solutions in local extension storage, labeled **Available locally** (kept distinct from remotely solved status). Clicking **Open Local** reopens the cached description and C++ file offline without overwriting your work.
- **Account tab**: Shows the exact session state (**Signed out**, **Session stored (unverified)**, **Verified: `<username>`**, **Session expired — reconnect needed**, or **Verification unavailable**) with contextual guidance, **Open LeetCode Sign-in**, **Check Saved Session**, **Disconnect Account**, and a separately labeled **Advanced: Import Session** section that launches VS Code's native masked input boxes. Credentials are never entered or stored in webview HTML.

Internal button-only tree/filter/pagination commands are hidden from the Command Palette so the palette stays focused on **LeetCode: OpenGUI** and direct actions (**Open Problem**, **Reopen Local Problem**, **Run Examples**, **Submit**, **Edit/Run Custom Input**, **Show Problem Description**, **Retrieve/Clear Pending**, **Show Results**, **Open Local Solutions Folder**, **Connect/Disconnect Account**).

Editor and remote actions:

- Clicking **Open** on a problem (or running **LeetCode: Open Problem**) opens a script-free HTML description beside a native C++ editor. Existing solution files are reopened without replacing their code. Remote images are omitted and LaTeX may remain as source text; problems that depend on diagrams may need the website.
- **Run Examples** sends the problem's supplied example test input to LeetCode's remote interpreter.
- **Edit Custom Test Input** creates a separate input file seeded with the examples. Use LeetCode's raw input syntax: one argument per line, then repeat arguments for more test cases. Unsaved input edits are included when running **Run Custom Input**.
- **Submit** sends an official submission for the selected solution. Verdict, runtime, memory, actual/expected output, compiler errors, and failing input are shown in the dashboard summary and Output panel when LeetCode returns them. After a completed official submission (or resumed pending submission), visible progress in both the dashboard and sidebar refreshes automatically without turning a refresh error into a submission failure. Running examples never marks a problem remotely solved.

Run and Submit capture the selected registered solution's text and editor version when invoked, including unsaved edits. Switching editors or typing during authentication/polling does not change that snapshot. If the selected solution editor was closed, **Run**/**Submit** require reopening it via **Open Code** rather than guessing another open tab. **Use Ctrl+S / Cmd+S to save your code locally**; remote actions do not automatically save the editor buffer.

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

`npm test` uses deterministic fake LeetCode responses and a VS Code API test double. `smoke:live` makes read-only anonymous requests to LeetCode. `package` builds `dist/leetcode-inside-vscode-0.3.0.vsix` and `dist/leetcode-inside-vscode-0.3.0-source.zip` from an explicit file allowlist and verifies every archive entry.

Small modules keep the boundary easy to audit: `api.js` owns fixed-origin HTTPS and input/response validation; `discovery.js` owns filter/page/account state and request generations; `explorer.js` owns synchronous TreeView presentation; `dashboard.js` and `media/dashboard.{css,js}` own the unified `lc.openGUI` webview controller and strict allowlisted message bridge; `store.js` owns local files; `jobs.js` owns pending-operation recovery; `render.js` owns description/results formatting; `extension.js` owns VS Code command, target-selection, and lifecycle integration.

See [VERIFICATION.md](VERIFICATION.md) for evidence and the remaining live acceptance checklist, and [SECURITY.md](SECURITY.md) for the trust model.

## References

- [VS Code Tree View API guide](https://code.visualstudio.com/api/extension-guides/tree-view)
- [VS Code SecretStorage API reference](https://code.visualstudio.com/api/references/vscode-api#SecretStorage)
- [VS Code webview security guidance](https://code.visualstudio.com/api/extension-guides/webview)
- [Installing a local VSIX](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace#_install-from-a-vsix)
