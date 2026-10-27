'use strict';
// Read-only. No cookies, run requests, or submissions. Opt in with npm run smoke:live.
const { LeetCodeClient } = require('../src/api');
const api = new LeetCodeClient();

(async () => {
  const problem = await api.problem('two-sum');
  if (problem.questionFrontendId !== '1' || !problem.starter.includes('twoSum')) {
    throw new Error('Unexpected Two Sum schema');
  }
  console.log('PASS: live Two Sum description, C++ starter, and example inputs retrieved.');

  const list = await api.search('1');
  const match = list.questions.find(q => String(q.questionFrontendId) === '1');
  if (!match || match.titleSlug !== 'two-sum') {
    throw new Error('Exact number 1 not found in first search page');
  }
  console.log('PASS: live problem number 1 resolves to two-sum.');

  const filtered = await api.listProblems({ tags: ['array'], difficulty: 'EASY', limit: 2 });
  if (!filtered.total || !Array.isArray(filtered.questions) || !filtered.questions.length) {
    throw new Error('Unexpected filtered problem list response');
  }
  console.log(`PASS: live filtered problem list (Array + Easy) returned ${filtered.questions.length} items (total ${filtered.total}).`);

  const topics = await api.topics();
  if (!Array.isArray(topics) || !topics.some(t => t.slug === 'array')) {
    throw new Error('Unexpected topic catalog response');
  }
  console.log(`PASS: live topic catalog retrieved (${topics.length} topics).`);

  const daily = await api.daily();
  if (!daily.date || !daily.question?.titleSlug) {
    throw new Error('Unexpected Daily Challenge response');
  }
  console.log(`PASS: live Daily Challenge retrieved (${daily.date} · ${daily.question.questionFrontendId}. ${daily.question.titleSlug}).`);
  console.log('NOT VERIFIED: authentication, remote tests, official submissions, and account progress require your account.');
})().catch(e => {
  console.error(e.code ? `${e.code}: ${e.message}` : 'Live schema check failed.');
  process.exitCode = 1;
});
