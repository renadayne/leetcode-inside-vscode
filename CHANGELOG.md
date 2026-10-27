# Changelog

## 0.2.0 — 2026-10-27

- Added a native **LeetCode** Activity Bar container and sidebar (`TreeDataProvider`) with **Account**, **Daily Challenge**, **Browse Problems**, and **Local Problems** sections for click-driven problem discovery without requiring command-palette workflows.
- Extended the fixed-origin GraphQL client (`src/api.js`) with validated paginated filtered problem listing (`listProblems`), `75`-topic catalog (`topics` via `questionTopicTags`), and dated Daily Challenge (`daily` via `activeDailyCodingChallengeQuestion`), while preserving existing `search`, `problem`, `run`, and `submit` contracts.
- Added bounded search, multi-topic, difficulty, and verified-only account progress filters (`src/discovery.js`, `src/explorer.js`) with request/account generation guards against out-of-order responses, explicit `Unsupported ID` labeling for nonnumeric frontend IDs, and stale-date preservation on failed Daily Challenge refreshes.
- Updated account UX for managed devices: separated **Open LeetCode Sign-in** (browser sign-in, no automatic cookie transfer) from **Advanced: Import Session** (masked `SecretStorage` import), added explicit `Signed out` / `Session stored (unverified)` / `Verified` / `Session expired` / `Verification unavailable` states, subscribed to `secrets.onDidChange`, and refreshed visible progress after completed official submissions and resumed pending submissions.
- Added dependency-free Node packaging (`scripts/package.js`) with an explicit allowlist and archive verification, split Windows `EPERM` symlink creation from unconditional path-traversal tests, and expanded automated test coverage to 38 tests (37 passing, 1 Windows symlink `EPERM` skip).

## 0.1.0 — 2026-10-26

Initial personal preview: masked session-cookie import using SecretStorage, numbered/slug/title problem discovery, cached script-free descriptions, preserved C++ solutions, LeetCode remote example/custom tests and official submission requests, bottom-panel results, and persistent pending-operation recovery. No local compiler or runtime npm dependencies. Live anonymous problem retrieval verified; authenticated judging and desktop extension-host acceptance checks remain outstanding.
