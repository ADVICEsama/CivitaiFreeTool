import unittest
from download_hud import snapshot, HudBridge, number
from types import SimpleNamespace


class DownloadHudTests(unittest.TestCase):
    def row(self, status='downloading', **kw):
        return dict(id='x', filename='demo', status=status, downloaded=20, total=100, speed=8, **kw)

    def test_weighted(self):
        a=self.row();b=self.row();b.update(total=900,downloaded=450)
        s=snapshot([a,b],{})
        self.assertEqual(s['progress'],47)
        self.assertEqual(s['speed'],16)

    def test_never_complete_before_verification(self):
        a=self.row();a['downloaded']=100
        self.assertFalse(snapshot([a],{})['done'])
        self.assertLess(snapshot([a],{})['progress'],100)
        a['status']='done'
        self.assertTrue(snapshot([a],{})['done'])

    def test_unknown(self):
        a=self.row();a['total']=0
        self.assertTrue(snapshot([a],{})['unknown'])

    def test_idle(self):
        self.assertFalse(snapshot([],{})['done'])

    def test_canceled_not_in_totals(self):
        self.assertEqual(snapshot([self.row('canceled')],{})['total'],0)

    def test_failed_not_success(self):
        s=snapshot([self.row('error')],{})
        self.assertEqual(s['failed'],1);self.assertEqual(s['speed'],0);self.assertFalse(s['done'])

    def test_privacy(self):
        r=self.row(url='secret',dest_dir='private',info={'api_key':'private'})
        s=snapshot([r],{})
        self.assertNotIn('secret',str(s));self.assertNotIn('private',str(s))

    def test_theme(self):
        self.assertEqual(snapshot([],{'theme':'light_pink'})['theme'],'light_endfield')
        self.assertEqual(snapshot([],{'theme':'dark_glass'})['theme'],'dark_endfield')
        self.assertEqual(snapshot([],{'theme':'dark','download_hud_theme':'light_glass'})['theme'],'light_endfield')

    def test_bad_number(self):
        for v in [None,-1,float('nan'),float('inf'),'bad']:
            self.assertEqual(number(v),0)

    def test_restricted_actions(self):
        calls=[]
        b=HudBridge(SimpleNamespace(api=SimpleNamespace(dl_action=lambda *a,**kw:calls.append((a,kw)) or True)))
        for a in ['remove','start_all','retry','save_config']:
            self.assertFalse(b.action(a,'x'))
        self.assertFalse(b.action('start',''));self.assertFalse(b.action('start',None));self.assertEqual(calls,[])
        self.assertTrue(b.action('start','x'))
        self.assertEqual(calls[0],(('start',),{'task_ids':['x']}))

if __name__=='__main__':unittest.main()
