"""Auralith Unreal Bridge runtime for Unreal Engine 5.7.

Run this file inside the Unreal Editor after enabling the Python Editor Script
Plugin. It connects only to the local Auralith bridge agent at 127.0.0.1:8765.
Commands are queued by a background socket thread but are executed on Unreal's
editor thread through a Slate post-tick callback.

Coverage strategy:
- Dedicated safe actions for common editor operations.
- Generic UObject get/set_editor_property access.
- Generic method/subsystem/class calls.
- Config/default-object property access for Project/Editor settings.
- Runtime discovery of Unreal symbols, settings classes, properties and methods.
- Optional python_exec/python_eval escape hatch, gated by local agent policy.

Anything exposed by Unreal/Blueprint/Python can therefore be reached without
adding a new bespoke bridge command. C++-only APIs can be exposed through the
optional AuralithBridge editor plugin and then become visible to this runtime.
"""

from __future__ import annotations

import contextlib
import io
import json
import queue
import socket
import threading
import time
import traceback
from typing import Any, Dict, Optional

import unreal

HOST = "127.0.0.1"
PORT = 8765
RECONNECT_SECONDS = 2.0
MAX_COMMANDS_PER_TICK = 4

# Make manual reload/re-execution safe: stop any previous bridge instance first.
try:
    _previous_stop = globals().get("_STOP")
    if _previous_stop is not None:
        _previous_stop.set()
    _previous_socket = globals().get("_SOCKET")
    if _previous_socket is not None:
        try:
            _previous_socket.close()
        except Exception:
            pass
    _previous_tick = globals().get("_TICK_HANDLE")
    if _previous_tick is not None:
        try:
            unreal.unregister_slate_post_tick_callback(_previous_tick)
        except Exception:
            pass
except Exception:
    pass

_INCOMING: "queue.Queue[Dict[str, Any]]" = queue.Queue()
_SOCKET: Optional[socket.socket] = None
_SOCKET_LOCK = threading.Lock()
_STOP = threading.Event()
_TICK_HANDLE = None


def _log(message: str) -> None:
    unreal.log(f"[AuralithBridge] {message}")


def _warn(message: str) -> None:
    unreal.log_warning(f"[AuralithBridge] {message}")


def _project_file() -> str:
    try:
        return str(unreal.Paths.get_project_file_path())
    except Exception:
        try:
            return str(unreal.Paths.project_dir())
        except Exception:
            return ""


def _engine_version() -> str:
    try:
        return str(unreal.SystemLibrary.get_engine_version())
    except Exception:
        return "unknown"


def _send(message: Dict[str, Any]) -> None:
    payload = (json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    with _SOCKET_LOCK:
        sock = _SOCKET
        if sock is None:
            return
        try:
            sock.sendall(payload)
        except OSError:
            pass


def _jsonify(value: Any, depth: int = 0) -> Any:
    if depth > 6:
        return repr(value)
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (list, tuple, set)):
        return [_jsonify(v, depth + 1) for v in value]
    if isinstance(value, dict):
        return {str(k): _jsonify(v, depth + 1) for k, v in value.items()}

    attrs = {}
    for name in ("x", "y", "z", "w", "pitch", "yaw", "roll", "r", "g", "b", "a"):
        if hasattr(value, name):
            try:
                attrs[name] = _jsonify(getattr(value, name), depth + 1)
            except Exception:
                pass
    if attrs:
        attrs["_type"] = type(value).__name__
        return attrs

    try:
        if isinstance(value, unreal.Object):
            cls = value.get_class()
            return {
                "_type": "UObject",
                "name": value.get_name(),
                "path": value.get_path_name(),
                "class": cls.get_path_name() if cls else type(value).__name__,
            }
    except Exception:
        pass

    try:
        enum_name = getattr(value, "name", None)
        if isinstance(enum_name, str):
            return {"_type": type(value).__name__, "name": enum_name, "value": str(value)}
    except Exception:
        pass
    return repr(value)


def _resolve_class(name_or_path: str):
    if not name_or_path:
        raise ValueError("class name/path is required")
    if name_or_path.startswith("/"):
        cls = unreal.load_class(None, name_or_path)
        if not cls:
            raise ValueError(f"Could not load Unreal class: {name_or_path}")
        return cls
    cls = getattr(unreal, name_or_path, None)
    if cls is None:
        raise ValueError(f"Unknown unreal class/symbol: {name_or_path}")
    return cls


def _actor_subsystem():
    return unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def _all_actors():
    return list(_actor_subsystem().get_all_level_actors())


def _find_actor(identifier: str):
    if not identifier:
        raise ValueError("actor identifier is required")
    needle = identifier.lower()
    for actor in _all_actors():
        try:
            candidates = {
                actor.get_name().lower(),
                actor.get_path_name().lower(),
                str(actor.get_actor_label()).lower(),
            }
            if needle in candidates:
                return actor
        except Exception:
            continue
    raise ValueError(f"Actor not found: {identifier}")


def _resolve_target(spec: Dict[str, Any]):
    kind = str(spec.get("kind", "object"))
    if kind == "actor":
        return _find_actor(str(spec.get("id") or spec.get("name") or spec.get("path") or ""))
    if kind == "asset":
        path = str(spec.get("path", ""))
        obj = unreal.load_asset(path)
        if not obj:
            raise ValueError(f"Asset not found: {path}")
        return obj
    if kind == "object":
        path = str(spec.get("path", ""))
        obj = unreal.load_object(None, path)
        if not obj:
            raise ValueError(f"Object not found: {path}")
        return obj
    if kind == "default_object":
        return unreal.get_default_object(_resolve_class(str(spec.get("class", ""))))
    if kind == "editor_subsystem":
        return unreal.get_editor_subsystem(_resolve_class(str(spec.get("class", ""))))
    if kind == "engine_subsystem":
        getter = getattr(unreal, "get_engine_subsystem", None)
        if getter is None:
            raise ValueError("get_engine_subsystem is unavailable in this Unreal build")
        return getter(_resolve_class(str(spec.get("class", ""))))
    if kind == "unreal_symbol":
        symbol = str(spec.get("name", ""))
        value = getattr(unreal, symbol, None)
        if value is None:
            raise ValueError(f"Unknown unreal symbol: {symbol}")
        return value
    raise ValueError(f"Unsupported target kind: {kind}")


def _vector(value: Any) -> unreal.Vector:
    if isinstance(value, dict):
        return unreal.Vector(float(value.get("x", 0)), float(value.get("y", 0)), float(value.get("z", 0)))
    return unreal.Vector(float(value[0]), float(value[1]), float(value[2]))


def _rotator(value: Any) -> unreal.Rotator:
    if isinstance(value, dict):
        return unreal.Rotator(float(value.get("roll", 0)), float(value.get("pitch", 0)), float(value.get("yaw", 0)))
    return unreal.Rotator(float(value[0]), float(value[1]), float(value[2]))


def _coerce_like(current: Any, value: Any) -> Any:
    tname = type(current).__name__
    if tname == "Vector":
        return _vector(value)
    if tname == "Rotator":
        return _rotator(value)
    if tname == "LinearColor":
        if isinstance(value, dict):
            return unreal.LinearColor(float(value.get("r", 0)), float(value.get("g", 0)), float(value.get("b", 0)), float(value.get("a", 1)))
        return unreal.LinearColor(*[float(v) for v in value])
    if tname == "Color":
        if isinstance(value, dict):
            return unreal.Color(int(value.get("r", 0)), int(value.get("g", 0)), int(value.get("b", 0)), int(value.get("a", 255)))
        return unreal.Color(*[int(v) for v in value])
    if isinstance(value, str):
        enum_value = getattr(type(current), value.upper(), None)
        if enum_value is not None:
            return enum_value
    return value


def _describe_object(target: Any, name_filter: str = "", limit: int = 1000, include_values: bool = True) -> Dict[str, Any]:
    needle = name_filter.lower().strip()
    names = [n for n in dir(target) if not n.startswith("_") and (not needle or needle in n.lower())]
    names = sorted(names)[: max(1, min(limit, 5000))]
    properties = []
    methods = []
    other = []

    for name in names:
        try:
            attr = getattr(target, name)
        except Exception:
            continue
        if callable(attr):
            methods.append(name)
            continue
        value_record = {"name": name}
        if include_values:
            try:
                value_record["value"] = _jsonify(target.get_editor_property(name))
                value_record["editor_property"] = True
            except Exception:
                value_record["value"] = _jsonify(attr)
                value_record["editor_property"] = False
        properties.append(value_record)

    return {
        "type": type(target).__name__,
        "properties": properties,
        "methods": methods,
        "other": other,
        "truncated": len(names) >= limit,
    }


def _action_ping(args: Dict[str, Any]) -> Dict[str, Any]:
    return {"pong": True, "engine_version": _engine_version(), "project_file": _project_file(), "time": time.time()}


def _action_project_info(args: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "project_file": _project_file(),
        "project_dir": str(unreal.Paths.project_dir()),
        "content_dir": str(unreal.Paths.project_content_dir()),
        "engine_version": _engine_version(),
    }


def _action_list_unreal_symbols(args: Dict[str, Any]) -> Dict[str, Any]:
    needle = str(args.get("filter", "")).lower().strip()
    limit = max(1, min(int(args.get("limit", 2000)), 10000))
    names = [n for n in dir(unreal) if not n.startswith("_") and (not needle or needle in n.lower())]
    names = sorted(names)
    records = []
    for name in names[:limit]:
        try:
            value = getattr(unreal, name)
            records.append({"name": name, "type": type(value).__name__, "callable": callable(value)})
        except Exception:
            records.append({"name": name, "type": "unknown", "callable": False})
    return {"count": len(names), "symbols": records, "truncated": len(names) > limit}


def _action_list_settings_classes(args: Dict[str, Any]) -> Dict[str, Any]:
    needle = str(args.get("filter", "")).lower().strip()
    limit = max(1, min(int(args.get("limit", 2000)), 10000))
    records = []
    for name in sorted(dir(unreal)):
        lowered = name.lower()
        if "setting" not in lowered:
            continue
        if needle and needle not in lowered:
            continue
        try:
            symbol = getattr(unreal, name)
            records.append({"name": name, "type": type(symbol).__name__, "callable": callable(symbol)})
        except Exception:
            continue
        if len(records) >= limit:
            break
    return {"settings_symbols": records, "count": len(records)}


def _action_describe_unreal_symbol(args: Dict[str, Any]) -> Dict[str, Any]:
    name = str(args["symbol"])
    symbol = getattr(unreal, name, None)
    if symbol is None:
        raise ValueError(f"Unknown unreal symbol: {name}")
    name_filter = str(args.get("filter", ""))
    limit = max(1, min(int(args.get("limit", 1000)), 5000))
    members = [n for n in dir(symbol) if not n.startswith("_") and (not name_filter or name_filter.lower() in n.lower())]
    methods = []
    fields = []
    for member in sorted(members)[:limit]:
        try:
            value = getattr(symbol, member)
            (methods if callable(value) else fields).append(member)
        except Exception:
            pass
    doc = str(getattr(symbol, "__doc__", "") or "")[:20000]
    return {
        "symbol": name,
        "type": type(symbol).__name__,
        "callable": callable(symbol),
        "methods": methods,
        "fields": fields,
        "doc": doc,
        "truncated": len(members) > limit,
    }


def _action_describe_target(args: Dict[str, Any]) -> Dict[str, Any]:
    target = _resolve_target(dict(args["target"]))
    return _describe_object(
        target,
        name_filter=str(args.get("filter", "")),
        limit=int(args.get("limit", 1000)),
        include_values=bool(args.get("include_values", True)),
    )


def _action_get_config_snapshot(args: Dict[str, Any]) -> Dict[str, Any]:
    cls_name = str(args["class"])
    target = unreal.get_default_object(_resolve_class(cls_name))
    requested = args.get("properties")
    if requested:
        props = [str(p) for p in requested]
    else:
        props = []
        for name in dir(target):
            if name.startswith("_"):
                continue
            try:
                target.get_editor_property(name)
                props.append(name)
            except Exception:
                continue
    limit = max(1, min(int(args.get("limit", 2000)), 10000))
    snapshot = {}
    errors = {}
    for prop in sorted(props)[:limit]:
        try:
            snapshot[prop] = _jsonify(target.get_editor_property(prop))
        except Exception as exc:
            errors[prop] = str(exc)
    return {"class": cls_name, "properties": snapshot, "errors": errors, "truncated": len(props) > limit}


def _action_list_actors(args: Dict[str, Any]) -> Dict[str, Any]:
    limit = max(1, min(int(args.get("limit", 500)), 5000))
    actors = []
    for actor in _all_actors()[:limit]:
        try:
            actors.append({
                "name": actor.get_name(),
                "label": actor.get_actor_label(),
                "path": actor.get_path_name(),
                "class": actor.get_class().get_path_name(),
                "location": _jsonify(actor.get_actor_location()),
                "rotation": _jsonify(actor.get_actor_rotation()),
                "scale": _jsonify(actor.get_actor_scale3d()),
            })
        except Exception as exc:
            actors.append({"error": str(exc)})
    return {"count": len(actors), "actors": actors}


def _action_spawn_actor(args: Dict[str, Any]) -> Dict[str, Any]:
    cls = _resolve_class(str(args["class"]))
    location = _vector(args.get("location", [0, 0, 0]))
    rotation = _rotator(args.get("rotation", [0, 0, 0]))
    subsystem = _actor_subsystem()
    try:
        actor = subsystem.spawn_actor_from_class(cls, location, rotation, bool(args.get("transient", False)))
    except TypeError:
        actor = subsystem.spawn_actor_from_class(cls, location, rotation)
    if actor is None:
        raise RuntimeError("Unreal did not create the actor")
    label = args.get("label")
    if label:
        actor.set_actor_label(str(label))
    scale = args.get("scale")
    if scale is not None:
        actor.set_actor_scale3d(_vector(scale))
    return {"actor": _jsonify(actor)}


def _action_delete_actor(args: Dict[str, Any]) -> Dict[str, Any]:
    actor = _find_actor(str(args.get("actor", "")))
    name = actor.get_path_name()
    ok = bool(_actor_subsystem().destroy_actor(actor))
    return {"deleted": ok, "actor": name}


def _action_set_actor_transform(args: Dict[str, Any]) -> Dict[str, Any]:
    actor = _find_actor(str(args.get("actor", "")))
    with unreal.ScopedEditorTransaction("Auralith Bridge: Set Actor Transform"):
        if "location" in args:
            actor.set_actor_location(_vector(args["location"]), False, False)
        if "rotation" in args:
            actor.set_actor_rotation(_rotator(args["rotation"]), False)
        if "scale" in args:
            actor.set_actor_scale3d(_vector(args["scale"]))
    return {
        "actor": actor.get_path_name(),
        "location": _jsonify(actor.get_actor_location()),
        "rotation": _jsonify(actor.get_actor_rotation()),
        "scale": _jsonify(actor.get_actor_scale3d()),
    }


def _action_get_property(args: Dict[str, Any]) -> Dict[str, Any]:
    target = _resolve_target(dict(args["target"]))
    prop = str(args["property"])
    return {"property": prop, "value": _jsonify(target.get_editor_property(prop))}


def _action_set_property(args: Dict[str, Any]) -> Dict[str, Any]:
    target = _resolve_target(dict(args["target"]))
    prop = str(args["property"])
    before = target.get_editor_property(prop)
    value = _coerce_like(before, args.get("value"))
    with unreal.ScopedEditorTransaction(f"Auralith Bridge: Set {prop}"):
        target.set_editor_property(prop, value)
    after = target.get_editor_property(prop)
    return {"property": prop, "before": _jsonify(before), "after": _jsonify(after)}


def _action_get_config_property(args: Dict[str, Any]) -> Dict[str, Any]:
    cls = _resolve_class(str(args["class"]))
    target = unreal.get_default_object(cls)
    prop = str(args["property"])
    return {"class": str(args["class"]), "property": prop, "value": _jsonify(target.get_editor_property(prop))}


def _action_set_config_property(args: Dict[str, Any]) -> Dict[str, Any]:
    cls = _resolve_class(str(args["class"]))
    target = unreal.get_default_object(cls)
    prop = str(args["property"])
    before = target.get_editor_property(prop)
    value = _coerce_like(before, args.get("value"))
    target.set_editor_property(prop, value)
    saved = False
    save_config = getattr(target, "save_config", None)
    if callable(save_config):
        save_config()
        saved = True
    return {
        "class": str(args["class"]),
        "property": prop,
        "before": _jsonify(before),
        "after": _jsonify(target.get_editor_property(prop)),
        "save_config_called": saved,
    }


def _action_call_method(args: Dict[str, Any]) -> Dict[str, Any]:
    target = _resolve_target(dict(args["target"]))
    method_name = str(args["method"])
    method = getattr(target, method_name, None)
    if not callable(method):
        raise ValueError(f"Target has no callable method: {method_name}")
    result = method(*list(args.get("args", [])), **dict(args.get("kwargs", {})))
    return {"method": method_name, "result": _jsonify(result)}


def _action_call_unreal(args: Dict[str, Any]) -> Dict[str, Any]:
    symbol = getattr(unreal, str(args["symbol"]), None)
    if symbol is None:
        raise ValueError(f"Unknown unreal symbol: {args['symbol']}")
    method_name = str(args.get("method", ""))
    callable_obj = getattr(symbol, method_name, None) if method_name else symbol
    if not callable(callable_obj):
        raise ValueError("Requested Unreal symbol/method is not callable")
    result = callable_obj(*list(args.get("args", [])), **dict(args.get("kwargs", {})))
    return {"result": _jsonify(result)}


def _action_execute_console(args: Dict[str, Any]) -> Dict[str, Any]:
    command = str(args["command"])
    editor = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    world = editor.get_editor_world()
    unreal.SystemLibrary.execute_console_command(world, command)
    return {"executed": command}


def _action_list_assets(args: Dict[str, Any]) -> Dict[str, Any]:
    root = str(args.get("path", "/Game"))
    recursive = bool(args.get("recursive", True))
    include_folder = bool(args.get("include_folder", False))
    assets = list(unreal.EditorAssetLibrary.list_assets(root, recursive, include_folder))
    limit = max(1, min(int(args.get("limit", 2000)), 10000))
    return {"path": root, "count": len(assets), "assets": assets[:limit], "truncated": len(assets) > limit}


def _action_load_asset(args: Dict[str, Any]) -> Dict[str, Any]:
    path = str(args["path"])
    asset = unreal.load_asset(path)
    if not asset:
        raise ValueError(f"Asset not found: {path}")
    return {"asset": _jsonify(asset)}


def _action_save_asset(args: Dict[str, Any]) -> Dict[str, Any]:
    path = str(args["path"])
    ok = bool(unreal.EditorAssetLibrary.save_asset(path, bool(args.get("only_if_dirty", False))))
    return {"path": path, "saved": ok}


def _action_save_current_level(args: Dict[str, Any]) -> Dict[str, Any]:
    subsystem = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    method = getattr(subsystem, "save_current_level", None)
    if not callable(method):
        raise RuntimeError("LevelEditorSubsystem.save_current_level is not exposed in this Unreal build")
    return {"saved": bool(method())}


def _action_python_eval(args: Dict[str, Any]) -> Dict[str, Any]:
    expression = str(args["expression"])
    scope = {"unreal": unreal}
    result = eval(expression, {"__builtins__": __builtins__}, scope)
    return {"result": _jsonify(result)}


def _action_python_exec(args: Dict[str, Any]) -> Dict[str, Any]:
    code = str(args["code"])
    stdout = io.StringIO()
    scope = {"unreal": unreal, "result": None}
    with contextlib.redirect_stdout(stdout):
        exec(code, {"__builtins__": __builtins__}, scope)
    return {"result": _jsonify(scope.get("result")), "stdout": stdout.getvalue()[-20000:]}


_ACTIONS = {
    "ping": _action_ping,
    "get_project_info": _action_project_info,
    "list_unreal_symbols": _action_list_unreal_symbols,
    "list_settings_classes": _action_list_settings_classes,
    "describe_unreal_symbol": _action_describe_unreal_symbol,
    "describe_target": _action_describe_target,
    "get_config_snapshot": _action_get_config_snapshot,
    "list_actors": _action_list_actors,
    "spawn_actor": _action_spawn_actor,
    "delete_actor": _action_delete_actor,
    "set_actor_transform": _action_set_actor_transform,
    "get_property": _action_get_property,
    "set_property": _action_set_property,
    "get_config_property": _action_get_config_property,
    "set_config_property": _action_set_config_property,
    "call_method": _action_call_method,
    "call_unreal": _action_call_unreal,
    "execute_console": _action_execute_console,
    "list_assets": _action_list_assets,
    "load_asset": _action_load_asset,
    "save_asset": _action_save_asset,
    "save_current_level": _action_save_current_level,
    "python_eval": _action_python_eval,
    "python_exec": _action_python_exec,
}


def _execute(command: Dict[str, Any]) -> Dict[str, Any]:
    command_id = str(command.get("id", "unknown"))
    action = str(command.get("action", ""))
    args = dict(command.get("args", {}))
    handler = _ACTIONS.get(action)
    if handler is None:
        return {"type": "result", "id": command_id, "ok": False, "error": f"Unknown action: {action}", "available_actions": sorted(_ACTIONS)}
    try:
        data = handler(args)
        return {"type": "result", "id": command_id, "ok": True, "action": action, "data": _jsonify(data)}
    except Exception as exc:
        return {
            "type": "result",
            "id": command_id,
            "ok": False,
            "action": action,
            "error": str(exc),
            "traceback": traceback.format_exc()[-20000:],
        }


def _on_tick(delta_seconds: float) -> None:
    processed = 0
    while processed < MAX_COMMANDS_PER_TICK:
        try:
            command = _INCOMING.get_nowait()
        except queue.Empty:
            break
        result = _execute(command)
        _send(result)
        processed += 1


def _socket_worker() -> None:
    global _SOCKET
    while not _STOP.is_set():
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.settimeout(5.0)
            sock.connect((HOST, PORT))
            sock.settimeout(None)
            with _SOCKET_LOCK:
                _SOCKET = sock
            _send({
                "type": "hello",
                "bridge_version": 2,
                "engine_version": _engine_version(),
                "project_file": _project_file(),
                "actions": sorted(_ACTIONS),
            })
            _log(f"Connected to local bridge agent at {HOST}:{PORT}")
            buffer = b""
            while not _STOP.is_set():
                chunk = sock.recv(65536)
                if not chunk:
                    break
                buffer += chunk
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    if not line.strip():
                        continue
                    message = json.loads(line.decode("utf-8"))
                    if message.get("type") == "command":
                        _INCOMING.put(message)
        except Exception as exc:
            _warn(f"Bridge connection unavailable: {exc}")
        finally:
            with _SOCKET_LOCK:
                if _SOCKET is sock:
                    _SOCKET = None
            try:
                sock.close()
            except OSError:
                pass
        if not _STOP.is_set():
            time.sleep(RECONNECT_SECONDS)


def start() -> None:
    global _TICK_HANDLE
    _STOP.clear()
    _TICK_HANDLE = unreal.register_slate_post_tick_callback(_on_tick)
    threading.Thread(target=_socket_worker, name="AuralithUnrealBridge", daemon=True).start()
    _log("Runtime started. Waiting for local bridge agent.")


def stop() -> None:
    global _TICK_HANDLE
    _STOP.set()
    if _TICK_HANDLE is not None:
        try:
            unreal.unregister_slate_post_tick_callback(_TICK_HANDLE)
        except Exception:
            pass
        _TICK_HANDLE = None
    with _SOCKET_LOCK:
        if _SOCKET:
            try:
                _SOCKET.close()
            except OSError:
                pass
    _log("Runtime stopped.")


start()
