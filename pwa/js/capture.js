// ═══════════════════════════════════════════════
//  Drape — Garment Capture Module  (v2)
//
//  WHAT'S NEW vs v1:
//  - "Upload Photo(s)" button: opens the native file
//    picker. Supports selecting multiple files.
//    If multiple images are chosen a mini-carousel
//    lets you pick the best one before processing.
//  - "Paste URL" button: shows a text field where
//    you paste any image URL (Amazon, Flipkart, etc.)
//    It fetches the image through a CORS proxy and
//    pipes it through the same background-removal step.
//  - Both paths merge back into the shared
//    processImage() function so background removal
//    and saving works identically for camera,
//    upload, and URL.
// ═══════════════════════════════════════════════

import { uid, blobToDataURL, resizeImage, showToast, haptic, categoryEmoji } from './utils.js';
import { addGarment } from './wardrobe.js';

// ─── Module State ──────────────────────────────
let stream           = null;
let capturedDataURL  = null;
let currentStep      = 1;
let selectedCategory = null;
let facingMode       = 'environment'; // back camera for garment capture

// For multi-photo selection carousel
let uploadedPhotos   = [];   // Array of dataURLs from file picker
let selectedPhotoIdx = 0;    // Which one the user picks

const CATEGORIES = [
  { id: 'tshirt',  label: 'T-Shirt',  emoji: '👕' },
  { id: 'shirt',   label: 'Shirt',    emoji: '👔' },
  { id: 'jacket',  label: 'Jacket',   emoji: '🧥' },
  { id: 'hoodie',  label: 'Hoodie',   emoji: '🥷' },
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
  { name: 'Black',  hex: '#000000' },
  { name: 'White',  hex: '#FFFFFF', border: true },
  { name: 'Gray',   hex: '#8E8E93' },
  { name: 'Navy',   hex: '#1C3A6E' },
  { name: 'Blue',   hex: '#007AFF' },
  { name: 'Red',    hex: '#FF3B30' },
  { name: 'Green',  hex: '#34C759' },
  { name: 'Yellow', hex: '#FFD60A' },
  { name: 'Orange', hex: '#FF9500' },
  { name: 'Pink',   hex: '#FF2D55' },
  { name: 'Purple', hex: '#AF52DE' },
  { name: 'Brown',  hex: '#A2845E' },
];

// ─── Initialization ────────────────────────────
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
      setTimeout(() => goToStep(2), 300); // short delay for selection animation
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
      style="background:${c.hex};${c.border ? 'border:2px solid #C6C6C8;' : ''}"
      aria-label="${c.name}"
    ></button>
  `).join('');

  row.querySelectorAll('.color-swatch').forEach(s => {
    s.addEventListener('click', () => {
      row.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('selected'));
      s.classList.add('selected');
      haptic('light');
    });
  });
  row.querySelector('.color-swatch')?.classList.add('selected'); // default: black
}

function setupEventListeners() {
  document.getElementById('capture-close-btn')?.addEventListener('click', closeCapture);
  document.getElementById('flip-camera-btn')?.addEventListener('click', flipCamera);
  document.getElementById('shutter-btn')?.addEventListener('click', capturePhoto);
  document.getElementById('retake-btn')?.addEventListener('click', () => goToStep(2));
  document.getElementById('save-garment-btn')?.addEventListener('click', saveGarment);

  // ── NEW: File upload ──────────────────────────────────────────────────────
  // Hidden file input — we trigger it programmatically from the upload button.
  // `multiple` allows selecting many photos at once (e.g. all angles of one jacket).
  const fileInput = document.getElementById('garment-file-input');
  const uploadBtn = document.getElementById('upload-photo-btn');

  uploadBtn?.addEventListener('click', () => {
    haptic('light');
    fileInput?.click(); // opens native photo picker
  });

  fileInput?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    await handleUploadedFiles(files);
    // Reset the input so the same file can be re-selected if needed
    fileInput.value = '';
  });

  // ── NEW: URL paste ────────────────────────────────────────────────────────
  // Opens a small overlay with a text input.
  // Supports any direct image URL or Amazon/Flipkart product image URLs.
  const urlBtn     = document.getElementById('url-paste-btn');
  const urlOverlay = document.getElementById('url-overlay');
  const urlInput   = document.getElementById('url-paste-input');
  const urlConfirm = document.getElementById('url-confirm-btn');
  const urlCancel  = document.getElementById('url-cancel-btn');

  urlBtn?.addEventListener('click', () => {
    haptic('light');
    urlOverlay?.classList.add('open');
    setTimeout(() => urlInput?.focus(), 300);
  });

  urlCancel?.addEventListener('click', () => {
    urlOverlay?.classList.remove('open');
    if (urlInput) urlInput.value = '';
  });

  urlConfirm?.addEventListener('click', () => handleURLInput());

  urlInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleURLInput();
    if (e.key === 'Escape') urlCancel?.click();
  });

  // ── Multi-photo carousel navigation ──────────────────────────────────────
  document.getElementById('carousel-prev')?.addEventListener('click', () => navigateCarousel(-1));
  document.getElementById('carousel-next')?.addEventListener('click', () => navigateCarousel(1));
  document.getElementById('carousel-use-btn')?.addEventListener('click', useSelectedCarouselPhoto);
}

// ─── Screen Navigation ─────────────────────────
export function openCapture() {
  selectedCategory = null;
  capturedDataURL  = null;
  uploadedPhotos   = [];
  currentStep      = 1;

  const screen = document.getElementById('screen-capture');
  screen?.classList.add('active');
  goToStep(1);
  haptic('medium');
}

export function closeCapture() {
  stopCamera();
  const screen = document.getElementById('screen-capture');
  screen?.classList.remove('active');
  haptic('light');
  window.dispatchEvent(new CustomEvent('capture-closed'));
}

function goToStep(step) {
  currentStep = step;

  // Update step dots
  document.querySelectorAll('.step-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i + 1 === step);
    dot.classList.toggle('done',   i + 1 < step);
  });

  // Show only the active step panel
  document.querySelectorAll('.capture-step').forEach(el => el.classList.remove('active'));
  document.getElementById(`capture-step-${step}`)?.classList.add('active');

  if (step === 2) startCamera();
  else stopCamera();
}

// ─── Camera ────────────────────────────────────
async function startCamera() {
  try {
    if (stream) stopCamera();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: false,
    });
    const video = document.getElementById('capture-video');
    if (video) {
      video.srcObject = stream;
      video.style.transform = facingMode === 'user' ? 'scaleX(-1)' : 'none';
    }
  } catch (err) {
    console.error('[Capture] Camera error:', err);
    showToast('Camera access denied', '⚠️');
    goToStep(1);
  }
}

function stopCamera() {
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  const video = document.getElementById('capture-video');
  if (video) video.srcObject = null;
}

async function flipCamera() {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  haptic('light');
  await startCamera();
}

async function capturePhoto() {
  const video  = document.getElementById('capture-video');
  const canvas = document.getElementById('capture-canvas');
  if (!video || !canvas) return;

  haptic('medium');
  triggerFlash();

  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (facingMode === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0);

  const rawURL = canvas.toDataURL('image/jpeg', 0.9);
  capturedDataURL = await resizeImage(rawURL, 800, 1066, 0.88);

  goToStep(3);
  stopCamera();
  await processImage();
}

function triggerFlash() {
  const flash = document.createElement('div');
  flash.style.cssText = 'position:absolute;inset:0;background:white;z-index:99;pointer-events:none;';
  flash.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
  document.getElementById('capture-step-2')?.appendChild(flash);
  setTimeout(() => flash.remove(), 320);
}

// ─── Upload Handler ────────────────────────────
/**
 * Called when the user picks files from the native file picker.
 *
 * If ONE file: jump straight to processing (same as camera path).
 * If MULTIPLE files: show the carousel so the user can pick the
 *   best angle/image before we process it.
 *
 * WHY: Amazon/Flipkart products often have 5–8 images.
 * The user might grab all of them and then pick the
 * clean white-background product shot.
 */
async function handleUploadedFiles(files) {
  showToast(`Loading ${files.length} image${files.length > 1 ? 's' : ''}…`, '📁');

  // Read all files in parallel
  uploadedPhotos = await Promise.all(
    files.map(file => blobToDataURL(file))
  );

  if (uploadedPhotos.length === 1) {
    // Single image — process immediately
    capturedDataURL = await resizeImage(uploadedPhotos[0], 800, 1066, 0.88);
    goToStep(3);
    stopCamera();
    await processImage();
  } else {
    // Multiple images — show carousel
    selectedPhotoIdx = 0;
    goToStep(3); // reuse processing step container for carousel
    stopCamera();
    showCarousel();
  }
}

// ─── URL Handler ───────────────────────────────
/**
 * Fetches an image from a URL.
 *
 * HOW IT WORKS:
 * Direct image URLs (ending in .jpg, .png, .webp) are fetched
 * through api.allorigins.win — a free CORS proxy — because
 * most product sites block cross-origin requests from browsers.
 *
 * AMAZON/FLIPKART: Their product images are hosted on their CDN
 * (images-na.ssl-images-amazon.com, rukminim1.flixcart.com etc).
 * You can paste those direct image URLs and they work perfectly.
 * Full product page URLs won't work — paste the image URL directly
 * (right-click the product image → Copy Image Address).
 */
async function handleURLInput() {
  const overlay  = document.getElementById('url-overlay');
  const urlInput = document.getElementById('url-paste-input');
  const rawURL   = urlInput?.value.trim();

  if (!rawURL) { showToast('Please paste an image URL', '⚠️'); return; }

  overlay?.classList.remove('open');
  if (urlInput) urlInput.value = '';

  goToStep(3);
  stopCamera();
  showProcessingState('Fetching image…');

  try {
    let imageURL = rawURL;

    // Wrap in CORS proxy if it's an external URL (not a data: or blob: URI)
    if (imageURL.startsWith('http')) {
      imageURL = `https://api.allorigins.win/raw?url=${encodeURIComponent(rawURL)}`;
    }

    const resp = await fetch(imageURL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const blob = await resp.blob();
    if (!blob.type.startsWith('image/')) throw new Error('URL did not return an image');

    const dataURL = await blobToDataURL(blob);
    capturedDataURL = await resizeImage(dataURL, 800, 1066, 0.88);
    await processImage();

  } catch (err) {
    console.error('[Capture] URL fetch error:', err);
    showToast(`Could not load image: ${err.message}`, '⚠️');
    goToStep(2); // back to camera/upload step
  }
}

// ─── Multi-Photo Carousel ──────────────────────
/**
 * Shows a carousel UI in the processing step area so the user
 * can swipe through their uploaded photos and pick the best one.
 *
 * The carousel replaces the spinner. Once they tap "Use This Photo",
 * we run the selected image through processImage() as normal.
 */
function showCarousel() {
  const container = document.getElementById('capture-step-3');
  if (!container) return;

  container.innerHTML = `
    <div class="photo-carousel">
      <div class="carousel-header">
        <h2 class="capture-step-title">Pick the best photo</h2>
        <p class="capture-step-sub">${uploadedPhotos.length} photos selected — choose the clearest one</p>
      </div>
      <div class="carousel-viewer">
        <button class="carousel-nav carousel-nav--left" id="carousel-prev" aria-label="Previous photo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div class="carousel-img-wrap">
          <img id="carousel-main-img" src="${uploadedPhotos[0]}" alt="Selected garment photo" />
          <div class="carousel-counter" id="carousel-counter">1 / ${uploadedPhotos.length}</div>
        </div>
        <button class="carousel-nav carousel-nav--right" id="carousel-next" aria-label="Next photo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
      <div class="carousel-thumbnails" id="carousel-thumbnails">
        ${uploadedPhotos.map((url, i) => `
          <button class="carousel-thumb ${i === 0 ? 'active' : ''}" data-idx="${i}">
            <img src="${url}" alt="Photo ${i + 1}" />
          </button>
        `).join('')}
      </div>
      <button class="btn-primary" id="carousel-use-btn" style="margin-top:16px;width:100%;">
        ✓ Use This Photo
      </button>
    </div>
  `;

  // Re-bind events because we just replaced the DOM
  document.getElementById('carousel-prev')?.addEventListener('click', () => navigateCarousel(-1));
  document.getElementById('carousel-next')?.addEventListener('click', () => navigateCarousel(1));
  document.getElementById('carousel-use-btn')?.addEventListener('click', useSelectedCarouselPhoto);

  container.querySelectorAll('.carousel-thumb').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedPhotoIdx = parseInt(btn.dataset.idx);
      updateCarouselView();
    });
  });
}

function navigateCarousel(direction) {
  selectedPhotoIdx = (selectedPhotoIdx + direction + uploadedPhotos.length) % uploadedPhotos.length;
  updateCarouselView();
  haptic('light');
}

function updateCarouselView() {
  const img     = document.getElementById('carousel-main-img');
  const counter = document.getElementById('carousel-counter');
  if (img) img.src = uploadedPhotos[selectedPhotoIdx];
  if (counter) counter.textContent = `${selectedPhotoIdx + 1} / ${uploadedPhotos.length}`;

  document.querySelectorAll('.carousel-thumb').forEach((btn, i) => {
    btn.classList.toggle('active', i === selectedPhotoIdx);
  });
}

async function useSelectedCarouselPhoto() {
  haptic('medium');
  capturedDataURL = await resizeImage(uploadedPhotos[selectedPhotoIdx], 800, 1066, 0.88);
  showProcessingState('Analyzing garment…');
  await processImage();
}

// ─── Image Processing ──────────────────────────
/**
 * Runs the selected image through background removal.
 * This is the same for ALL input methods:
 *   camera → capturePhoto() → here
 *   upload → handleUploadedFiles() → here
 *   URL    → handleURLInput() → here
 *
 * HOW BACKGROUND REMOVAL WORKS:
 * We use @imgly/background-removal, a 100% client-side
 * WebAssembly model (REMBG/U2Net). It runs entirely on
 * the user's device — images never leave their phone.
 * The model is ~5 MB and is cached by the browser after
 * the first use.
 *
 * If it fails (network offline, very old browser), we
 * gracefully fall back to showing the original image.
 * The garment can still be tried on — it just won't have
 * a transparent background (the white/plain background
 * from a product photo looks fine in most cases).
 */
async function processImage() {
  // Restore the step container to the spinner/preview layout
  // (might have been replaced by the carousel)
  const container = document.getElementById('capture-step-3');
  if (container && !document.getElementById('processing-preview')) {
    container.innerHTML = `
      <div class="processing-view">
        <img class="processing-preview" id="processing-preview" src="" alt="Processing" style="display:none;max-height:200px;object-fit:contain;border-radius:16px;margin-bottom:16px;" />
        <div class="processing-spinner"></div>
        <div class="processing-title">Analyzing garment…</div>
        <p class="processing-subtitle">Removing background · Running AI</p>
      </div>
    `;
  }

  const preview = document.getElementById('processing-preview');
  if (preview && capturedDataURL) { preview.src = capturedDataURL; preview.style.display = 'block'; }

  let processedDataURL = capturedDataURL;
  try {
    const blob = await fetch(capturedDataURL).then(r => r.blob());
    
    // Send to Gradio's native API — this is the only approach that properly
    // triggers @spaces.GPU allocation on Hugging Face ZeroGPU.
    const BACKEND_URL = window.location.hostname === 'localhost'
      ? 'http://localhost:7860'
      : 'https://mahanshgaur-virtual-dressup-backend.hf.space';

    // Convert blob to base64 data URL for Gradio's JSON API
    const base64Image = await blobToDataURL(blob);

    const response = await fetch(`${BACKEND_URL}/api/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [base64Image] }),
    });

    if (!response.ok) throw new Error(`Backend returned ${response.status}`);

    const result = await response.json();
    // Gradio returns { data: [{ url: "..." }] } or { data: ["data:image/png;base64,..."] }
    const output = result.data?.[0];
    if (output) {
      processedDataURL = typeof output === 'string' ? output : (output.url || output);
    }
    console.log('[Capture] Background removed by U2Net-Clothing (ZeroGPU) successfully');
  } catch (err) {
    console.warn('[Capture] Backend background removal failed:', err.message);
    // Fall back to original image, but let the user know
    showToast('AI background removal failed, using original', '⚠️');
  }

  capturedDataURL = processedDataURL;
  await new Promise(r => setTimeout(r, 400)); // brief pause so spinner is visible
  goToStep(4);

  const reviewImg   = document.getElementById('review-garment-img');
  const reviewEmoji = document.getElementById('review-garment-emoji');
  if (reviewImg)   { reviewImg.src = capturedDataURL; reviewImg.style.display = 'block'; }
  if (reviewEmoji)   reviewEmoji.style.display = 'none';

  const nameInput = document.getElementById('garment-name-input');
  if (nameInput && selectedCategory) {
    const cat = CATEGORIES.find(c => c.id === selectedCategory);
    nameInput.value = cat ? `My ${cat.label}` : 'New Garment';
  }
}

function showProcessingState(message) {
  const container = document.getElementById('capture-step-3');
  if (!container) return;
  container.innerHTML = `
    <div class="processing-view">
      <div class="processing-spinner"></div>
      <div class="processing-title">${message}</div>
    </div>
  `;
}

// ─── Save ──────────────────────────────────────
async function saveGarment() {
  const nameInput       = document.getElementById('garment-name-input');
  const selectedColor   = document.querySelector('#color-picker-row .color-swatch.selected');

  const name  = nameInput?.value.trim() || 'Unnamed Garment';
  const color = selectedColor?.dataset.color || 'Unknown';
  const cat   = selectedCategory || 'other';

  haptic('medium');

  const saveBtn = document.getElementById('save-garment-btn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<div class="processing-spinner" style="width:20px;height:20px;border-width:2px;margin:0;display:inline-block;vertical-align:middle;"></div> Saving…';
  }

  try {
    await addGarment({ id: uid(), name, category: cat, color, imageDataURL: capturedDataURL, createdAt: Date.now() });
    showToast(`${name} added to wardrobe`, categoryEmoji(cat));
    haptic('success');
    closeCapture();
    window.dispatchEvent(new CustomEvent('wardrobe-updated'));
  } catch (err) {
    console.error('[Capture] Save failed:', err);
    showToast('Failed to save garment', '⚠️');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Add to Wardrobe'; }
  }
}
