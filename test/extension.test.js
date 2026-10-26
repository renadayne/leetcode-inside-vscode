'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createController} = require('../src/extension');
const {Store} = require('../src/store');
const {LeetCodeClient} = require('../src/api');

const q={questionId:'101',questionFrontendId:'1',title:'Two Sum',titleSlug:'two-sum',difficulty:'Easy',content:'<p>Problem</p>',starter:'class Solution {};',exampleTestcases:'[2,7]\n9',enableRunCode:true};
const disposable=()=>({dispose(){}});
function fakeVSCode() {
  const handlers=new Map();
  const errors=[], logs=[], infos=[], inputs=[], picks=[], panels=[];
  const documents=[];
  const Uri={file:file=>({scheme:'file',fsPath:file,toString:()=>`file://${file}`}),parse:value=>({toString:()=>value})};
  const vscode={Uri,StatusBarAlignment:{Left:1},ViewColumn:{One:1,Beside:-2},ProgressLocation:{Notification:15},
    EventEmitter:class {event=()=>disposable();fire(){}dispose(){}},
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
      async showErrorMessage(s){errors.push(s);},
      async showInformationMessage(s,...rest){infos.push(s);return rest.length?undefined:undefined;},
      async showWarningMessage(){return undefined;},
      async showInputBox(){return inputs.shift();},
      async showQuickPick(items){const pick=picks.shift();return pick===undefined?undefined:items[pick];},
      async withProgress(_,fn){return fn({report(){}},{isCancellationRequested:false});},
      createWebviewPanel(_,title,col){const p={title,viewColumn:col,webview:{html:''},onDidDispose(){return disposable();},reveal(){},dispose(){}};panels.push(p);return p;},
      async showTextDocument(document,opts={}){const e={document,viewColumn:opts.viewColumn===-2?2:opts.viewColumn||2};this.activeTextEditor=e;this.visibleTextEditors=[e];return e;}
    },
    languages:{registerCodeLensProvider(_,provider){vscode.provider=provider;return disposable();}},
    env:{async openExternal(){return true;}}
  };
  return {vscode,handlers,errors,logs,infos,inputs,picks,panels};
}
async function fixture(t,transport) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lc-extension-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const store=new Store(path.join(dir,'solutions'));await store.init();
  const file=await store.cache(q);
  const ui=fakeVSCode();
  const secrets=new Map([['leetcode.session.v1',JSON.stringify({session:'fake-session-value',csrf:'fake-csrf-value'})]]);
  const context={globalStorageUri:ui.vscode.Uri.file(dir),subscriptions:[],globalState:{async update(){}},secrets:{async get(k){return secrets.get(k);},async store(k,v){secrets.set(k,v);},async delete(k){secrets.delete(k);}}};
  const api=new LeetCodeClient(transport || (async()=>{throw new Error('No network expected');}));
  const controller=await createController(ui.vscode,context,{store,api});
  t.after(()=>context.subscriptions.forEach(d=>d.dispose()));
  const doc=await ui.vscode.workspace.openTextDocument(ui.vscode.Uri.file(file));
  await ui.vscode.window.showTextDocument(doc);
  return {...ui,context,secrets,controller,store,file,doc,dir};
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
