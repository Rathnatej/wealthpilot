"""Encryption at rest for voice transcripts and summaries (Fernet / AES-128-CBC + HMAC).

Key: VOICE_ENCRYPTION_KEY (a urlsafe-base64 32-byte Fernet key) if set, otherwise derived
from JWT_SECRET. Set a dedicated key in production: rotating JWT_SECRET would otherwise make
stored transcripts unreadable.
Generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""
import base64
import hashlib
import json
import os

from cryptography.fernet import Fernet, InvalidToken


def _fernet() -> Fernet:
    key = os.getenv("VOICE_ENCRYPTION_KEY")
    if key:
        return Fernet(key.encode())
    secret = os.getenv("JWT_SECRET", "dev-only-insecure-secret")
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(("voice:" + secret).encode()).digest()))


def encrypt_json(obj) -> str:
    return _fernet().encrypt(json.dumps(obj, ensure_ascii=False).encode()).decode()


def decrypt_json(token: str | None):
    if not token:
        return None
    try:
        return json.loads(_fernet().decrypt(token.encode()).decode())
    except (InvalidToken, ValueError):
        return None  # key changed or data corrupt: treat as unreadable, never crash
