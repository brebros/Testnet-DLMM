// ═══════════════════════════════════════════
// chart.js — TradingView Lightweight Charts
// Binance OHLCV → Candlestick + Volume
// ═══════════════════════════════════════════

let chartInstance = null;
let candleSeries = null;
let volumeSeries = null;
let currentChartSymbol = null;
let currentTimeframe = '1h';

// Binance klines fetch
async function fetchBinanceKlines(symbol, interval = '1h', limit = 200) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance ${res.status}`);
    const data = await res.json();
    return data.map(k => ({
      time: Math.floor(k[0] / 1000),          // open time → unix seconds
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      value: parseFloat(k[5]),                  // volume for histogram
    }));
  } catch (e) {
    console.warn('Binance fetch failed:', e);
    return null;
  }
}

// Render chart ke container
function renderChart(containerId, pairId, timeframe) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const binanceSymbol = BINANCE_SYMBOLS[pairId];
  if (!binanceSymbol) {
    container.innerHTML = '<div class="chart-unavailable">📉 Chart tidak tersedia untuk pair ini (belum ada di Binance)</div>';
    return;
  }

  // Cleanup existing chart
  if (chartInstance) {
    chartInstance.remove();
    chartInstance = null;
  }

  container.innerHTML = '<div class="chart-loading">Loading chart... 🔄</div>';

  currentTimeframe = timeframe || '1h';
  currentChartSymbol = binanceSymbol;

  fetchBinanceKlines(binanceSymbol, currentTimeframe).then(klines => {
    if (!klines || !klines.length) {
      container.innerHTML = '<div class="chart-unavailable">📉 Data tidak tersedia</div>';
      return;
    }

    container.innerHTML = '';

    // Create chart
    chartInstance = LightweightCharts.createChart(container, {
      width: container.clientWidth,
      height: 280,
      layout: {
        background: { type: 'solid', color: '#0d1117' },
        textColor: '#8b949e',
      },
      grid: {
        vertLines: { color: '#21262d' },
        horzLines: { color: '#21262d' },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: '#22d3ee66', width: 1, style: 2 },
        horzLine: { color: '#22d3ee66', width: 1, style: 2 },
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

    // Candlestick series
    candleSeries = chartInstance.addCandlestickSeries({
      upColor: '#4ade80',
      downColor: '#f87171',
      borderDownColor: '#f87171',
      borderUpColor: '#4ade80',
      wickDownColor: '#f87171',
      wickUpColor: '#4ade80',
    });
    candleSeries.setData(klines);

    // Volume histogram
    volumeSeries = chartInstance.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chartInstance.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeries.setData(klines.map(k => ({
      time: k.time,
      value: k.value,
      color: k.close >= k.open ? '#4ade8033' : '#f8717133',
    })));

    chartInstance.timeScale().fitContent();

    // Auto-resize
    const resizeObserver = new ResizeObserver(entries => {
      if (entries[0] && chartInstance) {
        chartInstance.applyOptions({ width: entries[0].contentRect.width });
      }
    });
    resizeObserver.observe(container);
  });
}

// Timeframe buttons handler
function setTimeframe(tf, pairId) {
  currentTimeframe = tf;
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  renderChart('chart-container', pairId, tf);
}

// Inject chart + timeframe buttons ke DLMM panel
function getChartHTML(pairId) {
  return `
    <div class="dlmm-section">
      <div class="section-label">Price Chart</div>
      <div class="tf-btns">
        <button class="tf-btn ${currentTimeframe === '1m' ? 'active' : ''}" onclick="setTimeframe('1m','${pairId}')">1m</button>
        <button class="tf-btn ${currentTimeframe === '5m' ? 'active' : ''}" onclick="setTimeframe('5m','${pairId}')">5m</button>
        <button class="tf-btn ${currentTimeframe === '15m' ? 'active' : ''}" onclick="setTimeframe('15m','${pairId}')">15m</button>
        <button class="tf-btn ${currentTimeframe === '1h' ? 'active' : ''}" onclick="setTimeframe('1h','${pairId}')">1H</button>
        <button class="tf-btn ${currentTimeframe === '4h' ? 'active' : ''}" onclick="setTimeframe('4h','${pairId}')">4H</button>
        <button class="tf-btn ${currentTimeframe === '1d' ? 'active' : ''}" onclick="setTimeframe('1d','${pairId}')">1D</button>
      </div>
      <div id="chart-container" class="chart-container"></div>
    </div>
  `;
}
