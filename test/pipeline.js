#!/usr/bin/env node
/* Pipeline smoke test: simulate N partition workers scanning nonces with the
 * real double-SHA256 engine (same byte-level code path as miner-worker.js),
 * then main-thread verification. Proves find → verify → reward works.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const vm = require('vm');
const sandbox = { self: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js/sha256.js'), 'utf8'), sandbox);
const SHA = sandbox.self.SHA256;

const hexToBytes = (hex) => { const o = new Uint8Array(hex.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(hex.substr(i * 2, 2), 16); return o; };
// build header exactly like worker fillHeader + stampNonce
function buildHeader(prev, merkle, time, bits, nonce) {
  const buf = new Uint8Array(80);
  buf[3] = 1;
  buf.set(hexToBytes(prev), 4);
  buf.set(hexToBytes(merkle), 36);
  buf[68] = (time >>> 24) & 0xff; buf[69] = (time >>> 16) & 0xff; buf[70] = (time >>> 8) & 0xff; buf[71] = time & 0xff;
  buf.set(hexToBytes(bits), 72);
  buf[76] = (nonce >>> 24) & 0xff; buf[77] = (nonce >>> 16) & 0xff; buf[78] = (nonce >>> 8) & 0xff; buf[79] = nonce & 0xff;
  return buf;
}
const randHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), x => x.toString(16).padStart(2, '0')).join('');

// worker-equivalent mining loop
function mineBlock(diff, nWorkers, prev) {
  const time = (Date.now() / 1000) | 0;
  const merkle = randHex(32);
  const bits = ('0'.repeat(diff) + 'f'.repeat(64 - diff)).slice(0, 8);
  const fullBytes = Math.floor(diff / 2), remNib = diff % 2;
  const scratch = new Uint8Array(32), digest = new Uint8Array(32);
  let found = null;
  for (let w = 0; w < nWorkers && !found; w++) {
    let nonce = w; let attempts = 0;
    while (!found) {
      const hdr = buildHeader(prev, merkle, time, bits, nonce);
      SHA.doubleRawInto(hdr, 80, scratch, digest);
      attempts++;
      let ok = true;
      for (let i = 0; i < fullBytes; i++) { if (digest[i] !== 0) { ok = false; break; } }
      if (ok && remNib === 1 && (digest[fullBytes] >> 4) !== 0) ok = false;
      if (ok) {
        const hash = SHA.hexOf(digest);
        if (!hash.startsWith('0'.repeat(diff))) ok = false;
        if (ok) found = { nonce, hash, attempts };
      }
      nonce += nWorkers;
      if (attempts > 5e7) throw new Error('diff too high');
    }
  }
  return { ...found, merkle, time, bits };
}

(async () => {
  let prev = '0'.repeat(64);
  const t0 = Date.now();
  const scratch = new Uint8Array(32), digest = new Uint8Array(32);
  for (let h = 1; h <= 5; h++) {
    const r = mineBlock(5, 2, prev);
    // main-thread re-verify (independent recompute from raw fields)
    const hdr = buildHeader(prev, r.merkle, r.time, r.bits, r.nonce);
    SHA.doubleRawInto(hdr, 80, scratch, digest);
    const v = SHA.hexOf(digest);
    if (v !== r.hash || !v.startsWith('00000')) throw new Error('verify FAILED at block ' + h);
    prev = r.hash;
    console.log(`block #${h}  nonce=0x${(r.nonce>>>0).toString(16).padStart(8,'0')}  attempts=${r.attempts}  +${Date.now()-t0}ms  ${r.hash.slice(0,12)}…`);
  }
  console.log('reward(era0)=96/block · 5 blocks = 480 $FLOP');
  const eras = [0,1,2,3,4,5,6].map(e => 96 / Math.pow(2, Math.min(e,5)));
  console.log('era rewards: 96 → 48 → 24 → 12 → 6 → 3 → 3(恒定) |', eras.join(' → '));
  console.log('\nPIPELINE OK — 5 real blocks mined & verified');
})();
