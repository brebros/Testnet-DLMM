# DLMM MASTERY — Hermes Agent Knowledge Base
> Versi: Pro Edition
> Status: Core knowledge file — baca SELURUHNYA sebelum sesi LP pertama.
> Update Lesson Log setelah SETIAP posisi ditutup tanpa pengecualian.

---

## FILOSOFI DASAR

LP di DLMM bukan soal "pasang modal dan tunggu." LP yang bagus adalah:
1. **Risk manager pertama, yield chaser kedua** — lindungi modal dulu, profit mengikuti
2. **Thesis-driven** — setiap posisi punya alasan yang bisa dijelaskan dalam 2 kalimat
3. **Data-driven** — keputusan berdasarkan angka (volume, TVL, fee APR), bukan feeling
4. **Adaptive** — kalau kondisi berubah, posisi harus ikut berubah

Kalau tidak bisa jelaskan kenapa membuka posisi ini dalam 2 kalimat → jangan buka.

---

## BAGIAN 1: CORE MECHANICS

### 1.1 Bin System

Setiap pool DLMM dibagi jadi ribuan "bin" — kotak harga diskrit dengan lebar tetap. Bayangkan seperti rak toko: setiap rak = satu bin, harga naik = pindah ke rak atas.

```
Bin -3: $148.50 - $149.25  ░░░░░░ (kosong, harga sudah lewat)
Bin -2: $149.25 - $150.00  ████░░ (sebagian terpakai)
Bin -1: $150.00 - $150.75  ██████ ← ACTIVE BIN (harga sekarang)
Bin  0: $150.75 - $151.50  ██████ (menunggu)
Bin +1: $151.50 - $152.25  ████░░ (menunggu)
```

**Yang penting dipahami:**
- Fee HANYA generate di bin aktif saat ada swap
- Bin aktif berpindah mengikuti harga pasar
- Kalau harga keluar dari semua bin → posisi OOR, fee berhenti total

### 1.2 Bin Step

Bin step = lebar tiap bin dalam basis points. 1 bps = 0.01%.

```
Bin Step 1 bps  → tiap bin = 0.01% range → 100 bin = 1% total range
Bin Step 10 bps → tiap bin = 0.10% range → 100 bin = 10% total range
Bin Step 50 bps → tiap bin = 0.50% range → 100 bin = 50% total range
```

| Bin Step | Cocok untuk | Contoh pair |
|----------|------------|-------------|
| 1-2 bps | Stable pairs | USDC-USDT, USDC-DAI |
| 5-10 bps | Liquid majors | SOL-USDC (volume tinggi) |
| 10-25 bps | Mid-cap established | JUP, RAY, ORCA, PYTH |
| 50-80 bps | Meme/volatile | BONK, WIF, POPCAT |
| 80-125 bps | Extreme volatile | Token baru, low TVL |

**Rule of thumb:** Ambil 7-day price range, bagi 100 → itu bin step yang pas.
Contoh: SOL range $140-$160 dalam 7 hari = 20% / 100 = 0.2% = 20 bps.

### 1.3 Fee Tier

Fee tier = persentase yang dipotong dari setiap swap yang lewat pool kamu.

```
Total Fee Kamu = Volume Swap × Fee Tier × (Modal Kamu / TVL Pool)
```

Fee tier bukan pilihan bebas — setiap pool sudah fix fee tier-nya saat dibuat.

| Fee Tier | Untuk pair | Logic |
|----------|-----------|-------|
| 0.01% | Stable (USDC-USDT) | Volume gede, trader sensitif harga, IL hampir nol |
| 0.05% | Near-stable | Sedikit lebih volatile tapi masih predictable |
| 0.3% | Major volatile | Standard untuk most crypto pairs |
| 1%+ | Meme/exotic | Kompensasi IL yang besar, trader less price-sensitive |

**Kesalahan umum:** Kejar fee tier tinggi tanpa lihat volume. Pool fee 1% dengan volume $10K/hari hasilnya LEBIH KECIL dari pool fee 0.3% dengan volume $1M/hari.

### 1.4 Price Range & Capital Efficiency

Range sempit = modal lebih terkonsentrasi = fee per dollar lebih besar, TAPI risiko OOR lebih tinggi.

```
Range ±5%  → Capital efficiency 20x vs full-range AMM → Sering OOR
Range ±15% → Capital efficiency 7x  vs full-range AMM → Balance
Range ±30% → Capital efficiency 3x  vs full-range AMM → Jarang OOR
```

**Formula target range:**
```
Sideways market:   range = ±(7-day volatility × 1.2)
Trending market:   range = ±(7-day volatility × 1.5), lebih lebar ke arah trend
Volatile market:   range = ±(7-day volatility × 2.0)
```

---

## BAGIAN 2: STRATEGI DISTRIBUSI DETAIL

### 2.1 Spot (Uniform Distribution)

```
Bin -5: ████████  12.5%
Bin -4: ████████  12.5%
Bin -3: ████████  12.5%
Bin -2: ████████  12.5%
Bin -1: ████████  12.5% ← ACTIVE BIN
Bin  0: ████████  12.5%
Bin +1: ████████  12.5%
Bin +2: ████████  12.5%
```

**Matematika:** Modal/jumlah_bin = alokasi per bin (uniform)

**Kapan pakai:**
- Pertama kali masuk pair baru (belum ada data)
- Market kondisi mixed/unclear
- Pair dengan volume konsisten sepanjang hari
- Anchor position yang tidak perlu monitoring ketat

**Kapan hindari:**
- Punya conviction kuat market akan sideways (lebih baik Curve)
- Punya conviction kuat market akan breakout (lebih baik Bid-Ask)

**Expected outcome:** Fee konsisten tapi tidak maksimal, IL moderate, paling tahan OOR

---

### 2.2 Curve (Bell/Normal Distribution)

```
Bin -5: ██░░░░░░   5%
Bin -4: ████░░░░  15%
Bin -3: ██████░░  35%
Bin -2: ████████  70%  ← AREA FOKUS
Bin -1: ██████████ 100% ← ACTIVE BIN
Bin  0: ██████████ 100% ← ACTIVE BIN
Bin +1: ████████  70%
Bin +2: ██████░░  35%
Bin +3: ████░░░░  15%
Bin +4: ██░░░░░░   5%
```

**Matematika:** weight[i] = 1 - |i - mid| / mid → normalized

**Kapan pakai:**
- Market ranging dengan support-resistance yang jelas
- Pair major dengan volatilitas rendah (24h change < 3%)
- Setelah periode volatile dan market mulai konsolidasi
- Stable pair yang harganya selalu balik ke peg

**Signal spesifik:**
- RSI 40-60 (neutral zone)
- Bollinger Bands menyempit
- Volume turun tapi steady

**Kapan hindari:**
- Menjelang event besar
- Market sedang trending kuat satu arah
- Token baru dengan harga belum "settle"

**⚠️ RULE KRITIS: "Curve + Trending = TRAP"**
JTO-USDC trend turun pakai Curve = IL terus nambah walau masih in range.
JANGAN pakai Curve saat harga trending.

**Expected outcome:** Fee tertinggi saat sideways, IL paling kecil, TAPI paling parah kalau harga breakout

---

### 2.3 Bid-Ask (Bimodal/U-Shape Distribution)

```
Bin -5: ██████████ 100% ← BID (beli)
Bin -4: ████████   70%
Bin -3: ██████░░   40%
Bin -2: ████░░░░   10%
Bin -1: ░░░░░░░░    0% ← KOSONG (active bin)
Bin  0: ░░░░░░░░    0% ← KOSONG
Bin +1: ████░░░░   10%
Bin +2: ██████░░   40%
Bin +3: ████████   70%
Bin +4: ██████████ 100% ← ASK (jual)
```

**Matematika:** weight[i] = 0.1 + |i - mid| / mid → normalized

**Kapan pakai:**
- Volatile market (24h change > 5%)
- Trending market dengan kemungkinan retracement
- Pair meme dengan volume tinggi tapi harga ga stabil
- Sebelum event besar yang bisa pump atau dump

**Signal spesifik:**
- 24h change > 5% ke arah manapun
- Volume spike tidak beraturan
- Harga sering rejection di level support/resistance

**Kapan hindari:**
- Market dead (volume < $100K/day)
- Harga trending satu arah tanpa retracement

**Kelebihan vs Curve di volatile:**
- Kalau BONK rebound → collect fee dari swing naik
- Kalau BONK lanjut turun → lebih tahan IL dari Curve
- Modal di pinggir = lebih tahan trending market

**Expected outcome:** Fee besar saat volatile, IL lebih terkontrol

---

### 2.4 Aggressive (Skewed/One-Sided Distribution)

```
Bullish Aggressive:
Bin -5: ██████████ 100% ← SEMUA MODAL DI SINI
Bin -4: ████████   80%
Bin -3: ██████░░   50%
Bin -2: ████░░░░   20%
Bin -1: ░░░░░░░░    0%
Bin  0: ░░░░░░░░    0% ← ACTIVE BIN
Bin +1: ░░░░░░░░    0%
Bin +2: ░░░░░░░░    0%
```

**Kapan pakai:**
- Punya conviction SANGAT KUAT tentang arah harga
- Setup entry price spesifik (DCA otomatis)
- Event-driven: listing, announcement, token unlock
- Recovery play: harga udah turun banyak, yakin akan balik

**⚠️ WARNING:**
- Prediksi salah = IL parah
- HANYA untuk high conviction dengan data kuat
- Butuh stop-loss mental yang ketat
- Bukan LP biasa — lebih mirip limit order otomatis

**Expected outcome:** Fee maksimal kalau prediksi bener, IL maksimal kalau salah

---

### 2.5 Delta-Neutral (Advanced Hedged Strategy)

```
Implementasi:
LP Position (Bid-Ask): +$500 SOL-USDC  → generate fee
Short Position (perp): -$500 SOL        → hedge IL
─────────────────────────────────────────
Net SOL exposure: $0 (delta neutral)
Fee earned: 100% pure profit
IL: di-hedge oleh short position
```

**Konsep:**
Buka LP position untuk collect fee, SEKALIGUS buka short di perpetual futures dengan size yang sama. Ketika harga SOL turun → LP kena IL tapi short profit, saling cancel.

**Kapan pakai:**
- Mau yield farming tanpa risiko harga
- Market maker profesional
- Arbitrage antara spot dan perpetual
- Modal besar yang perlu diproteksi

**Requirements:**
- Akses perpetual futures (dYdX, Drift, Zeta Markets di Solana)
- Modal LP + margin untuk short (biasanya 2x modal)
- Understanding funding rate (short perp ada funding cost)
- Monitoring lebih ketat (dua posisi sekaligus)

**Trade-off:**
```
Profit  = Fee LP - Funding rate short - Gas cost
IL      = ~0 (di-hedge)
Risk    = Funding rate bisa makan profit kalau lama
```

**Expected outcome:** Yield stabil tanpa directional risk, tapi lebih kompleks dan butuh modal lebih besar

**⚠️ BELUM tersedia di simulator testnet — butuh integrasi perpetual protocol**

---

### 2.6 Reseed (Bukan Strategi, Tapi Action)

Tutup posisi OOR → buka posisi baru di range harga sekarang.

**Kapan Reseed:**
- Posisi OOR > 30-60 menit
- Tidak ada tanda harga akan balik dalam 1-2 jam
- Fee yang hilang selama OOR > biaya gas untuk reseed (~$0.10-0.30)

**Kapan TIDAK Reseed:**
- Harga baru saja keluar range dan kemungkinan besar balik
- Gas cost > 20% dari fee harian yang diharapkan
- Market sedang sangat volatile — tunggu arah jelas dulu

---

### 2.7 Decision Tree Strategi

```
Mau pasang posisi DLMM?
│
├─ Yakin arah harga?
│  ├─ YA → Aggressive (one-sided)
│  └─ TIDAK
│     │
│     ├─ Market sideways? (24h < 3%)
│     │  ├─ YA → Curve (numpuk tengah)
│     │  └─ TIDAK
│     │     │
│     │     ├─ Market volatile? (24h > 5%)
│     │     │  ├─ YA → Bid-Ask (numpuk pinggir)
│     │     │  └─ TIDAK → Spot (nyebar rata)
│     │     │
│     │     └─ Mau zero IL? (advanced)
│     │        └─ YA → Delta-Neutral (butuh hedge perp)
│
└─ Tidak yakin sama sekali → Spot (selalu aman)
```

### 2.8 Comparison Table

| Strategi | Risk | Reward | Capital Eff. | IL Risk | Cocok Market |
|----------|------|--------|--------------|---------|--------------|
| Spot | 🟢 Rendah | 🟢 Rendah | 🟡 Sedang | 🟢 Rendah | Sideways/Any |
| Curve | 🟡 Sedang | 🟢 Tinggi | 🔴 Tinggi | 🔴 Tinggi | Sideways ONLY |
| Bid-Ask | 🟡 Sedang | 🟡 Sedang | 🟡 Sedang | 🟡 Sedang | Volatile/Trending |
| Aggressive | 🔴 Tinggi | 🔴 Tinggi | 🔴 Tinggi | 🔴 Tinggi | Strong Conviction |
| Delta-Neutral | 🟢 Rendah | 🟡 Sedang | 🟡 Sedang | 🟢 Nol | Any (hedged) |

---

## BAGIAN 3: MEMBACA KONDISI MARKET

### 3.1 Framework Analisis (Baca Dalam Urutan Ini)

```
Step 1: SOL price action (semua pair Solana correlated)
Step 2: Volume pool target 24h vs 7-day average
Step 3: TVL pool (naik/turun dari kemarin?)
Step 4: Fee APR 24h (indikator seberapa aktif pool)
Step 5: Price range 7 hari (untuk set range yang tepat)
Step 6: Baru decide strategi & range
```

### 3.2 Market Condition Matrix

| Kondisi | SOL 24h | Volume | Volatility | Action Terbaik |
|---------|---------|--------|------------|----------------|
| Bull trending | +5%+ | Naik | Sedang | Spot, range asimetris atas |
| Bear trending | -5%+ | Naik | Sedang | Spot, range asimetris bawah |
| Sideways bull | +1-3% | Stabil | Rendah | Curve, range sempit |
| Sideways bear | -1-3% | Stabil | Rendah | Curve, range sempit |
| Volatile choppy | ±5%+ | Spike | Tinggi | Bid-Ask, range lebar |
| Dead market | <1% | Turun | Sangat rendah | Skip atau harvest saja |
| Pre-event | Mixed | Naik | Naik | Lebar range atau tunggu |
| Post-pump | -10%+ | Tinggi | Sangat tinggi | Hindari, tunggu settle |

### 3.3 Multi-Position Correlation

Ini yang sering dilupakan pemula. Semua pair SOL-based BERKORELASI TINGGI.

```
Kalau SOL turun 10%:
→ SOL-USDC: harga SOL drop, posisi kemungkinan OOR ke bawah
→ JUP-USDC: JUP biasanya follow SOL, ikut drop
→ BONK-USDC: BONK lebih volatile, bisa drop 15-20%
→ MSOL-SOL: pair LST-SOL lebih stabil (keduanya move bareng)
```

**Implikasi praktis:**
- Jangan full allocate ke semua pair SOL-based dengan range yang sama
- Kalau punya 5 posisi dan semuanya SOL correlated → satu event bisa OOR semua
- Diversifikasi NYATA = mix pair yang tidak berkorelasi (stable pair + meme + LST pair)

### 3.4 Volume Pattern Reading

```
Volume Pattern          → Interpretasi
─────────────────────────────────────────
Spike volume + naik     → Breakout bullish, pertimbangkan Spot/Aggressive
Spike volume + turun    → Sell pressure, hati-hati atau skip
Volume naik gradual     → Akumulasi, sideways → Curve
Volume turun gradual    → Distribusi atau dead, pertimbangkan harvest
Volume flat + harga flat→ Konsolidasi sehat → Curve dengan range sempit
Volume sangat rendah    → Hindari, fee tidak worth
```

### 3.5 Timing LP (Jam Berdasarkan Volume)

Volume tidak merata sepanjang hari. Pattern umum (UTC):

```
00:00-06:00 UTC  → Volume rendah (Asia sleeping, US sleeping)
06:00-10:00 UTC  → Volume mulai naik (Asia/EU morning)
10:00-16:00 UTC  → Volume tertinggi (EU full hours)
14:00-22:00 UTC  → Volume peak (EU + US overlap)
22:00-00:00 UTC  → Volume turun (US evening)
```

**Praktis:** Buka posisi baru saat volume mulai naik (06:00-10:00 UTC) bukan saat volume sedang peak — karena fee sudah berjalan dan posisi sudah "warm up" saat peak.

---

## BAGIAN 4: POOL METRICS INTERPRETATION

### 4.1 Key Metrics dan Cara Baca

**Volume 24h**
```
< $50K    → Terlalu sepi, skip
$50K-$500K → Acceptable untuk meme/small cap
$500K-$5M → Good untuk mid-tier
> $5M     → Excellent, major pair territory
```

**TVL (Total Value Locked)**
```
< $10K    → Micro pool, risiko tinggi (mudah dimanipulasi)
$10K-$100K → Small pool
$100K-$1M → Medium pool
> $1M     → Large pool, lebih stabil
```

**Fee/TVL Ratio (24h)**
```
< 0.1%   → Dead pool atau terlalu besar TVL-nya
0.1-0.5% → Average
0.5-2%   → Good
2-5%     → Excellent
> 5%     → Suspicious, cek apakah volume organik
```

**APR (24h annualized)**
```
< 10%    → Skip kecuali stable pair
10-50%   → Average LP return
50-150%  → Good, ini target range
150-300% → Excellent tapi volatile
> 300%   → Terlalu tinggi, kemungkinan tidak sustainable
```

**Modal Kamu / TVL Pool (Share)**
```
< 0.1%  → Terlalu kecil, tidak signifikan
0.1-1%  → Normal untuk retail LP
1-5%    → Kamu sudah cukup signifikan, perhatikan slippage
> 5%    → Kamu terlalu dominan, exit kamu bisa impact pool
> 10%   → Hindari, ini territory whale
```

### 4.2 Organic Score (Meteora)

Organic score mengukur seberapa "genuine" volume pool — bukan dari bot atau wash trading.

```
0-30   → Bot-heavy, volume tidak organik → skip
30-60  → Mixed, ada organic tapi ada bot juga → hati-hati
60-80  → Mostly organic → acceptable
80-100 → Highly organic → preferred
```

Organic score < 40 dengan APR > 200% = red flag besar. Volume kemungkinan wash trading.

### 4.3 Smart Money Signals

Top LPer di pool = alpha gratis. Perhatikan:
- Berapa lama mereka hold posisi? (durasi pendek = pair tidak reliable)
- Win rate mereka berapa? (> 70% = pool yang worth)
- Kapan mereka masuk/keluar? (pelajari timing-nya)

---

## BAGIAN 5: IMPERMANENT LOSS — DEEP UNDERSTANDING

### 5.1 Formula IL yang Benar

```
Price Ratio = Current Price / Entry Price
LP Value    = Entry Value × 2√(Price Ratio) / (1 + Price Ratio)
Hold Value  = Entry Value × (0.5 + 0.5 × Price Ratio)
IL          = LP Value - Hold Value
IL %        = (2√r / (1+r) - 1) × 100  dimana r = price ratio
```

### 5.2 IL Quick Reference Table

| Perubahan Harga | IL |
|----------------|-----|
| ±5% | -0.06% |
| ±10% | -0.25% |
| ±20% | -1.01% |
| ±30% | -2.29% |
| ±50% | -5.72% |
| ±75% | -13.4% |
| ±100% (2x) | -20.0% |
| ±200% (3x) | -42.3% |

**Insight kritis:** IL baru terasa signifikan setelah harga bergerak > 20%. Di bawah itu, fee dari pool yang active volume biasanya lebih dari cukup untuk cover IL.

### 5.3 Break-Even Calculation

Berapa fee yang dibutuhkan untuk break even dari IL?

```
Break-even fee = |IL Amount| 
Break-even time = Break-even fee / (Daily fee rate × Modal)

Contoh:
- Modal: $1000
- IL: -$25 (harga bergerak 50%)
- Daily fee rate: 0.3% dari modal = $3/hari
- Break-even: $25 / $3 = 8.3 hari

Kalau posisi masih in-range setelah 8 hari → sudah profit vs hold
```

### 5.4 Kapan IL Tidak Masalah

IL tidak masalah jika:
1. Fee collected > IL — net positive tetap
2. Kamu memang ingin "swap" token secara bertahap (DCA effect)
3. Kedua token dalam pair adalah aset yang ingin kamu hold jangka panjang

IL SANGAT masalah jika:
1. Kamu LP dengan token yang bearish fundamental
2. Fee tidak cukup karena volume rendah
3. Posisi OOR lama dan harga tidak balik

---

## BAGIAN 6: POSITION SIZING & RISK MANAGEMENT

### 6.1 Portfolio Allocation Rules

```
Total di LP          ≤ 70% portfolio (sisakan 30% cash/reserve)
Per posisi single    ≤ 20% portfolio
Per pair Tier 3      ≤ 10% portfolio
Max open positions   = 5-7 (supaya bisa dipantau tiap posisi)
Cash reserve         ≥ 10% untuk gas, reseed, opportunity
```

### 6.2 Ideal Portfolio Mix (Contoh $10,000)

```
$4,000 (40%) → Tier 1 (SOL-USDC, JUP-USDC): 2-3 posisi
$2,500 (25%) → Tier 2 (PYTH, RAY, ORCA): 2-3 posisi
$1,500 (15%) → Stable pairs (USDC-USDT, USDC-DAI): 1-2 posisi
$1,000 (10%) → Tier 3 meme (BONK, WIF): 1-2 posisi max
$1,000 (10%) → Cash reserve
```

### 6.3 Exit Rules (Wajib Set Sebelum Buka Posisi)

Setiap posisi HARUS punya exit rules yang ditetapkan sebelum modal masuk:

```
Stop Loss    : Tutup kalau IL > X% dari modal (default: 15%)
Take Profit  : Tutup kalau fee collected > Y% dari modal (default: 5%)
OOR Timeout  : Tutup/reseed kalau OOR > Z menit (default: 30 menit)
Low Yield    : Tutup kalau fee/hari < W% setelah 2 jam (default: 0.05%/hari)
Max Duration : Tutup setelah N jam terlepas dari hasil (default: 48 jam)
```

### 6.4 Gas Cost Consideration

Gas di Solana murah tapi tetap perlu diperhitungkan:

```
Open position:   ~$0.05-0.15
Close position:  ~$0.05-0.15
Claim fees:      ~$0.03-0.08
Reseed:          ~$0.10-0.30 (close + open)

Rule: Reseed hanya worth kalau daily fee > 5× gas cost reseed
Contoh: Gas reseed $0.20 → daily fee harus > $1.00 untuk worth it
```

---

## BAGIAN 7: RED FLAGS & COMMON MISTAKES

### 7.1 Red Flags — Jangan Deploy

**Pool-level red flags:**
- [ ] Volume spike > 5× tanpa berita jelas → kemungkinan manipulasi
- [ ] TVL turun > 20% dalam 24 jam → whale exit
- [ ] Fee APR > 500% untuk pool yang sudah > 7 hari → tidak sustainable
- [ ] Organic score < 40
- [ ] Top 10 holders > 60% supply
- [ ] Pool umur < 24 jam untuk meme token
- [ ] Volume 24h < $50K untuk non-stable pair

**Token-level red flags:**
- [ ] Harga sudah pump > 50% dalam 24 jam tanpa fundamental → FOMO trap
- [ ] Token dari launchpad yang diketahui problematic
- [ ] Deployer wallet ada di blacklist
- [ ] Liquidity sangat rendah di pool selain yang kamu masuki
- [ ] Social activity sudden spike tanpa substansi (coordinated shilling)

**Timing red flags:**
- [ ] Masuk posisi tepat sebelum major event (FOMC, CPI, Solana network upgrade)
- [ ] Masuk posisi saat market sedang panik sell (bisa salah arah)
- [ ] Masuk posisi saat gas sangat tinggi (network congested)

### 7.2 Common Mistakes LP Pemula

**Mistake 1: Chasing APR tinggi tanpa cek volume**
```
SALAH: "APR 1000%! Masuk semua!"
BENAR: APR 1000% = Fee 24h / TVL × 365. Kalau TVL $100K dan fee $274/hari
       = volume harus $91K/hari dengan fee tier 0.3%.
       Kalau volume tiba-tiba drop → APR drop ke 50% keesokan harinya.
```

**Mistake 2: Range terlalu sempit untuk pair volatile**
```
SALAH: Pair WIF-USDC (daily vol ±15%), pasang range ±5%
BENAR: Range harus minimal ±(daily volatility × 1.5) = ±22%
```

**Mistake 3: Tidak set exit rules sebelum masuk**
```
SALAH: "Lihat nanti saja"
BENAR: Sebelum deploy → sudah tahu: kalau IL > 15% → close
                                    kalau OOR > 30 menit → reseed
                                    kalau fee < $0.50/hari setelah 2 jam → close
```

**Mistake 4: Terlalu banyak posisi sekaligus**
```
SALAH: 10 posisi bersamaan dengan monitoring minimal
BENAR: 5 posisi maksimal dengan monitoring tiap 30 menit
       Lebih sedikit, lebih fokus, lebih profitable
```

**Mistake 5: Ignore korelasi antar posisi**
```
SALAH: 6 posisi semua SOL-correlated
BENAR: Mix tier, mix correlation (stable + volatile + LST pair)
```

**Mistake 6: Reseed terlalu agresif**
```
SALAH: Reseed setiap kali OOR walau cuma 5 menit
BENAR: Tunggu 30 menit OOR, evaluasi apakah harga likely balik,
       BARU reseed. Seringkali harga balik sendiri dalam 15-30 menit.
```

**Mistake 7: Tidak consider gas vs fee**
```
SALAH: Claim fee $0.10 dengan gas $0.08 → net $0.02
BENAR: Biarkan fee terakumulasi, claim kalau fee > 10× gas cost
```

**Mistake 8: FOMO masuk setelah pump**
```
SALAH: Token naik 80% → "Masuk sekarang sebelum naik lagi!"
BENAR: Setelah pump besar = IL risk sangat tinggi jika harga koreksi.
       Tunggu konsolidasi 24-48 jam setelah pump sebelum LP.
```

---

## BAGIAN 8: ADVANCED STRATEGIES

### 8.1 Correlation Hedging

Buka posisi berlawanan untuk hedge exposure:

```
Posisi A: SOL-USDC Bid-Ask (betting SOL volatile)
Posisi B: USDC-USDT Curve  (stabil, fee kecil tapi konsisten, zero IL)

Saat SOL volatile → Posisi A collect besar
Saat SOL dead     → Posisi B tetap collect steady
```

### 8.2 Range Ladder Strategy

Buka multiple posisi di range berbeda untuk satu pair:

```
Posisi 1: Range $140-$155 (lower range, Bid-Ask)
Posisi 2: Range $150-$165 (mid range, Curve)
Posisi 3: Range $160-$180 (upper range, Bid-Ask)

Hasil: Selalu ada posisi yang aktif selama harga dalam $140-$180
       Fee tetap jalan walau harga trending ke mana pun
```

### 8.3 Compound Growth Loop

```
Hari 1-7:   Collect fee, jangan claim
Hari 7:     Claim semua fee
            → Gunakan 50% untuk tambah modal posisi yang performing
            → Simpan 50% sebagai reserve
Hari 14:    Evaluasi, evolve threshold
```

### 8.4 Volatility Farming

Khusus untuk pair yang cycle-nya predictable (pump setelah listing, dump setelah hype):

```
Pre-pump phase:  Bid-Ask lebar (anticipate volatility)
Pump phase:      Tetap hold atau harvest (jangan reseed saat volatile)
Post-pump/dump:  Curve sempit (harga mulai konsolidasi)
Konsolidasi:     Harvest fee maksimal, prepare reseed
```

---

## BAGIAN 9: MORNING BRIEFING PROTOCOL

### Format Harian (Isi Setiap Pagi Sebelum Mulai Sesi)

```
══════════════════════════════════════
MORNING BRIEFING — [TANGGAL] [JAM UTC]
══════════════════════════════════════

MACRO CHECK:
├── SOL/USD: $[X] | 24h: [+/-X%] | 7d: [+/-X%]
├── BTC dominance: [X%] (naik = altcoin bearish)
├── Crypto fear & greed: [X/100] [Extreme Fear/Fear/Neutral/Greed/Extreme Greed]
└── Major event hari ini: [Tidak ada / Ada: ...]

MARKET CONDITION: [Sideways / Trending Up / Trending Down / Volatile / Dead]
CONFIDENCE: [High / Medium / Low]

POSISI AKTIF:
┌─────────────────────────────────────────────────────┐
│ # │ Pair       │ Status  │ Fee    │ IL     │ Net    │
├─────────────────────────────────────────────────────┤
│ 1 │ SOL-USDC   │ In Range│ +$X.XX │ -$X.XX │ +$X.XX │
│ 2 │ JUP-USDC   │ OOR!    │ +$X.XX │ -$X.XX │ -$X.XX │
└─────────────────────────────────────────────────────┘

ACTION YANG DIPERLUKAN:
├── CLOSE: [Pair yang perlu ditutup + alasan]
├── RESEED: [Pair yang OOR + rencana range baru]
├── CLAIM: [Pair yang fee-nya sudah layak di-claim]
└── OPEN: [Pair baru yang mau dibuka + strategi + alasan]

THESIS HARI INI:
[2-3 kalimat reasoning mengapa action di atas masuk akal
 berdasarkan kondisi market sekarang]

TARGET HARI INI:
├── Fee target: $[X] (realistic berdasarkan posisi aktif)
└── Risk yang perlu diwaspadai: [Sebutkan 1-2 hal]
══════════════════════════════════════
```

---

## BAGIAN 10: LESSON LOG

### Format Lesson (Isi Setelah SETIAP Posisi Ditutup)

```
╔══════════════════════════════════════════╗
║ LESSON LOG #[N] — [TANGGAL]             ║
╠══════════════════════════════════════════╣
║ Pair:        [BASE/QUOTE]               ║
║ Strategi:    [Spot/Curve/Bid-Ask/dll]   ║
║ Fee Tier:    [X%]                       ║
║ Bin Step:    [X bps]                    ║
║ Range:       [$X - $Y] (±Z%)           ║
║ Modal:       $[X]                       ║
╠══════════════════════════════════════════╣
║ HASIL:                                  ║
║ Duration:    [X jam X menit]            ║
║ Fee:         +$[X] (+X% dari modal)     ║
║ IL:          -$[X] (-X% dari modal)     ║
║ Net PnL:     [+/-]$[X] ([+/-]X%)       ║
║ Close Reason:[TP/SL/OOR/Manual/LowYield]║
╠══════════════════════════════════════════╣
║ ANALISIS:                               ║
║                                         ║
║ Yang Benar:                             ║
║ → [Keputusan apa yang terbukti tepat?]  ║
║ → [Apa yang berjalan sesuai thesis?]    ║
║                                         ║
║ Yang Salah:                             ║
║ → [Apa yang tidak berjalan?]            ║
║ → [Mana titik decision yang keliru?]    ║
║                                         ║
║ Root Cause:                             ║
║ → [1 kalimat: kenapa hasilnya begini?]  ║
╠══════════════════════════════════════════╣
║ LESSON:                                 ║
║ → [1 rule konkret yang bisa langsung   ║
║    diterapkan ke posisi berikutnya]     ║
║                                         ║
║ AKAN DITERAPKAN:                        ║
║ → [Perubahan spesifik di sesi depan]   ║
╚══════════════════════════════════════════╝
```

### Contoh Lesson yang Sudah Diisi

```
╔══════════════════════════════════════════╗
║ LESSON LOG #1 — Contoh                 ║
╠══════════════════════════════════════════╣
║ Pair:        POPCAT/USDC               ║
║ Strategi:    Curve                     ║
║ Fee Tier:    0.3%                      ║
║ Bin Step:    25 bps                    ║
║ Range:       $0.038 - $0.052 (±15%)   ║
║ Modal:       $300                      ║
╠══════════════════════════════════════════╣
║ HASIL:                                  ║
║ Duration:    4 jam 20 menit            ║
║ Fee:         +$0.42 (+0.14%)           ║
║ IL:          -$2.80 (-0.93%)           ║
║ Net PnL:     -$2.38 (-0.79%)           ║
║ Close Reason: OOR — harga dump ke $0.034║
╠══════════════════════════════════════════╣
║ ANALISIS:                               ║
║                                         ║
║ Yang Benar:                             ║
║ → Fee tier 0.3% sudah tepat untuk meme ║
║ → Keluar saat OOR sesuai rules         ║
║                                         ║
║ Yang Salah:                             ║
║ → Pakai Curve untuk meme pair           ║
║ → Range terlalu sempit untuk POPCAT    ║
║ → Tidak cek market condition (SOL -4%) ║
║                                         ║
║ Root Cause:                             ║
║ → Salah pilih strategi: POPCAT volatile,║
║   harusnya Bid-Ask bukan Curve          ║
╠══════════════════════════════════════════╣
║ LESSON:                                 ║
║ → Tier 3 meme pair SELALU pakai        ║
║   Bid-Ask, bukan Curve, terlepas dari  ║
║   kondisi market karena inherently      ║
║   volatile                              ║
║                                         ║
║ AKAN DITERAPKAN:                        ║
║ → Besok buka POPCAT lagi dengan        ║
║   Bid-Ask + range ±25% + bin step 50   ║
╚══════════════════════════════════════════╝
```

---

## BAGIAN 11: THRESHOLD EVOLUTION TRACKER

Update tabel ini setelah setiap 10 posisi ditutup.

| Metric | Target | Batch 1 (pos 1-10) | Batch 2 (pos 11-20) | Batch 3 (pos 21-30) |
|--------|--------|-------------------|--------------------|--------------------|
| Win rate | > 70% | — | — | — |
| Avg fee/24h | > 0.5% modal | — | — | — |
| Avg IL/posisi | < 3% modal | — | — | — |
| OOR frequency | < 30% | — | — | — |
| Avg hold time | 4-24 jam | — | — | — |
| Best strategy | — | — | — | — |
| Best pair tier | — | — | — | — |
| Best market condition | — | — | — | — |

### Cara Evolve Threshold

Setelah 10 posisi:
1. Hitung actual vs target untuk setiap metric
2. Kalau win rate < 70% → identifikasi pola posisi yang kalah (pair? strategi? timing?)
3. Adjust rules: kalau Tier 3 win rate < 50% → reduce allocation, increase bin step
4. Kalau OOR frequency > 30% → semua range diperlebar 20%
5. Kalau avg fee < 0.3%/24h → minimum volume dinaikkan

---

## BAGIAN 12: QUICK REFERENCE CARD

```
╔════════════════════════════════════════════════════╗
║              DECISION TREE LP                      ║
╠════════════════════════════════════════════════════╣
║                                                    ║
║  MARKET CONDITION?                                 ║
║  ├── Sideways (<3% 24h, volume flat)               ║
║  │   └── → Curve, range ±10%, bin step sedang     ║
║  ├── Trending (>5% satu arah, volume naik)         ║
║  │   └── → Spot, range asimetris ke arah trend    ║
║  ├── Volatile (>5% choppy, volume spike)           ║
║  │   └── → Bid-Ask, range ±20-30%                 ║
║  └── Dead (volume turun, <1% 24h)                  ║
║      └── → SKIP atau harvest saja                  ║
║                                                    ║
║  PAIR TIER?                                        ║
║  ├── Tier 1 (SOL, JUP, RAY): bin step 10-25 bps  ║
║  ├── Tier 2 (PYTH, ORCA, JTO): bin step 25-50 bps ║
║  ├── Tier 3 (BONK, WIF, meme): bin step 50-100 bps║
║  └── Stable (USDC-USDT): bin step 1-2 bps         ║
║                                                    ║
║  EXIT RULES (default):                             ║
║  ├── IL > 15%      → CLOSE                        ║
║  ├── Fee > 5%      → CLOSE (take profit)           ║
║  ├── OOR > 30 min  → EVALUATE (reseed atau close) ║
║  └── Fee < 0.05%/day after 2h → CLOSE             ║
║                                                    ║
║  POSISI SIZING:                                    ║
║  ├── Max per posisi: 20% portfolio                 ║
║  ├── Max Tier 3:     10% portfolio                 ║
║  ├── Max total LP:   70% portfolio                 ║
║  └── Cash reserve:   min 10%                       ║
╚════════════════════════════════════════════════════╝
```

---

## METADATA

```
File: DLMM_KNOWLEDGE.md
Versi: Pro Edition v1.0
Total posisi ditutup: 0
Win rate keseluruhan: —
Lesson terbaru: —
Last evolution: —
Next evolution target: setelah 10 posisi
```

---

*"LP yang bagus bukan yang paling sering profit, tapi yang paling konsisten manage risk."*
