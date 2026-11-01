import unittest
from site_catalog import displayed

class CatalogTests(unittest.TestCase):
    def test_ready_previous_build_remains_until_replacement_is_ready(self):
        old={'id':'old','lat':1,'lon':2,'status':'built'}
        new={'id':'new','lat':1,'lon':2,'status':'rendering'}
        self.assertEqual(displayed([old,new],lambda a,b:'new',lambda d:1),[old])
        new['status']='built'
        self.assertEqual(displayed([old,new],lambda a,b:'new',lambda d:1),[new])

    def test_new_location_can_show_pending_without_previous_build(self):
        new={'id':'new','lat':1,'lon':2,'status':'queued'}
        self.assertEqual(displayed([new],lambda a,b:'new',lambda d:1),[new])

if __name__=='__main__':unittest.main()
