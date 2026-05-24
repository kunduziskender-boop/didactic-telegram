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

const BRITISH_TTS_INSTRUCTIONS = 'Speak in clear British English (UK accent). Use natural UK pronunciation and intonation — not American. Sound like a friendly British English teacher.';

const AMERICAN_TTS_INSTRUCTIONS = 'Speak in clear American English (US accent). Use natural US pronunciation and intonation.';

function getTtsInstructions(variant = 'british') {
  return variant === 'american' ? AMERICAN_TTS_INSTRUCTIONS : BRITISH_TTS_INSTRUCTIONS;
}

module.exports = {
  getEnglishLocalePrompt,
  getEnglishLocaleLabel,
  getTtsInstructions,
  BRITISH_PROMPT,
  AMERICAN_PROMPT,
  BRITISH_TTS_INSTRUCTIONS,
  AMERICAN_TTS_INSTRUCTIONS,
};
