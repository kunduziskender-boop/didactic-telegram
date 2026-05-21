const fs = require('fs');
const config = require('../config');
const store = require('../store');
const { downloadTelegramFile, convertOggToWav, pathsForSession } = require('./audio');
const { transcribe } = require('./stt');
const { analyzeAnswer, analyzeFollowUpAnswer } = require('./llm');
const { synthesize } = require('./tts');

function buildAnalysisResponse(sttResult, analysis, paths) {
  const noTranscript = analysis.noTranscript || sttResult.voiceOnly;
  const transcript = sttResult.text?.trim()
    || (noTranscript ? '' : '(не удалось распознать)');

  return {
    transcript,
    correctedText: analysis.corrected_text,
    grammarTip: analysis.grammar_tip || null,
    mainImprovement: analysis.main_improvement || null,
    whatWentWell: analysis.what_went_well || [],
    issues: analysis.issues || [],
    typicalMistakes: analysis.typical_mistakes || [],
    noteRu: analysis.note_ru || '',
    quality: analysis.quality || 'ok',
    noTranscript,
    praise: analysis.praise,
    errorRuleTag: analysis.error_rule_tag,
    responseAudioPath: paths.responseOgg,
    shadowDone: false,
    usedDemo: sttResult.demo || analysis.demo,
    fallbackReason: sttResult.fallbackReason || analysis.fallbackReason || null,
    voiceOnly: noTranscript,
  };
}

/**
 * Process user voice answer through STT → LLM → TTS pipeline.
 */
async function processVoiceResponse({ telegram, telegramId, fileId, taskPrompt, level }) {
  const session = store.getTodaySession(telegramId);
  const dateKey = session?.sessionDate || store.todayKey();
  const paths = pathsForSession(telegramId, dateKey);

  await downloadTelegramFile(telegram, fileId, paths.responseOgg);
  const audioForStt = await convertOggToWav(paths.responseOgg, paths.responseWav);

  const sttResult = await transcribe(audioForStt);
  const analysis = await analyzeAnswer(sttResult.text, taskPrompt, level, {
    forceDemo: sttResult.demo && !config.deepseekApiKey,
    voiceOnly: sttResult.voiceOnly,
  });

  const noTranscript = analysis.noTranscript || sttResult.voiceOnly;
  const ttsPath = noTranscript ? null : await synthesize(analysis.corrected_text, paths.corrected);
  const hasAudio = ttsPath && fs.existsSync(paths.corrected) && fs.statSync(paths.corrected).size > 0;

  const response = {
    ...buildAnalysisResponse(sttResult, analysis, paths),
    correctedAudioPath: hasAudio ? paths.corrected : null,
  };

  store.updateTodaySession(telegramId, { response, status: 'in_progress' });

  if (analysis.error_rule_tag) {
    store.logError(telegramId, {
      sessionId: session?.id,
      ruleTag: analysis.error_rule_tag,
      originalFragment: analysis.original_fragment || sttResult.text.slice(0, 100),
      correction: analysis.correction || analysis.corrected_text,
    });
  }

  return { ...response, hasCorrectedAudio: hasAudio };
}

/**
 * Process typed English answer (real transcript for DeepSeek when Whisper is off).
 */
async function processTextResponse({ telegramId, text, taskPrompt, level }) {
  const session = store.getTodaySession(telegramId);
  const analysis = await analyzeAnswer(text.trim(), taskPrompt, level, { voiceOnly: false });
  const dateKey = session?.sessionDate || store.todayKey();
  const paths = pathsForSession(telegramId, dateKey);

  const sttResult = { text: text.trim(), demo: false, voiceOnly: false };
  const ttsPath = await synthesize(analysis.corrected_text, paths.corrected);
  const hasAudio = ttsPath && fs.existsSync(paths.corrected) && fs.statSync(paths.corrected).size > 0;

  const response = {
    ...buildAnalysisResponse(sttResult, analysis, { responseOgg: null }),
    correctedAudioPath: hasAudio ? paths.corrected : null,
  };

  store.updateTodaySession(telegramId, { response, status: 'in_progress' });

  if (analysis.error_rule_tag) {
    store.logError(telegramId, {
      sessionId: session?.id,
      ruleTag: analysis.error_rule_tag,
      originalFragment: analysis.original_fragment || text.slice(0, 100),
      correction: analysis.correction || analysis.corrected_text,
    });
  }

  return { ...response, hasCorrectedAudio: hasAudio };
}

/**
 * Process follow-up voice in the mini-dialogue (no TTS).
 */
async function processFollowUpVoice({ telegram, telegramId, fileId, followUpPrompt, level }) {
  const session = store.getTodaySession(telegramId);
  const dateKey = session?.sessionDate || store.todayKey();
  const paths = pathsForSession(telegramId, dateKey);

  await downloadTelegramFile(telegram, fileId, paths.responseOgg);
  const audioForStt = await convertOggToWav(paths.responseOgg, paths.responseWav);

  const sttResult = await transcribe(audioForStt);
  const analysis = await analyzeFollowUpAnswer(
    sttResult.text,
    followUpPrompt,
    level,
    { voiceOnly: sttResult.voiceOnly },
  );

  store.updateSessionResponse(telegramId, {
    followUpTranscript: sttResult.text?.trim() || '',
    followUpCorrectedText: analysis.corrected_text,
    followUpPraise: analysis.praise,
    followUpDone: true,
  });

  return {
    transcript: sttResult.text?.trim() || '',
    correctedText: analysis.corrected_text,
    praise: analysis.praise,
    issues: analysis.issues || [],
    voiceOnly: sttResult.voiceOnly && !sttResult.text?.trim(),
    usedDemo: sttResult.demo || analysis.demo,
  };
}

async function processFollowUpText({ telegramId, text, followUpPrompt, level }) {
  const analysis = await analyzeFollowUpAnswer(text.trim(), followUpPrompt, level, { voiceOnly: false });

  store.updateSessionResponse(telegramId, {
    followUpTranscript: text.trim(),
    followUpCorrectedText: analysis.corrected_text,
    followUpPraise: analysis.praise,
    followUpDone: true,
  });

  return {
    transcript: text.trim(),
    correctedText: analysis.corrected_text,
    praise: analysis.praise,
    issues: analysis.issues || [],
    voiceOnly: false,
    usedDemo: analysis.demo,
  };
}

async function synthesizeTask(telegramId, task) {
  const dateKey = store.todayKey();
  const paths = pathsForSession(telegramId, dateKey);
  const result = await synthesize(task.promptEn, paths.task);
  const hasAudio = result && fs.existsSync(paths.task) && fs.statSync(paths.task).size > 0;
  return hasAudio ? paths.task : null;
}

module.exports = {
  processVoiceResponse,
  processTextResponse,
  processFollowUpVoice,
  processFollowUpText,
  synthesizeTask,
};
