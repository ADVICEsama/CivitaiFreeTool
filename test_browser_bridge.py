# -*- coding: utf-8 -*-
"""browser_bridge 单测：扩展 POST /api/download → handler 入队下载 全链路（临时 handler，不碰真实下载）"""
import json
import os
import unittest
import urllib.request

import browser_bridge

PORT = 47539  # 测试端口，避开默认 47531


class FakeAPI:
    """mock CivitaiAPI：resolve/get_model/get_model_version/pick_file 全部本地返回"""
    def resolve_url(self, url):
        return ("123", None)

    def get_model(self, mid):
        return {"name": "Test Model", "modelVersions": [{"id": 456}]}

    def get_model_version(self, vid):
        return {"name": "v1", "files": [{"name": "test.safetensors", "primary": True,
                                         "downloadUrl": "https://example.com/x.safetensors",
                                         "hashes": {"SHA256": "abc123"}}]}

    def pick_file(self, version):
        return version["files"][0], 0

    def build_download_url(self, version_id, file_id=None):
        return "https://civitai.com/api/download/models/%s" % version_id


def req(path, method="GET", body=None, origin=None):
    url = "http://127.0.0.1:%d%s" % (PORT, path)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    if origin:
        r.add_header("Origin", origin)
    try:
        with urllib.request.urlopen(r, timeout=5) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


class BridgeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.received = []
        browser_bridge.set_download_handler(cls._fake_dl)
        browser_bridge.start(version="test", port=PORT)

    @classmethod
    def _fake_dl(cls, url):
        """模拟 dl_enqueue_url：记录 URL 并同步返回"""
        cls.received.append(url)
        if url.startswith("https://civitai.red/models/bad"):
            return {"ok": False, "msg": "模型没有可用版本"}
        return {"started": True}

    def setUp(self):
        type(self).received.clear()

    def test_health(self):
        st, d = req("/api/health")
        self.assertEqual(st, 200)
        self.assertTrue(d["ok"])
        self.assertEqual(d["version"], "test")

    def test_ext_download_model_url(self):
        st, d = req("/api/download", "POST", {"url": "https://civitai.red/models/1290339/miaomiao-blocks"},
                    origin="chrome-extension://abcdef123456")
        self.assertEqual(st, 200)
        self.assertTrue(d["ok"])
        self.assertEqual(self.received, ["https://civitai.red/models/1290339/miaomiao-blocks"])

    def test_ext_download_version_url(self):
        st, d = req("/api/download", "POST",
                    {"url": "https://www.civitai.com/models/123?modelVersionId=456"},
                    origin="chrome-extension://abcdef123456")
        self.assertEqual(st, 200)
        self.assertTrue(d["ok"])
        self.assertIn("https://www.civitai.com/models/123?modelVersionId=456", self.received)

    def test_ext_download_api_url(self):
        st, d = req("/api/download", "POST", {"url": "https://civitai.red/api/download/models/789"},
                    origin="chrome-extension://abcdef123456")
        self.assertEqual(st, 200)
        self.assertTrue(d["ok"])

    def test_handler_rejects(self):
        st, d = req("/api/download", "POST", {"url": "https://civitai.red/models/bad/xx"},
                    origin="chrome-extension://abc")
        self.assertEqual(st, 400)
        self.assertFalse(d["ok"])

    def test_reject_non_model_url(self):
        for bad in ("https://civitai.red/images/12345",
                    "https://civitai.red/posts/1",
                    "https://civitai.red/",
                    "https://example.com/models/1",
                    "https://civitai.red/models"):
            st, d = req("/api/download", "POST", {"url": bad}, origin="chrome-extension://abc")
            self.assertEqual(st, 400, bad)
            self.assertFalse(d["ok"], bad)
        self.assertEqual(self.received, [])

    def test_reject_foreign_origin(self):
        st, d = req("/api/download", "POST", {"url": "https://civitai.red/models/1"},
                    origin="https://evil.example.com")
        self.assertEqual(st, 403)
        self.assertEqual(self.received, [])

    def test_reject_empty_and_bad_json(self):
        st, d = req("/api/download", "POST", {}, origin="chrome-extension://abc")
        self.assertEqual(st, 400)
        st, d = req("/api/download", "POST", {"nourl": 1}, origin="chrome-extension://abc")
        self.assertEqual(st, 400)

    def test_local_origin_allowed(self):
        st, d = req("/api/download", "POST", {"url": "https://civitai.red/models/9/z"},
                    origin="http://127.0.0.1:47531")
        self.assertEqual(st, 200)

    def test_no_handler(self):
        browser_bridge.set_download_handler(None)
        try:
            st, d = req("/api/download", "POST", {"url": "https://civitai.red/models/1/a"},
                        origin="chrome-extension://abc")
            self.assertEqual(st, 500)
            self.assertFalse(d["ok"])
        finally:
            browser_bridge.set_download_handler(self._fake_dl)


class SyncEnqueueTest(unittest.TestCase):
    """dl_enqueue_url_sync：同步解析 + 真实入队（FakeAPI，不碰网络与磁盘）"""

    def setUp(self):
        import webui
        self.app = webui.Api()
        self.app.api = FakeAPI()

    def test_sync_enqueue_ok(self):
        r = self.app.dl_enqueue_url_sync("https://civitai.red/models/123/abc")
        self.assertTrue(r["ok"], r)
        self.assertTrue(r.get("task_id"))
        # 任务真实入队（文件名 = 模型名 + 空格 + 版本名 + 扩展名）
        tasks = [t for t in self.app.dl.tasks if t.info and t.info.get("model_id") == "123"]
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0].filename, "test v1.safetensors")
        # 关键：info.meta 必须存在（下载完成后生成 json + 封面缩略图的前提）
        meta = (tasks[0].info or {}).get("meta") or {}
        self.assertIn("info", meta)
        self.assertIn("sd", meta)
        self.assertTrue(meta["info"] and meta["sd"])
        # 下载链接用 build_download_url 生成
        self.assertTrue(tasks[0].url.startswith("https://"))

    def test_handle_dl_done_generates_metadata(self):
        """插件入队的任务下载完成后 → 自动生成 SD json（下载管理/模型管理缩略图依赖此链路）"""
        import os
        from downloader import ST_DONE
        r = self.app.dl_enqueue_url_sync("https://civitai.red/models/123/abc")
        self.assertTrue(r["ok"])
        task = next(t for t in self.app.dl.tasks if t.id == r["task_id"])
        # 把任务指向工作区内临时目录并放置占位文件，模拟下载完成
        d = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".test_tmp", "dl_done")
        os.makedirs(d, exist_ok=True)
        task.dest_dir = d
        dest = os.path.join(d, task.filename)
        with open(dest, "w") as f:
            f.write("placeholder")
        task.status = ST_DONE
        self.app._handle_dl_done(task)
        base = os.path.splitext(dest)[0]
        self.assertTrue(os.path.exists(base + ".json"), "SD json 未生成")
        import json as _json
        with open(base + ".json", encoding="utf-8") as f:
            sd = _json.load(f)
        self.assertEqual(sd.get("name"), "Test Model")
        # 清理
        for s in (".json", ".civitai.info", ".preview.png"):
            p = base + s
            if os.path.exists(p):
                os.remove(p)
        os.remove(dest)

    def test_sync_enqueue_failure(self):
        class BadAPI(FakeAPI):
            def resolve_url(self, url):
                raise __import__("civitai_api").CivitaiError("timed out")
        self.app.api = BadAPI()
        r = self.app.dl_enqueue_url_sync("https://civitai.red/models/123/abc")
        self.assertFalse(r["ok"])
        self.assertIn("代理", r["msg"])  # 友好错误提示含代理指引


class RenameTest(unittest.TestCase):
    """rename_file：自定义改名必须保留扩展名（前缀含点不误判）"""

    def setUp(self):
        import webui
        self.dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".test_tmp", "rename")
        os.makedirs(self.dir, exist_ok=True)
        self.app = webui.Api()
        self.app.api = FakeAPI()

    def _mk(self, name):
        p = os.path.join(self.dir, name)
        with open(p, "wb") as f:
            f.write(b"x")
        return p

    def test_prefix_with_dot_keeps_ext(self):
        # 前缀含点（如 "v1.8 前缀 Kisaki"）→ 扩展名必须保留 .safetensors
        p = self._mk("Kisaki v1.0.safetensors")
        r = self.app.rename_file(p, "v1.8 前缀 Kisaki")
        self.assertTrue(r["ok"], r)
        new_path = os.path.join(self.dir, "v1.8 前缀 Kisaki.safetensors")
        self.assertTrue(os.path.exists(new_path), "扩展名丢失: " + str(os.listdir(self.dir)))
        self.assertFalse(os.path.exists(p))

    def test_plain_prefix_keeps_ext(self):
        p = self._mk("Kisaki.safetensors")
        r = self.app.rename_file(p, "我的前缀 Kisaki")
        self.assertTrue(r["ok"], r)
        self.assertTrue(os.path.exists(os.path.join(self.dir, "我的前缀 Kisaki.safetensors")))

    def test_input_with_explicit_ext(self):
        p = self._mk("Kisaki.safetensors")
        r = self.app.rename_file(p, "新的名字.ckpt")
        self.assertTrue(r["ok"], r)
        self.assertTrue(os.path.exists(os.path.join(self.dir, "新的名字.ckpt")))

    def test_sides_renamed(self):
        p = self._mk("Kisaki.safetensors")
        with open(os.path.join(self.dir, "Kisaki.json"), "w", encoding="utf-8") as f:
            f.write("{}")
        r = self.app.rename_file(p, "新名")
        self.assertTrue(r["ok"], r)
        self.assertTrue(os.path.exists(os.path.join(self.dir, "新名.safetensors")))
        self.assertTrue(os.path.exists(os.path.join(self.dir, "新名.json")), "附属 json 未同步改名")

    def tearDown(self):
        import shutil
        if os.path.exists(self.dir):
            shutil.rmtree(self.dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
