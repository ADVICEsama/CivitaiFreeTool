"""Explicit metadata association for a downloaded file whose checksum did not pass.

This never changes model bytes, the expected download checksum or task success state.
"""
import copy
import hashlib
import json
import os
import tempfile
import time

import civitai_api


def eligible(task):
    return task.status == 'error' and 'SHA256 校验失败' in task.error


def binding_matches(task):
    binding = (task.info or {}).get('manual_binding') or {}
    return bool(task.actual_sha256 and binding.get('actual_sha256') == task.actual_sha256)


def inspect(task):
    if not eligible(task):
        raise ValueError('仅 SHA256 不一致的结束任务可手动关联')
    expected = civitai_api.normalize_sha256(task.expected_sha256)
    if not expected:
        raise ValueError('任务缺少有效的官方 SHA256，不能确认关联来源')
    if not task.dest_dir or not task.filename or os.path.basename(task.filename) != task.filename:
        raise ValueError('任务文件名或目录无效')
    path = os.path.abspath(os.path.join(task.dest_dir, task.filename))
    if os.path.islink(path) or not os.path.isfile(path):
        raise ValueError('下载文件不存在或已移动；不关联残留 .part 文件')
    before = os.stat(path)
    if not task.total or before.st_size != task.total:
        raise ValueError('文件大小不完整，不能手动关联')
    sha = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            sha.update(block)
    after = os.stat(path)
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError('文件读取期间发生变化，请重新检查')
    if not eligible(task):
        raise ValueError('任务状态已变化，请重新检查')
    info = ((task.info or {}).get('meta') or {}).get('info') or {}
    mid = info.get('modelId') or info.get('id')
    vid = info.get('versionId')
    if not str(mid or '').isdigit() or not str(vid or '').isdigit():
        raise ValueError('任务未保留明确的 C站模型与版本信息，不能猜测绑定')
    actual = sha.hexdigest()
    version = info.get('version') or {}
    return {'ok': True, 'path': path, 'filename': task.filename, 'bytes': before.st_size,
            'actual_sha256': actual, 'expected_sha256': expected,
            'model_id': int(mid), 'version_id': int(vid), 'file_id': (task.info or {}).get('fileId'),
            'model_name': info.get('name', ''), 'version_name': version.get('name', '') if isinstance(version,dict) else str(version),
            'hash_verified': actual == expected}


def associate(task, proof, confirmed, cfg):
    if confirmed is not True:
        raise ValueError('必须明确确认仅关联信息，不代表校验通过')
    report = inspect(task)
    if not isinstance(proof, str) or proof != report['actual_sha256']:
        raise ValueError('文件与确认时不同，请重新打开关联窗口')
    if report['hash_verified']:
        raise ValueError('文件现在已匹配官方哈希，无需手动关联未校验文件')
    annotation = {**{k: report[k] for k in ('actual_sha256', 'expected_sha256', 'model_id', 'version_id', 'file_id')},
                  'method': 'manual_download_association', 'hash_verified': False, 'confirmed_at': time.time()}
    info = copy.deepcopy(task.info['meta']['info'])
    info['localSha256'] = report['actual_sha256']
    info['association'] = annotation
    # Original hashes remain explicit provenance, never masquerading as local-file hashes.
    files = info.get('files') or []
    if files and isinstance(files[0], dict):
        files[0]['civitaiHashes'] = files[0].get('hashes') or {}
        files[0]['hashes'] = {'SHA256': report['actual_sha256'].upper()}
    base = os.path.splitext(report['path'])[0]
    for suffix in ('.civitai.info', '.info.json', '.json'):
        if os.path.lexists(base + suffix):
            raise ValueError('已有模型信息文件，未自动覆盖。请先核对现有信息')
    target = base + '.civitai.info'
    temp = None
    try:
        fd, temp = tempfile.mkstemp(prefix='.cft-binding-', suffix='.tmp', dir=os.path.dirname(target))
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(info, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.flush(); os.fsync(handle.fileno())
        # Same-directory hard link publishes complete JSON atomically without overwriting a race winner.
        os.link(temp, target)
    finally:
        if temp and os.path.isfile(temp):
            os.unlink(temp)
    task.info['meta']['info'] = info
    task.info['manual_binding'] = annotation
    task.actual_sha256 = report['actual_sha256']
    task.verification_status = 'mismatch'
    return {**report, 'info_path': target, 'hash_verified': False,
            'msg': '已关联 C站信息；SHA256 仍不一致，文件未修改，也未标为校验成功'}
