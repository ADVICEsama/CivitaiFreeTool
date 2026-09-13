# -*- coding: utf-8 -*-
"""一键发布到 GitHub Releases（token 从 git 凭据管理器读取，不落盘）

用法:
    py -3.13 scripts/release_github.py 2.1.30 "path/to/notes.md"

做三件事:
  1) 读取本地 git 凭据（git credential fill）拿 token；取不到则提示先 git push 一次
  2) 创建 release（tag = v<版本>，指向 main），说明取自 notes 文件
  3) 上传两个附件：dist/CivitaiFreeToolWeb.exe 与打包好的 Chrome 扩展 zip，最后验证

约定（与历史 release 保持一致）:
  - tag/名称: v2.1.30 / CivitaiFreeTool v2.1.30
  - 附件: CivitaiFreeToolWeb.exe、CivitaiFreeTool-ChromeExtension-v2.1.30.zip
"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

OWNER, REPO = "ADVICEsama", "CivitaiFreeTool"
REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.github.com"


def get_token():
    p = subprocess.run(["git", "credential", "fill"],
                       input="protocol=https\nhost=github.com\n\n",
                       capture_output=True, text=True, timeout=30)
    for line in (p.stdout or "").splitlines():
        if line.startswith("password="):
            return line.split("=", 1)[1].strip()
    return ""


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    ver = sys.argv[1].lstrip("v")
    notes_path = sys.argv[2] if len(sys.argv) > 2 else ""
    tag = "v" + ver
    token = get_token()
    if not token:
        print("!! 拿不到 GitHub token：先执行一次 git push 让凭据管理器记住，再重试")
        return 2
    hdr = {"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
           "User-Agent": "CivitaiFreeTool-release"}

    def req(url, data=None, method=None, timeout=180):
        body = json.dumps(data).encode() if data is not None else None
        r = urllib.request.Request(url, data=body, headers=dict(hdr), method=method or ("POST" if body else "GET"))
        if body:
            r.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    body = open(notes_path, encoding="utf-8").read() if notes_path and os.path.exists(notes_path) else ""
    try:
        ex = req("%s/repos/%s/%s/releases/tags/%s" % (API, OWNER, REPO, tag))
        print("该版本 release 已存在:", ex.get("html_url"))
        return 0
    except urllib.error.HTTPError:
        pass

    rel = req("%s/repos/%s/%s/releases" % (API, OWNER, REPO),
              {"tag_name": tag, "target_commitish": "main", "name": "CivitaiFreeTool " + tag,
               "body": body, "draft": False, "prerelease": False})
    rid = rel["id"]
    print("release 建好:", rel.get("html_url"))

    # 打包 Chrome 扩展
    ext_dir = os.path.join(REPO_DIR, "chrome-extension")
    ext_zip_base = os.path.join(os.environ.get("TEMP", "."), "CivitaiFreeTool-ChromeExtension-" + tag)
    if os.path.isdir(ext_dir):
        shutil.make_archive(ext_zip_base, "zip", root_dir=ext_dir)
    assets = [
        (ext_zip_base + ".zip", "CivitaiFreeTool-ChromeExtension-%s.zip" % tag),
        (os.path.join(REPO_DIR, "dist", "CivitaiFreeToolWeb.exe"), "CivitaiFreeToolWeb.exe"),
    ]
    for path, aname in assets:
        if not os.path.exists(path):
            print("!! 附件不存在，跳过:", path)
            continue
        url = "https://uploads.github.com/repos/%s/%s/releases/%d/assets?name=%s" % (OWNER, REPO, rid, aname)
        for attempt in (1, 2, 3):
            try:
                with open(path, "rb") as f:
                    data = f.read()
                r = urllib.request.Request(url, data=data, method="POST", headers={
                    "Authorization": "Bearer " + token, "Content-Type": "application/octet-stream",
                    "User-Agent": "CivitaiFreeTool-release"})
                with urllib.request.urlopen(r, timeout=1800) as resp:
                    a = json.loads(resp.read().decode("utf-8"))
                print("上传成功:", aname, "%.1f MB" % (os.path.getsize(path) / 1048576), a.get("browser_download_url"))
                break
            except Exception as e:
                print("第 %d 次失败: %s" % (attempt, str(e)[:140]))
                time.sleep(3)
        else:
            print("!! 上传失败:", aname)

    v = req("%s/repos/%s/%s/releases/tags/%s" % (API, OWNER, REPO, tag))
    print("验证:", v.get("tag_name"), v.get("name"), "附件:", [a.get("name") for a in (v.get("assets") or [])])
    print("页面:", v.get("html_url"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
