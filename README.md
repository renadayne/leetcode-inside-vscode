# LeetCode Inside VS Code

A small, inspectable VS Code extension for personal C++ practice on **leetcode.com**. It uses LeetCode's remote interpreter for tests and remote judge for submissions. It has **zero runtime npm dependencies** and does not invoke a C++ compiler or create compilation artifacts.

**Status: personal preview, not an end-to-end verified release.** Live anonymous retrieval of problem 1, its description, C++ starter, and sample inputs was verified on October 26, 2026. Authentication, remote execution, official submission, and submission-history visibility still require verification with your own account. The API uses undocumented web endpoints and can be blocked by LeetCode browser verification. No mock result is used by the installed extension.

## Install locally

1. Extract the supplied bundle. In VS Code **1.93 or later**, run **Extensions: Install from VSIX…** from the Command Palette and select `leetcode-inside-vscode-0.1.0.vsix`.
2. Reload if VS Code requests it.
3. Run **LeetCode: Connect Account**.
4. Run **LeetCode: Open Problem**, enter `1`, and write your C++ solution.
5. Use **Run Examples on LeetCode** or **Submit to LeetCode** above the solution editor. Results appear in the bottom **LeetCode Results** Output panel.

Alternatively, if the VS Code CLI is installed:

```sh
code --install-extension leetcode-inside-vscode-0.1.0.vsix
```

No Marketplace publication, Node installation, local compiler, build system, debugger, or companion server is needed to use the packaged extension. Browser-only VS Code is not supported. C++ language tooling is optional for editor completion; it is not used for execution.

## Connect an account without a password

LeetCode has no supported OAuth integration used by this project. This version imports an existing browser session:

1. Sign in normally at `https://leetcode.com` in your browser. Complete any account or browser verification there.
2. Open browser Developer Tools. In Chromium: **Application → Storage → Cookies → https://leetcode.com**. In Firefox: **Storage → Cookies**.
3. Locate the `LEETCODE_SESSION` and `csrftoken` cookies.
4. Run **LeetCode: Connect Account** and paste only each cookie's value into its separate masked field. Keep these credentials private; do not paste them into chat, source files, settings, or a terminal.

The extension verifies the session with LeetCode before saving it in VS Code **SecretStorage**. Existing credentials are retained if a replacement cannot be verified. The status bar shows the account after verification. After restart it says **Session stored** until checked; it does not claim that an unverified stored session is valid. **Check Account Status** revalidates it. Each remote action checks the account before sending source code.

**Disconnect Account** deletes the saved session from VS Code. It does not log the browser out, revoke LeetCode's session, or cancel already queued work. Manage account sessions on LeetCode if revocation is needed.

If LeetCode responds with a challenge or HTTP 403, complete verification in the browser and reconnect. Cookie import may still be insufficient for an anti-bot challenge tied to a browser. The extension reports that block; it does not bypass verification or switch to local execution. Reading cached problems and editing saved solutions remain available.

## Everyday workflow

- **Open Problem** accepts a number, slug, exact title, or search keyword. Search is paged, 50 results at a time. Numeric lookup matches the displayed problem number; remote actions use LeetCode's separate internal question ID.
- The description opens beside a native C++ editor. Existing solution files are reopened without replacing their code. Examples, constraints, tables, and code formatting are retained. HTML is reduced to a content allowlist in a script-free webview. Remote images are omitted and LaTeX may remain as source text; problems that depend on diagrams or advanced rendering may need the website.
- **Run Examples on LeetCode** sends the problem's supplied example test input to LeetCode's remote interpreter. If only one sample is exposed, only that sample runs.
- **Edit Custom Test Input** creates a separate input file seeded with the examples. Use LeetCode's raw input syntax: one argument per line, then repeat arguments for more test cases. For Two Sum: `[2,7,11,15]`, newline, `9`. Return to the solution editor and choose **Run Custom Input**. Unsaved input edits are included.
- **Submit to LeetCode** sends an official submission for the selected solution. Verdict, runtime, memory, actual/expected output, compiler errors, and failing input are shown when LeetCode returns them. An execution that merely completes is not labeled Accepted when correctness is unavailable.
- **Reopen Local Problem** works offline, including the cached description. **Show Results** restores the last completed result after restarting VS Code. **Show Problem Description** reopens it without replacing solution code.

Run and Submit capture the selected registered solution's text and editor version when invoked, including unsaved edits. Switching editors or typing during authentication/polling does not change that snapshot. The result includes its SHA-256 hash and version, so it is clear which version ran. Further edits need a new explicit action. **Use Ctrl+S / Cmd+S to save your code locally**; remote actions do not automatically save the editor buffer.

## Pending operations and failures

Only one remote operation can be pending for this installation's solution directory, including across VS Code windows. Once a request is sent, the extension never automatically repeats it. Polling waits for up to two minutes, with a 20-second timeout per HTTP request.

If polling times out, the connection fails, you cancel waiting, or VS Code restarts, use **Retrieve Pending Result**. Cancellation stops waiting in VS Code; it cannot cancel LeetCode's judge. Reconnect the same account if the session expires.

If a request might have reached LeetCode but no operation ID was received, the record remains pending. Check your LeetCode submission history before using **Clear Pending Operation**. This exceptional recovery can require the website. Clearing the record cannot cancel or prove the absence of a submission; sending again may create a duplicate. A definite HTTP rejection permits retrying after the cause is fixed. API schema changes fail explicitly instead of inventing results.

## Local files and privacy

Solutions live under this extension's VS Code global storage directory in `solutions/`, separate from your open workspace. **Open Local Solutions Folder** reveals it. In Remote/WSL/Codespaces sessions, this extension prefers the local UI host, so its files belong to that host.

Files include:

| File | Purpose |
| --- | --- |
| `1.two-sum.cpp` | Your saved C++ code |
| `1.two-sum.cpp.json` | Cached description, starter, metadata, and example input |
| `1.two-sum.cpp.input.txt` | Your optional custom test input |
| `pending.json` | Unfinished operation ID, account name, version, hash, and recovery metadata |
| `last-result.json` | Last completed LeetCode result |
| `completed-<uuid>.json` | Small completion marker preventing two windows from releasing the same pending record |

There is no workspace scan, telemetry, analytics, password collection, clipboard reading, automatic submission, or third-party service. All extension HTTP requests go to **https://leetcode.com**, with redirects disabled. Browser sign-in opens only when you choose it. No requests run at startup. Problem discovery sends search terms; run/submit sends only the selected registered solution and test input. Source code is held in memory for the request; recovery metadata stores a hash, not another copy of the source. Remote error/output text can contain parts of your submitted code, as returned by LeetCode. Credentials are excluded from these files and the extension's logs.

Keep a backup of the solutions folder; VS Code global storage is not cloud backup. Uninstalling or clearing VS Code data may remove extension data. Normal solution persistence was checked with filesystem and controller tests; desktop restart behavior remains on the manual checklist.

## Develop, inspect, and package

Open the source folder in VS Code and press **F5** to launch an Extension Development Host. No dependency installation or compile step is required. For checks use **Node 20+**, and for packaging use Python 3:

```sh
npm test
npm run check
npm run smoke:live
npm run package
```

`npm test` uses deterministic fake LeetCode responses and a VS Code API test double. These are isolated test fixtures and cannot validate a real account. `smoke:live` makes read-only anonymous requests to LeetCode. `package` builds a VSIX and source ZIP in `dist/`, without contacting or publishing to the Marketplace. The packaging script creates the standard VSIX ZIP/manifest structure using Python's standard library; installation must still be checked in desktop VS Code.

Small modules keep the boundary easy to audit: `api.js` owns fixed-origin HTTP and response validation; `store.js` owns local files; `jobs.js` owns pending-operation recovery; `render.js` owns description/results formatting; `extension.js` owns VS Code interactions. No local C++ execution path exists.

See [VERIFICATION.md](VERIFICATION.md) for evidence and the remaining live acceptance checklist, and [SECURITY.md](SECURITY.md) for the trust model.

## References

- [VS Code SecretStorage guidance](https://code.visualstudio.com/api/advanced-topics/remote-extensions)
- [VS Code webview security guidance](https://code.visualstudio.com/api/extension-guides/webview)
- [Installing a local VSIX](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace#_install-from-a-vsix)
- [Community-maintained API schema used as protocol reference](https://github.com/fspv/leetcode-swagger/blob/master/swagger.yml) — not an official LeetCode API contract.
