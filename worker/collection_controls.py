"""Server-owned collection switches. Missing or unreadable settings stay off."""
import time

FEATURES = ('wallets', 'mode')
PAUSED = {
    'wallets': 'Wallet analysis is off. Turn it on in Admin to collect new observations.',
    'mode': 'Mode collection is off. Turn it on in Admin to resume sampling.',
}


def read_controls(store):
    features = {}
    for feature in FEATURES:
        row = store.get(feature, None)
        features[feature] = dict(enabled=isinstance(row, dict) and row.get('enabled') is True,
                                 updatedAt=row.get('updatedAt') if isinstance(row, dict) else None)
    return dict(version=1, features=features)


def enabled(store, feature):
    if feature not in FEATURES:
        return False
    try:
        row = store.get(feature, None)
        return isinstance(row, dict) and row.get('enabled') is True
    except Exception:
        return False


def update_control(store, payload):
    if (not isinstance(payload, dict) or set(payload) != {'feature', 'enabled'}
            or payload.get('feature') not in FEATURES or type(payload.get('enabled')) is not bool):
        raise ValueError('Choose wallets or mode and an enabled boolean')
    # A separate key per feature prevents independent switches overwriting each other.
    store.put(payload['feature'], dict(enabled=payload['enabled'], updatedAt=int(time.time()*1000)))
    return read_controls(store)


def paused(feature):
    return dict(status='paused', collectionEnabled=False, reason=PAUSED[feature])


def mode_report(report, is_enabled):
    if is_enabled:
        return dict(report, collectionEnabled=True)
    return dict(report, collectionEnabled=False, ready=False, score=None, mode='Unknown', reason=PAUSED['mode'])
