const store = require('../store');
const {
  formatCardQuestion,
  formatCardAnswer,
  formatVocabStats,
  importFromRecentDrills,
  importFromSession,
} = require('../services/vocab');
const { vocabQuestionKeyboard, vocabAnswerKeyboard } = require('../keyboards');

const REVIEW_BATCH = 5;

async function ensureUser(ctx) {
  const user = store.getUser(ctx.from.id);
  if (!user?.onboardingCompleted) {
    await ctx.reply('Сначала пройди онбординг: /start');
    return null;
  }
  return user;
}

async function startReview(ctx, { announce = true } = {}) {
  const telegramId = ctx.from.id;
  let dueCards = store.getDueVocabCards(telegramId, REVIEW_BATCH);

  if (!dueCards.length) {
    const imported = importFromRecentDrills(telegramId);
    if (imported > 0) {
      dueCards = store.getDueVocabCards(telegramId, REVIEW_BATCH);
    }
  }

  if (!dueCards.length) {
    const stats = store.getVocabStats(telegramId);
    if (stats.total === 0) {
      await ctx.reply(
        '📖 Словарь пока пуст.\n\n'
        + 'Пройди /drill — после задания бот сохранит полезные фразы **в контексте**.\n'
        + 'Или посмотри уже сохранённые: /phrases',
      );
      return;
    }

    await ctx.reply(
      `${formatVocabStats(stats)}\n\n`
      + '✨ На сегодня повторений нет — отлично!\n'
      + 'Новые слова появятся после следующего /drill.',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  store.startVocabReview(telegramId, dueCards.map((c) => c.id));

  if (announce) {
    await ctx.reply(
      `🧠 **Повторение слов в контексте** · ${dueCards.length} карточек\n\n`
      + 'Сначала вспомни значение, потом оцени, насколько легко было.',
      { parse_mode: 'Markdown' },
    );
  }

  await showCurrentCard(ctx);
}

async function showCurrentCard(ctx) {
  const telegramId = ctx.from.id;
  const review = store.getVocabReviewSession(telegramId);
  if (!review) return;

  const card = store.getVocabCardById(review.currentCardId);
  if (!card) {
    store.clearVocabReviewSession(telegramId);
    await ctx.reply('Сессия повторения завершена.');
    return;
  }

  await ctx.reply(
    formatCardQuestion(card, review.currentIndex + 1, review.total),
    { parse_mode: 'Markdown', ...vocabQuestionKeyboard() },
  );
}

async function handleWordsCommand(ctx) {
  if (!(await ensureUser(ctx))) return;
  await startReview(ctx);
}

async function handleWordsStats(ctx) {
  if (!(await ensureUser(ctx))) return;
  const stats = store.getVocabStats(ctx.from.id);
  await ctx.reply(formatVocabStats(stats), { parse_mode: 'Markdown' });
}

async function handleVocabCallback(ctx) {
  const telegramId = ctx.from.id;
  const data = ctx.callbackQuery.data;

  if (!(await ensureUser(ctx))) {
    await ctx.answerCbQuery();
    return;
  }

  if (data === 'vocab:stop') {
    store.clearVocabReviewSession(telegramId);
    await ctx.answerCbQuery('Повторение остановлено');
    await ctx.reply('Ок, остановили. Вернуться: /words');
    return;
  }

  const review = store.getVocabReviewSession(telegramId);
  if (!review) {
    await ctx.answerCbQuery('Сессия не найдена');
    await ctx.reply('Начни заново: /words');
    return;
  }

  const card = store.getVocabCardById(review.currentCardId);
  if (!card) {
    store.clearVocabReviewSession(telegramId);
    await ctx.answerCbQuery();
    await ctx.reply('Карточки закончились.');
    return;
  }

  if (data === 'vocab:show') {
    await ctx.answerCbQuery();
    await ctx.reply(
      formatCardAnswer(card),
      { parse_mode: 'Markdown', ...vocabAnswerKeyboard() },
    );
    return;
  }

  if (data === 'vocab:skip') {
    await ctx.answerCbQuery('Пропущено');
    await advanceReview(ctx, card, 1);
    return;
  }

  const rateMatch = data.match(/^vocab:rate:(\d)$/);
  if (rateMatch) {
    const rating = Number(rateMatch[1]);
    await ctx.answerCbQuery(rating === 0 ? 'Повторим ещё раз' : 'Записано');
    await advanceReview(ctx, card, rating);
  }
}

async function advanceReview(ctx, card, rating) {
  const telegramId = ctx.from.id;
  store.reviewVocabCard(card.id, rating);

  const next = store.advanceVocabReview(telegramId);
  if (!next) {
    const stats = store.getVocabStats(telegramId);
    await ctx.reply(
      `🎉 **Повторение завершено!**\n\n`
      + `Закреплено слов: ${stats.mastered}\n`
      + `Следующая сессия — когда карточки «созреют».\n\n`
      + 'Команда: /words',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const nextCard = store.getVocabCardById(next.currentCardId);
  if (!nextCard) {
    store.clearVocabReviewSession(telegramId);
    await ctx.reply('Повторение завершено. /words');
    return;
  }

  await ctx.reply(
    formatCardQuestion(nextCard, next.currentIndex + 1, next.total),
    { parse_mode: 'Markdown', ...vocabQuestionKeyboard() },
  );
}

function autoSaveFromDrill(telegramId, session) {
  const added = importFromSession(telegramId, session);
  return added;
}

module.exports = {
  handleWordsCommand,
  handleWordsStats,
  handleVocabCallback,
  autoSaveFromDrill,
  startReview,
};
