'use strict';

const DIFFICULTY_LABELS = {
  ANY: 'Any',
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard'
};

const STATUS_LABELS = {
  ALL: 'All',
  AC: 'Solved',
  TRIED: 'Attempted',
  NOT_STARTED: 'Not started'
};

function boundText(value, max = 120) {
  const str = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function formatVerifiedProgress(status, isVerified) {
  if (!isVerified) return undefined;
  if (status === 'ac') return 'Solved';
  if (status === 'notac') return 'Attempted';
  if (status === null) return 'Not started';
  return undefined;
}

function formatProblemDescription(q, isVerified, extraPrefix) {
  const parts = [];
  if (extraPrefix) parts.push(extraPrefix);
  parts.push(q.difficulty);
  if (q.supported === false) parts.push('Unsupported ID');
  if (q.isPaidOnly) parts.push('Premium');
  const progress = formatVerifiedProgress(q.status, isVerified);
  if (progress) parts.push(progress);
  return parts.join(' · ');
}

function formatAccountSummary(account) {
  switch (account.kind) {
    case 'verified':
      return `Verified: ${boundText(account.username, 60)}`;
    case 'unverified':
      return 'Session stored (unverified)';
    case 'expired':
      return 'Session expired — reconnect needed';
    case 'unavailable':
      return 'Verification unavailable';
    default:
      return 'Signed out';
  }
}

function formatFilterSummary(discovery) {
  const parts = [];
  if (discovery.filters.query) parts.push(`"${boundText(discovery.filters.query, 30)}"`);
  if (discovery.filters.difficulty !== 'ANY') {
    parts.push(DIFFICULTY_LABELS[discovery.filters.difficulty] || discovery.filters.difficulty);
  }
  if (discovery.filters.tags.length > 0) {
    parts.push(discovery.filters.tags.length <= 2
      ? discovery.filters.tags.join(', ')
      : `${discovery.filters.tags.slice(0, 2).join(', ')} +${discovery.filters.tags.length - 2}`);
  }
  if (discovery.isVerified && discovery.filters.status !== 'ALL') {
    parts.push(STATUS_LABELS[discovery.filters.status] || discovery.filters.status);
  }
  if (discovery.catalog.status === 'ready' && discovery.catalog.total > 0) {
    const start = discovery.catalog.skip + 1;
    const end = discovery.catalog.skip + discovery.catalog.questions.length;
    parts.push(`${start}–${end} of ${discovery.catalog.total}`);
  } else if (discovery.catalog.status === 'ready') {
    parts.push('0 matches');
  }
  return parts.length ? parts.join(' · ') : 'All problems';
}

class LeetCodeExplorer {
  constructor(vscode, discovery, getLocalProblems) {
    this.vscode = vscode;
    this.discovery = discovery;
    this.getLocalProblems = getLocalProblems;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
  }

  refresh() {
    this._emitter.fire(undefined);
  }

  dispose() {
    this._emitter.dispose();
  }

  getTreeItem(element) {
    const TreeItem = this.vscode.TreeItem || class {
      constructor(label, collapsibleState) {
        this.label = label;
        this.collapsibleState = collapsibleState;
      }
    };
    const State = this.vscode.TreeItemCollapsibleState || { None: 0, Collapsed: 1, Expanded: 2 };
    const collapsible = element.collapsible
      ? (element.expanded ? State.Expanded : State.Collapsed)
      : State.None;
    const item = new TreeItem(element.label, collapsible);
    if (element.id) item.id = element.id;
    if (element.description !== undefined) item.description = element.description;
    if (element.tooltip !== undefined) item.tooltip = element.tooltip;
    if (element.contextValue !== undefined) item.contextValue = element.contextValue;
    if (element.command) item.command = element.command;
    if (element.icon && this.vscode.ThemeIcon) {
      item.iconPath = new this.vscode.ThemeIcon(element.icon);
    }
    return item;
  }

  async getChildren(element) {
    if (!element) {
      if (!this.discovery.initialized) {
        this.discovery.ensureLoaded();
      }
      const locals = await this.getLocalProblems();
      return [
        {
          id: 'section:account',
          kind: 'section',
          section: 'account',
          label: 'Account',
          description: formatAccountSummary(this.discovery.account),
          tooltip: this.discovery.account.detail || formatAccountSummary(this.discovery.account),
          collapsible: true,
          expanded: true,
          contextValue: 'lc.accountSection',
          icon: 'account'
        },
        {
          id: 'section:daily',
          kind: 'section',
          section: 'daily',
          label: 'Daily Challenge',
          description: this.discovery.daily.data
            ? `${this.discovery.daily.data.date}${this.discovery.daily.stale ? ' (stale)' : ''}`
            : (this.discovery.daily.status === 'loading' ? 'Loading…' : ''),
          collapsible: true,
          expanded: true,
          contextValue: 'lc.dailySection',
          icon: 'calendar'
        },
        {
          id: 'section:browse',
          kind: 'section',
          section: 'browse',
          label: 'Browse Problems',
          description: formatFilterSummary(this.discovery),
          collapsible: true,
          expanded: true,
          contextValue: 'lc.browseSection',
          icon: 'list-filter'
        },
        {
          id: 'section:local',
          kind: 'section',
          section: 'local',
          label: 'Local Problems',
          description: `${locals.length} saved`,
          collapsible: true,
          expanded: true,
          contextValue: 'lc.localSection',
          icon: 'folder-opened'
        }
      ];
    }

    if (element.section === 'account') {
      return this.getAccountChildren();
    }
    if (element.section === 'daily') {
      return this.getDailyChildren();
    }
    if (element.section === 'browse') {
      return this.getBrowseChildren();
    }
    if (element.section === 'local') {
      return this.getLocalChildren();
    }
    return [];
  }

  getAccountChildren() {
    const acct = this.discovery.account;
    const rows = [
      {
        id: 'account:status',
        kind: 'info',
        label: `Status: ${formatAccountSummary(acct)}`,
        description: acct.detail ? boundText(acct.detail, 80) : undefined,
        tooltip: acct.detail || formatAccountSummary(acct),
        icon: acct.kind === 'verified' ? 'verified' : acct.kind === 'expired' ? 'warning' : 'info'
      },
      {
        id: 'account:openSignIn',
        kind: 'action',
        label: 'Open LeetCode Sign-in',
        description: 'Browser sign-in (does not auto-connect VS Code)',
        command: { command: 'lc.openSignIn', title: 'Open LeetCode Sign-in' },
        icon: 'globe'
      },
      {
        id: 'account:check',
        kind: 'action',
        label: 'Check Saved Session',
        description: 'Verify stored SecretStorage session',
        command: { command: 'lc.account', title: 'Check Saved Session' },
        icon: 'check'
      },
      {
        id: 'account:import',
        kind: 'action',
        label: 'Advanced: Import Session',
        description: 'Paste LEETCODE_SESSION and csrftoken values',
        command: { command: 'lc.importSession', title: 'Advanced: Import Session' },
        icon: 'key'
      }
    ];
    if (acct.kind !== 'signed_out') {
      rows.push({
        id: 'account:disconnect',
        kind: 'action',
        label: 'Disconnect Account',
        description: 'Remove saved session from VS Code',
        command: { command: 'lc.disconnect', title: 'Disconnect Account' },
        icon: 'sign-out'
      });
    }
    return rows;
  }

  getDailyChildren() {
    const daily = this.discovery.daily;
    if (daily.status === 'idle') {
      this.discovery.ensureLoaded();
    }
    if (daily.status === 'loading' && !daily.data) {
      return [{
        id: 'daily:loading',
        kind: 'status',
        label: 'Loading Daily Challenge…',
        icon: 'sync'
      }];
    }
    if (daily.status === 'error' && !daily.data) {
      return [{
        id: 'daily:error',
        kind: 'action',
        label: boundText(daily.error || 'Could not load Daily Challenge.', 100),
        description: 'Click to retry',
        command: { command: 'lc.refreshDaily', title: 'Retry Daily Challenge' },
        icon: 'error'
      }];
    }
    if (!daily.data) {
      return [{
        id: 'daily:empty',
        kind: 'action',
        label: 'Load Daily Challenge',
        command: { command: 'lc.refreshDaily', title: 'Load Daily Challenge' },
        icon: 'refresh'
      }];
    }

    const q = daily.data.question;
    const prefix = `${daily.data.date}${daily.stale ? ' (stale)' : ''}`;
    const rows = [
      {
        id: `daily:problem:${q.titleSlug}`,
        kind: 'problem',
        problem: q,
        label: `${boundText(q.questionFrontendId, 20)}. ${boundText(q.title, 100)}`,
        description: formatProblemDescription(q, this.discovery.isVerified, prefix),
        tooltip: `${daily.data.date} · ${q.questionFrontendId}. ${q.title} (${q.difficulty})`,
        command: {
          command: 'lc.openProblemItem',
          title: 'Open Daily Challenge',
          arguments: [q]
        },
        contextValue: 'lc.problemItem',
        icon: q.isPaidOnly ? 'lock' : 'Flame'
      }
    ];

    if (daily.stale) {
      rows.push({
        id: 'daily:staleRetry',
        kind: 'action',
        label: `Refresh failed (${boundText(daily.error || 'network error', 60)})`,
        description: 'Click to retry Daily Challenge',
        command: { command: 'lc.refreshDaily', title: 'Retry Daily Challenge' },
        icon: 'warning'
      });
    }
    return rows;
  }

  getBrowseChildren() {
    const d = this.discovery;
    if (d.catalog.status === 'idle') {
      d.ensureLoaded();
    }
    const rows = [
      {
        id: 'filter:search',
        kind: 'filter',
        label: `Search: ${d.filters.query ? boundText(d.filters.query, 50) : 'Any'}`,
        description: 'Click to set keyword/number/title',
        command: { command: 'lc.filterSearch', title: 'Filter by Search Keyword' },
        icon: 'search'
      },
      {
        id: 'filter:difficulty',
        kind: 'filter',
        label: `Difficulty: ${DIFFICULTY_LABELS[d.filters.difficulty] || 'Any'}`,
        description: 'Any / Easy / Medium / Hard',
        command: { command: 'lc.filterDifficulty', title: 'Filter by Difficulty' },
        icon: 'filter'
      },
      {
        id: 'filter:topics',
        kind: 'filter',
        label: `Topics: ${d.filters.tags.length ? boundText(d.filters.tags.join(', '), 60) : 'Any'}`,
        description: 'Multi-select topic tags',
        command: { command: 'lc.filterTopics', title: 'Filter by Topics' },
        icon: 'tag'
      },
      {
        id: 'filter:status',
        kind: 'filter',
        label: `Progress: ${d.isVerified ? (STATUS_LABELS[d.filters.status] || 'All') : 'Verify session to filter'}`,
        description: d.isVerified ? 'All / Solved / Attempted / Not started' : 'Account progress unknown while unverified',
        command: { command: 'lc.filterStatus', title: 'Filter by Account Progress' },
        icon: 'pass'
      }
    ];

    if (d.hasActiveFilters) {
      rows.push({
        id: 'filter:clear',
        kind: 'action',
        label: 'Clear Filters',
        description: 'Reset search, difficulty, topics, and progress',
        command: { command: 'lc.clearFilters', title: 'Clear Problem Filters' },
        icon: 'clear-all'
      });
    }

    rows.push({
      id: 'browse:refresh',
      kind: 'action',
      label: 'Refresh Problem List',
      description: d.catalog.status === 'loading' ? 'Loading…' : undefined,
      command: { command: 'lc.refreshCatalog', title: 'Refresh Problem List' },
      icon: 'refresh'
    });

    if (d.catalog.status === 'loading') {
      rows.push({
        id: 'browse:loading',
        kind: 'status',
        label: 'Loading problems…',
        icon: 'sync'
      });
      return rows;
    }

    if (d.catalog.status === 'error') {
      rows.push({
        id: 'browse:error',
        kind: 'action',
        label: boundText(d.catalog.error || 'Could not load problems.', 100),
        description: 'Click to retry',
        command: { command: 'lc.refreshCatalog', title: 'Retry Problem List' },
        icon: 'error'
      });
      return rows;
    }

    if (d.catalog.questions.length === 0) {
      rows.push({
        id: 'browse:empty',
        kind: 'status',
        label: 'No matching LeetCode problems found.',
        description: d.hasActiveFilters ? 'Try clearing or adjusting filters' : undefined,
        icon: 'info'
      });
      return rows;
    }

    for (const q of d.catalog.questions) {
      rows.push({
        id: `browse:problem:${q.titleSlug}`,
        kind: 'problem',
        problem: q,
        label: `${boundText(q.questionFrontendId, 20)}. ${boundText(q.title, 100)}`,
        description: formatProblemDescription(q, d.isVerified),
        tooltip: `${q.questionFrontendId}. ${q.title} (${q.difficulty})${q.topicTags?.length ? '\nTopics: ' + q.topicTags.map(t => t.name).join(', ') : ''}`,
        command: {
          command: 'lc.openProblemItem',
          title: 'Open Problem',
          arguments: [q]
        },
        contextValue: 'lc.problemItem',
        icon: q.supported === false ? 'circle-slash' : q.isPaidOnly ? 'lock' : 'code'
      });
    }

    if (d.catalog.skip > 0) {
      rows.push({
        id: 'browse:prevPage',
        kind: 'pagination',
        label: 'Previous Page',
        description: `Items ${Math.max(1, d.catalog.skip - d.catalog.limit + 1)}–${d.catalog.skip}`,
        command: { command: 'lc.prevPage', title: 'Previous Problem Page' },
        icon: 'arrow-left'
      });
    }

    if (d.catalog.hasMore) {
      const nextStart = d.catalog.skip + d.catalog.questions.length + 1;
      const nextEnd = Math.min(d.catalog.total, d.catalog.skip + d.catalog.questions.length + d.catalog.limit);
      rows.push({
        id: 'browse:nextPage',
        kind: 'pagination',
        label: 'Next Page',
        description: `Items ${nextStart}–${nextEnd} of ${d.catalog.total}`,
        command: { command: 'lc.nextPage', title: 'Next Problem Page' },
        icon: 'arrow-right'
      });
    }

    return rows;
  }

  async getLocalChildren() {
    const locals = await this.getLocalProblems();
    if (!locals.length) {
      return [{
        id: 'local:empty',
        kind: 'status',
        label: 'No saved local problems yet',
        description: 'Click any problem above to create a local C++ solution',
        icon: 'info'
      }];
    }
    return locals.map(q => ({
      id: `local:problem:${q.titleSlug}`,
      kind: 'localProblem',
      problem: q,
      label: `${boundText(q.questionFrontendId, 20)}. ${boundText(q.title, 100)}`,
      description: `${q.difficulty} · Available locally`,
      tooltip: `${q.questionFrontendId}. ${q.title} · Available offline (existing C++ code preserved)`,
      command: {
        command: 'lc.openLocalProblem',
        title: 'Open Local Problem',
        arguments: [q]
      },
      contextValue: 'lc.localProblemItem',
      icon: 'file-code'
    }));
  }
}

module.exports = {
  LeetCodeExplorer,
  formatProblemDescription,
  formatAccountSummary,
  formatFilterSummary,
  boundText
};
