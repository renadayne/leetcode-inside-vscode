'use strict';

const path = require('node:path');
const { LeetCodeClient, LcError, credentials } = require('./api');
const { Store } = require('./store');
const { Jobs } = require('./jobs');
const { description, formatResult } = require('./render');
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
  let accountState = (await context.secrets.get(SECRET)) ? 'Session stored' : 'Disconnected';
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
  async function verifiedAuth() {
    const auth = await getAuth(true);
    const user = await api.account(auth);
    setStatus(user);
    return { auth, user };
  }
  async function report(error) {
    if (disposed) return;
    // Never expose arbitrary exception text: errors can include headers or tokens.
    const message = error instanceof LcError ? error.message : 'The operation failed locally. Check that the LeetCode solutions folder is accessible; your existing code has not been replaced.';
    if (error.code === 'AUTH' || error.code === 'FORBIDDEN') setStatus('Reconnect needed');
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
    if (isRegistered(uri)) return store.registered(uri.fsPath);
    if (current) return current;
    throw new LcError('SELECTION', 'Open a LeetCode problem first.');
  }
  function showDescription(q) {
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
    panel.webview.html = description(q);
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
    await context.globalState.update('lastProblem', q.titleSlug);
  }
  async function connect() {
    if (connecting || jobs.busy) throw new LcError('BUSY', 'Finish the current account or remote operation first.');
    connecting = true;
    try {
      const choice = await vscode.window.showInformationMessage('Sign in to leetcode.com in your browser. In Developer Tools → Application/Storage → Cookies → https://leetcode.com, copy LEETCODE_SESSION and csrftoken. Only their values go into the next two masked fields. They are stored in VS Code SecretStorage.', { modal: true }, 'Import Session', 'Open Sign-in');
      if (!choice) return;
      if (choice === 'Open Sign-in') await vscode.env.openExternal(vscode.Uri.parse('https://leetcode.com/accounts/login/'));
      const session = await vscode.window.showInputBox({ title: 'LeetCode: LEETCODE_SESSION', prompt: 'Paste the LEETCODE_SESSION cookie value only. Never paste your password.', password: true, ignoreFocusOut: true });
      if (session === undefined) return;
      const csrf = await vscode.window.showInputBox({ title: 'LeetCode: csrftoken', prompt: 'Paste the csrftoken cookie value only.', password: true, ignoreFocusOut: true });
      if (csrf === undefined) return;
      const auth = credentials(session, csrf);
      const user = await api.account(auth);
      await context.secrets.store(SECRET, JSON.stringify(auth));
      setStatus(user);
      await vscode.window.showInformationMessage(`Connected to LeetCode as ${user}.`);
    } finally { connecting = false; }
  }
  async function openProblem() {
    const input = await vscode.window.showInputBox({ title: 'Open LeetCode Problem', prompt: 'Problem number, slug, title, or keyword', placeHolder: '1, two-sum, or binary search' });
    if (!input?.trim()) return;
    const query = input.trim();
    let q;
    const auth = await getAuth();
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'LeetCode: Finding problem' }, async () => {
      if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(query)) {
        try { q = await api.problem(query, auth); return; }
        catch (e) { if (e.code !== 'NOT_FOUND') throw e; }
      }
      let skip = 0;
      for (;;) {
        const list = await api.search(query, auth, skip);
        if (/^\d+$/.test(query)) {
          // Frontend numbers differ from internal question IDs. Never guess.
          const match = list.questions.find(p => String(p.questionFrontendId) === query);
          if (match) { q = await api.problem(match.titleSlug, auth); return; }
        }
        if (!list.questions.length) throw new LcError('NOT_FOUND', 'No matching LeetCode problems were found. Try a title or slug.');
        const items = list.questions.map(p => ({ label: `${p.questionFrontendId}. ${p.title}`, description: `${p.difficulty}${p.isPaidOnly ? ' · Premium' : ''}${p.status === 'ac' ? ' · Solved' : ''}`, problem: p }));
        if (skip + list.questions.length < list.total) items.push({ label: 'Load more results…', more: true });
        const item = await vscode.window.showQuickPick(items, { title: 'LeetCode Problems', placeHolder: `${list.total} matches · choose a problem` });
        if (!item) return;
        if (item.more) { skip += list.questions.length; continue; }
        q = await api.problem(item.problem.titleSlug, auth);
        return;
      }
    });
    if (q) {
      await store.cache(q);
      registered = await store.problems();
      await displayProblem(q);
    }
  }
  async function recent() {
    registered = await store.problems();
    if (!registered.length) throw new LcError('EMPTY', 'No local problems yet. Use Open Problem while connected to the internet.');
    const picked = await vscode.window.showQuickPick(registered.map(q => ({ label: `${q.questionFrontendId}. ${q.title}`, description: q.difficulty, problem: q })), { title: 'Local LeetCode Problems', placeHolder: 'Available offline · existing code is preserved' });
    if (picked) await displayProblem(picked.problem);
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
    output.appendLine(`\n${kind === 'submit' ? 'SUBMISSION' : 'REMOTE TEST'} · ${q.questionFrontendId}. ${q.title} · editor version ${snapshot.version}${snapshot.dirty ? ' (includes unsaved edits; Ctrl+S to save locally)' : ''}`);
    output.show(true);
    const record = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: kind === 'submit' ? 'Submitting to LeetCode' : 'Running on LeetCode', cancellable: true }, (progress, token) => jobs.start(kind, q, snapshot, input, auth, user, message => progress.report({ message }), token));
    if (record) present(record);
  }
  function present(record) {
    output.appendLine('\n' + formatResult(record));
    output.show(true);
    lenses.fire();
  }
  async function resume() {
    const { auth, user } = await verifiedAuth();
    const record = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Retrieving LeetCode result', cancellable: true }, (p,t) => jobs.resume(auth, user, message => p.report({ message }), t));
    if (record) present(record);
  }
  async function updateEditorContext(editor) {
    await vscode.commands.executeCommand('setContext', 'lc.isSolution', isRegistered(editor?.document.uri));
  }

  command('lc.connect', connect);
  command('lc.account', async () => { const {user} = await verifiedAuth(); await vscode.window.showInformationMessage(`LeetCode session is valid: ${user}`); });
  command('lc.disconnect', async () => {
    if (jobs.busy || connecting) throw new LcError('BUSY', 'Finish or stop waiting for the current operation before disconnecting.');
    await context.secrets.delete(SECRET); setStatus('Disconnected');
    await vscode.window.showInformationMessage('LeetCode session removed from VS Code. Pending operations and local code are preserved.');
  });
  command('lc.open', openProblem);
  command('lc.recent', recent);
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
  context.subscriptions.push(output, status, lenses,
    vscode.window.onDidChangeActiveTextEditor(e => { updateEditorContext(e).catch(report); }),
    vscode.languages.registerCodeLensProvider({ scheme: 'file', language: 'cpp' }, {
      onDidChangeCodeLenses: lenses.event,
      provideCodeLenses(document) {
        if (!isRegistered(document.uri)) return [];
        return [['Run Examples on LeetCode','lc.run'],['Run Custom Input','lc.runCustom'],['Submit to LeetCode','lc.submit'],['Description','lc.description']].map(([title,commandId]) => new vscode.CodeLens(new vscode.Range(0,0,0,0), { title, command: commandId, arguments: commandId === 'lc.description' ? [] : [document.uri] }));
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
  return { store, api, jobs, capture, run, connect, openProblem, recent, resume, getAuth };
}

async function activate(context) {
  const vscode = require('vscode');
  try { return await createController(vscode, context); }
  catch { await vscode.window.showErrorMessage('LeetCode could not initialize its private solutions folder. Check local filesystem permissions.'); }
}

module.exports = { activate, createController };
