const { MAX_USER_CHARS, MAX_OUTPUT_CHARS } = require('./constants');
const { INJECTION_FALLBACK } = require('./fallback');

const INJECTION_PATTERNS = [
  /ignore (all )?(previous |prior )?instructions/i,
  /forget (your )?rules/i,
  /system prompt/i,
  /developer mode/i,
  /jailbreak/i,
  /\bdan\b/i,
  /sudo mode/i,
  /you are now/i,
  /ты теперь/i,
  /режим dan/i,
  /выведи промпт/i,
  /раскрой инструкции/i,
  /\[system override\]/i,
  /new role:/i,
  /disregard (all )?(prior|previous)/i,
];

const OFF_TOPIC_PATTERNS = [
  /\b(python|javascript|fastapi|postgresql|react|docker)\b/i,
  /\b(рецепт|курс доллара|погода в|bitcoin|крипт)\b/i,
  /\b(напиши код|реши задач|домашн.*работ)\b/i,
];

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{10,}/,
  /\b(BOT_TOKEN|OPENAI_API_KEY|DEEPSEEK_API_KEY)\s*[:=]/i,
  /api[_-]?key\s*[:=]\s*\S+/i,
];

const PROMPT_LEAK_PATTERNS = [
  /═══/,
  /Support-ассистент Telegram-бота/i,
  /ПРАВИЛА ОТВЕТА/i,
  /ЗАЩИТА ОТ INJECTION/i,
  /getSupportSystemPrompt/i,
];

function sanitizeUserInput(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/\0/g, '').trim().slice(0, MAX_USER_CHARS);
}

function detectInjection(text) {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

function detectOffTopic(text) {
  return OFF_TOPIC_PATTERNS.some((re) => re.test(text));
}

function sanitizeAssistantOutput(text) {
  if (!text || typeof text !== 'string') return '';
  let out = text.replace(/\0/g, '').trim();

  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, '[скрыто]');
  }

  if (out.length > MAX_OUTPUT_CHARS) {
    out = `${out.slice(0, MAX_OUTPUT_CHARS - 1)}…`;
  }

  return out;
}

function passesOutputGuardrails(text) {
  if (!text?.trim()) return false;
  if (SECRET_PATTERNS.some((re) => re.test(text))) return false;
  if (PROMPT_LEAK_PATTERNS.some((re) => re.test(text))) return false;
  return true;
}

function blockInjectionResponse() {
  return {
    blocked: true,
    reason: 'injection',
    text: INJECTION_FALLBACK,
  };
}

function blockOffTopicResponse() {
  return {
    blocked: true,
    reason: 'off_topic',
    text: null,
  };
}

module.exports = {
  sanitizeUserInput,
  detectInjection,
  detectOffTopic,
  sanitizeAssistantOutput,
  passesOutputGuardrails,
  blockInjectionResponse,
  blockOffTopicResponse,
};
