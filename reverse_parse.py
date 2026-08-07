# -*- coding: utf-8 -*-
"""反向解析：按文件 SHA256 通过 Civitai 官方 API 反查模型信息，生成 civitai.info.json"""
import json
import os
import re
import time

import civitai_api
import model_manager

import translator

_HTML_TAG_RE = re.compile(r"<[^>]+>")


def strip_html(text):
    """去掉 HTML 标签与常见实体，压缩空白（用于 SD json 的可读描述）"""
    if not text:
        return ""
    text = _HTML_TAG_RE.sub(" ", str(text))
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
                 ("&quot;", '"'), ("&#39;", "'"), ("&#x27;", "'")):
        text = text.replace(a, b)
    return re.sub(r"\s+", " ", text).strip()


def reverse_by_hash(file_path, api, cfg, progress_cb=None, translate_desc=False, cancel_ev=None):
    """核心：计算 SHA256 -> by-hash 反查 -> 组装完整信息。
    返回 dict: {file, sha256, model, version, info_path, translated}
    找不到时 model/version 为 None；cancel_ev 置位时中断哈希计算返回 error=已取消"""
    result = {
        "file": file_path,
        "sha256": None,
        "model": None,
        "version": None,
        "info_path": None,
        "found": False,
        "error": "",
    }
    # 1. 计算哈希（支持中断）
    sha = model_manager.compute_sha256(file_path, progress_cb=progress_cb, cancel_ev=cancel_ev)
    if not sha:
        if cancel_ev is not None and cancel_ev.is_set():
            result["error"] = "已取消"
        else:
            result["error"] = "哈希计算失败"
        return result
    result["sha256"] = sha

    # 2. 反查
    try:
        version = api.get_model_version_by_hash(sha)
    except civitai_api.CivitaiError as e:
        if "404" in str(e):
            result["error"] = "Civitai 未收录此哈希（文件可能不完整、已损坏或被修改）"
        else:
            result["error"] = str(e)
        return result
    result["version"] = version
    result["found"] = True

    # 3. 拿模型详情
    model = None
    if version.get("modelId"):
        try:
            model = api.get_model(version["modelId"])
        except civitai_api.CivitaiError:
            model = None
    result["model"] = model

    # 4. 生成 civitai.info.json（C 站标准格式）
    site_d = ((cfg or {}).get("site_domain", "civitai.red") or "civitai.red").strip("/")
    site_base = site_d if "://" in site_d else "https://" + site_d
    info = build_info(model, version, site_base)
    if info:
        out_path = write_info(file_path, info)
        result["info_path"] = out_path
        if translate_desc and info.get("description"):
            translated = translator.translate(
                info["description"],
                appid=((cfg or {}).get("baidu_appid") or "").strip(),
                key=((cfg or {}).get("baidu_key") or "").strip())
            if translated and translated != info["description"]:
                try:
                    with open(out_path, "r", encoding="utf-8") as f:
                        d = json.load(f)
                    d["description_translated"] = translated
                    with open(out_path, "w", encoding="utf-8") as f:
                        json.dump(d, f, ensure_ascii=False, indent=2)
                    result["translated"] = True
                except Exception:
                    pass
    return result


def build_info(model, version, site_base="https://civitai.red"):
    """组装 civitai.info 格式（兼容 C 站下载目录的 .info 结构）"""
    info = {}
    if model:
        info["id"] = model.get("id")
        info["modelId"] = model.get("id")
        info["name"] = model.get("name") or ""
        info["type"] = model.get("type") or ""
        info["nsfw"] = model.get("nsfw", False)
        info["tags"] = model.get("tags") or []
        info["creator"] = (model.get("creator") or {}).get("username", "")
        info["description"] = model.get("description") or ""
        info["url"] = "%s/models/%s" % (site_base, model.get("id"))
        stats = model.get("stats") or {}
        info["stats"] = {
            "downloadCount": stats.get("downloadCount"),
            "favoriteCount": stats.get("favoriteCount"),
            "commentCount": stats.get("commentCount"),
            "rating": stats.get("rating"),
            "ratingCount": stats.get("ratingCount"),
        }
    if version:
        info["versionId"] = version.get("id")
        info["baseModel"] = version.get("baseModel") or ""
        info["trainedWords"] = version.get("trainedWords") or []
        info["version"] = {
            "id": version.get("id"),
            "name": version.get("name") or "",
            "baseModel": version.get("baseModel") or "",
            "publishedAt": version.get("publishedAt") or "",
            "createdAt": version.get("createdAt") or "",
            "updatedAt": version.get("updatedAt") or "",
            "description": version.get("description") or "",
        }
        files = []
        for f in version.get("files") or []:
            files.append({
                "name": f.get("name"),
                "sizeKB": f.get("sizeKB"),
                "type": f.get("type"),
                "format": f.get("metadata", {}).get("format") if isinstance(f.get("metadata"), dict) else None,
                "fp": (f.get("metadata") or {}).get("fp") if isinstance(f.get("metadata"), dict) else None,
                "hashes": f.get("hashes") or {},
                "downloadUrl": f.get("downloadUrl"),
            })
        info["files"] = files
        images = []
        if version.get("images"):
            for img in version["images"][:5]:
                images.append({
                    "url": img.get("url"),
                    "width": img.get("width"),
                    "height": img.get("height"),
                    "nsfw": img.get("nsfw"),
                })
        info["images"] = images
    return info


def build_sd_metadata(model, version, site_base="https://civitai.red"):
    """把 C 站 info 转成 SD WebUI 生态易读的扁平结构（<模型名>.json / metadata.json）"""
    m = model or {}
    v = version or {}
    stats = m.get("stats") or {}
    files = v.get("files") or []
    file_name = ""
    for f in files:
        if f.get("primary") and f.get("type") != "Negative":
            file_name = f.get("name") or ""
            break
    if not file_name and files:
        file_name = files[0].get("name") or ""
    tw = v.get("trainedWords") or []
    return {
        "name": m.get("name") or v.get("name") or "",
        "model_id": m.get("id"),
        "version_id": v.get("id"),
        "version": v.get("name") or "",
        "type": m.get("type") or "",
        "base_model": v.get("baseModel") or "",
        "trained_words": tw,
        "trigger_words": tw,
        "activation_text": ", ".join(tw) if tw else "",
        "activation text": ", ".join(tw) if tw else "",  # Forge/A1111 卡片读取的标准字段名（带空格）
        "tags": m.get("tags") or [],
        "author": (m.get("creator") or {}).get("username", ""),
        "description": strip_html(m.get("description") or ""),
        "url": "%s/models/%s" % (site_base, m.get("id")) if m.get("id") else "",
        "nsfw": bool(m.get("nsfw")),
        "stats": {
            "download_count": stats.get("downloadCount"),
            "favorite_count": stats.get("favoriteCount"),
            "rating": stats.get("rating"),
            "rating_count": stats.get("ratingCount"),
        },
        "file_name": file_name,
        "hashes": (files[0].get("hashes") or {}) if files else {},
        "format": (files[0].get("metadata") or {}).get("format") if files else None,
        "preview": "{}.preview.png".format(os.path.splitext(file_name)[0]) if file_name else "",
    }


def info_to_sd_metadata(info):
    """从 civitai.info（合并结构，如反向解析/下载生成的 <名>.civitai.info）转 SD 扁平结构"""
    if not isinstance(info, dict):
        return None
    files = info.get("files") or []
    file = None
    for f in files:
        if isinstance(f, dict) and f.get("type") != "Negative":
            file = f
            break
    if file is None and files and isinstance(files[0], dict):
        file = files[0]
    file_name = (file or {}).get("name") or ""
    v = info.get("version")
    vname = v.get("name", "") if isinstance(v, dict) else (v or "")
    stats = info.get("stats") or {}
    tw = info.get("trainedWords") or info.get("trained_words") or info.get("trigger_words") or []
    return {
        "name": info.get("name") or "",
        "model_id": info.get("modelId") or info.get("model_id"),
        "version_id": info.get("versionId") or info.get("version_id"),
        "version": vname,
        "type": info.get("type") or "",
        "base_model": info.get("baseModel") or info.get("base_model") or "",
        "trained_words": tw,
        "trigger_words": tw,
        "activation_text": ", ".join(tw),
        "activation text": ", ".join(tw),  # Forge/A1111 标准字段
        "tags": info.get("tags") or [],
        "author": info.get("creator") or "",
        "description": strip_html(info.get("description") or ""),
        "description_zh": strip_html(info.get("description_translated") or "") or None,
        "url": info.get("url") or "",
        "nsfw": bool(info.get("nsfw")),
        "stats": {
            "download_count": stats.get("downloadCount") if stats else info.get("stats", {}).get("download_count"),
            "favorite_count": stats.get("favoriteCount") if stats else info.get("stats", {}).get("favorite_count"),
            "rating": stats.get("rating") if stats else info.get("stats", {}).get("rating"),
            "rating_count": stats.get("ratingCount") if stats else info.get("stats", {}).get("rating_count"),
        },
        "file_name": file_name,
        "hashes": (file or {}).get("hashes") or info.get("hashes") or {},
        "format": (file or {}).get("format") or ((file or {}).get("metadata") or {}).get("format") or info.get("format"),
        "preview": "{}.preview.png".format(os.path.splitext(file_name)[0]) if file_name else info.get("preview") or "",
    }


def write_info(model_path, info):
    """把 info 写到模型同目录：<模型名>.info.json；
    若已存在 <名>.civitai.info / civitai.info 则复用（不覆盖 sd 扁平 .json）"""
    base, _ = os.path.splitext(model_path)
    d = os.path.dirname(model_path)
    for cand in (base + ".info.json", base + ".civitai.info",
                 os.path.join(d, "civitai.info")):
        if os.path.exists(cand):
            out_path = cand
            break
    else:
        out_path = base + ".info.json"
    try:
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(info, f, ensure_ascii=False, indent=2)
        return out_path
    except Exception:
        return None
