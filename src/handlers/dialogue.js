const store = require('../store');
const { getState, setState, DialogueStates, DrillStates } = require('../fsm/manager');
const { pickScenarios, getScenarioById } = require('../data/dialogueScenarios');
const {
  DIALOGUE_TURNS,
  formatScenarioIntro,
  processDialogueTurn,
  formatTurnFeedback,
  formatDialogueSummary,
} = require('../services/dialogue');
const { dialogueScenarioKeyboard, dialogueActiveKeyboard } = require('../keyboards');
const { withTyping } = require('../services/typing');
const { transcribe } = require('../services/stt');
const { downloadTelegramFile, convertOggToWav, pathsForSession } = require('../services/audio');

async function ensureUser(ctx) {
  const user = store.getUser(ctx.from.id);
  if (!user?.onboardingCompleted) {
    await ctx.reply('Сначала пройди онбординг: /start');
    return null;
  }
  return user;
}

async function handleTalkCommand(ctx) {
  const user = await ensureUser(ctx);
  if (!user) return;

  const scenarios = pickScenarios(user.level, user.topic, 4);
  await ctx.reply(
    '🎭 **Role-play диалоги**\n\n'
    + 'Выбери ситуацию — бот сыграет роль собеседника, ты отвечаешь.\n'
    + '**4 реплики** → краткий фидбек → следующая реплика в роли.\n\n'
    + '✍️ Лучше отвечать **текстом** — так точнее, чем голос.',
    { parse_mode: 'Markdown', ...dialogueScenarioKeyboard(scenarios) },
  );
}

async function startScenario(ctx, scenarioId) {
  const user = await ensureUser(ctx);
  if (!user) return;

  const scenario = getScenarioById(scenarioId);
  if (!scenario) {
    await ctx.answerCbQuery('Сценарий не найден');
    return;
  }

  store.startDialogueSession(ctx.from.id, scenario.id, DIALOGUE_TURNS);
  store.setDialogueOpening(ctx.from.id, scenario.openingEn);
  setState(ctx.from.id, DialogueStates.ACTIVE);

  await ctx.answerCbQuery();
  await ctx.reply(formatScenarioIntro(scenario), {
    parse_mode: 'Markdown',
    ...dialogueActiveKeyboard(),
  });
}

async function handleTalkCallback(ctx) {
  const data = ctx.callbackQuery.data;

  if (data === 'talk:random') {
    const user = store.getUser(ctx.from.id);
    const [scenario] = pickScenarios(user.level, user.topic, 1);
    if (scenario) await startScenario(ctx, scenario.id);
    return;
  }

  if (data === 'talk:end') {
    store.clearDialogueSession(ctx.from.id);
    setState(ctx.from.id, DrillStates.IDLE);
    await ctx.answerCbQuery('Диалог завершён');
    await ctx.reply('Диалог остановлен. Новый: /talk');
    return;
  }

  if (data.startsWith('talk:sc:')) {
    const scenarioId = data.slice('talk:sc:'.length);
    await startScenario(ctx, scenarioId);
  }
}

async function handleDialogueMessage(ctx, text) {
  if (!text || text.startsWith('/')) return false;

  const telegramId = ctx.from.id;
  const state = getState(telegramId);
  if (state !== DialogueStates.ACTIVE) return false;

  const user = store.getUser(telegramId);
  const session = store.getDialogueSession(telegramId);
  const scenario = session ? getScenarioById(session.scenarioId) : null;

  if (!user || !session || !scenario) {
    setState(telegramId, DrillStates.IDLE);
    await ctx.reply('Сессия диалога не найдена. Начни заново: /talk');
    return true;
  }

  await processUserReply(ctx, user, session, scenario, text.trim());
  return true;
}

async function handleDialogueVoice(ctx, voiceFile) {
  const telegramId = ctx.from.id;
  const state = getState(telegramId);
  if (state !== DialogueStates.ACTIVE) return false;

  const user = store.getUser(telegramId);
  const session = store.getDialogueSession(telegramId);
  const scenario = session ? getScenarioById(session.scenarioId) : null;
  if (!user || !session || !scenario) return false;

  const duration = voiceFile.duration ?? 0;
  if (duration > 0 && duration < 2) {
    await ctx.reply('🎤 Слишком коротко. 3–10 секунд или напиши текстом.');
    return true;
  }

  setState(telegramId, DialogueStates.PROCESSING);
  const statusMsg = await ctx.reply('⏳ Слушаю...');

  try {
    const dateKey = store.todayKey();
    const paths = pathsForSession(telegramId, dateKey);
    await downloadTelegramFile(ctx.telegram, voiceFile.fileId, paths.responseOgg);
    const audioForStt = await convertOggToWav(paths.responseOgg, paths.responseWav);
    const sttResult = await transcribe(audioForStt, {
      taskPrompt: scenario.openingEn,
      durationSec: duration,
      wavPath: paths.responseWav,
    });

    const text = sttResult.text?.trim();
    if (!text) {
      setState(telegramId, DialogueStates.ACTIVE);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        '❌ Не расслышал. Напиши текстом или запиши громче.',
      );
      return true;
    }

    await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '✅ Готово!');
    await processUserReply(ctx, user, session, scenario, text, text);
  } catch (err) {
    console.error('Dialogue voice error:', err.message);
    setState(telegramId, DialogueStates.ACTIVE);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      `❌ Ошибка: ${err.message}. Напиши текстом.`,
    );
  }
  return true;
}

async function processUserReply(ctx, user, session, scenario, userText, heardText = null) {
  const telegramId = ctx.from.id;
  setState(telegramId, DialogueStates.PROCESSING);

  const turnIndex = session.turnIndex + 1;
  const result = await withTyping(ctx.telegram, ctx.chat.id, () => processDialogueTurn(
    scenario,
    session.history,
    userText,
    user.level,
    turnIndex,
  ));

  if (heardText) result.heardText = heardText;

  store.appendDialogueHistory(telegramId, [
    { role: 'user', text: userText },
    { role: 'bot', text: result.botReplyEn },
  ]);

  await ctx.reply(formatTurnFeedback(result, scenario), {
    parse_mode: 'Markdown',
    ...(result.isFinal ? {} : dialogueActiveKeyboard()),
  });

  if (result.isFinal) {
    const updated = store.getDialogueSession(telegramId);
    await ctx.reply(formatDialogueSummary(scenario, updated?.history || []), {
      parse_mode: 'Markdown',
    });
    store.clearDialogueSession(telegramId);
    setState(telegramId, DrillStates.IDLE);
    return;
  }

  setState(telegramId, DialogueStates.ACTIVE);
}

module.exports = {
  handleTalkCommand,
  handleTalkCallback,
  handleDialogueMessage,
  handleDialogueVoice,
};
