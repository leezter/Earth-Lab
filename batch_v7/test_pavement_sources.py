"""Source failure and snapshot behaviour without live network requests."""
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import pavement_sources as sources


class SourceTests(unittest.TestCase):
    def test_osm_original_direction_tags_versions_and_cached_reuse(self):
        xml = b'''<osm version="0.6"><node id="1" lon="13" lat="52"/>
          <node id="2" lon="13.001" lat="52"/>
          <way id="10" version="7" timestamp="2026-10-01T12:00:00Z"><nd ref="2"/><nd ref="1"/>
          <tag k="highway" v="residential"/><tag k="sidewalk" v="left"/>
          <tag k="sidewalk:left:width" v="2.4"/></way></osm>'''
        with tempfile.TemporaryDirectory() as folder, patch.object(sources,'ROOT',Path(folder)), \
             patch.object(sources.urllib.request,'urlopen',return_value=io.BytesIO(xml)) as fetch:
            response, info = sources.osm(52,13)
            way = response['elements'][0]
            self.assertEqual([p['lon'] for p in way['geometry']], [13.001,13])
            self.assertEqual(way['tags']['sidewalk:left:width'],'2.4')
            self.assertEqual(way['version'],'7')
            self.assertFalse(info['cache_reused'])
            again, cached = sources.osm(52,13)
            self.assertEqual(again,response)
            self.assertTrue(cached['cache_reused'])
            self.assertEqual(fetch.call_count,1)

    def test_network_failure_is_recorded_without_caching_empty_success(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(sources,'ROOT',Path(folder)), \
             patch.object(sources.urllib.request,'urlopen',side_effect=OSError('Controlled network outage')):
            response, info = sources.osm(52,13)
            self.assertEqual(info['status'],'unavailable')
            self.assertIn('Controlled network outage',info['warnings'][0])
            self.assertEqual(response['elements'],[])
            self.assertEqual(list(Path(folder).rglob('*.json')),[])

    def test_missing_survey_differs_from_outside_coverage(self):
        with patch.object(sources,'survey_path',return_value=None):
            self.assertEqual(sources.survey(52.5,13.4)[1]['status'],'unavailable')
            self.assertEqual(sources.survey(53.83,-1.95)[1]['status'],'outside coverage')


if __name__=='__main__':
    unittest.main()
