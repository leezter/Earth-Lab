"""Read-only audit of current freezes and retained completed v10 builds."""
from pathlib import Path
import json,hashlib,sys
ROOT=Path(__file__).resolve().parent;REPO=ROOT.parent;sys.path.insert(0,str(REPO))
from validation import outputs


def audit():
    freezes=[]
    for path in sorted(REPO.glob('batch*/freeze.json')):
        d=json.loads(path.read_text())
        for name,digest in d['source_hashes'].items():
            if hashlib.sha256((REPO/name).read_bytes()).hexdigest()!=digest:
                raise ValueError('Frozen input changed: '+name)
        freezes.append({'edition':path.parent.name,'id':d['id'],'source_hashes':len(d['source_hashes'])})
    builds=[]
    current=json.loads((ROOT/'freeze.json').read_text())['id']
    for path in sorted((ROOT/'custom').glob('*/job.json')):
        d=json.loads(path.read_text())
        if d['status']=='built' and d['renderer_freeze']==current:
            builds.append({'id':d['id'],'name':d['name'],**outputs(path.parent)})
    result={'status':'passed','freezes':freezes,'current_builds':builds}
    (ROOT/'audit.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2));return result

if __name__=='__main__':audit()
