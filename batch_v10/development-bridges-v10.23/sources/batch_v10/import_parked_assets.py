"""Snapshot the RacingVibes race-sprite registry without changing that checkout."""
import argparse, hashlib, json, subprocess
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent


def snapshot(source):
    source = Path(source)
    descriptors = json.loads(subprocess.check_output(
        ['node', str(source/'scripts/lib/vehicle-collider-inputs.cjs')], cwd=source))
    target = ROOT/'web/parked-assets'
    target.mkdir(exist_ok=True)
    records = []
    for item in descriptors:
        path = source/item['asset']
        image = Image.open(path).convert('RGBA')
        crop = item['crop']
        if crop:
            image = image.crop((crop['sx'], crop['sy'], crop['sx']+crop['sw'], crop['sy']+crop['sh']))
        source_height = image.height
        bounds = image.getchannel('A').point(lambda a: 255 if a >= 128 else 0).getbbox()
        if not bounds:
            raise ValueError('Empty sprite: '+str(path))
        image = image.crop(bounds)
        length = item['renderLength']/10 * image.height/source_height
        width = length*image.width/image.height
        buggy = item['kind'] in {'DuneraX1', 'RavikR'}
        truck = item['kind'] in {'Truck', 'MastiffST', 'JackalXT'}
        # Parking dimensions are inferred, not surveyed or physics tuning.
        scale = min(1, (2.4 if buggy or truck else 2.0)/width)
        length *= scale
        width *= scale
        image.thumbnail((256, 384), Image.Resampling.LANCZOS)
        name = item['kind']+'-'+item['variant']+'.webp'
        image.save(target/name, lossless=True)
        records.append(dict(kind=item['kind'], variant=item['variant'], asset='parked-assets/'+name,
                            length=round(length, 4), width=round(width, 4), height=2.4 if truck else 1.8,
                            weight=.01 if buggy else 1, source_asset=item['asset'], source_crop=crop,
                            source_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                            sha256=hashlib.sha256((target/name).read_bytes()).hexdigest()))
    manifest={'source':'RacingVibes race sprite and variant registry', 'units':'metres',
              'dimensions':'Inferred from race artwork; passenger width capped at 2 m, truck/buggy at 2.4 m, preserving aspect ratio.',
              'selection':'Equal vehicle-kind weights; DuneraX1 and RavikR each have 0.01 weight. Uniform variants within kind.',
              'vehicles':records}
    (target/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    print(len(records), 'liveries from', len({r['kind'] for r in records}), 'vehicle kinds')


if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('source');snapshot(parser.parse_args().source)
