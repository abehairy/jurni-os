/**
 * Conversation import channel.
 * Parses Claude and ChatGPT JSON export files into moments.
 */

function detectFormat(data) {
  if (Array.isArray(data) && data.length > 0) {
    if (data[0].chat_messages) return 'claude';
    if (data[0].mapping) return 'chatgpt';
    if (data[0].title && data[0].create_time) return 'chatgpt';
  }
  if (data.conversations) return 'chatgpt-wrapped';
  return 'unknown';
}

function parseClaudeExport(data, sendProgress) {
  const moments = [];
  let conversationCount = 0;

  for (const conversation of data) {
    conversationCount++;
    if (sendProgress && conversationCount % 10 === 0) {
      sendProgress({
        stage: 'parsing',
        message: `Parsing conversation ${conversationCount} of ${data.length}...`,
      });
    }

    const messages = conversation.chat_messages || [];
    for (const msg of messages) {
      if (msg.sender !== 'human') continue;

      const text = extractText(msg.text || msg.content);
      if (!text || text.trim().length < 5) continue;

      moments.push({
        timestamp: msg.created_at || conversation.created_at || new Date().toISOString(),
        source: 'conversation',
        raw_content: text,
        metadata: {
          conversation_name: conversation.name || 'Untitled',
          conversation_id: conversation.uuid || conversation.id || null,
          provider: 'claude',
        },
      });
    }
  }

  return moments;
}

function parseChatGPTExport(data, sendProgress) {
  const moments = [];
  const conversations = Array.isArray(data) ? data : (data.conversations || []);
  let conversationCount = 0;

  for (const conversation of conversations) {
    conversationCount++;
    if (sendProgress && conversationCount % 10 === 0) {
      sendProgress({
        stage: 'parsing',
        message: `Parsing conversation ${conversationCount} of ${conversations.length}...`,
      });
    }

    if (conversation.mapping) {
      for (const [, node] of Object.entries(conversation.mapping)) {
        const msg = node.message;
        if (!msg || msg.author?.role !== 'user') continue;

        const parts = msg.content?.parts || [];
        const text = parts.filter(p => typeof p === 'string').join('\n');
        if (!text || text.trim().length < 5) continue;

        const timestamp = msg.create_time
          ? new Date(msg.create_time * 1000).toISOString()
          : new Date().toISOString();

        moments.push({
          timestamp,
          source: 'conversation',
          raw_content: text,
          metadata: {
            conversation_name: conversation.title || 'Untitled',
            conversation_id: conversation.id || null,
            provider: 'chatgpt',
          },
        });
      }
    }
  }

  return moments;
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(c => typeof c === 'string' || c?.type === 'text')
      .map(c => (typeof c === 'string' ? c : c.text || ''))
      .join('\n');
  }
  if (content && typeof content === 'object' && content.text) return content.text;
  return '';
}

function processConversationImport(data, sendProgress) {
  const format = detectFormat(data);

  if (sendProgress) {
    sendProgress({ stage: 'parsing', message: `Detected ${format} export format...` });
  }

  switch (format) {
    case 'claude':
      return parseClaudeExport(data, sendProgress);
    case 'chatgpt':
    case 'chatgpt-wrapped':
      return parseChatGPTExport(data, sendProgress);
    default:
      throw new Error(
        'Unrecognized export format. Please upload a Claude or ChatGPT JSON export file.'
      );
  }
}

module.exports = { processConversationImport, detectFormat };
