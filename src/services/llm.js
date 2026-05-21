const OpenAI = require('openai');
const config = require('../config');
const { isRecoverableAiError, isQuotaError } = require('./openaiClient');

let deepseekClient = null;

function getDeepSeek() {
  if (!config.deepseekApiKey || config.demoMode) return null;
  if (!deepseekClient) {
    deepseekClient = new OpenAI({
      apiKey: config.deepseekApiKey,
      baseURL: config.deepseekBaseUrl,
    });
  }
  return deepseekClient;
}

function getLlmClient() {
  if (getDeepSeek()) return getDeepSeek();
  if (config.openaiEnabled) return require('./openaiClient').getOpenAIClient();
  return null;
}

function getModel() {
  return config.deepseekApiKey ? 'deepseek-chat' : 'gpt-4o-mini';
}

const FLUENCY_SYSTEM_PROMPT = `You are an English speaking coach. Balance warmth with HONEST feedback — never claim the answer was perfect if it had clear errors.

Analyze the student's answer against the task.
Return ONLY valid JSON with keys:
- corrected_text: natural corrected version preserving the student's ideas when possible
- what_went_well: array of 1-3 bullet points in Russian — ONLY genuine strengths. If the answer was weak or wrong, mention only real effort. Do NOT invent praise for incorrect grammar or off-topic content.
- issues: array of 1-3 objects {original, corrected, note_ru} for the most important mistakes. Empty array only if the answer was strong for the level.
- main_improvement: one clear tip in Russian — REQUIRED when issues is non-empty; empty only if answer was genuinely strong
- useful_phrases: array of 2-3 objects {en, ru} from corrected_text
- grammar_tip: one short grammar note in Russian when there is a grammar issue; empty string if none
- praise: one sentence in Russian. If issues is non-empty, do NOT say the answer was correct/perfect/well built — only thank them and point to fixes below.
- what_went_well: if issues is non-empty, mention ONLY effort (answered the question, tried to speak) — NEVER say grammar/structure was correct
- error_rule_tag: snake_case for the main issue, or "none" if nearly perfect
- original_fragment: the main problematic fragment, or empty
- correction: the corrected fragment, or empty
- quality: one of "strong", "ok", "needs_work"

CRITICAL: If the student answer has grammar, tense, word-order, or vocabulary errors, issues MUST contain at least 1 item. Never return empty issues for a flawed answer. Never say the answer was perfect when it was not.`;

const VOICE_ONLY_PROMPT = `Speech-to-text is UNAVAILABLE. You CANNOT hear what the student said.
Do NOT pretend to evaluate their specific answer. Do NOT say their answer was good or correct.

Return ONLY valid JSON:
- mode: "no_transcript"
- corrected_text: a strong model answer to the task (2-4 sentences) at the student's level
- typical_mistakes: array of 2-3 objects {wrong, right, note_ru} — common mistakes on THIS task at this level
- useful_phrases: array of 2-3 objects {en, ru}
- note_ru: 2 sentences in Russian: without speech recognition the bot cannot check their exact words; they can send the same answer as TEXT for real correction
- praise: one sentence in Russian praising ONLY that they spoke (effort), NOT the content
- error_rule_tag: one grammar topic typical for this task, or "none"
- what_went_well: array with exactly 1 item in Russian about attempting to speak
- issues: []
- main_improvement: empty string
- grammar_tip: empty string
- original_fragment: empty
- correction: empty
- quality: "unknown"`;

const FOLLOWUP_SYSTEM_PROMPT = `You are an English speaking coach continuing a natural conversation.
Return ONLY valid JSON:
- follow_up_en: one short follow-up question in English (1 sentence, open-ended)
- follow_up_ru: the same question in Russian`;

const PREPARE_SYSTEM_PROMPT = `You are an English speaking coach helping a student prepare to speak.
Return ONLY valid JSON:
- phrases: array of 3 objects {en, ru} — useful starter phrases for this task
- words: array of 3 English words with Russian hints as strings like "weather — погода"`;

function demoAnalysis(transcript, taskPrompt) {
  const hasRealText = transcript?.trim() && !transcript.startsWith('(');
  return {
    corrected_text: hasRealText
      ? transcript.replace(/\bi\b/g, 'I').replace(/\bam go\b/i, 'go')
      : 'I usually wake up at seven, then I have breakfast and go to work.',
    what_went_well: hasRealText
      ? ['Ты ответил по теме — это главное.']
      : ['Ты попробовал(а) ответить — это уже шаг вперёд.'],
    issues: hasRealText
      ? [{ original: 'i', corrected: 'I', note_ru: 'Местоимение I пишется с большой буквы.' }]
      : [],
    main_improvement: hasRealText ? 'Проверь артикли и порядок слов в предложении.' : '',
    useful_phrases: [
      { en: 'I usually wake up at...', ru: 'Я обычно просыпаюсь в...' },
      { en: 'After that, I...', ru: 'После этого я...' },
    ],
    grammar_tip: hasRealText ? 'Present Simple: I wake up, not I am wake up.' : '',
    praise: hasRealText
      ? 'Неплохая попытка — ниже видишь, что именно поправить.'
      : 'Спасибо за голосовой! Для проверки твоего текста отправь ответ сообщением.',
    error_rule_tag: hasRealText ? 'present_simple' : null,
    original_fragment: hasRealText ? transcript.slice(0, 80) : '',
    correction: hasRealText ? 'I usually wake up at seven' : '',
    quality: hasRealText ? 'needs_work' : 'unknown',
    typical_mistakes: [],
    note_ru: hasRealText ? '' : 'Без распознавания речи бот не слышит твои слова. Напиши ответ текстом — проверим именно его.',
  };
}

function demoPrepareHints(taskPrompt) {
  return {
    phrases: [
      { en: 'I usually...', ru: 'Я обычно...' },
      { en: 'To be honest...', ru: 'Если честно...' },
      { en: 'The thing is...', ru: 'Дело в том, что...' },
    ],
    words: ['routine — распорядок', 'morning — утро', 'usually — обычно'],
  };
}

function demoFollowUp() {
  return {
    follow_up_en: 'What do you enjoy most about that?',
    follow_up_ru: 'Что тебе в этом нравится больше всего?',
  };
}

function tokenize(text) {
  return (text || '').toLowerCase().replace(/[^\w\s']/g, ' ').split(/\s+/).filter(Boolean);
}

const OVERPRAISE_RE = /отлич|прекрас|идеал|perfect|great job|well done|всё хорошо|все хорошо|без ошибок|правильн|молодец|верно|хорошо постро|справил/i;
const FALSE_STRENGTH_RE = /правильн|верно|без ошибок|отличн|идеальн|perfectly|correctly built/i;

function textsDifferMeaningfully(original, corrected) {
  const orig = (original || '').trim();
  const corr = (corrected || '').trim();
  if (!orig || !corr) return false;
  if (orig === corr) return false;
  if (orig.toLowerCase() === corr.toLowerCase()) return true;

  const a = tokenize(original);
  const b = tokenize(corrected);
  if (!a.length || !b.length) return orig !== corr;
  const setB = new Set(b);
  const uniqueInA = a.filter((w) => !setB.has(w)).length;
  return uniqueInA >= 2 || Math.abs(a.length - b.length) >= 3 || orig !== corr;
}

function sanitizeWhatWentWell(items, hasIssues) {
  if (!hasIssues) return items;
  const filtered = (items || []).filter((item) => !FALSE_STRENGTH_RE.test(item));
  if (filtered.length) return filtered.slice(0, 2);
  return ['Ты ответил(а) на вопрос — это уже шаг вперёд.'];
}

function sanitizePraise(praise, hasIssues) {
  if (!hasIssues) return praise || 'Спасибо за ответ!';
  if (OVERPRAISE_RE.test(praise || '')) {
    return 'Спасибо за ответ! Есть ошибки — смотри исправления ниже.';
  }
  return praise || 'Спасибо за ответ! Есть что поправить.';
}

function enforceHonestFeedback(analysis, transcript) {
  if (analysis.noTranscript || !transcript?.trim()) return analysis;

  let { issues, quality, main_improvement, grammar_tip, praise, what_went_well } = analysis;
  issues = issues || [];

  if (issues.length === 0 && textsDifferMeaningfully(transcript, analysis.corrected_text)) {
    quality = 'needs_work';
    if (analysis.original_fragment && analysis.correction
      && analysis.original_fragment !== analysis.correction) {
      issues = [{
        original: analysis.original_fragment,
        corrected: analysis.correction,
        noteRu: main_improvement || grammar_tip || 'Обрати внимание на эту часть.',
      }];
    } else {
      issues = [{
        original: transcript.slice(0, 100),
        corrected: analysis.corrected_text.slice(0, 100),
        noteRu: 'Твой вариант отличается от правильного — сравни с исправленным текстом.',
      }];
    }
    if (!main_improvement) {
      main_improvement = 'Есть ошибки — посмотри блок «Исправления» и улучшенный вариант.';
    }
  }

  const hasIssues = issues.length > 0;

  if (hasIssues) {
    quality = quality === 'strong' ? 'ok' : 'needs_work';
    praise = sanitizePraise(praise, true);
    what_went_well = sanitizeWhatWentWell(what_went_well, true);
  }

  return {
    ...analysis,
    issues,
    quality,
    main_improvement,
    grammar_tip,
    praise,
    what_went_well,
  };
}

function normalizeAnalysis(raw, transcript, voiceOnly = false) {
  const corrected = raw.corrected_text || raw.correctedText || transcript;
  const whatWentWell = raw.what_went_well || raw.whatWentWell;
  const usefulPhrases = raw.useful_phrases || raw.usefulPhrases;
  const issues = raw.issues || [];
  const mainImprovement = raw.main_improvement || raw.mainImprovement || '';
  const grammarTip = raw.grammar_tip || raw.grammarTip || '';
  const errorTag = raw.error_rule_tag || raw.errorRuleTag || 'general';
  const noTranscript = raw.mode === 'no_transcript' || (voiceOnly && !transcript?.trim());
  const quality = raw.quality || (issues.length ? 'needs_work' : 'ok');

  const normalizedIssues = Array.isArray(issues)
    ? issues.slice(0, 3).map((item) => ({
      original: item.original || item.wrong || '',
      corrected: item.corrected || item.right || '',
      noteRu: item.note_ru || item.noteRu || '',
    })).filter((item) => item.original || item.corrected)
    : [];

  let praise = raw.praise || 'Спасибо за ответ!';
  if (!noTranscript && normalizedIssues.length > 0) {
    praise = sanitizePraise(praise, true);
  }

  const whatWentWellFinal = sanitizeWhatWentWell(
    Array.isArray(whatWentWell) && whatWentWell.length
      ? whatWentWell.slice(0, 3)
      : (noTranscript ? ['Ты записал(а) голосовой — это тренирует уверенность.'] : ['Ты ответил на задание.']),
    normalizedIssues.length > 0,
  );

  return enforceHonestFeedback({
    corrected_text: corrected,
    what_went_well: whatWentWellFinal,
    useful_phrases: Array.isArray(usefulPhrases) ? usefulPhrases.slice(0, 3) : [],
    issues: normalizedIssues,
    typical_mistakes: Array.isArray(raw.typical_mistakes || raw.typicalMistakes)
      ? (raw.typical_mistakes || raw.typicalMistakes).slice(0, 3).map((item) => ({
        wrong: item.wrong || item.original || '',
        right: item.right || item.corrected || '',
        noteRu: item.note_ru || item.noteRu || '',
      }))
      : [],
    main_improvement: mainImprovement,
    grammar_tip: grammarTip,
    praise,
    error_rule_tag: errorTag === 'none' ? null : errorTag,
    original_fragment: raw.original_fragment || raw.originalFragment || (transcript || '').slice(0, 100),
    correction: raw.correction || corrected,
    quality,
    noTranscript,
    note_ru: raw.note_ru || raw.noteRu || '',
  }, transcript);
}

async function callJson(client, systemPrompt, userContent, temperature = 0.4) {
  const response = await client.chat.completions.create({
    model: getModel(),
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature,
  });
  return JSON.parse(response.choices[0]?.message?.content || '{}');
}

/**
 * @param {string} transcript
 * @param {string} taskPrompt
 * @param {string} level
 * @param {{ forceDemo?: boolean, voiceOnly?: boolean }} options
 */
async function analyzeAnswer(transcript, taskPrompt, level, options = {}) {
  if (config.demoMode || (options.forceDemo && !config.deepseekApiKey)) {
    return { ...normalizeAnalysis(demoAnalysis(transcript, taskPrompt), transcript, false), demo: true };
  }

  const client = getLlmClient();
  if (!client) {
    return { ...normalizeAnalysis(demoAnalysis(transcript, taskPrompt), transcript, false), demo: true };
  }

  const voiceOnly = options.voiceOnly || !transcript?.trim();
  const systemPrompt = voiceOnly ? VOICE_ONLY_PROMPT : FLUENCY_SYSTEM_PROMPT;
  const userContent = voiceOnly
    ? `Student level: ${level}\nSpeaking task: ${taskPrompt}\nThe student sent a voice message.`
    : `Student level: ${level}\nTask: ${taskPrompt}\nStudent answer (transcript): ${transcript}`;

  try {
    const raw = await callJson(client, systemPrompt, userContent, 0.25);
    const normalized = normalizeAnalysis(raw, transcript, voiceOnly);
    return { ...normalized, demo: false, voiceOnly: normalized.noTranscript };
  } catch (err) {
    console.error('LLM error:', err.message);
    if (isRecoverableAiError(err)) {
      return {
        ...normalizeAnalysis(demoAnalysis(transcript, taskPrompt), transcript, false),
        demo: true,
        fallbackReason: isQuotaError(err) ? 'quota' : 'connection',
      };
    }
    throw err;
  }
}

/**
 * @param {string} taskPrompt
 * @param {string} transcript
 * @param {string} level
 */
async function generateFollowUpQuestion(taskPrompt, transcript, level) {
  const client = getLlmClient();
  if (!client) return demoFollowUp();

  try {
    const raw = await callJson(
      client,
      FOLLOWUP_SYSTEM_PROMPT,
      `Level: ${level}\nOriginal task: ${taskPrompt}\nStudent answer: ${transcript || '(voice answer)'}`,
      0.6,
    );
    return {
      follow_up_en: raw.follow_up_en || raw.followUpEn || demoFollowUp().follow_up_en,
      follow_up_ru: raw.follow_up_ru || raw.followUpRu || demoFollowUp().follow_up_ru,
    };
  } catch (err) {
    console.error('Follow-up LLM error:', err.message);
    return demoFollowUp();
  }
}

/**
 * @param {string} taskPrompt
 * @param {string} level
 */
async function generatePrepareHints(taskPrompt, level) {
  const client = getLlmClient();
  if (!client) return demoPrepareHints(taskPrompt);

  try {
    const raw = await callJson(
      client,
      PREPARE_SYSTEM_PROMPT,
      `Level: ${level}\nSpeaking task: ${taskPrompt}`,
      0.5,
    );
    const phrases = raw.phrases || raw.starter_phrases || demoPrepareHints(taskPrompt).phrases;
    const words = raw.words || demoPrepareHints(taskPrompt).words;
    return {
      phrases: Array.isArray(phrases) ? phrases.slice(0, 3) : demoPrepareHints(taskPrompt).phrases,
      words: Array.isArray(words) ? words.slice(0, 3) : demoPrepareHints(taskPrompt).words,
    };
  } catch (err) {
    console.error('Prepare hints LLM error:', err.message);
    return demoPrepareHints(taskPrompt);
  }
}

/**
 * @param {string} transcript
 * @param {string} followUpPrompt
 * @param {string} level
 * @param {{ voiceOnly?: boolean }} options
 */
async function analyzeFollowUpAnswer(transcript, followUpPrompt, level, options = {}) {
  const client = getLlmClient();
  const voiceOnly = options.voiceOnly || !transcript?.trim();

  if (!client) {
    return {
      corrected_text: 'That is a great point. I really enjoy it because it helps me relax.',
      praise: 'Отлично — ты поддержал разговор!',
      demo: true,
    };
  }

  const systemPrompt = voiceOnly
    ? `Speech-to-text unavailable. Return JSON: mode "no_transcript", corrected_text as model answer, praise only about speaking effort, note_ru explaining they should send TEXT for real check.`
    : `You are an English speaking coach. The student answered a follow-up question. Be HONEST about errors.
Return ONLY valid JSON:
- corrected_text: improved version (1-3 sentences)
- issues: array of up to 2 objects {original, corrected, note_ru} if there were mistakes; else []
- praise: one honest encouraging sentence in Russian`;

  const userContent = voiceOnly
    ? `Level: ${level}\nFollow-up question: ${followUpPrompt}\nStudent sent a voice message.`
    : `Level: ${level}\nFollow-up question: ${followUpPrompt}\nStudent answer: ${transcript}`;

  try {
    const raw = await callJson(client, systemPrompt, userContent, 0.25);
    const issues = Array.isArray(raw.issues) ? raw.issues : [];
    let praise = raw.praise || (voiceOnly ? 'Спасибо, что продолжил(а) разговор!' : 'Хорошо, что поддержал(а) диалог!');
    if (!voiceOnly && issues.length && /отлич|прекрас|идеал/i.test(praise)) {
      praise = 'Неплохо для follow-up — ниже мелкие правки.';
    }
    return {
      corrected_text: raw.corrected_text || raw.correctedText || transcript,
      praise,
      issues,
      voiceOnly,
      demo: false,
    };
  } catch (err) {
    console.error('Follow-up analysis error:', err.message);
    return {
      corrected_text: transcript || 'Thanks for sharing more!',
      praise: 'Хорошо, что продолжил(а) разговор!',
      demo: true,
    };
  }
}

/**
 * @param {Array<{rule_tag:string, count:number}>} topErrors
 */
async function generateWeeklyExercise(topErrors) {
  const client = getLlmClient();
  const rulesText = topErrors.map((e) => `${e.rule_tag} (${e.count}x)`).join(', ');

  if (!client) {
    return {
      summary: topErrors.map((e) => `• ${e.rule_tag}: ${e.count} раз`).join('\n'),
      miniExercise: 'Запиши голосом 3 предложения на тему прошлой недели, стараясь избежать этих ошибок.',
    };
  }

  const response = await client.chat.completions.create({
    model: getModel(),
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'Return JSON: { summary: string (Russian bullet list of top errors), miniExercise: string (short SPEAKING exercise in Russian — ask to record voice, not fill-in-blanks) }',
      },
      {
        role: 'user',
        content: `Weekly error tags: ${rulesText}. Create a brief weekly review and one speaking mini-exercise (voice recording).`,
      },
    ],
    temperature: 0.5,
  });

  return JSON.parse(response.choices[0]?.message?.content || '{}');
}

module.exports = {
  analyzeAnswer,
  analyzeFollowUpAnswer,
  generateFollowUpQuestion,
  generatePrepareHints,
  generateWeeklyExercise,
};
