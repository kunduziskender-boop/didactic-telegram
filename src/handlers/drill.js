const fs = require('fs');
const store = require('../store');
const { getState, setState, DrillStates, canAcceptVoice } = require('../fsm/manager');
const { CB, correctionKeyboard, shadowKeyboard, followUpKeyboard, textCheckKeyboard } = require('../keyboards');
const { deliverDailyTask, handleReady, handleSkip, sendDailyTask } = require('../services/drill');
const { processVoiceResponse, processTextResponse, processFollowUpVoice, processFollowUpText } = require('../services/pipeline');
const { generateFollowUpQuestion } = require('../services/llm');
const { formatFluencyFeedback, formatFollowUpPrompt } = require('../services/feedback');
const { withTyping } = require('../services/typing');
const { synthesize } = require('../services/tts');
const { pathsForSession } = require('../services/audio');
const { sendCorrectedAudio } = require('../services/telegramAudio');
const { autoSaveFromDrill } = require('./vocab');

function extractVoiceFile(ctx) {
  const msg = ctx.message;
  if (msg.voice) {
    return { fileId: msg.voice.file_id, kind: 'voice', duration: msg.voice.duration };
  }
  if (msg.audio) {
    return { fileId: msg.audio.file_id, kind: 'audio', duration: msg.audio.duration };
  }
  return null;
}

async function rejectShortVoice(ctx, voiceFile) {
  const { MIN_VOICE_DURATION_SEC } = require('../services/transcriptQuality');
  const duration = voiceFile.duration ?? 0;
  if (duration >= MIN_VOICE_DURATION_SEC) return false;

  await ctx.reply(
    `🎤 Запись слишком короткая (${duration || '?'} сек).\n\n`
    + `Запиши ответ **5–15 секунд** — одним дыханием, по теме задания.\n`
    + '✍️ Или напиши ответ **текстом** — так проверка будет точнее.',
    { parse_mode: 'Markdown' },
  );
  return true;
}

async function showFinishOptions(ctx) {
  const session = store.getTodaySession(ctx.from.id);
  const phrases = session?.response?.usefulPhrases || [];

  if (phrases.length) {
    const list = phrases
      .map((p) => {
        const en = typeof p === 'string' ? p : p.en;
        const ru = typeof p === 'object' ? p.ru : null;
        return ru ? `• "${en}" — ${ru}` : `• "${en}"`;
      })
      .join('\n');
    await ctx.reply(
      `📚 Сохрани фразы на сегодня:\n${list}\n\n`
      + 'Они автоматически попадут в словарь после «Готово».\n'
      + 'Повторение: /words · Все фразы: /phrases',
    );
  }

  setState(ctx.from.id, DrillStates.CORRECTION_SHOWN);
  await ctx.reply(
    '🎧 Хочешь потренировать произношение? Нажми Shadow — или заверши задание.',
    correctionKeyboard(),
  );
}

async function sendFollowUpRound(ctx, taskPrompt, transcript, level) {
  const followUp = await withTyping(ctx.telegram, ctx.chat.id, () => generateFollowUpQuestion(
    taskPrompt,
    transcript,
    level,
  ));
  store.updateSessionResponse(ctx.from.id, {
    followUpPromptEn: followUp.follow_up_en,
    followUpPromptRu: followUp.follow_up_ru,
  });

  await ctx.reply(formatFollowUpPrompt(followUp), {
    parse_mode: 'Markdown',
    ...followUpKeyboard(),
  });
  setState(ctx.from.id, DrillStates.AWAITING_FOLLOWUP);
}

async function handleDrillCommand(ctx) {
  const user = store.getUser(ctx.from.id);
  if (!user?.onboardingCompleted) {
    await ctx.reply('Сначала пройди онбординг: /start');
    return;
  }
  const sent = await deliverDailyTask(ctx, { force: true });
  if (!sent) {
    await ctx.reply('Не удалось отправить задание. Попробуй ещё раз.');
  }
}

async function handleCallback(ctx) {
  const data = ctx.callbackQuery.data;

  if (data === CB.READY) {
    await handleReady(ctx);
    return;
  }
  if (data === CB.REMIND_NOW) {
    const telegramId = ctx.from.id;
    const session = store.getTodaySession(telegramId);
    if (!session) {
      await sendDailyTask(ctx.telegram, telegramId, { isReminder: true, force: true });
    }
    await handleReady(ctx);
    return;
  }
  if (data === CB.SKIP) {
    await handleSkip(ctx);
    return;
  }
  if (data === CB.SKIP_FOLLOWUP) {
    await handleSkipFollowUp(ctx);
    return;
  }
  if (data === CB.SKIP_TEXT_CHECK) {
    await handleSkipTextCheck(ctx);
    return;
  }
  if (data === CB.SHADOW) {
    await handleShadow(ctx);
    return;
  }
  if (data === CB.DONE || data === CB.SKIP_SHADOW) {
    await handleDone(ctx);
    return;
  }
}

async function handleSkipTextCheck(ctx) {
  await ctx.answerCbQuery('Проверка пропущена');
  await proceedToFollowUp(ctx);
}

async function handleSkipFollowUp(ctx) {
  const telegramId = ctx.from.id;
  store.updateSessionResponse(telegramId, { followUpSkipped: true });
  await ctx.answerCbQuery('Follow-up пропущен');
  await showFinishOptions(ctx);
}

async function deliverMainResult(ctx, result, task, user) {
  if (result.hasCorrectedAudio && result.correctedAudioPath) {
    await sendCorrectedAudio(ctx, result.correctedAudioPath);
  }

  await ctx.reply(
    formatFluencyFeedback(result, {
      voiceOnly: result.noTranscript || result.sttUnreliable || result.sttFailed,
      usedDemo: result.usedDemo,
    }),
  );

  const needsTextCheck = result.noTranscript
    || result.sttUnreliable
    || result.sttFailed
    || (!result.transcript?.trim() && result.voiceOnly);
  if (needsTextCheck) {
    setState(ctx.from.id, DrillStates.AWAITING_VOICE);
    const extra = result.sttHeard
      ? `\n\n⚠️ Whisper услышал только «${result.sttHeard}».`
      : result.sttFailed
        ? '\n\n⚠️ Аудио не распозналось — попробуй записать громче или напиши текстом.'
        : '';
    await ctx.reply(
      '✍️ Отправь свой ответ текстом на английском — тогда проверим ошибки по-настоящему.'
      + extra
      + '\n\nИли нажми «Пропустить проверку», чтобы перейти к follow-up.',
      textCheckKeyboard(),
    );
    return;
  }

  await sendFollowUpRound(ctx, task.promptEn, result.transcript, user.level);
}

async function proceedToFollowUp(ctx) {
  const user = store.getUser(ctx.from.id);
  const session = store.getTodaySession(ctx.from.id);
  const task = store.getTaskById(session?.taskId);
  const transcript = session?.response?.transcript || '';
  if (!task) return;
  await sendFollowUpRound(ctx, task.promptEn, transcript, user.level);
}

async function handleMainVoice(ctx, voiceFile) {
  const telegramId = ctx.from.id;
  const user = store.getUser(telegramId);
  const session = store.getTodaySession(telegramId);
  const task = store.getTaskById(session?.taskId);

  if (await rejectShortVoice(ctx, voiceFile)) {
    return;
  }

  setState(telegramId, DrillStates.PROCESSING);
  store.updateTodaySession(telegramId, { status: 'processing' });

  const statusMsg = await ctx.reply('⏳ Обрабатываю ваш ответ...');
  console.log(`Voice received from ${telegramId} (${voiceFile.kind}), task #${task.id}`);

  try {
    const result = await processVoiceResponse({
      telegram: ctx.telegram,
      telegramId,
      fileId: voiceFile.fileId,
      taskPrompt: task.promptEn,
      level: user.level,
      durationSec: voiceFile.duration,
    });

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      '✅ Готово!',
    );

    await deliverMainResult(ctx, result, task, user);
  } catch (err) {
    console.error('Pipeline error:', err);
    setState(telegramId, DrillStates.AWAITING_VOICE);
    store.updateTodaySession(telegramId, { status: 'in_progress' });
    const detail = err.message?.includes('API') || err.message?.includes('401')
      ? '\n\nПроверь OPENAI_API_KEY в .env'
      : '';
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      `❌ Ошибка обработки: ${err.message || 'неизвестная ошибка'}.${detail}\n\nПопробуй записать голосовое ещё раз.`,
    );
  }
}

async function handleFollowUpVoice(ctx, voiceFile) {
  const telegramId = ctx.from.id;
  const user = store.getUser(telegramId);
  const session = store.getTodaySession(telegramId);
  const followUpPrompt = session?.response?.followUpPromptEn;

  if (!followUpPrompt) {
    await ctx.reply('Follow-up не найден. Нажми /drill.');
    setState(telegramId, DrillStates.IDLE);
    return;
  }

  if (await rejectShortVoice(ctx, voiceFile)) {
    return;
  }

  setState(telegramId, DrillStates.PROCESSING);
  const statusMsg = await ctx.reply('⏳ Слушаю ваш follow-up...');

  try {
    const result = await processFollowUpVoice({
      telegram: ctx.telegram,
      telegramId,
      fileId: voiceFile.fileId,
      followUpPrompt,
      level: user.level,
      durationSec: voiceFile.duration,
    });

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      '✅ Отлично!',
    );

    await ctx.reply(formatFluencyFeedback(result, {
      isFollowUp: true,
      voiceOnly: result.voiceOnly,
    }));
    if (result.hasCorrectedAudio && result.correctedAudioPath) {
      await sendCorrectedAudio(ctx, result.correctedAudioPath);
    }
    await showFinishOptions(ctx);
  } catch (err) {
    console.error('Follow-up pipeline error:', err);
    setState(telegramId, DrillStates.AWAITING_FOLLOWUP);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      `❌ Ошибка: ${err.message || 'неизвестная ошибка'}. Попробуй ещё раз, напиши текстом или пропусти follow-up.`,
    );
  }
}

async function handleFollowUpText(ctx, text) {
  const telegramId = ctx.from.id;
  const user = store.getUser(telegramId);
  const session = store.getTodaySession(telegramId);
  const followUpPrompt = session?.response?.followUpPromptEn;

  if (!followUpPrompt) {
    await ctx.reply('Follow-up не найден. Нажми /drill.');
    setState(telegramId, DrillStates.IDLE);
    return;
  }

  setState(telegramId, DrillStates.PROCESSING);
  const statusMsg = await ctx.reply('⏳ Проверяю ваш follow-up...');

  try {
    const result = await processFollowUpText({
      telegram: ctx.telegram,
      telegramId,
      text,
      followUpPrompt,
      level: user.level,
    });

    await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '✅ Готово!');
    await ctx.reply(formatFluencyFeedback(result, { isFollowUp: true }), { parse_mode: 'Markdown' });
    await showFinishOptions(ctx);
  } catch (err) {
    console.error('Follow-up text error:', err);
    setState(telegramId, DrillStates.AWAITING_FOLLOWUP);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      `❌ Ошибка: ${err.message || 'неизвестная ошибка'}.`,
    );
  }
}

async function handleMainText(ctx, text) {
  const telegramId = ctx.from.id;
  const user = store.getUser(telegramId);
  const session = store.getTodaySession(telegramId);
  const task = store.getTaskById(session?.taskId);

  setState(telegramId, DrillStates.PROCESSING);
  store.updateTodaySession(telegramId, { status: 'processing' });

  const statusMsg = await ctx.reply('⏳ Проверяю ваш текст...');
  console.log(`Text answer from ${telegramId}, task #${task.id}`);

  try {
    const result = await processTextResponse({
      telegram: ctx.telegram,
      telegramId,
      text,
      taskPrompt: task.promptEn,
      level: user.level,
    });

    await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '✅ Готово!');
    await deliverMainResult(ctx, result, task, user);
  } catch (err) {
    console.error('Text pipeline error:', err);
    setState(telegramId, DrillStates.AWAITING_VOICE);
    store.updateTodaySession(telegramId, { status: 'in_progress' });
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      `❌ Ошибка: ${err.message || 'неизвестная ошибка'}. Попробуй ещё раз.`,
    );
  }
}

async function handleDrillText(ctx) {
  const text = ctx.message?.text?.trim();
  if (!text || text.startsWith('/')) return;

  const telegramId = ctx.from.id;
  const state = getState(telegramId);

  if (state === DrillStates.PROCESSING) {
    await ctx.reply('⏳ Уже обрабатываю предыдущий ответ, подожди немного.');
    return;
  }

  if (state !== DrillStates.AWAITING_VOICE && state !== DrillStates.AWAITING_FOLLOWUP) {
    return;
  }

  const user = store.getUser(telegramId);
  if (!user?.onboardingCompleted) return;

  const session = store.getTodaySession(telegramId);
  if (!session) return;

  if (state === DrillStates.AWAITING_FOLLOWUP) {
    await handleFollowUpText(ctx, text);
    return;
  }

  const task = store.getTaskById(session.taskId);
  if (!task) return;

  await handleMainText(ctx, text);
}

async function handleVoice(ctx) {
  const telegramId = ctx.from.id;
  let state = getState(telegramId);
  const voiceFile = extractVoiceFile(ctx);

  if (!voiceFile) return;

  if (state === DrillStates.PROCESSING) {
    await ctx.reply('⏳ Уже обрабатываю предыдущий ответ, подожди немного.');
    return;
  }

  const session = store.getTodaySession(telegramId);

  if (!canAcceptVoice(telegramId, state)) {
    const hint = state === DrillStates.SHADOW_ACTIVE || state === DrillStates.CORRECTION_SHOWN
      ? 'Сейчас режим Shadow — просто слушай аудио и повторяй вслух. Когда закончишь, нажми «Готово».'
      : session?.status === 'completed'
        ? 'Сегодняшнее задание уже выполнено. Завтра будет новое — или /drill для повторной практики.'
        : 'Нажми /drill → «Готов» → запиши голосовое.';
    console.log(`Voice rejected for ${telegramId}: state=${state}, session=${session?.status ?? 'none'}`);
    await ctx.reply(`Сейчас не время для голосового ответа.\n\n${hint}`);
    return;
  }

  const user = store.getUser(telegramId);
  if (!user?.onboardingCompleted) {
    await ctx.reply('Сначала пройди онбординг: /start');
    return;
  }

  if (state === DrillStates.AWAITING_FOLLOWUP) {
    await handleFollowUpVoice(ctx, voiceFile);
    return;
  }

  if (state !== DrillStates.AWAITING_VOICE) {
    store.updateTodaySession(telegramId, { status: 'in_progress' });
    setState(telegramId, DrillStates.AWAITING_VOICE);
    state = DrillStates.AWAITING_VOICE;
  }

  const task = store.getTaskById(session?.taskId);
  if (!session || !task) {
    await ctx.reply(
      'Сессия задания не найдена.\n'
      + 'Нажми /drill и начни задание заново.',
    );
    setState(telegramId, DrillStates.IDLE);
    return;
  }

  await handleMainVoice(ctx, voiceFile);
}

async function resolveShadowAudio(telegramId, session) {
  const response = session?.response;
  if (!response) return null;

  const candidates = [
    response.followUpCorrectedAudioPath,
    response.correctedAudioPath,
  ].filter(Boolean);

  for (const audioPath of candidates) {
    if (fs.existsSync(audioPath)) return audioPath;
  }

  const text = response.followUpCorrectedText || response.correctedText;
  if (!text) return null;

  const dateKey = session.sessionDate || store.todayKey();
  const paths = pathsForSession(telegramId, dateKey);
  const outPath = response.followUpCorrectedText
    ? paths.followUpCorrected
    : paths.corrected;

  const ttsPath = await synthesize(text, outPath);
  if (!ttsPath || !fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    return null;
  }

  const patch = response.followUpCorrectedText
    ? { followUpCorrectedAudioPath: outPath }
    : { correctedAudioPath: outPath };
  store.updateSessionResponse(telegramId, patch);
  return outPath;
}

async function handleShadow(ctx) {
  const telegramId = ctx.from.id;
  const session = store.getTodaySession(telegramId);

  await ctx.answerCbQuery();
  const audioPath = await resolveShadowAudio(telegramId, session);

  if (!audioPath) {
    await ctx.reply('Аудио исправленного варианта недоступно. Прочитай текст вслух.');
  } else {
    await ctx.reply('🎧 Shadow Practice: прослушай и повтори вслух за мной. Без проверки — просто тренируй произношение!');
    const sent = await sendCorrectedAudio(ctx, audioPath);
    if (!sent) {
      const text = session?.response?.followUpCorrectedText || session?.response?.correctedText;
      if (text) {
        await ctx.reply(`🔊 Прочитай вслух:\n\n${text}`);
      }
    }
  }

  store.updateSessionResponse(telegramId, { shadowDone: true });
  setState(telegramId, DrillStates.SHADOW_ACTIVE);
  await ctx.reply('Когда закончишь — нажми «Готово».', shadowKeyboard());
}

async function handleDone(ctx) {
  const telegramId = ctx.from.id;
  const state = getState(telegramId);

  if (state === DrillStates.CORRECTION_SHOWN || state === DrillStates.SHADOW_ACTIVE) {
    const session = store.getTodaySession(telegramId);
    if (session?.status !== 'completed') {
      store.updateTodaySession(telegramId, { status: 'completed', completedAt: new Date() });
      store.updateStreakOnComplete(telegramId);
    }
    setState(telegramId, DrillStates.IDLE);

    const streak = store.getStreak(telegramId);
    const savedWords = session ? autoSaveFromDrill(telegramId, session) : 0;
    await ctx.answerCbQuery();
    const vocabNote = savedWords > 0
      ? `\n📖 +${savedWords} фраз(а) в словарь. Повтори: /words`
      : '';
    await ctx.reply(
      `Отличная работа! 🔥 Стрик: ${streak?.currentStreak ?? 0} дней.\n`
      + 'Сегодня ты потренировал(а) живой диалог — так и строится уверенность!'
      + vocabNote,
    );
  } else {
    await ctx.answerCbQuery('Сначала заверши follow-up или пропусти его');
  }
}

module.exports = {
  handleDrillCommand,
  handleCallback,
  handleVoice,
  handleDrillText,
  extractVoiceFile,
};
