'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { LeetCodeClient, LcError, requestJson, credentials } = require('../src/api');
const { Store } = require('../src/store');
const { Jobs } = require('../src/jobs');
const { sanitize, description, formatResult } = require('../src/render');
const { buildPackages, readZipEntries, RUNTIME_ALLOWLIST, SOURCE_ALLOWLIST } = require('../scripts/package');

const q = { questionId:'1', questionFrontendId:'1', title:'Two Sum', titleSlug:'two-sum', difficulty:'Easy', content:'<p>Find two values.</p>', starter:'class Solution { public: vector<int> twoSum(vector<int>& nums, int target) {} };', exampleTestcases:'[2,7,11,15]\n9', enableRunCode:true };
const auth = credentials('fake-session-value', 'fake-csrf-token');
async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lc-test-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const store = new Store(path.join(dir, 'solutions'));
  await store.init();
  return { dir, store };
}
function fakeRequest(status, response, options = {}) {
  return (url, init, callback) => {
    options.inspect?.(url, init);
    const req = new EventEmitter();
    req.destroy = error => { req.emit('error', error); req.emit('close'); };
    req.end = body => {
      options.body?.(body);
      queueMicrotask(() => {
        if (options.networkError) return req.destroy(new Error('sensitive-session-should-not-leak'));
        const res = new EventEmitter();
        res.statusCode = status;
        callback(res);
        res.emit('data', Buffer.from(typeof response === 'string' ? response : JSON.stringify(response)));
        res.emit('end'); req.emit('close');
      });
    };
    return req;
  };
}

test('transport uses fixed HTTPS origin, CSRF headers and exact JSON, with no redirects', async () => {
  const data = await requestJson('/problems/two-sum/submit/', { method:'POST', body:{typed_code:'unsaved code'}, auth }, fakeRequest(200, {submission_id:42}, {
    inspect(url, init) {
      assert.equal(url, 'https://leetcode.com/problems/two-sum/submit/');
      assert.equal(init.headers.Cookie, 'LEETCODE_SESSION=fake-session-value; csrftoken=fake-csrf-token');
      assert.equal(init.headers['X-CSRFToken'], auth.csrf);
      assert.equal(init.headers.Referer, 'https://leetcode.com/problems/two-sum/');
    }, body: body => assert.equal(JSON.parse(body).typed_code, 'unsaved code')
  }));
  assert.equal(data.submission_id, 42);
  await assert.rejects(requestJson('/problems/two-sum/submit/', {}, fakeRequest(302, {})), {code:'AUTH'});
  await assert.rejects(requestJson('//evil.example/', {}, fakeRequest(200, {})), {code:'ORIGIN'});
});
test('transport reports auth, Cloudflare, throttling, protocol and network errors without response leakage', async () => {
  for (const [status, body, code] of [[401,{},'AUTH'],[403,'SECRET','FORBIDDEN'],[429,{},'RATE_LIMIT'],[503,{},'HTTP'],[200,'<html>challenge SECRET</html>','PROTOCOL'],[200,[],'PROTOCOL']]) {
    await assert.rejects(requestJson('/graphql/', {}, fakeRequest(status, body)), e => e.code === code && !e.message.includes('SECRET'));
  }
  await assert.rejects(requestJson('/graphql/', {}, fakeRequest(200, {}, {networkError:true})), e => e.code === 'NETWORK' && !e.message.includes('sensitive-session'));
  assert.throws(() => credentials('session\r\nInjected: true', 'csrf-token'), {code:'CREDENTIALS'});
});
test('client sends remote C++ test and submit payloads once and validates IDs/states', async () => {
  const calls = [];
  const client = new LeetCodeClient(async (p,o) => { calls.push([p,o]); return p.endsWith('/check/') ? {state:'SUCCESS',status_code:10} : p.includes('interpret') ? {interpret_id:'runcode_123.45_abc'} : {submission_id:100}; });
  assert.equal(await client.start('test', q, 'C++ EXACT', '[1,2]\n3', auth), 'runcode_123.45_abc');
  assert.deepEqual(calls[0][1].body, {lang:'cpp',question_id:'1',typed_code:'C++ EXACT',data_input:'[1,2]\n3'});
  await client.start('submit', q, 'C++ EXACT', undefined, auth);
  assert.equal(calls[1][0], '/problems/two-sum/submit/');
  assert.equal('data_input' in calls[1][1].body, false);
  await client.check('runcode_123.45_abc', auth);
  assert.equal(calls.length, 3);
  await assert.rejects(client.check('../../evil', auth), {code:'PROTOCOL'});
  const changed = new LeetCodeClient(async () => ({state:'UNKNOWN'}));
  await assert.rejects(changed.check('123', auth), {code:'PROTOCOL'});
});
test('missing access, absent C++ and expired accounts produce explicit errors', async () => {
  const client = response => new LeetCodeClient(async () => response);
  await assert.rejects(client({data:{userStatus:{isSignedIn:false}}}).account(auth), {code:'AUTH'});
  await assert.rejects(client({data:{question:null}}).problem('missing'), {code:'NOT_FOUND'});
  await assert.rejects(client({data:{question:{...q, content:null,isPaidOnly:true}}}).problem('two-sum'), {code:'ACCESS'});
  await assert.rejects(client({data:{question:q}}).problem('two-sum'), {code:'UNSUPPORTED'});
  await assert.rejects(client({errors:[{message:'PRIVATE'}]}).problem('two-sum'), e => e.code === 'GRAPHQL' && !e.message.includes('PRIVATE'));
});
test('persistent solutions are never overwritten, and survive a new Store instance', async t => {
  const {store} = await setup(t);
  const file = await store.cache(q);
  await fs.writeFile(file, 'my previous work');
  await store.cache({...q, starter:'changed starter'});
  assert.equal(await fs.readFile(file,'utf8'), 'my previous work');
  const reloaded = new Store(store.root);
  assert.equal((await reloaded.problems())[0].titleSlug, q.titleSlug);
  assert.equal((await reloaded.registered(file)).questionId,'1');
  await assert.rejects(reloaded.registered(path.join(store.root,'other.cpp')), {code:'SELECTION'});
  await assert.rejects(reloaded.registered(path.join(path.dirname(store.root),'1.two-sum.cpp')), {code:'SELECTION'});
});
test('path traversal and outside files cannot be cached or selected as solutions', async t => {
  const {dir,store} = await setup(t);
  const unrelated = path.join(dir, 'private.cpp');
  await fs.writeFile(unrelated, 'confidential');
  await assert.rejects(store.cache({...q,titleSlug:'../../private'}), {code:'PROTOCOL'});
  await assert.rejects(store.cache({...q,questionFrontendId:'../1'}), {code:'PATH'});
  await assert.rejects(store.safe(unrelated, true), {code:'PATH'});
  await assert.rejects(store.registered(unrelated), {code:'SELECTION'});
  assert.equal(await fs.readFile(unrelated,'utf8'),'confidential');
});
test('linked files cannot be selected as solutions or inputs', async t => {
  const {dir,store} = await setup(t);
  const file = await store.cache(q);
  await fs.unlink(file);
  const unrelated = path.join(dir, 'private.cpp');
  await fs.writeFile(unrelated, 'confidential');
  try {
    await fs.symlink(unrelated, file);
  } catch (e) {
    if (e.code === 'EPERM' || e.code === 'ENOSYS') {
      t.skip(`Symbolic link creation not permitted in this environment (${e.code}).`);
      return;
    }
    throw e;
  }
  await assert.rejects(store.registered(file), {code:'PATH'});
  const input = path.join(store.root,'1.two-sum.cpp.input.txt');
  await fs.symlink(unrelated,input);
  await assert.rejects(store.custom(q), {code:'PATH'});
  assert.equal(await fs.readFile(unrelated,'utf8'),'confidential');
});
const snapshot = {code:'unsaved C++',file:'/private/solutions/1.two-sum.cpp',version:7};
test('remote job polls real-shaped responses, persists final result and excludes code/credentials from metadata', async t => {
  const {store} = await setup(t);
  let posts=0,checks=0;
  const api = {start:async (...args)=>{posts++;assert.equal(args[2],snapshot.code);return '987';},check:async()=>++checks===1?{state:'PENDING'}:{state:'SUCCESS',status_code:10,status_msg:'Accepted'}};
  const jobs = new Jobs(store,api,{sleep:async()=>{}});
  const result = await jobs.start('submit',q,snapshot,undefined,auth,'me',()=>{});
  assert.equal(result.result.status_msg,'Accepted');
  assert.equal(posts,1); assert.equal(checks,2);
  assert.equal(await store.pending(),undefined);
  const serialized = JSON.stringify(await store.readJSON('last-result.json'));
  assert.ok(!serialized.includes(snapshot.code)); assert.ok(!serialized.includes(auth.session));
});
test('ambiguous POST failure stays pending across reload and never automatically reposts', async t => {
  const {store} = await setup(t);
  let posts=0;
  const api={start:async()=>{posts++;throw new LcError('NETWORK','request interrupted');}};
  const jobs=new Jobs(store,api);
  await assert.rejects(jobs.start('submit',q,snapshot,undefined,auth,'me',()=>{}), {code:'NETWORK'});
  assert.ok(await store.pending());
  const reloaded=new Jobs(new Store(store.root),api);
  await assert.rejects(reloaded.start('submit',q,snapshot,undefined,auth,'me',()=>{}), {code:'BUSY'});
  await assert.rejects(reloaded.resume(auth,'me',()=>{}), {code:'UNKNOWN'});
  assert.equal(posts,1);
});
test('known rejection releases lock while poll failure preserves ID for resume', async t => {
  const {store} = await setup(t);
  const bad=new Jobs(store,{start:async()=>{throw new LcError('FORBIDDEN','blocked',true);}});
  await assert.rejects(bad.start('submit',q,snapshot,undefined,auth,'me',()=>{}));
  assert.equal(await store.pending(),undefined);
  let posts=0;
  const api={start:async()=>{posts++;return '123';},check:async()=>{throw new LcError('NETWORK','interrupted');}};
  const jobs=new Jobs(store,api);
  await assert.rejects(jobs.start('submit',q,snapshot,undefined,auth,'me',()=>{}));
  assert.equal((await store.pending()).id,'123');
  await assert.rejects(jobs.resume(auth,'different-user',()=>{}), {code:'ACCOUNT'});
  api.check=async()=>({state:'SUCCESS',status_code:11});
  const result=await jobs.resume(auth,'me',()=>{});
  assert.equal(result.result.status_code,11); assert.equal(posts,1);
});
test('concurrent windows cannot send a second request while one is pending', async t => {
  const {store} = await setup(t);
  let release;
  const started=new Promise(resolve=>{release=resolve;});
  let unblock;
  const waiting=new Promise(resolve=>{unblock=resolve;});
  let posts=0;
  const api={start:async()=>{posts++;release();await waiting;return '123';},check:async()=>({state:'SUCCESS',status_code:10})};
  const first=new Jobs(store,api).start('submit',q,snapshot,undefined,auth,'me',()=>{});
  await started;
  await assert.rejects(new Jobs(new Store(store.root),api).start('submit',q,snapshot,undefined,auth,'me',()=>{}), {code:'BUSY'});
  unblock(); await first;
  assert.equal(posts,1);
});
test('poll timeout and cancellation keep IDs instead of resending code', async t => {
  const {store} = await setup(t);
  let now=0;
  const api={start:async()=> '111',check:async()=>({state:'PENDING'})};
  const jobs=new Jobs(store,api,{now:()=>now,sleep:async()=>{now+=10;},timeoutMs:20});
  await assert.rejects(jobs.start('test',q,snapshot,'input',auth,'me',()=>{}), {code:'POLL_TIMEOUT'});
  assert.equal((await store.pending()).id,'111');
  await assert.rejects(jobs.resume(auth,'me',()=>{}, {isCancellationRequested:true}), {code:'CANCELLED'});
  assert.equal((await store.pending()).id,'111');
});
test('description content cannot inject executable attributes, scripts or remote requests', () => {
  const html=description({...q,title:'<script>bad()</script>',content:'<script>alert(1)</script><img src="https://evil.example/a"><p onclick="bad()">Text <code>&lt;x&gt;</code></p><a href="command:evil">link</a><table style="color:red"><tr><td>cell</td></tr></table>'});
  assert.ok(!html.includes('onclick')); assert.ok(!html.includes('href='));
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('evil.example'));
  assert.ok(html.includes('<table><tr><td>cell</td></tr></table>'));
  assert.ok(html.includes("default-src 'none'")); assert.ok(html.includes('&lt;script&gt;bad()'));
  assert.equal(sanitize('<svg><script>bad()</script></svg><p data-x="a">ok</p>'),'<p>ok</p>');
});
test('test execution success is never mistaken for Accepted, and error details are shown', () => {
  const job={kind:'test',number:'1',title:'Two Sum'};
  assert.match(formatResult({job,result:{status_code:10,correct_answer:false,code_answer:['[1,2]'],expected_code_answer:['[0,1]']}}), /Verdict: Wrong Answer/);
  assert.match(formatResult({job,result:{status_code:10}}), /comparison unavailable/);
  assert.match(formatResult({job:{...job,kind:'submit'},result:{status_code:20,full_compile_error:'unknown identifier'}}), /Compilation Error[^]*unknown identifier/);
  assert.match(formatResult({job:{...job,kind:'submit'},result:{status_code:14}}), /Time Limit Exceeded/);
});
test('Node packager builds verified 0.3.0 VSIX and source archives with forward-slash paths and strict allowlist', async t => {
  const {dir} = await setup(t);
  const rootDir = path.resolve(__dirname, '..');
  const out = buildPackages(rootDir, dir);
  assert.equal(path.basename(out.vsixPath), 'leetcode-inside-vscode-0.3.0.vsix');
  assert.equal(path.basename(out.sourceZipPath), 'leetcode-inside-vscode-0.3.0-source.zip');

  const vsixItems = readZipEntries(await fs.readFile(out.vsixPath));
  const sourceItems = readZipEntries(await fs.readFile(out.sourceZipPath));

  assert.equal(vsixItems.length, RUNTIME_ALLOWLIST.length + 2);
  assert.equal(sourceItems.length, SOURCE_ALLOWLIST.length);

  const vsixNames = new Set(vsixItems.map(e => e.name));
  assert.ok(vsixNames.has('extension.vsixmanifest'));
  assert.ok(vsixNames.has('[Content_Types].xml'));
  assert.ok(vsixNames.has('extension/media/leetcode.svg'));
  assert.ok(vsixNames.has('extension/media/dashboard.css'));
  assert.ok(vsixNames.has('extension/media/dashboard.js'));
  assert.ok(vsixNames.has('extension/src/dashboard.js'));
  assert.ok(vsixNames.has('extension/src/discovery.js'));
  assert.ok(vsixNames.has('extension/src/explorer.js'));

  const vsixManifest = vsixItems.find(e => e.name === 'extension.vsixmanifest').data.toString('utf8');
  assert.match(vsixManifest, /Version="0\.3\.0"/);
  const contentTypes = vsixItems.find(e => e.name === '[Content_Types].xml').data.toString('utf8');
  assert.match(contentTypes, /Extension="css"\s+ContentType="text\/css"/);
  assert.match(contentTypes, /Extension="svg"\s+ContentType="image\/svg\+xml"/);

  for (const item of [...vsixItems, ...sourceItems]) {
    assert.ok(!item.name.includes('\\'));
    assert.ok(!item.name.includes('.git/'));
    assert.ok(!item.name.includes('dist/'));
  }
});
