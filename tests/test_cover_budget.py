import unittest,tempfile,json,io
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from webui import Api
class CoverBudgetTests(unittest.TestCase):
 def test_edge_and_encoded_cache_bounded(self):
  with tempfile.TemporaryDirectory() as temp:
   path=Path(temp)/'cover.jpg';Image.new('RGB',(1800,1200),'#557799').save(path)
   a=Api.__new__(Api);a._cover_cache={('old',i):'x'*200 for i in range(210)}
   with patch('model_manager.find_cover',return_value=str(path)):
    out=json.loads(a.get_covers(['synthetic'],10000))
   import base64
   self.assertEqual(Image.open(io.BytesIO(base64.b64decode(out['synthetic']))).size,(1280,853));self.assertLessEqual(len(a._cover_cache),192)
if __name__=='__main__':unittest.main()
