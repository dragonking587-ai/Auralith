"""Render-preview feedback for the Auralith Unreal Engine bridge.

V2 can build the transient MRQ job for the requested sequence/map before configuring
preview quality. This prevents a preview request from accidentally reusing an older
queue job. Render output remains scoped to the project's Saved/MovieRenders folder.
"""

from __future__ import annotations

from pathlib import Path
import time
from typing import Any, Dict, List

import unreal
import auralith_unreal_bridge as bridge


def _movie_renders_root() -> Path:
    try:
        saved = Path(str(unreal.Paths.project_saved_dir()))
    except Exception:
        saved = Path(str(unreal.Paths.project_dir())) / "Saved"
    return saved / "MovieRenders"


def _safe_subdir(value: str) -> str:
    raw = (value or "AuralithBridgePreview").strip().replace("\\", "/")
    parts = [part for part in raw.split("/") if part and part not in {".", ".."}]
    return "/".join(parts) or "AuralithBridgePreview"


def _queue():
    subsystem = unreal.get_editor_subsystem(unreal.MoviePipelineQueueSubsystem)
    return subsystem, subsystem.get_queue()


def _find_job(args: Dict[str, Any]):
    _subsystem, queue = _queue()
    jobs = list(queue.get_jobs())
    if not jobs:
        raise RuntimeError("Movie Render Queue has no jobs")
    requested_name = str(args.get("job_name", "")).strip()
    if requested_name:
        for job in jobs:
            try:
                if str(job.get_editor_property("job_name")) == requested_name:
                    return job
            except Exception:
                pass
        raise ValueError(f"Movie Render Queue job not found: {requested_name}")
    index = int(args.get("job_index", 0))
    if index < 0 or index >= len(jobs):
        raise IndexError(f"job_index {index} is outside the queue range 0..{len(jobs)-1}")
    return jobs[index]


def _ensure_preview_job(args: Dict[str, Any], warnings: List[str]):
    """Return the selected job, optionally replacing the transient queue.

    If sequence is supplied we intentionally create/configure a job for that exact
    sequence. clear_queue defaults to True in that mode so old preview jobs cannot
    leak into a new render.
    """
    sequence_path = str(args.get("sequence", "")).strip()
    map_path = str(args.get("map", "/Game/Main.Main")).strip() or "/Game/Main.Main"
    if not sequence_path:
        return _find_job(args)

    subsystem, queue = _queue()
    if subsystem.is_rendering():
        raise RuntimeError("Cannot replace Movie Render Queue while a render is active")

    clear_queue = bool(args.get("clear_queue", True))
    if clear_queue:
        try:
            queue.delete_all_jobs()
        except Exception as exc:
            warnings.append(f"clear queue: {exc}")

    jobs = list(queue.get_jobs())
    if jobs and not clear_queue:
        job = jobs[int(args.get("job_index", 0))]
    else:
        job = queue.allocate_new_job(unreal.MoviePipelineExecutorJob)

    job_name = str(args.get("name") or args.get("job_name") or "Auralith Preview")
    for prop, value in (
        ("job_name", job_name),
        ("sequence", unreal.SoftObjectPath(sequence_path)),
        ("map", unreal.SoftObjectPath(map_path)),
    ):
        try:
            job.set_editor_property(prop, value)
        except Exception as exc:
            warnings.append(f"job {prop}: {exc}")
    return job


def _set_property(target, name: str, value: Any, warnings: List[str]) -> None:
    try:
        target.set_editor_property(name, value)
    except Exception as exc:
        warnings.append(f"{name}: {exc}")


def _directory_path(path: Path):
    text = path.as_posix()
    try:
        return unreal.DirectoryPath(path=text)
    except Exception:
        value = unreal.DirectoryPath()
        try:
            value.set_editor_property("path", text)
        except Exception:
            try:
                value.path = text
            except Exception:
                pass
        return value


def _frame_rate(fps: int):
    try:
        return unreal.FrameRate(numerator=int(fps), denominator=1)
    except Exception:
        rate = unreal.FrameRate()
        rate.set_editor_property("numerator", int(fps))
        rate.set_editor_property("denominator", 1)
        return rate


def _action_render_feedback_capabilities(args: Dict[str, Any]) -> Dict[str, Any]:
    symbols = (
        "MoviePipelineOutputSetting",
        "MoviePipelineAntiAliasingSetting",
        "MoviePipelineImageSequenceOutput_PNG",
        "MoviePipelineDeferredPassBase",
        "MoviePipelineQueue",
    )
    return {
        "bridge_extension": "render-feedback-v2-job-aware",
        "movie_renders_root": _movie_renders_root().as_posix(),
        "available_symbols": {name: hasattr(unreal, name) for name in symbols},
        "registered_actions": ["render_feedback_capabilities", "render_prepare_preview", "render_preview_manifest"],
    }


def _action_render_prepare_preview(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create/select the requested MRQ job and configure predictable PNG output."""
    warnings: List[str] = []
    job = _ensure_preview_job(args, warnings)
    config = job.get_configuration()
    if not config:
        raise RuntimeError("Selected Movie Render Queue job has no configuration")

    width = max(64, int(args.get("width", args.get("resolution_x", 1920))))
    height = max(64, int(args.get("height", args.get("resolution_y", 1080))))
    fps = max(1, int(args.get("fps", 24)))
    spatial = max(1, int(args.get("spatial_samples", 1)))
    temporal = max(1, int(args.get("temporal_samples", 4)))
    subdir = _safe_subdir(str(args.get("output_subdir", "AuralithBridgePreview")))
    output_dir = _movie_renders_root() / Path(subdir)
    output_dir.mkdir(parents=True, exist_ok=True)
    settings: Dict[str, str] = {}

    try:
        output = config.find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)
        settings["output"] = output.get_class().get_path_name()
        _set_property(output, "output_directory", _directory_path(output_dir), warnings)
        _set_property(output, "output_resolution", unreal.IntPoint(width, height), warnings)
        _set_property(output, "file_name_format", "AuralithPreview_{frame_number}", warnings)
        _set_property(output, "override_existing_output", True, warnings)
        _set_property(output, "use_custom_frame_rate", True, warnings)
        _set_property(output, "output_frame_rate", _frame_rate(fps), warnings)
        if "frame_start" in args or "frame_end" in args:
            _set_property(output, "use_custom_playback_range", True, warnings)
            if "frame_start" in args:
                _set_property(output, "custom_start_frame", int(args["frame_start"]), warnings)
            if "frame_end" in args:
                _set_property(output, "custom_end_frame", int(args["frame_end"]), warnings)
    except Exception as exc:
        warnings.append(f"output setting: {exc}")

    try:
        aa = config.find_or_add_setting_by_class(unreal.MoviePipelineAntiAliasingSetting)
        settings["anti_aliasing"] = aa.get_class().get_path_name()
        _set_property(aa, "spatial_sample_count", spatial, warnings)
        _set_property(aa, "temporal_sample_count", temporal, warnings)
        _set_property(aa, "engine_warm_up_count", int(args.get("engine_warm_up_count", 8)), warnings)
        _set_property(aa, "render_warm_up_count", int(args.get("render_warm_up_count", 4)), warnings)
    except Exception as exc:
        warnings.append(f"anti-aliasing setting: {exc}")

    try:
        png = config.find_or_add_setting_by_class(unreal.MoviePipelineImageSequenceOutput_PNG)
        settings["png_output"] = png.get_class().get_path_name()
        _set_property(png, "write_alpha", False, warnings)
    except Exception as exc:
        warnings.append(f"PNG output setting: {exc}")

    try:
        deferred = config.find_or_add_setting_by_class(unreal.MoviePipelineDeferredPassBase)
        settings["deferred_pass"] = deferred.get_class().get_path_name()
        try:
            deferred.set_is_enabled(True)
        except Exception:
            pass
    except Exception as exc:
        warnings.append(f"deferred render pass: {exc}")

    try:
        config.initialize_transient_settings()
    except Exception:
        pass

    job_record = {"object": bridge._jsonify(job)}
    for prop in ("job_name", "sequence", "map"):
        try:
            job_record[prop] = bridge._jsonify(job.get_editor_property(prop))
        except Exception:
            pass

    return {
        "job": job_record,
        "output_directory": output_dir.as_posix(),
        "resolution": {"x": width, "y": height},
        "fps": fps,
        "spatial_samples": spatial,
        "temporal_samples": temporal,
        "settings": settings,
        "warnings": warnings,
    }


def _representative_files(files: List[Path], max_files: int) -> List[Path]:
    if len(files) <= max_files:
        return files
    if max_files <= 1:
        return [files[-1]]
    indexes = []
    for i in range(max_files):
        index = int(round(i * (len(files) - 1) / float(max_files - 1)))
        if index not in indexes:
            indexes.append(index)
    return [files[index] for index in indexes]


def _action_render_preview_manifest(args: Dict[str, Any]) -> Dict[str, Any]:
    root = _movie_renders_root()
    max_files = max(1, min(int(args.get("max_files", 3)), 8))
    since_epoch = float(args.get("since_epoch", 0.0) or 0.0)
    extensions = {".png", ".jpg", ".jpeg"}
    candidates: List[Path] = []
    if root.exists():
        for path in root.rglob("*"):
            try:
                if not path.is_file() or path.suffix.lower() not in extensions:
                    continue
                if since_epoch and path.stat().st_mtime < since_epoch:
                    continue
                candidates.append(path)
            except OSError:
                continue
    candidates.sort(key=lambda p: (p.stat().st_mtime, p.as_posix()))
    selected = _representative_files(candidates, max_files)
    artifacts = []
    for path in selected:
        stat = path.stat()
        artifacts.append({
            "local_path": str(path),
            "name": path.name,
            "size_bytes": stat.st_size,
            "modified_epoch": stat.st_mtime,
            "kind": "render_preview_image",
        })
    return {
        "movie_renders_root": root.as_posix(),
        "since_epoch": since_epoch,
        "candidate_count": len(candidates),
        "bridge_artifacts": artifacts,
        "generated_epoch": time.time(),
    }


_ACTIONS = {
    "render_feedback_capabilities": _action_render_feedback_capabilities,
    "render_prepare_preview": _action_render_prepare_preview,
    "render_preview_manifest": _action_render_preview_manifest,
}
bridge._ACTIONS.update(_ACTIONS)
bridge._log(f"Render feedback v2 registered: {', '.join(sorted(_ACTIONS))}")
