// Mountain Made 2.0 - Main JavaScript Utilities

const API_BASE = '/api';

// API Helper Functions
const api = {
  async request(endpoint, options = {}) {
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        credentials: 'include'
      });

      // Try to parse JSON, but handle empty/non-JSON responses gracefully
      let data = null;
      const text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.error('Failed to parse JSON response:', e, text);
          if (!response.ok) {
            throw new Error('Request failed');
          }
          return null;
        }
      }

      if (!response.ok) {
        throw new Error((data && data.error) || 'Request failed');
      }

      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  },

  get(endpoint) {
    return this.request(endpoint);
  },

  post(endpoint, body) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },

  put(endpoint, body) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  },

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  },

  // Upload image file (JPG/PNG only)
  async uploadImage(file) {
    try {
      // Validate file type on client side
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
      const allowedExtensions = ['.jpg', '.jpeg', '.png'];
      const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
      
      if (!allowedTypes.includes(file.type) || !allowedExtensions.includes(fileExtension)) {
        throw new Error('Invalid file type. Only JPG and PNG images are allowed.');
      }

      // Check file size (5MB max)
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('File size too large. Maximum size is 5MB.');
      }

      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch(`${API_BASE}/upload/image`, {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      return data;
    } catch (error) {
      console.error('Upload Error:', error);
      throw error;
    }
  }
};

// Authentication
const auth = {
  currentUser: null,

  async checkAuth() {
    try {
      const data = await api.get('/auth/check');
      this.currentUser = data.authenticated ? data.user : null;
      this.updateUI();
      return this.currentUser;
    } catch (error) {
      this.currentUser = null;
      this.updateUI();
      return null;
    }
  },

  async login(email, password) {
    const data = await api.post('/auth/login', { email, password });
    this.currentUser = data.user;
    this.updateUI();
    return data;
  },

  async register(userData) {
    const data = await api.post('/auth/register', userData);
    this.currentUser = data.user;
    this.updateUI();
    return data;
  },

  async logout() {
    await api.post('/auth/logout');
    this.currentUser = null;
    this.updateUI();
    window.location.href = '/';
  },

  isAuthenticated() {
    return !!this.currentUser;
  },

  isAdmin() {
    return this.currentUser?.role === 'admin';
  },

  isWholesale() {
    return this.currentUser?.role === 'wholesale' && this.currentUser?.is_approved;
  },

  updateUI() {
    const authButtons = document.getElementById('auth-buttons');
    const userMenu = document.getElementById('user-menu');
    const adminLink = document.getElementById('admin-link');

    if (!authButtons || !userMenu) return;

    if (this.isAuthenticated()) {
      authButtons.classList.add('hidden');
      userMenu.classList.remove('hidden');

      if (adminLink) {
        adminLink.classList.toggle('hidden', !this.isAdmin());
      }
    } else {
      authButtons.classList.remove('hidden');
      userMenu.classList.add('hidden');
      
      if (adminLink) {
        adminLink.classList.add('hidden');
      }
    }
  }
};

// Cart Management
const cart = {
  items: [],
  total: 0,
  itemCount: 0,

  async fetch() {
    if (!auth.isAuthenticated()) {
      this.items = [];
      this.total = 0;
      this.itemCount = 0;
      this.updateBadge();
      return;
    }

    try {
      const data = await api.get('/cart');
      this.items = data.cartItems || [];
      this.total = parseFloat(data.total || 0);
      this.itemCount = this.items.length;
      this.updateBadge();
      return data;
    } catch (error) {
      console.error('Failed to fetch cart:', error);
      return null;
    }
  },

  async add(productId, quantity = 1) {
    try {
      console.log('Cart add called, auth status:', auth.isAuthenticated(), 'currentUser:', auth.currentUser);
      
      // Make sure we have latest auth status
      if (!auth.currentUser) {
        console.log('No currentUser, checking auth...');
        await auth.checkAuth();
        console.log('After checkAuth, authenticated:', auth.isAuthenticated());
      }
      
      if (!auth.isAuthenticated()) {
        showAlert('⚠️  Please login to add items to cart. Click the Login button in the top right.', 'error');
        return;
      }

      console.log('Adding product to cart:', productId);
      const response = await api.post('/cart/add', { product_id: productId, quantity });
      console.log('Cart add response:', response);
      
      if (response && response.success !== false) {
        await this.fetch();
        showAlert('✓ Product added to cart!', 'success');
        return response;
      } else {
        throw new Error(response.error || 'Failed to add to cart');
      }
    } catch (error) {
      console.error('Cart add error:', error);
      if (!error.message.includes('Please login')) {
        showAlert('❌ ' + (error.message || 'Failed to add to cart'), 'error');
      }
    }
  },

  async update(itemId, quantity) {
    try {
      await api.put(`/cart/${itemId}`, { quantity });
      await this.fetch();
    } catch (error) {
      showAlert(error.message || 'Failed to update cart', 'error');
    }
  },

  async remove(itemId) {
    try {
      await api.delete(`/cart/${itemId}`);
      await this.fetch();
      showAlert('Item removed from cart', 'success');
    } catch (error) {
      showAlert(error.message || 'Failed to remove item', 'error');
    }
  },

  async clear() {
    try {
      await api.delete('/cart');
      await this.fetch();
    } catch (error) {
      showAlert(error.message || 'Failed to clear cart', 'error');
    }
  },

  updateBadge() {
    const badge = document.getElementById('cart-badge');
    if (badge) {
      badge.textContent = this.itemCount;
      badge.classList.toggle('hidden', this.itemCount === 0);
    }
  }
};

// Image Upload Helper
async function uploadProductImage(fileInput) {
  try {
    if (!fileInput.files || !fileInput.files[0]) {
      throw new Error('No file selected');
    }

    const file = fileInput.files[0];
    
    showAlert('Uploading image...', 'info');
    const result = await api.uploadImage(file);
    
    if (result.success) {
      showAlert('Image uploaded successfully!', 'success');
      return result.imageUrl;
    } else {
      throw new Error(result.error || 'Upload failed');
    }
  } catch (error) {
    showAlert(error.message || 'Failed to upload image', 'error');
    return null;
  }
}

// Alert/Notification System
function showAlert(message, type = 'info') {
  const alertContainer = document.getElementById('alert-container') || createAlertContainer();
  
  const alert = document.createElement('div');
  alert.className = `alert alert-${type}`;
  alert.style.cssText = 'padding: 1rem; margin-bottom: 0.5rem; border-radius: 0.5rem; box-shadow: 0 2px 8px rgba(0,0,0,0.1); transition: opacity 0.3s;';
  
  alert.innerHTML = `<span>${message}</span>`;
  
  alertContainer.appendChild(alert);
  
  setTimeout(() => {
    alert.style.opacity = '0';
    setTimeout(() => alert.remove(), 300);
  }, 3000);
}

function createAlertContainer() {
  const container = document.createElement('div');
  container.id = 'alert-container';
  container.style.cssText = 'position: fixed; top: 100px; right: 20px; z-index: 10000; display: flex; flex-direction: column; gap: 10px; max-width: 400px;';
  document.body.appendChild(container);
  return container;
}

// Modal System
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

// Profile management (name, phone, photo)
const PROFILE_MODAL_ID = 'profile-modal';
const PROFILE_STYLE_ID = 'profile-modal-styles';
const PROFILE_PHOTO_KEY = 'mm_profile_photo_url';

function ensureProfileModal() {
  if (document.getElementById(PROFILE_MODAL_ID)) return;

  if (!document.getElementById(PROFILE_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = PROFILE_STYLE_ID;
    style.textContent = `
      .profile-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 2100; padding: 1rem; }
      .profile-modal.hidden { display: none; }
      .profile-modal-dialog { background: var(--background, #fff); border-radius: 12px; max-width: 480px; width: 95%; padding: 1.5rem; box-shadow: 0 20px 40px rgba(0,0,0,0.15); border: 1px solid var(--border, #e5e7eb); }
      .profile-modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
      .profile-avatar-preview { width: 80px; height: 80px; border-radius: 50%; background: #f1f5f9; border: 2px dashed var(--border, #cbd5e1); display: grid; place-items: center; color: var(--text-light, #64748b); font-weight: 700; overflow: hidden; }
      .profile-avatar-preview.has-photo { border-style: solid; background-size: cover; background-position: center; color: transparent; }
      .profile-avatar-row { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
      .profile-modal-sub { color: var(--text-light, #6b7280); margin-top: 0; margin-bottom: 1rem; }
    `;
    document.head.appendChild(style);
  }

  const modal = document.createElement('div');
  modal.id = PROFILE_MODAL_ID;
  modal.className = 'profile-modal hidden';
  modal.innerHTML = `
    <div class="profile-modal-dialog">
      <h3 style="margin:0 0 0.25rem 0;">Edit Profile</h3>
      <p class="profile-modal-sub">Update your display name, phone number, and profile picture.</p>
      <div class="profile-avatar-row">
        <div id="profile-avatar-preview" class="profile-avatar-preview">+</div>
        <div style="flex:1;">
          <label class="form-label" for="profile-photo-input">Profile picture</label>
          <input type="file" id="profile-photo-input" accept="image/*" class="form-input">
          <div class="form-help" style="margin-top:0.25rem;">Image stays on your account and shows on your account icon.</div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="profile-name">Full Name</label>
        <input type="text" id="profile-name" class="form-input" placeholder="Your name">
      </div>
      <div class="form-group">
        <label class="form-label" for="profile-phone">Phone Number</label>
        <input type="text" id="profile-phone" class="form-input" placeholder="10-digit phone">
      </div>
      <div class="profile-modal-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal('${PROFILE_MODAL_ID}')">Cancel</button>
        <button type="button" id="profile-save" class="btn btn-primary">Save Profile</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const fileInput = modal.querySelector('#profile-photo-input');
  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const result = await api.uploadImage(file);
        if (result?.imageUrl) {
          localStorage.setItem(PROFILE_PHOTO_KEY, result.imageUrl);
          applyProfilePhotoFromStorage();
          renderProfilePreview(result.imageUrl);
          showAlert('Profile picture updated.', 'success');
        }
      } catch (error) {
        showAlert(error.message || 'Failed to upload profile picture', 'error');
      }
    });
  }

  const saveBtn = modal.querySelector('#profile-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveProfileChanges);
  }
}

function renderProfilePreview(url) {
  const preview = document.getElementById('profile-avatar-preview');
  if (!preview) return;
  if (url) {
    preview.classList.add('has-photo');
    preview.style.backgroundImage = `url(${url})`;
    preview.textContent = '';
  } else {
    preview.classList.remove('has-photo');
    preview.style.backgroundImage = '';
    preview.textContent = '+';
  }
}

function applyProfilePhotoFromStorage() {
  const url = localStorage.getItem(PROFILE_PHOTO_KEY) || '';
  const toggleButtons = document.querySelectorAll('#account-toggle');
  toggleButtons.forEach((btn) => {
    const icon = btn.querySelector('i');
    if (url) {
      btn.style.backgroundImage = `url(${url})`;
      btn.style.backgroundSize = 'cover';
      btn.style.backgroundPosition = 'center';
      btn.style.borderRadius = '50%';
      btn.classList.add('has-profile-photo');
      if (icon) icon.style.display = 'none';
    } else {
      btn.style.backgroundImage = '';
      btn.classList.remove('has-profile-photo');
      if (icon) icon.style.display = '';
    }
  });
  renderProfilePreview(url);
}

async function openProfileModal() {
  ensureProfileModal();
  const profile = await api.get('/auth/profile').catch(() => null);
  const user = profile?.user || auth.currentUser || {};

  const nameInput = document.getElementById('profile-name');
  const phoneInput = document.getElementById('profile-phone');

  if (nameInput) nameInput.value = user.full_name || '';
  if (phoneInput) phoneInput.value = user.phone || '';

  applyProfilePhotoFromStorage();
  openModal(PROFILE_MODAL_ID);
}

async function saveProfileChanges() {
  const nameInput = document.getElementById('profile-name');
  const phoneInput = document.getElementById('profile-phone');

  const full_name = nameInput?.value?.trim();
  const phone = phoneInput?.value?.trim();

  if (!full_name) {
    showAlert('Full name is required.', 'error');
    if (nameInput) nameInput.focus();
    return;
  }

  if (phone && !validatePhone(phone)) {
    showAlert('Enter a valid 10-digit phone number.', 'error');
    if (phoneInput) phoneInput.focus();
    return;
  }

  try {
    const resp = await api.put('/auth/profile', { full_name, phone });
    if (resp?.user) {
      auth.currentUser = resp.user;
      auth.updateUI();
    }
    showAlert('Profile updated successfully.', 'success');
    closeModal(PROFILE_MODAL_ID);
  } catch (error) {
    showAlert(error.message || 'Failed to update profile.', 'error');
  }
}

// Format Currency
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR'
  }).format(amount);
}

// Format Date
function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

// Format Date & Time
function formatDateTime(dateString) {
  return new Date(dateString).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Loading State
function showLoading(elementId) {
  const element = document.getElementById(elementId);
  if (element) {
    element.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  }
}

function hideLoading(elementId) {
  const element = document.getElementById(elementId);
  if (element) {
    element.innerHTML = '';
  }
}

// Form Validation
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function validatePhone(phone) {
  const re = /^\d{10}$/;
  return re.test(phone.replace(/\D/g, ''));
}

function validatePassword(password) {
  return password.length >= 6;
}

// File validation helper
function validateImageFile(file) {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  const allowedExtensions = ['.jpg', '.jpeg', '.png'];
  const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
  

  
  if (!allowedTypes.includes(file.type) || !allowedExtensions.includes(fileExtension)) {
    return { valid: false, error: 'Invalid file type. Only JPG and PNG images are allowed.' };
  }
  
  if (file.size > 5 * 1024 * 1024) {
    return { valid: false, error: 'File size too large. Maximum size is 5MB.' };
  }
  
  return { valid: true };
}

// Initialize app
async function initApp() {
  await auth.checkAuth();
  await cart.fetch();
  applyProfilePhotoFromStorage();
  
  // Setup logout button
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      auth.logout();
    });
  }

  // Setup mobile menu
  const mobileToggle = document.querySelector('.mobile-menu-toggle');
  const navbarMenu = document.querySelector('.navbar-menu');
  
  if (mobileToggle && navbarMenu) {
    mobileToggle.addEventListener('click', () => {
      navbarMenu.classList.toggle('mobile-active');
    });
  }

  // Global back button on non-home pages
  try {
    const existingBack = document.querySelector('.page-back-button');
    const hasNavbar = document.querySelector('.navbar');
    const path = window.location.pathname || '/';
    const isHome = path === '/' || path === '/index.html';

    if (!existingBack && hasNavbar && !isHome) {
      const backBtn = document.createElement('button');
      backBtn.className = 'page-back-button btn-sm';
      backBtn.type = 'button';
      backBtn.innerHTML = '<i class="fas fa-arrow-left"></i><span>Back</span>';

      backBtn.addEventListener('click', () => {
        if (window.history.length > 1) {
          window.history.back();
        } else {
          window.location.href = document.referrer || '/';
        }
      });

      document.body.appendChild(backBtn);
    }
  } catch (e) {
    console.warn('Back button init failed:', e);
  }
}

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('Service Worker registered'))
      .catch(err => console.log('Service Worker registration failed:', err));
  });
}

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Load and apply custom logo
async function loadSiteLogo() {
  try {
    const response = await fetch('/api/products/settings', {
      method: 'GET',
      credentials: 'include'
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.settings && data.settings.logo_url && data.settings.logo_url !== 'default') {
        // Update all navbar brand elements with custom logo
        const navbarBrands = document.querySelectorAll('.navbar-brand');
        navbarBrands.forEach(brand => {
          // Replace content with image
          brand.innerHTML = `<img src="${data.settings.logo_url}" alt="Site Logo" style="max-height: 40px; max-width: 200px; object-fit: contain;">`;
        });
      }
    }
  } catch (error) {
    // Silently fail - keep default logo
    console.log('Using default logo');
  }
}

// Load logo on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadSiteLogo);
} else {
  loadSiteLogo();
}

// Export for use in other scripts
window.api = api;
window.auth = auth;
window.cart = cart;
window.showAlert = showAlert;
window.formatCurrency = formatCurrency;
window.formatDate = formatDate;
window.formatDateTime = formatDateTime;
window.openModal = openModal;
window.closeModal = closeModal;
window.showLoading = showLoading;
window.hideLoading = hideLoading;
window.uploadProductImage = uploadProductImage;
window.validateImageFile = validateImageFile;
window.loadSiteLogo = loadSiteLogo;
window.openProfileModal = openProfileModal;