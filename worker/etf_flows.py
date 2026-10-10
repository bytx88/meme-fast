"""Validated public ETF flow data; totals are USD, never AUM or price changes."""
import datetime as dt
import math

TFTC_URL = 'https://www.tftc.io/bitcoin-etf-flows/data.json'
TFTC_PAGE = 'https://www.tftc.io/bitcoin-etf-flows'
FUNDS = frozenset('IBIT FBTC BITB ARKB BTCO EZBC BRRR HODL BTCW GBTC BTC MSBT'.split())


def tftc_rows(payload, today):
    if payload.get('units') != 'USD' or payload.get('name') != 'US Spot Bitcoin ETF Daily Flows':
        raise ValueError('Unexpected ETF dataset or units')
    updated = dt.date.fromisoformat(payload['updatedThrough']).isoformat()
    result = {}
    for row in payload['days']:
        try:
            date = dt.date.fromisoformat(row['date'])
            # This adapter uses the current 12-fund universe, including MSBT.
            if not '2026-04-08' <= date.isoformat() < today or date.isoformat() > updated or date.weekday() >= 5:
                continue
            parts = row['perEtfUsd']
            if not isinstance(parts, dict) or not FUNDS <= parts.keys():
                continue
            values = [row['netFlowUsd'], *parts.values()]
            if not all(type(v) in (int, float) and math.isfinite(v) for v in values):
                continue
            total = row['netFlowUsd']
            # Allow reported per-fund rounding, never missing constituents.
            if abs(sum(parts.values()) - total) > 100000:
                continue
            result[date.isoformat()] = {
                'date': date.isoformat(), 'millionUsd': total / 1000000,
                'provider': 'TFTC', 'sourceUrl': TFTC_PAGE,
                'fundCount': len(parts), 'perEtfUsd': parts,
            }
        except (KeyError, TypeError, ValueError):
            continue
    if not result:
        raise ValueError('No complete reconciled ETF reports')
    return [result[d] for d in sorted(result)][-90:]
