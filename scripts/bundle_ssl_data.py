"""Collect SSL runtime resources without changing certificate verification policy."""
from pathlib import Path
import ssl


def collect_ssl_runtime_data(ssl_module=ssl):
    source = Path(ssl_module.__file__)
    data = []
    # Some Python distributions load an additional CA resource in SSLContext.__new__.
    # Preserve that distribution's policy rather than replacing SSLContext or disabling TLS.
    for name in ('codex-rejected-cas.pem',):
        resource = source.parent / name
        if resource.is_file():
            data.append((str(resource), '.'))
        elif source.is_file() and name in source.read_text(encoding='utf-8'):
            raise FileNotFoundError('Required SSL runtime resource is missing: ' + name)
    return data
