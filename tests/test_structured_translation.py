import unittest
import json
from unittest.mock import patch
import translator

class StructuredTranslation(unittest.TestCase):
    def test_api_protocols_and_credentials(self):
        replies = {
            'chat': {'choices': [{'message': {'content': '["你好"]'}}]},
            'responses': {'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': '["你好"]'}]}]},
            'anthropic': {'content': [{'type': 'text', 'text': '["你好"]'}]},
            'gemini': {'candidates': [{'content': {'parts': [{'text': '["你好"]'}]}}]},
        }
        for protocol, reply in replies.items():
            with self.subTest(protocol=protocol), patch('urllib.request.build_opener') as network:
                network.return_value.open.return_value.__enter__.return_value.read.return_value = json.dumps(reply).encode()
                cfg = {'translation_provider': 'custom', 'translation_protocol': protocol,
                       'translation_base_url': 'https://example.test/v1',
                       'translation_model': 'example-model', 'translation_api_key': 'test-only-token'}
                self.assertEqual(translator.translate('Hello', cfg=cfg, strict=True), '你好')
                req = network.return_value.open.call_args.args[0]
                self.assertNotIn('test-only-token', req.full_url)
                payload = json.loads(req.data)
                self.assertNotIn('test-only-token', json.dumps(payload))
                expected = {'chat': '/chat/completions', 'responses': '/responses',
                            'anthropic': '/messages', 'gemini': '/models/example-model:generateContent'}[protocol]
                self.assertTrue(req.full_url.endswith(expected), req.full_url)
                handler = network.call_args.args[0]
                self.assertIsNone(handler.redirect_request(req, None, 302, '', {}, 'https://other.test'))

    def test_fenced_code_is_untouched(self):
        source = 'Hello\n```python\nx = "Do not translate"\n```\n- World'
        with patch.object(translator, '_mymemory', side_effect=lambda text: '译' + text):
            self.assertEqual(translator.translate(source), '译Hello\n```python\nx = "Do not translate"\n```\n- 译World')

    def test_markdown_delimiters_and_link_destination_are_untouched(self):
        with patch.object(translator, '_mymemory', side_effect=lambda text: '译' + text):
            self.assertEqual(translator.translate('**Hello** [World](https://example.test/a?q=1)\n- *Item*'),
                             '**译Hello** [译World](https://example.test/a?q=1)\n- *译Item*')

    def test_html_preserves_tags_links_and_code(self):
        source='<h2>Title</h2><p>First <strong>bold</strong>.</p><ul><li>A</li><li>B</li></ul><a href="https://example.com/?a=1&amp;b=2">Link</a><pre>x=1</pre>'
        with patch.object(translator,'_mymemory',side_effect=lambda x:'译'+x):
            result=translator.translate(source)
        self.assertIn('<h2>译Title</h2>',result)
        self.assertIn('<li>译A</li><li>译B</li>',result)
        self.assertIn('href="https://example.com/?a=1&amp;b=2"',result)
        self.assertIn('<pre>x=1</pre>',result)
    def test_plain_lines_indent_and_bullets(self):
        with patch.object(translator,'_mymemory',side_effect=lambda x:'译'+x):
            self.assertEqual(translator.translate('# Title\n\n  - Item\nhttps://example.com'), '# 译Title\n\n  - 译Item\nhttps://example.com')
    def test_failure_preserves_original(self):
        with patch.object(translator,'_mymemory',side_effect=RuntimeError('secret')):
            self.assertEqual(translator.translate('<p>Hello</p>'),'<p>Hello</p>')
            with self.assertRaisesRegex(RuntimeError,'^translation.failed$'):
                translator.translate('Hello',strict=True)
    def test_ai_batch_and_html_escaping(self):
        cfg={'translation_provider':'deepseek','translation_api_key':'private'}
        with patch.object(translator,'_ai_batch',return_value=['<b>not markup</b>','二']) as call:
            out=translator.translate('<p>One</p><p>Two</p>',cfg=cfg)
        self.assertEqual(out,'<p>&lt;b&gt;not markup&lt;/b&gt;</p><p>二</p>')
        self.assertEqual(call.call_args.args[0],['One','Two'])
    def test_legacy_baidu_migration(self):
        self.assertEqual(translator.provider_config({},'id','key')[0],'baidu')
        self.assertEqual(translator.provider_config({})[0],'mymemory')
        self.assertEqual(translator.provider_config({'translation_provider':'mymemory'},'id','key')[0],'mymemory')
    def test_ai_rejects_insecure_remote_before_network(self):
        cfg={'translation_provider':'custom','translation_api_key':'secret','translation_model':'test','translation_base_url':'http://example.com/v1'}
        with patch('urllib.request.urlopen') as network:
            self.assertEqual(translator.translate('Hello',cfg=cfg),'Hello')
        network.assert_not_called()

if __name__=='__main__':unittest.main()
