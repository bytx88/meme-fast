const address = 'BNoUUtinMiHdARMwEM6YXaNJ1MhGmTiJ4a5FmCgyJL8R';
const header = document.querySelector('.masthead');

if (header) {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'donate-trigger';
  trigger.textContent = '♡ Donate SOL';
  trigger.setAttribute('aria-haspopup', 'dialog');
  header.querySelector('.brand')?.after(trigger);

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
