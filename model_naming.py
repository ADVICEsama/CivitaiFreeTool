"""Shared download / rename formatting. Does not rename or move any files itself."""
import os


def version_name(info):
    version = info.get('version') or {}
    return str(version.get('name') or info.get('versionName') or info.get('version_name') or '') if isinstance(version, dict) else str(version)


def append_version(base, version, enabled):
    from model_manager import sanitize_filename
    version = str(version or '').strip()
    if not enabled or not version: return base
    version = sanitize_filename(version)
    if base.casefold().endswith(('-'+version).casefold()): return base
    if base.casefold().endswith((' '+version).casefold()): base=base[:-(len(version)+1)].rstrip()
    return base+'-'+version


def download_name(cfg, file, model_name, version, multi=False):
    from model_manager import sanitize_filename, clean_model_name
    import translator
    source = str(file.get('name') or '')
    raw, extension = os.path.splitext(source)
    mode = cfg.get('download_name_mode') or ('chinese' if cfg.get('translate_filename') else 'original')
    base = model_name if mode in ('civitai','chinese') and model_name else raw
    if mode == 'chinese' and base and not translator._is_cjk(base):
        try:
            translated = translator.translate(base, appid=(cfg.get('baidu_appid') or '').strip(), key=(cfg.get('baidu_key') or '').strip())
            if translated: base = translated
        except Exception: pass  # Keep the Civitai name if translation is unavailable.
    base=clean_model_name(sanitize_filename(base),cfg.get('rename_clean_rules')) or sanitize_filename(raw) or 'model'
    if multi and mode != 'original':
        details=file.get('metadata') or {}
        variant='-'.join(str(details.get(k) or '') for k in ('format','fp','size')).strip('-')
        # Preserve distinct quantizations even when all use the same model name.
        base+='-'+(sanitize_filename(variant)+'-' if variant else '')+'file-'+str(file.get('id') if file.get('id') is not None else sanitize_filename(raw))
    base=append_version(base,version,cfg.get('filename_include_version') is True)
    return base+(extension or '.safetensors')
