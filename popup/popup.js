// Popup Controller
class PopupController {
  constructor() {
    this.currentStep = 1;
    this.isSetupComplete = false;
    this.isUnlocked = false;
    this.currentView = 'onboarding';
    
    // Temporary storage for onboarding data (before encryption key exists)
    this.onboardingData = {
      groqApiKey: null,
      userName: null,
      password: null,
      notionToken: null,
      notionDatabaseId: null
    };
    
    this.init();
  }

  async init() {
    await this.checkSetupStatus();
    this.bindEvents();
    this.updateView();
  }

  async checkSetupStatus() {
    try {
      const setupComplete = await StorageManager.get('setupComplete');
      const isLocked = await StorageManager.get('isLocked');
      
      this.isSetupComplete = setupComplete === true;
      this.isUnlocked = !isLocked;
      
      if (this.isSetupComplete && !this.isUnlocked) {
        this.currentView = 'lock';
        const userData = await StorageManager.getEncrypted('userData');
        if (userData && userData.name) {
          document.getElementById('lockUserName').textContent = userData.name;
        }
      } else if (this.isSetupComplete && this.isUnlocked) {
        this.currentView = 'dashboard';
        await this.loadDashboardData();
      } else {
        this.currentView = 'onboarding';
      }
    } catch (error) {
      console.error('Error checking setup status:', error);
      this.currentView = 'onboarding';
    }
  }

  bindEvents() {
    // Visibility toggles
    document.querySelectorAll('.toggle-visibility').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetId = e.currentTarget.dataset.target;
        const input = document.getElementById(targetId);
        input.type = input.type === 'password' ? 'text' : 'password';
      });
    });

    // Step 1: Groq API
    document.getElementById('step1Next').addEventListener('click', () => this.validateStep1());

    // Step 2: Local Identity
    document.getElementById('step2Back').addEventListener('click', () => this.goToStep(1));
    document.getElementById('step2Next').addEventListener('click', () => this.validateStep2());

    // Step 3: Notion
    document.getElementById('step3Back').addEventListener('click', () => this.goToStep(2));
    document.getElementById('step3Complete').addEventListener('click', () => this.validateStep3());

    // Lock screen
    document.getElementById('unlockBtn').addEventListener('click', () => this.unlock());
    document.getElementById('unlockPassword').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.unlock();
    });

    // Settings
    document.getElementById('settingsBtn').addEventListener('click', () => this.showView('settings'));
    document.getElementById('backFromSettings').addEventListener('click', () => this.showView('dashboard'));
    document.getElementById('lockExtension').addEventListener('click', () => this.lockExtension());
    document.getElementById('clearAllData').addEventListener('click', () => this.clearAllData());
    document.getElementById('updateGroqKey').addEventListener('click', () => this.updateGroqKey());
    document.getElementById('updateNotion').addEventListener('click', () => this.updateNotion());
    document.getElementById('changePassword').addEventListener('click', () => this.changePassword());

    // Sessions
    document.getElementById('newSessionBtn').addEventListener('click', () => this.showNewSessionModal());
    document.getElementById('cancelNewSession').addEventListener('click', () => this.hideNewSessionModal());
    document.getElementById('createSession').addEventListener('click', () => this.createNewSession());
    document.getElementById('newSessionName').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.createNewSession();
    });

    // Listen for messages from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'MAPPING_COMPLETE') {
        this.showToast('Note mapped successfully!', 'success');
        this.loadDashboardData();
      } else if (message.type === 'MAPPING_ERROR') {
        this.showToast(message.error || 'Failed to map note', 'error');
      }
    });
  }

  updateView() {
    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    
    // Show current view
    const viewId = `${this.currentView}View`;
    const view = document.getElementById(viewId);
    if (view) {
      view.classList.remove('hidden');
    }

    // Hide settings button if not on dashboard
    const settingsBtn = document.getElementById('settingsBtn');
    settingsBtn.style.display = this.currentView === 'dashboard' ? 'block' : 'none';
  }

  showView(viewName) {
    this.currentView = viewName;
    this.updateView();
  }

  goToStep(step) {
    // Update step dots
    document.querySelectorAll('.step-dot').forEach((dot, i) => {
      dot.classList.remove('active');
      if (i + 1 < step) {
        dot.classList.add('completed');
      } else {
        dot.classList.remove('completed');
      }
      if (i + 1 === step) {
        dot.classList.add('active');
      }
    });

    // Update step content
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    document.getElementById(`step${step}`).classList.add('active');
    
    this.currentStep = step;
  }

  async validateStep1() {
    const apiKey = document.getElementById('groqApiKey').value.trim();
    const validation = document.getElementById('groqValidation');
    
    if (!apiKey) {
      validation.textContent = 'Please enter your Groq API key';
      validation.className = 'validation-msg error';
      return;
    }

    if (!apiKey.startsWith('gsk_')) {
      validation.textContent = 'Invalid API key format';
      validation.className = 'validation-msg error';
      return;
    }

    // Validate API key with Groq
    const btn = document.getElementById('step1Next');
    btn.textContent = 'Validating...';
    btn.disabled = true;

    try {
      const isValid = await this.testGroqApiKey(apiKey);
      if (isValid) {
        // Store temporarily until password is set (encryption key derived)
        this.onboardingData.groqApiKey = apiKey;
        validation.textContent = 'API key validated!';
        validation.className = 'validation-msg success';
        setTimeout(() => this.goToStep(2), 500);
      } else {
        validation.textContent = 'Invalid API key';
        validation.className = 'validation-msg error';
      }
    } catch (error) {
      validation.textContent = 'Failed to validate API key';
      validation.className = 'validation-msg error';
    } finally {
      btn.textContent = 'Continue';
      btn.disabled = false;
    }
  }

  async testGroqApiKey(apiKey) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      return response.ok;
    } catch (error) {
      console.error('Groq API test error:', error);
      return false;
    }
  }

  async validateStep2() {
    const name = document.getElementById('userName').value.trim();
    const password = document.getElementById('userPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const validation = document.getElementById('passwordValidation');

    if (!name) {
      validation.textContent = 'Please enter your name';
      validation.className = 'validation-msg error';
      return;
    }

    if (!password || password.length < 6) {
      validation.textContent = 'Password must be at least 6 characters';
      validation.className = 'validation-msg error';
      return;
    }

    if (password !== confirmPassword) {
      validation.textContent = 'Passwords do not match';
      validation.className = 'validation-msg error';
      return;
    }

    // Store user data
    this.onboardingData.userName = name;
    this.onboardingData.password = password;

    // Now encrypt and store the Groq API key
    await StorageManager.setEncrypted('groqApiKey', this.onboardingData.groqApiKey);

    // Hash and store user data
    const hashedPassword = await CryptoUtils.hashPassword(password);
    await StorageManager.setEncrypted('userData', {
      name: name,
      passwordHash: hashedPassword
    });

    validation.textContent = '';
    this.goToStep(3);
  }

  async validateStep3() {
    const token = document.getElementById('notionToken').value.trim();
    const databaseId = document.getElementById('notionDatabaseId').value.trim();
    const validation = document.getElementById('notionValidation');

    if (!token) {
      validation.textContent = 'Please enter your Notion integration token';
      validation.className = 'validation-msg error';
      return;
    }

    if (!databaseId) {
      validation.textContent = 'Please enter your Notion database ID';
      validation.className = 'validation-msg error';
      return;
    }

    const btn = document.getElementById('step3Complete');
    btn.textContent = 'Validating...';
    btn.disabled = true;

    try {
      const isValid = await this.testNotionConnection(token, databaseId);
      if (isValid) {
        await StorageManager.setEncrypted('notionCredentials', {
          token: token,
          databaseId: databaseId
        });

        // Complete setup
        await StorageManager.set('setupComplete', true);
        await StorageManager.set('isLocked', false);

        // Initialize sessions storage
        await StorageManager.set('sessions', []);
        await StorageManager.set('activeSessionId', null);
        await StorageManager.set('totalNotes', 0);

        validation.textContent = 'Connected successfully!';
        validation.className = 'validation-msg success';

        // Notify background script
        chrome.runtime.sendMessage({ type: 'SETUP_COMPLETE' });

        setTimeout(async () => {
          this.isSetupComplete = true;
          this.isUnlocked = true;
          this.currentView = 'dashboard';
          await this.loadDashboardData();
          this.updateView();
        }, 500);
      } else {
        validation.textContent = 'Failed to connect to Notion';
        validation.className = 'validation-msg error';
      }
    } catch (error) {
      validation.textContent = 'Connection error: ' + error.message;
      validation.className = 'validation-msg error';
    } finally {
      btn.textContent = 'Complete Setup';
      btn.disabled = false;
    }
  }

  async testNotionConnection(token, databaseId) {
    try {
      const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        }
      });
      return response.ok;
    } catch (error) {
      console.error('Notion connection test error:', error);
      return false;
    }
  }

  async unlock() {
    const password = document.getElementById('unlockPassword').value;
    const validation = document.getElementById('unlockValidation');

    if (!password) {
      validation.textContent = 'Please enter your password';
      validation.className = 'validation-msg error';
      return;
    }

    try {
      const userData = await StorageManager.getEncrypted('userData');
      const isValid = await CryptoUtils.verifyPassword(password, userData.passwordHash);

      if (isValid) {
        await CryptoUtils.deriveKey(password);
        await StorageManager.set('isLocked', false);
        this.isUnlocked = true;
        this.currentView = 'dashboard';
        await this.loadDashboardData();
        this.updateView();
        document.getElementById('unlockPassword').value = '';
      } else {
        validation.textContent = 'Incorrect password';
        validation.className = 'validation-msg error';
      }
    } catch (error) {
      validation.textContent = 'Error unlocking';
      validation.className = 'validation-msg error';
    }
  }

  async lockExtension() {
    await StorageManager.set('isLocked', true);
    CryptoUtils.clearKey();
    this.isUnlocked = false;
    this.currentView = 'lock';
    
    const userData = await StorageManager.getEncrypted('userData');
    if (userData && userData.name) {
      document.getElementById('lockUserName').textContent = userData.name;
    }
    
    this.updateView();
    this.showToast('Extension locked');
  }

  async loadDashboardData() {
    try {
      // Load sessions
      const sessions = await StorageManager.get('sessions') || [];
      const activeSessionId = await StorageManager.get('activeSessionId');
      const totalNotes = await StorageManager.get('totalNotes') || 0;

      // Update stats
      document.getElementById('totalNotes').textContent = totalNotes;
      document.getElementById('totalSessions').textContent = sessions.length;

      // Update active session
      const activeSession = sessions.find(s => s.id === activeSessionId);
      if (activeSession) {
        document.getElementById('currentSessionName').textContent = activeSession.name;
        document.getElementById('sessionNoteCount').textContent = `${activeSession.contentCount || 0} items`;
      } else {
        document.getElementById('currentSessionName').textContent = 'No active session';
        document.getElementById('sessionNoteCount').textContent = '0 items';
      }

      // Update session list
      const sessionList = document.getElementById('sessionList');
      sessionList.innerHTML = '';

      sessions.slice(0, 5).forEach(session => {
        const div = document.createElement('div');
        div.className = `session-item${session.id === activeSessionId ? ' active' : ''}`;
        div.innerHTML = `
          <span class="session-item-name">${this.escapeHtml(session.name)}</span>
          <span class="session-item-count">${session.contentCount || 0} items</span>
        `;
        div.addEventListener('click', () => this.selectSession(session.id));
        sessionList.appendChild(div);
      });

      if (sessions.length === 0) {
        sessionList.innerHTML = '<p style="color: var(--text-muted); font-size: 12px; padding: 8px;">No sessions yet. Create one to start mapping!</p>';
      }
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    }
  }

  async selectSession(sessionId) {
    await StorageManager.set('activeSessionId', sessionId);
    chrome.runtime.sendMessage({ type: 'SESSION_CHANGED', sessionId });
    await this.loadDashboardData();
    this.showToast('Session activated');
  }

  showNewSessionModal() {
    document.getElementById('newSessionModal').classList.remove('hidden');
    document.getElementById('newSessionName').focus();
  }

  hideNewSessionModal() {
    document.getElementById('newSessionModal').classList.add('hidden');
    document.getElementById('newSessionName').value = '';
  }

  async createNewSession() {
    const name = document.getElementById('newSessionName').value.trim();
    
    if (!name) {
      this.showToast('Please enter a session name', 'error');
      return;
    }

    try {
      const sessions = await StorageManager.get('sessions') || [];
      const newSession = {
        id: this.generateId(),
        name: name,
        createdAt: new Date().toISOString(),
        noteIds: [],
        summary: ''
      };

      sessions.unshift(newSession);
      await StorageManager.set('sessions', sessions);
      await StorageManager.set('activeSessionId', newSession.id);

      chrome.runtime.sendMessage({ type: 'SESSION_CHANGED', sessionId: newSession.id });

      this.hideNewSessionModal();
      await this.loadDashboardData();
      this.showToast('Session created');
    } catch (error) {
      this.showToast('Failed to create session', 'error');
    }
  }

  async clearAllData() {
    if (confirm('Are you sure you want to clear all data? This action cannot be undone.')) {
      await chrome.storage.local.clear();
      CryptoUtils.clearKey();
      this.isSetupComplete = false;
      this.isUnlocked = false;
      this.currentView = 'onboarding';
      this.currentStep = 1;
      this.goToStep(1);
      this.updateView();
      this.showToast('All data cleared');
    }
  }

  async updateGroqKey() {
    const newKey = prompt('Enter new Groq API key:');
    if (newKey && newKey.startsWith('gsk_')) {
      const isValid = await this.testGroqApiKey(newKey);
      if (isValid) {
        await StorageManager.setEncrypted('groqApiKey', newKey);
        this.showToast('Groq API key updated', 'success');
      } else {
        this.showToast('Invalid API key', 'error');
      }
    }
  }

  async updateNotion() {
    const token = prompt('Enter new Notion integration token:');
    const databaseId = prompt('Enter new Notion database ID:');
    
    if (token && databaseId) {
      const isValid = await this.testNotionConnection(token, databaseId);
      if (isValid) {
        await StorageManager.setEncrypted('notionCredentials', { token, databaseId });
        this.showToast('Notion settings updated', 'success');
      } else {
        this.showToast('Failed to connect to Notion', 'error');
      }
    }
  }

  async changePassword() {
    const currentPassword = prompt('Enter current password:');
    if (!currentPassword) return;

    const userData = await StorageManager.getEncrypted('userData');
    const isValid = await CryptoUtils.verifyPassword(currentPassword, userData.passwordHash);
    
    if (!isValid) {
      this.showToast('Incorrect password', 'error');
      return;
    }

    const newPassword = prompt('Enter new password (min 6 characters):');
    if (!newPassword || newPassword.length < 6) {
      this.showToast('Password must be at least 6 characters', 'error');
      return;
    }

    const confirmPassword = prompt('Confirm new password:');
    if (newPassword !== confirmPassword) {
      this.showToast('Passwords do not match', 'error');
      return;
    }

    const newHash = await CryptoUtils.hashPassword(newPassword);
    userData.passwordHash = newHash;
    await StorageManager.setEncrypted('userData', userData);
    await CryptoUtils.deriveKey(newPassword);
    this.showToast('Password changed successfully', 'success');
  }

  showToast(message, type = '') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    
    toastMessage.textContent = message;
    toast.className = `toast ${type}`;
    
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});
