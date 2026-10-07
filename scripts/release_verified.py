"""已推送源码的发布：完整附件先校验、创建草稿、全部验证后公开。认证只在内存。"""
import argparse,hashlib,json,os,subprocess
from pathlib import Path
import urllib.request,urllib.error
from urllib.parse import quote,urlsplit
ROOT=Path(__file__).resolve().parents[1]
API='https://api.github.com/repos/ADVICEsama/CivitaiFreeTool'

def git(*args):
    return subprocess.check_output(['git','-c','safe.directory='+str(ROOT),'-C',str(ROOT),*args],text=True).strip()

def authentication():
    value=os.environ.get('GITHUB_TOKEN') or os.environ.get('GH_TOKEN')
    if value:return value
    env=dict(os.environ,GIT_TERMINAL_PROMPT='0',GCM_INTERACTIVE='Never')
    p=subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',text=True,capture_output=True,timeout=30,env=env)
    return next((line.split('=',1)[1] for line in p.stdout.splitlines() if line.startswith('password=')), '')

class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,*args):
        result=super().redirect_request(req,*args)
        if result is not None and urlsplit(result.full_url).hostname not in ('api.github.com','uploads.github.com'):
            result.headers={k:v for k,v in result.header_items() if k.lower()!='authorization'}
        return result

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('version');parser.add_argument('notes');parser.add_argument('--assets-dir',type=Path,required=True)
    args=parser.parse_args();version=args.version.lstrip('v');tag='v'+version
    head=git('rev-parse','HEAD');remote=git('ls-remote','origin','refs/heads/main').split()[0]
    if remote!=head:raise RuntimeError('origin/main 未包含当前提交；请先安全推送源码')
    manifest=json.loads((args.assets_dir/'release_assets.json').read_text(encoding='utf-8'))
    if manifest['version']!=version or manifest['commit']!=head:raise RuntimeError('附件清单与版本或源码提交不一致')
    required={'CivitaiFreeToolWeb-'+version+'.exe','CivitaiFreeTool-Windows-'+tag+'.zip','CivitaiFreeTool-ChromeExtension-'+tag+'.zip','CivitaiFreeTool-FirefoxExtension-'+tag+'.zip','CivitaiFreeTool-Source-'+tag+'.zip','SHA256SUMS.txt'}
    if {a['name'] for a in manifest['assets']}!=required:raise RuntimeError('缺少必要附件')
    for a in manifest['assets']:
        data=(args.assets_dir/a['name']).read_bytes()
        if len(data)!=a['size'] or hashlib.sha256(data).hexdigest()!=a['sha256']:raise RuntimeError('本地附件校验失败: '+a['name'])
    auth=authentication()
    if not auth:raise RuntimeError('GitHub 认证不可用，请通过 Git Credential Manager 登录；不要在聊天里粘贴凭据')
    opener=urllib.request.build_opener(SafeRedirect())
    headers={'Authorization':'Bearer '+auth,'Accept':'application/vnd.github+json','User-Agent':'CivitaiFreeTool-release','X-GitHub-Api-Version':'2022-11-28'}
    def request(url,body=None,method=None):
        payload=json.dumps(body).encode() if body is not None else None
        req=urllib.request.Request(url,data=payload,headers=headers,method=method or ('POST' if payload else 'GET'))
        if payload:req.add_header('Content-Type','application/json')
        with opener.open(req,timeout=90) as r:return json.load(r)
    try:release=request(API+'/releases/tags/'+tag)
    except urllib.error.HTTPError as e:
        if e.code!=404:raise
        release=request(API+'/releases',{'tag_name':tag,'target_commitish':head,'name':'CivitaiFreeTool '+tag,'body':Path(args.notes).read_text(encoding='utf-8-sig'),'draft':True,'prerelease':False})
    print('校验发布:',release['html_url'],flush=True)
    existing={a['name']:a for a in release.get('assets',[])};verified=[]
    for a in manifest['assets']:
        asset=existing.get(a['name'])
        if asset is None:
            if not release.get('draft'):raise RuntimeError('已公开发布缺少附件，拒绝改写旧发布: '+a['name'])
            req=urllib.request.Request(release['upload_url'].split('{')[0]+'?name='+quote(a['name']),data=(args.assets_dir/a['name']).read_bytes(),headers={**headers,'Content-Type':'application/octet-stream'},method='POST')
            with opener.open(req,timeout=1800) as r:asset=json.load(r)
        if asset['size']!=a['size']:raise RuntimeError('远端大小不一致: '+a['name'])
        digest=asset.get('digest')
        if digest:
            if digest!='sha256:'+a['sha256']:raise RuntimeError('远端 SHA256 不一致: '+a['name'])
        else:
            req=urllib.request.Request(asset['url'],headers={**headers,'Accept':'application/octet-stream'});sha=hashlib.sha256()
            with opener.open(req,timeout=1800) as r:
                for chunk in iter(lambda:r.read(1024*1024),b''):sha.update(chunk)
            if sha.hexdigest()!=a['sha256']:raise RuntimeError('远端下载校验失败: '+a['name'])
        verified.append({'name':a['name'],'size':a['size'],'sha256':a['sha256'],'url':asset['browser_download_url']});print('附件已校验:',a['name'],flush=True)
    if release.get('draft'):release=request(API+'/releases/'+str(release['id']),{'draft':False},method='PATCH')
    receipt={'version':version,'commit':head,'url':release['html_url'],'draft':release['draft'],'verified_assets':verified}
    (args.assets_dir/'github-release-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'url':receipt['url'],'draft':receipt['draft'],'attachments':len(verified)},ensure_ascii=False),flush=True)

if __name__=='__main__':
    try:main()
    except Exception as error:
        print('发布未完成:',type(error).__name__,str(error)[:200]);raise SystemExit(1)
