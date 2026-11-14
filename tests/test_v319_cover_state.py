import json,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from PIL import Image
from webui import Api

class CoverStateTests(unittest.TestCase):
 def test_scan_bridge_and_set_cover_sidecar(self):
  with tempfile.TemporaryDirectory() as temp:
   model=Path(temp)/'fixture.safetensors';model.write_bytes(b'fixture');source=Path(temp)/'source.png';Image.new('RGB',(60,90),'blue').save(source)
   api=Api.__new__(Api);api.cfg={};api.model_rows=[];api.mm_scan_state={'running':False,'rows':[]};api._models_roots=lambda:[temp]
   with patch('threading.Thread',side_effect=lambda target,daemon:SimpleNamespace(start=target)):
    self.assertTrue(api.scan_models()['started']);rows=json.loads(api.get_scan_rows());self.assertEqual(len(rows),1);self.assertIs(rows[0]['has_cover'],False)
    result=api.set_model_cover(str(model),str(source));self.assertTrue(result['ok'],result);self.assertEqual(Path(result['cover']).parent,model.parent);self.assertTrue(Path(result['cover']).is_file());self.assertIs(json.loads(api.get_scan_rows())[0]['has_cover'],True)
    # Cached metadata must not keep a stale cover flag when a sidecar disappears.
    Path(result['cover']).unlink();api.scan_models();self.assertIs(json.loads(api.get_scan_rows())[0]['has_cover'],False)
    api.set_model_cover(str(model),str(source));api.scan_models();self.assertIs(json.loads(api.get_scan_rows())[0]['has_cover'],True)

if __name__=='__main__':unittest.main()
