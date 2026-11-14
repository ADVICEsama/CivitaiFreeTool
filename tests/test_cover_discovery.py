import tempfile,unittest
from pathlib import Path
import model_manager
class CoverDiscoveryTests(unittest.TestCase):
 def test_gallery_fallback_and_explicit_priority(self):
  with tempfile.TemporaryDirectory() as tmp:
   base=Path(tmp)/'model';model=str(base)+'.safetensors';gallery=Path(str(base)+'.images');gallery.mkdir()
   (gallery/'first.mp4').write_bytes(b'video');self.assertIsNone(model_manager.find_cover(model))
   (gallery/'image_01.jpg').write_bytes(b'image');self.assertEqual(model_manager.find_cover(model),str(gallery/'image_01.jpg'))
   (gallery/'image_cover.png').write_bytes(b'cover');self.assertEqual(model_manager.find_cover(model),str(gallery/'image_cover.png'))
   preview=Path(str(base)+'.preview.webp');preview.write_bytes(b'preview');self.assertEqual(model_manager.find_cover(model),str(preview))
if __name__=='__main__':unittest.main()
