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
- [ ] T2 implemented and output verified.
- [ ] T3 implemented and output verified.
- [ ] T4 implemented and final output validation completed.
