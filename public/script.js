'use strict';

/* ── Element references ──────────────────────────────────────────────────────── */
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const progressSection = document.getElementById('progressSection');
const progressText = document.getElementById('progressText');
const downloadSection = document.getElementById('downloadSection');
const fileNameEl = document.getElementById('fileName');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const errorSection = document.getElementById('errorSection');
const errorMessage = document.getElementById('errorMessage');
const retryBtn = document.getElementById('retryBtn');
const statusPill = document.querySelector('.status-pill');

/* ── State ───────────────────────────────────────────────────────────────────── */
let formattedBlob = null;
let originalFileName = '';

function setStatus(text, type = 'ready') {
  if (!statusPill) return;

  statusPill.textContent = text;
  statusPill.style.borderColor = 'rgb(159 255 221 / 0.6)';
  statusPill.style.background = 'rgb(77 255 173 / 0.17)';
  statusPill.style.color = '#d7ffe8';

  if (type === 'working') {
    statusPill.style.borderColor = 'rgb(158 244 255 / 0.65)';
    statusPill.style.background = 'rgb(138 231 255 / 0.18)';
    statusPill.style.color = '#ecfeff';
  }

  if (type === 'error') {
    statusPill.style.borderColor = 'rgb(255 156 156 / 0.65)';
    statusPill.style.background = 'rgb(255 164 164 / 0.18)';
    statusPill.style.color = '#fff1f1';
  }
}

function setActionsDisabled(disabled) {
  downloadBtn.disabled = disabled;
  resetBtn.disabled = disabled;
  retryBtn.disabled = disabled;
}

/* ── Drag-and-drop ───────────────────────────────────────────────────────────── */
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length > 0) {
    handleFile(e.dataTransfer.files[0]);
  }
});

/* ── Click to browse ─────────────────────────────────────────────────────────── */
dropZone.addEventListener('click', () => fileInput.click());

// Allow keyboard activation (Enter / Space)
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    handleFile(fileInput.files[0]);
  }
});

/* ── Download ────────────────────────────────────────────────────────────────── */
downloadBtn.addEventListener('click', () => {
  if (!formattedBlob) return;

  const url = URL.createObjectURL(formattedBlob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `formatted_${originalFileName}`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
});

/* ── Reset / retry ───────────────────────────────────────────────────────────── */
resetBtn.addEventListener('click', resetUI);
retryBtn.addEventListener('click', resetUI);

function resetUI() {
  formattedBlob = null;
  originalFileName = '';
  fileInput.value = '';
  setActionsDisabled(false);

  downloadSection.classList.add('hidden');
  errorSection.classList.add('hidden');
  progressSection.classList.add('hidden');
  dropZone.classList.remove('hidden');
  progressText.textContent = 'Uploading and formatting...';
  setStatus('Ready', 'ready');
}

/* ── File handling ───────────────────────────────────────────────────────────── */
async function handleFile(file) {
  // Client-side validation
  if (!file.name.toLowerCase().endsWith('.docx')) {
    showError('Please upload a .docx file.');
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    showError('File size exceeds the 10 MB limit.');
    return;
  }

  originalFileName = file.name;

  // Show progress
  setActionsDisabled(true);
  dropZone.classList.add('hidden');
  progressSection.classList.remove('hidden');
  progressText.textContent = 'Uploading and formatting your document...';
  setStatus('Formatting...', 'working');

  try {
    const formData = new FormData();
    formData.append('document', file);

    const response = await fetch('/api/format', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      let msg = `Server error (${response.status})`;
      try {
        const data = await response.json();
        if (data.message) msg = data.message;
      } catch {
        // ignore JSON parse errors
      }
      throw new Error(msg);
    }

    formattedBlob = await response.blob();

    progressSection.classList.add('hidden');
    downloadSection.classList.remove('hidden');
    fileNameEl.textContent = `formatted_${originalFileName}`;
    setStatus('Done', 'ready');
    setActionsDisabled(false);
  } catch (err) {
    setActionsDisabled(false);
    showError(err.message || 'An error occurred while formatting the document.');
  }
}

function showError(message) {
  dropZone.classList.add('hidden');
  progressSection.classList.add('hidden');
  downloadSection.classList.add('hidden');
  errorSection.classList.remove('hidden');
  errorMessage.textContent = message;
  setStatus('Error', 'error');
}
