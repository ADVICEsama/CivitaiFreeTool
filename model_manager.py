# -*- coding: utf-8 -*-
"""模型管理核心：扫描、哈希、整理（改名/分类移动）、清理、更新检查、HTML 图例"""
import hashlib
import html as html_mod
import json
import os
import re
import shutil
import threading
import time

MODEL_EXTS = {".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".gguf", ".onnx"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
INFO_EXTS = {".json", ".txt", ".yaml", ".yml", ".md", ".html"}

# 附属文件（随模型改名/移动）统一列表
_SIDE_EXTS = (
    ".info.json", ".civitai.info", ".json", ".txt", ".yaml", ".yml", ".md", ".html",
    ".preview.png", ".preview.jpg", ".preview.jpeg", ".preview.webp", ".preview.gif",
    ".cover.jpg", ".cover.png", ".cover.jpeg", ".cover.webp",
    ".example.png", ".example.jpg", ".example.jpeg", ".example.webp", ".example.gif",
) + tuple(sorted(IMAGE_EXTS))

TYPE_DIRS = {
    "Checkpoint": "Checkpoint",
    "TextualInversion": "Embedding",
    "Hypernetwork": "Hypernetwork",
    "AestheticGradient": "Aesthetic",
    "LORA": "Lora",
    "LoRA": "Lora",
    "Controlnet": "Controlnet",
    "ControlNet": "Controlnet",
    "Poses": "Poses",
    "Wildcards": "Wildcards",
    "Workflows": "Workflows",
    "Other": "Other",
    "MotionModule": "Motion",
}
BASE_DIRS = {
    "SD 1.5": "SD1.5", "SD 2.0": "SD2.x", "SD 2.1": "SD2.x",
    "SDXL": "SDXL", "SDXL 1.0": "SDXL", "SD 3": "SD3",
    "FLUX.1 D": "FLUX", "FLUX.1 S": "FLUX", "FLUX.1 K": "FLUX",
    "Pony": "Pony", "Illustrious": "Illustrious", "NoobAI": "NoobAI",
    "Other": "Other",
}


def sanitize_filename(name):
    name = re.sub(r'[\\/:*?"<>|]', "_", name or "")
    name = name.strip().strip(".")
    return name[:180] or "model"


def find_cover(model_path):
    """查找模型封面图（本地优先）：<名>.cover.* / <名>.preview.png / 同名图片 / info.cover"""
    base, _ = os.path.splitext(model_path)
    for c in (base + ".cover.jpg", base + ".cover.png", base + ".cover.jpeg",
              base + ".cover.webp", base + ".preview.png", base + ".preview.jpg",
              base + ".jpg", base + ".png", base + ".jpeg", base + ".webp"):
        if os.path.exists(c):
            return c
    return None


def rename_to_civitai(model_path, meta, dry_run=False, log_cb=None):
    """同目录下把模型重命名为 C 站文件名（files 主文件 name，回退模型名），
    并同步改名附属文件（info/json/预览图/示例图/txt 等），返回 (新路径, 消息列表)。
    不移动目录，避免破坏 SD 的模型文件夹结构。"""
    msgs = []
    if not isinstance(meta, dict) or not meta:
        return model_path, ["无元数据，跳过: %s" % os.path.basename(model_path)]
    files = meta.get("files") or []
    # 优先 C 站模型名（meta.name，如 "Koikatsu Style"），files 名兜底
    # （files 名常是 @xxx 原始下载名，与本地名相同导致"重命名"无意义）
    new_base = (meta.get("name") or "").strip()
    if not new_base and files and isinstance(files[0], dict):
        for f in files:
            if f.get("primary") and f.get("type") != "Negative":
                new_base = (f.get("name") or "").strip()
                break
        if not new_base:
            new_base = (files[0].get("name") or "").strip()
    if not new_base:
        return model_path, ["无法确定 C 站文件名，跳过: %s" % os.path.basename(model_path)]
    new_base = sanitize_filename(new_base)

    src_base, ext = os.path.splitext(model_path)
    # 去掉 C 站文件名里可能重复的扩展名
    if new_base.lower().endswith(ext.lower()):
        new_base = new_base[: -len(ext)]
    dst_base = os.path.join(os.path.dirname(model_path), new_base)
    dst = dst_base + ext
    if os.path.normpath(dst) == os.path.normpath(model_path):
        return model_path, ["已是 C 站文件名: %s" % os.path.basename(model_path)]
    if os.path.exists(dst):
        return model_path, ["目标已存在，跳过: %s" % new_base + ext]
    if dry_run:
        return dst, ["将重命名: %s -> %s" % (os.path.basename(model_path), new_base + ext)]

    # 先改主文件：失败则附属文件保持原名，天然一致
    try:
        os.rename(model_path, dst)
    except OSError as e:
        return model_path, ["重命名失败: %s (%s)" % (new_base + ext, e)]
    msgs.append("已重命名: %s -> %s" % (os.path.basename(model_path), new_base + ext))

    # 附属文件同步改名（保持与模型同名，SD 预览图约定 <名>.preview.png）
    for se in _SIDE_EXTS:
        s = src_base + se
        if os.path.exists(s):
            try:
                os.rename(s, dst_base + se)
            except OSError as e:
                msgs.append("附属文件未改名（目标冲突或被占用）: %s (%s)" % (os.path.basename(s), e))
    return dst, msgs


def scan_models(root, progress_cb=None):
    """递归扫描模型目录，返回文件信息列表"""
    results = []
    if not root or not os.path.isdir(root):
        return results
    for dirpath, dirnames, filenames in os.walk(root, onerror=lambda e: None):
        # onerror: 忽略无权限/被占用等无法访问的子目录，避免中断整个扫描
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for fn in filenames:
            if os.path.splitext(fn)[1].lower() in MODEL_EXTS:
                full = os.path.join(dirpath, fn)
                try:
                    st = os.stat(full)
                except OSError:
                    continue
                results.append({
                    "path": full,
                    "rel": os.path.relpath(full, root),
                    "name": fn,
                    "size": st.st_size,
                    "mtime": st.st_mtime,
                })
                if progress_cb:
                    progress_cb(len(results))
    return results


def compute_sha256(path, progress_cb=None, cancel_ev=None):
    """计算文件 SHA256，进度回调 (已读字节, 总字节)"""
    h = hashlib.sha256()
    size = os.path.getsize(path)
    read = 0
    with open(path, "rb") as f:
        while True:
            if cancel_ev is not None and cancel_ev.is_set():
                return None
            b = f.read(1024 * 1024)
            if not b:
                break
            h.update(b)
            read += len(b)
            if progress_cb:
                progress_cb(read, size)
    return h.hexdigest()


def find_info_file(model_path):
    """查找模型同目录下的元数据文件，优先级：
    <名>.info.json / <名>.civitai.info / civitai.info / <名>.json（sd 扁平结构）"""
    base, _ = os.path.splitext(model_path)
    d = os.path.dirname(model_path)
    for cand in (base + ".info.json", base + ".civitai.info",
                 os.path.join(d, "civitai.info")):
        if os.path.exists(cand):
            return cand
    # sd 扁平结构 <名>.json：仅当内容含 model_id/version_id 时认定
    sd = base + ".json"
    if os.path.exists(sd):
        try:
            with open(sd, "r", encoding="utf-8") as f:
                d2 = json.load(f)
            if isinstance(d2, dict) and ("model_id" in d2 or "version_id" in d2):
                return sd
        except Exception:
            pass
    return None


def organize_model(model_path, models_root, dry_run=True, log_cb=None, rules=None):
    """整理单个模型：按自定义规则（关键词→文件夹）或 类型/基础模型 分类移动。
    rules: [{"folder": "文件夹名", "keywords": ["词1", ...]}]，匹配 tags/模型名/文件名（任一关键词）。
    返回 (new_path, messages)"""
    msgs = []
    info_path = find_info_file(model_path)
    meta = {}
    if info_path:
        try:
            with open(info_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except Exception:
            meta = {}
    model_name = (meta.get("name") or "").strip()
    model_type = (meta.get("type") or "Other").strip()
    base_model = (meta.get("baseModel") or meta.get("base_model") or "Other").strip()
    version_name = ""
    files = meta.get("files") or []
    if files and isinstance(files[0], dict):
        # 优先主文件，与下载 pick_file 逻辑一致
        chosen = None
        for f in files:
            if f.get("primary") and f.get("type") != "Negative":
                chosen = f
                break
        if chosen is None and files:
            chosen = files[0]
        version_name = (chosen or {}).get("name") or ""

    # 目标文件名：优先 C 站文件名
    new_name = sanitize_filename(version_name) if version_name else os.path.basename(model_path)
    if not new_name.lower().endswith(os.path.splitext(model_path)[1].lower()):
        new_name += os.path.splitext(model_path)[1].lower()

    # 目标目录：先匹配自定义规则（关键词命中 tags/模型名/文件名），未命中退回 类型/基础模型
    dest_dir = None
    if rules:
        hay = " ".join([model_name, os.path.basename(model_path)] +
                       [str(t) for t in (meta.get("tags") or [])]).lower()
        for rule in rules:
            folder = (rule.get("folder") or "").strip()
            kws = [k.strip().lower() for k in (rule.get("keywords") or []) if k and k.strip()]
            if not folder or not kws:
                continue
            if any(kw in hay for kw in kws):
                dest_dir = os.path.join(models_root, sanitize_filename(folder))
                msgs.append("规则匹配「%s」" % folder)
                break
    if dest_dir is None:
        tdir = TYPE_DIRS.get(model_type, "Other")
        bdir = BASE_DIRS.get(base_model, "Other")
        dest_dir = os.path.join(models_root, tdir, bdir)
    dest = os.path.join(dest_dir, new_name)

    if os.path.normpath(dest) == os.path.normpath(model_path):
        msgs.append("无需整理: %s" % os.path.basename(model_path))
        return model_path, msgs

    if os.path.exists(dest) and os.path.normpath(dest) != os.path.normpath(model_path):
        msgs.append("目标已存在，跳过: %s" % new_name)
        return model_path, msgs

    if dry_run:
        msgs.append("将移动: %s -> %s" % (os.path.basename(model_path), os.path.relpath(dest, models_root)))
        return dest, msgs

    os.makedirs(dest_dir, exist_ok=True)
    try:
        shutil.move(model_path, dest)
        # 同目录附属文件（info/预览图/封面/示例图）一起移动；
        # 若 C 站文件名与原名不同，附属文件同步改为新 base 名（保持 find_info_file/find_cover 可识别）
        src_dir = os.path.dirname(model_path)
        base_src, _ = os.path.splitext(model_path)
        new_base = os.path.splitext(new_name)[0]
        for ext in _SIDE_EXTS:
            side = base_src + ext
            if os.path.exists(side):
                try:
                    shutil.move(side, os.path.join(dest_dir, new_base + ext))
                except Exception as e:
                    msgs.append("附属文件移动失败: %s (%s)" % (os.path.basename(side), e))
        msgs.append("已移动: %s" % new_name)
        # 清理空目录
        _remove_empty_dirs(src_dir, models_root)
    except Exception as e:
        msgs.append("移动失败: %s (%s)" % (new_name, e))
        return model_path, msgs
    return dest, msgs


def _remove_empty_dirs(start, stop_root):
    start = os.path.normpath(start)
    stop_root = os.path.normpath(stop_root)
    try:
        common = os.path.commonpath([start, stop_root])
    except ValueError:
        return
    if common != stop_root:
        return  # start 不是 stop_root 的子目录，避免误删兄弟目录
    while start != stop_root:
        try:
            os.rmdir(start)
        except OSError:
            return
        start = os.path.dirname(start)


def cleanup_model(model_path, remove_info=True, remove_cover=True, remove_html=True,
                  remove_examples=True, log_cb=None):
    """一键清理：删除 info/封面/HTML/示例图。返回删除文件数"""
    removed = 0
    base, _ = os.path.splitext(model_path)
    targets = []
    if remove_info:
        targets += [base + ".info.json", base + ".json", base + ".txt",
                    base + ".yaml", base + ".yml", base + ".md"]
    if remove_html:
        targets.append(base + ".html")
    if remove_cover:
        targets.append(base + ".cover.jpg")
        targets.append(base + ".cover.png")
    if remove_examples:
        examples_dir = base + ".examples"
        if os.path.isdir(examples_dir):
            targets.append(examples_dir)
        for ext in IMAGE_EXTS:
            targets.append(base + ".example" + ext)
    for t in targets:
        if os.path.isdir(t):
            try:
                shutil.rmtree(t)
                removed += 1
                if log_cb:
                    log_cb("已删除目录: %s" % t)
            except Exception as e:
                if log_cb:
                    log_cb("删除失败: %s (%s)" % (t, e))
        elif os.path.exists(t):
            try:
                os.remove(t)
                removed += 1
                if log_cb:
                    log_cb("已删除: %s" % t)
            except Exception as e:
                if log_cb:
                    log_cb("删除失败: %s (%s)" % (t, e))
    return removed


def generate_html(models, out_path, progress_cb=None):
    """生成 HTML 图例页：封面 + 名称 + 类型 + 触发词 + 链接"""
    rows = []
    total = len(models)
    for i, m in enumerate(models):
        cover = m.get("cover") or ""
        if cover and not os.path.isabs(cover):
            cover = os.path.basename(cover)
        rows.append(
            '<div class="card">'
            '<div class="cover">%s</div>'
            '<div class="name">%s</div>'
            '<div class="meta">%s</div>'
            '<div class="tags">%s</div>'
            '<div class="link">%s</div>'
            "</div>"
            % (
                '<img src="%s" loading="lazy"/>' % html_mod.escape(cover) if cover else '<div class="nopic">无封面</div>',
                html_mod.escape(m.get("name") or os.path.basename(m.get("path", ""))),
                html_mod.escape("%s · %s" % (m.get("type") or "-", m.get("baseModel") or "-")),
                html_mod.escape(" ".join(m.get("trainedWords") or []) or "-"),
                '<a href="%s" target="_blank">%s</a>' % (html_mod.escape(m.get("url") or "#"),
                                                          html_mod.escape(m.get("url") or "")) if m.get("url") else "",
            )
        )
        if progress_cb:
            progress_cb(i + 1, total)
    page = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<title>模型图例</title>
<style>
body{font-family:"Microsoft YaHei",sans-serif;background:#1e1e2e;color:#cdd6f4;margin:24px}
h1{color:#89b4fa}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
.card{background:#313244;border-radius:10px;padding:10px;overflow:hidden}
.cover{height:160px;overflow:hidden;background:#45475a;border-radius:6px;margin-bottom:8px;text-align:center}
.cover img{width:100%;height:100%;object-fit:cover}
.nopic{color:#6c7086;line-height:160px;font-size:13px}
.name{font-weight:bold;font-size:14px;margin-bottom:4px;word-break:break-all}
.meta{color:#a6adc8;font-size:12px;margin-bottom:4px}
.tags{color:#f9e2af;font-size:11px;word-break:break-all;margin-bottom:4px}
.link a{color:#89b4fa;font-size:11px;word-break:break-all}
</style></head><body><h1>模型图例 (__TOTAL__)</h1><div class="grid">
__ROWS__
</div></body></html>"""
    page = page.replace("__TOTAL__", str(total)).replace("__ROWS__", "\n".join(rows))
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(page)
    return out_path
