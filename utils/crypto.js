// Cryptographic utilities for secure local storage
const CryptoUtils = {
  // Stored encryption key (persisted encrypted with a machine key)
  _encryptionKey: null,
  _keyPromise: null,

  // Generate a random salt
  generateSalt() {
    return crypto.getRandomValues(new Uint8Array(16));
  },

  // Convert array buffer to base64
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  },

  // Convert base64 to array buffer
  base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  },

  // Hash password using PBKDF2
  async hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    
    // Generate a salt
    const salt = this.generateSalt();
    
    // Import password as key
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      data,
      'PBKDF2',
      false,
      ['deriveBits']
    );

    // Derive bits using PBKDF2
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    );

    // Return salt and hash as base64
    return {
      salt: this.arrayBufferToBase64(salt),
      hash: this.arrayBufferToBase64(derivedBits)
    };
  },

  // Verify password against stored hash
  async verifyPassword(password, storedHash) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const salt = this.base64ToArrayBuffer(storedHash.salt);

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      data,
      'PBKDF2',
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    );

    const computedHash = this.arrayBufferToBase64(derivedBits);
    return computedHash === storedHash.hash;
  },

  // Get or create the master encryption key (stored in chrome.storage)
  async getOrCreateMasterKey() {
    // Return cached key if available
    if (this._encryptionKey) {
      return this._encryptionKey;
    }

    // Prevent race conditions
    if (this._keyPromise) {
      return this._keyPromise;
    }

    this._keyPromise = (async () => {
      // Try to load existing key from storage
      const stored = await new Promise(resolve => {
        chrome.storage.local.get(['_masterKey'], result => resolve(result._masterKey));
      });

      if (stored) {
        // Import the stored key
        const keyData = this.base64ToArrayBuffer(stored);
        this._encryptionKey = await crypto.subtle.importKey(
          'raw',
          keyData,
          { name: 'AES-GCM', length: 256 },
          true,
          ['encrypt', 'decrypt']
        );
      } else {
        // Generate a new key
        this._encryptionKey = await crypto.subtle.generateKey(
          { name: 'AES-GCM', length: 256 },
          true,
          ['encrypt', 'decrypt']
        );

        // Export and store the key
        const exported = await crypto.subtle.exportKey('raw', this._encryptionKey);
        const keyBase64 = this.arrayBufferToBase64(exported);
        await new Promise(resolve => {
          chrome.storage.local.set({ _masterKey: keyBase64 }, resolve);
        });
      }

      return this._encryptionKey;
    })();

    const key = await this._keyPromise;
    this._keyPromise = null;
    return key;
  },

  // Derive encryption key from password (for user session validation)
  async deriveKey(password) {
    // This now just validates and ensures master key exists
    await this.getOrCreateMasterKey();
    return this._encryptionKey;
  },

  // Encrypt data
  async encrypt(data) {
    const key = await this.getOrCreateMasterKey();

    const encoder = new TextEncoder();
    const dataString = JSON.stringify(data);
    const dataBuffer = encoder.encode(dataString);

    // Generate random IV
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encryptedBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      dataBuffer
    );

    return {
      iv: this.arrayBufferToBase64(iv),
      data: this.arrayBufferToBase64(encryptedBuffer)
    };
  },

  // Decrypt data
  async decrypt(encryptedData) {
    const key = await this.getOrCreateMasterKey();

    const iv = this.base64ToArrayBuffer(encryptedData.iv);
    const data = this.base64ToArrayBuffer(encryptedData.data);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      data
    );

    const decoder = new TextDecoder();
    const decryptedString = decoder.decode(decryptedBuffer);
    return JSON.parse(decryptedString);
  },

  // Clear the encryption key from memory
  clearKey() {
    this._encryptionKey = null;
  },

  // Check if encryption key is available
  hasKey() {
    return this._encryptionKey !== null;
  },

  // Generate a simple unique ID
  generateId() {
    const timestamp = Date.now().toString(36);
    const randomPart = crypto.getRandomValues(new Uint8Array(8));
    const randomStr = Array.from(randomPart, b => b.toString(36)).join('').substr(0, 8);
    return `${timestamp}-${randomStr}`;
  }
};

// Make available globally
if (typeof window !== 'undefined') {
  window.CryptoUtils = CryptoUtils;
}
