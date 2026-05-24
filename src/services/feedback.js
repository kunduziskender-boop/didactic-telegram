/**
 * Format fluency-first feedback for Telegram.
 * @param {object} result
 * @param {{ isFollowUp?: boolean, voiceOnly?: boolean, usedDemo?: boolean }} options
 */
function formatFluencyFeedback(result, options = {}) {
  if (options.isFollowUp) {
    const hasIssues = (result.issues?.length ?? 0) > 0;
    const offTopic = result.relevance === 'off_topic' || result.relevance === 'nonsense';
    const lines = [
      hasIssues || offTopic ? `📝 ${result.praise}` : `✅ ${result.praise}`,
    ];

    if (offTopic) {
      lines.push('', `⚠️ ${result.relevanceNoteRu || 'Ответ не по теме follow-up вопроса.'}`);
    } else if (result.relevance === 'partial') {
      lines.push('', `⚠️ ${result.relevanceNoteRu || 'Ответ слишком короткий или неполный.'}`);
    }

    lines.push('', `📝 Ваш ответ:\n${result.transcript}`, '');

    if (hasIssues) {
      lines.push('🔧 Исправления:');
      for (const issue of result.issues) {
        const orig = issue.original || issue.wrong;
        const fixed = issue.corrected || issue.right;
        lines.push(`• "${orig}" → "${fixed}"${issue.noteRu || issue.note_ru ? ` — ${issue.noteRu || issue.note_ru}` : ''}`);
      }
      lines.push('');
    }

    lines.push(`✏️ Как можно сказать естественнее:\n${result.correctedText}`);

    if (result.mainImprovement) {
      lines.push('', `💡 Главное улучшение:\n${result.mainImprovement}`);
    }
    if (options.voiceOnly) {
      lines.push('', 'ℹ️ Follow-up по голосу без распознавания — напиши ответ текстом для точной проверки.');
    }
    return lines.join('\n').trim();
  }

  if (result.noTranscript || (options.voiceOnly && !result.transcript?.trim()) || result.sttUnreliable || result.sttFailed) {
    const heardLine = result.sttHeard
      ? `\n\n🎧 Whisper услышал только: «${result.sttHeard}»\nСкорее всего это **ошибка распознавания**, а не твой ответ.`
      : '';
    const failLine = result.sttFailed
      ? '\n\n🎧 Не удалось распознать аудио. Запиши **ещё раз громче** (5–15 сек) или напиши **текстом**.'
      : '';
    const example = result.correctedText?.trim()
      || 'I want to travel to Japan because I love the culture and the food there.';
    const lines = [
      `✅ ${result.praise || 'Спасибо за голосовой!'}`,
      '',
      result.sttFailed
        ? 'ℹ️ Аудио не распозналось — бот **не оценивает** это как неправильный ответ.'
        : 'ℹ️ Голос распознан ненадёжно — бот **не оценивает** такой ответ как неправильный.',
      heardLine,
      failLine,
      result.noteRu || '',
      '',
      '📘 Пример хорошего ответа:',
      example,
    ].filter(Boolean);

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
  const offTopic = result.relevance === 'off_topic' || result.relevance === 'nonsense';
  const header = hasIssues || offTopic
    ? `📝 ${result.praise}`
    : `✅ ${result.praise}`;
  const lines = [header, ''];

  if (offTopic) {
    lines.push(`⚠️ ${result.relevanceNoteRu || 'Ответ не по теме задания.'}`, '');
  } else if (result.relevance === 'partial') {
    lines.push(`⚠️ ${result.relevanceNoteRu || 'Ответ слишком короткий или неполный — раскрой мысль подробнее.'}`, '');
  }

  if (hasIssues) {
    lines.push('📌 Есть ошибки — это нормально, смотри правки ниже.', '');
  } else if (result.quality === 'strong' && !offTopic) {
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
    '🎤 Запиши голосовой ответ на английском (**5–15 секунд**, не короче!).',
    '✍️ Или **напиши ответ текстом** — тогда бот проверит именно его (особенно если Whisper ошибётся).',
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
