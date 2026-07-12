// ═══════════════════════════════════════════
// DLMM TESTNET SIMULATOR — MERGED VERSION
// Base: Claude (clean code + chart)
// Features: Meridian (screening, rules, darwin)
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
  lessons: [],
  signalWeights: {},
};

// ═══════════════════════════════════════════
// LOCALSTORAGE + CLOUD SYNC
// ═══════════════════════════════════════════
const STORAGE_KEY = 'dlmm_testnet_state';
const GIST_TOKEN_KEY = 'dlmm_gist_token';
const GIST_ID_KEY = 'dlmm_gist_id';
const PUBLIC_GIST_ID = '66ef2a095c65a34939750a4cdff8c29e';

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
    version: 4,
  });
}

async function syncToCloud() {
  const token = getGistToken();
  if (!token) return;
  const gistId = getGistId();
  const body = getStateJSON();
  try {
    if (gistId && gistId !== PUBLIC_GIST_ID) {
      const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: { 'dlmm-state.json': { content: body } } }),
      });
      if (!res.ok && res.status === 404) { setGistId(''); return syncToCloud(); }
    } else {
      const res = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'DLMM Testnet State — auto-sync', public: true, files: { 'dlmm-state.json': { content: body } } }),
      });
      if (res.ok) { const data = await res.json(); setGistId(data.id); }
    }
  } catch (e) { console.warn('Cloud sync error:', e); }
}

async function loadFromCloud() {
  const gistId = getGistId();
  if (!gistId) return false;
  try {
    const res = await fetch(`https://gist.githubusercontent.com/brebros/${gistId}/raw/dlmm-state.json`);
    if (!res.ok) return false;
    const saved = JSON.parse(await res.text());
    if (!saved || !saved.wallet) return false;
    return saved;
  } catch (e) { return false; }
}

function saveState() {
  const json = getStateJSON();
  try { localStorage.setItem(STORAGE_KEY, json); syncToCloud(); } catch (e) {}
}

async function loadState() {
  try {
    let saved = await loadFromCloud();
    let source = 'cloud';
    if (!saved) { const raw = localStorage.getItem(STORAGE_KEY); if (raw) { saved = JSON.parse(raw); source = 'local'; } }
    if (!saved || !saved.wallet) return false;
    STATE.wallet = saved.wallet;
    STATE.balances = saved.balances || {};
    STATE.decisionLog = saved.decisionLog || [];
    STATE.lessons = saved.lessons || [];
    STATE.lastFaucet = saved.lastFaucet;
    STATE.signalWeights = saved.signalWeights || {};
    STATE.closedPositions = saved.closedPositions || [];
    STATE.positions = (saved.positions || []).map(sp => ({ ...sp, pair: PAIRS.find(p => p.id === sp.pairId) || sp.pair }));
    STATE.positions.forEach(pos => startFeeAccumulation(pos));
    document.getElementById('wallet-addr').textContent = STATE.wallet.slice(0, 6) + '...' + STATE.wallet.slice(-4);
    document.getElementById('connect-btn').textContent = 'Disconnect';
    document.getElementById('connect-btn').onclick = disconnectWallet;
    document.getElementById('faucet-btn').disabled = false;
    renderTokenList(); updateTotalBalance(); renderPositionList(); renderDecisionLog();
    return source;
  } catch (e) { return false; }
}

function clearState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  const gistId = getGistId(); const token = getGistToken();
  if (gistId && gistId !== PUBLIC_GIST_ID && token) {
    fetch(`https://api.github.com/gists/${gistId}`, { method: 'DELETE', headers: { 'Authorization': `token ${token}` } }).catch(() => {});
    setGistId('');
  }
}

setInterval(saveState, 5000);
window.addEventListener('beforeunload', saveState);

// ═══════════════════════════════════════════
// MERIDIAN SCREENING
// ═══════════════════════════════════════════
function scoreCandidate(pool) {
  const feeTvl = pool.feeTvlRatio || 0;
  const organic = pool.organic || 0;
  const volume = pool.volume24h || 0;
  const holders = pool.holders || 0;
  return feeTvl * 1000 + organic * 10 + volume / 100 + holders / 100;
}

function degenScore(pool, targets = {}) {
  const { targetVolRatio = 20, targetLpCount = 40, targetFeeRatio = 0.20, targetLiquidity = 20000 } = targets;
  const La = pool.tvl || 0;
  if (La <= 0) return 0;
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const sTrading = clamp01((pool.volume24h || 0) / La / targetVolRatio);
  const sLp = clamp01(((pool.uniqueLps || 0) + (pool.positionsCreated || 0)) / targetLpCount);
  const sFees = clamp01((pool.feeTvlRatio || 0) / targetFeeRatio);
  const sLiq = clamp01(Math.log10(Math.max(La, 1)) / Math.log10(targetLiquidity));
  return Math.pow(sTrading * sLp * sFees * sLiq, 0.25) * 100;
}

function computePairMetrics(pair) {
  const change = Math.abs(STATE.prices[pair.base]?.change24h || 0);
  const basePrice = getPrice(pair.base);
  const quotePrice = getPrice(pair.quote);
  if (!basePrice || !quotePrice) return { score: 0, degen: 0, feeTvlRatio: 0, volatility: 0 };
  const volatility = Math.min(change * 1.5, 20);
  const maxFee = Math.max(...pair.feeTiers);
  const feeTvlRatio = pair.type === 'volatile' ? 0.15 : 0.05;
  const pool = { feeTvlRatio: maxFee * feeTvlRatio, organic: pair.type === 'volatile' ? 70 : 90, volume24h: change * 10000, holders: pair.type === 'volatile' ? 1000 : 5000, tvl: 50000, uniqueLps: Math.floor(change * 10), positionsCreated: Math.floor(change * 5) };
  return { score: scoreCandidate(pool), degen: degenScore(pool), feeTvlRatio: pool.feeTvlRatio, volatility };
}

// ═══════════════════════════════════════════
// MERIDIAN BIN RANGE (volatility-based)
// ═══════════════════════════════════════════
const MIN_SAFE_BINS_BELOW = 35;
function computeBinsBelow(volatility, minBins = 35, maxBins = 69) {
  return Math.max(minBins, Math.min(maxBins, Math.round(minBins + (volatility / 5) * (maxBins - minBins))));
}

// ═══════════════════════════════════════════
// MERIDIAN STRATEGY LIBRARY
// ═══════════════════════════════════════════
const STRATEGIES = {
  spot: { name: 'Spot', description: 'Nyebar rata — cocok kalau ga yakin arah harga', best_for: 'Neutral market, steady fees' },
  curve: { name: 'Curve', description: 'Numpuk di tengah — maksimal fee saat sideways', best_for: 'Sideways market, max fee capture' },
  bid_ask: { name: 'Bid-Ask', description: 'Numpuk di pinggir — cocok saat yakin volatile', best_for: 'Volatile market, directional bet' },
  aggressive: { name: 'Aggressive', description: 'Extreme di pinggir — max fee kalau harga bolak-balik', best_for: 'Wild price action' },
  conservative: { name: 'Safe', description: 'Range lebar, distribusi aman — minim IL', best_for: 'Capital preservation' },
  single_sided_reseed: { name: 'Reseed', description: 'Token-only bid-ask, OOR → close & redeploy lower', best_for: 'DCA via LP' },
  fee_compounding: { name: 'Compound', description: 'Claim fees → add liquidity balik', best_for: 'Compound yield' },
  partial_harvest: { name: 'Harvest', description: 'Di ≥10% return, withdraw 50%, sisanya jalan', best_for: 'Progressive profit-taking' },
};

// ═══════════════════════════════════════════
// MERIDIAN RULES ENGINE (Two-Layer Close)
// ═══════════════════════════════════════════
const RULES = {
  stopLossPct: -50, takeProfitPct: 5,
  outOfRangeWaitMinutes: 30, minFeePerTvl24h: 7, minAgeBeforeYieldCheck: 60,
  trailingEnabled: true, trailingTriggerPct: 3, trailingDropPct: 1.5, confirmTicks: 2,
  enabled: true,
};

function getDeterministicCloseRule(pos) {
  const cp = getPrice(pos.pair.base) / (getPrice(pos.pair.quote) || 1);
  const inRange = cp >= pos.rangeMin && cp <= pos.rangeMax;
  const ageMin = (Date.now() - pos.openedAt) / 60000;
  const entryVal = pos.baseAmt * pos.entryPrice + pos.quoteAmt;
  const pr = cp / pos.entryPrice;
  const lpVal = entryVal * 2 * Math.sqrt(pr) / (1 + pr);
  const holdVal = pos.baseAmt * getPrice(pos.pair.base) + pos.quoteAmt * getPrice(pos.pair.quote);
  const pnlPct = holdVal > 0 ? ((pos.feeCollected + (lpVal - holdVal)) / holdVal * 100) : 0;
  if (pnlPct <= RULES.stopLossPct) return { rule: 'STOP_LOSS', pnlPct };
  if (!RULES.trailingEnabled && pnlPct >= RULES.takeProfitPct) return { rule: 'TAKE_PROFIT', pnlPct };
  if (!inRange && pos.outOfRangeSince && (Date.now() - pos.outOfRangeSince) / 60000 >= RULES.outOfRangeWaitMinutes) return { rule: 'OOR_TIMEOUT' };
  return null;
}

function updatePnlAndCheckExits(pos) {
  const cp = getPrice(pos.pair.base) / (getPrice(pos.pair.quote) || 1);
  const entryVal = pos.baseAmt * pos.entryPrice + pos.quoteAmt;
  const pr = cp / pos.entryPrice;
  const lpVal = entryVal * 2 * Math.sqrt(pr) / (1 + pr);
  const holdVal = pos.baseAmt * getPrice(pos.pair.base) + pos.quoteAmt * getPrice(pos.pair.quote);
  const pnlPct = holdVal > 0 ? ((pos.feeCollected + (lpVal - holdVal)) / holdVal * 100) : 0;
  if (pnlPct > 0 && pnlPct > (pos.pendingPeakPnlPct || 0)) { pos.pendingPeakPnlPct = pnlPct; pos.pendingPeakConfirmCount = 1; }
  else if (pnlPct > 0 && pnlPct >= (pos.pendingPeakPnlPct || 0) * 0.99) {
    pos.pendingPeakConfirmCount = (pos.pendingPeakConfirmCount || 0) + 1;
    if (pos.pendingPeakConfirmCount >= RULES.confirmTicks && pos.pendingPeakPnlPct >= RULES.trailingTriggerPct) { pos.peakPnlPct = pos.pendingPeakPnlPct; pos.trailingActive = true; }
  }
  if (RULES.trailingEnabled && pos.trailingActive && pos.peakPnlPct) {
    if (pos.peakPnlPct - pnlPct >= RULES.trailingDropPct) return { rule: 'TRAILING_TP', peak: pos.peakPnlPct, current: pnlPct };
  }
  if (pnlPct <= RULES.stopLossPct) return { rule: 'STOP_LOSS', pnlPct };
  return null;
}

function rulesEngine() {
  if (!RULES.enabled || !STATE.positions.length) return;
  STATE.positions.forEach(pos => {
    const cp = getPrice(pos.pair.base) / (getPrice(pos.pair.quote) || 1);
    const inRange = cp >= pos.rangeMin && cp <= pos.rangeMax;
    if (inRange) pos.inRangeSeconds = (pos.inRangeSeconds || 0) + 5;
    if (!inRange) { if (!pos.outOfRangeSince) pos.outOfRangeSince = Date.now(); } else { pos.outOfRangeSince = null; pos.oorWarned = false; }
    const det = getDeterministicCloseRule(pos);
    if (det && !pos.closeTriggered) { pos.closeTriggered = true; logDecision(det.rule === 'STOP_LOSS' ? 'SL_HIT' : 'OOR', pos.pairId, `${pos.pairId} ${det.rule} → auto-close`); autoClosePosition(pos.id, det.rule.toLowerCase().replace('_', ' ')); return; }
    const stateExit = updatePnlAndCheckExits(pos);
    if (stateExit && !pos.closeTriggered) { pos.closeTriggered = true; logDecision('TP_HIT', pos.pairId, `${pos.pairId} ${stateExit.rule} → auto-close`); autoClosePosition(pos.id, stateExit.rule === 'TRAILING_TP' ? 'trailing take profit' : 'stop loss'); return; }
    if (pos.outOfRangeSince && (Date.now() - pos.outOfRangeSince) / 60000 >= 15 && !pos.oorWarned) { pos.oorWarned = true; logDecision('WARNING', pos.pairId, `⚠️ ${pos.pairId} out of range`); }
    const rw = pos.rangeMax - pos.rangeMin;
    if ((cp - pos.rangeMin < rw * 0.1 || pos.rangeMax - cp < rw * 0.1) && inRange && !pos.edgeWarned) { pos.edgeWarned = true; logDecision('REBALANCE', pos.pairId, `🔄 ${pos.pairId} near edge`); }
    if (cp - pos.rangeMin >= rw * 0.1 && pos.rangeMax - cp >= rw * 0.1) pos.edgeWarned = false;
  });
}

function autoClosePosition(id, reason) {
  const pos = STATE.positions.find(p => p.id === id);
  if (!pos) return;
  STATE.balances[pos.pair.base] = (STATE.balances[pos.pair.base] || 0) + pos.baseAmt;
  STATE.balances[pos.pair.quote] = (STATE.balances[pos.pair.quote] || 0) + pos.quoteAmt + pos.feeCollected / getPrice(pos.pair.quote);
  recordPerformance(pos, reason);
  const cp = getPrice(pos.pair.base) / (getPrice(pos.pair.quote) || 1);
  const entryVal = pos.baseAmt * pos.entryPrice + pos.quoteAmt;
  const pr = cp / pos.entryPrice;
  const lpVal = entryVal * 2 * Math.sqrt(pr) / (1 + pr);
  const holdVal = pos.baseAmt * getPrice(pos.pair.base) + pos.quoteAmt * getPrice(pos.pair.quote);
  STATE.closedPositions.push({ ...pos, closedAt: Date.now(), closeReason: reason, finalFee: pos.feeCollected, finalIL: lpVal - holdVal, finalPnl: pos.feeCollected + (lpVal - holdVal), duration: Date.now() - pos.openedAt });
  STATE.positions = STATE.positions.filter(p => p.id !== id);
  renderTokenList(); updateTotalBalance(); renderPositionList();
  showToast(`🔴 ${pos.pairId} ditutup (${reason}). Fee: $${pos.feeCollected.toFixed(2)}`);
}

// ═══════════════════════════════════════════
// MERIDIAN DECISION LOG
// ═══════════════════════════════════════════
function logDecision(type, pairId, message, details = {}) {
  const entry = { id: `dec_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, ts: new Date().toISOString(), type, actor: details.actor || 'MANAGER', pool: pairId, summary: message.slice(0, 280), reason: (details.reason || '').slice(0, 500), risks: [], metrics: {}, rejected: [] };
  STATE.decisionLog.unshift(entry);
  if (STATE.decisionLog.length > 100) STATE.decisionLog.pop();
  renderDecisionLog();
}

function renderDecisionLog() {
  const el = document.getElementById('decision-log');
  if (!el) return;
  if (!STATE.decisionLog.length) { el.innerHTML = '<div class="empty-state">Belum ada aktivitas</div>'; return; }
  el.innerHTML = STATE.decisionLog.slice(0, 30).map(d => {
    const time = new Date(d.ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const icon = { DEPLOY: '🟢', CLOSE: '🔴', REBALANCE: '🔄', WARNING: '⚠️', TP_HIT: '💰', SL_HIT: '🛑', OOR: '📍', CLAIM: '💎', LESSON: '📚' }[d.type] || '📌';
    return `<div class="log-entry log-${d.type.toLowerCase()}"><span class="log-time">${time}</span><span class="log-icon">${icon}</span><span class="log-msg">${d.summary}</span></div>`;
  }).join('');
}

// ═══════════════════════════════════════════
// DARWIN LEARNING
// ═══════════════════════════════════════════
function recordPerformance(pos, closeReason) {
  const cp = getPrice(pos.pair.base) / (getPrice(pos.pair.quote) || 1);
  const entryVal = pos.baseAmt * pos.entryPrice + pos.quoteAmt;
  const pr = cp / pos.entryPrice;
  const lpVal = entryVal * 2 * Math.sqrt(pr) / (1 + pr);
  const holdVal = pos.baseAmt * getPrice(pos.pair.base) + pos.quoteAmt * getPrice(pos.pair.quote);
  const pnlPct = holdVal > 0 ? ((pos.feeCollected + (lpVal - holdVal)) / holdVal * 100) : 0;
  const rangeEff = pos.inRangeSeconds > 0 ? (pos.inRangeSeconds / ((Date.now() - pos.openedAt) / 1000) * 100) : 50;
  let outcome = pnlPct >= 5 || (pnlPct >= 0 && (pos.feeCollected / pos.totalUSD * 100) >= 2) ? 'good' : pnlPct >= 0 ? 'neutral' : pnlPct >= -5 ? 'poor' : 'bad';
  let lesson = null;
  if (outcome === 'bad' && rangeEff < 30) lesson = `AVOID ${pos.pairId} — low range efficiency (${rangeEff.toFixed(0)}%). Use wider range.`;
  else if (outcome === 'good' && rangeEff > 80) lesson = `PREFER ${pos.pairId} — high efficiency (${rangeEff.toFixed(0)}%) → +${pnlPct.toFixed(1)}%`;
  else if (outcome === 'good') lesson = `${pos.pairId} worked: ${pos.strategy} → +${pnlPct.toFixed(1)}%`;
  else if (outcome === 'bad') lesson = `${pos.pairId} failed: ${pos.strategy} → ${pnlPct.toFixed(1)}% IL`;
  if (lesson) { STATE.lessons.unshift({ lesson, outcome, ts: Date.now(), pairId: pos.pairId }); if (STATE.lessons.length > 50) STATE.lessons.pop(); logDecision('LESSON', pos.pairId, `📚 ${lesson}`, { actor: 'DARWIN' }); }
}

// ═══════════════════════════════════════════
// CoinGecko price fetch
// ═══════════════════════════════════════════
async function fetchPrices() {
  const ids = [...new Set(Object.values(TOKENS).map(t => t.id))].join(',');
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
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
    renderCurrentView(); updateSolTicker(); updateTotalBalance();
  } catch (e) { useFallbackPrices(); }
}

function useFallbackPrices() {
  const fallback = { USDC:1,USDT:1,DAI:1,PYUSD:1,FRAX:1,USDS:1,TUSD:1,BUSD:1,GUSD:1,USDP:1, SOL:150,BONK:0.000025,WIF:2.5,JUP:0.9,PYTH:0.4,RAY:2.1,ORCA:3.5, JTO:2.8,POPCAT:0.8,BOME:0.008,MEW:0.006,SLERF:0.12,SAMO:0.02, MNGO:0.04,RENDER:5.5,HNT:6.2,MOBILE:0.006,IOT:0.004,GMT:0.18, GST:0.01,DRIFT:0.55,ZEUS:0.4,KMNO:0.15,MSOL:165,JSOL:162, STSOL:163,BSOL:164,W:0.35,TNSR:0.45,PONKE:0.12 };
  Object.entries(fallback).forEach(([sym, usd]) => { STATE.prices[sym] = { usd, change24h: (Math.random()-0.5)*5 }; });
  renderCurrentView(); updateSolTicker(); updateTotalBalance();
}

function getPrice(sym) { return STATE.prices[sym]?.usd || 0; }

function updateSolTicker() {
  const p = getPrice('SOL'); const c = STATE.prices['SOL']?.change24h || 0;
  const el = document.getElementById('sol-ticker');
  el.textContent = `SOL $${p.toFixed(2)}`; el.style.color = c >= 0 ? '#4ade80' : '#f87171';
}

// ═══════════════════════════════════════════
// Wallet
// ═══════════════════════════════════════════
function generateAddress() {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let addr = ''; for (let i = 0; i < 44; i++) addr += chars[Math.floor(Math.random() * chars.length)]; return addr;
}

function connectWallet(address) {
  STATE.wallet = address; STATE.balances = {};
  document.getElementById('wallet-addr').textContent = address.slice(0,6)+'...'+address.slice(-4);
  document.getElementById('connect-btn').textContent = 'Disconnect';
  document.getElementById('connect-btn').onclick = disconnectWallet;
  document.getElementById('faucet-btn').disabled = false;
  document.getElementById('wallet-modal').style.display = 'none';
  renderTokenList(); updateTotalBalance(); saveState();
}

function disconnectWallet() {
  STATE.wallet = null; STATE.balances = {}; STATE.positions = []; STATE.decisionLog = []; STATE.closedPositions = []; STATE.lessons = [];
  clearState();
  document.getElementById('wallet-addr').textContent = 'Not connected';
  document.getElementById('connect-btn').textContent = 'Connect Wallet';
  document.getElementById('connect-btn').onclick = () => document.getElementById('wallet-modal').style.display = 'flex';
  document.getElementById('faucet-btn').disabled = true;
  renderTokenList(); renderPositionList(); renderDecisionLog(); updateTotalBalance();
}

document.getElementById('connect-btn').onclick = () => document.getElementById('wallet-modal').style.display = 'flex';
document.getElementById('gen-wallet-btn').onclick = () => connectWallet(generateAddress());
document.getElementById('use-custom-btn').onclick = () => { const v = document.getElementById('custom-addr').value.trim(); if (v.length > 10) connectWallet(v); };
document.getElementById('close-modal-btn').onclick = () => document.getElementById('wallet-modal').style.display = 'none';

// ═══════════════════════════════════════════
// Faucet
// ═══════════════════════════════════════════
document.getElementById('faucet-btn').onclick = openFaucet;
function openFaucet() {
  const grid = document.getElementById('faucet-grid');
  const canClaim = !STATE.lastFaucet || Date.now() - STATE.lastFaucet > 86400000;
  grid.innerHTML = Object.entries(FAUCET_AMOUNTS).map(([sym, amt]) => `<div class="faucet-item"><span class="faucet-sym">${sym}</span><span class="faucet-amt">${fmt(amt)}</span></div>`).join('');
  document.getElementById('claim-all-btn').disabled = !canClaim;
  document.getElementById('claim-all-btn').textContent = canClaim ? 'Claim All Tokens' : `Claim lagi dalam ${timeUntilFaucet()}`;
  document.getElementById('faucet-modal').style.display = 'flex';
}
function timeUntilFaucet() { const diff = 86400000 - (Date.now() - STATE.lastFaucet); return `${Math.floor(diff/3600000)}j ${Math.floor((diff%3600000)/60000)}m`; }
document.getElementById('claim-all-btn').onclick = () => {
  Object.entries(FAUCET_AMOUNTS).forEach(([sym, amt]) => STATE.balances[sym] = (STATE.balances[sym]||0) + amt);
  STATE.lastFaucet = Date.now(); saveState(); renderTokenList(); updateTotalBalance();
  document.getElementById('faucet-modal').style.display = 'none';
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
    const bal = STATE.balances[sym]; const price = getPrice(sym);
    return `<div class="token-row"><div class="token-sym">${sym}</div><div class="token-bal"><div>${fmtBal(bal, sym)}</div><div class="token-usd">$${(bal*price).toFixed(2)}</div></div></div>`;
  }).join('');
}

function updateTotalBalance() {
  const tokenTotal = Object.entries(STATE.balances).reduce((s,[k,v]) => s + v * getPrice(k), 0);
  const posTotal = STATE.positions.reduce((s,p) => s + p.totalUSD + p.feeCollected, 0);
  document.getElementById('total-usd').textContent = '$' + (tokenTotal + posTotal).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
}

// ═══════════════════════════════════════════
// View Switching
// ═══════════════════════════════════════════
function switchView(view) {
  STATE.currentView = view;
  document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active'); renderCurrentView();
}
function renderCurrentView() { if (STATE.currentView === 'analytics') renderAnalytics(); else renderPairGrid(); }

// ═══════════════════════════════════════════
// Pair Grid
// ═══════════════════════════════════════════
function renderPairGrid() {
  const el = document.getElementById('pair-grid');
  let pairs = PAIRS;
  if (STATE.filter !== 'all') pairs = pairs.filter(p => p.type === STATE.filter);
  if (STATE.search) { const q = STATE.search.toLowerCase(); pairs = pairs.filter(p => p.id.toLowerCase().includes(q)); }
  pairs = sortPairs(pairs);
  if (!pairs.length) { el.innerHTML = '<div class="empty-state">Pair tidak ditemukan</div>'; return; }
  el.innerHTML = pairs.map(pair => {
    const rate = getPrice(pair.quote) > 0 ? getPrice(pair.base) / getPrice(pair.quote) : 0;
    const change = STATE.prices[pair.base]?.change24h || 0;
    const m = computePairMetrics(pair);
    const scoreColor = m.degen >= 60 ? 'high' : m.degen >= 30 ? 'mid' : 'low';
    const isSelected = STATE.openPair?.id === pair.id;
    return `<div class="pair-card ${isSelected?'selected':''} ${pair.type}" onclick="selectPair('${pair.id}')">
      <div class="pair-top-row"><div class="pair-name">${pair.base}/${pair.quote}</div><div class="pair-score ${scoreColor}">${m.degen.toFixed(0)}</div></div>
      <div class="pair-price">${fmtRate(rate, pair)}</div>
      <div class="pair-change ${change>=0?'green':'red'}">${change>=0?'+':''}${change.toFixed(2)}%</div>
      <div class="pair-type-badge ${pair.type}">${pair.type}</div></div>`;
  }).join('');
}

function filterPairs(type) {
  STATE.filter = type;
  document.querySelectorAll('#filter-tabs .pair-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active'); renderCurrentView();
}
function sortPairsBy(sort) {
  STATE.sortBy = sort;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active'); renderCurrentView();
}
function searchPairs(val) { STATE.search = val; renderCurrentView(); }
function sortPairs(pairs) {
  const s = [...pairs];
  switch (STATE.sortBy) {
    case 'score': return s.sort((a,b) => computePairMetrics(b).score - computePairMetrics(a).score);
    case 'degen': return s.sort((a,b) => computePairMetrics(b).degen - computePairMetrics(a).degen);
    case 'change': return s.sort((a,b) => Math.abs(STATE.prices[b.base]?.change24h||0) - Math.abs(STATE.prices[a.base]?.change24h||0));
    case 'price': return s.sort((a,b) => (getPrice(b.base)/(getPrice(b.quote)||1)) - (getPrice(a.base)/(getPrice(a.quote)||1)));
    default: return s.sort((a,b) => a.id.localeCompare(b.id));
  }
}

function selectPair(pairId) { STATE.openPair = PAIRS.find(p => p.id === pairId); renderPairGrid(); renderDLMMPanel(); }

// ═══════════════════════════════════════════
// DLMM Panel
// ═══════════════════════════════════════════
let dlmmState = { feeTier: null, binStep: null, strategy: 'spot', rangeMin: 0, rangeMax: 0, numBins: 20 };

function renderDLMMPanel() {
  const pair = STATE.openPair; if (!pair) return;
  const rate = getPrice(pair.quote) > 0 ? getPrice(pair.base) / getPrice(pair.quote) : 1;
  const change = STATE.prices[pair.base]?.change24h || 0;
  const m = computePairMetrics(pair);
  dlmmState.feeTier = pair.feeTiers[0]; dlmmState.binStep = pair.binSteps[0];
  const binsBelow = computeBinsBelow(m.volatility, MIN_SAFE_BINS_BELOW, 69);
  const rangePct = binsBelow / 69 * 0.15;
  dlmmState.rangeMin = parseFloat((rate * (1 - rangePct)).toFixed(8));
  dlmmState.rangeMax = parseFloat((rate * (1 + rangePct)).toFixed(8));
  dlmmState.numBins = binsBelow * 2;
  dlmmState.strategy = m.volatility >= 10 ? 'aggressive' : m.volatility >= 5 ? 'bid_ask' : m.volatility >= 2 ? 'curve' : 'spot';

  const panel = document.getElementById('right-panel');
  panel.innerHTML = `
    <div class="dlmm-header">
      <div class="dlmm-pair">${pair.base}/${pair.quote}</div>
      <div class="dlmm-price">${fmtRate(rate, pair)}</div>
      <div class="dlmm-change ${change>=0?'green':'red'}">${change>=0?'+':''}${change.toFixed(2)}% 24h</div>
      <div class="dlmm-score-badge">Degen: ${m.degen.toFixed(0)}/100 | Vol: ${m.volatility.toFixed(1)}</div>
    </div>

    ${renderChartSection(pair.id)}

    <!-- Pool Stats (Meteora Real Data) -->
    <div class="dlmm-section">
      <div class="section-label">📡 Live Pool Data · Meteora</div>
      <div id="pool-stats-container"></div>
    </div>

    <div class="dlmm-section">
      <div class="section-label">Fee Tier</div>
      <div class="btn-row" id="fee-tier-btns">${pair.feeTiers.map(f => `<button class="btn-sm ${f===dlmmState.feeTier?'sel':''}" onclick="setDlmmFee(${f})">${f}%</button>`).join('')}</div>
    </div>

    <div class="dlmm-section">
      <div class="section-label">Bin Step (basis points)</div>
      <div class="btn-row" id="bin-step-btns">${pair.binSteps.map(b => `<button class="btn-sm ${b===dlmmState.binStep?'sel':''}" onclick="setDlmmBin(${b})">${b} bps</button>`).join('')}</div>
    </div>

    <div class="dlmm-section">
      <div class="section-label">Strategy (Meridian Library)</div>
      <div class="btn-row" id="strat-btns">${Object.entries(STRATEGIES).map(([k,s]) => `<button class="btn-sm ${dlmmState.strategy===k?'sel':''}" onclick="setDlmmStrat('${k}')">${s.name}</button>`).join('')}</div>
      <div class="strat-hint" id="strat-hint">${STRATEGIES[dlmmState.strategy]?.description||''}</div>
      <div class="strat-best-for" id="strat-best-for">Best for: ${STRATEGIES[dlmmState.strategy]?.best_for||''}</div>
    </div>

    <div class="dlmm-section">
      <div class="section-label">Active Bins: <span id="bin-count-val">${dlmmState.numBins}</span> <span class="bin-hint">(vol: ${m.volatility.toFixed(1)} → binsBelow: ${binsBelow})</span></div>
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
        <div class="liq-input-group"><label>${pair.base}</label><input type="number" id="amount-base" placeholder="0.00" oninput="syncQuote(this.value)" min="0"><span class="bal-hint">Bal: ${fmtBal(STATE.balances[pair.base]||0, pair.base)}</span></div>
        <div class="liq-plus">+</div>
        <div class="liq-input-group"><label>${pair.quote}</label><input type="number" id="amount-quote" placeholder="0.00" oninput="syncBase(this.value)" min="0"><span class="bal-hint">Bal: ${fmtBal(STATE.balances[pair.quote]||0, pair.quote)}</span></div>
      </div>
      <div class="liq-usd-total" id="liq-usd-total">≈ $0.00</div>
      <button class="btn-primary full" onclick="addLiquidity()">${STATE.wallet ? 'Add Liquidity' : 'Connect Wallet First'}</button>
    </div>`;

  updateRangeInfo(); renderBinPreview();
  setTimeout(() => mountChart(pair.id), 100);
  renderPoolStats(pair.id, 'pool-stats-container');
}

function setDlmmFee(f) { dlmmState.feeTier = f; document.querySelectorAll('#fee-tier-btns .btn-sm').forEach(b=>b.classList.remove('sel')); event.target.classList.add('sel'); }
function setDlmmBin(b) { dlmmState.binStep = b; document.querySelectorAll('#bin-step-btns .btn-sm').forEach(b=>b.classList.remove('sel')); event.target.classList.add('sel'); renderBinPreview(); }
function setDlmmStrat(s) { dlmmState.strategy = s; document.querySelectorAll('#strat-btns .btn-sm').forEach(b=>b.classList.remove('sel')); event.target.classList.add('sel'); document.getElementById('strat-hint').textContent = STRATEGIES[s]?.description||''; document.getElementById('strat-best-for').textContent = 'Best for: '+(STRATEGIES[s]?.best_for||''); renderBinPreview(); }
function updateBinCount(v) { dlmmState.numBins = parseInt(v); document.getElementById('bin-count-val').textContent = v; renderBinPreview(); }
function updateRangeMin(v) { dlmmState.rangeMin = parseFloat(v)||0; updateRangeInfo(); renderBinPreview(); }
function updateRangeMax(v) { dlmmState.rangeMax = parseFloat(v)||0; updateRangeInfo(); renderBinPreview(); }
function updateRangeInfo() { const el = document.getElementById('range-width-info'); if (!el) return; const mid = (dlmmState.rangeMin+dlmmState.rangeMax)/2; el.textContent = `Range width: ${mid>0?((dlmmState.rangeMax-dlmmState.rangeMin)/mid*100).toFixed(1):0}%`; }

function renderBinPreview() {
  const el = document.getElementById('bin-preview'); if (!el) return;
  const n = dlmmState.numBins; const weights = getWeights(n, dlmmState.strategy); const max = Math.max(...weights); const activeIdx = Math.floor(n/2);
  el.innerHTML = weights.map((w,i) => { const h = Math.max((w/max)*100,4); const isActive = i===activeIdx; return `<div style="flex:1;height:${h}%;background:${isActive?'#f59e0b':'#22d3ee'};border-radius:2px 2px 0 0;opacity:${isActive?1:0.7}"></div>`; }).join('');
}

function getWeights(n, strategy) {
  const mid = (n-1)/2;
  if (strategy==='spot'||strategy==='conservative') return Array(n).fill(1);
  if (strategy==='curve'||strategy==='fee_compounding') return Array.from({length:n},(_,i)=>Math.max(0.05,1-Math.abs(i-mid)/mid));
  if (strategy==='bid_ask'||strategy==='single_sided_reseed') return Array.from({length:n},(_,i)=>0.1+Math.abs(i-mid)/mid);
  if (strategy==='aggressive') return Array.from({length:n},(_,i)=>0.02+Math.pow(Math.abs(i-mid)/mid,1.5));
  if (strategy==='partial_harvest') return Array.from({length:n},(_,i)=>0.3+0.7*Math.max(0,1-Math.abs(i-mid)/mid));
  return Array(n).fill(1);
}

function syncQuote(v) { const p=STATE.openPair; if(!p) return; const r=getPrice(p.base)/(getPrice(p.quote)||1); const q=document.getElementById('amount-quote'); if(q) q.value=isNaN(parseFloat(v)*r)?'':(parseFloat(v)*r).toFixed(6); updateLiqUSD(); }
function syncBase(v) { const p=STATE.openPair; if(!p) return; const r=getPrice(p.base)/(getPrice(p.quote)||1); const b=document.getElementById('amount-base'); if(b) b.value=isNaN(parseFloat(v)/r)?'':(parseFloat(v)/r).toFixed(6); updateLiqUSD(); }
function updateLiqUSD() { const p=STATE.openPair; if(!p) return; const b=parseFloat(document.getElementById('amount-base')?.value)||0; const q=parseFloat(document.getElementById('amount-quote')?.value)||0; const el=document.getElementById('liq-usd-total'); if(el) el.textContent=`≈ $${(b*getPrice(p.base)+q*getPrice(p.quote)).toFixed(2)}`; }

// ═══════════════════════════════════════════
// Add Liquidity
// ═══════════════════════════════════════════
function addLiquidity() {
  if (!STATE.wallet) { alert('Connect wallet dulu!'); return; }
  const pair = STATE.openPair;
  const baseAmt = parseFloat(document.getElementById('amount-base')?.value)||0;
  const quoteAmt = parseFloat(document.getElementById('amount-quote')?.value)||0;
  if (baseAmt<=0&&quoteAmt<=0) { alert('Masukkan jumlah token!'); return; }
  if ((STATE.balances[pair.base]||0)<baseAmt) { alert(`Balance ${pair.base} tidak cukup!`); return; }
  if ((STATE.balances[pair.quote]||0)<quoteAmt) { alert(`Balance ${pair.quote} tidak cukup!`); return; }
  STATE.balances[pair.base] -= baseAmt; STATE.balances[pair.quote] -= quoteAmt;
  const totalUSD = baseAmt*getPrice(pair.base) + quoteAmt*getPrice(pair.quote);
  const pos = {
    id: Date.now(), pairId: pair.id, pair, baseAmt, quoteAmt,
    entryPrice: getPrice(pair.base)/(getPrice(pair.quote)||1), totalUSD,
    feeTier: dlmmState.feeTier, binStep: dlmmState.binStep, strategy: dlmmState.strategy,
    rangeMin: dlmmState.rangeMin, rangeMax: dlmmState.rangeMax,
    feeCollected: 0, openedAt: Date.now(), swapCount: 0,
    feePeak: 0, outOfRangeSince: null, oorWarned: false, closeTriggered: false, edgeWarned: false,
    peakPnlPct: 0, trailingActive: false, pendingPeakPnlPct: 0, pendingPeakConfirmCount: 0, inRangeSeconds: 0,
  };
  STATE.positions.push(pos);
  logDecision('DEPLOY', pair.id, `Deploy ${pair.id} — ${dlmmState.strategy}, $${totalUSD.toFixed(0)}, fee ${dlmmState.feeTier}%`, { actor: 'SCREENER' });
  renderTokenList(); updateTotalBalance(); renderPositionList(); startFeeAccumulation(pos); saveState();
  startRealFeeTracking(STATE.positions, () => { renderPositionList(); updateTotalBalance(); });
  showToast(`✅ ${pair.id} dibuka! $${totalUSD.toFixed(2)} terdeploy.`); renderDLMMPanel();
}

// ═══════════════════════════════════════════
// Fee Accumulation + Rules Engine (3s)
// ═══════════════════════════════════════════
function startFeeAccumulation(position) {
  const interval = setInterval(() => {
    const pos = STATE.positions.find(p => p.id === position.id);
    if (!pos) { clearInterval(interval); return; }
    const cp = getPrice(pos.pair.base)/(getPrice(pos.pair.quote)||1);
    if (cp >= pos.rangeMin && cp <= pos.rangeMax) {
      pos.feeCollected += pos.baseAmt * 0.02 * getPrice(pos.pair.base) * (pos.feeTier / 100);
      pos.swapCount++;
    }
    rulesEngine(); renderPositionList(); updateTotalBalance();
  }, 3000);
}

// ═══════════════════════════════════════════
// Position List
// ═══════════════════════════════════════════
function renderPositionList() {
  const el = document.getElementById('position-list');
  if (!STATE.positions.length) { el.innerHTML = '<div class="empty-state">Belum ada posisi</div>'; return; }
  el.innerHTML = STATE.positions.map(pos => {
    const cp = getPrice(pos.pair.base)/(getPrice(pos.pair.quote)||1);
    const inRange = cp >= pos.rangeMin && cp <= pos.rangeMax;
    const entryVal = pos.baseAmt * pos.entryPrice + pos.quoteAmt;
    const pr = cp / pos.entryPrice;
    const lpVal = entryVal * 2 * Math.sqrt(pr) / (1 + pr);
    const holdVal = pos.baseAmt * getPrice(pos.pair.base) + pos.quoteAmt * getPrice(pos.pair.quote);
    const il = lpVal - holdVal;
    const netPnl = pos.feeCollected + il;
    const feePct = pos.totalUSD > 0 ? (pos.feeCollected / pos.totalUSD * 100) : 0;
    const ilPct = holdVal > 0 ? (il / holdVal * 100) : 0;
    const oorMin = pos.outOfRangeSince ? Math.floor((Date.now()-pos.outOfRangeSince)/60000) : 0;
    let badges = '';
    if (!inRange && oorMin > 0) badges += `<span class="badge-warn">OOR ${oorMin}m</span>`;
    if (ilPct < -30) badges += `<span class="badge-danger">IL ${ilPct.toFixed(0)}%</span>`;
    if (pos.trailingActive) badges += `<span class="badge-info">Trailing ${pos.peakPnlPct?.toFixed(1)}%</span>`;
    return `<div class="position-card">
      <div class="pos-header"><span class="pos-pair">${pos.pair.base}/${pos.pair.quote}</span><span class="pos-status ${inRange?'in-range':'out-range'}">${inRange?'● In Range':'○ Out'}</span></div>
      ${badges?`<div class="pos-badges">${badges}</div>`:''}
      <div class="pos-row"><span>Strategy</span><span>${pos.strategy}</span></div>
      <div class="pos-row">
        <span>Fee</span>
        <span class="green">+$${pos.feeCollected.toFixed(2)} (${feePct.toFixed(1)}%)
          ${pos.dataSource === 'meteora_real' ? '<span class="real-badge">REAL</span>' : '<span class="sim-badge">SIM</span>'}
        </span>
      </div>
      ${pos.realFeeData ? `
      <div class="pos-row sub"><span>Volume 24h pool</span><span>${typeof fmtVolume !== 'undefined' ? fmtVolume(pos.realFeeData.volume24h) : '$'+pos.realFeeData.volume24h.toFixed(0)}</span></div>
      <div class="pos-row sub"><span>Share lu di pool</span><span>${pos.realFeeData.luShare.toFixed(4)}%</span></div>
      <div class="pos-row sub"><span>Est. APR</span><span class="green">${pos.realFeeData.apr.toFixed(1)}%</span></div>
      ` : ''}
      <div class="pos-row"><span>IL</span><span class="${il>=0?'green':'red'}">${il>=0?'+':''}$${il.toFixed(2)}</span></div>
      <div class="pos-row pos-net"><span>Net PnL</span><span class="${netPnl>=0?'green':'red'}">${netPnl>=0?'+':''}$${netPnl.toFixed(2)}</span></div>
      <button class="btn-remove" onclick="removePosition(${pos.id})">Remove Position</button>
    </div>`;
  }).join('');
}

function removePosition(id) {
  const pos = STATE.positions.find(p => p.id === id); if (!pos) return;
  const cp = getPrice(pos.pair.base)/(getPrice(pos.pair.quote)||1);
  const entryVal = pos.baseAmt * pos.entryPrice + pos.quoteAmt;
  const pr = cp / pos.entryPrice;
  const lpVal = entryVal * 2 * Math.sqrt(pr) / (1 + pr);
  const holdVal = pos.baseAmt * getPrice(pos.pair.base) + pos.quoteAmt * getPrice(pos.pair.quote);
  recordPerformance(pos, 'manual');
  STATE.closedPositions.push({ ...pos, closedAt: Date.now(), closeReason: 'manual', finalFee: pos.feeCollected, finalIL: lpVal-holdVal, finalPnl: pos.feeCollected+(lpVal-holdVal), duration: Date.now()-pos.openedAt });
  logDecision('CLOSE', pos.pairId, `Manual close ${pos.pairId} — Fee: $${pos.feeCollected.toFixed(2)}`);
  STATE.balances[pos.pair.base] = (STATE.balances[pos.pair.base]||0) + pos.baseAmt;
  STATE.balances[pos.pair.quote] = (STATE.balances[pos.pair.quote]||0) + pos.quoteAmt + pos.feeCollected/getPrice(pos.pair.quote);
  STATE.positions = STATE.positions.filter(p => p.id !== id);
  renderTokenList(); updateTotalBalance(); renderPositionList(); saveState();
  showToast(`🔴 ${pos.pair.id} ditutup. Fee: +$${pos.feeCollected.toFixed(2)}`);
}

// ═══════════════════════════════════════════
// Analytics Dashboard
// ═══════════════════════════════════════════
function renderAnalytics() {
  const el = document.getElementById('pair-grid');
  const allClosed = STATE.closedPositions;
  const totalDeployed = [...STATE.positions,...allClosed].reduce((s,p)=>s+p.totalUSD,0);
  const totalFees = [...STATE.positions,...allClosed].reduce((s,p)=>s+(p.finalFee??p.feeCollected),0);
  const totalPnl = allClosed.reduce((s,p)=>s+(p.finalPnl||0),0);
  const activeValue = STATE.positions.reduce((s,p)=>s+p.totalUSD,0);
  const winCount = allClosed.filter(p=>(p.finalPnl||0)>0).length;
  const lossCount = allClosed.filter(p=>(p.finalPnl||0)<=0).length;
  const winRate = allClosed.length>0?(winCount/allClosed.length*100):0;
  const pairPnl = {}; allClosed.forEach(p=>{pairPnl[p.pairId]=(pairPnl[p.pairId]||0)+(p.finalPnl||0);});
  const sorted = Object.entries(pairPnl).sort((a,b)=>b[1]-a[1]);
  const reasons = {}; allClosed.forEach(p=>{reasons[p.closeReason]=(reasons[p.closeReason]||0)+1;});

  el.innerHTML = `<div class="analytics-container">
    <h2 class="analytics-title">📊 Analytics Dashboard</h2>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Deployed</div><div class="stat-value">$${totalDeployed.toFixed(0)}</div></div>
      <div class="stat-card"><div class="stat-label">Active</div><div class="stat-value accent">$${activeValue.toFixed(0)}</div></div>
      <div class="stat-card"><div class="stat-label">Fees</div><div class="stat-value green">+$${totalFees.toFixed(2)}</div></div>
      <div class="stat-card"><div class="stat-label">PnL</div><div class="stat-value ${totalPnl>=0?'green':'red'}">${totalPnl>=0?'+':''}$${totalPnl.toFixed(2)}</div></div>
      <div class="stat-card"><div class="stat-label">Win Rate</div><div class="stat-value">${winRate.toFixed(0)}%</div><div class="stat-sub">${winCount}W/${lossCount}L</div></div>
      <div class="stat-card"><div class="stat-label">Positions</div><div class="stat-value">${STATE.positions.length}</div></div>
    </div>
    <div class="chart-section"><div class="section-label">PnL per Position</div>
      <div class="pnl-chart">${allClosed.length?allClosed.map(p=>{const max=Math.max(...allClosed.map(x=>Math.abs(x.finalPnl||0)),1);const h=Math.max(Math.abs(p.finalPnl||0)/max*80,4);return`<div class="chart-bar-wrapper"><div class="chart-bar" style="height:${h}px;background:${(p.finalPnl||0)>=0?'#4ade80':'#f87171'}"></div><div class="chart-label">${p.pair.base}</div><div class="chart-val ${(p.finalPnl||0)>=0?'green':'red'}">${(p.finalPnl||0)>=0?'+':''}$${(p.finalPnl||0).toFixed(1)}</div></div>`;}).join(''):'<div class="empty-state">Belum ada posisi ditutup</div>'}</div>
    </div>
    <div class="ranking-section"><div class="section-label">Pair Rankings</div>
      <div class="ranking-grid">
        <div class="rank-card best"><div class="rank-label">🏆 Best</div><div class="rank-pair">${sorted[0]?sorted[0][0]:'—'}</div><div class="rank-pnl green">${sorted[0]?'+$'+sorted[0][1].toFixed(2):''}</div></div>
        <div class="rank-card worst"><div class="rank-label">💀 Worst</div><div class="rank-pair">${sorted.length>1?sorted[sorted.length-1][0]:'—'}</div><div class="rank-pnl red">${sorted.length>1?'$'+sorted[sorted.length-1][1].toFixed(2):''}</div></div>
      </div>
    </div>
    <div class="lessons-section"><div class="section-label">📚 Darwin Lessons</div>
      <div class="lessons-grid">${STATE.lessons.length?STATE.lessons.slice(0,10).map(l=>`<div class="lesson-item lesson-${l.outcome}"><span class="lesson-outcome">${{good:'✅',poor:'⚠️',bad:'❌',neutral:'➖'}[l.outcome]}</span><span class="lesson-text">${l.lesson}</span></div>`).join(''):'<div class="empty-state">Belum ada pelajaran</div>'}</div>
    </div>
    <div class="rules-section"><div class="section-label">⚙️ Rules Engine</div>
      <div class="rules-grid">
        <div class="rule-item"><label>Stop Loss (%)</label><input type="number" value="${RULES.stopLossPct}" onchange="RULES.stopLossPct=parseFloat(this.value)" class="rule-input"></div>
        <div class="rule-item"><label>Take Profit (%)</label><input type="number" value="${RULES.takeProfitPct}" onchange="RULES.takeProfitPct=parseFloat(this.value)" class="rule-input"></div>
        <div class="rule-item"><label>Trailing TP</label><label class="toggle"><input type="checkbox" ${RULES.trailingEnabled?'checked':''} onchange="RULES.trailingEnabled=this.checked"><span class="toggle-slider"></span></label></div>
        <div class="rule-item"><label>OOR Timeout (min)</label><input type="number" value="${RULES.outOfRangeWaitMinutes}" onchange="RULES.outOfRangeWaitMinutes=parseFloat(this.value)" class="rule-input"></div>
      </div>
      <div class="rules-toggle-row"><label class="toggle"><input type="checkbox" ${RULES.enabled?'checked':''} onchange="RULES.enabled=this.checked"><span class="toggle-slider"></span></label><span>Rules ${RULES.enabled?'ACTIVE':'DISABLED'}</span></div>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════
// Toast & Helpers
// ═══════════════════════════════════════════
function showToast(msg) { let t=document.getElementById('toast'); if(!t){t=document.createElement('div');t.id='toast';document.body.appendChild(t);} t.textContent=msg; t.className='toast show'; setTimeout(()=>t.className='toast',3000); }
function fmt(n) { if(n>=1e6) return(n/1e6).toFixed(1)+'M'; if(n>=1e3) return(n/1e3).toFixed(1)+'K'; return n.toString(); }
function fmtBal(n,sym) { if(!n) return'0'; if(n>=1e6) return(n/1e6).toFixed(2)+'M '+sym; if(n>=1e3) return(n/1e3).toFixed(2)+'K '+sym; if(n<0.0001) return n.toExponential(2)+' '+sym; return n.toFixed(4)+' '+sym; }
function fmtRate(rate) { if(!rate) return'—'; if(rate<0.000001) return rate.toExponential(4); if(rate<0.01) return rate.toFixed(8); if(rate<1) return rate.toFixed(6); return rate.toFixed(4); }

// ═══════════════════════════════════════════
// Init
// ═══════════════════════════════════════════
fetchPrices(); renderDecisionLog(); setInterval(fetchPrices, 30000);

(async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const gistParam = urlParams.get('gist');
  if (gistParam) { setGistToken(gistParam); window.history.replaceState({}, '', window.location.pathname); }
  const source = await loadState();
  const statusEl = document.getElementById('persist-status');
  if (source === 'cloud') { if (statusEl) { statusEl.textContent = '☁️ Cloud'; statusEl.style.color = '#4ade80'; } }
  else if (source === 'local') { if (statusEl) { statusEl.textContent = '💾 Local'; statusEl.style.color = '#f59e0b'; } }
  else { if (statusEl) { statusEl.textContent = '🆕 Fresh'; statusEl.style.color = '#8b949e'; } }
})();
