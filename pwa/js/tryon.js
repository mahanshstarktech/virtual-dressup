// ═══════════════════════════════════════════════
//  Drape — Real-Time AR Try-On Module
//  Uses MediaPipe Pose Landmarker for body tracking
// ═══════════════════════════════════════════════

import { dist, midpoint, angle, clamp, loadImage, haptic, showToast, categoryType } from './utils.js';

// ─── State ───────────────────────────────────────
let tryonStream      = null;
let poseLandmarker   = null;
let animFrameId      = null;
let isRunning        = false;
let activeGarments   = {};   // { id: garmentData }
let garmentImages    = {};   // { id: HTMLImageElement }
let lastPoseTime     = 0;
let poseDetected     = false;

// Smoothing buffers for stable overlay
const SMOOTH = 0.35;
let smoothed = {};

// MediaPipe landmark indices
const LM = {
  NOSE:          0,
  L_SHOULDER:    11,
  R_SHOULDER:    12,
  L_ELBOW:       13,
  R_ELBOW:       14,
  L_WRIST:       15,
  R_WRIST:       16,
  L_HIP:         23,
  R_HIP:         24,
  L_KNEE:        25,
  R_KNEE:        26,
  L_ANKLE:       27,
  R_ANKLE:       28,
};

/**
 * Initialize MediaPipe Pose Landmarker
 */
async function initPoseLandmarker() {
  if (poseLandmarker) return poseLandmarker;
  
  try {
    // Import from CDN
    const vision = await window.MediaPipeTasksVision;
    if (!vision) throw new Error('MediaPipe not loaded');

    const { PoseLandmarker, FilesetResolver } = vision;

    const filesetResolver = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );

    poseLandmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'GPU',
      },
      runningMode:     'VIDEO',
      numPoses:        1,
      minPoseDetectionConfidence:  0.55,
      minPosePresenceConfidence:   0.55,
      minTrackingConfidence:       0.55,
    });

    console.log('[TryOn] Pose Landmarker ready');
    return poseLandmarker;
  } catch (err) {
    console.error('[TryOn] Failed to init pose landmarker:', err);
    throw err;
  }
}

/**
 * Start the try-on camera and detection loop
 */
export async function startTryOn() {
  if (isRunning) return;

  updatePoseStatus('loading', 'Loading AI…');

  try {
    // Start camera (front-facing)
    tryonStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode:  'user',
        width:  { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    });

    const video = document.getElementById('tryon-video');
    if (!video) return;
    video.srcObject = tryonStream;
    await video.play();

    updatePoseStatus('loading', 'Initializing pose detection…');

    // Init MediaPipe
    await initPoseLandmarker();

    isRunning = true;
    updatePoseStatus('searching', 'Stand back so we can see you');
    runDetectionLoop();
  } catch (err) {
    console.error('[TryOn] Start failed:', err);
    if (err.name === 'NotAllowedError') {
      showToast('Camera access denied', '⚠️');
    } else if (err.message.includes('MediaPipe')) {
      showToast('Loading AI model…', '⏳');
      // Fallback: basic overlay without pose
      startBasicMode();
    } else {
      showToast('Could not start camera', '⚠️');
    }
    updatePoseStatus('error', 'Camera unavailable');
  }
}

/**
 * Basic mode: overlay garments without pose detection (fallback)
 */
function startBasicMode() {
  isRunning = true;
  const video  = document.getElementById('tryon-video');
  const canvas = document.getElementById('tryon-canvas');
  if (!video || !canvas) return;

  function basicLoop() {
    if (!isRunning) return;
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw placeholder overlay
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    
    Object.values(activeGarments).forEach((garment, i) => {
      const img = garmentImages[garment.id];
      if (!img) return;
      const type = categoryType(garment.category);
      if (type === 'upper') {
        drawGarmentBasic(ctx, img, cx - 100, cy - 150, 200, 200);
      } else if (type === 'lower') {
        drawGarmentBasic(ctx, img, cx - 90, cy + 60, 180, 220);
      } else {
        drawGarmentBasic(ctx, img, cx - 100, cy - 150, 200, 400);
      }
    });
    
    animFrameId = requestAnimationFrame(basicLoop);
  }
  basicLoop();
}

function drawGarmentBasic(ctx, img, x, y, w, h) {
  ctx.globalAlpha = 0.85;
  ctx.drawImage(img, x, y, w, h);
  ctx.globalAlpha = 1;
}

/**
 * Main detection + rendering loop
 */
function runDetectionLoop() {
  const video  = document.getElementById('tryon-video');
  const canvas = document.getElementById('tryon-canvas');
  if (!video || !canvas || !isRunning) return;

  function loop(timestamp) {
    if (!isRunning) return;
    animFrameId = requestAnimationFrame(loop);

    if (video.readyState < 2) return;

    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Run pose detection (throttle to ~30fps if needed)
    if (poseLandmarker && timestamp - lastPoseTime > 33) {
      lastPoseTime = timestamp;
      try {
        const result = poseLandmarker.detectForVideo(video, timestamp);
        if (result.landmarks && result.landmarks.length > 0) {
          const lms = result.landmarks[0];
          poseDetected = true;
          updatePoseStatus('detected', 'Pose detected ✓');
          drawGarments(ctx, lms, canvas.width, canvas.height);
        } else {
          poseDetected = false;
          updatePoseStatus('searching', 'Move back so we can see you');
        }
      } catch (err) {
        // Non-fatal - keep looping
      }
    } else if (poseDetected) {
      // Use cached landmarks to maintain smooth rendering between detections
    }
  }

  animFrameId = requestAnimationFrame(loop);
}

/**
 * Convert normalized landmark to pixel coordinates
 */
function lmPx(landmark, w, h) {
  return { x: landmark.x * w, y: landmark.y * h, z: landmark.z, vis: landmark.visibility };
}

/**
 * Smooth a value using exponential moving average
 */
function smooth(key, value) {
  if (smoothed[key] === undefined) { smoothed[key] = value; return value; }
  smoothed[key] = smoothed[key] * (1 - SMOOTH) + value * SMOOTH;
  return smoothed[key];
}

function smoothPt(key, pt) {
  return {
    x: smooth(key + '_x', pt.x),
    y: smooth(key + '_y', pt.y),
  };
}

/**
 * Draw all active garments using pose landmarks
 */
function drawGarments(ctx, landmarks, w, h) {
  const lms = {};
  Object.entries(LM).forEach(([name, idx]) => {
    lms[name] = lmPx(landmarks[idx], w, h);
  });

  // Smooth key landmarks for stable overlay
  const ls  = smoothPt('ls',  lms.L_SHOULDER);
  const rs  = smoothPt('rs',  lms.R_SHOULDER);
  const lh  = smoothPt('lh',  lms.L_HIP);
  const rh  = smoothPt('rh',  lms.R_HIP);
  const lk  = smoothPt('lk',  lms.L_KNEE);
  const rk  = smoothPt('rk',  lms.R_KNEE);
  const la  = smoothPt('la',  lms.L_ANKLE);
  const ra  = smoothPt('ra',  lms.R_ANKLE);

  const hasUpper = Object.values(activeGarments).some(g => categoryType(g.category) === 'upper');
  const hasLower = Object.values(activeGarments).some(g => categoryType(g.category) === 'lower');
  const hasFull  = Object.values(activeGarments).some(g => categoryType(g.category) === 'full');

  Object.values(activeGarments).forEach(garment => {
    const img = garmentImages[garment.id];
    if (!img || !img.complete) return;
    const type = categoryType(garment.category);

    if (type === 'upper' || type === 'full') {
      drawUpperGarment(ctx, img, ls, rs, lh, rh, type, hasLower);
    } else if (type === 'lower') {
      drawLowerGarment(ctx, img, lh, rh, la, ra, lk, rk, hasUpper || hasFull);
    }
  });
}

/**
 * Draw an upper-body garment (shirt, jacket, dress)
 */
function drawUpperGarment(ctx, img, ls, rs, lh, rh, type, hasPants) {
  const sm = midpoint(ls, rs);   // shoulder midpoint
  const hm = midpoint(lh, rh);   // hip midpoint

  const shoulderWidth = dist(ls, rs);
  const torsoHeight   = dist(sm, hm);

  if (shoulderWidth < 20 || torsoHeight < 20) return;

  // Scale garment
  const padding = 1.35;
  const gWidth  = shoulderWidth * padding;

  let gHeight;
  if (type === 'full') {
    // Dress: extends to ankles — estimate based on torso proportion
    gHeight = torsoHeight * 2.5;
  } else if (hasPants) {
    // Tucked-in shirt: stop at hip
    gHeight = torsoHeight * 1.05;
  } else {
    // Regular shirt: slight overhang below hip
    gHeight = torsoHeight * 1.15;
  }

  // Rotation to match shoulder tilt
  const tiltAngle = angle(ls, rs);  // angle of shoulder line

  // Anchor: slightly above shoulder midpoint
  const anchorX = sm.x;
  const anchorY = sm.y - torsoHeight * 0.05;

  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.translate(anchorX, anchorY);
  ctx.rotate(tiltAngle);
  ctx.drawImage(img, -gWidth / 2, 0, gWidth, gHeight);
  ctx.restore();
}

/**
 * Draw a lower-body garment (pants, shorts, skirt)
 */
function drawLowerGarment(ctx, img, lh, rh, la, ra, lk, rk, hasShirt) {
  const hm = midpoint(lh, rh);   // hip midpoint
  const am = midpoint(la, ra);   // ankle midpoint
  const km = midpoint(lk, rk);   // knee midpoint

  const hipWidth   = dist(lh, rh);
  const legLength  = dist(hm, am);

  if (hipWidth < 20 || legLength < 20) return;

  const padding = 1.4;
  const gWidth  = hipWidth * padding;
  const gHeight = legLength * 1.05;

  // Start drawing from hip level (below shirt if tucked)
  const startY = hasShirt ? hm.y - 2 : hm.y;

  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.drawImage(img, hm.x - gWidth / 2, startY, gWidth, gHeight);
  ctx.restore();
}

/**
 * Add a garment to the try-on view
 */
export async function addGarmentToTryOn(garment) {
  if (activeGarments[garment.id]) {
    removeGarmentFromTryOn(garment.id);
    return;
  }

  activeGarments[garment.id] = garment;

  // Pre-load the image
  try {
    const img = await loadImage(garment.imageDataURL);
    garmentImages[garment.id] = img;
  } catch (err) {
    console.warn('Could not load garment image:', err);
  }

  haptic('light');
  renderTryOnShelf();
}

/**
 * Remove a garment from the try-on view
 */
export function removeGarmentFromTryOn(id) {
  delete activeGarments[id];
  delete garmentImages[id];
  haptic('light');
  renderTryOnShelf();
}

/**
 * Clear all garments from try-on view
 */
export function clearTryOnGarments() {
  activeGarments = {};
  garmentImages  = {};
  smoothed       = {};
  renderTryOnShelf();
}

/**
 * Render the garment shelf at the bottom of the try-on view
 */
function renderTryOnShelf() {
  const row = document.getElementById('tryon-garment-row');
  if (!row) return;

  const garments = Object.values(activeGarments);
  
  if (garments.length === 0) {
    row.innerHTML = `
      <div class="tryon-garment-empty" style="color:rgba(255,255,255,0.4);font-size:13px;padding:16px 0;">
        Tap + to add garments
      </div>
    `;
    return;
  }

  row.innerHTML = garments.map(g => `
    <div class="tryon-garment-thumb active" data-id="${g.id}">
      ${g.imageDataURL 
        ? `<img src="${g.imageDataURL}" alt="${g.name}" />`
        : `<span style="font-size:28px">${categoryEmoji(g.category)}</span>`
      }
      <div class="remove-x" data-id="${g.id}">✕</div>
    </div>
  `).join('');

  row.querySelectorAll('.remove-x').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeGarmentFromTryOn(btn.dataset.id);
    });
  });
}

/**
 * Stop try-on and release resources
 */
export function stopTryOn() {
  isRunning = false;
  poseDetected = false;
  
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  
  if (tryonStream) {
    tryonStream.getTracks().forEach(t => t.stop());
    tryonStream = null;
  }
  
  const video = document.getElementById('tryon-video');
  if (video) video.srcObject = null;

  const canvas = document.getElementById('tryon-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  clearTryOnGarments();
  smoothed = {};
}

/**
 * Update the pose detection status indicator
 */
function updatePoseStatus(state, text) {
  const statusEl = document.getElementById('pose-status');
  const dotEl    = document.getElementById('pose-dot');
  const textEl   = document.getElementById('pose-status-text');
  if (!statusEl) return;
  
  if (dotEl) {
    dotEl.className = 'pose-dot';
    if (state === 'detected') dotEl.classList.add('detected');
  }
  if (textEl) textEl.textContent = text;
}

// Export for use in app.js
export function categoryEmoji(cat) {
  const map = {
    tshirt:'👕', shirt:'👔', jacket:'🧥', hoodie:'🫱',
    pants:'👖', jeans:'👖', shorts:'🩳', dress:'👗',
    skirt:'🪡', sweater:'🧶', shoes:'👟', other:'🛍️',
  };
  return map[cat] || '👕';
}
