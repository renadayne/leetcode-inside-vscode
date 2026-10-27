# LeetCode explorer and account UX plan

Date: 2026-10-26. Baseline: `8217607` (0.1.0).
Workflow updated: 2026-10-27.

## Product outcome

Open a LeetCode sidebar, see the Daily Challenge, browse problems, filter by topic,
difficulty and account progress, and click a problem to work on it. Normal discovery
must not require knowing a problem number or running commands from the palette.

This installation is intended for a managed company computer. Avoid additional
browser extensions, browser automation, cookie-database access, persistent local
servers and changes to device security settings. Do not claim that activity is
hidden from an employer or network monitoring.

## Authentication decision and boundary

The requested ideal is browser login followed by explicit consent to connect VS
Code, without copying session cookies. No supported public LeetCode OAuth grant
for this extension has been established. Opening the official login page cannot
grant a VS Code extension access to browser cookies.

A Chromium companion could use the cookies API with explicit permissions, but
that is an additional security-sensitive component and is not selected for this
managed-computer deployment. Do not substitute password collection, headless login,
remote debugging, browser-profile scraping, injected scripts, an unofficial proxy,
or a fake OAuth flow.

Deliver now:

- Anonymous problem discovery, Daily and topic/difficulty filters.
- An account row with Open LeetCode Sign-in, Check Saved Session, and Disconnect.
- A clearly labeled Advanced: Import Session fallback using the existing masked
  fields and SecretStorage. Browser sign-in alone must never mark VS Code connected.
- Exact UI distinctions: signed out, saved but unverified, verified username,
  expired/reconnect needed, and unavailable due to a network/challenge error.
- Remote solved/attempted/not-started filters only when a session has been verified.
  When anonymous or offline, account progress is unknown, not "not started".
- Local files mean "available locally", not "solved on LeetCode".

Automatic session transfer remains explicitly deferred until a supported or
organization-approved mechanism is identified. This is a product limitation, not
an implemented automatic-login feature.

## Evidence and platform references

Anonymous requests through the existing HTTPS client were checked on 2026-10-26:

- `activeDailyCodingChallengeQuestion { date link question { questionId
  questionFrontendId title titleSlug difficulty status isPaidOnly topicTags { name
  slug } } }` returned the dated Daily Challenge.
- `questionList(categorySlug: "", limit: 2, skip: 0, filters: { tags: ["array"],
  difficulty: EASY })` returned a filtered list and total count.
- `questionTopicTags { edges { node { name slug } } }` returned 75 topics.
- The root `topicTags` query returned an empty list; do not use it as the catalog.
- Authenticated progress and run/submit have not been live verified.

References:

- https://code.visualstudio.com/api/extension-guides/tree-view
- https://code.visualstudio.com/api/references/vscode-api#SecretStorage
- https://developer.chrome.com/docs/extensions/reference/api/cookies
- https://developer.chrome.com/docs/extensions/reference/api/permissions

## Interaction design

Use a native VS Code TreeView in its own LeetCode Activity Bar container. Keep the
description webview script-free. Use standard icons, accessible labels and native
QuickPick/InputBox dialogs opened by sidebar actions; no command palette required.

The view contains:

1. **Account**: explicit state and clickable actions described above.
2. **Daily Challenge**: server-provided date, number, title, difficulty, account
   progress if verified, and click-to-open. A failed refresh must not call an old
   challenge "today"; expose its date/stale state or a retry row.
3. **Browse Problems**: visible filter summary and click actions for search, topics,
   difficulty, progress, clear filters, refresh and pagination. Problems show number,
   title, difficulty, premium lock and verified progress where known.
4. **Local Problems**: existing saved solutions, usable offline without overwrite.

Provide explicit loading, empty-result, network/challenge and retry states. Never
show an endless spinner or replace a failure with fabricated catalog entries.
Opening a premium problem must surface its access restriction and preserve files.

Filters: title/keyword search, multi-select topic slugs, Any/Easy/Medium/Hard,
All/Solved/Attempted/Not started. Retain non-sensitive preferences across restarts,
but reset invalid or account-only filters when the account becomes unavailable.
Pagination is bounded (e.g. 50/page), resets on filter changes, and cannot mix pages
from older requests with a new filter selection.

## Architecture and invariants

- `api.js`: fixed-origin HTTPS, GraphQL queries, validated catalog/topic/Daily models.
  Keep existing search callers compatible; factor shared parsing where useful.
- A discovery/controller module owns filters, page state, loading/error state and
  request generations. A TreeDataProvider owns presentation rather than network
  calls inside `getTreeItem`.
- Fetch on explicit sidebar use/refresh/filter actions. Do not introduce network
  requests just because the extension activates on startup.
- Cache only bounded in-memory catalog responses initially. Local problem storage
  remains the offline fallback. Persistent catalog caching is not required.
- Treat account verification and credentials as a separate state. Auth existence
  alone is not proof of a valid account. In-flight results carry an account/filter
  generation and cannot repopulate state after disconnect or account replacement.
- Clear account-specific catalog/progress on disconnect, reconnect and expiry.
  Ignore stale progress in previously cached local problem metadata.
- Preserve user code, dirty editor capture, internal question IDs, pending-job locks,
  no automatic resubmission, fixed LeetCode origin and sanitized remote error text.
- After a definitive completed official submission, refresh visible progress if
  possible without converting a successful submission into a failure when refresh
  fails. Running examples must not mark a problem remotely solved.
- Every disposable/event subscription is owned by the extension context.
- Do not log cookies, auth headers, raw transport exceptions or arbitrary API errors.

## Work packages and gates

### T1 — Discovery API and model

Owner: Antigravity via MCP. Scope: `api.js`, focused discovery API tests.

Implement paged filtered listing, topics, Daily, normalization and input/response
validation. Verify query variable mapping; reject malformed slugs, IDs, dates,
pagination values and responses. Keep search compatibility. Limit topic counts and
query lengths. Do not need actual user credentials to test.

Acceptance: deterministic tests cover correct requests, boundaries, unknown account
status, empty results, HTTP/GraphQL failures and malformed response data. Read-only
anonymous smoke can be run independently. Verify the delivered output and focused
test results before integrating it.

### T2 — Sidebar and discovery state

Owner: Antigravity via MCP. Scope: new provider/controller, `extension.js`, manifest,
icon assets and controller/UI tests.

Implement the native view and complete click-driven workflows described above.
Use one shared open-by-slug path for sidebar and the existing Open Problem command.
Protect against out-of-order responses; bound pages; never overwrite solutions.

Acceptance: tests exercise anonymous first use, filters and pagination, direct row
opening, Daily, offline local reopening, loading/empty/error/retry, and stale request
invalidation. Manifest contribution IDs and registered commands agree. Verify the
delivered behavior against T1 and the existing run/submit flows.

### T3 — Managed-device account UX and progress integration

Owner: Antigravity via MCP. Scope: account state and sidebar actions, focused tests.

Expose official browser sign-in and clearly separate advanced session import. Tie
progress filters to verified account identity; invalidate state on account changes
and refresh after completed official submissions. Handle expired sessions and
challenge/network failures without claiming the browser transferred credentials.

Acceptance: fake VS Code + transport tests cover saved-but-unverified state,
successful/failed import, preservation of previous credentials on failed replacement,
disconnect during delayed responses, account switch, expiry, and no secret leakage.
No browser companion or credential broker is added. Verify the security-sensitive
acceptance cases using the delivered tests and targeted checks.

### T4 — Packaging, documentation and release validation

Owner: Antigravity via MCP. Scope: README, SECURITY, VERIFICATION, CHANGELOG, version,
packaging/check scripts and any necessary targeted portability adjustments.

Document the real onboarding flow and the automatic-auth limitation. Package all
new source and icon assets in a 0.2.0 preview VSIX and source archive. Use a deliberate
allowlist so archives cannot accidentally include credentials or unrelated local
files. Exclude archives, build output and environment/credential files from Git.

The baseline has 17 passing tests and a symlink test blocked by Windows EPERM. Keep
path-traversal assertions independently executable; skip only unsupported symlink
creation with an explicit reason, not all filesystem security tests.

Acceptance: test suite and syntax/manifest checks pass (document platform skips);
anonymous discovery smoke uses the actual API and reports external failures honestly;
inspect VSIX manifest and asset inclusion. Verify the final delivered output.
Desktop/account acceptance remains marked unverified unless actually performed.

## Delegation and review workflow

Antigravity implements one package at a time in this project. It must not
delegate, access browser profiles/credentials, make real submissions, install into
the user's live VS Code, change device policy, or commit/push without a later brief.
Read completion output and inspect real files; CLI completion is not acceptance.

User correction on 2026-10-27: planning is complete. Antigravity owns implementation.
The current Sol session only verifies its returned output and runs necessary targeted
checks. Do not spawn review agents or repeat architecture reviews. Send a task back
to Antigravity only when verification identifies a concrete defect or unmet criterion.
Keep briefs, tool output and status polling concise.

After each small task passes output verification, the parent commits its scoped
changes and pushes `feat/problem-explorer` to GitHub before starting the next task.
Use clear conventional commit messages describing the delivered behavior. Never
commit a known incomplete or failing task as completed work. Keep unverified changes
out of the index when committing another completed task.

Work on a feature branch. Keep the initial release available. Do not claim the
unimplemented automatic-auth feature or unperformed desktop tests are complete.

### Sol architecture review requirements

Architecture review: GO for T1, with the following acceptance clarifications:

- Keep raw `ac` / `notac` / `null` separate from verified identity; unexpected status
  values are protocol failures, not guesses about user progress.
- Malformed/expired stored secrets must not prevent anonymous discovery.
- A network failure, anti-bot challenge, or generic redirect is not positive proof
  of expired credentials. Preserve secrets and display an unavailable state.
- Verify `isSignedIn === true` and a bounded, nonempty username. Do not enable
  account progress using a generic fallback username or truthy arbitrary data.
- Listen to `context.secrets.onDidChange` to invalidate verified identity and stale
  requests when another window replaces or disconnects the account.
- Keep nonnumeric frontend IDs explicit as unsupported for the current C++ workflow;
  do not silently drop them while retaining incorrect pagination/counts.
- Refresh progress after completed official submissions from both initial submission
  and pending-result resume, guarded by originating account and request generation.
- Test real calendar dates, malformed totals, bounded display text, and multi-topic
  filter mapping. Preserve existing search callers.
- Python is not on PATH in this environment. Packaging must be executable with the
  available toolchain or clearly document an actual prerequisite; prefer a small,
  inspectable Node-only packager if replacing the current Python-only build command.

## Progress

- [x] Baseline inspected and anonymous query feasibility checked.
- [x] Managed-device authentication boundary selected after user clarification.
- [x] Sol architecture review (GO with requirements recorded above).
- [x] T1 implemented; verification identified status normalization and unsupported-ID defects.
- [x] T1 verification defects corrected by Antigravity; 27 tests passed, baseline Windows symlink EPERM remains for T4. Live anonymous list/topics/Daily verified on 2026-10-27.
- [x] T2 implemented and output verified: 31 tests passed, baseline symlink EPERM remains; desktop rendering not yet verified.
- [x] T3 implemented and output verified: 35 tests passed, baseline symlink EPERM remains; browser sign-in/session import separation and account lifecycle regression cases covered.
- [x] T4 implemented and final output validation completed: 37 tests passed, 1 explicit Windows symlink skip, syntax/view/package checks passed, live anonymous smoke passed on 2026-10-27, and 0.2.0 VSIX/source ZIP built in dist. Desktop and authenticated account acceptance remain manual.

## Next phase: unified OpenGUI dashboard

Planned: 2026-10-27. Baseline: 0.2.0, `69e0108`.
Status: authorized; G1, G2, and G3 implemented.

### Outcome and scope

Run `LeetCode: OpenGUI` (`lc.openGUI`) once to open an editor tab containing a
click-driven dashboard. The current manifest exposes 28 commands; users should
not have to search that list to discover or operate the extension.

Use VS Code's built-in WebviewPanel with HTML, CSS and JavaScript bundled in the
extension. Updating this extension is sufficient: no additional extension,
framework, runtime installation, CDN, browser companion or local server is needed.
The dashboard uses existing API and controller capabilities. Automatic login and
browser-session transfer remain deferred under the authentication boundary above.

Platform reference: https://code.visualstudio.com/api/extension-guides/webview

### Interaction design

The dashboard has three destinations:

1. **Explore**: dated Daily Challenge; search by title/number; difficulty, multi-topic
   and verified-account progress filters; removable filter selections and reset;
   a paged problem list with number, title, difficulty, progress, premium/access
   indicators and an Open action.
2. **My Problems**: saved local solutions with open actions, usable offline. Local
   availability must remain distinct from remotely solved status.
3. **Account**: explicit connection state, official sign-in, check saved session,
   disconnect, and a separately labeled Advanced: Import Session action. Continue
   using native masked input dialogs for credentials; do not collect them in HTML.

A visible current-problem area identifies the selected problem and solution file,
with Open Code, View Description, Run Examples, Custom Input, Submit and Results.
Custom Input exposes editing and running the custom test. Less frequent actions,
including Retrieve Pending Result, Clear Pending Operation and Open Solutions
Folder, live under More Actions. Explain unavailable actions and how to enable
them; do not leave unexplained disabled buttons.

Opening the command again reveals the existing dashboard. Preserve non-sensitive
navigation/filter state when practical. Support VS Code light/dark/high-contrast
themes, keyboard navigation, accessible labels and narrow editor widths.
Show loading, empty, offline, expired-session, error and retry states explicitly.

Keep the sidebar available and synchronized. Hide internal button-only commands
from the Command Palette while preserving registered command IDs and useful direct
shortcuts. Opening GUI must not trigger a submission or account verification by itself.

### Architecture and invariants

- Add a dedicated dashboard panel/controller and bundled assets. Share discovery,
  account state and business actions with the existing sidebar; do not create an
  independent API client, duplicate catalog state or background polling loop.
- Load discovery on explicit GUI use and reuse existing in-memory state. Search
  on Enter or an explicit Search action; avoid a request on every keystroke.
- The dashboard must display and retain an explicit selected problem/file. Moving
  focus from a code editor to a webview must not change which solution Run/Submit
  targets. Revalidate the registered solution URI and read its current editor
  document, including unsaved changes, when an action executes. If no valid target
  exists, require selection instead of guessing from the active tab.
- Preserve existing pending-job locks, no automatic resubmission, no-overwrite
  storage behavior and account/request generation guards. Block duplicate actions
  while busy; completed submissions refresh shared progress without making a
  successful submission fail if the refresh fails.
- Route webview messages through a bounded, validated allowlist of actions and
  payloads. Never accept arbitrary command IDs, paths or URLs for execution.
- Keep credentials in extension-host SecretStorage. Send only presentation state
  to the webview, never cookies, CSRF tokens, auth headers or raw transport errors.
- Use a restrictive content security policy, bundled scripts/styles and restricted
  localResourceRoots. Render remote labels as text, not executable HTML. Keep
  enableCommandUris disabled and the existing description webview script-free.
- Dispose panel listeners/subscriptions correctly. Reopening or revealing the GUI
  must not accumulate event handlers, duplicate requests or restore stale account
  progress after disconnect/account replacement.

### Work packages and acceptance gates

Implement sequentially after a separate implementation instruction. Antigravity
owns implementation; the parent Sol session verifies returned output and performs
only necessary targeted checks. Do not spawn review agents or repeat architecture
reviews. Return work only for concrete defects or unmet acceptance criteria.
After each verified task, commit its scoped changes and push before starting the
next task. The commit subjects below are suggested professional messages.

#### G1 - Dashboard shell and action bridge

Scope: command/manifest registration, single-panel lifecycle, three destinations,
theme-aware bundled assets, loading/error presentation and validated message bridge.

Acceptance: OpenGUI opens or reveals one tab; closing/reopening works; unknown or
malformed actions are rejected; disposal does not leave duplicate handlers; the
GUI loads using only bundled resources. Cover lifecycle and message validation.

Commit: `feat: add unified LeetCode dashboard shell`

#### G2 - Problem discovery and local solutions

Scope: Daily, search, filters, pagination and local problem list wired to shared
discovery state and the existing open-by-slug/local-open flows.

Acceptance: anonymous users can select/open problems entirely by click; filters
and pages agree with the sidebar; delayed responses cannot overwrite newer state;
Daily errors retain explicit date/stale information; offline local reopening
preserves files. Test these transitions with deterministic fixtures.

Commit: `feat: add dashboard problem browsing and filters`

#### G3 - Current-problem actions and results

Scope: explicit problem/file selection; open code/description; examples, custom
input, submit, result display and pending-operation actions through shared logic.

Acceptance: after focus moves to the GUI, Run/Submit still uses the displayed
solution and its unsaved contents. Switching problems, closing editors or having
no valid target cannot run the wrong file. Duplicate requests remain blocked;
pending results can be retrieved without resubmission. Test with fake transport;
do not perform real account submissions without explicit authorization.

Commit: `feat: add dashboard solution actions and results`

#### G4 - Account controls and command discoverability

Scope: account destination, advanced import entry, contextual action availability,
More Actions and hiding internal-only entries from the Command Palette.

Acceptance: account changes update both surfaces and discard stale progress;
browser sign-in alone never implies connection; credentials never enter webview
state/messages; failed imports preserve previous credentials. Existing command
IDs and useful shortcuts remain functional, including editor Run/Submit actions.

Commit: `feat: unify dashboard account controls and command navigation`

#### G5 - Integration validation, documentation and packaging

Scope: necessary integration tests, actual desktop UX checks, README/CHANGELOG/
VERIFICATION updates and deliberate packaging allowlist updates for GUI assets.
Select the next version when preparing that release; do not bump it during planning.

Acceptance: tests and manifest/syntax checks pass; packaged VSIX includes all GUI
assets and no secrets/unrelated files. In an Extension Development Host, check
OpenGUI -> filter/select problem -> open code, repeated open/close, keyboard use,
themes and narrow layouts. Verify Run/Submit dispatch and unsaved-buffer handling
with mocks; report authenticated/live submission and desktop checks as unverified
unless actually performed. No installation into the user's live editor without
authorization. Do not expand this into another architecture review.

Commit: `build: package and document the LeetCode dashboard`

### Dashboard progress

- [x] Feasibility and interaction plan recorded; no extra installation required.
- [x] G1: dashboard shell and action bridge implemented (`lc.openGUI`, single-panel lifecycle, Explore/My Problems/Account navigation, bundled theme-aware assets, strict CSP/resource roots, validated message bridge, loading/error states, and focused tests: 40 passed, 1 Windows symlink skip).
- [x] G2: discovery and local solutions implemented (Daily/catalog/local click-to-open via shared flows, Enter/button search, difficulty/multi-topic/verified-progress filters, removable filter chips and reset, pagination, stale-response and Daily date/stale guards, non-destructive filter input/focus updates, and focused tests: 42 passed, 1 Windows symlink skip).
- [x] G3: current-problem actions and results implemented (explicit selected solution/URI retention across webview/custom-input focus, unsaved C++ and custom-input capture at action start, closed/missing target rejection, Open Code/View Description/Run Examples/Edit & Run Custom Input/Submit/Results/Retrieve & Clear Pending/Open Solutions Folder via shared flows, busy duplicate prevention, in-GUI result summary and pending banner, and focused tests: 44 passed, 1 Windows symlink skip).
- [ ] G4: account controls and command discoverability.
- [ ] G5: integration validation, documentation and packaging.
