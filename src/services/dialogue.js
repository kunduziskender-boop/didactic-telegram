const config = require('../config');
const { getScenarioById } = require('../data/dialogueScenarios');
const { getEnglishLocalePrompt } = require('../data/englishLocale');

const DIALOGUE_TURNS = 4;

const DIALOGUE_SYSTEM_BASE = `You are an English speaking coach running a role-play dialogue in Telegram.

CRITICAL ROLE RULES:
- You play ONLY the bot role (e.g. barista, waiter, receptionist).
- The STUDENT plays the customer/guest/candidate.
- bot_reply_en = ONLY what YOUR character says next. NEVER the student's line.
- NEVER put "I would like..." in bot_reply_en if the student is the customer — that is the STUDENT's line.
- Example CORRECT: student says "I'd like a tea" → barista: "Sure! Hot or iced?"
- Example WRONG: barista: "I would like a tea, please."

FEEDBACK RULES:
- If the student answer fits the situation (even with small grammar mistakes) → feedback_ru praises, better_phrase = "".
- better_phrase = improved STUDENT line only when needed; empty string if answer was fine.
- Do NOT say student "repeated the question" or "didn't answer" if they clearly responded to the scene.
- Fluency over perfect grammar. Accept "I want coffee" as valid.

Return ONLY valid JSON:
{
  "feedback_ru": "string",
  "better_phrase": "string or empty",
  "bot_reply_en": "YOUR character's next line in English",
  "bot_reply_ru": "brief Russian translation of bot_reply_en",
  "hint_ru": "what student could say next (Russian)",
  "suggested_reply_en": "simple English phrase for student's NEXT turn after bot_reply_en (A1 = 4-8 words)",
  "suggested_reply_ru": "Russian translation of suggested_reply_en",
  "is_final": false,
  "student_ok": true
}

suggested_reply_en/ru = ready-to-copy line for the student on the NEXT turn. Keep it short and level-appropriate.

On the LAST turn: is_final=true, bot_reply_en closes the scene politely in character. suggested_reply_en may be empty.`;

function getDialogueSystemPrompt() {
  return `${DIALOGUE_SYSTEM_BASE}\n\n${getEnglishLocalePrompt(config.englishVariant)}`;
}

function getLlmClient() {
  if (config.openaiLlmEnabled) {
    return require('./openaiClient').getOpenAIClient();
  }
  if (config.deepseekLlmEnabled) {
    const OpenAI = require('openai');
    return new OpenAI({
      apiKey: config.deepseekApiKey,
      baseURL: config.deepseekBaseUrl,
    });
  }
  return null;
}

function getModel() {
  if (config.openaiLlmEnabled) return config.llmModel;
  if (config.deepseekLlmEnabled) return 'deepseek-chat';
  return config.llmModel;
}

async function callDialogueJson(userContent) {
  const client = getLlmClient();
  if (!client) return null;

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await client.chat.completions.create({
        model: getModel(),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: getDialogueSystemPrompt() },
          { role: 'user', content: userContent },
        ],
        temperature: 0.2,
        max_tokens: 450,
      });
      return JSON.parse(response.choices[0]?.message?.content || '{}');
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function formatScenarioIntro(scenario) {
  return (
    `🎭 **${scenario.titleRu}** · Guided Talk\n\n`
    + `📍 ${scenario.settingRu}\n\n`
    + `👤 Ты: **${scenario.userRole}**\n`
    + `🤖 Собеседник: **${scenario.botRole}**\n\n`
    + `🇬🇧 **${scenario.botRole}:** ${scenario.openingEn}\n`
    + `🇷🇺 _${scenario.openingRu}_\n\n`
    + `Ниже — **готовая фраза**: скопируй, отправь или скажи вслух.\n`
    + `Диалог — **${DIALOGUE_TURNS} реплики**. Ошибки — нормально.`
  );
}

function formatGuidedSuggestion(en, ru) {
  if (!en?.trim()) return '';
  return (
    '🗣 **Скажи так:**\n\n'
    + `🇬🇧 ${en.trim()}\n`
    + (ru?.trim() ? `🇷🇺 _${ru.trim()}_\n\n` : '\n')
    + 'Скопируй и отправь — или скажи похожими словами.'
  );
}

function getOpeningSuggestion(scenario) {
  return {
    suggestedReplyEn: scenario.firstReplyEn || "I'd like ..., please.",
    suggestedReplyRu: scenario.firstReplyRu || 'Скажи простую фразу по ситуации.',
  };
}

function fallbackSuggestedReply(scenario, turnIndex) {
  const lines = {
    cafe_order: [
      'Hot, please.',
      'Can I pay by card?',
      'No, that\'s all. Thank you!',
    ],
    restaurant_dinner: [
      'By the window, if possible.',
      'Could we see the menu, please?',
      'I\'ll have the soup, please.',
    ],
    hotel_checkin: [
      'My name is Alex Smith.',
      'Yes, here is my passport.',
      'Thank you very much.',
    ],
  };
  const pool = lines[scenario.id] || [
    'Yes, please.',
    'That sounds good.',
    'Thank you!',
  ];
  const en = pool[Math.min(Math.max(turnIndex - 1, 0), pool.length - 1)];
  return { suggestedReplyEn: en, suggestedReplyRu: 'Продолжи диалог простой фразой.' };
}

const CYRILLIC_RE = /[\u0400-\u04FF]/;

function isDialogueHelpRequest(text) {
  const t = (text || '').trim();
  if (!t) return false;
  return /(?:подскаж|как (?:сказать|спросить|ответить|на англий)|что (?:сказать|ответить|написать)|не понима|не знаю что|help me|how do i say|what should i say)/i.test(t);
}

function isRussianMetaMessage(text) {
  const t = (text || '').trim();
  if (!CYRILLIC_RE.test(t)) return false;
  return isDialogueHelpRequest(t) || /^(?:а |ну )?(?:слушай|скажи|объясни|помоги)\b/i.test(t);
}

/** Russian or unrelated question during role-play — not a scene reply. */
function isDialogueOffTopicMessage(text) {
  const t = (text || '').trim();
  if (!t || isDialogueHelpRequest(t)) return false;

  const latinWords = (t.match(/\b[a-z]{2,}\b/gi) || []).length;
  const cyrillicWords = (t.match(/[\u0400-\u04FF]+/g) || []).length;

  // Mostly English — treat as attempt to speak in scene (LLM handles relevance)
  if (latinWords >= 2 && cyrillicWords === 0) return false;

  const isQuestion = /\?/.test(t)
    || /^(?:кто|что|где|когда|почему|зачем|сколько|какой|какая|какие|как)\b/i.test(t);

  const unrelatedRu = /(?:тестир|сайт|бот|ассистент|chatgpt|программ|код|погод|курс|рецепт|политик|зарплат|сколько\s+стоит)/i.test(t);
  const toBotRu = /(?:^|\s)(?:ты|вы|у\s+тебя)\b/i.test(t);

  if (isQuestion && (unrelatedRu || toBotRu) && cyrillicWords > 0) return true;

  if (CYRILLIC_RE.test(t) && isQuestion && !looksLikeRolePlayIntentRu(t)) return true;

  return false;
}

function looksLikeRolePlayIntentRu(text) {
  return /(?:ищу|хочу|нужен|размер|мне\s+надо|можно|есть\s+ли|сколько\s+стоит\s+(?:это|размер|футболк|плать))/i.test(text);
}

function buildDialogueOffTopicResponse(scenario, session) {
  const en = session?.suggestedReplyEn || scenario.firstReplyEn || 'I would like …, please.';
  const ru = session?.suggestedReplyRu || scenario.firstReplyRu || '';

  return (
    '⚠️ **Вопрос не по теме диалога.**\n\n'
    + `Сейчас сценарий **${scenario.titleRu}** — отвечай **репликой на английском**, как в этой ситуации.\n\n`
    + '• Вопросы о боте, работе, IT — **после** диалога (заверши 🛑 или /reset → напиши в чат).\n'
    + '• Подсказка по фразе — кнопка **💡 Подсказка** или «подскажи как сказать».\n\n'
    + `🗣 **По сцене скажи:**\n🇬🇧 ${en}`
    + (ru ? `\n🇷🇺 _${ru}_` : '')
  );
}

function buildDialogueHelpResponse(scenario, history) {
  const lastBotLine = [...(history || [])].reverse().find((h) => h.role === 'bot')?.text || scenario.openingEn;

  const scenarioHints = {
    cafe_order: {
      en: "I'd like a cappuccino, please.",
      ru: 'Я бы хотел(а) капучино, пожалуйста.',
      alt: 'Can I have a latte to go?',
    },
    restaurant_dinner: {
      en: 'Could we have a table for two, please?',
      ru: 'Нам столик на двоих, пожалуйста.',
      alt: "I'd like to order the soup, please.",
    },
    hotel_checkin: {
      en: 'Yes, I have a reservation under Ivan Petrov.',
      ru: 'Да, у меня бронь на имя Иван Петров.',
      alt: 'I booked a double room for two nights.',
    },
    airport_gate: {
      en: 'Excuse me, is this the gate for flight BA123?',
      ru: 'Извините, это выход на рейс BA123?',
      alt: 'Could you tell me if the flight is on time?',
    },
    job_interview: {
      en: "I'm a software developer with three years of experience.",
      ru: 'Я разработчик с тремя годами опыта.',
      alt: "I'm passionate about building reliable products.",
    },
  };

  const hint = scenarioHints[scenario.id] || {
    en: 'I would like …, please.',
    ru: 'Скажи простую фразу: I would like …, please.',
    alt: 'Could you help me with …, please?',
  };

  return (
    '💡 **Подсказка для сцены** (это не засчитывается как реплика)\n\n'
    + `Собеседник сказал: _${lastBotLine}_\n\n`
    + `🇬🇧 **Пример:** ${hint.en}\n`
    + `🇷🇺 _${hint.ru}_\n`
    + (hint.alt ? `\n🔄 **Ещё вариант:** ${hint.alt}\n` : '')
    + '\nОтветь **на английском** — диалог продолжится.'
  );
}

function looksLikeValidStudentReply(userMessage, scenarioId) {
  const t = userMessage.trim().toLowerCase();
  if (t.length < 2) return false;
  if (isDialogueHelpRequest(t) || isRussianMetaMessage(t) || isDialogueOffTopicMessage(t)) return false;
  if (CYRILLIC_RE.test(t) && !/\b[a-z]{2,}\b/i.test(t)) return false;
  if (scenarioId === 'cafe_order' || scenarioId === 'restaurant_dinner') {
    return /\b(like|want|order|please|coffee|tea|latte|cappuccino|water|juice|milk|size|hot|iced|for here|to go|card|cash|thank)\b/i.test(t);
  }
  if (scenarioId === 'hotel_checkin') {
    return /\b(yes|no|reservation|book|name|night|room|check)\b/i.test(t);
  }
  return t.split(/\s+/).length >= 2;
}

const NEGATIVE_FEEDBACK_RE = /но |ошиб|повтор|не ответ|не по тем|нужно ответ|wrong|incorrect/i;

function fallbackBotReply(scenario, turnIndex, userMessage) {
  const fallbacks = {
    cafe_order: [
      'Lovely! Would you like that hot or iced?',
      'Sure! Anything else for you today?',
      'Perfect. That\'ll be four pounds. Cash or card?',
      'Thank you! Here you are. Enjoy!',
    ],
    restaurant_dinner: [
      'Of course! Would you prefer a table by the window?',
      'Excellent. Can I bring you some water while you decide?',
      'Wonderful choice. Anything to drink?',
      'Thank you! Enjoy your meal.',
    ],
    hotel_checkin: [
      'Perfect. May I have your name, please?',
      'Thank you. Could I see your ID, please?',
      'Your room is ready on the third floor.',
      'Have a pleasant stay!',
    ],
  };
  const lines = fallbacks[scenario.id] || [
    'I understand. Please tell me more.',
    'That sounds good. What else?',
    'Thank you for sharing.',
    'Great talking with you!',
  ];
  return lines[Math.min(turnIndex - 1, lines.length - 1)];
}

function botReplyLooksLikeStudentLine(botReply, userMessage) {
  const bot = botReply.trim().toLowerCase();
  const user = userMessage.trim().toLowerCase();
  if (!bot || !user) return false;
  if (bot === user) return true;
  if (/\bi('d| would) like\b/i.test(bot) && /\b(like|want|order)\b/i.test(user)) return true;
  if (bot.startsWith(user.slice(0, Math.min(user.length, 25)))) return true;
  return false;
}

function sanitizeDialogueTurn(result, scenario, userMessage, turnIndex) {
  const studentOk = result.studentOk
    || looksLikeValidStudentReply(userMessage, scenario.id);

  if (studentOk) {
    if (NEGATIVE_FEEDBACK_RE.test(result.feedbackRu || '')) {
      result.feedbackRu = 'Отлично — ответ по ситуации!';
    }
    if (result.betterPhrase && result.betterPhrase.trim().toLowerCase() === userMessage.trim().toLowerCase()) {
      result.betterPhrase = '';
    }
    if (!result.betterPhrase && looksLikeValidStudentReply(userMessage, scenario.id)) {
      result.betterPhrase = '';
    }
  }

  if (botReplyLooksLikeStudentLine(result.botReplyEn, userMessage)) {
    result.botReplyEn = fallbackBotReply(scenario, turnIndex, userMessage);
    result.botReplyRu = 'Собеседник отвечает по роли.';
    result.feedbackRu = studentOk ? 'Хороший ответ!' : result.feedbackRu;
    result.betterPhrase = '';
  }

  return result;
}

function demoTurn(scenario, userMessage, turnIndex) {
  const isFinal = turnIndex >= DIALOGUE_TURNS;
  const next = isFinal ? {} : fallbackSuggestedReply(scenario, turnIndex + 1);
  return {
    feedbackRu: 'Хорошо! Продолжаем диалог.',
    betterPhrase: '',
    botReplyEn: isFinal
      ? 'Great talking with you! Have a wonderful day.'
      : 'I see. And what else would you like to add?',
    botReplyRu: isFinal ? 'Завершение разговора.' : 'Собеседник ждёт продолжения.',
    hintRu: 'Скажи, что тебе нужно, простыми словами.',
    suggestedReplyEn: next.suggestedReplyEn || '',
    suggestedReplyRu: next.suggestedReplyRu || '',
    isFinal,
    demo: true,
  };
}

/**
 * @param {object} scenario
 * @param {Array<{role:string,text:string}>} history
 * @param {string} userMessage
 * @param {string} level
 * @param {number} turnIndex 1-based
 */
async function processDialogueTurn(scenario, history, userMessage, level, turnIndex) {
  const isLastTurn = turnIndex >= DIALOGUE_TURNS;
  const historyText = history
    .map((h) => `${h.role}: ${h.text}`)
    .join('\n');

  const userContent = [
    `Level: ${level}`,
    `Scenario: ${scenario.titleRu}`,
    `Setting: ${scenario.settingRu}`,
    `Student role: ${scenario.userRole}`,
    `Your role: ${scenario.botRole}`,
    `Turn: ${turnIndex} of ${DIALOGUE_TURNS}${isLastTurn ? ' (FINAL — wrap up)' : ''}`,
    '',
    'Dialogue so far:',
    historyText || '(start)',
    '',
    `Student just said: ${userMessage}`,
    '',
    'If student answer fits the scene, set student_ok=true, better_phrase="", praise in feedback_ru.',
    'bot_reply_en must be spoken by YOUR character only, never copy student words.',
  ].join('\n');

  try {
    const raw = await callDialogueJson(userContent);
    if (!raw) return demoTurn(scenario, userMessage, turnIndex);
    let result = {
      feedbackRu: raw.feedback_ru || 'Хорошо!',
      betterPhrase: raw.better_phrase || raw.betterPhrase || '',
      botReplyEn: raw.bot_reply_en || raw.botReplyEn || fallbackBotReply(scenario, turnIndex, userMessage),
      botReplyRu: raw.bot_reply_ru || raw.botReplyRu || '',
      hintRu: raw.hint_ru || raw.hintRu || '',
      suggestedReplyEn: raw.suggested_reply_en || raw.suggestedReplyEn || '',
      suggestedReplyRu: raw.suggested_reply_ru || raw.suggestedReplyRu || '',
      isFinal: Boolean(raw.is_final || raw.isFinal || isLastTurn),
      studentOk: Boolean(raw.student_ok || raw.studentOk),
      demo: false,
    };
    if (!result.isFinal && !result.suggestedReplyEn?.trim()) {
      const fb = fallbackSuggestedReply(scenario, turnIndex + 1);
      result.suggestedReplyEn = fb.suggestedReplyEn;
      result.suggestedReplyRu = fb.suggestedReplyRu;
    }
    result = sanitizeDialogueTurn(result, scenario, userMessage, turnIndex);
    return result;
  } catch (err) {
    console.error('Dialogue LLM error:', err.message);
    return { ...demoTurn(scenario, userMessage, turnIndex), demo: true };
  }
}

function formatTurnFeedback(result, scenario) {
  const lines = [];
  if (result.heardText) {
    lines.push(`📝 **Я услышал:** ${result.heardText}`, '');
  }
  lines.push(`💬 **${result.feedbackRu}**`);
  if (result.betterPhrase?.trim()) {
    lines.push('', `✏️ Естественнее: ${result.betterPhrase}`);
  }
  lines.push(
    '',
    `🤖 **${scenario.botRole}:** ${result.botReplyEn}`,
  );
  if (result.botReplyRu) {
    lines.push(`🇷🇺 _${result.botReplyRu}_`);
  }
  if (!result.isFinal && result.hintRu) {
    lines.push('', `💡 Идея: ${result.hintRu}`);
  }
  return lines.join('\n');
}

function formatDialogueSummary(scenario, history) {
  const userLines = history.filter((h) => h.role === 'user').map((h) => h.text);
  return (
    `🎉 **Диалог завершён!**\n\n`
    + `Сценарий: ${scenario.titleRu}\n`
    + `Ты сделал(а) ${userLines.length} реплик — отличная практика!\n\n`
    + '🔄 Новый диалог: /talk\n'
    + '📝 Классический drill: /drill'
  );
}

module.exports = {
  DIALOGUE_TURNS,
  formatScenarioIntro,
  formatGuidedSuggestion,
  getOpeningSuggestion,
  processDialogueTurn,
  formatTurnFeedback,
  formatDialogueSummary,
  getScenarioById,
  isDialogueHelpRequest,
  isDialogueOffTopicMessage,
  buildDialogueHelpResponse,
  buildDialogueOffTopicResponse,
};
