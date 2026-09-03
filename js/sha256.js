/* Pure-JS synchronous SHA-256 (for real PoW mining in a Web Worker).
 * Verified against Node crypto with test vectors before shipping.
 * Exposed as: module.exports (Node) / globalThis.SHA256 (browser worker)
 *
 * API:
 *   sha256Hex(bytes, byteLen)          -> lowercase hex digest string
 *   rawInto(bytes, byteLen, out32)     -> writes raw 32-byte digest into out32
 *   doubleRawInto(header, out32)       -> sha256(sha256(header)) into out32
 *                                        (out32 may alias a 32-byte scratch
 *                                         used as midstate? NO — caller must
 *                                         pass a separate 32-byte scratch)
 */
(function (root) {
  'use strict';

  var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  var H0 = 0x6a09e667, H1 = 0xbb67ae85, H2 = 0x3c6ef372, H3 = 0xa54ff53a,
      H4 = 0x510e527f, H5 = 0x9b05688c, H6 = 0x1f83d9ab, H7 = 0x5be0cd19;

  var w = new Uint32Array(64);
  // reusable padding scratch: message bytes copied here (64 blocks = 4096B max input)
  var _buf = new Uint8Array(4096 + 64);

  function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

  // compress one 64-byte block at data[off], folding into running state hv
  function compressInto(data, off, hv) {
    for (var i = 0; i < 16; i++) {
      var j = off + i * 4;
      w[i] = ((data[j] << 24) | (data[j+1] << 16) | (data[j+2] << 8) | data[j+3]) >>> 0;
    }
    for (var t = 16; t < 64; t++) {
      var w15 = w[t-15], w2 = w[t-2];
      var s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      var s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[t] = (w[t-16] + s0 + w[t-7] + s1) >>> 0;
    }
    var a = hv[0], b = hv[1], c = hv[2], d = hv[3], e = hv[4], f = hv[5], g = hv[6], h = hv[7];
    for (var n = 0; n < 64; n++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      var ch = (e & f) ^ (~e & g);
      var temp1 = (h + S1 + ch + K[n] + w[n]) >>> 0;
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hv[0] = (a + hv[0]) >>> 0; hv[1] = (b + hv[1]) >>> 0; hv[2] = (c + hv[2]) >>> 0; hv[3] = (d + hv[3]) >>> 0;
    hv[4] = (e + hv[4]) >>> 0; hv[5] = (f + hv[5]) >>> 0; hv[6] = (g + hv[6]) >>> 0; hv[7] = (h + hv[7]) >>> 0;
  }

  // Compute full sha256 into out32 (caller-provided), reusing _buf scratch.
  // NOTE: msg bytes must be < 560 so padding fits in _buf (576B).
  function rawInto(msg, byteLen, out32) {
    var bitLen = byteLen * 8;
    var nBlocks = Math.ceil((byteLen + 9) / 64);
    _buf.fill(0, 0, nBlocks * 64);
    _buf.set(msg.subarray(0, byteLen), 0);
    _buf[byteLen] = 0x80;
    var b = nBlocks * 64 - 8;
    var hi = Math.floor(bitLen / 0x100000000) >>> 0, lo = bitLen >>> 0;
    _buf[b] = (hi >>> 24) & 0xff; _buf[b+1] = (hi >>> 16) & 0xff; _buf[b+2] = (hi >>> 8) & 0xff; _buf[b+3] = hi & 0xff;
    _buf[b+4] = (lo >>> 24) & 0xff; _buf[b+5] = (lo >>> 16) & 0xff; _buf[b+6] = (lo >>> 8) & 0xff; _buf[b+7] = lo & 0xff;

    var hv = [H0, H1, H2, H3, H4, H5, H6, H7];
    for (var blk = 0; blk < nBlocks; blk++) compressInto(_buf, blk * 64, hv);

    out32[0] = (hv[0] >>> 24) & 0xff; out32[1] = (hv[0] >>> 16) & 0xff; out32[2] = (hv[0] >>> 8) & 0xff; out32[3] = hv[0] & 0xff;
    out32[4] = (hv[1] >>> 24) & 0xff; out32[5] = (hv[1] >>> 16) & 0xff; out32[6] = (hv[1] >>> 8) & 0xff; out32[7] = hv[1] & 0xff;
    out32[8] = (hv[2] >>> 24) & 0xff; out32[9] = (hv[2] >>> 16) & 0xff; out32[10] = (hv[2] >>> 8) & 0xff; out32[11] = hv[2] & 0xff;
    out32[12] = (hv[3] >>> 24) & 0xff; out32[13] = (hv[3] >>> 16) & 0xff; out32[14] = (hv[3] >>> 8) & 0xff; out32[15] = hv[3] & 0xff;
    out32[16] = (hv[4] >>> 24) & 0xff; out32[17] = (hv[4] >>> 16) & 0xff; out32[18] = (hv[4] >>> 8) & 0xff; out32[19] = hv[4] & 0xff;
    out32[20] = (hv[5] >>> 24) & 0xff; out32[21] = (hv[5] >>> 16) & 0xff; out32[22] = (hv[5] >>> 8) & 0xff; out32[23] = hv[5] & 0xff;
    out32[24] = (hv[6] >>> 24) & 0xff; out32[25] = (hv[6] >>> 16) & 0xff; out32[26] = (hv[6] >>> 8) & 0xff; out32[27] = hv[6] & 0xff;
    out32[28] = (hv[7] >>> 24) & 0xff; out32[29] = (hv[7] >>> 16) & 0xff; out32[30] = (hv[7] >>> 8) & 0xff; out32[31] = hv[7] & 0xff;
  }

  // double sha256 of a (usually 80-byte) header; scratch must be 32 bytes
  function doubleRawInto(header, headerLen, scratch32, out32) {
    rawInto(header, headerLen, scratch32);
    rawInto(scratch32, 32, out32);
  }

  function sha256Hex(msg, byteLen) {
    var d = new Uint8Array(32);
    rawInto(msg, byteLen, d);
    return hexOf(d);
  }
  function hexOf(b) {
    var s = '';
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  }
  function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

  var api = { sha256Hex: sha256Hex, rawInto: rawInto, doubleRawInto: doubleRawInto, hexOf: hexOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SHA256 = api;
})(typeof self !== 'undefined' ? self : this);
