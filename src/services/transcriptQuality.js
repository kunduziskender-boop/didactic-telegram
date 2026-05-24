const SHORT_OK_WORDS = new Set(['yes', 'no', 'ok', 'okay', 'sure', 'maybe']);

function wordCount(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Detect when Whisper likely misheard a longer voice message.
 * @param {string} text
 * @param {number|null|undefined} durationSec
 */
function assessTranscriptReliability(text, durationSec) {
  const heard = (text || '').trim();
  const words = wordCount(heard);
  const duration = Number(durationSec) || 0;

  if (!heard) {
    return { unreliable: false, reason: 'empty', heardText: '' };
  }

  if (duration >= 3 && words <= 2 && !SHORT_OK_WORDS.has(heard.toLowerCase())) {
    return {
      unreliable: true,
      reason: 'too_short_for_duration',
      heardText: heard,
    };
  }

  if (duration >= 5 && words <= 3) {
    return {
      unreliable: true,
      reason: 'too_few_words',
      heardText: heard,
    };
  }

  return { unreliable: false, reason: null, heardText: heard };
}

const MIN_VOICE_DURATION_SEC = 4;

module.exports = {
  assessTranscriptReliability,
  MIN_VOICE_DURATION_SEC,
};
