'use strict';

const path = require('node:path');
const { LeetCodeClient, LcError, credentials } = require('./api');
const { Store } = require('./store');
const { Jobs } = require('./jobs');
const { description, formatResult } = require('./render');
const { DiscoveryState } = require('./discovery');
const { LeetCodeExplorer } = require('./explorer');
const { LeetCodeDashboard } = require('./dashboard');
const SECRET = 'leetcode.session.v1';

async function createController(vscode, context, dependencies = {}) {
  const store = dependencies.store || new Store(path.join(context.globalStorageUri.fsPath, 'solutions'));
  await store.init();
  const api = dependencies.api || new LeetCodeClient();
  const jobs = dependencies.jobs || new Jobs(store, api);
  const output = vscode.window.createOutputChannel('LeetCode Results');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  const lenses = new vscode.EventEmitter();
  let panel;
  let current;
  let registered = await store.problems();
  let disposed = false;
  let connecting = false;
  let internalSecretWrite = false;
  let explorer;
  let dashboard;

  const discovery = dependencies.discovery || new DiscoveryState(api, context.globalState, () => {
    if (!disposed) {
      if (explorer) explorer.refresh();
      if (dashboard && dashboard.isOpen) dashboard.refresh();
    }
  });
  explorer = dependencies.explorer || new LeetCodeExplorer(vscode, discovery, async () => {
    registered = await store.problems();
    return registered;
  });
  const mediaRoot = context.extensionUri?.fsPath
    ? path.join(context.extensionUri.fsPath, 'media')
    : (context.extensionPath ? path.join(context.extensionPath, 'media') : path.resolve(__dirname, '..', 'media'));
  dashboard = dependencies.dashboard || new LeetCodeDashboard(vscode, context, {
    discovery,
    mediaRoot,
    getLocalProblems: async () => {
      registered = await store.problems();
      return registered;
    },
    getCurrentProblem: async () => {
      const uri = vscode.window.activeTextEditor?.document?.uri;
      if (isRegistered(uri)) {
        try {
          const q = await store.registered(uri.fsPath);
          return { ...q, fileName: path.basename(uri.fsPath) };
        } catch {
          // Fall back to current problem in memory
        }
      }
      if (current) {
        return { ...current, fileName: path.basename(store.file(current)) };
      }
      return undefined;
    }
  });

  const initialSecret = await context.secrets.get(SECRET);
  let accountState = initialSecret ? 'Session stored' : 'Disconnected';
  discovery.setAccountState(initialSecret ? 'unverified' : 'signed_out');

  function setStatus(state) {
    accountState = state;
    status.text = `$(code) LeetCode: ${state}`;
    status.tooltip = 'Account status · LeetCode C++ practice';
    status.command = state === 'Disconnected' ? 'lc.connect' : 'lc.account';
    status.show();
  }
  setStatus(accountState);

  async function getAuth(required = false) {
    const saved = await context.secrets.get(SECRET);
    if (saved) {
      try { const a = JSON.parse(saved); return credentials(a.session, a.csrf); }
      catch { throw new LcError('CREDENTIALS', 'The stored session could not be read. Connect Account again.'); }
    }
    if (required) throw new LcError('AUTH', 'Connect your LeetCode account first using LeetCode: Connect Account.');
    return undefined;
  }

  async function tryGetAuth() {
    try { return await getAuth(false); }
    catch { return undefined; }
  }

  function clearCurrentProgress() {
    if (current) {
      current = { ...current, status: null };
      if (panel) {
        panel.webview.html = description(current);
      }
    }
  }

  async function verifiedAuth() {
    const rawSaved = await context.secrets.get(SECRET);
    let auth;
    try {
      auth = await getAuth(true);
    } catch (error) {
      clearCurrentProgress();
      if (error.code === 'CREDENTIALS') {
        discovery.setAccountState('expired', { detail: error.message });
        setStatus('Reconnect needed');
      } else {
        discovery.setAccountState('signed_out');
        setStatus('Disconnected');
      }
      error.preserveAccountState = true;
      throw error;
    }
    const startGen = discovery.accountGeneration;
    try {
      const user = await api.account(auth);
      if (disposed || discovery.accountGeneration !== startGen || (await context.secrets.get(SECRET)) !== rawSaved) {
        throw Object.assign(new LcError('ACCOUNT', 'The LeetCode account state changed during verification. Try again.'), { preserveAccountState: true });
      }
      const prevUser = discovery.account.username;
      if (prevUser && prevUser !== user) clearCurrentProgress();
      discovery.setAccountState('verified', { username: user, auth });
      await discovery.persistFilters();
      setStatus(user);
      if (discovery.initialized) {
        await discovery.refreshAll();
      }
      return { auth, user };
    } catch (error) {
      if (error?.preserveAccountState || disposed || discovery.accountGeneration !== startGen || (await context.secrets.get(SECRET)) !== rawSaved) {
        if (error && typeof error === 'object') error.preserveAccountState = true;
        throw error;
      }
      clearCurrentProgress();
      if (error.code === 'AUTH' && !error.redirected) {
        discovery.setAccountState('expired', { detail: error.message });
        await discovery.persistFilters();
        setStatus('Reconnect needed');
      } else {
        discovery.setAccountState('unavailable', { detail: error instanceof LcError ? error.message : 'Account verification unavailable.' });
        await discovery.persistFilters();
        setStatus('Verification unavailable');
      }
      if (error && typeof error === 'object') error.preserveAccountState = true;
      throw error;
    }
  }

  async function report(error) {
    if (disposed) return;
    // Never expose arbitrary exception text: errors can include headers or tokens.
    const message = error instanceof LcError ? error.message : 'The operation failed locally. Check that the LeetCode solutions folder is accessible; your existing code has not been replaced.';
    if (!error?.preserveAccountState) {
      if (error?.code === 'AUTH' && !error?.redirected) {
        clearCurrentProgress();
        discovery.setAccountState('expired', { detail: message });
        setStatus('Reconnect needed');
      } else if (error?.code === 'FORBIDDEN' || error?.redirected) {
        clearCurrentProgress();
        discovery.setAccountState('unavailable', { detail: message });
        setStatus('Verification unavailable');
      }
    }
    output.appendLine(`\n${message}`);
    output.show(true);
    await vscode.window.showErrorMessage(message);
  }

  function command(id, action) {
    context.subscriptions.push(vscode.commands.registerCommand(id, (...args) => {
      try { return Promise.resolve(action(...args)).catch(report); }
      catch (e) { return report(e); }
    }));
  }

  function localUri(uri) {
    return uri?.scheme === 'file' && path.dirname(uri.fsPath) === store.root;
  }

  function isRegistered(uri) {
    return localUri(uri) && registered.some(q => store.file(q) === uri.fsPath);
  }

  function capture(uri) {
    const doc = uri && typeof uri.toString === 'function'
      ? vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString())
      : vscode.window.activeTextEditor?.document;
    if (!doc || !isRegistered(doc.uri)) throw new LcError('SELECTION', 'Select a registered LeetCode C++ solution editor before running or submitting.');
    const code = doc.getText();
    if (!code.trim()) throw new LcError('EMPTY', 'The solution is empty. Write some C++ before sending it.');
    if (Buffer.byteLength(code, 'utf8') > 1024 * 1024) throw new LcError('SIZE', 'The solution exceeds the 1 MiB limit.');
    return { file: doc.uri.fsPath, uri: doc.uri, code, version: doc.version, dirty: doc.isDirty };
  }

  async function selectedProblem() {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (isRegistered(uri)) {
      const q = await store.registered(uri.fsPath);
      return { ...q, status: null };
    }
    if (current) return current;
    throw new LcError('SELECTION', 'Open a LeetCode problem first.');
  }

  function showDescription(q) {
    const renderedQuestion = discovery.isVerified ? q : { ...q, status: null };
    if (!panel) {
      const editor = vscode.window.activeTextEditor;
      const activeColumn = editor?.viewColumn || vscode.ViewColumn.One;
      const homeColumn = isRegistered(editor?.document.uri) && activeColumn > 1 ? activeColumn - 1 : activeColumn;
      panel = vscode.window.createWebviewPanel('lc.problem', `${q.questionFrontendId}. ${q.title}`, homeColumn, { enableScripts: false, enableCommandUris: false, localResourceRoots: [], retainContextWhenHidden: true });
      panel.onDidDispose(() => { panel = undefined; }, undefined, context.subscriptions);
      context.subscriptions.push(panel);
    } else {
      panel.title = `${q.questionFrontendId}. ${q.title}`;
      panel.reveal(panel.viewColumn, true);
    }
    panel.webview.html = description(renderedQuestion);
  }

  async function displayProblem(q) {
    const file = store.file(q);
    await store.safe(file, true);
    current = q;
    // Reuse the existing solution column, so revisiting doesn't create new splits.
    const visible = vscode.window.visibleTextEditors.find(e => isRegistered(e.document.uri));
    showDescription(q);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const solutionColumn = visible?.viewColumn && visible.viewColumn !== panel.viewColumn ? visible.viewColumn : vscode.ViewColumn.Beside;
    await vscode.window.showTextDocument(doc, { viewColumn: solutionColumn, preview: false });
    lenses.fire();
    if (dashboard && dashboard.isOpen) dashboard.refresh();
    await context.globalState.update('lastProblem', q.titleSlug);
  }

  async function openProblemBySlug(titleSlug, previewQuestion) {
    if (previewQuestion && (previewQuestion.supported === false || (previewQuestion.questionFrontendId !== undefined && !/^\d+$/.test(String(previewQuestion.questionFrontendId))))) {
      throw new LcError('UNSUPPORTED', 'This problem is not a supported numbered C++ problem.');
    }
    const auth = discovery.isVerified ? discovery.activeAuth : await tryGetAuth();
    let q;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'LeetCode: Opening problem' }, async () => {
      try {
        q = await api.problem(titleSlug, auth);
      } catch (error) {
        if (auth && (error.code === 'AUTH' || error.code === 'FORBIDDEN')) {
          discovery.handleAuthFailure(error);
          setStatus(error.code === 'AUTH' && !error.redirected ? 'Reconnect needed' : 'Verification unavailable');
          q = await api.problem(titleSlug, undefined);
        } else {
          throw error;
        }
      }
    });
    if (q) {
      await store.cache({ ...q, status: null });
      registered = await store.problems();
      explorer.refresh();
      await displayProblem(q);
    }
    return q;
  }

  async function openSignIn() {
    await vscode.env.openExternal(vscode.Uri.parse('https://leetcode.com/accounts/login/'));
    await vscode.window.showInformationMessage('Opened leetcode.com in your browser. Browser sign-in does not automatically connect VS Code; use Advanced: Import Session to store session cookies in SecretStorage.');
  }

  async function importSession() {
    if (connecting || jobs.busy) throw new LcError('BUSY', 'Finish the current account or remote operation first.');
    connecting = true;
    try {
      const session = await vscode.window.showInputBox({ title: 'LeetCode: LEETCODE_SESSION', prompt: 'Paste the LEETCODE_SESSION cookie value only. Never paste your password.', password: true, ignoreFocusOut: true });
      if (session === undefined) return;
      const csrf = await vscode.window.showInputBox({ title: 'LeetCode: csrftoken', prompt: 'Paste the csrftoken cookie value only.', password: true, ignoreFocusOut: true });
      if (csrf === undefined) return;
      let auth;
      let user;
      const startGen = discovery.accountGeneration;
      try {
        auth = credentials(session, csrf);
        user = await api.account(auth);
      } catch (error) {
        if (error && typeof error === 'object') error.preserveAccountState = true;
        throw error;
      }
      if (disposed || discovery.accountGeneration !== startGen) {
        throw Object.assign(new LcError('ACCOUNT', 'The LeetCode account changed during session import. Try again.'), { preserveAccountState: true });
      }
      const prevUser = discovery.account.username;
      internalSecretWrite = true;
      try {
        await context.secrets.store(SECRET, JSON.stringify(auth));
      } finally {
        internalSecretWrite = false;
      }
      if (prevUser && prevUser !== user) clearCurrentProgress();
      discovery.setAccountState('verified', { username: user, auth });
      await discovery.persistFilters();
      setStatus(user);
      if (discovery.initialized) {
        await discovery.refreshAll();
      }
      await vscode.window.showInformationMessage(`Connected to LeetCode as ${user}.`);
    } finally {
      connecting = false;
    }
  }

  async function connect() {
    if (connecting || jobs.busy) throw new LcError('BUSY', 'Finish the current account or remote operation first.');
    const choice = await vscode.window.showInformationMessage(
      'Sign in to leetcode.com in your browser. Browser sign-in does not transfer cookies automatically. To connect VS Code for remote runs, submissions, and progress filters, choose Advanced: Import Session and paste LEETCODE_SESSION and csrftoken values into the masked fields (stored in VS Code SecretStorage).',
      { modal: true },
      'Open LeetCode Sign-in',
      'Check Saved Session',
      'Advanced: Import Session'
    );
    if (!choice) return;
    if (choice === 'Open LeetCode Sign-in' || choice === 'Open Sign-in') {
      await openSignIn();
      return;
    }
    if (choice === 'Check Saved Session') {
      const { user } = await verifiedAuth();
      await vscode.window.showInformationMessage(`LeetCode session is valid: ${user}`);
      return;
    }
    if (choice === 'Advanced: Import Session' || choice === 'Import Session') {
      await importSession();
    }
  }

  async function openProblem() {
    const input = await vscode.window.showInputBox({ title: 'Open LeetCode Problem', prompt: 'Problem number, slug, title, or keyword', placeHolder: '1, two-sum, or binary search' });
    if (!input?.trim()) return;
    const query = input.trim();
    let targetSlug;
    let preview;
    const auth = discovery.activeAuth;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'LeetCode: Finding problem' }, async () => {
      if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(query)) {
        try {
          const q = await api.problem(query, auth || await tryGetAuth());
          await store.cache({ ...q, status: null });
          registered = await store.problems();
          explorer.refresh();
          await displayProblem(q);
          return;
        } catch (e) {
          if (e.code !== 'NOT_FOUND') throw e;
        }
      }
      let skip = 0;
      for (;;) {
        const list = await api.search(query, auth, skip);
        if (/^\d+$/.test(query)) {
          // Frontend numbers differ from internal question IDs. Never guess.
          const match = list.questions.find(p => String(p.questionFrontendId) === query);
          if (match) {
            targetSlug = match.titleSlug;
            preview = match;
            return;
          }
        }
        if (!list.questions.length) throw new LcError('NOT_FOUND', 'No matching LeetCode problems were found. Try a title or slug.');
        const items = list.questions.map(p => ({
          label: `${p.questionFrontendId}. ${p.title}`,
          description: `${p.difficulty}${p.supported === false ? ' · Unsupported ID' : ''}${p.isPaidOnly ? ' · Premium' : ''}${discovery.isVerified && p.status === 'ac' ? ' · Solved' : discovery.isVerified && p.status === 'notac' ? ' · Attempted' : ''}`,
          problem: p
        }));
        if (skip + list.questions.length < list.total) items.push({ label: 'Load more results…', more: true });
        const item = await vscode.window.showQuickPick(items, { title: 'LeetCode Problems', placeHolder: `${list.total} matches · choose a problem` });
        if (!item) return;
        if (item.more) { skip += list.questions.length; continue; }
        targetSlug = item.problem.titleSlug;
        preview = item.problem;
        return;
      }
    });
    if (targetSlug) {
      await openProblemBySlug(targetSlug, preview);
    }
  }

  async function recent() {
    registered = await store.problems();
    if (!registered.length) throw new LcError('EMPTY', 'No local problems yet. Use Open Problem while connected to the internet.');
    const picked = await vscode.window.showQuickPick(
      registered.map(q => ({ label: `${q.questionFrontendId}. ${q.title}`, description: `${q.difficulty} · Available locally`, problem: q })),
      { title: 'Local LeetCode Problems', placeHolder: 'Available offline · existing code is preserved' }
    );
    if (picked) await displayProblem({ ...picked.problem, status: null });
  }

  async function openLocalProblemItem(itemOrProblem) {
    const target = itemOrProblem?.problem || itemOrProblem;
    if (!target?.titleSlug || !target?.questionFrontendId) {
      return recent();
    }
    const file = store.file(target);
    const q = await store.registered(file);
    await displayProblem({ ...q, status: null });
  }

  async function filterSearch() {
    const value = await vscode.window.showInputBox({
      title: 'LeetCode: Filter by Search Keyword',
      prompt: 'Enter a problem number, title, or keyword (leave empty for Any)',
      value: discovery.filters.query,
      placeHolder: 'e.g. binary tree, two sum, or 1'
    });
    if (value === undefined) return;
    await discovery.setSearchQuery(value);
  }

  async function filterDifficulty() {
    const items = [
      { label: 'Any Difficulty', description: 'Show all difficulties', value: 'ANY' },
      { label: 'Easy', value: 'EASY' },
      { label: 'Medium', value: 'MEDIUM' },
      { label: 'Hard', value: 'HARD' }
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: 'LeetCode: Filter by Difficulty',
      placeHolder: `Current: ${discovery.filters.difficulty}`
    });
    if (!picked) return;
    await discovery.setDifficulty(picked.value);
  }

  async function filterTopics() {
    const topics = await discovery.ensureTopics();
    const active = new Set(discovery.filters.tags);
    const items = topics.map(t => ({
      label: t.name,
      description: t.slug,
      slug: t.slug,
      picked: active.has(t.slug)
    }));
    const selected = await vscode.window.showQuickPick(items, {
      title: 'LeetCode: Filter by Topics',
      placeHolder: 'Select up to 20 topics (or none to clear topic filter)',
      canPickMany: true
    });
    if (selected === undefined) return;
    const list = Array.isArray(selected) ? selected : [selected];
    await discovery.setTopics(list.map(i => i.slug));
  }

  async function filterStatus() {
    if (!discovery.isVerified) {
      throw Object.assign(new LcError('AUTH', 'Check Saved Session or Import Session to verify your LeetCode account before filtering by progress.'), { preserveAccountState: true });
    }
    const items = [
      { label: 'All Problems', value: 'ALL' },
      { label: 'Solved', description: 'Accepted on LeetCode', value: 'AC' },
      { label: 'Attempted', description: 'Tried but not yet Accepted', value: 'TRIED' },
      { label: 'Not started', description: 'No submissions on this verified account', value: 'NOT_STARTED' }
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: 'LeetCode: Filter by Account Progress',
      placeHolder: `Verified as ${discovery.account.username}`
    });
    if (!picked) return;
    await discovery.setStatusFilter(picked.value);
  }

  async function run(kind, uri, custom = false) {
    // Snapshot before the first asynchronous operation. Never read another editor
    // after authentication, input selection, or network calls change focus.
    const snapshot = capture(uri);
    const q = await store.registered(snapshot.file);
    let input;
    if (kind === 'test') {
      if (q.enableRunCode === false) throw new LcError('UNSUPPORTED', 'LeetCode does not permit remote tests for this problem.');
      if (custom) {
        const file = await store.custom(q);
        await store.safe(file, true);
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        input = doc.getText(); // includes unsaved custom input
      } else input = q.exampleTestcases || q.sampleTestCase;
      if (!input?.trim()) throw new LcError('INPUT', 'No example input is available. Use Edit Custom Test Input, then Run Custom Input.');
      if (Buffer.byteLength(input) > 1024 * 1024) throw new LcError('SIZE', 'Test input exceeds the 1 MiB limit.');
    }
    const { auth, user } = await verifiedAuth();
    const originAccountGen = discovery.accountGeneration;
    output.appendLine(`\n${kind === 'submit' ? 'SUBMISSION' : 'REMOTE TEST'} · ${q.questionFrontendId}. ${q.title} · editor version ${snapshot.version}${snapshot.dirty ? ' (includes unsaved edits; Ctrl+S to save locally)' : ''}`);
    output.show(true);
    const record = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: kind === 'submit' ? 'Submitting to LeetCode' : 'Running on LeetCode', cancellable: true }, (progress, token) => jobs.start(kind, q, snapshot, input, auth, user, message => progress.report({ message }), token));
    if (record) {
      present(record);
      if (kind === 'submit' && record.result?.state === 'SUCCESS') {
        await discovery.refreshAfterSubmission(user, originAccountGen);
      }
    }
  }

  function present(record) {
    output.appendLine('\n' + formatResult(record));
    output.show(true);
    lenses.fire();
  }

  async function resume() {
    const { auth, user } = await verifiedAuth();
    const originAccountGen = discovery.accountGeneration;
    const record = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Retrieving LeetCode result', cancellable: true }, (p, t) => jobs.resume(auth, user, message => p.report({ message }), t));
    if (record) {
      present(record);
      if (record.job?.kind === 'submit' && record.result?.state === 'SUCCESS') {
        await discovery.refreshAfterSubmission(user, originAccountGen);
      }
    }
  }

  async function updateEditorContext(editor) {
    await vscode.commands.executeCommand('setContext', 'lc.isSolution', isRegistered(editor?.document.uri));
    if (dashboard && dashboard.isOpen) dashboard.refresh();
  }

  command('lc.openGUI', () => dashboard.open());
  command('lc.connect', connect);
  command('lc.openSignIn', openSignIn);
  command('lc.importSession', importSession);
  command('lc.account', async () => { const { user } = await verifiedAuth(); await vscode.window.showInformationMessage(`LeetCode session is valid: ${user}`); });
  command('lc.disconnect', async () => {
    if (jobs.busy || connecting) throw new LcError('BUSY', 'Finish or stop waiting for the current operation before disconnecting.');
    internalSecretWrite = true;
    try {
      await context.secrets.delete(SECRET);
    } finally {
      internalSecretWrite = false;
    }
    clearCurrentProgress();
    discovery.setAccountState('signed_out');
    await discovery.persistFilters();
    setStatus('Disconnected');
    if (discovery.initialized) {
      await discovery.refreshAll();
    }
    await vscode.window.showInformationMessage('LeetCode session removed from VS Code. Pending operations and local code are preserved.');
  });
  command('lc.open', openProblem);
  command('lc.openProblemItem', async item => {
    const problem = item?.problem || (typeof item === 'object' ? item : undefined);
    const targetSlug = typeof item === 'string' ? item : problem?.titleSlug;
    if (!targetSlug) throw new LcError('SELECTION', 'Choose a LeetCode problem to open.');
    await openProblemBySlug(targetSlug, problem);
  });
  command('lc.recent', recent);
  command('lc.openLocalProblem', openLocalProblemItem);
  command('lc.refreshExplorer', async () => {
    registered = await store.problems();
    await discovery.refreshAll();
    explorer.refresh();
    if (dashboard && dashboard.isOpen) await dashboard.refresh();
  });
  command('lc.refreshDaily', () => discovery.refreshDaily());
  command('lc.refreshCatalog', () => discovery.refreshCatalog());
  command('lc.filterSearch', filterSearch);
  command('lc.filterDifficulty', filterDifficulty);
  command('lc.filterTopics', filterTopics);
  command('lc.filterStatus', filterStatus);
  command('lc.clearFilters', () => discovery.clearFilters());
  command('lc.nextPage', () => discovery.nextPage());
  command('lc.prevPage', () => discovery.prevPage());
  command('lc.description', async () => {
    const q = await selectedProblem();
    const visible = vscode.window.visibleTextEditors.find(e => isRegistered(e.document.uri));
    showDescription(q);
    if (visible && visible.viewColumn === panel.viewColumn) await vscode.window.showTextDocument(visible.document, { viewColumn: vscode.ViewColumn.Beside, preview: false });
  });
  command('lc.run', uri => run('test', uri));
  command('lc.submit', uri => run('submit', uri));
  command('lc.runCustom', uri => run('test', uri, true));
  command('lc.custom', async () => {
    const q = await selectedProblem();
    const file = await store.custom(q);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.window.showInformationMessage('Use LeetCode input format: one argument per line; repeat arguments for additional cases. Return to the solution editor and choose Run Custom Input.');
  });
  command('lc.resume', resume);
  command('lc.clearPending', async () => {
    if (jobs.busy) throw new LcError('BUSY', 'Stop waiting for the current operation first.');
    const pending = await store.pending();
    if (!pending) return;
    const choice = await vscode.window.showWarningMessage('Clearing this record does not cancel execution on LeetCode. If no result ID was saved, first check your submission history. Sending again may duplicate your submission.', { modal: true }, 'Clear Pending Record');
    if (choice === 'Clear Pending Record') await store.release();
  });
  command('lc.results', async () => {
    const record = await store.readJSON('last-result.json');
    output.clear();
    if (record) present(record); else { output.appendLine('No completed remote result saved yet. Use Retrieve Pending Result for an unfinished operation.'); output.show(true); }
  });
  command('lc.folder', async () => { await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(store.root)); });

  if (typeof vscode.window.registerTreeDataProvider === 'function') {
    context.subscriptions.push(vscode.window.registerTreeDataProvider('lc.explorer', explorer));
  }
  if (typeof context.secrets.onDidChange === 'function') {
    context.subscriptions.push(context.secrets.onDidChange(async e => {
      if (disposed || internalSecretWrite || (e?.key && e.key !== SECRET)) return;
      const saved = await context.secrets.get(SECRET);
      clearCurrentProgress();
      discovery.setAccountState(saved ? 'unverified' : 'signed_out');
      await discovery.persistFilters();
      setStatus(saved ? 'Session stored' : 'Disconnected');
      if (discovery.initialized) {
        await discovery.refreshAll();
      }
    }));
  }

  context.subscriptions.push(output, status, lenses, explorer, dashboard,
    vscode.window.onDidChangeActiveTextEditor(e => { updateEditorContext(e).catch(report); }),
    vscode.languages.registerCodeLensProvider({ scheme: 'file', language: 'cpp' }, {
      onDidChangeCodeLenses: lenses.event,
      provideCodeLenses(document) {
        if (!isRegistered(document.uri)) return [];
        return [['Run Examples on LeetCode', 'lc.run'], ['Run Custom Input', 'lc.runCustom'], ['Submit to LeetCode', 'lc.submit'], ['Description', 'lc.description']].map(([title, commandId]) => new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), { title, command: commandId, arguments: commandId === 'lc.description' ? [] : [document.uri] }));
      }
    }),
    { dispose() { disposed = true; } });
  await updateEditorContext(vscode.window.activeTextEditor);
  const pending = await store.pending();
  if (pending) {
    output.appendLine('An earlier LeetCode operation is pending. Use Retrieve Pending Result before running or submitting again.');
    vscode.window.showInformationMessage('LeetCode has a pending operation. Use Retrieve Pending Result to continue.');
  }
  // No startup network calls or implicit restoration of editors/layout.
  return {
    store,
    api,
    jobs,
    discovery,
    explorer,
    dashboard,
    openGUI: () => dashboard.open(),
    capture,
    run,
    connect,
    openSignIn,
    importSession,
    openProblem,
    openProblemBySlug,
    recent,
    resume,
    getAuth
  };
}

async function activate(context) {
  const vscode = require('vscode');
  try { return await createController(vscode, context); }
  catch { await vscode.window.showErrorMessage('LeetCode could not initialize its private solutions folder. Check local filesystem permissions.'); }
}

module.exports = { activate, createController };
