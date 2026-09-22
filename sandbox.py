#!/usr/bin/env python3
"""Real-platform build+run on the easyworker sandboxes.

The static guards and the `swiftc -parse` syntax check cannot prove a client
compiles or launches with its REAL toolchain. This tool does:

  android (demo-aosp / demo-gms)  the sandbox has adb + the KVM emulator but NO
                                  build toolchain, so the x86_64 debug APK is
                                  built HERE (the dev pod has Flutter + the
                                  Android SDK), pushed in over the worker's
                                  binary-safe FileWrite, then adb install /
                                  am start / asserted via uiautomator dump.

  macos   (demo-macx)             clone agent-swiftui into the workspace, push
                                  the local working tree, then `swift build` +
                                  `swift test` with the real Xcode toolchain
                                  (SwiftUI + LucideSwift link for real).

    python3 sandbox.py android [flutter|compose|both] [--pod demo-aosp]
    python3 sandbox.py macos
    python3 sandbox.py all

`all` = android both + macos. Slow (a full Flutter debug build + SwiftPM), so
it is the `--sandbox` tier of check.sh, not the default.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

APPS_ROOT = Path(os.environ.get("AGENT_APPS_ROOT") or Path(__file__).resolve().parent.parent)
FLUTTER = Path("/home/user/flutter/bin/flutter")
ANDROID_HOME = Path(os.environ.get("ANDROID_HOME") or "/home/user/Android/sdk")
JAVA_HOME = os.environ.get("JAVA_HOME") or "/opt/tools/mise/installs/java/17.0.2"

# client -> (package id, launcher activity, APK path after build)
CLIENTS = {
    "flutter": ("easy.agent.flutter", ".MainActivity",
                APPS_ROOT / "agent-flutter/build/app/outputs/flutter-apk/app-debug.apk"),
    "compose": ("easy.agent.compose", ".MainActivity",
                APPS_ROOT / "agent-compose/android/build/outputs/apk/debug/android-debug.apk"),
}

SWIFTUI_REPO = "https://github.com/easy-utils/agent-swiftui.git"
SWIFTUI_REMOTE = "swui-sandbox"  # under the mac worker workspace root


def log(msg: str) -> None:
    print(f"  {msg}", flush=True)


def _clean_env() -> dict:
    env = dict(os.environ)
    env.update({"JAVA_HOME": JAVA_HOME, "ANDROID_HOME": str(ANDROID_HOME),
                "ANDROID_SDK_ROOT": str(ANDROID_HOME),
                "no_proxy": "*", "NO_PROXY": "*"})
    for k in ("https_proxy", "http_proxy", "HTTPS_PROXY", "HTTP_PROXY"):
        env.pop(k, None)
    env["PATH"] = f"{FLUTTER.parent}:{env.get('PATH', '')}"
    return env


def build_android(which: str) -> Path:
    """Build a debug x86_64 APK for the sandbox; return its path."""
    env = _clean_env()
    if which == "flutter":
        cmd = [str(FLUTTER), "build", "apk", "--debug",
               "--target-platform", "android-x64",
               "--dart-define=cronetHttpNoPlay=true"]
        cwd = APPS_ROOT / "agent-flutter"
    elif which == "compose":
        env["GITHUB_ACTOR"] = os.environ.get("GITHUB_ACTOR", "SilverMelon233")
        env.setdefault("GITHUB_TOKEN", os.environ.get("GITHUB_TOKEN", ""))
        cmd = ["./gradlew", ":android:assembleDebug", "-Pabis=x86_64", "-q"]
        cwd = APPS_ROOT / "agent-compose"
    else:
        raise SystemExit(f"unknown android client {which}")
    log(f"build: {' '.join(cmd)}  (cwd={cwd})")
    if subprocess.run(cmd, cwd=cwd, env=env).returncode != 0:
        raise SystemExit(f"build failed ({which})")
    apk = CLIENTS[which][2]
    if not apk.exists():
        raise SystemExit(f"build produced no APK at {apk}")
    log(f"APK: {apk} ({apk.stat().st_size / 1e6:.1f} MB)")
    return apk


class Worker:
    def __init__(self, pod: str, token: str | None = None):
        self.base = f"http://{pod}.temp.svc.cluster.local:48080"
        self.token = token or f"{pod}-token"

    def _call(self, method: str, body: dict, timeout: int = 300) -> dict:
        req = urllib.request.Request(
            f"{self.base}/worker.v1.WorkerService/{method}",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {self.token}"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")

    def info(self) -> dict:
        return self._call("Info", {})

    def write(self, path: str, data: bytes) -> None:
        self._call("FileWrite", {"path": path, "content": base64.b64encode(data).decode()})

    def run(self, command: str, wait_s: int = 900) -> tuple[int, str]:
        """Execute and block until the job finishes; return (exit, output)."""
        jid = self._call("Execute", {"command": command})["jobId"]
        deadline = time.time() + wait_s
        st: dict = {}
        while time.time() < deadline:
            st = self._call("JobWait", {"jobId": jid, "timeout_ms": 5000})
            if st.get("state") in ("done", "failed", "killed"):
                break
        out = self._call("JobOutput", {"jobId": jid, "start": 0})
        return int(st.get("exitCode", 0)), "\n".join(out.get("lines", []))


def test_android_client(which: str, pod: str, token: str | None, keep: bool) -> bool:
    pkg, _activity, _ = CLIENTS[which]
    apk = build_android(which)
    w = Worker(pod, token)
    info = w.info()
    if info.get("os") != "linux":
        raise SystemExit(f"{pod} is not an Android sandbox (os={info.get('os')})")
    log(f"worker: os={info['os']} arch={info['arch']} workspace={info['workspace']}")

    remote = f"/workspace/{which}-sandbox.apk"
    log(f"push {apk.name} -> {remote}")
    w.write(remote, apk.read_bytes())

    log("adb install")
    _, out = w.run(f"adb install -r -d {remote} 2>&1 | tail -3", wait_s=300)
    if "Success" not in out:
        log(f"install FAILED:\n{out}")
        return False
    log("installed")

    log("launch")
    w.run(f"adb shell am force-stop {pkg}", wait_s=30)
    w.run(f"adb shell monkey -p {pkg} -c android.intent.category.LAUNCHER 1", wait_s=60)
    time.sleep(6)

    _, resumed = w.run("adb shell dumpsys activity activities | grep -i ResumedActivity", wait_s=40)
    _, pid = w.run(f"adb shell pidof {pkg}", wait_s=30)
    _, crash = w.run("adb logcat -d -b crash -t 20", wait_s=40)
    w.run("adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1", wait_s=60)
    _, xml = w.run("adb shell cat /sdcard/ui.xml", wait_s=40)

    ok = True
    if pkg not in resumed:
        log(f"FAIL not resumed: {resumed.strip()[:200]}"); ok = False
    if not pid.strip():
        log("FAIL no pid"); ok = False
    if pkg not in xml:
        log("FAIL UI dump does not contain the package (blank screen?)"); ok = False
    if crash.strip():
        log(f"FAIL crash log:\n{crash[-400:]}"); ok = False
    if ok:
        log(f"OK {pkg} resumed pid={pid.strip()} ui={len(xml)}B")

    if not keep:
        w.run(f"adb uninstall {pkg}", wait_s=60)
        w.run(f"adb shell rm -f {remote}", wait_s=30)
    return ok


def test_swiftui(pod: str = "demo-macx", token: str | None = None) -> bool:
    """Build + run the SwiftUI conformance suite on the macOS Xcode sandbox."""
    root = APPS_ROOT / "agent-swiftui"
    w = Worker(pod, token)
    info = w.info()
    if info.get("os") != "darwin":
        raise SystemExit(f"{pod} is not a macOS sandbox (os={info.get('os')})")
    log(f"worker: os={info['os']} arch={info['arch']} workspace={info['workspace']}")

    # Clone ONCE and keep it: the SwiftPM checkouts live under .build, so a
    # persistent tree means later runs need no network (GitHub is flaky from
    # the guest and SwiftPM's parallel clones time out).
    log(f"ensure clone {SWIFTUI_REPO} -> {SWIFTUI_REMOTE}")
    _, out = w.run(
        f"[ -f {SWIFTUI_REMOTE}/Package.swift ] || "
        f"git clone --depth 1 {SWIFTUI_REPO} {SWIFTUI_REMOTE} 2>&1 | tail -2; "
        f"ls {SWIFTUI_REMOTE}/Package.swift", wait_s=300)
    if "Package.swift" not in out:
        log(f"clone FAILED:\n{out}")
        return False

    files = subprocess.check_output(
        ["git", "ls-files", "Sources", "Tests", "Package.swift", "Package.resolved"],
        cwd=root, text=True).split()
    log(f"push {len(files)} local files")
    for f in files:
        w.write(f"{SWIFTUI_REMOTE}/{f}", (root / f).read_bytes())

    env = "export PATH=/usr/bin:/bin:/usr/sbin:/sbin"
    # `--only-use-versions-from-resolved-file` stops SwiftPM from re-fetching
    # every remote on each run (the guest's GitHub access is unreliable); the
    # first run still needs the network once to populate .build/checkouts.
    flags = "--only-use-versions-from-resolved-file"
    log("swift build")
    out = ""
    for attempt in range(1, 4):
        _, out = w.run(
            f"cd {SWIFTUI_REMOTE} && {env} && swift build {flags} 2>&1 | tail -5", wait_s=2400)
        if "Build complete" in out:
            break
        log(f"attempt {attempt} did not complete; retrying")
    if "Build complete" not in out:
        log(f"build FAILED (first run needs network for SwiftPM):\n{out}")
        return False
    log("build OK")

    log("swift test (conformance)")
    _, out = w.run(
        f"cd {SWIFTUI_REMOTE} && {env} && swift test {flags} 2>&1 "
        f"| grep -E 'Test Case.*(passed|failed)|Executed [0-9]+ tests' | tail -20", wait_s=2400)
    ok = "with 0 failures" in out and "failed (" not in out
    for line in out.splitlines():
        log(line)
    return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("target", choices=["android", "macos", "all"])
    ap.add_argument("client", nargs="?", default="both",
                    choices=["flutter", "compose", "both"],
                    help="android only")
    ap.add_argument("--pod", default=None, help="android pod (default demo-aosp)")
    ap.add_argument("--token", default=None)
    ap.add_argument("--keep", action="store_true", help="keep the app installed")
    args = ap.parse_args()

    failed = 0
    if args.target in ("android", "all"):
        pod = args.pod or "demo-aosp"
        clients = ["flutter", "compose"] if args.client == "both" else [args.client]
        for c in clients:
            print(f"\n===== {c} on {pod} =====")
            try:
                if not test_android_client(c, pod, args.token, args.keep):
                    failed += 1
            except Exception as e:  # noqa: BLE001
                log(f"ERROR {type(e).__name__}: {e}"); failed += 1
    if args.target in ("macos", "all"):
        print("\n===== swiftui on demo-macx =====")
        try:
            if not test_swiftui("demo-macx", args.token):
                failed += 1
        except Exception as e:  # noqa: BLE001
            log(f"ERROR {type(e).__name__}: {e}"); failed += 1

    print()
    print("sandbox: ALL PASS" if failed == 0 else f"sandbox: {failed} FAILED")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
