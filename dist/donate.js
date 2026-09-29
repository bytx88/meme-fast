import {mountMarket} from './market-delta.mjs?v=market-two-rows-v1';
const address = 'BNoUUtinMiHdARMwEM6YXaNJ1MhGmTiJ4a5FmCgyJL8R';
const header = document.querySelector('.masthead');

if (header) {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'donate-trigger';
  trigger.textContent = '♡ Donate SOL';
  trigger.setAttribute('aria-haspopup', 'dialog');
  const actions = document.createElement('div');
  actions.className = 'header-support';
  const support = document.createElement('a');
  support.className = 'contact-support';
  support.href = 'mailto:microtoken1688@gmail.com';
  support.setAttribute('aria-label', 'Contact support');
  support.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
  support.title = 'Email microtoken1688@gmail.com';
  actions.append(trigger, support);
  header.querySelector('.site-nav')?.append(actions);
  const disclaimer = document.createElement('span');
  disclaimer.className = 'site-disclaimer';
  disclaimer.textContent = 'Not financial advice, DYOR.';
  const brand = header.querySelector('.brand');
  const brandGroup = document.createElement('div');
  brandGroup.className = 'header-brand-group';
  if (brand) {
    brand.before(brandGroup);
    brandGroup.append(brand, disclaimer);
  }
  const market = document.createElement('button');
  market.type = 'button';
  market.className = 'market-overview';
  market.setAttribute('aria-haspopup', 'dialog');
  market.setAttribute('aria-label', 'Market Delta overview. Meme and Alt data unavailable. Open details');
  market.innerHTML = '<span class="market-overview-title">MARKET DELTA · 1H <span aria-hidden="true">↗</span></span><span class="market-overview-values"><span>Meme <b>—</b></span><span>Alt <b>—</b></span></span>';
  header.querySelector('.site-nav')?.before(market);
  const marketDialog = document.createElement('dialog');
  marketDialog.className = 'donate-dialog market-overview-dialog';
  marketDialog.setAttribute('aria-labelledby', 'market-overview-title');
  marketDialog.innerHTML = `<div class="donate-heading"><h2 id="market-overview-title">Meme Market Delta</h2><button type="button" aria-label="Close market overview">×</button></div><div class="market-content"></div>`;
  document.body.append(marketDialog);
  mountMarket(market, marketDialog);
  market.addEventListener('click', () => marketDialog.showModal());
  marketDialog.querySelector('button').addEventListener('click', () => marketDialog.close());
  marketDialog.addEventListener('click', event => {
    const rect = marketDialog.getBoundingClientRect();
    if (event.target === marketDialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) marketDialog.close();
  });

  const dialog = document.createElement('dialog');
  dialog.className = 'donate-dialog';
  dialog.setAttribute('aria-labelledby', 'donate-title');
  dialog.innerHTML = `
    <div class="donate-heading"><h2 id="donate-title">Support Meme Fast</h2><button type="button" aria-label="Close donation panel">×</button></div>
    <p>Enjoying Meme Fast? Help keep it running with an optional donation.</p>
    <strong class="donate-network">SOL · Solana network only</strong>
    <label for="donate-address">Donation address</label>
    <textarea id="donate-address" readonly rows="2" spellcheck="false">${address}</textarea>
    <button type="button" class="donate-copy">Copy address</button>
    <p class="donate-status" role="status" aria-live="polite"></p>
    <p class="donate-note">Any amount is welcome. Donations are optional; network fees apply.</p>`;
  document.body.append(dialog);
  const status = dialog.querySelector('.donate-status');
  const field = dialog.querySelector('textarea');
  trigger.addEventListener('click', () => {
    status.textContent = '';
    dialog.showModal();
  });
  dialog.querySelector('.donate-heading button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  dialog.querySelector('.donate-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(address);
      status.textContent = 'Address copied.';
    } catch {
      field.focus();
      field.select();
      status.textContent = 'Copy unavailable. Address selected—copy it manually.';
    }
  });
}
