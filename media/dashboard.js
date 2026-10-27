(function () {
  'use strict';

  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  const DESTINATIONS = ['explore', 'local', 'account'];

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

  function renderHeaderAndCurrent(state) {
    const pill = document.getElementById('lc-account-summary-pill');
    if (pill && state.account) {
      pill.textContent = state.account.summary || 'Signed out';
    }

    const currentTitle = document.getElementById('lc-current-problem-title');
    const currentFile = document.getElementById('lc-current-problem-file');
    if (currentTitle && currentFile) {
      if (state.currentProblem) {
        currentTitle.textContent =
          state.currentProblem.questionFrontendId +
          '. ' +
          state.currentProblem.title +
          ' (' +
          state.currentProblem.difficulty +
          ')';
        currentFile.textContent = state.currentProblem.fileName || 'Registered C++ solution';
      } else {
        currentTitle.textContent = 'No problem selected';
        currentFile.textContent = 'Select a problem via the LeetCode sidebar or Open Problem command (dashboard selection wiring in G2/G3).';
      }
    }
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

    const openBtn = createEl('button', 'lc-btn lc-btn-secondary', 'Open (Planned in G2)');
    openBtn.type = 'button';
    openBtn.disabled = true;
    openBtn.title = 'Opening problems directly from the dashboard is scheduled for G2. Use the LeetCode sidebar in G1.';
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
    const summaryEl = document.getElementById('lc-filter-summary');
    if (summaryEl && catalog) {
      summaryEl.textContent = 'Active summary: ' + (catalog.filterSummary || 'All problems');
    }

    const body = document.getElementById('lc-catalog-body');
    if (!body || !catalog) return;
    clearChildren(body);

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
      main.appendChild(createEl('div', 'lc-item-meta', metaParts.join(' · ')));
      item.appendChild(main);

      const openBtn = createEl('button', 'lc-btn lc-btn-secondary', 'Open (Planned in G2)');
      openBtn.type = 'button';
      openBtn.disabled = true;
      openBtn.title = 'Direct problem opening in the dashboard is scheduled for G2. Use the LeetCode sidebar in G1.';
      item.appendChild(openBtn);
      list.appendChild(item);
    }
    body.appendChild(list);
  }

  function renderLocal(localProblems) {
    const body = document.getElementById('lc-local-body');
    if (!body) return;
    clearChildren(body);

    const items = Array.isArray(localProblems) ? localProblems : [];
    if (items.length === 0) {
      const box = createEl('div', 'lc-status-box');
      box.appendChild(createEl('span', '', 'No saved local problems yet. Open a problem to create a local C++ solution file.'));
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

      const openBtn = createEl('button', 'lc-btn lc-btn-secondary', 'Open Local (Planned in G2)');
      openBtn.type = 'button';
      openBtn.disabled = true;
      openBtn.title = 'Reopening local solutions from the dashboard is scheduled for G2. Use the LeetCode sidebar Local Problems section in G1.';
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

  function applyState(state) {
    if (!state || typeof state !== 'object') return;
    setDestinationDom(state.destination);
    renderNotice(state);
    renderHeaderAndCurrent(state);
    renderDaily(state.daily);
    renderCatalog(state.catalog, state.account);
    renderLocal(state.localProblems);
    renderAccount(state.account);
    if (vscode && typeof vscode.setState === 'function') {
      vscode.setState({ destination: state.destination });
    }
  }

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
    }
  });

  document.addEventListener('keydown', function (event) {
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
