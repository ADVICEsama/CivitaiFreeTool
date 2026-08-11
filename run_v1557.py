# -*- coding: utf-8 -*-
import subprocess, sys, io
sys.stdout.reconfigure(encoding='utf-8')
r = subprocess.run([sys.executable, 'test_v1557.py'], capture_output=True)
data = r.stdout or b''
try:
    txt = data.decode('utf-8')
except Exception:
    txt = data.decode('gbk', errors='replace')
for line in txt.splitlines():
    if 'ERR' in line or 'OK' in line or '菜单' in line or '张' in line:
        print(repr(line))
print('RC=', r.returncode)
