"""Safe self-update/hot-reload support for the Auralith Unreal bridge.

This extension exists to remove repeated Unreal restarts during bridge development.
It can copy only a fixed whitelist of Auralith bridge Python modules from the local
Auralith clone into the currently-running project's Content/Python directory, then
reload only those whitelisted extensions. It cannot execute arbitrary Python,
load arbitrary module names, or copy arbitrary files.
"""

from __future__ import annotations

import importlib
from pathlib import Path
import shutil
import sys
from typing import Any, Dict

import unreal
import auralith_unreal_bridge as bridge


MODULE_ORDER = [
    "auralith_production_controls",
    "auralith_test_scene",
    "auralith_render_feedback",
    "auralith_cinematic_stage",
]
MODULE_FILES = {name: f"{name}.py" for name in MODULE_ORDER}


def _project_python_dir() -> Path:
    return Path(str(unreal.Paths.project_content_dir())) / "Python"


def _normalize_requested(args: Dict[str, Any]) -> list[str]:
    requested = args.get("modules")
    if not requested:
        return list(MODULE_ORDER)
    result = []
    for value in requested:
        name = str(value).strip()
        if name not in MODULE_FILES:
            raise ValueError(f"Module is not in the bridge reload whitelist: {name}")
        if name not in result:
            result.append(name)
    return result


def _action_bridge_reload_extensions(args: Dict[str, Any]) -> Dict[str, Any]:
    requested = _normalize_requested(args)
    reloaded = []
    errors = {}
    for name in requested:
        try:
            module = sys.modules.get(name)
            if module is None:
                module = importlib.import_module(name)
            else:
                module = importlib.reload(module)
            reloaded.append({"module": name, "file": str(getattr(module, "__file__", ""))})
        except Exception as exc:
            errors[name] = str(exc)
    return {
        "reloaded": reloaded,
        "errors": errors,
        "registered_actions": sorted(bridge._ACTIONS),
    }


def _action_bridge_sync_extensions(args: Dict[str, Any]) -> Dict[str, Any]:
    requested = _normalize_requested(args)
    source_root_text = str(args.get("source_root", "")).strip()
    if not source_root_text:
        raise ValueError("source_root is required")

    source_root = Path(source_root_text).expanduser().resolve()
    normalized_parts = [part.lower() for part in source_root.parts]
    if len(normalized_parts) < 2 or normalized_parts[-2:] != ["unreal_bridge", "unreal"]:
        raise ValueError("source_root must end with unreal_bridge/unreal")
    if not source_root.exists() or not source_root.is_dir():
        raise ValueError(f"Bridge source directory does not exist: {source_root}")

    target_root = _project_python_dir().resolve()
    target_root.mkdir(parents=True, exist_ok=True)
    copied = []
    unchanged = []

    for name in requested:
        filename = MODULE_FILES[name]
        source = (source_root / filename).resolve()
        target = (target_root / filename).resolve()
        if source.parent != source_root:
            raise ValueError(f"Unsafe source resolution for {filename}")
        if target.parent != target_root:
            raise ValueError(f"Unsafe target resolution for {filename}")
        if not source.exists() or not source.is_file():
            raise ValueError(f"Whitelisted bridge module is missing: {source}")

        source_bytes = source.read_bytes()
        target_bytes = target.read_bytes() if target.exists() else None
        if target_bytes == source_bytes:
            unchanged.append(filename)
            continue
        shutil.copy2(source, target)
        copied.append(filename)

    reload_result = _action_bridge_reload_extensions({"modules": requested})
    return {
        "source_root": str(source_root),
        "target_root": str(target_root),
        "copied": copied,
        "unchanged": unchanged,
        "reload": reload_result,
    }


def _action_bridge_hot_reload_capabilities(args: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "bridge_extension": "hot-reload-v2",
        "project_python_dir": str(_project_python_dir()),
        "whitelisted_modules": list(MODULE_ORDER),
        "registered_actions": [
            "bridge_hot_reload_capabilities",
            "bridge_reload_extensions",
            "bridge_sync_extensions",
        ],
    }


_ACTIONS = {
    "bridge_hot_reload_capabilities": _action_bridge_hot_reload_capabilities,
    "bridge_reload_extensions": _action_bridge_reload_extensions,
    "bridge_sync_extensions": _action_bridge_sync_extensions,
}

bridge._ACTIONS.update(_ACTIONS)
bridge._log(f"Hot-reload controls registered: {', '.join(sorted(_ACTIONS))}")
