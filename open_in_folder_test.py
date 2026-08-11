# -*- coding: utf-8 -*-
"""open_in_folder 参数修复单测"""
import sys, os, tempfile, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import webui

w = webui.Api()
import subprocess as sp
calls = []
def fake_popen(args, **kw):
    calls.append(args)
    return None
sp.Popen = fake_popen
tmp = tempfile.mkdtemp()
try:
    f = os.path.join(tmp, "a b.safetensors")
    open(f, "w").write("x")
    r = w.open_in_folder(f)
    print("ok:", r)
    assert r["ok"] and len(calls) == 1
    assert calls[0] == ["explorer", "/select," + f], "explorer 参数应为单参数（路径带空格）"
    print("参数 OK:", calls[0])
    r2 = w.open_in_folder(os.path.join(tmp, "no.safetensors"))
    assert not r2["ok"]
    print("不存在路径 OK")
    print("OPEN_IN_FOLDER TEST OK")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
