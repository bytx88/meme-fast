import {formatSmartNumber} from './smart-number.mjs';

export function formatUnitPrice(value) {
  if(!Number.isFinite(value)||value<0)return '—';
  return `$${formatSmartNumber(value)}`;
}
