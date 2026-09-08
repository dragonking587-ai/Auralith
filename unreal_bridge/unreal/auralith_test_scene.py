"""Saved cinematic test-scene builder for the Auralith Unreal bridge.

The actions registered here are scoped to the existing AuralithProduction sandbox.
They create/repair the test scene, keep the production Cine Camera pointed at the
hero while Sequencer animates it, repair the Camera Cut binding, and provide
read-only sequence diagnostics. They never start a render or delete unrelated
project content.
"""

from __future__ import annotations

import math
from typing import Any, Dict

import unreal
import auralith_unreal_bridge as bridge
import auralith_production_controls as production


ROOT = "/Game/AuralithProduction"
MATERIAL_PATH = f"{ROOT}/Materials/M_AuralithTest_GoldGlow.M_AuralithTest_GoldGlow"
SEQUENCE_PATH = f"{ROOT}/Cinematics/AuralithProduction_Master.AuralithProduction_Master"
CAMERA_LABEL = "AuralithProduction_Camera"
HERO_TARGET = (0.0, 100.0, 145.0)


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
            unreal.MaterialEditingLibrary.connect_material_property(base, "", unreal.MaterialProperty.MP_BASE_COLOR)

            metallic = unreal.MaterialEditingLibrary.create_material_expression(
                material, unreal.MaterialExpressionConstant, -700, 20
            )
            metallic.set_editor_property("r", 0.9)
            unreal.MaterialEditingLibrary.connect_material_property(metallic, "", unreal.MaterialProperty.MP_METALLIC)

            roughness = unreal.MaterialEditingLibrary.create_material_expression(
                material, unreal.MaterialExpressionConstant, -700, 120
            )
            roughness.set_editor_property("r", 0.24)
            unreal.MaterialEditingLibrary.connect_material_property(roughness, "", unreal.MaterialProperty.MP_ROUGHNESS)

            emissive = unreal.MaterialEditingLibrary.create_material_expression(
                material, unreal.MaterialExpressionConstant3Vector, -700, 250
            )
            emissive.set_editor_property("constant", unreal.LinearColor(4.0, 0.8, 0.035, 1.0))
            unreal.MaterialEditingLibrary.connect_material_property(emissive, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)

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


def _camera_binding(camera, sequence):
    for item in sequence.get_bindings():
        try:
            if str(item.get_display_name()) == str(camera.get_actor_label()):
                return item
        except Exception:
            continue
    return sequence.add_possessable(camera)


def _look_rotation(location, target=HERO_TARGET):
    dx = float(target[0]) - float(location[0])
    dy = float(target[1]) - float(location[1])
    dz = float(target[2]) - float(location[2])
    horizontal = math.sqrt(dx * dx + dy * dy)
    yaw = math.degrees(math.atan2(dy, dx))
    pitch = math.degrees(math.atan2(dz, horizontal))
    return (0.0, pitch, yaw)  # roll, pitch, yaw


def _add_key(channel, frame: int, value: float) -> None:
    try:
        channel.add_key(time=unreal.FrameNumber(value=int(frame)), new_value=float(value))
    except TypeError:
        channel.add_key(unreal.FrameNumber(value=int(frame)), float(value))


def _ensure_camera_animation(camera, sequence, fps: int, duration_seconds: float, warnings: list[str]):
    """Create or repair the camera transform track, including rotation channels.

    The original test track keyed only Location.*. In Sequencer, an existing
    transform section can evaluate unkeyed rotation channels at zero and override
    the CineCameraActor's editor rotation. That makes the render look at empty
    sky/floor even though the actor itself is aimed at the hero. This repair adds
    explicit rotation keys that keep the camera aimed at the hero throughout the
    move.
    """
    try:
        binding = _camera_binding(camera, sequence)
        tracks = list(binding.find_tracks_by_type(unreal.MovieScene3DTransformTrack))
        track_existed = bool(tracks)
        track = tracks[0] if tracks else binding.add_track(unreal.MovieScene3DTransformTrack)
        sections = list(track.get_sections())
        section = sections[0] if sections else track.add_section()

        frames = max(2, int(round(fps * duration_seconds)))
        mid = frames // 2
        section.set_range(0, frames)
        channels = list(section.get_all_channels())

        positions = {
            0: (-800.0, -800.0, 300.0),
            mid: (-650.0, -900.0, 345.0),
            frames - 1: (-800.0, -800.0, 300.0),
        }
        rotations = {frame: _look_rotation(pos) for frame, pos in positions.items()}

        keyframes = {
            "Location.X": [(f, p[0]) for f, p in positions.items()],
            "Location.Y": [(f, p[1]) for f, p in positions.items()],
            "Location.Z": [(f, p[2]) for f, p in positions.items()],
            "Rotation.X": [(f, r[0]) for f, r in rotations.items()],
            "Rotation.Y": [(f, r[1]) for f, r in rotations.items()],
            "Rotation.Z": [(f, r[2]) for f, r in rotations.items()],
        }

        matched = []
        keys_added = 0
        for channel in channels:
            try:
                name = str(channel.get_editor_property("channel_name"))
            except Exception:
                continue
            if name not in keyframes:
                continue
            matched.append(name)
            # Existing location keys are kept. For a repaired pre-existing track,
            # only add the missing rotation keys to avoid duplicating location keys.
            if track_existed and name.startswith("Location."):
                continue
            for frame, value in keyframes[name]:
                _add_key(channel, frame, value)
                keys_added += 1

        rotation_channels = sorted(name for name in matched if name.startswith("Rotation."))
        if len(rotation_channels) < 3:
            warnings.append(f"camera animation: expected 3 rotation channels, matched {rotation_channels}")

        return {
            "binding": bridge._jsonify(binding),
            "track_existed": track_existed,
            "section_count": len(sections) if sections else 1,
            "keys_added": keys_added,
            "matched_channels": matched,
            "rotation_channels_repaired": rotation_channels,
            "start_rotation": {"roll": rotations[0][0], "pitch": rotations[0][1], "yaw": rotations[0][2]},
            "mid_rotation": {"roll": rotations[mid][0], "pitch": rotations[mid][1], "yaw": rotations[mid][2]},
        }
    except Exception as exc:
        warnings.append(f"camera animation: {exc}")
        return {"animation_repaired": False, "error": str(exc)}


def _set_camera_binding(section, binding):
    try:
        section.set_camera_binding_id(binding.get_id())
        return "direct_guid"
    except Exception:
        binding_id = unreal.MovieSceneObjectBindingID()
        assigned = False
        for prop in ("guid", "binding_id"):
            try:
                binding_id.set_editor_property(prop, binding.get_id())
                assigned = True
                break
            except Exception:
                continue
        if not assigned:
            raise RuntimeError("Could not construct MovieSceneObjectBindingID from camera binding")
        section.set_camera_binding_id(binding_id)
        return "object_binding_id"


def _ensure_camera_cut(camera, sequence, fps: int, duration_seconds: float, warnings: list[str]):
    """Create or repair the Camera Cut section and always re-apply its binding."""
    try:
        binding = _camera_binding(camera, sequence)
        tracks = list(sequence.find_tracks_by_type(unreal.MovieSceneCameraCutTrack))
        track = tracks[0] if tracks else sequence.add_track(unreal.MovieSceneCameraCutTrack)
        existing_sections = list(track.get_sections())
        section = existing_sections[0] if existing_sections else track.add_section()
        frames = max(2, int(round(fps * duration_seconds)))
        section.set_range(0, frames)
        try:
            section.set_is_active(True)
        except Exception:
            pass

        before = None
        try:
            before = str(section.get_camera_binding_id())
        except Exception:
            pass
        mode = _set_camera_binding(section, binding)
        after = None
        try:
            after = str(section.get_camera_binding_id())
        except Exception:
            pass

        return {
            "camera_cut_repaired": True,
            "track_existed": bool(tracks),
            "section_existed": bool(existing_sections),
            "binding_display_name": str(binding.get_display_name()),
            "binding_guid": str(binding.get_id()),
            "assignment_mode": mode,
            "binding_before": before,
            "binding_after": after,
        }
    except Exception as exc:
        warnings.append(f"camera cut: {exc}")
        return {"camera_cut_repaired": False, "error": str(exc)}


def _action_scene_sequence_diagnostics(args: Dict[str, Any]) -> Dict[str, Any]:
    sequence = unreal.load_asset(str(args.get("sequence", SEQUENCE_PATH)))
    if not sequence or not isinstance(sequence, unreal.LevelSequence):
        raise ValueError(f"Level Sequence not found: {args.get('sequence', SEQUENCE_PATH)}")

    bindings = []
    for binding in sequence.get_bindings():
        record = {
            "display_name": str(binding.get_display_name()),
            "name": str(binding.get_name()),
            "id": str(binding.get_id()),
            "valid": bool(binding.is_valid()),
            "tracks": [],
        }
        try:
            for track in binding.get_tracks():
                record["tracks"].append({
                    "name": track.get_name(),
                    "class": track.get_class().get_path_name(),
                    "sections": len(list(track.get_sections())),
                })
        except Exception as exc:
            record["track_error"] = str(exc)
        bindings.append(record)

    master_tracks = []
    camera_cuts = []
    try:
        tracks = list(sequence.get_tracks())
    except Exception:
        tracks = []
    for track in tracks:
        item = {
            "name": track.get_name(),
            "class": track.get_class().get_path_name(),
            "sections": len(list(track.get_sections())),
        }
        master_tracks.append(item)
        if isinstance(track, unreal.MovieSceneCameraCutTrack):
            for section in track.get_sections():
                try:
                    camera_cuts.append({
                        "start": int(section.get_start_frame()),
                        "end": int(section.get_end_frame()),
                        "active": bool(section.is_active()),
                        "binding": str(section.get_camera_binding_id()),
                    })
                except Exception as exc:
                    camera_cuts.append({"error": str(exc)})

    return {
        "sequence": bridge._jsonify(sequence),
        "display_rate": bridge._jsonify(sequence.get_display_rate()),
        "playback_start": int(sequence.get_playback_start()),
        "playback_end": int(sequence.get_playback_end()),
        "bindings": bindings,
        "master_tracks": master_tracks,
        "camera_cuts": camera_cuts,
    }


def _action_scene_build_test(args: Dict[str, Any]) -> Dict[str, Any]:
    warnings: list[str] = []
    created_labels: list[str] = []

    camera = _find_by_label(CAMERA_LABEL)
    if camera is None:
        camera, created = _ensure_actor(
            unreal.CineCameraActor,
            CAMERA_LABEL,
            (-800, -800, 300),
            (0, -9, 48),
        )
        if created:
            created_labels.append(CAMERA_LABEL)
    start_roll, start_pitch, start_yaw = _look_rotation((-800.0, -800.0, 300.0))
    camera.set_actor_location(bridge._vector([-800, -800, 300]), False, False)
    camera.set_actor_rotation(bridge._rotator({"pitch": start_pitch, "yaw": start_yaw, "roll": start_roll}), False)
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
    animation = {"animation_repaired": False, "reason": "sequence unavailable"}
    camera_cut = {"camera_cut_repaired": False, "reason": "sequence unavailable"}
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
    "scene_sequence_diagnostics": _action_scene_sequence_diagnostics,
}

bridge._ACTIONS.update(_ACTIONS)
bridge._log(f"Test-scene controls registered: {', '.join(sorted(_ACTIONS))}")
