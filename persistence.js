// ═══════════════════════════════════════════
// persistence.js — State persistence module
// Strategy: localStorage primary + Gist cloud backup
// Auto-save tiap 10 detik + setiap ada perubahan state
// ═══════════════════════════════════════════

const STORAGE_KEY = 'dlmm_testnet_state';
const SAVE_VERSION = '2.0';

// ── Serialize state untuk disimpan ──
function serializeState() {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    wallet: STATE.wallet,
    balances: STATE.balances,
    lastFaucet: STATE.lastFaucet,
    positions: STATE.positions.map(pos => ({
      id: pos.id,
      pairId: pos.pairId,
      pairBase: pos.pair.base,
      pairQuote: pos.pair.quote,
      baseAmt: pos.baseAmt,
      quoteAmt: pos.quoteAmt,
      entryPrice: pos.entryPrice,
      totalUSD: pos.totalUSD,
      feeTier: pos.feeTier,
      binStep: pos.binStep,
      strategy: pos.strategy,
      rangeMin: pos.rangeMin,
      rangeMax: pos.rangeMax,
      feeCollected: pos.feeCollected,
      openedAt: pos.openedAt,
      deployTs: pos.deployTs,
      lastChecked: pos.lastChecked,
      oorSince: pos.oorSince,
      feePerDay: pos.feePerDay,
      swapCount: pos.swapCount,
      dataSource: pos.dataSource,
      lowYieldWarning: pos.lowYieldWarning,
      poolData: pos.poolData || null,
      realFeeData: pos.realFeeData || null,
    })),
  };
}

// ── Deserialize state dari storage ──
function deserializeState(data) {
  if (!data || data.version !== SAVE_VERSION) return null;

  // Restore positions dengan pair object lengkap
  const positions = (data.positions || []).map(p => {
    const pair = PAIRS.find(pr => pr.id === p.pairId);
    if (!pair) return null;
    return {
      ...p,
      pair,
      // Pastikan field baru ada (backward compat)
      deployTs: p.deployTs || p.openedAt,
      lastChecked: p.lastChecked || Date.now(),
      oorSince: p.oorSince || null,
      feePerDay: p.feePerDay || 0,
      dataSource: p.dataSource || 'sim',
      lowYieldWarning: p.lowYieldWarning || false,
      poolData: p.poolData || null,
      realFeeData: p.realFeeData || null,
    };
  }).filter(Boolean);

  return {
    wallet: data.wallet,
    balances: data.balances || {},
    lastFaucet: data.lastFaucet,
    positions,
  };
}

// ── Save ke localStorage ──
function saveToLocal() {
  try {
    const data = serializeState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('localStorage save failed:', e);
    return false;
  }
}

// ── Load dari localStorage ──
function loadFromLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return deserializeState(JSON.parse(raw));
  } catch (e) {
    console.warn('localStorage load failed:', e);
    return null;
  }
}

// ── Save ke Gist (cloud backup) ──
async function saveToGist(gistId, token) {
  if (!gistId || !token) return false;
  try {
    const data = serializeState();
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: {
          'dlmm-state.json': {
            content: JSON.stringify(data, null, 2),
          },
        },
      }),
    });
    return res.ok;
  } catch (e) {
    console.warn('Gist save failed:', e);
    return false;
  }
}

// ── Load dari Gist (cloud) ──
async function loadFromGist(gistId) {
  if (!gistId) return null;
  try {
    const res = await fetch(
      `https://gist.githubusercontent.com/raw/${gistId}/dlmm-state.json?t=${Date.now()}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return deserializeState(data);
  } catch (e) {
    console.warn('Gist load failed:', e);
    return null;
  }
}

// ── Apply restored state ke STATE global ──
function applyRestoredState(restored) {
  if (!restored) return false;

  STATE.wallet = restored.wallet;
  STATE.balances = restored.balances;
  STATE.lastFaucet = restored.lastFaucet;
  STATE.positions = restored.positions;

  // Update UI
  if (STATE.wallet) {
    document.getElementById('wallet-addr').textContent =
      STATE.wallet.slice(0,6) + '...' + STATE.wallet.slice(-4);
    document.getElementById('connect-btn').textContent = 'Disconnect';
    document.getElementById('connect-btn').onclick = disconnectWallet;
    document.getElementById('faucet-btn').disabled = false;
  }

  // Restart fee accumulation untuk posisi yang ada
  STATE.positions.forEach(pos => {
    startFeeAccumulation(pos);
  });

  // Refresh Meteora data untuk posisi yang ada
  if (STATE.positions.length > 0) {
    startRealFeeTracking(STATE.positions, () => {
      renderPositionList();
      updateTotalBalance();
    });
  }

  renderTokenList();
  renderPositionList();
  updateTotalBalance();

  return true;
}

// ── Init persistence — load state saat app start ──
async function initPersistence() {
  const indicator = document.getElementById('persist-indicator');

  // 1. Coba load dari localStorage dulu (cepat, offline)
  const localData = loadFromLocal();
  if (localData && localData.positions.length > 0) {
    applyRestoredState(localData);
    if (indicator) {
      indicator.textContent = '💾 Local';
      indicator.title = 'State loaded from localStorage';
    }
    console.log('State restored from localStorage:', localData.positions.length, 'positions');
  }

  // 2. Coba load dari Gist (cloud, mungkin lebih fresh)
  const gistId = localStorage.getItem('dlmm_gist_id');
  if (gistId) {
    try {
      const cloudData = await loadFromGist(gistId);
      if (cloudData && cloudData.savedAt > (localData?.savedAt || 0)) {
        applyRestoredState(cloudData);
        if (indicator) {
          indicator.textContent = '☁️ Cloud';
          indicator.title = 'State loaded from Gist (more recent)';
        }
        console.log('State restored from Gist (more recent)');
      }
    } catch (e) {
      console.warn('Cloud load failed, using local state');
    }
  }

  if (!localData && !gistId) {
    if (indicator) {
      indicator.textContent = '🆕 Fresh';
      indicator.title = 'New session';
    }
  }

  // 3. Setup auto-save tiap 10 detik
  setInterval(() => {
    saveToLocal();
    // Gist save tiap 5 menit (rate limit friendly)
  }, 10000);

  // Gist auto-save tiap 5 menit
  const token = localStorage.getItem('dlmm_gist_token');
  if (gistId && token) {
    setInterval(async () => {
      const ok = await saveToGist(gistId, token);
      if (indicator && ok) {
        const prev = indicator.textContent;
        indicator.textContent = '☁️ Synced';
        setTimeout(() => indicator.textContent = prev, 2000);
      }
    }, 5 * 60 * 1000);
  }
}

// ── Save dipanggil setiap kali state berubah ──
function persistState() {
  saveToLocal();
  // Gist save non-blocking
  const gistId = localStorage.getItem('dlmm_gist_id');
  const token = localStorage.getItem('dlmm_gist_token');
  if (gistId && token) {
    saveToGist(gistId, token).catch(() => {});
  }
}

// ── Settings modal untuk input Gist credentials ──
function openSettingsModal() {
  const existingGistId = localStorage.getItem('dlmm_gist_id') || '';
  const existingToken = localStorage.getItem('dlmm_gist_token') || '';

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'settings-modal';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-title">⚙️ Settings</div>
      <p class="modal-desc">Configure cloud sync via GitHub Gist.</p>
      <label class="lbl" style="font-size:12px;color:var(--text2);margin-bottom:4px;display:block;">Gist ID</label>
      <input type="text" id="settings-gist-id" class="input-field" placeholder="e.g. bb14dd9aa..." value="${existingGistId}">
      <label class="lbl" style="font-size:12px;color:var(--text2);margin:8px 0 4px;display:block;">GitHub PAT (write access)</label>
      <input type="password" id="settings-token" class="input-field" placeholder="ghp_..." value="${existingToken}">
      <div style="font-size:11px;color:var(--text3);margin-top:4px;">Token hanya disimpan di localStorage browser ini. Tidak dikirim ke server lain.</div>
      <button class="btn-primary full" onclick="saveSettings()" style="margin-top:12px;">Save Settings</button>
      <button class="btn-ghost full" onclick="document.getElementById('settings-modal').remove()">Cancel</button>
    </div>
  `;
  document.body.appendChild(modal);
}

function saveSettings() {
  const gistId = document.getElementById('settings-gist-id').value.trim();
  const token = document.getElementById('settings-token').value.trim();
  if (gistId) localStorage.setItem('dlmm_gist_id', gistId);
  if (token) localStorage.setItem('dlmm_gist_token', token);
  document.getElementById('settings-modal').remove();
  showToast('✅ Settings saved! Cloud sync aktif.');
  // Test sync sekarang
  saveToGist(gistId, token).then(ok => {
    showToast(ok ? '☁️ Cloud sync berhasil!' : '❌ Cloud sync gagal, cek Gist ID & token');
  });
}

// ── Reset semua state ──
function resetAllState() {
  if (!confirm('Reset semua posisi, balances, dan history? Tidak bisa di-undo.')) return;
  localStorage.removeItem(STORAGE_KEY);
  STATE.wallet = null;
  STATE.balances = {};
  STATE.positions = [];
  STATE.lastFaucet = null;
  disconnectWallet();
  showToast('🗑️ State direset. Fresh start!');
}
