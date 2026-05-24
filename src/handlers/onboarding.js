const store = require('../store');
const { setState, OnboardingStates, DrillStates } = require('../fsm/manager');
const { levelKeyboard, topicKeyboard } = require('../keyboards');

async function handleStart(ctx) {
  const telegramId = ctx.from.id;
  store.ensureUser(telegramId);
  const user = store.getUser(telegramId);

  if (user.onboardingCompleted) {
    setState(telegramId, DrillStates.IDLE);
    await ctx.reply(
      'С возвращением! 👋\n\n'
      + 'Команды:\n'
      + '/drill — получить сегодняшнее задание\n'
      + '/talk — role-play диалог по ситуации\n'
      + '/level — сменить уровень и тему\n'
      + '/stats — стрик и статистика\n'
      + '/help — справка',
    );
    return;
  }

  await promptLevelSelection(ctx, telegramId, 'Привет! Я помогу тебе практиковать разговорный **британский английский** каждый день.');
}

async function handleChangeLevel(ctx) {
  const telegramId = ctx.from.id;
  store.ensureUser(telegramId);
  const user = store.getUser(telegramId);

  const intro = user.onboardingCompleted && user.level
    ? `Сейчас: **${user.level}**, тема **${formatTopic(user.topic)}**.\n\nВыбери новый уровень:`
    : 'Выбери свой уровень:';

  await promptLevelSelection(ctx, telegramId, intro);
}

async function promptLevelSelection(ctx, telegramId, intro) {
  setState(telegramId, OnboardingStates.LEVEL);
  await ctx.reply(intro, { parse_mode: 'Markdown', ...levelKeyboard() });
}

function formatTopic(topicId) {
  const { TOPICS } = require('../data/constants');
  return TOPICS.find((t) => t.id === topicId)?.label || topicId || '—';
}

async function handleLevelCallback(ctx) {
  const telegramId = ctx.from.id;
  const level = ctx.callbackQuery.data.replace('lvl:', '');

  store.updateUser(telegramId, { level });
  setState(telegramId, OnboardingStates.TOPIC);
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `Уровень: ${level}\n\nВыбери предпочтительную тему:`,
    topicKeyboard(),
  );
}

async function handleTopicCallback(ctx) {
  const telegramId = ctx.from.id;
  const topic = ctx.callbackQuery.data.replace('top:', '');
  const userBefore = store.getUser(telegramId);
  const isSettingsUpdate = Boolean(userBefore?.onboardingCompleted);

  store.updateUser(telegramId, { topic, onboardingCompleted: true });
  setState(telegramId, DrillStates.IDLE);
  await ctx.answerCbQuery();

  const user = store.getUser(telegramId);
  const topicLabel = formatTopic(topic);

  const text = isSettingsUpdate
    ? `✅ Обновлено!\n\nУровень: **${user.level}**\nТема: **${topicLabel}**\n\n`
      + 'Нажми /drill чтобы получить задание под новый уровень.'
    : `Отлично! Уровень: ${user.level}, тема: ${topicLabel}.\n\n`
      + 'Каждый день я буду присылать голосовое задание.\n'
      + 'Нажми /drill чтобы получить первое задание прямо сейчас.';

  await ctx.editMessageText(text, { parse_mode: 'Markdown' });
}

module.exports = {
  handleStart,
  handleChangeLevel,
  handleLevelCallback,
  handleTopicCallback,
};
