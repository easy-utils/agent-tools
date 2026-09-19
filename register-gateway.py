#!/usr/bin/env python3
"""Repoint the platform gateway providers to the new ai-multimodal-gateway.

Deletes every existing `gateway*` provider row (the old
`ai-gateway-dev004.../v4/ai` registration) and re-registers one provider per
modality against the new gateway, with the NEW model ids from its `/v1/models`.

    python3 tools/register-gateway.py            # apply
    python3 tools/register-gateway.py --dry-run  # print the calls only

Config (env-overridable; no defaults for the secrets — this checkout is public):
    AGENT_BASE   default https://standalone-agent.temp.10.199.64.20.nip.io
    AGENT_TOKEN  required
    GW_BASE      default https://api-gray.xueersi.com/ai-multimodal-gateway/v4/ai
    GW_KEY       required
"""
from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import urllib.error
import urllib.request

BASE = os.environ.get(
    "AGENT_BASE", "https://standalone-agent.temp.10.199.64.20.nip.io"
).rstrip("/")
TOKEN = os.environ.get("AGENT_TOKEN", "")
GW_BASE = os.environ.get(
    "GW_BASE", "https://api-gray.xueersi.com/ai-multimodal-gateway/v4/ai"
)
GW_KEY = os.environ.get("GW_KEY", "")

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

# provider id -> capability -> models (id, display name, context limit)
# Text models need a >0 context limit; every other modality MUST be 0.
TEXT_CTX = 262144
PROVIDERS: list[tuple[str, str, list[tuple[str, str, int]]]] = [
    ("gateway-text", "text", [
        ("tal-coding/deepseek-v4.1-flash", "DeepSeek V4.1 Flash", TEXT_CTX),
        ("tal-coding/glm-5.3", "GLM 5.3", TEXT_CTX),
        ("tal-coding/glm-5.3-flash", "GLM 5.3 Flash", TEXT_CTX),
    ]),
    ("gateway-image", "image", [
        ("tal-coding-gptimage/gpt-image-2", "GPT Image 2", 0),
        ("tal-coding-gptimage/gpt-image-2.5-flare", "GPT Image 2.5 Flare", 0),
        ("tal-coding-gptimage/gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst", 0),
        ("local/local-image", "Local Image", 0),
        ("local/local-image-edit", "Local Image Edit", 0),
    ]),
    ("gateway-video", "video", [
        ("local/minimax-h3-video", "MiniMax H3 Video", 0),
        ("local/local-video", "Local Video", 0),
    ]),
    ("gateway-speech", "speech", [
        ("mlops-tts-customvoice/qwen3-tts-customvoice", "Qwen3 TTS CustomVoice", 0),
        ("mlops-tts-base/qwen3-tts-base", "Qwen3 TTS Base", 0),
    ]),
    ("gateway-transcription", "transcription", [
        ("mlops-asr/qwen3-asr", "Qwen3 ASR", 0),
    ]),
    ("gateway-embedding", "embedding", [
        ("mlops-embed/gte-multilingual-base", "GTE Multilingual", 0),
    ]),
    ("gateway-rerank", "rerank", [
        ("mlops-rerank/gte-multilingual-reranker-base", "GTE Reranker", 0),
    ]),
    ("gateway-realtime", "realtime", [
        ("mlops-voxtral/voxtral-realtime", "Voxtral Realtime", 0),
    ]),
]

# Old provider ids to remove. `gateway` / `gateway-<modality>` were the
# dev004 registrations; the bare `gateway` row held every modality at once.
LEGACY_IDS = [
    "gateway", "gateway-text", "gateway-image", "gateway-video",
    "gateway-speech", "gateway-transcription", "gateway-embedding",
    "gateway-rerank", "gateway-realtime",
]


def call(method: str, payload: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE}/agent.v1.AgentService/{method}",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "Connect-Protocol-Version": "1",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120, context=CTX) as r:
            body = r.read().decode()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        return {"__err__": f"HTTP {e.code}: {e.read().decode()[:300]}"}
    except Exception as e:  # noqa: BLE001
        return {"__err__": str(e)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.dry_run:
        print(f"AGENT {BASE}\nGW    {GW_BASE} key={GW_KEY}\n")
        for pid in LEGACY_IDS:
            print(f"DELETE {pid}")
        for pid, cap, models in PROVIDERS:
            print(f"REGISTER {pid} [{cap}] -> {[m[0] for m in models]}")
        return 0

    failures = 0
    for pid in LEGACY_IDS:
        r = call("DeleteProvider", {"providerId": pid})
        err = r.get("__err__")
        # A missing provider is fine (idempotent re-run).
        if err and "not found" not in err.lower():
            print(f"  delete {pid}: {err}")
            failures += 1
        else:
            print(f"  deleted {pid}")

    for pid, cap, models in PROVIDERS:
        r = call("RegisterProvider", {
            "provider": {
                "providerId": pid,
                "capability": cap,
                "apiType": "vercel-compatible-gateway",
                "baseUrl": GW_BASE,
                "apiKey": GW_KEY,
                "models": [
                    {"id": mid, "name": name, "contextLimit": ctx}
                    for mid, name, ctx in models
                ],
            },
        })
        if r.get("__err__"):
            print(f"  register {pid}: {r['__err__']}")
            failures += 1
        else:
            print(f"  registered {pid} [{cap}]")

    print("FAILURES" if failures else "OK")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
