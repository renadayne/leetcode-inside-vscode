# Verification record

Date: October 26, 2026.

## Live checks completed

Using the extension's actual HTTPS/GraphQL client, without credentials:

- `question(titleSlug: "two-sum")` returned displayed number `1`, internal ID `1`, the full description, the `Solution` C++ starter containing `twoSum`, and three example input pairs. `enableRunCode` was true.
- `questionList` search for `1` included an exact displayed-number match for `1` with slug `two-sum`.
- `npm run smoke:live` completed both checks successfully. An earlier search request failed transiently; the client surfaced a network error rather than returning fake data.

These read-only checks do not establish whether authenticated write endpoints will accept this client.

## Automated checks

18 automated tests passed, followed by the syntax/command registration check. The VSIX and source archives were built successfully and inspected for manifest/content consistency.

The included Node tests cover fixed HTTPS origin and CSRF headers; exact remote C++ request bodies; redirects, auth/challenge/rate-limit/network/protocol errors; C++ availability and premium access; solution preservation across store instances; rejection of outside and symlinked files; pending-ID recovery; uncertain POST behavior; duplicate prevention across windows; account matching; cancellation and timeout behavior; safe description rendering; and the difference between execution success and correctness.

Controller tests exercise commands with a VS Code API test double, including an unsaved editor snapshot while the user changes documents, internal question ID selection, offline reopen, custom input buffers, and credential connect/disconnect. Fake endpoints are used only in tests. Runtime code has no mock mode.

`npm run check` verifies syntax and contributed command registration. Archive checks inspect packaged manifests and included files. This environment has a `code` shim but no installed VS Code executable, so it cannot run an Extension Development Host or confirm VSIX installation/rendering.

## Required manual acceptance checks — not yet completed

Use a personal account and code that you choose to send. Do not share cookies or passwords with anyone.

- [ ] Install the supplied VSIX in desktop VS Code and confirm activation and commands.
- [ ] Connect through the masked cookie import; see a remotely verified account name.
- [ ] Open `1`; confirm the description appears beside the native C++ editor in light and dark themes.
- [ ] Write a correct C++ Two Sum solution, run examples, and inspect genuine actual/expected outputs in the Output panel.
- [ ] Edit custom input, return to the solution, run it, and confirm the returned result reflects that input.
- [ ] Try an incorrect solution and a compilation error; inspect genuine remote errors.
- [ ] Submit the intended current solution; record the genuine ID and verdict.
- [ ] Independently confirm that ID appears in the account's submission history. The extension itself does not implement history browsing in this version.
- [ ] Cancel polling, retrieve the pending result, and confirm no second submission was created.
- [ ] Reconnect after an expired session and retrieve a pending result with the same account.
- [ ] Save code, close VS Code, reopen, and use Reopen Local Problem. Confirm the saved edits remain.
- [ ] Disconnect the network; reopen cached problem and edit code. Confirm remote commands fail clearly without launching a local compiler.
- [ ] Repeat without a C++ compiler installed.

The full MVP definition of done remains unverified until these live checks pass. Remote run/submit handlers are implemented, but their authenticated behavior must not be represented as proven by the fixture-based tests.
