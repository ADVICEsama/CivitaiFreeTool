# -*- coding: utf-8 -*-
"""v1.5.5.2 前端集成测试：多目录设置 / 引导 / 右键菜单 / data-tip"""
import sys, os, json, time, tempfile, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import webview, config

tmp = tempfile.mkdtemp()
old_APP_DIR = config.APP_DIR
config.APP_DIR = tmp
config.save(config.DEFAULTS.copy())

import webui as webui_mod
api = webui_mod.Api()
api.cfg = dict(config.load())
cfg = api.cfg
cfg["download_dir"] = os.path.join(tmp, "dl")
cfg["models_dir"] = os.path.join(tmp, "dl", "models")
os.makedirs(cfg["download_dir"], exist_ok=True)
os.makedirs(cfg["models_dir"], exist_ok=True)
config.save(cfg)

webview.create_window("CFT Test", "web/index.html", js_api=api, width=1200, height=800)

def test_main():
    window = webview.windows[0]
    def js(expr):
        return window.evaluate_js(expr)
    def wait_js(expr, timeout=15):
        for _ in range(timeout * 10):
            try:
                r = window.evaluate_js(expr)
                if r not in (None, "null", ""):
                    return r
            except Exception:
                pass
            time.sleep(0.1)
        return None
    try:
        wait_js("window.__ready === true")
        # 1) 设置页 models_dirs textarea
        js("buildSettingsForm()")
        r = js("!!document.querySelector('#settingsForm textarea[data-key=\\'models_dirs\\']')")
        print("设置页 models_dirs textarea:", r)
        assert r, "models_dirs textarea 未渲染"
        # 2) 保存解析
        js("document.querySelector(\"#settingsForm textarea[data-key='models_dirs']\").value = 'C:\\\\a\\\\models\\nD:\\\\b\\\\models'")
        r = json.loads(js("""
          (() => {
            const cfg = {};
            Object.assign(cfg, state.cfg);
            document.querySelectorAll('#settingsForm [data-key]').forEach(el => {
              const k = el.dataset.key;
              if (el.type === 'checkbox') cfg[k] = el.checked;
              else if (el.type === 'number') cfg[k] = Number(el.value);
              else if (el.tagName === 'TEXTAREA') cfg[k] = el.value.split('\\n').map(s => s.trim()).filter(Boolean);
              else cfg[k] = el.value;
            });
            return JSON.stringify({k: cfg.models_dirs});
          })()
        """))
        print("保存解析:", r["k"])
        assert r["k"] == ["C:\\a\\models", "D:\\b\\models"], "textarea 按行解析失败"
        # 3) 引导 5 步
        js("showOnboarding()")
        steps = js("document.querySelectorAll('.ob-step').length")
        print("引导步数:", steps)
        assert steps == 5, "引导应为 5 步"
        js("obStep = 3; renderOnboarding()")
        assert js("!!document.getElementById('obModelDirs')"), "模型目录步骤未渲染"
        js("obStep = 4; renderOnboarding()")
        assert js("!!document.getElementById('obGoRp') && !!document.getElementById('obSkipRp')"), "反向解析步骤未渲染"
        js("document.getElementById('obMask').style.display='none'")
        # 4) 列表右键 folder
        js("document.getElementById('ctxMenu').innerHTML = '<div class=\\'ctx-item\\' data-act=\\'folder\\'>📂 打开所在文件夹</div>';")
        assert js("!!document.querySelector('#ctxMenu [data-act=\\'folder\\']')"), "列表右键 folder 缺失"
        # 5) 图片右键 img_tags
        js("document.getElementById('ctxMenu').innerHTML = '<div class=\\'ctx-item\\' data-act=\\'img_tags\\'>🏷️</div>';")
        assert js("!!document.querySelector('#ctxMenu [data-act=\\'img_tags\\']')"), "图片右键 img_tags 缺失"
        # 6) data-tip
        js("buildSettingsForm()")
        n = js("document.querySelectorAll('#settingsForm [data-tip]').length")
        print("设置项 data-tip:", n)
        assert n >= 10, "设置项 data-tip 过少"
        n2 = js("document.querySelectorAll('.btn[data-tip]').length")
        print("按钮 data-tip:", n2)
        assert n2 >= 5, "按钮 data-tip 过少"
        print("V1552 FRONTEND TEST OK")
        code = 0
    except AssertionError as e:
        print("ERR:", e)
        code = 1
    except Exception as e:
        print("ERR:", repr(e))
        code = 1
    finally:
        config.APP_DIR = old_APP_DIR
        shutil.rmtree(tmp, ignore_errors=True)
        try:
            window.destroy()
        except Exception:
            pass
        time.sleep(0.3)
        os._exit(code)

webview.start(test_main, debug=False)
