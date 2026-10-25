"""Shared Mode rules. The browser contract is generated from the same JSON."""
import json
import math
from pathlib import Path

CONFIG = json.loads(Path(__file__).with_suffix('.json').read_text(encoding='utf-8'))
POLICY = CONFIG['policy']
LEVELS = tuple(CONFIG['levels'])
SCORES = CONFIG['scores']
MINUTE = 60_000
HOUR = 60 * MINUTE
DAY = 24 * HOUR
SAMPLE_INTERVAL = CONFIG['sampling']['intervalMinutes'] * MINUTE
QUOTE_MAX_AGE = CONFIG['sampling']['quoteMaxAgeMinutes'] * MINUTE
CONFIRMATION_WINDOW = POLICY['confirmationMinutes'] * MINUTE
FOLLOWUP = POLICY['followupHours'] * HOUR
LIMIT = POLICY['cohortCapacity']
BOOTSTRAP = CONFIG['sampling']['bootstrap']
HOURLY_ADMISSIONS = CONFIG['sampling']['hourlyAdmissions']
MAX_CAP = CONFIG['valuation']['maximumCap']
MIN_LIQUIDITY = CONFIG['valuation']['minimumLiquidity']
MAX_POPULATION_RATIO = CONFIG['maximumPopulationRatio']
MIN_AGREEING_THRESHOLDS = CONFIG['minimumAgreeingThresholds']


def number(value):
    return (float(value) if isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and value >= 0 else None)


def fresh(at, now, max_age=QUOTE_MAX_AGE):
    return at is not None and 0 <= now - at <= max_age
