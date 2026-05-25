const fs = require('fs');
const store = require('../store');
const { getState, setState, DialogueStates, DrillStates } = require('../fsm/manager');
const { pickScenarios, getScenarioById } = require('../data/dialogueScenarios');
const {
  DIALOGUE_TURNS,
  formatScenarioIntro,
  formatGuidedSuggestion,
  getOpeningSuggestion,
  processDialogueTurn,
  formatTurnFeedback,
  formatDialogueSummary,
  isDialogueHelpRequest,
  isDialogueOffTopicMessage,
  buildDialogueHelpResponse,
  buildDialogueOffTopicResponse,
} = require('../services/dialogue');
const { dialogueScenarioKeyboard, dialogueActiveKeyboard } = require('../keyboards');
const { withTyping } = require('../services/typing');
const { transcribe } = require('../services/stt');
const { downloadTelegramFile, convertOggToWav, pathsForSession } = require('../services/audio');
const { synthesize } = require('../services/tts');
const { sendCorrectedAudio } = require('../services/telegramAudio');

async function ensureUser(ctx) {
  const user = store.getUser(ctx.from.id);
  if (!user?.onboardingCompleted) {
    await ctx.reply('Сначала пройди онбординг: /start');
    return null;
  }
  return user;
}

async function replyMarkdownSafe(ctx, text, extra = {}) {
  try {
    await ctx.reply(text, { parse_mode: 'Markdown', ...extra });
  } catch {
    await ctx.reply(text.replace(/\*\*/g, ''), extra);
  }
}

async function sendSuggestionAudio(ctx, telegramId, text) {
  if (!text?.trim()) return;
  const dateKey = store.todayKey();
  const paths = pathsForSession(telegramId, dateKey);
  const audioPath = await synthesize(text, paths.dialogueHint);
  if (!audioPath || !fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) {
    return;
  }
  try {
    await sendCorrectedAudio(ctx, audioPath, { title: 'Guided Talk' });
  } catch (err) {
    console.error('Dialogue hint TTS error:', err.message);
  }
}

async function sendGuidedSuggestion(ctx, telegramId, en, ru, { withAudio = true } = {}) {
  if (!en?.trim()) return;
  store.setDialogueSuggestion(telegramId, en, ru);
  await replyMarkdownSafe(
    ctx,
    formatGuidedSuggestion(en, ru),
    dialogueActiveKeyboard(),
  );
  if (withAudio) {
    await sendSuggestionAudio(ctx, telegramId, en);
  }
}

async function handleTalkCommand(ctx) {
  const user = await ensureUser(ctx);
  if (!user) return;

  const scenarios = pickScenarios(user.level, user.topic, 4);
  await ctx.reply(
    '🎭 **Guided Talk** — диалог с готовыми фразами\n\n'
    + 'Бот покажет **что сказать** → ты копируешь или повторяешь вслух.\n'
    + '**4 реплики** → краткий итог.\n\n'
    + '✍️ Лучше **текстом** на первых порах — так спокойнее.',
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
  await replyMarkdownSafe(ctx, formatScenarioIntro(scenario), dialogueActiveKeyboard());

  const opening = getOpeningSuggestion(scenario);
  await sendGuidedSuggestion(ctx, ctx.from.id, opening.suggestedReplyEn, opening.suggestedReplyRu);
}

async function handleTalkCallback(ctx) {
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from.id;

  if (data === 'talk:random') {
    const user = store.getUser(telegramId);
    const [scenario] = pickScenarios(user.level, user.topic, 1);
    if (scenario) await startScenario(ctx, scenario.id);
    return;
  }

  if (data === 'talk:end') {
    store.clearDialogueSession(telegramId);
    setState(telegramId, DrillStates.IDLE);
    await ctx.answerCbQuery('Диалог завершён');
    await ctx.reply('Диалог остановлен. Новый: /talk');
    return;
  }

  if (data === 'talk:hint') {
    const session = store.getDialogueSession(telegramId);
    if (!session?.suggestedReplyEn) {
      await ctx.answerCbQuery('Подсказка пока недоступна');
      return;
    }
    await ctx.answerCbQuery();
    await sendGuidedSuggestion(
      ctx,
      telegramId,
      session.suggestedReplyEn,
      session.suggestedReplyRu,
      { withAudio: false },
    );
    return;
  }

  if (data === 'talk:listen') {
    const session = store.getDialogueSession(telegramId);
    if (!session?.suggestedReplyEn) {
      await ctx.answerCbQuery('Нечего озвучить');
      return;
    }
    await ctx.answerCbQuery('Слушай…');
    await sendSuggestionAudio(ctx, telegramId, session.suggestedReplyEn);
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
      taskPrompt: session.suggestedReplyEn || scenario.openingEn,
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

  if (isDialogueHelpRequest(userText)) {
    await replyMarkdownSafe(
      ctx,
      buildDialogueHelpResponse(scenario, session.history),
      dialogueActiveKeyboard(),
    );
    setState(telegramId, DialogueStates.ACTIVE);
    return;
  }

  if (isDialogueOffTopicMessage(userText)) {
    await replyMarkdownSafe(
      ctx,
      buildDialogueOffTopicResponse(scenario, session),
      dialogueActiveKeyboard(),
    );
    setState(telegramId, DialogueStates.ACTIVE);
    return;
  }

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

  await replyMarkdownSafe(
    ctx,
    formatTurnFeedback(result, scenario),
    result.isFinal ? {} : dialogueActiveKeyboard(),
  );

  if (result.isFinal) {
    const updated = store.getDialogueSession(telegramId);
    await replyMarkdownSafe(ctx, formatDialogueSummary(scenario, updated?.history || []));
    store.clearDialogueSession(telegramId);
    setState(telegramId, DrillStates.IDLE);
    return;
  }

  if (result.suggestedReplyEn?.trim()) {
    await sendGuidedSuggestion(
      ctx,
      telegramId,
      result.suggestedReplyEn,
      result.suggestedReplyRu,
    );
  }

  setState(telegramId, DialogueStates.ACTIVE);
}

module.exports = {
  handleTalkCommand,
  handleTalkCallback,
  handleDialogueMessage,
  handleDialogueVoice,
};
