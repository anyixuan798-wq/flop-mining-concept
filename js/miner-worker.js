/* FLOP Mining Concept Simulator — miner worker.
 * Performs REAL double-SHA-256 proof-of-work: scans nonces until
 * SHA256(SHA256(80-byte block header)) starts with `diff` hex zeros.
 * Nonce space is partitioned across N workers (worker i starts at i, step N).
 */
'use strict';
importScripts('sha256.js');

let running = false;
let task = null;        // current block template
let buf = new Uint8Array(80);
let scratch = new Uint8Array(32);   // doubleRawInto midstate scratch
let digest = new Uint8Array(32);    // final double-sha256 output
let attemptsSinceReport = 0;
let lastReport = 0;
let sampleNonce = 0;
let sampleHash = '';

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function fillHeader() {
  // big-endian, fixed 76 bytes + mutable nonce at [76..79]
  const v = task.version;
  buf[0] = (v >>> 24) & 0xff; buf[1] = (v >>> 16) & 0xff; buf[2] = (v >>> 8) & 0xff; buf[3] = v & 0xff;
  const prev = hexToBytes(task.prevHash); buf.set(prev, 4);
  const mer = hexToBytes(task.merkleRoot); buf.set(mer, 36);
  const ts = task.time;
  buf[68] = (ts >>> 24) & 0xff; buf[69] = (ts >>> 16) & 0xff; buf[70] = (ts >>> 8) & 0xff; buf[71] = ts & 0xff;
  const bitsB = hexToBytes(task.bits); buf.set(bitsB, 72);
}

function stampNonce(nonce) {
  buf[76] = (nonce >>> 24) & 0xff; buf[77] = (nonce >>> 16) & 0xff; buf[78] = (nonce >>> 8) & 0xff; buf[79] = nonce & 0xff;
}

function mine() {
  const step = task.nWorkers;
  let nonce = task.workerId;
  const diff = task.diff; // required leading hex zeros
  // leading hex zeros ⇒ full zero bytes + possibly a half nibble check
  const fullBytes = Math.floor(diff / 2);
  const remNib = diff % 2;            // 1 → need high nibble of next byte zero
  const prefix = '0'.repeat(diff);
  let hashHex = '';

  while (running) {
    stampNonce(nonce);
    SHA256.doubleRawInto(buf, 80, scratch, digest);
    attemptsSinceReport++;

    // check leading zeros byte-wise (cheap), then nibble, then exact string on success
    let ok = true;
    for (let i = 0; i < fullBytes; i++) { if (digest[i] !== 0) { ok = false; break; } }
    if (ok && remNib === 1 && (digest[fullBytes] >> 4) !== 0) ok = false;
    if (ok) {
      hashHex = SHA256.hexOf(digest);
      if (!hashHex.startsWith(prefix)) ok = false; // belt & suspenders
    }
    if (ok) {
      // FOUND A BLOCK — real proof-of-work (echo current time: it may have
      // advanced past the template's original time if the nonce space wrapped)
      postMessage({ type: 'found', nonce: nonce, hash: hashHex, time: task.time, workerId: task.workerId, attempts: attemptsSinceReport, headerHex: SHA256.hexOf(buf) });
      running = false;
      return;
    }

    nonce += step;

    // progress heartbeat (throttled)
    const now = Date.now();
    if (attemptsSinceReport >= 8192 || (now - lastReport > 140)) {
      sampleNonce = nonce;
      sampleHash = SHA256.hexOf(digest);
      lastReport = now;
      postMessage({ type: 'progress', nonce: nonce, hash: sampleHash, attempts: attemptsSinceReport });
      attemptsSinceReport = 0;
    }
    if (nonce > 0xffffffff - step) { // wrap: restart partition, bump time field to stay valid
      nonce = task.workerId;
      task.time = (Date.now() / 1000) | 0;
      const ts = task.time;
      buf[68] = (ts >>> 24) & 0xff; buf[69] = (ts >>> 16) & 0xff; buf[70] = (ts >>> 8) & 0xff; buf[71] = ts & 0xff;
    }
  }
}

onmessage = function (e) {
  if (e.data.type === 'start') {
    task = e.data.task;
    running = true;
    fillHeader();
    mine();
  } else if (e.data.type === 'stop') {
    running = false;
  }
};
