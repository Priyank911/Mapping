// Notion API Service - Knowledge Storage

const NotionService = {
  API_URL: 'https://api.notion.com/v1',
  API_VERSION: '2022-06-28',

  /**
   * Create a new page (note) in Notion database
   * @param {Object} credentials - Notion token and database ID
   * @param {Object} noteData - Structured note data
   * @returns {Promise<Object>} Created page response
   */
  async createNote(credentials, noteData) {
    const { token, databaseId } = credentials;
    
    const properties = this.buildProperties(noteData);

    const response = await fetch(`${this.API_URL}/pages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': this.API_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: properties
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Notion API error: ${error.message || response.statusText}`);
    }

    return await response.json();
  },

  /**
   * Build Notion properties object from note data
   */
  buildProperties(noteData) {
    const properties = {
      // Title (required)
      'Title': {
        title: [{
          text: {
            content: noteData.title || 'Untitled Note'
          }
        }]
      },

      // Original Content (rich_text)
      'Original Content': {
        rich_text: [{
          text: {
            content: this.truncateText(noteData.originalContent, 2000)
          }
        }]
      },

      // Session Name (select)
      'Session Name': {
        select: {
          name: noteData.sessionName || 'Default'
        }
      },

      // Tags (multi_select)
      'Tags': {
        multi_select: (noteData.tags || []).map(tag => ({
          name: this.sanitizeTag(tag)
        }))
      },

      // Source URL (url)
      'Source URL': {
        url: noteData.sourceUrl || null
      },

      // Context Note (rich_text)
      'Context Note': {
        rich_text: [{
          text: {
            content: noteData.contextNote || ''
          }
        }]
      },

      // Timestamp (date)
      'Timestamp': {
        date: {
          start: new Date().toISOString()
        }
      }
    };

    // Linked Notes as text (since we don't have page IDs for relations)
    if (noteData.linkedNotes && noteData.linkedNotes.length > 0) {
      properties['Linked Notes Text'] = {
        rich_text: [{
          text: {
            content: noteData.linkedNotes.join(', ')
          }
        }]
      };
    }

    return properties;
  },

  /**
   * Truncate text to specified length
   */
  truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  },

  /**
   * Sanitize tag for Notion multi_select
   */
  sanitizeTag(tag) {
    // Notion has a 100 character limit for select options
    return (tag || 'tag').substring(0, 100).trim();
  },

  /**
   * Query notes from database
   * @param {Object} credentials - Notion credentials
   * @param {Object} filter - Optional filter
   * @returns {Promise<Array>} Array of notes
   */
  async queryNotes(credentials, filter = {}) {
    const { token, databaseId } = credentials;

    const body = {
      page_size: 100,
      sorts: [
        {
          property: 'Timestamp',
          direction: 'descending'
        }
      ]
    };

    if (filter.sessionName) {
      body.filter = {
        property: 'Session Name',
        select: {
          equals: filter.sessionName
        }
      };
    }

    const response = await fetch(`${this.API_URL}/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': this.API_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Notion query error: ${error.message || response.statusText}`);
    }

    const data = await response.json();
    return data.results;
  },

  /**
   * Get database schema
   * @param {Object} credentials - Notion credentials
   * @returns {Promise<Object>} Database schema
   */
  async getDatabaseSchema(credentials) {
    const { token, databaseId } = credentials;

    const response = await fetch(`${this.API_URL}/databases/${databaseId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': this.API_VERSION,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Notion database error: ${error.message || response.statusText}`);
    }

    return await response.json();
  },

  /**
   * Test Notion connection
   * @param {string} token - Integration token
   * @param {string} databaseId - Database ID
   * @returns {Promise<boolean>} Connection success
   */
  async testConnection(token, databaseId) {
    try {
      const response = await fetch(`${this.API_URL}/databases/${databaseId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': this.API_VERSION,
          'Content-Type': 'application/json'
        }
      });
      return response.ok;
    } catch (error) {
      console.error('Notion connection test failed:', error);
      return false;
    }
  },

  /**
   * Validate token format
   */
  isValidToken(token) {
    return typeof token === 'string' && 
           (token.startsWith('secret_') || token.startsWith('ntn_')) && 
           token.length > 20;
  },

  /**
   * Validate database ID format
   */
  isValidDatabaseId(databaseId) {
    // Notion database IDs are 32 characters (with or without hyphens)
    const cleanId = (databaseId || '').replace(/-/g, '');
    return cleanId.length === 32 && /^[a-f0-9]+$/i.test(cleanId);
  },

  /**
   * Extract database ID from URL
   */
  extractDatabaseIdFromUrl(url) {
    try {
      // Match patterns like:
      // https://www.notion.so/workspace/abc123...
      // https://notion.so/abc123...?v=...
      const match = url.match(/([a-f0-9]{32})/i);
      return match ? match[1] : null;
    } catch (e) {
      return null;
    }
  },

  /**
   * Get required database properties
   * Used to verify database has correct schema
   */
  getRequiredProperties() {
    return [
      { name: 'Title', type: 'title' },
      { name: 'Original Content', type: 'rich_text' },
      { name: 'Session Name', type: 'select' },
      { name: 'Tags', type: 'multi_select' },
      { name: 'Source URL', type: 'url' },
      { name: 'Timestamp', type: 'date' }
    ];
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NotionService;
}
