"""Server-owned collection switches. Feature defaults apply to missing keys; unreadable settings fail closed."""
import time

DEFAULTS = dict(wallets=False, mode=False, meme=False, robinhood=True, context=True, x_rss=True)
FEATURES = tuple(DEFAULTS)
PAUSED = {
    'meme': 'Meme index collection is off. BTC/Alt sampling continues independently.',
    'wallets': 'Wallet analysis is off. Turn it on in Admin to collect new observations.',
    'mode': 'Mode collection is off. Turn it on in Admin to resume sampling.',
    'robinhood': 'Robinhood collection is off. Saved pool records are retained.',
    'context': 'Automatic narrative enrichment is off. Saved context is retained.',
    'x_rss': 'X RSS monitoring is off. Saved observations are retained.',
}


def read_controls(store):
    features = {}
    for feature in FEATURES:
        row = store.get(feature, {'enabled': DEFAULTS[feature]})
        features[feature] = dict(enabled=isinstance(row, dict) and row.get('enabled') is True,
                                 updatedAt=row.get('updatedAt') if isinstance(row, dict) else None)
    return dict(version=1, features=features)


def enabled(store, feature):
    if feature not in FEATURES:
        return False
    try:
        row = store.get(feature, {'enabled': DEFAULTS[feature]})
        return isinstance(row, dict) and row.get('enabled') is True
    except Exception:
        return False


def update_control(store, payload):
    if (not isinstance(payload, dict) or set(payload) != {'feature', 'enabled'}
            or payload.get('feature') not in FEATURES or type(payload.get('enabled')) is not bool):
        raise ValueError('Choose a supported feature and an enabled boolean')
    # A separate key per feature prevents independent switches overwriting each other.
    store.put(payload['feature'], dict(enabled=payload['enabled'], updatedAt=int(time.time()*1000)))
    return read_controls(store)


def paused(feature):
    return dict(status='paused', collectionEnabled=False, reason=PAUSED[feature])


def mode_report(report, is_enabled):
    if is_enabled:
        return dict(report, collectionEnabled=True)
    return dict(report, collectionEnabled=False, ready=False, score=None, mode='Unknown', reason=PAUSED['mode'])
