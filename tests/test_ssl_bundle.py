"""Offline SSL initialization and build resource regression checks."""
import importlib.util
import ssl
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from urllib.request import HTTPSHandler

import civitai_api

spec = importlib.util.spec_from_file_location('bundle_ssl_data', Path(__file__).resolve().parents[1]/'scripts'/'bundle_ssl_data.py')
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class SSLBundleTests(unittest.TestCase):
    def test_actual_runtime_resources_are_present(self):
        for source, destination in bundle.collect_ssl_runtime_data():
            self.assertTrue(Path(source).is_file())
            self.assertEqual(destination, '.')

    def test_vendor_ca_resource_is_collected(self):
        with tempfile.TemporaryDirectory() as d:
            source = Path(d)/'ssl.py'
            source.write_text("cafile='codex-rejected-cas.pem'", encoding='utf-8')
            ca = Path(d)/'codex-rejected-cas.pem'
            ca.write_text('fixture', encoding='utf-8')
            self.assertEqual(bundle.collect_ssl_runtime_data(SimpleNamespace(__file__=str(source))), [(str(ca), '.')])

    def test_missing_required_resource_fails_the_build(self):
        with tempfile.TemporaryDirectory() as d:
            source = Path(d)/'ssl.py'
            source.write_text("cafile='codex-rejected-cas.pem'", encoding='utf-8')
            with self.assertRaises(FileNotFoundError):
                bundle.collect_ssl_runtime_data(SimpleNamespace(__file__=str(source)))

    def test_standard_python_does_not_require_vendor_resource(self):
        with tempfile.TemporaryDirectory() as d:
            source = Path(d)/'ssl.py'
            source.write_text('# standard SSL module', encoding='utf-8')
            self.assertEqual(bundle.collect_ssl_runtime_data(SimpleNamespace(__file__=str(source))), [])

    def test_default_tls_policy_remains_strict(self):
        context = ssl.create_default_context()
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)

    def test_api_https_initialization_stays_offline_and_strict(self):
        for proxy in (None, 'http://127.0.0.1:9'):
            client = civitai_api.CivitaiAPI(proxy=proxy)
            handler = next(h for h in client.opener.handlers if isinstance(h, HTTPSHandler))
            context = handler._context or ssl.create_default_context()
            self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
            self.assertTrue(context.check_hostname)


if __name__ == '__main__':
    unittest.main()
