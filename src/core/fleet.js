const fs = require('fs');
const path = require('path');
const tmux = require('./tmux');

/**
 * Read the cache file for a session number.
 * Returns { prNum, prAdds, prDels, prFiles, ciResult, ciBuild, review } or null.
 */
function readCache(config, num) {
  const file = `${config.cache.statusPrefix}${num}`;
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const prNum = lines[0] || '';
    if (!prNum) return null;
    return {
      prNum,
      prAdds: lines[1] || '0',
      prDels: lines[2] || '0',
      prFiles: lines[3] || '0',
      ciResult: lines[4] || '',
      ciBuild: lines[5] || '',
      review: lines[6] || '',
    };
  } catch {
    return null;
  }
}

/**
 * Read the Claude state file for a session number.
 * Returns 'idle', 'working', 'off', or null.
 */
function readState(config, num) {
  const file = path.join(config.cache.stateDir, String(num));
  try {
    return fs.readFileSync(file, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Extract session number from session name ("6-DEV-43966-..." → 6).
 */
function sessionNum(name) {
  const m = name.match(/^(\d+)/);
  return m ? parseInt(m[1]) : null;
}

/**
 * Extract JIRA ticket key from branch name.
 */
function ticketFromBranch(branch) {
  const m = (branch || '').match(/(DEV-\d+)/);
  return m ? m[1] : null;
}

/**
 * Get full status for a single session.
 */
async function getSession(config, sessionName) {
  const num = sessionNum(sessionName);
  const repoDir = num ? config.sessions.repoDir(num) : null;
  const isRepo = repoDir && fs.existsSync(path.join(repoDir, '.git'));

  // Claude state — prefer cached state file, fall back to live detection
  let state = num ? readState(config, num) : null;
  if (!state) {
    const paneTarget = `${sessionName}:.${config.sessions.claudePane}`;
    const paneContent = await tmux.capturePane(paneTarget, { lines: 3 });
    state = tmux.detectState(paneContent, config);
  }

  // Git info
  const git = isRepo ? await tmux.gitInfo(repoDir) : { branch: '', staged: 0, modified: 0, untracked: 0 };
  const ticket = ticketFromBranch(git.branch);

  // PR/CI from cache
  const cache = num ? readCache(config, num) : null;

  return {
    name: sessionName,
    num,
    state,
    branch: git.branch,
    ticket,
    git,
    pr: cache,
  };
}

// Cache: { result, timestamp, pending }
let _fleetCache = { result: null, ts: 0, pending: null };
const FLEET_CACHE_TTL = 5000; // 5s

/**
 * Get status for all fleet sessions.
 * Cached for 5s — all concurrent callers share one result.
 */
async function getFleetStatus(config, _router) {
  const now = Date.now();
  if (_fleetCache.result && now - _fleetCache.ts < FLEET_CACHE_TTL) {
    return _fleetCache.result;
  }
  // If a fetch is already in flight, piggyback on it
  if (_fleetCache.pending) return _fleetCache.pending;

  _fleetCache.pending = (async () => {
    const t0 = Date.now();
    const sessions = await tmux.listSessions();
    const matching = sessions.filter(s => config.sessions.pattern.test(s));
    // Process in batches of 4 to balance speed vs resource usage
    const results = [];
    for (let i = 0; i < matching.length; i += 4) {
      const batch = matching.slice(i, i + 4);
      const batchResults = await Promise.all(batch.map(s => getSession(config, s)));
      results.push(...batchResults);
    }
    console.log(`  [perf] getFleetStatus: ${Date.now() - t0}ms`);
    _fleetCache.result = results;
    _fleetCache.ts = Date.now();
    _fleetCache.pending = null;
    return results;
  })();
  return _fleetCache.pending;
}

/**
 * Get Claude's pane content with TUI chrome stripped.
 * Accepts (config, sessionName) or (config, node, sessionName).
 */
async function peekSession(config, nodeOrName, maybeName) {
  const sessionName = maybeName !== undefined ? maybeName : nodeOrName;
  const paneTarget = `${sessionName}:.${config.sessions.claudePane}`;
  const content = await tmux.capturePane(paneTarget);
  return tmux.stripTUIChrome(content, config);
}

/**
 * Find a session by number (partial match).
 * Accepts (config, query) or (config, router, query) for compatibility with server.js.
 */
async function findSession(config, routerOrQuery, maybeQuery) {
  const query = maybeQuery !== undefined ? maybeQuery : routerOrQuery;
  const allSessions = await tmux.listSessions();
  const sessions = allSessions.filter(s => config.sessions.pattern.test(s));
  let found = null;
  // Exact number match
  const num = parseInt(query);
  if (!isNaN(num)) {
    found = sessions.find(s => sessionNum(s) === num) || null;
  } else {
    // Substring match
    found = sessions.find(s => s.toLowerCase().includes(query.toLowerCase())) || null;
  }
  if (!found) return null;
  return { name: found, nodeId: 'local' };
}

/**
 * Get the config for a given node. For local nodes, returns the main config.
 */
function getNodeConfig(config, _nodeId) {
  return config;
}

module.exports = {
  readCache,
  readState,
  sessionNum,
  getNodeConfig,
  ticketFromBranch,
  getSession,
  getFleetStatus,
  peekSession,
  findSession,
};
