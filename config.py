# -*- coding: utf-8 -*-
"""配置模块：读写 user_config.json（默认值 + 兼容旧工具配置）"""
import json
import re
import os
import copy
import sys
import tempfile
import threading
import shutil

import data_storage
INSTALL_DIR = os.path.dirname(os.path.abspath(sys.executable if getattr(sys,"frozen",False) else __file__))
APP_DIR, STORAGE_WARNING = data_storage.resolve_directory(INSTALL_DIR, use_global=bool(getattr(sys,"frozen",False)))

# 界面主题（必须与 web/style.css 的 [data-theme=...] 与 app.js 设置项保持一致）
THEMES = ("dark_endfield", "light_endfield")


def normalize_theme(value, ui_scheme="light"):
    """Migrate retired palettes to one of the two supported Endfield themes."""
    if value in THEMES:
        return value
    if isinstance(value, str) and (value.startswith("light") or value == "modern"):
        return "light_endfield"
    if value == "metro":
        return "dark_endfield" if ui_scheme == "dark" else "light_endfield"
    return "dark_endfield"


def normalize_theme_preferences(cfg):
    scheme = cfg.get("ui_scheme", "light")
    legacy_theme = "light_endfield" if cfg.get("dark_mode") is False else "dark_endfield"
    cfg["theme"] = normalize_theme((cfg.get("theme") or legacy_theme), scheme)
    hud_theme = cfg.get("download_hud_theme", "follow")
    cfg["download_hud_theme"] = "follow" if not hud_theme or hud_theme == "follow" else normalize_theme(hud_theme, scheme)
    for key in ("dark_mode", "ui_scheme", "metro_accent"):
        cfg.pop(key, None)

DEFAULTS = {
    "endfield_parallax": True,
    "download_hud_enabled": False,
    "download_hud_dock": True,
    "download_hud_scale": 100,
    "download_hud_theme": "follow",
    "download_hud_motion": True,
    "download_hud_x": 40,
    "download_hud_y": 40,
    "api_key": "",
    "download_dir": os.path.join(INSTALL_DIR, "downloads", "models"),
    "models_dir": os.path.join(INSTALL_DIR, "downloads", "models"),
    "models_dirs": [],               # 多模型目录（每行一个；WebUI 与 ComfyUI 分开时都填）
    "max_concurrent_downloads": 3,
    "download_name_mode": "original",    # original / civitai / chinese
    "filename_include_version": False,   # 模型名字-原始版本号.后缀
    "multi_file_download": "ask",       # ask / first / all；无人操作 10 秒默认第一个
    "download_timeout": 300,
    "download_retry": 5,                 # 网络中断（SSL EOF/超时）自动重试次数，每次断点续传
    "auto_translate": True,
    "save_raw_json": True,
    "save_translated_json": True,
    "max_images_per_model": 5,
    "proxy_enabled": False,
    "ssl_verify": True,  # TLS 证书验证（代理 MITM 时取消勾选可跳过）
    "proxy_address": "127.0.0.1:7897",
    "hash_threads": 4,
    "usage_stats_enabled": True,
    # —— 新增功能配置 ——
    "window_style": "mica",             # mica / acrylic / none
    "ask_move_after_download": True,    # 下载完成后询问移动位置
    "download_target_dir": "",          # 下载落地文件夹（下载页/设置里选；空 = 用 download_dir）
    "gen_metadata": True,               # 下载完成后自动生成 json/info
    "download_cover": True,             # 下载完成后自动下载封面
    "update_keep_old": "keep",           # 更新下载完成后旧版处理：keep=保留（默认）/ delete=移入回收站（可还原）
    "window_wait_seconds": 30,           # 窗口启动至少等待 30 秒，检测到进展可继续宽限
    "browser_fallback_enabled": True,   # 原生窗口仍是默认；失败时允许浏览器兜底
    "cache_detail_images": True,        # 详情在线缩略图本地缓存；不下载原图
    "performance_profile": "custom",
    "performance_prompt_version": 0,
    "ui_animations": True,
    "pause_effects_while_dragging": True,
    "terrain_pixel_ratio": 1.5,
    "show_fps": False,                 # 左下角显示 UI 帧率与地图实际绘制帧率
    "effects_fps_limit": 60,            # 0 跟随屏幕刷新；15–360 自定义上限
    "cache_original_images": True,      # 已查看原图与生成数据保存到软件数据目录
    "gallery_cache_mb": 1024,           # 自动淘汰最旧缓存，不移动模型文件
    "model_favorites": [],             # 收藏置顶的本地模型路径
    "model_toolbar_locked": False,
    "onboarding_done": False,
    "model_folder_visibility": {},     # 显式目录选择，更深层选择优先
    "model_folder_include_subfolders": True,  # 默认递归包含子目录
    "hidden_model_folders": [],         # 模型管理目录中隐藏的子文件夹
    "show_root_models": True,           # 是否显示模型目录根目录下的模型
    "metadata_format": "sd",            # sd / civitai / both（WebUI 可读 json 的格式；.civitai.info 始终生成）
    "theme": "dark_endfield",           # 终末地主题：dark_endfield / light_endfield
    "frameless": False,                 # 无边框窗口（自绘标题栏）
    "site_domain": "civitai.red",       # 站点域名（展示/打开链接用；API 仍走 civitai.com）
    "baidu_appid": "",                  # 百度翻译开放平台 APP ID
    "baidu_key": "",                    # 百度翻译开放平台密钥
    "translate_filename": False,        # 下载时把模型名翻译成中文作为文件名
    "zebra_rows": True,                 # 模型列表斑马纹（行间视觉分隔）
    "organize_rules": [],               # 自定义分类规则：[{"folder": "文件夹", "keywords": ["词1","词2"]}]
    "target_env": "",                   # 目标环境：""=未选择 / webui / comfyui（整理前必须选择）
    "organize_mode": "manual",          # 整理模式：manual=手动 / civitai=C站tags分类 / rules=自定义规则
    "ambient_bg": True,                 # 顶部氛围动态背景（流动光晕，近似 shader）
    "ui_zoom": 100,                     # 界面缩放百分比（80-150）
    "show_file_paths": True,            # 名称下的路径（不隐藏目标列、选中目标及详情路径）
    "folder_picker_favorites": [],
    "folder_picker_folded": [],
    "folder_picker_show_paths": False,  # 默认只显示目录名，可独立开关
    "shortcuts_enabled": False,
    "shortcuts_bindings": {},
    "model_glow_opacity": 100,       # Inner-light opacity, 0..100
    "model_grid_size": 220,
    "model_list_hover": "thumbnail",
    "model_pagination": False,
    "model_page_size": 60,
    "model_card_styles": {},            # Per-type underlight and square-view shell pool
    "model_list_size": 3,               # 1 精简名称但保留信息列 / 2 无封面和作者 / 3 完整（现有最大）
    "masonry_info_mode": "always",     # always / slide / fade
    "masonry_overlay_size": "partial", # partial / full
    "name_scroll_speed": 70,          # px/s
    "name_scroll_start_pause": 350,   # ms
    "name_scroll_end_pause": 250,     # ms
    "masonry_card_width": 220,         # 瀑布流图片/卡片宽度，140–420
    "ui_text_size": "standard",         # small / standard / large / xlarge / huge；不改变界面缩放
    "integrated_titlebar": True,        # 应用内窗口栏；失败保留标准系统框
    "window_appearance": "theme",       # theme / mica / mica_alt / system / external
    "ui_font": "",                    # 空=软件默认；其他=已安装的本地字体族
    "ui_font_scripts": {},             # 各文字用途的独立字体回退列表
    "ui_font_picker_view": {"expanded": False, "scope": "default"},  # 字库分配视图，不包含字体草稿
    "ui_font_stack": None,             # None 兼容旧 ui_font；[] 使用主题默认；列表按顺序补缺字
    "folder_picker_size": {},           # 分类选择器上次尺寸，占视口的比例，兼容界面缩放
    "custom_accent_enabled": False,     # 所有主题均可覆盖强调色
    "custom_accent": "#60A5FA",
    "ui_density": "standard",          # compact / standard / comfortable
    "ui_corners": "theme",             # theme / square / soft / rounded
    "sidebar_collapsed": False,
    "rename_menu_default": "custom",
    "default_view": "waterfall",  # 模型管理默认视图 list / waterfall / grid  # 修改名称按钮默认动作：custom/rename_c/localize
    "rename_clean_rules": "comma,paren",  # 改名/下载命名时清理符号：comma 逗号→空格 / paren 括号删除 / dash 横线下划线→空格
    "confirm_buttons_flip": False,   # 确认弹窗按钮翻转：False=确定左/取消右，True=取消左/确定右
    # —— 界面模式（浏览器模式 = 后端常驻 + 系统浏览器显示界面，界面卡死不拖死下载）——
    "ui_mode": "window",                # window（原生窗口，默认）/ browser（浏览器）
    "tray_icon": True,                  # 浏览器模式：显示托盘图标（打开界面/退出软件）
    "exit_when_page_closed": False,     # 浏览器模式：关闭页面后自动退出（有任务在下载时不退）
    "close_action": "exit",             # 点窗口关闭按钮：exit 退出（默认）/ minimize 最小化到任务栏
    "webview_disable_gpu": False,       # 禁用 WebView2 GPU 加速（软件渲染；默认关。软渲染会让氛围动画吃满 CPU）
    "default_page": "models",           # 启动默认页（download/dlmanager/models/reverse/settings）
}

CONFIG_PATH = os.path.join(APP_DIR, "user_config.json")
TASKS_PATH = os.path.join(APP_DIR, "download_tasks.json")
HISTORY_PATH = os.path.join(APP_DIR, "download_history.json")
_json_write_lock = data_storage.LOCK

def use_data_directory(directory):
    global APP_DIR, CONFIG_PATH, TASKS_PATH, HISTORY_PATH, STORAGE_WARNING
    APP_DIR = os.path.abspath(directory)
    CONFIG_PATH = os.path.join(APP_DIR,"user_config.json")
    TASKS_PATH = os.path.join(APP_DIR,"download_tasks.json")
    HISTORY_PATH = os.path.join(APP_DIR,"download_history.json")
    STORAGE_WARNING = ""

# 旧工具配置（若用户安装过原赞助工具，自动导入 API key 等，避免重复配置）
# 在常见位置查找，避免硬编码个人路径
def _find_legacy_config():
    desktop = os.path.join(os.path.expanduser("~"), "Desktop")
    candidates = [
        os.path.join(desktop, "工具", "CivitaiDownloadTool", "user_config.json"),
        os.path.join(desktop, "CivitaiDownloadTool", "user_config.json"),
        os.path.join(desktop, "Tools", "CivitaiDownloadTool", "user_config.json"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return None


def _import_legacy(cfg):
    """从旧工具的 user_config.json 导入可用配置（仅当新配置为空时）"""
    try:
        if cfg.get("api_key"):
            return
        legacy = _find_legacy_config()
        if not legacy:
            return
        with open(legacy, "r", encoding="utf-8") as f:
            old = json.load(f)
        for k in ("api_key", "download_dir", "models_dir", "max_concurrent_downloads",
                  "download_timeout", "proxy_enabled", "proxy_address", "hash_threads",
                  "auto_translate"):
            v = old.get(k)
            if v is None:
                continue
            if k in ("download_dir", "models_dir"):
                # 旧配置可能含乱码路径（GBK 被误读为 UTF-8），只导入真实存在的目录
                if not os.path.isdir(str(v)):
                    continue
            cfg[k] = v
    except Exception:
        pass


def _merge(dst, src):
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            _merge(dst[k], v)
        else:
            dst[k] = v
    return dst


def load():
    cfg = copy.deepcopy(DEFAULTS)
    disk = {}
    try:
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                disk = json.load(f)
                _merge(cfg, disk)
    except Exception:
        pass
    _import_legacy(cfg)
    if "download_name_mode" not in disk and cfg.get("translate_filename") is True: cfg["download_name_mode"] = "chinese"
    # 旧配置只有 dark_mode 时兼容为 theme
    if "theme" not in disk:
        if "dark_mode" in disk:
            cfg["theme"] = "dark_endfield" if disk.get("dark_mode", True) else "light_endfield"
    try:
        cfg["window_wait_seconds"] = max(30, min(600, int(cfg.get("window_wait_seconds") or 30)))
    except (TypeError, ValueError, OverflowError):
        cfg["window_wait_seconds"] = 30
    normalize_ui_preferences(cfg)
    return cfg


MODEL_CARD_TYPES = ("Checkpoint", "LORA", "VAE", "Controlnet", "TextualInversion", "Hypernetwork", "Upscaler", "TextEncoder", "MotionModule", "Other", "Unknown")
MODEL_CARD_GLOWS = ("none", "gold", "cyan", "violet", "green", "red", "white")
MODEL_CARD_FRAMES = frozenset(('icon_user_avatar_frame_activity_1', 'icon_user_avatar_frame_activity_2', 'icon_user_avatar_frame_activity_3', 'icon_user_avatar_frame_activity_4', 'icon_user_avatar_frame_activity_5', 'icon_user_avatar_frame_activity_6', 'icon_user_avatar_frame_activity_7', 'icon_user_avatar_frame_activity_8', 'icon_user_avatar_frame_activity_9', 'icon_user_avatar_frame_bp_1', 'icon_user_avatar_frame_bp_1_1', 'icon_user_avatar_frame_bp_1_2', 'icon_user_avatar_frame_bp_1_3', 'icon_user_avatar_frame_bp_1_4', 'icon_user_avatar_frame_bp_1_5', 'icon_user_avatar_frame_bp_1_6', 'icon_user_avatar_frame_channel_1', 'icon_user_avatar_frame_channel_2', 'icon_user_avatar_frame_channel_3', 'icon_user_avatar_frame_channel_4', 'icon_user_avatar_frame_channel_5', 'icon_user_avatar_frame_channel_6', 'icon_user_avatar_frame_channel_7', 'icon_user_avatar_frame_channel_v1d3_1', 'icon_user_avatar_frame_channel_v1d4_1', 'icon_user_avatar_frame_channel_v1d4_2', 'icon_user_avatar_frame_channel_v1d5_1', 'icon_user_avatar_frame_channel_v1d5_2', 'icon_user_avatar_frame_channel_v1d5_3', 'icon_user_avatar_frame_endfield_1', 'icon_user_avatar_frame_endfield_2', 'item_user_avatar_frame_test_1', 'item_user_avatar_frame_test_2'))
MODEL_CARD_DEFAULT_GLOWS = dict(zip(MODEL_CARD_TYPES, ("gold", "cyan", "violet", "green", "white", "violet", "cyan", "white", "red", "none", "none")))

def normalize_model_glow(value, fallback='none'):
    if not isinstance(value, str): return fallback
    if value in MODEL_CARD_GLOWS: return value
    return value.lower() if re.fullmatch(r'#[0-9a-fA-F]{6}', value) else fallback


def normalize_model_style_folder(value):
    if not isinstance(value, str) or len(value) > 1000 or any(ord(c) < 32 for c in value): return ''
    path = value.strip().replace('\\', '/')
    if not (re.match(r'^[A-Za-z]:/', path) or path.startswith('/')): return ''
    if any(part in ('.', '..') for part in path.split('/')): return ''
    return path.rstrip('/').lower()


def normalize_model_card_styles(value):
    """Keep actual assignment identifiers, safe colors and bundled frame IDs.

    Folder overrides are data-only absolute paths. Applying a style never touches a model file.
    """
    value = value if isinstance(value, dict) else {}
    result = {}
    def entry(raw, fallback='none'):
        raw = raw if isinstance(raw, dict) else {}
        frames = raw.get('frames')
        data = {'glow': normalize_model_glow(raw.get('glow'), fallback),
                'frames': list(dict.fromkeys(f for f in frames if isinstance(f, str) and f in MODEL_CARD_FRAMES)) if isinstance(frames, list) else []}
        if 'opacity' in raw:
            try: data['opacity'] = max(0, min(100, int(raw['opacity'])))
            except (ValueError, TypeError, OverflowError): pass
        return data
    for key in MODEL_CARD_TYPES:
        result[key] = entry(value.get(key), MODEL_CARD_DEFAULT_GLOWS[key])
    for key, raw in list(value.items())[:2000]:
        if not isinstance(key, str) or not isinstance(raw, dict): continue
        if key.startswith('base:'):
            name = key[5:].strip().lower()
            if name and len(name) <= 80 and not any(ord(ch) < 32 for ch in name):
                result['base:' + name] = entry(raw)
        elif key.startswith('folder:'):
            path = normalize_model_style_folder(key[7:])
            if path: result['folder:' + path] = entry(raw)
    return result


def normalize_ui_preferences(cfg):
    normalize_theme_preferences(cfg)
    if cfg.get("performance_profile") not in ("full", "balanced", "static", "custom"): cfg["performance_profile"] = "custom"
    cfg["pause_effects_while_dragging"] = cfg.get("pause_effects_while_dragging", True) is not False
    cfg["ui_animations"] = cfg.get("ui_animations", True) is not False
    try: cfg["performance_prompt_version"] = max(0, min(1000, int(cfg.get("performance_prompt_version", 0))))
    except (ValueError, TypeError, OverflowError): cfg["performance_prompt_version"] = 0
    try: cfg["terrain_pixel_ratio"] = max(1.0, min(2.0, float(cfg.get("terrain_pixel_ratio", 1.5))))
    except (ValueError, TypeError): cfg["terrain_pixel_ratio"] = 1.5
    cfg.pop("pointer_effects", None)
    cfg.pop("pointer_effect_quality", None)
    cfg["model_card_styles"] = normalize_model_card_styles(cfg.get("model_card_styles"))
    cfg["model_pagination"] = cfg.get("model_pagination") is True
    if cfg.get("default_view", "waterfall") not in ("waterfall", "list", "grid"): cfg["default_view"] = "waterfall"
    # Retired path override: never read an old font file or reintroduce its setting.
    cfg.pop("endfield_display_font", None)
    raw_scripts = cfg.get("ui_font_scripts")
    scripts = {}
    if isinstance(raw_scripts, dict):
        for scope in ("zhHans", "digits", "latin", "ja", "zhHant", "ko"):
            values = raw_scripts.get(scope)
            if isinstance(values, list):
                fonts = list(dict.fromkeys(f.strip()[:200] for f in values if isinstance(f, str) and f.strip()))[:20]
                if fonts: scripts[scope] = fonts
    cfg["ui_font_scripts"] = scripts
    raw_picker_view = cfg.get("ui_font_picker_view")
    if not isinstance(raw_picker_view, dict): raw_picker_view = {}
    picker_scope = raw_picker_view.get("scope")
    cfg["ui_font_picker_view"] = {
        "expanded": raw_picker_view.get("expanded") is True,
        "scope": picker_scope if picker_scope in ("default", "zhHans", "digits", "latin", "ja", "zhHant", "ko") else "default",
    }
    try: cfg["download_hud_scale"] = max(75, min(150, int(cfg.get("download_hud_scale",100))))
    except (ValueError, TypeError, OverflowError): cfg["download_hud_scale"] = 100
    cfg["download_hud_dock"] = cfg.get("download_hud_dock",True) is not False
    cfg["download_hud_enabled"] = cfg.get("download_hud_enabled") is True
    cfg["download_hud_motion"] = cfg.get("download_hud_motion", True) is not False
    for key in ("download_hud_x", "download_hud_y"):
        try: cfg[key] = max(-100000, min(100000, int(cfg.get(key, 40))))
        except (ValueError, TypeError, OverflowError): cfg[key] = 40
    if cfg.get("model_list_hover","thumbnail") not in ("thumbnail","text","both","none"):cfg["model_list_hover"]="thumbnail"
    if cfg.get("masonry_info_mode","always") not in ("always","slide","fade"):cfg["masonry_info_mode"]="always"
    if cfg.get("masonry_overlay_size","partial") not in ("partial","full"):cfg["masonry_overlay_size"]="partial"
    if cfg.get("download_name_mode", "original") not in ("original", "civitai", "chinese"): cfg["download_name_mode"] = "original"
    cfg["filename_include_version"] = cfg.get("filename_include_version") is True
    if cfg.get("multi_file_download", "ask") not in ("ask", "first", "all"): cfg["multi_file_download"] = "ask"
    for key,default,lo,hi in [("model_grid_size",220,100,500),("model_page_size",60,12,240),("model_glow_opacity",100,0,100),("max_concurrent_downloads",3,1,32),("effects_fps_limit",60,15,360),("gallery_cache_mb",1024,64,8192),("model_list_size",3,1,3),("name_scroll_speed",70,10,240),("name_scroll_start_pause",350,0,5000),("name_scroll_end_pause",250,0,5000)]:
        try:value=int(cfg.get(key,default));cfg[key]=0 if key=="effects_fps_limit" and value==0 else max(lo,min(hi,value))
        except (TypeError,ValueError,OverflowError):cfg[key]=default
    cfg['show_fps']=cfg.get('show_fps') is True
    cfg['shortcuts_enabled']=cfg.get('shortcuts_enabled') is True
    legacy_shortcuts=cfg.pop("shortcuts_preset", None)
    bindings=cfg.get('shortcuts_bindings')
    cfg['shortcuts_bindings']={str(k)[:150]:v[:80] for k,v in list(bindings.items())[:2000] if isinstance(k,str) and isinstance(v,str)} if isinstance(bindings,dict) else {}
    # 删除多预设入口；旧 W/S、J/K 用户的导航键迁移为普通自定义绑定，不自动开启。
    legacy_navigation={"wasd":("W","S"),"vim":("K","J")}.get(legacy_shortcuts)
    if legacy_navigation:
        for command,key in zip(("model:previous","model:next"),legacy_navigation):cfg['shortcuts_bindings'].setdefault(command,key)
    values=cfg.get("model_favorites")
    cfg["model_favorites"]=list(dict.fromkeys(p for p in values if isinstance(p,str) and p.strip()))[:10000] if isinstance(values,list) else []


def _save_json_atomic(path, value):
    """同目录临时文件 + 原子替换，保留上次有效 JSON，避免退出/断电产生半个文件。"""
    temp_path = None
    try:
        with _json_write_lock:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=os.path.dirname(os.path.abspath(path)),
                                             prefix=os.path.basename(path) + ".", suffix=".tmp", delete=False) as f:
                temp_path = f.name
                json.dump(value, f, ensure_ascii=False, indent=2)
                f.flush()
                os.fsync(f.fileno())
            if os.path.exists(path):
                try:
                    with open(path, "r", encoding="utf-8") as previous:
                        json.load(previous)
                    shutil.copyfile(path, path + ".bak")
                except (OSError, ValueError):
                    pass
            os.replace(temp_path, path)
            temp_path = None
        return True
    except Exception:
        return False
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


def save(cfg):
    # Direct/native callers also migrate retired themes without mutating their
    # in-memory configuration before an atomic save has succeeded.
    saved = dict(cfg)
    normalize_theme_preferences(saved)
    return _save_json_atomic(CONFIG_PATH, saved)


def _load_json_list(path):
    for candidate in (path, path + ".bak"):
        try:
            with open(candidate, "r", encoding="utf-8") as f:
                value = json.load(f)
            if isinstance(value, list):
                return value
        except (OSError, ValueError):
            continue
    return []


def load_tasks():
    return _load_json_list(TASKS_PATH)


def save_tasks(tasks):
    return _save_json_atomic(TASKS_PATH, tasks)


def load_history():
    return _load_json_list(HISTORY_PATH)


def save_history(history):
    return _save_json_atomic(HISTORY_PATH, history)
