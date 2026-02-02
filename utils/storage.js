// Storage Manager for encrypted and plain data storage
const StorageManager = {
  // Get plain data from storage
  async get(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key]);
      });
    });
  },

  // Set plain data in storage
  async set(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  },

  // Remove data from storage
  async remove(key) {
    return new Promise((resolve) => {
      chrome.storage.local.remove([key], resolve);
    });
  },

  // Get and decrypt sensitive data
  async getEncrypted(key) {
    const encryptedData = await this.get(`encrypted_${key}`);
    if (!encryptedData) return null;

    try {
      return await CryptoUtils.decrypt(encryptedData);
    } catch (error) {
      console.error('Decryption error:', error);
      return null;
    }
  },

  // Encrypt and store sensitive data
  async setEncrypted(key, value) {
    try {
      const encryptedData = await CryptoUtils.encrypt(value);
      await this.set(`encrypted_${key}`, encryptedData);
    } catch (error) {
      console.error('Encryption error:', error);
      throw error;
    }
  },

  // Get multiple keys at once
  async getMultiple(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, resolve);
    });
  },

  // Set multiple values at once
  async setMultiple(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set(data, resolve);
    });
  },

  // Clear all storage
  async clearAll() {
    return new Promise((resolve) => {
      chrome.storage.local.clear(resolve);
    });
  },

  // Get storage usage info
  async getStorageInfo() {
    return new Promise((resolve) => {
      chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
        resolve({
          bytesInUse,
          quota: chrome.storage.local.QUOTA_BYTES
        });
      });
    });
  }
};

// Session Manager for managing knowledge sessions
const SessionManager = {
  // Get all sessions
  async getSessions() {
    return await StorageManager.get('sessions') || [];
  },

  // Get active session
  async getActiveSession() {
    const sessions = await this.getSessions();
    const activeId = await StorageManager.get('activeSessionId');
    return sessions.find(s => s.id === activeId) || null;
  },

  // Set active session
  async setActiveSession(sessionId) {
    await StorageManager.set('activeSessionId', sessionId);
  },

  // Create new session
  async createSession(name) {
    const sessions = await this.getSessions();
    const newSession = {
      id: CryptoUtils.generateId(),
      name: name,
      createdAt: new Date().toISOString(),
      notionPageId: null, // Will be set when first content is added
      contents: [],       // Array of content summaries for AI context
      contentCount: 0
    };

    sessions.unshift(newSession);
    await StorageManager.set('sessions', sessions);
    await this.setActiveSession(newSession.id);
    
    return newSession;
  },

  // Update session with Notion page ID
  async setSessionPageId(sessionId, pageId) {
    const sessions = await this.getSessions();
    const session = sessions.find(s => s.id === sessionId);
    
    if (session) {
      session.notionPageId = pageId;
      await StorageManager.set('sessions', sessions);
      return session;
    }
    return null;
  },

  // Add content to session (for AI context)
  async addContentToSession(sessionId, title, summary) {
    const sessions = await this.getSessions();
    const session = sessions.find(s => s.id === sessionId);
    
    if (session) {
      if (!session.contents) session.contents = [];
      
      session.contents.push({
        title: title,
        summary: summary.substring(0, 300), // Brief summary for context
        timestamp: new Date().toISOString()
      });
      
      session.contentCount = (session.contentCount || 0) + 1;
      
      // Keep only last 30 content items for context
      if (session.contents.length > 30) {
        session.contents = session.contents.slice(-30);
      }
      
      await StorageManager.set('sessions', sessions);
      
      // Update total notes count
      const totalNotes = await StorageManager.get('totalNotes') || 0;
      await StorageManager.set('totalNotes', totalNotes + 1);
      
      return session;
    }
    
    return null;
  },

  // Update session
  async updateSession(sessionId, updates) {
    const sessions = await this.getSessions();
    const index = sessions.findIndex(s => s.id === sessionId);
    
    if (index !== -1) {
      sessions[index] = { ...sessions[index], ...updates };
      await StorageManager.set('sessions', sessions);
      return sessions[index];
    }
    
    return null;
  },

  // Legacy: Add note to session (kept for compatibility)
  async addNoteToSession(sessionId, noteId, noteTitle, noteSummary = '') {
    return this.addContentToSession(sessionId, noteTitle, noteSummary);
  },

  // Get session context for Groq
  async getSessionContext(sessionId) {
    const sessions = await this.getSessions();
    const session = sessions.find(s => s.id === sessionId);
    
    if (session) {
      return {
        sessionName: session.name,
        notionPageId: session.notionPageId || null,
        contents: session.contents || [],
        contentCount: session.contentCount || 0
      };
    }
    
    return {
      sessionName: 'Default',
      notionPageId: null,
      contents: [],
      contentCount: 0
    };
  },

  // Delete session
  async deleteSession(sessionId) {
    const sessions = await this.getSessions();
    const filtered = sessions.filter(s => s.id !== sessionId);
    await StorageManager.set('sessions', filtered);
    
    const activeId = await StorageManager.get('activeSessionId');
    if (activeId === sessionId) {
      await StorageManager.set('activeSessionId', filtered[0]?.id || null);
    }
  }
};

// Make available globally
if (typeof window !== 'undefined') {
  window.StorageManager = StorageManager;
  window.SessionManager = SessionManager;
}
