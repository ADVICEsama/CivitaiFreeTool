"""目录记录只清理配置；批量移动使用临时文件，Shell/网络一律 mock。"""
import copy,json,os,shutil,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import config,webui,downloader
class FolderPickerActionsTests(unittest.TestCase):
    def api(self,root):
        a=webui.Api.__new__(webui.Api);a.cfg=copy.deepcopy(config.DEFAULTS);a.cfg.update(models_dir=str(root),models_dirs=[str(root)],download_dir=str(root));a.dl=Mock();a.dl.tasks=[];a._new_api=Mock(return_value=Mock());a.open_in_folder=Mock(return_value={"ok":True});return a
    def test_missing_root_is_not_fake_selectable(self):
        with tempfile.TemporaryDirectory() as d:
            a=self.api(Path(d)/'missing');self.assertFalse(json.loads(a.get_folders())['exists']);self.assertFalse(a.folder_picker_status([str(Path(d)/'missing')])[0]['exists'])
    def test_status_accepts_existing_model_child_not_missing(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'child').mkdir();a=self.api(root);r=a.folder_picker_status([str(root/'child'),str(root/'missing')]);self.assertTrue(r[0]['valid']);self.assertFalse(r[1]['valid'])
    def test_existing_favorite_removal_never_deletes_models_or_resets_target(self):
        with tempfile.TemporaryDirectory() as d,patch('config.save',return_value=True):
            root=Path(d);folder=root/'child';folder.mkdir();model=folder/'keep.safetensors';model.write_bytes(b'keep');a=self.api(root);a.cfg.update(folder_picker_favorites=[str(folder),str(folder/'nested')],folder_picker_folded=[str(folder)],download_target_dir=str(folder));r=a.forget_folder_record(str(folder));self.assertTrue(r['ok']);self.assertTrue(model.exists());self.assertEqual(a.cfg['folder_picker_favorites'],[str(folder/'nested')]);self.assertEqual(a.cfg['download_target_dir'],str(folder));self.assertEqual(a.cfg['folder_picker_folded'],[str(folder)]);a.dl.relocate.assert_not_called()
    def test_missing_parent_clears_descendants_only_and_invalid_target(self):
        with tempfile.TemporaryDirectory() as d,patch('config.save',return_value=True):
            root=Path(d);gone=root/'gone';other=root/'gone-other';other.mkdir();a=self.api(root);a.cfg.update(folder_picker_favorites=[str(gone),str(gone/'child'),str(other)],folder_picker_folded=[str(gone),str(gone/'child'),str(other)],download_target_dir=str(gone/'child'));r=a.forget_folder_record(str(gone));self.assertTrue(r['missing']);self.assertEqual(a.cfg['folder_picker_favorites'],[str(other)]);self.assertEqual(a.cfg['folder_picker_folded'],[str(other)]);self.assertEqual(a.cfg['download_target_dir'],'');self.assertTrue(other.exists())
    def test_record_save_failure_preserves_preferences(self):
        with tempfile.TemporaryDirectory() as d,patch('config.save',return_value=False):
            a=self.api(Path(d));a.cfg['folder_picker_favorites']=[str(Path(d)/'missing')];old=copy.deepcopy(a.cfg);self.assertFalse(a.forget_folder_record(old['folder_picker_favorites'][0])['ok']);self.assertEqual(a.cfg,old)
    def test_open_location_existing_directory_opens_parent(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'child').mkdir();a=self.api(root);self.assertTrue(a.open_folder_location(str(root/'child'))['ok']);a.open_in_folder.assert_called_once_with(str(root))
    def test_missing_location_uses_nearest_existing_ancestor(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);a=self.api(root);a.open_folder_location(str(root/'missing'/'deep'));a.open_in_folder.assert_called_once_with(str(root))
    def test_removed_primary_root_falls_back_to_other_existing_library(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);a=self.api(root/'missing');a.cfg['models_dirs']=[str(root/'missing'),str(root)];self.assertEqual(json.loads(a.get_folders())['root'],str(root))
    def test_empty_record_rejected(self):self.assertFalse(self.api(Path('.')).forget_folder_record('')['ok'])
    def test_move_keeps_sidecars_history_and_favorite_paths(self):
        with tempfile.TemporaryDirectory() as d,patch('config.save',return_value=True):
            root=Path(d);dest=root/'dest';dest.mkdir();source=root/'m.safetensors';source.write_bytes(b'model');(root/'m.json').write_text('{}');(root/'m.preview.png').write_bytes(b'preview');(root/'m.images').mkdir();(root/'m.images'/'example.png').write_bytes(b'image');a=self.api(root);a.cfg['model_favorites']=[str(source)];r=a.move_file_to(str(source),str(dest));self.assertTrue(r['ok']);self.assertTrue(all((dest/n).exists() for n in ['m.safetensors','m.json','m.preview.png','m.images/example.png']));self.assertFalse(source.exists());self.assertEqual(a.cfg['model_favorites'],[str(dest/source.name)]);a.dl.relocate.assert_called_once_with(str(source),str(dest/source.name))
    def test_conflict_never_overwrites_either_model(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);dest=root/'dest';dest.mkdir();source=root/'m.safetensors';source.write_bytes(b'original');(dest/source.name).write_bytes(b'existing');a=self.api(root);self.assertFalse(a.move_file_to(str(source),str(dest))['ok']);self.assertEqual(source.read_bytes(),b'original');self.assertEqual((dest/source.name).read_bytes(),b'existing');a.dl.relocate.assert_not_called()
    def test_partial_move_failure_rolls_back_model(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);dest=root/'dest';dest.mkdir();source=root/'m.safetensors';source.write_bytes(b'model');side=root/'m.json';side.write_bytes(b'json');a=self.api(root);real=shutil.move
            def move(old,new):
                if str(old)==str(side):raise OSError('fixture locked sidecar')
                return real(old,new)
            with patch('webui.shutil.move',side_effect=move):self.assertFalse(a.move_file_to(str(source),str(dest))['ok'])
            self.assertEqual(source.read_bytes(),b'model');self.assertEqual(side.read_bytes(),b'json');self.assertFalse((dest/source.name).exists());a.dl.relocate.assert_not_called()
    def test_downloading_model_cannot_be_moved(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);dest=root/'dest';dest.mkdir();source=root/'m.safetensors';source.write_bytes(b'model');a=self.api(root);a.dl.tasks=[Mock(status=downloader.ST_DOWNLOADING,filename=source.name,dest_dir=str(root))];self.assertFalse(a.move_file_to(str(source),str(dest))['ok']);self.assertTrue(source.exists())
if __name__=='__main__':unittest.main()
