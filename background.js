// Background Service Worker for Mapping Extension

// Import utilities
importScripts('utils/crypto.js', 'utils/storage.js');

// Context menu ID
const CONTEXT_MENU_ID = 'storeToMapping';

// Initialize extension
chrome.runtime.onInstalled.addListener(async (details) => {
  // Create context menu
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Store to Mapping',
    contexts: ['selection']
  });

  if (details.reason === 'install') {
    console.log('Mapping Extension installed');
  }
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_ID && info.selectionText) {
    await handleMapping(info.selectionText, tab.url, tab.id);
  }
});

// Handle mapping request
async function handleMapping(selectedText, sourceUrl, tabId) {
  try {
    // Check if setup is complete and unlocked
    const setupComplete = await StorageManager.get('setupComplete');
    const isLocked = await StorageManager.get('isLocked');

    if (!setupComplete) {
      sendNotification(tabId, 'Please complete setup first', 'error');
      return;
    }

    if (isLocked) {
      sendNotification(tabId, 'Extension is locked. Please unlock first.', 'error');
      return;
    }

    // Get active session
    const activeSessionId = await StorageManager.get('activeSessionId');
    if (!activeSessionId) {
      sendNotification(tabId, 'No active session. Please create one first.', 'error');
      return;
    }

    // Show processing notification
    sendNotification(tabId, 'Processing...', 'info');

    // Get session context
    const sessionContext = await SessionManager.getSessionContext(activeSessionId);

    // Get Groq API key
    const groqApiKey = await StorageManager.getEncrypted('groqApiKey');
    if (!groqApiKey) {
      sendNotification(tabId, 'Groq API key not found', 'error');
      return;
    }

    // Get Notion credentials
    const notionCreds = await StorageManager.getEncrypted('notionCredentials');
    if (!notionCreds) {
      sendNotification(tabId, 'Notion credentials not found', 'error');
      return;
    }

    // Structure content with Groq - analyze connections with existing content
    const structuredData = await processWithGroq(groqApiKey, selectedText, sessionContext);

    // Check if session already has a Notion page
    const session = await SessionManager.getActiveSession();
    
    if (session && session.notionPageId) {
      // APPEND to existing page
      await appendToNotionPage(notionCreds, session.notionPageId, {
        content: selectedText,
        sourceUrl: sourceUrl,
        connections: structuredData.connections,
        sectionTitle: structuredData.sectionTitle
      });
    } else {
      // CREATE new page for this session
      const notionResponse = await createNotionPage(notionCreds, {
        sessionName: sessionContext.sessionName,
        content: selectedText,
        sourceUrl: sourceUrl,
        sectionTitle: structuredData.sectionTitle
      });

      // Save the Notion page ID to the session
      await SessionManager.updateSession(activeSessionId, {
        notionPageId: notionResponse.id
      });
    }

    // Update session with content info for future AI analysis
    await SessionManager.addContentToSession(
      activeSessionId,
      structuredData.sectionTitle,
      selectedText.substring(0, 300)
    );

    // Send success notification
    sendNotification(tabId, 'Mapped successfully!', 'success');

    // Notify popup if open
    chrome.runtime.sendMessage({ type: 'MAPPING_COMPLETE' }).catch(() => {});

  } catch (error) {
    console.error('Mapping error:', error);
    sendNotification(tabId, `Error: ${error.message}`, 'error');
    chrome.runtime.sendMessage({ type: 'MAPPING_ERROR', error: error.message }).catch(() => {});
  }
}

// Process content with Groq AI - Find connections with existing content
async function processWithGroq(apiKey, selectedText, sessionContext) {
  // Build context about previous content in this session
  let previousContentContext = 'This is the first content in this session.';
  
  if (sessionContext.contents && sessionContext.contents.length > 0) {
    previousContentContext = sessionContext.contents.map((item, index) => 
      `[${index + 1}] "${item.title}": ${item.summary}`
    ).join('\n\n');
  }

  const systemPrompt = `You are a knowledge organizing assistant. Your job is to:
1. Create a clear, concise section title (3-6 words) for the new content
2. Find meaningful CONNECTIONS between this new content and existing content

STRICT RULES:
- DO NOT use emojis in titles
- DO NOT rewrite or modify the original text
- Keep titles professional and descriptive
- Only identify genuine connections, not forced ones

OUTPUT FORMAT (JSON only):
{
  "sectionTitle": "Clear descriptive title",
  "connections": [
    {
      "toSection": "Title of connected section",
      "relationship": "Brief explanation (10 words max)"
    }
  ]
}

If no meaningful connections exist, return empty connections array.`;

  const userPrompt = `SESSION: "${sessionContext.sessionName}"

=== EXISTING CONTENT IN THIS SESSION ===
${previousContentContext}

=== NEW CONTENT TO MAP ===
"""
${selectedText.substring(0, 1500)}
"""

Create a section title and find connections to existing content.`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 400,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Groq API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    const parsed = JSON.parse(content);
    
    return {
      sectionTitle: parsed.sectionTitle || 'New Section',
      connections: parsed.connections || []
    };
  } catch (e) {
    console.error('Groq processing error:', e);
    // Fallback - just use first few words as title
    const words = selectedText.split(/\s+/).slice(0, 5).join(' ');
    return {
      sectionTitle: words + '...',
      connections: []
    };
  }
}

// Create a new Notion page for a session
async function createNotionPage(credentials, data) {
  const { token, databaseId } = credentials;

  // Get the database schema to find the title property
  const schemaResponse = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    }
  });

  if (!schemaResponse.ok) {
    const error = await schemaResponse.json().catch(() => ({}));
    throw new Error(`Notion API error: ${error.message || schemaResponse.statusText}`);
  }

  const schema = await schemaResponse.json();
  
  // Find the title property name
  let titlePropertyName = 'Name';
  for (const [propName, propConfig] of Object.entries(schema.properties)) {
    if (propConfig.type === 'title') {
      titlePropertyName = propName;
      break;
    }
  }

  // Clean title without emoji
  const properties = {
    [titlePropertyName]: {
      title: [{ text: { content: data.sessionName } }]
    }
  };

  // Build initial content blocks - clean markdown-like format
  const children = [
    // Table of contents for easy navigation
    {
      object: 'block',
      type: 'table_of_contents',
      table_of_contents: { color: 'gray' }
    },
    {
      object: 'block',
      type: 'divider',
      divider: {}
    },
    // First content section
    {
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: data.sectionTitle } }]
      }
    }
  ];

  // Split content into paragraphs for better readability
  const paragraphs = data.content.split(/\n\n+/).filter(p => p.trim());
  paragraphs.forEach(para => {
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: para.trim().substring(0, 2000) } }]
      }
    });
  });

  // Add source as small inline link
  if (data.sourceUrl) {
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          { type: 'text', text: { content: 'Source: ' }, annotations: { color: 'gray', italic: true } },
          { type: 'text', text: { content: new URL(data.sourceUrl).hostname, link: { url: data.sourceUrl } }, annotations: { color: 'gray', italic: true } }
        ]
      }
    });
  }

  // Add divider for separation
  children.push({
    object: 'block',
    type: 'divider',
    divider: {}
  });

  // Create the page
  const response = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: properties,
      children: children
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Notion API error: ${errorData.message || response.statusText}`);
  }

  return await response.json();
}

// Append content to existing Notion page
async function appendToNotionPage(credentials, pageId, data) {
  const { token } = credentials;

  // Build content blocks to append - clean markdown-like format
  const children = [
    // Section heading (clean, no emoji)
    {
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: data.sectionTitle } }]
      }
    }
  ];

  // Split content into paragraphs for better readability
  const paragraphs = data.content.split(/\n\n+/).filter(p => p.trim());
  paragraphs.forEach(para => {
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: para.trim().substring(0, 2000) } }]
      }
    });
  });

  // Add connections as a clean quote block (if found)
  if (data.connections && data.connections.length > 0) {
    // Add connections as nested toggle for clean look
    const connectionItems = data.connections.map(c => 
      `${c.toSection} — ${c.relationship}`
    );
    
    children.push({
      object: 'block',
      type: 'toggle',
      toggle: {
        rich_text: [
          { type: 'text', text: { content: `Related: ${connectionItems.length} connection${connectionItems.length > 1 ? 's' : ''}` }, annotations: { italic: true, color: 'gray' } }
        ],
        children: connectionItems.map(item => ({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: item } }]
          }
        }))
      }
    });
  }

  // Add source as small inline link
  if (data.sourceUrl) {
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          { type: 'text', text: { content: 'Source: ' }, annotations: { color: 'gray', italic: true } },
          { type: 'text', text: { content: new URL(data.sourceUrl).hostname, link: { url: data.sourceUrl } }, annotations: { color: 'gray', italic: true } }
        ]
      }
    });
  }

  // Add divider for separation
  children.push({
    object: 'block',
    type: 'divider',
    divider: {}
  });

  // Append blocks to existing page
  const response = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ children })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Notion API error: ${errorData.message || response.statusText}`);
  }

  return await response.json();
}

// Send notification to content script
function sendNotification(tabId, message, type = 'info') {
  chrome.tabs.sendMessage(tabId, {
    type: 'SHOW_NOTIFICATION',
    message: message,
    notificationType: type
  }).catch(() => {
    // Tab might not have content script, ignore
    console.log('Could not send notification to tab');
  });
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SETUP_COMPLETE') {
    console.log('Setup completed');
  } else if (message.type === 'SESSION_CHANGED') {
    console.log('Session changed to:', message.sessionId);
  } else if (message.type === 'GET_ACTIVE_SESSION') {
    SessionManager.getActiveSession().then(session => {
      sendResponse(session);
    });
    return true; // Keep message channel open for async response
  }
});

// Clean up on extension uninstall
chrome.runtime.setUninstallURL('', () => {
  // Data is automatically cleared when extension is uninstalled
  console.log('Extension uninstalled, data cleared');
});
