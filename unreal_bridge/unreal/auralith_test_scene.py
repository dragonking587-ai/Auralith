"""Saved cinematic test-scene builder for the Auralith Unreal bridge.

The action registered here is intentionally scoped to actors/assets whose names
start with AuralithTest_ or the existing AuralithProduction sandbox. It creates
an idempotent visual test stage, saves the level/assets, and never starts a
render or deletes unrelated project content.
"""

from __future__ import annotations

from typing import Any, Dict

import unreal
import auralith_unreal_bridge as bridge
import auralith_production_controls as production


ROOT = "/Game/AuralithProduction"
MATERIAL_PATH = f"{ROOT}/Materials/M_AuralithTest_GoldGlow.M_AuralithTest_GoldGlow"
SEQUENCE_PATH = f"{ROOT}/Cinematics/AuralithProduction_Master.AuralithProduction_Master"


def _find_by_label(label: str):
    try:
        return bridge._find_actor(label)
    except Exception:
        return None


def _ensure_actor(cls, label: str, location, rotation=(0, 0, 0), scale=(1, 1, 1)):
    actor = _find_by_label(label)
    created = False
    if actor is None:
        actor = production._spawn(cls, {
            "label": label,
            "location": location,
            "rotation": rotation,
            "scale": scale,
            "transient": False,
        })
        created = True
    else:
        actor.set_actor_location(bridge._vector(location), False, False)
        actor.set_actor_rotation(bridge._rotator(rotation), False)
        actor.set_actor_scale3d(bridge._vector(scale))
    try:
        actor.set_folder_path("AuralithProduction/TestScene")
    except Exception:
        pass
    return actor, created


def _load_engine_mesh(name: str):
    path = f"/Engine/BasicShapes/{name}.{name}"
    mesh = unreal.load_asset(path)
    if not mesh:
        raise RuntimeError(f"Required Unreal basic shape was not found: {path}")
    return mesh


def _set_mesh(actor, mesh, material=None):
    component = actor.get_component_by_class(unreal.StaticMeshComponent)
    if not component:
        raise RuntimeError(f"StaticMeshComponent unavailable for {actor.get_actor_label()}")
    component.set_static_mesh(mesh)
    if material:
        component.set_material(0, material)
    return component


def _ensure_gold_material(warnings: list[str]):
    material, existed = production._create_asset(
        "M_AuralithTest_GoldGlow",
        f"{ROOT}/Materials",
        unreal.Material,
        unreal.MaterialFactoryNew,
        save=False,
    )
    if not existed:
        try:
            unreal.MaterialEditingLibrary.delete_all_material_expressions(material)

            base = unreal.MaterialEditingLibrary.create_material_expression(
                material, unreal.MaterialExpressionConstant3Vector, -700, -120
            )
            base.set_editor_property("constant", unreal.LinearColor(0.12, 0.035, 0.003, 1.0))
            unreal.MaterialEditingLibrary.connect_material_property(
                base, "", unreal.MaterialProperty.MP_BASE_COLOR
            )

            metallic = unreal.MaterialEditingLibrary.create_material_expression(
                material, unreal.MaterialExpressionConstant, -700, 20
            )
            metallic.set_editor_property("r", 0.9)
            unreal.MaterialEditingLibrary.connect_material_property(
                metallic, "", unreal.MaterialProperty.MP_METALLIC
            )

            roughness = unreal.MaterialEditingLibrary.create_material_expression(
                material, unreal.MaterialExpressionConstant, -700, 120
            )
            roughness.set_editor_property("r", 0.24)
            unreal.MaterialEditingLibrary.connect_material_property(
                roughness, "", unreal.MaterialProperty.MP_ROUGHNESS
            )

            emissive = unreal.MaterialEditingLibrary.create_material_expression(
                material, unreal.MaterialExpressionConstant3Vector, -700, 250
            )
            emissive.set_editor_property("constant", unreal.LinearColor(4.0, 0.8, 0.035, 1.0))
            unreal.MaterialEditingLibrary.connect_material_property(
                emissive, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR
            )

            unreal.MaterialEditingLibrary.layout_material_expressions(material)
            unreal.MaterialEditingLibrary.recompile_material(material)
        except Exception as exc:
            warnings.append(f"gold material graph: {exc}")

    unreal.EditorAssetLibrary.save_asset(MATERIAL_PATH, False)
    return material, existed


def _set_light(actor, intensity: float, color, radius: float | None, warnings: list[str]):
    component = production._light_component(actor)
    try:
        component.set_intensity(float(intensity))
    except Exception as exc:
        warnings.append(f"{actor.get_actor_label()} intensity: {exc}")
    try:
        linear = unreal.LinearColor(float(color[0]), float(color[1]), float(color[2]), 1.0)
        try:
            component.set_light_color(linear, False)
        except TypeError:
            component.set_light_color(linear)
    except Exception as exc:
        warnings.append(f"{actor.get_actor_label()} color: {exc}")
    if radius is not None:
        try:
            component.set_editor_property("attenuation_radius", float(radius))
        except Exception as exc:
            warnings.append(f"{actor.get_actor_label()} radius: {exc}")


def _ensure_camera_animation(camera, sequence, fps: int, duration_seconds: float, warnings: list[str]):
    """Add a gentle location move if this sequence has no camera transform track yet."""
    try:
        binding = None
        for item in sequence.get_bindings():
            try:
                if str(item.get_display_name()) == str(camera.get_actor_label()):
                    binding = item
                    break
            except Exception:
                continue
        if binding is None:
            binding = sequence.add_possessable(camera)

        existing_tracks = list(binding.find_tracks_by_type(unreal.MovieScene3DTransformTrack))
        if existing_tracks:
            return {"binding": bridge._jsonify(binding), "animation_added": False, "reason": "transform track already exists"}

        track = binding.add_track(unreal.MovieScene3DTransformTrack)
        section = track.add_section()
        frames = max(2, int(round(fps * duration_seconds)))
        section.set_range(0, frames)
        channels = list(section.get_all_channels())

        keyframes = {
            "Location.X": [(0, -800.0), (frames // 2, -650.0), (frames - 1, -800.0)],
            "Location.Y": [(0, -800.0), (frames // 2, -900.0), (frames - 1, -800.0)],
            "Location.Z": [(0, 300.0), (frames // 2, 345.0), (frames - 1, 300.0)],
        }
        keys_added = 0
        for channel in channels:
            try:
                name = str(channel.get_editor_property("channel_name"))
            except Exception:
                continue
            if name not in keyframes:
                continue
            for frame, value in keyframes[name]:
                try:
                    channel.add_key(time=unreal.FrameNumber(value=int(frame)), new_value=float(value))
                    keys_added += 1
                except TypeError:
                    channel.add_key(unreal.FrameNumber(value=int(frame)), float(value))
                    keys_added += 1

        return {"binding": bridge._jsonify(binding), "animation_added": keys_added > 0, "keys_added": keys_added}
    except Exception as exc:
        warnings.append(f"camera animation: {exc}")
        return {"animation_added": False, "error": str(exc)}


def _ensure_camera_cut(camera, sequence, fps: int, duration_seconds: float, warnings: list[str]):
    try:
        binding = None
        for item in sequence.get_bindings():
            try:
                if str(item.get_display_name()) == str(camera.get_actor_label()):
                    binding = item
                    break
            except Exception:
                continue
        if binding is None:
            binding = sequence.add_possessable(camera)

        tracks = list(sequence.find_tracks_by_type(unreal.MovieSceneCameraCutTrack))
        track = tracks[0] if tracks else sequence.add_track(unreal.MovieSceneCameraCutTrack)
        existing_sections = list(track.get_sections())
        if existing_sections:
            return {"camera_cut_added": False, "reason": "camera cut section already exists"}

        section = track.add_section()
        frames = max(2, int(round(fps * duration_seconds)))
        section.set_range(0, frames)

        # UE versions differ on whether a Guid can be passed directly. Try the
        # direct scripting form first, then construct MovieSceneObjectBindingID.
        try:
            section.set_camera_binding_id(binding.get_id())
        except Exception:
            binding_id = unreal.MovieSceneObjectBindingID()
            for prop in ("guid", "binding_id"):
                try:
                    binding_id.set_editor_property(prop, binding.get_id())
                    break
                except Exception:
                    continue
            section.set_camera_binding_id(binding_id)
        return {"camera_cut_added": True}
    except Exception as exc:
        warnings.append(f"camera cut: {exc}")
        return {"camera_cut_added": False, "error": str(exc)}


def _action_scene_build_test(args: Dict[str, Any]) -> Dict[str, Any]:
    warnings: list[str] = []
    created_labels: list[str] = []

    # Reframe the persistent sandbox camera so it looks into the center stage.
    camera = _find_by_label("AuralithProduction_Camera")
    if camera is None:
        camera, created = _ensure_actor(
            unreal.CineCameraActor,
            "AuralithProduction_Camera",
            (-800, -800, 300),
            (0, -9, 48),
        )
        if created:
            created_labels.append("AuralithProduction_Camera")
    camera.set_actor_location(bridge._vector([-800, -800, 300]), False, False)
    camera.set_actor_rotation(bridge._rotator({"pitch": -9, "yaw": 48, "roll": 0}), False)
    try:
        component = production._camera_component(camera)
        component.set_editor_property("current_focal_length", 45.0)
        component.set_editor_property("current_aperture", 2.8)
    except Exception as exc:
        warnings.append(f"camera settings: {exc}")

    gold_material, material_existed = _ensure_gold_material(warnings)
    base_material = unreal.load_asset(f"{ROOT}/Materials/M_AuralithProduction_Base.M_AuralithProduction_Base")

    meshes = {
        "sphere": _load_engine_mesh("Sphere"),
        "cube": _load_engine_mesh("Cube"),
        "cylinder": _load_engine_mesh("Cylinder"),
    }

    geometry = [
        ("AuralithTest_HeroSphere", "sphere", [0, 100, 145], [0, 0, 0], [1.45, 1.45, 1.45], gold_material),
        ("AuralithTest_Pedestal", "cylinder", [0, 100, 35], [0, 0, 0], [1.8, 1.8, 0.7], base_material),
        ("AuralithTest_PillarLeft", "cube", [-275, 160, 145], [0, 0, 0], [0.7, 0.7, 2.9], base_material),
        ("AuralithTest_PillarRight", "cube", [275, 160, 145], [0, 0, 0], [0.7, 0.7, 2.9], base_material),
        ("AuralithTest_Backdrop", "cube", [0, 430, 180], [0, 0, 0], [6.5, 0.22, 3.6], base_material),
    ]

    actor_records = []
    for label, mesh_name, location, rotation, scale, material in geometry:
        actor, created = _ensure_actor(unreal.StaticMeshActor, label, location, rotation, scale)
        if created:
            created_labels.append(label)
        try:
            _set_mesh(actor, meshes[mesh_name], material)
        except Exception as exc:
            warnings.append(f"{label} mesh/material: {exc}")
        actor_records.append(bridge._jsonify(actor))

    # Warm key light: reuse the sandbox Rect Light when present.
    key = _find_by_label("AuralithProduction_KeyLight")
    if key is None:
        key, created = _ensure_actor(unreal.RectLight, "AuralithProduction_KeyLight", [-250, -200, 430], [0, -32, 40])
        if created:
            created_labels.append("AuralithProduction_KeyLight")
    key.set_actor_location(bridge._vector([-250, -200, 430]), False, False)
    key.set_actor_rotation(bridge._rotator({"pitch": -32, "yaw": 40, "roll": 0}), False)
    _set_light(key, 6500.0, (1.0, 0.42, 0.08), None, warnings)

    rim, created = _ensure_actor(unreal.PointLight, "AuralithTest_RimLight", [250, 250, 330])
    if created:
        created_labels.append("AuralithTest_RimLight")
    _set_light(rim, 3200.0, (0.06, 0.20, 1.0), 900.0, warnings)

    accent, created = _ensure_actor(unreal.PointLight, "AuralithTest_GoldAccent", [-250, 100, 210])
    if created:
        created_labels.append("AuralithTest_GoldAccent")
    _set_light(accent, 2200.0, (1.0, 0.18, 0.02), 700.0, warnings)

    sequence = unreal.load_asset(SEQUENCE_PATH)
    animation = {"animation_added": False, "reason": "sequence unavailable"}
    camera_cut = {"camera_cut_added": False, "reason": "sequence unavailable"}
    if sequence and isinstance(sequence, unreal.LevelSequence):
        fps = 24
        duration = 10.0
        try:
            rate = sequence.get_display_rate()
            fps = int(getattr(rate, "numerator", fps) or fps)
        except Exception:
            pass
        animation = _ensure_camera_animation(camera, sequence, fps, duration, warnings)
        camera_cut = _ensure_camera_cut(camera, sequence, fps, duration, warnings)
        try:
            unreal.EditorAssetLibrary.save_asset(SEQUENCE_PATH, False)
        except Exception as exc:
            warnings.append(f"save sequence: {exc}")

    saved_level = False
    try:
        level_subsystem = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
        saved_level = bool(level_subsystem.save_current_level())
    except Exception as exc:
        warnings.append(f"save level: {exc}")

    return {
        "scene": "Auralith cinematic production test scene",
        "root": ROOT,
        "camera": bridge._jsonify(camera),
        "actors": actor_records,
        "lights": [bridge._jsonify(key), bridge._jsonify(rim), bridge._jsonify(accent)],
        "gold_material": bridge._jsonify(gold_material),
        "gold_material_existed": material_existed,
        "sequence": bridge._jsonify(sequence) if sequence else None,
        "animation": animation,
        "camera_cut": camera_cut,
        "created_labels": created_labels,
        "saved_level": saved_level,
        "warnings": warnings,
    }


_ACTIONS = {
    "scene_build_test": _action_scene_build_test,
}

bridge._ACTIONS.update(_ACTIONS)
bridge._log(f"Test-scene controls registered: {', '.join(sorted(_ACTIONS))}")
