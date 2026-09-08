"""Cinematic, look-development, and first effect-production controls for Auralith UE 5.7.

Persistent assets remain under /Game/AuralithProduction. Spawned production actors use
AuralithProduction_, AuralithCine_, AuralithTest_, or AuralithFX_ labels. The module
is intentionally repeatable and avoids deleting unrelated project content.
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
    ),
    "impact_burst": (
        "/Niagara/DefaultAssets/Templates/Systems/SimpleExplosion.SimpleExplosion",
        f"{ROOT}/VFX/NS_AuralithFX_ImpactBurst.NS_AuralithFX_ImpactBurst",
        "AuralithFX_ImpactBurst",
    ),
    "directional_burst": (
        "/Niagara/DefaultAssets/Templates/Systems/DirectionalBurst.DirectionalBurst",
        f"{ROOT}/VFX/NS_AuralithFX_DirectionalBurst.NS_AuralithFX_DirectionalBurst",
        "AuralithFX_DirectionalBurst",
    ),
    "fountain": (
        "/Niagara/DefaultAssets/Templates/Systems/FountainLightweight.FountainLightweight",
        f"{ROOT}/VFX/NS_AuralithFX_Fountain.NS_AuralithFX_Fountain",
        "AuralithFX_Fountain",
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
    dx = target[0] - float(location[0])
    dy = target[1] - float(location[1])
    dz = target[2] - float(location[2])
    horizontal = max(0.0001, math.sqrt(dx * dx + dy * dy))
    return {"roll": 0.0, "pitch": math.degrees(math.atan2(dz, horizontal)), "yaw": math.degrees(math.atan2(dy, dx))}


def _mesh(name: str):
    asset = unreal.load_asset(f"/Engine/BasicShapes/{name}.{name}")
    if not asset:
        raise RuntimeError(f"Engine basic shape unavailable: {name}")
    return asset


def _mesh_component(actor):
    component = actor.get_component_by_class(unreal.StaticMeshComponent)
    if not component:
        raise RuntimeError(f"StaticMeshComponent unavailable for {actor.get_actor_label()}")
    return component


def _set_mesh(actor, mesh, material=None):
    component = _mesh_component(actor)
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


def _constant(material, value: float, x: int, y: int):
    node = unreal.MaterialEditingLibrary.create_material_expression(material, unreal.MaterialExpressionConstant, x, y)
    node.set_editor_property("r", float(value))
    return node


def _color_constant(material, rgb, x: int, y: int):
    node = unreal.MaterialEditingLibrary.create_material_expression(material, unreal.MaterialExpressionConstant3Vector, x, y)
    node.set_editor_property("constant", unreal.LinearColor(float(rgb[0]), float(rgb[1]), float(rgb[2]), 1.0))
    return node


def _connect(a, b, input_name: str):
    unreal.MaterialEditingLibrary.connect_material_expressions(a, "", b, input_name)


def _ensure_static_material(name: str, base_rgb, metallic: float, roughness: float, emissive_rgb=None, rebuild=False):
    path = f"{ROOT}/Materials/{name}.{name}"
    material, existed = production._create_asset(name, f"{ROOT}/Materials", unreal.Material, unreal.MaterialFactoryNew, save=False)
    warnings: list[str] = []
    if rebuild or not existed:
        try:
            unreal.MaterialEditingLibrary.delete_all_material_expressions(material)
            base = _color_constant(material, base_rgb, -700, -100)
            unreal.MaterialEditingLibrary.connect_material_property(base, "", unreal.MaterialProperty.MP_BASE_COLOR)
            metallic_node = _constant(material, metallic, -700, 20)
            unreal.MaterialEditingLibrary.connect_material_property(metallic_node, "", unreal.MaterialProperty.MP_METALLIC)
            rough_node = _constant(material, roughness, -700, 120)
            unreal.MaterialEditingLibrary.connect_material_property(rough_node, "", unreal.MaterialProperty.MP_ROUGHNESS)
            if emissive_rgb is not None:
                glow = _color_constant(material, emissive_rgb, -700, 240)
                unreal.MaterialEditingLibrary.connect_material_property(glow, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
            unreal.MaterialEditingLibrary.layout_material_expressions(material)
            unreal.MaterialEditingLibrary.recompile_material(material)
        except Exception as exc:
            warnings.append(f"material graph {name}: {exc}")
    _save_asset(path, warnings)
    return material, existed, path, warnings


def _ensure_pulse_material(name: str, base_rgb, glow_rgb, metallic: float, roughness: float, speed: float, amplitude: float, bias: float, rebuild=True):
    """Build a real time-driven emissive material rather than a static glowing color."""
    path = f"{ROOT}/Materials/{name}.{name}"
    material, existed = production._create_asset(name, f"{ROOT}/Materials", unreal.Material, unreal.MaterialFactoryNew, save=False)
    warnings: list[str] = []
    if rebuild or not existed:
        try:
            unreal.MaterialEditingLibrary.delete_all_material_expressions(material)
            base = _color_constant(material, base_rgb, -900, -260)
            unreal.MaterialEditingLibrary.connect_material_property(base, "", unreal.MaterialProperty.MP_BASE_COLOR)
            metallic_node = _constant(material, metallic, -900, -140)
            unreal.MaterialEditingLibrary.connect_material_property(metallic_node, "", unreal.MaterialProperty.MP_METALLIC)
            rough_node = _constant(material, roughness, -900, -40)
            unreal.MaterialEditingLibrary.connect_material_property(rough_node, "", unreal.MaterialProperty.MP_ROUGHNESS)

            time_node = unreal.MaterialEditingLibrary.create_material_expression(material, unreal.MaterialExpressionTime, -900, 160)
            speed_node = _constant(material, speed, -900, 260)
            time_mul = unreal.MaterialEditingLibrary.create_material_expression(material, unreal.MaterialExpressionMultiply, -650, 180)
            _connect(time_node, time_mul, "A")
            _connect(speed_node, time_mul, "B")

            sine = unreal.MaterialEditingLibrary.create_material_expression(material, unreal.MaterialExpressionSine, -450, 180)
            _connect(time_mul, sine, "Input")

            amp_node = _constant(material, amplitude, -450, 300)
            amp_mul = unreal.MaterialEditingLibrary.create_material_expression(material, unreal.MaterialExpressionMultiply, -230, 180)
            _connect(sine, amp_mul, "A")
            _connect(amp_node, amp_mul, "B")

            bias_node = _constant(material, bias, -230, 300)
            pulse = unreal.MaterialEditingLibrary.create_material_expression(material, unreal.MaterialExpressionAdd, 0, 180)
            _connect(amp_mul, pulse, "A")
            _connect(bias_node, pulse, "B")

            glow = _color_constant(material, glow_rgb, 0, 320)
            emissive = unreal.MaterialEditingLibrary.create_material_expression(material, unreal.MaterialExpressionMultiply, 250, 220)
            _connect(glow, emissive, "A")
            _connect(pulse, emissive, "B")
            unreal.MaterialEditingLibrary.connect_material_property(emissive, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)

            unreal.MaterialEditingLibrary.layout_material_expressions(material)
            unreal.MaterialEditingLibrary.recompile_material(material)
        except Exception as exc:
            warnings.append(f"pulse material graph {name}: {exc}")
    _save_asset(path, warnings)
    return material, existed, path, warnings


def _ensure_obsidian(warnings: list[str], rebuild=False):
    material, existed, _path, local = _ensure_static_material("M_AuralithCine_Obsidian", (0.0025, 0.0035, 0.007), 0.94, 0.16, None, rebuild)
    warnings.extend(local)
    return material, existed


def _binding_for(sequence, obj, display_name=None):
    wanted = str(display_name or getattr(obj, "get_name", lambda: "")())
    for binding in sequence.get_bindings():
        try:
            if str(binding.get_display_name()) == wanted:
                return binding
        except Exception:
            pass
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
        value = unreal.MovieSceneObjectBindingID()
        for prop in ("guid", "binding_id"):
            try:
                value.set_editor_property(prop, binding.get_id())
                section.set_camera_binding_id(value)
                return "object_binding_id"
            except Exception:
                pass
    raise RuntimeError("Unable to assign camera binding")


def _add_key(channel, frame: int, value: float):
    try:
        channel.add_key(time=unreal.FrameNumber(value=int(frame)), new_value=float(value))
    except TypeError:
        channel.add_key(unreal.FrameNumber(value=int(frame)), float(value))


def _add_intensity_track(sequence, actor_label: str, values: Iterable[tuple[int, float]], warnings: list[str]):
    actor = _find_actor(actor_label)
    if not actor:
        warnings.append(f"{actor_label}: actor unavailable")
        return None
    try:
        component = production._light_component(actor)
        binding = _binding_for(sequence, component, f"{actor_label}_LightComponent")
        tracks = list(binding.find_tracks_by_type(unreal.MovieSceneFloatTrack))
        track = tracks[0] if tracks else binding.add_track(unreal.MovieSceneFloatTrack)
        try:
            track.set_property_name_and_path("Intensity", "Intensity")
        except Exception:
            pass
        sections = list(track.get_sections())
        section = sections[0] if sections else track.add_section()
        values = list(values)
        section.set_range(min(f for f, _ in values), max(f for f, _ in values) + 1)
        channel = list(section.get_all_channels())[0]
        try:
            for key in list(channel.get_keys()):
                channel.remove_key(key)
        except Exception:
            pass
        for frame, value in values:
            _add_key(channel, frame, value)
        return {"actor": actor_label, "keys": [{"frame": f, "value": v} for f, v in values]}
    except Exception as exc:
        warnings.append(f"{actor_label} animation: {exc}")
        return None


def _action_cinematic_stage_capabilities(args: Dict[str, Any]):
    symbols = ["MovieSceneCameraCutTrack", "MovieSceneFloatTrack", "MovieSceneAudioTrack", "NiagaraActor", "NiagaraComponent", "PostProcessVolume", "ExponentialHeightFogComponent", "MaterialExpressionTime", "MaterialExpressionSine", "MaterialExpressionMultiply", "MaterialExpressionAdd"]
    return {"bridge_extension": "cinematic-stage-v3-polished-effects", "available_symbols": {name: hasattr(unreal, name) for name in symbols}, "registered_actions": sorted(name for name in bridge._ACTIONS if name.startswith("cinematic_"))}


def _action_cinematic_expand_environment(args: Dict[str, Any]):
    warnings: list[str] = []
    obsidian, existed = _ensure_obsidian(warnings, bool(args.get("rebuild_materials", False)))
    cube, cylinder = _mesh("Cube"), _mesh("Cylinder")
    specs = [
        ("AuralithCine_FloorStage", cylinder, (0, 100, -6), (0, 0, 0), (7.5, 7.5, 0.12)),
        ("AuralithCine_BackFrameTop", cube, (0, 405, 475), (0, 0, 0), (12.5, 0.32, 0.24)),
        ("AuralithCine_BackFrameLeft", cube, (-590, 405, 235), (0, 0, 0), (0.24, 0.32, 4.8)),
        ("AuralithCine_BackFrameRight", cube, (590, 405, 235), (0, 0, 0), (0.24, 0.32, 4.8)),
        ("AuralithCine_ArchLeft", cube, (-410, 260, 205), (0, 0, -12), (0.32, 0.45, 4.2)),
        ("AuralithCine_ArchRight", cube, (410, 260, 205), (0, 0, 12), (0.32, 0.45, 4.2)),
    ]
    created = []
    for label, mesh, location, rotation, scale in specs:
        actor, was_created = _ensure_actor(unreal.StaticMeshActor, label, location, rotation, scale)
        if was_created:
            created.append(label)
        _set_mesh(actor, mesh, obsidian)
    for label in ("AuralithTest_Pedestal", "AuralithTest_PillarLeft", "AuralithTest_PillarRight", "AuralithTest_Backdrop"):
        actor = _find_actor(label)
        if actor:
            try:
                _mesh_component(actor).set_material(0, obsidian)
            except Exception as exc:
                warnings.append(f"{label}: {exc}")
    try:
        unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
    except Exception as exc:
        warnings.append(f"save level: {exc}")
    return {"created_labels": created, "obsidian_material": bridge._jsonify(obsidian), "material_existed": existed, "warnings": warnings}


def _action_cinematic_build_multicam(args: Dict[str, Any]):
    sequence = unreal.load_asset(SEQUENCE_PATH)
    if not sequence:
        raise ValueError("Production Level Sequence not found")
    warnings: list[str] = []
    primary = _find_actor("AuralithProduction_Camera")
    if not primary:
        raise ValueError("AuralithProduction_Camera is required")
    specs = [
        ("AuralithProduction_Camera", primary, None, 48.0),
        ("AuralithCine_Camera_B", None, (650, -650, 250), 52.0),
        ("AuralithCine_Camera_C", None, (0, -560, 195), 58.0),
    ]
    cameras = []
    for label, actor, location, focal in specs:
        if actor is None:
            actor, _ = _ensure_actor(unreal.CineCameraActor, label, location, _look_rotation(location))
        try:
            comp = production._camera_component(actor)
            comp.set_editor_property("current_focal_length", focal)
            comp.set_editor_property("current_aperture", 4.0)
        except Exception as exc:
            warnings.append(f"{label}: {exc}")
        cameras.append(actor)
    bindings = [_binding_for(sequence, c, c.get_actor_label()) for c in cameras]
    tracks = list(sequence.find_tracks_by_type(unreal.MovieSceneCameraCutTrack))
    track = tracks[0] if tracks else sequence.add_track(unreal.MovieSceneCameraCutTrack)
    for section in list(track.get_sections()):
        try:
            track.remove_section(section)
        except Exception:
            pass
    total = max(240, int(sequence.get_playback_end()) - int(sequence.get_playback_start()))
    third = total // 3
    cuts = []
    for camera, binding, start, end in zip(cameras, bindings, (0, third, third * 2), (third, third * 2, total)):
        section = track.add_section()
        section.set_range(start, end)
        try:
            section.set_is_active(True)
        except Exception:
            pass
        cuts.append({"camera": camera.get_actor_label(), "start": start, "end": end, "assignment_mode": _set_camera_binding(section, binding)})
    _save_asset(SEQUENCE_PATH, warnings)
    return {"cameras": [bridge._jsonify(c) for c in cameras], "camera_cuts": cuts, "warnings": warnings}


def _action_cinematic_animate_lighting(args: Dict[str, Any]):
    sequence = unreal.load_asset(SEQUENCE_PATH)
    if not sequence:
        raise ValueError("Production Level Sequence not found")
    warnings: list[str] = []
    total = max(240, int(sequence.get_playback_end()) - int(sequence.get_playback_start()))
    mid = total // 2
    tracks = [
        _add_intensity_track(sequence, "AuralithProduction_KeyLight", [(0, 700.0), (mid, 1050.0), (total - 1, 760.0)], warnings),
        _add_intensity_track(sequence, "AuralithTest_GoldAccent", [(0, 170.0), (mid, 380.0), (total - 1, 220.0)], warnings),
        _add_intensity_track(sequence, "AuralithTest_RimLight", [(0, 300.0), (mid, 600.0), (total - 1, 380.0)], warnings),
    ]
    _save_asset(SEQUENCE_PATH, warnings)
    return {"tracks": [x for x in tracks if x], "warnings": warnings}


def _action_cinematic_lock_look(args: Dict[str, Any]):
    warnings: list[str] = []
    actor, created = _ensure_actor(unreal.PostProcessVolume, "AuralithFX_PostProcess", (0, 0, 0), folder="AuralithProduction/LookDev")
    _safe_prop(actor, "unbound", True, warnings)
    _safe_prop(actor, "enabled", True, warnings)
    _safe_prop(actor, "blend_weight", 1.0, warnings)
    try:
        settings = actor.get_editor_property("settings")
        for name, value in [
            ("override_auto_exposure_apply_physical_camera_exposure", True),
            ("auto_exposure_apply_physical_camera_exposure", False),
            ("override_auto_exposure_bias", True), ("auto_exposure_bias", -0.35),
            ("override_auto_exposure_min_brightness", True), ("auto_exposure_min_brightness", 1.0),
            ("override_auto_exposure_max_brightness", True), ("auto_exposure_max_brightness", 1.0),
            ("override_bloom_intensity", True), ("bloom_intensity", 0.75),
            ("override_bloom_threshold", True), ("bloom_threshold", 1.1),
            ("override_motion_blur_amount", True), ("motion_blur_amount", 0.12),
            ("override_film_slope", True), ("film_slope", 0.88),
            ("override_film_toe", True), ("film_toe", 0.50),
            ("override_film_shoulder", True), ("film_shoulder", 0.23),
        ]:
            try:
                settings.set_editor_property(name, value)
            except Exception as exc:
                warnings.append(f"postprocess {name}: {exc}")
        actor.set_editor_property("settings", settings)
    except Exception as exc:
        warnings.append(f"postprocess settings: {exc}")
    return {"actor": bridge._jsonify(actor), "created": created, "warnings": warnings}


def _action_cinematic_configure_atmosphere(args: Dict[str, Any]):
    warnings: list[str] = []
    fog = _find_actor("ExponentialHeightFog")
    component = None
    if fog:
        component = fog.get_component_by_class(unreal.ExponentialHeightFogComponent)
        if component:
            for name, value in [
                ("fog_density", 0.010), ("fog_height_falloff", 0.20), ("fog_max_opacity", 0.48), ("start_distance", 20.0),
                ("enable_volumetric_fog", True), ("volumetric_fog_scattering_distribution", 0.22),
                ("volumetric_fog_extinction_scale", 0.52), ("volumetric_fog_distance", 3000.0),
                ("volumetric_fog_start_distance", 0.0), ("volumetric_fog_near_fade_in_distance", 60.0),
            ]:
                _safe_prop(component, name, value, warnings)
    else:
        warnings.append("ExponentialHeightFog actor was not found")
    skylight = _find_actor("SkyLight")
    if skylight:
        try:
            production._light_component(skylight).set_intensity(0.16)
        except Exception as exc:
            warnings.append(f"SkyLight: {exc}")
    return {"fog_component": bridge._jsonify(component) if component else None, "warnings": warnings}


def _duplicate_system(template: str, dest: str, warnings: list[str]):
    system = unreal.load_asset(dest)
    duplicated = False
    if not system:
        try:
            system = unreal.EditorAssetLibrary.duplicate_asset(template, dest)
            duplicated = bool(system)
        except Exception as exc:
            warnings.append(f"duplicate {template}: {exc}")
    if system and duplicated:
        _save_asset(dest, warnings)
    return system, duplicated


def _assign_system(actor, system, warnings):
    component = actor.get_component_by_class(unreal.NiagaraComponent)
    if not component:
        warnings.append(f"{actor.get_actor_label()}: NiagaraComponent unavailable")
        return None
    try:
        component.set_asset(system, True)
    except TypeError:
        component.set_asset(system)
    try:
        component.set_editor_property("allow_scalability", False)
    except Exception:
        pass
    try:
        component.activate(True)
    except Exception:
        pass
    return component


def _action_cinematic_spawn_niagara(args: Dict[str, Any]):
    warnings: list[str] = []
    system, duplicated = _duplicate_system(NIAGARA_TEMPLATE, NIAGARA_PATH, warnings)
    if not system:
        raise RuntimeError("RadialBurst Niagara system unavailable")
    actor, created = _ensure_actor(unreal.NiagaraActor, "AuralithCine_HeroBurst", HERO_TARGET, scale=(0.45, 0.45, 0.45), folder="AuralithProduction/VFX")
    component = _assign_system(actor, system, warnings)
    return {"actor": bridge._jsonify(actor), "component": bridge._jsonify(component), "system": bridge._jsonify(system), "duplicated_template": duplicated, "created_actor": created, "warnings": warnings}


def _action_cinematic_create_effect_library(args: Dict[str, Any]):
    warnings: list[str] = []
    created_assets, created_actors, effects = [], [], []
    for key, (template, dest, label) in FX_SYSTEMS.items():
        system, duplicated = _duplicate_system(template, dest, warnings)
        if not system:
            continue
        if duplicated:
            created_assets.append(dest)
        actor = _find_actor(label)
        if actor is None:
            actor, _ = _ensure_actor(unreal.NiagaraActor, label, HERO_TARGET, folder="AuralithProduction/VFX")
            created_actors.append(label)
        component = _assign_system(actor, system, warnings)
        effects.append({"key": key, "actor": bridge._jsonify(actor), "component": bridge._jsonify(component), "system": bridge._jsonify(system)})
    return {"effects": effects, "created_assets": created_assets, "created_actors": created_actors, "warnings": warnings}


def _action_cinematic_polish_effect_showcase(args: Dict[str, Any]):
    """Build the first deliberately art-directed Auralith effects rather than raw templates."""
    warnings: list[str] = []
    obsidian, _ = _ensure_obsidian(warnings, True)
    core, _, core_path, core_warn = _ensure_pulse_material("M_AuralithFX_ObsidianCorePulse", (0.002, 0.003, 0.006), (2.2, 0.30, 0.018), 0.92, 0.14, 2.0, 0.26, 0.56, True)
    gold, _, gold_path, gold_warn = _ensure_pulse_material("M_AuralithFX_GoldPulse", (0.006, 0.002, 0.001), (3.4, 0.62, 0.035), 0.35, 0.24, 1.35, 0.32, 0.60, True)
    blue, _, blue_path, blue_warn = _ensure_pulse_material("M_AuralithFX_BluePulse", (0.001, 0.003, 0.008), (0.035, 0.42, 3.0), 0.28, 0.25, 1.10, 0.30, 0.60, True)
    warnings.extend(core_warn + gold_warn + blue_warn)

    hero = _find_actor("AuralithTest_HeroSphere")
    if hero:
        hero.set_actor_scale3d(bridge._vector((1.15, 1.15, 1.15)))
        _mesh_component(hero).set_material(0, core)
    pedestal = _find_actor("AuralithTest_Pedestal")
    if pedestal:
        _mesh_component(pedestal).set_material(0, obsidian)
    for label in ("AuralithTest_PillarLeft", "AuralithTest_PillarRight", "AuralithTest_Backdrop"):
        actor = _find_actor(label)
        if actor:
            _mesh_component(actor).set_material(0, obsidian)

    cube, cylinder = _mesh("Cube"), _mesh("Cylinder")
    accent_specs = [
        ("AuralithFX_GoldRailLeft", cube, (-355, 395, 205), (0, 0, 0), (0.035, 0.055, 3.2), gold),
        ("AuralithFX_GoldRailRight", cube, (355, 395, 205), (0, 0, 0), (0.035, 0.055, 3.2), gold),
        ("AuralithFX_BlueHeader", cube, (0, 398, 405), (0, 0, 0), (5.9, 0.045, 0.045), blue),
        ("AuralithFX_HeroGlowDisc", cylinder, (0, 100, 7), (0, 0, 0), (1.45, 1.45, 0.018), gold),
    ]
    for label, mesh, location, rotation, scale, material in accent_specs:
        actor, _ = _ensure_actor(unreal.StaticMeshActor, label, location, rotation, scale, "AuralithProduction/VFX")
        _set_mesh(actor, mesh, material)

    # Keep the reusable raw systems in the library, but do not let the generic smoke/
    # line templates dominate the polished showcase.
    for label in ("AuralithFX_ImpactBurst", "AuralithFX_DirectionalBurst", "AuralithCine_HeroBurst"):
        actor = _find_actor(label)
        if actor:
            actor.set_actor_hidden_in_game(True)
    energy = _find_actor("AuralithFX_EnergyBurst")
    if energy:
        energy.set_actor_hidden_in_game(False)
        energy.set_actor_location(bridge._vector((0, 100, 145)), False, False)
        energy.set_actor_scale3d(bridge._vector((0.42, 0.42, 0.42)))
    fountain = _find_actor("AuralithFX_Fountain")
    if fountain:
        fountain.set_actor_hidden_in_game(False)
        fountain.set_actor_location(bridge._vector((0, 285, 20)), False, False)
        fountain.set_actor_scale3d(bridge._vector((0.42, 0.42, 0.42)))

    light_specs = [
        ("AuralithFX_GoldPulseLight", (-175, 20, 205), 260.0, 3200.0, {"r": 1.0, "g": 0.38, "b": 0.055, "a": 1.0}),
        ("AuralithFX_BluePulseLight", (190, 185, 240), 360.0, 7200.0, {"r": 0.055, "g": 0.28, "b": 1.0, "a": 1.0}),
    ]
    for label, location, intensity, temperature, color in light_specs:
        actor = _find_actor(label)
        if not actor:
            production._action_light_create({"type": "point", "label": label, "location": location, "intensity": intensity, "temperature": temperature, "attenuation_radius": 520.0, "color": color, "transient": False})
            actor = _find_actor(label)
        else:
            comp = production._light_component(actor)
            comp.set_intensity(intensity)
            _safe_prop(comp, "attenuation_radius", 520.0, warnings)
        try:
            actor.set_folder_path("AuralithProduction/VFX")
        except Exception:
            pass

    sequence = unreal.load_asset(SEQUENCE_PATH)
    light_tracks = []
    if sequence:
        total = max(240, int(sequence.get_playback_end()) - int(sequence.get_playback_start()))
        q = total // 4
        light_tracks = [
            _add_intensity_track(sequence, "AuralithFX_GoldPulseLight", [(0, 190.0), (q, 390.0), (q * 2, 220.0), (q * 3, 360.0), (total - 1, 200.0)], warnings),
            _add_intensity_track(sequence, "AuralithFX_BluePulseLight", [(0, 430.0), (q, 240.0), (q * 2, 470.0), (q * 3, 260.0), (total - 1, 400.0)], warnings),
        ]
        _save_asset(SEQUENCE_PATH, warnings)

    try:
        unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
    except Exception as exc:
        warnings.append(f"save level: {exc}")

    return {
        "finished_effect_prototypes": [
            {"name": "Obsidian Core Pulse", "type": "procedural material + reactive light + subtle Niagara", "material": core_path},
            {"name": "Gold Rail Pulse", "type": "procedural emissive backdrop accent", "material": gold_path},
            {"name": "Blue Header Pulse", "type": "procedural emissive backdrop accent", "material": blue_path},
        ],
        "animated_lights": [x for x in light_tracks if x],
        "warnings": warnings,
    }


def _action_cinematic_add_audio_track(args: Dict[str, Any]):
    sound_path = str(args.get("sound", "")).strip()
    if not sound_path:
        raise ValueError("sound asset path is required")
    sequence = unreal.load_asset(SEQUENCE_PATH)
    sound = unreal.load_asset(sound_path)
    if not sequence or not sound or not isinstance(sound, unreal.SoundBase):
        raise ValueError("Valid production sequence and SoundBase are required")
    track = sequence.add_track(unreal.MovieSceneAudioTrack)
    section = track.add_section()
    section.set_sound(sound)
    start = max(0.0, float(args.get("start_seconds", 0.0)))
    duration = max(0.1, float(args.get("duration_seconds", 10.0)))
    section.set_range_seconds(start, start + duration)
    _save_asset(SEQUENCE_PATH, [])
    return {"track": bridge._jsonify(track), "section": bridge._jsonify(section), "sound": bridge._jsonify(sound)}


def _action_cinematic_effects_diagnostics(args: Dict[str, Any]):
    effects = []
    for key, (template, dest, label) in FX_SYSTEMS.items():
        actor = _find_actor(label)
        system = unreal.load_asset(dest)
        effects.append({"key": key, "label": label, "actor_exists": bool(actor), "hidden_in_game": bool(actor.is_hidden()) if actor else None, "system_exists": bool(system), "template": template})
    return {
        "effects": effects,
        "materials": {
            "core_pulse": bool(unreal.load_asset(f"{ROOT}/Materials/M_AuralithFX_ObsidianCorePulse.M_AuralithFX_ObsidianCorePulse")),
            "gold_pulse": bool(unreal.load_asset(f"{ROOT}/Materials/M_AuralithFX_GoldPulse.M_AuralithFX_GoldPulse")),
            "blue_pulse": bool(unreal.load_asset(f"{ROOT}/Materials/M_AuralithFX_BluePulse.M_AuralithFX_BluePulse")),
        },
        "look_locked": bool(_find_actor("AuralithFX_PostProcess")),
        "effect_lights": [bool(_find_actor("AuralithFX_GoldPulseLight")), bool(_find_actor("AuralithFX_BluePulseLight"))],
    }


def _action_cinematic_stage_diagnostics(args: Dict[str, Any]):
    sequence = unreal.load_asset(SEQUENCE_PATH)
    if not sequence:
        raise ValueError("Production Level Sequence not found")
    cuts = []
    for track in sequence.get_tracks():
        if isinstance(track, unreal.MovieSceneCameraCutTrack):
            for section in track.get_sections():
                cuts.append({"start": int(section.get_start_frame()), "end": int(section.get_end_frame()), "active": bool(section.is_active()), "binding": str(section.get_camera_binding_id())})
    actors = []
    for actor in bridge._all_actors():
        try:
            label = str(actor.get_actor_label())
            if label.startswith(("AuralithProduction_", "AuralithCine_", "AuralithTest_", "AuralithFX_")):
                actors.append({"label": label, "class": actor.get_class().get_path_name(), "location": bridge._jsonify(actor.get_actor_location())})
        except Exception:
            pass
    return {"playback_start": int(sequence.get_playback_start()), "playback_end": int(sequence.get_playback_end()), "camera_cuts": cuts, "actors": actors, "effects": _action_cinematic_effects_diagnostics({})}


def _action_cinematic_build_major_stage(args: Dict[str, Any]):
    return {
        "environment": _action_cinematic_expand_environment(args),
        "multicam": _action_cinematic_build_multicam(args),
        "lighting": _action_cinematic_animate_lighting(args),
        "look": _action_cinematic_lock_look(args),
        "atmosphere": _action_cinematic_configure_atmosphere(args),
        "niagara": _action_cinematic_spawn_niagara(args),
        "diagnostics": _action_cinematic_stage_diagnostics(args),
    }


def _action_cinematic_prepare_effect_production(args: Dict[str, Any]):
    return {
        "environment": _action_cinematic_expand_environment({"rebuild_materials": True}),
        "multicam": _action_cinematic_build_multicam(args),
        "lighting": _action_cinematic_animate_lighting(args),
        "look": _action_cinematic_lock_look(args),
        "atmosphere": _action_cinematic_configure_atmosphere(args),
        "library": _action_cinematic_create_effect_library(args),
        "polish": _action_cinematic_polish_effect_showcase(args),
        "diagnostics": _action_cinematic_stage_diagnostics(args),
    }


_ACTIONS = {
    "cinematic_stage_capabilities": _action_cinematic_stage_capabilities,
    "cinematic_expand_environment": _action_cinematic_expand_environment,
    "cinematic_build_multicam": _action_cinematic_build_multicam,
    "cinematic_animate_lighting": _action_cinematic_animate_lighting,
    "cinematic_lock_look": _action_cinematic_lock_look,
    "cinematic_configure_atmosphere": _action_cinematic_configure_atmosphere,
    "cinematic_spawn_niagara": _action_cinematic_spawn_niagara,
    "cinematic_create_effect_library": _action_cinematic_create_effect_library,
    "cinematic_polish_effect_showcase": _action_cinematic_polish_effect_showcase,
    "cinematic_add_audio_track": _action_cinematic_add_audio_track,
    "cinematic_effects_diagnostics": _action_cinematic_effects_diagnostics,
    "cinematic_stage_diagnostics": _action_cinematic_stage_diagnostics,
    "cinematic_build_major_stage": _action_cinematic_build_major_stage,
    "cinematic_prepare_effect_production": _action_cinematic_prepare_effect_production,
}

bridge._ACTIONS.update(_ACTIONS)
bridge._log(f"Cinematic/effects v3 controls registered: {', '.join(sorted(_ACTIONS))}")
