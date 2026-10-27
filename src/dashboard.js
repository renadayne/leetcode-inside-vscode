'use strict';

const path = require('node:path');
const { randomBytes } = require('node:crypto');
const {
  LcError,
  MAX_QUERY_LENGTH,
  MAX_TOPIC_FILTERS
} = require('./api');
const {
  VALID_DIFFICULTIES,
  VALID_STATUSES
} = require('./discovery');
const { escape } = require('./render');
const {
  boundText,
  formatAccountSummary,
  formatFilterSummary
} = require('./explorer');

const DASHBOARD_VIEW_TYPE = 'lc.dashboard';
const VALID_DESTINATIONS = new Set(['explore', 'local', 'account']);
const VALID_REFRESH_TARGETS = new Set(['all', 'daily', 'catalog', 'local', 'topics']);
const VALID_REMOVE_FILTER_KINDS = new Set(['query', 'difficulty', 'status', 'tag']);
const G1_ACTIVE_ACTIONS = new Set([
  'ready',
  'navigate',
  'refresh',
  'dismissNotice',
  'openProblem',
  'openLocal',
  'setFilters',
  'setSearch',
  'setDifficulty',
  'setTopics',
  'setStatus',
  'toggleTopic',
  'removeFilter',
  'clearFilters',
  'loadTopics',
  'changePage',
  'problemAction',
  'accountAction'
]);
const PLANNED_ACTIONS = new Set([]);
const VALID_PROBLEM_ACTIONS = new Set([
  'openCode',
  'description',
  'run',
  'customInput',
  'runCustom',
  'submit',
  'results',
  'resume',
  'clearPending',
  'folder'
]);
const VALID_ACCOUNT_ACTIONS = new Set([
  'openSignIn',
  'checkSession',
  'importSession',
  'disconnect'
]);
const FORBIDDEN_MESSAGE_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'command',
  'commandId',
  'uri',
  'url',
  'path',
  'fsPath',
  'html',
  'script',
  'auth',
  'session',
  'csrf',
  'cookie',
  'token',
  'secret'
]);

const STATUS_LABELS = {
  ALL: 'All',
  AC: 'Solved',
  TRIED: 'Attempted',
  NOT_STARTED: 'Not started'
};

const VERDICTS = {
  10: 'Accepted',
  11: 'Wrong Answer',
  12: 'Memory Limit Exceeded',
  13: 'Output Limit Exceeded',
  14: 'Time Limit Exceeded',
  15: 'Runtime Error',
  16: 'Internal Error',
  20: 'Compilation Error'
};

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasOnlyAllowedKeys(obj, allowed) {
  const keys = Object.keys(obj);
  if (keys.length === 0 || keys.length > 6) return false;
  for (const key of keys) {
    if (FORBIDDEN_MESSAGE_KEYS.has(key) || !allowed.has(key)) return false;
  }
  return true;
}

function isValidSlug(value) {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 120 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  );
}

function isValidQueryText(value) {
  return (
    typeof value === 'string' &&
    value.length <= MAX_QUERY_LENGTH &&
    !/[\x00-\x1F\x7F]/.test(value)
  );
}

function isValidDifficultyValue(value) {
  return typeof value === 'string' && VALID_DIFFICULTIES.has(value.trim().toUpperCase());
}

function isValidStatusValue(value) {
  return typeof value === 'string' && VALID_STATUSES.has(value.trim().toUpperCase());
}

function isValidTagsArray(value) {
  return (
    Array.isArray(value) &&
    value.length <= MAX_TOPIC_FILTERS &&
    value.every(isValidSlug)
  );
}

function validateFiltersObject(filters) {
  if (!isPlainObject(filters)) return null;
  const keys = Object.keys(filters);
  if (keys.length === 0 || keys.length > 4) return null;

  const clean = {};
  for (const k of keys) {
    if (FORBIDDEN_MESSAGE_KEYS.has(k) || !['query', 'difficulty', 'tags', 'status'].includes(k)) {
      return null;
    }
    if (k === 'query') {
      if (!isValidQueryText(filters.query)) return null;
      clean.query = filters.query.trim();
    } else if (k === 'difficulty') {
      if (!isValidDifficultyValue(filters.difficulty)) return null;
      clean.difficulty = filters.difficulty.trim().toUpperCase();
    } else if (k === 'tags') {
      if (!isValidTagsArray(filters.tags)) return null;
      clean.tags = [...new Set(filters.tags)];
    } else if (k === 'status') {
      if (!isValidStatusValue(filters.status)) return null;
      clean.status = filters.status.trim().toUpperCase();
    }
  }
  return clean;
}

function validateDashboardMessage(raw) {
  if (!isPlainObject(raw)) {
    return { ok: false, code: 'INVALID_MESSAGE', message: 'Dashboard message must be a plain object.' };
  }

  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_MESSAGE_KEYS.has(key)) {
      return { ok: false, code: 'INVALID_MESSAGE', message: `Forbidden message property: ${key}` };
    }
  }

  const action = raw.action;
  if (typeof action !== 'string' || !/^[a-zA-Z]{1,40}$/.test(action)) {
    return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid or missing dashboard action.' };
  }

  if (raw.type !== undefined && raw.type !== 'action') {
    return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid message type.' };
  }

  if (action === 'ready' || action === 'dismissNotice' || action === 'clearFilters') {
    if (!hasOnlyAllowedKeys(raw, new Set(['action', 'type']))) {
      return { ok: false, code: 'INVALID_MESSAGE', message: `Unexpected payload for ${action}.` };
    }
    return { ok: true, action, payload: {} };
  }

  if (action === 'navigate') {
    if (!hasOnlyAllowedKeys(raw, new Set(['action', 'type', 'destination']))) {
      return { ok: false, code: 'INVALID_MESSAGE', message: 'Unexpected payload for navigate.' };
    }
    if (typeof raw.destination !== 'string' || !VALID_DESTINATIONS.has(raw.destination)) {
      return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid dashboard destination.' };
    }
    return { ok: true, action: 'navigate', payload: { destination: raw.destination } };
  }

  if (action === 'refresh') {
    if (!hasOnlyAllowedKeys(raw, new Set(['action', 'type', 'target']))) {
      return { ok: false, code: 'INVALID_MESSAGE', message: 'Unexpected payload for refresh.' };
    }
    const target = raw.target === undefined ? 'all' : raw.target;
    if (typeof target !== 'string' || !VALID_REFRESH_TARGETS.has(target)) {
      return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid refresh target.' };
    }
    return { ok: true, action: 'refresh', payload: { target } };
  }

  if (action === 'openProblem' || action === 'openLocal') {
    if (!hasOnlyAllowedKeys(raw, new Set(['action', 'type', 'titleSlug'])) || !isValidSlug(raw.titleSlug)) {
      return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid problem slug in dashboard message.' };
    }
    return { ok: true, action, payload: { titleSlug: raw.titleSlug } };
  }

  if (action === 'changePage') {
    if (!hasOnlyAllowedKeys(raw, new Set(['action', 'type', 'direction'])) || (raw.direction !== 'next' && raw.direction !== 'prev')) {
      return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid pagination direction.' };
    }
    return { ok: true, action: 'changePage', payload: { direction: raw.direction } };
  }

  if (action === 'loadTopics') {
    if (!hasOnlyAllowedKeys(raw, new Set(['action', 'type', 'force']))) {
      return { ok: false, code: 'INVALID_MESSAGE', message: 'Unexpected payload for loadTopics.' };
    }
    if (raw.force !== undefined && typeof raw.force !== 'boolean') {
      return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid force flag for loadTopics.' };
    }
    return { ok: true, action: 'loadTopics', payload: { force: Boolean(raw.force) } };
  }

  if (action === 'toggleTopic') {
    if (!hasOnlyAllowedKeys(raw, new Set(['action', 'type', 'tag'])) || !isValidSlug(raw.tag)) {
      return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid topic tag slug.' };
    }
    return { ok: true, action: 'toggleTopic', payload: { tag: raw.tag } };
  }

  if (action === 'removeFilter') {
    if (!hasOnlyAllowedKeys(raw, new Set(['action', 'type', 'kind', 'value']))) {
      return { ok: false, code: 'INVALID_MESSAGE', message: 'Unexpected payload for removeFilter.' };
    }
    if (typeof raw.kind !== 'string' || !VALID_REMOVE_FILTER_KINDS.has(raw.kind)) {
      return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid filter kind to remove.' };
    }
    if (raw.kind === 'tag') {
      if (!isValidSlug(raw.value)) {
        return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid topic slug to remove.' };
      }
      return { ok: true, action: 'removeFilter', payload: { kind: 'tag', value: raw.value } };
    }
    if (raw.value !== undefined) {
      return { ok: false, code: 'INVALID_MESSAGE', message: 'Unexpected value for removeFilter.' };
    }
    return { ok: true, action: 'removeFilter', payload: { kind: raw.kind } };
  }

  if (action === 'setSearch') {
    if (!hasOnlyAllowedKeys(raw, new Set(['action', 'type', 'query'])) || !isValidQueryText(raw.query)) {
      return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid search query.' };
    }
    return { ok: true, action: 'setFilters', payload: { filters: { query: raw.query.trim() } } };
  }

  if (action === 'setDifficulty') {
    if (!hasOnlyAllowedKeys(raw, new Set(['action', 'type', 'difficulty'])) || !isValidDifficultyValue(raw.difficulty)) {
      return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid difficulty filter.' };
    }
    return { ok: true, action: 'setFilters', payload: { filters: { difficulty: raw.difficulty.trim().toUpperCase() } } };
  }

  if (action === 'setTopics') {
    if (!hasOnlyAllowedKeys(raw, new Set(['action', 'type', 'tags'])) || !isValidTagsArray(raw.tags)) {
      return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid topic filters.' };
    }
    return { ok: true, action: 'setFilters', payload: { filters: { tags: [...new Set(raw.tags)] } } };
  }

  if (action === 'setStatus') {
    if (!hasOnlyAllowedKeys(raw, new Set(['action', 'type', 'status'])) || !isValidStatusValue(raw.status)) {
      return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid progress filter.' };
    }
    return { ok: true, action: 'setFilters', payload: { filters: { status: raw.status.trim().toUpperCase() } } };
  }

  if (action === 'setFilters') {
    if (!hasOnlyAllowedKeys(raw, new Set(['action', 'type', 'filters']))) {
      return { ok: false, code: 'INVALID_MESSAGE', message: 'Unexpected payload for setFilters.' };
    }
    const clean = validateFiltersObject(raw.filters);
    if (!clean) {
      return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid filters payload.' };
    }
    return { ok: true, action: 'setFilters', payload: { filters: clean } };
  }

  if (action === 'problemAction') {
    if (!hasOnlyAllowedKeys(raw, new Set(['action', 'type', 'kind'])) || typeof raw.kind !== 'string' || !VALID_PROBLEM_ACTIONS.has(raw.kind)) {
      return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid problem action kind.' };
    }
    return { ok: true, action: 'problemAction', payload: { kind: raw.kind } };
  }

  if (action === 'accountAction') {
    if (!hasOnlyAllowedKeys(raw, new Set(['action', 'type', 'kind'])) || typeof raw.kind !== 'string' || !VALID_ACCOUNT_ACTIONS.has(raw.kind)) {
      return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid account action kind.' };
    }
    return { ok: true, action: 'accountAction', payload: { kind: raw.kind } };
  }

  if (PLANNED_ACTIONS.has(action)) {
    return {
      ok: false,
      code: 'UNIMPLEMENTED',
      action,
      message: `Action "${action}" is not available.`
    };
  }

  return { ok: false, code: 'INVALID_MESSAGE', message: 'Unknown or disallowed dashboard action.' };
}

function serializeStateForHtml(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function formatVerifiedProgress(status, isVerified) {
  if (!isVerified) return null;
  if (status === 'ac') return 'Solved';
  if (status === 'notac') return 'Attempted';
  if (status === null) return 'Not started';
  return null;
}

function sanitizeQuestionForView(q, isVerified) {
  return {
    questionFrontendId: boundText(q.questionFrontendId, 20),
    title: boundText(q.title, 120),
    titleSlug: boundText(q.titleSlug, 120),
    difficulty: boundText(q.difficulty, 20),
    isPaidOnly: Boolean(q.isPaidOnly),
    supported: q.supported !== false,
    progress: formatVerifiedProgress(q.status, isVerified),
    topicTags: Array.isArray(q.topicTags)
      ? q.topicTags.slice(0, 10).map(t => ({
          name: boundText(t.name, 40),
          slug: boundText(t.slug, 40)
        }))
      : []
  };
}

function formatResultFieldValue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) {
    return boundText(value.map(v => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n'), 240);
  }
  return boundText(typeof value === 'string' ? value : JSON.stringify(value), 240);
}

function summarizeResultForView(record) {
  if (!record || !record.job || !record.result) return null;
  const { job, result: r } = record;
  let verdict = r.status_msg || VERDICTS[r.status_code] || 'Unknown verdict';
  if (job.kind === 'test' && Number(r.status_code) === 10) {
    verdict = r.correct_answer === true
      ? 'Passed'
      : r.correct_answer === false
        ? 'Wrong Answer'
        : 'Execution completed (comparison unavailable)';
  }
  return {
    kind: job.kind === 'submit' ? 'submit' : 'test',
    heading: job.kind === 'submit'
      ? 'OFFICIAL LEETCODE SUBMISSION'
      : 'LEETCODE REMOTE TEST — not an official submission',
    problemNumber: boundText(job.number, 20),
    problemTitle: boundText(job.title, 120),
    verdict: boundText(verdict, 80),
    operationId: job.id ? boundText(job.id, 60) : null,
    account: job.user ? boundText(job.user, 60) : null,
    editorVersion: job.version !== undefined ? Number(job.version) : null,
    runtime: r.status_runtime ? boundText(r.status_runtime, 40) : null,
    memory: r.status_memory
      ? boundText(r.status_memory, 40)
      : (typeof r.memory === 'number' ? `${r.memory} bytes` : null),
    passed: r.total_correct != null && r.total_testcases != null
      ? `${r.total_correct}/${r.total_testcases}`
      : null,
    actualOutput: formatResultFieldValue(r.code_answer ?? r.output),
    expectedOutput: formatResultFieldValue(r.expected_code_answer ?? r.expected_output),
    failingInput: formatResultFieldValue(r.last_testcase ?? r.input_formatted ?? r.input),
    compileError: formatResultFieldValue(r.full_compile_error ?? r.compile_error),
    runtimeError: formatResultFieldValue(r.full_runtime_error ?? r.runtime_error),
    stdout: formatResultFieldValue(r.std_output ?? r.code_output),
    startedAt: job.startedAt ? boundText(job.startedAt, 40) : null
  };
}

function formatAccountGuidance(account, busy) {
  if (busy) {
    return 'A remote or account operation is currently in progress. Wait for it to finish before checking, importing, or disconnecting a session.';
  }
  if (!account) {
    return 'Browser sign-in alone never marks VS Code connected. Credentials are kept in VS Code SecretStorage.';
  }
  if (account.detail) {
    return account.detail;
  }
  switch (account.kind) {
    case 'verified':
      return `Connected and verified as ${account.username || 'LeetCode user'}. Remote runs, official submissions, and account progress filters are enabled.`;
    case 'unverified':
      return 'A session is stored in VS Code SecretStorage, but has not been verified in this window yet. Click "Check Saved Session" to verify it and enable progress filters.';
    case 'expired':
      return 'Your stored LeetCode session expired or was signed out. Sign in via your browser and use "Advanced: Import Session" to replace the stored cookies, or click "Disconnect Account" to remove them.';
    case 'unavailable':
      return 'Account verification could not be completed due to a network or service challenge. Your saved session is preserved in SecretStorage; click "Check Saved Session" to retry when connectivity recovers.';
    default:
      return 'No LeetCode session is stored in VS Code. Anonymous browsing and opening public problems work without an account. To run remote tests, submit solutions, or filter by progress, sign in on leetcode.com and use "Advanced: Import Session".';
  }
}

function computeActionHint(state) {
  if (state.busy) {
    return 'Remote operation in progress on LeetCode… Duplicate runs and submissions are blocked until completion.';
  }
  if (state.pendingJob) {
    return `Pending ${state.pendingJob.kind === 'submit' ? 'submission' : 'remote test'} for ${state.pendingJob.number}. ${state.pendingJob.title}. Use "Retrieve Pending Result" or "Clear Pending Operation" under More Actions before running or submitting again.`;
  }
  if (!state.currentProblem) {
    return 'No problem selected. Click "Open" on any problem in Explore or My Problems to select a C++ solution.';
  }
  if (!state.currentProblem.editorOpen) {
    return `The editor for ${state.currentProblem.fileName || 'this solution'} is closed. Click "Open Code" to reopen the C++ solution before running or submitting.`;
  }
  return `Target locked to ${state.currentProblem.fileName || 'registered C++ solution'}${state.currentProblem.dirty ? ' (includes unsaved editor changes)' : ''}. Moving focus to this dashboard will not change the target file.`;
}

function renderPendingHtml(pendingJob, busy) {
  if (!pendingJob) return '';
  const disabledAttr = busy ? ' disabled' : '';
  return `<div class="lc-status-box" role="status"><span>Pending ${pendingJob.kind === 'submit' ? 'submission' : 'test'}: ${escape(pendingJob.number)}. ${escape(pendingJob.title)}${pendingJob.id ? ' (ID: ' + escape(pendingJob.id) + ')' : ' (unconfirmed ID)'}</span><div class="lc-action-row"><button type="button" class="lc-btn" data-action="problemAction" data-kind="resume"${disabledAttr}>Retrieve Pending Result</button><button type="button" class="lc-btn lc-btn-secondary" data-action="problemAction" data-kind="clearPending"${disabledAttr}>Clear Pending Operation</button></div></div>`;
}

function renderLastResultHtml(lastResult) {
  if (!lastResult) return '';
  const details = [];
  if (lastResult.runtime) details.push(`Runtime: ${lastResult.runtime}`);
  if (lastResult.memory) details.push(`Memory: ${lastResult.memory}`);
  if (lastResult.passed) details.push(`Passed: ${lastResult.passed}`);
  if (lastResult.editorVersion !== null && lastResult.editorVersion !== undefined) {
    details.push(`Editor v${lastResult.editorVersion}`);
  }
  const extraLines = [];
  if (lastResult.actualOutput) extraLines.push(`Actual: ${lastResult.actualOutput}`);
  if (lastResult.expectedOutput) extraLines.push(`Expected: ${lastResult.expectedOutput}`);
  if (lastResult.failingInput) extraLines.push(`Input: ${lastResult.failingInput}`);
  if (lastResult.compileError) extraLines.push(`Compiler: ${lastResult.compileError}`);
  if (lastResult.runtimeError) extraLines.push(`Runtime error: ${lastResult.runtimeError}`);

  return `<div class="lc-status-box" role="region" aria-label="Latest Remote Result"><div class="lc-item-main"><div class="lc-item-title">${escape(lastResult.heading)} · ${escape(lastResult.problemNumber)}. ${escape(lastResult.problemTitle)} — Verdict: ${escape(lastResult.verdict)}</div><div class="lc-item-meta">${escape(details.join(' · '))}</div>${extraLines.length ? `<div class="lc-item-meta">${escape(extraLines.join(' | '))}</div>` : ''}</div></div>`;
}

function renderActiveFiltersHtml(catalog, account) {
  const filters = catalog.filters || { query: '', difficulty: 'ANY', tags: [], status: 'ALL' };
  const chips = [];
  if (filters.query) {
    chips.push(`<button type="button" class="lc-chip" data-action="removeFilter" data-filter-kind="query" data-focus-key="chip:query" title="Remove search filter">Search: &quot;${escape(filters.query)}&quot; ×</button>`);
  }
  if (filters.difficulty && filters.difficulty !== 'ANY') {
    chips.push(`<button type="button" class="lc-chip" data-action="removeFilter" data-filter-kind="difficulty" data-focus-key="chip:difficulty" title="Remove difficulty filter">Difficulty: ${escape(filters.difficulty)} ×</button>`);
  }
  if (Array.isArray(filters.tags)) {
    for (const tag of filters.tags) {
      chips.push(`<button type="button" class="lc-chip" data-action="removeFilter" data-filter-kind="tag" data-filter-value="${escape(tag)}" data-focus-key="chip:tag:${escape(tag)}" title="Remove topic filter ${escape(tag)}">Topic: ${escape(tag)} ×</button>`);
    }
  }
  if (account.isVerified && filters.status && filters.status !== 'ALL') {
    const label = STATUS_LABELS[filters.status] || filters.status;
    chips.push(`<button type="button" class="lc-chip" data-action="removeFilter" data-filter-kind="status" data-focus-key="chip:status" title="Remove progress filter">Progress: ${escape(label)} ×</button>`);
  }
  if (chips.length > 0 || catalog.hasActiveFilters) {
    chips.push('<button type="button" class="lc-btn lc-btn-secondary" data-action="clearFilters" data-focus-key="clear-filters">Clear Filters</button>');
  }
  return chips.join('');
}

function renderTopicsHtml(topics, catalog) {
  const selected = new Set((catalog.filters && catalog.filters.tags) || []);
  if (!topics || topics.status === 'idle') {
    if (selected.size === 0) return '';
    const activePills = [...selected].map(slug =>
      `<button type="button" class="lc-topic-btn" aria-pressed="true" data-action="toggleTopic" data-tag="${escape(slug)}" data-focus-key="topic:${escape(slug)}">${escape(slug)}</button>`
    ).join('');
    return `<div class="lc-badge-row">${activePills}</div>`;
  }
  if (topics.status === 'loading') {
    return '<div class="lc-status-box" role="status"><span>Loading topic tags…</span></div>';
  }
  if (topics.status === 'error') {
    return `<div class="lc-status-box lc-status-error" role="alert"><span>${escape(topics.error || 'Could not load topic tags.')}</span><button type="button" class="lc-btn" data-action="loadTopics" data-force="true">Retry Topics</button></div>`;
  }
  const items = Array.isArray(topics.items) ? topics.items : [];
  if (items.length === 0) return '';
  const buttons = items.map(t => {
    const isSelected = selected.has(t.slug);
    return `<button type="button" class="lc-topic-btn" aria-pressed="${isSelected ? 'true' : 'false'}" data-action="toggleTopic" data-tag="${escape(t.slug)}" data-focus-key="topic:${escape(t.slug)}">${escape(t.name)}</button>`;
  }).join('');
  return `<div class="lc-badge-row">${buttons}</div>`;
}

function renderDailyHtml(daily) {
  if (daily.status === 'loading' && !daily.question) {
    return '<div class="lc-status-box" role="status"><span>Loading Daily Challenge…</span></div>';
  }
  if (daily.status === 'error' && !daily.question) {
    return `<div class="lc-status-box lc-status-error" role="alert"><span>${escape(daily.error || 'Could not load Daily Challenge.')}</span><button type="button" class="lc-btn" data-action="refresh" data-target="daily">Retry Daily Challenge</button></div>`;
  }
  if (!daily.question) {
    return '<div class="lc-status-box"><span>Daily Challenge not loaded yet.</span><button type="button" class="lc-btn" data-action="refresh" data-target="daily">Load Daily Challenge</button></div>';
  }

  const q = daily.question;
  const metaParts = [];
  if (daily.date) metaParts.push(`${daily.date}${daily.stale ? ' (stale)' : ''}`);
  metaParts.push(q.difficulty);
  if (!q.supported) metaParts.push('Unsupported ID');
  if (q.isPaidOnly) metaParts.push('Premium');
  if (q.progress) metaParts.push(q.progress);

  const btnClass = q.supported ? 'lc-btn' : 'lc-btn lc-btn-secondary';
  const btnLabel = q.supported ? 'Open Daily Challenge' : 'Unsupported ID';
  const btnTitle = q.supported
    ? (q.isPaidOnly ? 'Premium problem — requires active LeetCode subscription' : 'Open Daily Challenge in editor')
    : 'Non-numeric problem IDs are not supported by the C++ workflow';

  let html = `<div class="lc-list-item"><div class="lc-item-main"><div class="lc-item-title">${escape(q.questionFrontendId)}. ${escape(q.title)}</div><div class="lc-item-meta">${escape(metaParts.join(' · '))}</div></div><button type="button" class="${btnClass}" data-action="openProblem" data-slug="${escape(q.titleSlug)}" data-focus-key="daily-open:${escape(q.titleSlug)}" title="${escape(btnTitle)}">${escape(btnLabel)}</button></div>`;

  if (daily.stale) {
    html += `<div class="lc-status-box lc-status-error" role="status"><span>Refresh failed (${escape(daily.error || 'network error')}). Showing last known date ${escape(daily.date || '')}.</span><button type="button" class="lc-btn" data-action="refresh" data-target="daily">Retry Daily Challenge</button></div>`;
  }
  return html;
}

function renderCatalogHtml(catalog, account) {
  if (catalog.status === 'loading') {
    return '<div class="lc-status-box" role="status"><span>Loading problems…</span></div>';
  }
  if (catalog.status === 'error') {
    return `<div class="lc-status-box lc-status-error" role="alert"><span>${escape(catalog.error || 'Could not load problems.')}</span><button type="button" class="lc-btn" data-action="refresh" data-target="catalog">Retry Problem List</button></div>`;
  }
  const questions = Array.isArray(catalog.questions) ? catalog.questions : [];
  if (questions.length === 0) {
    const clearBtn = catalog.hasActiveFilters
      ? '<button type="button" class="lc-btn lc-btn-secondary" data-action="clearFilters">Clear Filters</button>'
      : '';
    return `<div class="lc-status-box"><span>No matching LeetCode problems found.</span>${clearBtn}</div>`;
  }

  const items = questions.map(q => {
    const metaParts = [q.difficulty];
    if (!q.supported) metaParts.push('Unsupported ID');
    if (q.isPaidOnly) metaParts.push('Premium');
    if (account.isVerified && q.progress) metaParts.push(q.progress);
    if (Array.isArray(q.topicTags) && q.topicTags.length > 0) {
      metaParts.push(q.topicTags.map(t => t.name).join(', '));
    }
    const btnClass = q.supported ? 'lc-btn' : 'lc-btn lc-btn-secondary';
    const btnLabel = q.supported ? 'Open' : 'Unsupported ID';
    const btnTitle = q.supported
      ? (q.isPaidOnly ? 'Premium problem — requires active LeetCode subscription' : 'Open problem in editor')
      : 'Non-numeric problem IDs are not supported by the C++ workflow';
    return `<li class="lc-list-item"><div class="lc-item-main"><div class="lc-item-title">${escape(q.questionFrontendId)}. ${escape(q.title)}</div><div class="lc-item-meta">${escape(metaParts.join(' · '))}</div></div><button type="button" class="${btnClass}" data-action="openProblem" data-slug="${escape(q.titleSlug)}" data-focus-key="catalog-open:${escape(q.titleSlug)}" title="${escape(btnTitle)}">${escape(btnLabel)}</button></li>`;
  }).join('');

  return `<ul class="lc-list">${items}</ul>`;
}

function renderPaginationHtml(catalog) {
  if (catalog.status !== 'ready' || !Array.isArray(catalog.questions) || catalog.questions.length === 0) {
    return '';
  }
  const start = catalog.skip + 1;
  const end = catalog.skip + catalog.questions.length;
  const prevDisabled = catalog.skip > 0 ? '' : ' disabled';
  const nextDisabled = catalog.hasMore ? '' : ' disabled';
  return `<span class="lc-muted">Showing ${start}–${end} of ${catalog.total}</span><div class="lc-action-row"><button type="button" class="lc-btn lc-btn-secondary" data-action="changePage" data-direction="prev" data-focus-key="page:prev"${prevDisabled}>Previous Page</button><button type="button" class="lc-btn lc-btn-secondary" data-action="changePage" data-direction="next" data-focus-key="page:next"${nextDisabled}>Next Page</button></div>`;
}

function renderLocalHtml(localProblems) {
  if (!Array.isArray(localProblems) || localProblems.length === 0) {
    return '<div class="lc-status-box"><span>No saved local problems yet. Open a problem from Explore to create a local C++ solution file.</span></div>';
  }
  const items = localProblems.map(q =>
    `<li class="lc-list-item"><div class="lc-item-main"><div class="lc-item-title">${escape(q.questionFrontendId)}. ${escape(q.title)}</div><div class="lc-item-meta">${escape(q.difficulty)} · ${escape(q.availability || 'Available locally')}</div></div><button type="button" class="lc-btn" data-action="openLocal" data-slug="${escape(q.titleSlug)}" data-focus-key="local-open:${escape(q.titleSlug)}" title="Reopen saved local C++ solution offline without overwriting existing code">Open Local</button></li>`
  ).join('');
  return `<ul class="lc-list">${items}</ul>`;
}

class LeetCodeDashboard {
  constructor(vscode, context, options = {}) {
    this.vscode = vscode;
    this.context = context;
    this.discovery = options.discovery;
    this.openProblemBySlug = options.openProblemBySlug;
    this.openLocalProblem = options.openLocalProblem;
    this.executeProblemAction = options.executeProblemAction;
    this.executeAccountAction = options.executeAccountAction;
    this.isBusy = options.isBusy || (() => false);
    this.getPendingJob = options.getPendingJob || (async () => undefined);
    this.getLastResult = options.getLastResult || (async () => undefined);
    this.onError = options.onError;
    this.getLocalProblems = options.getLocalProblems || (async () => []);
    this.getCurrentProblem = options.getCurrentProblem || (async () => undefined);
    this.mediaRoot = options.mediaRoot || path.resolve(__dirname, '..', 'media');

    this.panel = undefined;
    this.panelDisposables = [];
    this.nonce = undefined;
    this.htmlInitialized = false;
    this.destination = 'explore';
    this.notice = null;
    this.lastState = undefined;
    this.disposed = false;
    this.rejectedCount = 0;
    this._refreshQueue = Promise.resolve();
  }

  get isOpen() {
    return Boolean(this.panel && !this.disposed);
  }

  async open() {
    if (this.disposed) return undefined;

    if (this.panel) {
      if (typeof this.panel.reveal === 'function') {
        const col = this.panel.viewColumn || this.vscode.ViewColumn.One;
        this.panel.reveal(col, false);
      }
      if (this.discovery && !this.discovery.initialized) {
        Promise.resolve(this.discovery.ensureLoaded()).catch(() => {});
      }
      await this.refresh();
      return this.panel;
    }

    const column = this.vscode.window.activeTextEditor?.viewColumn || this.vscode.ViewColumn.One;
    const mediaUri = this.vscode.Uri.file(this.mediaRoot);
    const panel = this.vscode.window.createWebviewPanel(
      DASHBOARD_VIEW_TYPE,
      'LeetCode Dashboard',
      column,
      {
        enableScripts: true,
        enableCommandUris: false,
        retainContextWhenHidden: true,
        localResourceRoots: [mediaUri]
      }
    );

    this.panel = panel;
    this.nonce = randomBytes(16).toString('hex');
    this.htmlInitialized = false;

    if (panel.webview && typeof panel.webview.onDidReceiveMessage === 'function') {
      const msgSub = panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
      if (msgSub && typeof msgSub.dispose === 'function') {
        this.panelDisposables.push(msgSub);
      }
    }

    if (typeof panel.onDidDispose === 'function') {
      const dispSub = panel.onDidDispose(() => this._cleanupPanel(panel));
      if (dispSub && typeof dispSub.dispose === 'function') {
        this.panelDisposables.push(dispSub);
      }
    }

    if (this.discovery && !this.discovery.initialized) {
      Promise.resolve(this.discovery.ensureLoaded()).catch(() => {});
    }

    await this.refresh();
    return panel;
  }

  _cleanupPanel(targetPanel) {
    if (targetPanel && this.panel && this.panel !== targetPanel) return;
    while (this.panelDisposables.length > 0) {
      const sub = this.panelDisposables.pop();
      try {
        sub.dispose();
      } catch {
        // Ignore disposal error
      }
    }
    this.panel = undefined;
    this.nonce = undefined;
    this.htmlInitialized = false;
  }

  dispose() {
    this.disposed = true;
    const activePanel = this.panel;
    this._cleanupPanel(activePanel);
    if (activePanel && typeof activePanel.dispose === 'function') {
      try {
        activePanel.dispose();
      } catch {
        // Ignore disposal error
      }
    }
  }

  async buildState() {
    const acct = this.discovery?.account || { kind: 'signed_out' };
    const isVerified = Boolean(this.discovery?.isVerified);
    const daily = this.discovery?.daily || { status: 'idle', data: undefined, stale: false, error: undefined };
    const cat = this.discovery?.catalog || { status: 'idle', questions: [], total: 0, limit: 50, skip: 0, hasMore: false, error: undefined };
    const topics = this.discovery?.topics || { status: 'idle', items: [], error: undefined };
    const filters = this.discovery?.filters || { query: '', difficulty: 'ANY', tags: [], status: 'ALL' };

    let locals = [];
    try {
      const rawLocals = await this.getLocalProblems();
      if (Array.isArray(rawLocals)) locals = rawLocals;
    } catch {
      locals = [];
    }

    let current = undefined;
    try {
      current = await this.getCurrentProblem();
    } catch {
      current = undefined;
    }

    let pending = undefined;
    try {
      pending = await this.getPendingJob();
    } catch {
      pending = undefined;
    }

    let rawResult = undefined;
    try {
      rawResult = await this.getLastResult();
    } catch {
      rawResult = undefined;
    }

    const busy = Boolean(this.isBusy());

    return {
      destination: VALID_DESTINATIONS.has(this.destination) ? this.destination : 'explore',
      busy,
      notice: this.notice ? { kind: this.notice.kind, code: this.notice.code, message: boundText(this.notice.message, 240) } : null,
      account: {
        kind: acct.kind || 'signed_out',
        isVerified,
        username: isVerified ? boundText(acct.username, 60) : null,
        summary: formatAccountSummary(acct),
        detail: acct.detail ? boundText(acct.detail, 160) : null
      },
      currentProblem: current && current.titleSlug
        ? {
            questionFrontendId: boundText(current.questionFrontendId, 20),
            title: boundText(current.title, 120),
            titleSlug: boundText(current.titleSlug, 120),
            difficulty: boundText(current.difficulty, 20),
            fileName: current.fileName ? boundText(current.fileName, 120) : null,
            editorOpen: current.editorOpen !== false,
            dirty: Boolean(current.dirty),
            enableRunCode: current.enableRunCode !== false
          }
        : null,
      pendingJob: pending && pending.slug
        ? {
            kind: pending.kind === 'submit' ? 'submit' : 'test',
            id: pending.id ? boundText(pending.id, 60) : null,
            slug: boundText(pending.slug, 120),
            title: boundText(pending.title, 120),
            number: boundText(pending.number, 20),
            user: boundText(pending.user, 60),
            startedAt: boundText(pending.startedAt, 40)
          }
        : null,
      lastResult: summarizeResultForView(rawResult),
      daily: {
        status: daily.status || 'idle',
        stale: Boolean(daily.stale),
        date: daily.data?.date ? boundText(daily.data.date, 20) : null,
        error: daily.error ? boundText(daily.error, 160) : null,
        question: daily.data?.question ? sanitizeQuestionForView(daily.data.question, isVerified) : null
      },
      topics: {
        status: topics.status || 'idle',
        error: topics.error ? boundText(topics.error, 160) : null,
        items: Array.isArray(topics.items)
          ? topics.items.slice(0, 200).map(t => ({
              name: boundText(t.name, 40),
              slug: boundText(t.slug, 40)
            }))
          : []
      },
      catalog: {
        status: cat.status || 'idle',
        total: Number(cat.total) || 0,
        limit: Number(cat.limit) || 50,
        skip: Number(cat.skip) || 0,
        hasMore: Boolean(cat.hasMore),
        error: cat.error ? boundText(cat.error, 160) : null,
        filterSummary: this.discovery ? formatFilterSummary(this.discovery) : 'All problems',
        hasActiveFilters: Boolean(this.discovery?.hasActiveFilters),
        filters: {
          query: boundText(filters.query, 100),
          difficulty: boundText(filters.difficulty || 'ANY', 20),
          tags: Array.isArray(filters.tags) ? filters.tags.slice(0, 20).map(t => boundText(t, 40)) : [],
          status: isVerified ? boundText(filters.status || 'ALL', 20) : 'ALL'
        },
        questions: Array.isArray(cat.questions)
          ? cat.questions.map(q => sanitizeQuestionForView(q, isVerified))
          : []
      },
      localProblems: locals.map(q => ({
        questionFrontendId: boundText(q.questionFrontendId, 20),
        title: boundText(q.title, 120),
        titleSlug: boundText(q.titleSlug, 120),
        difficulty: boundText(q.difficulty, 20),
        availability: 'Available locally'
      }))
    };
  }

  refresh() {
    this._refreshQueue = this._refreshQueue.then(() => this._performRefresh()).catch(() => undefined);
    return this._refreshQueue;
  }

  async _performRefresh() {
    if (this.disposed || !this.panel) return undefined;
    const targetPanel = this.panel;
    const state = await this.buildState();
    if (this.disposed || !this.panel || this.panel !== targetPanel) return undefined;

    this.lastState = state;
    if (!this.htmlInitialized) {
      targetPanel.webview.html = this.renderHtml(state);
      this.htmlInitialized = true;
    }
    if (typeof targetPanel.webview.postMessage === 'function') {
      try {
        await targetPanel.webview.postMessage({ type: 'state', state });
      } catch {
        // Ignore disconnected webview postMessage failures
      }
    }
    return state;
  }

  async _applyFiltersToDiscovery(filters) {
    if (!this.discovery) return;
    if (filters.status !== undefined && filters.status !== 'ALL' && !this.discovery.isVerified) {
      throw Object.assign(
        new LcError('AUTH', 'Verify your LeetCode session before filtering by account progress.'),
        { preserveAccountState: true }
      );
    }

    const keys = Object.keys(filters);
    if (keys.length === 1) {
      if (keys[0] === 'query') {
        await this.discovery.setSearchQuery(filters.query);
        return;
      }
      if (keys[0] === 'difficulty') {
        await this.discovery.setDifficulty(filters.difficulty);
        return;
      }
      if (keys[0] === 'tags') {
        await this.discovery.setTopics(filters.tags);
        return;
      }
      if (keys[0] === 'status') {
        await this.discovery.setStatusFilter(filters.status);
        return;
      }
    }

    if (filters.query !== undefined) this.discovery.filters.query = filters.query;
    if (filters.difficulty !== undefined) this.discovery.filters.difficulty = filters.difficulty;
    if (filters.tags !== undefined) this.discovery.filters.tags = [...filters.tags];
    if (filters.status !== undefined) this.discovery.filters.status = filters.status;
    this.discovery.skip = 0;
    await this.discovery.persistFilters();
    await this.discovery.refreshCatalog();
  }

  async _reportActionError(error, fallbackMessage) {
    const code = error?.code || 'ERROR';
    const message = error instanceof LcError ? error.message : fallbackMessage;
    this.notice = { kind: 'error', code, message };
    await this.refresh();
    if (this.onError) {
      try {
        await this.onError(error);
      } catch {
        // Ignore error reporter failures
      }
    }
    return { ok: false, code, message };
  }

  async handleMessage(raw) {
    if (this.disposed || !this.panel) {
      return { ok: false, code: 'DISPOSED', message: 'Dashboard is not active.' };
    }

    const validated = validateDashboardMessage(raw);
    if (!validated.ok) {
      if (validated.code === 'UNIMPLEMENTED') {
        this.notice = {
          kind: 'info',
          code: 'UNIMPLEMENTED',
          message: validated.message
        };
        await this.refresh();
      } else {
        this.rejectedCount += 1;
      }
      return validated;
    }

    try {
      if (validated.action === 'ready') {
        await this.refresh();
        return { ok: true, action: 'ready' };
      }

      if (validated.action === 'navigate') {
        this.destination = validated.payload.destination;
        this.notice = null;
        await this.refresh();
        return { ok: true, action: 'navigate', destination: this.destination };
      }

      if (validated.action === 'dismissNotice') {
        this.notice = null;
        await this.refresh();
        return { ok: true, action: 'dismissNotice' };
      }

      if (validated.action === 'refresh') {
        const target = validated.payload.target;
        this.notice = null;
        if (this.discovery) {
          if (target === 'daily') {
            await this.discovery.refreshDaily();
          } else if (target === 'catalog') {
            await this.discovery.refreshCatalog();
          } else if (target === 'topics') {
            await this.discovery.ensureTopics(true);
          } else if (target === 'all') {
            await this.discovery.refreshAll();
          }
        }
        await this.refresh();
        return { ok: true, action: 'refresh', target };
      }

      if (validated.action === 'openProblem') {
        const { titleSlug } = validated.payload;
        if (typeof this.openProblemBySlug !== 'function') {
          throw new LcError('UNSUPPORTED', 'Problem opening is not configured.');
        }
        const dailyQ = this.discovery?.daily?.data?.question;
        const preview = (dailyQ && dailyQ.titleSlug === titleSlug)
          ? dailyQ
          : this.discovery?.catalog?.questions?.find(q => q.titleSlug === titleSlug);
        this.notice = null;
        await this.openProblemBySlug(titleSlug, preview);
        await this.refresh();
        return { ok: true, action: 'openProblem', titleSlug };
      }

      if (validated.action === 'openLocal') {
        const { titleSlug } = validated.payload;
        if (typeof this.openLocalProblem !== 'function') {
          throw new LcError('UNSUPPORTED', 'Local problem opening is not configured.');
        }
        const locals = await this.getLocalProblems();
        const found = Array.isArray(locals) ? locals.find(q => q.titleSlug === titleSlug) : undefined;
        if (!found) {
          throw new LcError('NOT_FOUND', 'Saved local problem was not found.');
        }
        this.notice = null;
        await this.openLocalProblem(found);
        await this.refresh();
        return { ok: true, action: 'openLocal', titleSlug };
      }

      if (validated.action === 'setFilters') {
        this.notice = null;
        await this._applyFiltersToDiscovery(validated.payload.filters);
        await this.refresh();
        return { ok: true, action: 'setFilters', filters: { ...this.discovery?.filters } };
      }

      if (validated.action === 'toggleTopic') {
        const { tag } = validated.payload;
        this.notice = null;
        if (this.discovery) {
          const current = Array.isArray(this.discovery.filters.tags) ? this.discovery.filters.tags : [];
          const next = current.includes(tag)
            ? current.filter(t => t !== tag)
            : [...current, tag];
          await this.discovery.setTopics(next);
        }
        await this.refresh();
        return { ok: true, action: 'toggleTopic', tag };
      }

      if (validated.action === 'removeFilter') {
        const { kind, value } = validated.payload;
        this.notice = null;
        if (this.discovery) {
          if (kind === 'query') {
            await this.discovery.setSearchQuery('');
          } else if (kind === 'difficulty') {
            await this.discovery.setDifficulty('ANY');
          } else if (kind === 'status') {
            await this.discovery.setStatusFilter('ALL');
          } else if (kind === 'tag') {
            const next = (this.discovery.filters.tags || []).filter(t => t !== value);
            await this.discovery.setTopics(next);
          }
        }
        await this.refresh();
        return { ok: true, action: 'removeFilter', kind };
      }

      if (validated.action === 'clearFilters') {
        this.notice = null;
        if (this.discovery) {
          await this.discovery.clearFilters();
        }
        await this.refresh();
        return { ok: true, action: 'clearFilters' };
      }

      if (validated.action === 'loadTopics') {
        this.notice = null;
        if (this.discovery) {
          await this.discovery.ensureTopics(Boolean(validated.payload.force));
        }
        await this.refresh();
        return { ok: true, action: 'loadTopics' };
      }

      if (validated.action === 'changePage') {
        const { direction } = validated.payload;
        this.notice = null;
        if (this.discovery) {
          if (direction === 'next') {
            await this.discovery.nextPage();
          } else {
            await this.discovery.prevPage();
          }
        }
        await this.refresh();
        return { ok: true, action: 'changePage', direction, skip: this.discovery?.skip || 0 };
      }

      if (validated.action === 'problemAction') {
        const { kind } = validated.payload;
        if (typeof this.executeProblemAction !== 'function') {
          throw new LcError('UNSUPPORTED', 'Problem actions are not configured.');
        }
        this.notice = null;
        await this.executeProblemAction(kind);
        await this.refresh();
        return { ok: true, action: 'problemAction', kind };
      }

      if (validated.action === 'accountAction') {
        const { kind } = validated.payload;
        if (typeof this.executeAccountAction !== 'function') {
          throw new LcError('UNSUPPORTED', 'Account actions are not configured.');
        }
        this.notice = null;
        await this.executeAccountAction(kind);
        await this.refresh();
        return { ok: true, action: 'accountAction', kind };
      }
    } catch (error) {
      return this._reportActionError(error, 'The dashboard action could not be completed.');
    }

    return { ok: false, code: 'INVALID_MESSAGE', message: 'Unhandled dashboard action.' };
  }

  renderHtml(state) {
    const nonce = this.nonce || randomBytes(16).toString('hex');
    const cssFileUri = this.vscode.Uri.file(path.join(this.mediaRoot, 'dashboard.css'));
    const jsFileUri = this.vscode.Uri.file(path.join(this.mediaRoot, 'dashboard.js'));
    const cssUri = typeof this.panel?.webview?.asWebviewUri === 'function'
      ? this.panel.webview.asWebviewUri(cssFileUri)
      : cssFileUri;
    const jsUri = typeof this.panel?.webview?.asWebviewUri === 'function'
      ? this.panel.webview.asWebviewUri(jsFileUri)
      : jsFileUri;
    const cspSource = this.panel?.webview?.cspSource || 'vscode-resource:';

    const dest = state.destination || 'explore';
    const current = state.currentProblem;
    const currentTitle = current
      ? `${current.questionFrontendId}. ${current.title} (${current.difficulty})`
      : 'No problem selected';
    const currentFile = current
      ? `${current.fileName || 'Registered C++ solution'}${current.dirty ? ' (unsaved edits)' : ''}${!current.editorOpen ? ' (editor closed)' : ''}`
      : 'Open a problem from Explore or My Problems below to select a C++ solution.';

    const canOpenProblemDocs = Boolean(current);
    const canExecuteSolution = Boolean(current && current.editorOpen && !state.busy && !state.pendingJob);
    const canRunTests = Boolean(canExecuteSolution && current.enableRunCode !== false);
    const canManagePending = Boolean(state.pendingJob && !state.busy);
    const canAccountBusyFree = !state.busy;
    const canDisconnect = Boolean(!state.busy && state.account.kind !== 'signed_out');

    const noticeHtml = state.notice?.message
      ? `<div id="lc-notice-region"><div class="lc-notice${state.notice.kind === 'error' ? ' lc-notice-error' : state.notice.kind === 'warning' ? ' lc-notice-warning' : ''}" role="${state.notice.kind === 'error' ? 'alert' : 'status'}"><span>${escape(state.notice.message)}</span><button type="button" class="lc-btn lc-btn-secondary" data-action="dismissNotice">Dismiss</button></div></div>`
      : '<div id="lc-notice-region" hidden></div>';

    const diff = state.catalog.filters.difficulty || 'ANY';
    const statusVal = state.account.isVerified ? (state.catalog.filters.status || 'ALL') : 'ALL';
    const selectedTopicCount = Array.isArray(state.catalog.filters.tags) ? state.catalog.filters.tags.length : 0;

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escape(cspSource)}; script-src 'nonce-${escape(nonce)}'; img-src 'none'; font-src 'none'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none';">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LeetCode Dashboard</title>
  <link rel="stylesheet" href="${escape(String(cssUri))}">
</head>
<body>
  <div class="lc-dashboard">
    <header class="lc-header">
      <div class="lc-title-group">
        <h1 class="lc-title">LeetCode Dashboard</h1>
        <p class="lc-subtitle">Unified C++ problem discovery, local solutions, and remote execution</p>
      </div>
      <div class="lc-action-row">
        <span id="lc-account-summary-pill" class="lc-account-pill" aria-label="Account connection state">${escape(state.account.summary)}</span>
        <button type="button" class="lc-btn lc-btn-secondary" data-action="refresh" data-target="all">Refresh All</button>
      </div>
    </header>

    <section class="lc-current-problem" aria-label="Current Problem">
      <div class="lc-current-header">
        <div>
          <span class="lc-muted">Current Problem: </span>
          <span id="lc-current-problem-title" class="lc-current-title">${escape(currentTitle)}</span>
        </div>
        <span id="lc-current-problem-file" class="lc-current-file">${escape(currentFile)}</span>
      </div>
      <div class="lc-action-row" role="group" aria-label="Current Problem Actions">
        <button type="button" id="lc-action-openCode" class="lc-btn lc-btn-secondary" data-action="problemAction" data-kind="openCode" data-focus-key="action:openCode"${canOpenProblemDocs ? '' : ' disabled'} title="${canOpenProblemDocs ? 'Open or reveal the registered C++ solution editor' : 'Select a problem first'}">Open Code</button>
        <button type="button" id="lc-action-description" class="lc-btn lc-btn-secondary" data-action="problemAction" data-kind="description" data-focus-key="action:description"${canOpenProblemDocs ? '' : ' disabled'} title="${canOpenProblemDocs ? 'Show problem description' : 'Select a problem first'}">View Description</button>
        <button type="button" id="lc-action-run" class="lc-btn" data-action="problemAction" data-kind="run" data-focus-key="action:run"${canRunTests ? '' : ' disabled'} title="${canRunTests ? 'Run example testcases on LeetCode using the selected C++ buffer' : 'Requires an open selected C++ solution editor and no pending operation'}">Run Examples</button>
        <button type="button" id="lc-action-customInput" class="lc-btn lc-btn-secondary" data-action="problemAction" data-kind="customInput" data-focus-key="action:customInput"${canOpenProblemDocs ? '' : ' disabled'} title="${canOpenProblemDocs ? 'Edit custom test input file for the selected problem' : 'Select a problem first'}">Edit Custom Input</button>
        <button type="button" id="lc-action-runCustom" class="lc-btn lc-btn-secondary" data-action="problemAction" data-kind="runCustom" data-focus-key="action:runCustom"${canRunTests ? '' : ' disabled'} title="${canRunTests ? 'Run custom test input on LeetCode using the selected C++ buffer' : 'Requires an open selected C++ solution editor and no pending operation'}">Run Custom Input</button>
        <button type="button" id="lc-action-submit" class="lc-btn" data-action="problemAction" data-kind="submit" data-focus-key="action:submit"${canExecuteSolution ? '' : ' disabled'} title="${canExecuteSolution ? 'Submit selected C++ solution to LeetCode' : 'Requires an open selected C++ solution editor and no pending operation'}">Submit</button>
        <button type="button" id="lc-action-results" class="lc-btn lc-btn-secondary" data-action="problemAction" data-kind="results" data-focus-key="action:results" title="Show last completed remote result">Results</button>
        <details class="lc-details">
          <summary>More Actions</summary>
          <div class="lc-more-menu">
            <button type="button" id="lc-action-resume" class="lc-btn lc-btn-secondary" data-action="problemAction" data-kind="resume" data-focus-key="action:resume"${canManagePending ? '' : ' disabled'} title="${canManagePending ? 'Retrieve result of pending operation without resending code' : 'No pending operation to retrieve'}">Retrieve Pending Result</button>
            <button type="button" id="lc-action-clearPending" class="lc-btn lc-btn-secondary" data-action="problemAction" data-kind="clearPending" data-focus-key="action:clearPending"${canManagePending ? '' : ' disabled'} title="${canManagePending ? 'Clear pending operation lock after checking submission history' : 'No pending operation to clear'}">Clear Pending Operation</button>
            <button type="button" id="lc-action-folder" class="lc-btn lc-btn-secondary" data-action="problemAction" data-kind="folder" data-focus-key="action:folder" title="Reveal local C++ solutions folder">Open Solutions Folder</button>
          </div>
        </details>
      </div>
      <p id="lc-current-action-hint" class="lc-muted">${escape(computeActionHint(state))}</p>
      <div id="lc-pending-region">${renderPendingHtml(state.pendingJob, state.busy)}</div>
      <div id="lc-result-region">${renderLastResultHtml(state.lastResult)}</div>
    </section>

    ${noticeHtml}

    <nav class="lc-tabs" role="tablist" aria-label="Dashboard Destinations">
      <button type="button" id="lc-tab-explore" class="lc-tab" role="tab" data-action="navigate" data-destination="explore" aria-selected="${dest === 'explore' ? 'true' : 'false'}" aria-controls="lc-panel-explore" tabindex="${dest === 'explore' ? '0' : '-1'}">Explore</button>
      <button type="button" id="lc-tab-local" class="lc-tab" role="tab" data-action="navigate" data-destination="local" aria-selected="${dest === 'local' ? 'true' : 'false'}" aria-controls="lc-panel-local" tabindex="${dest === 'local' ? '0' : '-1'}">My Problems (${state.localProblems.length})</button>
      <button type="button" id="lc-tab-account" class="lc-tab" role="tab" data-action="navigate" data-destination="account" aria-selected="${dest === 'account' ? 'true' : 'false'}" aria-controls="lc-panel-account" tabindex="${dest === 'account' ? '0' : '-1'}">Account</button>
    </nav>

    <main>
      <section id="lc-panel-explore" class="lc-panel" role="tabpanel" aria-labelledby="lc-tab-explore" data-panel="explore"${dest === 'explore' ? '' : ' hidden'}>
        <article class="lc-card" aria-label="Daily Challenge">
          <div class="lc-card-header">
            <h2 class="lc-card-title">Daily Challenge</h2>
            <button type="button" class="lc-btn lc-btn-secondary" data-action="refresh" data-target="daily">Refresh Daily</button>
          </div>
          <div id="lc-daily-body">${renderDailyHtml(state.daily)}</div>
        </article>

        <article class="lc-card" aria-label="Browse and Filter Problems">
          <div class="lc-card-header">
            <h2 class="lc-card-title">Browse Problems</h2>
            <button type="button" class="lc-btn lc-btn-secondary" data-action="refresh" data-target="catalog">Refresh Problem List</button>
          </div>

          <div class="lc-filter-bar">
            <div class="lc-filter-group lc-search-group">
              <label for="lc-search-input" class="lc-label">Search by Title or Number</label>
              <div class="lc-input-row">
                <input id="lc-search-input" class="lc-input" type="search" maxlength="100" placeholder="e.g. 1, two sum, binary tree…" value="${escape(state.catalog.filters.query)}">
                <button type="button" id="lc-search-btn" class="lc-btn" data-action="submitSearch">Search</button>
              </div>
            </div>

            <div class="lc-filter-group">
              <label for="lc-difficulty-select" class="lc-label">Difficulty</label>
              <select id="lc-difficulty-select" class="lc-select" data-filter-select="difficulty" aria-label="Filter by Difficulty">
                <option value="ANY"${diff === 'ANY' ? ' selected' : ''}>Any Difficulty</option>
                <option value="EASY"${diff === 'EASY' ? ' selected' : ''}>Easy</option>
                <option value="MEDIUM"${diff === 'MEDIUM' ? ' selected' : ''}>Medium</option>
                <option value="HARD"${diff === 'HARD' ? ' selected' : ''}>Hard</option>
              </select>
            </div>

            <div class="lc-filter-group">
              <label for="lc-status-select" class="lc-label">Account Progress</label>
              <select id="lc-status-select" class="lc-select" data-filter-select="status" aria-label="Filter by Account Progress"${state.account.isVerified ? '' : ' disabled'} title="${state.account.isVerified ? 'Filter by verified LeetCode progress' : 'Verify your LeetCode session in Account to filter by progress'}">
                <option value="ALL"${statusVal === 'ALL' ? ' selected' : ''}>${state.account.isVerified ? 'All Progress' : 'Verify session to filter'}</option>
                <option value="AC"${statusVal === 'AC' ? ' selected' : ''}>Solved</option>
                <option value="TRIED"${statusVal === 'TRIED' ? ' selected' : ''}>Attempted</option>
                <option value="NOT_STARTED"${statusVal === 'NOT_STARTED' ? ' selected' : ''}>Not started</option>
              </select>
            </div>
          </div>

          <div class="lc-filter-group">
            <div class="lc-card-header">
              <span id="lc-topics-label" class="lc-label">Topics (${selectedTopicCount} selected)</span>
              <button type="button" class="lc-btn lc-btn-secondary" data-action="loadTopics">Load Topic Options</button>
            </div>
            <div id="lc-topics-body">${renderTopicsHtml(state.topics, state.catalog)}</div>
          </div>

          <p id="lc-filter-summary" class="lc-muted">Active summary: ${escape(state.catalog.filterSummary)}</p>
          <div id="lc-active-filters" class="lc-badge-row" aria-label="Active Filters">${renderActiveFiltersHtml(state.catalog, state.account)}</div>

          <div id="lc-catalog-body">${renderCatalogHtml(state.catalog, state.account)}</div>
          <div id="lc-pagination-bar" class="lc-pagination">${renderPaginationHtml(state.catalog)}</div>
        </article>
      </section>

      <section id="lc-panel-local" class="lc-panel" role="tabpanel" aria-labelledby="lc-tab-local" data-panel="local"${dest === 'local' ? '' : ' hidden'}>
        <article class="lc-card" aria-label="Saved Local Problems">
          <div class="lc-card-header">
            <h2 class="lc-card-title">My Problems (Local C++ Solutions)</h2>
            <button type="button" class="lc-btn lc-btn-secondary" data-action="refresh" data-target="local">Refresh Local List</button>
          </div>
          <p class="lc-muted">Saved solutions on disk remain usable offline without overwriting your work. Local availability is distinct from remotely solved status on LeetCode.</p>
          <div id="lc-local-body">${renderLocalHtml(state.localProblems)}</div>
        </article>
      </section>

      <section id="lc-panel-account" class="lc-panel" role="tabpanel" aria-labelledby="lc-tab-account" data-panel="account"${dest === 'account' ? '' : ' hidden'}>
        <article class="lc-card" aria-label="Account Connection">
          <div class="lc-card-header">
            <h2 class="lc-card-title">Account &amp; Session Status</h2>
          </div>
          <p id="lc-account-status-text" class="lc-item-title">Status: ${escape(state.account.summary)}</p>
          <p id="lc-account-detail-text" class="lc-muted">${escape(formatAccountGuidance(state.account, state.busy))}</p>
          <div class="lc-action-row">
            <button type="button" id="lc-account-openSignIn" class="lc-btn" data-action="accountAction" data-kind="openSignIn" data-focus-key="account:openSignIn" title="Open leetcode.com/accounts/login/ in your default browser (browser sign-in does not automatically transfer cookies to VS Code)">Open LeetCode Sign-in</button>
            <button type="button" id="lc-account-checkSession" class="lc-btn lc-btn-secondary" data-action="accountAction" data-kind="checkSession" data-focus-key="account:checkSession"${canAccountBusyFree ? '' : ' disabled'} title="${canAccountBusyFree ? 'Verify the saved session in VS Code SecretStorage against LeetCode' : 'Finish the current operation before checking your session'}">Check Saved Session</button>
            <button type="button" id="lc-account-disconnect" class="lc-btn lc-btn-secondary" data-action="accountAction" data-kind="disconnect" data-focus-key="account:disconnect"${canDisconnect ? '' : ' disabled'} title="${canDisconnect ? 'Remove the saved LeetCode session from VS Code SecretStorage' : (state.busy ? 'Finish the current operation before disconnecting' : 'No saved session in SecretStorage to disconnect')}">Disconnect Account</button>
          </div>
        </article>

        <article class="lc-card" aria-label="Advanced Session Import">
          <div class="lc-card-header">
            <h2 class="lc-card-title">Advanced: Import Session</h2>
          </div>
          <p class="lc-muted">Browser sign-in does not transfer cookies automatically. Use Advanced: Import Session to paste <code>LEETCODE_SESSION</code> and <code>csrftoken</code> values into VS Code's native masked input dialogs. Credentials are validated before saving to VS Code SecretStorage and are never entered or stored in this webview.</p>
          <div class="lc-action-row">
            <button type="button" id="lc-account-importSession" class="lc-btn lc-btn-secondary" data-action="accountAction" data-kind="importSession" data-focus-key="account:importSession"${canAccountBusyFree ? '' : ' disabled'} title="${canAccountBusyFree ? 'Import LEETCODE_SESSION and csrftoken via native masked VS Code input dialogs' : 'Finish the current operation before importing a session'}">Advanced: Import Session</button>
          </div>
        </article>
      </section>
    </main>
  </div>
  <script id="lc-initial-state" type="application/json" nonce="${escape(nonce)}">${serializeStateForHtml(state)}</script>
  <script nonce="${escape(nonce)}" src="${escape(String(jsUri))}"></script>
</body>
</html>`;
  }
}

module.exports = {
  LeetCodeDashboard,
  DASHBOARD_VIEW_TYPE,
  VALID_DESTINATIONS,
  VALID_REFRESH_TARGETS,
  G1_ACTIVE_ACTIONS,
  PLANNED_ACTIONS,
  validateDashboardMessage,
  serializeStateForHtml,
  summarizeResultForView
};
