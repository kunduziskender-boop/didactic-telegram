const fs = require('fs');
const config = require('../config');
const store = require('../store');
const { downloadTelegramFile, convertOggToWav, pathsForSession } = require('./audio');
const { transcribe } = require('./stt');
const { analyzeAnswer, analyzeFollowUpAnswer } = require('./llm');
const { synthesize } = require('./tts');
const { withTyping } = require('./typing');

function buildAnalysisResponse(sttResult, analysis, paths) {
  const sttUnreliable = Boolean(sttResult.unreliable);
  const sttFailed = Boolean(sttResult.sttFailed);
  const noTranscript = analysis.noTranscript || sttResult.voiceOnly || sttUnreliable || sttFailed;
  const transcript = sttUnreliable
    ? (sttResult.sttHeard || '')
    : (sttResult.text?.trim() || (noTranscript ? '' : '(не удалось распознать)'));

  return {
    transcript,
    correctedText: analysis.corrected_text,
    grammarTip: analysis.grammar_tip || null,
    mainImprovement: analysis.main_improvement || null,
    whatWentWell: analysis.what_went_well || [],
    issues: (sttUnreliable || sttFailed) ? [] : (analysis.issues || []),
    typicalMistakes: analysis.typical_mistakes || [],
    noteRu: analysis.note_ru || '',
    quality: (sttUnreliable || sttFailed) ? 'unknown' : (analysis.quality || 'ok'),
    relevance: (sttUnreliable || sttFailed) ? 'unknown' : (analysis.relevance || 'on_topic'),
    relevanceNoteRu: analysis.relevance_note_ru || '',
    noTranscript,
    sttUnreliable,
    sttFailed,
    sttHeard: sttResult.sttHeard || null,
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
async function processVoiceResponse({ telegram, telegramId, fileId, taskPrompt, level, durationSec }) {
  const session = store.getTodaySession(telegramId);
  const dateKey = session?.sessionDate || store.todayKey();
  const paths = pathsForSession(telegramId, dateKey);

  await downloadTelegramFile(telegram, fileId, paths.responseOgg);
  const audioForStt = await convertOggToWav(paths.responseOgg, paths.responseWav);

  const sttResult = await transcribe(audioForStt, {
    taskPrompt,
    durationSec,
    wavPath: paths.responseWav,
  });
  const hasLlm = config.openaiLlmEnabled || config.deepseekLlmEnabled;
  const voiceOnly = sttResult.voiceOnly || sttResult.unreliable || sttResult.sttFailed || !sttResult.text?.trim();
  const analysis = await withTyping(telegram, telegramId, () => analyzeAnswer(
    voiceOnly ? '' : sttResult.text,
    taskPrompt,
    level,
    {
      forceDemo: sttResult.demo && !hasLlm,
      voiceOnly,
    },
  ));

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
async function processTextResponse({ telegram, telegramId, text, taskPrompt, level }) {
  const session = store.getTodaySession(telegramId);
  const analysis = await withTyping(telegram, telegramId, () => analyzeAnswer(
    text.trim(),
    taskPrompt,
    level,
    { voiceOnly: false },
  ));
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
async function processFollowUpVoice({ telegram, telegramId, fileId, followUpPrompt, level, durationSec }) {
  const session = store.getTodaySession(telegramId);
  const dateKey = session?.sessionDate || store.todayKey();
  const paths = pathsForSession(telegramId, dateKey);

  await downloadTelegramFile(telegram, fileId, paths.responseOgg);
  const audioForStt = await convertOggToWav(paths.responseOgg, paths.responseWav);

  const sttResult = await transcribe(audioForStt, {
    taskPrompt: followUpPrompt,
    durationSec,
    wavPath: paths.responseWav,
  });
  const hasLlm = config.openaiLlmEnabled || config.deepseekLlmEnabled;
  const voiceOnly = (sttResult.voiceOnly && !sttResult.text?.trim()) || sttResult.unreliable;
  const analysis = await withTyping(telegram, telegramId, () => analyzeFollowUpAnswer(
    voiceOnly ? '' : sttResult.text,
    followUpPrompt,
    level,
    { voiceOnly },
  ));

  store.updateSessionResponse(telegramId, {
    followUpTranscript: sttResult.text?.trim() || '',
    followUpCorrectedText: analysis.corrected_text,
    followUpPraise: analysis.praise,
    followUpDone: true,
  });

  const ttsPath = analysis.corrected_text
    ? await synthesize(analysis.corrected_text, paths.followUpCorrected)
    : null;
  const hasAudio = ttsPath && fs.existsSync(paths.followUpCorrected)
    && fs.statSync(paths.followUpCorrected).size > 0;
  if (hasAudio) {
    store.updateSessionResponse(telegramId, { followUpCorrectedAudioPath: paths.followUpCorrected });
  }

  return {
    transcript: sttResult.unreliable ? (sttResult.sttHeard || '') : (sttResult.text?.trim() || ''),
    correctedText: analysis.corrected_text,
    praise: analysis.praise,
    issues: sttResult.unreliable ? [] : (analysis.issues || []),
    relevance: sttResult.unreliable ? 'unknown' : (analysis.relevance || 'on_topic'),
    relevanceNoteRu: analysis.relevance_note_ru || '',
    mainImprovement: analysis.main_improvement || null,
    quality: sttResult.unreliable ? 'unknown' : (analysis.quality || 'ok'),
    voiceOnly,
    sttUnreliable: Boolean(sttResult.unreliable),
    sttHeard: sttResult.sttHeard || null,
    usedDemo: sttResult.demo || analysis.demo,
    hasCorrectedAudio: hasAudio,
    correctedAudioPath: hasAudio ? paths.followUpCorrected : null,
  };
}

async function processFollowUpText({ telegram, telegramId, text, followUpPrompt, level }) {
  const analysis = await withTyping(telegram, telegramId, () => analyzeFollowUpAnswer(
    text.trim(),
    followUpPrompt,
    level,
    { voiceOnly: false },
  ));

  store.updateSessionResponse(telegramId, {
    followUpTranscript: text.trim(),
    followUpCorrectedText: analysis.corrected_text,
    followUpPraise: analysis.praise,
    followUpDone: true,
  });

  const session = store.getTodaySession(telegramId);
  const dateKey = session?.sessionDate || store.todayKey();
  const paths = pathsForSession(telegramId, dateKey);
  const ttsPath = analysis.corrected_text
    ? await synthesize(analysis.corrected_text, paths.followUpCorrected)
    : null;
  const hasAudio = ttsPath && fs.existsSync(paths.followUpCorrected)
    && fs.statSync(paths.followUpCorrected).size > 0;
  if (hasAudio) {
    store.updateSessionResponse(telegramId, { followUpCorrectedAudioPath: paths.followUpCorrected });
  }

  return {
    transcript: text.trim(),
    correctedText: analysis.corrected_text,
    praise: analysis.praise,
    issues: analysis.issues || [],
    relevance: analysis.relevance || 'on_topic',
    relevanceNoteRu: analysis.relevance_note_ru || '',
    mainImprovement: analysis.main_improvement || null,
    quality: analysis.quality || 'ok',
    voiceOnly: false,
    usedDemo: analysis.demo,
    hasCorrectedAudio: hasAudio,
    correctedAudioPath: hasAudio ? paths.followUpCorrected : null,
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
