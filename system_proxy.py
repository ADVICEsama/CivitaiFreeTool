"""Use an explicitly configured, reachable Windows HTTP proxy at startup.

No port scanning, public connectivity probes, or TLS verification changes.
TUN-only VPNs need no explicit HTTP proxy and are not guessed from processes.
"""
import socket
import sys
import urllib.parse
import urllib.request


def enable_detected_proxy(cfg):
    if cfg.get('proxy_enabled') or sys.platform != 'win32':
        return False
    try:
        proxies = urllib.request.getproxies_registry()
        value = proxies.get('https') or proxies.get('http') or ''
        if not value:
            return False
        value = value if '://' in value else 'http://' + value
        parts = urllib.parse.urlsplit(value)
        if parts.scheme not in ('http', 'https') or not parts.hostname or parts.username or parts.password:
            return False
        with socket.create_connection((parts.hostname, parts.port or (443 if parts.scheme == 'https' else 80)), timeout=.35):
            pass
    except (OSError, ValueError, AttributeError):
        return False
    cfg.update(proxy_enabled=True, proxy_address=value)
    return True
