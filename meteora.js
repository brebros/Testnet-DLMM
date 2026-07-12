// ═══════════════════════════════════════════
// meteora.js — Real volume data from Meteora API
// Base URL: https://dlmm.datapi.meteora.ag
// No API key needed, 30 req/s limit
// ═══════════════════════════════════════════

const METEORA_API = 'https://dlmm.datapi.meteora.ag';

// Cache pool data biar ga spam API
const POOL_CACHE = {
  data: {},        // pairId → pool data
  lastFetch: {},   // pairId → timestamp
  TTL: 5 * 60 * 1000, // 5 menit
};

// Mapping pair → token mint addresses Solana (buat match ke Meteora pool)
const TOKEN_MINTS = {
  SOL:    'So11111111111111111111111111111111111111112',
  USDC:   'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT:   'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  BONK:   'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  WIF:    'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  JUP:    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  PYTH:   'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
  RAY:    '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  ORCA:   'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
  JTO:    'jtojtomepa8b22eZPgamTtTMcjT9e9kb5rFLmLBgGSN',
  POPCAT: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
  BOME:   'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82',
  MEW:    'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5',
  SLERF:  '7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7VC5xgkn',
  SAMO:   '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  MNGO:   'MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac',
  RENDER: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',
  HNT:    'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux',
  MOBILE: 'mb1eu7TzEc71KxDpsmsKoucSSuuoGLv1drys1oP2jh6',
  IOT:    'iotEVVZLEywoTn1QdwNPddxPWszn3zFhEot3MfL9fns',
  GMT:    '7i5KKsX2weiTkry7jA4ZwSuXGhs5eJBEjY8vVxR4pfRx',
  GST:    'AFbX8oGjGpmVFywbVouvhQSRmiW2aR1mohfahi4Y2AdB',
  DRIFT:  'DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7',
  ZEUS:   'ZEUS1aR7aX8DFFkFgg5q8a3o6Lo3gjzGQUF7c8K4Lkj',
  KMNO:   'KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS',
  MSOL:   'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  JSOL:   '7Q2afV64in6N6SeZsAAB81TJzwDoD6zpqmHkzi9Dcavn',
  BSOL:   'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',
  W:      '85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ',
  TNSR:   'TNSRxcUxoT9xBG3de7A4kBSGFhzN3Jg8djAMqaGQ7kz',
  PONKE:  '5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK31CF6Ta',
  DAI:    'EjmyN6qEC1Tf1JxiG1ae7UTJhUxSwk1TCWNWqxWV4J6o',
  PYUSD:  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
  FRAX:   'FR87nWEUxVgerFGhZM8Y4AggKGLnaXswr1Pd8wZ4kZcp',
  USDS:   'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA',
  TUSD:   'EZF2sPJRe26c9ZQa7DFVLd5NkMkAQL9oFBvQbXRDfHf4',
};

// ── Fetch pools by token pair dari Meteora ──
async function fetchMeteoraPools(baseSymbol, quoteSymbol) {
  const cacheKey = `${baseSymbol}-${quoteSymbol}`;
  const now = Date.now();

  // Return cache kalau masih fresh
  if (POOL_CACHE.data[cacheKey] && now - POOL_CACHE.lastFetch[cacheKey] < POOL_CACHE.TTL) {
    return POOL_CACHE.data[cacheKey];
  }

  const baseMint  = TOKEN_MINTS[baseSymbol];
  const quoteMint = TOKEN_MINTS[quoteSymbol];
  if (!baseMint || !quoteMint) return null;

  try {
    // Cari pool group by mints
    const url = `${METEORA_API}/pools/groups/${baseMint},${quoteMint}?page_size=10&sort_by=volume_24h&sort_order=desc`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const pools = data.pools || data.items || data || [];
    if (!pools.length) return null;

    // Ambil pool dengan volume 24h terbesar
    const topPool = pools[0];
    const result  = {
      address:    topPool.address || topPool.pool_address,
      volume24h:  parseFloat(topPool.volume_24h || topPool.trade_volume_24h || 0),
      tvl:        parseFloat(topPool.tvl || topPool.liquidity || 0),
      feeTier:    parseFloat(topPool.fee_rate || topPool.trade_fee_rate || 0.003) * 100,
      binStep:    topPool.bin_step || 10,
      apr24h:     parseFloat(topPool.apr_24h || topPool.fee_apr || 0),
    };

    POOL_CACHE.data[cacheKey]      = result;
    POOL_CACHE.lastFetch[cacheKey] = now;
    return result;

  } catch (e) {
    console.warn(`Meteora pool fetch failed for ${cacheKey}:`, e.message);
    return null;
  }
}

// ── Fetch volume history pool ──
async function fetchVolumeHistory(poolAddress, interval = '1h', limit = 24) {
  try {
    const url = `${METEORA_API}/pools/${poolAddress}/volume/history?interval=${interval}&limit=${limit}`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.history || data || [];
  } catch (e) {
    console.warn('Volume history fetch failed:', e.message);
    return [];
  }
}

// ── Fetch protocol-wide metrics ──
async function fetchProtocolMetrics() {
  try {
    const res  = await fetch(`${METEORA_API}/stats/protocol_metrics`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('Protocol metrics fetch failed:', e.message);
    return null;
  }
}

// ── Hitung fee estimate realistis ──
// Formula: fee_lu = volume_24h × fee_tier% × (modal_lu / TVL_pool)
function calcRealisticFee(poolData, modalUSD, durationHours = 24) {
  if (!poolData || !poolData.volume24h || !poolData.tvl) return null;

  const { volume24h, tvl, feeTier } = poolData;

  // Share lu dari total TVL pool (makin kecil TVL, makin gede share lu)
  const luShare     = Math.min(modalUSD / tvl, 1);
  // Fee per 24h
  const fee24h      = volume24h * (feeTier / 100) * luShare;
  // Pro-rate ke durasi posisi lu
  const feeProRated = fee24h * (durationHours / 24);

  return {
    fee24h:       fee24h,
    feeProRated:  feeProRated,
    volume24h:    volume24h,
    tvl:          tvl,
    luShare:      luShare * 100, // dalam persen
    apr:          poolData.apr24h || (fee24h / modalUSD * 365 * 100),
  };
}

// ── Update semua posisi dengan fee real ──
async function updatePositionFeesWithRealData(positions) {
  if (!positions.length) return;

  for (const pos of positions) {
    try {
      const poolData = await fetchMeteoraPools(pos.pair.base, pos.pair.quote);
      if (!poolData) continue;

      // Simpan pool data ke posisi
      pos.poolData = poolData;

      // Hitung durasi sejak posisi dibuka
      const hoursOpen = (Date.now() - pos.openedAt) / 3600000;

      // Hitung fee realistis
      const feeCalc = calcRealisticFee(poolData, pos.totalUSD, hoursOpen);
      if (!feeCalc) continue;

      // Update fee di posisi (override simulasi dummy)
      pos.feeCollected   = feeCalc.feeProRated;
      pos.realFeeData    = feeCalc;
      pos.dataSource     = 'meteora_real';

    } catch (e) {
      console.warn(`Fee update failed for ${pos.pair.id}:`, e.message);
    }

    // Delay kecil biar ga spam API (max 30 req/s)
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

  const pair     = PAIRS.find(p => p.id === pairId);
  if (!pair) return;

  const poolData = await fetchMeteoraPools(pair.base, pair.quote);

  if (!poolData) {
    container.innerHTML = `<div class="pool-no-data">Pool data tidak tersedia untuk pair ini</div>`;
    return;
  }

  const aprStr = poolData.apr24h ? poolData.apr24h.toFixed(1) + '%' : '—';

  container.innerHTML = `
    <div class="pool-stats-grid">
      <div class="pool-stat">
        <div class="pool-stat-label">Volume 24h</div>
        <div class="pool-stat-value accent">${fmtVolume(poolData.volume24h)}</div>
      </div>
      <div class="pool-stat">
        <div class="pool-stat-label">TVL Pool</div>
        <div class="pool-stat-value">${fmtVolume(poolData.tvl)}</div>
      </div>
      <div class="pool-stat">
        <div class="pool-stat-label">Fee APR (24h)</div>
        <div class="pool-stat-value green">${aprStr}</div>
      </div>
      <div class="pool-stat">
        <div class="pool-stat-label">Bin Step</div>
        <div class="pool-stat-value">${poolData.binStep} bps</div>
      </div>
    </div>
    <div class="pool-source">
      📡 Data: Meteora DLMM API · Pool: ${poolData.address?.slice(0,8)}...
    </div>
  `;
}

// ── Auto refresh fee tiap 5 menit ──
let feeRefreshInterval = null;

function startRealFeeTracking(positions, onUpdate) {
  if (feeRefreshInterval) clearInterval(feeRefreshInterval);

  // Langsung update sekali
  updatePositionFeesWithRealData(positions).then(onUpdate);

  // Lanjut tiap 5 menit
  feeRefreshInterval = setInterval(async () => {
    await updatePositionFeesWithRealData(positions);
    if (onUpdate) onUpdate();
  }, 5 * 60 * 1000);
}

function stopRealFeeTracking() {
  if (feeRefreshInterval) {
    clearInterval(feeRefreshInterval);
    feeRefreshInterval = null;
  }
}
