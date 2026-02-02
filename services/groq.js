// Groq AI Service - Structuring and Linking Engine

const GroqService = {
  API_URL: 'https://api.groq.com/openai/v1/chat/completions',
  MODEL: 'llama-3.1-8b-instant',

  /**
   * Process selected text with Groq AI for structuring
   * @param {string} apiKey - Groq API key
   * @param {string} selectedText - The text to process
   * @param {Object} context - Session context with previous notes
   * @returns {Promise<Object>} Structured data
   */
  async processText(apiKey, selectedText, context) {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(selectedText, context);

    try {
      const response = await fetch(this.API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 500,
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      return this.parseResponse(data, selectedText);

    } catch (error) {
      console.error('Groq processing error:', error);
      return this.getFallbackStructure(selectedText);
    }
  },

  /**
   * Build the system prompt for Groq
   * Strictly defines the AI's role and constraints
   */
  buildSystemPrompt() {
    return `You are a knowledge structuring assistant for a personal knowledge management system.

YOUR ONLY RESPONSIBILITIES:
1. Create a concise, descriptive title (maximum 10 words)
2. Generate 2-5 relevant tags that categorize the content
3. Identify potential relationships with existing notes based on their titles
4. Write a brief contextual note (1-2 sentences) explaining connections

STRICT CONSTRAINTS - YOU MUST NOT:
- Rewrite, paraphrase, or modify the original text in any way
- Search for or include external information
- Generate new content beyond the requested structure
- Write summaries, essays, or explanations
- Add opinions or interpretations
- Expand on the provided content

OUTPUT FORMAT (JSON only):
{
  "title": "Concise descriptive title",
  "tags": ["tag1", "tag2", "tag3"],
  "linkedNotes": ["Related note title 1", "Related note title 2"],
  "contextNote": "Brief explanation of how this connects to other knowledge in the session"
}

If you cannot find relationships, return an empty linkedNotes array.
If the text is unclear, still provide your best structural interpretation.`;
  },

  /**
   * Build the user prompt with context
   */
  buildUserPrompt(selectedText, context) {
    const previousNotes = context.previousTitles?.length > 0
      ? context.previousTitles.join('\n- ')
      : 'None yet';

    return `KNOWLEDGE SESSION: ${context.sessionName || 'Default'}

EXISTING NOTES IN THIS SESSION:
- ${previousNotes}

SESSION SUMMARY: ${context.summary || 'No summary yet'}

---

NEW CONTENT TO STRUCTURE:
"""
${selectedText}
"""

Analyze this content and provide the structured output. Remember: DO NOT modify the original text, only create metadata.`;
  },

  /**
   * Parse and validate Groq response
   */
  parseResponse(data, originalText) {
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return this.getFallbackStructure(originalText);
    }

    try {
      const parsed = JSON.parse(content);

      // Validate and sanitize response
      return {
        title: this.sanitizeTitle(parsed.title, originalText),
        tags: this.sanitizeTags(parsed.tags),
        linkedNotes: this.sanitizeLinkedNotes(parsed.linkedNotes),
        contextNote: this.sanitizeContextNote(parsed.contextNote)
      };

    } catch (e) {
      console.error('Failed to parse Groq response:', content);
      return this.getFallbackStructure(originalText);
    }
  },

  /**
   * Sanitize title
   */
  sanitizeTitle(title, originalText) {
    if (!title || typeof title !== 'string') {
      // Generate from first few words
      const words = originalText.split(/\s+/).slice(0, 8);
      return words.join(' ') + (originalText.split(/\s+/).length > 8 ? '...' : '');
    }
    return title.substring(0, 100);
  },

  /**
   * Sanitize tags array
   */
  sanitizeTags(tags) {
    if (!Array.isArray(tags)) {
      return ['uncategorized'];
    }
    return tags
      .filter(tag => typeof tag === 'string' && tag.trim())
      .map(tag => tag.trim().substring(0, 50))
      .slice(0, 5);
  },

  /**
   * Sanitize linked notes array
   */
  sanitizeLinkedNotes(linkedNotes) {
    if (!Array.isArray(linkedNotes)) {
      return [];
    }
    return linkedNotes
      .filter(note => typeof note === 'string' && note.trim())
      .map(note => note.trim().substring(0, 100))
      .slice(0, 5);
  },

  /**
   * Sanitize context note
   */
  sanitizeContextNote(note) {
    if (!note || typeof note !== 'string') {
      return 'New knowledge entry';
    }
    return note.substring(0, 500);
  },

  /**
   * Get fallback structure when processing fails
   */
  getFallbackStructure(originalText) {
    const words = originalText.split(/\s+/);
    const title = words.slice(0, 8).join(' ') + (words.length > 8 ? '...' : '');

    return {
      title: title,
      tags: ['uncategorized'],
      linkedNotes: [],
      contextNote: 'Auto-captured content'
    };
  },

  /**
   * Validate API key format
   */
  isValidApiKey(apiKey) {
    return typeof apiKey === 'string' && apiKey.startsWith('gsk_') && apiKey.length > 20;
  },

  /**
   * Test API key validity
   */
  async testApiKey(apiKey) {
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
      console.error('API key test failed:', error);
      return false;
    }
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GroqService;
}
