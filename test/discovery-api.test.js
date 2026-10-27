'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  LeetCodeClient,
  LcError,
  credentials,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_SKIP,
  MAX_QUERY_LENGTH,
  MAX_TOPIC_FILTERS
} = require('../src/api');

const auth = credentials('fake-session-value', 'fake-csrf-token');

const sampleQuestion = {
  questionId: '1',
  questionFrontendId: '1',
  title: 'Two Sum',
  titleSlug: 'two-sum',
  difficulty: 'Easy',
  isPaidOnly: false,
  status: null,
  topicTags: [
    { name: 'Array', slug: 'array' },
    { name: 'Hash Table', slug: 'hash-table' }
  ]
};

test('listProblems sends aliased questionList query with mapped variables and normalizes results', async () => {
  const calls = [];
  const client = new LeetCodeClient(async (path, options) => {
    calls.push([path, options]);
    return {
      data: {
        problemsetQuestionList: {
          total: 3,
          questions: [
            { ...sampleQuestion, status: null },
            { ...sampleQuestion, questionId: '2', questionFrontendId: '2', title: 'Add Two Numbers', titleSlug: 'add-two-numbers', difficulty: 'MEDIUM', status: 'ac' },
            { ...sampleQuestion, questionId: '4', questionFrontendId: '4', title: 'Median of Two Sorted Arrays', titleSlug: 'median-of-two-sorted-arrays', difficulty: 'Hard', isPaidOnly: true, status: 'notac' }
          ]
        }
      }
    };
  });

  const page = await client.listProblems({
    limit: 20,
    skip: 0,
    difficulty: 'Easy',
    tags: ['array', 'hash-table', 'array'],
    query: '  two sum  ',
    status: 'solved'
  }, auth);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/graphql/');
  assert.equal(calls[0][1].auth, auth);
  const { query, variables } = calls[0][1].body;
  assert.match(query, /problemsetQuestionList:\s*questionList\(categorySlug:\s*"",\s*limit:\s*\$limit,\s*skip:\s*\$skip,\s*filters:\s*\$filters\)/);
  assert.match(query, /total:\s*totalNum/);
  assert.match(query, /questions:\s*data/);
  assert.deepEqual(variables, {
    limit: 20,
    skip: 0,
    filters: {
      difficulty: 'EASY',
      tags: ['array', 'hash-table'],
      searchKeywords: 'two sum',
      status: 'AC'
    }
  });

  assert.equal(page.total, 3);
  assert.equal(page.limit, 20);
  assert.equal(page.skip, 0);
  assert.equal(page.hasMore, false);
  assert.equal(page.questions.length, 3);
  assert.equal(page.questions[0].status, null);
  assert.equal(page.questions[1].status, 'ac');
  assert.equal(page.questions[1].difficulty, 'Medium');
  assert.equal(page.questions[2].status, 'notac');
  assert.equal(page.questions[2].isPaidOnly, true);
});

test('listProblems defaults to first bounded page with empty filters and supports empty results', async () => {
  let receivedVariables;
  const client = new LeetCodeClient(async (_path, options) => {
    receivedVariables = options.body.variables;
    return {
      data: {
        problemsetQuestionList: {
          total: 0,
          questions: []
        }
      }
    };
  });

  const result = await client.listProblems({ difficulty: 'Any', status: 'All', query: '   ', tags: [] });
  assert.deepEqual(receivedVariables, { limit: DEFAULT_PAGE_SIZE, skip: 0, filters: {} });
  assert.deepEqual(result, {
    questions: [],
    total: 0,
    limit: DEFAULT_PAGE_SIZE,
    skip: 0,
    hasMore: false
  });
});

test('search preserves existing caller contract while validating inputs and responses', async () => {
  let receivedVariables;
  const client = new LeetCodeClient(async (_path, options) => {
    receivedVariables = options.body.variables;
    return {
      data: {
        problemsetQuestionList: {
          total: 120,
          questions: [
            {
              questionFrontendId: '1',
              title: 'Two Sum',
              titleSlug: 'two-sum',
              difficulty: 'Easy',
              isPaidOnly: false,
              status: null
            }
          ]
        }
      }
    };
  });

  const res = await client.search('two-sum', undefined, 50);
  assert.deepEqual(receivedVariables, {
    limit: 50,
    skip: 50,
    filters: { searchKeywords: 'two-sum' }
  });
  assert.equal(res.total, 120);
  assert.equal(res.questions.length, 1);
  assert.equal(res.questions[0].titleSlug, 'two-sum');
  assert.deepEqual(res.questions[0].topicTags, []);

  await assert.rejects(client.search(''), { code: 'INPUT' });
  await assert.rejects(client.search('   '), { code: 'INPUT' });
  await assert.rejects(client.search('a'.repeat(MAX_QUERY_LENGTH + 1)), { code: 'INPUT' });
});

test('account progress preserves null/ac/notac and rejects unknown or missing status values', async () => {
  const client = new LeetCodeClient(async () => ({
    data: {
      problemsetQuestionList: {
        total: 3,
        questions: [
          { ...sampleQuestion, questionFrontendId: '1', status: null },
          { ...sampleQuestion, questionFrontendId: '2', status: 'ac' },
          { ...sampleQuestion, questionFrontendId: '3', status: 'notac' }
        ]
      }
    }
  }));

  const list = await client.listProblems();
  assert.deepEqual(list.questions.map(q => q.status), [null, 'ac', 'notac']);
  assert.notEqual(list.questions[0].status, 'not-started');

  for (const invalidStatus of [undefined, 'FUTURE_SOLVED_ENUM', 'TRIED', 'SOLVED_V2', '', 123, true, {}]) {
    const badListClient = new LeetCodeClient(async () => ({
      data: {
        problemsetQuestionList: {
          total: 1,
          questions: [{ ...sampleQuestion, status: invalidStatus }]
        }
      }
    }));
    await assert.rejects(badListClient.listProblems(), { code: 'PROTOCOL' });

    const badDailyClient = new LeetCodeClient(async () => ({
      data: {
        activeDailyCodingChallengeQuestion: {
          date: '2026-10-26',
          link: '/problems/two-sum/',
          question: { ...sampleQuestion, status: invalidStatus }
        }
      }
    }));
    await assert.rejects(badDailyClient.daily(), { code: 'PROTOCOL' });
  }

  const badProblemClient = new LeetCodeClient(async () => ({
    data: {
      question: {
        ...sampleQuestion,
        status: 'TRIED',
        content: '<p>Desc</p>',
        codeSnippets: [{ langSlug: 'cpp', code: 'class Solution {};' }]
      }
    }
  }));
  await assert.rejects(badProblemClient.problem('two-sum'), { code: 'PROTOCOL' });
});

test('nonnumeric frontend IDs are retained as explicit unsupported entries while problem open rejects them', async () => {
  const client = new LeetCodeClient(async (_path, options) => {
    if (options.body.query.includes('questionData')) {
      return {
        data: {
          question: {
            ...sampleQuestion,
            questionFrontendId: 'LCP 01',
            content: '<p>Special problem</p>',
            codeSnippets: [{ langSlug: 'cpp', code: 'class Solution {};' }]
          }
        }
      };
    }
    return {
      data: {
        problemsetQuestionList: {
          total: 2,
          questions: [
            { ...sampleQuestion, questionFrontendId: '1', titleSlug: 'two-sum' },
            { ...sampleQuestion, questionId: '100001', questionFrontendId: 'LCP 01', title: 'Guess Numbers', titleSlug: 'guess-numbers' }
          ]
        }
      }
    };
  });

  const list = await client.listProblems();
  assert.equal(list.total, 2);
  assert.equal(list.questions.length, 2);
  assert.equal(list.questions[0].questionFrontendId, '1');
  assert.equal(list.questions[0].supported, true);
  assert.equal(list.questions[1].questionFrontendId, 'LCP 01');
  assert.equal(list.questions[1].supported, false);

  await assert.rejects(client.problem('guess-numbers'), { code: 'UNSUPPORTED' });
});

test('account verification requires explicit isSignedIn boolean and bounded non-empty username', async () => {
  const validClient = new LeetCodeClient(async () => ({
    data: { userStatus: { isSignedIn: true, username: '  alice_dev  ' } }
  }));
  assert.equal(await validClient.account(auth), 'alice_dev');

  for (const userStatus of [{ isSignedIn: false, username: 'alice' }, { isSignedIn: 'true', username: 'alice' }, { isSignedIn: 1, username: 'alice' }]) {
    const c = new LeetCodeClient(async () => ({ data: { userStatus } }));
    await assert.rejects(c.account(auth), { code: 'AUTH' });
  }

  for (const userStatus of [null, [], { isSignedIn: true, username: '' }, { isSignedIn: true, username: '   ' }, { isSignedIn: true, username: null }, { isSignedIn: true, username: 'a'.repeat(101) }, { isSignedIn: true, username: 'bad\nname' }]) {
    const c = new LeetCodeClient(async () => ({ data: { userStatus } }));
    await assert.rejects(c.account(auth), { code: 'PROTOCOL' });
  }
});

test('filter and pagination input validation enforces strict bounds', async () => {
  const client = new LeetCodeClient(async () => ({
    data: { problemsetQuestionList: { total: 0, questions: [] } }
  }));

  // Valid boundary values succeed
  await client.listProblems({
    limit: MAX_PAGE_SIZE,
    skip: MAX_SKIP,
    query: 'q'.repeat(MAX_QUERY_LENGTH),
    tags: Array.from({ length: MAX_TOPIC_FILTERS }, (_, i) => `topic-${i}`),
    difficulty: 'Hard',
    status: 'not-started'
  });

  // Invalid options container
  await assert.rejects(client.listProblems(null), { code: 'INPUT' });
  await assert.rejects(client.listProblems([]), { code: 'INPUT' });

  // Invalid pagination
  for (const limit of [0, -1, MAX_PAGE_SIZE + 1, 1.5, '50', NaN, null]) {
    await assert.rejects(client.listProblems({ limit }), { code: 'INPUT' });
  }
  for (const skip of [-1, MAX_SKIP + 1, 2.5, '0', NaN, null]) {
    await assert.rejects(client.listProblems({ skip }), { code: 'INPUT' });
  }

  // Invalid queries
  await assert.rejects(client.listProblems({ query: 'a'.repeat(MAX_QUERY_LENGTH + 1) }), { code: 'INPUT' });
  await assert.rejects(client.listProblems({ query: 'bad\nquery' }), { code: 'INPUT' });
  await assert.rejects(client.listProblems({ query: 'bad\0query' }), { code: 'INPUT' });
  await assert.rejects(client.listProblems({ query: 123 }), { code: 'INPUT' });
  await assert.rejects(client.listProblems({ query: 'one', searchKeywords: 'two' }), { code: 'INPUT' });

  // Invalid topics
  await assert.rejects(client.listProblems({ tags: 'array' }), { code: 'INPUT' });
  await assert.rejects(client.listProblems({ tags: Array.from({ length: MAX_TOPIC_FILTERS + 1 }, (_, i) => `t-${i}`) }), { code: 'INPUT' });
  for (const badTag of ['', 'Array', 'two pointers', '../array', 'array--list', '-array', 'a'.repeat(101), 123, null]) {
    await assert.rejects(client.listProblems({ tags: [badTag] }), { code: 'INPUT' });
  }
  await assert.rejects(client.listProblems({ tags: ['array'], topics: ['dp'] }), { code: 'INPUT' });

  // Invalid difficulty and status filters
  for (const difficulty of ['Extreme', '1', 123, {}]) {
    await assert.rejects(client.listProblems({ difficulty }), { code: 'INPUT' });
  }
  for (const status of ['DONE', 'UNKNOWN', 123, {}]) {
    await assert.rejects(client.listProblems({ status }), { code: 'INPUT' });
  }
});

test('topics queries questionTopicTags connection, deduplicates slugs, and rejects malformed shapes', async () => {
  let sentQuery;
  const client = new LeetCodeClient(async (_path, options) => {
    sentQuery = options.body.query;
    return {
      data: {
        questionTopicTags: {
          edges: [
            { node: { name: ' Array ', slug: 'array' } },
            { node: { name: 'Dynamic Programming', slug: 'dynamic-programming' } },
            { node: { name: 'Array Duplicate', slug: 'array' } }
          ]
        }
      }
    };
  });

  const topics = await client.topics();
  assert.match(sentQuery, /questionTopicTags\s*\{\s*edges\s*\{\s*node\s*\{\s*name\s+slug\s*\}\s*\}\s*\}/);
  assert.deepEqual(topics, [
    { name: 'Array', slug: 'array' },
    { name: 'Dynamic Programming', slug: 'dynamic-programming' }
  ]);

  // Empty root topicTags instead of questionTopicTags must fail
  const wrongRoot = new LeetCodeClient(async () => ({ data: { topicTags: [] } }));
  await assert.rejects(wrongRoot.topics(), { code: 'PROTOCOL' });

  const badShapes = [
    { questionTopicTags: null },
    { questionTopicTags: [] },
    { questionTopicTags: { edges: null } },
    { questionTopicTags: { edges: [null] } },
    { questionTopicTags: { edges: [{ node: null }] } },
    { questionTopicTags: { edges: [{ node: { name: '  ', slug: 'array' } }] } },
    { questionTopicTags: { edges: [{ node: { name: 'Array', slug: 'Invalid_Slug' } }] } },
    { questionTopicTags: { edges: [{ node: { name: 'Array', slug: '../evil' } }] } }
  ];
  for (const data of badShapes) {
    const c = new LeetCodeClient(async () => ({ data }));
    await assert.rejects(c.topics(), { code: 'PROTOCOL' });
  }
});

test('daily validates date, safe problem link, slug match, and required question fields', async () => {
  let sentQuery;
  const client = new LeetCodeClient(async (_path, options) => {
    sentQuery = options.body.query;
    return {
      data: {
        activeDailyCodingChallengeQuestion: {
          date: '2026-10-26',
          link: '/problems/two-sum/description/',
          question: { ...sampleQuestion, status: 'ac' }
        }
      }
    };
  });

  const daily = await client.daily(auth);
  assert.match(sentQuery, /activeDailyCodingChallengeQuestion/);
  assert.equal(daily.date, '2026-10-26');
  assert.equal(daily.link, '/problems/two-sum/');
  assert.equal(daily.question.questionId, '1');
  assert.equal(daily.question.questionFrontendId, '1');
  assert.equal(daily.question.titleSlug, 'two-sum');
  assert.equal(daily.question.status, 'ac');
  assert.equal(daily.question.topicTags.length, 2);

  const badDailyEntries = [
    null,
    { date: '2026-02-29', link: '/problems/two-sum/', question: sampleQuestion }, // 2026 is not a leap year
    { date: '2026-13-01', link: '/problems/two-sum/', question: sampleQuestion },
    { date: '10-26-2026', link: '/problems/two-sum/', question: sampleQuestion },
    { date: '2026-10-26', link: 'https://leetcode.com/problems/two-sum/', question: sampleQuestion },
    { date: '2026-10-26', link: '//evil.example/problems/two-sum/', question: sampleQuestion },
    { date: '2026-10-26', link: '/problems/two-sum/../../accounts/login/', question: sampleQuestion },
    { date: '2026-10-26', link: '/problems/two-sum/?envType=daily', question: sampleQuestion },
    { date: '2026-10-26', link: '/problems/different-slug/', question: sampleQuestion },
    { date: '2026-10-26', link: '/submissions/detail/1/', question: sampleQuestion },
    { date: '2026-10-26', link: '/problems/two-sum/', question: { ...sampleQuestion, questionId: undefined } },
    { date: '2026-10-26', link: '/problems/two-sum/', question: { ...sampleQuestion, questionId: 'abc' } },
    { date: '2026-10-26', link: '/problems/two-sum/', question: { ...sampleQuestion, topicTags: undefined } }
  ];

  for (const entry of badDailyEntries) {
    const c = new LeetCodeClient(async () => ({ data: { activeDailyCodingChallengeQuestion: entry } }));
    await assert.rejects(c.daily(), { code: 'PROTOCOL' });
  }
});

test('listProblems rejects malformed catalog responses and propagates transport/GraphQL errors', async () => {
  const badLists = [
    { problemsetQuestionList: null },
    { problemsetQuestionList: { total: -1, questions: [] } },
    { problemsetQuestionList: { total: '10', questions: [] } },
    { problemsetQuestionList: { total: 1.5, questions: [] } },
    { problemsetQuestionList: { total: 2, questions: [sampleQuestion, sampleQuestion] }, limit: 1 },
    { problemsetQuestionList: { total: 1, questions: [{ ...sampleQuestion, questionFrontendId: '   ' }] } },
    { problemsetQuestionList: { total: 1, questions: [{ ...sampleQuestion, questionFrontendId: '../1' }] } },
    { problemsetQuestionList: { total: 1, questions: [{ ...sampleQuestion, questionFrontendId: '<script>' }] } },
    { problemsetQuestionList: { total: 1, questions: [{ ...sampleQuestion, questionId: 'bad' }] } },
    { problemsetQuestionList: { total: 1, questions: [{ ...sampleQuestion, title: '   ' }] } },
    { problemsetQuestionList: { total: 1, questions: [{ ...sampleQuestion, titleSlug: '../../evil' }] } },
    { problemsetQuestionList: { total: 1, questions: [{ ...sampleQuestion, difficulty: 'Impossible' }] } },
    { problemsetQuestionList: { total: 1, questions: [{ ...sampleQuestion, isPaidOnly: 'false' }] } },
    { problemsetQuestionList: { total: 1, questions: [{ ...sampleQuestion, status: 123 }] } },
    { problemsetQuestionList: { total: 1, questions: [{ ...sampleQuestion, topicTags: 'array' }] } }
  ];

  for (const item of badLists) {
    const c = new LeetCodeClient(async () => ({ data: { problemsetQuestionList: item.problemsetQuestionList } }));
    await assert.rejects(c.listProblems({ limit: item.limit || 10 }), { code: 'PROTOCOL' });
  }

  const gqlErrorClient = new LeetCodeClient(async () => ({ errors: [{ message: 'SENSITIVE_INTERNAL_TRACE' }] }));
  await assert.rejects(
    gqlErrorClient.listProblems(),
    err => err instanceof LcError && err.code === 'GRAPHQL' && !err.message.includes('SENSITIVE_INTERNAL_TRACE')
  );

  const forbiddenClient = new LeetCodeClient(async () => {
    throw new LcError('FORBIDDEN', 'LeetCode refused this request.', true);
  });
  await assert.rejects(forbiddenClient.daily(), { code: 'FORBIDDEN' });
});
