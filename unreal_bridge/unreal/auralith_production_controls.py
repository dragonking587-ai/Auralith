"""Production control extensions for the Auralith Unreal Engine 5.7 bridge.

This module is imported after auralith_unreal_bridge and registers higher-level,
non-destructive production actions for cameras, lights, Sequencer assets,
Niagara assets, materials, and Movie Render Queue. It does not auto-save levels,
start renders, or delete content unless an explicit command requests the action.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

import unreal
import auralith_unreal_bridge as bridge


def _package_path(value: str, default: str) -> str:
    path = (value or default).strip().rstrip("/")
    if not path.startswith("/Game"):
        raise ValueError("Asset package paths must be under /Game")
    return path


def _asset_object_path(package_path: str, name: str) -> str:
    return f"{package_path}/{name}.{name}"


def _actor(identifier: str):
    try:
        return bridge._find_actor(identifier)
    except Exception:
        obj = unreal.load_object(None, identifier)
        if obj and isinstance(obj, unreal.Actor):
            return obj
        raise


def _spawn(cls, args: Dict[str, Any]):
    location = bridge._vector(args.get("location", [0, 0, 0]))
    rotation = bridge._rotator(args.get("rotation", [0, 0, 0]))
    transient = bool(args.get("transient", False))
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    try:
        actor = subsystem.spawn_actor_from_class(cls, location, rotation, transient)
    except TypeError:
        actor = subsystem.spawn_actor_from_class(cls, location, rotation)
    if actor is None:
        raise RuntimeError(f"Unreal failed to spawn {getattr(cls, '__name__', cls)}")
    if args.get("label"):
        actor.set_actor_label(str(args["label"]))
    if args.get("scale") is not None:
        actor.set_actor_scale3d(bridge._vector(args["scale"]))
    return actor


def _set_editor_property_safe(target, name: str, value: Any, warnings: list[str]) -> None:
    try:
        current = target.get_editor_property(name)
        target.set_editor_property(name, bridge._coerce_like(current, value))
    except Exception as exc:
        warnings.append(f"{name}: {exc}")


def _camera_component(actor):
    method = getattr(actor, "get_cine_camera_component", None)
    if not callable(method):
        raise ValueError("Actor is not a CineCameraActor or does not expose a cine camera component")
    component = method()
    if not component:
        raise RuntimeError("Cine camera component was not available")
    return component


def _light_component(actor):
    for class_name in (
        "PointLightComponent",
        "SpotLightComponent",
        "RectLightComponent",
        "DirectionalLightComponent",
        "LightComponent",
        "LightComponentBase",
    ):
        cls = getattr(unreal, class_name, None)
        if cls is None:
            continue
        try:
            component = actor.get_component_by_class(cls)
            if component:
                return component
        except Exception:
            continue
    raise RuntimeError("Could not resolve a light component for the actor")


def _action_production_capabilities(args: Dict[str, Any]) -> Dict[str, Any]:
    symbols = [
        "CineCameraActor",
        "PointLight",
        "SpotLight",
        "RectLight",
        "DirectionalLight",
        "LevelSequence",
        "LevelSequenceFactoryNew",
        "NiagaraSystem",
        "NiagaraSystemFactoryNew",
        "Material",
        "MaterialFactoryNew",
        "MaterialEditingLibrary",
        "MoviePipelineQueueSubsystem",
        "MoviePipelineExecutorJob",
        "MoviePipelinePIEExecutor",
    ]
    return {
        "bridge_extension": "production-controls-v1",
        "available_symbols": {name: hasattr(unreal, name) for name in symbols},
        "registered_actions": sorted(name for name in bridge._ACTIONS if name.startswith(("production_", "camera_", "light_", "sequence_", "niagara_", "material_", "render_"))),
    }


def _action_camera_create(args: Dict[str, Any]) -> Dict[str, Any]:
    actor = _spawn(unreal.CineCameraActor, args)
    component = _camera_component(actor)
    warnings: list[str] = []

    if "focal_length" in args:
        _set_editor_property_safe(component, "current_focal_length", float(args["focal_length"]), warnings)
    if "aperture" in args:
        _set_editor_property_safe(component, "current_aperture", float(args["aperture"]), warnings)
    if "aspect_ratio" in args:
        try:
            component.set_aspect_ratio(float(args["aspect_ratio"]))
        except Exception as exc:
            warnings.append(f"aspect_ratio: {exc}")
    if args.get("filmback_preset"):
        try:
            component.set_filmback_preset_by_name(str(args["filmback_preset"]))
        except Exception as exc:
            warnings.append(f"filmback_preset: {exc}")
    if args.get("lens_preset"):
        try:
            component.set_lens_preset_by_name(str(args["lens_preset"]))
        except Exception as exc:
            warnings.append(f"lens_preset: {exc}")

    return {
        "actor": bridge._jsonify(actor),
        "component": bridge._jsonify(component),
        "transient": bool(args.get("transient", False)),
        "warnings": warnings,
    }


def _action_camera_set(args: Dict[str, Any]) -> Dict[str, Any]:
    actor = _actor(str(args["actor"]))
    component = _camera_component(actor)
    warnings: list[str] = []

    with unreal.ScopedEditorTransaction("Auralith Bridge: Camera Settings"):
        if "location" in args:
            actor.set_actor_location(bridge._vector(args["location"]), False, False)
        if "rotation" in args:
            actor.set_actor_rotation(bridge._rotator(args["rotation"]), False)
        if "focal_length" in args:
            _set_editor_property_safe(component, "current_focal_length", float(args["focal_length"]), warnings)
        if "aperture" in args:
            _set_editor_property_safe(component, "current_aperture", float(args["aperture"]), warnings)
        if "aspect_ratio" in args:
            try:
                component.set_aspect_ratio(float(args["aspect_ratio"]))
            except Exception as exc:
                warnings.append(f"aspect_ratio: {exc}")

    return {
        "actor": bridge._jsonify(actor),
        "component": bridge._jsonify(component),
        "location": bridge._jsonify(actor.get_actor_location()),
        "rotation": bridge._jsonify(actor.get_actor_rotation()),
        "focal_length": bridge._jsonify(component.get_editor_property("current_focal_length")),
        "aperture": bridge._jsonify(component.get_editor_property("current_aperture")),
        "warnings": warnings,
    }


def _action_light_create(args: Dict[str, Any]) -> Dict[str, Any]:
    kind = str(args.get("type", "point")).lower().replace("_", "")
    class_map = {
        "point": unreal.PointLight,
        "spot": unreal.SpotLight,
        "rect": unreal.RectLight,
        "directional": unreal.DirectionalLight,
    }
    if kind not in class_map:
        raise ValueError("light type must be point, spot, rect, or directional")

    actor = _spawn(class_map[kind], args)
    component = _light_component(actor)
    warnings: list[str] = []

    if "intensity" in args:
        try:
            component.set_intensity(float(args["intensity"]))
        except Exception:
            _set_editor_property_safe(component, "intensity", float(args["intensity"]), warnings)

    if "temperature" in args:
        _set_editor_property_safe(component, "use_temperature", True, warnings)
        _set_editor_property_safe(component, "temperature", float(args["temperature"]), warnings)

    if "attenuation_radius" in args:
        _set_editor_property_safe(component, "attenuation_radius", float(args["attenuation_radius"]), warnings)

    if "color" in args:
        c = args["color"]
        if isinstance(c, dict):
            linear = unreal.LinearColor(float(c.get("r", 1)), float(c.get("g", 1)), float(c.get("b", 1)), float(c.get("a", 1)))
        else:
            values = list(c)
            linear = unreal.LinearColor(float(values[0]), float(values[1]), float(values[2]), float(values[3]) if len(values) > 3 else 1.0)
        try:
            component.set_light_color(linear, False)
        except TypeError:
            try:
                component.set_light_color(linear)
            except Exception as exc:
                warnings.append(f"color: {exc}")
        except Exception as exc:
            warnings.append(f"color: {exc}")

    return {
        "actor": bridge._jsonify(actor),
        "component": bridge._jsonify(component),
        "type": kind,
        "warnings": warnings,
    }


def _create_asset(name: str, package_path: str, asset_class, factory_class, save: bool):
    object_path = _asset_object_path(package_path, name)
    existing = unreal.load_asset(object_path)
    if existing:
        return existing, True
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    factory = factory_class()
    asset = tools.create_asset(name, package_path, asset_class, factory)
    if not asset:
        raise RuntimeError(f"Unreal failed to create asset {object_path}")
    if save:
        unreal.EditorAssetLibrary.save_asset(object_path, False)
    return asset, False


def _frame_rate(fps: int):
    try:
        return unreal.FrameRate(numerator=int(fps), denominator=1)
    except Exception:
        rate = unreal.FrameRate()
        rate.set_editor_property("numerator", int(fps))
        rate.set_editor_property("denominator", 1)
        return rate


def _action_sequence_create(args: Dict[str, Any]) -> Dict[str, Any]:
    name = str(args.get("name", "AuralithSequence"))
    path = _package_path(str(args.get("path", "/Game/Cinematics")), "/Game/Cinematics")
    fps = max(1, int(args.get("fps", 24)))
    duration = max(0.1, float(args.get("duration_seconds", 5.0)))
    save = bool(args.get("save", False))

    sequence, existed = _create_asset(name, path, unreal.LevelSequence, unreal.LevelSequenceFactoryNew, save=False)
    warnings: list[str] = []
    try:
        sequence.set_display_rate(_frame_rate(fps))
        sequence.set_playback_start(0)
        sequence.set_playback_end(max(1, int(round(duration * fps))))
    except Exception as exc:
        warnings.append(f"timing: {exc}")
    if save:
        unreal.EditorAssetLibrary.save_asset(_asset_object_path(path, name), False)

    return {
        "sequence": bridge._jsonify(sequence),
        "object_path": _asset_object_path(path, name),
        "existed": existed,
        "fps": fps,
        "duration_seconds": duration,
        "saved": save,
        "warnings": warnings,
    }


def _action_sequence_add_actor(args: Dict[str, Any]) -> Dict[str, Any]:
    sequence_path = str(args["sequence"])
    sequence = unreal.load_asset(sequence_path)
    if not sequence or not isinstance(sequence, unreal.LevelSequence):
        raise ValueError(f"Level Sequence not found: {sequence_path}")
    actor = _actor(str(args["actor"]))
    binding = sequence.add_possessable(actor)
    binding_id = None
    for method_name in ("get_id", "get_binding_id"):
        method = getattr(binding, method_name, None)
        if callable(method):
            try:
                binding_id = bridge._jsonify(method())
                break
            except Exception:
                pass
    if bool(args.get("save", False)):
        unreal.EditorAssetLibrary.save_asset(sequence_path, False)
    return {
        "sequence": bridge._jsonify(sequence),
        "actor": bridge._jsonify(actor),
        "binding": bridge._jsonify(binding),
        "binding_id": binding_id,
    }


def _action_niagara_create_system(args: Dict[str, Any]) -> Dict[str, Any]:
    name = str(args.get("name", "AuralithNiagara"))
    path = _package_path(str(args.get("path", "/Game/VFX")), "/Game/VFX")
    save = bool(args.get("save", False))
    system, existed = _create_asset(name, path, unreal.NiagaraSystem, unreal.NiagaraSystemFactoryNew, save)
    return {
        "system": bridge._jsonify(system),
        "object_path": _asset_object_path(path, name),
        "existed": existed,
        "saved": save,
    }


def _action_material_create(args: Dict[str, Any]) -> Dict[str, Any]:
    name = str(args.get("name", "AuralithMaterial"))
    path = _package_path(str(args.get("path", "/Game/Materials")), "/Game/Materials")
    save = bool(args.get("save", False))
    material, existed = _create_asset(name, path, unreal.Material, unreal.MaterialFactoryNew, save)
    return {
        "material": bridge._jsonify(material),
        "object_path": _asset_object_path(path, name),
        "existed": existed,
        "saved": save,
    }


def _action_material_add_expression(args: Dict[str, Any]) -> Dict[str, Any]:
    material_path = str(args["material"])
    material = unreal.load_asset(material_path)
    if not material:
        raise ValueError(f"Material not found: {material_path}")
    expression_class = bridge._resolve_class(str(args["expression_class"]))
    x = int(args.get("x", 0))
    y = int(args.get("y", 0))
    expression = unreal.MaterialEditingLibrary.create_material_expression(material, expression_class, x, y)
    if not expression:
        raise RuntimeError("Material expression was not created")
    warnings: list[str] = []
    for prop, value in dict(args.get("properties", {})).items():
        _set_editor_property_safe(expression, str(prop), value, warnings)
    if bool(args.get("recompile", True)):
        try:
            unreal.MaterialEditingLibrary.recompile_material(material)
        except Exception as exc:
            warnings.append(f"recompile: {exc}")
    if bool(args.get("save", False)):
        unreal.EditorAssetLibrary.save_asset(material_path, False)
    return {
        "material": bridge._jsonify(material),
        "expression": bridge._jsonify(expression),
        "warnings": warnings,
    }


def _job_record(job) -> Dict[str, Any]:
    data: Dict[str, Any] = {"object": bridge._jsonify(job)}
    for prop in ("job_name", "author", "sequence", "map"):
        try:
            data[prop] = bridge._jsonify(job.get_editor_property(prop))
        except Exception:
            pass
    return data


def _action_render_queue_status(args: Dict[str, Any]) -> Dict[str, Any]:
    subsystem = unreal.get_editor_subsystem(unreal.MoviePipelineQueueSubsystem)
    queue = subsystem.get_queue()
    jobs = list(queue.get_jobs())
    return {
        "is_rendering": bool(subsystem.is_rendering()),
        "is_queue_dirty": bool(subsystem.is_queue_dirty()),
        "job_count": len(jobs),
        "jobs": [_job_record(job) for job in jobs],
    }


def _action_render_queue_add_job(args: Dict[str, Any]) -> Dict[str, Any]:
    sequence_path = str(args["sequence"])
    map_path = str(args.get("map", "/Game/Main.Main"))
    subsystem = unreal.get_editor_subsystem(unreal.MoviePipelineQueueSubsystem)
    queue = subsystem.get_queue()
    job = queue.allocate_new_job(unreal.MoviePipelineExecutorJob)
    warnings: list[str] = []

    for prop, value in (
        ("job_name", str(args.get("name", "Auralith Render Job"))),
        ("sequence", unreal.SoftObjectPath(sequence_path)),
        ("map", unreal.SoftObjectPath(map_path)),
    ):
        try:
            job.set_editor_property(prop, value)
        except Exception as exc:
            warnings.append(f"{prop}: {exc}")

    return {
        "job": _job_record(job),
        "queue_job_count": len(list(queue.get_jobs())),
        "warnings": warnings,
    }


def _action_render_queue_start(args: Dict[str, Any]) -> Dict[str, Any]:
    subsystem = unreal.get_editor_subsystem(unreal.MoviePipelineQueueSubsystem)
    if subsystem.is_rendering():
        raise RuntimeError("Movie Render Queue is already rendering")
    executor_name = str(args.get("executor", "MoviePipelinePIEExecutor"))
    executor_class = bridge._resolve_class(executor_name)
    executor = subsystem.render_queue_with_executor(executor_class)
    return {"started": bool(executor), "executor": bridge._jsonify(executor)}


_ACTIONS = {
    "production_capabilities": _action_production_capabilities,
    "camera_create": _action_camera_create,
    "camera_set": _action_camera_set,
    "light_create": _action_light_create,
    "sequence_create": _action_sequence_create,
    "sequence_add_actor": _action_sequence_add_actor,
    "niagara_create_system": _action_niagara_create_system,
    "material_create": _action_material_create,
    "material_add_expression": _action_material_add_expression,
    "render_queue_status": _action_render_queue_status,
    "render_queue_add_job": _action_render_queue_add_job,
    "render_queue_start": _action_render_queue_start,
}

bridge._ACTIONS.update(_ACTIONS)
bridge._log(f"Production controls registered: {', '.join(sorted(_ACTIONS))}")
