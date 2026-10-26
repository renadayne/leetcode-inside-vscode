# Security and trust model

The runtime has no third-party dependencies and no local execution path for C++. It uses Node HTTPS with TLS verification, a fixed leetcode.com origin, a path allowlist, no redirects, bounded responses, and request timeouts. It sends no background analytics or startup network requests. It does not read the clipboard, scan a workspace, or run shell commands.

An explicit remote command accepts only a solution registered in the extension's dedicated folder. It checks the regular file and rejects symlinks/outside paths before authenticating and sending the captured text. It never falls back to the last active file for a submission. Workspace configuration cannot redirect the solution folder or API origin.

Credentials are session cookies, never passwords. They are imported through masked fields and stored only in VS Code SecretStorage, never in configuration or solution metadata. Only known, controlled error messages are surfaced; arbitrary transport/GraphQL exception bodies are not logged. The account username, submitted source filename/hash/version, and remote judge output are not treated as secrets and appear in results/recovery metadata. LeetCode necessarily receives source explicitly sent for execution.

Descriptions use an HTML tag allowlist, strip remote attributes, images, scripts, links, and embedded content, and enforce a restrictive Content Security Policy. Webview scripting and command URIs are disabled. Complex math and remote diagrams therefore have rendering limitations.

Filesystem checks reduce accidental access; they do not sandbox VS Code extensions or defend against another process under your OS account deliberately modifying this extension's private files during an operation. The editor and other installed extensions share a trust boundary. Inspect the source and use an OS account and VS Code installation you trust.

Pending-write records prevent automatic re-submission after uncertain network failure. Polling failures preserve IDs. Cancellation stops polling, not remote execution. A manual clear explicitly warns that LeetCode may still have received the request.

Known external limitation: LeetCode can reject this client with anti-bot checks, expire sessions, or change its undocumented protocol. No bypass is attempted. Reconnect through the normal browser flow; if blocked, remote actions remain unavailable while cached reading/editing works.
