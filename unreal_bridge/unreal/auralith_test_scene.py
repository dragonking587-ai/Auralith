"""Auralith reactive-effects lab for Unreal Engine.

This module intentionally replaces the old Studio scene generator.  It keeps the
Auralith Unreal bridge intact and turns the level into a minimal effects test bed.

Bridge actions:
    effects_reset_scene   - remove Auralith-generated Studio/test/effects actors
    effects_build_lab     - create the minimal effects lab + first three rigs
    effects_audio_frame   - push bass/low/mid/high/beat/transient/intensity values
    effects_status        - inspect the current effects-lab state
    build_test_scene      - backwards-compatible alias for effects_build_lab

Audio values are normalized 0..1.  The module registers a Slate post-tick callback
so effect motion remains continuous between bridge audio packets.
"""

from __future__ import annotations

import math
import time
from typing import Any, Dict

import unreal
import auralith_unreal_bridge as bridge
import auralith_production_controls as production

__version__ = "1.0.0"

ROOT = "/Game/AuralithProduction"
MATERIAL_ROOT = f"{ROOT}/Effects/Materials"
FX_FOLDER = "AuralithProduction/EffectsLab"
FX_TAG = "AuralithReactiveEffect"

# Known generated scene families from the previous Studio/test work.
_OLD_PREFIXES = (
    "AuralithStudio_",
    "AuralithProduction_",
    "AuralithCine_",
    "AuralithTest_",
)
_OLD_FOLDERS = (
    "AuralithProduction/Studio",
    "AuralithProduction/Test",
    "Auralith/GeneratedScene",
)

_CHANNELS = ("bass", "low", "mid", "high", "beat", "transient", "intensity")
_TARGET = {name: 0.0 for name in _CHANNELS}
_SMOOTH = {name: 0.0 for name in _CHANNELS}
_LAST_AUDIO_AT = 0.0
_PHASE = 0.0
_TICK_HANDLE = None
_RIGS: Dict[str, Any] = {
    "fire": [],
    "plasma": [],
    "electric": [],
    "lights": {},
    "base": [],
}


def _clamp01(value: Any) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except Exception:
        return 0.0


def _label(actor) -> str:
    try:
        return str(actor.get_actor_label())
    except Exception:
        return ""


def _folder(actor) -> str:
    try:
        return str(actor.get_folder_path())
    except Exception:
        return ""


def _actor_tags(actor) -> set[str]:
    try:
        return {str(tag) for tag in actor.tags}
    except Exception:
        try:
            return {str(tag) for tag in actor.get_editor_property("tags")}
        except Exception:
            return set()


def _set_tags(actor, *tags: str) -> None:
    values = [unreal.Name(str(tag)) for tag in tags if tag]
    try:
        actor.set_editor_property("tags", values)
    except Exception:
        pass


def _is_old_generated(actor) -> bool:
    label = _label(actor)
    folder = _folder(actor)
    tags = _actor_tags(actor)
    if FX_TAG in tags:
        return True
    if label.startswith(_OLD_PREFIXES):
        return True
    if label.startswith("AuralithFX_"):
        return True
    return any(folder.startswith(prefix) for prefix in _OLD_FOLDERS + (FX_FOLDER,))


def _destroy_actor(actor) -> bool:
    """Destroy one editor actor using the subsystem available in this UE build."""
    try:
        subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
        method = getattr(subsystem, "destroy_actor", None)
        if callable(method):
            return bool(method(actor))
    except Exception:
        pass
    try:
        method = getattr(unreal.EditorLevelLibrary, "destroy_actor", None)
        if callable(method):
            return bool(method(actor))
    except Exception:
        pass
    return False


def _find(label: str):
    try:
        return bridge._find_actor(label)
    except Exception:
        return None


def _mesh(name: str):
    asset = unreal.load_asset(f"/Engine/BasicShapes/{name}.{name}")
    if asset:
        return asset
    asset = unreal.load_asset("/Engine/BasicShapes/Cube.Cube")
    if asset:
        return asset
    raise RuntimeError("Unreal Engine basic shape meshes are unavailable")


def _spawn_mesh(
    label: str,
    mesh_name: str,
    location,
    scale=(1, 1, 1),
    rotation=(0, 0, 0),
    material=None,
):
    actor = production._spawn(
        unreal.StaticMeshActor,
        {
            "label": label,
            "location": location,
            "rotation": rotation,
            "scale": scale,
            "transient": False,
        },
    )
    try:
        actor.set_folder_path(FX_FOLDER)
    except Exception:
        pass
    _set_tags(actor, FX_TAG)
    component = actor.get_component_by_class(unreal.StaticMeshComponent)
    if not component:
        raise RuntimeError(f"StaticMeshComponent unavailable for {label}")
    component.set_static_mesh(_mesh(mesh_name))
    if material:
        component.set_material(0, material)
    return actor


def _create_material(name: str, base_rgb, emissive_rgb=None, roughness=0.55, metallic=0.0):
    """Create/rebuild a tiny persistent material using only stock UE material nodes."""
    material, _existed = production._create_asset(
        name,
        MATERIAL_ROOT,
        unreal.Material,
        unreal.MaterialFactoryNew,
        save=False,
    )
    warnings = []
    try:
        unreal.MaterialEditingLibrary.delete_all_material_expressions(material)

        base = unreal.MaterialEditingLibrary.create_material_expression(
            material, unreal.MaterialExpressionConstant3Vector, -650, -120
        )
        base.set_editor_property(
            "constant",
            unreal.LinearColor(float(base_rgb[0]), float(base_rgb[1]), float(base_rgb[2]), 1.0),
        )
        unreal.MaterialEditingLibrary.connect_material_property(
            base, "", unreal.MaterialProperty.MP_BASE_COLOR
        )

        rough = unreal.MaterialEditingLibrary.create_material_expression(
            material, unreal.MaterialExpressionConstant, -650, 40
        )
        rough.set_editor_property("r", float(roughness))
        unreal.MaterialEditingLibrary.connect_material_property(
            rough, "", unreal.MaterialProperty.MP_ROUGHNESS
        )

        metal = unreal.MaterialEditingLibrary.create_material_expression(
            material, unreal.MaterialExpressionConstant, -650, 150
        )
        metal.set_editor_property("r", float(metallic))
        unreal.MaterialEditingLibrary.connect_material_property(
            metal, "", unreal.MaterialProperty.MP_METALLIC
        )

        if emissive_rgb is not None:
            glow = unreal.MaterialEditingLibrary.create_material_expression(
                material, unreal.MaterialExpressionConstant3Vector, -650, 270
            )
            glow.set_editor_property(
                "constant",
                unreal.LinearColor(
                    float(emissive_rgb[0]),
                    float(emissive_rgb[1]),
                    float(emissive_rgb[2]),
                    1.0,
                ),
            )
            unreal.MaterialEditingLibrary.connect_material_property(
                glow, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR
            )

        unreal.MaterialEditingLibrary.layout_material_expressions(material)
        unreal.MaterialEditingLibrary.recompile_material(material)
        path = f"{MATERIAL_ROOT}/{name}.{name}"
        try:
            unreal.EditorAssetLibrary.save_asset(path, False)
        except Exception as exc:
            warnings.append(f"save {name}: {exc}")
    except Exception as exc:
        warnings.append(f"material {name}: {exc}")
    return material, warnings


def _spawn_point_light(label: str, location, intensity: float, radius: float, color):
    result = production._action_light_create(
        {
            "type": "point",
            "label": label,
            "location": location,
            "intensity": float(intensity),
            "attenuation_radius": float(radius),
            "color": {
                "r": float(color[0]),
                "g": float(color[1]),
                "b": float(color[2]),
                "a": 1.0,
            },
            "transient": False,
        }
    )
    actor = _find(label)
    if actor:
        try:
            actor.set_folder_path(FX_FOLDER)
        except Exception:
            pass
        _set_tags(actor, FX_TAG)
    return actor, list(result.get("warnings", []))


def _light_component(actor):
    if not actor:
        return None
    try:
        return production._light_component(actor)
    except Exception:
        return actor.get_component_by_class(unreal.PointLightComponent)


def _set_light(actor, intensity: float, radius: float | None = None) -> None:
    comp = _light_component(actor)
    if not comp:
        return
    try:
        comp.set_intensity(max(0.0, float(intensity)))
    except Exception:
        try:
            comp.set_editor_property("intensity", max(0.0, float(intensity)))
        except Exception:
            pass
    if radius is not None:
        try:
            comp.set_editor_property("attenuation_radius", max(1.0, float(radius)))
        except Exception:
            pass


def _set_transform(actor, location=None, scale=None, rotation=None) -> None:
    if not actor:
        return
    try:
        if location is not None:
            actor.set_actor_location(bridge._vector(location), False, False)
        if rotation is not None:
            actor.set_actor_rotation(bridge._rotator(rotation), False)
        if scale is not None:
            actor.set_actor_scale3d(bridge._vector(scale))
    except Exception:
        pass


def _build_fire(material, warnings: list[str]) -> list[Any]:
    """Layered flame-lobe prototype driven mostly by bass/low/beat."""
    actors = []
    origin_x = -420.0
    specs = [
        (-48, 0.85, 1.45),
        (-24, 0.72, 1.85),
        (0, 1.00, 2.30),
        (24, 0.74, 1.75),
        (48, 0.82, 1.35),
        (-10, 0.55, 2.65),
        (18, 0.48, 2.45),
    ]
    for i, (xoff, width, height) in enumerate(specs):
        actor = _spawn_mesh(
            f"AuralithFX_Fire_{i:02d}",
            "Cone",
            (origin_x + xoff, 0.0, 75.0 + 22.0 * (i % 3)),
            (0.55 * width, 0.55 * width, height),
            material=material,
        )
        actors.append(actor)
    light, light_warnings = _spawn_point_light(
        "AuralithFX_FireLight", (origin_x, -20.0, 145.0), 4200.0, 650.0, (1.0, 0.18, 0.015)
    )
    warnings.extend(light_warnings)
    _RIGS["lights"]["fire"] = light
    return actors


def _build_plasma(material, warnings: list[str]) -> list[Any]:
    """Energy core + orbiting satellites, driven by mids/intensity/highs."""
    actors = []
    core = _spawn_mesh(
        "AuralithFX_Plasma_Core",
        "Sphere",
        (0.0, 0.0, 155.0),
        (1.15, 1.15, 1.15),
        material=material,
    )
    actors.append(core)
    for i in range(6):
        angle = i * math.tau / 6.0
        satellite = _spawn_mesh(
            f"AuralithFX_Plasma_Orb_{i:02d}",
            "Sphere",
            (math.cos(angle) * 125.0, math.sin(angle) * 125.0, 155.0),
            (0.22, 0.22, 0.22),
            material=material,
        )
        actors.append(satellite)
    light, light_warnings = _spawn_point_light(
        "AuralithFX_PlasmaLight", (0.0, 0.0, 155.0), 3600.0, 750.0, (0.25, 0.035, 1.0)
    )
    warnings.extend(light_warnings)
    _RIGS["lights"]["plasma"] = light
    return actors


def _build_electric(material, warnings: list[str]) -> list[Any]:
    """Segmented bolt path prototype, driven by high/transient/beat."""
    actors = []
    origin_x = 420.0
    count = 13
    for i in range(count):
        t = i / max(1, count - 1)
        actor = _spawn_mesh(
            f"AuralithFX_Electric_{i:02d}",
            "Sphere",
            (origin_x - 150.0 + t * 300.0, 0.0, 125.0),
            (0.12, 0.12, 0.12),
            material=material,
        )
        actors.append(actor)
    light, light_warnings = _spawn_point_light(
        "AuralithFX_ElectricLight", (origin_x, 0.0, 140.0), 2800.0, 650.0, (0.18, 0.55, 1.0)
    )
    warnings.extend(light_warnings)
    _RIGS["lights"]["electric"] = light
    return actors


def _discover_rigs() -> None:
    """Rebuild Python references after a module reload without changing the level."""
    _RIGS["fire"] = []
    _RIGS["plasma"] = []
    _RIGS["electric"] = []
    _RIGS["base"] = []
    _RIGS["lights"] = {}
    for actor in bridge._all_actors():
        label = _label(actor)
        if label.startswith("AuralithFX_Fire_"):
            _RIGS["fire"].append(actor)
        elif label.startswith("AuralithFX_Plasma_"):
            _RIGS["plasma"].append(actor)
        elif label.startswith("AuralithFX_Electric_"):
            _RIGS["electric"].append(actor)
        elif label.startswith("AuralithFX_BaseFloor"):
            _RIGS["base"].append(actor)
        elif label == "AuralithFX_FireLight":
            _RIGS["lights"]["fire"] = actor
        elif label == "AuralithFX_PlasmaLight":
            _RIGS["lights"]["plasma"] = actor
        elif label == "AuralithFX_ElectricLight":
            _RIGS["lights"]["electric"] = actor
        elif label == "AuralithFX_BaseFill":
            _RIGS["lights"]["fill"] = actor


def _ensure_tick() -> None:
    global _TICK_HANDLE
    if _TICK_HANDLE is not None:
        return
    _TICK_HANDLE = unreal.register_slate_post_tick_callback(_tick)


def _stop_tick() -> None:
    global _TICK_HANDLE
    if _TICK_HANDLE is None:
        return
    try:
        unreal.unregister_slate_post_tick_callback(_TICK_HANDLE)
    except Exception:
        pass
    _TICK_HANDLE = None


def _animate_fire(phase: float) -> None:
    bass = _SMOOTH["bass"]
    low = _SMOOTH["low"]
    beat = _SMOOTH["beat"]
    transient = _SMOOTH["transient"]
    for i, actor in enumerate(_RIGS["fire"]):
        base_x = -420.0 + (i - 3) * 22.0
        local_phase = phase * (1.8 + i * 0.07) + i * 0.93
        sway = math.sin(local_phase) * (8.0 + 30.0 * low)
        curl = math.sin(local_phase * 0.57 + i) * (5.0 + 22.0 * bass)
        height = 1.0 + 1.25 * bass + 0.55 * beat + 0.35 * transient
        width = 0.42 + 0.18 * low + 0.06 * math.sin(local_phase * 1.7)
        _set_transform(
            actor,
            location=(base_x + curl, sway, 80.0 + (i % 3) * 18.0 + 20.0 * bass),
            scale=(width, width * 0.88, (1.15 + 0.15 * (i % 4)) * height),
            rotation=(0.0, 6.0 * math.sin(local_phase), 8.0 * math.sin(local_phase * 0.73)),
        )
    _set_light(
        _RIGS["lights"].get("fire"),
        1800.0 + 7600.0 * bass + 4200.0 * beat + 2600.0 * transient,
        500.0 + 350.0 * low,
    )


def _animate_plasma(phase: float) -> None:
    mid = _SMOOTH["mid"]
    high = _SMOOTH["high"]
    beat = _SMOOTH["beat"]
    intensity = _SMOOTH["intensity"]
    actors = _RIGS["plasma"]
    if actors:
        core = next((a for a in actors if _label(a) == "AuralithFX_Plasma_Core"), None)
        pulse = 0.82 + 0.58 * mid + 0.36 * beat + 0.20 * math.sin(phase * 2.4)
        _set_transform(core, location=(0.0, 0.0, 155.0), scale=(pulse, pulse, pulse))
        orbs = [a for a in actors if "_Orb_" in _label(a)]
        radius = 105.0 + 85.0 * intensity
        for i, actor in enumerate(orbs):
            angle = phase * (0.55 + high * 1.6) + i * math.tau / max(1, len(orbs))
            z = 155.0 + math.sin(angle * 1.7 + i) * (22.0 + 38.0 * mid)
            orb_scale = 0.13 + 0.23 * high + 0.14 * beat
            _set_transform(
                actor,
                location=(math.cos(angle) * radius, math.sin(angle) * radius, z),
                scale=(orb_scale, orb_scale, orb_scale),
            )
    _set_light(
        _RIGS["lights"].get("plasma"),
        1400.0 + 5200.0 * mid + 4600.0 * intensity + 2200.0 * beat,
        520.0 + 420.0 * intensity,
    )


def _animate_electric(phase: float) -> None:
    high = _SMOOTH["high"]
    transient = _SMOOTH["transient"]
    beat = _SMOOTH["beat"]
    actors = _RIGS["electric"]
    count = max(1, len(actors))
    for i, actor in enumerate(actors):
        t = i / max(1, count - 1)
        x = 420.0 - 150.0 + t * 300.0
        jitter = 14.0 + 70.0 * high + 85.0 * transient
        y = math.sin(phase * 7.4 + i * 1.83) * jitter
        z = 125.0 + math.sin(phase * 5.6 + i * 2.31) * jitter * 0.62
        flash = 0.08 + 0.16 * high + 0.22 * transient + 0.08 * beat
        _set_transform(actor, location=(x, y, z), scale=(flash, flash, flash))
    _set_light(
        _RIGS["lights"].get("electric"),
        900.0 + 4300.0 * high + 9000.0 * transient + 2800.0 * beat,
        420.0 + 380.0 * high,
    )


def _tick(delta_seconds: float) -> None:
    global _PHASE
    dt = max(1.0 / 240.0, min(0.1, float(delta_seconds or 0.0)))

    # Attack quickly and release more slowly to keep the motion organic.
    for name in _CHANNELS:
        target = _TARGET[name]
        current = _SMOOTH[name]
        attack = 0.035 if name not in ("beat", "transient") else 0.012
        release = 0.18 if name not in ("beat", "transient") else 0.095
        tau = attack if target > current else release
        alpha = 1.0 - math.exp(-dt / max(0.001, tau))
        _SMOOTH[name] = current + (target - current) * alpha

    # Beat/transient are impulses unless refreshed by the bridge.
    age = max(0.0, time.time() - _LAST_AUDIO_AT) if _LAST_AUDIO_AT else 999.0
    if age > 0.05:
        _TARGET["beat"] *= max(0.0, 1.0 - dt * 9.0)
        _TARGET["transient"] *= max(0.0, 1.0 - dt * 14.0)
    if age > 0.75:
        # Fail gracefully if audio packets stop: settle instead of freezing hot.
        for name in ("bass", "low", "mid", "high", "intensity"):
            _TARGET[name] *= max(0.0, 1.0 - dt * 2.5)

    speed = 0.9 + 1.4 * _SMOOTH["intensity"] + 0.8 * _SMOOTH["high"]
    _PHASE += dt * speed
    _animate_fire(_PHASE)
    _animate_plasma(_PHASE)
    _animate_electric(_PHASE)


def effects_reset_scene(args: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Remove old Auralith Studio/test/effects actors and leave unrelated actors alone."""
    args = dict(args or {})
    removed = []
    failed = []
    _stop_tick()
    actors = list(bridge._all_actors())
    for actor in actors:
        if not _is_old_generated(actor):
            continue
        label = _label(actor)
        if _destroy_actor(actor):
            removed.append(label)
        else:
            # If deletion isn't exposed by this editor build, hide the actor so the
            # effects lab still starts visually clean and report it explicitly.
            try:
                actor.set_actor_hidden_in_game(True)
                actor.set_is_temporarily_hidden_in_editor(True)
                failed.append(label)
            except Exception:
                failed.append(label)

    for key in ("fire", "plasma", "electric", "base"):
        _RIGS[key] = []
    _RIGS["lights"] = {}

    if bool(args.get("save", True)):
        try:
            subsystem = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
            save = getattr(subsystem, "save_current_level", None)
            if callable(save):
                save()
        except Exception:
            pass

    return {
        "removed_count": len(removed),
        "removed": removed,
        "hidden_fallback_count": len(failed),
        "hidden_fallback": failed,
        "preserved_unrelated_actors": True,
    }


def effects_build_lab(args: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Build a clean, minimal three-effect lab after removing the old Studio scene."""
    args = dict(args or {})
    reset = effects_reset_scene({"save": False}) if args.get("reset", True) else None
    warnings: list[str] = []

    floor_mat, mat_warnings = _create_material(
        "M_AuralithFX_Floor", (0.006, 0.008, 0.012), None, roughness=0.78, metallic=0.08
    )
    warnings.extend(mat_warnings)
    fire_mat, mat_warnings = _create_material(
        "M_AuralithFX_Fire", (0.22, 0.01, 0.0), (8.0, 0.26, 0.008), roughness=0.4
    )
    warnings.extend(mat_warnings)
    plasma_mat, mat_warnings = _create_material(
        "M_AuralithFX_Plasma", (0.035, 0.005, 0.16), (1.4, 0.05, 12.0), roughness=0.3
    )
    warnings.extend(mat_warnings)
    electric_mat, mat_warnings = _create_material(
        "M_AuralithFX_Electric", (0.005, 0.08, 0.24), (0.5, 4.0, 14.0), roughness=0.2
    )
    warnings.extend(mat_warnings)

    floor = _spawn_mesh(
        "AuralithFX_BaseFloor",
        "Cube",
        (0.0, 0.0, -25.0),
        (12.5, 7.5, 0.25),
        material=floor_mat,
    )
    _RIGS["base"] = [floor]

    _RIGS["fire"] = _build_fire(fire_mat, warnings)
    _RIGS["plasma"] = _build_plasma(plasma_mat, warnings)
    _RIGS["electric"] = _build_electric(electric_mat, warnings)

    # Low, neutral fill only; effect lights provide the reactive illumination.
    fill, fill_warnings = _spawn_point_light(
        "AuralithFX_BaseFill",
        (0.0, -350.0, 450.0),
        850.0,
        1800.0,
        (0.18, 0.20, 0.28),
    )
    warnings.extend(fill_warnings)
    _RIGS["lights"]["fill"] = fill

    for name in _CHANNELS:
        _TARGET[name] = 0.0
        _SMOOTH[name] = 0.0
    _ensure_tick()

    if bool(args.get("save", True)):
        try:
            subsystem = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
            save = getattr(subsystem, "save_current_level", None)
            if callable(save):
                save()
        except Exception as exc:
            warnings.append(f"save level: {exc}")

    return {
        "lab": "Auralith Reactive Effects Lab",
        "version": __version__,
        "reset": reset,
        "effects": {
            "fire": {"actors": len(_RIGS["fire"]), "driven_by": ["bass", "low", "beat", "transient"]},
            "plasma": {"actors": len(_RIGS["plasma"]), "driven_by": ["mid", "high", "intensity", "beat"]},
            "electric": {"actors": len(_RIGS["electric"]), "driven_by": ["high", "transient", "beat"]},
        },
        "bridge_audio_action": "effects_audio_frame",
        "warnings": warnings,
    }


def effects_audio_frame(args: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Accept one normalized audio-analysis frame from the Auralith bridge."""
    global _LAST_AUDIO_AT
    args = dict(args or {})
    # Accept both `low` and the common `lows` spelling without changing protocol.
    if "low" not in args and "lows" in args:
        args["low"] = args["lows"]
    for name in _CHANNELS:
        if name in args:
            _TARGET[name] = _clamp01(args[name])
    _LAST_AUDIO_AT = time.time()
    _ensure_tick()
    return {
        "accepted": True,
        "target": dict(_TARGET),
        "smoothed": dict(_SMOOTH),
        "effects": ["fire", "plasma", "electric"],
    }


def effects_status(args: Dict[str, Any] | None = None) -> Dict[str, Any]:
    _discover_rigs()
    return {
        "version": __version__,
        "tick_active": _TICK_HANDLE is not None,
        "target_audio": dict(_TARGET),
        "smoothed_audio": dict(_SMOOTH),
        "last_audio_age_seconds": None if not _LAST_AUDIO_AT else max(0.0, time.time() - _LAST_AUDIO_AT),
        "actors": {
            "fire": len(_RIGS["fire"]),
            "plasma": len(_RIGS["plasma"]),
            "electric": len(_RIGS["electric"]),
            "base": len(_RIGS["base"]),
        },
        "lights": sorted(_RIGS["lights"].keys()),
    }


# Backwards compatibility: anything still requesting the former "test scene" now
# receives the effects lab instead of resurrecting the Studio scene.
build_scene = effects_build_lab

bridge._ACTIONS["effects_reset_scene"] = effects_reset_scene
bridge._ACTIONS["effects_build_lab"] = effects_build_lab
bridge._ACTIONS["effects_audio_frame"] = effects_audio_frame
bridge._ACTIONS["effects_status"] = effects_status
bridge._ACTIONS["build_test_scene"] = effects_build_lab

# If the module is hot-reloaded while an effects lab already exists, reconnect
# references and resume its continuous animation without spawning duplicates.
_discover_rigs()
if _RIGS["fire"] or _RIGS["plasma"] or _RIGS["electric"]:
    _ensure_tick()

print(
    "[AuralithEffects] registered: effects_reset_scene, effects_build_lab, "
    "effects_audio_frame, effects_status (build_test_scene -> effects_build_lab)"
)
