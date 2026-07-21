// ═══════════════════════════════════════════════
//  Drape — Real-Time AR Try-On Module  (v2 — fixed)
//
//  WHAT CHANGED FROM v1:
//  - MediaPipe is now imported at the top as a
//    static ESM import (not a fragile dynamic one).
//    This is the only reliable way to get
//    PoseLandmarker and FilesetResolver in the browser.
//  - `cachedLandmarks` stores the last detected pose.
//    Every animation frame draws using this cache,
//    so the overlay is stable even between detection ticks.
//  - Canvas resize is guarded so it only happens when
//    dimensions actually change (avoids clearing on every frame).
//  - Error messages surface to the UI so you can see
//    exactly what's failing instead of silent black screen.
// ═══════════════════════════════════════════════

// ── Static top-level import (this is the correct MediaPipe pattern) ──
// The wasm files are loaded by FilesetResolver using the CDN URL below.
import { PoseLandmarker, FilesetResolver }
  from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

import { dist, midpoint, angle, loadImage, haptic, showToast, categoryType } from './utils.js';

// ─── State ───────────────────────────────────────
let tryonStream      = null;
let poseLandmarker   = null;
let animFrameId      = null;
let isRunning        = false;
let activeGarments   = {};   // { id: garmentData }
let garmentImages    = {};   // { id: HTMLImageElement }
let lastPoseTime     = 0;
let cachedLandmarks  = null; // ← KEY FIX: store last good pose result
                              //   so overlay stays visible between frames

// Exponential smoothing for jitter-free overlay
const SMOOTH = 0.25;
let smoothed = {};

// MediaPipe landmark index constants
const LM = {
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_HIP:      23, R_HIP:      24,
  L_KNEE:     25, R_KNEE:     26,
  L_ANKLE:    27, R_ANKLE:    28,
};

// ─── MediaPipe Initialization ──────────────────
/**
 * Creates the PoseLandmarker once and caches it.
 * Called once when the try-on screen opens.
 *
 * WHY: PoseLandmarker is heavy (~5 MB model download).
 * We initialise it once and reuse it for the lifetime
 * of the try-on session.
 */
async function initPoseLandmarker() {
  if (poseLandmarker) return; // already loaded — do nothing

  updatePoseStatus('loading', 'Downloading AI model (first time ~5 MB)…');

  // FilesetResolver downloads the WASM binary for MediaPipe's
  // vision runtime from the CDN. We point it to the same version
  // as the JS bundle above.
  const filesetResolver = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
  );

  poseLandmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      // Lite model — small download, fast inference, good enough for POC
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
      delegate: 'GPU', // Uses WebGL for acceleration; falls back to CPU automatically
    },
    runningMode:                  'VIDEO', // continuous stream, not single image
    numPoses:                     1,
    minPoseDetectionConfidence:   0.5,
    minPosePresenceConfidence:    0.5,
    minTrackingConfidence:        0.5,
  });

  console.log('[TryOn] ✅ Pose Landmarker ready');
}

// ─── Camera Startup ────────────────────────────
/**
 * Entry point called by app.js when switching to the try-on tab.
 * 1. Asks for camera permission
 * 2. Initialises MediaPipe
 * 3. Starts the render loop
 */
export async function startTryOn() {
  if (isRunning) return;

  updatePoseStatus('loading', 'Starting camera…');

  try {
    // Request front-facing camera at a sensible resolution.
    // 640×480 is ideal — enough detail for pose, low enough to stay fast.
    tryonStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });

    const video = document.getElementById('tryon-video');
    if (!video) throw new Error('tryon-video element not found in DOM');
    video.srcObject = tryonStream;

    // Mirror the front camera so it feels like a mirror, not a selfie camera
    video.style.transform = 'scaleX(-1)';
    await video.play();

    // Now initialise MediaPipe (downloads model if not cached)
    await initPoseLandmarker();

    isRunning = true;
    updatePoseStatus('searching', 'Step back so we can see your full body…');
    startRenderLoop();

  } catch (err) {
    console.error('[TryOn] Startup error:', err);

    // Surface specific errors to the user
    if (err.name === 'NotAllowedError') {
      showToast('Camera access denied — please allow camera in settings', '⚠️');
      updatePoseStatus('error', 'Camera permission denied');
    } else if (err.name === 'NotFoundError') {
      showToast('No camera found on this device', '⚠️');
      updatePoseStatus('error', 'No camera found');
    } else {
      showToast('Could not start: ' + err.message, '⚠️');
      updatePoseStatus('error', err.message.slice(0, 60));
    }
  }
}

// ─── Main Render Loop ──────────────────────────
/**
 * Runs at up to 60fps via requestAnimationFrame.
 *
 * Every frame:
 *   1. Mirror the video onto the canvas
 *   2. Run MediaPipe pose detection (throttled to ~30fps)
 *   3. If a pose is found → cache it + draw garments
 *   4. If no pose found this frame → draw garments using CACHED landmarks
 *      (this is the key fix — v1 drew NOTHING when using cache)
 */
function startRenderLoop() {
  const video  = document.getElementById('tryon-video');
  const canvas = document.getElementById('tryon-canvas');
  if (!video || !canvas) return;

  let lastW = 0, lastH = 0; // track last size to avoid unnecessary canvas resets

  function loop(timestamp) {
    if (!isRunning) return;
    animFrameId = requestAnimationFrame(loop);

    // Wait until video has real data
    if (video.readyState < 2) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    // Only resize canvas if video dimensions changed
    // (resizing canvas clears it — doing it every frame was causing flickering)
    if (vw !== lastW || vh !== lastH) {
      canvas.width  = vw;
      canvas.height = vh;
      lastW = vw;
      lastH = vh;
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ── Pose Detection (run every ~33ms = ~30fps) ──
    if (poseLandmarker && timestamp - lastPoseTime > 33) {
      lastPoseTime = timestamp;
      try {
        const result = poseLandmarker.detectForVideo(video, timestamp);
        if (result.landmarks && result.landmarks.length > 0) {
          cachedLandmarks = result.landmarks[0]; // ← update cache
          updatePoseStatus('detected', 'Pose detected ✓');
        } else {
          // No body visible — keep cachedLandmarks from last frame
          updatePoseStatus('searching', 'Step back so we can see your full body…');
        }
      } catch (e) {
        // Detection can fail on a single frame — not fatal, just skip
        console.warn('[TryOn] detection skip:', e.message);
      }
    }

    // ── Garment Overlay ──
    // Draw using cached landmarks EVERY frame (not just when we detect this frame)
    if (cachedLandmarks) {
      drawGarments(ctx, cachedLandmarks, canvas.width, canvas.height);
    }
  }

  animFrameId = requestAnimationFrame(loop);
}

// ─── Coordinate Helpers ────────────────────────

/** Convert a normalised landmark (0-1) to pixel coordinates */
function lmPx(lm, w, h) {
  return { x: lm.x * w, y: lm.y * h };
}

/** Exponential moving average smoothing — removes jitter */
function smoothPt(key, pt) {
  if (!smoothed[key]) { smoothed[key] = { ...pt }; return pt; }
  smoothed[key].x = smoothed[key].x * (1 - SMOOTH) + pt.x * SMOOTH;
  smoothed[key].y = smoothed[key].y * (1 - SMOOTH) + pt.y * SMOOTH;
  return { ...smoothed[key] };
}

// ─── Garment Drawing ───────────────────────────
/**
 * Draws all active garments onto the canvas.
 * Called every frame with the latest (or cached) landmarks.
 *
 * Body structure used:
 *   Shoulders (11, 12) → width and tilt of upper body
 *   Hips      (23, 24) → bottom of torso / top of lower body
 *   Ankles    (27, 28) → bottom of lower body
 */
function drawGarments(ctx, landmarks, w, h) {
  // Convert relevant landmarks to pixel coords and smooth them
  const ls = smoothPt('ls', lmPx(landmarks[LM.L_SHOULDER], w, h));
  const rs = smoothPt('rs', lmPx(landmarks[LM.R_SHOULDER], w, h));
  const lh = smoothPt('lh', lmPx(landmarks[LM.L_HIP],      w, h));
  const rh = smoothPt('rh', lmPx(landmarks[LM.R_HIP],      w, h));
  const la = smoothPt('la', lmPx(landmarks[LM.L_ANKLE],    w, h));
  const ra = smoothPt('ra', lmPx(landmarks[LM.R_ANKLE],    w, h));

  const hasUpper = Object.values(activeGarments).some(g => categoryType(g.category) === 'upper');
  const hasFull  = Object.values(activeGarments).some(g => categoryType(g.category) === 'full');

  Object.values(activeGarments).forEach(garment => {
    const img  = garmentImages[garment.id];
    if (!img || !img.complete) return;

    const type = categoryType(garment.category);
    if (type === 'upper' || type === 'full') {
      drawUpperGarment(ctx, img, ls, rs, lh, rh, type);
    } else if (type === 'lower') {
      drawLowerGarment(ctx, img, lh, rh, la, ra, hasUpper || hasFull);
    }
  });
}

/**
 * Overlay an upper-body garment (shirt, jacket, hoodie, sweater, dress).
 *
 * HOW IT WORKS:
 * - Measure shoulder-to-shoulder width → sets garment width (with padding)
 * - Measure shoulder-midpoint to hip-midpoint → sets garment height
 * - Calculate shoulder tilt angle → rotates garment to match body tilt
 * - Anchor point is the shoulder midpoint
 *
 * The front camera image is MIRRORED (scaleX(-1) on the video),
 * but the canvas is NOT mirrored — so left/right landmarks are already
 * in the correct position for canvas drawing.
 */
function drawUpperGarment(ctx, img, ls, rs, lh, rh, type) {
  const shoulderMid = midpoint(ls, rs);
  const hipMid      = midpoint(lh, rh);
  const shoulderW   = dist(ls, rs);
  const torsoH      = dist(shoulderMid, hipMid);

  if (shoulderW < 10 || torsoH < 10) return; // body too small / partially off-screen

  // Width: shoulders + ~35% padding to cover sleeves
  const gWidth = shoulderW * 1.35;

  // Height: scaled from torso. Dress goes to ankle (estimated 2.5× torso),
  // shirt goes slightly below hip.
  const gHeight = type === 'full' ? torsoH * 2.6 : torsoH * 1.15;

  // Tilt: angle of the shoulder line (so garment tilts with your body)
  const tiltAngle = angle(ls, rs);

  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.translate(shoulderMid.x, shoulderMid.y);
  ctx.rotate(tiltAngle);
  // Draw: centred on shoulder midpoint, extending downward
  ctx.drawImage(img, -gWidth / 2, -torsoH * 0.04, gWidth, gHeight);
  ctx.restore();
}

/**
 * Overlay a lower-body garment (pants, jeans, shorts, skirt).
 *
 * HOW IT WORKS:
 * - Hip midpoint → top anchor
 * - Ankle midpoint → bottom anchor (determines height)
 * - Hip width × padding → garment width
 */
function drawLowerGarment(ctx, img, lh, rh, la, ra, hasUpperGarment) {
  const hipMid    = midpoint(lh, rh);
  const ankleMid  = midpoint(la, ra);
  const hipW      = dist(lh, rh);
  const legH      = dist(hipMid, ankleMid);

  if (hipW < 10 || legH < 10) return;

  const gWidth  = hipW * 1.4;
  const gHeight = legH * 1.05;

  // If wearing a shirt too, start 2px higher so there's no gap at the waistband
  const startY = hasUpperGarment ? hipMid.y - 2 : hipMid.y;

  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.drawImage(img, hipMid.x - gWidth / 2, startY, gWidth, gHeight);
  ctx.restore();
}

// ─── Garment Management ────────────────────────

/** Add a garment to the try-on overlay */
export async function addGarmentToTryOn(garment) {
  // Toggling: tap the same garment again to remove it
  if (activeGarments[garment.id]) {
    removeGarmentFromTryOn(garment.id);
    return;
  }

  activeGarments[garment.id] = garment;

  // Pre-load and cache the image so drawing is instant
  try {
    garmentImages[garment.id] = await loadImage(garment.imageDataURL);
  } catch (e) {
    console.warn('[TryOn] Image load failed:', e);
  }

  haptic('light');
  renderTryOnShelf();
}

/** Remove one garment */
export function removeGarmentFromTryOn(id) {
  delete activeGarments[id];
  delete garmentImages[id];
  haptic('light');
  renderTryOnShelf();
}

/** Clear all garments (called when closing try-on) */
export function clearTryOnGarments() {
  activeGarments  = {};
  garmentImages   = {};
  smoothed        = {};
  cachedLandmarks = null;
  renderTryOnShelf();
}

/** Render the bottom shelf of garment thumbnails */
function renderTryOnShelf() {
  const row = document.getElementById('tryon-garment-row');
  if (!row) return;

  const garments = Object.values(activeGarments);

  if (garments.length === 0) {
    row.innerHTML = `<div style="color:rgba(255,255,255,0.4);font-size:13px;padding:12px 4px">Tap + to add garments</div>`;
    return;
  }

  row.innerHTML = garments.map(g => `
    <div class="tryon-garment-thumb" data-id="${g.id}">
      ${g.imageDataURL
        ? `<img src="${g.imageDataURL}" alt="${g.name}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;" />`
        : `<span style="font-size:28px">${_emoji(g.category)}</span>`
      }
      <button class="remove-x" data-id="${g.id}" aria-label="Remove">✕</button>
    </div>
  `).join('');

  row.querySelectorAll('.remove-x').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      removeGarmentFromTryOn(btn.dataset.id);
    });
  });
}

// ─── Stop / Cleanup ────────────────────────────
export function stopTryOn() {
  isRunning = false;
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
  if (tryonStream) { tryonStream.getTracks().forEach(t => t.stop()); tryonStream = null; }

  const video = document.getElementById('tryon-video');
  if (video) { video.srcObject = null; video.style.transform = ''; }

  const canvas = document.getElementById('tryon-canvas');
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);

  clearTryOnGarments();
  updatePoseStatus('loading', 'Initializing…');
}

// ─── UI helpers ────────────────────────────────
function updatePoseStatus(state, text) {
  const dot  = document.getElementById('pose-dot');
  const textEl = document.getElementById('pose-status-text');
  if (dot) {
    dot.className = 'pose-dot';
    if (state === 'detected') dot.classList.add('detected');
  }
  if (textEl) textEl.textContent = text;
}

function _emoji(cat) {
  return { tshirt:'👕', shirt:'👔', jacket:'🧥', hoodie:'🥷', pants:'👖',
           jeans:'👖', shorts:'🩳', dress:'👗', skirt:'👗', sweater:'🧶' }[cat] || '👕';
}
