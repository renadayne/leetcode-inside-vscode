'use strict';

const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { escape } = require('./render');
const {
  boundText,
  formatAccountSummary,
  formatFilterSummary
} = require('./explorer');

const DASHBOARD_VIEW_TYPE = 'lc.dashboard';
const VALID_DESTINATIONS = new Set(['explore', 'local', 'account']);
const VALID_REFRESH_TARGETS = new Set(['all', 'daily', 'catalog', 'local']);
const G1_ACTIVE_ACTIONS = new Set(['ready', 'navigate', 'refresh', 'dismissNotice']);
const PLANNED_ACTIONS = new Set([
  'openProblem',
  'openLocal',
  'setFilters',
  'changePage',
  'problemAction',
  'accountAction'
]);
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

  if (action === 'ready' || action === 'dismissNotice') {
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

  if (PLANNED_ACTIONS.has(action)) {
    if (action === 'openProblem' || action === 'openLocal') {
      if (!hasOnlyAllowedKeys(raw, new Set(['action', 'type', 'titleSlug'])) || !isValidSlug(raw.titleSlug)) {
        return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid problem slug in dashboard message.' };
      }
    } else if (action === 'changePage') {
      if (!hasOnlyAllowedKeys(raw, new Set(['action', 'type', 'direction'])) || (raw.direction !== 'next' && raw.direction !== 'prev')) {
        return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid pagination direction.' };
      }
    } else if (action === 'problemAction') {
      if (!hasOnlyAllowedKeys(raw, new Set(['action', 'type', 'kind'])) || typeof raw.kind !== 'string' || !VALID_PROBLEM_ACTIONS.has(raw.kind)) {
        return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid problem action kind.' };
      }
    } else if (action === 'accountAction') {
      if (!hasOnlyAllowedKeys(raw, new Set(['action', 'type', 'kind'])) || typeof raw.kind !== 'string' || !VALID_ACCOUNT_ACTIONS.has(raw.kind)) {
        return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid account action kind.' };
      }
    } else if (action === 'setFilters') {
      if (!hasOnlyAllowedKeys(raw, new Set(['action', 'type', 'filters'])) || !isPlainObject(raw.filters)) {
        return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid filters payload.' };
      }
      for (const k of Object.keys(raw.filters)) {
        if (FORBIDDEN_MESSAGE_KEYS.has(k) || !['query', 'difficulty', 'tags', 'status'].includes(k)) {
          return { ok: false, code: 'INVALID_MESSAGE', message: 'Invalid filter property.' };
        }
      }
    }
    return {
      ok: false,
      code: 'UNIMPLEMENTED',
      action,
      message: `Action "${action}" is not yet implemented in G1 (Dashboard shell). Use the LeetCode sidebar or editor commands until G2–G4 are completed.`
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

  let html = `<div class="lc-list-item"><div class="lc-item-main"><div class="lc-item-title">${escape(q.questionFrontendId)}. ${escape(q.title)}</div><div class="lc-item-meta">${escape(metaParts.join(' · '))}</div></div><button type="button" class="lc-btn lc-btn-secondary" disabled title="Opening problems directly from the dashboard is scheduled for G2. Use the LeetCode sidebar in G1.">Open (Planned in G2)</button></div>`;

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
    return '<div class="lc-status-box"><span>No matching LeetCode problems found.</span></div>';
  }

  const items = questions.map(q => {
    const metaParts = [q.difficulty];
    if (!q.supported) metaParts.push('Unsupported ID');
    if (q.isPaidOnly) metaParts.push('Premium');
    if (account.isVerified && q.progress) metaParts.push(q.progress);
    return `<li class="lc-list-item"><div class="lc-item-main"><div class="lc-item-title">${escape(q.questionFrontendId)}. ${escape(q.title)}</div><div class="lc-item-meta">${escape(metaParts.join(' · '))}</div></div><button type="button" class="lc-btn lc-btn-secondary" disabled title="Direct problem opening in the dashboard is scheduled for G2. Use the LeetCode sidebar in G1.">Open (Planned in G2)</button></li>`;
  }).join('');

  return `<ul class="lc-list">${items}</ul>`;
}

function renderLocalHtml(localProblems) {
  if (!Array.isArray(localProblems) || localProblems.length === 0) {
    return '<div class="lc-status-box"><span>No saved local problems yet. Open a problem to create a local C++ solution file.</span></div>';
  }
  const items = localProblems.map(q =>
    `<li class="lc-list-item"><div class="lc-item-main"><div class="lc-item-title">${escape(q.questionFrontendId)}. ${escape(q.title)}</div><div class="lc-item-meta">${escape(q.difficulty)} · ${escape(q.availability || 'Available locally')}</div></div><button type="button" class="lc-btn lc-btn-secondary" disabled title="Reopening local solutions from the dashboard is scheduled for G2. Use the LeetCode sidebar Local Problems section in G1.">Open Local (Planned in G2)</button></li>`
  ).join('');
  return `<ul class="lc-list">${items}</ul>`;
}

class LeetCodeDashboard {
  constructor(vscode, context, options = {}) {
    this.vscode = vscode;
    this.context = context;
    this.discovery = options.discovery;
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

    return {
      phase: 'G1',
      destination: VALID_DESTINATIONS.has(this.destination) ? this.destination : 'explore',
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
            fileName: current.fileName ? boundText(current.fileName, 120) : null
          }
        : null,
      daily: {
        status: daily.status || 'idle',
        stale: Boolean(daily.stale),
        date: daily.data?.date ? boundText(daily.data.date, 20) : null,
        error: daily.error ? boundText(daily.error, 160) : null,
        question: daily.data?.question ? sanitizeQuestionForView(daily.data.question, isVerified) : null
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
      if (this.discovery) {
        if (target === 'daily') {
          await this.discovery.refreshDaily();
        } else if (target === 'catalog') {
          await this.discovery.refreshCatalog();
        } else if (target === 'all') {
          await this.discovery.refreshAll();
        }
      }
      await this.refresh();
      return { ok: true, action: 'refresh', target };
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
      ? (current.fileName || 'Registered C++ solution')
      : 'Select a problem via the LeetCode sidebar or Open Problem command (dashboard selection wiring in G2/G3).';

    const noticeHtml = state.notice?.message
      ? `<div id="lc-notice-region"><div class="lc-notice${state.notice.kind === 'error' ? ' lc-notice-error' : state.notice.kind === 'warning' ? ' lc-notice-warning' : ''}" role="${state.notice.kind === 'error' ? 'alert' : 'status'}"><span>${escape(state.notice.message)}</span><button type="button" class="lc-btn lc-btn-secondary" data-action="dismissNotice">Dismiss</button></div></div>`
      : '<div id="lc-notice-region" hidden></div>';

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
        <p class="lc-subtitle">Unified C++ practice shell (G1 shell · G2–G4 interactive actions labeled below)</p>
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
        <button type="button" class="lc-btn lc-btn-secondary" disabled title="Planned in G3: Open Code editor action.">Open Code (G3)</button>
        <button type="button" class="lc-btn lc-btn-secondary" disabled title="Planned in G3: View Problem Description.">View Description (G3)</button>
        <button type="button" class="lc-btn lc-btn-secondary" disabled title="Planned in G3: Run Examples on LeetCode.">Run Examples (G3)</button>
        <button type="button" class="lc-btn lc-btn-secondary" disabled title="Planned in G3: Edit and run Custom Input.">Custom Input (G3)</button>
        <button type="button" class="lc-btn lc-btn-secondary" disabled title="Planned in G3: Submit C++ solution to LeetCode.">Submit (G3)</button>
        <button type="button" class="lc-btn lc-btn-secondary" disabled title="Planned in G3: Show saved remote results.">Results (G3)</button>
        <details class="lc-details">
          <summary>More Actions</summary>
          <div class="lc-more-menu">
            <button type="button" class="lc-btn lc-btn-secondary" disabled title="Planned in G3/G4: Retrieve Pending Result.">Retrieve Pending Result (G3)</button>
            <button type="button" class="lc-btn lc-btn-secondary" disabled title="Planned in G3/G4: Clear Pending Operation.">Clear Pending Operation (G3)</button>
            <button type="button" class="lc-btn lc-btn-secondary" disabled title="Planned in G3/G4: Open Local Solutions Folder.">Open Solutions Folder (G4)</button>
          </div>
        </details>
      </div>
      <p class="lc-muted">G1 Shell Note: Solution execution and editor actions are scheduled for G3. Use the editor title buttons, CodeLens, or sidebar in G1.</p>
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
          <p id="lc-filter-summary" class="lc-muted">Active summary: ${escape(state.catalog.filterSummary)}</p>
          <div class="lc-badge-row">
            <span class="lc-badge">Search: ${escape(state.catalog.filters.query || 'Any')}</span>
            <span class="lc-badge">Difficulty: ${escape(state.catalog.filters.difficulty)}</span>
            <span class="lc-badge">Topics: ${escape(state.catalog.filters.tags.length ? state.catalog.filters.tags.join(', ') : 'Any')}</span>
            <span class="lc-badge">Progress: ${escape(state.account.isVerified ? state.catalog.filters.status : 'Verify session to filter')}</span>
          </div>
          <p class="lc-muted">Interactive search, difficulty/topic/progress filter controls, pagination, and click-to-open are scheduled for G2 (currently synced with the LeetCode sidebar).</p>
          <div id="lc-catalog-body">${renderCatalogHtml(state.catalog, state.account)}</div>
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
          <p id="lc-account-detail-text" class="lc-muted">${escape(state.account.detail || 'Browser sign-in alone never marks VS Code connected. Credentials are kept in VS Code SecretStorage.')}</p>
          <div class="lc-action-row">
            <button type="button" class="lc-btn lc-btn-secondary" disabled title="Planned in G4: Open LeetCode Sign-in in browser.">Open LeetCode Sign-in (G4)</button>
            <button type="button" class="lc-btn lc-btn-secondary" disabled title="Planned in G4: Check Saved Session in SecretStorage.">Check Saved Session (G4)</button>
            <button type="button" class="lc-btn lc-btn-secondary" disabled title="Planned in G4: Advanced: Import Session via native masked input dialogs.">Advanced: Import Session (G4)</button>
            <button type="button" class="lc-btn lc-btn-secondary" disabled title="Planned in G4: Disconnect Account from VS Code.">Disconnect Account (G4)</button>
          </div>
          <p class="lc-muted">G1 Shell Note: Account actions in the dashboard are scheduled for G4. Credentials are never collected in HTML; use the LeetCode sidebar Account section in G1.</p>
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
  serializeStateForHtml
};
