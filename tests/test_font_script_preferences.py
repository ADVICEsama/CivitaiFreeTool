"""Script font preferences are local, ordered, bounded, and backwards compatible."""
import unittest
import config
class FontScriptPreferenceTests(unittest.TestCase):
    def test_groups_and_order(self):
        cfg={'ui_font':'Arial','ui_font_stack':['Arial'],'ui_font_scripts':{'digits':[' Courier New ','Arial','Courier New'],'latin':['Segoe UI'],'ja':['Meiryo'],'zhHant':['Microsoft JhengHei'],'ko':['Malgun Gothic'],'zhHans':['SimSun']}}
        config.normalize_ui_preferences(cfg)
        self.assertEqual(cfg['ui_font_scripts']['digits'],['Courier New','Arial'])
        self.assertEqual(len(cfg['ui_font_scripts']),6)
        self.assertEqual(cfg['ui_font_stack'],['Arial'])
    def test_invalid_values_and_limits(self):
        for raw in (None,[],42,'bad'):
            cfg={'ui_font_scripts':raw};config.normalize_ui_preferences(cfg);self.assertEqual(cfg['ui_font_scripts'],{})
        cfg={'ui_font_scripts':{'digits':['',None,False]+[str(i)*250 for i in range(30)],'unsupported':['Arial'],'latin':'Arial'}}
        config.normalize_ui_preferences(cfg)
        self.assertEqual(len(cfg['ui_font_scripts']['digits']),20)
        self.assertTrue(all(len(f)<=200 for f in cfg['ui_font_scripts']['digits']))
        self.assertNotIn('unsupported',cfg['ui_font_scripts']);self.assertNotIn('latin',cfg['ui_font_scripts'])
    def test_older_config_remains_default(self):
        cfg={'ui_font':'Arial'};config.normalize_ui_preferences(cfg)
        self.assertEqual(cfg['ui_font_scripts'],{})
        self.assertEqual(cfg['ui_font'],'Arial')
        self.assertEqual(cfg['ui_font_picker_view'], {'expanded': False, 'scope': 'default'})
    def test_picker_view_keeps_scope_without_touching_font_order(self):
        for scope in ('default', 'zhHans', 'digits', 'latin', 'ja', 'zhHant', 'ko'):
            cfg={'ui_font_picker_view':{'expanded': True, 'scope':scope, 'draft':['Do not save']},
                 'ui_font_stack':['Segoe UI', 'Arial'], 'ui_font_scripts':{'digits':['Arial']}}
            config.normalize_ui_preferences(cfg)
            self.assertEqual(cfg['ui_font_picker_view'], {'expanded': True, 'scope':scope})
            self.assertEqual(cfg['ui_font_stack'], ['Segoe UI', 'Arial'])
            self.assertEqual(cfg['ui_font_scripts'], {'digits':['Arial']})
    def test_picker_view_invalid_values_are_safe(self):
        for raw in (None, [], 42, 'digits', {'expanded': 'true', 'scope':'wrong'}, {'expanded':1, 'scope':[]}):
            cfg={'ui_font_picker_view':raw}
            config.normalize_ui_preferences(cfg)
            self.assertEqual(cfg['ui_font_picker_view'], {'expanded': False, 'scope': 'default'})
if __name__=='__main__':unittest.main()
