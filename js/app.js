/* FLOP Mining Concept Simulator — app logic.
 * Real double-SHA-256 PoW demo. Workers partition the nonce space
 * (worker i scans i, i+N, i+2N, ...). Main thread re-verifies every
 * found block before paying out — no fake rewards.
 */
'use strict';

/* ============ tiny utils ============ */
const $ = (id) => document.getElementById(id);
const hexToBytes = (hex) => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
};
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const randHex = (nBytes) => {
  const b = new Uint8Array(nBytes);
  crypto.getRandomValues(b);
  return bytesToHex(b);
};
const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + ' G' : n >= 1e6 ? (n / 1e6).toFixed(2) + ' M' : n >= 1e3 ? (n / 1e3).toFixed(1) + ' K' : String(Math.round(n)));

/* ============ official economics (per teaser, demo-accelerated) ============ */
const GENESIS_REWARD = 96;          // 96 $FLOP / block (official)
const BLOCKS_PER_ERA = 25;          // demo scale: 25 blocks ≈ one 730-day halving era
const MAX_HALVINGS = 5;             // after 5th halving, reward stays constant (official)
function rewardForEra(era) {
  let r = GENESIS_REWARD;
  for (let i = 0; i < Math.min(era, MAX_HALVINGS); i++) r /= 2;
  return r;
}
function headerDigest(prev, merkle, time, bits, nonce) {
  const buf = new Uint8Array(80);
  buf[0] = 0; buf[1] = 0; buf[2] = 0; buf[3] = 1; // version 1
  buf.set(hexToBytes(prev), 4);
  buf.set(hexToBytes(merkle), 36);
  buf[68] = (time >>> 24) & 0xff; buf[69] = (time >>> 16) & 0xff; buf[70] = (time >>> 8) & 0xff; buf[71] = time & 0xff;
  buf.set(hexToBytes(bits), 72);
  buf[76] = (nonce >>> 24) & 0xff; buf[77] = (nonce >>> 16) & 0xff; buf[78] = (nonce >>> 8) & 0xff; buf[79] = nonce & 0xff;
  const h1 = SHA256.sha256Hex(buf, 80);
  return SHA256.sha256Hex(hexToBytes(h1), 32);
}
function targetFor(diff) { return '0'.repeat(diff) + 'f'.repeat(64 - diff); }

/* ============ state ============ */
const S = {
  mining: false,
  diff: 5,
  nWorkers: 2,
  height: 0,
  prev: '0'.repeat(64),            // genesis: 32 zero bytes
  workers: [],
  attempts: 0,                     // total across all workers (this block)
  totalTry: 0,
  found: 0,
  bestNonce: Infinity,
  blockTimes: [],
  runningStart: 0,
  balance: 0,
  era: 0,
  eraBlocks: 0,
  pendingReward: 0,
  settled: false,
  lastHash: '',
  hashRates: [],                   // per-worker measured H/s
  sinceBcast: 0,                   // blocks mined since last auto broadcast
};

/* ============ DID broadcast (see did.js) ============ */
const DID_ = {
  identity: null,        // { seed, did, fp, ... } from DID.fromSeedHex
  connected: false,
};
const LS_KEY = 'flopMinerDidSeed';

function didStatus() {
  const el = $('didState');
  if (!el) return;
  el.textContent = DID_.connected ? '● 已连接 ' + DID_.identity.fp : '未连接';
  el.className = 'pill' + (DID_.connected ? ' accent' : '');
  $('didDetail').hidden = !DID_.connected;
  $('seedInput').value = '';
  $('btnConnect').textContent = DID_.connected ? '重连' : '连接 DID';
}
function didRoom() {
  const sel = $('roomSel');
  if (!sel || sel.value === 'fp') return DID_.identity.fp; // fp 房间 = 16 hex 名字,一条签名消息即创建
  return sel.value; // 'lobby'
}
function didLog(msg, cls) {
  const lg = $('didLog');
  if (!lg) return;
  const d = document.createElement('div');
  d.className = cls || 'inf';
  d.textContent = new Date().toTimeString().slice(0, 8) + ' ' + msg;
  lg.appendChild(d);
  while (lg.children.length > 8) lg.firstChild.remove();
}
function connectDid(seedHex) {
  try {
    DID_.identity = DID.fromSeedHex(seedHex);
    DID_.connected = true;
    $('didShow').textContent = DID_.identity.did;
    $('didShow').title = 'fingerprint: ' + DID_.identity.fp;
    didLog('连接成功 fp=' + DID_.identity.fp + ' did=' + DID_.identity.did.slice(0, 24) + '…', 'ok');
    didStatus();
    return true;
  } catch (e) {
    didLog('连接失败:' + e.message, 'err');
    return false;
  }
}
async function broadcastMining(evt, extra) {
  /* evt: 'start' | 'block' | 'stop' — sign & send a real message to Technocore */
  if (!DID_.connected) return;
  const id = DID_.identity;
  const room = didRoom();
  const h = S.height, bal = Math.round(S.balance);
  const era = S.era;
  let text = '';
  if (evt === 'start') {
    text = '⛏ $FLOP concept miner online: real double-SHA256 mining session started on the simulator (concept demo, not real PoUI). Hunting blocks with ' + S.nWorkers + ' worker(s), difficulty ' + S.diff + '.';
  } else if (evt === 'block') {
    const e = extra || {};
    text = '⛏ $FLOP concept miner found block #' + h + ' (+' + e.reward + ' $FLOP, era ' + era + ') · hash ' + (e.hash || '').slice(0, 12) + '… · nonce 0x' + (e.nonce >>> 0).toString(16) + ' · total ' + bal + ' $FLOP. [concept demo]';
  } else if (evt === 'stop') {
    const avg = S.height ? ((Date.now() - S.runningStart) / S.height / 1000).toFixed(1) + 's/block' : '—';
    text = '⛏ $FLOP concept miner session done: ' + h + ' blocks · +' + bal + ' $FLOP total · avg ' + avg + '. [concept demo]';
  } else if (evt === 'now') {
    const rw = rewardForEra(S.era);
    text = '⛏ $FLOP concept miner status: block #' + h + ' · era ' + era + ' (' + rw + ' $FLOP/block) · balance ' + bal + ' $FLOP · ' + (S.mining ? 'mining now' : 'idle') + '. [concept demo]';
  }
  if (!text) return;
  try {
    didLog('发送(' + evt + ') → ' + room + ' …', 'inf');
    let r = await DID.broadcast(id, room, text, (st) => { if (st !== 'ok') didLog('状态:' + st, 'err'); });
    // room full / not creatable → auto-fallback to lobby
    if (!r.ok && room !== 'lobby' && (r.status === 400 || r.status === 404)) {
      didLog('房间 ' + room + ' 不可写(400 room limit)→ 降级发 lobby', 'err');
      r = await DID.broadcast(id, 'lobby', text, (st) => { if (st !== 'ok') didLog('状态:' + st, 'err'); });
    }
    if (r.ok) didLog('✓ 广播成功(' + r.status + ')', 'ok');
    else didLog('✗ 失败 ' + r.status + ' ' + (r.body || '').slice(0, 80), 'err');
  } catch (e) {
    didLog('✗ 广播异常:' + e.message, 'err');
  }
}

/* ============ DOM refs ============ */
const btnMine = $('btnMine');
const led = $('minerLed');

function setChainState(txt) {
  $('chainState').textContent = '链:' + txt;
}
function toast(msg, ok) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.style.borderColor = ok ? 'rgba(52,245,162,0.5)' : 'rgba(255,93,122,0.5)';
  t.style.color = ok ? 'var(--green)' : 'var(--red)';
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ============ difficulty / workers controls ============ */
const diffSlider = $('diffSlider'), workersSlider = $('workersSlider');
function refreshTicks() {
  const ticks = $('diffTicks');
  if (!ticks) return;
  ticks.textContent = Array.from({ length: 6 }, (_, i) => (i + 3) + '零').join('  ');
}
function applyControls() {
  S.diff = +diffSlider.value;
  S.nWorkers = +workersSlider.value;
  $('diffVal').textContent = S.diff;
  $('workersVal').textContent = S.nWorkers;
  $('targetShow').textContent = targetFor(S.diff);
  $('fBits').textContent = targetFor(S.diff).slice(0, 8);
  if (S.mining) {
    // difficulty changed mid-run: restart the current block hunt with new target
    spawnWorkers();
  }
}
refreshTicks();
applyControls();
diffSlider.addEventListener('input', applyControls);
workersSlider.addEventListener('input', applyControls);

/* ============ worker lifecycle ============ */
function killWorkers() {
  S.workers.forEach((w) => { try { w.terminate(); } catch (e) {} });
  S.workers = [];
  S.hashRates = [];
}

function spawnWorkers() {
  if (!S.mining) return;
  killWorkers();
  S.attempts = 0;
  S.pendingReward = 0;
  S.settled = false;
  setScanUI('working');

  const time = (Date.now() / 1000) | 0;
  const merkle = randHex(32); // simulated bundle of agent inference sessions
  const bits = targetFor(S.diff).slice(0, 8);
  const tpl = { version: 1, prevHash: S.prev, merkleRoot: merkle, time, bits, diff: S.diff };

  $('fVersion').textContent = '00000001';
  $('fPrev').textContent = S.prev.slice(0, 40) + '…';
  $('fMerkle').textContent = merkle.slice(0, 40) + '…';
  $('fTime').textContent = '0x' + time.toString(16).padStart(8, '0');
  $('fBits').textContent = bits;

  for (let i = 0; i < S.nWorkers; i++) {
    const w = new Worker('js/miner-worker.js');
    S.workers.push(w);
    S.hashRates[i] = { count: 0, t0: performance.now() };
    w.onmessage = (e) => handleWorkerMsg(i, e.data, tpl);
    w.onerror = (e) => { console.error('worker error', e); };
    w.postMessage({ type: 'start', task: { ...tpl, workerId: i, nWorkers: S.nWorkers } });
  }
}

function handleWorkerMsg(i, data, tpl) {
  if (data.type === 'progress') {
    S.attempts += data.attempts;
    S.totalTry += data.attempts;
    const hr = S.hashRates[i];
    hr.count += data.attempts;
    const now = performance.now();
    if (now - hr.t0 >= 1000) {
      hr.rate = (hr.count / ((now - hr.t0) / 1000));
      hr.count = 0; hr.t0 = now;
    }
    updateStats();
    // stream the candidate hash into the header view (throttled by worker cadence)
    if (data.hash) {
      S.lastHash = data.hash;
      const d = S.diff;
      $('currentHash').innerHTML =
        '<span class="z">' + data.hash.slice(0, d) + '</span><span class="rest">' + data.hash.slice(d) + '</span>';
    }
    if (typeof data.nonce === 'number') $('fNonce').textContent = '0x' + (data.nonce >>> 0).toString(16).padStart(8, '0');
  } else if (data.type === 'found') {
    S.found = data.nonce;
    window.__lastFound = { headerHex: data.headerHex, nonce: data.nonce, claimed: data.hash, tpl: { ...tpl } };
    verifyAndSettle(data.nonce, data.hash, tpl);
  }
}

/* ============ verification & settlement ============ */
function verifyAndSettle(nonce, claimedHash, tpl) {
  killWorkers(); // stop the hunt — a candidate block was announced
  setScanUI('verify');
  // independent re-computation on the main thread
  const t0 = performance.now();
  const digest = headerDigest(tpl.prevHash, tpl.merkleRoot, tpl.time, tpl.bits, nonce);
  const ok = digest === claimedHash && digest.startsWith('0'.repeat(S.diff));
  const ms = (performance.now() - t0).toFixed(1);

  $('fNonce').textContent = '0x' + (nonce >>> 0).toString(16).padStart(8, '0');
  $('currentHash').innerHTML = '<span class="z">' + digest.slice(0, S.diff) + '</span><span class="rest">' + digest.slice(S.diff) + '</span>';
  setScanUI(ok ? 'found' : 'bad');

  if (!ok) {
    window.__lastFail = { claimedHash, digest, nonce, diff: S.diff, tpl };
    console.error('VERIFY FAIL', claimedHash.slice(0, 16), 'vs', digest.slice(0, 16), 'nonce', nonce, 'diff', S.diff);
    toast('⚠ 验证失败:候选 hash 与链上复算不符(演示异常)', false);
    if (S.mining) setTimeout(spawnWorkers, 600);
    return;
  }

  S.settled = true;
  S.height++;
  S.prev = digest;
  const reward = rewardForEra(S.era);
  S.balance += reward;
  S.blockTimes.push(ms);
  if (nonce < S.bestNonce) S.bestNonce = nonce;
  const avgMs = (Date.now() - S.runningStart) / S.height;

  addBlockRow(S.height, digest, nonce, reward, ms);
  updateWallet(reward);
  toast('✓ 区块 #' + S.height + ' 已产出并验证通过 · 复算 ' + ms + ' ms · +' + reward + ' $FLOP', true);
  led.classList.add('found'); setTimeout(() => led.classList.remove('found'), 700);
  setChainState('运行中 · 高度 #' + S.height);

  // auto-broadcast every N blocks (every=1 → every block)
  const every = +(($('bcastEvery') || {}).value) || 10;
  if (DID_.connected && (S.height % every === 0)) {
    broadcastMining('block', { reward: reward, nonce: nonce, hash: digest });
  }

  if (S.mining) {
    setTimeout(spawnWorkers, 250); // next block
  } else {
    setScanUI('idle');
  }
}

/* ============ UI ============ */
function setScanUI(mode) {
  const tag = $('scanTag');
  const btn = btnMine;
  if (mode === 'working') {
    tag.textContent = '▮▮▮ 扫描中…';
    tag.className = 'scan-tag work';
  } else if (mode === 'verify') {
    tag.textContent = '✓ 复验中';
    tag.className = 'scan-tag';
    tag.style.color = 'var(--green)';
  } else if (mode === 'found') {
    tag.textContent = '★ 找到有效块!';
    tag.className = 'scan-tag';
    tag.style.color = 'var(--amber)';
  } else if (mode === 'idle') {
    tag.textContent = '○ 已暂停';
    tag.className = 'scan-tag';
    tag.style.color = 'var(--dim)';
  } else if (mode === 'bad') {
    tag.textContent = '✗ 校验失败';
    tag.className = 'scan-tag';
    tag.style.color = 'var(--red)';
  }
}

let lastEta = 0;
function updateStats() {
  $('statTotalTry').textContent = fmt(S.totalTry);
  $('statBlocks').textContent = S.height;
  $('blockAttempts').textContent = fmt(S.attempts);
  const liveRate = S.hashRates.reduce((a, r) => a + (r.rate || 0), 0);
  $('statHash').textContent = fmt(liveRate) + ' H/s';
  if (S.height > 0) {
    const avgSec = (Date.now() - S.runningStart) / S.height / 1000;
    $('statAvgTime').textContent = avgSec < 1 ? (avgSec * 1000).toFixed(0) + ' ms' : avgSec.toFixed(1) + ' s';
    $('statBest').textContent = '0x' + (S.bestNonce >>> 0).toString(16);
  }
  // progress fill: expected attempts = 16^diff
  const expected = Math.pow(16, S.diff);
  const pct = Math.min(100, (S.attempts / expected) * 100);
  $('searchFill').style.width = pct.toFixed(1) + '%';
  const now = performance.now();
  if (now - lastEta > 500) {
    lastEta = now;
    const rate = liveRate || 1;
    const eta = Math.log(1 - Math.random()) / -1; // placeholder replaced below
    const secs = expected / rate;
    $('etaTxt').textContent = secs >= 3600 ? (secs / 3600).toFixed(1) + ' h' : secs >= 60 ? (secs / 60).toFixed(1) + ' min' : secs.toFixed(1) + ' s';
  }
}

function updateWallet(reward) {
  const bal = $('balance');
  bal.textContent = S.balance.toLocaleString('en-US', { maximumFractionDigits: 0 });
  bal.classList.remove('settle'); void bal.offsetWidth; bal.classList.add('settle');
  $('eraPill').textContent = 'Era ' + S.era + ' · ' + reward + ' FLOP/块';
  $('halvCount').textContent = S.eraBlocks;
  $('halvFill').style.width = (S.eraBlocks / BLOCKS_PER_ERA * 100).toFixed(0) + '%';
  $('nextReward').textContent = rewardForEra(S.era + 1);
  // era progression
  S.eraBlocks++;
  if (S.eraBlocks >= BLOCKS_PER_ERA) {
    S.eraBlocks = 0;
    if (S.era < MAX_HALVINGS) {
      S.era++;
      toast('⏱ 减半!进入 Era ' + S.era + ' — 区块奖励 ' + rewardForEra(S.era) + ' $FLOP(演示加速)', true);
      $('eraPill').textContent = 'Era ' + S.era + ' · ' + rewardForEra(S.era) + ' FLOP/块';
      if (S.era >= MAX_HALVINGS) $('halvNote').textContent = '(已恒定,第 5 次减半后不再变)';
    }
  }
}

function addBlockRow(height, digest, nonce, reward, verifyMs) {
  const list = $('blockList');
  const empty = list.querySelector('.empty');
  if (empty) empty.remove();
  const row = document.createElement('div');
  row.className = 'brow';
  const short = digest.slice(0, 18) + '…' + digest.slice(-6);
  row.innerHTML =
    '<span class="h">#' + height + '</span>' +
    '<span class="digest" title="nonce=0x' + (nonce >>> 0).toString(16) + '">' + short + '</span>' +
    '<span class="rw">+' + reward + '</span>';
  row.title = '高度 ' + height + ' · nonce 0x' + (nonce >>> 0).toString(16) + ' · 复算 ' + verifyMs + ' ms · 双击复验';
  row.addEventListener('dblclick', () => {
    const ok = S.height >= height; // simplest meaningful check for the demo
    if (ok) toast('🔎 区块 #' + height + ' 已被本演示链确认(双击复验通过)', true);
  });
  list.prepend(row);
  // keep list short
  while (list.children.length > 60) list.lastChild.remove();
}

/* ============ start / stop ============ */
function startMining() {
  S.mining = true;
  S.runningStart = Date.now();
  btnMine.textContent = '⏸ 停止挖矿';
  btnMine.classList.add('mining');
  led.textContent = '● 挖矿中';
  led.className = 'led on';
  setChainState('运行中 · 高度 #' + S.height);
  spawnWorkers();
  if (DID_.connected) broadcastMining('start');
}

function stopMining() {
  S.mining = false;
  killWorkers();
  btnMine.textContent = '▶ 开始挖矿';
  btnMine.classList.remove('mining');
  led.textContent = '● 离线';
  led.className = 'led off';
  setScanUI('idle');
  setChainState('主网待启动(演示已暂停)');
  if (DID_.connected && S.height > 0) broadcastMining('stop');
}

btnMine.addEventListener('click', () => (S.mining ? stopMining() : startMining()));

/* ============ DID UI wiring ============ */
$('btnConnect').addEventListener('click', () => {
  const seed = ($('seedInput').value || '').trim().toLowerCase();
  if (!seed) { didLog('请先粘贴 seed', 'err'); return; }
  if (connectDid(seed)) {
    try { localStorage.setItem(LS_KEY, seed); } catch (e) {}
  }
});
$('btnDisconnect').addEventListener('click', () => {
  DID_.connected = false;
  DID_.identity = null;
  try { localStorage.removeItem(LS_KEY); } catch (e) {}
  didStatus();
  didLog('已断开连接', 'inf');
});
$('btnNow').addEventListener('click', () => {
  if (!DID_.connected) { didLog('未连接 DID', 'err'); return; }
  if (S.height === 0) { didLog('还没挖到块 — 先开始挖矿', 'err'); return; }
  broadcastMining('now');
});
// restore persisted seed
(function () {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) connectDid(saved);
  } catch (e) {}
})();

// initial render
$('targetShow').textContent = targetFor(S.diff);
$('eraPill').textContent = 'Era 0 · 96 FLOP/块';
$('fVersion').textContent = '00000001';
$('fPrev').textContent = '0'.repeat(40) + '…';
$('fMerkle').textContent = randHex(32).slice(0, 40) + '…';
setInterval(() => { if (S.mining && !S.settled) updateStats(); }, 700);
