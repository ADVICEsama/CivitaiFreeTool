"""发布流程测试：假 Git/HTTP/凭据，不触碰真实 GitHub 或认证信息。"""
import unittest,sys,json,io,hashlib,importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.parse import urlsplit,parse_qs
from urllib.error import HTTPError
spec=importlib.util.spec_from_file_location('release_verified',Path(__file__).resolve().parents[1]/'scripts'/'release_verified.py')
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)

class ReleaseTests(unittest.TestCase):
    def fixture(self,d):
        folder=Path(d);names=['CivitaiFreeToolWeb-2.6.0.exe','CivitaiFreeTool-Windows-v2.6.0.zip','CivitaiFreeTool-ChromeExtension-v2.6.0.zip','CivitaiFreeTool-FirefoxExtension-v2.6.0.zip','CivitaiFreeTool-Source-v2.6.0.zip','SHA256SUMS.txt']
        assets=[]
        for name in names:
            data=('fixture '+name).encode();(folder/name).write_bytes(data);assets.append({'name':name,'size':len(data),'sha256':hashlib.sha256(data).hexdigest()})
        manifest={'version':'2.6.0','commit':'a'*40,'assets':assets};(folder/'release_assets.json').write_text(json.dumps(manifest),encoding='utf-8');(folder/'notes.md').write_text('Fixture release notes',encoding='utf-8')
        return folder,manifest,['release','2.6.0',str(folder/'notes.md'),'--assets-dir',str(folder)]
    def test_wrong_remote_commit_blocks_before_authentication(self):
        with TemporaryDirectory() as d:
            folder,m,argv=self.fixture(d)
            with patch.object(sys,'argv',argv),patch.object(release,'git',side_effect=['a'*40,'b'*40+'\trefs/heads/main']),patch.object(release,'authentication') as auth:
                with self.assertRaises(RuntimeError):release.main()
                auth.assert_not_called()
    def test_bad_local_hash_blocks_before_authentication(self):
        with TemporaryDirectory() as d:
            folder,m,argv=self.fixture(d);(folder/m['assets'][0]['name']).write_bytes(b'changed')
            with patch.object(sys,'argv',argv),patch.object(release,'git',side_effect=['a'*40,'a'*40+'\trefs/heads/main']),patch.object(release,'authentication') as auth:
                with self.assertRaises(RuntimeError):release.main()
                auth.assert_not_called()
    def test_all_assets_verified_before_publication(self):
        with TemporaryDirectory() as d:
            folder,m,argv=self.fixture(d);uploaded=[];published=[]
            class Opener:
                def open(self,req,timeout=0):
                    url=req.full_url;method=req.get_method()
                    if '/releases/tags/' in url:raise HTTPError(url,404,'fixture absent',None,None)
                    if method=='POST' and url.endswith('/releases'):
                        body=json.loads(req.data);self.assertion=body['draft'];assert body['target_commitish']=='a'*40
                        data={'id':77,'html_url':'https://github.com/ADVICEsama/CivitaiFreeTool/releases/tag/v2.6.0','draft':True,'assets':[],'upload_url':'https://uploads.github.com/fixture{?name}'}
                    elif 'uploads.github.com' in url:
                        name=parse_qs(urlsplit(url).query)['name'][0];asset=next(a for a in m['assets'] if a['name']==name);uploaded.append(name)
                        data={'size':len(req.data),'digest':'sha256:'+hashlib.sha256(req.data).hexdigest(),'browser_download_url':'https://example.invalid/'+name}
                    else:
                        assert method=='PATCH' and len(uploaded)==6;published.append(True);data={'html_url':'https://github.com/ADVICEsama/CivitaiFreeTool/releases/tag/v2.6.0','draft':False}
                    return io.BytesIO(json.dumps(data).encode())
            with patch.object(sys,'argv',argv),patch.object(release,'git',side_effect=['a'*40,'a'*40+'\trefs/heads/main']),patch.object(release,'authentication',return_value='fixture-not-real'),patch.object(release.urllib.request,'build_opener',return_value=Opener()):release.main()
            self.assertEqual(len(uploaded),6);self.assertEqual(published,[True]);self.assertFalse(json.loads((folder/'github-release-receipt.json').read_text())['draft'])
    def test_credentials_removed_on_external_redirect(self):
        req=release.urllib.request.Request('https://api.github.com/asset',headers={'Authorization':'Bearer fixture-not-real'})
        redirect=release.SafeRedirect().redirect_request(req,None,302,'fixture',{},'https://objects.githubusercontent.com/asset')
        self.assertNotIn('Authorization',dict(redirect.header_items()))

if __name__=='__main__':unittest.main()
