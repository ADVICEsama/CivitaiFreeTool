# -*- coding: utf-8 -*-
"""在线翻译：优先百度翻译开放平台（需 APP ID + 密钥），未配置时回退 mymemory 免费接口。
失败/超限时返回原文，不影响主流程。"""
import hashlib
import json
import random
import re
import urllib.parse
import urllib.request

BAIDU_URL = "https://fanyi-api.baidu.com/api/trans/vip/translate"
MAX_SEG = 1200        # 单段字符数（百度单次 q 限 6000 字节，中文 3 字节/字，留余量）
MAX_BYTES = 5500      # 单段字节上限


def _is_cjk(text):
    """粗略判断文本是否已含大量中文（已翻译的不再翻）"""
    if not text:
        return False
    cjk = sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff")
    return cjk / max(1, len(text)) > 0.3


def baidu_translate(text, appid, key, to="zh", from_lang="auto", timeout=15):
    """百度翻译通用 API：md5(appid+q+salt+key) 签名。失败抛异常。"""
    if not text or not appid or not key:
        raise ValueError("百度翻译未配置 APP ID / 密钥")
    salt = str(random.randint(10000, 99999))
    sign = hashlib.md5((appid + text + salt + key).encode("utf-8")).hexdigest()
    body = urllib.parse.urlencode({
        "q": text, "from": from_lang, "to": to,
        "appid": appid, "salt": salt, "sign": sign,
    }).encode("utf-8")
    req = urllib.request.Request(BAIDU_URL, data=body, headers={
        "User-Agent": "Mozilla/5.0",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.loads(r.read().decode("utf-8"))
    if "error_code" in d:
        raise RuntimeError("百度翻译错误 %s: %s" % (d["error_code"], d.get("error_msg", "")))
    return "".join(x.get("dst", "") for x in d.get("trans_result", []))


def _split_segments(text, max_chars=MAX_SEG):
    """按句子切分，控制每段长度（字符与字节双重限制）"""
    segs, cur = [], ""
    parts = re.split(r"(?<=[.!?。！？])\s*", text)
    if len(parts) <= 1:
        parts = [text[i:i + max_chars] for i in range(0, len(text), max_chars)]
    for p in parts:
        if len(cur) + len(p) + 1 > max_chars or len(cur.encode("utf-8")) > MAX_BYTES:
            if cur:
                segs.append(cur)
            cur = p
        else:
            cur = (cur + " " + p) if cur else p
    if cur:
        segs.append(cur)
    return segs


def translate(text, appid=None, key=None, timeout=15):
    """整段翻译：配置了百度 key 用百度，否则 mymemory。失败返回原文。"""
    if not text:
        return text
    text = text.strip()
    try:
        if appid and key:
            out = " ".join(baidu_translate(s, appid, key, timeout=timeout)
                           for s in _split_segments(text))
            return out if out else text
        # 回退 mymemory
        if len(text) <= MAX_SEG:
            out = _mymemory(text)
            return out if out else text
        out_parts = []
        for s in _split_segments(text):
            out_parts.append(_mymemory(s) or s)
        return " ".join(out_parts)
    except Exception:
        return text


def _mymemory(text):
    url = "https://api.mymemory.translated.net/get?q=%s&langpair=en|zh-CN" % urllib.parse.quote(text)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return (data.get("responseData") or {}).get("translatedText") or ""
