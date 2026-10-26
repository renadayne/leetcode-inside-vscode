'use strict';

const { randomBytes } = require('node:crypto');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// Content-only allowlist. No remote attributes, links, images, SVG, scripts, styles,
// forms, or command URIs reach the webview. Text entities remain text in HTML.
function sanitize(html) {
  const allowed = new Set('p div span br hr strong b em i u s sub sup pre code ul ol li blockquote h1 h2 h3 h4 h5 h6 table thead tbody tfoot tr th td caption dl dt dd'.split(' '));
  return String(html)
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<(script|style|iframe|object|svg|math|template)\b[^>]*>[^]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>|</g, tag => {
      const match = /^<(\/?)([a-z0-9]+)\b[^>]*>$/i.exec(tag);
      if (!match || !allowed.has(match[2].toLowerCase())) return tag === '<' ? '&lt;' : '';
      return `<${match[1]}${match[2].toLowerCase()}>`;
    });
}

function description(q) {
  const nonce = randomBytes(16).toString('hex');
  const tags = (q.topicTags || []).map(t => escape(t.name)).join(' · ');
  return `<!doctype html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; img-src 'none'; form-action 'none'; base-uri 'none';">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style nonce="${nonce}">
      body { color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font: var(--vscode-font-size)/1.65 var(--vscode-font-family); padding: 20px 26px 48px; max-width: 880px; margin: auto; }
      h1 { font-size: 1.65em; line-height: 1.3; } .meta, .note { color: var(--vscode-descriptionForeground); } .meta { margin-bottom: 25px; }
      code, pre { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); } code { padding: 1px 4px; border-radius: 3px; }
      pre { white-space: pre-wrap; padding: 14px; overflow-wrap: anywhere; border-left: 3px solid var(--vscode-textBlockQuote-border); }
      table { border-collapse: collapse; display: block; overflow-x: auto; } td, th { border: 1px solid var(--vscode-panel-border); padding: 6px 10px; }
      blockquote { margin-left: 0; border-left: 3px solid var(--vscode-textBlockQuote-border); padding-left: 14px; }
    </style></head><body>
    <h1>${escape(q.questionFrontendId)}. ${escape(q.title)}</h1>
    <div class="meta">${escape(q.difficulty)} · ${escape(q.status === 'ac' ? 'Solved' : q.status === 'notac' ? 'Attempted' : 'Status unavailable / unsolved')}<br>${tags}</div>
    <main>${sanitize(q.content)}</main>
    <hr><p class="note">Run Examples and Submit are available above the C++ editor or in the Command Palette. Execution happens on LeetCode. Remote images are omitted; LaTeX may appear as source text.</p>
    </body></html>`;
}

const VERDICTS = { 10:'Accepted', 11:'Wrong Answer', 12:'Memory Limit Exceeded', 13:'Output Limit Exceeded', 14:'Time Limit Exceeded', 15:'Runtime Error', 16:'Internal Error', 20:'Compilation Error' };
function formatResult({ job, result: r }) {
  // Test status 10 only means execution completed; correct_answer is the judge's
  // comparison and may be false (or unavailable for custom inputs).
  let verdict = r.status_msg || VERDICTS[r.status_code] || 'Unknown verdict';
  if (job.kind === 'test' && Number(r.status_code) === 10) verdict = r.correct_answer === true ? 'Passed' : r.correct_answer === false ? 'Wrong Answer' : 'Execution completed (comparison unavailable)';
  const lines = [job.kind === 'submit' ? 'OFFICIAL LEETCODE SUBMISSION' : 'LEETCODE REMOTE TEST — not an official submission',
    `${job.number}. ${job.title}`, `Verdict: ${verdict}`, `Operation: ${job.id}`, `Account: ${job.user}`,
    `Source: ${job.file}`, `Editor version: ${job.version} · SHA-256: ${job.hash}`, `Sent: ${job.startedAt}`];
  const fields = [ ['Runtime', r.status_runtime], ['Memory', r.status_memory ?? (typeof r.memory === 'number' ? `${r.memory} bytes` : undefined)],
    ['Passed', r.total_correct != null && r.total_testcases != null ? `${r.total_correct}/${r.total_testcases}` : undefined],
    ['Actual output', r.code_answer ?? r.output], ['Expected output', r.expected_code_answer ?? r.expected_output],
    ['Failing input', r.last_testcase ?? r.input_formatted ?? r.input], ['Compilation error', r.full_compile_error ?? r.compile_error],
    ['Runtime error', r.full_runtime_error ?? r.runtime_error], ['Standard output', r.std_output ?? r.code_output] ];
  for (const [label, value] of fields) if (value !== undefined && value !== null && value !== '') lines.push(`\n${label}:\n${Array.isArray(value) ? value.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join('\n') : typeof value === 'string' ? value : JSON.stringify(value)}`);
  return lines.join('\n') + '\n';
}

module.exports = { escape, sanitize, description, formatResult };
