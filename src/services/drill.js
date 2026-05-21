const store = require('../store');
const { setState, DrillStates } = require('../fsm/manager');
const { taskDeliveredKeyboard, reminderKeyboard, awaitingVoiceKeyboard } = require('../keyboards');
const { synthesizeTask } = require('./pipeline');
const { generatePrepareHints } = require('./llm');
const { formatPrepareHints } = require('./feedback');

/**
 * @param {import('telegraf').Telegram} telegram
 * @param {number} telegramId
 * @param {{ isReminder?: boolean, force?: boolean }} options
 */
async function sendDailyTask(telegram, telegramId, options = {}) {
  const fs = require('fs');
  const user = store.getUser(telegramId);
  if (!user?.onboardingCompleted) return false;

  let session = store.getTodaySession(telegramId);
  if (session && !options.force) {
    return false;
  }

  if (session && options.force) {
    store.deleteTodaySession(telegramId);
    session = null;
  }

  const task = store.selectTaskForUser(telegramId);
  if (!task) {
    await telegram.sendMessage(telegramId, 'Задания для вашего уровня временно недоступны.');
    return false;
  }

  session = store.createTodaySession(telegramId, task.id);
  store.updateTodaySession(telegramId, { status: 'pending', taskId: task.id });

  const intro = options.isReminder
    ? '🔔 Напоминание: сегодняшнее задание ещё не выполнено!\n\n'
    : '🎯 Daily Speaking Drill\n\n';

  const keyboard = options.isReminder ? reminderKeyboard() : taskDeliveredKeyboard();

  await telegram.sendMessage(
    telegramId,
    `${intro}📋 ${task.promptRu}\n\n🇬🇧 ${task.promptEn}`,
    keyboard,
  );

  try {
    const audioPath = await synthesizeTask(telegramId, task);
    if (audioPath && fs.existsSync(audioPath)) {
      await telegram.sendVoice(telegramId, { source: fs.createReadStream(audioPath) });
    } else {
      await telegram.sendMessage(telegramId, '🔊 (TTS недоступен — прочитай текст задания выше)');
    }
  } catch (err) {
    console.error('Task TTS error:', err.message);
    await telegram.sendMessage(telegramId, '🔊 (Не удалось озвучить задание — используй текст выше)');
  }

  setState(telegramId, DrillStates.TASK_DELIVERED);
  return true;
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {{ isReminder?: boolean, force?: boolean }} options
 */
async function deliverDailyTask(ctx, options = {}) {
  return sendDailyTask(ctx.telegram, ctx.from.id, options);
}

async function handleReady(ctx) {
  const telegramId = ctx.from.id;
  const user = store.getUser(telegramId);

  if (!user?.onboardingCompleted) {
    await ctx.answerCbQuery('Сначала /start');
    await ctx.reply('Сначала пройди онбординг: /start');
    return;
  }

  const session = store.getTodaySession(telegramId);
  if (!session) {
    await ctx.answerCbQuery('Сессия устарела');
    await ctx.reply(
      'Сессия задания не найдена (бот мог перезапуститься).\n'
      + 'Нажми /drill чтобы получить задание заново.',
    );
    setState(telegramId, DrillStates.IDLE);
    return;
  }

  const task = store.getTaskById(session.taskId);
  if (!task) {
    await ctx.answerCbQuery('Задание не найдено');
    await ctx.reply('Задание не найдено. Нажми /drill.');
    return;
  }

  store.updateTodaySession(telegramId, { status: 'in_progress' });
  setState(telegramId, DrillStates.AWAITING_VOICE);
  await ctx.answerCbQuery();

  const hints = await generatePrepareHints(task.promptEn, user.level);
  await ctx.reply(formatPrepareHints(hints), {
    parse_mode: 'Markdown',
    ...awaitingVoiceKeyboard(),
  });
}

async function handleSkip(ctx) {
  const telegramId = ctx.from.id;
  store.updateTodaySession(telegramId, { status: 'skipped', completedAt: new Date() });
  setState(telegramId, DrillStates.IDLE);
  await ctx.answerCbQuery();
  await ctx.reply('Задание пропущено. Увидимся завтра! 👋');
}

module.exports = {
  sendDailyTask,
  deliverDailyTask,
  handleReady,
  handleSkip,
};
