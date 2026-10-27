'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createController} = require('../src/extension');
const {Store} = require('../src/store');
const {LeetCodeClient, LcError} = require('../src/api');

const q={questionId:'101',questionFrontendId:'1',title:'Two Sum',titleSlug:'two-sum',difficulty:'Easy',isPaidOnly:false,status:null,topicTags:[{name:'Array',slug:'array'}],content:'<p>Problem</p>',starter:'class Solution {};',exampleTestcases:'[2,7]\n9',enableRunCode:true};
const disposable=()=>({dispose(){}});
function fakeVSCode() {
  const handlers=new Map();
  const errors=[], logs=[], infos=[], inputs=[], picks=[], panels=[], treeProviders=new Map();
  const documents=[];
  const Uri={file:file=>({scheme:'file',fsPath:file,toString:()=>`file://${file}`}),parse:value=>({toString:()=>value})};
  const vscode={Uri,StatusBarAlignment:{Left:1},ViewColumn:{One:1,Beside:-2},ProgressLocation:{Notification:15},
    TreeItemCollapsibleState:{None:0,Collapsed:1,Expanded:2},
    TreeItem:class {constructor(label,collapsibleState){this.label=label;this.collapsibleState=collapsibleState;}},
    ThemeIcon:class {constructor(id){this.id=id;}},
    EventEmitter:class {
      constructor(){this.listeners=[];}
      event=fn=>{this.listeners.push(fn);return disposable();};
      fire(v){for(const fn of this.listeners)fn(v);}
      dispose(){this.listeners=[];}
    },
    CodeLens:class {constructor(range,command){Object.assign(this,{range,command});}},Range:class {},
    commands:{
      registerCommand(id,fn){handlers.set(id,fn);return disposable();},
      async executeCommand(id,...args){if(handlers.has(id))return handlers.get(id)(...args);}
    },
    workspace:{textDocuments:documents,async openTextDocument(uri){
      let doc=documents.find(d=>d.uri.toString()===uri.toString());
      if(!doc){doc={uri,version:1,isDirty:false,text:await fs.readFile(uri.fsPath,'utf8'),getText(){return this.text;}};documents.push(doc);}
      return doc;
    }},
    window:{activeTextEditor:undefined,visibleTextEditors:[],
      createOutputChannel(){return {appendLine:s=>logs.push(s),show(){},clear(){logs.length=0;},dispose(){}};},
      createStatusBarItem(){return {show(){},dispose(){}};},
      onDidChangeActiveTextEditor(){return disposable();},
      registerTreeDataProvider(id,provider){treeProviders.set(id,provider);return disposable();},
      async showErrorMessage(s){errors.push(s);},
      async showInformationMessage(s,...rest){infos.push(s);return rest.length?undefined:undefined;},
      async showWarningMessage(){return undefined;},
      async showInputBox(){return inputs.shift();},
      async showQuickPick(items,opts){
        const pick=picks.shift();
        if(pick===undefined)return undefined;
        if(typeof pick==='function')return pick(items,opts);
        if(Array.isArray(pick))return pick.map(i=>items[i]);
        return items[pick];
      },
      async withProgress(_,fn){return fn({report(){}},{isCancellationRequested:false});},
      createWebviewPanel(_,title,col){const p={title,viewColumn:col,webview:{html:''},onDidDispose(){return disposable();},reveal(){},dispose(){}};panels.push(p);return p;},
      async showTextDocument(document,opts={}){const e={document,viewColumn:opts.viewColumn===-2?2:opts.viewColumn||2};this.activeTextEditor=e;this.visibleTextEditors=[e];return e;}
    },
    languages:{registerCodeLensProvider(_,provider){vscode.provider=provider;return disposable();}},
    env:{async openExternal(){return true;}}
  };
  return {vscode,handlers,errors,logs,infos,inputs,picks,panels,treeProviders};
}
async function fixture(t,transport,options={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lc-extension-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const store=new Store(path.join(dir,'solutions'));await store.init();
  const file=await store.cache(q);
  const ui=fakeVSCode();
  const secretListeners=[];
  const secrets=new Map(options.initialSecrets!==undefined?options.initialSecrets:[['leetcode.session.v1',JSON.stringify({session:'fake-session-value',csrf:'fake-csrf-value'})]]);
  const stateMap=new Map(options.initialState||[]);
  const context={
    globalStorageUri:ui.vscode.Uri.file(dir),
    subscriptions:[],
    globalState:{get(k){return stateMap.get(k);},async update(k,v){stateMap.set(k,v);}},
    secrets:{
      async get(k){return secrets.get(k);},
      async store(k,v){secrets.set(k,v);for(const fn of secretListeners)await fn({key:k});},
      async delete(k){secrets.delete(k);for(const fn of secretListeners)await fn({key:k});},
      onDidChange(fn){secretListeners.push(fn);return disposable();}
    }
  };
  const api=new LeetCodeClient(transport || (async()=>{throw new Error('No network expected');}));
  const controller=await createController(ui.vscode,context,{store,api});
  t.after(()=>context.subscriptions.forEach(d=>d.dispose()));
  const doc=await ui.vscode.workspace.openTextDocument(ui.vscode.Uri.file(file));
  await ui.vscode.window.showTextDocument(doc);
  return {...ui,context,secrets,stateMap,controller,store,file,doc,dir};
}

test('full command flow sends the selected dirty editor snapshot and receives remote-shaped verdict', async t=>{
  const requests=[];
  let checkAccount;
  const waiting=new Promise(resolve=>{checkAccount=resolve;});
  const f=await fixture(t,async(p,o)=>{
    requests.push([p,o]);
    if(p==='/graphql/'){await waiting;return {data:{userStatus:{isSignedIn:true,username:'test-user'}}};}
    if(p.endsWith('/submit/'))return {submission_id:555};
    if(p.endsWith('/check/'))return {state:'SUCCESS',status_code:10,status_msg:'Accepted',status_runtime:'3 ms',status_memory:'12 MB'};
    throw new Error('unexpected endpoint');
  });
  f.doc.text='class Solution { /* unsaved snapshot */ };';f.doc.version=8;f.doc.isDirty=true;
  const pending=f.handlers.get('lc.submit')();
  // The user edits and switches files while account verification is in progress.
  f.doc.text='newer edits must not be submitted';f.doc.version=9;
  const unrelated={uri:f.vscode.Uri.file(path.join(f.dir,'confidential.cpp')),version:1,getText:()=> 'CONFIDENTIAL'};
  f.vscode.window.activeTextEditor={document:unrelated};
  checkAccount();await pending;
  assert.equal(f.errors.length,0);
  assert.equal(requests.length,3);
  const body=requests.find(([p])=>p.endsWith('/submit/'))[1].body;
  assert.equal(body.typed_code,'class Solution { /* unsaved snapshot */ };');
  assert.equal(body.question_id,'101'); // internal ID, not displayed frontend number
  assert.match(f.logs.join('\n'),/OFFICIAL LEETCODE SUBMISSION[^]*Verdict: Accepted/);
  assert.match(f.logs.join('\n'),/Editor version: 8/);
  assert.ok(!JSON.stringify(requests).includes('CONFIDENTIAL'));
  assert.equal(await f.store.pending(),undefined);
});
test('unrelated C++ editor is rejected before any authenticated or network action',async t=>{
  let calls=0;
  const f=await fixture(t,async()=>{calls++;});
  f.vscode.window.activeTextEditor={document:{uri:f.vscode.Uri.file(path.join(f.dir,'business.cpp')),getText:()=>{throw new Error('must not read');}}};
  await f.handlers.get('lc.submit')();
  assert.equal(calls,0);assert.match(f.errors[0],/registered LeetCode/);
});
test('cached problem and C++ reopen offline without overwriting earlier work or contacting LeetCode',async t=>{
  let calls=0;
  const f=await fixture(t,async()=>{calls++;});
  await fs.writeFile(f.file,'previous saved work');
  f.inputs.push('two-sum');
  // Reopen Local Problem works independently of online discovery.
  f.picks.push(0);await f.handlers.get('lc.recent')();
  assert.equal(calls,0);assert.equal(await fs.readFile(f.file,'utf8'),'previous saved work');
  assert.match(f.panels[0].webview.html,/<h1>1\. Two Sum<\/h1>/);
  assert.equal(f.vscode.window.activeTextEditor.viewColumn,2);
  assert.equal(f.vscode.provider.provideCodeLenses(f.doc).length,4);
});
test('custom tests send the unsaved input buffer to the remote interpreter, never a local tool',async t=>{
  const requests=[];
  const f=await fixture(t,async(p,o)=>{
    requests.push([p,o]);
    if(p==='/graphql/')return {data:{userStatus:{isSignedIn:true,username:'test-user'}}};
    if(p.includes('interpret_solution'))return {interpret_id:'runcode_12.34_abc'};
    return {state:'SUCCESS',status_code:10,correct_answer:false,code_answer:['[]'],expected_code_answer:['[0,1]']};
  });
  await f.handlers.get('lc.custom')();
  const input=f.vscode.window.activeTextEditor.document;
  input.text='[4,5]\n9';input.isDirty=true;
  await f.vscode.window.showTextDocument(f.doc);
  await f.handlers.get('lc.runCustom')();
  assert.equal(f.errors.length,0);
  assert.equal(requests.find(([p])=>p.includes('interpret_solution'))[1].body.data_input,'[4,5]\n9');
  assert.match(f.logs.join('\n'),/REMOTE TEST[^]*Verdict: Wrong Answer[^]*Actual output:\n\[\]/);
});
test('connect stores credentials only after remote validation, disconnect removes them',async t=>{
  const f=await fixture(t,async()=>({data:{userStatus:{isSignedIn:true,username:'verified'}}}));
  f.vscode.window.showInformationMessage=async()=> 'Import Session';
  f.inputs.push('new-session-value','new-csrf-token');
  await f.handlers.get('lc.connect')();
  const saved=f.secrets.get('leetcode.session.v1');
  assert.equal(JSON.parse(saved).session,'new-session-value');
  for(const file of await fs.readdir(f.store.root)){
    assert.ok(!(await fs.readFile(path.join(f.store.root,file),'utf8')).includes('new-session-value'));
  }
  assert.ok(!f.logs.join('\n').includes('new-session-value'));
  await f.handlers.get('lc.disconnect')();assert.equal(f.secrets.size,0);
  await f.handlers.get('lc.run')();assert.match(f.errors.at(-1),/Connect your LeetCode account first/);
});

test('sidebar makes no startup network calls, loads anonymously on first use, and ignores malformed stored secrets', async t=>{
  const calls=[];
  const f=await fixture(t,async(_p,o)=>{
    calls.push(o);
    const query=o.body.query;
    if(query.includes('activeDailyCodingChallengeQuestion')){
      return {data:{activeDailyCodingChallengeQuestion:{date:'2026-10-27',link:'/problems/two-sum/',question:{...q,status:'ac'}}}};
    }
    if(query.includes('problemsetQuestionList')){
      return {data:{problemsetQuestionList:{total:2,questions:[
        {...q,status:null},
        {...q,questionId:'999',questionFrontendId:'LCP 01',title:'Guess Numbers',titleSlug:'guess-numbers',status:null}
      ]}}};
    }
    throw new Error('unexpected query');
  },{initialSecrets:[['leetcode.session.v1','{corrupted-json']]});

  // Activation made zero network calls.
  assert.equal(calls.length,0);
  const explorer=f.treeProviders.get('lc.explorer');
  assert.ok(explorer);

  // First sidebar root expansion triggers anonymous discovery without failing on corrupted secrets.
  const sections=await explorer.getChildren();
  assert.deepEqual(sections.map(s=>s.label),['Account','Daily Challenge','Browse Problems','Local Problems']);
  await f.controller.discovery.refreshAll();
  assert.ok(calls.every(c=>c.auth===undefined));

  const dailyRows=await explorer.getChildren(sections[1]);
  assert.equal(dailyRows[0].label,'1. Two Sum');
  // Unverified session must not show 'Solved' or 'Not started'.
  assert.equal(dailyRows[0].description,'2026-10-27 · Easy');

  const browseRows=await explorer.getChildren(sections[2]);
  const problemRows=browseRows.filter(r=>r.kind==='problem');
  assert.equal(problemRows.length,2);
  assert.equal(problemRows[0].description,'Easy');
  assert.equal(problemRows[1].label,'LCP 01. Guess Numbers');
  assert.equal(problemRows[1].description,'Easy · Unsupported ID');

  // Clicking unsupported nonnumeric entry surfaces explicit error without network calls.
  const countBefore=calls.length;
  await f.handlers.get('lc.openProblemItem')(problemRows[1]);
  assert.equal(calls.length,countBefore);
  assert.match(f.errors.at(-1),/not a supported numbered C\+\+ problem/);

  // Local Problems section shows 'Available locally', never remote solved status, and reopens offline.
  await fs.writeFile(f.file,'// local edits kept');
  const localRows=await explorer.getChildren(sections[3]);
  assert.equal(localRows[0].description,'Easy · Available locally');
  await f.handlers.get('lc.openLocalProblem')(localRows[0]);
  assert.equal(calls.length,countBefore);
  assert.equal(await fs.readFile(f.file,'utf8'),'// local edits kept');
});

test('filters, pagination, filter reset, andverified progress display work through sidebar actions', async t=>{
  const variablesLog=[];
  const f=await fixture(t,async(_p,o)=>{
    const {query,variables}=o.body;
    if(query.includes('userStatus'))return {data:{userStatus:{isSignedIn:true,username:'alice'}}};
    if(query.includes('activeDailyCodingChallengeQuestion')){
      return {data:{activeDailyCodingChallengeQuestion:{date:'2026-10-27',link:'/problems/two-sum/',question:{...q,status:'ac'}}}};
    }
    if(query.includes('questionTopicTags')){
      return {data:{questionTopicTags:{edges:[{node:{name:'Array',slug:'array'}},{node:{name:'Dynamic Programming',slug:'dynamic-programming'}}]}}};
    }
    if(query.includes('problemsetQuestionList')){
      variablesLog.push(variables);
      return {data:{problemsetQuestionList:{
        total:120,
        questions:Array.from({length:50},(_,i)=>({
          ...q,
          questionId:String(variables.skip+i+1),
          questionFrontendId:String(variables.skip+i+1),
          title:`Problem ${variables.skip+i+1}`,
          titleSlug:`problem-${variables.skip+i+1}`,
          status:i===0?'ac':i===1?'notac':null
        }))
      }}};
    }
    throw new Error('unexpected query');
  });

  // Verify account first so progress badges and filters are enabled.
  await f.handlers.get('lc.account')();
  assert.equal(f.controller.discovery.isVerified,true);

  await f.handlers.get('lc.refreshCatalog')();
  const browseSection=(await f.controller.explorer.getChildren())[2];
  const initialRows=await f.controller.explorer.getChildren(browseSection);
  const firstThree=initialRows.filter(r=>r.kind==='problem').slice(0,3);
  assert.equal(firstThree[0].description,'Easy · Solved');
  assert.equal(firstThree[1].description,'Easy · Attempted');
  assert.equal(firstThree[2].description,'Easy · Not started');

  // Pagination: advance to next page (skip=50).
  await f.handlers.get('lc.nextPage')();
  assert.equal(f.controller.discovery.skip,50);
  assert.equal(variablesLog.at(-1).skip,50);

  // Changing difficulty filter resets pagination skip to 0.
  f.picks.push(2); // Medium
  await f.handlers.get('lc.filterDifficulty')();
  assert.equal(f.controller.discovery.skip,0);
  assert.equal(variablesLog.at(-1).filters.difficulty,'MEDIUM');

  // Multi-topic filter and search keyword filter.
  f.picks.push([0,1]); // array, dynamic-programming
  await f.handlers.get('lc.filterTopics')();
  assert.deepEqual(variablesLog.at(-1).filters.tags,['array','dynamic-programming']);

  f.inputs.push('  binary tree  ');
  await f.handlers.get('lc.filterSearch')();
  assert.equal(variablesLog.at(-1).filters.searchKeywords,'binary tree');

  // Progress filter when verified.
  f.picks.push(1); // Solved -> AC
  await f.handlers.get('lc.filterStatus')();
  assert.equal(variablesLog.at(-1).filters.status,'AC');

  // Clear filters resets all filters and skip.
  await f.handlers.get('lc.clearFilters')();
  assert.deepEqual(variablesLog.at(-1),{limit:50,skip:0,filters:{}});
});

test('stale out-of-order catalog responses are discarded and cannot overwrite newer filter selection', async t=>{
  let resolveFirst;
  const firstGate=new Promise(r=>{resolveFirst=r;});
  let callCount=0;
  const f=await fixture(t,async(_p,o)=>{
    const {variables}=o.body;
    callCount++;
    if(callCount===1){
      await firstGate;
      return {data:{problemsetQuestionList:{total:1,questions:[{...q,title:'Stale Easy Problem',titleSlug:'stale-easy'}]}}};
    }
    return {data:{problemsetQuestionList:{total:1,questions:[{...q,questionFrontendId:'2',title:`Fresh ${variables.filters.difficulty} Problem`,titleSlug:'fresh-hard',difficulty:'Hard'}]}}};
  });

  const p1=f.controller.discovery.setDifficulty('EASY');
  const p2=f.controller.discovery.setDifficulty('HARD');
  await p2;
  resolveFirst();
  await p1;

  assert.equal(f.controller.discovery.filters.difficulty,'HARD');
  assert.equal(f.controller.discovery.catalog.questions.length,1);
  assert.equal(f.controller.discovery.catalog.questions[0].titleSlug,'fresh-hard');
});

test('Daily Challenge exposes server date, marks failed refreshes as stale without calling old challenge today, and opens problem without overwriting code', async t=>{
  let failDaily=false;
  const f=await fixture(t,async(_p,o)=>{
    const {query}=o.body;
    if(query.includes('activeDailyCodingChallengeQuestion')){
      if(failDaily)throw new LcError('NETWORK','Cannot reach LeetCode.');
      return {data:{activeDailyCodingChallengeQuestion:{date:'2026-10-25',link:'/problems/two-sum/',question:q}}};
    }
    if(query.includes('questionData')){
      return {data:{question:{...q,codeSnippets:[{langSlug:'cpp',code:'class Solution { /* remote starter */ };'}]}}};
    }
    return {data:{problemsetQuestionList:{total:0,questions:[]}}};
  });

  await fs.writeFile(f.file,'// user solution preserved');
  await f.handlers.get('lc.refreshDaily')();
  const sections=await f.controller.explorer.getChildren();
  assert.equal(sections[1].description,'2026-10-25');

  // Subsequent refresh failure keeps dated challenge as explicitly stale + retry row.
  failDaily=true;
  await f.handlers.get('lc.refreshDaily')();
  const updatedSections=await f.controller.explorer.getChildren();
  assert.equal(updatedSections[1].description,'2026-10-25 (stale)');
  const dailyChildren=await f.controller.explorer.getChildren(updatedSections[1]);
  assert.equal(dailyChildren.length,2);
  assert.match(dailyChildren[0].description,/2026-10-25 \(stale\)/);
  assert.ok(!dailyChildren[0].description.toLowerCase().includes('today'));
  assert.equal(dailyChildren[1].command.command,'lc.refreshDaily');

  // Clicking the Daily problem row opens it via shared slug path without overwriting existing C++ file.
  await f.handlers.get('lc.openProblemItem')(dailyChildren[0]);
  assert.equal(await fs.readFile(f.file,'utf8'),'// user solution preserved');
});

test('browser sign-in returns immediately without prompting cookies or marking connected, and failed replacement preserves prior credentials/state', async t=>{
  let externalUrl;
  let calls=0;
  const f=await fixture(t,async(_p,o)=>{
    calls++;
    const session=o.auth?.session;
    if(session==='alice-valid-session')return {data:{userStatus:{isSignedIn:true,username:'alice'}}};
    throw new LcError('AUTH','Your LeetCode session is invalid or expired.',true);
  },{initialSecrets:[['leetcode.session.v1',JSON.stringify({session:'alice-valid-session',csrf:'alice-valid-csrf'})]]});
  f.vscode.env.openExternal=async uri=>{externalUrl=uri.toString();return true;};

  // Startup with stored secret is 'unverified', never 'verified'.
  assert.equal(f.controller.discovery.account.kind,'unverified');
  await f.handlers.get('lc.filterStatus')();
  assert.match(f.errors.at(-1),/verify your LeetCode account/i);
  f.errors.length=0;

  // Selecting Open LeetCode Sign-in from Connect Account opens browser and returns without prompting inputs or making network calls.
  f.vscode.window.showInformationMessage=async()=> 'Open LeetCode Sign-in';
  f.inputs.push('should-not-be-consumed');
  await f.handlers.get('lc.connect')();
  assert.equal(externalUrl,'https://leetcode.com/accounts/login/');
  assert.equal(calls,0);
  assert.equal(f.inputs.length,1);
  assert.equal(f.controller.discovery.account.kind,'unverified');
  f.inputs.length=0;

  // Verify existing saved session.
  await f.handlers.get('lc.account')();
  assert.equal(f.controller.discovery.account.kind,'verified');
  assert.equal(f.controller.discovery.account.username,'alice');

  // Attempt replacement import with invalid cookie format: previous secret and verified state remain intact.
  f.inputs.push('bad;cookie','csrf-value-123');
  await f.handlers.get('lc.importSession')();
  assert.match(f.errors.at(-1),/Paste only each cookie value/);
  assert.equal(JSON.parse(f.secrets.get('leetcode.session.v1')).session,'alice-valid-session');
  assert.equal(f.controller.discovery.account.kind,'verified');
  assert.equal(f.controller.discovery.account.username,'alice');
  assert.ok(!f.logs.join('\n').includes('bad;cookie'));

  // Attempt replacement import with rejected remote session: previous secret and verified state remain intact.
  f.inputs.push('rejected-candidate-session','rejected-candidate-csrf');
  await f.handlers.get('lc.importSession')();
  assert.match(f.errors.at(-1),/invalid or expired/);
  assert.equal(JSON.parse(f.secrets.get('leetcode.session.v1')).session,'alice-valid-session');
  assert.equal(f.controller.discovery.account.kind,'verified');
  assert.equal(f.controller.discovery.account.username,'alice');
  assert.ok(!f.logs.join('\n').includes('rejected-candidate-session'));
  assert.ok(!f.errors.join('\n').includes('rejected-candidate-session'));
});

test('challenge/network/redirect failures mark account unavailable while preserving secrets, whereas positive auth expiry marks expired', async t=>{
  let mode='challenge';
  const f=await fixture(t,async()=>{
    if(mode==='challenge')throw new LcError('FORBIDDEN','Cloudflare challenge',true);
    if(mode==='redirect'){const e=new LcError('AUTH','Redirected',true);e.redirected=true;throw e;}
    if(mode==='network')throw new LcError('NETWORK','Connection reset');
    if(mode==='expired')throw new LcError('AUTH','Session expired',true);
    return {data:{userStatus:{isSignedIn:true,username:'alice'}}};
  });

  for (const m of ['challenge','redirect','network']) {
    mode=m;
    await f.handlers.get('lc.account')();
    assert.equal(f.controller.discovery.account.kind,'unavailable');
    assert.ok(f.secrets.has('leetcode.session.v1'));
  }

  mode='ok';
  await f.handlers.get('lc.account')();
  assert.equal(f.controller.discovery.account.kind,'verified');
  await f.controller.discovery.setStatusFilter('AC');
  assert.equal(f.controller.discovery.filters.status,'AC');

  // Positive 401/signed-out expiry transitions to 'expired', resets progress filter, and keeps secret until explicit disconnect.
  mode='expired';
  await f.handlers.get('lc.account')();
  assert.equal(f.controller.discovery.account.kind,'expired');
  assert.equal(f.controller.discovery.filters.status,'ALL');
  assert.ok(f.secrets.has('leetcode.session.v1'));
});

test('disconnect, cross-window secret changes, and account switches invalidate delayed responses and clear stale progress', async t=>{
  let resolveVerify;
  let markVerifyEntered;
  let verifyEntered=new Promise(r=>{markVerifyEntered=r;});
  let verifyGate=new Promise(r=>{resolveVerify=r;});
  let currentUser='alice';
  let submitCalls=0;
  const f=await fixture(t,async(p,o)=>{
    if(p.endsWith('/submit/')){submitCalls++;return {submission_id:999};}
    const {query}=o.body;
    if(query.includes('userStatus')){
      markVerifyEntered?.();
      await verifyGate;
      return {data:{userStatus:{isSignedIn:true,username:currentUser}}};
    }
    if(query.includes('activeDailyCodingChallengeQuestion')){
      return {data:{activeDailyCodingChallengeQuestion:{date:'2026-10-27',link:'/problems/two-sum/',question:{...q,status:'ac'}}}};
    }
    return {data:{problemsetQuestionList:{total:1,questions:[{...q,status:'ac'}]}}};
  });

  // Start submit (which awaits verifiedAuth), wait until userStatus is in flight, then simulate cross-window disconnect.
  const pendingSubmit=f.handlers.get('lc.submit')();
  await verifyEntered;
  await f.context.secrets.delete('leetcode.session.v1');
  assert.equal(f.controller.discovery.account.kind,'signed_out');
  resolveVerify();
  await pendingSubmit;

  // Submit was aborted before posting code, and delayed verification did not restore 'alice'.
  assert.equal(submitCalls,0);
  assert.equal(f.controller.discovery.account.kind,'signed_out');
  assert.match(f.errors.at(-1),/account state changed/i);

  // Now connect as alice, open description & load solved progress, then switch to bob.
  verifyGate=Promise.resolve();
  f.inputs.push('alice-session-token','alice-csrf-token');
  await f.handlers.get('lc.importSession')();
  await f.handlers.get('lc.refreshCatalog')();
  await f.controller.discovery.setStatusFilter('AC');
  await f.handlers.get('lc.description')();
  assert.equal(f.controller.discovery.catalog.questions[0].status,'ac');

  // Inject stale status:'ac' into local cached metadata on disk and switch account to bob.
  await fs.writeFile(path.join(f.store.root,'1.two-sum.cpp.json'),JSON.stringify({...q,status:'ac'}));
  currentUser='bob';
  f.inputs.push('bob-session-token-1','bob-csrf-token-1');
  // When bob loads catalog, return status: null for bob.
  f.controller.api.transport=async(_p,o)=>{
    const {query}=o.body;
    if(query.includes('userStatus'))return {data:{userStatus:{isSignedIn:true,username:'bob'}}};
    if(query.includes('activeDailyCodingChallengeQuestion'))return {data:{activeDailyCodingChallengeQuestion:{date:'2026-10-27',link:'/problems/two-sum/',question:{...q,status:null}}}};
    return {data:{problemsetQuestionList:{total:1,questions:[{...q,status:null}]}}};
  };
  await f.handlers.get('lc.importSession')();
  assert.equal(f.controller.discovery.account.username,'bob');
  assert.equal(f.controller.discovery.filters.status,'ALL');
  assert.equal(f.controller.discovery.catalog.questions[0].status,null);

  // Reopening description from local registered file ignores stale 'ac' in disk JSON.
  await f.handlers.get('lc.description')();
  assert.match(f.panels[0].webview.html,/Status unavailable \/ unsolved/);
});

test('completed official submit and resume refresh visible progress without failing when refresh errors, while test runs never refresh progress', async t=>{
  let solved=false;
  let failRefresh=false;
  let catalogCalls=0;
  const f=await fixture(t,async(p,o)=>{
    if(p.includes('interpret_solution'))return {interpret_id:'run_1'};
    if(p.endsWith('/submit/'))return {submission_id:777};
    if(p.endsWith('/check/'))return {state:'SUCCESS',status_code:10,status_msg:'Accepted',correct_answer:true};
    const {query}=o.body;
    if(query.includes('userStatus'))return {data:{userStatus:{isSignedIn:true,username:'test-user'}}};
    if(query.includes('activeDailyCodingChallengeQuestion')){
      if(failRefresh)throw new LcError('NETWORK','Refresh failed');
      return {data:{activeDailyCodingChallengeQuestion:{date:'2026-10-27',link:'/problems/two-sum/',question:{...q,status:solved?'ac':null}}}};
    }
    if(query.includes('problemsetQuestionList')){
      catalogCalls++;
      if(failRefresh)throw new LcError('NETWORK','Refresh failed');
      return {data:{problemsetQuestionList:{total:1,questions:[{...q,status:solved?'ac':null}]}}};
    }
    throw new Error('unexpected query');
  });

  await f.handlers.get('lc.account')();
  await f.controller.discovery.refreshAll();
  assert.equal(f.controller.discovery.catalog.questions[0].status,null);
  const callsAfterInit=catalogCalls;

  // Running examples ('lc.run') must not mark solved or refresh catalog beyond account verification.
  await f.handlers.get('lc.run')();
  assert.equal(f.controller.discovery.catalog.questions[0].status,null);
  assert.equal(catalogCalls,callsAfterInit+1); // verifiedAuth refreshed once before test run, no post-run refresh

  // Official submit refreshes visible progress to 'ac'.
  solved=true;
  await f.handlers.get('lc.submit')();
  assert.equal(f.errors.length,0);
  assert.equal(f.controller.discovery.catalog.questions[0].status,'ac');
  assert.equal(f.controller.discovery.daily.data.question.status,'ac');

  // If post-submit or post-resume refresh fails, the submission/resume still succeeds without error.
  failRefresh=true;
  await f.store.acquire({token:'11111111-1111-1111-1111-111111111111',kind:'submit',id:'888',slug:'two-sum',title:'Two Sum',number:'1',user:'test-user',file:f.file,version:1,hash:'abc',startedAt:'2026-10-27T00:00:00Z'});
  await f.handlers.get('lc.resume')();
  assert.equal(f.errors.length,0);
  assert.match(f.logs.join('\n'),/OFFICIAL LEETCODE SUBMISSION[^]*Verdict: Accepted/);
});

