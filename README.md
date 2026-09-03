# ⛏ FLOP Mining Concept Simulator

**The Flop Network · 挖矿概念交互模拟器** — a browser live demo of *how mining works* on the Flop Network economics, powered by **real double-SHA-256 proof-of-work** running in your browser. No fake animations — every block you "mine" is a genuine hash found by scanning nonces, then re-verified on the main thread before the reward is paid out.

> 🎯 Live demo: **https://anyixuan798-wq.github.io/flop-mining-concept/**
>
> Community concept demo — **not affiliated with Flop Labs**. All $FLOP balances are simulated; no real value. Data from the official [Flop Network Teaser v0.1](https://flop.finance/teaser/) (2026-08-26).

---

## ✨ What it does

| 面板 | 内容 |
|---|---|
| 🎛 Miner Console | Start/stop mining, adjust **difficulty** (target leading zeros) and **hashpower** (parallel Web-Workers). Watch the live 80-byte block header (version / prev_hash / merkle_root / time / bits / nonce) scan in real time. |
| ⛏ Real PoW | Web Workers brute-force **double-SHA-256** over a partitioned nonce space. When a candidate is found, the main thread **independently re-verifies** the header before the block is accepted — a cheat cannot be mined. |
| 👛 Wallet & Halving | Earn **96 $FLOP / block** (official value). Reward halves every 25 blocks in demo-accelerated time — mirroring the real schedule (halving every 730 days × 5, then constant in perpetuity). |
| 📡 DID Broadcast | Paste a **did:key seed** (32-byte hex, same format as `keys.txt`). Every mined block / session start / stop is **signed locally with Ed25519** and broadcast over GET to `technocore.chat` lobby — your mining activity becomes real, verifiable network participation. Seed stays in *your browser's localStorage only*; the repo contains **no private keys**. |
| 📊 Official mechanics | Block reward, 1s block time, PoUI, 85% fee pass-through, miner allocations from the teaser. |

## 🧠 Why it's interesting

Flop Network is **not** classical PoW — it is a *proof-of-useful-inference (PoUI)* chain where miners run GPUs doing verifiable AI inference (TEE attestation + TOPLOC fingerprints + sampled re-execution + staking/slashing). This simulator uses real SHA-256 work as an intuitive stand-in so anyone can *feel* the economics: harder target → more work → reward for the finder.

## 🚀 Run locally

```bash
# any static file server works (no build step)
python -m http.server 8000        # then open http://localhost:8000
```

## 🔬 Test suite

```bash
node test/crosscheck.js     # JS sha256+did:key ↔ python cryptography vector parity
node test/pipeline.js       # full mine → verify → reward loop, real hashes
python test/e2e_browser.py  # real Chrome E2E: page loads, DID derives, block mined & broadcast 200
python test/crosscheck.py   # (helper) regenerate python reference vectors
```

## 🔒 Privacy & safety

- Private key material (seed) is entered **per-browser**, stored **only in localStorage**, signed **only in-page**. Nothing is transmitted except the signed messages you opt into.
- The repository contains **zero keys**. Use a dedicated test identity, never a main wallet.
- Broadcasts are public and permanent — mind what you post to `lobby`.

## 📚 Sources

- Flop Network Teaser v0.1 — https://flop.finance/teaser/
- Technocore Chat protocol — https://technocore.chat/llms.txt

MIT License.
