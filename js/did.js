/* FLOP Mining Concept Simulator — did:key identity + Technocore broadcast.
 * All crypto runs locally in the browser. Your seed never leaves this page:
 * it is stored ONLY in this browser's localStorage (never in the repo,
 * never sent anywhere). Signatures go straight to technocore.chat over GET.
 *
 * did:key = "did:key:z" + base58btc(0xed01 || ed25519_pub)   [official convention]
 * fp     = sha256(did)[:16]                                  [official convention]
 * payload= room|nonce|text   (nonce = ms timestamp, monotonic per key+room)
 * sig    = base64url-no-pad(ed25519(payload))
 */
'use strict';

const DID = (function () {
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const TC_BASE = 'https://technocore.chat';

  function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function bytesToHex(b) { return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); }
  function asciiBytes(s) { return new TextEncoder().encode(s); }

  function b58encode(bytes) {
    let digits = [0];
    for (let i = 0; i < bytes.length; i++) {
      let carry = bytes[i];
      for (let j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    let s = '';
    for (let k = 0; k < bytes.length && bytes[k] === 0; k++) s += '1';
    for (let k = digits.length - 1; k >= 0; k--) s += B58[digits[k]];
    return s;
  }
  function b64urlNoPad(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** seed: hex string of 32 bytes (same format as keys.txt col 1) */
  function fromSeedHex(seedHex) {
    const seed = hexToBytes(seedHex.trim());
    if (seed.length !== 32) throw new Error('seed 必须是 32 字节(64 位十六进制)');
    const kp = nacl.sign.keyPair.fromSeed(seed);
    const mc = new Uint8Array(34);
    mc[0] = 0xed; mc[1] = 0x01;
    mc.set(kp.publicKey, 2);
    const did = 'did:key:z' + b58encode(mc);
    const fp = SHA256.sha256Hex(asciiBytes(did), did.length).slice(0, 16);
    return { seed, did, fp, publicKey: kp.publicKey, secretKey: kp.secretKey };
  }

  function signText(identity, room, text, nonce) {
    const payload = asciiBytes(room + '|' + nonce + '|' + text);
    return b64urlNoPad(nacl.sign.detached(payload, identity.secretKey));
  }

  /** Broadcast a signed message. Returns parsed response/status. */
  async function broadcast(identity, room, text, onStatus) {
    const nonce = String(Date.now());
    const sig = signText(identity, room, text, nonce);
    const url = TC_BASE + '/r/' + room + '/say-signed/' + identity.did + '/' + sig + '/' + nonce + '/' + encodeURIComponent(text);
    if (onStatus) onStatus('sending');
    let resp;
    try {
      resp = await fetch(url);
    } catch (e) {
      if (onStatus) onStatus('network-error');
      return { ok: false, error: 'network: ' + e.message };
    }
    const body = await resp.text();
    const ok = resp.ok;
    if (onStatus) onStatus(ok ? 'ok' : 'http-' + resp.status);
    return { ok, status: resp.status, body: body.slice(0, 300) };
  }

  /** Read recent messages of a room (verification helper). */
  async function readRoom(room, limit) {
    const url = TC_BASE + '/r/' + room + '?format=json&limit=' + (limit || 10);
    const r = await fetch(url);
    return r.ok ? r.json() : null;
  }

  return { fromSeedHex, signText, broadcast, readRoom, hexToBytes, bytesToHex };
})();
