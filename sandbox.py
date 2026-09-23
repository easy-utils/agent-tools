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

    def run(self, command: str, wait_s: int = 900, env: dict | None = None) -> tuple[int, str]:
        """Execute and block until the job finishes; return (exit, output)."""
        jid = self._call("Execute", {"command": command, "env": env or {}})["jobId"]
        deadline = time.time() + wait_s
        st: dict = {}
        while time.time() < deadline:
            st = self._call("JobWait", {"jobId": jid, "timeoutMs": 5000})
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
        ["git", "ls-files", "Sources", "Tests", "tool", "Package.swift", "Package.resolved"],
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

    # The iOS device target (arm64) is the app's real deployment target; build
    # the ad-hoc-signed .ipa against the Xcode iPhoneOS SDK.
    log("build ios .ipa (arm64)")
    _, out = w.run(
        f"cd {SWIFTUI_REMOTE} && {env} && bash tool/build-ios.sh /tmp/iosout 2>&1 | tail -3",
        wait_s=2400)
    if "IPA_OK" not in out:
        log(f"ios build FAILED:\n{out}")
        ok = False
    else:
        for line in out.splitlines():
            if "IPA_OK" in line or ".ipa" in line:
                log(line.strip())
    return ok


# ---- desktop builds: compose (dmg/win) + flutter (macos) --------------------
#
# NOTHING downloads on the workers: every artifact (JDK, Flutter SDK, pub
# cache, gradle distribution) is fetched HERE and imported over FileWrite in
# 256MB chunks (sha256-verified worker-side). The guest networks are
# unreliable for large transfers (the gradle zip stalled at 50/137MB on the
# Windows VM; JDK redirects to github time out from macOS).

CHUNK = 256 * 1024 * 1024
GRADLE_URL = "https://services.gradle.org/distributions/gradle-9.7.1-bin.zip"
FLUTTER_VER = "3.47.5"


def upload_file(w: Worker, local: Path, remote: str) -> None:
    """Chunked FileWrite + worker-side reassembly + sha256 verify (cross-platform)."""
    import hashlib
    data_sha = hashlib.sha256(local.read_bytes()).hexdigest()
    parts: list[str] = []
    with open(local, "rb") as f:
        part = 0
        while buf := f.read(CHUNK):
            w._call("FileWrite", {"path": f"{remote}.part{part:02d}",
                                  "content": base64.b64encode(buf).decode()})
            parts.append(f"{remote}.part{part:02d}")
            part += 1
    if w.info().get("os") == "windows":
        rt = remote.replace("/", "\\")
        ps = [p.replace("/", "\\") for p in parts]
        if len(ps) == 1:
            reasm = f"move /y {ps[0]} {rt}"
        else:
            reasm = f"copy /b {'+'.join(ps)} {rt} >nul"
        _, out = w.run(f'cmd /c "{reasm} & certutil -hashfile {rt} SHA256"')
        ok = data_sha.upper() in out.upper()
    else:
        if len(parts) == 1:
            reasm = f"mv {parts[0]} {remote}"
        else:
            reasm = f"cat {remote}.part* > {remote} && rm -f {remote}.part*"
        _, out = w.run(f"{reasm} && echo {data_sha}  {remote} | shasum -a 256 -c -")
        ok = ": OK" in out
    if not ok:
        raise RuntimeError(f"upload verify failed for {local}: {out[-300:]}")


def fetch_local(url: str, dest: Path) -> Path:
    """Download ONCE on the dev pod (proxy env honoured), tencent mirror ok."""
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["curl", "--http1.1", "-sSL", "--retry", "3", "-o", str(dest), url], check=True)
    return dest


def gradle_dists_hash(url: str) -> str:
    """The wrapper's dist dir name: base36 of the MD5 of the distribution URL."""
    import hashlib
    n = int.from_bytes(hashlib.md5(url.encode()).digest(), "big")
    alpha = "0123456789abcdefghijklmnopqrstuvwxyz"
    s = ""
    while n:
        s = alpha[n % 36] + s
        n //= 36
    return s


def provision_mac(w: Worker) -> None:
    """JDK 17 + Flutter SDK on the mac sandbox (uploaded, never downloaded)."""
    _, out = w.run("ls /Users/docker/tools/jdk17/Contents/Home/bin/java "
                   "/Users/docker/tools/flutter/bin/flutter")
    if "No such file" not in out:
        log("mac toolchains already provisioned")
        return
    log("provisioning macx: JDK17 + Flutter (local download -> import)")
    jdk = fetch_local(
        "https://api.adoptium.net/v3/binary/latest/17/ga/mac/x64/jdk/hotspot/normal/eclipse",
        Path("/tmp/opencode/wdl/jdk17-mac.tar.gz"))
    flz = fetch_local(
        f"https://storage.googleapis.com/flutter_infra_release/releases/stable/macos/"
        f"flutter_macos_{FLUTTER_VER}-stable.zip",
        Path("/tmp/opencode/wdl/flutter-mac.zip"))
    upload_file(w, jdk, "dl/jdk17-mac.tar.gz")
    upload_file(w, flz, "dl/flutter-mac.zip")
    _, out = w.run(
        "mkdir -p ~/tools && cd ~/tools && "
        "tar -xzf ~/ewws/dl/jdk17-mac.tar.gz && rm -rf jdk17 && mv jdk-17* jdk17 && "
        "rm -rf flutter && tar -xf ~/ewws/dl/flutter-mac.zip && "
        "/Users/docker/tools/jdk17/Contents/Home/bin/java -version 2>&1 | head -1 && "
        "/Users/docker/tools/flutter/bin/flutter --version | head -1")
    log(out.strip())


def sync_dir(w: Worker, local_repo: Path, remote: str, extra_excludes: list[str]) -> None:
    tgz = Path("/tmp/opencode") / f"{remote}-src.tgz"
    excl = ["build", ".gradle", ".dart_tool", "local.properties", ".kotlin",
            "android/build", ".pub-cache"] + extra_excludes
    args = []
    for e in excl:
        args += ["--exclude", f"./{e}"]
    subprocess.run(["tar", "czf", str(tgz)] + args + ["."],
                   cwd=local_repo, check=True)
    data = tgz.read_bytes()
    w._call("SyncFolder", {"tarball": base64.b64encode(data).decode(),
                           "dest": remote, "clean": True, "rev": "sandbox"})


def compose_mac(token: str | None) -> bool:
    w = Worker("demo-macx", token)
    provision_mac(w)
    log("sync compose source")
    sync_dir(w, APPS_ROOT / "agent-compose", "compose", [])
    env = {"JAVA_HOME": "/Users/docker/tools/jdk17/Contents/Home",
           "GRADLE_USER_HOME": "/Users/docker/ggradle"}
    # NOTE: env MUST go through ExecuteRequest.env — an in-shell `export` does
    # not reach the gradlew subprocess under the builtin interpreter.
    # -PpackageVersion: jpackage rejects a version whose FIRST number is 0.
    w.run("cd compose && chmod +x gradlew", env=env)
    _, out = w.run(
        "cd compose && ./gradlew --no-daemon packageReleaseDmg "
        "-PpackageVersion=1.0.2 2>&1 | tail -5; "
        "find build/compose/binaries -name '*.dmg' -exec ls -la {} \\;", wait_s=3600, env=env)
    ok = ".dmg" in out and "BUILD" in out
    for line in out.splitlines():
        if ".dmg" in line or "BUILD" in line:
            log(line.strip())
    return ok


def flutter_mac(token: str | None) -> bool:
    w = Worker("demo-macx", token)
    provision_mac(w)
    log("sync flutter source + pub cache")
    sync_dir(w, APPS_ROOT / "agent-flutter", "flut", [])
    pub = Path("/tmp/opencode/wdl/pub-cache.tgz")
    if not pub.exists():
        subprocess.run(["tar", "czf", str(pub), "-C", str(Path.home()), ".pub-cache"], check=True)
    _, has = w.run("ls /Users/docker/.pub-cache/hosted")
    if "No such file" in has:
        upload_file(w, pub, "dl/pub-cache.tgz")
        w.run("tar -xzf ~/ewws/dl/pub-cache.tgz -C /Users/docker")
    # First build after a clean sync sometimes trips on the one-time SPM/pub
    # resolution (the guest's github access is flaky); a retry completes it.
    out = ""
    for attempt in (1, 2):
        _, out = w.run(
            "cd ~/ewws/flut && /Users/docker/tools/flutter/bin/flutter build macos --release "
            "2>&1 | tail -4; ls build/macos/Build/Products/Release/ "
            "2>/dev/null | head -4", wait_s=3600)
        if "agent_app.app" in out:
            break
        log(f"attempt {attempt} failed; retrying")
    ok = "agent_app.app" in out
    for line in out.splitlines()[:6]:
        log(line.strip())
    return ok


def compose_win(token: str | None) -> bool:
    w = Worker("demo-win", token)
    log("sync compose source")
    sync_dir(w, APPS_ROOT / "agent-compose", "compose", [])
    env = {"JAVA_HOME": r"C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot",
           "GRADLE_USER_HOME": r"C:\Users\Docker\ggradle",
           "GITHUB_ACTOR": os.environ.get("GITHUB_ACTOR", "SilverMelon233"),
           "GITHUB_TOKEN": os.environ.get("GITHUB_TOKEN", "")}
    # Seed the wrapper's dist dir with an IMPORTED distribution (the VM's own
    # download stalls: observed frozen at 50/137MB).
    d = r"C:\Users\Docker\ggradle\wrapper\dists\gradle-9.7.1-bin\\" + gradle_dists_hash(GRADLE_URL)
    _, seeded = w.run(f'cmd /c "if exist {d}\\gradle-9.7.1-bin.zip (echo SEEDED) else (echo NO)"')
    if "SEEDED" not in seeded:
        log("importing gradle 9.7.1 dist into the win wrapper cache")
        gz = fetch_local(GRADLE_URL.replace(
            "https://services.gradle.org",
            "https://mirrors.cloud.tencent.com/gradle").replace(
            "gradle/gradle", "gradle"), Path("/tmp/opencode/wdl/gradle-9.7.1-bin.zip"))
        upload_file(w, gz, "dl/gradle-9.7.1-bin.zip")
        w.run(f'cmd /c "if not exist {d} mkdir {d} & '
              f'copy /y C:\\Users\\Docker\\ewws\\dl\\gradle-9.7.1-bin.zip '
              f'{d}\\gradle-9.7.1-bin.zip >nul & echo IMPORTED"')
    _, out = w.run(
        'cd compose && cmd /c "gradlew.bat --no-daemon '
        ':compileKotlinDesktop :compileKotlinWasmJs 2>&1"', wait_s=3600, env=env)
    tail = "\n".join(out.splitlines()[-4:])
    ok = "BUILD SUCCESSFUL" in out
    log(tail.strip())
    return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("target", choices=["android", "macos", "all",
                                       "compose-mac", "compose-win", "flutter-mac"])
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

    desktop = {"compose-mac": compose_mac, "compose-win": compose_win,
               "flutter-mac": flutter_mac}
    if args.target in desktop:
        fn = desktop[args.target]
        print(f"\n===== {args.target} =====")
        try:
            if not fn(args.token):
                failed += 1
        except Exception as e:  # noqa: BLE001
            log(f"ERROR {type(e).__name__}: {e}"); failed += 1

    print()
    print("sandbox: ALL PASS" if failed == 0 else f"sandbox: {failed} FAILED")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
