# -*- coding: utf-8 -*-
"""配置模块：读写 user_config.json（默认值 + 兼容旧工具配置）"""
import json
import os
import copy
import sys

if getattr(sys, "frozen", False):
    # PyInstaller onefile 模式：配置放 exe 同目录，而非解压临时目录
    APP_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
    APP_DIR = os.path.dirname(os.path.abspath(__file__))

DEFAULTS = {
    "api_key": "",
    "download_dir": os.path.join(APP_DIR, "downloads", "models"),
    "models_dir": os.path.join(APP_DIR, "downloads", "models"),
    "max_concurrent_downloads": 3,
    "download_timeout": 300,
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
    "gen_metadata": True,               # 下载完成后自动生成 json/info
    "download_cover": True,             # 下载完成后自动下载封面
    "hidden_model_folders": [],         # 模型管理目录中隐藏的子文件夹
    "show_root_models": True,           # 是否显示模型目录根目录下的模型
    "metadata_format": "sd",            # sd / civitai / both（下载生成的 json 格式）
    "dark_mode": True,                  # 深色/浅色主题（旧字段，兼容）
    "theme": "dark",                    # 主题：dark / light / modern
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
    "rename_menu_default": "custom",
    "default_view": "waterfall",  # 模型管理默认视图 list / waterfall  # 修改名称按钮默认动作：custom/rename_c/localize
    "confirm_buttons_flip": False,   # 确认弹窗按钮翻转：False=确定左/取消右，True=取消左/确定右
    "default_page": "models",         # 启动默认页
    "default_page": "models",           # 启动默认页（download/dlmanager/models/reverse/settings）
}

CONFIG_PATH = os.path.join(APP_DIR, "user_config.json")
TASKS_PATH = os.path.join(APP_DIR, "download_tasks.json")

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
    # 旧配置只有 dark_mode 时兼容为 theme
    if "theme" not in disk:
        if "dark_mode" in disk:
            cfg["theme"] = "dark" if disk.get("dark_mode", True) else "light"
    if cfg.get("theme") not in ("dark", "light", "modern"):
        cfg["theme"] = "dark"
    return cfg


def save(cfg):
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False


def load_tasks():
    try:
        if os.path.exists(TASKS_PATH):
            with open(TASKS_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return []


def save_tasks(tasks):
    try:
        with open(TASKS_PATH, "w", encoding="utf-8") as f:
            json.dump(tasks, f, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False
