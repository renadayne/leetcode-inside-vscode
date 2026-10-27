# Security and trust model

The runtime has no third-party dependencies and no local execution path for C++. It uses Node HTTPS with TLS verification, a fixed `https://leetcode.com` origin, a strict path allowlist, no redirects, bounded responses, and request timeouts. It sends no background analytics and makes no network requests on startup activation. It does not read the clipboard, scan a workspace, run shell commands, install browser companions, automate browsers, scrape browser cookie databases, or run a local server.

## Managed-device authentication boundary

No supported public LeetCode OAuth flow is available for this extension, and opening `https://leetcode.com/accounts/login/` in the system browser cannot transfer browser cookies to VS Code. Automatic session transfer is explicitly deferred rather than substituted with password collection, headless login, remote debugging, browser-profile access, or an unofficial proxy. Do not treat extension activity as hidden from enterprise endpoint or network monitoring.

- **Anonymous discovery isolation**: Problem browsing, search, topic tags, difficulty filters, Daily Challenge, and free problem opening run anonymously until a session is explicitly verified. Malformed or expired secrets in `SecretStorage` cannot block anonymous discovery.
- **Explicit session verification**: Credentials (`LEETCODE_SESSION` and `csrftoken` cookie values) are entered only through the separate **Advanced: Import Session** masked fields and stored in VS Code `SecretStorage` only after `userStatus` confirms `isSignedIn === true` and a bounded non-empty username. Failed replacement imports preserve existing stored credentials and state.
- **Ambiguous failures vs positive expiry**: Network errors, HTTP redirects, and HTTP 403 anti-bot challenges transition account status to **Verification unavailable** while preserving stored secrets. Positive authentication rejection (`HTTP 401` or `isSignedIn: false`) transitions the session to **expired** and clears verified progress state.
- **Generation and cross-window guards**: `DiscoveryState` and `extension.js` track account and request generations and subscribe to `context.secrets.onDidChange`. Delayed responses from prior filters or accounts are discarded, in-flight writes abort if the account changes during verification, and cached local `.cpp.json` metadata strips remote progress so another account's solved state is never shown.

## Local file and webview boundaries

An explicit remote command accepts only a solution registered in the extension's dedicated global-storage folder (`solutions/`). It validates numbered problem filenames, checks regular files, and rejects path traversal, outside paths, and symbolic links before authenticating and sending the captured editor snapshot. It never falls back to an unrelated active editor.

Only controlled `LcError` messages are surfaced; raw transport/GraphQL exception bodies, cookies, and headers are never logged. The verified username, submitted filename/hash/version, and remote judge output appear in results and recovery metadata.

Problem descriptions (`lc.problem`) use an HTML tag allowlist, strip all attributes, remote images, scripts, links, and embedded content, and enforce a strict Content Security Policy (`default-src 'none'; style-src 'nonce-...'`). Webview scripting and command URIs are disabled (`enableScripts: false`, `enableCommandUris: false`, `localResourceRoots: []`).

The unified **LeetCode: OpenGUI** dashboard (`lc.dashboard`) restricts `localResourceRoots` to the extension's bundled `media/` directory, keeps `enableCommandUris: false`, and enforces a nonce-based Content Security Policy (`default-src 'none'; style-src <cspSource>; script-src 'nonce-...'; img-src 'none'; font-src 'none'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`). Untrusted problem titles and metadata are escaped on initial render and updated via DOM `textContent`. All webview-to-host messages pass through `validateDashboardMessage` (`src/dashboard.js`), which enforces a strict action/payload allowlist and rejects prototype pollution keys, arbitrary command IDs, file paths, URLs, and credential fields. Credentials remain exclusively in extension-host `SecretStorage` (entered only through native masked VS Code input boxes) and are never included in dashboard state or messages. Moving focus to the dashboard webview never changes which registered C++ file **Run** or **Submit** targets; the selected solution URI and open editor document are revalidated before capturing code.

Pending-write records prevent automatic re-submission after uncertain network failure. Polling failures preserve operation IDs for manual recovery.

Packaging (`scripts/package.js` and `scripts/package.py`) uses a deliberate file allowlist with forward-slash ZIP paths and read-back verification so `.git`, `dist`, `node_modules`, environment files, logs, and credentials cannot be bundled into release archives.
