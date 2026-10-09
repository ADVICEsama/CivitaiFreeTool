"""Folder selection precedence and model categories, temporary fixtures only."""
import json
import sys
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config
import model_filters as filters
import webui


class ModelFilterTests(unittest.TestCase):
    def visible(self, rel, choices, recursive=True):
        return filters.folder_visible(rel, {"model_folder_visibility": choices, "model_folder_include_subfolders": recursive})

    def test_child_visible_with_hidden_parent(self):
        choices = {"A": False, "A/B": True}
        self.assertFalse(self.visible("A/a.safetensors", choices))
        self.assertTrue(self.visible("A/B/b.safetensors", choices))
        self.assertTrue(self.visible("A/B/C/c.safetensors", choices))
        self.assertFalse(self.visible("A/D/d.safetensors", choices))

    def test_checked_parent_excludes_unchecked_child_subtree(self):
        choices = {"A": True, "A/B": False}
        self.assertTrue(self.visible("A/a.safetensors", choices))
        self.assertTrue(self.visible("A/D/d.safetensors", choices))
        self.assertFalse(self.visible("A/B/b.safetensors", choices))
        self.assertFalse(self.visible("A/B/C/c.safetensors", choices))
        choices["A/B/C"] = True
        self.assertTrue(self.visible("A/B/C/c.safetensors", choices))

    def test_direct_mode_does_not_include_unselected_children(self):
        choices = {"A": True}
        self.assertTrue(self.visible("A/a.safetensors", choices, False))
        self.assertFalse(self.visible("A/B/b.safetensors", choices, False))
        choices.update({"A": False, "A/B": True})
        self.assertTrue(self.visible("A/B/b.safetensors", choices, False))
        self.assertFalse(self.visible("A/B/C/c.safetensors", choices, False))

    def test_case_slash_segment_and_root_boundaries(self):
        self.assertFalse(self.visible(r"a\b\model.pt", {"A/B": False}))
        self.assertTrue(self.visible("A/Big/model.pt", {"A/B": False}))
        self.assertFalse(filters.folder_visible("root.pt", {"show_root_models": False}))
        self.assertTrue(filters.folder_visible("A/a.pt", {"show_root_models": False}))

    def test_default_recursive_and_legacy_choices(self):
        self.assertTrue(config.DEFAULTS["model_folder_include_subfolders"])
        cfg = {"hidden_model_folders": ["A"], "model_folder_visibility": {"A/B": True}}
        self.assertFalse(filters.folder_visible("A/a.pt", cfg))
        self.assertTrue(filters.folder_visible("A/B/b.pt", cfg))

    def test_metadata_category_has_precedence_and_aliases(self):
        for raw, expected in [("Checkpoint", "Checkpoint"), ("UNet", "Checkpoint"), ("LoRA", "LORA"), ("LoCon", "LORA"), ("LyCORIS", "LORA"), ("VAE", "VAE"), ("TextualInversion", "TextualInversion"), ("ControlNet", "Controlnet"), ("Other", "Other")]:
            with self.subTest(raw=raw):
                self.assertEqual(filters.model_category(raw, "models/VAE/demo.pt"), (expected, "metadata"))

    def test_directory_fallback_not_filename_or_size_guess(self):
        for directory, expected in [("Lora", "LORA"), ("loras", "LORA"), ("Stable-diffusion", "Checkpoint"), ("diffusion_models", "Checkpoint"), ("vae", "VAE"), ("text_encoders", "TextEncoder"), ("upscale_models", "Upscaler")]:
            self.assertEqual(filters.model_category("", f"D:/models/{directory}/风格/model.safetensors"), (expected, "directory"))
        self.assertEqual(filters.model_category("", "D:/models/vae_lora_checkpoint.safetensors"), ("Unknown", "unknown"))

    def test_save_roundtrip_and_rollback_with_child_override(self):
        a = webui.Api.__new__(webui.Api)
        a.cfg = dict(config.DEFAULTS)
        a.model_rows = []
        with patch.object(config, "save", return_value=True):
            self.assertTrue(a.save_folders(["A"], True, {"A": False, "A/B": True}))
        self.assertEqual(filters.folder_choices(a.cfg), {"a": False, "a/b": True})
        before = dict(a.cfg)
        with patch.object(config, "save", return_value=False):
            self.assertFalse(a.save_folders(["A/B"], False, {"A/B": False}))
        self.assertEqual(a.cfg, before)
        self.assertFalse(a.save_folders([], True, {"../A": True}))

    def test_scan_and_bridge_return_folder_override_and_types(self):
        with TemporaryDirectory() as d:
            root = Path(d)
            for rel in ["A/a.pt", "A/B/vae/b.pt", "A/D/d.pt"]:
                p = root / rel
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(b"synthetic")
            a = webui.Api.__new__(webui.Api)
            a.cfg = dict(config.DEFAULTS, models_dir=d, models_dirs=[d], hidden_model_folders=["A"], model_folder_visibility={"A": False, "A/B": True})
            a.model_rows = []
            a.mm_scan_state = {"running": False, "rows": [], "msg": ""}
            self.assertTrue(a.scan_models()["started"])
            for _ in range(100):
                if not a.get_scan_state()["running"]:
                    break
                time.sleep(.01)
            rows = json.loads(a.get_scan_rows())
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["type_filter"], "VAE")
            self.assertEqual(rows[0]["type_source"], "directory")
            data = json.loads(a.get_folders())
            self.assertTrue(data["visibility"]["a/b"])
            self.assertTrue(data["include_subfolders"])
            self.assertTrue((root / "A/a.pt").is_file())


if __name__ == "__main__":
    unittest.main()
