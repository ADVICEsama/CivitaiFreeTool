"""软件数据目录与安全迁移：仅迁移白名单应用数据，原目录保留，模型文件不移动。"""
from pathlib import Path
import json
import os
import shutil
import tempfile
import threading
import time

LOCK = threading.RLock()
RECORD_NAME = 'data_location.json'
JSON_NAMES = ('user_config.json','download_tasks.json','download_history.json','model_updates.json',
              'update_whitelist.json','todo_downloads.json','organize_log.json','browser_queue.json')
DATA_NAMES = tuple(name+suffix for name in JSON_NAMES for suffix in ('','.bak')) + ('history_assets','detail_thumb_cache','gallery_cache','error.log')

def global_record_path():
    return Path(os.environ.get('LOCALAPPDATA') or (Path.home()/'.local/share'))/'CivitaiFreeToolWeb'/RECORD_NAME

def suggested_directory():
    return global_record_path().parent/'data'

def resolve_directory(install_dir, use_global=False):
    """源代码运行不读全局安装记录，防止开发/测试加载用户的正式配置。"""
    install=Path(install_dir).resolve()
    records=[];warnings=[]
    for record in [install/RECORD_NAME] + ([global_record_path()] if use_global else []):
        if not record.exists(): continue
        try:
            data=json.loads(record.read_text(encoding='utf-8-sig'))
            if data.get('app') != 'CivitaiFreeTool': raise ValueError('unknown app')
            path=Path(data.get('data_dir',''))
            if not path.is_absolute(): raise ValueError('relative data directory')
            records.append((int(data.get('updated_at',0)),path.resolve()))
        except (OSError,ValueError,TypeError): warnings.append('数据位置记录无法读取')
    if records:
        _,path=max(records,key=lambda item:item[0])
        if path.is_dir(): return str(path),''
        warnings.append('自定义数据目录不可用，暂时读取软件旁保留的旧副本；请恢复目录或重新选择位置')
    return str(install),'；'.join(warnings)

def _atomic_record(path,data):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    fd,temp=tempfile.mkstemp(prefix='cft-location-',suffix='.tmp',dir=path.parent)
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as f:
            json.dump(data,f,ensure_ascii=False,indent=2);f.flush();os.fsync(f.fileno())
        os.replace(temp,path)
    finally:
        if os.path.exists(temp):os.unlink(temp)

def _is_link(path):
    return path.is_symlink() or bool(getattr(path.lstat(),'st_file_attributes',0)&0x400)

def _check_tree(path):
    if _is_link(path): raise ValueError('数据包含链接或目录联接，请先移除链接后重试')
    if path.is_dir():
        for root,dirs,files in os.walk(path,followlinks=False):
            for name in dirs+files:
                if _is_link(Path(root)/name): raise ValueError('数据包含链接或目录联接，已拒绝跟随')

def _remove_stage(stage,target):
    """只删除本次创建的、位于显式目标目录内的临时目录。"""
    stage=Path(stage);target=Path(target).resolve()
    resolved=stage.resolve()
    if resolved.parent!=target or not stage.name.startswith('cft-data-stage-') or _is_link(stage):
        raise ValueError('临时清理范围校验失败')
    shutil.rmtree(stage)

def migrate(source,target,install_dir,replace_existing=False,use_global=False,snapshot=None):
    """先完整复制并校验，再原子提交定位文件；失败不切换当前目录。"""
    with LOCK:
        source=Path(source).resolve();install=Path(install_dir).resolve()
        raw=Path(str(target).strip()).expanduser()
        if not str(target).strip() or not raw.is_absolute(): return {'ok':False,'msg':'请填写绝对目录路径'}
        target=raw.resolve()
        if target==source:return {'ok':True,'directory':str(source),'msg':'已经使用该数据位置','changed':False}
        if target==Path(target.anchor):return {'ok':False,'msg':'请使用专用文件夹，不要直接使用磁盘根目录'}
        # 返回 exe 旁是允许的；其他源/目标嵌套会使缓存复制自身，明确拒绝。
        if source in target.parents or target in source.parents:
            return {'ok':False,'msg':'数据目录不能与当前目录互相嵌套，请选独立文件夹'}
        if target.exists() and not target.is_dir():return {'ok':False,'msg':'目标是文件，不是目录'}
        snapshot=snapshot or {}
        if any(name not in JSON_NAMES for name in snapshot):return {'ok':False,'msg':'无效的数据快照字段'}
        names=[name for name in DATA_NAMES if (source/name).exists() or name in snapshot]
        conflicts=[name for name in DATA_NAMES if (target/name).exists()]
        if conflicts and not replace_existing:
            return {'ok':False,'need_confirm':True,'conflicts':conflicts,'msg':'目标已有软件数据。确认后会先备份目标旧数据，再迁移当前数据'}
        stage=None;backup=None;committed=[];old_locations=[]
        try:
            target.mkdir(parents=True,exist_ok=True)
            for name in names:
                if (source/name).exists():_check_tree(source/name)
            for name in conflicts:_check_tree(target/name)
            stage=Path(tempfile.mkdtemp(prefix='cft-data-stage-',dir=target))
            for name in names:
                src=source/name;dst=stage/name
                if name in snapshot:
                    with open(dst,'w',encoding='utf-8') as f:
                        json.dump(snapshot[name],f,ensure_ascii=False,indent=2);f.flush();os.fsync(f.fileno())
                    with open(dst,encoding='utf-8') as f:
                        if json.load(f)!=snapshot[name]:raise OSError('数据快照校验失败')
                    continue
                if src.is_dir():shutil.copytree(src,dst)
                else:shutil.copy2(src,dst)
                # 校验文件大小与内容，不只检查是否复制成功。
                import hashlib
                files=src.rglob('*') if src.is_dir() else [src]
                for f in files:
                    if not f.is_file():continue
                    copied=dst/f.relative_to(src) if src.is_dir() else dst
                    def digest(p):
                        h=hashlib.sha256()
                        with open(p,'rb') as stream:
                            for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
                        return h.digest()
                    if digest(f)!=digest(copied):raise OSError('复制校验失败')
            if conflicts:
                backup=target/('CFT-data-backup-'+str(time.time_ns()));backup.mkdir()
                for name in conflicts:os.replace(target/name,backup/name)
            for name in names:
                os.replace(stage/name,target/name);committed.append(name)
            record={'app':'CivitaiFreeTool','version':1,'data_dir':str(target),'updated_at':time.time_ns()}
            locations=[install/RECORD_NAME]+([global_record_path()] if use_global else [])
            # 两个定位文件均需可写；任意失败则回滚定位和目标数据，旧源数据从不删除。
            successful=0;location_warnings=[]
            for location in locations:
                try:
                    previous=location.read_bytes() if location.exists() else None
                    _atomic_record(location,record)
                    old_locations.append((location,previous));successful+=1
                except OSError:location_warnings.append(str(location))
            if not successful:raise OSError('无法保存数据定位记录，请检查目录权限')
            return {'ok':True,'changed':True,'directory':str(target),'copied_items':len(names),
                    'backup':str(backup) if backup else '', 'locator_warning':bool(location_warnings), 'msg':'已切换软件数据位置；原数据保留，模型文件未移动'}
        except (OSError,ValueError) as e:
            for location,old in reversed(old_locations):
                try:
                    if old is None:location.unlink(missing_ok=True)
                    else:
                        fd,temp=tempfile.mkstemp(dir=location.parent,prefix='cft-rollback-')
                        with os.fdopen(fd,'wb') as f:f.write(old)
                        os.replace(temp,location)
                except OSError:pass
            # 目标新数据先收回临时目录，再恢复目标的旧备份；没有删除任何旧数据。
            if stage and stage.exists():
                for name in committed:
                    try:os.replace(target/name,stage/name)
                    except OSError:pass
            if backup and backup.exists():
                for name in conflicts:
                    if (backup/name).exists():
                        try:os.replace(backup/name,target/name)
                        except OSError:pass
            return {'ok':False,'msg':'数据迁移未完成，当前位置不变：'+str(e)[:180]}
        finally:
            if stage and stage.exists():_remove_stage(stage,target)
