"""Create an explicit NEW identity and retain its exact source snapshot."""
from pathlib import Path
import argparse,hashlib,json,shutil

ROOT=Path(__file__).resolve().parent;REPO=ROOT.parent


def freeze(identity):
    if not identity.startswith('bridges-v10.'):raise ValueError('Use an explicit bridges-v10.N identity')
    path=ROOT/'freeze.json'
    old=json.loads(path.read_text())if path.exists()else None
    if old and old['id']==identity:raise ValueError('Never refresh an existing renderer identity; use a new version')
    snapshot=ROOT/('development-'+identity)
    if snapshot.exists():raise ValueError('Identity already has a retained source snapshot')
    files=[p for p in ROOT.glob('*.py')if not p.name.startswith(('test_','verify_','audit','probe_','freeze_','build_examples'))]
    files += [p for p in (ROOT/'web').rglob('*')if p.is_file()and 'reviews'not in p.parts]
    files += [p for p in (ROOT/'runtime').rglob('*')if p.is_file()]
    files += [REPO/'earth_backend.py',REPO/'assets/materials/batch-manifest.json',REPO/'web/rv/vendor/planck/planck.min.js',REPO/'web/rv/assets/vehicles/vehicle_colliders.js']
    hashes={p.relative_to(REPO).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()for p in sorted(files)}
    d={'id':identity,'source_hashes':hashes}
    snapshot.mkdir()
    for p in files:
        target=snapshot/'sources'/p.relative_to(REPO);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
    (snapshot/'source-manifest.json').write_text(json.dumps(d,indent=2))
    if old:(snapshot/'previous-freeze.json').write_text(json.dumps(old,indent=2))
    path.write_text(json.dumps(d,indent=2)+'\n');print(identity,len(hashes),'frozen inputs')
    return d

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--id',required=True);args=parser.parse_args();freeze(args.id)
