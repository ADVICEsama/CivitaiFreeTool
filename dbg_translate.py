# -*- coding: utf-8 -*-
import sys, os, json, tempfile, shutil, time
sys.path.insert(0, ".")
import config, webui, translator as tr
tr.translate = lambda text, appid, key: ("译:" + text) if text and not tr._is_cjk(text) else text
tmp = tempfile.mkdtemp()
old_app = config.APP_DIR
config.APP_DIR = tmp
config.save(config.DEFAULTS.copy())
import importlib; importlib.reload(webui)
w = webui.Api()
w.cfg = dict(config.load())
w.cfg["models_dirs"] = [tmp]
md = os.path.join(tmp, "Lora"); os.makedirs(md, exist_ok=True)
path = os.path.join(md, "m1.safetensors"); open(path, "w").write("x")
info = {"name": "m1", "type": "LORA", "description": "A cute style lora for girls", "trainedWords": ["cute style"]}
base = os.path.splitext(path)[0]
open(base + ".civitai.info", "w", encoding="utf-8").write(json.dumps(info))
w.scan_models()
while w.mm_progress.get("running"):
    time.sleep(0.1)
print("model_rows:", [(r["path"], r.get("name")) for r in w.model_rows])
print("info 文件内容:", open(base + ".civitai.info", encoding="utf-8").read())
w.mm_translate_descs([path])
for _ in range(60):
    if not w.mm_progress.get("running"):
        break
    time.sleep(0.2)
print("msg:", w.mm_progress["msg"], "| result:", w.mm_progress["result"])
print("info 现在:", open(base + ".civitai.info", encoding="utf-8").read())
config.APP_DIR = old_app
shutil.rmtree(tmp, ignore_errors=True)
