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

function slug(value) {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 200) {
    throw new LcError('PROTOCOL', 'LeetCode returned an invalid problem identifier.');
  }
  return value;
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
        if (status >= 300 && status < 400) return reject(new LcError('AUTH', 'LeetCode redirected the request. Reconnect your account after browser verification.', true));
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
    total: totalNum questions: data { questionFrontendId title titleSlug difficulty isPaidOnly status }
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
    if (!data.userStatus?.isSignedIn) throw new LcError('AUTH', 'Your LeetCode session is invalid or expired. Connect Account again.', true);
    return String(data.userStatus.username || 'LeetCode user');
  }
  async search(keyword, auth, skip = 0) {
    const data = await this.graphql(SEARCH, { limit: 50, skip, filters: { searchKeywords: keyword } }, auth);
    const list = data.problemsetQuestionList;
    if (!Array.isArray(list?.questions)) throw new LcError('PROTOCOL', 'LeetCode returned an unsupported problem list.');
    return { questions: list.questions, total: Number(list.total) || 0 };
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
    return { ...q, starter };
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

module.exports = { LeetCodeClient, LcError, credentials, slug, jobId, requestJson, ORIGIN };
