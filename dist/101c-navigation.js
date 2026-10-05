const sectionPicker = document.querySelector('#section-picker');
if (sectionPicker) {
  sectionPicker.closest('.section-select').hidden = false;
  sectionPicker.addEventListener('change', () => {
    const destination = sectionPicker.value;
    if (/^\.\/meme-101c-section-(?:[1-9]|10)\.html$/.test(destination)) {
      location.assign(destination);
    }
  });
}
