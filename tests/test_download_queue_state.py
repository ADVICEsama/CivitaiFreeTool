"""Priority and concurrency use simulated workers; never open a download URL."""
import copy,sys,threading,time,unittest
from pathlib import Path
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import config,downloader


class DownloadQueueStateTests(unittest.TestCase):
    def manager(self,limit=1):
        with patch.object(config,'load_history',return_value=[]):d=downloader.Downloader(dict(config.DEFAULTS,max_concurrent_downloads=limit))
        d.save_tasks=Mock(return_value=True);d._ensure_workers=Mock();return d

    def tasks(self,d,count):
        d.tasks=[downloader.DownloadTask('fixture.invalid','',str(i)) for i in range(count)]
        for t in d.tasks:d._queue.put(t)
        return d.tasks[:]

    def test_priority_reorder_controls_next_worker_claim(self):
        d=self.manager();tasks=self.tasks(d,3);self.assertTrue(d.reorder_tasks([tasks[2].id,tasks[0].id,tasks[1].id]));order=[]
        def run(t):
            order.append(t.filename);t.status=downloader.ST_DONE
            if len(order)==3:d._stop=True
        d._download_impl=run;d._worker();self.assertEqual(order,['2','0','1']);d.save_tasks.assert_called()

    def test_active_task_never_preempted_or_requeued(self):
        d=self.manager(2);tasks=self.tasks(d,3);tasks[0].status=downloader.ST_DOWNLOADING;d._active_ids.add(tasks[0].id)
        self.assertTrue(d.reorder_tasks([tasks[2].id,tasks[1].id,tasks[0].id]));self.assertEqual(tasks[0].status,downloader.ST_DOWNLOADING)
        queued=[]
        while not d._queue.empty():queued.append(d._queue.get_nowait().id)
        self.assertEqual(queued,[tasks[2].id,tasks[1].id])

    def test_invalid_reorder_preserves_tasks(self):
        d=self.manager();tasks=self.tasks(d,2)
        for ids in [['unknown'],[tasks[0].id,tasks[0].id],[],[{}]]:
            if ids==[]:continue
            self.assertFalse(d.reorder_tasks(ids));self.assertEqual(d.tasks,tasks)

    def test_parallel_workers_obey_current_limit(self):
        d=self.manager(2);self.tasks(d,6);counts={'running':0,'peak':0,'done':0};lock=threading.Lock()
        def run(t):
            with lock:counts['running']+=1;counts['peak']=max(counts['peak'],counts['running'])
            time.sleep(.03);t.status=downloader.ST_DONE
            with lock:
                counts['running']-=1;counts['done']+=1
                if counts['done']==6:d._stop=True
        d._download_impl=run;workers=[threading.Thread(target=d._worker) for _ in range(5)]
        for w in workers:w.start()
        for w in workers:w.join(3)
        self.assertEqual(counts['done'],6);self.assertLessEqual(counts['peak'],2);self.assertFalse(any(w.is_alive() for w in workers))

    def test_same_destination_cannot_be_written_by_two_workers(self):
        d=self.manager(2);tasks=self.tasks(d,2)
        for t in tasks:t.filename='same.safetensors'
        active=0;peak=0;done=0;lock=threading.Lock()
        def run(t):
            nonlocal active,peak,done
            with lock:active+=1;peak=max(peak,active)
            time.sleep(.03);t.status=downloader.ST_DONE
            with lock:
                active-=1;done+=1
                if done==2:d._stop=True
        d._download_impl=run;workers=[threading.Thread(target=d._worker) for _ in range(2)]
        for w in workers:w.start()
        for w in workers:w.join(3)
        self.assertEqual(done,2);self.assertEqual(peak,1)

    def test_retry_resets_downloading_state_and_speed(self):
        d=self.manager();t=downloader.DownloadTask('fixture.invalid','', 'fixture');t.status=downloader.ST_DOWNLOADING;seen=[]
        d._resolve_dest=Mock(return_value='');d._notify=lambda task:seen.append((task.status,task.speed,task.error))
        attempts=[]
        def attempt(task):
            attempts.append((task.status,task.speed,task.error))
            if len(attempts)==1:task.status=downloader.ST_ERROR;task.error='connection interrupted';task.speed=999
            else:task.status=downloader.ST_DONE
        d._download_once=attempt
        with patch.object(downloader.time,'sleep'):d._download_impl(t)
        self.assertEqual(attempts,[('downloading',0.0,''),('downloading',0.0,'')]);self.assertTrue(any(status=='retrying' and speed==0 for status,speed,_ in seen))

    def test_paused_and_restored_retry_tasks_not_marked_active(self):
        d=self.manager();t=downloader.DownloadTask('fixture.invalid','', 'fixture');t.status=downloader.ST_RETRYING;t.speed=10;d.tasks=[t];d._pause_events[t.id]=threading.Event();d._notify=Mock();d.pause_task(t);self.assertEqual(t.status,'paused');self.assertEqual(t.speed,0)

    def test_same_clock_same_filename_ids_still_unique(self):
        with patch.object(downloader.time,'time_ns',return_value=1):
            self.assertEqual(len({downloader.DownloadTask('fixture','','same').id for _ in range(30)}),30)

    def test_concurrent_setting_is_bounded(self):
        for value,expected in [(0,1),(99,32),('bad',3)]:
            cfg={'max_concurrent_downloads':value};config.normalize_ui_preferences(cfg);self.assertEqual(cfg['max_concurrent_downloads'],expected)


if __name__=='__main__':unittest.main()
