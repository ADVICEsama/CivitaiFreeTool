# -*- coding: utf-8 -*-
"""多目录支持单测：_models_roots / save_config 规范化 / scan_models 合并 / _root_of"""
import sys, os, tempfile, json, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config, webui

tmp = tempfile.mkdtemp()
webui_root = os.path.join(tmp, "webui_models")
comfy_root = os.path.join(tmp, "comfyui_models")
os.makedirs(os.path.join(webui_root, "Lora"))
os.makedirs(os.path.join(comfy_root, "loras"))
def w(p, content=b"x"):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as f:
        f.write(content)

w(os.path.join(webui_root, "Lora", "a.safetensors"))
w(os.path.join(comfy_root, "loras", "b.safetensors"))

w = webui.Api()
# 1) _models_roots：models_dirs + legacy models_dir 合并去重
w.cfg["models_dir"] = webui_root
w.cfg["models_dirs"] = [comfy_root, webui_root]  # webui_root 重复 → 去重
roots = w._models_roots()
print("roots:", [os.path.basename(r) for r in roots])
assert len(roots) == 2, "应去重为 2 个根"
assert webui_root in roots and comfy_root in roots

# 2) save_config 规范化：空列表保留 models_dir；非空时 models_dir 同步为第一个
w.cfg["models_dirs"] = []
w.save_config({"models_dirs": []})
assert w.cfg["models_dirs"] == []
w.save_config({"models_dirs": [comfy_root, comfy_root, ""]})
assert w.cfg["models_dirs"] == [comfy_root], "去空去重"
assert w.cfg["models_dir"] == comfy_root, "models_dir 同步为第一个"
print("save_config 规范化 OK")

# 3) _root_of：文件归属正确根
w.cfg["models_dirs"] = [webui_root, comfy_root]
w.cfg["models_dir"] = webui_root
assert w._root_of(os.path.join(webui_root, "Lora", "a.safetensors")) == webui_root
assert w._root_of(os.path.join(comfy_root, "loras", "b.safetensors")) == comfy_root
assert w._root_of(os.path.join(tmp, "elsewhere", "x.safetensors")) == webui_root  # 不在任何根 → 第一个
print("_root_of OK")

# 4) scan_models 合并两目录
w.cfg["models_dirs"] = [webui_root, comfy_root]
w.cfg["models_dir"] = webui_root
w.scan_models()
import time
for _ in range(50):
    if not w.mm_scan_state["running"]:
        break
    time.sleep(0.1)
rows = w.mm_scan_state["rows"]
names = sorted(os.path.basename(r["path"]) for r in rows)
print("扫描结果:", names)
assert names == ["a.safetensors", "b.safetensors"], "两目录模型合并"

# 5) mm_organize：多 root 时每个文件归属自己的根
# 临时改 models_dirs，用 comfy 环境整理 b（应在 comfy_root/loras 下不动或归类）
import model_manager as mm
w.cfg["target_env"] = "comfyui"
w.cfg["organize_mode"] = "civitai"
p2, msgs = mm.organize_model(os.path.join(comfy_root, "loras", "b.safetensors"), comfy_root,
                             dry_run=False, env="comfyui", mode="manual")
print("organize 归属根 OK:", os.path.basename(os.path.dirname(p2)))

shutil.rmtree(tmp, ignore_errors=True)
print("MULTI ROOTS TEST OK")
