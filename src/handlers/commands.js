const store = require('../store');
const config = require('../config');
const { getEnglishLocaleLabel } = require('../data/englishLocale');
const { generateWeeklyExercise } = require('../services/llm');
const { withTyping } = require('../services/typing');

async function handleStats(ctx) {
  const telegramId = ctx.from.id;
  const user = store.getUser(telegramId);

  if (!user?.onboardingCompleted) {
    await ctx.reply('Сначала пройди онбординг: /start');
    return;
  }

  const streak = store.getStreak(telegramId);
  const errorCount = store.countErrors(telegramId);
  const completed = store.countCompletedSessions(telegramId);
  const vocab = store.getVocabStats(telegramId);
  const phrases = store.getRecentPhrases(telegramId, 3);
  const session = store.getTodaySession(telegramId);

  const statusLabels = {
    pending: 'ожидает',
    in_progress: 'в процессе',
    processing: 'обрабатывается',
    completed: 'выполнено',
    skipped: 'пропущено',
  };

  const phraseLine = phrases.length
    ? phrases.map((p) => `• "${p.en}"`).join('\n')
    : 'пока нет — пройди drill';

  await ctx.reply(
    `📊 **Статистика**\n\n`
    + `Уровень: ${user.level}\n`
    + `Тема: ${user.topic}\n`
    + `🔥 Стрик: ${streak?.currentStreak ?? 0} (рекорд: ${streak?.longestStreak ?? 0})\n`
    + `🗣 Диалогов завершено: ${completed}\n`
    + `📖 Слов в контексте: ${vocab.total} (на повтор: ${vocab.due})\n`
    + `📝 Ошибок записано: ${errorCount}\n`
    + `📅 Сегодня: ${session ? statusLabels[session.status] || session.status : 'нет сессии'}\n\n`
    + `💬 Последние фразы:\n${phraseLine}`,
    { parse_mode: 'Markdown' },
  );
}

async function handleHelp(ctx) {
  await ctx.reply(
    '📖 **Daily Speaking Drill Bot**\n\n'
    + `🇬🇧 Язык: **${getEnglishLocaleLabel(config.englishVariant)}** (UK spelling & vocabulary)\n\n`
    + '**Сценарии:**\n'
    + '• Prepare → Speak — подсказки перед записью\n'
    + '• Daily Drill — голосовое задание → ваш ответ → fluency feedback\n'
    + '• Mini-dialogue — follow-up вопрос для живого разговора\n'
    + '• Role-play — /talk (диалог по готовой ситуации, 4 реплики)\n'
    + '• Shadow Practice — повторение за ботом\n'
    + '• Phrase bank — /phrases\n'
    + '• Context Words — /words (слова в контексте + интервальное повторение)\n'
    + '• Weekly Error Review — по воскресеньям\n'
    + '• Напоминание в 20:00 если задание не сделано\n\n'
    + '**Команды** (кнопка «/» в чате):\n'
    + '/start — онбординг / главное меню\n'
    + '/level — сменить уровень и тему\n'
    + '/drill — получить задание\n'
    + '/talk — role-play диалог (ситуация → беседа)\n'
    + '/phrases — фразы из прошлых drill\n'
    + '/words — повторить слова в контексте (SRS)\n'
    + '/stats — стрик и статистика\n'
    + '/weekly — еженедельный обзор ошибок\n'
    + '/help — эта справка\n\n'
    + '**Кнопки в задании:**\n'
    + '✅ Готов — подсказки и запись голосового\n'
    + '✍️ Или напиши ответ текстом — для честной проверки\n'
    + '🎧 Shadow — повторить исправленную фразу\n'
    + '⏭ Пропустить follow-up — завершить диалог\n'
    + '⏭ Пропустить — пропустить задание',
    { parse_mode: 'Markdown' },
  );
}

async function handlePhrases(ctx) {
  const telegramId = ctx.from.id;
  const user = store.getUser(telegramId);
  if (!user?.onboardingCompleted) {
    await ctx.reply('Сначала пройди онбординг: /start');
    return;
  }

  const phrases = store.getRecentPhrases(telegramId, 12);
  if (!phrases.length) {
    await ctx.reply(
      '📚 Phrase bank пуст.\n\n'
      + 'Пройди /drill — после каждого задания бот сохранит полезные фразы.',
    );
    return;
  }

  const lines = phrases.map((p, i) => {
    const ru = p.ru ? ` — ${p.ru}` : '';
    return `${i + 1}. "${p.en}"${ru}`;
  });

  await ctx.reply(
    `📚 **Phrase bank** (из твоих drill)\n\n${lines.join('\n')}\n\n`
    + '🎤 Повтори 2–3 фразы вслух — так они останутся в речи.',
    { parse_mode: 'Markdown' },
  );
}

async function handleWeeklyTest(ctx) {
  const telegramId = ctx.from.id;
  const user = store.getUser(telegramId);
  if (!user?.onboardingCompleted) {
    await ctx.reply('Сначала пройди онбординг: /start');
    return;
  }

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);

  const errors = store.getErrorsSince(telegramId, weekStart);
  const counts = {};
  for (const e of errors) {
    counts[e.ruleTag] = (counts[e.ruleTag] || 0) + 1;
  }

  const topErrors = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([rule_tag, count]) => ({ rule_tag, count }));

  if (topErrors.length === 0) {
    await ctx.reply('📅 Weekly Error Review\n\nЗа неделю ошибок не зафиксировано. Так держать!');
    return;
  }

  const { summary, miniExercise } = await withTyping(
    ctx.telegram,
    ctx.chat.id,
    () => generateWeeklyExercise(topErrors),
  );
  store.saveWeeklyReview(telegramId, { weekStart: weekStart.toISOString().slice(0, 10), topErrors, miniExercise });

  await ctx.reply(
    `📅 **Weekly Error Review**\n\n${summary || topErrors.map((e) => `• ${e.rule_tag}: ${e.count}x`).join('\n')}\n\n`
    + `📝 **Мини-упражнение:**\n${miniExercise || '—'}`,
    { parse_mode: 'Markdown' },
  );
}

module.exports = { handleStats, handleHelp, handleWeeklyTest, handlePhrases };
