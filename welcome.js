const aiToggle = document.getElementById('aiFeaturesToggle');
const aiStatus = document.getElementById('aiDownloadStatus');

chrome.storage.local.get(['aiFeaturesEnabled']).then(({ aiFeaturesEnabled }) => {
  aiToggle.checked = !!aiFeaturesEnabled;
});

aiToggle.addEventListener('change', async () => {
  chrome.storage.local.set({ aiFeaturesEnabled: aiToggle.checked });

  if (!aiToggle.checked) {
    aiStatus.textContent = '';
    return;
  }
  if (!('Summarizer' in self)) {
    aiStatus.textContent = 'this chrome version does not support the "Summarizer" api.';
    return;
  }
  try {
    const options = { outputLanguage: 'en' };
    const availability = await Summarizer.availability(options);
    if (availability === 'unavailable') {
      aiStatus.textContent = 'ai model unavailable on this device.';
      return;
    }
    if (availability === 'available') {
      aiStatus.textContent = 'model ready.';
      return;
    }
    aiStatus.textContent = 'downloading on-device model...';
    await Summarizer.create({
      ...options,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          aiStatus.textContent = `downloading on-device model... ${Math.round(e.loaded * 100)}%`;
        });
      }
    });
    aiStatus.textContent = 'model ready.';
  } catch (e) {
    aiStatus.textContent = 'could not start model download.';
  }
});