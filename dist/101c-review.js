// Research notes stay in the current browser. Nothing is sent to a server.
(() => {
  const form = document.querySelector('#token-review');
  if (!form) return;
  const key = 'meme-fast:101c:review:v1';
  const fields = [...form.querySelectorAll('textarea[name]')];
  const status = document.querySelector('#review-status');
  const message = text => { status.textContent = text; };
  const notes = () => Object.fromEntries(fields.map(field => [field.name, field.value]));
  form.addEventListener('submit', event => event.preventDefault());
  try {
    const saved = localStorage.getItem(key);
    if (saved) {
      const record = JSON.parse(saved);
      if (!record || record.version !== 1 || typeof record.notes !== 'object' || !record.notes) {
        throw new Error('Unsupported notes');
      }
      for (const field of fields) {
        if (typeof record.notes[field.name] === 'string') field.value = record.notes[field.name];
      }
      message('Loaded your saved notes.');
    }
  } catch {
    message('Saved notes could not be loaded. You can write notes and download a copy.');
  }
  form.addEventListener('input', () => message('You have unsaved changes. Save or download your notes.'));
  document.querySelector('#review-save').addEventListener('click', () => {
    try {
      localStorage.setItem(key, JSON.stringify({version: 1, notes: notes(), savedAt: new Date().toISOString()}));
      message('Saved in this browser.');
    } catch {
      message('Browser saving is unavailable. Download your notes to keep a copy.');
    }
  });
  document.querySelector('#review-download').addEventListener('click', () => {
    const body = ['101C token review', 'Exported: ' + new Date().toISOString(), '',
      ...fields.flatMap(field => [form.querySelector(`label[for="${field.id}"]`).textContent,
        field.value || '(not recorded)', ''])].join('\n');
    const url = URL.createObjectURL(new Blob([body], {type: 'text/plain;charset=utf-8'}));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '101c-token-review.txt';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message('Download requested. Your browser saves the text file.');
  });
  const example = document.querySelector('#review-example');
  const sample = document.querySelector('#review-sample');
  example.addEventListener('click', () => {
    sample.hidden = !sample.hidden;
    example.setAttribute('aria-expanded', String(!sample.hidden));
    example.textContent = sample.hidden ? 'View worked example' : 'Hide worked example';
  });
})();
