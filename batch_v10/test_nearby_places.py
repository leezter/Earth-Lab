import hashlib,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import nearby_places as nearby


class NearbyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)

    def built(self,sid,lat,lon,**extra):
        folder=self.root/sid;(folder/'baked/tiles').mkdir(parents=True)
        files=[]
        for x in range(3):
            for y in range(3):
                name=f'{x}_{y}.webp';(folder/'baked/tiles'/name).write_bytes(b'image')
                files.append({'name':name,'sha256':hashlib.sha256(b'image').hexdigest()})
        (folder/'baked/manifest.json').write_text(json.dumps({'files':files,'content_identity':sid}))
        (folder/'district-data.json').write_text('{}');(folder/'job.json').write_text('{}')
        return {'id':sid,'status':'built','lat':lat,'lon':lon,'content_identity':sid,'acceptance':{'status':'passed'},**extra}

    def find(self,entries):
        with patch.object(nearby.jobs,'entries',return_value=entries),patch.object(nearby.jobs,'directory',side_effect=lambda sid:self.root/sid):
            return nearby.nearest_ready(52,13)

    def test_closest_actual_centre(self):
        near=self.built('near',52,13.001);far=self.built('far',52,13,actual_lat=52.01,actual_lon=13)
        self.assertEqual(self.find([far,near])['id'],'near')

    def test_synthetic_fixtures_excluded(self):
        self.assertIsNone(self.find([self.built('fake',52,13,fixture='flat')]))

    def test_radius_does_not_jump_to_distant_scene(self):
        self.assertIsNone(self.find([self.built('far',53,13)]))

    def test_missing_and_corrupted_images_are_unavailable(self):
        near=self.built('near',52,13.001);far=self.built('far',52,13.002)
        (self.root/'near/baked/tiles/0_0.webp').write_bytes(b'corrupt')
        self.assertEqual(self.find([near,far])['id'],'far')
        (self.root/'far/baked/tiles/0_0.webp').unlink()
        self.assertIsNone(self.find([near,far]))

    def test_failed_jobs_excluded(self):
        d=self.built('bad',52,13);d['status']='failed';self.assertIsNone(self.find([d]))

    def test_invalid_coordinates(self):
        for lat,lon in [(float('nan'),0),(90,0),(0,181)]:
            with self.assertRaises(ValueError):nearby.coordinates(lat,lon)

    def test_failure_history_is_invalidated_by_model_changes(self):
        old={'source_hashes':{'batch_v10/surface_network.py':'original','batch_v10/batch_server.py':'old','batch_v10/web/picker.js':'old'}}
        delivery={'source_hashes':{**old['source_hashes'],'batch_v10/batch_server.py':'new','batch_v10/web/picker.js':'new','batch_v10/nearby_places.py':'new'}}
        self.assertEqual(nearby.model_hashes(old),nearby.model_hashes(delivery))
        delivery['source_hashes']['batch_v10/surface_network.py']='fixed-model'
        self.assertNotEqual(nearby.model_hashes(old),nearby.model_hashes(delivery))

    def test_road_candidates_are_bounded_spaced_and_nearest_first(self):
        import earth_backend
        roads={'roads':[{'class':'residential','parts':[[[[12.98,52],[13.02,52]]]]}]}
        with patch.object(earth_backend,'features',return_value=roads):rows=nearby.candidates(52,13)
        self.assertLessEqual(len(rows),8);self.assertGreater(len(rows),1)
        self.assertEqual(rows,sorted(rows,key=lambda p:p['distance_m']))
        self.assertTrue(all(32<=p['distance_m']<=1500 for p in rows))
        for i,a in enumerate(rows):
            for b in rows[:i]:self.assertGreater(nearby.distance((a['lat'],a['lon']),(b['lat'],b['lon'])),63)
