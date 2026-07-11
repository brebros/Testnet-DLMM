// ═══════════════════════════════════════════
// DLMM TESTNET SIMULATOR v3 — app.js
// Meridian-faithful: real screening formulas,
// two-layer close, strategy library, darwin
// ═══════════════════════════════════════════

// ── State global ──
const STATE = {
  wallet: null,
  balances: {},
  positions: [],
  prices: {},
  priceHistory: {},
  selectedPair: null,
  openPair: null,
  filter: 'all',
  search: '',
  sortBy: 'score',
  lastFaucet: null,
  feeSimInterval: null,
  decisionLog: [],
  closedPositions: [],
  currentView: 'pairs',
  lessons: [],           // Darwin learning
  signalWeights: {},     // Darwin signal weights
};

// ═══════════════════════════════════════════
// LOCALSTORAGE PERSISTENCE
// ═══════════════════════════════════════════
const STORAGE_KEY = 'dlmm_testnet_state';
const GIST_TOKEN_KEY = 'dlmm_gist_token';
const GIST_ID_KEY = 'dlmm_gist_id';
const PUBLIC_GIST_ID = '66ef2a095c65a34939750a4cdff8c29e';

// ── Cloud Sync (GitHub Gist) ──
function getGistToken() { return localStorage.getItem(GIST_TOKEN_KEY) || ''; }
function setGistToken(t) { localStorage.setItem(GIST_TOKEN_KEY, t); }
function getGistId() { return localStorage.getItem(GIST_ID_KEY) || PUBLIC_GIST_ID; }
function setGistId(id) { localStorage.setItem(GIST_ID_KEY, id); }

function getStateJSON() {
  return JSON.stringify({
    wallet: STATE.wallet,
    balances: STATE.balances,
    positions: STATE.positions.map(p => ({
      ...p,
      pair: { id: p.pair.id, base: p.pair.base, quote: p.pair.quote, type: p.pair.type, feeTiers: p.pair.feeTiers, binSteps: p.pair.binSteps },
    })),
    closedPositions: STATE.closedPositions.map(p => ({
      ...p,
      pair: { id: p.pair.id, base: p.pair.base, quote: p.pair.quote, type: p.pair.type, feeTiers: p.pair.feeTiers, binSteps: p.pair.binSteps },
    })),
    decisionLog: STATE.decisionLog,
    lessons: STATE.lessons,
    lastFaucet: STATE.lastFaucet,
    signalWeights: STATE.signalWeights,
    savedAt: Date.now(),
    version: 3,
  });
}

async function syncToCloud() {
  const token = getGistToken();
  if (!token) return;
  const gistId = getGistId();
  const body = getStateJSON();
  try {
    if (gistId) {
      // Update existing gist
      const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: { 'dlmm-state.json': { content: body } } }),
      });
      if (!res.ok) {
        if (res.status === 404) {
          // Gist deleted, create new one
          setGistId('');
          return syncToCloud();
        }
        console.warn('Gist update failed:', res.status);
      }
    } else {
      // Create new gist
      const res = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: 'DLMM Testnet Simulator State — auto-sync',
          public: false,
          files: { 'dlmm-state.json': { content: body } },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setGistId(data.id);
        console.log('[cloud] Created gist:', data.id);
      } else {
        console.warn('Gist create failed:', res.status);
      }
    }
  } catch (e) {
    console.warn('Cloud sync error:', e);
  }
}

async function loadFromCloud() {
  const gistId = getGistId();
  if (!gistId) return false;
  try {
    // Public Gist — no auth needed, use raw URL to avoid CORS
    const res = await fetch(`https://gist.githubusercontent.com/brebros/${gistId}/raw/dlmm-state.json`);
    if (!res.ok) return false;
    const text = await res.text();
    const saved = JSON.parse(text);
    if (!saved || !saved.wallet) return false;
    return saved;
  } catch (e) {
    console.warn('Cloud load error:', e);
    return false;
  }
}

function saveState() {
  const toSave = getStateJSON();
  try {
    localStorage.setItem(STORAGE_KEY, toSave);
    // Also sync to cloud in background
    syncToCloud();
  } catch (e) {
    console.warn('localStorage save failed:', e);
  }
}

async function loadState() {
  try {
    // Try cloud first
    let saved = await loadFromCloud();
    let source = 'cloud';
    if (!saved) {
      // Fallback to localStorage
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { saved = JSON.parse(raw); source = 'local'; }
    }
    if (!saved || !saved.wallet) return false;

    STATE.wallet = saved.wallet;
    STATE.balances = saved.balances || {};
    STATE.decisionLog = saved.decisionLog || [];
    STATE.lessons = saved.lessons || [];
    STATE.lastFaucet = saved.lastFaucet;
    STATE.signalWeights = saved.signalWeights || {};
    STATE.closedPositions = saved.closedPositions || [];

    STATE.positions = (saved.positions || []).map(sp => {
      const pair = PAIRS.find(p => p.id === sp.pairId) || sp.pair;
      return { ...sp, pair };
    });

    STATE.positions.forEach(pos => startFeeAccumulation(pos));

    document.getElementById('wallet-addr').textContent = STATE.wallet.slice(0, 6) + '...' + STATE.wallet.slice(-4);
    document.getElementById('connect-btn').textContent = 'Disconnect';
    document.getElementById('connect-btn').onclick = disconnectWallet;
    document.getElementById('faucet-btn').disabled = false;

    renderTokenList();
    updateTotalBalance();
    renderPositionList();
    renderDecisionLog();

    console.log(`[loadState] Restored from ${source}`);
    return source;
  } catch (e) {
    console.warn('loadState failed:', e);
    return false;
  }
}

function clearState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  const gistId = getGistId();
  const token = getGistToken();
  if (gistId && token) {
    fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `token ${token}` },
    }).catch(() => {});
    setGistId('');
  }
}

setInterval(saveState, 5000);
window.addEventListener('beforeunload', saveState);

// ═══════════════════════════════════════════
// MERIDIAN SCREENING — Two scoring systems
// ═══════════════════════════════════════════

// scoreCandidate — Meridian's primary ranking
// Formula: feeTvl*1000 + organic*10 + volume/100 + holders/100
function scoreCandidate(pool) {
  const feeTvl = pool.feeTvlRatio || 0;
  const organic = pool.organic || 0;
  const volume = pool.volume24h || 0;
  const holders = pool.holders || 0;
  return feeTvl * 1000 + organic * 10 + volume / 100 + holders / 100;
}

// degenScore — Meridian's efficiency score (0-100)
// Geometric mean of 4 sub-scores — any zero → total zero
function degenScore(pool, targets = {}) {
  const {
    targetVolRatio = 20,
    targetLpCount = 40,
    targetFeeRatio = 0.20,
    targetLiquidity = 20000,
  } = targets;

  const La = pool.tvl || 0;
  if (La <= 0) return 0;

  const clamp01 = (x) => Math.min(1, Math.max(0, x));

  const tradingRatio = (pool.volume24h || 0) / La;
  const feeRatio = pool.feeTvlRatio || 0;
  const lpActivity = (pool.uniqueLps || 0) + (pool.positionsCreated || 0);

  const sTrading = clamp01(tradingRatio / targetVolRatio);
  const sLp = clamp01(lpActivity / targetLpCount);
  const sFees = clamp01(feeRatio / targetFeeRatio);
  const sLiq = clamp01(Math.log10(Math.max(La, 1)) / Math.log10(targetLiquidity));

  return Math.pow(sTrading * sLp * sFees * sLiq, 0.25) * 100;
}

// ═══════════════════════════════════════════
// MERIDIAN RULES — Two-Layer Close System
// ═══════════════════════════════════════════

const RULES = {
  // Layer A: Deterministic Rules
  stopLossPct: -50,
  takeProfitPct: 5,
  outOfRangeBinsToClose: 10,
  outOfRangeWaitMinutes: 30,
  minFeePerTvl24h: 7,
  minAgeBeforeYieldCheck: 60, // minutes
  minClaimAmount: 5, // USD

  // Layer B: State Machine
  trailingEnabled: true,
  trailingTriggerPct: 3,
  trailingDropPct: 1.5,
  confirmTicks: 2, // Meridian: consecutive ticks to confirm

  // Runtime
  enabled: true,
};

// ═══════════════════════════════════════════
// MERIDIAN BIN RANGE — Volatility-Based
// ═══════════════════════════════════════════
// Formula: binsBelow = clamp(volatility/5 * (hi-lo) + lo, 35, hi)
const MIN_SAFE_BINS_BELOW = 35;

function computeBinsBelow(volatility, minBins = 35, maxBins = 69) {
  return Math.max(minBins, Math.min(maxBins, Math.round(
    minBins + (volatility / 5) * (maxBins - minBins)
  )));
}

// ═══════════════════════════════════════════
// MERIDIAN STRATEGY LIBRARY
// ═══════════════════════════════════════════

const STRATEGIES = {
  spot: {
    name: 'Spot',
    lp_strategy: 'spot',
    description: 'Nyebar rata — cocok kalau ga yakin arah harga',
    entry: { condition: 'Any market condition', notes: 'Equal distribution across all bins' },
    range: { type: 'default' },
    exit: { take_profit_pct: 10 },
    best_for: 'Neutral market, steady fees',
  },
  curve: {
    name: 'Curve',
    lp_strategy: 'curve',
    description: 'Numpuk di tengah — maksimal fee saat sideways',
    entry: { condition: 'Range-bound market', notes: 'Concentrate at current price' },
    range: { type: 'default' },
    exit: { take_profit_pct: 10 },
    best_for: 'Sideways market, max fee capture',
  },
  bid_ask: {
    name: 'Bid-Ask',
    lp_strategy: 'bid_ask',
    description: 'Numpuk di pinggir — cocok saat yakin volatile',
    entry: { condition: 'Volatile market', notes: 'Concentrate at edges for rebalance capture' },
    range: { type: 'default' },
    exit: { take_profit_pct: 10 },
    best_for: 'Volatile market, directional bet',
  },
  single_sided_reseed: {
    name: 'Single-Sided Reseed',
    lp_strategy: 'bid_ask',
    description: 'Token-only bid-ask, OOR → close & redeploy lower (DCA via LP)',
    entry: { condition: 'Token-only deploy, bins below active only', single_side: 'token' },
    range: { type: 'custom', bins_below_pct: 100 },
    exit: { notes: 'OOR downside → close(skip_swap) → redeploy lower. Repeat.' },
    best_for: 'Riding volatile tokens down without cutting losses',
  },
  fee_compounding: {
    name: 'Fee Compounding',
    lp_strategy: 'any',
    description: 'Claim fees > $5 → add liquidity balik — compound yield',
    entry: { condition: 'Stable volume pools', notes: 'Strategy is about management, not entry' },
    range: { type: 'default' },
    exit: { notes: 'When unclaimed > $5 AND in range: claim → add liquidity back' },
    best_for: 'Maximizing yield on stable pools via compounding',
  },
  multi_layer: {
    name: 'Multi-Layer',
    lp_strategy: 'mixed',
    description: 'Stack shapes (bid-ask + spot + curve) ke 1 position',
    entry: { condition: 'Create ONE position, layer shapes via addLiquidity', notes: 'Composite distribution' },
    range: { type: 'custom' },
    exit: { notes: 'Single position — one close, one claim' },
    best_for: 'Custom liquidity distribution, single position to manage',
  },
  partial_harvest: {
    name: 'Partial Harvest',
    lp_strategy: 'any',
    description: 'Di ≥10% return, withdraw 50%, sisanya jalan terus',
    entry: { condition: 'Deploy normally', notes: 'Strategy is about progressive profit-taking' },
    range: { type: 'default' },
    exit: { take_profit_pct: 10, notes: 'At TP: withdraw 50% (bps=5000), let remainder run' },
    best_for: 'Locking profits without fully exiting winners',
  },
  aggressive: {
    name: 'Aggressive Bid-Ask',
    lp_strategy: 'bid_ask',
    description: 'Extreme di pinggir — max fee kalau harga bolak-balik',
    entry: { condition: 'High volatility expected', notes: 'Edge-heavy distribution' },
    range: { type: 'default' },
    exit: { take_profit_pct: 15 },
    best_for: 'Wild price action, maximum rebalance capture',
  },
  conservative: {
    name: 'Conservative',
    lp_strategy: 'spot',
    description: 'Range lebar, distribusi aman — minim IL',
    entry: { condition: 'Uncertain market', notes: 'Wide range, even distribution' },
    range: { type: 'custom', range_width_pct: 50 },
    exit: { take_profit_pct: 5 },
    best_for: 'Capital preservation, steady small fees',
  },
};

// ═══════════════════════════════════════════
// MERIDIAN DECISION LOG
// ═══════════════════════════════════════════

function logDecision(type, pairId, message, details = {}) {
  const entry = {
    id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    type,
    actor: details.actor || 'MANAGER',
    pool: pairId,
    summary: message.slice(0, 280),
    reason: (details.reason || '').slice(0, 500),
    risks: Array.isArray(details.risks) ? details.risks.slice(0, 6) : [],
    metrics: details.metrics || {},
    rejected: Array.isArray(details.rejected) ? details.rejected.slice(0, 8) : [],
  };
  STATE.decisionLog.unshift(entry);
  if (STATE.decisionLog.length > 100) STATE.decisionLog.pop(); // Meridian: max 100
  renderDecisionLog();
  return entry;
}

function renderDecisionLog() {
  const el = document.getElementById('decision-log');
  if (!el) return;
  if (!STATE.decisionLog.length) {
    el.innerHTML = '<div class="empty-state">Belum ada aktivitas</div>';
    return;
  }
  el.innerHTML = STATE.decisionLog.slice(0, 30).map(d => {
    const time = new Date(d.ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const icon = { DEPLOY: '🟢', CLOSE: '🔴', REBALANCE: '🔄', WARNING: '⚠️', SCREEN: '🔍', TP_HIT: '💰', SL_HIT: '🛑', OOR: '📍', CLAIM: '💎', LESSON: '📚', LOW_YIELD: '📉' }[d.type] || '📌';
    return `<div class="log-entry log-${d.type.toLowerCase()}">
      <span class="log-time">${time}</span>
      <span class="log-icon">${icon}</span>
      <span class="log-msg">${d.summary}</span>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════
// MERIDIAN LESSONS — Darwin Learning
// ═══════════════════════════════════════════

function recordPerformance(pos, closeReason) {
  const currentPrice = getPrice(pos.pair.base) / (getPrice(pos.pair.quote) || 1);
  const holdVal = pos.baseAmt * getPrice(pos.pair.base) + pos.quoteAmt * getPrice(pos.pair.quote);
  const entryVal = pos.baseAmt * pos.entryPrice + pos.quoteAmt;
  const priceRatio = currentPrice / pos.entryPrice;
  const lpVal = entryVal * 2 * Math.sqrt(priceRatio) / (1 + priceRatio);
  const pnlPct = holdVal > 0 ? ((pos.feeCollected + (lpVal - holdVal)) / holdVal * 100) : 0;
  const rangeEfficiency = pos.totalRangeMin > 0 ? (pos.inRangeSeconds / ((Date.now() - pos.openedAt) / 1000) * 100) : 50;

  // Meridian outcome classification
  let outcome;
  if (pnlPct >= 5 || (pnlPct >= 0 && (pos.feeCollected / pos.totalUSD * 100) >= 2)) outcome = 'good';
  else if (pnlPct >= 0) outcome = 'neutral';
  else if (pnlPct >= -5) outcome = 'poor';
  else outcome = 'bad';

  // Derive lesson
  let lesson = null;
  if (outcome === 'bad' && rangeEfficiency < 30) {
    lesson = `AVOID ${pos.pairId} — low range efficiency (${rangeEfficiency.toFixed(0)}%). Use wider bin_range or bid_ask strategy.`;
  } else if (outcome === 'good' && rangeEfficiency > 80) {
    lesson = `PREFER ${pos.pairId} — high range efficiency (${rangeEfficiency.toFixed(0)}%) → +${pnlPct.toFixed(1)}% PnL.`;
  } else if (outcome === 'bad' && closeReason.includes('volume')) {
    lesson = `AVOID ${pos.pairId} — volume collapsed. Check minimum sustained volume before deploy.`;
  } else if (outcome === 'good') {
    lesson = `${pos.pairId} worked: ${pos.strategy} strategy, fee ${pos.feeTier}%, held ${(Date.now() - pos.openedAt) / 60000 | 0}min → +${pnlPct.toFixed(1)}%`;
  } else if (outcome === 'bad') {
    lesson = `${pos.pairId} failed: ${pos.strategy} strategy, IL ${pnlPct.toFixed(1)}% — consider tighter SL or different strategy.`;
  }

  if (lesson) {
    STATE.lessons.unshift({ lesson, outcome, ts: Date.now(), pairId: pos.pairId });
    if (STATE.lessons.length > 50) STATE.lessons.pop();
    logDecision('LESSON', pos.pairId, `📚 ${lesson}`, { actor: 'DARWIN' });
  }

  // Evolve thresholds every 5 closed positions (Meridian pattern)
  if (STATE.closedPositions.length > 0 && STATE.closedPositions.length % 5 === 0) {
    evolveThresholds();
  }
}

function evolveThresholds() {
  const recent = STATE.closedPositions.slice(-10);
  if (recent.length < 5) return;
  const winners = recent.filter(p => (p.finalPnl || 0) > 0);
  const losers = recent.filter(p => (p.finalPnl || 0) <= 0);

  if (losers.length > winners.length * 1.5) {
    // Tighten screening — raise thresholds (max 20% change per Meridian)
    const oldSL = RULES.stopLossPct;
    RULES.stopLossPct = Math.max(-30, RULES.stopLossPct * 1.1); // tighten SL
    logDecision('EVOLUTION', '', `🔧 Darwin: tightening SL ${oldSL.toFixed(0)}% → ${RULES.stopLossPct.toFixed(0)}% (${losers.length}L/${winners.length}W)`, { actor: 'DARWIN' });
  }
}

// ═══════════════════════════════════════════
// MERIDIAN CLOSE RULES — Two-Layer System
// ═══════════════════════════════════════════

function getDeterministicCloseRule(pos) {
  const currentPrice = getPrice(pos.pair.base) / (getPrice(pos.pair.quote) || 1);
  const inRange = currentPrice >= pos.rangeMin && currentPrice <= pos.rangeMax;
  const ageMinutes = (Date.now() - pos.openedAt) / 60000;

  // PnL calculation
  const holdVal = pos.baseAmt * getPrice(pos.pair.base) + pos.quoteAmt * getPrice(pos.pair.quote);
  const entryVal = pos.baseAmt * pos.entryPrice + pos.quoteAmt;
  const priceRatio = currentPrice / pos.entryPrice;
  const lpVal = entryVal * 2 * Math.sqrt(priceRatio) / (1 + priceRatio);
  const il = lpVal - holdVal;
  const pnlPct = holdVal > 0 ? ((pos.feeCollected + il) / holdVal * 100) : 0;

  // Rule 1: Stop Loss
  if (pnlPct <= RULES.stopLossPct) return { rule: 'STOP_LOSS', pnlPct };

  // Rule 2: Take Profit (non-trailing mode)
  if (!RULES.trailingEnabled && pnlPct >= RULES.takeProfitPct) return { rule: 'TAKE_PROFIT', pnlPct };

  // Rule 4: Out of Range timeout
  if (!inRange && pos.outOfRangeSince) {
    const oorMinutes = (Date.now() - pos.outOfRangeSince) / 60000;
    if (oorMinutes >= RULES.outOfRangeWaitMinutes) return { rule: 'OOR_TIMEOUT', oorMinutes };
  }

  // Rule 5: Low Yield
  const feePerTvl24h = pos.totalUSD > 0 ? (pos.feeCollected / pos.totalUSD * 100 * (1440 / Math.max(ageMinutes, 1))) : 0;
  if (ageMinutes >= RULES.minAgeBeforeYieldCheck && feePerTvl24h < RULES.minFeePerTvl24h) {
    return { rule: 'LOW_YIELD', feePerTvl24h };
  }

  return null;
}

// Layer B: State Machine — Trailing TP with peak confirmation
function updatePnlAndCheckExits(pos) {
  const currentPrice = getPrice(pos.pair.base) / (getPrice(pos.pair.quote) || 1);
  const holdVal = pos.baseAmt * getPrice(pos.pair.base) + pos.quoteAmt * getPrice(pos.pair.quote);
  const entryVal = pos.baseAmt * pos.entryPrice + pos.quoteAmt;
  const priceRatio = currentPrice / pos.entryPrice;
  const lpVal = entryVal * 2 * Math.sqrt(priceRatio) / (1 + priceRatio);
  const pnlPct = holdVal > 0 ? ((pos.feeCollected + (lpVal - holdVal)) / holdVal * 100) : 0;

  // Peak confirmation (Meridian: require confirmTicks consecutive confirms)
  // Only track peaks when pnlPct is positive and meaningful
  if (pnlPct > 0 && pnlPct > (pos.pendingPeakPnlPct || 0)) {
    pos.pendingPeakPnlPct = pnlPct;
    pos.pendingPeakConfirmCount = 1;
  } else if (pnlPct > 0 && pnlPct >= (pos.pendingPeakPnlPct || 0) * 0.99) {
    pos.pendingPeakConfirmCount = (pos.pendingPeakConfirmCount || 0) + 1;
    if (pos.pendingPeakConfirmCount >= RULES.confirmTicks && pos.pendingPeakPnlPct >= RULES.trailingTriggerPct) {
      pos.peakPnlPct = pos.pendingPeakPnlPct;
      pos.trailingActive = true;
    }
  }

  // Trailing TP
  if (RULES.trailingEnabled && pos.trailingActive && pos.peakPnlPct) {
    const dropFromPeak = pos.peakPnlPct - pnlPct;
    if (dropFromPeak >= RULES.trailingDropPct) {
      return { rule: 'TRAILING_TP', peak: pos.peakPnlPct, current: pnlPct, drop: dropFromPeak };
    }
  }

  // Stop Loss (Layer B)
  if (pnlPct <= RULES.stopLossPct) {
    return { rule: 'STOP_LOSS', pnlPct };
  }

  return null;
}

// ═══════════════════════════════════════════
// RULES ENGINE — Meridian management cycle
// ═══════════════════════════════════════════

function rulesEngine() {
  if (!RULES.enabled || !STATE.positions.length) return;

  STATE.positions.forEach(pos => {
    const currentPrice = getPrice(pos.pair.base) / (getPrice(pos.pair.quote) || 1);
    const inRange = currentPrice >= pos.rangeMin && currentPrice <= pos.rangeMax;

    // Track in-range seconds (for range efficiency calc)
    if (inRange) pos.inRangeSeconds = (pos.inRangeSeconds || 0) + 5;

    // Track OOR
    if (!inRange) {
      if (!pos.outOfRangeSince) pos.outOfRangeSince = Date.now();
    } else {
      pos.outOfRangeSince = null;
      pos.oorWarned = false;
    }

    // Layer A: Deterministic
    const detRule = getDeterministicCloseRule(pos);
    if (detRule && !pos.closeTriggered) {
      pos.closeTriggered = true;
      logDecision(detRule.rule === 'STOP_LOSS' ? 'SL_HIT' : detRule.rule === 'TAKE_PROFIT' ? 'TP_HIT' : detRule.rule === 'OOR_TIMEOUT' ? 'OOR' : 'LOW_YIELD',
        pos.pairId, `${pos.pairId} ${detRule.rule} → auto-close`, { positionId: pos.id, reason: JSON.stringify(detRule) });
      autoClosePosition(pos.id, detRule.rule.toLowerCase().replace('_', ' '));
      return;
    }

    // Layer B: State Machine
    const stateExit = updatePnlAndCheckExits(pos);
    if (stateExit && !pos.closeTriggered) {
      pos.closeTriggered = true;
      logDecision(stateExit.rule === 'TRAILING_TP' ? 'TP_HIT' : 'SL_HIT',
        pos.pairId, `${pos.pairId} ${stateExit.rule} → auto-close (peak: ${stateExit.peak?.toFixed(1)}%, drop: ${stateExit.drop?.toFixed(1)}%)`, { positionId: pos.id });
      autoClosePosition(pos.id, stateExit.rule === 'TRAILING_TP' ? 'trailing take profit' : 'stop loss');
      return;
    }

    // OOR Warning
    if (pos.outOfRangeSince) {
      const oorMin = (Date.now() - pos.outOfRangeSince) / 60000;
      if (oorMin >= 15 && !pos.oorWarned) {
        pos.oorWarned = true;
        logDecision('WARNING', pos.pairId, `⚠️ ${pos.pairId} out of range ${Math.floor(oorMin)}m`, { positionId: pos.id });
      }
    }

    // Edge warning
    const rangeWidth = pos.rangeMax - pos.rangeMin;
    const distToMin = currentPrice - pos.rangeMin;
    const distToMax = pos.rangeMax - currentPrice;
    const edgeThreshold = rangeWidth * 0.1;
    if ((distToMin < edgeThreshold || distToMax < edgeThreshold) && inRange && !pos.edgeWarned) {
      pos.edgeWarned = true;
      logDecision('REBALANCE', pos.pairId, `🔄 ${pos.pairId} harga mendekati edge range`, { positionId: pos.id });
    }
    if (distToMin >= edgeThreshold && distToMax >= edgeThreshold) pos.edgeWarned = false;

    // Fee compounding (Meridian pattern)
    if (pos.strategy === 'fee_compounding' && pos.feeCollected >= RULES.minClaimAmount && inRange) {
      logDecision('CLAIM', pos.pairId, `💎 ${pos.pairId} fee compound: $${pos.feeCollected.toFixed(2)} → reinvest`, { positionId: pos.id });
    }
  });
}

function autoClosePosition(id, reason) {
  const pos = STATE.positions.find(p => p.id === id);
  if (!pos) return;

  STATE.balances[pos.pair.base] = (STATE.balances[pos.pair.base] || 0) + pos.baseAmt;
  STATE.balances[pos.pair.quote] = (STATE.balances[pos.pair.quote] || 0) + pos.quoteAmt + pos.feeCollected / getPrice(pos.pair.quote);

  // Record performance for Darwin learning
  recordPerformance(pos, reason);

  const currentPrice = getPrice(pos.pair.base) / (getPrice(pos.pair.quote) || 1);
  const holdVal = pos.baseAmt * getPrice(pos.pair.base) + pos.quoteAmt * getPrice(pos.pair.quote);
  const entryVal = pos.baseAmt * pos.entryPrice + pos.quoteAmt;
  const priceRatio = currentPrice / pos.entryPrice;
  const lpVal = entryVal * 2 * Math.sqrt(priceRatio) / (1 + priceRatio);

  STATE.closedPositions.push({
    ...pos,
    closedAt: Date.now(),
    closeReason: reason,
    finalFee: pos.feeCollected,
    finalIL: lpVal - holdVal,
    finalPnl: pos.feeCollected + (lpVal - holdVal),
    duration: Date.now() - pos.openedAt,
  });

  STATE.positions = STATE.positions.filter(p => p.id !== id);
  renderTokenList();
  updateTotalBalance();
  renderPositionList();
  showToast(`🔴 ${pos.pairId} ditutup (${reason}). Fee: $${pos.feeCollected.toFixed(2)}`);
  saveState();
}

// ═══════════════════════════════════════════
// SMART SCREENING — Meridian pool scoring
// ═══════════════════════════════════════════

function computePairMetrics(pair) {
  const change = Math.abs(STATE.prices[pair.base]?.change24h || 0);
  const basePrice = getPrice(pair.base);
  const quotePrice = getPrice(pair.quote);
  if (!basePrice || !quotePrice) return { score: 0, degen: 0, feeTvlRatio: 0, volatility: 0 };

  // Estimate metrics from available data
  const rate = basePrice / quotePrice;
  // Volatility scale: amplify change24h for better strategy differentiation
  // Meridian uses per-pool API volatility; we approximate from CoinGecko 24h change
  // Scale: 1% change = 1.5 vol, 5% = 7.5, 10% = 15 (capped at 20)
  const volatility = Math.min(change * 1.5, 20);
  const feeTvlRatio = pair.type === 'volatile' ? 0.15 : 0.05; // Estimate
  const maxFee = Math.max(...pair.feeTiers);

  // Score like Meridian
  const pool = {
    feeTvlRatio: maxFee * feeTvlRatio,
    organic: pair.type === 'volatile' ? 70 : 90,
    volume24h: change * 10000, // Rough estimate
    holders: pair.type === 'volatile' ? 1000 : 5000,
    tvl: 50000,
    uniqueLps: Math.floor(change * 10),
    positionsCreated: Math.floor(change * 5),
  };

  return {
    score: scoreCandidate(pool),
    degen: degenScore(pool),
    feeTvlRatio: pool.feeTvlRatio,
    volatility,
    estimatedPool: pool,
  };
}

function sortPairs(pairs) {
  const sorted = [...pairs];
  switch (STATE.sortBy) {
    case 'score':
      return sorted.sort((a, b) => computePairMetrics(b).score - computePairMetrics(a).score);
    case 'degen':
      return sorted.sort((a, b) => computePairMetrics(b).degen - computePairMetrics(a).degen);
    case 'change':
      return sorted.sort((a, b) => Math.abs(STATE.prices[b.base]?.change24h || 0) - Math.abs(STATE.prices[a.base]?.change24h || 0));
    case 'price':
      return sorted.sort((a, b) => (getPrice(b.base) / (getPrice(b.quote) || 1)) - (getPrice(a.base) / (getPrice(a.quote) || 1)));
    case 'name':
    default:
      return sorted.sort((a, b) => a.id.localeCompare(b.id));
  }
}

// ═══════════════════════════════════════════
// CoinGecko price fetch
// ═══════════════════════════════════════════

async function fetchPrices() {
  const ids = [...new Set(Object.values(TOKENS).map(t => t.id))].join(',');
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
    );
    const data = await res.json();
    Object.entries(TOKENS).forEach(([sym, token]) => {
      if (data[token.id]) {
        const newPrice = data[token.id].usd;
        if (!STATE.priceHistory[sym]) STATE.priceHistory[sym] = [];
        STATE.priceHistory[sym].push({ t: Date.now(), p: newPrice });
        if (STATE.priceHistory[sym].length > 100) STATE.priceHistory[sym].shift();
        STATE.prices[sym] = { usd: newPrice, change24h: data[token.id].usd_24h_change || 0 };
      }
    });
    renderCurrentView();
    updateSolTicker();
    updateTotalBalance();
  } catch (e) {
    console.warn('Price fetch failed, using fallback', e);
    useFallbackPrices();
  }
}

function useFallbackPrices() {
  const fallback = {
    USDC:1,USDT:1,DAI:1,PYUSD:1,FRAX:1,USDS:1,TUSD:1,BUSD:1,GUSD:1,USDP:1,
    SOL:150,BONK:0.000025,WIF:2.5,JUP:0.9,PYTH:0.4,RAY:2.1,ORCA:3.5,
    JTO:2.8,POPCAT:0.8,BOME:0.008,MEW:0.006,SLERF:0.12,SAMO:0.02,
    MNGO:0.04,RENDER:5.5,HNT:6.2,MOBILE:0.006,IOT:0.004,GMT:0.18,
    GST:0.01,DRIFT:0.55,ZEUS:0.4,KMNO:0.15,MSOL:165,JSOL:162,
    STSOL:163,BSOL:164,W:0.35,TNSR:0.45,PONKE:0.12,
  };
  Object.entries(fallback).forEach(([sym, usd]) => {
    STATE.prices[sym] = { usd, change24h: (Math.random() - 0.5) * 5 };
  });
  renderCurrentView();
  updateSolTicker();
  updateTotalBalance();
}

function getPrice(sym) { return STATE.prices[sym]?.usd || 0; }

function updateSolTicker() {
  const p = getPrice('SOL');
  const c = STATE.prices['SOL']?.change24h || 0;
  const el = document.getElementById('sol-ticker');
  el.textContent = `SOL $${p.toFixed(2)}`;
  el.style.color = c >= 0 ? '#4ade80' : '#f87171';
}

// ═══════════════════════════════════════════
// Wallet
// ═══════════════════════════════════════════

function generateAddress() {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let addr = '';
  for (let i = 0; i < 44; i++) addr += chars[Math.floor(Math.random() * chars.length)];
  return addr;
}

function connectWallet(address) {
  STATE.wallet = address;
  STATE.balances = {};
  document.getElementById('wallet-addr').textContent = address.slice(0, 6) + '...' + address.slice(-4);
  document.getElementById('connect-btn').textContent = 'Disconnect';
  document.getElementById('connect-btn').onclick = disconnectWallet;
  document.getElementById('faucet-btn').disabled = false;
  document.getElementById('wallet-modal').style.display = 'none';
  renderTokenList();
  updateTotalBalance();
  saveState();
}

function disconnectWallet() {
  STATE.wallet = null;
  STATE.balances = {};
  STATE.positions = [];
  STATE.decisionLog = [];
  STATE.closedPositions = [];
  STATE.lessons = [];
  clearState(); // Clear localStorage
  document.getElementById('wallet-addr').textContent = 'Not connected';
  document.getElementById('connect-btn').textContent = 'Connect Wallet';
  document.getElementById('connect-btn').onclick = () => document.getElementById('wallet-modal').style.display = 'flex';
  document.getElementById('faucet-btn').disabled = true;
  renderTokenList();
  renderPositionList();
  renderDecisionLog();
  updateTotalBalance();
}

document.getElementById('connect-btn').onclick = () => document.getElementById('wallet-modal').style.display = 'flex';
document.getElementById('gen-wallet-btn').onclick = () => connectWallet(generateAddress());
document.getElementById('use-custom-btn').onclick = () => {
  const v = document.getElementById('custom-addr').value.trim();
  if (v.length > 10) connectWallet(v);
};
document.getElementById('close-modal-btn').onclick = () => document.getElementById('wallet-modal').style.display = 'none';

// ═══════════════════════════════════════════
// Faucet
// ═══════════════════════════════════════════

document.getElementById('faucet-btn').onclick = openFaucet;

function openFaucet() {
  const grid = document.getElementById('faucet-grid');
  const now = Date.now();
  const canClaim = !STATE.lastFaucet || now - STATE.lastFaucet > 86400000;
  grid.innerHTML = Object.entries(FAUCET_AMOUNTS).map(([sym, amt]) => `
    <div class="faucet-item"><span class="faucet-sym">${sym}</span><span class="faucet-amt">${fmt(amt)}</span></div>
  `).join('');
  document.getElementById('claim-all-btn').disabled = !canClaim;
  document.getElementById('claim-all-btn').textContent = canClaim ? 'Claim All Tokens' : `Claim lagi dalam ${timeUntilFaucet()}`;
  document.getElementById('faucet-modal').style.display = 'flex';
}

function timeUntilFaucet() {
  const diff = 86400000 - (Date.now() - STATE.lastFaucet);
  return `${Math.floor(diff / 3600000)}j ${Math.floor((diff % 3600000) / 60000)}m`;
}

document.getElementById('claim-all-btn').onclick = () => {
  Object.entries(FAUCET_AMOUNTS).forEach(([sym, amt]) => STATE.balances[sym] = (STATE.balances[sym] || 0) + amt);
  STATE.lastFaucet = Date.now();
  saveState();
  renderTokenList();
  updateTotalBalance();
  document.getElementById('faucet-modal').style.display = 'none';
  showToast('🚰 Semua token berhasil di-claim!');
};
document.getElementById('close-faucet-btn').onclick = () => document.getElementById('faucet-modal').style.display = 'none';

// ═══════════════════════════════════════════
// Token List & Balance
// ═══════════════════════════════════════════

function renderTokenList() {
  const el = document.getElementById('token-list');
  if (!STATE.wallet) { el.innerHTML = '<div class="empty-state">Connect wallet dulu</div>'; return; }
  const tokens = Object.keys(STATE.balances).filter(s => STATE.balances[s] > 0);
  if (!tokens.length) { el.innerHTML = '<div class="empty-state">Claim faucet dulu 🚰</div>'; return; }
  el.innerHTML = tokens.map(sym => {
    const bal = STATE.balances[sym];
    return `<div class="token-row"><div class="token-sym">${sym}</div><div class="token-bal"><div>${fmtBal(bal, sym)}</div><div class="token-usd">$${(bal * getPrice(sym)).toFixed(2)}</div></div></div>`;
  }).join('');
}

function updateTotalBalance() {
  const tokenTotal = Object.entries(STATE.balances).reduce((sum, [sym, bal]) => sum + bal * getPrice(sym), 0);
  const posTotal = STATE.positions.reduce((sum, pos) => sum + pos.totalUSD + pos.feeCollected, 0);
  const total = tokenTotal + posTotal;
  document.getElementById('total-usd').textContent = '$' + total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ═══════════════════════════════════════════
// View Switching
// ═══════════════════════════════════════════

function switchView(view) {
  STATE.currentView = view;
  document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  renderCurrentView();
}

function renderCurrentView() {
  if (STATE.currentView === 'analytics') renderAnalytics();
  else renderPairGrid();
}

// ═══════════════════════════════════════════
// Pair Grid
// ═══════════════════════════════════════════

function renderPairGrid() {
  const el = document.getElementById('pair-grid');
  let pairs = PAIRS;
  if (STATE.filter !== 'all') pairs = pairs.filter(p => p.type === STATE.filter);
  if (STATE.search) {
    const q = STATE.search.toLowerCase();
    pairs = pairs.filter(p => p.id.toLowerCase().includes(q));
  }
  pairs = sortPairs(pairs);
  if (!pairs.length) { el.innerHTML = '<div class="empty-state">Pair tidak ditemukan</div>'; return; }
  el.innerHTML = pairs.map(pair => {
    const basePrice = getPrice(pair.base);
    const quotePrice = getPrice(pair.quote);
    const rate = quotePrice > 0 ? basePrice / quotePrice : 0;
    const change = STATE.prices[pair.base]?.change24h || 0;
    const changeStr = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
    const changeColor = change >= 0 ? 'green' : 'red';
    const isSelected = STATE.openPair?.id === pair.id;
    const metrics = computePairMetrics(pair);
    const scoreColor = metrics.degen >= 60 ? 'high' : metrics.degen >= 30 ? 'mid' : 'low';
    return `
      <div class="pair-card ${isSelected ? 'selected' : ''} ${pair.type}" onclick="selectPair('${pair.id}')">
        <div class="pair-top-row">
          <div class="pair-name">${pair.base}/${pair.quote}</div>
          <div class="pair-score ${scoreColor}">${metrics.degen.toFixed(0)}</div>
        </div>
        <div class="pair-price">${fmtRate(rate, pair)}</div>
        <div class="pair-change ${changeColor}">${changeStr}</div>
        <div class="pair-type-badge ${pair.type}">${pair.type}</div>
      </div>`;
  }).join('');
}

function filterPairs(type) {
  STATE.filter = type;
  document.querySelectorAll('#filter-tabs .pair-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  renderCurrentView();
}

function sortPairsBy(sort) {
  STATE.sortBy = sort;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  renderCurrentView();
}

function searchPairs(val) { STATE.search = val; renderCurrentView(); }

function selectPair(pairId) {
  STATE.openPair = PAIRS.find(p => p.id === pairId);
  renderPairGrid();
  renderDLMMPanel();
}

// ═══════════════════════════════════════════
// DLMM Panel
// ═══════════════════════════════════════════

let dlmmState = { feeTier: null, binStep: null, strategy: 'spot', rangeMin: 0, rangeMax: 0, numBins: 20 };

function renderDLMMPanel() {
  const pair = STATE.openPair;
  if (!pair) return;
  const basePrice = getPrice(pair.base);
  const quotePrice = getPrice(pair.quote);
  const rate = quotePrice > 0 ? basePrice / quotePrice : 1;
  const change = STATE.prices[pair.base]?.change24h || 0;
  const metrics = computePairMetrics(pair);

  dlmmState.feeTier = pair.feeTiers[0];
  dlmmState.binStep = pair.binSteps[0];
  // Meridian volatility-based bin range
  const binsBelow = computeBinsBelow(metrics.volatility, MIN_SAFE_BINS_BELOW, 69);
  const rangePct = binsBelow / 69 * 0.15;
  dlmmState.rangeMin = parseFloat((rate * (1 - rangePct)).toFixed(8));
  dlmmState.rangeMax = parseFloat((rate * (1 + rangePct)).toFixed(8));
  dlmmState.numBins = binsBelow * 2;

  // Auto-select strategy based on volatility (recalibrated for CoinGecko data)
  // Vol scale: 1% change = 1.5 vol, 5% = 7.5, 10% = 15
  const autoStrategy = metrics.volatility >= 10 ? 'aggressive' : metrics.volatility >= 5 ? 'bid_ask' : metrics.volatility >= 2 ? 'curve' : 'spot';
  dlmmState.strategy = autoStrategy;

  const panel = document.getElementById('right-panel');
  panel.innerHTML = `
    <div class="dlmm-header">
      <div class="dlmm-pair">${pair.base}/${pair.quote}</div>
      <div class="dlmm-price">${fmtRate(rate, pair)}</div>
      <div class="dlmm-change ${change >= 0 ? 'green' : 'red'}">${change >= 0 ? '+' : ''}${change.toFixed(2)}% 24h</div>
      <div class="dlmm-score-badge">Degen: ${metrics.degen.toFixed(0)}/100 | Score: ${metrics.score.toFixed(0)}</div>
    </div>

    ${getChartHTML(pair.id)}

    <div class="dlmm-section">
      <div class="section-label">Fee Tier</div>
      <div class="btn-row" id="fee-tier-btns">
        ${pair.feeTiers.map(f => `<button class="btn-sm ${f === dlmmState.feeTier ? 'sel' : ''}" onclick="setDlmmFee(${f})">${f}%</button>`).join('')}
      </div>
    </div>

    <div class="dlmm-section">
      <div class="section-label">Bin Step (basis points)</div>
      <div class="btn-row" id="bin-step-btns">
        ${pair.binSteps.map(b => `<button class="btn-sm ${b === dlmmState.binStep ? 'sel' : ''}" onclick="setDlmmBin(${b})">${b} bps</button>`).join('')}
      </div>
    </div>

    <div class="dlmm-section">
      <div class="section-label">Strategy (Meridian Library)</div>
      <div class="btn-row" id="strat-btns">
        ${Object.entries(STRATEGIES).map(([key, s]) => `<button class="btn-sm ${dlmmState.strategy === key ? 'sel' : ''}" onclick="setDlmmStrat('${key}')">${s.name}</button>`).join('')}
      </div>
      <div class="strat-hint" id="strat-hint">${STRATEGIES[dlmmState.strategy]?.description || ''}</div>
      <div class="strat-best-for" id="strat-best-for">Best for: ${STRATEGIES[dlmmState.strategy]?.best_for || ''}</div>
    </div>

    <div class="dlmm-section">
      <div class="section-label">Active Bins: <span id="bin-count-val">${dlmmState.numBins}</span> <span class="bin-hint">(volatility: ${metrics.volatility.toFixed(1)} → binsBelow: ${binsBelow})</span></div>
      <input type="range" id="bin-slider" min="5" max="50" value="${dlmmState.numBins}" oninput="updateBinCount(this.value)" class="range-slider">
    </div>

    <div class="dlmm-section">
      <div class="section-label">Price Range</div>
      <div class="range-inputs">
        <div class="range-input-group"><label>Min</label><input type="number" id="range-min" value="${dlmmState.rangeMin}" step="any" oninput="updateRangeMin(this.value)"></div>
        <div class="range-divider">↔</div>
        <div class="range-input-group"><label>Max</label><input type="number" id="range-max" value="${dlmmState.rangeMax}" step="any" oninput="updateRangeMax(this.value)"></div>
      </div>
      <div class="range-width-info" id="range-width-info"></div>
    </div>

    <div class="dlmm-section">
      <div class="section-label">Bin Distribution</div>
      <div id="bin-preview" class="bin-preview"></div>
    </div>

    <div class="dlmm-section">
      <div class="section-label">Add Liquidity</div>
      <div class="liq-inputs">
        <div class="liq-input-group"><label>${pair.base}</label><input type="number" id="amount-base" placeholder="0.00" oninput="syncQuote(this.value)" min="0"><span class="bal-hint">Bal: ${fmtBal(STATE.balances[pair.base] || 0, pair.base)}</span></div>
        <div class="liq-plus">+</div>
        <div class="liq-input-group"><label>${pair.quote}</label><input type="number" id="amount-quote" placeholder="0.00" oninput="syncBase(this.value)" min="0"><span class="bal-hint">Bal: ${fmtBal(STATE.balances[pair.quote] || 0, pair.quote)}</span></div>
      </div>
      <div class="liq-usd-total" id="liq-usd-total">≈ $0.00</div>
      <button class="btn-primary full" onclick="addLiquidity()">${STATE.wallet ? 'Add Liquidity' : 'Connect Wallet First'}</button>
    </div>`;

  updateRangeInfo();
  renderBinPreview();
  setTimeout(() => renderChart('chart-container', pair.id, currentTimeframe), 100);
}

function setDlmmFee(f) { dlmmState.feeTier = f; document.querySelectorAll('#fee-tier-btns .btn-sm').forEach(b => b.classList.remove('sel')); event.target.classList.add('sel'); }
function setDlmmBin(b) { dlmmState.binStep = b; document.querySelectorAll('#bin-step-btns .btn-sm').forEach(btn => btn.classList.remove('sel')); event.target.classList.add('sel'); renderBinPreview(); }
function setDlmmStrat(s) { dlmmState.strategy = s; document.querySelectorAll('#strat-btns .btn-sm').forEach(b => b.classList.remove('sel')); event.target.classList.add('sel'); document.getElementById('strat-hint').textContent = STRATEGIES[s]?.description || ''; document.getElementById('strat-best-for').textContent = 'Best for: ' + (STRATEGIES[s]?.best_for || ''); renderBinPreview(); }
function updateBinCount(v) { dlmmState.numBins = parseInt(v); document.getElementById('bin-count-val').textContent = v; renderBinPreview(); }
function updateRangeMin(v) { dlmmState.rangeMin = parseFloat(v) || 0; updateRangeInfo(); renderBinPreview(); }
function updateRangeMax(v) { dlmmState.rangeMax = parseFloat(v) || 0; updateRangeInfo(); renderBinPreview(); }
function updateRangeInfo() { const el = document.getElementById('range-width-info'); if (!el) return; const mid = (dlmmState.rangeMin + dlmmState.rangeMax) / 2; const width = mid > 0 ? ((dlmmState.rangeMax - dlmmState.rangeMin) / mid * 100).toFixed(1) : 0; el.textContent = `Range width: ${width}%`; }

function renderBinPreview() {
  const el = document.getElementById('bin-preview');
  if (!el) return;
  const n = dlmmState.numBins;
  const weights = getWeights(n, dlmmState.strategy);
  const max = Math.max(...weights);
  const activeIdx = Math.floor(n / 2);
  el.innerHTML = weights.map((w, i) => {
    const h = Math.max((w / max) * 100, 4);
    const isActive = i === activeIdx;
    return `<div style="flex:1;height:${h}%;background:${isActive ? '#f59e0b' : '#22d3ee'};border-radius:2px 2px 0 0;opacity:${isActive ? 1 : 0.7}" title="Bin ${i}"></div>`;
  }).join('');
}

function getWeights(n, strategy) {
  const mid = (n - 1) / 2;
  if (strategy === 'spot' || strategy === 'conservative') return Array(n).fill(1);
  if (strategy === 'curve' || strategy === 'fee_compounding') return Array.from({ length: n }, (_, i) => Math.max(0.05, 1 - Math.abs(i - mid) / mid));
  if (strategy === 'bid_ask' || strategy === 'single_sided_reseed') return Array.from({ length: n }, (_, i) => 0.1 + Math.abs(i - mid) / mid);
  if (strategy === 'aggressive') return Array.from({ length: n }, (_, i) => 0.02 + Math.pow(Math.abs(i - mid) / mid, 1.5));
  if (strategy === 'multi_layer') { const bidask = Array.from({ length: n }, (_, i) => 0.1 + Math.abs(i - mid) / mid); const spot = Array(n).fill(0.5); return bidask.map((v, i) => v + spot[i]); }
  if (strategy === 'partial_harvest') return Array.from({ length: n }, (_, i) => 0.3 + 0.7 * Math.max(0, 1 - Math.abs(i - mid) / mid));
  return Array(n).fill(1);
}

function syncQuote(baseVal) { const pair = STATE.openPair; if (!pair) return; const rate = getPrice(pair.base) / (getPrice(pair.quote) || 1); const qEl = document.getElementById('amount-quote'); if (qEl) qEl.value = isNaN(parseFloat(baseVal) * rate) ? '' : (parseFloat(baseVal) * rate).toFixed(6); updateLiqUSD(); }
function syncBase(quoteVal) { const pair = STATE.openPair; if (!pair) return; const rate = getPrice(pair.base) / (getPrice(pair.quote) || 1); const bEl = document.getElementById('amount-base'); if (bEl) bEl.value = isNaN(parseFloat(quoteVal) / rate) ? '' : (parseFloat(quoteVal) / rate).toFixed(6); updateLiqUSD(); }
function updateLiqUSD() { const pair = STATE.openPair; if (!pair) return; const b = parseFloat(document.getElementById('amount-base')?.value) || 0; const q = parseFloat(document.getElementById('amount-quote')?.value) || 0; const el = document.getElementById('liq-usd-total'); if (el) el.textContent = `≈ $${(b * getPrice(pair.base) + q * getPrice(pair.quote)).toFixed(2)}`; }

// ═══════════════════════════════════════════
// Add Liquidity
// ═══════════════════════════════════════════

function addLiquidity() {
  if (!STATE.wallet) { alert('Connect wallet dulu!'); return; }
  const pair = STATE.openPair;
  const baseAmt = parseFloat(document.getElementById('amount-base')?.value) || 0;
  const quoteAmt = parseFloat(document.getElementById('amount-quote')?.value) || 0;
  if (baseAmt <= 0 && quoteAmt <= 0) { alert('Masukkan jumlah token!'); return; }
  if ((STATE.balances[pair.base] || 0) < baseAmt) { alert(`Balance ${pair.base} tidak cukup!`); return; }
  if ((STATE.balances[pair.quote] || 0) < quoteAmt) { alert(`Balance ${pair.quote} tidak cukup!`); return; }

  STATE.balances[pair.base] -= baseAmt;
  STATE.balances[pair.quote] -= quoteAmt;

  const totalUSD = baseAmt * getPrice(pair.base) + quoteAmt * getPrice(pair.quote);
  const position = {
    id: Date.now(), pairId: pair.id, pair, baseAmt, quoteAmt,
    entryPrice: getPrice(pair.base) / (getPrice(pair.quote) || 1),
    totalUSD, feeTier: dlmmState.feeTier, binStep: dlmmState.binStep,
    strategy: dlmmState.strategy, rangeMin: dlmmState.rangeMin, rangeMax: dlmmState.rangeMax,
    feeCollected: 0, openedAt: Date.now(), swapCount: 0,
    feePeak: 0, outOfRangeSince: null, oorWarned: false, closeTriggered: false,
    edgeWarned: false, peakPnlPct: 0, trailingActive: false,
    pendingPeakPnlPct: 0, pendingPeakConfirmCount: 0,
    inRangeSeconds: 0,
  };

  STATE.positions.push(position);
  logDecision('DEPLOY', pair.id, `Deploy ${pair.id} — ${dlmmState.strategy}, $${totalUSD.toFixed(2)}, fee ${dlmmState.feeTier}%, bins ${dlmmState.numBins}`, { actor: 'SCREENER', positionId: position.id });

  renderTokenList();
  updateTotalBalance();
  renderPositionList();
  startFeeAccumulation(position);
  showToast(`✅ ${pair.id} dibuka! $${totalUSD.toFixed(2)} terdeploy.`);
  saveState();
  renderDLMMPanel();
}

// ═══════════════════════════════════════════
// Fee Accumulation + Rules Engine (3s interval — Meridian pattern)
// ═══════════════════════════════════════════

function startFeeAccumulation(position) {
  const interval = setInterval(() => {
    const pos = STATE.positions.find(p => p.id === position.id);
    if (!pos) { clearInterval(interval); return; }

    const currentPrice = getPrice(pos.pair.base) / (getPrice(pos.pair.quote) || 1);
    const inRange = currentPrice >= pos.rangeMin && currentPrice <= pos.rangeMax;

    if (inRange) {
      const baseVol = pos.baseAmt * 0.02;
      pos.feeCollected += baseVol * getPrice(pos.pair.base) * (pos.feeTier / 100);
      pos.swapCount++;
    }

    // Meridian: 3-second polling with rules engine
    rulesEngine();

    renderPositionList();
    updateTotalBalance();
    if (STATE.currentView === 'analytics') renderAnalytics();
  }, 3000); // 3 detik — sesuai Meridian
}

// ═══════════════════════════════════════════
// Position List
// ═══════════════════════════════════════════

function renderPositionList() {
  const el = document.getElementById('position-list');
  if (!STATE.positions.length) { el.innerHTML = '<div class="empty-state">Belum ada posisi</div>'; return; }
  el.innerHTML = STATE.positions.map(pos => {
    const currentPrice = getPrice(pos.pair.base) / (getPrice(pos.pair.quote) || 1);
    const inRange = currentPrice >= pos.rangeMin && currentPrice <= pos.rangeMax;
    const holdVal = pos.baseAmt * getPrice(pos.pair.base) + pos.quoteAmt * getPrice(pos.pair.quote);
    const entryVal = pos.baseAmt * pos.entryPrice + pos.quoteAmt;
    const priceRatio = currentPrice / pos.entryPrice;
    const lpVal = entryVal * 2 * Math.sqrt(priceRatio) / (1 + priceRatio);
    const il = lpVal - holdVal;
    const netPnl = pos.feeCollected + il;
    const feePct = pos.totalUSD > 0 ? (pos.feeCollected / pos.totalUSD * 100) : 0;
    const ilPct = holdVal > 0 ? (il / holdVal * 100) : 0;
    const oorMin = pos.outOfRangeSince ? Math.floor((Date.now() - pos.outOfRangeSince) / 60000) : 0;

    let badges = '';
    if (!inRange && oorMin > 0) badges += `<span class="badge-warn">OOR ${oorMin}m</span>`;
    if (ilPct < -30) badges += `<span class="badge-danger">IL ${ilPct.toFixed(0)}%</span>`;
    if (pos.trailingActive) badges += `<span class="badge-info">Trailing peak ${pos.peakPnlPct?.toFixed(1)}%</span>`;
    if (pos.feeCollected >= RULES.minClaimAmount) badges += `<span class="badge-claim">Claim $${pos.feeCollected.toFixed(1)}</span>`;

    return `
      <div class="position-card">
        <div class="pos-header"><span class="pos-pair">${pos.pair.base}/${pos.pair.quote}</span><span class="pos-status ${inRange ? 'in-range' : 'out-range'}">${inRange ? '● In Range' : '○ Out'}</span></div>
        ${badges ? `<div class="pos-badges">${badges}</div>` : ''}
        <div class="pos-row"><span>Strategy</span><span>${pos.strategy}</span></div>
        <div class="pos-row"><span>Fee Tier</span><span>${pos.feeTier}%</span></div>
        <div class="pos-row"><span>Value</span><span>$${pos.totalUSD.toFixed(2)}</span></div>
        <div class="pos-row"><span>Fee</span><span class="green">+$${pos.feeCollected.toFixed(2)} (${feePct.toFixed(1)}%)</span></div>
        <div class="pos-row"><span>IL</span><span class="${il >= 0 ? 'green' : 'red'}">${il >= 0 ? '+' : ''}$${il.toFixed(2)}</span></div>
        <div class="pos-row pos-net"><span>Net PnL</span><span class="${netPnl >= 0 ? 'green' : 'red'}">${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)}</span></div>
        <button class="btn-remove" onclick="removePosition(${pos.id})">Remove Position</button>
      </div>`;
  }).join('');
}

function removePosition(id) {
  const pos = STATE.positions.find(p => p.id === id);
  if (!pos) return;
  const currentPrice = getPrice(pos.pair.base) / (getPrice(pos.pair.quote) || 1);
  const holdVal = pos.baseAmt * getPrice(pos.pair.base) + pos.quoteAmt * getPrice(pos.pair.quote);
  const entryVal = pos.baseAmt * pos.entryPrice + pos.quoteAmt;
  const priceRatio = currentPrice / pos.entryPrice;
  const lpVal = entryVal * 2 * Math.sqrt(priceRatio) / (1 + priceRatio);
  const finalPnl = pos.feeCollected + (lpVal - holdVal);

  recordPerformance(pos, 'manual');
  STATE.closedPositions.push({ ...pos, closedAt: Date.now(), closeReason: 'manual', finalFee: pos.feeCollected, finalIL: lpVal - holdVal, finalPnl, duration: Date.now() - pos.openedAt });
  logDecision('CLOSE', pos.pairId, `Manual close ${pos.pairId} — Fee: $${pos.feeCollected.toFixed(2)}, PnL: $${finalPnl.toFixed(2)}`, { actor: 'MANAGER' });

  STATE.balances[pos.pair.base] = (STATE.balances[pos.pair.base] || 0) + pos.baseAmt;
  STATE.balances[pos.pair.quote] = (STATE.balances[pos.pair.quote] || 0) + pos.quoteAmt + pos.feeCollected / getPrice(pos.pair.quote);
  STATE.positions = STATE.positions.filter(p => p.id !== id);
  renderTokenList();
  updateTotalBalance();
  renderPositionList();
  showToast(`🔴 ${pos.pair.id} ditutup. Fee: +$${pos.feeCollected.toFixed(2)}`);
  saveState();
}

// ═══════════════════════════════════════════
// Analytics Dashboard
// ═══════════════════════════════════════════

function renderAnalytics() {
  const el = document.getElementById('pair-grid');
  const allClosed = STATE.closedPositions;
  const allPositions = [...STATE.positions, ...allClosed];
  const totalDeployed = allPositions.reduce((s, p) => s + p.totalUSD, 0);
  const totalFees = allPositions.reduce((s, p) => s + (p.finalFee ?? p.feeCollected), 0);
  const totalPnl = allClosed.reduce((s, p) => s + (p.finalPnl || 0), 0);
  const activeValue = STATE.positions.reduce((s, p) => s + p.totalUSD, 0);
  const winCount = allClosed.filter(p => (p.finalPnl || 0) > 0).length;
  const lossCount = allClosed.filter(p => (p.finalPnl || 0) <= 0).length;
  const winRate = allClosed.length > 0 ? (winCount / allClosed.length * 100) : 0;
  const pairPnl = {};
  allClosed.forEach(p => { pairPnl[p.pairId] = (pairPnl[p.pairId] || 0) + (p.finalPnl || 0); });
  const sortedPairs = Object.entries(pairPnl).sort((a, b) => b[1] - a[1]);
  const bestPair = sortedPairs[0];
  const worstPair = sortedPairs[sortedPairs.length - 1];
  const reasons = {};
  allClosed.forEach(p => { reasons[p.closeReason] = (reasons[p.closeReason] || 0) + 1; });
  const totalDuration = allPositions.reduce((s, p) => s + ((p.closedAt || Date.now()) - p.openedAt), 0);
  const avgDurationHrs = allPositions.length > 0 ? (totalDuration / allPositions.length / 3600000) : 1;
  const aprEstimate = totalDeployed > 0 ? ((totalFees / totalDeployed) / (avgDurationHrs / 8760) * 100) : 0;

  el.innerHTML = `
    <div class="analytics-container">
      <h2 class="analytics-title">📊 Analytics Dashboard</h2>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">Total Deployed</div><div class="stat-value">$${totalDeployed.toFixed(2)}</div></div>
        <div class="stat-card"><div class="stat-label">Active Value</div><div class="stat-value accent">$${activeValue.toFixed(2)}</div></div>
        <div class="stat-card"><div class="stat-label">Total Fees</div><div class="stat-value green">+$${totalFees.toFixed(2)}</div></div>
        <div class="stat-card"><div class="stat-label">Realized PnL</div><div class="stat-value ${totalPnl >= 0 ? 'green' : 'red'}">${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}</div></div>
        <div class="stat-card"><div class="stat-label">Win Rate</div><div class="stat-value">${winRate.toFixed(0)}%</div><div class="stat-sub">${winCount}W / ${lossCount}L</div></div>
        <div class="stat-card"><div class="stat-label">Est. APR</div><div class="stat-value">${aprEstimate.toFixed(1)}%</div></div>
      </div>

      <div class="chart-section">
        <div class="section-label">PnL per Position</div>
        <div class="pnl-chart">
          ${allClosed.length ? allClosed.map(p => {
            const maxAbs = Math.max(...allClosed.map(x => Math.abs(x.finalPnl || 0)), 1);
            const h = Math.max(Math.abs(p.finalPnl || 0) / maxAbs * 80, 4);
            const color = (p.finalPnl || 0) >= 0 ? '#4ade80' : '#f87171';
            return `<div class="chart-bar-wrapper"><div class="chart-bar" style="height:${h}px;background:${color}"></div><div class="chart-label">${p.pair.base}</div><div class="chart-val ${(p.finalPnl || 0) >= 0 ? 'green' : 'red'}">${(p.finalPnl || 0) >= 0 ? '+' : ''}$${(p.finalPnl || 0).toFixed(1)}</div></div>`;
          }).join('') : '<div class="empty-state">Belum ada posisi ditutup</div>'}
        </div>
      </div>

      <div class="ranking-section">
        <div class="section-label">Pair Rankings</div>
        <div class="ranking-grid">
          <div class="rank-card best"><div class="rank-label">🏆 Best</div><div class="rank-pair">${bestPair ? bestPair[0] : '—'}</div><div class="rank-pnl green">${bestPair ? '+$' + bestPair[1].toFixed(2) : ''}</div></div>
          <div class="rank-card worst"><div class="rank-label">💀 Worst</div><div class="rank-pair">${worstPair && worstPair !== bestPair ? worstPair[0] : '—'}</div><div class="rank-pnl red">${worstPair && worstPair !== bestPair ? '$' + worstPair[1].toFixed(2) : ''}</div></div>
        </div>
      </div>

      <div class="reasons-section">
        <div class="section-label">Close Reasons</div>
        <div class="reasons-grid">
          ${Object.entries(reasons).length ? Object.entries(reasons).map(([r, c]) => `<div class="reason-item"><span class="reason-icon">${{ manual: '🖐️', 'stop loss': '🛑', 'take profit': '💰', 'trailing take profit': '📈', 'out-of-range timeout': '📍', low_yield: '📉' }[r] || '📌'}</span><span class="reason-name">${r}</span><span class="reason-count">${c}</span></div>`).join('') : '<div class="empty-state">Belum ada</div>'}
        </div>
      </div>

      <!-- Darwin Lessons -->
      <div class="lessons-section">
        <div class="section-label">📚 Darwin Lessons</div>
        <div class="lessons-grid">
          ${STATE.lessons.length ? STATE.lessons.slice(0, 10).map(l => `<div class="lesson-item lesson-${l.outcome}"><span class="lesson-outcome">${{ good: '✅', poor: '⚠️', bad: '❌', neutral: '➖' }[l.outcome]}</span><span class="lesson-text">${l.lesson}</span></div>`).join('') : '<div class="empty-state">Belum ada pelajaran — tutup posisi dulu</div>'}
        </div>
      </div>

      <!-- Rules Config -->
      <div class="rules-section">
        <div class="section-label">⚙️ Rules Engine (Meridian Two-Layer)</div>
        <div class="rules-grid">
          <div class="rule-item"><label>Stop Loss (%)</label><input type="number" value="${RULES.stopLossPct}" onchange="RULES.stopLossPct=parseFloat(this.value)" class="rule-input"></div>
          <div class="rule-item"><label>Take Profit (%)</label><input type="number" value="${RULES.takeProfitPct}" onchange="RULES.takeProfitPct=parseFloat(this.value)" class="rule-input"></div>
          <div class="rule-item"><label>Trailing TP</label><label class="toggle"><input type="checkbox" ${RULES.trailingEnabled ? 'checked' : ''} onchange="RULES.trailingEnabled=this.checked"><span class="toggle-slider"></span></label></div>
          <div class="rule-item"><label>Trailing Trigger (%)</label><input type="number" value="${RULES.trailingTriggerPct}" onchange="RULES.trailingTriggerPct=parseFloat(this.value)" class="rule-input"></div>
          <div class="rule-item"><label>Trailing Drop (%)</label><input type="number" value="${RULES.trailingDropPct}" onchange="RULES.trailingDropPct=parseFloat(this.value)" class="rule-input"></div>
          <div class="rule-item"><label>OOR Timeout (min)</label><input type="number" value="${RULES.outOfRangeWaitMinutes}" onchange="RULES.outOfRangeWaitMinutes=parseFloat(this.value)" class="rule-input"></div>
          <div class="rule-item"><label>Confirm Ticks</label><input type="number" value="${RULES.confirmTicks}" onchange="RULES.confirmTicks=parseInt(this.value)" class="rule-input"></div>
          <div class="rule-item"><label>Min Fee/TVL 24h (%)</label><input type="number" value="${RULES.minFeePerTvl24h}" onchange="RULES.minFeePerTvl24h=parseFloat(this.value)" class="rule-input"></div>
        </div>
        <div class="rules-toggle-row">
          <label class="toggle"><input type="checkbox" ${RULES.enabled ? 'checked' : ''} onchange="RULES.enabled=this.checked; showToast(this.checked ? '✅ Rules ON' : '⚠️ Rules OFF')"><span class="toggle-slider"></span></label>
          <span>Rules Engine ${RULES.enabled ? 'ACTIVE' : 'DISABLED'}</span>
        </div>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'toast show';
  setTimeout(() => t.className = 'toast', 3000);
}

function fmt(n) { if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return n.toString(); }
function fmtBal(n, sym) { if (!n) return '0'; if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M ' + sym; if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K ' + sym; if (n < 0.0001) return n.toExponential(2) + ' ' + sym; return n.toFixed(4) + ' ' + sym; }
function fmtRate(rate) { if (!rate) return '—'; if (rate < 0.000001) return rate.toExponential(4); if (rate < 0.01) return rate.toFixed(8); if (rate < 1) return rate.toFixed(6); return rate.toFixed(4); }

// ═══════════════════════════════════════════
// Init — load from localStorage or fresh
// ═══════════════════════════════════════════

fetchPrices();
renderDecisionLog();
setInterval(fetchPrices, 30000);

// Try to restore state from localStorage or cloud
(async () => {
  const debugLines = [];
  const statusEl = document.getElementById('persist-status');
  const debugEl = document.getElementById('sync-debug');

  // Auto-setup Gist token from URL parameter
  const urlParams = new URLSearchParams(window.location.search);
  const gistParam = urlParams.get('gist');
  if (gistParam) {
    setGistToken(gistParam);
    window.history.replaceState({}, '', window.location.pathname);
    debugLines.push('✅ Token set from URL');
  }

  const token = getGistToken();
  const gistId = getGistId();
  debugLines.push('Token: ' + (token ? token.slice(0,6) + '...' + token.slice(-4) : 'NONE'));
  debugLines.push('Gist ID: ' + (gistId || 'NONE'));

  const source = await loadState();
  debugLines.push('Source: ' + (source || 'NONE'));

  if (source === 'cloud') {
    if (statusEl) { statusEl.textContent = '☁️ Cloud'; statusEl.style.color = '#4ade80'; }
  } else if (source === 'local') {
    if (statusEl) { statusEl.textContent = '💾 Local'; statusEl.style.color = '#f59e0b'; }
  } else {
    if (statusEl) { statusEl.textContent = '🆕 Fresh'; statusEl.style.color = '#8b949e'; }
  }

  if (debugEl) debugEl.innerHTML = debugLines.map(l => '<div style="font-size:10px;color:#8b949e;">' + l + '</div>').join('');
})();
