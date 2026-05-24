const store = require('../store');

const STOP_WORDS = new Set([
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'the', 'a', 'an', 'to', 'at', 'in', 'on',
  'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'my', 'your', 'his',
  'her', 'our', 'their', 'this', 'that', 'and', 'or', 'but', 'so', 'if', 'when', 'what',
  'how', 'usually', 'often', 'really', 'very', 'just', 'also', 'then', 'after', 'before',
]);

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractFocusWord(phrase) {
  const cleaned = phrase.replace(/\.{2,}$/, '').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  const content = words.filter((w) => {
    const bare = w.replace(/[^\w'-]/g, '').toLowerCase();
    return bare.length > 2 && !STOP_WORDS.has(bare);
  });
  if (content.length >= 2) return content.slice(0, 2).join(' ');
  if (content.length === 1) return content[0];
  return words[0] || cleaned;
}

function blankWord(context, word) {
  if (!context || !word) return context;
  const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
  if (!re.test(context)) return context.replace(/\.\.\.$/, ' ______');
  return context.replace(re, '______');
}

function scheduleNextReview(card, rating) {
  const now = new Date();
  let repetitions = card.repetitions || 0;
  let intervalDays = card.interval_days || 1;
  let lapses = card.lapses || 0;

  if (rating === 0) {
    repetitions = 0;
    intervalDays = 1;
    lapses += 1;
  } else if (repetitions === 0) {
    repetitions = 1;
    intervalDays = 1;
  } else if (repetitions === 1) {
    repetitions = 2;
    intervalDays = rating === 1 ? 2 : 3;
  } else {
    repetitions += 1;
    const factor = rating === 1 ? 1.3 : 2.0;
    intervalDays = Math.min(Math.max(Math.round(intervalDays * factor), 2), 180);
  }

  const nextReviewAt = new Date(now);
  nextReviewAt.setDate(nextReviewAt.getDate() + intervalDays);

  let status = 'learning';
  if (repetitions >= 5 && intervalDays >= 14) status = 'mastered';
  else if (repetitions >= 2) status = 'reviewing';

  return {
    repetitions,
    interval_days: intervalDays,
    lapses,
    next_review_at: nextReviewAt.toISOString(),
    last_reviewed_at: now.toISOString(),
    status,
  };
}

function phraseToCard(phrase, sessionId = null) {
  const en = typeof phrase === 'string' ? phrase : phrase?.en;
  const ru = typeof phrase === 'object' ? phrase?.ru : null;
  if (!en?.trim()) return null;

  const contextEn = en.trim();
  const word = extractFocusWord(contextEn);
  return {
    word,
    contextEn,
    contextRu: ru || null,
    translationRu: ru || null,
    source: 'drill',
    sessionId,
  };
}

function importPhrases(telegramId, phrases, sessionId = null) {
  let added = 0;
  for (const phrase of phrases || []) {
    const card = phraseToCard(phrase, sessionId);
    if (!card) continue;
    if (store.addVocabCard(telegramId, card)) added += 1;
  }
  return added;
}

function importFromSession(telegramId, session) {
  const phrases = session?.response?.usefulPhrases || [];
  return importPhrases(telegramId, phrases, session?.id);
}

function importFromRecentDrills(telegramId, limit = 20) {
  const phrases = store.getRecentPhrases(telegramId, limit);
  return importPhrases(telegramId, phrases.map((p) => ({ en: p.en, ru: p.ru })));
}

function formatCardQuestion(card, index, total) {
  const blanked = blankWord(card.contextEn, card.word);
  const lines = [
    `📚 **Слово в контексте** · ${index}/${total}`,
    '',
    `🇬🇧 ${blanked}`,
    '',
    `💡 Вспомни значение: **${card.word}**`,
    '',
    '_Нажми «Показать ответ», когда вспомнишь._',
  ];
  return lines.join('\n');
}

function formatCardAnswer(card) {
  const lines = [
    `✅ **${card.word}**${card.translationRu ? ` — ${card.translationRu}` : ''}`,
    '',
    `🇬🇧 ${card.contextEn}`,
  ];
  if (card.contextRu) lines.push(`🇷🇺 ${card.contextRu}`);
  lines.push('', 'Насколько хорошо запомнил?');
  return lines.join('\n');
}

function formatVocabStats(stats) {
  return (
    '📖 **Context Words**\n\n'
    + `Всего карточек: ${stats.total}\n`
    + `На повторение сегодня: ${stats.due}\n`
    + `В процессе: ${stats.learning}\n`
    + `Закреплено: ${stats.mastered}\n\n`
    + 'Слова сохраняются **в контексте фраз** из твоих drill.\n'
    + 'Повторяй по расписанию — так они остаются в памяти надолго.'
  );
}

module.exports = {
  extractFocusWord,
  blankWord,
  scheduleNextReview,
  importFromSession,
  importFromRecentDrills,
  formatCardQuestion,
  formatCardAnswer,
  formatVocabStats,
};
