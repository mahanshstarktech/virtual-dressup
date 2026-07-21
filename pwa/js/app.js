// ═══════════════════════════════════════════════
//  Drape — Main Application (Router + State)
// ═══════════════════════════════════════════════

import { openCapture, closeCapture, initCapture } from './capture.js';
import { startTryOn, stopTryOn, addGarmentToTryOn, clearTryOnGarments } from './tryon.js';
import { getAllGarments, getWardrobeStats, deleteGarment } from './wardrobe.js';
import { showToast, haptic, formatCategory, categoryEmoji } from './utils.js';

// ─── State ─────────────────────────────────────
let currentTab = 'home';
let wardrobeGarments = [];
let wardrobeFilter   = 'all';
let selectedForTryOn = {};  // id → garment (selected in wardrobe)
let garmentPickerOpen = false;

// ─── Theme Management ──────────────────────────
const THEME_KEY = 'drape-theme';

function applyTheme(theme) {
  const root = document.documentElement;
  root.removeAttribute('data-theme');
  if (theme === 'dark')  root.setAttribute('data-theme', 'dark');
  if (theme === 'light') root.setAttribute('data-theme', 'light');
  // 'auto' = use system preference (no attribute)
  localStorage.setItem(THEME_KEY, theme);
  updateThemeSelector(theme);
}

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || 'auto';
  applyTheme(saved);
}

function updateThemeSelector(theme) {
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.theme === theme);
  });

  // Update the settings row display value
  const labels = { light: '☀️ Light', dark: '🌙 Dark', auto: '⚙️ Auto' };
  const el = document.getElementById('theme-display-value');
  if (el) el.textContent = labels[theme] || 'Auto';
}

// ─── Navigation ────────────────────────────────
function switchTab(tab) {
  if (tab === currentTab && tab !== 'capture') return;
  
  haptic('light');
  
  // Handle special tabs
  if (tab === 'capture') {
    openCapture();
    return;
  }

  // If leaving tryon, stop it
  if (currentTab === 'tryon') {
    stopTryOn();
    clearTryOnGarments();
  }

  currentTab = tab;

  // Update screens
  document.querySelectorAll('.screen:not(#screen-capture):not(#screen-splash)').forEach(s => {
    s.classList.remove('active');
  });
  const target = document.getElementById(`screen-${tab}`);
  if (target) target.classList.add('active');

  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Tab-specific initialization
  if (tab === 'home')     loadHomeData();
  if (tab === 'wardrobe') loadWardrobe();
  if (tab === 'tryon')    initTryOnScreen();
  if (tab === 'settings') initSettings();
}

// ─── Home Screen ───────────────────────────────
async function loadHomeData() {
  try {
    const stats = await getWardrobeStats();

    // Update stat counters
    const totalEl = document.getElementById('stat-total');
    if (totalEl) totalEl.textContent = stats.total;

    const typesEl = document.getElementById('stat-types');
    if (typesEl) typesEl.textContent = Object.keys(stats.categories).length;

    // Recent garments horizontal strip
    renderRecentGarments(stats.recent);
  } catch (err) {
    console.warn('Could not load home data:', err);
  }
}

function renderRecentGarments(garments) {
  const scroll = document.getElementById('home-recent-scroll');
  if (!scroll) return;

  if (garments.length === 0) {
    scroll.innerHTML = `
      <div class="empty-state" style="padding: 32px 16px; min-width: 280px;">
        <div class="empty-state__icon">👗</div>
        <div class="empty-state__title">Empty Wardrobe</div>
        <div class="empty-state__subtitle">Capture your first garment to get started</div>
        <button class="empty-state__btn" onclick="window.drapeApp.openCapture()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add First Garment
        </button>
      </div>
    `;
    return;
  }

  scroll.innerHTML = garments.map(g => `
    <div class="garment-card-sm" onclick="window.drapeApp.viewGarment('${g.id}')">
      <div class="garment-card-sm__img garment-card-sm__img--placeholder">
        ${g.imageDataURL 
          ? `<img src="${g.imageDataURL}" alt="${g.name}" style="width:100%;height:100%;object-fit:cover;" />`
          : categoryEmoji(g.category)
        }
      </div>
      <div class="garment-card-sm__info">
        <div class="garment-card-sm__name">${g.name}</div>
        <div class="garment-card-sm__type">${formatCategory(g.category)}</div>
      </div>
    </div>
  `).join('');
}

// ─── Wardrobe Screen ───────────────────────────
async function loadWardrobe(filter = wardrobeFilter) {
  wardrobeFilter = filter;
  wardrobeGarments = await getAllGarments(filter === 'all' ? null : filter);
  renderWardrobeGrid();
  updateFilterChips(filter);
}

function renderWardrobeGrid() {
  const grid = document.getElementById('wardrobe-grid');
  if (!grid) return;

  if (wardrobeGarments.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1; padding: 48px 16px;">
        <div class="empty-state__icon">${wardrobeFilter === 'all' ? '👗' : categoryEmoji(wardrobeFilter)}</div>
        <div class="empty-state__title">${wardrobeFilter === 'all' ? 'No garments yet' : 'No ' + formatCategory(wardrobeFilter) + 's'}</div>
        <div class="empty-state__subtitle">Capture photos of your clothes to build your digital wardrobe</div>
        <button class="empty-state__btn" onclick="window.drapeApp.openCapture()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Garment
        </button>
      </div>
    `;
    return;
  }

  grid.innerHTML = wardrobeGarments.map((g, i) => `
    <div class="garment-card ${selectedForTryOn[g.id] ? 'selected' : ''}" 
         data-id="${g.id}"
         style="animation-delay: ${i * 50}ms"
         onclick="window.drapeApp.toggleGarmentSelection('${g.id}')">
      <div class="garment-card__img">
        ${g.imageDataURL
          ? `<img src="${g.imageDataURL}" alt="${g.name}" />`
          : `<span style="font-size:52px">${categoryEmoji(g.category)}</span>`
        }
      </div>
      <div class="garment-card__info">
        <div class="garment-card__name">${g.name}</div>
        <div class="garment-card__meta">
          <span>${categoryEmoji(g.category)}</span>
          <span>${formatCategory(g.category)}</span>
        </div>
      </div>
      <div class="garment-card__badge">✓</div>
    </div>
  `).join('');

  updateTryOnActionBar();
}

function updateFilterChips(active) {
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.filter === active);
  });
}

function toggleGarmentSelection(id) {
  haptic('light');
  const garment = wardrobeGarments.find(g => g.id === id);
  if (!garment) return;

  if (selectedForTryOn[id]) {
    delete selectedForTryOn[id];
  } else {
    selectedForTryOn[id] = garment;
  }

  // Update the card UI
  const card = document.querySelector(`.garment-card[data-id="${id}"]`);
  if (card) card.classList.toggle('selected', !!selectedForTryOn[id]);

  updateTryOnActionBar();
}

function updateTryOnActionBar() {
  const bar   = document.getElementById('tryon-action-bar');
  const count = Object.keys(selectedForTryOn).length;
  if (!bar) return;

  bar.classList.toggle('visible', count > 0);

  const infoEl = document.getElementById('tryon-bar-info');
  const subEl  = document.getElementById('tryon-bar-sub');
  if (infoEl) infoEl.textContent = `${count} garment${count !== 1 ? 's' : ''} selected`;
  if (subEl)  subEl.textContent = 'Tap to try on in real-time AR';
}

async function launchTryOn() {
  if (Object.keys(selectedForTryOn).length === 0) return;
  haptic('medium');
  // Pass garments to try-on screen
  switchTab('tryon');
}

// ─── Try-On Screen ──────────────────────────────
async function initTryOnScreen() {
  // Pre-load garments from selection
  const garments = Object.values(selectedForTryOn);
  
  if (garments.length === 0) {
    // Open garment picker immediately
    openGarmentPicker();
  }

  await startTryOn();

  // Add pre-selected garments
  for (const g of garments) {
    await addGarmentToTryOn(g);
  }
}

function openGarmentPicker() {
  const sheet   = document.getElementById('garment-picker-sheet');
  const overlay = document.getElementById('sheet-overlay');
  if (!sheet || !overlay) return;

  garmentPickerOpen = true;
  renderGarmentPickerItems();
  sheet.classList.add('open');
  overlay.classList.add('open');
}

function closeGarmentPicker() {
  garmentPickerOpen = false;
  const sheet   = document.getElementById('garment-picker-sheet');
  const overlay = document.getElementById('sheet-overlay');
  sheet?.classList.remove('open');
  overlay?.classList.remove('open');
}

async function renderGarmentPickerItems() {
  const grid = document.getElementById('sheet-garment-grid');
  if (!grid) return;

  const garments = await getAllGarments();
  
  if (garments.length === 0) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:32px;color:var(--text-secondary);">
        <div style="font-size:40px;margin-bottom:12px">👗</div>
        <div style="font-weight:600">Wardrobe is empty</div>
        <div style="font-size:13px;margin-top:6px">Capture garments first</div>
      </div>
    `;
    return;
  }

  grid.innerHTML = garments.map(g => `
    <div class="sheet-garment-item" onclick="window.drapeApp.addToTryOn('${g.id}')">
      <div class="sheet-garment-item__img">
        ${g.imageDataURL 
          ? `<img src="${g.imageDataURL}" alt="${g.name}" style="width:100%;height:100%;object-fit:cover;" />`
          : `<span>${categoryEmoji(g.category)}</span>`
        }
      </div>
      <div class="sheet-garment-item__name">${g.name}</div>
    </div>
  `).join('');
}

async function addToTryOn(id) {
  const garments = await getAllGarments();
  const garment  = garments.find(g => g.id === id);
  if (!garment) return;
  await addGarmentToTryOn(garment);
  closeGarmentPicker();
  haptic('medium');
  showToast(`${garment.name} added`, categoryEmoji(garment.category));
}

// ─── Settings Screen ───────────────────────────
function initSettings() {
  // Theme selector
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.addEventListener('click', () => {
      applyTheme(opt.dataset.theme);
      haptic('light');
    });
  });

  // Update stats in settings
  getWardrobeStats().then(stats => {
    const el = document.getElementById('settings-garment-count');
    if (el) el.textContent = `${stats.total} garment${stats.total !== 1 ? 's' : ''}`;
  });
}

// ─── Garment Detail (bottom sheet) ─────────────
async function viewGarment(id) {
  haptic('light');
  switchTab('wardrobe');
  await loadWardrobe();
  // Scroll to and highlight garment
  const card = document.querySelector(`.garment-card[data-id="${id}"]`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.style.outline = '2.5px solid var(--accent)';
    setTimeout(() => { card.style.outline = ''; }, 1500);
  }
}

async function handleDeleteGarment(id) {
  if (!confirm('Remove this garment from your wardrobe?')) return;
  await deleteGarment(id);
  showToast('Garment removed', '🗑️');
  haptic('medium');
  delete selectedForTryOn[id];
  await loadWardrobe();
}

// ─── Splash Screen ─────────────────────────────
function hideSplash() {
  const splash = document.getElementById('screen-splash');
  if (!splash) return;
  setTimeout(() => {
    splash.style.opacity = '0';
    splash.style.transform = 'scale(1.05)';
    splash.style.transition = 'all 0.5s ease';
    setTimeout(() => {
      splash.classList.remove('active');
      splash.style.display = 'none';
    }, 500);
  }, 1800);
}

// ─── Event Listeners Setup ─────────────────────
function setupEventListeners() {
  // Tab bar
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Hero try-on button
  document.getElementById('hero-tryon-btn')?.addEventListener('click', () => {
    selectedForTryOn = {};
    switchTab('tryon');
  });

  // Wardrobe section "See All" 
  document.getElementById('wardrobe-see-all')?.addEventListener('click', () => switchTab('wardrobe'));

  // Wardrobe filters
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => loadWardrobe(chip.dataset.filter));
  });

  // Try-on launch from wardrobe
  document.getElementById('tryon-launch-btn')?.addEventListener('click', launchTryOn);

  // Try-on close
  document.getElementById('tryon-close-btn')?.addEventListener('click', () => {
    stopTryOn();
    clearTryOnGarments();
    switchTab('wardrobe');
  });

  // Try-on add garment button
  document.getElementById('tryon-add-btn')?.addEventListener('click', openGarmentPicker);

  // Sheet overlay close
  document.getElementById('sheet-overlay')?.addEventListener('click', closeGarmentPicker);

  // Capture lifecycle
  window.addEventListener('capture-closed', () => {
    // Return focus to previous tab
    switchTab(currentTab === 'capture' ? 'wardrobe' : currentTab);
  });

  window.addEventListener('wardrobe-updated', async () => {
    if (currentTab === 'wardrobe') await loadWardrobe();
    if (currentTab === 'home')     await loadHomeData();
  });

  // System theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const saved = localStorage.getItem(THEME_KEY) || 'auto';
    if (saved === 'auto') applyTheme('auto');
  });
}

// ─── App Entry Point ───────────────────────────
async function init() {
  // Apply saved theme
  initTheme();

  // Show splash screen first
  document.getElementById('screen-splash')?.classList.add('active');

  // Set up event listeners
  setupEventListeners();

  // Initialize capture module
  initCapture();

  // Load initial data
  await loadHomeData();

  // Hide splash and show home
  hideSplash();
  setTimeout(() => switchTab('home'), 1800);

  // Register service worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
      console.log('[SW] Service Worker registered');
    } catch (err) {
      console.warn('[SW] Registration failed:', err);
    }
  }
}

// ─── Global API (for inline onclick handlers) ──
window.drapeApp = {
  openCapture,
  viewGarment,
  toggleGarmentSelection,
  addToTryOn,
  deleteGarment: handleDeleteGarment,
  switchTab,
};

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', init);
