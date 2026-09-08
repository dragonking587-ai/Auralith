"""Cinematic + look-development + effects production controls for Auralith UE 5.7.

This module intentionally keeps all persistent content under /Game/AuralithProduction
and all spawned production actors under AuralithProduction_, AuralithCine_,
AuralithTest_, or AuralithFX_ labels. It is designed for repeatable, non-destructive
look development before we start authoring the user's full backdrop/effect library.
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

FX_SYSTEMS = {
    "energy_burst": (
        "/Niagara/DefaultAssets/Templates/Systems/RadialBurst.RadialBurst",
        f"{ROOT}/VFX/NS_AuralithFX_EnergyBurst.NS_AuralithFX_EnergyBurst",
        "AuralithFX_EnergyBurst",
        HERO_TARGET,
        (1.10, 1.10, 1.10),
    ),
    "impact_burst": (
        "/Niagara/DefaultAssets/Templates/Systems/SimpleExplosion.SimpleExplosion",
        f"{ROOT}/VFX/NS_AuralithFX_ImpactBurst.NS_AuralithFX_ImpactBurst",
        "AuralithFX_ImpactBurst",
        (-260.0, 120.0, 95.0),
        (0.75, 0.75, 0.75),
    ),
    "directional_burst": (
        "/Niagara/DefaultAssets/Templates/Systems/DirectionalBurst.DirectionalBurst",
        f"{ROOT}/VFX/NS_AuralithFX_DirectionalBurst.NS_AuralithFX_DirectionalBurst",
        "AuralithFX_DirectionalBurst",
        (260.0, 120.0, 95.0),
        (0.85, 0.85, 0.85),
    ),
    "fountain": (
        "/Niagara/DefaultAssets/Templates/Systems/FountainLightweight.FountainLightweight",
        f"{ROOT}/VFX/NS_AuralithFX_Fountain.NS_AuralithFX_Fountain",
        "AuralithFX_Fountain",
        (0.0, 255.0, 5.0),
        (0.70, 0.70, 0.70),
    ),
}


def _find_actor(label: str):
    try:
        return bridge._find_actor(label)
    except Exception:
        return None


def _ensure_actor(cls, label: str, location, rotation=(0, 0, 0), scale=(1, 1, 1), folder="AuralithProduction/CinematicStage"):
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
        actor.set_folder_path(folder)
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


def _safe_prop(target, name: str, value, warnings: list[str]) -> bool:
    try:
        current = target.get_editor_property(name)
        target.set_editor_property(name, bridge._coerce_like(current, value))
        return True
    except Exception as exc:
        warnings.append(f"{name}: {exc}")
        return False


def _ensure_material(name: str, base_rgb, metallic: float, roughness: float, emissive_rgb=None, rebuild=False):
    path = f"{ROOT}/Materials/{name}.{name}"
    material, existed = production._create_asset(
        name, f"{ROOT}/Materials", unreal.Material, unreal.MaterialFactoryNew, save=False
    )
    warnings: list[str] = []
    if rebuild or not existed:
        try:
            unreal.MaterialEditingLibrary.delete_all_material_expressions(material)
            base = unreal.MaterialEditingLibrary.create_material_expression(
                material, unreal.MaterialExpressionConstant3Vector, -750, -120
            )
            base.set_editor_property("constant", unreal.LinearColor(float(base_rgb[0]), float(base_rgb[1]), float(base_rgb[2]), 1.0))
            unreal.MaterialEditingLibrary.connect_material_property(base, "", unreal.MaterialProperty.MP_BASE_COLOR)

            met = unreal.MaterialEditingLibrary.create_material_expression(
                material, unreal.MaterialExpressionConstant, -750, 10
            )
            met.set_editor_property("r", float(metallic))
            unreal.MaterialEditingLibrary.connect_material_property(met, "", unreal.MaterialProperty.MP_METALLIC)

            rough = unreal.MaterialEditingLibrary.create_material_expression(
                material, unreal.MaterialExpressionConstant, -750, 110
            )
            rough.set_editor_property("r", float(roughness))
            unreal.MaterialEditingLibrary.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)

            if emissive_rgb is not None:
                glow = unreal.MaterialEditingLibrary.create_material_expression(
                    material, unreal.MaterialExpressionConstant3Vector, -750, 220
                )
                glow.set_editor_property("constant", unreal.LinearColor(float(emissive_rgb[0]), float(emissive_rgb[1]), float(emissive_rgb[2]), 1.0))
                unreal.MaterialEditingLibrary.connect_material_property(glow, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)

            unreal.MaterialEditingLibrary.layout_material_expressions(material)
            unreal.MaterialEditingLibrary.recompile_material(material)
        except Exception as exc:
            warnings.append(f"material graph {name}: {exc}")
    _save_asset(path, warnings)
    return material, existed, path, warnings


def _ensure_obsidian_material(warnings: list[str]):
    material, existed, _path, local = _ensure_material(
        "M_AuralithCine_Obsidian", (0.003, 0.004, 0.008), 0.92, 0.18, None, False
    )
    warnings.extend(local)
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
        "MovieSceneCameraCutTrack", "MovieSceneFloatTrack", "MovieSceneAudioTrack",
        "MovieSceneAudioSection", "NiagaraActor", "NiagaraComponent",
        "EditorAssetLibrary", "PostProcessVolume", "PostProcessSettings",
        "ExponentialHeightFogComponent",
    ]
    return {
        "bridge_extension": "cinematic-stage-v2-effects",
        "available_symbols": {name: hasattr(unreal, name) for name in symbols},
        "niagara_templates": {key: value[0] for key, value in FX_SYSTEMS.items()},
        "registered_actions": sorted(name for name in bridge._ACTIONS if name.startswith("cinematic_")),
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
    created, actors = [], []
    for label, mesh, location, rotation, scale in specs:
        actor, was_created = _ensure_actor(unreal.StaticMeshActor, label, location, rotation, scale)
        if was_created:
            created.append(label)
        try:
            _set_static_mesh(actor, mesh, obsidian)
        except Exception as exc:
            warnings.append(f"{label}: {exc}")
        actors.append(bridge._jsonify(actor))
    saved_level = False
    try:
        saved_level = bool(unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level())
    except Exception as exc:
        warnings.append(f"save level: {exc}")
    return {"actors": actors, "created_labels": created, "obsidian_material": bridge._jsonify(obsidian), "material_existed": material_existed, "saved_level": saved_level, "warnings": warnings}


def _action_cinematic_build_multicam(args: Dict[str, Any]) -> Dict[str, Any]:
    sequence = unreal.load_asset(str(args.get("sequence", SEQUENCE_PATH)))
    if not sequence or not isinstance(sequence, unreal.LevelSequence):
        raise ValueError(f"Level Sequence not found: {args.get('sequence', SEQUENCE_PATH)}")
    warnings: list[str] = []
    total_frames = int(sequence.get_playback_end()) - int(sequence.get_playback_start())
    total_frames = total_frames if total_frames > 2 else 240
    one_third = max(1, total_frames // 3)
    primary = _find_actor("AuralithProduction_Camera")
    if primary is None:
        raise ValueError("AuralithProduction_Camera is required before multicam setup")
    specs = [
        ("AuralithProduction_Camera", primary, None, 45.0),
        ("AuralithCine_Camera_B", None, (650, -650, 250), 50.0),
        ("AuralithCine_Camera_C", None, (0, -520, 185), 55.0),
    ]
    cameras, created = [], []
    for label, existing, location, focal in specs:
        actor = existing
        if actor is None:
            actor, was_created = _ensure_actor(unreal.CineCameraActor, label, location, _look_rotation(location))
            if was_created:
                created.append(label)
        try:
            component = production._camera_component(actor)
            component.set_editor_property("current_focal_length", focal)
            component.set_editor_property("current_aperture", 4.0)
        except Exception as exc:
            warnings.append(f"{label} settings: {exc}")
        cameras.append(actor)
    bindings = [_binding_for(sequence, cam, cam.get_actor_label()) for cam in cameras]
    tracks = list(sequence.find_tracks_by_type(unreal.MovieSceneCameraCutTrack))
    track = tracks[0] if tracks else sequence.add_track(unreal.MovieSceneCameraCutTrack)
    removed = _clear_sections(track)
    ranges = [(0, one_third), (one_third, one_third * 2), (one_third * 2, total_frames)]
    cuts = []
    for binding, (start, end), camera in zip(bindings, ranges, cameras):
        section = track.add_section()
        section.set_range(int(start), int(end))
        try:
            section.set_is_active(True)
        except Exception:
            pass
        cuts.append({"camera": camera.get_actor_label(), "start": int(start), "end": int(end), "assignment_mode": _set_camera_binding(section, binding)})
    _save_asset(SEQUENCE_PATH, warnings)
    try:
        unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
    except Exception as exc:
        warnings.append(f"save level: {exc}")
    return {"sequence": bridge._jsonify(sequence), "cameras": [bridge._jsonify(c) for c in cameras], "created_cameras": created, "removed_previous_camera_cut_sections": removed, "camera_cuts": cuts, "warnings": warnings}


def _add_intensity_track(sequence, actor_label: str, values: Iterable[tuple[int, float]], warnings: list[str]):
    actor = _find_actor(actor_label)
    if actor is None:
        warnings.append(f"{actor_label}: actor unavailable")
        return None
    try:
        component = production._light_component(actor)
        binding = _binding_for(sequence, component, f"{actor_label}_LightComponent")
        tracks = list(binding.find_tracks_by_type(unreal.MovieSceneFloatTrack))
        track = tracks[0] if tracks else binding.add_track(unreal.MovieSceneFloatTrack)
        try:
            track.set_property_name_and_path("Intensity", "Intensity")
        except Exception as exc:
            warnings.append(f"{actor_label} property path: {exc}")
        sections = list(track.get_sections())
        section = sections[0] if sections else track.add_section()
        values = list(values)
        section.set_range(min(f for f, _ in values), max(f for f, _ in values) + 1)
        channel = _first_float_channel(section)
        try:
            for key in list(channel.get_keys()):
                channel.remove_key(key)
        except Exception:
            pass
        for frame, value in values:
            _add_key(channel, int(frame), float(value))
        return {"actor": actor_label, "component": bridge._jsonify(component), "keys": [{"frame": int(f), "value": float(v)} for f, v in values]}
    except Exception as exc:
        warnings.append(f"{actor_label} animation: {exc}")
        return None


def _action_cinematic_animate_lighting(args: Dict[str, Any]) -> Dict[str, Any]:
    sequence = unreal.load_asset(str(args.get("sequence", SEQUENCE_PATH)))
    if not sequence or not isinstance(sequence, unreal.LevelSequence):
        raise ValueError("Level Sequence not found")
    total = int(sequence.get_playback_end()) - int(sequence.get_playback_start())
    total = total if total > 2 else 240
    mid = total // 2
    warnings: list[str] = []
    records = [
        _add_intensity_track(sequence, "AuralithProduction_KeyLight", [(0, 850.0), (mid, 1250.0), (total - 1, 900.0)], warnings),
        _add_intensity_track(sequence, "AuralithTest_GoldAccent", [(0, 250.0), (mid, 650.0), (total - 1, 350.0)], warnings),
        _add_intensity_track(sequence, "AuralithTest_RimLight", [(0, 400.0), (mid, 850.0), (total - 1, 500.0)], warnings),
    ]
    _save_asset(SEQUENCE_PATH, warnings)
    return {"sequence": bridge._jsonify(sequence), "tracks": [r for r in records if r], "warnings": warnings}


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
    actor, created = _ensure_actor(unreal.NiagaraActor, "AuralithCine_HeroBurst", HERO_TARGET, (0, 0, 0), (1, 1, 1), "AuralithProduction/VFX")
    component = actor.get_component_by_class(unreal.NiagaraComponent)
    if not component:
        raise RuntimeError("NiagaraActor did not expose a NiagaraComponent")
    try:
        component.set_asset(system, True)
    except TypeError:
        component.set_asset(system)
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
    return {"actor": bridge._jsonify(actor), "component": bridge._jsonify(component), "system": bridge._jsonify(system), "template": NIAGARA_TEMPLATE, "duplicated_template": duplicated, "created_actor": created, "warnings": warnings}


def _action_cinematic_add_audio_track(args: Dict[str, Any]) -> Dict[str, Any]:
    sequence_path = str(args.get("sequence", SEQUENCE_PATH))
    sound_path = str(args.get("sound", "")).strip()
    if not sound_path:
        raise ValueError("sound asset path is required")
    sequence = unreal.load_asset(sequence_path)
    sound = unreal.load_asset(sound_path)
    if not sequence or not isinstance(sequence, unreal.LevelSequence):
        raise ValueError(f"Level Sequence not found: {sequence_path}")
    if not sound or not isinstance(sound, unreal.SoundBase):
        raise ValueError(f"SoundBase asset not found: {sound_path}")
    track = sequence.add_track(unreal.MovieSceneAudioTrack)
    try:
        track.set_display_name(str(args.get("name", "Auralith Production Audio")))
    except Exception:
        pass
    section = track.add_section()
    section.set_sound(sound)
    start = max(0.0, float(args.get("start_seconds", 0.0)))
    duration = max(0.1, float(args.get("duration_seconds", 10.0)))
    section.set_range_seconds(start, start + duration)
    try:
        section.set_looping(bool(args.get("looping", False)))
        section.set_suppress_subtitles(bool(args.get("suppress_subtitles", True)))
    except Exception:
        pass
    warnings: list[str] = []
    if bool(args.get("save", True)):
        _save_asset(sequence_path, warnings)
    return {"sequence": bridge._jsonify(sequence), "sound": bridge._jsonify(sound), "track": bridge._jsonify(track), "section": bridge._jsonify(section), "start_seconds": start, "duration_seconds": duration, "warnings": warnings}


def _action_cinematic_lock_look(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create a restrained, repeatable cinematic post-process baseline."""
    warnings: list[str] = []
    actor, created = _ensure_actor(unreal.PostProcessVolume, "AuralithFX_PostProcess", (0, 0, 0), folder="AuralithProduction/LookDev")
    _safe_prop(actor, "unbound", True, warnings)
    _safe_prop(actor, "enabled", True, warnings)
    _safe_prop(actor, "blend_weight", 1.0, warnings)
    try:
        settings = actor.get_editor_property("settings")
        pairs = [
            ("override_auto_exposure_apply_physical_camera_exposure", True),
            ("auto_exposure_apply_physical_camera_exposure", False),
            ("override_auto_exposure_bias", True),
            ("auto_exposure_bias", -0.45),
            ("override_auto_exposure_min_brightness", True),
            ("auto_exposure_min_brightness", 1.0),
            ("override_auto_exposure_max_brightness", True),
            ("auto_exposure_max_brightness", 1.0),
            ("override_bloom_intensity", True),
            ("bloom_intensity", 0.65),
            ("override_bloom_threshold", True),
            ("bloom_threshold", 1.25),
            ("override_motion_blur_amount", True),
            ("motion_blur_amount", 0.15),
            ("override_film_slope", True),
            ("film_slope", 0.90),
            ("override_film_toe", True),
            ("film_toe", 0.48),
            ("override_film_shoulder", True),
            ("film_shoulder", 0.24),
        ]
        for name, value in pairs:
            try:
                settings.set_editor_property(name, value)
            except Exception as exc:
                warnings.append(f"postprocess {name}: {exc}")
        actor.set_editor_property("settings", settings)
    except Exception as exc:
        warnings.append(f"postprocess settings: {exc}")
    try:
        unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
    except Exception as exc:
        warnings.append(f"save level: {exc}")
    return {"actor": bridge._jsonify(actor), "created": created, "warnings": warnings}


def _action_cinematic_configure_atmosphere(args: Dict[str, Any]) -> Dict[str, Any]:
    warnings: list[str] = []
    fog = _find_actor("ExponentialHeightFog")
    fog_record = None
    if fog:
        component = None
        cls = getattr(unreal, "ExponentialHeightFogComponent", None)
        if cls:
            try:
                component = fog.get_component_by_class(cls)
            except Exception:
                component = None
        if component:
            for name, value in [
                ("fog_density", 0.012),
                ("fog_height_falloff", 0.22),
                ("fog_max_opacity", 0.55),
                ("start_distance", 25.0),
                ("volumetric_fog", True),
                ("volumetric_fog_scattering_distribution", 0.30),
                ("volumetric_fog_extinction_scale", 0.65),
                ("volumetric_fog_view_distance", 3500.0),
            ]:
                _safe_prop(component, name, value, warnings)
            fog_record = bridge._jsonify(component)
        else:
            warnings.append("ExponentialHeightFog component was unavailable")
    else:
        warnings.append("Existing ExponentialHeightFog actor was not found")

    skylight = _find_actor("SkyLight")
    if skylight:
        try:
            production._light_component(skylight).set_intensity(0.20)
        except Exception as exc:
            warnings.append(f"SkyLight: {exc}")

    try:
        unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
    except Exception as exc:
        warnings.append(f"save level: {exc}")
    return {"fog_component": fog_record, "skylight": bridge._jsonify(skylight) if skylight else None, "warnings": warnings}


def _duplicate_system(template: str, dest: str, warnings: list[str]):
    system = unreal.load_asset(dest)
    duplicated = False
    if system is None:
        try:
            system = unreal.EditorAssetLibrary.duplicate_asset(template, dest)
            duplicated = bool(system)
        except Exception as exc:
            warnings.append(f"duplicate {template}: {exc}")
    if system is None:
        warnings.append(f"Niagara system unavailable: {dest}")
    elif duplicated:
        _save_asset(dest, warnings)
    return system, duplicated


def _action_cinematic_create_effect_library(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create the first real Auralith effect assets and a controlled showcase."""
    warnings: list[str] = []
    created_assets, created_actors, effects = [], [], []

    gold, gold_existed, gold_path, gold_warn = _ensure_material(
        "M_AuralithFX_GoldGlow", (0.020, 0.006, 0.001), 0.25, 0.28, (5.5, 1.1, 0.08), rebuild=bool(args.get("rebuild_materials", False))
    )
    blue, blue_existed, blue_path, blue_warn = _ensure_material(
        "M_AuralithFX_BlueGlow", (0.001, 0.006, 0.020), 0.20, 0.30, (0.08, 0.65, 5.5), rebuild=bool(args.get("rebuild_materials", False))
    )
    warnings.extend(gold_warn + blue_warn)
    if not gold_existed:
        created_assets.append(gold_path)
    if not blue_existed:
        created_assets.append(blue_path)

    for key, (template, dest, label, location, scale) in FX_SYSTEMS.items():
        system, duplicated = _duplicate_system(template, dest, warnings)
        if system is None:
            continue
        if duplicated:
            created_assets.append(dest)
        actor, was_created = _ensure_actor(unreal.NiagaraActor, label, location, (0, 0, 0), scale, "AuralithProduction/VFX")
        if was_created:
            created_actors.append(label)
        component = actor.get_component_by_class(unreal.NiagaraComponent)
        if not component:
            warnings.append(f"{label}: NiagaraComponent unavailable")
            continue
        try:
            component.set_asset(system, True)
        except TypeError:
            component.set_asset(system)
        except Exception as exc:
            warnings.append(f"{label} set asset: {exc}")
        try:
            component.activate(True)
        except Exception:
            pass
        effects.append({"key": key, "label": label, "actor": bridge._jsonify(actor), "system": bridge._jsonify(system), "template": template})

    cube = _mesh("Cube")
    cylinder = _mesh("Cylinder")
    accents = [
        ("AuralithFX_GoldRailLeft", cube, (-395, 385, 215), (0, 0, 0), (0.045, 0.08, 3.4), gold),
        ("AuralithFX_GoldRailRight", cube, (395, 385, 215), (0, 0, 0), (0.045, 0.08, 3.4), gold),
        ("AuralithFX_BlueHeader", cube, (0, 392, 420), (0, 0, 0), (6.8, 0.06, 0.055), blue),
        ("AuralithFX_HeroGlowDisc", cylinder, HERO_TARGET[:2] + (7.0,), (0, 0, 0), (1.75, 1.75, 0.025), gold),
    ]
    for label, mesh, location, rotation, scale, material in accents:
        actor, was_created = _ensure_actor(unreal.StaticMeshActor, label, location, rotation, scale, "AuralithProduction/VFX")
        if was_created:
            created_actors.append(label)
        try:
            _set_static_mesh(actor, mesh, material)
        except Exception as exc:
            warnings.append(f"{label}: {exc}")

    light_specs = [
        ("AuralithFX_GoldPulse", (-180, 20, 210), 450.0, 3200.0, {"r": 1.0, "g": 0.42, "b": 0.08, "a": 1.0}),
        ("AuralithFX_BluePulse", (180, 180, 245), 500.0, 7000.0, {"r": 0.08, "g": 0.35, "b": 1.0, "a": 1.0}),
    ]
    for label, location, intensity, temperature, color in light_specs:
        actor = _find_actor(label)
        if actor is None:
            result = production._action_light_create({"type": "point", "label": label, "location": location, "intensity": intensity, "temperature": temperature, "attenuation_radius": 650.0, "color": color, "transient": False})
            actor = _find_actor(label)
            created_actors.append(label)
            warnings.extend(result.get("warnings", []))
        else:
            try:
                comp = production._light_component(actor)
                comp.set_intensity(intensity)
                _safe_prop(comp, "attenuation_radius", 650.0, warnings)
            except Exception as exc:
                warnings.append(f"{label}: {exc}")
        try:
            actor.set_folder_path("AuralithProduction/VFX")
        except Exception:
            pass

    sequence = unreal.load_asset(SEQUENCE_PATH)
    light_tracks = []
    if sequence and isinstance(sequence, unreal.LevelSequence):
        total = int(sequence.get_playback_end()) - int(sequence.get_playback_start())
        total = total if total > 2 else 240
        q = max(1, total // 4)
        light_tracks.append(_add_intensity_track(sequence, "AuralithFX_GoldPulse", [(0, 220.0), (q, 700.0), (q * 2, 280.0), (q * 3, 650.0), (total - 1, 220.0)], warnings))
        light_tracks.append(_add_intensity_track(sequence, "AuralithFX_BluePulse", [(0, 620.0), (q, 260.0), (q * 2, 760.0), (q * 3, 300.0), (total - 1, 580.0)], warnings))
        _save_asset(SEQUENCE_PATH, warnings)

    try:
        unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
    except Exception as exc:
        warnings.append(f"save level: {exc}")

    return {
        "effects": effects,
        "materials": [gold_path, blue_path],
        "created_assets": created_assets,
        "created_actors": created_actors,
        "animated_effect_lights": [r for r in light_tracks if r],
        "warnings": warnings,
    }


def _action_cinematic_effects_diagnostics(args: Dict[str, Any]) -> Dict[str, Any]:
    records = []
    for key, (template, dest, label, _location, _scale) in FX_SYSTEMS.items():
        actor = _find_actor(label)
        system = unreal.load_asset(dest)
        active = None
        component = None
        if actor:
            component = actor.get_component_by_class(unreal.NiagaraComponent)
            if component:
                try:
                    active = bool(component.is_active())
                except Exception:
                    pass
        records.append({"key": key, "label": label, "actor_exists": bool(actor), "system_exists": bool(system), "component": bridge._jsonify(component) if component else None, "active": active, "template": template})
    return {
        "effects": records,
        "gold_material": bool(unreal.load_asset(f"{ROOT}/Materials/M_AuralithFX_GoldGlow.M_AuralithFX_GoldGlow")),
        "blue_material": bool(unreal.load_asset(f"{ROOT}/Materials/M_AuralithFX_BlueGlow.M_AuralithFX_BlueGlow")),
        "post_process": bool(_find_actor("AuralithFX_PostProcess")),
        "gold_pulse_light": bool(_find_actor("AuralithFX_GoldPulse")),
        "blue_pulse_light": bool(_find_actor("AuralithFX_BluePulse")),
    }


def _action_cinematic_stage_diagnostics(args: Dict[str, Any]) -> Dict[str, Any]:
    sequence = unreal.load_asset(str(args.get("sequence", SEQUENCE_PATH)))
    if not sequence or not isinstance(sequence, unreal.LevelSequence):
        raise ValueError("Level Sequence not found")
    actors = []
    for actor in bridge._all_actors():
        try:
            label = str(actor.get_actor_label())
            if label.startswith(("AuralithProduction_", "AuralithCine_", "AuralithTest_", "AuralithFX_")):
                actors.append({"label": label, "class": actor.get_class().get_path_name(), "location": bridge._jsonify(actor.get_actor_location())})
        except Exception:
            pass
    tracks, cuts, audio = [], [], []
    for track in sequence.get_tracks():
        tracks.append({"name": track.get_name(), "class": track.get_class().get_path_name(), "sections": len(list(track.get_sections()))})
        if isinstance(track, unreal.MovieSceneCameraCutTrack):
            for section in track.get_sections():
                cuts.append({"start": int(section.get_start_frame()), "end": int(section.get_end_frame()), "active": bool(section.is_active()), "binding": str(section.get_camera_binding_id())})
        if isinstance(track, unreal.MovieSceneAudioTrack):
            for section in track.get_sections():
                try:
                    sound = section.get_sound()
                except Exception:
                    sound = None
                audio.append({"start": int(section.get_start_frame()) if section.has_start_frame() else None, "end": int(section.get_end_frame()) if section.has_end_frame() else None, "sound": bridge._jsonify(sound)})
    return {"sequence": bridge._jsonify(sequence), "playback_start": int(sequence.get_playback_start()), "playback_end": int(sequence.get_playback_end()), "actors": actors, "master_tracks": tracks, "camera_cuts": cuts, "audio_sections": audio, "niagara_system_exists": bool(unreal.load_asset(NIAGARA_PATH)), "obsidian_material_exists": bool(unreal.load_asset(OBSIDIAN_PATH)), "effects": _action_cinematic_effects_diagnostics({})}


def _action_cinematic_build_major_stage(args: Dict[str, Any]) -> Dict[str, Any]:
    results = {
        "environment": _action_cinematic_expand_environment(args),
        "multicam": _action_cinematic_build_multicam(args),
        "lighting": _action_cinematic_animate_lighting(args),
        "niagara": _action_cinematic_spawn_niagara(args),
    }
    sound = str(args.get("sound", "")).strip()
    if sound:
        results["audio"] = _action_cinematic_add_audio_track({"sequence": str(args.get("sequence", SEQUENCE_PATH)), "sound": sound, "name": str(args.get("audio_name", "Auralith Production Audio")), "start_seconds": float(args.get("audio_start_seconds", 0.0)), "duration_seconds": float(args.get("audio_duration_seconds", 10.0)), "looping": bool(args.get("audio_looping", False)), "save": True})
    results["diagnostics"] = _action_cinematic_stage_diagnostics(args)
    return results


def _action_cinematic_prepare_effect_production(args: Dict[str, Any]) -> Dict[str, Any]:
    """Run every prerequisite stage needed before authoring user-facing effects."""
    return {
        "environment": _action_cinematic_expand_environment(args),
        "multicam": _action_cinematic_build_multicam(args),
        "base_lighting": _action_cinematic_animate_lighting(args),
        "look": _action_cinematic_lock_look(args),
        "atmosphere": _action_cinematic_configure_atmosphere(args),
        "effect_library": _action_cinematic_create_effect_library(args),
        "diagnostics": _action_cinematic_stage_diagnostics(args),
    }


_ACTIONS = {
    "cinematic_stage_capabilities": _action_cinematic_stage_capabilities,
    "cinematic_expand_environment": _action_cinematic_expand_environment,
    "cinematic_build_multicam": _action_cinematic_build_multicam,
    "cinematic_animate_lighting": _action_cinematic_animate_lighting,
    "cinematic_spawn_niagara": _action_cinematic_spawn_niagara,
    "cinematic_add_audio_track": _action_cinematic_add_audio_track,
    "cinematic_lock_look": _action_cinematic_lock_look,
    "cinematic_configure_atmosphere": _action_cinematic_configure_atmosphere,
    "cinematic_create_effect_library": _action_cinematic_create_effect_library,
    "cinematic_effects_diagnostics": _action_cinematic_effects_diagnostics,
    "cinematic_stage_diagnostics": _action_cinematic_stage_diagnostics,
    "cinematic_build_major_stage": _action_cinematic_build_major_stage,
    "cinematic_prepare_effect_production": _action_cinematic_prepare_effect_production,
}

bridge._ACTIONS.update(_ACTIONS)
bridge._log(f"Cinematic/effects controls registered: {', '.join(sorted(_ACTIONS))}")
