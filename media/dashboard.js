(function () {
  'use strict';

  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  const DESTINATIONS = ['explore', 'local', 'account'];
  const STATUS_LABELS = {
    ALL: 'All',
    AC: 'Solved',
    TRIED: 'Attempted',
    NOT_STARTED: 'Not started'
  };

  let searchDraftDirty = false;
  let lastCommittedQuery = '';

  function postAction(payload) {
    if (vscode && typeof vscode.postMessage === 'function') {
      vscode.postMessage(payload);
    }
  }

  function clearChildren(node) {
    while (node && node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) {
      el.textContent = String(text);
    }
    return el;
  }

  function setDestinationDom(destination) {
    const active = DESTINATIONS.includes(destination) ? destination : 'explore';
    const tabs = document.querySelectorAll('[role="tab"][data-destination]');
    for (const tab of tabs) {
      const isSelected = tab.getAttribute('data-destination') === active;
      tab.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      tab.setAttribute('tabindex', isSelected ? '0' : '-1');
    }
    const panels = document.querySelectorAll('[role="tabpanel"][data-panel]');
    for (const panel of panels) {
      const isMatch = panel.getAttribute('data-panel') === active;
      if (isMatch) {
        panel.removeAttribute('hidden');
      } else {
        panel.setAttribute('hidden', 'hidden');
      }
    }
  }

  function computeActionHint(state) {
    if (state.busy) {
      return 'Remote operation in progress on LeetCode… Duplicate runs and submissions are blocked until completion.';
    }
    if (state.pendingJob) {
      return (
        'Pending ' +
        (state.pendingJob.kind === 'submit' ? 'submission' : 'remote test') +
        ' for ' +
        state.pendingJob.number +
        '. ' +
        state.pendingJob.title +
        '. Use "Retrieve Pending Result" or "Clear Pending Operation" under More Actions before running or submitting again.'
      );
    }
    if (!state.currentProblem) {
      return 'No problem selected. Click "Open" on any problem in Explore or My Problems to select a C++ solution.';
    }
    if (!state.currentProblem.editorOpen) {
      return (
        'The editor for ' +
        (state.currentProblem.fileName || 'this solution') +
        ' is closed. Click "Open Code" to reopen the C++ solution before running or submitting.'
      );
    }
    return (
      'Target locked to ' +
      (state.currentProblem.fileName || 'registered C++ solution') +
      (state.currentProblem.dirty ? ' (includes unsaved editor changes)' : '') +
      '. Moving focus to this dashboard will not change the target file.'
    );
  }

  function renderNotice(state) {
    const container = document.getElementById('lc-notice-region');
    if (!container) return;
    clearChildren(container);
    if (!state || !state.notice || !state.notice.message) {
      container.setAttribute('hidden', 'hidden');
      return;
    }
    container.removeAttribute('hidden');
    const kind = state.notice.kind || 'info';
    const box = createEl(
      'div',
      'lc-notice' + (kind === 'error' ? ' lc-notice-error' : kind === 'warning' ? ' lc-notice-warning' : '')
    );
    box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    box.appendChild(createEl('span', '', state.notice.message));

    const dismissBtn = createEl('button', 'lc-btn lc-btn-secondary', 'Dismiss');
    dismissBtn.type = 'button';
    dismissBtn.setAttribute('data-action', 'dismissNotice');
    box.appendChild(dismissBtn);
    container.appendChild(box);
  }

  function updateButtonState(id, enabled, enabledTitle, disabledTitle) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = !enabled;
    btn.title = enabled ? enabledTitle : disabledTitle;
  }

  function renderPendingAndResult(state) {
    const pendingRegion = document.getElementById('lc-pending-region');
    if (pendingRegion) {
      clearChildren(pendingRegion);
      if (state.pendingJob) {
        const box = createEl('div', 'lc-status-box');
        box.setAttribute('role', 'status');
        const label =
          'Pending ' +
          (state.pendingJob.kind === 'submit' ? 'submission' : 'test') +
          ': ' +
          state.pendingJob.number +
          '. ' +
          state.pendingJob.title +
          (state.pendingJob.id ? ' (ID: ' + state.pendingJob.id + ')' : ' (unconfirmed ID)');
        box.appendChild(createEl('span', '', label));

        const actions = createEl('div', 'lc-action-row');
        const resumeBtn = createEl('button', 'lc-btn', 'Retrieve Pending Result');
        resumeBtn.type = 'button';
        resumeBtn.disabled = Boolean(state.busy);
        resumeBtn.setAttribute('data-action', 'problemAction');
        resumeBtn.setAttribute('data-kind', 'resume');
        actions.appendChild(resumeBtn);

        const clearBtn = createEl('button', 'lc-btn lc-btn-secondary', 'Clear Pending Operation');
        clearBtn.type = 'button';
        clearBtn.disabled = Boolean(state.busy);
        clearBtn.setAttribute('data-action', 'problemAction');
        clearBtn.setAttribute('data-kind', 'clearPending');
        actions.appendChild(clearBtn);

        box.appendChild(actions);
        pendingRegion.appendChild(box);
      }
    }

    const resultRegion = document.getElementById('lc-result-region');
    if (resultRegion) {
      clearChildren(resultRegion);
      const r = state.lastResult;
      if (r) {
        const box = createEl('div', 'lc-status-box');
        box.setAttribute('role', 'region');
        box.setAttribute('aria-label', 'Latest Remote Result');
        const main = createEl('div', 'lc-item-main');
        main.appendChild(
          createEl(
            'div',
            'lc-item-title',
            r.heading + ' · ' + r.problemNumber + '. ' + r.problemTitle + ' — Verdict: ' + r.verdict
          )
        );
        const details = [];
        if (r.runtime) details.push('Runtime: ' + r.runtime);
        if (r.memory) details.push('Memory: ' + r.memory);
        if (r.passed) details.push('Passed: ' + r.passed);
        if (r.editorVersion !== null && r.editorVersion !== undefined) {
          details.push('Editor v' + r.editorVersion);
        }
        if (details.length > 0) {
          main.appendChild(createEl('div', 'lc-item-meta', details.join(' · ')));
        }
        const extra = [];
        if (r.actualOutput) extra.push('Actual: ' + r.actualOutput);
        if (r.expectedOutput) extra.push('Expected: ' + r.expectedOutput);
        if (r.failingInput) extra.push('Input: ' + r.failingInput);
        if (r.compileError) extra.push('Compiler: ' + r.compileError);
        if (r.runtimeError) extra.push('Runtime error: ' + r.runtimeError);
        if (extra.length > 0) {
          main.appendChild(createEl('div', 'lc-item-meta', extra.join(' | ')));
        }
        box.appendChild(main);
        resultRegion.appendChild(box);
      }
    }
  }

  function renderHeaderAndCurrent(state) {
    const pill = document.getElementById('lc-account-summary-pill');
    if (pill && state.account) {
      pill.textContent = state.account.summary || 'Signed out';
    }

    const localTab = document.getElementById('lc-tab-local');
    if (localTab && Array.isArray(state.localProblems)) {
      localTab.textContent = 'My Problems (' + state.localProblems.length + ')';
    }

    const current = state.currentProblem;
    const currentTitle = document.getElementById('lc-current-problem-title');
    const currentFile = document.getElementById('lc-current-problem-file');
    if (currentTitle && currentFile) {
      if (current) {
        currentTitle.textContent =
          current.questionFrontendId + '. ' + current.title + ' (' + current.difficulty + ')';
        currentFile.textContent =
          (current.fileName || 'Registered C++ solution') +
          (current.dirty ? ' (unsaved edits)' : '') +
          (!current.editorOpen ? ' (editor closed)' : '');
      } else {
        currentTitle.textContent = 'No problem selected';
        currentFile.textContent = 'Open a problem from Explore or My Problems below to select a C++ solution.';
      }
    }

    const canOpenProblemDocs = Boolean(current);
    const canExecuteSolution = Boolean(current && current.editorOpen && !state.busy && !state.pendingJob);
    const canRunTests = Boolean(canExecuteSolution && current.enableRunCode !== false);
    const canManagePending = Boolean(state.pendingJob && !state.busy);

    updateButtonState(
      'lc-action-openCode',
      canOpenProblemDocs,
      'Open or reveal the registered C++ solution editor',
      'Select a problem first'
    );
    updateButtonState(
      'lc-action-description',
      canOpenProblemDocs,
      'Show problem description',
      'Select a problem first'
    );
    updateButtonState(
      'lc-action-run',
      canRunTests,
      'Run example testcases on LeetCode using the selected C++ buffer',
      'Requires an open selected C++ solution editor and no pending operation'
    );
    updateButtonState(
      'lc-action-customInput',
      canOpenProblemDocs,
      'Edit custom test input file for the selected problem',
      'Select a problem first'
    );
    updateButtonState(
      'lc-action-runCustom',
      canRunTests,
      'Run custom test input on LeetCode using the selected C++ buffer',
      'Requires an open selected C++ solution editor and no pending operation'
    );
    updateButtonState(
      'lc-action-submit',
      canExecuteSolution,
      'Submit selected C++ solution to LeetCode',
      'Requires an open selected C++ solution editor and no pending operation'
    );
    updateButtonState(
      'lc-action-resume',
      canManagePending,
      'Retrieve result of pending operation without resending code',
      'No pending operation to retrieve'
    );
    updateButtonState(
      'lc-action-clearPending',
      canManagePending,
      'Clear pending operation lock after checking submission history',
      'No pending operation to clear'
    );

    const hintEl = document.getElementById('lc-current-action-hint');
    if (hintEl) {
      hintEl.textContent = computeActionHint(state);
    }

    renderPendingAndResult(state);
  }

  function syncFilterControls(catalog, account) {
    if (!catalog || !catalog.filters) return;
    const filters = catalog.filters;
    const isVerified = Boolean(account && account.isVerified);
    const serverQuery = filters.query || '';

    const searchInput = document.getElementById('lc-search-input');
    if (searchInput) {
      const isFocused = document.activeElement === searchInput;
      if (!searchDraftDirty && !isFocused) {
        searchInput.value = serverQuery;
      } else if (serverQuery !== lastCommittedQuery && !isFocused) {
        searchInput.value = serverQuery;
        searchDraftDirty = false;
      }
      lastCommittedQuery = serverQuery;
    }

    const diffSelect = document.getElementById('lc-difficulty-select');
    if (diffSelect && document.activeElement !== diffSelect) {
      diffSelect.value = filters.difficulty || 'ANY';
    }

    const statusSelect = document.getElementById('lc-status-select');
    if (statusSelect) {
      statusSelect.disabled = !isVerified;
      statusSelect.title = isVerified
        ? 'Filter by verified LeetCode progress'
        : 'Verify your LeetCode session in Account to filter by progress';
      const allOpt = statusSelect.querySelector('option[value="ALL"]');
      if (allOpt) {
        allOpt.textContent = isVerified ? 'All Progress' : 'Verify session to filter';
      }
      if (document.activeElement !== statusSelect) {
        statusSelect.value = isVerified && filters.status ? filters.status : 'ALL';
      }
    }
  }

  function renderActiveFilters(catalog, account) {
    const summaryEl = document.getElementById('lc-filter-summary');
    if (summaryEl && catalog) {
      summaryEl.textContent = 'Active summary: ' + (catalog.filterSummary || 'All problems');
    }

    const container = document.getElementById('lc-active-filters');
    if (!container || !catalog || !catalog.filters) return;
    clearChildren(container);

    const filters = catalog.filters;
    const isVerified = Boolean(account && account.isVerified);
    let anyChip = false;

    if (filters.query) {
      anyChip = true;
      const chip = createEl('button', 'lc-chip', 'Search: "' + filters.query + '" ×');
      chip.type = 'button';
      chip.setAttribute('data-action', 'removeFilter');
      chip.setAttribute('data-filter-kind', 'query');
      chip.setAttribute('data-focus-key', 'chip:query');
      chip.title = 'Remove search filter';
      container.appendChild(chip);
    }

    if (filters.difficulty && filters.difficulty !== 'ANY') {
      anyChip = true;
      const chip = createEl('button', 'lc-chip', 'Difficulty: ' + filters.difficulty + ' ×');
      chip.type = 'button';
      chip.setAttribute('data-action', 'removeFilter');
      chip.setAttribute('data-filter-kind', 'difficulty');
      chip.setAttribute('data-focus-key', 'chip:difficulty');
      chip.title = 'Remove difficulty filter';
      container.appendChild(chip);
    }

    if (Array.isArray(filters.tags)) {
      for (const tag of filters.tags) {
        anyChip = true;
        const chip = createEl('button', 'lc-chip', 'Topic: ' + tag + ' ×');
        chip.type = 'button';
        chip.setAttribute('data-action', 'removeFilter');
        chip.setAttribute('data-filter-kind', 'tag');
        chip.setAttribute('data-filter-value', tag);
        chip.setAttribute('data-focus-key', 'chip:tag:' + tag);
        chip.title = 'Remove topic filter ' + tag;
        container.appendChild(chip);
      }
    }

    if (isVerified && filters.status && filters.status !== 'ALL') {
      anyChip = true;
      const label = STATUS_LABELS[filters.status] || filters.status;
      const chip = createEl('button', 'lc-chip', 'Progress: ' + label + ' ×');
      chip.type = 'button';
      chip.setAttribute('data-action', 'removeFilter');
      chip.setAttribute('data-filter-kind', 'status');
      chip.setAttribute('data-focus-key', 'chip:status');
      chip.title = 'Remove progress filter';
      container.appendChild(chip);
    }

    if (anyChip || catalog.hasActiveFilters) {
      const clearBtn = createEl('button', 'lc-btn lc-btn-secondary', 'Clear Filters');
      clearBtn.type = 'button';
      clearBtn.setAttribute('data-action', 'clearFilters');
      clearBtn.setAttribute('data-focus-key', 'clear-filters');
      container.appendChild(clearBtn);
    }
  }

  function renderTopics(topicsState, catalog) {
    const body = document.getElementById('lc-topics-body');
    if (!body) return;
    clearChildren(body);

    const selected = new Set((catalog && catalog.filters && catalog.filters.tags) || []);
    const labelEl = document.getElementById('lc-topics-label');
    if (labelEl) {
      labelEl.textContent = 'Topics (' + selected.size + ' selected)';
    }

    if (!topicsState || topicsState.status === 'idle') {
      if (selected.size > 0) {
        const row = createEl('div', 'lc-badge-row');
        for (const slug of selected) {
          const btn = createEl('button', 'lc-topic-btn', slug);
          btn.type = 'button';
          btn.setAttribute('aria-pressed', 'true');
          btn.setAttribute('data-action', 'toggleTopic');
          btn.setAttribute('data-tag', slug);
          btn.setAttribute('data-focus-key', 'topic:' + slug);
          row.appendChild(btn);
        }
        body.appendChild(row);
      }
      return;
    }

    if (topicsState.status === 'loading') {
      const box = createEl('div', 'lc-status-box');
      box.setAttribute('role', 'status');
      box.appendChild(createEl('span', '', 'Loading topic tags…'));
      body.appendChild(box);
      return;
    }

    if (topicsState.status === 'error') {
      const box = createEl('div', 'lc-status-box lc-status-error');
      box.setAttribute('role', 'alert');
      box.appendChild(createEl('span', '', topicsState.error || 'Could not load topic tags.'));
      const retry = createEl('button', 'lc-btn', 'Retry Topics');
      retry.type = 'button';
      retry.setAttribute('data-action', 'loadTopics');
      retry.setAttribute('data-force', 'true');
      box.appendChild(retry);
      body.appendChild(box);
      return;
    }

    const items = Array.isArray(topicsState.items) ? topicsState.items : [];
    if (items.length === 0) return;

    const row = createEl('div', 'lc-badge-row');
    for (const t of items) {
      const isSelected = selected.has(t.slug);
      const btn = createEl('button', 'lc-topic-btn', t.name);
      btn.type = 'button';
      btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      btn.setAttribute('data-action', 'toggleTopic');
      btn.setAttribute('data-tag', t.slug);
      btn.setAttribute('data-focus-key', 'topic:' + t.slug);
      row.appendChild(btn);
    }
    body.appendChild(row);
  }

  function renderDaily(daily) {
    const body = document.getElementById('lc-daily-body');
    if (!body || !daily) return;
    clearChildren(body);

    if (daily.status === 'loading' && !daily.question) {
      const box = createEl('div', 'lc-status-box');
      box.setAttribute('role', 'status');
      box.appendChild(createEl('span', '', 'Loading Daily Challenge…'));
      body.appendChild(box);
      return;
    }

    if (daily.status === 'error' && !daily.question) {
      const box = createEl('div', 'lc-status-box lc-status-error');
      box.setAttribute('role', 'alert');
      box.appendChild(createEl('span', '', daily.error || 'Could not load Daily Challenge.'));
      const retry = createEl('button', 'lc-btn', 'Retry Daily Challenge');
      retry.type = 'button';
      retry.setAttribute('data-action', 'refresh');
      retry.setAttribute('data-target', 'daily');
      box.appendChild(retry);
      body.appendChild(box);
      return;
    }

    if (!daily.question) {
      const box = createEl('div', 'lc-status-box');
      box.appendChild(createEl('span', '', 'Daily Challenge not loaded yet.'));
      const loadBtn = createEl('button', 'lc-btn', 'Load Daily Challenge');
      loadBtn.type = 'button';
      loadBtn.setAttribute('data-action', 'refresh');
      loadBtn.setAttribute('data-target', 'daily');
      box.appendChild(loadBtn);
      body.appendChild(box);
      return;
    }

    const q = daily.question;
    const row = createEl('div', 'lc-list-item');
    const main = createEl('div', 'lc-item-main');
    main.appendChild(createEl('div', 'lc-item-title', q.questionFrontendId + '. ' + q.title));

    const metaParts = [];
    if (daily.date) metaParts.push(daily.date + (daily.stale ? ' (stale)' : ''));
    metaParts.push(q.difficulty);
    if (!q.supported) metaParts.push('Unsupported ID');
    if (q.isPaidOnly) metaParts.push('Premium');
    if (q.progress) metaParts.push(q.progress);
    main.appendChild(createEl('div', 'lc-item-meta', metaParts.join(' · ')));
    row.appendChild(main);

    const openBtn = createEl(
      'button',
      q.supported ? 'lc-btn' : 'lc-btn lc-btn-secondary',
      q.supported ? 'Open Daily Challenge' : 'Unsupported ID'
    );
    openBtn.type = 'button';
    openBtn.setAttribute('data-action', 'openProblem');
    openBtn.setAttribute('data-slug', q.titleSlug);
    openBtn.setAttribute('data-focus-key', 'daily-open:' + q.titleSlug);
    openBtn.title = q.supported
      ? (q.isPaidOnly ? 'Premium problem — requires active LeetCode subscription' : 'Open Daily Challenge in editor')
      : 'Non-numeric problem IDs are not supported by the C++ workflow';
    row.appendChild(openBtn);
    body.appendChild(row);

    if (daily.stale) {
      const staleBox = createEl('div', 'lc-status-box lc-status-error');
      staleBox.setAttribute('role', 'status');
      staleBox.appendChild(
        createEl('span', '', 'Refresh failed (' + (daily.error || 'network error') + '). Showing last known date ' + (daily.date || '') + '.')
      );
      const retry = createEl('button', 'lc-btn', 'Retry Daily Challenge');
      retry.type = 'button';
      retry.setAttribute('data-action', 'refresh');
      retry.setAttribute('data-target', 'daily');
      staleBox.appendChild(retry);
      body.appendChild(staleBox);
    }
  }

  function renderCatalog(catalog, account) {
    const body = document.getElementById('lc-catalog-body');
    const pageBar = document.getElementById('lc-pagination-bar');
    if (!body || !catalog) return;
    clearChildren(body);
    if (pageBar) clearChildren(pageBar);

    if (catalog.status === 'loading') {
      const box = createEl('div', 'lc-status-box');
      box.setAttribute('role', 'status');
      box.appendChild(createEl('span', '', 'Loading problems…'));
      body.appendChild(box);
      return;
    }

    if (catalog.status === 'error') {
      const box = createEl('div', 'lc-status-box lc-status-error');
      box.setAttribute('role', 'alert');
      box.appendChild(createEl('span', '', catalog.error || 'Could not load problems.'));
      const retry = createEl('button', 'lc-btn', 'Retry Problem List');
      retry.type = 'button';
      retry.setAttribute('data-action', 'refresh');
      retry.setAttribute('data-target', 'catalog');
      box.appendChild(retry);
      body.appendChild(box);
      return;
    }

    const questions = Array.isArray(catalog.questions) ? catalog.questions : [];
    if (questions.length === 0) {
      const box = createEl('div', 'lc-status-box');
      box.appendChild(createEl('span', '', 'No matching LeetCode problems found.'));
      if (catalog.hasActiveFilters) {
        const clearBtn = createEl('button', 'lc-btn lc-btn-secondary', 'Clear Filters');
        clearBtn.type = 'button';
        clearBtn.setAttribute('data-action', 'clearFilters');
        box.appendChild(clearBtn);
      }
      body.appendChild(box);
      return;
    }

    const list = createEl('ul', 'lc-list');
    for (const q of questions) {
      const item = createEl('li', 'lc-list-item');
      const main = createEl('div', 'lc-item-main');
      main.appendChild(createEl('div', 'lc-item-title', q.questionFrontendId + '. ' + q.title));

      const metaParts = [q.difficulty];
      if (!q.supported) metaParts.push('Unsupported ID');
      if (q.isPaidOnly) metaParts.push('Premium');
      if (account && account.isVerified && q.progress) {
        metaParts.push(q.progress);
      }
      if (Array.isArray(q.topicTags) && q.topicTags.length > 0) {
        metaParts.push(q.topicTags.map(function (t) { return t.name; }).join(', '));
      }
      main.appendChild(createEl('div', 'lc-item-meta', metaParts.join(' · ')));
      item.appendChild(main);

      const openBtn = createEl(
        'button',
        q.supported ? 'lc-btn' : 'lc-btn lc-btn-secondary',
        q.supported ? 'Open' : 'Unsupported ID'
      );
      openBtn.type = 'button';
      openBtn.setAttribute('data-action', 'openProblem');
      openBtn.setAttribute('data-slug', q.titleSlug);
      openBtn.setAttribute('data-focus-key', 'catalog-open:' + q.titleSlug);
      openBtn.title = q.supported
        ? (q.isPaidOnly ? 'Premium problem — requires active LeetCode subscription' : 'Open problem in editor')
        : 'Non-numeric problem IDs are not supported by the C++ workflow';
      item.appendChild(openBtn);
      list.appendChild(item);
    }
    body.appendChild(list);

    if (pageBar) {
      const start = catalog.skip + 1;
      const end = catalog.skip + questions.length;
      pageBar.appendChild(createEl('span', 'lc-muted', 'Showing ' + start + '–' + end + ' of ' + catalog.total));

      const btnRow = createEl('div', 'lc-action-row');
      const prevBtn = createEl('button', 'lc-btn lc-btn-secondary', 'Previous Page');
      prevBtn.type = 'button';
      prevBtn.disabled = !(catalog.skip > 0);
      prevBtn.setAttribute('data-action', 'changePage');
      prevBtn.setAttribute('data-direction', 'prev');
      prevBtn.setAttribute('data-focus-key', 'page:prev');
      btnRow.appendChild(prevBtn);

      const nextBtn = createEl('button', 'lc-btn lc-btn-secondary', 'Next Page');
      nextBtn.type = 'button';
      nextBtn.disabled = !catalog.hasMore;
      nextBtn.setAttribute('data-action', 'changePage');
      nextBtn.setAttribute('data-direction', 'next');
      nextBtn.setAttribute('data-focus-key', 'page:next');
      btnRow.appendChild(nextBtn);

      pageBar.appendChild(btnRow);
    }
  }

  function renderLocal(localProblems) {
    const body = document.getElementById('lc-local-body');
    if (!body) return;
    clearChildren(body);

    const items = Array.isArray(localProblems) ? localProblems : [];
    if (items.length === 0) {
      const box = createEl('div', 'lc-status-box');
      box.appendChild(createEl('span', '', 'No saved local problems yet. Open a problem from Explore to create a local C++ solution file.'));
      body.appendChild(box);
      return;
    }

    const list = createEl('ul', 'lc-list');
    for (const q of items) {
      const li = createEl('li', 'lc-list-item');
      const main = createEl('div', 'lc-item-main');
      main.appendChild(createEl('div', 'lc-item-title', q.questionFrontendId + '. ' + q.title));
      main.appendChild(createEl('div', 'lc-item-meta', q.difficulty + ' · ' + (q.availability || 'Available locally')));
      li.appendChild(main);

      const openBtn = createEl('button', 'lc-btn', 'Open Local');
      openBtn.type = 'button';
      openBtn.setAttribute('data-action', 'openLocal');
      openBtn.setAttribute('data-slug', q.titleSlug);
      openBtn.setAttribute('data-focus-key', 'local-open:' + q.titleSlug);
      openBtn.title = 'Reopen saved local C++ solution offline without overwriting existing code';
      li.appendChild(openBtn);
      list.appendChild(li);
    }
    body.appendChild(list);
  }

  function renderAccount(account) {
    const statusText = document.getElementById('lc-account-status-text');
    const detailText = document.getElementById('lc-account-detail-text');
    if (statusText && account) {
      statusText.textContent = 'Status: ' + (account.summary || 'Signed out');
    }
    if (detailText && account) {
      detailText.textContent = account.detail || 'Browser sign-in alone never marks VS Code connected. Credentials are kept in VS Code SecretStorage.';
    }
  }

  function restoreFocusByKey(focusKey) {
    if (!focusKey || document.activeElement !== document.body) return;
    const candidates = document.querySelectorAll('[data-focus-key]');
    for (const el of candidates) {
      if (el.getAttribute('data-focus-key') === focusKey && !el.hasAttribute('disabled')) {
        el.focus();
        break;
      }
    }
  }

  function applyState(state) {
    if (!state || typeof state !== 'object') return;
    const activeFocusKey = document.activeElement instanceof Element
      ? document.activeElement.getAttribute('data-focus-key')
      : null;

    setDestinationDom(state.destination);
    renderNotice(state);
    renderHeaderAndCurrent(state);
    syncFilterControls(state.catalog, state.account);
    renderActiveFilters(state.catalog, state.account);
    renderTopics(state.topics, state.catalog);
    renderDaily(state.daily);
    renderCatalog(state.catalog, state.account);
    renderLocal(state.localProblems);
    renderAccount(state.account);
    restoreFocusByKey(activeFocusKey);

    if (vscode && typeof vscode.setState === 'function') {
      vscode.setState({ destination: state.destination });
    }
  }

  function submitSearchInput() {
    const searchInput = document.getElementById('lc-search-input');
    const query = searchInput ? searchInput.value : '';
    searchDraftDirty = false;
    lastCommittedQuery = query.trim();
    postAction({ action: 'setFilters', filters: { query: query } });
  }

  document.addEventListener('input', function (event) {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.id === 'lc-search-input') {
      searchDraftDirty = true;
    }
  });

  document.addEventListener('change', function (event) {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const filterKind = target.getAttribute('data-filter-select');
    if (filterKind === 'difficulty') {
      postAction({ action: 'setFilters', filters: { difficulty: target.value } });
    } else if (filterKind === 'status') {
      postAction({ action: 'setFilters', filters: { status: target.value } });
    }
  });

  document.addEventListener('click', function (event) {
    const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!target || target.hasAttribute('disabled')) return;
    const action = target.getAttribute('data-action');
    if (action === 'navigate') {
      const destination = target.getAttribute('data-destination');
      if (destination) {
        setDestinationDom(destination);
        postAction({ action: 'navigate', destination: destination });
      }
    } else if (action === 'refresh') {
      const refreshTarget = target.getAttribute('data-target') || 'all';
      postAction({ action: 'refresh', target: refreshTarget });
    } else if (action === 'dismissNotice') {
      postAction({ action: 'dismissNotice' });
    } else if (action === 'submitSearch') {
      submitSearchInput();
    } else if (action === 'openProblem') {
      const slug = target.getAttribute('data-slug');
      if (slug) postAction({ action: 'openProblem', titleSlug: slug });
    } else if (action === 'openLocal') {
      const slug = target.getAttribute('data-slug');
      if (slug) postAction({ action: 'openLocal', titleSlug: slug });
    } else if (action === 'loadTopics') {
      const force = target.getAttribute('data-force') === 'true';
      postAction({ action: 'loadTopics', force: force });
    } else if (action === 'toggleTopic') {
      const tag = target.getAttribute('data-tag');
      if (tag) postAction({ action: 'toggleTopic', tag: tag });
    } else if (action === 'removeFilter') {
      const kind = target.getAttribute('data-filter-kind');
      const value = target.getAttribute('data-filter-value') || undefined;
      if (kind === 'query') {
        searchDraftDirty = false;
        lastCommittedQuery = '';
        const searchInput = document.getElementById('lc-search-input');
        if (searchInput) searchInput.value = '';
      }
      if (kind) {
        postAction(value !== undefined ? { action: 'removeFilter', kind: kind, value: value } : { action: 'removeFilter', kind: kind });
      }
    } else if (action === 'clearFilters') {
      searchDraftDirty = false;
      lastCommittedQuery = '';
      const searchInput = document.getElementById('lc-search-input');
      if (searchInput) searchInput.value = '';
      postAction({ action: 'clearFilters' });
    } else if (action === 'changePage') {
      const direction = target.getAttribute('data-direction');
      if (direction === 'next' || direction === 'prev') {
        postAction({ action: 'changePage', direction: direction });
      }
    } else if (action === 'problemAction') {
      const kind = target.getAttribute('data-kind');
      if (kind) {
        postAction({ action: 'problemAction', kind: kind });
      }
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.target instanceof HTMLInputElement && event.target.id === 'lc-search-input') {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitSearchInput();
      }
      return;
    }

    const tab = event.target instanceof Element ? event.target.closest('[role="tab"][data-destination]') : null;
    if (!tab) return;
    const tabs = Array.from(document.querySelectorAll('[role="tab"][data-destination]'));
    const idx = tabs.indexOf(tab);
    if (idx === -1) return;

    let nextIdx = -1;
    if (event.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIdx = 0;
    else if (event.key === 'End') nextIdx = tabs.length - 1;

    if (nextIdx !== -1) {
      event.preventDefault();
      const nextTab = tabs[nextIdx];
      nextTab.focus();
      const destination = nextTab.getAttribute('data-destination');
      if (destination) {
        setDestinationDom(destination);
        postAction({ action: 'navigate', destination: destination });
      }
    }
  });

  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (msg && msg.type === 'state' && msg.state) {
      applyState(msg.state);
    }
  });

  const initialEl = document.getElementById('lc-initial-state');
  if (initialEl && initialEl.textContent) {
    try {
      applyState(JSON.parse(initialEl.textContent));
    } catch {
      // Ignore malformed bootstrap JSON
    }
  }
  postAction({ action: 'ready' });
})();
