// Content Script for Mapping Extension

// Notification container
let notificationContainer = null;

// Initialize content script
function init() {
  // Create notification container
  createNotificationContainer();
  
  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SHOW_NOTIFICATION') {
      showNotification(message.message, message.notificationType);
    }
    return true;
  });
}

// Create the notification container element
function createNotificationContainer() {
  if (notificationContainer) return;

  notificationContainer = document.createElement('div');
  notificationContainer.id = 'mapping-notification-container';
  document.body.appendChild(notificationContainer);
}

// Show notification
function showNotification(message, type = 'info') {
  if (!notificationContainer) {
    createNotificationContainer();
  }

  const notification = document.createElement('div');
  notification.className = `mapping-notification mapping-notification-${type}`;
  
  // Icon based on type
  let icon = '';
  switch (type) {
    case 'success':
      icon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>`;
      break;
    case 'error':
      icon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="15" y1="9" x2="9" y2="15"></line>
        <line x1="9" y1="9" x2="15" y2="15"></line>
      </svg>`;
      break;
    case 'info':
    default:
      icon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
      </svg>`;
      break;
  }

  notification.innerHTML = `
    <span class="mapping-notification-icon">${icon}</span>
    <span class="mapping-notification-message">${escapeHtml(message)}</span>
  `;

  notificationContainer.appendChild(notification);

  // Trigger animation
  requestAnimationFrame(() => {
    notification.classList.add('mapping-notification-show');
  });

  // Auto remove after delay
  const duration = type === 'error' ? 5000 : 3000;
  setTimeout(() => {
    notification.classList.remove('mapping-notification-show');
    notification.classList.add('mapping-notification-hide');
    
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, duration);
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
