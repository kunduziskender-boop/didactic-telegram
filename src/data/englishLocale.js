const BRITISH_PROMPT = `BRITISH ENGLISH (UK) — mandatory for all English output:
- Spelling: colour, favourite, organise, centre, travelled, practise (verb), licence (noun)
- Vocabulary: lift, flat, mobile, queue, boot, takeaway, holiday, biscuit, chemist, petrol
- Phrasing: "Have you got...?", "at the weekend", "in hospital" (no article where UK uses none)
- Avoid US forms: color, favorite, vacation (→ holiday), apartment (→ flat), elevator (→ lift), cookie (→ biscuit in UK café)`;

const AMERICAN_PROMPT = `AMERICAN ENGLISH (US) — mandatory for all English output:
- US spelling and vocabulary (color, favorite, vacation, apartment, elevator, cookie).`;

function getEnglishLocalePrompt(variant = 'british') {
  return variant === 'american' ? AMERICAN_PROMPT : BRITISH_PROMPT;
}

function getEnglishLocaleLabel(variant = 'british') {
  return variant === 'american' ? 'American English' : 'British English';
}

const BRITISH_TTS_INSTRUCTIONS = [
  'Speak exclusively in British English (UK accent).',
  'Use Received Pronunciation or modern Southern British intonation — never General American.',
  'Short vowels in "bath", "dance", "cannot" — flat British /a/, not American /æ/.',
  'No American rhotic emphasis. Natural UK rhythm and polite tone.',
  'Sound like a friendly British café barista or English teacher in London.',
].join(' ');

const AMERICAN_TTS_INSTRUCTIONS = 'Speak in clear American English (US accent). Use natural US pronunciation and intonation.';

const DEFAULT_TTS_VOICES = {
  british: 'fable',
  american: 'nova',
};

/** ElevenLabs preset voice IDs */
const DEFAULT_ELEVENLABS_VOICES = {
  british: 'onwK4e9ZLuTAKqWW03F9', // Daniel — British male
  american: '21m00Tcm4TlvDq8ikWAM', // Rachel — US female
};

function getDefaultTtsVoice(variant = 'british') {
  return variant === 'american' ? DEFAULT_TTS_VOICES.american : DEFAULT_TTS_VOICES.british;
}

function getDefaultElevenLabsVoiceId(variant = 'british') {
  return variant === 'american'
    ? DEFAULT_ELEVENLABS_VOICES.american
    : DEFAULT_ELEVENLABS_VOICES.british;
}

function isSteerableTtsModel(model) {
  return /mini-tts/i.test(model || '');
}

/** Light UK wording so TTS picks British pronunciation cues. */
function prepareSpeechText(text, variant = 'british') {
  if (variant === 'american' || !text) return text;
  return text
    .replace(/\bvacation\b/gi, 'holiday')
    .replace(/\bapartment\b/gi, 'flat')
    .replace(/\belevator\b/gi, 'lift')
    .replace(/\bcookie\b/gi, 'biscuit')
    .replace(/\bgotten\b/gi, 'got');
}

function getTtsInstructions(variant = 'british') {
  return variant === 'american' ? AMERICAN_TTS_INSTRUCTIONS : BRITISH_TTS_INSTRUCTIONS;
}

module.exports = {
  getEnglishLocalePrompt,
  getEnglishLocaleLabel,
  getTtsInstructions,
  getDefaultTtsVoice,
  getDefaultElevenLabsVoiceId,
  isSteerableTtsModel,
  prepareSpeechText,
  BRITISH_PROMPT,
  AMERICAN_PROMPT,
  BRITISH_TTS_INSTRUCTIONS,
  AMERICAN_TTS_INSTRUCTIONS,
};
