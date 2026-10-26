"""Build atomic public projections in a separately bounded child process."""
import json
import os
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from worker.snapshot_view import coin_projection_views, snapshot_view
from worker.runner_sampling import candidate_snapshot


def project(filename):
    main = Path(filename)
    source_stat = main.stat()
    snapshot = json.loads(main.read_text(encoding='utf-8'))
    if not isinstance(snapshot.get('coins'), list):
        raise ValueError('Invalid coin snapshot: coins must be a list')
    now_ms = time.time() * 1000
    candidates = main.with_name('coins.runner-candidates.json')
    temporary = candidates.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(candidate_snapshot(snapshot), separators=(',', ':')), encoding='utf-8')
    os.replace(temporary, candidates)
    catalog = main.with_name('coins.catalog.v2.json')
    temporary = catalog.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(snapshot_view(snapshot, 'catalog', now_ms=now_ms), separators=(',', ':')), encoding='utf-8')
    os.replace(temporary, catalog)
    tweet = main.with_name('coins.tweet.json')
    temporary = tweet.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(snapshot_view(snapshot,'tweet',now_ms=now_ms),separators=(',',':')),encoding='utf-8')
    os.replace(temporary,tweet)
    for hours, view in coin_projection_views(snapshot, now_ms=now_ms):
        projection = main.with_name(f'coins.snipe.v2.{hours}.json')
        temporary = projection.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(view, separators=(',', ':')), encoding='utf-8')
        os.replace(temporary, projection)
    final_stat = main.stat()
    if (source_stat.st_size, source_stat.st_mtime_ns, source_stat.st_dev, source_stat.st_ino) != (
            final_stat.st_size, final_stat.st_mtime_ns, final_stat.st_dev, final_stat.st_ino):
        raise RuntimeError('Snapshot changed while building projections')
    # The controller can reuse this already-parsed checkpoint once all writers
    # stop and the authoritative snapshot still matches these stat values.
    return dict(version=1, snapshotSize=final_stat.st_size, snapshotMtimeNs=final_stat.st_mtime_ns,
                snapshotDev=final_stat.st_dev, snapshotIno=final_stat.st_ino,
                checkpoint=dict(lastRun=snapshot.get('lastRun'), revision=snapshot.get('revision'),
                                coins=len(snapshot.get('coins', [])), providerErrors={
                                    key: feed['error'] for key, feed in snapshot.get('feeds', {}).items()
                                    if isinstance(feed, dict) and feed.get('error')}))


if __name__ == '__main__':
    print(json.dumps(project(sys.argv[1]), separators=(',', ':')))
