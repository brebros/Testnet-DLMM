// ═══════════════════════════════════════════
// DLMM TESTNET SIMULATOR — app.js
// ═══════════════════════════════════════════

// ── State global ──
const STATE = {
  wallet: null,
  balances: {},
  positions: [],
  prices: {},
  selectedPair: null,
  openPair: null,
  filter: 'all',
  search: '',
  lastFaucet: null,
  feeSimInterval: null,
};

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
        STATE.prices[sym] = {
          usd: data[token.id].usd,
          change24h: data[token.id].usd_24h_change || 0,
        };
      }
    });
    renderPairGrid();
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
    STATE.prices[sym] = { usd, change24h: (Math.random()-0.5)*5 };
  });
  renderPairGrid();
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
  document.getElementById('wallet-addr').textContent = address.slice(0,6)+'...'+address.slice(-4);
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
  document.getElementById('wallet-addr').textContent = 'Not connected';
  document.getElementById('connect-btn').textContent = 'Connect Wallet';
  document.getElementById('connect-btn').onclick = () => document.getElementById('wallet-modal').style.display = 'flex';
  document.getElementById('faucet-btn').disabled = true;
  renderTokenList();
  renderPositionList();
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
  persistState();
  document.getElementById('faucet-modal').style.display = 'none';
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
  const total = Object.entries(STATE.balances).reduce((sum, [sym, bal]) => {
    return sum + bal * getPrice(sym);
  }, 0);
  document.getElementById('total-usd').textContent = '$' + total.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
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
  if (!pairs.length) { el.innerHTML = '<div class="empty-state">Pair tidak ditemukan</div>'; return; }
  el.innerHTML = pairs.map(pair => {
    const basePrice = getPrice(pair.base);
    const quotePrice = getPrice(pair.quote);
    const rate = quotePrice > 0 ? basePrice / quotePrice : 0;
    const change = STATE.prices[pair.base]?.change24h || 0;
    const changeStr = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
    const changeColor = change >= 0 ? 'green' : 'red';
    const isSelected = STATE.openPair?.id === pair.id;
    return `
      <div class="pair-card ${isSelected ? 'selected' : ''} ${pair.type}" onclick="selectPair('${pair.id}')">
        <div class="pair-name">${pair.base}/${pair.quote}</div>
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
  renderPairGrid();
}

function searchPairs(val) {
  STATE.search = val;
  renderPairGrid();
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

  dlmmState.feeTier = pair.feeTiers[0];
  dlmmState.binStep = pair.binSteps[0];
  dlmmState.rangeMin = parseFloat((rate * 0.85).toFixed(6));
  dlmmState.rangeMax = parseFloat((rate * 1.15).toFixed(6));

  const panel = document.getElementById('right-panel');
  panel.innerHTML = `
    <div class="dlmm-header">
      <div class="dlmm-pair">${pair.base}/${pair.quote}</div>
      <div class="dlmm-price">${fmtRate(rate, pair)}</div>
      <div class="dlmm-change ${change>=0?'green':'red'}">${change>=0?'+':''}${change.toFixed(2)}% 24h</div>
    </div>

    ${renderChartSection(pair.id)}

    <!-- Pool Stats (Meteora Real Data) -->
    <div class="dlmm-section">
      <div class="section-label">📡 Live Pool Data · Meteora</div>
      <div id="pool-stats-container"></div>
    </div>

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
        <button class="btn-sm ${dlmmState.strategy==='spot'?'sel':''}" onclick="setDlmmStrat('spot')">Spot</button>
        <button class="btn-sm ${dlmmState.strategy==='curve'?'sel':''}" onclick="setDlmmStrat('curve')">Curve</button>
        <button class="btn-sm ${dlmmState.strategy==='bidask'?'sel':''}" onclick="setDlmmStrat('bidask')">Bid-Ask</button>
        <button class="btn-sm ${dlmmState.strategy==='aggressive'?'sel':''}" onclick="setDlmmStrat('aggressive')">Aggressive</button>
        <button class="btn-sm delta-neutral-btn ${dlmmState.strategy==='delta_neutral'?'sel':''}" onclick="setDlmmStrat('delta_neutral')" title="Advanced: requires hedge position">Δ Neutral</button>
      </div>
      <div class="strat-hint" id="strat-hint">${stratHint(dlmmState.strategy)}</div>
      ${dlmmState.strategy === 'delta_neutral' ? `
      <div class="delta-neutral-info">
        <div class="dn-title">⚡ Delta-Neutral Setup</div>
        <div class="dn-row"><span>LP Position</span><span>+$X (ini yang lu deploy)</span></div>
        <div class="dn-row"><span>Short Hedge</span><span>-$X di Drift/dYdX (manual)</span></div>
        <div class="dn-row"><span>Net IL</span><span>~$0 (hedged)</span></div>
        <div class="dn-note">Simulator ini handle LP side-nya. Short position perlu dibuka manual di perp exchange.</div>
      </div>` : ''}
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
          <span class="bal-hint" id="bal-base">Balance: ${fmtBal(STATE.balances[pair.base]||0, pair.base)}</span>
        </div>
        <div class="liq-plus">+</div>
        <div class="liq-input-group">
          <label>${pair.quote}</label>
          <input type="number" id="amount-quote" placeholder="0.00" oninput="syncBase(this.value)" min="0">
          <span class="bal-hint" id="bal-quote">Balance: ${fmtBal(STATE.balances[pair.quote]||0, pair.quote)}</span>
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
  setTimeout(() => mountChart(pair.id), 100);
  renderPoolStats(pair.id, 'pool-stats-container');
}

function stratHint(s) {
  const hints = {
    spot:          'Nyebar rata — aman untuk semua kondisi, fee konsisten',
    curve:         'Numpuk di tengah — maksimal fee saat sideways. ⚠️ Trap di trending market!',
    bidask:        'Numpuk di pinggir — cocok saat volatile >5%. Fee dari dua arah swing.',
    aggressive:    'One-sided — high conviction only. IL maksimal kalau prediksi salah.',
    delta_neutral: '⚡ Advanced: LP fee + short hedge = zero IL. Butuh perp position sebagai hedge.',
  };
  return hints[s] || 'Pilih strategi yang sesuai kondisi market';
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
function updateRangeMin(v) { dlmmState.rangeMin = parseFloat(v)||0; updateRangeInfo(); renderBinPreview(); }
function updateRangeMax(v) { dlmmState.rangeMax = parseFloat(v)||0; updateRangeInfo(); renderBinPreview(); }

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
  const n = 20;
  const weights = getWeights(n, dlmmState.strategy);
  const max = Math.max(...weights);
  const pair = STATE.openPair;
  const rate = pair ? getPrice(pair.base) / (getPrice(pair.quote)||1) : 1;
  const activeIdx = Math.floor(n/2);

  el.innerHTML = weights.map((w, i) => {
    const h = Math.max((w/max)*100, 4);
    const isActive = i === activeIdx;
    const color = isActive ? '#f59e0b' : '#22d3ee';
    return `<div style="flex:1;height:${h}%;background:${color};border-radius:2px 2px 0 0;opacity:${isActive?1:0.7}" title="Bin ${i}"></div>`;
  }).join('');
}

function getWeights(n, strategy) {
  const mid = (n-1)/2;
  if (strategy === 'spot') {
    return Array(n).fill(1);
  }
  if (strategy === 'curve') {
    return Array.from({length:n}, (_,i) => Math.max(0.05, 1-Math.abs(i-mid)/mid));
  }
  if (strategy === 'bidask') {
    return Array.from({length:n}, (_,i) => 0.1 + Math.abs(i-mid)/mid);
  }
  if (strategy === 'aggressive') {
    // One-sided: semua modal di sisi kiri (bullish aggressive = beli base saat turun)
    return Array.from({length:n}, (_,i) => Math.max(0, 1 - (i / mid)));
  }
  if (strategy === 'delta_neutral') {
    // Delta neutral = Bid-Ask distribution tapi visualized dengan warna berbeda
    return Array.from({length:n}, (_,i) => 0.1 + Math.abs(i-mid)/mid);
  }
  return Array(n).fill(1); // fallback spot
}

function syncQuote(baseVal) {
  const pair = STATE.openPair;
  if (!pair) return;
  const rate = getPrice(pair.base) / (getPrice(pair.quote)||1);
  const quoteVal = parseFloat(baseVal) * rate;
  const qEl = document.getElementById('amount-quote');
  if (qEl) qEl.value = isNaN(quoteVal) ? '' : quoteVal.toFixed(6);
  updateLiqUSD();
}
function syncBase(quoteVal) {
  const pair = STATE.openPair;
  if (!pair) return;
  const rate = getPrice(pair.base) / (getPrice(pair.quote)||1);
  const baseVal = parseFloat(quoteVal) / rate;
  const bEl = document.getElementById('amount-base');
  if (bEl) bEl.value = isNaN(baseVal) ? '' : baseVal.toFixed(6);
  updateLiqUSD();
}
function updateLiqUSD() {
  const pair = STATE.openPair;
  if (!pair) return;
  const b = parseFloat(document.getElementById('amount-base')?.value)||0;
  const q = parseFloat(document.getElementById('amount-quote')?.value)||0;
  const usd = b*getPrice(pair.base) + q*getPrice(pair.quote);
  const el = document.getElementById('liq-usd-total');
  if (el) el.textContent = `≈ $${usd.toFixed(2)}`;
}

// ── Add Liquidity → Open Position ──
function addLiquidity() {
  if (!STATE.wallet) { alert('Connect wallet dulu!'); return; }
  const pair = STATE.openPair;
  const baseAmt = parseFloat(document.getElementById('amount-base')?.value)||0;
  const quoteAmt = parseFloat(document.getElementById('amount-quote')?.value)||0;
  if (baseAmt <= 0 && quoteAmt <= 0) { alert('Masukkan jumlah token!'); return; }
  if ((STATE.balances[pair.base]||0) < baseAmt) { alert(`Balance ${pair.base} tidak cukup. Claim faucet dulu!`); return; }
  if ((STATE.balances[pair.quote]||0) < quoteAmt) { alert(`Balance ${pair.quote} tidak cukup. Claim faucet dulu!`); return; }

  STATE.balances[pair.base] = (STATE.balances[pair.base]||0) - baseAmt;
  STATE.balances[pair.quote] = (STATE.balances[pair.quote]||0) - quoteAmt;

  const entryPrice = getPrice(pair.base) / (getPrice(pair.quote)||1);
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
    deployTs: Date.now(),       // timestamp deploy (untuk low yield check)
    lastChecked: Date.now(),    // last monitoring check
    oorSince: null,             // timestamp mulai OOR (untuk OOR timeout)
    feePerDay: 0,               // estimated fee per day (diupdate realtime)
    swapCount: 0,
    dataSource: 'sim',          // 'sim' atau 'meteora_real'
  };

  STATE.positions.push(position);
  renderTokenList();
  updateTotalBalance();
  renderPositionList();
  startFeeAccumulation(position);
  startRealFeeTracking(STATE.positions, () => {
    renderPositionList();
    updateTotalBalance();
  });

  // Notif success
  showToast(`✅ Posisi ${pair.id} dibuka! $${totalUSD.toFixed(2)} terdeploy.`);
  persistState();
  renderDLMMPanel();
}

// ── Fee Accumulation — Meteora Real Volume Based ──
// Formula: fee_per_second = (volume_24h × fee_tier% × lu_share) / 86400
// Fallback ke simulasi noise kalau Meteora data ga tersedia
function startFeeAccumulation(position) {
  const interval = setInterval(async () => {
    const pos = STATE.positions.find(p => p.id === position.id);
    if (!pos) { clearInterval(interval); return; }

    const currentPrice = getPrice(pos.pair.base) / (getPrice(pos.pair.quote)||1);
    const inRange = currentPrice >= pos.rangeMin && currentPrice <= pos.rangeMax;

    // Track OOR timestamp
    if (!inRange) {
      if (!pos.oorSince) pos.oorSince = Date.now();
    } else {
      pos.oorSince = null;
    }

    if (inRange) {
      let feePerTick = 0;

      // Prioritas 1: Meteora real volume data
      if (pos.poolData && pos.poolData.volume24h && pos.poolData.tvl) {
        const { volume24h, tvl, feeTier } = pos.poolData;
        const luShare = Math.min(pos.totalUSD / tvl, 1);
        const feePerSecond = (volume24h * (feeTier / 100) * luShare) / 86400;
        feePerTick = feePerSecond * 3; // 3 detik per tick
        pos.dataSource = 'meteora_real';

        // Update feePerDay estimate
        pos.feePerDay = volume24h * (feeTier / 100) * luShare;

      } else {
        // Fallback: simulasi berbasis noise (lebih realistis dari sebelumnya)
        // Estimasi volume harian = TVL pool × 0.5 (rough estimate)
        const estimatedDailyVol = pos.totalUSD * 8; // 8× modal = rough volume estimate
        const luShare = 0.001; // asumsi share kecil
        const feePerSecond = (estimatedDailyVol * (pos.feeTier / 100) * luShare) / 86400;
        feePerTick = feePerSecond * 3 * (0.8 + Math.random() * 0.4); // noise ±20%
        pos.dataSource = 'sim';
        pos.feePerDay = feePerSecond * 86400;
      }

      pos.feeCollected += feePerTick;
      pos.swapCount++;
      pos.lastChecked = Date.now();
    }

    // Low yield check (Fix 1: threshold 0.01%/day untuk simulator)
    const hoursOpen = (Date.now() - pos.deployTs) / 3600000;
    if (hoursOpen >= 2 && pos.feePerDay > 0) {
      const feeRatePerDay = pos.feePerDay / pos.totalUSD * 100;
      const threshold = pos.dataSource === 'meteora_real' ? 0.05 : 0.01; // berbeda per source
      pos.lowYieldWarning = feeRatePerDay < threshold;
    }

    renderPositionList();
    updateTotalBalance();
  }, 3000); // tiap 3 detik
}

// ── Position List ──
function renderPositionList() {
  const el = document.getElementById('position-list');
  if (!STATE.positions.length) {
    el.innerHTML = '<div class="empty-state">Belum ada posisi</div>'; return;
  }
  el.innerHTML = STATE.positions.map(pos => {
    const currentPrice = getPrice(pos.pair.base) / (getPrice(pos.pair.quote)||1);
    const inRange = currentPrice >= pos.rangeMin && currentPrice <= pos.rangeMax;

    // IL calc — formula yang benar berdasarkan constant product
    const priceRatio = pos.entryPrice > 0 ? currentPrice / pos.entryPrice : 1;
    const lpVal = pos.totalUSD * 2 * Math.sqrt(priceRatio) / (1 + priceRatio);
    const holdVal = pos.totalUSD * (0.5 + 0.5 * priceRatio);
    const il = lpVal - holdVal;
    const netPnl = pos.feeCollected + il;

    return `
      <div class="position-card">
        <div class="pos-header">
          <span class="pos-pair">${pos.pair.base}/${pos.pair.quote}</span>
          <span class="pos-status ${inRange?'in-range':'out-range'}">${inRange?'● In Range':'○ Out'}</span>
        </div>
        <div class="pos-row"><span>Strategy</span><span>${pos.strategy}</span></div>
        <div class="pos-row"><span>Fee Tier</span><span>${pos.feeTier}%</span></div>
        <div class="pos-row"><span>Value</span><span>$${pos.totalUSD.toFixed(2)}</span></div>
        <div class="pos-row"><span>Duration</span><span>${fmtDuration(pos.deployTs)}</span></div>
        ${pos.oorSince ? `<div class="pos-row"><span>OOR Sejak</span><span class="red">${fmtDuration(pos.oorSince)} lalu ⚠️</span></div>` : ''}
        ${pos.lowYieldWarning ? `<div class="pos-row"><span>Yield Warning</span><span class="red">Fee/day di bawah threshold ⚠️</span></div>` : ''}
        <div class="pos-row">
          <span>Fee Earned</span>
          <span class="green">+$${pos.feeCollected.toFixed(2)}</span>
          ${pos.dataSource === 'meteora_real' ? '<span class="real-badge">REAL</span>' : '<span class="sim-badge">SIM</span>'}
        </div>
        <div class="pos-row sub">
          <span>Est. Fee/day</span>
          <span class="${pos.feePerDay > 0 ? 'green' : 'text2'}">$${(pos.feePerDay||0).toFixed(2)}/day (${pos.totalUSD > 0 ? ((pos.feePerDay||0)/pos.totalUSD*100).toFixed(3) : '0.000'}%)</span>
        </div>
        ${pos.realFeeData ? `
        <div class="pos-row sub"><span>Volume 24h pool</span><span>${fmtVolume ? fmtVolume(pos.realFeeData.volume24h) : '$'+pos.realFeeData.volume24h.toFixed(0)}</span></div>
        <div class="pos-row sub"><span>Share lu di pool</span><span>${pos.realFeeData.luShare.toFixed(4)}%</span></div>
        <div class="pos-row sub"><span>Est. APR</span><span class="green">${pos.realFeeData.apr.toFixed(1)}%</span></div>
        ` : ''}
        <div class="pos-row"><span>IL</span><span class="${il>=0?'green':'red'}">${il>=0?'+':''}$${il.toFixed(2)}</span></div>
        <div class="pos-row pos-net"><span>Net PnL</span><span class="${netPnl>=0?'green':'red'}">${netPnl>=0?'+':''}$${netPnl.toFixed(2)}</span></div>
        <button class="btn-remove" onclick="removePosition(${pos.id})">Remove Position</button>
      </div>
    `;
  }).join('');
}

function removePosition(id) {
  const pos = STATE.positions.find(p => p.id === id);
  if (!pos) return;
  // Return token ke balance
  STATE.balances[pos.pair.base] = (STATE.balances[pos.pair.base]||0) + pos.baseAmt;
  STATE.balances[pos.pair.quote] = (STATE.balances[pos.pair.quote]||0) + pos.quoteAmt + pos.feeCollected / getPrice(pos.pair.quote);
  STATE.positions = STATE.positions.filter(p => p.id !== id);
  renderTokenList();
  updateTotalBalance();
  renderPositionList();
  persistState();
  showToast(`🔴 Posisi ${pos.pair.id} ditutup. Fee: +$${pos.feeCollected.toFixed(2)}`);
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
function fmtDuration(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (h > 0) return h + 'j ' + m + 'm';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

function fmt(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return n.toString();
}
function fmtBal(n, sym) {
  if (!n) return '0';
  if (n >= 1e6) return (n/1e6).toFixed(2)+'M ' + sym;
  if (n >= 1e3) return (n/1e3).toFixed(2)+'K ' + sym;
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
setInterval(fetchPrices, 30000); // refresh tiap 30 detik

// Init persistence setelah DOM dan PAIRS tersedia
window.addEventListener('load', () => {
  initPersistence();
});
