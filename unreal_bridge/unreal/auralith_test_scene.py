"""Reference-studio builder for the Auralith Unreal bridge.

This module replaces the old throwaway test-scene builder with a production-oriented
studio builder based on the user's Obsidian Wolf / Auralith studio reference image.
It is intentionally non-destructive: old test/outdoor actors are hidden rather than
deleted, so the bridge can honor the local allow_delete=false safety policy while
still giving the studio a clean renderable stage.
"""

from __future__ import annotations

import math
from typing import Any, Dict

import unreal
import auralith_unreal_bridge as bridge
import auralith_production_controls as production

ROOT = "/Game/AuralithProduction"
STUDIO_ROOT = f"{ROOT}/Studio"
STUDIO_SEQUENCE = f"{ROOT}/Cinematics/AuralithStudio_Master.AuralithStudio_Master"
STUDIO_PREFIX = "AuralithStudio_"
CAMERA_LABEL = "AuralithStudio_Camera"
TARGET = (0.0, 250.0, 280.0)
PURPLE = (0.40, 0.035, 1.85)
VIOLET = (0.80, 0.08, 2.90)
SOFT_PURPLE = (0.20, 0.018, 0.80)


def _find(label: str):
    try:
        return bridge._find_actor(label)
    except Exception:
        return None


def _mesh(name: str):
    asset = unreal.load_asset(f"/Engine/BasicShapes/{name}.{name}")
    if asset:
        return asset
    if name != "Cube":
        return unreal.load_asset("/Engine/BasicShapes/Cube.Cube")
    raise RuntimeError("Engine basic Cube mesh is unavailable")


def _mesh_component(actor):
    component = actor.get_component_by_class(unreal.StaticMeshComponent)
    if not component:
        raise RuntimeError(f"StaticMeshComponent unavailable for {actor.get_actor_label()}")
    return component


def _ensure_actor(cls, label: str, location, rotation=(0, 0, 0), scale=(1, 1, 1), folder="AuralithProduction/Studio"):
    actor = _find(label)
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
        actor.set_actor_hidden_in_game(False)
    except Exception:
        pass
    try:
        actor.set_is_temporarily_hidden_in_editor(False)
    except Exception:
        pass
    try:
        actor.set_folder_path(folder)
    except Exception:
        pass
    return actor, created


def _set_mesh(actor, mesh, material=None):
    component = _mesh_component(actor)
    component.set_static_mesh(mesh)
    if material:
        component.set_material(0, material)
    return component


def _save_asset(path: str, warnings: list[str]):
    try:
        return bool(unreal.EditorAssetLibrary.save_asset(path, False))
    except Exception as exc:
        warnings.append(f"save {path}: {exc}")
        return False


def _constant(material, value, x, y):
    node = unreal.MaterialEditingLibrary.create_material_expression(material, unreal.MaterialExpressionConstant, x, y)
    node.set_editor_property("r", float(value))
    return node


def _color(material, rgb, x, y):
    node = unreal.MaterialEditingLibrary.create_material_expression(material, unreal.MaterialExpressionConstant3Vector, x, y)
    node.set_editor_property("constant", unreal.LinearColor(float(rgb[0]), float(rgb[1]), float(rgb[2]), 1.0))
    return node


def _ensure_material(name: str, base_rgb, metallic: float, roughness: float, emissive_rgb=None, rebuild=True):
    path = f"{ROOT}/Materials/{name}.{name}"
    material, existed = production._create_asset(name, f"{ROOT}/Materials", unreal.Material, unreal.MaterialFactoryNew, save=False)
    warnings = []
    if rebuild or not existed:
        try:
            unreal.MaterialEditingLibrary.delete_all_material_expressions(material)
            base = _color(material, base_rgb, -700, -120)
            unreal.MaterialEditingLibrary.connect_material_property(base, "", unreal.MaterialProperty.MP_BASE_COLOR)
            metal = _constant(material, metallic, -700, 10)
            unreal.MaterialEditingLibrary.connect_material_property(metal, "", unreal.MaterialProperty.MP_METALLIC)
            rough = _constant(material, roughness, -700, 120)
            unreal.MaterialEditingLibrary.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)
            if emissive_rgb is not None:
                glow = _color(material, emissive_rgb, -700, 250)
                unreal.MaterialEditingLibrary.connect_material_property(glow, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
            unreal.MaterialEditingLibrary.layout_material_expressions(material)
            unreal.MaterialEditingLibrary.recompile_material(material)
        except Exception as exc:
            warnings.append(f"material {name}: {exc}")
    _save_asset(path, warnings)
    return material, path, warnings


def _look_rotation(location, target=TARGET):
    dx = float(target[0]) - float(location[0])
    dy = float(target[1]) - float(location[1])
    dz = float(target[2]) - float(location[2])
    horizontal = max(0.001, math.sqrt(dx * dx + dy * dy))
    yaw = math.degrees(math.atan2(dy, dx))
    pitch = math.degrees(math.atan2(dz, horizontal))
    # bridge._rotator positional order is roll, pitch, yaw.
    return (0.0, pitch, yaw)


def _hide_prior_scene():
    hidden = []
    keep = {CAMERA_LABEL}
    default_labels = {
        "DirectionalLight", "SkyAtmosphere", "SkyLight", "ExponentialHeightFog",
        "VolumetricCloud", "SM_SkySphere", "Floor",
    }
    for actor in bridge._all_actors():
        try:
            label = str(actor.get_actor_label())
            if label in keep or label.startswith(STUDIO_PREFIX):
                continue
            should_hide = label in default_labels or label.startswith(("AuralithProduction_", "AuralithCine_", "AuralithTest_", "AuralithFX_"))
            if not should_hide:
                continue
            try:
                actor.set_actor_hidden_in_game(True)
            except Exception:
                pass
            try:
                actor.set_is_temporarily_hidden_in_editor(True)
            except Exception:
                pass
            hidden.append(label)
        except Exception:
            pass
    return hidden


def _box(label, location, scale, material, rotation=(0, 0, 0), folder="AuralithProduction/Studio/Architecture"):
    actor, created = _ensure_actor(unreal.StaticMeshActor, label, location, rotation, scale, folder)
    _set_mesh(actor, _mesh("Cube"), material)
    return actor, created


def _cylinder(label, location, scale, material, rotation=(0, 0, 0), folder="AuralithProduction/Studio/Props"):
    actor, created = _ensure_actor(unreal.StaticMeshActor, label, location, rotation, scale, folder)
    _set_mesh(actor, _mesh("Cylinder"), material)
    return actor, created


def _cone(label, location, scale, material, rotation=(0, 0, 0), folder="AuralithProduction/Studio/Props"):
    actor, created = _ensure_actor(unreal.StaticMeshActor, label, location, rotation, scale, folder)
    _set_mesh(actor, _mesh("Cone"), material)
    return actor, created


def _text(label: str, text: str, location, world_size: float, color=(185, 95, 255, 255), rotation=(0, 0, -90), folder="AuralithProduction/Studio/Text"):
    actor, created = _ensure_actor(unreal.TextRenderActor, label, location, rotation, (1, 1, 1), folder)
    component = actor.get_component_by_class(unreal.TextRenderComponent)
    warnings = []
    if component:
        try:
            component.set_text(str(text))
        except Exception as exc:
            warnings.append(f"{label} text: {exc}")
        try:
            component.set_world_size(float(world_size))
        except Exception as exc:
            warnings.append(f"{label} size: {exc}")
        try:
            component.set_text_render_color(unreal.Color(int(color[0]), int(color[1]), int(color[2]), int(color[3])))
        except Exception as exc:
            warnings.append(f"{label} color: {exc}")
    return actor, created, warnings


def _screen_frame(prefix, center, width, height, black, screen, neon, title=None):
    x, y, z = center
    actors = []
    actors.append(_box(prefix + "_Outer", center, (width / 100.0, 0.16, height / 100.0), black)[0])
    actors.append(_box(prefix + "_Screen", (x, y - 12, z), ((width - 28) / 100.0, 0.035, (height - 28) / 100.0), screen)[0])
    t = 0.035
    actors.append(_box(prefix + "_BorderL", (x - width / 2 + 8, y - 17, z), (t, 0.025, height / 100.0), neon)[0])
    actors.append(_box(prefix + "_BorderR", (x + width / 2 - 8, y - 17, z), (t, 0.025, height / 100.0), neon)[0])
    actors.append(_box(prefix + "_BorderT", (x, y - 17, z + height / 2 - 8), (width / 100.0, 0.025, t), neon)[0])
    actors.append(_box(prefix + "_BorderB", (x, y - 17, z - height / 2 + 8), (width / 100.0, 0.025, t), neon)[0])
    if title:
        _text(prefix + "_Title", title, (x - width * 0.30, y - 24, z + height * 0.30), 22)
    return actors


def _waveform(prefix, center, width, count, material):
    x0, y, z0 = center
    created = []
    step = width / max(1, count - 1)
    for i in range(count):
        phase = i * 0.82
        height = 12.0 + 34.0 * (0.25 + 0.75 * abs(math.sin(phase) * math.cos(phase * 0.37)))
        x = x0 - width / 2 + i * step
        actor, was_created = _box(f"{prefix}_{i:02d}", (x, y, z0), (0.018, 0.018, height / 100.0), material, folder="AuralithProduction/Studio/Screens")
        if was_created:
            created.append(actor.get_actor_label())
    return created


def _crystal_cluster(prefix, origin, material, size=1.0):
    x, y, z = origin
    specs = [
        ((0, 0, 0), (0.22, 0.18, 0.90), (0, 0, 0)),
        ((-22, 3, -5), (0.16, 0.14, 0.62), (0, 8, -10)),
        ((24, -1, -8), (0.15, 0.13, 0.55), (0, -8, 12)),
        ((-38, 0, -12), (0.11, 0.10, 0.40), (0, 10, -18)),
        ((38, 2, -14), (0.10, 0.09, 0.34), (0, -12, 18)),
    ]
    labels = []
    for i, (offset, scale, rot) in enumerate(specs):
        actor, _ = _cone(
            f"{prefix}_{i}",
            (x + offset[0] * size, y + offset[1] * size, z + offset[2] * size),
            (scale[0] * size, scale[1] * size, scale[2] * size),
            material,
            rot,
            "AuralithProduction/Studio/Crystals",
        )
        labels.append(actor.get_actor_label())
    return labels


def _speaker(prefix, center, black, cone_mat):
    x, y, z = center
    _box(prefix + "_Cabinet", center, (1.15, 0.70, 1.75), black, folder="AuralithProduction/Studio/Audio")
    # Cylinders are rotated to face the camera along -Y.
    _cylinder(prefix + "_Woofer", (x, y - 41, z - 20), (0.58, 0.58, 0.15), cone_mat, (90, 0, 0), "AuralithProduction/Studio/Audio")
    _cylinder(prefix + "_Tweeter", (x, y - 41, z + 58), (0.22, 0.22, 0.12), cone_mat, (90, 0, 0), "AuralithProduction/Studio/Audio")


def _dj_deck(prefix, center, black, purple, screen):
    x, y, z = center
    _box(prefix + "_Body", center, (2.2, 1.25, 0.16), black, folder="AuralithProduction/Studio/DJ")
    _cylinder(prefix + "_Platter", (x, y - 5, z + 20), (0.78, 0.78, 0.08), black, folder="AuralithProduction/Studio/DJ")
    _cylinder(prefix + "_Ring", (x, y - 5, z + 29), (0.60, 0.60, 0.035), purple, folder="AuralithProduction/Studio/DJ")
    _box(prefix + "_Display", (x + 72, y - 52, z + 22), (0.52, 0.015, 0.30), screen, folder="AuralithProduction/Studio/DJ")
    for i in range(6):
        _cylinder(prefix + f"_Knob{i}", (x - 70 + i * 24, y - 38, z + 22), (0.07, 0.07, 0.07), purple, folder="AuralithProduction/Studio/DJ")


def _add_point_light(label, location, intensity, radius, color, warnings):
    actor = _find(label)
    if not actor:
        result = production._action_light_create({
            "type": "point", "label": label, "location": location,
            "intensity": intensity, "attenuation_radius": radius,
            "color": {"r": color[0], "g": color[1], "b": color[2], "a": 1.0},
            "transient": False,
        })
        actor = _find(label)
        warnings.extend(result.get("warnings", []))
    else:
        actor.set_actor_location(bridge._vector(location), False, False)
        try:
            comp = production._light_component(actor)
            comp.set_intensity(float(intensity))
            comp.set_editor_property("attenuation_radius", float(radius))
            try:
                comp.set_light_color(unreal.LinearColor(float(color[0]), float(color[1]), float(color[2]), 1.0), False)
            except TypeError:
                comp.set_light_color(unreal.LinearColor(float(color[0]), float(color[1]), float(color[2]), 1.0))
        except Exception as exc:
            warnings.append(f"{label}: {exc}")
    if actor:
        try:
            actor.set_actor_hidden_in_game(False)
            actor.set_is_temporarily_hidden_in_editor(False)
            actor.set_folder_path("AuralithProduction/Studio/Lights")
        except Exception:
            pass
    return actor


def _ensure_camera(warnings):
    camera, created = _ensure_actor(unreal.CineCameraActor, CAMERA_LABEL, (0, -1580, 390), _look_rotation((0, -1580, 390)), folder="AuralithProduction/Studio/Cameras")
    try:
        comp = production._camera_component(camera)
        comp.set_editor_property("current_focal_length", 36.0)
        comp.set_editor_property("current_aperture", 4.5)
        try:
            comp.set_aspect_ratio(16.0 / 9.0)
        except Exception:
            pass
    except Exception as exc:
        warnings.append(f"camera: {exc}")
    return camera, created


def _ensure_sequence(camera, warnings):
    sequence, existed = production._create_asset("AuralithStudio_Master", f"{ROOT}/Cinematics", unreal.LevelSequence, unreal.LevelSequenceFactoryNew, save=False)
    try:
        sequence.set_display_rate(production._frame_rate(24))
        sequence.set_playback_start(0)
        sequence.set_playback_end(240)
    except Exception as exc:
        warnings.append(f"sequence timing: {exc}")
    binding = None
    for item in sequence.get_bindings():
        try:
            if str(item.get_display_name()) == CAMERA_LABEL:
                binding = item
                break
        except Exception:
            pass
    if binding is None:
        binding = sequence.add_possessable(camera)
        try:
            binding.set_display_name(CAMERA_LABEL)
        except Exception:
            pass
    tracks = list(sequence.find_tracks_by_type(unreal.MovieSceneCameraCutTrack))
    track = tracks[0] if tracks else sequence.add_track(unreal.MovieSceneCameraCutTrack)
    sections = list(track.get_sections())
    section = sections[0] if sections else track.add_section()
    section.set_range(0, 240)
    try:
        section.set_is_active(True)
    except Exception:
        pass
    try:
        section.set_camera_binding_id(binding.get_id())
    except Exception:
        try:
            value = unreal.MovieSceneObjectBindingID()
            for prop in ("guid", "binding_id"):
                try:
                    value.set_editor_property(prop, binding.get_id())
                    break
                except Exception:
                    pass
            section.set_camera_binding_id(value)
        except Exception as exc:
            warnings.append(f"camera cut binding: {exc}")
    _save_asset(STUDIO_SEQUENCE, warnings)
    return sequence, existed


def _configure_postprocess(warnings):
    actor, created = _ensure_actor(unreal.PostProcessVolume, "AuralithStudio_PostProcess", (0, 0, 0), folder="AuralithProduction/Studio/LookDev")
    try:
        actor.set_editor_property("unbound", True)
        actor.set_editor_property("enabled", True)
        actor.set_editor_property("blend_weight", 1.0)
        settings = actor.get_editor_property("settings")
        pairs = [
            ("override_auto_exposure_apply_physical_camera_exposure", True),
            ("auto_exposure_apply_physical_camera_exposure", False),
            ("override_auto_exposure_bias", True), ("auto_exposure_bias", -0.55),
            ("override_auto_exposure_min_brightness", True), ("auto_exposure_min_brightness", 1.0),
            ("override_auto_exposure_max_brightness", True), ("auto_exposure_max_brightness", 1.0),
            ("override_bloom_intensity", True), ("bloom_intensity", 1.25),
            ("override_bloom_threshold", True), ("bloom_threshold", 0.8),
            ("override_motion_blur_amount", True), ("motion_blur_amount", 0.04),
            ("override_vignette_intensity", True), ("vignette_intensity", 0.22),
        ]
        for name, value in pairs:
            try:
                settings.set_editor_property(name, value)
            except Exception:
                pass
        actor.set_editor_property("settings", settings)
    except Exception as exc:
        warnings.append(f"postprocess: {exc}")
    return actor, created


def _action_studio_build_reference(args: Dict[str, Any]) -> Dict[str, Any]:
    warnings = []
    hidden = _hide_prior_scene()

    obsidian, obsidian_path, w = _ensure_material("M_AuralithStudio_Obsidian", (0.006, 0.004, 0.010), 0.78, 0.23, None, True)
    warnings.extend(w)
    black, black_path, w = _ensure_material("M_AuralithStudio_Black", (0.010, 0.008, 0.014), 0.28, 0.31, None, True)
    warnings.extend(w)
    wood, wood_path, w = _ensure_material("M_AuralithStudio_DarkWood", (0.028, 0.010, 0.017), 0.10, 0.42, None, True)
    warnings.extend(w)
    purple, purple_path, w = _ensure_material("M_AuralithStudio_PurpleNeon", (0.004, 0.001, 0.009), 0.12, 0.23, PURPLE, True)
    warnings.extend(w)
    violet, violet_path, w = _ensure_material("M_AuralithStudio_VioletNeon", (0.006, 0.001, 0.012), 0.08, 0.20, VIOLET, True)
    warnings.extend(w)
    screen, screen_path, w = _ensure_material("M_AuralithStudio_Screen", (0.002, 0.003, 0.010), 0.05, 0.30, (0.018, 0.010, 0.060), True)
    warnings.extend(w)
    crystal, crystal_path, w = _ensure_material("M_AuralithStudio_Crystal", (0.035, 0.006, 0.080), 0.18, 0.18, (0.55, 0.04, 1.90), True)
    warnings.extend(w)

    # Room shell: wide front-facing studio matching the reference proportions.
    _box("AuralithStudio_Floor", (0, 120, -10), (14.5, 10.0, 0.18), wood)
    _box("AuralithStudio_BackWall", (0, 665, 325), (14.5, 0.16, 6.7), obsidian)
    _box("AuralithStudio_LeftWall", (-720, 160, 325), (0.16, 10.0, 6.7), obsidian)
    _box("AuralithStudio_RightWall", (720, 160, 325), (0.16, 10.0, 6.7), obsidian)
    _box("AuralithStudio_Ceiling", (0, 170, 655), (14.5, 10.0, 0.16), black)

    # Ceiling galaxy recess and perimeter purple lighting.
    _box("AuralithStudio_CeilingGalaxy", (0, 210, 642), (8.8, 4.5, 0.035), screen)
    for label, loc, scale in [
        ("CeilGlowFront", (0, -250, 632), (9.2, 0.035, 0.035)),
        ("CeilGlowBack", (0, 640, 632), (9.2, 0.035, 0.035)),
        ("CeilGlowLeft", (-455, 195, 632), (0.035, 8.9, 0.035)),
        ("CeilGlowRight", (455, 195, 632), (0.035, 8.9, 0.035)),
    ]:
        _box("AuralithStudio_" + label, loc, scale, purple)
    star_points = [(-320, 80), (-250, 310), (-165, 180), (-80, 20), (20, 280), (95, 125), (180, 360), (260, 225), (335, 55), (-30, 430), (300, 430), (-360, 390)]
    for i, (sx, sy) in enumerate(star_points):
        _cylinder(f"AuralithStudio_CeilingStar_{i:02d}", (sx, sy, 628), (0.045 + (i % 3) * 0.018, 0.045 + (i % 3) * 0.018, 0.015), violet)

    # Side wall vertical neon strips.
    for x in (-690, -650, 650, 690):
        _box(f"AuralithStudio_WallStrip_{str(x).replace('-', 'L')}", (x, 110, 335), (0.035, 0.05, 5.0), purple)

    # Left and right large screens.
    _screen_frame("AuralithStudio_LeftScreen", (-500, 640, 410), 390, 270, black, screen, purple)
    _screen_frame("AuralithStudio_RightScreen", (500, 640, 410), 390, 270, black, screen, purple)
    _text("AuralithStudio_LeftScreenArtist", "OBSIDIAN WOLF", (-610, 610, 500), 22)
    _text("AuralithStudio_LeftNowPlaying", "NOW PLAYING", (-610, 610, 445), 13, (210, 180, 255, 255))
    _text("AuralithStudio_LeftTrack", "SHADOWS COLLIDE", (-610, 610, 415), 13, (210, 180, 255, 255))
    _text("AuralithStudio_RightTitle", "AURALITH", (420, 610, 505), 25)
    _waveform("AuralithStudio_LeftWave", (-500, 605, 335), 310, 28, purple)
    _waveform("AuralithStudio_RightWave", (500, 605, 340), 310, 28, purple)

    # Vertical Auralith banners between screens and central crest.
    for side, x, slogan in [("Left", -255, "HEAR.\nFEEL.\nBECOME."), ("Right", 255, "SOUND\nSHAPES\nREALITY.")]:
        _box(f"AuralithStudio_Banner{side}", (x, 638, 365), (1.65, 0.09, 4.1), black)
        _box(f"AuralithStudio_Banner{side}L", (x - 78, 626, 365), (0.025, 0.02, 4.0), purple)
        _box(f"AuralithStudio_Banner{side}R", (x + 78, 626, 365), (0.025, 0.02, 4.0), purple)
        _text(f"AuralithStudio_Banner{side}Title", "AURALITH", (x - 60, 610, 410), 18)
        _text(f"AuralithStudio_Banner{side}Slogan", slogan, (x - 55, 610, 335), 12, (190, 150, 255, 255))
        # simple crystal/diamond line emblem
        _box(f"AuralithStudio_Banner{side}DiamondA", (x, 610, 485), (0.025, 0.025, 0.55), purple, (0, 0, 28))
        _box(f"AuralithStudio_Banner{side}DiamondB", (x, 610, 485), (0.025, 0.025, 0.55), purple, (0, 0, -28))

    # Central faceted acoustic wall around the wolf crest.
    for row in range(5):
        for col in range(7):
            x = -210 + col * 70
            z = 250 + row * 72
            if abs(x) < 115 and 300 < z < 485:
                continue
            rot = (0, (row % 2) * 9 - 4, ((row + col) % 3 - 1) * 8)
            _box(f"AuralithStudio_Acoustic_{row}_{col}", (x, 635, z), (0.60, 0.08, 0.60), black, rot)

    # Wolf medallion: layered discs + geometric ears/muzzle/eyes.
    _cylinder("AuralithStudio_CrestOuter", (0, 618, 425), (2.05, 2.05, 0.10), purple, (90, 0, 0), "AuralithProduction/Studio/Crest")
    _cylinder("AuralithStudio_CrestInner", (0, 602, 425), (1.82, 1.82, 0.12), obsidian, (90, 0, 0), "AuralithProduction/Studio/Crest")
    _cone("AuralithStudio_WolfEarL", (-58, 588, 505), (0.38, 0.14, 0.80), black, (0, 8, -8), "AuralithProduction/Studio/Crest")
    _cone("AuralithStudio_WolfEarR", (58, 588, 505), (0.38, 0.14, 0.80), black, (0, -8, 8), "AuralithProduction/Studio/Crest")
    _box("AuralithStudio_WolfBrowL", (-38, 582, 450), (0.52, 0.08, 0.13), obsidian, (0, 0, -24), "AuralithProduction/Studio/Crest")
    _box("AuralithStudio_WolfBrowR", (38, 582, 450), (0.52, 0.08, 0.13), obsidian, (0, 0, 24), "AuralithProduction/Studio/Crest")
    _cone("AuralithStudio_WolfMuzzle", (0, 580, 390), (0.42, 0.15, 0.72), obsidian, (0, 0, 180), "AuralithProduction/Studio/Crest")
    _cylinder("AuralithStudio_WolfEyeL", (-34, 572, 444), (0.12, 0.12, 0.05), violet, (90, 0, 0), "AuralithProduction/Studio/Crest")
    _cylinder("AuralithStudio_WolfEyeR", (34, 572, 444), (0.12, 0.12, 0.05), violet, (90, 0, 0), "AuralithProduction/Studio/Crest")
    _text("AuralithStudio_CenterTitle", "OBSIDIAN WOLF", (-155, 575, 235), 31)

    # Shelves and crystal décor under the screens.
    for side, x in [("L", -500), ("R", 500)]:
        _box(f"AuralithStudio_Shelf_{side}", (x, 560, 175), (3.9, 1.0, 0.10), black)
        _crystal_cluster(f"AuralithStudio_CrystalShelf_{side}", (x + (-120 if side == 'L' else 120), 500, 195), crystal, 0.85)
    _crystal_cluster("AuralithStudio_CrystalFloorL", (-650, 160, 80), crystal, 1.20)
    _crystal_cluster("AuralithStudio_CrystalFloorR", (650, 160, 80), crystal, 1.20)
    _crystal_cluster("AuralithStudio_CrystalCenterL", (-185, 460, 160), crystal, 0.70)
    _crystal_cluster("AuralithStudio_CrystalCenterR", (185, 460, 160), crystal, 0.70)

    # Studio monitors.
    _speaker("AuralithStudio_SpeakerL", (-520, 500, 245), black, purple)
    _speaker("AuralithStudio_SpeakerR", (520, 500, 245), black, purple)

    # DJ workbench behind the front desk.
    _box("AuralithStudio_RearBench", (0, 390, 250), (9.0, 2.3, 0.16), black)
    _dj_deck("AuralithStudio_DeckL1", (-330, 350, 285), black, purple, screen)
    _dj_deck("AuralithStudio_DeckL2", (-110, 350, 285), black, purple, screen)
    _dj_deck("AuralithStudio_DeckR1", (110, 350, 285), black, purple, screen)
    _dj_deck("AuralithStudio_DeckR2", (330, 350, 285), black, purple, screen)

    # Chair silhouette.
    _box("AuralithStudio_ChairSeat", (0, 185, 230), (1.25, 1.05, 0.30), black, folder="AuralithProduction/Studio/Furniture")
    _box("AuralithStudio_ChairBack", (0, 235, 340), (1.50, 0.42, 2.15), black, (0, -8, 0), "AuralithProduction/Studio/Furniture")
    _text("AuralithStudio_ChairLogo", "OBSIDIAN WOLF", (-65, 190, 382), 9)

    # Front desk and branded fascia.
    _box("AuralithStudio_DeskBody", (0, 35, 150), (11.8, 2.0, 2.65), obsidian, folder="AuralithProduction/Studio/Furniture")
    _box("AuralithStudio_DeskTop", (0, 10, 290), (12.3, 2.5, 0.20), black, folder="AuralithProduction/Studio/Furniture")
    _box("AuralithStudio_DeskGlow", (0, -170, 278), (11.6, 0.035, 0.035), purple, folder="AuralithProduction/Studio/Furniture")
    _box("AuralithStudio_DeskScreen", (0, -170, 145), (8.2, 0.035, 1.85), screen, folder="AuralithProduction/Studio/Furniture")
    _text("AuralithStudio_DeskTitle", "OBSIDIAN WOLF", (-300, -185, 185), 43)
    _text("AuralithStudio_DeskURL", "https://loudman.live/artist/ObsidianWolf", (-310, -185, 105), 22, (205, 90, 255, 255))
    for side, x in [("L", -480), ("R", 480)]:
        _cylinder(f"AuralithStudio_DeskBadgeOuter{side}", (x, -188, 145), (0.92, 0.92, 0.07), purple, (90, 0, 0), "AuralithProduction/Studio/Furniture")
        _cylinder(f"AuralithStudio_DeskBadgeInner{side}", (x, -196, 145), (0.74, 0.74, 0.08), obsidian, (90, 0, 0), "AuralithProduction/Studio/Furniture")
        _cone(f"AuralithStudio_DeskBadgeWolf{side}", (x, -204, 145), (0.28, 0.12, 0.55), violet, (0, 0, 180), "AuralithProduction/Studio/Furniture")

    # Purple under-desk and shelf glows plus ceiling downlights.
    _box("AuralithStudio_UnderDeskGlow", (0, 5, 12), (11.8, 0.08, 0.035), purple)
    for x in (-520, -260, 0, 260, 520):
        _add_point_light(f"AuralithStudio_CeilingLight_{x}", (x, 160, 585), 420.0, 520.0, (0.48, 0.24, 0.72), warnings)
    _add_point_light("AuralithStudio_KeyPurple", (-280, -180, 360), 760.0, 900.0, (0.36, 0.08, 1.0), warnings)
    _add_point_light("AuralithStudio_FillPurple", (330, 90, 330), 540.0, 800.0, (0.18, 0.04, 0.78), warnings)
    _add_point_light("AuralithStudio_BackGlow", (0, 540, 360), 360.0, 650.0, (0.50, 0.03, 1.0), warnings)
    _add_point_light("AuralithStudio_DeskGlowLight", (0, -110, 90), 330.0, 650.0, (0.40, 0.02, 0.90), warnings)

    camera, camera_created = _ensure_camera(warnings)
    sequence, sequence_existed = _ensure_sequence(camera, warnings)
    post, post_created = _configure_postprocess(warnings)

    try:
        unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
    except Exception as exc:
        warnings.append(f"save level: {exc}")

    return {
        "scene": "Obsidian Wolf / Auralith reference studio v1",
        "reference_features": [
            "purple-black enclosed studio", "galaxy ceiling recess", "dual wall screens",
            "Auralith side banners", "central wolf medallion", "DJ bench and decks",
            "large branded front desk", "purple crystal decor", "studio monitors",
            "purple practical lighting and locked exposure",
        ],
        "hidden_prior_actor_count": len(hidden),
        "hidden_prior_actors": hidden,
        "camera": bridge._jsonify(camera),
        "camera_created": camera_created,
        "sequence": bridge._jsonify(sequence),
        "sequence_path": STUDIO_SEQUENCE,
        "sequence_existed": sequence_existed,
        "postprocess": bridge._jsonify(post),
        "postprocess_created": post_created,
        "materials": [obsidian_path, black_path, wood_path, purple_path, violet_path, screen_path, crystal_path],
        "saved_level": True,
        "warnings": warnings,
    }


def _action_studio_diagnostics(args: Dict[str, Any]) -> Dict[str, Any]:
    actors = []
    for actor in bridge._all_actors():
        try:
            label = str(actor.get_actor_label())
            if label.startswith(STUDIO_PREFIX):
                actors.append({
                    "label": label,
                    "class": actor.get_class().get_path_name(),
                    "location": bridge._jsonify(actor.get_actor_location()),
                })
        except Exception:
            pass
    sequence = unreal.load_asset(STUDIO_SEQUENCE)
    cuts = []
    if sequence:
        try:
            for track in sequence.get_tracks():
                if isinstance(track, unreal.MovieSceneCameraCutTrack):
                    for section in track.get_sections():
                        cuts.append({"start": int(section.get_start_frame()), "end": int(section.get_end_frame()), "active": bool(section.is_active()), "binding": str(section.get_camera_binding_id())})
        except Exception:
            pass
    return {
        "studio_actor_count": len(actors),
        "actors": actors,
        "sequence_exists": bool(sequence),
        "sequence_path": STUDIO_SEQUENCE,
        "camera_exists": bool(_find(CAMERA_LABEL)),
        "camera_cuts": cuts,
    }


def _action_studio_capabilities(args: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "bridge_extension": "reference-studio-v1",
        "supports": ["architecture", "materials", "text", "screens", "waveforms", "crystal_props", "speakers", "DJ_decks", "lighting", "camera", "sequence", "postprocess"],
        "non_destructive_clear": True,
        "sequence_path": STUDIO_SEQUENCE,
    }


# Remove the old throwaway test-scene entry points when this replacement module reloads.
bridge._ACTIONS.pop("scene_build_test", None)
bridge._ACTIONS.pop("scene_sequence_diagnostics", None)

_ACTIONS = {
    "studio_build_reference": _action_studio_build_reference,
    "studio_diagnostics": _action_studio_diagnostics,
    "studio_capabilities": _action_studio_capabilities,
}
bridge._ACTIONS.update(_ACTIONS)
bridge._log(f"Reference studio controls registered: {', '.join(sorted(_ACTIONS))}")
