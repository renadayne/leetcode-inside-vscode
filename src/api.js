'use strict';

const https = require('node:https');
const ORIGIN = 'https://leetcode.com';

class LcError extends Error {
  constructor(code, message, rejected = false) {
    super(message);
    this.name = 'LcError';
    this.code = code;
    // Only a definite rejection makes it safe to release a write-operation lock.
    this.rejected = rejected;
  }
}

function credentials(session, csrf) {
  if (![session, csrf].every(s => typeof s === 'string' && /^[\x21-\x7E]{8,16384}$/.test(s) && !/[;,"\\]/.test(s))) {
    throw new LcError('CREDENTIALS', 'Paste only each cookie value, without its name, quotes, spaces, or semicolons.');
  }
  return { session, csrf };
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_SKIP = 10000;
const MAX_QUERY_LENGTH = 200;
const MAX_TOPIC_FILTERS = 20;

const DIFFICULTY_MAP = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard'
};

const DIFFICULTY_FILTERS = {
  easy: 'EASY',
  medium: 'MEDIUM',
  hard: 'HARD'
};

const STATUS_FILTERS = {
  ac: 'AC',
  solved: 'AC',
  notac: 'TRIED',
  tried: 'TRIED',
  attempted: 'TRIED',
  not_started: 'NOT_STARTED',
  'not-started': 'NOT_STARTED',
  'not started': 'NOT_STARTED',
  todo: 'NOT_STARTED'
};

function slug(value) {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 200) {
    throw new LcError('PROTOCOL', 'LeetCode returned an invalid problem identifier.');
  }
  return value;
}

function topicSlug(value, code = 'PROTOCOL', message = 'LeetCode returned an invalid topic identifier.') {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 100) {
    throw new LcError(code, message);
  }
  return value;
}

function dailyDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new LcError('PROTOCOL', 'LeetCode returned an invalid Daily Challenge date.');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new LcError('PROTOCOL', 'LeetCode returned an invalid Daily Challenge date.');
  }
  return value;
}

function problemPath(link, expectedSlug) {
  if (typeof link !== 'string') {
    throw new LcError('PROTOCOL', 'LeetCode returned an invalid Daily Challenge link.');
  }
  const match = /^\/problems\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/(?:description\/?)?)?$/.exec(link);
  if (!match) {
    throw new LcError('PROTOCOL', 'LeetCode returned an unsafe or invalid Daily Challenge link.');
  }
  const pathSlug = slug(match[1]);
  if (expectedSlug !== undefined && pathSlug !== slug(expectedSlug)) {
    throw new LcError('PROTOCOL', 'LeetCode Daily Challenge link does not match the problem slug.');
  }
  return `/problems/${pathSlug}/`;
}

function normalizeTopic(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throw new LcError('PROTOCOL', 'LeetCode returned an invalid topic entry.');
  }
  const name = typeof node.name === 'string' ? node.name.trim() : '';
  if (!name || name.length > 100) {
    throw new LcError('PROTOCOL', 'LeetCode returned an invalid topic name.');
  }
  return { name, slug: topicSlug(node.slug) };
}

function normalizeDifficulty(difficulty) {
  if (typeof difficulty !== 'string') {
    throw new LcError('PROTOCOL', 'LeetCode returned an invalid problem difficulty.');
  }
  const normalized = DIFFICULTY_MAP[difficulty.toLowerCase()];
  if (!normalized) {
    throw new LcError('PROTOCOL', 'LeetCode returned an invalid problem difficulty.');
  }
  return normalized;
}

function normalizeStatus(status) {
  if (status === null || status === 'ac' || status === 'notac') return status;
  throw new LcError('PROTOCOL', 'LeetCode returned an invalid problem status.');
}

function normalizeQuestion(q, { requireId = false, requireTags = false } = {}) {
  if (!q || typeof q !== 'object' || Array.isArray(q)) {
    throw new LcError('PROTOCOL', 'LeetCode returned an invalid problem entry.');
  }
  const frontendId = typeof q.questionFrontendId === 'string' ? q.questionFrontendId.trim() : '';
  if (!frontendId || frontendId.length > 40 || !/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(frontendId) || frontendId.includes('..')) {
    throw new LcError('PROTOCOL', 'LeetCode returned an invalid problem number.');
  }
  const supported = /^\d+$/.test(frontendId);
  if (requireId || q.questionId !== undefined) {
    if (typeof q.questionId !== 'string' || !/^\d+$/.test(q.questionId)) {
      throw new LcError('PROTOCOL', 'LeetCode returned an invalid internal problem ID.');
    }
  }
  const title = typeof q.title === 'string' ? q.title.trim() : '';
  if (!title || title.length > 300) {
    throw new LcError('PROTOCOL', 'LeetCode returned an invalid problem title.');
  }
  const titleSlug = slug(q.titleSlug);
  const difficulty = normalizeDifficulty(q.difficulty);
  if (typeof q.isPaidOnly !== 'boolean') {
    throw new LcError('PROTOCOL', 'LeetCode returned an invalid problem access flag.');
  }
  const status = normalizeStatus(q.status);
  let topicTags = [];
  if (requireTags || q.topicTags !== undefined) {
    if (!Array.isArray(q.topicTags) || q.topicTags.length > 100) {
      throw new LcError('PROTOCOL', 'LeetCode returned invalid problem topic tags.');
    }
    topicTags = q.topicTags.map(normalizeTopic);
  }
  const normalized = {
    questionFrontendId: frontendId,
    supported,
    title,
    titleSlug,
    difficulty,
    isPaidOnly: q.isPaidOnly,
    status,
    topicTags
  };
  if (q.questionId !== undefined) normalized.questionId = q.questionId;
  return normalized;
}

function normalizeDaily(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new LcError('PROTOCOL', 'LeetCode returned an invalid Daily Challenge response.');
  }
  const date = dailyDate(entry.date);
  const question = normalizeQuestion(entry.question, { requireId: true, requireTags: true });
  const link = problemPath(entry.link, question.titleSlug);
  return { date, link, question };
}

function normalizeFilters(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new LcError('INPUT', 'Invalid problem filter options.');
  }
  const limit = options.limit === undefined ? DEFAULT_PAGE_SIZE : options.limit;
  const skip = options.skip === undefined ? 0 : options.skip;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new LcError('INPUT', `Page size must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
  }
  if (!Number.isInteger(skip) || skip < 0 || skip > MAX_SKIP) {
    throw new LcError('INPUT', `Pagination offset must be an integer between 0 and ${MAX_SKIP}.`);
  }
  if (options.query !== undefined && options.searchKeywords !== undefined && options.query !== options.searchKeywords) {
    throw new LcError('INPUT', 'Conflicting search query options.');
  }
  if (options.tags !== undefined && options.topics !== undefined) {
    throw new LcError('INPUT', 'Conflicting topic filter options.');
  }
  const filters = {};
  const rawQuery = options.query !== undefined ? options.query : options.searchKeywords;
  if (rawQuery !== undefined && rawQuery !== null) {
    if (typeof rawQuery !== 'string' || rawQuery.length > MAX_QUERY_LENGTH || /[\x00-\x1F\x7F]/.test(rawQuery)) {
      throw new LcError('INPUT', `Search query must be a string up to ${MAX_QUERY_LENGTH} characters.`);
    }
    const trimmed = rawQuery.trim();
    if (trimmed) filters.searchKeywords = trimmed;
  }
  if (options.difficulty !== undefined && options.difficulty !== null && options.difficulty !== '') {
    if (typeof options.difficulty !== 'string') {
      throw new LcError('INPUT', 'Invalid difficulty filter.');
    }
    const lower = options.difficulty.trim().toLowerCase();
    if (lower !== 'any' && lower !== 'all') {
      const mapped = DIFFICULTY_FILTERS[lower];
      if (!mapped) throw new LcError('INPUT', 'Invalid difficulty filter.');
      filters.difficulty = mapped;
    }
  }
  const rawTags = options.tags !== undefined ? options.tags : options.topics;
  if (rawTags !== undefined && rawTags !== null) {
    if (!Array.isArray(rawTags)) {
      throw new LcError('INPUT', 'Topic filters must be an array of topic slugs.');
    }
    if (rawTags.length > MAX_TOPIC_FILTERS) {
      throw new LcError('INPUT', `Select at most ${MAX_TOPIC_FILTERS} topic filters.`);
    }
    const tags = [...new Set(rawTags.map(t => topicSlug(t, 'INPUT', 'Invalid topic filter.')))];
    if (tags.length > 0) filters.tags = tags;
  }
  if (options.status !== undefined && options.status !== null && options.status !== '') {
    if (typeof options.status !== 'string') {
      throw new LcError('INPUT', 'Invalid progress status filter.');
    }
    const lower = options.status.trim().toLowerCase();
    if (lower !== 'all' && lower !== 'any') {
      const mapped = STATUS_FILTERS[lower];
      if (!mapped) throw new LcError('INPUT', 'Invalid progress status filter.');
      filters.status = mapped;
    }
  }
  return { limit, skip, filters };
}

function jobId(value) {
  const id = String(value ?? '');
  if (!/^[a-zA-Z0-9_.-]{1,180}$/.test(id)) throw new LcError('PROTOCOL', 'LeetCode did not return a usable operation ID. The request may have been received; do not submit again until you check.');
  return id;
}

function requestJson(path, { method = 'GET', body, auth } = {}, requestImpl = https.request) {
  if (!/^\/(?:graphql\/|submissions\/detail\/[a-zA-Z0-9_.-]+\/check\/|problems\/[a-z0-9-]+\/(?:submit|interpret_solution)\/)$/.test(path)) {
    return Promise.reject(new LcError('ORIGIN', 'Blocked an unexpected API path.'));
  }
  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'LeetCode-Inside-VSCode/0.1.0 (personal C++ practice)',
    'Referer': ORIGIN + (path.startsWith('/problems/') ? path.split('/').slice(0, 3).join('/') + '/' : '/'),
    'Origin': ORIGIN
  };
  if (auth) {
    credentials(auth.session, auth.csrf);
    headers.Cookie = `LEETCODE_SESSION=${auth.session}; csrftoken=${auth.csrf}`;
    headers['X-CSRFToken'] = auth.csrf;
  }
  const payload = body === undefined ? undefined : JSON.stringify(body);
  if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
  return new Promise((resolve, reject) => {
    let timer;
    const req = requestImpl(ORIGIN + path, { method, headers }, res => {
      const chunks = [];
      let length = 0;
      res.on('data', chunk => {
        length += chunk.length;
        if (length > 8 * 1024 * 1024) req.destroy(new LcError('PROTOCOL', 'LeetCode returned an unexpectedly large response.'));
        else chunks.push(chunk);
      });
      res.on('error', () => reject(new LcError('NETWORK', 'The LeetCode response was interrupted. Use Retrieve Pending Result if an operation was sent.')));
      res.on('end', () => {
        const status = res.statusCode;
        if (status === 401) return reject(new LcError('AUTH', 'Your LeetCode session has expired. Connect Account again.', true));
        if (status === 403) return reject(new LcError('FORBIDDEN', 'LeetCode refused this request. Sign in or complete browser verification, then reconnect. If it persists, remote actions are blocked by LeetCode.', true));
        if (status === 429) return reject(new LcError('RATE_LIMIT', 'LeetCode is rate limiting requests. Wait before trying again.', true));
        // Redirects are never followed, particularly with credentials attached.
        if (status >= 300 && status < 400) {
          const err = new LcError('AUTH', 'LeetCode redirected the request. Reconnect your account after browser verification.', true);
          err.redirected = true;
          return reject(err);
        }
        if (status < 200 || status >= 300) return reject(new LcError('HTTP', `LeetCode returned HTTP ${status}. Try again later.`, status >= 400 && status < 500));
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return reject(new LcError('PROTOCOL', 'LeetCode returned a non-JSON response, possibly a browser verification page. Reconnect after verification.')); }
        if (!data || typeof data !== 'object' || Array.isArray(data)) return reject(new LcError('PROTOCOL', 'LeetCode returned an unsupported response.'));
        resolve(data);
      });
    });
    timer = setTimeout(() => req.destroy(new LcError('TIMEOUT', 'LeetCode did not respond within 20 seconds. A sent operation may still be running; retrieve its result before retrying.')), 20000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', e => reject(e instanceof LcError ? e : new LcError('NETWORK', 'Cannot reach LeetCode. Check your connection. Reading cached problems and editing local code remain available.')));
    req.end(payload);
  });
}

const QUESTION = `query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId questionFrontendId title titleSlug content difficulty isPaidOnly status
    topicTags { name slug } codeSnippets { langSlug code }
    sampleTestCase exampleTestcases enableRunCode
  }
}`;
const SEARCH = `query problemsetQuestionList($limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList: questionList(categorySlug: "", limit: $limit, skip: $skip, filters: $filters) {
    total: totalNum questions: data { questionId questionFrontendId title titleSlug difficulty isPaidOnly status topicTags { name slug } }
  }
}`;
const DAILY = `query dailyCodingQuestionRecords {
  activeDailyCodingChallengeQuestion {
    date link question {
      questionId questionFrontendId title titleSlug difficulty status isPaidOnly
      topicTags { name slug }
    }
  }
}`;
const TOPICS = `query questionTopicTags {
  questionTopicTags {
    edges {
      node { name slug }
    }
  }
}`;

class LeetCodeClient {
  constructor(transport = requestJson) { this.transport = transport; }
  async graphql(query, variables = {}, auth) {
    const response = await this.transport('/graphql/', { method: 'POST', body: { query, variables }, auth });
    if (response.errors?.length || !response.data) throw new LcError('GRAPHQL', 'LeetCode could not complete this query. The session, account access, or API schema may have changed.');
    return response.data;
  }
  async account(auth) {
    const data = await this.graphql('query { userStatus { isSignedIn username } }', {}, auth);
    const status = data.userStatus;
    if (!status || typeof status !== 'object' || Array.isArray(status)) {
      throw new LcError('PROTOCOL', 'LeetCode returned an invalid account status.');
    }
    if (status.isSignedIn !== true) {
      throw new LcError('AUTH', 'Your LeetCode session is invalid or expired. Connect Account again.', true);
    }
    const username = typeof status.username === 'string' ? status.username.trim() : '';
    if (!username || username.length > 100 || /[\x00-\x1F\x7F]/.test(username)) {
      throw new LcError('PROTOCOL', 'LeetCode did not return a valid username for this session.');
    }
    return username;
  }
  async listProblems(options = {}, auth) {
    const { limit, skip, filters } = normalizeFilters(options);
    const data = await this.graphql(SEARCH, { limit, skip, filters }, auth);
    const list = data.problemsetQuestionList;
    if (!list || typeof list !== 'object' || Array.isArray(list) || !Array.isArray(list.questions)) {
      throw new LcError('PROTOCOL', 'LeetCode returned an unsupported problem list.');
    }
    if (typeof list.total !== 'number' || !Number.isInteger(list.total) || list.total < 0) {
      throw new LcError('PROTOCOL', 'LeetCode returned an invalid problem count.');
    }
    if (list.questions.length > limit) {
      throw new LcError('PROTOCOL', 'LeetCode returned more problems than requested.');
    }
    const questions = list.questions.map(q => normalizeQuestion(q));
    return { questions, total: list.total, limit, skip, hasMore: skip + questions.length < list.total };
  }
  async problems(options = {}, auth) {
    return this.listProblems(options, auth);
  }
  async search(keyword, auth, skip = 0) {
    if (typeof keyword !== 'string' || !keyword.trim() || keyword.length > MAX_QUERY_LENGTH || /[\x00-\x1F\x7F]/.test(keyword)) {
      throw new LcError('INPUT', 'Enter a valid problem number, title, slug, or keyword.');
    }
    const { questions, total } = await this.listProblems({ query: keyword, limit: DEFAULT_PAGE_SIZE, skip }, auth);
    return { questions, total };
  }
  async topics(auth) {
    const data = await this.graphql(TOPICS, {}, auth);
    const conn = data.questionTopicTags;
    if (!conn || typeof conn !== 'object' || Array.isArray(conn) || !Array.isArray(conn.edges) || conn.edges.length > 500) {
      throw new LcError('PROTOCOL', 'LeetCode returned an unsupported topic catalog.');
    }
    const seen = new Set();
    const result = [];
    for (const edge of conn.edges) {
      if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
        throw new LcError('PROTOCOL', 'LeetCode returned an invalid topic edge.');
      }
      const topic = normalizeTopic(edge.node);
      if (!seen.has(topic.slug)) {
        seen.add(topic.slug);
        result.push(topic);
      }
    }
    return result;
  }
  async topicTags(auth) {
    return this.topics(auth);
  }
  async daily(auth) {
    const data = await this.graphql(DAILY, {}, auth);
    return normalizeDaily(data.activeDailyCodingChallengeQuestion);
  }
  async dailyChallenge(auth) {
    return this.daily(auth);
  }
  async problem(titleSlug, auth) {
    const data = await this.graphql(QUESTION, { titleSlug: slug(titleSlug) }, auth);
    const q = data.question;
    if (!q) throw new LcError('NOT_FOUND', 'Problem not found. Check its number, title, or slug.');
    slug(q.titleSlug);
    if (!/^\d+$/.test(q.questionId) || !/^\d+$/.test(q.questionFrontendId)) throw new LcError('UNSUPPORTED', 'This problem is not a supported numbered C++ problem.');
    if (!q.content) throw new LcError('ACCESS', q.isPaidOnly ? 'This problem requires a LeetCode account with access. Connect that account first.' : 'The problem description is unavailable.');
    const starter = q.codeSnippets?.find(s => s.langSlug === 'cpp')?.code;
    if (typeof starter !== 'string' || !starter.trim()) throw new LcError('UNSUPPORTED', 'LeetCode does not provide a C++ starter for this problem.');
    const status = q.status === undefined ? null : normalizeStatus(q.status);
    return { ...q, status, starter };
  }
  async start(kind, problem, code, input, auth) {
    const body = { lang: 'cpp', question_id: problem.questionId, typed_code: code };
    if (kind === 'test') body.data_input = input;
    const response = await this.transport(`/problems/${slug(problem.titleSlug)}/${kind === 'submit' ? 'submit' : 'interpret_solution'}/`, { method: 'POST', body, auth });
    if (response.error) throw new LcError('REJECTED', 'LeetCode rejected this operation. Check account access and reconnect if needed.', true);
    return jobId(kind === 'submit' ? response.submission_id : response.interpret_id);
  }
  async check(id, auth) {
    const response = await this.transport(`/submissions/detail/${jobId(id)}/check/`, { auth });
    if (!['PENDING', 'STARTED', 'SUCCESS'].includes(response.state)) throw new LcError('PROTOCOL', 'LeetCode returned an unknown judging state. Keep the operation pending and retrieve again later.');
    return response;
  }
}

module.exports = {
  LeetCodeClient,
  LcError,
  credentials,
  slug,
  topicSlug,
  dailyDate,
  problemPath,
  jobId,
  normalizeTopic,
  normalizeDifficulty,
  normalizeStatus,
  normalizeQuestion,
  normalizeDaily,
  normalizeFilters,
  requestJson,
  ORIGIN,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_SKIP,
  MAX_QUERY_LENGTH,
  MAX_TOPIC_FILTERS
};
