// ═══════════════════════════════════════════
// chart.js — Candlestick chart module
// Data: Binance public API (no key needed)
// Render: TradingView Lightweight Charts
// ═══════════════════════════════════════════

let chartInstance = null;
let candleSeries = null;
let volumeSeries = null;
let chartPair = null;
let autoRefreshInterval = null;

// Map pair ID → Binance symbol
const BINANCE_SYMBOLS = {
  'SOL-USDC':   'SOLUSDC',
  'BONK-USDC':  'BONKUSDC',
  'WIF-USDC':   'WIFUSDC',
  'JUP-USDC':   'JUPUSDC',
  'PYTH-USDC':  'PYTHUSDC',
  'RAY-USDC':   'RAYUSDC',
  'ORCA-USDC':  'ORCAUSDC',
  'JTO-USDC':   'JTOUSDC',
  'POPCAT-USDC':'POPCATUSDC',
  'BOME-USDC':  'BOMEUSDC',
  'MEW-USDC':   'MEWUSDC',
  'SLERF-USDC': 'SLERFUSDC',
  'SAMO-USDC':  'SAMOUSDC',
  'RENDER-USDC':'RENDERUSDC',
  'HNT-USDC':   'HNTUSDC',
  'MOBILE-USDC':'MOBILEUSDC',
  'IOT-USDC':   'IOTUSDC',
  'GMT-USDC':   'GMTUSDC',
  'DRIFT-USDC': 'DRIFTUSDC',
  'ZEUS-USDC':  'ZEUSUSDC',
  'W-USDC':     'WUSDC',
  'TNSR-USDC':  'TNSRUSDC',
  'PONKE-USDC': 'PONKEUSDC',
  'MSOL-SOL':   null, // not on Binance, skip
  'JSOL-SOL':   null,
  'BSOL-SOL':   null,
  'BONK-SOL':   'BONKSOL',
  'WIF-SOL':    'WIFSOL',
  'JUP-SOL':    'JUPSOL',
  'RAY-SOL':    'RAYSOL',
  'MNGO-USDC':  'MNGOUSDC',
  'KMNO-USDC':  null,
  // Stable pairs — use fallback flat line
  'USDC-USDT':  null,
  'USDC-DAI':   null,
  'USDC-PYUSD': null,
  'USDC-FRAX':  null,
  'USDC-USDS':  null,
  'USDT-DAI':   null,
  'USDT-FRAX':  null,
  'USDT-USDS':  null,
  'DAI-FRAX':   null,
  'TUSD-USDC':  null,
};

const INTERVALS = [
  { label: '1m',  value: '1m'  },
  { label: '5m',  value: '5m'  },
  { label: '15m', value: '15m' },
  { label: '1h',  value: '1h'  },
  { label: '4h',  value: '4h'  },
  { label: '1d',  value: '1d'  },
];

let currentInterval = '15m';

// ── Fetch OHLCV dari Binance ──
async function fetchCandles(symbol, interval, limit = 200) {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Binance fetch failed');
    const raw = await res.json();
    return raw.map(k => ({
      time: Math.floor(k[0] / 1000),
      open:  parseFloat(k[1]),
      high:  parseFloat(k[2]),
      low:   parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  } catch (e) {
    console.warn('Binance candle fetch failed:', e);
    return null;
  }
}

// ── Stable pair fallback: generate flat candles ──
function generateStableCandles() {
  const candles = [];
  const now = Math.floor(Date.now() / 1000);
  for (let i = 199; i >= 0; i--) {
    const base = 1 + (Math.random() - 0.5) * 0.0002;
    candles.push({
      time: now - i * 900,
      open:  parseFloat((base + (Math.random()-0.5)*0.0001).toFixed(6)),
      high:  parseFloat((base + Math.random()*0.0001).toFixed(6)),
      low:   parseFloat((base - Math.random()*0.0001).toFixed(6)),
      close: parseFloat((base + (Math.random()-0.5)*0.0001).toFixed(6)),
      volume: Math.random() * 500000,
    });
  }
  return candles;
}

// ── Init chart dalam container ──
function initChart(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Destroy existing
  if (chartInstance) {
    chartInstance.remove();
    chartInstance = null;
    candleSeries = null;
    volumeSeries = null;
  }

  chartInstance = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight || 280,
    layout: {
      background: { color: '#161b22' },
      textColor: '#8b949e',
    },
    grid: {
      vertLines: { color: '#21262d' },
      horzLines: { color: '#21262d' },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
    },
    rightPriceScale: {
      borderColor: '#30363d',
    },
    timeScale: {
      borderColor: '#30363d',
      timeVisible: true,
      secondsVisible: false,
    },
  });

  candleSeries = chartInstance.addCandlestickSeries({
    upColor:        '#4ade80',
    downColor:      '#f87171',
    borderUpColor:  '#4ade80',
    borderDownColor:'#f87171',
    wickUpColor:    '#4ade80',
    wickDownColor:  '#f87171',
  });

  volumeSeries = chartInstance.addHistogramSeries({
    color: '#22d3ee',
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
    scaleMargins: { top: 0.85, bottom: 0 },
  });

  // Resize observer
  const ro = new ResizeObserver(() => {
    if (chartInstance && container) {
      chartInstance.applyOptions({ width: container.clientWidth });
    }
  });
  ro.observe(container);
}

// ── Load candle data ke chart ──
async function loadChartData(pairId, interval) {
  const symbol = BINANCE_SYMBOLS[pairId];
  let candles;

  if (!symbol) {
    // Stable pair atau ga ada di Binance
    candles = generateStableCandles();
  } else {
    candles = await fetchCandles(symbol, interval);
    if (!candles) candles = generateStableCandles();
  }

  if (!candleSeries || !volumeSeries) return;

  candleSeries.setData(candles);
  volumeSeries.setData(candles.map(c => ({
    time: c.time,
    value: c.volume,
    color: c.close >= c.open ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)',
  })));

  chartInstance.timeScale().fitContent();
}

// ── Render chart section dalam DLMM panel ──
function renderChartSection(pairId) {
  chartPair = pairId;
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);

  const html = `
    <div class="chart-section">
      <div class="chart-toolbar">
        <div class="chart-pair-label" id="chart-pair-label">${pairId.replace('-','/')}</div>
        <div class="interval-btns" id="interval-btns">
          ${INTERVALS.map(iv => `
            <button class="iv-btn ${iv.value === currentInterval ? 'sel' : ''}"
              onclick="changeInterval('${iv.value}')">${iv.label}</button>
          `).join('')}
        </div>
        <div class="chart-status" id="chart-status">Loading...</div>
      </div>
      <div id="candle-container" class="candle-container"></div>
    </div>
  `;

  return html;
}

async function mountChart(pairId) {
  // Tunggu DOM ready
  await new Promise(r => setTimeout(r, 50));
  initChart('candle-container');
  await loadChartData(pairId, currentInterval);
  document.getElementById('chart-status').textContent = BINANCE_SYMBOLS[pairId] ? 'Live · Binance' : 'Simulated · Stable';

  // Auto refresh tiap 30 detik
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  autoRefreshInterval = setInterval(async () => {
    if (!chartPair) return;
    const symbol = BINANCE_SYMBOLS[chartPair];
    if (!symbol) return;
    const candles = await fetchCandles(symbol, currentInterval, 5);
    if (candles && candleSeries) {
      candles.forEach(c => {
        candleSeries.update(c);
        volumeSeries.update({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)' });
      });
    }
  }, 30000);
}

async function changeInterval(iv) {
  currentInterval = iv;
  document.querySelectorAll('.iv-btn').forEach(b => b.classList.remove('sel'));
  event.target.classList.add('sel');
  document.getElementById('chart-status').textContent = 'Loading...';
  await loadChartData(chartPair, iv);
  document.getElementById('chart-status').textContent = BINANCE_SYMBOLS[chartPair] ? 'Live · Binance' : 'Simulated · Stable';
}
