const fs = require('fs');
const { toFile } = require('openai/uploads');
const path = require('path');
const config = require('../config');
const { getOpenAIClient, isRecoverableAiError, isQuotaError } = require('./openaiClient');
const { assessTranscriptReliability } = require('./transcriptQuality');

async function runWhisper(openai, audioPath, taskPrompt) {
  const ext = path.extname(audioPath) || '.ogg';
  const file = await toFile(fs.createReadStream(audioPath), `response${ext}`);

  const whisperOpts = {
    file,
    model: 'whisper-1',
    language: 'en',
  };
  if (taskPrompt) {
    whisperOpts.prompt = `English speaking practice answer. Question: ${taskPrompt.slice(0, 200)}`;
  }

  const result = await openai.audio.transcriptions.create(whisperOpts);
  return result.text.trim();
}

/**
 * @param {string} audioPath
 * @param {{ taskPrompt?: string, durationSec?: number|null, wavPath?: string }} options
 */
async function transcribe(audioPath, options = {}) {
  const { taskPrompt, durationSec, wavPath } = options;

  if (config.demoMode) {
    return { text: '', demo: true, voiceOnly: true, fallbackReason: 'demo' };
  }

  if (!config.sttEnabled) {
    console.log('Whisper skipped — STT disabled (set WHISPER_ENABLED=true in .env)');
    return { text: '', demo: true, voiceOnly: true, fallbackReason: 'no_stt' };
  }

  const openai = getOpenAIClient();
  if (!openai) {
    return { text: '', demo: true, voiceOnly: true, fallbackReason: 'no_stt' };
  }

  try {
    let text = await runWhisper(openai, audioPath, taskPrompt);

    if (!text && wavPath && wavPath !== audioPath && fs.existsSync(wavPath)) {
      console.log('Whisper retry with wav...');
      text = await runWhisper(openai, wavPath, taskPrompt);
    }

    if (!text) {
      console.warn(`STT empty transcript (${durationSec ?? '?'}s) file=${audioPath}`);
      return {
        text: '',
        demo: false,
        voiceOnly: true,
        sttFailed: true,
        sttHeard: '',
      };
    }

    const reliability = assessTranscriptReliability(text, durationSec);
    if (reliability.unreliable) {
      console.warn(
        `STT suspicious: heard "${text}" (${durationSec ?? '?'}s) reason=${reliability.reason}`,
      );
      return {
        text: '',
        demo: false,
        voiceOnly: true,
        unreliable: true,
        sttHeard: reliability.heardText,
        sttReason: reliability.reason,
      };
    }

    return { text, demo: false, unreliable: false, sttHeard: text };
  } catch (err) {
    console.error('Whisper error:', err.message);
    if (isRecoverableAiError(err)) {
      return {
        text: '',
        demo: true,
        voiceOnly: true,
        fallbackReason: isQuotaError(err) ? 'quota' : 'connection',
      };
    }
    throw err;
  }
}

module.exports = { transcribe };
