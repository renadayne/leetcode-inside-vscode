'use strict';
// Read-only. No cookies, run requests, or submissions. Opt in with npm run smoke:live.
const {LeetCodeClient} = require('../src/api');
const api = new LeetCodeClient();
(async()=>{
  const problem=await api.problem('two-sum');
  if(problem.questionFrontendId!=='1' || !problem.starter.includes('twoSum')) throw new Error('Unexpected Two Sum schema');
  console.log('PASS: live Two Sum description, C++ starter, and example inputs retrieved.');
  const list=await api.search('1');
  const match=list.questions.find(q=>String(q.questionFrontendId)==='1');
  if(!match || match.titleSlug!=='two-sum') throw new Error('Exact number 1 not found in first search page');
  console.log('PASS: live problem number 1 resolves to two-sum.');
  console.log('NOT VERIFIED: authentication, remote tests, official submissions, and account history require your account.');
})().catch(e=>{console.error(e.code?`${e.code}: ${e.message}`:'Live schema check failed.');process.exitCode=1;});
