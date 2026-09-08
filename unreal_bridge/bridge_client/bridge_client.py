#!/usr/bin/env python3
"""Auralith Unreal Bridge local agent.

Control plane:
  ChatGPT/GitHub -> unreal_bridge/commands/*.json -> this agent -> localhost TCP -> Unreal Editor
  Unreal Editor -> this agent -> unreal_bridge/results/*.json -> GitHub

Render feedback:
  Movie Render Queue finishes -> agent asks Unreal for fresh preview files -> agent
  copies only whitelisted Saved/MovieRenders images into unreal_bridge/previews/latest
  -> Git commit/push -> ChatGPT can inspect the actual rendered pixels.

The agent binds only to 127.0.0.1 by default. It uses only the Python standard
library plus the user's existing Git installation/authentication.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import threading
import time
from typing import Any, Dict, Optional


_GIT_LOCK = threading.RLock()
_PREVIEW_EXTENSIONS = {".png", ".jpg", ".jpeg"}


def log(message: str) -> None:
    print(time.strftime("[%H:%M:%S]"), message, flush=True)


def run_git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    proc = subprocess.run(
        ["git", "-C", str(repo), *args],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if check and proc.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed:\n{proc.stdout}")
    return proc


def find_repo_root(start: Path) -> Path:
    current = start.resolve()
    for candidate in [current, *current.parents]:
        if (candidate / ".git").exists():
            return candidate
    raise RuntimeError("Could not find the Auralith Git repository. Run this script from a cloned checkout.")


def load_config(bridge_root: Path) -> Dict[str, Any]:
    local = bridge_root / "local_config.json"
    example = bridge_root / "config.example.json"
    source = local if local.exists() else example
    if not source.exists():
        raise RuntimeError(f"Missing bridge configuration: {source}")
    with source.open("r", encoding="utf-8") as fh:
        cfg = json.load(fh)
    if not local.exists():
        log("Using config.example.json. Copy it to local_config.json to customize local-only settings.")
    return cfg


class UnrealConnection:
    def __init__(self, host: str, port: int) -> None:
        self.host = host
        self.port = port
        self._server: Optional[socket.socket] = None
        self._conn: Optional[socket.socket] = None
        self._conn_lock = threading.Lock()
        self._cv = threading.Condition()
        self._responses: Dict[str, Dict[str, Any]] = {}
        self.hello: Dict[str, Any] = {}
        self._stop = threading.Event()

    def start(self) -> None:
        thread = threading.Thread(target=self._serve, name="UnrealBridgeServer", daemon=True)
        thread.start()

    def stop(self) -> None:
        self._stop.set()
        with self._conn_lock:
            if self._conn:
                try:
                    self._conn.close()
                except OSError:
                    pass
                self._conn = None
        if self._server:
            try:
                self._server.close()
            except OSError:
                pass

    def _serve(self) -> None:
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((self.host, self.port))
        server.listen(1)
        server.settimeout(1.0)
        self._server = server
        log(f"Listening for Unreal Editor on {self.host}:{self.port}")

        while not self._stop.is_set():
            try:
                conn, addr = server.accept()
            except socket.timeout:
                continue
            except OSError:
                break

            log(f"Unreal connection accepted from {addr[0]}:{addr[1]}")
            conn.settimeout(None)
            with self._conn_lock:
                old = self._conn
                self._conn = conn
                if old:
                    try:
                        old.close()
                    except OSError:
                        pass
            self.hello = {}
            with self._cv:
                self._cv.notify_all()
            threading.Thread(target=self._reader, args=(conn,), daemon=True).start()

    def _reader(self, conn: socket.socket) -> None:
        buffer = b""
        try:
            while not self._stop.is_set():
                chunk = conn.recv(65536)
                if not chunk:
                    break
                buffer += chunk
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    if not line.strip():
                        continue
                    try:
                        msg = json.loads(line.decode("utf-8"))
                    except Exception as exc:
                        log(f"Ignored malformed Unreal message: {exc}")
                        continue
                    mtype = msg.get("type")
                    if mtype == "hello":
                        self.hello = msg
                        log(
                            "Unreal ready: "
                            f"project={msg.get('project_file', '?')} "
                            f"engine={msg.get('engine_version', '?')}"
                        )
                        with self._cv:
                            self._cv.notify_all()
                    elif mtype == "result" and msg.get("id"):
                        with self._cv:
                            self._responses[str(msg["id"])] = msg
                            self._cv.notify_all()
                    elif mtype == "log":
                        log(f"UE: {msg.get('message', '')}")
        except OSError:
            pass
        finally:
            with self._conn_lock:
                if self._conn is conn:
                    self._conn = None
            self.hello = {}
            with self._cv:
                self._cv.notify_all()
            log("Unreal connection closed; waiting for reconnect.")

    def wait_until_ready(self, timeout: float = 0.0) -> bool:
        deadline = None if timeout <= 0 else time.time() + timeout
        with self._cv:
            while not self._stop.is_set():
                with self._conn_lock:
                    connected = self._conn is not None
                if connected and self.hello:
                    return True
                if deadline is not None:
                    remaining = deadline - time.time()
                    if remaining <= 0:
                        return False
                    self._cv.wait(min(remaining, 1.0))
                else:
                    self._cv.wait(1.0)
        return False

    def send_command(self, command: Dict[str, Any], timeout: float) -> Dict[str, Any]:
        command_id = str(command["id"])
        with self._conn_lock:
            conn = self._conn
            if conn is None:
                raise RuntimeError("Unreal Editor is not connected")
            payload = json.dumps({"type": "command", **command}, separators=(",", ":")) + "\n"
            conn.sendall(payload.encode("utf-8"))

        deadline = time.time() + timeout
        with self._cv:
            while True:
                if command_id in self._responses:
                    return self._responses.pop(command_id)
                remaining = deadline - time.time()
                if remaining <= 0:
                    raise TimeoutError(f"Unreal command {command_id} timed out after {timeout:.0f}s")
                self._cv.wait(min(remaining, 1.0))


def project_allowed(config: Dict[str, Any], hello: Dict[str, Any]) -> bool:
    allowed = str(config.get("allowed_project_file", "")).strip()
    if not allowed:
        return True
    actual = str(hello.get("project_file", "")).strip()
    if not actual:
        return False
    return Path(actual).name.lower() == Path(allowed).name.lower() or os.path.normcase(actual) == os.path.normcase(allowed)


def policy_rejection(config: Dict[str, Any], command: Dict[str, Any]) -> Optional[str]:
    action = str(command.get("action", ""))
    if action in {"delete_actor", "delete_asset"} and not config.get("allow_delete", False):
        return "Destructive actions are disabled locally (allow_delete=false)."
    if action in {"execute_console", "console_command"} and not config.get("allow_console_commands", True):
        return "Console commands are disabled locally (allow_console_commands=false)."
    if action in {"python_exec", "python_eval"} and not config.get("allow_unsafe_python", False):
        return "Arbitrary Python is disabled locally (allow_unsafe_python=false)."
    return None


def write_result(repo: Path, command_id: str, result: Dict[str, Any]) -> Path:
    result_dir = repo / "unreal_bridge" / "results"
    result_dir.mkdir(parents=True, exist_ok=True)
    path = result_dir / f"{command_id}.json"
    with path.open("w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    return path


def pull_rebase(repo: Path, branch: str) -> None:
    """Pull remote bridge updates without failing on temporary tracked edits."""
    run_git(repo, "pull", "--rebase", "--autostash", "origin", branch)


def publish_result(repo: Path, branch: str, result_path: Path, command_id: str) -> None:
    with _GIT_LOCK:
        rel = result_path.relative_to(repo).as_posix()
        run_git(repo, "add", "--", rel)
        staged = run_git(repo, "diff", "--cached", "--quiet", check=False)
        if staged.returncode == 0:
            return
        run_git(repo, "commit", "-m", f"unreal(result): {command_id}")
        pull_rebase(repo, branch)
        run_git(repo, "push", "origin", f"HEAD:{branch}")


def sync(repo: Path, branch: str) -> None:
    with _GIT_LOCK:
        run_git(repo, "checkout", branch)
        pull_rebase(repo, branch)


def _origin_slug(repo: Path) -> str:
    try:
        remote = run_git(repo, "remote", "get-url", "origin").stdout.strip()
    except Exception:
        return ""
    if remote.startswith("git@github.com:"):
        value = remote.split(":", 1)[1]
    elif "github.com/" in remote:
        value = remote.split("github.com/", 1)[1]
    else:
        return ""
    value = value.split("?", 1)[0].split("#", 1)[0].strip("/")
    if value.endswith(".git"):
        value = value[:-4]
    return value


def _is_safe_preview_source(path: Path) -> bool:
    try:
        parts = [part.lower() for part in path.resolve().parts]
    except Exception:
        parts = [part.lower() for part in path.parts]
    if "saved" not in parts or "movierenders" not in parts:
        return False
    return path.suffix.lower() in _PREVIEW_EXTENSIONS


def publish_preview_artifacts(
    repo: Path,
    branch: str,
    artifacts: list[Dict[str, Any]],
    config: Dict[str, Any],
    render_command_id: str,
) -> Dict[str, Any]:
    max_files = max(1, min(int(config.get("preview_max_files", 3)), 8))
    max_bytes = max(1, int(float(config.get("preview_max_file_mb", 25)) * 1024 * 1024))
    preview_root = repo / "unreal_bridge" / "previews" / "latest"
    copied = []

    with _GIT_LOCK:
        if preview_root.exists():
            for child in preview_root.iterdir():
                if child.is_dir():
                    shutil.rmtree(child)
                else:
                    child.unlink()
        preview_root.mkdir(parents=True, exist_ok=True)

        for item in artifacts[:max_files]:
            source_text = str(item.get("local_path") or "").strip()
            if not source_text:
                continue
            source = Path(source_text)
            try:
                if not source.exists() or not source.is_file() or not _is_safe_preview_source(source):
                    log(f"Skipped unsafe/missing preview source: {source}")
                    continue
                size = source.stat().st_size
                if size > max_bytes:
                    log(f"Skipped preview larger than limit ({size} bytes): {source.name}")
                    continue
                destination = preview_root / f"{len(copied)+1:02d}-{source.name}"
                shutil.copy2(source, destination)
                copied.append({
                    "name": destination.name,
                    "repo_path": destination.relative_to(repo).as_posix(),
                    "size_bytes": size,
                    "source_name": source.name,
                })
            except OSError as exc:
                log(f"Preview copy failed for {source}: {exc}")

        slug = _origin_slug(repo)
        for item in copied:
            if slug:
                item["raw_url"] = f"https://raw.githubusercontent.com/{slug}/{branch}/{item['repo_path']}"

        manifest = {
            "render_command_id": render_command_id,
            "captured_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "image_count": len(copied),
            "images": copied,
            "note": "Preview files are copied only from this Unreal project's Saved/MovieRenders output.",
        }
        manifest_path = preview_root / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

        rel_root = preview_root.relative_to(repo).as_posix()
        run_git(repo, "add", "-A", "--", rel_root)
        staged = run_git(repo, "diff", "--cached", "--quiet", check=False)
        if staged.returncode != 0:
            run_git(repo, "commit", "-m", f"unreal(preview): {render_command_id}")
            pull_rebase(repo, branch)
            run_git(repo, "push", "origin", f"HEAD:{branch}")

    log(f"Published render feedback: {len(copied)} preview image(s)")
    return manifest


def auto_publish_after_render(
    repo: Path,
    branch: str,
    connection: UnrealConnection,
    config: Dict[str, Any],
    render_command_id: str,
    render_started_epoch: float,
) -> None:
    if not bool(config.get("auto_publish_render_previews", True)):
        return

    poll_seconds = max(0.5, float(config.get("preview_poll_seconds", 2.0)))
    wait_timeout = max(10.0, float(config.get("preview_wait_timeout_seconds", 900)))
    max_files = max(1, min(int(config.get("preview_max_files", 3)), 8))
    deadline = time.time() + wait_timeout
    counter = 0

    log("Automatic render feedback armed; waiting for Movie Render Queue to finish.")
    while time.time() < deadline:
        counter += 1
        internal_id = f"__auto_render_status_{int(render_started_epoch)}_{counter}"
        try:
            status = connection.send_command(
                {"id": internal_id, "action": "render_queue_status", "args": {}},
                timeout=min(30.0, max(5.0, poll_seconds * 4.0)),
            )
        except Exception as exc:
            log(f"Automatic render status check failed: {exc}")
            return

        if not status.get("ok"):
            log(f"Automatic render status returned an error: {status.get('error', 'unknown error')}")
            return
        if not bool(status.get("data", {}).get("is_rendering", False)):
            break
        time.sleep(poll_seconds)
    else:
        log(f"Automatic render feedback timed out after {wait_timeout:.0f}s")
        return

    settle = max(0.0, float(config.get("preview_settle_seconds", 2.0)))
    if settle:
        time.sleep(settle)

    manifest_id = f"__auto_render_manifest_{int(render_started_epoch)}"
    try:
        result = connection.send_command(
            {
                "id": manifest_id,
                "action": "render_preview_manifest",
                "args": {
                    "since_epoch": max(0.0, render_started_epoch - 2.0),
                    "max_files": max_files,
                },
            },
            timeout=30.0,
        )
    except Exception as exc:
        log(f"Automatic preview manifest failed: {exc}")
        return

    if not result.get("ok"):
        log(
            "Automatic preview manifest unavailable. Install/restart the newest Unreal bridge runtime. "
            f"Error: {result.get('error', 'unknown error')}"
        )
        return

    artifacts = list(result.get("data", {}).get("bridge_artifacts", []))
    if not artifacts:
        log("Render finished but no fresh PNG/JPG preview images were found in Saved/MovieRenders.")
        return

    try:
        publish_preview_artifacts(repo, branch, artifacts, config, render_command_id)
    except Exception as exc:
        log(f"Preview files were found but GitHub publication failed: {exc}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Auralith Unreal 5.7 GitHub bridge")
    parser.add_argument("--repo", type=Path, default=None, help="Path to local Auralith clone")
    args = parser.parse_args()

    script = Path(__file__).resolve()
    repo = args.repo.resolve() if args.repo else find_repo_root(script.parent)
    bridge_root = repo / "unreal_bridge"
    config = load_config(bridge_root)
    branch = str(config.get("branch", "unreal-control"))
    host = str(config.get("host", "127.0.0.1"))
    port = int(config.get("port", 8765))
    poll_seconds = float(config.get("poll_seconds", 2.0))
    timeout = float(config.get("command_timeout_seconds", 120))
    auto_commit = bool(config.get("auto_commit_results", True))

    sync(repo, branch)
    connection = UnrealConnection(host, port)
    connection.start()

    log(f"Bridge branch: {branch}")
    if bool(config.get("auto_publish_render_previews", True)):
        log("Automatic render-preview feedback: ENABLED")
    else:
        log("Automatic render-preview feedback: disabled by local config")
    log("Waiting for Unreal Editor. Load unreal_bridge/unreal/auralith_unreal_bridge.py inside UE 5.7.")

    try:
        while True:
            try:
                sync(repo, branch)
            except Exception as exc:
                log(f"Git sync warning: {exc}")
                time.sleep(poll_seconds)
                continue

            commands_dir = bridge_root / "commands"
            commands_dir.mkdir(parents=True, exist_ok=True)
            results_dir = bridge_root / "results"
            results_dir.mkdir(parents=True, exist_ok=True)

            pending = sorted(commands_dir.glob("*.json"), key=lambda p: p.name)
            for command_path in pending:
                command_id = command_path.stem
                result_path = results_dir / f"{command_id}.json"
                if result_path.exists():
                    continue

                try:
                    command = json.loads(command_path.read_text(encoding="utf-8"))
                    command["id"] = str(command.get("id") or command_id)
                    command_id = str(command["id"])
                except Exception as exc:
                    result = {"type": "result", "id": command_id, "ok": False, "error": f"Invalid command JSON: {exc}"}
                    result_path = write_result(repo, command_id, result)
                    if auto_commit:
                        publish_result(repo, branch, result_path, command_id)
                    continue

                rejection = policy_rejection(config, command)
                if rejection:
                    result = {"type": "result", "id": command_id, "ok": False, "error": rejection, "rejected_by": "local_policy"}
                    result_path = write_result(repo, command_id, result)
                    if auto_commit:
                        publish_result(repo, branch, result_path, command_id)
                    continue

                if not connection.wait_until_ready(timeout=1.0):
                    break

                if not project_allowed(config, connection.hello):
                    result = {
                        "type": "result",
                        "id": command_id,
                        "ok": False,
                        "error": "Wrong Unreal project is open; command blocked by allowed_project_file.",
                        "actual_project": connection.hello.get("project_file"),
                        "rejected_by": "project_lock",
                    }
                else:
                    try:
                        log(f"Executing {command_id}: {command.get('action')}")
                        render_started_epoch = time.time() if command.get("action") == "render_queue_start" else 0.0
                        result = connection.send_command(command, timeout=timeout)
                    except Exception as exc:
                        result = {"type": "result", "id": command_id, "ok": False, "error": str(exc)}
                        render_started_epoch = 0.0

                result_path = write_result(repo, command_id, result)
                if auto_commit:
                    try:
                        publish_result(repo, branch, result_path, command_id)
                    except Exception as exc:
                        log(f"Result saved locally but GitHub publish failed: {exc}")
                log(f"Completed {command_id}: ok={result.get('ok', False)}")

                if (
                    command.get("action") == "render_queue_start"
                    and result.get("ok")
                    and bool(result.get("data", {}).get("started", False))
                    and render_started_epoch > 0
                ):
                    auto_publish_after_render(
                        repo,
                        branch,
                        connection,
                        config,
                        command_id,
                        render_started_epoch,
                    )

            time.sleep(poll_seconds)
    except KeyboardInterrupt:
        log("Stopping bridge.")
    finally:
        connection.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
