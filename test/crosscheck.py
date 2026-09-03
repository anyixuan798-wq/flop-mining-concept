#!/usr/bin/env python3
"""Generate reference vectors for JS crosscheck using python cryptography
(same libs as technocore_batch.py). Run: python crosscheck.py > py_vectors.json"""
import json, hashlib
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
import base64

def b58encode(b: bytes) -> str:
    alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    n = int.from_bytes(b, "big")
    s = ""
    while n:
        n, r = divmod(n, 58)
        s = alphabet[r] + s
    pad = len(b) - len(b.lstrip(b"\x00"))
    return "1" * pad + s

SEEDS = [
    "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    "476d7b5ae33da96a4b99e824e06f6c311247ce0b94eee32097f24a8196658e0d",
]
out = {}
for sh in SEEDS:
    seed = bytes.fromhex(sh)
    priv = Ed25519PrivateKey.from_private_bytes(seed)
    pub = priv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    did = "did:key:z" + b58encode(b"\xed\x01" + pub)
    fp = hashlib.sha256(did.encode()).hexdigest()[:16]
    room = "fp-" + fp
    nonce = "1750000000000"
    text = "hello from flop miner demo block #12 +96 $FLOP"
    payload = f"{room}|{nonce}|{text}".encode()
    sig = base64.urlsafe_b64encode(priv.sign(payload)).rstrip(b"=").decode()
    out[sh] = {"did": did, "fp": fp, "sig": sig}
print(json.dumps(out))
