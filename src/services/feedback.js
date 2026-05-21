/**
 * Format fluency-first feedback for Telegram.
 * @param {object} result
 * @param {{ isFollowUp?: boolean, voiceOnly?: boolean, usedDemo?: boolean }} options
 */
function formatFluencyFeedback(result, options = {}) {
  if (options.isFollowUp) {
    const lines = [
      `✅ ${result.praise}`,
      '',
      `📝 Ваш ответ:\n${result.transcript}`,
      '',
      `✏️ Как можно сказать естественнее:\n${result.correctedText}`,
    ];
    if (result.issues?.length) {
      lines.push('', '🔧 Исправления:');
      for (const issue of result.issues) {
        const orig = issue.original || issue.wrong;
        const fixed = issue.corrected || issue.right;
        lines.push(`• "${orig}" → "${fixed}"${issue.noteRu || issue.note_ru ? ` — ${issue.noteRu || issue.note_ru}` : ''}`);
      }
    }
    if (options.voiceOnly) {
      lines.push('', 'ℹ️ Follow-up по голосу без распознавания — напиши ответ текстом для точной проверки.');
    }
    return lines.join('\n').trim();
  }

  if (result.noTranscript || (options.voiceOnly && !result.transcript?.trim())) {
    const lines = [
      `✅ ${result.praise}`,
      '',
      'ℹ️ Без распознавания речи бот не слышит твои слова.',
      result.noteRu || 'Напиши свой ответ текстом на английском — тогда проверим именно его.',
      '',
      '📘 Пример хорошего ответа:',
      result.correctedText,
    ];

    if (result.typicalMistakes?.length) {
      lines.push('', '⚠️ Типичные ошибки на этом задании:');
      for (const m of result.typicalMistakes) {
        lines.push(`• "${m.wrong}" → "${m.right}"${m.noteRu ? ` — ${m.noteRu}` : ''}`);
      }
    }

    if (result.usefulPhrases?.length) {
      lines.push('', '💬 Полезные фразы:');
      for (const phrase of result.usefulPhrases) {
        const en = typeof phrase === 'string' ? phrase : phrase.en;
        const ru = typeof phrase === 'object' ? phrase.ru : null;
        lines.push(ru ? `• "${en}" — ${ru}` : `• "${en}"`);
      }
    }

    lines.push('', '💡 Совет: отправь тот же ответ текстом — получишь честную проверку.');
    return lines.join('\n').trim();
  }

  const hasIssues = (result.issues?.length ?? 0) > 0;
  const header = hasIssues
    ? `📝 ${result.praise}`
    : `✅ ${result.praise}`;
  const lines = [header, ''];

  if (hasIssues) {
    lines.push('📌 Есть ошибки — это нормально, смотри правки ниже.', '');
  } else if (result.quality === 'strong') {
    lines.push('📌 Ответ сильный для твоего уровня!', '');
  }

  if (result.whatWentWell?.length && !hasIssues) {
    lines.push('🌟 Что получилось:');
    for (const item of result.whatWentWell) {
      lines.push(`• ${item}`);
    }
    lines.push('');
  } else if (result.whatWentWell?.length && hasIssues) {
    lines.push('💪 Что уже ок:');
    for (const item of result.whatWentWell) {
      lines.push(`• ${item}`);
    }
    lines.push('');
  }

  lines.push(`📝 Ваш ответ:\n${result.transcript}`, '');

  if (hasIssues) {
    lines.push('🔧 Исправления:');
    for (const issue of result.issues) {
      lines.push(`• "${issue.original}" → "${issue.corrected}"${issue.noteRu ? ` — ${issue.noteRu}` : ''}`);
    }
    lines.push('');
  }

  lines.push(`✏️ Правильный вариант:\n${result.correctedText}`, '');

  if (result.usefulPhrases?.length) {
    lines.push('💬 Фразы на сегодня:');
    for (const phrase of result.usefulPhrases) {
      const en = typeof phrase === 'string' ? phrase : phrase.en;
      const ru = typeof phrase === 'object' ? phrase.ru : null;
      lines.push(ru ? `• "${en}" — ${ru}` : `• "${en}"`);
    }
    lines.push('');
  }

  if (result.mainImprovement) {
    lines.push(`💡 Главное улучшение:\n${result.mainImprovement}`, '');
  }

  if (result.grammarTip) {
    lines.push(`📘 Grammar:\n${result.grammarTip}`, '');
  }

  if (options.usedDemo) {
    lines.push('⚠️ AI временно недоступен — показан демо-ответ.');
  }

  return lines.join('\n').trim();
}

function formatPrepareHints(hints) {
  const lines = [
    '🧠 **Prepare → Speak** (30 секунд)',
    '',
    'Полезные фразы для старта:',
  ];

  for (const phrase of hints.phrases || []) {
    const en = phrase.en || phrase;
    const ru = phrase.ru;
    lines.push(ru ? `• "${en}" — ${ru}` : `• "${en}"`);
  }

  if (hints.words?.length) {
    lines.push('', 'Слова, которые можно вставить:');
    for (const word of hints.words) {
      lines.push(`• ${word}`);
    }
  }

  lines.push(
    '',
    '🎤 Запиши голосовой ответ на английском (30–60 сек).',
    '✍️ Или **напиши ответ текстом** — тогда бот проверит именно его (особенно если нет Whisper).',
  );
  return lines.join('\n');
}

function formatFollowUpPrompt(followUp) {
  return (
    '💬 **Продолжим разговор!**\n\n'
    + `🇬🇧 ${followUp.follow_up_en || followUp.followUpEn}\n\n`
    + `🇷🇺 ${followUp.follow_up_ru || followUp.followUpRu}\n\n`
    + '🎤 Ответь голосом — или ✍️ текстом для точной проверки.'
  );
}

module.exports = { formatFluencyFeedback, formatPrepareHints, formatFollowUpPrompt };
