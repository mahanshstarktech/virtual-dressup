// ═══════════════════════════════════════════════
//  Drape — Garment Capture Module
// ═══════════════════════════════════════════════

import { uid, blobToDataURL, resizeImage, showToast, haptic, categoryEmoji } from './utils.js';
import { addGarment } from './wardrobe.js';

let stream         = null;
let capturedDataURL = null;
let currentStep    = 1;
let selectedCategory = null;
let facingMode     = 'environment'; // back camera for garment capture

const CATEGORIES = [
  { id: 'tshirt',  label: 'T-Shirt',  emoji: '👕' },
  { id: 'shirt',   label: 'Shirt',    emoji: '👔' },
  { id: 'jacket',  label: 'Jacket',   emoji: '🧥' },
  { id: 'hoodie',  label: 'Hoodie',   emoji: '🫱' },
  { id: 'sweater', label: 'Sweater',  emoji: '🧶' },
  { id: 'pants',   label: 'Pants',    emoji: '👖' },
  { id: 'jeans',   label: 'Jeans',    emoji: '🩲' },
  { id: 'shorts',  label: 'Shorts',   emoji: '🩳' },
  { id: 'dress',   label: 'Dress',    emoji: '👗' },
  { id: 'skirt',   label: 'Skirt',    emoji: '🪡' },
  { id: 'shoes',   label: 'Shoes',    emoji: '👟' },
  { id: 'other',   label: 'Other',    emoji: '🛍️' },
];

const COLORS = [
  { name: 'Black',     hex: '#000000' },
  { name: 'White',     hex: '#FFFFFF', border: true },
  { name: 'Gray',      hex: '#8E8E93' },
  { name: 'Navy',      hex: '#1C3A6E' },
  { name: 'Blue',      hex: '#007AFF' },
  { name: 'Red',       hex: '#FF3B30' },
  { name: 'Green',     hex: '#34C759' },
  { name: 'Yellow',    hex: '#FFD60A' },
  { name: 'Orange',    hex: '#FF9500' },
  { name: 'Pink',      hex: '#FF2D55' },
  { name: 'Purple',    hex: '#AF52DE' },
  { name: 'Brown',     hex: '#A2845E' },
];

/**
 * Initialize the capture screen
 */
export function initCapture() {
  renderCategoryGrid();
  renderColorPicker();
  setupEventListeners();
}

function renderCategoryGrid() {
  const grid = document.getElementById('category-grid');
  if (!grid) return;
  grid.innerHTML = CATEGORIES.map(cat => `
    <button class="category-item" data-cat="${cat.id}" aria-label="${cat.label}">
      <span class="category-item__emoji">${cat.emoji}</span>
      <span class="category-item__label">${cat.label}</span>
    </button>
  `).join('');

  grid.querySelectorAll('.category-item').forEach(btn => {
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.category-item').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedCategory = btn.dataset.cat;
      haptic('light');
      // Auto-advance after short delay
      setTimeout(() => goToStep(2), 300);
    });
  });
}

function renderColorPicker() {
  const row = document.getElementById('color-picker-row');
  if (!row) return;
  row.innerHTML = COLORS.map(c => `
    <button 
      class="color-swatch" 
      data-color="${c.name}"
      style="background:${c.hex}; ${c.border ? 'border-color: #C6C6C8;' : ''}"
      aria-label="${c.name}"
    ></button>
  `).join('');

  row.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      row.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      haptic('light');
    });
  });

  // Select black by default
  row.querySelector('.color-swatch')?.classList.add('selected');
}

function setupEventListeners() {
  // Close button
  document.getElementById('capture-close-btn')?.addEventListener('click', closeCapture);

  // Camera flip button
  document.getElementById('flip-camera-btn')?.addEventListener('click', flipCamera);

  // Shutter button
  document.getElementById('shutter-btn')?.addEventListener('click', capturePhoto);

  // Retake button
  document.getElementById('retake-btn')?.addEventListener('click', () => goToStep(2));

  // Save button
  document.getElementById('save-garment-btn')?.addEventListener('click', saveGarment);

  // Back buttons
  document.getElementById('back-to-step1')?.addEventListener('click', () => goToStep(1));
  document.getElementById('back-to-step2')?.addEventListener('click', () => goToStep(2));
}

/**
 * Open the capture screen
 */
export function openCapture() {
  selectedCategory = null;
  capturedDataURL = null;
  currentStep = 1;
  
  const screen = document.getElementById('screen-capture');
  screen.classList.add('active');
  screen.classList.add('slide-in-right');
  
  goToStep(1);
  haptic('medium');
}

/**
 * Close the capture screen
 */
export function closeCapture() {
  stopCamera();
  const screen = document.getElementById('screen-capture');
  screen.classList.remove('active', 'slide-in-right');
  haptic('light');
  // Dispatch event to notify app
  window.dispatchEvent(new CustomEvent('capture-closed'));
}

/**
 * Navigate to a capture step
 */
function goToStep(step) {
  currentStep = step;

  // Update step indicators
  const dots = document.querySelectorAll('.step-dot');
  dots.forEach((dot, i) => {
    dot.classList.remove('active', 'done');
    if (i + 1 === step)    dot.classList.add('active');
    if (i + 1 < step)     dot.classList.add('done');
  });

  // Show/hide steps
  document.querySelectorAll('.capture-step').forEach(el => el.classList.remove('active'));
  const activeStep = document.getElementById(`capture-step-${step}`);
  if (activeStep) activeStep.classList.add('active');

  // Step-specific logic
  if (step === 2) startCamera();
  if (step !== 2) stopCamera();
}

/**
 * Start the camera
 */
async function startCamera() {
  try {
    if (stream) stopCamera();
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode,
        width:  { ideal: 1280 },
        height: { ideal: 1280 },
      },
      audio: false,
    });
    const video = document.getElementById('capture-video');
    if (video) {
      video.srcObject = stream;
      // Mirror for front camera
      video.style.transform = facingMode === 'user' ? 'scaleX(-1)' : 'none';
    }
  } catch (err) {
    console.error('Camera error:', err);
    showToast('Camera access denied', '⚠️');
    // Fallback: go back to step 1
    goToStep(1);
  }
}

/**
 * Stop the camera
 */
function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  const video = document.getElementById('capture-video');
  if (video) video.srcObject = null;
}

/**
 * Flip between front/back camera
 */
async function flipCamera() {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  haptic('light');
  await startCamera();
}

/**
 * Capture a photo from the video stream
 */
async function capturePhoto() {
  const video  = document.getElementById('capture-video');
  const canvas = document.getElementById('capture-canvas');
  if (!video || !canvas) return;

  haptic('medium');

  // Flash effect
  const flash = document.createElement('div');
  flash.style.cssText = `
    position:absolute;inset:0;background:white;z-index:999;
    animation: flashOut 0.3s ease-out forwards;
    pointer-events:none;
  `;
  const style = document.createElement('style');
  style.textContent = '@keyframes flashOut { from{opacity:0.8} to{opacity:0} }';
  document.head.appendChild(style);
  document.getElementById('capture-step-2').appendChild(flash);
  setTimeout(() => flash.remove(), 300);

  // Draw to canvas
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (facingMode === 'user') {
    // Mirror front camera
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0);

  // Get data URL and resize
  const rawDataURL = canvas.toDataURL('image/jpeg', 0.9);
  capturedDataURL = await resizeImage(rawDataURL, 800, 1066, 0.88);

  // Go to processing step
  goToStep(3);
  stopCamera();
  await processImage();
}

/**
 * Process the captured image (background removal)
 */
async function processImage() {
  const preview = document.getElementById('processing-preview');
  if (preview) {
    preview.src = capturedDataURL;
    preview.style.display = 'block';
  }

  // Try to use background removal library
  let processedDataURL = capturedDataURL;
  try {
    // Dynamically import background removal
    const { removeBackground } = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.5/dist/background-removal.js');
    
    const blob = await fetch(capturedDataURL).then(r => r.blob());
    const resultBlob = await removeBackground(blob, {
      publicPath: 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.5/dist/',
      model: 'small',
    });
    processedDataURL = await blobToDataURL(resultBlob);
  } catch (err) {
    console.warn('Background removal unavailable, using original:', err.message);
    // Gracefully fall back to original image
  }

  capturedDataURL = processedDataURL;

  // Update preview with processed image
  if (preview) preview.src = capturedDataURL;

  // Auto-advance to review
  await new Promise(r => setTimeout(r, 500));
  goToStep(4);
  
  // Show processed image in review
  const reviewImg = document.getElementById('review-garment-img');
  const reviewEmoji = document.getElementById('review-garment-emoji');
  if (reviewImg && reviewEmoji) {
    reviewImg.src = capturedDataURL;
    reviewImg.style.display = 'block';
    reviewEmoji.style.display = 'none';
  }

  // Pre-fill garment name from category
  const nameInput = document.getElementById('garment-name-input');
  if (nameInput && selectedCategory) {
    const cat = CATEGORIES.find(c => c.id === selectedCategory);
    nameInput.value = cat ? `My ${cat.label}` : 'New Garment';
  }
}

/**
 * Save the garment to the wardrobe
 */
async function saveGarment() {
  const nameInput  = document.getElementById('garment-name-input');
  const selectedColorBtn = document.querySelector('#color-picker-row .color-swatch.selected');

  const name  = nameInput?.value.trim() || 'Unnamed Garment';
  const color = selectedColorBtn?.dataset.color || 'Unknown';
  const cat   = selectedCategory || 'other';

  haptic('medium');

  const saveBtn = document.getElementById('save-garment-btn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<div class="processing-spinner" style="width:20px;height:20px;border-width:2px;margin:0"></div> Saving…';
  }

  try {
    const garment = {
      id:             uid(),
      name,
      category:       cat,
      color,
      imageDataURL:   capturedDataURL,
      createdAt:      Date.now(),
    };

    await addGarment(garment);
    showToast(`${name} added to wardrobe`, categoryEmoji(cat));
    haptic('success');
    closeCapture();

    // Notify app to refresh wardrobe
    window.dispatchEvent(new CustomEvent('wardrobe-updated'));
  } catch (err) {
    console.error('Save failed:', err);
    showToast('Failed to save garment', '⚠️');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Add to Wardrobe';
    }
  }
}
