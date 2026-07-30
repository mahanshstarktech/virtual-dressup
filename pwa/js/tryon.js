// ═══════════════════════════════════════════════
//  Drape — AI Virtual Try-On Module (v3 — IDM-VTON)
//
//  ARCHITECTURE CHANGE from v2:
//  Instead of live AR camera overlay (which produced
//  a flat 2D image pasted on the body — unrealistic),
//  we now use an AI photo generation approach:
//
//  Flow:
//  1. User selects a garment from wardrobe
//  2. User takes / uploads a full-body selfie
//  3. Both images are sent to CatVTON backend
//  4. AI generates a photorealistic try-on photo
//  5. Before/after comparison shown
//
//  This produces DRAMATICALLY better results because
//  the AI model understands body shape, fabric draping,
//  shadows, and lighting — things a 2D overlay never can.
// ═══════════════════════════════════════════════

import { haptic, showToast, blobToDataURL } from './utils.js';

// ─── State ───────────────────────────────────────
let selectedGarment    = null;  // garment object from wardrobe
let personPhotoDataURL = null;  // full-body selfie from user
let selfieStream       = null;  // camera stream for taking selfie
let generatedResultURL = null;  // AI-generated try-on result

const BACKEND_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:7860'
  : 'https://mahanshgaur-virtual-dressup-backend.hf.space';

// ─── Entry Point ─────────────────────────────────
/**
 * Called by app.js when user navigates to Try-On tab.
 * Shows the garment selection step.
 */
export async function startTryOn() {
  resetTryOnState();
  showTryOnStep('step-select-garment');
  renderGarmentPicker();
}

/** Called by app.js when leaving Try-On tab */
export function stopTryOn() {
  stopSelfieCamera();
  resetTryOnState();
}

function resetTryOnState() {
  selectedGarment    = null;
  personPhotoDataURL = null;
  generatedResultURL = null;
  stopSelfieCamera();
}

// ─── Step Navigation ─────────────────────────────
function showTryOnStep(stepId) {
  document.querySelectorAll('.tryon-step').forEach(el => el.classList.remove('active'));
  const step = document.getElementById(stepId);
  if (step) step.classList.add('active');
}

// ─── Step 1: Select Garment ──────────────────────
function renderGarmentPicker() {
  const grid = document.getElementById('tryon-garment-grid');
  if (!grid) return;

  // Load garments from localStorage (same store as wardrobe)
  let garments = [];
  try {
    garments = JSON.parse(localStorage.getItem('drape_garments') || '[]');
  } catch (e) {}

  if (garments.length === 0) {
    grid.innerHTML = `
      <div class="tryon-empty-state">
        <div class="tryon-empty-icon">👗</div>
        <div class="tryon-empty-title">No garments yet</div>
        <p class="tryon-empty-sub">Add clothes to your wardrobe first, then come back to try them on.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = garments.map(g => `
    <button class="tryon-garment-card" data-id="${g.id}" aria-label="Try on ${g.name}">
      ${g.imageDataURL
        ? `<img src="${g.imageDataURL}" alt="${g.name}" />`
        : `<div class="tryon-garment-emoji">${_emoji(g.category)}</div>`
      }
      <div class="tryon-garment-name">${g.name}</div>
      <div class="tryon-garment-category">${g.category}</div>
    </button>
  `).join('');

  grid.querySelectorAll('.tryon-garment-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      const garment = garments.find(g => g.id === id);
      if (garment) selectGarment(garment);
    });
  });
}

function selectGarment(garment) {
  selectedGarment = garment;
  haptic('light');

  // Update the selected garment preview in step 2
  const preview = document.getElementById('tryon-selected-garment-preview');
  if (preview) {
    if (garment.imageDataURL) {
      preview.innerHTML = `<img src="${garment.imageDataURL}" alt="${garment.name}" />`;
    } else {
      preview.innerHTML = `<div class="tryon-garment-emoji">${_emoji(garment.category)}</div>`;
    }
  }
  const nameEl = document.getElementById('tryon-selected-garment-name');
  if (nameEl) nameEl.textContent = garment.name;

  showTryOnStep('step-take-selfie');
}

// ─── Step 2: Take / Upload Selfie ────────────────
export async function initSelfieCameraStep() {
  const video = document.getElementById('tryon-selfie-video');
  if (!video) return;

  // Stop any existing stream
  stopSelfieCamera();

  try {
    selfieStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = selfieStream;
    video.style.transform = 'scaleX(-1)'; // mirror for natural feel
    await video.play();
  } catch (err) {
    console.warn('[TryOn] Camera error:', err);
    showToast('Camera unavailable — use the upload button instead', '📁');
  }
}

export function captureSelfieFn() {
  const video = document.getElementById('tryon-selfie-video');
  if (!video || !video.videoWidth) {
    showToast('Camera not ready yet', '⚠️');
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  // Mirror to undo the CSS scaleX(-1)
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0);

  personPhotoDataURL = canvas.toDataURL('image/jpeg', 0.92);
  haptic('medium');
  stopSelfieCamera();
  goToGenerating();
}

export function uploadSelfieFn() {
  const input = document.getElementById('tryon-selfie-upload');
  if (input) input.click();
}

export async function onSelfieFileChosen(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    personPhotoDataURL = await blobToDataURL(file);
    stopSelfieCamera();
    goToGenerating();
  } catch (e) {
    showToast('Could not read image file', '⚠️');
  }
}

function stopSelfieCamera() {
  if (selfieStream) {
    selfieStream.getTracks().forEach(t => t.stop());
    selfieStream = null;
  }
  const video = document.getElementById('tryon-selfie-video');
  if (video) video.srcObject = null;
}

// ─── Step 3: Generating ──────────────────────────
async function goToGenerating() {
  if (!selectedGarment || !personPhotoDataURL) {
    showToast('Missing garment or photo', '⚠️');
    return;
  }

  showTryOnStep('step-generating');

  // Animate progress messages
  const messages = [
    'Analyzing your body shape…',
    'Understanding garment texture…',
    'Fitting the garment to your silhouette…',
    'Adding natural shadows and lighting…',
    'Almost there — rendering final result…',
  ];
  let msgIdx = 0;
  const msgEl = document.getElementById('tryon-gen-message');
  const msgInterval = setInterval(() => {
    msgIdx = (msgIdx + 1) % messages.length;
    if (msgEl) msgEl.textContent = messages[msgIdx];
  }, 4000);

  try {
    const result = await callTryOnAPI(personPhotoDataURL, selectedGarment);
    clearInterval(msgInterval);
    showResult(result);
  } catch (err) {
    clearInterval(msgInterval);
    console.error('[TryOn] Generation failed:', err);
    showToast('AI generation failed — please try again', '⚠️');
    showTryOnStep('step-take-selfie');
  }
}

async function callTryOnAPI(personDataURL, garment) {
  // Determine cloth type for CatVTON
  const clothType = _getClothType(garment.category);

  // Convert data URLs to blobs for sending
  const personBlob  = await fetch(personDataURL).then(r => r.blob());
  const garmentBlob = await fetch(garment.imageDataURL).then(r => r.blob());

  // Convert to base64 for Gradio API
  const personB64  = await blobToDataURL(personBlob);
  const garmentB64 = await blobToDataURL(garmentBlob);

  // Call our backend which proxies to CatVTON
  const response = await fetch(`${BACKEND_URL}/api/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: [personB64, garmentB64, clothType, 50, 2.5, 42],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backend error ${response.status}: ${text}`);
  }

  const json = await response.json();
  const output = json.data?.[0];

  if (!output) throw new Error('No output from AI model');

  // Handle both string (base64) and object ({url: "..."}) responses
  return typeof output === 'string' ? output : (output.url || output.value);
}

// ─── Step 4: Result ──────────────────────────────
function showResult(resultDataURL) {
  generatedResultURL = resultDataURL;

  // Populate result images
  const resultImg = document.getElementById('tryon-result-img');
  const beforeImg = document.getElementById('tryon-before-img');

  if (resultImg) resultImg.src = resultDataURL;
  if (beforeImg) beforeImg.src = personPhotoDataURL;

  showTryOnStep('step-result');
  haptic('success');
}

export function shareResult() {
  if (!generatedResultURL) return;

  if (navigator.share) {
    fetch(generatedResultURL)
      .then(r => r.blob())
      .then(blob => {
        const file = new File([blob], 'drape-tryon.png', { type: 'image/png' });
        navigator.share({
          title: 'Virtual Try-On by Drape',
          files: [file],
        }).catch(() => {});
      });
  } else {
    // Download fallback
    const a = document.createElement('a');
    a.href     = generatedResultURL;
    a.download = 'drape-tryon.png';
    a.click();
  }
}

export function tryAnotherGarment() {
  resetTryOnState();
  showTryOnStep('step-select-garment');
  renderGarmentPicker();
}

export function retakeSelfie() {
  personPhotoDataURL = null;
  showTryOnStep('step-take-selfie');
  initSelfieCameraStep();
}

// ─── Helpers ─────────────────────────────────────
function _getClothType(category) {
  const upper = ['tshirt', 'shirt', 'jacket', 'hoodie', 'sweater', 'blouse', 'top'];
  const lower = ['pants', 'jeans', 'shorts', 'skirt', 'trousers'];
  if (lower.includes(category?.toLowerCase())) return 'lower';
  if (category?.toLowerCase() === 'dress' || category?.toLowerCase() === 'jumpsuit') return 'overall';
  return 'upper';
}

function _emoji(cat) {
  return {
    tshirt:'👕', shirt:'👔', jacket:'🧥', hoodie:'🥷', pants:'👖',
    jeans:'👖', shorts:'🩳', dress:'👗', skirt:'👗', sweater:'🧶',
    blouse:'👚', top:'👚',
  }[cat?.toLowerCase()] || '👕';
}

// ─── Backwards compat stubs (called by app.js) ───
export function addGarmentToTryOn()    { /* noop — handled by selectGarment flow */ }
export function removeGarmentFromTryOn() { /* noop */ }
export function clearTryOnGarments()   { resetTryOnState(); }
