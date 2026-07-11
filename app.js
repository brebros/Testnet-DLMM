// ═══════════════════════════════════════════
// DLMM TESTNET SIMULATOR v2 — app.js
// Meridian-inspired: rules engine, screening,
// decision log, analytics, enhanced strategies
// ═══════════════════════════════════════════

// ── State global ──
const STATE = {
  wallet: null,
  balances: {},
  positions: [],
  prices: {},
  priceHistory: {},  // track price over time for volatility
  selectedPair: null,
  openPair: null,
  filter: 'all',
  search: '',
  sortBy: 'score',   // name | price | change | score
  lastFaucet: null,
  feeSimInterval: null,
  decisionLog: [],   // decision log ala Meridian
  closedPositions: [], // history for analytics
  currentView: 'pairs', // pairs | analytics
};

// ── Rules Config (user-adjustable) ──
const RULES = {
  stopLossPct: -50,        // auto-close kalau IL < -50%
  takeProfitPct: 10,       // auto-close kalau fee > 10% deployed
  trailingEnabled: true,
  trailingTriggerPct: 5,   // trailing TP mulai di 5% fee
  trailingDropPct: 2,      // close kalau fee turun 2% dari peak
  outOfRangeMinutes: 60,   // auto-close kalau out of range > 60 min
  outOfRangeWarnMin: 15,   // warning setelah 15 min
  enabled: true,
};

// ── Decision Log ──
function logDecision(type, pairId, message, details = {}) {
  const entry = {
    time: new Date(),
    type, // DEPLOY | CLOSE | REBALANCE | WARNING | SCREEN | TP_HIT | SL_HIT | OOR
    pairId,
    message,
    ...details,
  };
  STATE.decisionLog.unshift(entry);
  if (STATE.decisionLog.length > 200) STATE.decisionLog.pop();
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
    const time = d.time.toLocaleTimeString('id-ID', {hour:'2-digit',minute:'2-digit'});
    const icon = {DEPLOY:'🟢',CLOSE:'🔴',REBALANCE:'🔄',WARNING:'⚠️',SCREEN:'🔍',TP_HIT:'💰',SL_HIT:'🛑',OOR:'📍'}[d.type] || '📌';
    return `<div class="log-entry log-${d.type.toLowerCase()}">
      <span class="log-time">${time}</span>
      <span class="log-icon">${icon}</span>
      <span class="log-msg">${d.message}</span>
    </div>`;
  }).join('');
}

// ── Rules Engine ──
function rulesEngine() {
  if (!RULES.enabled || !STATE.positions.length) return;

  STATE.positions.forEach(pos => {
    const currentPrice = getPrice(pos.pair.base) / (getPrice(pos.pair.quote) || 1);
    const inRange = currentPrice >= pos.rangeMin && currentPrice <= pos.rangeMax;

    // Track out-of-range duration
    if (!inRange) {
      if (!pos.outOfRangeSince) pos.outOfRangeSince = Date.now();
      const oorMinutes = (Date.now() - pos.outOfRangeSince) / 60000;

      if (oorMinutes >= RULES.outOfRangeMinutes && !pos.oorClosed) {
        pos.oorClosed = true;
        logDecision('OOR', pos.pairId, `${pos.pairId} out of range ${Math.floor(oorMinutes)}m → auto-close`, { positionId: pos.id });
        autoClosePosition(pos.id, 'out-of-range timeout');
        return;
      }
      if (oorMinutes >= RULES.outOfRangeWarnMin && !pos.oorWarned) {
        pos.oorWarned = true;
        logDecision('WARNING', pos.pairId, `${pos.pairId} out of range ${Math.floor(oorMinutes)}m — perhatikan!`, { positionId: pos.id });
      }
    } else {
      pos.outOfRangeSince = null;
      pos.oorWarned = false;
    }

    // IL check
    const k = (pos.baseAmt / 2) * (pos.quoteAmt / 2);
    const holdVal = pos.baseAmt * getPrice(pos.pair.base) + pos.quoteAmt * getPrice(pos.pair.quote);
    const lpBase = Math.sqrt(k * currentPrice);
    const lpQuote = Math.sqrt(k / currentPrice);
    const lpVal = lpBase * getPrice(pos.pair.base) + lpQuote * getPrice(pos.pair.quote);
    const ilPct = holdVal > 0 ? ((lpVal - holdVal) / holdVal * 100) : 0;

    // Stop Loss
    if (ilPct <= RULES.stopLossPct && !pos.slHit) {
      pos.slHit = true;
      logDecision('SL_HIT', pos.pairId, `${pos.pairId} SL hit! IL ${ilPct.toFixed(1)}% → auto-close`, { positionId: pos.id });
      autoClosePosition(pos.id, 'stop loss');
      return;
    }

    // Take Profit
    const feePct = pos.totalUSD > 0 ? (pos.feeCollected / pos.totalUSD * 100) : 0;
    if (feePct >= RULES.takeProfitPct && !pos.tpHit && !RULES.trailingEnabled) {
      pos.tpHit = true;
      logDecision('TP_HIT', pos.pairId, `${pos.pairId} TP hit! Fee ${feePct.toFixed(1)}% → auto-close`, { positionId: pos.id });
      autoClosePosition(pos.id, 'take profit');
      return;
    }

    // Trailing Take Profit
    if (RULES.trailingEnabled) {
      if (feePct >= RULES.trailingTriggerPct) {
        if (!pos.feePeak) pos.feePeak = feePct;
        pos.feePeak = Math.max(pos.feePeak, feePct);
        const dropFromPeak = pos.feePeak - feePct;

        if (dropFromPeak >= RULES.trailingDropPct && pos.feePeak > RULES.trailingTriggerPct) {
          pos.tpHit = true;
          logDecision('TP_HIT', pos.pairId, `${pos.pairId} Trailing TP! Peak ${pos.feePeak.toFixed(1)}% → drop ${dropFromPeak.toFixed(1)}% → close`, { positionId: pos.id });
          autoClosePosition(pos.id, 'trailing take profit');
          return;
        }
      }
    }

    // Rebalance warning — price near range edge
    const rangeWidth = pos.rangeMax - pos.rangeMin;
    const distToMin = currentPrice - pos.rangeMin;
    const distToMax = pos.rangeMax - currentPrice;
    const edgeThreshold = rangeWidth * 0.1; // 10% dari range
    if ((distToMin < edgeThreshold || distToMax < edgeThreshold) && inRange && !pos.edgeWarned) {
      pos.edgeWarned = true;
      logDecision('REBALANCE', pos.pairId, `${pos.pairId} harga mendekati edge range — pertimbangkan rebalance!`, { positionId: pos.id });
    }
    if (distToMin >= edgeThreshold && distToMax >= edgeThreshold) {
      pos.edgeWarned = false;
    }
  });
}

function autoClosePosition(id, reason) {
  const pos = STATE.positions.find(p => p.id === id);
  if (!pos) return;

  // Return tokens
  STATE.balances[pos.pair.base] = (STATE.balances[pos.pair.base] || 0) + pos.baseAmt;
  STATE.balances[pos.pair.quote] = (STATE.balances[pos.pair.quote] || 0) + pos.quoteAmt + pos.feeCollected / getPrice(pos.pair.quote);

  // Save to closed history
  const currentPrice = getPrice(pos.pair.base) / (getPrice(pos.pair.quote) || 1);
  const k = (pos.baseAmt / 2) * (pos.quoteAmt / 2);
  const holdVal = pos.baseAmt * getPrice(pos.pair.base) + pos.quoteAmt * getPrice(pos.pair.quote);
  const lpBase = Math.sqrt(k * currentPrice);
  const lpQuote = Math.sqrt(k / currentPrice);
  const lpVal = lpBase * getPrice(pos.pair.base) + lpQuote * getPrice(pos.pair.quote);

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
}

// ── Smart Screening ──
function scorePair(pair) {
  const change = Math.abs(STATE.prices[pair.base]?.change24h || 0);
  const basePrice = getPrice(pair.base);
  const quotePrice = getPrice(pair.quote);
  if (!basePrice || !quotePrice) return 0;

  // Volatility score (0-40) — higher change = higher score
  const volScore = Math.min(change * 4, 40);

  // Fee efficiency (0-30) — higher fee tier = higher potential earnings
  const maxFee = Math.max(...pair.feeTiers);
  const feeScore = Math.min(maxFee * 15, 30);

  // Type bonus (0-20) — volatile pairs get bonus
  const typeScore = pair.type === 'volatile' ? 20 : 5;

  // Bin step diversity (0-10) — more options = more flexibility
  const binScore = Math.min(pair.binSteps.length * 3, 10);

  return Math.round(volScore + feeScore + typeScore + binScore);
}

function sortPairs(pairs) {
  const sorted = [...pairs];
  switch (STATE.sortBy) {
    case 'score':
      return sorted.sort((a, b) => scorePair(b) - scorePair(a));
    case 'change':
      return sorted.sort((a, b) => Math.abs(STATE.prices[b.base]?.change24h || 0) - Math.abs(STATE.prices[a.base]?.change24h || 0));
    case 'price':
      return sorted.sort((a, b) => (getPrice(b.base) / (getPrice(b.quote) || 1)) - (getPrice(a.base) / (getPrice(a.quote) || 1)));
    case 'name':
    default:
      return sorted.sort((a, b) => a.id.localeCompare(b.id));
  }
}

// ── CoinGecko price fetch ──
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
        // Track price history for volatility
        if (!STATE.priceHistory[sym]) STATE.priceHistory[sym] = [];
        STATE.priceHistory[sym].push({ t: Date.now(), p: newPrice });
        if (STATE.priceHistory[sym].length > 100) STATE.priceHistory[sym].shift();

        STATE.prices[sym] = {
          usd: newPrice,
          change24h: data[token.id].usd_24h_change || 0,
        };
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

function getPrice(sym) {
  return STATE.prices[sym]?.usd || 0;
}

function updateSolTicker() {
  const p = getPrice('SOL');
  const c = STATE.prices['SOL']?.change24h || 0;
  const el = document.getElementById('sol-ticker');
  el.textContent = `SOL $${p.toFixed(2)}`;
  el.style.color = c >= 0 ? '#4ade80' : '#f87171';
}

// ── Wallet ──
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
}

function disconnectWallet() {
  STATE.wallet = null;
  STATE.balances = {};
  STATE.positions = [];
  STATE.decisionLog = [];
  STATE.closedPositions = [];
  document.getElementById('wallet-addr').textContent = 'Not connected';
  document.getElementById('connect-btn').textContent = 'Connect Wallet';
  document.getElementById('connect-btn').onclick = () => document.getElementById('wallet-modal').style.display = 'flex';
  document.getElementById('faucet-btn').disabled = true;
  renderTokenList();
  renderPositionList();
  renderDecisionLog();
  updateTotalBalance();
}

document.getElementById('connect-btn').onclick = () => {
  document.getElementById('wallet-modal').style.display = 'flex';
};
document.getElementById('gen-wallet-btn').onclick = () => connectWallet(generateAddress());
document.getElementById('use-custom-btn').onclick = () => {
  const v = document.getElementById('custom-addr').value.trim();
  if (v.length > 10) connectWallet(v);
};
document.getElementById('close-modal-btn').onclick = () => {
  document.getElementById('wallet-modal').style.display = 'none';
};

// ── Faucet ──
document.getElementById('faucet-btn').onclick = openFaucet;

function openFaucet() {
  const grid = document.getElementById('faucet-grid');
  const now = Date.now();
  const canClaim = !STATE.lastFaucet || now - STATE.lastFaucet > 86400000;
  grid.innerHTML = Object.entries(FAUCET_AMOUNTS).map(([sym, amt]) => `
    <div class="faucet-item">
      <span class="faucet-sym">${sym}</span>
      <span class="faucet-amt">${fmt(amt)}</span>
    </div>
  `).join('');
  document.getElementById('claim-all-btn').disabled = !canClaim;
  document.getElementById('claim-all-btn').textContent = canClaim
    ? 'Claim All Tokens'
    : `Claim lagi dalam ${timeUntilFaucet()}`;
  document.getElementById('faucet-modal').style.display = 'flex';
}

function timeUntilFaucet() {
  const diff = 86400000 - (Date.now() - STATE.lastFaucet);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${h}j ${m}m`;
}

document.getElementById('claim-all-btn').onclick = () => {
  Object.entries(FAUCET_AMOUNTS).forEach(([sym, amt]) => {
    STATE.balances[sym] = (STATE.balances[sym] || 0) + amt;
  });
  STATE.lastFaucet = Date.now();
  renderTokenList();
  updateTotalBalance();
  document.getElementById('faucet-modal').style.display = 'none';
  showToast('🚰 Semua token berhasil di-claim!');
};
document.getElementById('close-faucet-btn').onclick = () => {
  document.getElementById('faucet-modal').style.display = 'none';
};

// ── Render Token List ──
function renderTokenList() {
  const el = document.getElementById('token-list');
  if (!STATE.wallet) { el.innerHTML = '<div class="empty-state">Connect wallet dulu</div>'; return; }
  const tokens = Object.keys(STATE.balances).filter(s => STATE.balances[s] > 0);
  if (!tokens.length) {
    el.innerHTML = '<div class="empty-state">Claim faucet dulu 🚰</div>'; return;
  }
  el.innerHTML = tokens.map(sym => {
    const bal = STATE.balances[sym];
    const price = getPrice(sym);
    const usd = bal * price;
    return `
      <div class="token-row">
        <div class="token-sym">${sym}</div>
        <div class="token-bal">
          <div>${fmtBal(bal, sym)}</div>
          <div class="token-usd">$${usd.toFixed(2)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function updateTotalBalance() {
  const tokenTotal = Object.entries(STATE.balances).reduce((sum, [sym, bal]) => {
    return sum + bal * getPrice(sym);
  }, 0);
  const posTotal = STATE.positions.reduce((sum, pos) => sum + pos.totalUSD + pos.feeCollected, 0);
  const total = tokenTotal + posTotal;
  document.getElementById('total-usd').textContent = '$' + total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── View Switching ──
function switchView(view) {
  STATE.currentView = view;
  document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  renderCurrentView();
}

function renderCurrentView() {
  if (STATE.currentView === 'analytics') {
    renderAnalytics();
  } else {
    renderPairGrid();
  }
}

// ── Pair Grid ──
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
    const score = scorePair(pair);
    const scoreColor = score >= 70 ? 'high' : score >= 40 ? 'mid' : 'low';
    return `
      <div class="pair-card ${isSelected ? 'selected' : ''} ${pair.type}" onclick="selectPair('${pair.id}')">
        <div class="pair-top-row">
          <div class="pair-name">${pair.base}/${pair.quote}</div>
          <div class="pair-score ${scoreColor}">${score}</div>
        </div>
        <div class="pair-price">${fmtRate(rate, pair)}</div>
        <div class="pair-change ${changeColor}">${changeStr}</div>
        <div class="pair-type-badge ${pair.type}">${pair.type}</div>
      </div>
    `;
  }).join('');
}

function filterPairs(type) {
  STATE.filter = type;
  document.querySelectorAll('.pair-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  renderCurrentView();
}

function sortPairsBy(sort) {
  STATE.sortBy = sort;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  renderCurrentView();
}

function searchPairs(val) {
  STATE.search = val;
  renderCurrentView();
}

// ── Select Pair → Open DLMM Interface ──
function selectPair(pairId) {
  STATE.openPair = PAIRS.find(p => p.id === pairId);
  renderPairGrid();
  renderDLMMPanel();
}

// ── DLMM Panel ──
let dlmmState = {
  feeTier: null,
  binStep: null,
  strategy: 'spot',
  rangeMin: 0,
  rangeMax: 0,
  numBins: 20,
};

function renderDLMMPanel() {
  const pair = STATE.openPair;
  if (!pair) return;
  const basePrice = getPrice(pair.base);
  const quotePrice = getPrice(pair.quote);
  const rate = quotePrice > 0 ? basePrice / quotePrice : 1;
  const change = STATE.prices[pair.base]?.change24h || 0;
  const score = scorePair(pair);

  dlmmState.feeTier = pair.feeTiers[0];
  dlmmState.binStep = pair.binSteps[0];
  dlmmState.rangeMin = parseFloat((rate * 0.85).toFixed(6));
  dlmmState.rangeMax = parseFloat((rate * 1.15).toFixed(6));

  const panel = document.getElementById('right-panel');
  panel.innerHTML = `
    <div class="dlmm-header">
      <div class="dlmm-pair">${pair.base}/${pair.quote}</div>
      <div class="dlmm-price">${fmtRate(rate, pair)}</div>
      <div class="dlmm-change ${change >= 0 ? 'green' : 'red'}">${change >= 0 ? '+' : ''}${change.toFixed(2)}% 24h</div>
      <div class="dlmm-score-badge">Score: ${score}/100</div>
    </div>

    ${getChartHTML(pair.id)}

    <!-- Fee Tier -->
    <div class="dlmm-section">
      <div class="section-label">Fee Tier</div>
      <div class="btn-row" id="fee-tier-btns">
        ${pair.feeTiers.map(f => `
          <button class="btn-sm ${f === dlmmState.feeTier ? 'sel' : ''}" onclick="setDlmmFee(${f})">${f}%</button>
        `).join('')}
      </div>
    </div>

    <!-- Bin Step -->
    <div class="dlmm-section">
      <div class="section-label">Bin Step (basis points)</div>
      <div class="btn-row" id="bin-step-btns">
        ${pair.binSteps.map(b => `
          <button class="btn-sm ${b === dlmmState.binStep ? 'sel' : ''}" onclick="setDlmmBin(${b})">${b} bps</button>
        `).join('')}
      </div>
    </div>

    <!-- Strategy -->
    <div class="dlmm-section">
      <div class="section-label">Strategy</div>
      <div class="btn-row" id="strat-btns">
        <button class="btn-sm ${dlmmState.strategy === 'spot' ? 'sel' : ''}" onclick="setDlmmStrat('spot')">Spot</button>
        <button class="btn-sm ${dlmmState.strategy === 'curve' ? 'sel' : ''}" onclick="setDlmmStrat('curve')">Curve</button>
        <button class="btn-sm ${dlmmState.strategy === 'bidask' ? 'sel' : ''}" onclick="setDlmmStrat('bidask')">Bid-Ask</button>
        <button class="btn-sm ${dlmmState.strategy === 'aggressive' ? 'sel' : ''}" onclick="setDlmmStrat('aggressive')">Aggressive</button>
        <button class="btn-sm ${dlmmState.strategy === 'conservative' ? 'sel' : ''}" onclick="setDlmmStrat('conservative')">Safe</button>
      </div>
      <div class="strat-hint" id="strat-hint">${stratHint(dlmmState.strategy)}</div>
    </div>

    <!-- Bin Count Slider -->
    <div class="dlmm-section">
      <div class="section-label">Active Bins: <span id="bin-count-val">${dlmmState.numBins}</span></div>
      <input type="range" id="bin-slider" min="5" max="50" value="${dlmmState.numBins}" oninput="updateBinCount(this.value)" class="range-slider">
    </div>

    <!-- Price Range -->
    <div class="dlmm-section">
      <div class="section-label">Price Range</div>
      <div class="range-inputs">
        <div class="range-input-group">
          <label>Min Price</label>
          <input type="number" id="range-min" value="${dlmmState.rangeMin}" step="any" oninput="updateRangeMin(this.value)">
        </div>
        <div class="range-divider">↔</div>
        <div class="range-input-group">
          <label>Max Price</label>
          <input type="number" id="range-max" value="${dlmmState.rangeMax}" step="any" oninput="updateRangeMax(this.value)">
        </div>
      </div>
      <div class="range-width-info" id="range-width-info"></div>
    </div>

    <!-- Bin Visualizer -->
    <div class="dlmm-section">
      <div class="section-label">Bin Distribution Preview</div>
      <div id="bin-preview" class="bin-preview"></div>
    </div>

    <!-- Add Liquidity -->
    <div class="dlmm-section">
      <div class="section-label">Add Liquidity</div>
      <div class="liq-inputs">
        <div class="liq-input-group">
          <label>${pair.base}</label>
          <input type="number" id="amount-base" placeholder="0.00" oninput="syncQuote(this.value)" min="0">
          <span class="bal-hint" id="bal-base">Balance: ${fmtBal(STATE.balances[pair.base] || 0, pair.base)}</span>
        </div>
        <div class="liq-plus">+</div>
        <div class="liq-input-group">
          <label>${pair.quote}</label>
          <input type="number" id="amount-quote" placeholder="0.00" oninput="syncBase(this.value)" min="0">
          <span class="bal-hint" id="bal-quote">Balance: ${fmtBal(STATE.balances[pair.quote] || 0, pair.quote)}</span>
        </div>
      </div>
      <div class="liq-usd-total" id="liq-usd-total">≈ $0.00</div>
      <button class="btn-primary full" id="add-liq-btn" onclick="addLiquidity()">
        ${STATE.wallet ? 'Add Liquidity' : 'Connect Wallet First'}
      </button>
    </div>
  `;

  updateRangeInfo();
  renderBinPreview();
  // Render TradingView chart
  setTimeout(() => renderChart('chart-container', pair.id, currentTimeframe), 100);
}

function stratHint(s) {
  return {
    spot: 'Nyebar rata — cocok kalau ga yakin arah harga',
    curve: 'Numpuk di tengah — maksimal fee saat sideways',
    bidask: 'Numpuk di pinggir — cocok saat yakin volatile',
    aggressive: 'Extreme di pinggir — max fee kalau harga bolak-balik',
    conservative: 'Range lebar, distribusi aman — minim IL'
  }[s];
}

function setDlmmFee(f) {
  dlmmState.feeTier = f;
  document.querySelectorAll('#fee-tier-btns .btn-sm').forEach(b => b.classList.remove('sel'));
  event.target.classList.add('sel');
}
function setDlmmBin(b) {
  dlmmState.binStep = b;
  document.querySelectorAll('#bin-step-btns .btn-sm').forEach(btn => btn.classList.remove('sel'));
  event.target.classList.add('sel');
  renderBinPreview();
}
function setDlmmStrat(s) {
  dlmmState.strategy = s;
  document.querySelectorAll('#strat-btns .btn-sm').forEach(b => b.classList.remove('sel'));
  event.target.classList.add('sel');
  document.getElementById('strat-hint').textContent = stratHint(s);
  renderBinPreview();
}
function updateBinCount(v) {
  dlmmState.numBins = parseInt(v);
  document.getElementById('bin-count-val').textContent = v;
  renderBinPreview();
}
function updateRangeMin(v) { dlmmState.rangeMin = parseFloat(v) || 0; updateRangeInfo(); renderBinPreview(); }
function updateRangeMax(v) { dlmmState.rangeMax = parseFloat(v) || 0; updateRangeInfo(); renderBinPreview(); }

function updateRangeInfo() {
  const el = document.getElementById('range-width-info');
  if (!el) return;
  const mid = (dlmmState.rangeMin + dlmmState.rangeMax) / 2;
  const width = mid > 0 ? ((dlmmState.rangeMax - dlmmState.rangeMin) / mid * 100).toFixed(1) : 0;
  el.textContent = `Range width: ${width}% dari harga tengah`;
}

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
    const color = isActive ? '#f59e0b' : '#22d3ee';
    return `<div style="flex:1;height:${h}%;background:${color};border-radius:2px 2px 0 0;opacity:${isActive ? 1 : 0.7}" title="Bin ${i}"></div>`;
  }).join('');
}

function getWeights(n, strategy) {
  const mid = (n - 1) / 2;
  if (strategy === 'spot') return Array(n).fill(1);
  if (strategy === 'curve') return Array.from({ length: n }, (_, i) => Math.max(0.05, 1 - Math.abs(i - mid) / mid));
  if (strategy === 'bidask') return Array.from({ length: n }, (_, i) => 0.1 + Math.abs(i - mid) / mid);
  if (strategy === 'aggressive') return Array.from({ length: n }, (_, i) => 0.02 + Math.pow(Math.abs(i - mid) / mid, 1.5));
  if (strategy === 'conservative') return Array.from({ length: n }, () => 0.5 + Math.random() * 0.5);
  return Array(n).fill(1);
}

function syncQuote(baseVal) {
  const pair = STATE.openPair;
  if (!pair) return;
  const rate = getPrice(pair.base) / (getPrice(pair.quote) || 1);
  const quoteVal = parseFloat(baseVal) * rate;
  const qEl = document.getElementById('amount-quote');
  if (qEl) qEl.value = isNaN(quoteVal) ? '' : quoteVal.toFixed(6);
  updateLiqUSD();
}
function syncBase(quoteVal) {
  const pair = STATE.openPair;
  if (!pair) return;
  const rate = getPrice(pair.base) / (getPrice(pair.quote) || 1);
  const baseVal = parseFloat(quoteVal) / rate;
  const bEl = document.getElementById('amount-base');
  if (bEl) bEl.value = isNaN(baseVal) ? '' : baseVal.toFixed(6);
  updateLiqUSD();
}
function updateLiqUSD() {
  const pair = STATE.openPair;
  if (!pair) return;
  const b = parseFloat(document.getElementById('amount-base')?.value) || 0;
  const q = parseFloat(document.getElementById('amount-quote')?.value) || 0;
  const usd = b * getPrice(pair.base) + q * getPrice(pair.quote);
  const el = document.getElementById('liq-usd-total');
  if (el) el.textContent = `≈ $${usd.toFixed(2)}`;
}

// ── Add Liquidity → Open Position ──
function addLiquidity() {
  if (!STATE.wallet) { alert('Connect wallet dulu!'); return; }
  const pair = STATE.openPair;
  const baseAmt = parseFloat(document.getElementById('amount-base')?.value) || 0;
  const quoteAmt = parseFloat(document.getElementById('amount-quote')?.value) || 0;
  if (baseAmt <= 0 && quoteAmt <= 0) { alert('Masukkan jumlah token!'); return; }
  if ((STATE.balances[pair.base] || 0) < baseAmt) { alert(`Balance ${pair.base} tidak cukup. Claim faucet dulu!`); return; }
  if ((STATE.balances[pair.quote] || 0) < quoteAmt) { alert(`Balance ${pair.quote} tidak cukup. Claim faucet dulu!`); return; }

  STATE.balances[pair.base] = (STATE.balances[pair.base] || 0) - baseAmt;
  STATE.balances[pair.quote] = (STATE.balances[pair.quote] || 0) - quoteAmt;

  const entryPrice = getPrice(pair.base) / (getPrice(pair.quote) || 1);
  const totalUSD = baseAmt * getPrice(pair.base) + quoteAmt * getPrice(pair.quote);

  const position = {
    id: Date.now(),
    pairId: pair.id,
    pair,
    baseAmt,
    quoteAmt,
    entryPrice,
    totalUSD,
    feeTier: dlmmState.feeTier,
    binStep: dlmmState.binStep,
    strategy: dlmmState.strategy,
    rangeMin: dlmmState.rangeMin,
    rangeMax: dlmmState.rangeMax,
    feeCollected: 0,
    openedAt: Date.now(),
    swapCount: 0,
    feePeak: 0,
    outOfRangeSince: null,
    oorWarned: false,
    oorClosed: false,
    slHit: false,
    tpHit: false,
    edgeWarned: false,
  };

  STATE.positions.push(position);
  logDecision('DEPLOY', pair.id, `Deploy ${pair.id} — ${dlmmState.strategy}, $${totalUSD.toFixed(2)}, fee ${dlmmState.feeTier}%`, { positionId: position.id });

  renderTokenList();
  updateTotalBalance();
  renderPositionList();
  startFeeAccumulation(position);
  showToast(`✅ Posisi ${pair.id} dibuka! $${totalUSD.toFixed(2)} terdeploy.`);
  renderDLMMPanel();
}

// ── Fee Accumulation (real-time sim) + Rules Engine ──
function startFeeAccumulation(position) {
  const interval = setInterval(() => {
    const pos = STATE.positions.find(p => p.id === position.id);
    if (!pos) { clearInterval(interval); return; }

    const currentPrice = getPrice(pos.pair.base) / (getPrice(pos.pair.quote) || 1);
    const inRange = currentPrice >= pos.rangeMin && currentPrice <= pos.rangeMax;

    if (inRange) {
      const baseVol = pos.baseAmt * 0.02;
      const feePerTick = baseVol * getPrice(pos.pair.base) * (pos.feeTier / 100);
      pos.feeCollected += feePerTick;
      pos.swapCount++;
    }

    // Run rules engine
    rulesEngine();

    renderPositionList();
    updateTotalBalance();
    if (STATE.currentView === 'analytics') renderAnalytics();
  }, 5000);
}

// ── Position List ──
function renderPositionList() {
  const el = document.getElementById('position-list');
  if (!STATE.positions.length) {
    el.innerHTML = '<div class="empty-state">Belum ada posisi</div>'; return;
  }
  el.innerHTML = STATE.positions.map(pos => {
    const currentPrice = getPrice(pos.pair.base) / (getPrice(pos.pair.quote) || 1);
    const inRange = currentPrice >= pos.rangeMin && currentPrice <= pos.rangeMax;

    // IL calc
    const k = (pos.baseAmt / 2) * (pos.quoteAmt / 2);
    const holdVal = pos.baseAmt * getPrice(pos.pair.base) + pos.quoteAmt * getPrice(pos.pair.quote);
    const lpBase = Math.sqrt(k * currentPrice);
    const lpQuote = Math.sqrt(k / currentPrice);
    const lpVal = lpBase * getPrice(pos.pair.base) + lpQuote * getPrice(pos.pair.quote);
    const il = lpVal - holdVal;
    const netPnl = pos.feeCollected + il;

    // Rules status
    const feePct = pos.totalUSD > 0 ? (pos.feeCollected / pos.totalUSD * 100) : 0;
    const ilPct = holdVal > 0 ? (il / holdVal * 100) : 0;
    const oorMin = pos.outOfRangeSince ? Math.floor((Date.now() - pos.outOfRangeSince) / 60000) : 0;

    let statusBadges = '';
    if (!inRange && oorMin > 0) statusBadges += `<span class="badge-warn">OOR ${oorMin}m</span>`;
    if (ilPct < -30) statusBadges += `<span class="badge-danger">IL ${ilPct.toFixed(0)}%</span>`;
    if (pos.feePeak > 0) statusBadges += `<span class="badge-info">Peak ${pos.feePeak.toFixed(1)}%</span>`;

    return `
      <div class="position-card">
        <div class="pos-header">
          <span class="pos-pair">${pos.pair.base}/${pos.pair.quote}</span>
          <span class="pos-status ${inRange ? 'in-range' : 'out-range'}">${inRange ? '● In Range' : '○ Out'}</span>
        </div>
        ${statusBadges ? `<div class="pos-badges">${statusBadges}</div>` : ''}
        <div class="pos-row"><span>Strategy</span><span>${pos.strategy}</span></div>
        <div class="pos-row"><span>Fee Tier</span><span>${pos.feeTier}%</span></div>
        <div class="pos-row"><span>Value</span><span>$${pos.totalUSD.toFixed(2)}</span></div>
        <div class="pos-row"><span>Fee Earned</span><span class="green">+$${pos.feeCollected.toFixed(2)} (${feePct.toFixed(1)}%)</span></div>
        <div class="pos-row"><span>IL</span><span class="${il >= 0 ? 'green' : 'red'}">${il >= 0 ? '+' : ''}$${il.toFixed(2)}</span></div>
        <div class="pos-row pos-net"><span>Net PnL</span><span class="${netPnl >= 0 ? 'green' : 'red'}">${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)}</span></div>
        <button class="btn-remove" onclick="removePosition(${pos.id})">Remove Position</button>
      </div>
    `;
  }).join('');
}

function removePosition(id) {
  const pos = STATE.positions.find(p => p.id === id);
  if (!pos) return;

  // Calculate final PnL
  const currentPrice = getPrice(pos.pair.base) / (getPrice(pos.pair.quote) || 1);
  const k = (pos.baseAmt / 2) * (pos.quoteAmt / 2);
  const holdVal = pos.baseAmt * getPrice(pos.pair.base) + pos.quoteAmt * getPrice(pos.pair.quote);
  const lpBase = Math.sqrt(k * currentPrice);
  const lpQuote = Math.sqrt(k / currentPrice);
  const lpVal = lpBase * getPrice(pos.pair.base) + lpQuote * getPrice(pos.pair.quote);

  STATE.closedPositions.push({
    ...pos,
    closedAt: Date.now(),
    closeReason: 'manual',
    finalFee: pos.feeCollected,
    finalIL: lpVal - holdVal,
    finalPnl: pos.feeCollected + (lpVal - holdVal),
    duration: Date.now() - pos.openedAt,
  });

  logDecision('CLOSE', pos.pairId, `Manual close ${pos.pairId} — Fee: $${pos.feeCollected.toFixed(2)}, PnL: $${(pos.feeCollected + (lpVal - holdVal)).toFixed(2)}`, { positionId: pos.id });

  STATE.balances[pos.pair.base] = (STATE.balances[pos.pair.base] || 0) + pos.baseAmt;
  STATE.balances[pos.pair.quote] = (STATE.balances[pos.pair.quote] || 0) + pos.quoteAmt + pos.feeCollected / getPrice(pos.pair.quote);
  STATE.positions = STATE.positions.filter(p => p.id !== id);
  renderTokenList();
  updateTotalBalance();
  renderPositionList();
  showToast(`🔴 Posisi ${pos.pair.id} ditutup. Fee: +$${pos.feeCollected.toFixed(2)}`);
}

// ── Analytics Dashboard ──
function renderAnalytics() {
  const el = document.getElementById('pair-grid');
  const allClosed = STATE.closedPositions;
  const allPositions = [...STATE.positions, ...allClosed];

  // Aggregate stats
  const totalDeployed = allPositions.reduce((s, p) => s + p.totalUSD, 0);
  const totalFees = allPositions.reduce((s, p) => s + (p.finalFee ?? p.feeCollected), 0);
  const totalPnl = allClosed.reduce((s, p) => s + p.finalPnl, 0);
  const activeValue = STATE.positions.reduce((s, p) => s + p.totalUSD, 0);
  const winCount = allClosed.filter(p => p.finalPnl > 0).length;
  const lossCount = allClosed.filter(p => p.finalPnl <= 0).length;
  const winRate = allClosed.length > 0 ? (winCount / allClosed.length * 100) : 0;

  // Best/worst pair
  const pairPnl = {};
  allClosed.forEach(p => {
    if (!pairPnl[p.pairId]) pairPnl[p.pairId] = 0;
    pairPnl[p.pairId] += p.finalPnl;
  });
  const sortedPairs = Object.entries(pairPnl).sort((a, b) => b[1] - a[1]);
  const bestPair = sortedPairs[0];
  const worstPair = sortedPairs[sortedPairs.length - 1];

  // Close reasons breakdown
  const reasons = {};
  allClosed.forEach(p => {
    reasons[p.closeReason] = (reasons[p.closeReason] || 0) + 1;
  });

  // APR estimate (annualized from fees)
  const totalDuration = allPositions.reduce((s, p) => s + ((p.closedAt || Date.now()) - p.openedAt), 0);
  const avgDurationHrs = allPositions.length > 0 ? (totalDuration / allPositions.length / 3600000) : 1;
  const aprEstimate = totalDeployed > 0 ? ((totalFees / totalDeployed) / (avgDurationHrs / 8760) * 100) : 0;

  el.innerHTML = `
    <div class="analytics-container">
      <h2 class="analytics-title">📊 Analytics Dashboard</h2>

      <!-- Stats Grid -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Deployed</div>
          <div class="stat-value">$${totalDeployed.toFixed(2)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Active Value</div>
          <div class="stat-value accent">$${activeValue.toFixed(2)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Fees</div>
          <div class="stat-value green">+$${totalFees.toFixed(2)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Realized PnL</div>
          <div class="stat-value ${totalPnl >= 0 ? 'green' : 'red'}">${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Win Rate</div>
          <div class="stat-value">${winRate.toFixed(0)}%</div>
          <div class="stat-sub">${winCount}W / ${lossCount}L</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Est. APR</div>
          <div class="stat-value">${aprEstimate.toFixed(1)}%</div>
        </div>
      </div>

      <!-- PnL Chart -->
      <div class="chart-section">
        <div class="section-label">PnL per Position</div>
        <div class="pnl-chart" id="pnl-chart">
          ${allClosed.length ? allClosed.map((p, i) => {
            const maxAbs = Math.max(...allClosed.map(x => Math.abs(x.finalPnl)), 1);
            const h = Math.max(Math.abs(p.finalPnl) / maxAbs * 80, 4);
            const color = p.finalPnl >= 0 ? '#4ade80' : '#f87171';
            return `<div class="chart-bar-wrapper">
              <div class="chart-bar" style="height:${h}px;background:${color}"></div>
              <div class="chart-label">${p.pair.base}</div>
              <div class="chart-val ${p.finalPnl >= 0 ? 'green' : 'red'}">${p.finalPnl >= 0 ? '+' : ''}$${p.finalPnl.toFixed(1)}</div>
            </div>`;
          }).join('') : '<div class="empty-state">Belum ada posisi ditutup</div>'}
        </div>
      </div>

      <!-- Best/Worst -->
      <div class="ranking-section">
        <div class="section-label">Pair Rankings</div>
        <div class="ranking-grid">
          <div class="rank-card best">
            <div class="rank-label">🏆 Best Pair</div>
            <div class="rank-pair">${bestPair ? bestPair[0] : '—'}</div>
            <div class="rank-pnl green">${bestPair ? '+' + '$' + bestPair[1].toFixed(2) : ''}</div>
          </div>
          <div class="rank-card worst">
            <div class="rank-label">💀 Worst Pair</div>
            <div class="rank-pair">${worstPair && worstPair !== bestPair ? worstPair[0] : '—'}</div>
            <div class="rank-pnl red">${worstPair && worstPair !== bestPair ? '$' + worstPair[1].toFixed(2) : ''}</div>
          </div>
        </div>
      </div>

      <!-- Close Reasons -->
      <div class="reasons-section">
        <div class="section-label">Close Reasons</div>
        <div class="reasons-grid">
          ${Object.entries(reasons).length ? Object.entries(reasons).map(([r, c]) => `
            <div class="reason-item">
              <span class="reason-icon">${{ manual: '🖐️', 'stop loss': '🛑', 'take profit': '💰', 'trailing take profit': '📈', 'out-of-range timeout': '📍' }[r] || '📌'}</span>
              <span class="reason-name">${r}</span>
              <span class="reason-count">${c}</span>
            </div>
          `).join('') : '<div class="empty-state">Belum ada</div>'}
        </div>
      </div>

      <!-- Rules Config -->
      <div class="rules-section">
        <div class="section-label">⚙️ Rules Engine Config</div>
        <div class="rules-grid">
          <div class="rule-item">
            <label>Stop Loss (%)</label>
            <input type="number" value="${RULES.stopLossPct}" onchange="RULES.stopLossPct=parseFloat(this.value)" class="rule-input">
          </div>
          <div class="rule-item">
            <label>Take Profit (%)</label>
            <input type="number" value="${RULES.takeProfitPct}" onchange="RULES.takeProfitPct=parseFloat(this.value)" class="rule-input">
          </div>
          <div class="rule-item">
            <label>Trailing TP</label>
            <label class="toggle">
              <input type="checkbox" ${RULES.trailingEnabled ? 'checked' : ''} onchange="RULES.trailingEnabled=this.checked">
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="rule-item">
            <label>Trailing Trigger (%)</label>
            <input type="number" value="${RULES.trailingTriggerPct}" onchange="RULES.trailingTriggerPct=parseFloat(this.value)" class="rule-input">
          </div>
          <div class="rule-item">
            <label>Trailing Drop (%)</label>
            <input type="number" value="${RULES.trailingDropPct}" onchange="RULES.trailingDropPct=parseFloat(this.value)" class="rule-input">
          </div>
          <div class="rule-item">
            <label>OOR Timeout (min)</label>
            <input type="number" value="${RULES.outOfRangeMinutes}" onchange="RULES.outOfRangeMinutes=parseFloat(this.value)" class="rule-input">
          </div>
        </div>
        <div class="rules-toggle-row">
          <label class="toggle">
            <input type="checkbox" ${RULES.enabled ? 'checked' : ''} onchange="RULES.enabled=this.checked; showToast(this.checked ? '✅ Rules ON' : '⚠️ Rules OFF')">
            <span class="toggle-slider"></span>
          </label>
          <span>Rules Engine ${RULES.enabled ? 'ACTIVE' : 'DISABLED'}</span>
        </div>
      </div>
    </div>
  `;
}

// ── Toast ──
function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'toast show';
  setTimeout(() => t.className = 'toast', 3000);
}

// ── Format helpers ──
function fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}
function fmtBal(n, sym) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M ' + sym;
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K ' + sym;
  if (n < 0.0001) return n.toExponential(2) + ' ' + sym;
  return n.toFixed(4) + ' ' + sym;
}
function fmtRate(rate, pair) {
  if (!rate) return '—';
  if (rate < 0.000001) return rate.toExponential(4);
  if (rate < 0.01) return rate.toFixed(8);
  if (rate < 1) return rate.toFixed(6);
  return rate.toFixed(4);
}

// ── Init ──
fetchPrices();
renderDecisionLog();
setInterval(fetchPrices, 30000);
