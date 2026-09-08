"""Cinematic production-stage expansion for the Auralith Unreal bridge.

Adds higher-level, scoped production actions for:
- richer stage/environment construction
- three-camera Sequencer coverage
- animated cinematic lighting
- a visible Niagara system cloned from an Epic Niagara template
- Sequencer audio placement when a SoundBase asset is supplied
- read-only diagnostics

All writes remain under /Game/AuralithProduction and actors with AuralithProduction_
or AuralithCine_ labels. No unrelated actors/assets are deleted.
"""

from __future__ import annotations

import math
from typing import Any, Dict, Iterable

import unreal
import auralith_unreal_bridge as bridge
import auralith_production_controls as production


ROOT = "/Game/AuralithProduction"
SEQUENCE_PATH = f"{ROOT}/Cinematics/AuralithProduction_Master.AuralithProduction_Master"
OBSIDIAN_PATH = f"{ROOT}/Materials/M_AuralithCine_Obsidian.M_AuralithCine_Obsidian"
NIAGARA_PATH = f"{ROOT}/VFX/NS_AuralithCine_RadialBurst.NS_AuralithCine_RadialBurst"
NIAGARA_TEMPLATE = "/Niagara/DefaultAssets/Templates/Systems/RadialBurst.RadialBurst"
HERO_TARGET = (0.0, 100.0, 145.0)


def _find_actor(label: str):
    try:
        return bridge._find_actor(label)
    except Exception:
        return None


def _ensure_actor(cls, label: str, location, rotation=(0, 0, 0), scale=(1, 1, 1)):
    actor = _find_actor(label)
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
        actor.set_folder_path("AuralithProduction/CinematicStage")
    except Exception:
        pass
    return actor, created


def _look_rotation(location, target=HERO_TARGET):
    dx = float(target[0]) - float(location[0])
    dy = float(target[1]) - float(location[1])
    dz = float(target[2]) - float(location[2])
    horizontal = max(0.0001, math.sqrt(dx * dx + dy * dy))
    return {
        "roll": 0.0,
        "pitch": math.degrees(math.atan2(dz, horizontal)),
        "yaw": math.degrees(math.atan2(dy, dx)),
    }


def _mesh(name: str):
    asset = unreal.load_asset(f"/Engine/BasicShapes/{name}.{name}")
    if not asset:
        raise RuntimeError(f"Engine basic shape unavailable: {name}")
    return asset


def _set_static_mesh(actor, mesh, material=None):
    component = actor.get_component_by_class(unreal.StaticMeshComponent)
    if not component:
        raise RuntimeError(f"StaticMeshComponent unavailable for {actor.get_actor_label()}")
    component.set_static_mesh(mesh)
    if material:
        component.set_material(0, material)
    return component


def _save_asset(path: str, warnings: list[str]) -> bool:
    try:
        return bool(unreal.EditorAssetLibrary.save_asset(path, False))
    except Exception as exc:
        warnings.append(f"save {path}: {exc}")
        return False


def _ensure_obsidian_material(warnings: list[str]):
    material, existed = production._create_asset(
        "M_AuralithCine_Obsidian",
        f"{ROOT}/Materials",
        unreal.Material,
        unreal.MaterialFactoryNew,
        save=False,
    )
    if not existed:
        try:
            unreal.MaterialEditingLibrary.delete_all_material_expressions(material)

            base = unreal.MaterialEditingLibrary.create_material_expression(
                material, unreal.MaterialExpressionConstant3Vector, -700, -100
            )
            base.set_editor_property("constant", unreal.LinearColor(0.003, 0.004, 0.008, 1.0))
            unreal.MaterialEditingLibrary.connect_material_property(
                base, "", unreal.MaterialProperty.MP_BASE_COLOR
            )

            metallic = unreal.MaterialEditingLibrary.create_material_expression(
                material, unreal.MaterialExpressionConstant, -700, 20
            )
            metallic.set_editor_property("r", 0.92)
            unreal.MaterialEditingLibrary.connect_material_property(
                metallic, "", unreal.MaterialProperty.MP_METALLIC
            )

            roughness = unreal.MaterialEditingLibrary.create_material_expression(
                material, unreal.MaterialExpressionConstant, -700, 120
            )
            roughness.set_editor_property("r", 0.18)
            unreal.MaterialEditingLibrary.connect_material_property(
                roughness, "", unreal.MaterialProperty.MP_ROUGHNESS
            )

            unreal.MaterialEditingLibrary.layout_material_expressions(material)
            unreal.MaterialEditingLibrary.recompile_material(material)
        except Exception as exc:
            warnings.append(f"obsidian material graph: {exc}")

    _save_asset(OBSIDIAN_PATH, warnings)
    return material, existed


def _binding_for(sequence, obj, display_name: str | None = None):
    wanted = str(display_name or getattr(obj, "get_name", lambda: "")())
    for binding in sequence.get_bindings():
        try:
            if str(binding.get_display_name()) == wanted:
                return binding
        except Exception:
            continue
    binding = sequence.add_possessable(obj)
    if display_name:
        try:
            binding.set_display_name(str(display_name))
        except Exception:
            pass
    return binding


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
            raise RuntimeError("Unable to build MovieSceneObjectBindingID")
        section.set_camera_binding_id(binding_id)
        return "object_binding_id"


def _clear_sections(track) -> int:
    removed = 0
    for section in list(track.get_sections()):
        try:
            track.remove_section(section)
            removed += 1
        except Exception:
            pass
    return removed


def _first_float_channel(section):
    channels = list(section.get_all_channels())
    if not channels:
        raise RuntimeError("Sequencer float section exposed no channels")
    return channels[0]


def _add_key(channel, frame: int, value: float) -> None:
    try:
        channel.add_key(time=unreal.FrameNumber(value=int(frame)), new_value=float(value))
    except TypeError:
        channel.add_key(unreal.FrameNumber(value=int(frame)), float(value))


def _action_cinematic_stage_capabilities(args: Dict[str, Any]) -> Dict[str, Any]:
    symbols = [
        "MovieSceneCameraCutTrack",
        "MovieSceneFloatTrack",
        "MovieSceneAudioTrack",
        "MovieSceneAudioSection",
        "NiagaraActor",
        "NiagaraComponent",
        "EditorAssetLibrary",
    ]
    return {
        "bridge_extension": "cinematic-stage-v1",
        "available_symbols": {name: hasattr(unreal, name) for name in symbols},
        "niagara_template": NIAGARA_TEMPLATE,
        "registered_actions": sorted(
            name for name in bridge._ACTIONS if name.startswith("cinematic_")
        ),
    }


def _action_cinematic_expand_environment(args: Dict[str, Any]) -> Dict[str, Any]:
    warnings: list[str] = []
    obsidian, material_existed = _ensure_obsidian_material(warnings)
    cube = _mesh("Cube")
    cylinder = _mesh("Cylinder")

    specs = [
        ("AuralithCine_FloorStage", cylinder, (0, 100, -6), (0, 0, 0), (7.5, 7.5, 0.12)),
        ("AuralithCine_BackFrameTop", cube, (0, 405, 475), (0, 0, 0), (12.5, 0.32, 0.24)),
        ("AuralithCine_BackFrameLeft", cube, (-590, 405, 235), (0, 0, 0), (0.24, 0.32, 4.8)),
        ("AuralithCine_BackFrameRight", cube, (590, 405, 235), (0, 0, 0), (0.24, 0.32, 4.8)),
        ("AuralithCine_ArchLeft", cube, (-410, 260, 205), (0, 0, -12), (0.32, 0.45, 4.2)),
        ("AuralithCine_ArchRight", cube, (410, 260, 205), (0, 0, 12), (0.32, 0.45, 4.2)),
    ]

    created = []
    actors = []
    for label, mesh, location, rotation, scale in specs:
        actor, was_created = _ensure_actor(
            unreal.StaticMeshActor, label, location, rotation, scale
        )
        if was_created:
            created.append(label)
        try:
            _set_static_mesh(actor, mesh, obsidian)
        except Exception as exc:
            warnings.append(f"{label}: {exc}")
        actors.append(bridge._jsonify(actor))

    saved_level = False
    try:
        saved_level = bool(
            unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
        )
    except Exception as exc:
        warnings.append(f"save level: {exc}")

    return {
        "actors": actors,
        "created_labels": created,
        "obsidian_material": bridge._jsonify(obsidian),
        "material_existed": material_existed,
        "saved_level": saved_level,
        "warnings": warnings,
    }


def _action_cinematic_build_multicam(args: Dict[str, Any]) -> Dict[str, Any]:
    sequence = unreal.load_asset(str(args.get("sequence", SEQUENCE_PATH)))
    if not sequence or not isinstance(sequence, unreal.LevelSequence):
        raise ValueError(f"Level Sequence not found: {args.get('sequence', SEQUENCE_PATH)}")

    warnings: list[str] = []
    fps = int(args.get("fps", 24))
    total_frames = int(sequence.get_playback_end()) - int(sequence.get_playback_start())
    total_frames = total_frames if total_frames > 2 else fps * 10
    one_third = max(1, total_frames // 3)

    primary = _find_actor("AuralithProduction_Camera")
    if primary is None:
        raise ValueError("AuralithProduction_Camera is required before multicam setup")

    camera_specs = [
        ("AuralithProduction_Camera", primary, None),
        ("AuralithCine_Camera_B", None, (650, -650, 250)),
        ("AuralithCine_Camera_C", None, (0, -520, 185)),
    ]
    cameras = []
    created = []
    for label, existing, location in camera_specs:
        actor = existing
        if actor is None:
            rot = _look_rotation(location)
            actor, was_created = _ensure_actor(
                unreal.CineCameraActor, label, location, rot
            )
            if was_created:
                created.append(label)
        try:
            component = production._camera_component(actor)
            component.set_editor_property(
                "current_focal_length",
                50.0 if label.endswith("_B") else 58.0 if label.endswith("_C") else 45.0,
            )
            component.set_editor_property("current_aperture", 2.8)
        except Exception as exc:
            warnings.append(f"{label} settings: {exc}")
        cameras.append(actor)

    bindings = [_binding_for(sequence, cam, cam.get_actor_label()) for cam in cameras]

    tracks = list(sequence.find_tracks_by_type(unreal.MovieSceneCameraCutTrack))
    track = tracks[0] if tracks else sequence.add_track(unreal.MovieSceneCameraCutTrack)
    removed_sections = _clear_sections(track)

    ranges = [
        (0, one_third),
        (one_third, one_third * 2),
        (one_third * 2, total_frames),
    ]
    cut_records = []
    for binding, (start, end), camera in zip(bindings, ranges, cameras):
        section = track.add_section()
        section.set_range(int(start), int(end))
        try:
            section.set_is_active(True)
        except Exception:
            pass
        mode = _set_camera_binding(section, binding)
        cut_records.append({
            "camera": camera.get_actor_label(),
            "start": int(start),
            "end": int(end),
            "assignment_mode": mode,
        })

    _save_asset(SEQUENCE_PATH, warnings)
    try:
        unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
    except Exception as exc:
        warnings.append(f"save level: {exc}")

    return {
        "sequence": bridge._jsonify(sequence),
        "cameras": [bridge._jsonify(c) for c in cameras],
        "created_cameras": created,
        "removed_previous_camera_cut_sections": removed_sections,
        "camera_cuts": cut_records,
        "warnings": warnings,
    }


def _add_intensity_track(sequence, actor_label: str, values: Iterable[tuple[int, float]], warnings: list[str]):
    actor = _find_actor(actor_label)
    if actor is None:
        warnings.append(f"{actor_label}: actor unavailable")
        return None
    try:
        component = production._light_component(actor)
        display = f"{actor_label}_LightComponent"
        binding = _binding_for(sequence, component, display)

        tracks = list(binding.find_tracks_by_type(unreal.MovieSceneFloatTrack))
        track = tracks[0] if tracks else binding.add_track(unreal.MovieSceneFloatTrack)
        try:
            track.set_property_name_and_path("Intensity", "Intensity")
        except Exception as exc:
            warnings.append(f"{actor_label} property path: {exc}")

        sections = list(track.get_sections())
        section = sections[0] if sections else track.add_section()
        start = min(frame for frame, _ in values)
        end = max(frame for frame, _ in values) + 1
        section.set_range(int(start), int(end))
        channel = _first_float_channel(section)
        for frame, value in values:
            _add_key(channel, int(frame), float(value))
        return {
            "actor": actor_label,
            "component": bridge._jsonify(component),
            "binding": bridge._jsonify(binding),
            "keys": [{"frame": int(f), "value": float(v)} for f, v in values],
        }
    except Exception as exc:
        warnings.append(f"{actor_label} animation: {exc}")
        return None


def _action_cinematic_animate_lighting(args: Dict[str, Any]) -> Dict[str, Any]:
    sequence = unreal.load_asset(str(args.get("sequence", SEQUENCE_PATH)))
    if not sequence or not isinstance(sequence, unreal.LevelSequence):
        raise ValueError(f"Level Sequence not found: {args.get('sequence', SEQUENCE_PATH)}")
    total_frames = int(sequence.get_playback_end()) - int(sequence.get_playback_start())
    total_frames = total_frames if total_frames > 2 else 240
    mid = total_frames // 2
    warnings: list[str] = []

    records = [
        _add_intensity_track(
            sequence,
            "AuralithProduction_KeyLight",
            [(0, 1100.0), (mid, 1850.0), (total_frames - 1, 1250.0)],
            warnings,
        ),
        _add_intensity_track(
            sequence,
            "AuralithTest_GoldAccent",
            [(0, 450.0), (mid, 1200.0), (total_frames - 1, 650.0)],
            warnings,
        ),
        _add_intensity_track(
            sequence,
            "AuralithTest_RimLight",
            [(0, 700.0), (mid, 1500.0), (total_frames - 1, 900.0)],
            warnings,
        ),
    ]
    _save_asset(SEQUENCE_PATH, warnings)
    return {
        "sequence": bridge._jsonify(sequence),
        "tracks": [r for r in records if r],
        "warnings": warnings,
    }


def _action_cinematic_spawn_niagara(args: Dict[str, Any]) -> Dict[str, Any]:
    warnings: list[str] = []
    system = unreal.load_asset(NIAGARA_PATH)
    duplicated = False
    if system is None:
        try:
            system = unreal.EditorAssetLibrary.duplicate_asset(NIAGARA_TEMPLATE, NIAGARA_PATH)
            duplicated = bool(system)
        except Exception as exc:
            warnings.append(f"duplicate Niagara template: {exc}")
    if system is None:
        system = unreal.load_asset(f"{ROOT}/VFX/NS_AuralithProduction_Base.NS_AuralithProduction_Base")
        warnings.append("Using base Niagara system because template duplication was unavailable")
    if system is None:
        raise RuntimeError("No usable Niagara system is available")

    actor, created = _ensure_actor(
        unreal.NiagaraActor,
        "AuralithCine_HeroBurst",
        HERO_TARGET,
        (0, 0, 0),
        (1, 1, 1),
    )
    component = actor.get_component_by_class(unreal.NiagaraComponent)
    if not component:
        raise RuntimeError("NiagaraActor did not expose a NiagaraComponent")
    try:
        component.set_asset(system, True)
    except TypeError:
        component.set_asset(system)
    except Exception as exc:
        try:
            component.set_editor_property("asset", system)
        except Exception:
            warnings.append(f"assign Niagara system: {exc}")

    try:
        component.activate(True)
    except Exception:
        pass

    if duplicated:
        _save_asset(NIAGARA_PATH, warnings)
    try:
        unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
    except Exception as exc:
        warnings.append(f"save level: {exc}")

    return {
        "actor": bridge._jsonify(actor),
        "component": bridge._jsonify(component),
        "system": bridge._jsonify(system),
        "template": NIAGARA_TEMPLATE,
        "duplicated_template": duplicated,
        "created_actor": created,
        "warnings": warnings,
    }


def _action_cinematic_add_audio_track(args: Dict[str, Any]) -> Dict[str, Any]:
    sequence_path = str(args.get("sequence", SEQUENCE_PATH))
    sound_path = str(args.get("sound", "")).strip()
    if not sound_path:
        raise ValueError("sound asset path is required")
    sequence = unreal.load_asset(sequence_path)
    if not sequence or not isinstance(sequence, unreal.LevelSequence):
        raise ValueError(f"Level Sequence not found: {sequence_path}")
    sound = unreal.load_asset(sound_path)
    if not sound or not isinstance(sound, unreal.SoundBase):
        raise ValueError(f"SoundBase asset not found: {sound_path}")

    track = sequence.add_track(unreal.MovieSceneAudioTrack)
    try:
        track.set_display_name(str(args.get("name", "Auralith Production Audio")))
    except Exception:
        pass
    section = track.add_section()
    section.set_sound(sound)
    start_seconds = max(0.0, float(args.get("start_seconds", 0.0)))
    duration_seconds = max(0.1, float(args.get("duration_seconds", 10.0)))
    section.set_range_seconds(start_seconds, start_seconds + duration_seconds)
    try:
        section.set_looping(bool(args.get("looping", False)))
        section.set_suppress_subtitles(bool(args.get("suppress_subtitles", True)))
    except Exception:
        pass

    warnings: list[str] = []
    if bool(args.get("save", True)):
        _save_asset(sequence_path, warnings)
    return {
        "sequence": bridge._jsonify(sequence),
        "sound": bridge._jsonify(sound),
        "track": bridge._jsonify(track),
        "section": bridge._jsonify(section),
        "start_seconds": start_seconds,
        "duration_seconds": duration_seconds,
        "warnings": warnings,
    }


def _action_cinematic_stage_diagnostics(args: Dict[str, Any]) -> Dict[str, Any]:
    sequence = unreal.load_asset(str(args.get("sequence", SEQUENCE_PATH)))
    if not sequence or not isinstance(sequence, unreal.LevelSequence):
        raise ValueError(f"Level Sequence not found: {args.get('sequence', SEQUENCE_PATH)}")

    actors = []
    for actor in bridge._all_actors():
        try:
            label = str(actor.get_actor_label())
            if label.startswith(("AuralithProduction_", "AuralithCine_", "AuralithTest_")):
                actors.append({
                    "label": label,
                    "class": actor.get_class().get_path_name(),
                    "location": bridge._jsonify(actor.get_actor_location()),
                })
        except Exception:
            pass

    tracks = []
    camera_cuts = []
    audio_sections = []
    for track in sequence.get_tracks():
        item = {
            "name": track.get_name(),
            "class": track.get_class().get_path_name(),
            "sections": len(list(track.get_sections())),
        }
        tracks.append(item)
        if isinstance(track, unreal.MovieSceneCameraCutTrack):
            for section in track.get_sections():
                camera_cuts.append({
                    "start": int(section.get_start_frame()),
                    "end": int(section.get_end_frame()),
                    "active": bool(section.is_active()),
                    "binding": str(section.get_camera_binding_id()),
                })
        if isinstance(track, unreal.MovieSceneAudioTrack):
            for section in track.get_sections():
                try:
                    sound = section.get_sound()
                except Exception:
                    sound = None
                audio_sections.append({
                    "start": int(section.get_start_frame()) if section.has_start_frame() else None,
                    "end": int(section.get_end_frame()) if section.has_end_frame() else None,
                    "sound": bridge._jsonify(sound),
                })

    return {
        "sequence": bridge._jsonify(sequence),
        "playback_start": int(sequence.get_playback_start()),
        "playback_end": int(sequence.get_playback_end()),
        "actors": actors,
        "master_tracks": tracks,
        "camera_cuts": camera_cuts,
        "audio_sections": audio_sections,
        "niagara_system_exists": bool(unreal.load_asset(NIAGARA_PATH)),
        "obsidian_material_exists": bool(unreal.load_asset(OBSIDIAN_PATH)),
    }


def _action_cinematic_build_major_stage(args: Dict[str, Any]) -> Dict[str, Any]:
    results = {
        "environment": _action_cinematic_expand_environment(args),
        "multicam": _action_cinematic_build_multicam(args),
        "lighting": _action_cinematic_animate_lighting(args),
        "niagara": _action_cinematic_spawn_niagara(args),
    }
    sound = str(args.get("sound", "")).strip()
    if sound:
        results["audio"] = _action_cinematic_add_audio_track({
            "sequence": str(args.get("sequence", SEQUENCE_PATH)),
            "sound": sound,
            "name": str(args.get("audio_name", "Auralith Production Audio")),
            "start_seconds": float(args.get("audio_start_seconds", 0.0)),
            "duration_seconds": float(args.get("audio_duration_seconds", 10.0)),
            "looping": bool(args.get("audio_looping", False)),
            "save": True,
        })
    results["diagnostics"] = _action_cinematic_stage_diagnostics(args)
    return results


_ACTIONS = {
    "cinematic_stage_capabilities": _action_cinematic_stage_capabilities,
    "cinematic_expand_environment": _action_cinematic_expand_environment,
    "cinematic_build_multicam": _action_cinematic_build_multicam,
    "cinematic_animate_lighting": _action_cinematic_animate_lighting,
    "cinematic_spawn_niagara": _action_cinematic_spawn_niagara,
    "cinematic_add_audio_track": _action_cinematic_add_audio_track,
    "cinematic_stage_diagnostics": _action_cinematic_stage_diagnostics,
    "cinematic_build_major_stage": _action_cinematic_build_major_stage,
}

bridge._ACTIONS.update(_ACTIONS)
bridge._log(f"Cinematic-stage controls registered: {', '.join(sorted(_ACTIONS))}")
