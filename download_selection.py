"""Thread-safe transient file-choice broker. Does not store URLs, credentials or user data."""
import threading
import time
import uuid


class FileChoiceBroker:
    def __init__(self, timeout=10):
        self.timeout = timeout
        self.gate = threading.Lock()
        self.lock = threading.Lock()
        self.pending = None

    def choose(self, files, title, policy='ask'):
        if not files:
            raise ValueError('该版本没有可下载的模型文件')
        if len(files) == 1 or policy == 'first':
            return files[:1]
        if policy == 'all':
            return files[:]
        with self.gate:
            row = {'id': uuid.uuid4().hex, 'title': title, 'files': [
                {'index': i, 'name': f.get('name', ''), 'sizeKB': f.get('sizeKB', 0),
                 'metadata': {k: (f.get('metadata') or {}).get(k, '') for k in ('format', 'fp', 'size')},
                 'primary': bool(f.get('primary'))} for i, f in enumerate(files)],
                 'created': time.monotonic(), 'deadline': None, 'paused': False,
                 'result': None, 'event': threading.Event()}
            with self.lock:
                self.pending = row
            while not row['event'].wait(.05):
                with self.lock:
                    if row['deadline'] is not None and not row['paused'] and time.monotonic() >= row['deadline']:
                        row['result'] = [0]
                        row['event'].set()
                    # A lost UI after interaction must cancel, never unexpectedly download.
                    elif time.monotonic() >= (row['deadline'] or row['created']) + 600:
                        row['result'] = []
                        row['event'].set()
            with self.lock:
                result = row['result'] or []
                self.pending = None
            return [files[i] for i in result]

    def get(self):
        with self.lock:
            row = self.pending
            if not row or row['event'].is_set():
                return None
            return {k: row[k] for k in ('id', 'title', 'files', 'paused')} | {
                'shown': row['deadline'] is not None,
                'seconds': max(0, row['deadline'] - time.monotonic()) if row['deadline'] is not None else self.timeout}

    def acknowledge(self, identity):
        """Start the default timer only once the visible UI has actually shown the dialog."""
        with self.lock:
            row = self.pending
            if not row or row['id'] != identity or row['event'].is_set():
                return {'ok': False, 'msg': '选择已过期'}
            if row['deadline'] is None:
                row['deadline'] = time.monotonic() + self.timeout
            return {'ok': True}

    def respond(self, identity, indices=None, pause=False):
        with self.lock:
            row = self.pending
            if not row or row['id'] != identity or row['event'].is_set():
                return {'ok': False, 'msg': '选择已过期，请查看下载队列'}
            if pause:
                row['paused'] = True
                return {'ok': True}
            if not isinstance(indices, list) or any(isinstance(i, bool) or not isinstance(i, int) or i < 0 or i >= len(row['files']) for i in indices):
                return {'ok': False, 'msg': '文件选择无效'}
            row['result'] = list(dict.fromkeys(indices))
            row['event'].set()
            return {'ok': True}
