'use strict';

const {
  LcError,
  topicSlug,
  DEFAULT_PAGE_SIZE,
  MAX_SKIP,
  MAX_QUERY_LENGTH,
  MAX_TOPIC_FILTERS
} = require('./api');

const FILTER_STATE_KEY = 'lc.discovery.filters.v1';
const VALID_DIFFICULTIES = new Set(['ANY', 'EASY', 'MEDIUM', 'HARD']);
const VALID_STATUSES = new Set(['ALL', 'AC', 'TRIED', 'NOT_STARTED']);

function defaultFilters() {
  return { query: '', difficulty: 'ANY', tags: [], status: 'ALL' };
}

function sanitizeStoredFilters(raw, isVerified = false) {
  const clean = defaultFilters();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
  if (typeof raw.query === 'string') {
    const trimmed = raw.query.trim();
    if (trimmed.length <= MAX_QUERY_LENGTH && !/[\x00-\x1F\x7F]/.test(trimmed)) {
      clean.query = trimmed;
    }
  }
  if (typeof raw.difficulty === 'string') {
    const upper = raw.difficulty.trim().toUpperCase();
    if (VALID_DIFFICULTIES.has(upper)) clean.difficulty = upper;
  }
  if (Array.isArray(raw.tags)) {
    const validTags = [];
    const seen = new Set();
    for (const item of raw.tags) {
      if (validTags.length >= MAX_TOPIC_FILTERS) break;
      try {
        const s = topicSlug(item, 'INPUT', 'Invalid topic filter.');
        if (!seen.has(s)) {
          seen.add(s);
          validTags.push(s);
        }
      } catch {
        // Ignore invalid persisted tag
      }
    }
    clean.tags = validTags;
  }
  if (isVerified && typeof raw.status === 'string') {
    const upper = raw.status.trim().toUpperCase();
    if (VALID_STATUSES.has(upper)) clean.status = upper;
  }
  return clean;
}

function safeErrorMessage(error, fallback) {
  return error instanceof LcError ? error.message : fallback;
}

class DiscoveryState {
  constructor(api, globalState, onChange = () => {}) {
    this.api = api;
    this.globalState = globalState;
    this.onChange = onChange;

    this.accountGeneration = 0;
    this.catalogGeneration = 0;
    this.dailyGeneration = 0;
    this.topicsGeneration = 0;

    this.account = {
      kind: 'signed_out', // 'signed_out' | 'unverified' | 'verified' | 'expired' | 'unavailable'
      username: undefined,
      auth: undefined,
      detail: undefined
    };

    const stored = globalState?.get ? globalState.get(FILTER_STATE_KEY) : undefined;
    this.filters = sanitizeStoredFilters(stored, false);
    this.limit = DEFAULT_PAGE_SIZE;
    this.skip = 0;
    this.initialized = false;

    this.daily = {
      status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
      data: undefined,
      stale: false,
      error: undefined
    };

    this.catalog = {
      status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
      questions: [],
      total: 0,
      limit: DEFAULT_PAGE_SIZE,
      skip: 0,
      hasMore: false,
      error: undefined
    };

    this.topics = {
      status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
      items: [],
      error: undefined
    };
  }

  get isVerified() {
    return this.account.kind === 'verified' && Boolean(this.account.username) && Boolean(this.account.auth);
  }

  get activeAuth() {
    return this.isVerified ? this.account.auth : undefined;
  }

  get hasActiveFilters() {
    return Boolean(
      this.filters.query ||
      this.filters.difficulty !== 'ANY' ||
      this.filters.tags.length > 0 ||
      this.filters.status !== 'ALL'
    );
  }

  async persistFilters() {
    if (this.globalState?.update) {
      await this.globalState.update(FILTER_STATE_KEY, {
        query: this.filters.query,
        difficulty: this.filters.difficulty,
        tags: [...this.filters.tags],
        status: this.filters.status
      });
    }
  }

  clearAccountProgress() {
    if (this.daily.data?.question) {
      this.daily.data = {
        ...this.daily.data,
        question: { ...this.daily.data.question, status: null }
      };
    }
    if (this.catalog.questions.length > 0) {
      this.catalog.questions = this.catalog.questions.map(q => ({ ...q, status: null }));
    }
    if (this.filters.status !== 'ALL') {
      this.filters.status = 'ALL';
      this.skip = 0;
    }
  }

  setAccountState(kind, { username, auth, detail } = {}) {
    const prevKind = this.account.kind;
    const prevUser = this.account.username;
    this.accountGeneration += 1;
    this.catalogGeneration += 1;
    this.dailyGeneration += 1;

    if (kind === 'verified' && username && auth) {
      this.account = { kind: 'verified', username, auth, detail: undefined };
    } else {
      this.account = {
        kind,
        username: undefined,
        auth: undefined,
        detail: detail || undefined
      };
      this.clearAccountProgress();
    }

    if (prevKind === 'verified' && (kind !== 'verified' || prevUser !== username)) {
      this.clearAccountProgress();
    }
    this.onChange();
  }

  ensureLoaded() {
    if (this.initialized) return undefined;
    this.initialized = true;
    return this.refreshAll();
  }

  async refreshAll() {
    this.initialized = true;
    await Promise.all([this.refreshDaily(), this.refreshCatalog()]);
  }

  async refreshDaily() {
    this.initialized = true;
    const gen = ++this.dailyGeneration;
    const acctGen = this.accountGeneration;
    const auth = this.activeAuth;

    this.daily.status = 'loading';
    this.daily.error = undefined;
    this.onChange();

    try {
      const data = await this.api.daily(auth);
      if (gen !== this.dailyGeneration || acctGen !== this.accountGeneration) return undefined;
      const question = this.isVerified ? data.question : { ...data.question, status: null };
      this.daily = {
        status: 'ready',
        data: { ...data, question },
        stale: false,
        error: undefined
      };
      this.onChange();
      return this.daily.data;
    } catch (error) {
      if (gen !== this.dailyGeneration || acctGen !== this.accountGeneration) return undefined;
      if (auth && (error?.code === 'AUTH' || error?.code === 'FORBIDDEN')) {
        this.handleAuthFailure(error);
        return this.refreshDaily();
      }
      const message = safeErrorMessage(error, 'Could not load the Daily Challenge.');
      if (this.daily.data) {
        this.daily.status = 'ready';
        this.daily.stale = true;
        this.daily.error = message;
      } else {
        this.daily = {
          status: 'error',
          data: undefined,
          stale: false,
          error: message
        };
      }
      this.onChange();
      return undefined;
    }
  }

  async refreshCatalog() {
    this.initialized = true;
    const gen = ++this.catalogGeneration;
    const acctGen = this.accountGeneration;
    const auth = this.activeAuth;
    const limit = this.limit;
    const skip = this.skip;
    const filterSnapshot = {
      limit,
      skip,
      query: this.filters.query || undefined,
      difficulty: this.filters.difficulty === 'ANY' ? undefined : this.filters.difficulty,
      tags: this.filters.tags.length ? [...this.filters.tags] : undefined,
      status: this.isVerified && this.filters.status !== 'ALL' ? this.filters.status : undefined
    };

    this.catalog.status = 'loading';
    this.catalog.error = undefined;
    this.onChange();

    try {
      const page = await this.api.listProblems(filterSnapshot, auth);
      if (gen !== this.catalogGeneration || acctGen !== this.accountGeneration) return undefined;
      const questions = this.isVerified
        ? page.questions
        : page.questions.map(q => ({ ...q, status: null }));
      this.catalog = {
        status: 'ready',
        questions,
        total: page.total,
        limit: page.limit,
        skip: page.skip,
        hasMore: page.hasMore && page.skip + page.limit <= MAX_SKIP,
        error: undefined
      };
      this.onChange();
      return this.catalog;
    } catch (error) {
      if (gen !== this.catalogGeneration || acctGen !== this.accountGeneration) return undefined;
      if (auth && (error?.code === 'AUTH' || error?.code === 'FORBIDDEN')) {
        this.handleAuthFailure(error);
        return this.refreshCatalog();
      }
      this.catalog = {
        status: 'error',
        questions: [],
        total: 0,
        limit,
        skip,
        hasMore: false,
        error: safeErrorMessage(error, 'Could not load the problem catalog.')
      };
      this.onChange();
      return undefined;
    }
  }

  async ensureTopics(force = false) {
    if (!force && this.topics.status === 'ready' && this.topics.items.length > 0) {
      return this.topics.items;
    }
    const gen = ++this.topicsGeneration;
    this.topics.status = 'loading';
    this.topics.error = undefined;
    this.onChange();

    try {
      const items = await this.api.topics();
      if (gen !== this.topicsGeneration) return this.topics.items;
      this.topics = {
        status: 'ready',
        items,
        error: undefined
      };
      this.onChange();
      return items;
    } catch (error) {
      if (gen !== this.topicsGeneration) return [];
      this.topics = {
        status: 'error',
        items: [],
        error: safeErrorMessage(error, 'Could not load topic tags.')
      };
      this.onChange();
      throw error;
    }
  }

  handleAuthFailure(error) {
    const unavailable = Boolean(error?.redirected || error?.code === 'FORBIDDEN');
    this.setAccountState(unavailable ? 'unavailable' : 'expired', {
      detail: safeErrorMessage(error, 'Session verification failed.')
    });
  }

  async setSearchQuery(rawQuery) {
    const text = rawQuery === undefined || rawQuery === null ? '' : String(rawQuery);
    if (text.length > MAX_QUERY_LENGTH || /[\x00-\x1F\x7F]/.test(text)) {
      throw new LcError('INPUT', `Search query must be up to ${MAX_QUERY_LENGTH} printable characters.`);
    }
    this.filters.query = text.trim();
    this.skip = 0;
    await this.persistFilters();
    return this.refreshCatalog();
  }

  async setDifficulty(difficulty) {
    const upper = String(difficulty || 'ANY').trim().toUpperCase();
    if (!VALID_DIFFICULTIES.has(upper)) {
      throw new LcError('INPUT', 'Invalid difficulty filter.');
    }
    this.filters.difficulty = upper;
    this.skip = 0;
    await this.persistFilters();
    return this.refreshCatalog();
  }

  async setTopics(tags) {
    if (!Array.isArray(tags) || tags.length > MAX_TOPIC_FILTERS) {
      throw new LcError('INPUT', `Select at most ${MAX_TOPIC_FILTERS} topic filters.`);
    }
    const normalized = [...new Set(tags.map(t => topicSlug(t, 'INPUT', 'Invalid topic filter.')))];
    this.filters.tags = normalized;
    this.skip = 0;
    await this.persistFilters();
    return this.refreshCatalog();
  }

  async setStatusFilter(status) {
    const upper = String(status || 'ALL').trim().toUpperCase();
    if (!VALID_STATUSES.has(upper)) {
      throw new LcError('INPUT', 'Invalid progress filter.');
    }
    if (upper !== 'ALL' && !this.isVerified) {
      throw new LcError('AUTH', 'Verify your LeetCode session before filtering by account progress.');
    }
    this.filters.status = upper;
    this.skip = 0;
    await this.persistFilters();
    return this.refreshCatalog();
  }

  async clearFilters() {
    this.filters = defaultFilters();
    this.skip = 0;
    await this.persistFilters();
    return this.refreshCatalog();
  }

  async nextPage() {
    if (!this.catalog.hasMore) return undefined;
    const nextSkip = this.skip + this.limit;
    if (nextSkip > MAX_SKIP) return undefined;
    this.skip = nextSkip;
    return this.refreshCatalog();
  }

  async prevPage() {
    if (this.skip <= 0) return undefined;
    this.skip = Math.max(0, this.skip - this.limit);
    return this.refreshCatalog();
  }

  async refreshAfterSubmission(expectedUser, expectedAccountGen) {
    if (!this.isVerified || !this.initialized) return;
    if (this.account.username !== expectedUser || this.accountGeneration !== expectedAccountGen) return;
    try {
      await Promise.all([this.refreshDaily(), this.refreshCatalog()]);
    } catch {
      // Never convert a completed submission into an error if post-submit refresh fails.
    }
  }
}

module.exports = {
  DiscoveryState,
  FILTER_STATE_KEY,
  VALID_DIFFICULTIES,
  VALID_STATUSES,
  defaultFilters,
  sanitizeStoredFilters
};
