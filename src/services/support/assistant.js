const store = require('../../store');
const { getSupportSystemPrompt } = require('./prompt');
const { getFallback, matchQuickFaq } = require('./fallback');
const {
  sanitizeUserInput,
  detectInjection,
  detectOffTopic,
  sanitizeAssistantOutput,
  passesOutputGuardrails,
  blockInjectionResponse,
} = require('./guardrails');
const { getSupportLlmClient, getSupportModel } = require('./client');
const { SUPPORT_TEMPERATURE, SUPPORT_MAX_TOKENS, MAX_HISTORY_MESSAGES } = require('./constants');
const { isRecoverableAiError } = require('../openaiClient');
const { retrieveSupportContext } = require('./retrieval');

/**
 * @param {number} telegramId
 * @param {string} userMessage
 * @returns {Promise<{ text: string, source: string }>}
 */
async function generateSupportReply(telegramId, userMessage) {
  const sanitized = sanitizeUserInput(userMessage);

  if (!sanitized) {
    return { text: getFallback('default'), source: 'fallback' };
  }

  if (detectInjection(sanitized)) {
    return { text: blockInjectionResponse().text, source: 'guard_injection' };
  }

  if (detectOffTopic(sanitized)) {
    return { text: getFallback('off_topic'), source: 'guard_off_topic' };
  }

  const quickFaq = matchQuickFaq(sanitized);
  if (quickFaq) {
    return { text: quickFaq, source: 'fallback_faq' };
  }

  const client = getSupportLlmClient();
  if (!client) {
    return { text: getFallback('no_llm'), source: 'fallback' };
  }

  const history = store.getSupportHistory(telegramId);
  let retrieval;
  try {
    retrieval = await retrieveSupportContext(sanitized);
  } catch (err) {
    console.error('Support retrieval error:', err.message);
    retrieval = { chunks: [], contextText: '', available: false };
  }

  if (retrieval.available && retrieval.chunks.length === 0) {
    const noContextText = (
      'Не могу честно ответить: в моей базе знаний сейчас нет релевантной информации по этому вопросу.\n\n'
      + 'Попробуй уточнить формулировку или открой /help с командами.'
    );
    store.appendSupportMessage(telegramId, 'user', sanitized, MAX_HISTORY_MESSAGES);
    store.appendSupportMessage(telegramId, 'assistant', noContextText, MAX_HISTORY_MESSAGES);
    return { text: noContextText, source: 'rag_no_context' };
  }

  const ragInstruction = retrieval.contextText
    ? `Ниже блок RAG_CONTEXT с фактами из базы знаний. Используй ТОЛЬКО эти факты по продукту.\nЕсли ответа нет в RAG_CONTEXT, честно скажи, что в базе знаний нет данных, и предложи /help.\n\nRAG_CONTEXT:\n${retrieval.contextText}`
    : '';

  const messages = [
    { role: 'system', content: getSupportSystemPrompt() },
    ...(ragInstruction ? [{ role: 'system', content: ragInstruction }] : []),
    ...history.map((item) => ({ role: item.role, content: item.content })),
    { role: 'user', content: sanitized },
  ];

  try {
    const response = await client.chat.completions.create({
      model: getSupportModel(),
      messages,
      temperature: SUPPORT_TEMPERATURE,
      max_tokens: SUPPORT_MAX_TOKENS,
    });

    let text = sanitizeAssistantOutput(response.choices[0]?.message?.content || '');

    if (!text || !passesOutputGuardrails(text)) {
      return { text: getFallback('output_blocked'), source: 'guard_output' };
    }

    if (detectInjection(text)) {
      return { text: getFallback('injection'), source: 'guard_output' };
    }

    store.appendSupportMessage(telegramId, 'user', sanitized, MAX_HISTORY_MESSAGES);
    store.appendSupportMessage(telegramId, 'assistant', text, MAX_HISTORY_MESSAGES);

    return { text, source: retrieval.contextText ? 'rag_llm' : 'llm' };
  } catch (err) {
    console.error('Support LLM error:', err.message);
    if (isRecoverableAiError(err)) {
      return { text: getFallback('no_llm'), source: 'fallback' };
    }
    return { text: getFallback('error'), source: 'fallback' };
  }
}

function resetSupportChat(telegramId) {
  store.clearSupportHistory(telegramId);
}

module.exports = {
  generateSupportReply,
  resetSupportChat,
};
