"""Local Meme basket editing, isolated from deployed configuration and history."""
import json
import sys
from pathlib import Path

from worker.meme_preset import Conflict, admin_report, project_report, read_config, revise


def saved_report(directory):
    for name in ('meme-index.public.json', 'meme-index.json'):
        try:
            return json.loads((directory/name).read_text(encoding='utf-8'))
        except (OSError, ValueError):
            pass
    return {'version': 2, 'basket': [], 'readings': []}


def handle(method, payload=None, directory='.data'):
    directory = Path(directory)
    path = directory/'meme-preset.json'
    try:
        try:
            stored = json.loads(path.read_text(encoding='utf-8'))
        except FileNotFoundError:
            stored = None
        config = read_config(stored)
        report = saved_report(directory)
        if method == 'REPORT':
            return {'status': 200, 'body': project_report(report, config)}
        if method == 'GET':
            return {'status': 200, 'body': admin_report(config, report)}
        if method == 'SUGGEST':
            from worker.meme_suggestions import Unavailable, fetch_suggestions
            try:
                return {'status': 200, 'body': fetch_suggestions(config)}
            except Unavailable as error:
                return {'status': 503, 'body': {'detail': str(error)}}
        if method != 'PUT':
            return {'status': 405, 'body': {'detail': 'Method not supported'}}
        try:
            saved = revise(config, payload)
        except Conflict as error:
            return {'status': 409, 'body': {'detail': str(error), 'current': error.current}}
        except ValueError as error:
            return {'status': 400, 'body': {'detail': str(error)}}
        directory.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(saved, allow_nan=False), encoding='utf-8')
        temporary.replace(path)
        return {'status': 200, 'body': admin_report(saved, report)}
    except (OSError, ValueError, TypeError):
        return {'status': 503, 'body': {'detail': 'Saved Meme basket is unavailable. Reload before retrying.'}}


if __name__ == '__main__':
    print(json.dumps(handle(sys.argv[1], json.loads(sys.argv[2]) if len(sys.argv) > 2 else None)))
