"""Build atomic public projections in a separately bounded child process."""
import json
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from worker.snapshot_view import snapshot_view


def project(filename):
    main = Path(filename)
    snapshot = json.loads(main.read_text(encoding='utf-8'))
    catalog = main.with_name('coins.catalog.v1.json')
    temporary = catalog.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(snapshot_view(snapshot, 'catalog'), separators=(',', ':')), encoding='utf-8')
    os.replace(temporary, catalog)
    for hours in (1, 6, 12, 36, 120):
        projection = main.with_name(f'coins.snipe.v2.{hours}.json')
        temporary = projection.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(snapshot_view(snapshot, 'coin', hours=hours), separators=(',', ':')), encoding='utf-8')
        os.replace(temporary, projection)


if __name__ == '__main__':
    project(sys.argv[1])
