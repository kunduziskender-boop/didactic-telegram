const OpenAI = require('openai');
const config = require('../config');
const { isRecoverableAiError, isQuotaError } = require('./openaiClient');
const { getEnglishLocalePrompt } = require('../data/englishLocale');

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
  if (config.openaiLlmEnabled) {
    const openai = require('./openaiClient').getOpenAIClient();
    if (openai) return openai;
  }
  if (config.deepseekLlmEnabled && getDeepSeek()) return getDeepSeek();
  if (config.openaiLlmEnabled) return require('./openaiClient').getOpenAIClient();
  return null;
}

function getModel() {
  if (config.openaiLlmEnabled) return config.llmModel;
  if (config.deepseekLlmEnabled) return 'deepseek-chat';
  return config.llmModel;
}

const FLUENCY_SYSTEM_PROMPT = `Ты — English speaking coach в Telegram-боте Fluency Coach Bot (@DailyGabBot).

ЦЕЛЬ
Помочь пользователю уверенно говорить на английском. Fluency важнее идеальной грамматики, но ошибки и неверные ответы нужно называть честно и конкретно.

ВХОД
- level: A1 | A2 | B1 | B2 | C1
- task: speaking-задание (EN)
- student_answer: транскript (EN) ИЛИ marker: "voice_only_no_transcript"

АЛГОРИТМ ПРОВЕРКИ (строго по порядку)
1. РЕЛЕВАНТНОСТЬ — ответил ли ученик именно на task?
   - off_topic: другая тема, бессмыслица, случайные слова, ответ не на тот вопрос
   - partial: слишком коротко (< 3 слов для open-ended), только намёк на тему, не раскрыто
   - on_topic: ответ по смыслу соответствует task
2. ОШИБКИ — грамматика, время, артикль, порядок слов, лексика, регистр
3. ИСПРАВЛЕНИЕ — corrected_text: как правильно ответить на task (не выдумывай чужие факты)

ЖЁСТКИЕ ПРАВИЛА (нарушать нельзя)
1. Ответ — ТОЛЬКО валидный JSON. Без текста до или после JSON. Без markdown.
2. Если student_answer — реальный транскript:
   - Сначала выставь relevance: on_topic | partial | off_topic | nonsense
   - Если relevance = off_topic или nonsense → issues ОБЯЗАН быть непустым, quality = "needs_work"
   - Если relevance = partial → issues непустой только если ответ реально неполный/короткий
   - Если ответ правильный и по теме, без ошибок → issues = [], quality = "strong", praise может хвалить
   - issues обязан быть непустым только если есть реальная ошибка ИЛИ ответ явно не по теме
   - Если issues не пустой → quality = "needs_work" или "ok", но НЕ "strong"
   - Если issues не пустой → praise НЕ содержит: "правильно", "идеально", "отлично", "молодец", "без ошибок", "perfect", "well done", "верно"
   - Если issues не пустой → what_went_well только про усилие ("попробовал ответить"), НЕ про правильность
   - main_improvement обязателен, если issues не пустой
   - НЕ хвали за правильность, если ответ off-topic или с ошибками
3. Если marker = "voice_only_no_transcript":
   - mode = "no_transcript", issues = [], quality = "unknown", relevance = "unknown"
   - НЕ придумывай original_fragment и конкретные ошибки пользователя
4. corrected_text — улучшенный вариант ответа ученика; если ошибок нет, может совпадать с transcript
5. grammar_tip — максимум 1–2 предложения на русском; "" если ошибок нет
6. useful_phrases — 2–3 объекта {en, ru}

ПРИМЕРЫ off_topic
- Task: "What places do you like to visit?" → Answer: "you" / "yes" / "I like pizza" → off_topic
- Task: "Describe your morning routine" → Answer: "My name is John" → off_topic
- Task: "What do you do in free time?" → Answer: "Good" → partial

САМОПРОВЕРКА ПЕРЕД ОТВЕТОМ
- off-topic, но issues пустой? → исправь
- praise хвалит при ошибках? → перепиши
- corrected_text просто косметически правит бессмыслицу вместо ответа на task? → перепиши corrected_text

JSON-СХЕМА (transcript):
{
  "relevance": "on_topic|partial|off_topic|nonsense",
  "relevance_note_ru": "string",
  "corrected_text": "string",
  "what_went_well": ["string"],
  "issues": [{"original": "string", "corrected": "string", "note_ru": "string"}],
  "main_improvement": "string",
  "useful_phrases": [{"en": "string", "ru": "string"}],
  "grammar_tip": "string",
  "praise": "string",
  "error_rule_tag": "string",
  "original_fragment": "string",
  "correction": "string",
  "quality": "strong|ok|needs_work"
}

ТОН
Тёплый коуч, но честный. Русский — простой. Английский — естественный, по уровню ученика.`;

function withEnglishLocale(base) {
  return `${base}\n\n${getEnglishLocalePrompt(config.englishVariant)}`;
}

function getVoiceOnlyPrompt() {
  return `${withEnglishLocale(FLUENCY_SYSTEM_PROMPT)}

РЕЖИМ voice_only_no_transcript — student_answer = marker: "voice_only_no_transcript".

JSON-СХЕМА (voice_only):
{
  "mode": "no_transcript",
  "corrected_text": "string",
  "typical_mistakes": [{"wrong": "string", "right": "string", "note_ru": "string"}],
  "useful_phrases": [{"en": "string", "ru": "string"}],
  "note_ru": "string",
  "praise": "string",
  "what_went_well": ["string"],
  "issues": [],
  "main_improvement": "",
  "grammar_tip": "",
  "original_fragment": "",
  "correction": "",
  "error_rule_tag": "string",
  "quality": "unknown"
}`;
}

function getFollowUpAnalysisPrompt() {
  return `${withEnglishLocale(FLUENCY_SYSTEM_PROMPT)}

Контекст: это follow-up вопрос в диалоге. task = follow-up question.
Проверяй, ответил ли ученик именно на follow-up question, а не на исходное задание.`;
}

function getFollowUpSystemPrompt() {
  return `${withEnglishLocale(`You are an English speaking coach continuing a natural conversation.
Return ONLY valid JSON:
- follow_up_en: one short follow-up question in English (1 sentence, open-ended)
- follow_up_ru: the same question in Russian`)}`;
}

function getPrepareSystemPrompt() {
  return `${withEnglishLocale(`You are an English speaking coach helping a student prepare to speak.
Return ONLY valid JSON:
- phrases: array of 3 objects {en, ru} — useful starter phrases for this task
- words: array of 3 English words with Russian hints as strings like "weather — погода"`)}`;
}

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
const FALSE_STRENGTH_RE = /правильн|верно|без ошибок|отличн|идеальн|perfectly|correctly built|ответил на задание|ответил на вопрос|по теме/i;
const CYRILLIC_RE = /[\u0400-\u04FF]/;
const OFF_TOPIC_NOTE_RE = /не по теме|off.topic|не отвечает|не раскрывает|слишком коротк|на английском/i;

function wordCount(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

function isYesNoTask(taskPrompt) {
  const task = (taskPrompt || '').trim();
  if (!task) return false;
  return /^(do|does|did|is|are|was|were|have|has|can|will|would)\b/i.test(task)
    && wordCount(task) <= 14;
}

function shouldTrustLlmVerdict(analysis) {
  if ((analysis.issues || []).length > 0) return false;
  if (analysis.relevance === 'off_topic' || analysis.relevance === 'nonsense') return false;
  if (analysis.relevance === 'partial') return false;
  if (analysis.quality === 'needs_work') return false;
  return true;
}

function hasOffTopicIssue(issues) {
  return (issues || []).some((item) => OFF_TOPIC_NOTE_RE.test(item.noteRu || item.note_ru || ''));
}

function pushIssue(issues, issue) {
  const exists = issues.some(
    (item) => item.noteRu === issue.noteRu && item.original === issue.original,
  );
  if (!exists) issues.push(issue);
}

function validateAnswerQuality(analysis, transcript, taskPrompt) {
  if (analysis.noTranscript || !transcript?.trim()) return analysis;

  let {
    issues,
    quality,
    relevance,
    relevance_note_ru,
    praise,
    main_improvement,
    what_went_well,
    corrected_text,
  } = analysis;
  issues = [...(issues || [])];
  relevance = relevance || analysis.relevance || 'on_topic';
  relevance_note_ru = relevance_note_ru || analysis.relevanceNoteRu || '';

  if (CYRILLIC_RE.test(transcript) && !issues.some((item) => /английск/i.test(item.noteRu || ''))) {
    pushIssue(issues, {
      original: transcript.slice(0, 100),
      corrected: (corrected_text || '').slice(0, 100),
      noteRu: 'На speaking-задание нужно отвечать на английском.',
    });
    relevance = 'partial';
  }

  const wc = wordCount(transcript);
  if (wc < 3 && !isYesNoTask(taskPrompt) && issues.length === 0) {
    pushIssue(issues, {
      original: transcript,
      corrected: (corrected_text || '').slice(0, 120),
      noteRu: wc <= 1
        ? 'Ответ не по теме или слишком короткий — нужно 2–4 предложения по заданию.'
        : 'Ответ слишком короткий — раскрой мысль подробнее.',
    });
    relevance = wc <= 1 ? 'off_topic' : 'partial';
    if (!main_improvement) {
      main_improvement = 'Ответь полнее на вопрос задания: что, где, почему, как часто.';
    }
  }

  if ((relevance === 'off_topic' || relevance === 'nonsense') && !hasOffTopicIssue(issues)) {
    pushIssue(issues, {
      original: transcript.slice(0, 100),
      corrected: (corrected_text || '').slice(0, 120),
      noteRu: relevance_note_ru || 'Ответ не по теме задания.',
    });
    quality = 'needs_work';
  }

  return {
    ...analysis,
    issues,
    quality,
    relevance,
    relevance_note_ru,
    main_improvement,
    praise,
    what_went_well,
  };
}

function textsDifferMeaningfully(original, corrected) {
  const orig = (original || '').trim();
  const corr = (corrected || '').trim();
  if (!orig || !corr) return false;
  if (orig === corr) return false;
  if (orig.toLowerCase() === corr.toLowerCase()) return false;

  const a = tokenize(original);
  const b = tokenize(corrected);
  if (!a.length || !b.length) return orig !== corr;
  const setB = new Set(b);
  const uniqueInA = a.filter((w) => !setB.has(w)).length;
  const uniqueInB = b.filter((w) => !new Set(a).has(w)).length;
  return uniqueInA >= 3 || uniqueInB >= 3 || Math.abs(a.length - b.length) >= 5;
}

function sanitizeWhatWentWell(items, hasIssues) {
  if (!hasIssues) return items;
  const filtered = (items || []).filter((item) => !FALSE_STRENGTH_RE.test(item));
  if (filtered.length) return filtered.slice(0, 2);
  return ['Ты попробовал(а) ответить — это уже шаг вперёд.'];
}

function sanitizePraise(praise, hasIssues) {
  if (!hasIssues) return praise || 'Спасибо за ответ!';
  if (OVERPRAISE_RE.test(praise || '')) {
    return 'Спасибо за ответ! Есть ошибки — смотри исправления ниже.';
  }
  return praise || 'Спасибо за ответ! Есть что поправить.';
}

function enforceHonestFeedback(analysis, transcript, taskPrompt = '') {
  if (analysis.noTranscript || !transcript?.trim()) return analysis;

  let validated = validateAnswerQuality(analysis, transcript, taskPrompt);
  let { issues, quality, main_improvement, grammar_tip, praise, what_went_well } = validated;
  issues = issues || [];

  if (shouldTrustLlmVerdict(validated)) {
    return {
      ...validated,
      issues: [],
      quality: validated.quality === 'needs_work' ? 'ok' : validated.quality,
      corrected_text: transcript.trim(),
      praise: praise || 'Хороший ответ — ты ответил по теме!',
      what_went_well: what_went_well?.length
        ? what_went_well
        : ['Ты ответил на задание и сформулировал мысль.'],
    };
  }

  const fragment = validated.original_fragment?.trim();
  const correction = validated.correction?.trim();
  if (
    issues.length === 0
    && fragment
    && correction
    && fragment !== correction
    && fragment.length <= 120
  ) {
    issues = [{
      original: fragment,
      corrected: correction,
      noteRu: main_improvement || grammar_tip || 'Обрати внимание на эту часть.',
    }];
    if (!main_improvement) {
      main_improvement = 'Есть ошибки — посмотри блок «Исправления» и улучшенный вариант.';
    }
  }

  const hasIssues = issues.length > 0;

  if (hasIssues) {
    quality = quality === 'strong' ? 'ok' : 'needs_work';
    if (validated.relevance === 'off_topic' || validated.relevance === 'nonsense') {
      praise = 'Спасибо за ответ! Но он не по теме задания — смотри правильный вариант ниже.';
    } else {
      praise = sanitizePraise(praise, true);
    }
    what_went_well = sanitizeWhatWentWell(what_went_well, true);
  }

  return {
    ...validated,
    issues,
    quality,
    main_improvement,
    grammar_tip,
    praise,
    what_went_well,
  };
}

function normalizeAnalysis(raw, transcript, voiceOnly = false, taskPrompt = '') {
  const corrected = raw.corrected_text || raw.correctedText || transcript;
  const whatWentWell = raw.what_went_well || raw.whatWentWell;
  const usefulPhrases = raw.useful_phrases || raw.usefulPhrases;
  const issues = raw.issues || [];
  const mainImprovement = raw.main_improvement || raw.mainImprovement || '';
  const grammarTip = raw.grammar_tip || raw.grammarTip || '';
  const errorTag = raw.error_rule_tag || raw.errorRuleTag || 'general';
  const relevance = raw.relevance || 'on_topic';
  const relevanceNoteRu = raw.relevance_note_ru || raw.relevanceNoteRu || '';
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
      : (noTranscript
        ? ['Ты записал(а) голосовой — это тренирует уверенность.']
        : (normalizedIssues.length ? [] : ['Ты ответил на задание.'])),
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
    relevance,
    relevance_note_ru: relevanceNoteRu,
    noTranscript,
    note_ru: raw.note_ru || raw.noteRu || '',
  }, transcript, taskPrompt);
}

async function callJson(client, systemPrompt, userContent, temperature) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await client.chat.completions.create({
        model: getModel(),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: temperature ?? config.llmTemperature,
        max_tokens: config.llmMaxTokens,
      });
      return JSON.parse(response.choices[0]?.message?.content || '{}');
    } catch (err) {
      lastErr = err;
      if (attempt === 0) continue;
      throw err;
    }
  }
  throw lastErr;
}

/**
 * @param {string} transcript
 * @param {string} taskPrompt
 * @param {string} level
 * @param {{ forceDemo?: boolean, voiceOnly?: boolean }} options
 */
async function analyzeAnswer(transcript, taskPrompt, level, options = {}) {
  if (config.demoMode || (options.forceDemo && !getLlmClient())) {
    return { ...normalizeAnalysis(demoAnalysis(transcript, taskPrompt), transcript, false, taskPrompt), demo: true };
  }

  const client = getLlmClient();
  if (!client) {
    return { ...normalizeAnalysis(demoAnalysis(transcript, taskPrompt), transcript, false, taskPrompt), demo: true };
  }

  const voiceOnly = options.voiceOnly || !transcript?.trim();
  const systemPrompt = voiceOnly ? getVoiceOnlyPrompt() : withEnglishLocale(FLUENCY_SYSTEM_PROMPT);
  const userContent = voiceOnly
    ? `Student level: ${level}\nTask: ${taskPrompt}\nstudent_answer: marker: "voice_only_no_transcript"`
    : `Student level: ${level}\nTask: ${taskPrompt}\nstudent_answer (transcript): ${transcript}\n\nЕсли ответ правильный и по теме — issues=[], quality=strong. Не ищи ошибки там, где их нет.`;

  try {
    const raw = await callJson(client, systemPrompt, userContent);
    const normalized = normalizeAnalysis(raw, transcript, voiceOnly, taskPrompt);
    return { ...normalized, demo: false, voiceOnly: normalized.noTranscript };
  } catch (err) {
    console.error('LLM error:', err.message);
    if (isRecoverableAiError(err)) {
      return {
        ...normalizeAnalysis(demoAnalysis(transcript, taskPrompt), transcript, false, taskPrompt),
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
      getFollowUpSystemPrompt(),
      `Level: ${level}\nOriginal task: ${taskPrompt}\nStudent answer: ${transcript || 'marker: "voice_only_no_transcript"'}`,
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
      getPrepareSystemPrompt(),
      `Level: ${level}\nSpeaking task: ${taskPrompt}`,
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
      corrected_text: transcript || 'That is a great point. I really enjoy it because it helps me relax.',
      praise: 'Спасибо, что продолжил(а) разговор!',
      issues: transcript?.trim() ? [] : [],
      relevance: 'unknown',
      demo: true,
    };
  }

  const systemPrompt = voiceOnly ? getVoiceOnlyPrompt() : getFollowUpAnalysisPrompt();
  const userContent = voiceOnly
    ? `Student level: ${level}\nTask (follow-up question): ${followUpPrompt}\nstudent_answer: marker: "voice_only_no_transcript"`
    : `Student level: ${level}\nTask (follow-up question): ${followUpPrompt}\nstudent_answer (transcript): ${transcript}\n\nПроверь, ответил ли ученик именно на follow-up question.`;

  try {
    const raw = await callJson(client, systemPrompt, userContent);
    const normalized = normalizeAnalysis(raw, transcript, voiceOnly, followUpPrompt);
    return {
      corrected_text: normalized.corrected_text,
      praise: normalized.praise,
      issues: normalized.issues,
      relevance: normalized.relevance,
      main_improvement: normalized.main_improvement,
      quality: normalized.quality,
      voiceOnly: normalized.noTranscript,
      demo: false,
    };
  } catch (err) {
    console.error('Follow-up analysis error:', err.message);
    return {
      corrected_text: transcript || 'Thanks for sharing more!',
      praise: 'Спасибо, что продолжил(а) разговор!',
      issues: [],
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
    temperature: config.llmTemperature,
    max_tokens: config.llmMaxTokens,
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
