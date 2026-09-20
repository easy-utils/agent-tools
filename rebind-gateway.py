#!/usr/bin/env python3
"""(Re)bind the platform gateway providers per tenant.

There are TWO gateways and TWO keys with different model visibility:

  * ai-gateway-dev004 .../v4/ai      key GW_KEY_DEV004
        -> 17 models: the 16 listed by /v4/ai/config PLUS `local/local-text`
           (a language model that the gateway will serve but does not list).
  * api-gray.xueersi.com/ai-multimodal-gateway/v4/ai   key GW_KEY_GRAY
        -> 13 models (no `local/*` at all).

Per the owner's instruction:
  * myuser                    -> dev004 + GW_KEY_DEV004 (full set, incl. local-text)
  * default / test1 / test2 / test3 -> gray + GW_KEY_GRAY (subset, no `local/*`)

For each tenant this deletes its existing `gateway*` provider rows, then
re-registers one provider per modality with only its models.

Usage:
    python3 tools/rebind-gateway.py
    python3 tools/rebind-gateway.py --dry-run
    python3 tools/rebind-gateway.py --tenant myuser
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
    "AGENT_BASE", "https://agent.agent.10.199.64.20.nip.io"
).rstrip("/")

GW_DEV004 = "https://ai-gateway-dev004.develop.10.199.64.20.nip.io/v4/ai"
GW_GRAY = "https://api-gray.xueersi.com/ai-multimodal-gateway/v4/ai"

# Credentials are supplied via the environment (this checkout is public — no
# live keys are committed). See the tenant table below for the expected vars.
KEY_HZ = os.environ.get("GW_KEY_DEV004", "")
KEY_SK = os.environ.get("GW_KEY_GRAY", "")

TEXT_CTX = 262144

# tenant -> (token, gateway base, key, include_local)
# Tokens come from AGENT_TOKEN_<TENANT> (uppercased, dashes -> underscores).
TENANTS: dict[str, tuple[str, str, str, bool]] = {
    "default": (os.environ.get("AGENT_TOKEN_DEFAULT", ""), GW_GRAY, KEY_SK, False),
    "test1": (os.environ.get("AGENT_TOKEN_TEST1", ""), GW_GRAY, KEY_SK, False),
    "test2": (os.environ.get("AGENT_TOKEN_TEST2", ""), GW_GRAY, KEY_SK, False),
    "test3": (os.environ.get("AGENT_TOKEN_TEST3", ""), GW_GRAY, KEY_SK, False),
    "myuser": (os.environ.get("AGENT_TOKEN_MYUSER", ""), GW_DEV004, KEY_HZ, True),
}

# capability -> [(model id, display name, context limit)] for EVERY tenant.
BY_CAPABILITY: dict[str, list[tuple[str, str, int]]] = {
    "text": [
        ("tal-coding/deepseek-v4.1-flash", "DeepSeek V4.1 Flash", TEXT_CTX),
        ("tal-coding/glm-5.3", "GLM 5.3", TEXT_CTX),
        ("tal-coding/glm-5.3-flash", "GLM 5.3 Flash", TEXT_CTX),
    ],
    "image": [
        ("tal-coding-gptimage/gpt-image-2", "GPT Image 2", 0),
        ("tal-coding-gptimage/gpt-image-2.5-flare", "GPT Image 2.5 Flare", 0),
        ("tal-coding-gptimage/gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst", 0),
    ],
    "video": [("local/minimax-h3-video", "MiniMax H3 Video", 0)],
    "speech": [
        ("mlops-tts-customvoice/qwen3-tts-customvoice", "Qwen3 TTS CustomVoice", 0),
        ("mlops-tts-base/qwen3-tts-base", "Qwen3 TTS Base", 0),
    ],
    "transcription": [("mlops-asr/qwen3-asr", "Qwen3 ASR", 0)],
    "embedding": [("mlops-embed/gte-multilingual-base", "GTE Multilingual", 0)],
    "rerank": [("mlops-rerank/gte-multilingual-reranker-base", "GTE Reranker", 0)],
    "realtime": [("mlops-voxtral/voxtral-realtime", "Voxtral Realtime", 0)],
}

# Extra models only the dev004 tenant may use. `local/local-text` is a
# language model the gateway serves but omits from its listings.
LOCAL_EXTRA: dict[str, list[tuple[str, str, int]]] = {
    "text": [("local/local-text", "Local Text", TEXT_CTX)],
    "image": [
        ("local/local-image", "Local Image", 0),
        ("local/local-image-edit", "Local Image Edit", 0),
    ],
    "video": [("local/local-video", "Local Video", 0)],
}

LEGACY_IDS = [f"gateway-{c}" for c in BY_CAPABILITY]


def models_for(include_local: bool) -> list[tuple[str, list[tuple[str, str, int]]]]:
    out: list[tuple[str, list[tuple[str, str, int]]]] = []
    for cap, models in BY_CAPABILITY.items():
        merged = list(models) + (LOCAL_EXTRA.get(cap, []) if include_local else [])
        out.append((cap, merged))
    return out


CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def call(token: str, method: str, payload: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE}/agent.v1.AgentService/{method}",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {token}",
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
    ap.add_argument("--tenant")
    args = ap.parse_args()

    tenants = {args.tenant: TENANTS[args.tenant]} if args.tenant else TENANTS

    if args.dry_run:
        for t, (_, gw, key, include_local) in tenants.items():
            print(f"\n=== {t}  gw={gw.split('//')[1].split('/')[0]}  key={key[:6]}... ===")
            for c in LEGACY_IDS:
                print(f"  DELETE {c}")
            for cap, models in models_for(include_local):
                print(f"  REGISTER gateway-{cap} -> {[m[0] for m in models]}")
        return 0

    failures = 0
    for t, (token, gw, key, include_local) in tenants.items():
        print(f"\n=== {t} ({gw}) ===")
        for pid in LEGACY_IDS:
            r = call(token, "DeleteProvider", {"providerId": pid})
            err = r.get("__err__")
            if err and "not found" not in err.lower():
                print(f"  delete {pid}: {err}")
                failures += 1
            else:
                print(f"  deleted {pid}")
        for cap, models in models_for(include_local):
            r = call(token, "RegisterProvider", {
                "provider": {
                    "providerId": f"gateway-{cap}",
                    "capability": cap,
                    "apiType": "vercel-compatible-gateway",
                    "baseUrl": gw,
                    "apiKey": key,
                    "models": [
                        {"id": mid, "name": name, "contextLimit": ctx}
                        for mid, name, ctx in models
                    ],
                },
            })
            if r.get("__err__"):
                print(f"  register gateway-{cap}: {r['__err__']}")
                failures += 1
            else:
                print(f"  registered gateway-{cap}: {[m[0] for m in models]}")

    print("\n" + ("FAILURES" if failures else "OK"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
