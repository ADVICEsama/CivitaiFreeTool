"""Read-only folder visibility and model category filters; no filesystem mutation."""
import posixpath


def folder_key(path):
    if not isinstance(path, str):
        return ""
    parts = path.replace("\\", "/").strip("/").split("/")
    if any(p in (".", "..") or ":" in p for p in parts):
        return ""
    return "/".join(p for p in parts if p).lower()


def folder_choices(cfg):
    choices = {folder_key(p): False for p in (cfg.get("hidden_model_folders") or []) if folder_key(p)}
    overrides = cfg.get("model_folder_visibility") or {}
    if isinstance(overrides, dict):
        choices.update({folder_key(p): v for p, v in overrides.items()
                        if folder_key(p) and isinstance(v, bool)})
    return choices


def directory_visible(directory, choices, recursive=True):
    key = folder_key(directory)
    if not key:
        return True
    if not recursive:
        return choices.get(key, "/" not in key)
    while key:
        if key in choices:
            return choices[key]
        key = key.rpartition("/")[0]
    return True


def folder_visible(rel, cfg):
    directory = posixpath.dirname(str(rel).replace("\\", "/"))
    if not directory:
        return cfg.get("show_root_models", True) is not False
    return directory_visible(directory, folder_choices(cfg), cfg.get("model_folder_include_subfolders", True) is not False)


_TYPES = {
    "checkpoint": "Checkpoint", "diffusionmodel": "Checkpoint", "unet": "Checkpoint",
    "lora": "LORA", "locon": "LORA", "lycoris": "LORA", "loha": "LORA", "lokr": "LORA",
    "vae": "VAE", "controlnet": "Controlnet", "textualinversion": "TextualInversion",
    "embedding": "TextualInversion", "hypernetwork": "Hypernetwork", "upscaler": "Upscaler",
    "textencoder": "TextEncoder", "motionmodule": "MotionModule", "other": "Other",
}
_DIRS = {
    "checkpoints": "Checkpoint", "checkpoint": "Checkpoint", "stable-diffusion": "Checkpoint",
    "diffusion_models": "Checkpoint", "unet": "Checkpoint", "lora": "LORA", "loras": "LORA",
    "lycoris": "LORA", "vae": "VAE", "controlnet": "Controlnet", "controlnets": "Controlnet",
    "embeddings": "TextualInversion", "embedding": "TextualInversion",
    "hypernetwork": "Hypernetwork", "hypernetworks": "Hypernetwork",
    "upscale_models": "Upscaler", "esrgan": "Upscaler", "realesrgan": "Upscaler",
    "text_encoders": "TextEncoder", "clip": "TextEncoder", "motion_modules": "MotionModule",
}


def model_category(metadata_type, path):
    """Metadata takes precedence; otherwise use exact directory segments, never size/name guesses."""
    raw = str(metadata_type or "").strip()
    if raw:
        return _TYPES.get(raw.casefold().replace(" ", "").replace("_", "").replace("-", ""), "Other"), "metadata"
    for segment in reversed(str(path).replace("\\", "/").split("/")[:-1]):
        if segment.casefold() in _DIRS:
            return _DIRS[segment.casefold()], "directory"
    return "Unknown", "unknown"
