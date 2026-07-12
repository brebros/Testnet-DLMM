// ═══════════════════════════════════════════
// meteora.js — Real volume data from Meteora API
// Base URL: https://dlmm.datapi.meteora.ag
// No API key needed
// ═══════════════════════════════════════════

const METEORA_API = 'https://dlmm.datapi.meteora.ag';

// Cache pool data biar ga spam API
const POOL_CACHE = { data: {}, lastFetch: {}, TTL: 5 * 60 * 1000 };

// Symbol normalization — handle Meteora's weird naming
function normalizeSymbol(sym) {
  return (sym || '').replace(/^\$/, '').replace(/^m/, 'M').replace(/^b/, 'B').replace(/^j/, 'J').toUpperCase();
}

// Fallback quotes — if USDC pair not found, try these
const FALLBACK_QUOTES = ['USDC', 'SOL', 'USDT'];

// ── Fetch multiple pages in parallel ──
async function fetchAllPools(pages = 10) {
  const urls = [];
  for (let i = 1; i <= pages; i++) {
    urls.push(`${METEORA_API}/pools?page_size=200&page=${i}`);
  }
  const results = await Promise.allSettled(
    urls.map(url => fetch(url).then(r => r.ok ? r.json() : { data: [] }))
  );
  const allPools = [];
  results.forEach(r => {
    if (r.status === 'fulfilled' && r.value?.data) {
      allPools.push(...r.value.data);
    }
  });
  return allPools;
}

// ── Find matching pool with fallback quotes ──
function findMatchingPool(pools, baseSymbol, quoteSymbol) {
  const baseNorm = normalizeSymbol(baseSymbol);
  const quoteNorm = normalizeSymbol(quoteSymbol);

  // Try exact match first
  let match = pools.find(p => {
    const xSym = normalizeSymbol(p.token_x?.symbol);
    const ySym = normalizeSymbol(p.token_y?.symbol);
    return (xSym === baseNorm && ySym === quoteNorm) ||
           (xSym === quoteNorm && ySym === baseNorm);
  });

  if (match) return match;

  // Fallback: try other quote tokens (USDC → SOL → USDT)
  for (const fallbackQuote of FALLBACK_QUOTES) {
    if (fallbackQuote === quoteSymbol) continue; // skip original
    const fbNorm = normalizeSymbol(fallbackQuote);
    match = pools.find(p => {
      const xSym = normalizeSymbol(p.token_x?.symbol);
      const ySym = normalizeSymbol(p.token_y?.symbol);
      return (xSym === baseNorm && ySym === fbNorm) ||
             (xSym === fbNorm && ySym === baseNorm);
    });
    if (match) return match;
  }

  return null;
}

// ── Fetch pools by token pair dari Meteora ──
async function fetchMeteoraPools(baseSymbol, quoteSymbol) {
  const cacheKey = `${baseSymbol}-${quoteSymbol}`;
  const now = Date.now();
  if (POOL_CACHE.data[cacheKey] && now - POOL_CACHE.lastFetch[cacheKey] < POOL_CACHE.TTL) {
    return POOL_CACHE.data[cacheKey];
  }

  try {
    // Fetch 10 pages (2000 pools) in parallel
    const allPools = await fetchAllPools(10);
    const match = findMatchingPool(allPools, baseSymbol, quoteSymbol);

    if (!match) return null;

    const result = {
      address:   match.address,
      volume24h: parseFloat(match.volume?.['24h'] || 0),
      tvl:       parseFloat(match.tvl || 0),
      feeTier:   parseFloat(match.pool_config?.base_fee_pct || 0.3),
      binStep:   match.pool_config?.bin_step || 10,
      apr:       parseFloat(match.apr || 0) * 100,
      fees24h:   parseFloat(match.fees?.['24h'] || 0),
      matchedAs: match.name, // track what we actually matched
    };

    POOL_CACHE.data[cacheKey] = result;
    POOL_CACHE.lastFetch[cacheKey] = now;
    return result;
  } catch (e) {
    console.warn(`Meteora pool fetch failed for ${cacheKey}:`, e.message);
    return null;
  }
}

// ── Hitung fee estimate realistis ──
function calcRealisticFee(poolData, modalUSD, durationHours = 24) {
  if (!poolData || !poolData.volume24h || !poolData.tvl) return null;
  const { volume24h, tvl, feeTier } = poolData;
  const luShare     = Math.min(modalUSD / tvl, 1);
  const fee24h      = volume24h * (feeTier / 100) * luShare;
  const feeProRated = fee24h * (durationHours / 24);
  return {
    fee24h, feeProRated, volume24h, tvl,
    luShare: luShare * 100,
    apr: poolData.apr || (fee24h / modalUSD * 365 * 100),
  };
}

// ── Update semua posisi dengan fee real ──
async function updatePositionFeesWithRealData(positions) {
  if (!positions.length) return;
  for (const pos of positions) {
    try {
      const poolData = await fetchMeteoraPools(pos.pair.base, pos.pair.quote);
      if (!poolData) continue;
      pos.poolData = poolData;
      const hoursOpen = (Date.now() - pos.openedAt) / 3600000;
      const feeCalc = calcRealisticFee(poolData, pos.totalUSD, hoursOpen);
      if (!feeCalc) continue;
      pos.feeCollected = feeCalc.feeProRated;
      pos.realFeeData  = feeCalc;
      pos.dataSource   = 'meteora_real';
    } catch (e) {
      console.warn(`Fee update failed for ${pos.pair.id}:`, e.message);
    }
    await new Promise(r => setTimeout(r, 150));
  }
}

// ── Format angka volume/TVL ──
function fmtVolume(n) {
  if (!n) return '$0';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(2) + 'K';
  return '$' + n.toFixed(2);
}

// ── Render pool stats section di DLMM panel ──
async function renderPoolStats(pairId, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = `<div class="pool-loading">Fetching Meteora data... 🔄</div>`;

  const pair = PAIRS.find(p => p.id === pairId);
  if (!pair) return;

  const poolData = await fetchMeteoraPools(pair.base, pair.quote);
  if (!poolData) {
    container.innerHTML = `<div class="pool-no-data">Pool data tidak tersedia untuk pair ini</div>`;
    return;
  }

  const aprStr = poolData.apr ? poolData.apr.toFixed(1) + '%' : '—';
  const matchedNote = poolData.matchedAs !== `${pair.base}-${pair.quote}` 
    ? ` (matched: ${poolData.matchedAs})` : '';

  container.innerHTML = `
    <div class="pool-stats-grid">
      <div class="pool-stat"><div class="pool-stat-label">Volume 24h</div><div class="pool-stat-value accent">${fmtVolume(poolData.volume24h)}</div></div>
      <div class="pool-stat"><div class="pool-stat-label">TVL Pool</div><div class="pool-stat-value">${fmtVolume(poolData.tvl)}</div></div>
      <div class="pool-stat"><div class="pool-stat-label">Fee APR</div><div class="pool-stat-value green">${aprStr}</div></div>
      <div class="pool-stat"><div class="pool-stat-label">Bin Step</div><div class="pool-stat-value">${poolData.binStep} bps</div></div>
    </div>
    <div class="pool-source">📡 Meteora DLMM${matchedNote} · Pool: ${poolData.address?.slice(0,8)}...</div>
  `;
}

// ── Auto refresh fee tiap 5 menit ──
let feeRefreshInterval = null;

function startRealFeeTracking(positions, onUpdate) {
  if (feeRefreshInterval) clearInterval(feeRefreshInterval);
  updatePositionFeesWithRealData(positions).then(onUpdate);
  feeRefreshInterval = setInterval(async () => {
    await updatePositionFeesWithRealData(positions);
    if (onUpdate) onUpdate();
  }, 5 * 60 * 1000);
}

function stopRealFeeTracking() {
  if (feeRefreshInterval) { clearInterval(feeRefreshInterval); feeRefreshInterval = null; }
}
