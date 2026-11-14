"""Bounded, read-only software update check against the official stable release."""
import json,re,urllib.request
ENDPOINT='https://api.github.com/repos/ADVICEsama/CivitaiFreeTool/releases/latest'
def version_tuple(value):
 match=re.fullmatch(r'v?(\d+)\.(\d+)\.(\d+)',str(value))
 if not match:raise ValueError('not a stable semantic version')
 return tuple(map(int,match.groups()))
def _primary(current,opener):
 request=urllib.request.Request(ENDPOINT,headers={'Accept':'application/vnd.github+json','User-Agent':'CivitaiFreeTool/'+current})
 with opener.open(request,timeout=6) as response:
  raw=response.read(1024*1024+1)
 if len(raw)>1024*1024:return {'ok':False}
 release=json.loads(raw);tag=release.get('tag_name','');latest=version_tuple(tag)
 if release.get('draft') or release.get('prerelease'):return {'ok':False}
 return {'ok':True,'available':latest>version_tuple(current),'version':tag.lstrip('v'),'url':'https://github.com/ADVICEsama/CivitaiFreeTool/releases/tag/'+tag}

def check(current,opener):
 try:
  return _primary(current,opener)
 except Exception:
  # API rate limits do not affect the public stable-release redirect.
  try:
   request=urllib.request.Request('https://github.com/ADVICEsama/CivitaiFreeTool/releases/latest',headers={'User-Agent':'CivitaiFreeTool/'+current})
   with opener.open(request,timeout=6) as response:url=response.geturl()
   match=re.fullmatch(r'https://github\.com/ADVICEsama/CivitaiFreeTool/releases/tag/(v?\d+\.\d+\.\d+)',url)
   if not match:return {'ok':False}
   tag=match[1]
   return {'ok':True,'available':version_tuple(tag)>version_tuple(current),'version':tag.lstrip('v'),'url':url,'source':'release-page'}
  except Exception:return {'ok':False}
