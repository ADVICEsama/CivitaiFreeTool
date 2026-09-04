# -*- coding: utf-8 -*-
"""Cross-platform helpers for non-Windows systems (Linux/macOS).

On Windows the original code paths are untouched; every function here is only
wired in via ``IS_WINDOWS`` branches at the call sites. All implementations
follow freedesktop standards so they work on GNOME/KDE/X11/Wayland alike:

- open_url / open_in_folder -> xdg-open / DBus org.freedesktop.FileManager1
- trash                      -> gio trash (gvfs) or trash-put (trash-cli);
                                rm is intentionally NOT used (data safety)
- clipboard                  -> wl-copy/wl-paste (Wayland), xclip/xsel (X11),
                                then pbcopy/paste (macOS)
"""
import os
import shutil
import subprocess
import urllib.parse

IS_WINDOWS = os.name == "nt"


def _run(cmd, timeout=5):
    """Run a command detached from our stdio; return (ok, stdout)."""
    try:
        p = subprocess.run(
            cmd,
            capture_output=True,
            timeout=timeout,
            stdin=subprocess.DEVNULL,
        )
        return p.returncode == 0, p.stdout
    except Exception:
        return False, b""


def open_url(url):
    """Open a URL (or any path) with the system handler. Returns bool."""
    if not url:
        return False
    if os.name == "darwin":
        ok, _ = _run(["open", url])
        return ok
    ok, _ = _run(["xdg-open", url])
    return ok


def open_in_folder(path):
    """Reveal a file/folder in the desktop file manager (select if possible).

    Returns {"ok": bool, "msg": str}; same shape as the Win32 original.
    """
    path = os.path.abspath(path)
    if not os.path.exists(path):
        return {"ok": False, "msg": "path does not exist"}
    if os.name == "darwin":
        cmd = ["open", "-R", path] if os.path.isfile(path) else ["open", path]
        ok, _ = _run(cmd)
        return {"ok": ok, "msg": "" if ok else "cannot open"}

    # Preferred: DBus FileManager1 interface (works under both X11 and Wayland,
    # supported by Nautilus/Dolphin/Nemo/Thunar file managers).
    # quote() percent-encodes spaces/quotes/non-ASCII (safe='/' only), so the
    # URI can never break out of the GVariant single-quoted string; argv form
    # means no shell is involved at all.
    if os.path.isfile(path):
        uri = "file://" + urllib.parse.quote(path)
        ok, _ = _run([
            "gdbus", "call", "--session",
            "--dest", "org.freedesktop.FileManager1",
            "--object-path", "/org/freedesktop/FileManager1",
            "--method", "org.freedesktop.FileManager1.ShowItems",
            "['%s']" % uri, "",
        ])
        if ok:
            return {"ok": True, "msg": ""}

    ok, _ = _run(["xdg-open", os.path.dirname(path) if os.path.isfile(path) else path])
    return {"ok": ok, "msg": "" if ok else "cannot open"}


def trash(paths):
    """Move files to the desktop trash (freedesktop). Returns bool (all-or-nothing).

    Tries gio (gvfs) then trash-put (trash-cli). Neither available -> False
    (we never fall back to rm: unrecoverable deletion is not acceptable).
    """
    paths = [p for p in paths if p and os.path.exists(p)]
    if not paths:
        return True
    for tool in (["gio", "trash"], ["trash-put"]):
        if shutil.which(tool[0]):
            ok, _ = _run(tool + paths)
            if ok:
                return True
    return False


def get_clipboard_text():
    """Read the system clipboard. Returns str ('' on failure)."""
    if os.name == "darwin":
        ok, out = _run(["pbpaste"])
        return out.decode("utf-8", "replace") if ok else ""
    for cmd in (["wl-paste", "--no-newline"], ["xclip", "-o", "-selection", "clipboard"],
                ["xsel", "-o", "-b"]):
        if shutil.which(cmd[0]):
            ok, out = _run(cmd)
            if ok:
                return out.decode("utf-8", "replace")
    return ""


def copy_clipboard_text(text):
    """Write text to the system clipboard. Returns bool."""
    text = str(text or "")
    if not text:
        return False
    # All clipboard tools need stdin; use Popen rather than _run (DEVNULL stdin)
    tools = []
    if os.name == "darwin":
        tools = [["pbcopy"]]
    else:
        if shutil.which("wl-copy"):
            tools.append(["wl-copy"])
        if shutil.which("xclip"):
            tools.append(["xclip", "-selection", "clipboard"])
        if shutil.which("xsel"):
            tools.append(["xsel", "-b", "-i"])
    for cmd in tools:
        try:
            p = subprocess.Popen(
                cmd, stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            try:
                p.communicate(text.encode("utf-8"), timeout=5)
            except subprocess.TimeoutExpired:
                # xclip/xsel must stay resident to keep owning the selection;
                # stdin was already fully consumed, so the clipboard is set.
                # Do NOT kill the process -- that would clear the clipboard.
                return True
            if p.returncode == 0:
                return True
        except Exception:
            continue
    return False
