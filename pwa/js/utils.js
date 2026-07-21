// ═══════════════════════════════════════════════
//  Drape — Utility Functions
// ═══════════════════════════════════════════════

/**
 * Show a toast notification
 */
export function showToast(message, icon = '✓', duration = 2800) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

/**
 * Haptic feedback (iOS only, silently fails elsewhere)
 */
export function haptic(type = 'light') {
  if ('vibrate' in navigator) {
    const patterns = { light: [10], medium: [20], heavy: [40], success: [10, 50, 10] };
    navigator.vibrate(patterns[type] || [10]);
  }
}

/**
 * Convert a Blob/File to a base64 data URL
 */
export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Convert a data URL to a Blob
 */
export function dataURLToBlob(dataURL) {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new Blob([u8arr], { type: mime });
}

/**
 * Resize an image from a data URL, returns new data URL
 */
export function resizeImage(dataURL, maxWidth = 800, maxHeight = 1066, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataURL;
  });
}

/**
 * Clamp a number between min and max
 */
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Linear interpolation
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Distance between two 2D points
 */
export function dist(p1, p2) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * Midpoint between two 2D points
 */
export function midpoint(p1, p2) {
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

/**
 * Angle (radians) of the vector from p1 to p2
 */
export function angle(p1, p2) {
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

/**
 * Format garment category as human-readable string
 */
export function formatCategory(cat) {
  const map = {
    tshirt:   'T-Shirt',
    shirt:    'Shirt',
    jacket:   'Jacket',
    hoodie:   'Hoodie',
    pants:    'Pants',
    jeans:    'Jeans',
    shorts:   'Shorts',
    dress:    'Dress',
    skirt:    'Skirt',
    sweater:  'Sweater',
  };
  return map[cat] || cat;
}

/**
 * Category to emoji mapping
 */
export function categoryEmoji(cat) {
  const map = {
    tshirt:   '👕',
    shirt:    '👔',
    jacket:   '🧥',
    hoodie:   '🥷',
    pants:    '👖',
    jeans:    '👖',
    shorts:   '🩳',
    dress:    '👗',
    skirt:    '👗',
    sweater:  '🧶',
  };
  return map[cat] || '👕';
}

/**
 * Category type: 'upper', 'lower', 'full'
 */
export function categoryType(cat) {
  const lower = ['pants', 'jeans', 'shorts', 'skirt'];
  const full   = ['dress'];
  if (lower.includes(cat)) return 'lower';
  if (full.includes(cat)) return 'full';
  return 'upper';
}

/**
 * Generate a unique ID
 */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Debounce a function
 */
export function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Load an image and return HTMLImageElement
 */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Check if running on iOS
 */
export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Check if running as installed PWA
 */
export function isPWA() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}
