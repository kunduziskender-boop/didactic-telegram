const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/connection');
const { LEVELS } = require('../data/constants');

const LEGACY_STORE_PATH = path.resolve('./data/store.json');

function normalizeTelegramId(id) {
  const n = Number(id);
  return Number.isFinite(n) ? n : id;
}

function rowToUser(row) {
  if (!row) return null;
  return {
    telegramId: row.telegram_id,
    level: row.level,
    topic: row.topic,
    onboardingCompleted: Boolean(row.onboarding_completed),
    timezone: row.timezone,
    createdAt: row.created_at,
  };
}

function rowToTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    level: row.level,
    topic: row.topic,
    promptEn: row.prompt_en,
    promptRu: row.prompt_ru,
  };
}

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowToResponse(row) {
  if (!row) return null;
  return {
    transcript: row.transcript,
    correctedText: row.corrected_text,
    grammarTip: row.grammar_tip,
    praise: row.praise,
    errorRuleTag: row.error_rule_tag,
    responseAudioPath: row.response_audio_path,
    correctedAudioPath: row.corrected_audio_path,
    shadowDone: Boolean(row.shadow_done),
    whatWentWell: parseJsonArray(row.what_went_well),
    usefulPhrases: parseJsonArray(row.useful_phrases),
    mainImprovement: row.main_improvement,
    followUpPromptEn: row.follow_up_prompt_en,
    followUpPromptRu: row.follow_up_prompt_ru,
    followUpTranscript: row.follow_up_transcript,
    followUpCorrectedText: row.follow_up_corrected_text,
    followUpPraise: row.follow_up_praise,
    followUpDone: Boolean(row.follow_up_done),
    followUpSkipped: Boolean(row.follow_up_skipped),
  };
}

function mapSessionRow(sessionRow, responseRow) {
  if (!sessionRow) return null;
  return {
    id: sessionRow.id,
    userId: sessionRow.user_id,
    taskId: sessionRow.task_id,
    sessionDate: sessionRow.session_date,
    status: sessionRow.status,
    taskSentAt: sessionRow.task_sent_at,
    completedAt: sessionRow.completed_at,
    reminderSentAt: sessionRow.reminder_sent_at,
    response: rowToResponse(responseRow),
  };
}

function scheduleVocabReview(card, rating) {
  const now = new Date();
  let repetitions = card.repetitions || 0;
  let intervalDays = card.intervalDays || 1;
  let lapses = card.lapses || 0;

  if (rating === 0) {
    repetitions = 0;
    intervalDays = 1;
    lapses += 1;
  } else if (repetitions === 0) {
    repetitions = 1;
    intervalDays = 1;
  } else if (repetitions === 1) {
    repetitions = 2;
    intervalDays = rating === 1 ? 2 : 3;
  } else {
    repetitions += 1;
    intervalDays = Math.min(Math.max(Math.round(intervalDays * (rating === 1 ? 1.3 : 2.0)), 2), 180);
  }

  const nextReviewAt = new Date(now);
  nextReviewAt.setDate(nextReviewAt.getDate() + intervalDays);

  let status = 'learning';
  if (repetitions >= 5 && intervalDays >= 14) status = 'mastered';
  else if (repetitions >= 2) status = 'reviewing';

  return {
    repetitions,
    interval_days: intervalDays,
    lapses,
    next_review_at: nextReviewAt.toISOString(),
    last_reviewed_at: now.toISOString(),
    status,
  };
}

class DbStore {
  constructor() {
    this.db = getDb();
    this.migrateLegacyStore();
    const users = this.db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    console.log(`Store loaded: ${users} user(s)`);
  }

  migrateLegacyStore() {
    if (!fs.existsSync(LEGACY_STORE_PATH)) return;
    const hasUsers = this.db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0;
    if (hasUsers) return;

    try {
      const raw = JSON.parse(fs.readFileSync(LEGACY_STORE_PATH, 'utf8'));
      const tx = this.db.transaction(() => {
        for (const [, user] of Object.entries(raw.users || {})) {
          const tid = normalizeTelegramId(user.telegramId);
          const fsm = raw.fsmStates?.[tid] || raw.fsmStates?.[String(tid)] || 'idle';
          this.db.prepare(`
            INSERT INTO users (telegram_id, level, topic, onboarding_completed, timezone, fsm_state, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            tid, user.level, user.topic, user.onboardingCompleted ? 1 : 0,
            user.timezone || 'Europe/Moscow', fsm, user.createdAt || new Date().toISOString(),
          );
        }
        for (const [tid, streak] of Object.entries(raw.streaks || {})) {
          this.db.prepare(`
            INSERT OR REPLACE INTO streaks (user_id, current_streak, longest_streak, last_completed_date)
            VALUES (?, ?, ?, ?)
          `).run(Number(tid), streak.currentStreak || 0, streak.longestStreak || 0, streak.lastCompletedDate);
        }
      });
      tx();
      fs.renameSync(LEGACY_STORE_PATH, `${LEGACY_STORE_PATH}.migrated`);
      console.log('Migrated data/store.json → SQLite');
    } catch (err) {
      console.warn('Legacy store migration skipped:', err.message);
    }
  }

  getUser(telegramId) {
    const id = normalizeTelegramId(telegramId);
    return rowToUser(this.db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(id));
  }

  ensureUser(telegramId) {
    const id = normalizeTelegramId(telegramId);
    let user = this.getUser(id);
    if (user) return user;

    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO users (telegram_id, level, topic, onboarding_completed, timezone, fsm_state, created_at)
      VALUES (?, NULL, NULL, 0, 'Europe/Moscow', 'idle', ?)
    `).run(id, now);
    this.db.prepare(`
      INSERT OR IGNORE INTO streaks (user_id, current_streak, longest_streak, last_completed_date)
      VALUES (?, 0, 0, NULL)
    `).run(id);

    return this.getUser(id);
  }

  updateUser(telegramId, patch) {
    this.ensureUser(telegramId);
    const id = normalizeTelegramId(telegramId);
    const fields = [];
    const values = [];

    if (patch.level !== undefined) { fields.push('level = ?'); values.push(patch.level); }
    if (patch.topic !== undefined) { fields.push('topic = ?'); values.push(patch.topic); }
    if (patch.onboardingCompleted !== undefined) {
      fields.push('onboarding_completed = ?');
      values.push(patch.onboardingCompleted ? 1 : 0);
    }
    if (patch.timezone !== undefined) { fields.push('timezone = ?'); values.push(patch.timezone); }

    if (fields.length) {
      values.push(id);
      this.db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE telegram_id = ?`).run(...values);
    }
    return this.getUser(id);
  }

  getFsmState(telegramId) {
    const id = normalizeTelegramId(telegramId);
    const row = this.db.prepare('SELECT fsm_state FROM users WHERE telegram_id = ?').get(id);
    return row?.fsm_state || 'idle';
  }

  setFsmState(telegramId, state) {
    this.ensureUser(telegramId);
    const id = normalizeTelegramId(telegramId);
    this.db.prepare('UPDATE users SET fsm_state = ? WHERE telegram_id = ?').run(state, id);
  }

  hasOpenDrillSession(telegramId) {
    const session = this.getTodaySession(telegramId);
    return !!session && ['pending', 'in_progress', 'processing'].includes(session.status);
  }

  todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  /** YYYY-MM-DD for task rotation window (UTC, matches session_date). */
  rotationCutoff(days = 14) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  }

  getTodaySession(telegramId) {
    const id = normalizeTelegramId(telegramId);
    const sessionRow = this.db.prepare(`
      SELECT * FROM daily_sessions WHERE user_id = ? AND session_date = ?
    `).get(id, this.todayKey());

    if (!sessionRow) return null;

    const responseRow = this.db.prepare(
      'SELECT * FROM session_responses WHERE session_id = ?',
    ).get(sessionRow.id);

    return mapSessionRow(sessionRow, responseRow);
  }

  createTodaySession(telegramId, taskId) {
    const existing = this.getTodaySession(telegramId);
    if (existing) return existing;

    const id = normalizeTelegramId(telegramId);
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO daily_sessions (user_id, task_id, session_date, status, task_sent_at)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(id, taskId, this.todayKey(), now);

    return this.getTodaySession(telegramId) || {
      id: result.lastInsertRowid,
      userId: id,
      taskId,
      sessionDate: this.todayKey(),
      status: 'pending',
      taskSentAt: now,
      completedAt: null,
      reminderSentAt: null,
      response: null,
    };
  }

  updateTodaySession(telegramId, patch) {
    const session = this.getTodaySession(telegramId);
    if (!session) return null;

    const { response, ...sessionPatch } = patch;
    const fields = [];
    const values = [];

    if (sessionPatch.status !== undefined) { fields.push('status = ?'); values.push(sessionPatch.status); }
    if (sessionPatch.taskId !== undefined) { fields.push('task_id = ?'); values.push(sessionPatch.taskId); }
    if (sessionPatch.completedAt !== undefined) {
      fields.push('completed_at = ?');
      values.push(sessionPatch.completedAt instanceof Date ? sessionPatch.completedAt.toISOString() : sessionPatch.completedAt);
    }
    if (sessionPatch.reminderSentAt !== undefined) {
      fields.push('reminder_sent_at = ?');
      values.push(sessionPatch.reminderSentAt instanceof Date ? sessionPatch.reminderSentAt.toISOString() : sessionPatch.reminderSentAt);
    }

    if (fields.length) {
      values.push(session.id);
      this.db.prepare(`UPDATE daily_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    if (response) {
      this.upsertSessionResponse(session.id, response);
    }

    return this.getTodaySession(telegramId);
  }

  upsertSessionResponse(sessionId, response) {
    const existingRow = this.db.prepare('SELECT * FROM session_responses WHERE session_id = ?').get(sessionId);
    const merged = { ...(existingRow ? rowToResponse(existingRow) : {}), ...response };

    const data = {
      transcript: merged.transcript ?? null,
      corrected_text: merged.correctedText ?? null,
      grammar_tip: merged.grammarTip ?? null,
      praise: merged.praise ?? null,
      error_rule_tag: merged.errorRuleTag ?? null,
      response_audio_path: merged.responseAudioPath ?? null,
      corrected_audio_path: merged.correctedAudioPath ?? null,
      shadow_done: merged.shadowDone ? 1 : 0,
      what_went_well: merged.whatWentWell?.length ? JSON.stringify(merged.whatWentWell) : null,
      useful_phrases: merged.usefulPhrases?.length ? JSON.stringify(merged.usefulPhrases) : null,
      main_improvement: merged.mainImprovement ?? null,
      follow_up_prompt_en: merged.followUpPromptEn ?? null,
      follow_up_prompt_ru: merged.followUpPromptRu ?? null,
      follow_up_transcript: merged.followUpTranscript ?? null,
      follow_up_corrected_text: merged.followUpCorrectedText ?? null,
      follow_up_praise: merged.followUpPraise ?? null,
      follow_up_done: merged.followUpDone ? 1 : 0,
      follow_up_skipped: merged.followUpSkipped ? 1 : 0,
    };

    if (existingRow) {
      const fields = Object.keys(data).map((k) => `${k} = ?`).join(', ');
      this.db.prepare(`UPDATE session_responses SET ${fields} WHERE session_id = ?`).run(...Object.values(data), sessionId);
    } else {
      this.db.prepare(`
        INSERT INTO session_responses (
          session_id, transcript, corrected_text, grammar_tip, praise, error_rule_tag,
          response_audio_path, corrected_audio_path, shadow_done,
          what_went_well, useful_phrases, main_improvement,
          follow_up_prompt_en, follow_up_prompt_ru,
          follow_up_transcript, follow_up_corrected_text, follow_up_praise,
          follow_up_done, follow_up_skipped
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sessionId, ...Object.values(data));
    }
  }

  updateSessionResponse(telegramId, patch) {
    const session = this.getTodaySession(telegramId);
    if (!session) return null;
    this.upsertSessionResponse(session.id, { ...(session.response || {}), ...patch });
    return this.getTodaySession(telegramId);
  }

  deleteTodaySession(telegramId) {
    const session = this.getTodaySession(telegramId);
    if (!session) return;
    this.db.prepare('DELETE FROM session_responses WHERE session_id = ?').run(session.id);
    this.db.prepare('DELETE FROM daily_sessions WHERE id = ?').run(session.id);
  }

  selectTaskForUser(telegramId) {
    const user = this.getUser(telegramId);
    if (!user?.level) return null;

    const id = normalizeTelegramId(telegramId);
    const { level, topic } = user;
    const cutoff = this.rotationCutoff(14);

    const recentUsedIds = this.db.prepare(`
      SELECT DISTINCT task_id FROM daily_sessions
      WHERE user_id = ? AND session_date >= ?
    `).all(id, cutoff).map((r) => r.task_id);

    const pick = (taskLevel, taskTopic, excludeRecent) => {
      const notRecent = excludeRecent && recentUsedIds.length
        ? `AND t.id NOT IN (${recentUsedIds.map(() => '?').join(',')})`
        : '';
      const topicClause = taskTopic === 'any' ? '1=1' : 't.topic = ?';
      const params = taskTopic === 'any'
        ? [taskLevel, ...(excludeRecent && recentUsedIds.length ? recentUsedIds : [])]
        : [taskLevel, taskTopic, ...(excludeRecent && recentUsedIds.length ? recentUsedIds : [])];

      return this.db.prepare(`
        SELECT t.* FROM tasks t
        WHERE t.active = 1 AND t.level = ?
          AND ${topicClause}
          ${notRecent}
        ORDER BY RANDOM() LIMIT 1
      `).get(...params);
    };

    const pickLeastRecent = (taskLevel, taskTopic) => {
      const topicClause = taskTopic === 'any' ? '1=1' : 't.topic = ?';
      const params = taskTopic === 'any'
        ? [id, taskLevel]
        : [id, taskLevel, taskTopic];

      return this.db.prepare(`
        SELECT t.* FROM tasks t
        LEFT JOIN (
          SELECT task_id, MAX(session_date) AS last_used
          FROM daily_sessions
          WHERE user_id = ?
          GROUP BY task_id
        ) usage ON usage.task_id = t.id
        WHERE t.active = 1 AND t.level = ?
          AND ${topicClause}
        ORDER BY usage.last_used ASC, RANDOM()
        LIMIT 1
      `).get(...params);
    };

    const userTopic = topic || 'any';
    const searchTopic = userTopic === 'any' ? 'any' : userTopic;

    let row = pick(level, searchTopic, true);
    if (!row) row = pickLeastRecent(level, searchTopic);

    if (!row && userTopic !== 'any') {
      const levelIdx = LEVELS.indexOf(level);
      const adjacent = [];
      if (levelIdx > 0) adjacent.push(LEVELS[levelIdx - 1]);
      if (levelIdx >= 0 && levelIdx < LEVELS.length - 1) adjacent.push(LEVELS[levelIdx + 1]);

      for (const adjLevel of adjacent) {
        row = pick(adjLevel, userTopic, true) || pickLeastRecent(adjLevel, userTopic);
        if (row) break;
      }
    }

    if (!row && userTopic === 'any') {
      row = pick(level, 'any', true) || pickLeastRecent(level, 'any');
    }

    return rowToTask(row);
  }

  getTaskById(taskId) {
    return rowToTask(this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId));
  }

  logError(telegramId, entry) {
    const id = normalizeTelegramId(telegramId);
    this.db.prepare(`
      INSERT INTO error_log (user_id, session_id, rule_tag, original_fragment, correction, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.sessionId || null,
      entry.ruleTag,
      entry.originalFragment || null,
      entry.correction || null,
      new Date().toISOString(),
    );
  }

  countErrors(telegramId) {
    const id = normalizeTelegramId(telegramId);
    return this.db.prepare('SELECT COUNT(*) AS c FROM error_log WHERE user_id = ?').get(id).c;
  }

  getErrorsSince(telegramId, sinceDate) {
    const id = normalizeTelegramId(telegramId);
    const since = sinceDate instanceof Date ? sinceDate.toISOString() : sinceDate;
    return this.db.prepare(`
      SELECT * FROM error_log WHERE user_id = ? AND occurred_at >= ? ORDER BY occurred_at
    `).all(id, since).map((row) => ({
      sessionId: row.session_id,
      ruleTag: row.rule_tag,
      originalFragment: row.original_fragment,
      correction: row.correction,
      occurredAt: row.occurred_at,
    }));
  }

  updateStreakOnComplete(telegramId) {
    const id = normalizeTelegramId(telegramId);
    this.ensureUser(id);
    const streak = this.db.prepare('SELECT * FROM streaks WHERE user_id = ?').get(id);
    if (!streak) return;

    const today = this.todayKey();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = yesterday.toISOString().slice(0, 10);

    let current = streak.current_streak;
    if (streak.last_completed_date === yesterdayKey) {
      current += 1;
    } else if (streak.last_completed_date !== today) {
      current = 1;
    }

    const longest = Math.max(streak.longest_streak, current);
    this.db.prepare(`
      UPDATE streaks SET current_streak = ?, longest_streak = ?, last_completed_date = ?
      WHERE user_id = ?
    `).run(current, longest, today, id);
  }

  getStreak(telegramId) {
    const id = normalizeTelegramId(telegramId);
    const row = this.db.prepare('SELECT * FROM streaks WHERE user_id = ?').get(id);
    if (!row) return { currentStreak: 0, longestStreak: 0, lastCompletedDate: null };
    return {
      currentStreak: row.current_streak,
      longestStreak: row.longest_streak,
      lastCompletedDate: row.last_completed_date,
    };
  }

  saveWeeklyReview(telegramId, review) {
    const id = normalizeTelegramId(telegramId);
    this.db.prepare(`
      INSERT INTO weekly_reviews (user_id, week_start, top_errors_json, mini_exercise, sent_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      id,
      review.weekStart,
      JSON.stringify(review.topErrors || []),
      review.miniExercise || null,
      new Date().toISOString(),
    );
  }

  getRecentPhrases(telegramId, limit = 9) {
    const id = normalizeTelegramId(telegramId);
    const rows = this.db.prepare(`
      SELECT sr.useful_phrases, ds.session_date
      FROM session_responses sr
      JOIN daily_sessions ds ON ds.id = sr.session_id
      WHERE ds.user_id = ? AND sr.useful_phrases IS NOT NULL
      ORDER BY ds.session_date DESC
      LIMIT 14
    `).all(id);

    const seen = new Set();
    const phrases = [];
    for (const row of rows) {
      for (const item of parseJsonArray(row.useful_phrases)) {
        const en = typeof item === 'string' ? item : item?.en;
        if (!en || seen.has(en)) continue;
        seen.add(en);
        phrases.push({
          en,
          ru: typeof item === 'object' ? item.ru : null,
          date: row.session_date,
        });
        if (phrases.length >= limit) return phrases;
      }
    }
    return phrases;
  }

  countCompletedSessions(telegramId) {
    const id = normalizeTelegramId(telegramId);
    return this.db.prepare(`
      SELECT COUNT(*) AS c FROM daily_sessions
      WHERE user_id = ? AND status = 'completed'
    `).get(id).c;
  }

  getActiveUsers() {
    return this.db.prepare(`
      SELECT * FROM users WHERE onboarding_completed = 1
    `).all().map(rowToUser);
  }

  getUsersNeedingReminder() {
    const today = this.todayKey();
    return this.getActiveUsers().filter((user) => {
      const session = this.db.prepare(`
        SELECT status FROM daily_sessions WHERE user_id = ? AND session_date = ?
      `).get(user.telegramId, today);
      if (!session) return true;
      return !['completed', 'skipped'].includes(session.status);
    });
  }

  rowToVocabCard(row) {
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      word: row.word,
      translationRu: row.translation_ru,
      contextEn: row.context_en,
      contextRu: row.context_ru,
      source: row.source,
      sessionId: row.session_id,
      createdAt: row.created_at,
      nextReviewAt: row.next_review_at,
      intervalDays: row.interval_days,
      repetitions: row.repetitions,
      lapses: row.lapses,
      lastReviewedAt: row.last_reviewed_at,
      status: row.status,
    };
  }

  addVocabCard(telegramId, card) {
    const id = normalizeTelegramId(telegramId);
    const now = new Date().toISOString();
    try {
      this.db.prepare(`
        INSERT INTO vocab_cards (
          user_id, word, translation_ru, context_en, context_ru, source, session_id,
          created_at, next_review_at, interval_days, repetitions, lapses, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 'learning')
      `).run(
        id,
        card.word,
        card.translationRu || card.contextRu || null,
        card.contextEn,
        card.contextRu || null,
        card.source || 'drill',
        card.sessionId || null,
        now,
        now,
      );
      return true;
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return false;
      throw err;
    }
  }

  getDueVocabCards(telegramId, limit = 5) {
    const id = normalizeTelegramId(telegramId);
    const now = new Date().toISOString();
    return this.db.prepare(`
      SELECT * FROM vocab_cards
      WHERE user_id = ? AND next_review_at <= ?
      ORDER BY next_review_at ASC
      LIMIT ?
    `).all(id, now, limit).map((row) => this.rowToVocabCard(row));
  }

  getVocabCardById(cardId) {
    const row = this.db.prepare('SELECT * FROM vocab_cards WHERE id = ?').get(cardId);
    return this.rowToVocabCard(row);
  }

  getVocabStats(telegramId) {
    const id = normalizeTelegramId(telegramId);
    const now = new Date().toISOString();
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) AS c FROM vocab_cards WHERE user_id = ? GROUP BY status
    `).all(id);
    const due = this.db.prepare(`
      SELECT COUNT(*) AS c FROM vocab_cards WHERE user_id = ? AND next_review_at <= ?
    `).get(id, now).c;
    const total = this.db.prepare(`
      SELECT COUNT(*) AS c FROM vocab_cards WHERE user_id = ?
    `).get(id).c;

    const byStatus = { learning: 0, reviewing: 0, mastered: 0 };
    for (const row of rows) byStatus[row.status] = row.c;

    return {
      total,
      due,
      learning: byStatus.learning + byStatus.reviewing,
      mastered: byStatus.mastered,
    };
  }

  reviewVocabCard(cardId, rating) {
    const card = this.getVocabCardById(cardId);
    if (!card) return null;

    const next = scheduleVocabReview(card, rating);

    this.db.prepare(`
      UPDATE vocab_cards
      SET repetitions = ?, interval_days = ?, lapses = ?, next_review_at = ?,
          last_reviewed_at = ?, status = ?
      WHERE id = ?
    `).run(
      next.repetitions,
      next.interval_days,
      next.lapses,
      next.next_review_at,
      next.last_reviewed_at,
      next.status,
      cardId,
    );

    return this.getVocabCardById(cardId);
  }

  startVocabReview(telegramId, cardIds) {
    const id = normalizeTelegramId(telegramId);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO vocab_review_sessions (user_id, card_ids_json, current_index, started_at)
      VALUES (?, ?, 0, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        card_ids_json = excluded.card_ids_json,
        current_index = 0,
        started_at = excluded.started_at
    `).run(id, JSON.stringify(cardIds), now);
  }

  getVocabReviewSession(telegramId) {
    const id = normalizeTelegramId(telegramId);
    const row = this.db.prepare(`
      SELECT * FROM vocab_review_sessions WHERE user_id = ?
    `).get(id);
    if (!row) return null;

    const cardIds = parseJsonArray(row.card_ids_json);
    if (!cardIds.length) return null;

    const index = Math.min(row.current_index, cardIds.length - 1);
    return {
      cardIds,
      currentIndex: index,
      currentCardId: cardIds[index],
      total: cardIds.length,
    };
  }

  advanceVocabReview(telegramId) {
    const id = normalizeTelegramId(telegramId);
    const session = this.getVocabReviewSession(telegramId);
    if (!session) return null;

    const nextIndex = session.currentIndex + 1;
    if (nextIndex >= session.cardIds.length) {
      this.clearVocabReviewSession(telegramId);
      return null;
    }

    this.db.prepare(`
      UPDATE vocab_review_sessions SET current_index = ? WHERE user_id = ?
    `).run(nextIndex, id);

    return {
      ...session,
      currentIndex: nextIndex,
      currentCardId: session.cardIds[nextIndex],
    };
  }

  clearVocabReviewSession(telegramId) {
    const id = normalizeTelegramId(telegramId);
    this.db.prepare('DELETE FROM vocab_review_sessions WHERE user_id = ?').run(id);
  }

  getUsersWithDueVocab() {
    const now = new Date().toISOString();
    return this.db.prepare(`
      SELECT DISTINCT user_id AS telegram_id FROM vocab_cards
      WHERE next_review_at <= ?
    `).all(now).map((row) => row.telegram_id);
  }

  getDialogueSession(telegramId) {
    const id = normalizeTelegramId(telegramId);
    const row = this.db.prepare('SELECT * FROM dialogue_sessions WHERE user_id = ?').get(id);
    if (!row) return null;
    return {
      userId: row.user_id,
      scenarioId: row.scenario_id,
      turnIndex: row.turn_index,
      maxTurns: row.max_turns,
      history: parseJsonArray(row.history_json),
      suggestedReplyEn: row.suggested_reply_en || '',
      suggestedReplyRu: row.suggested_reply_ru || '',
      startedAt: row.started_at,
    };
  }

  setDialogueSuggestion(telegramId, suggestedReplyEn, suggestedReplyRu) {
    const id = normalizeTelegramId(telegramId);
    this.db.prepare(`
      UPDATE dialogue_sessions
      SET suggested_reply_en = ?, suggested_reply_ru = ?
      WHERE user_id = ?
    `).run(suggestedReplyEn || '', suggestedReplyRu || '', id);
  }

  startDialogueSession(telegramId, scenarioId, maxTurns = 4) {
    const id = normalizeTelegramId(telegramId);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO dialogue_sessions (user_id, scenario_id, turn_index, max_turns, history_json, suggested_reply_en, suggested_reply_ru, started_at)
      VALUES (?, ?, 0, ?, '[]', NULL, NULL, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        scenario_id = excluded.scenario_id,
        turn_index = 0,
        max_turns = excluded.max_turns,
        history_json = '[]',
        suggested_reply_en = NULL,
        suggested_reply_ru = NULL,
        started_at = excluded.started_at
    `).run(id, scenarioId, maxTurns, now);
  }

  setDialogueOpening(telegramId, openingEn) {
    const id = normalizeTelegramId(telegramId);
    this.db.prepare(`
      UPDATE dialogue_sessions SET history_json = ? WHERE user_id = ?
    `).run(JSON.stringify([{ role: 'bot', text: openingEn }]), id);
  }

  appendDialogueHistory(telegramId, entries) {
    const session = this.getDialogueSession(telegramId);
    if (!session) return null;
    const history = [...session.history, ...entries];
    const id = normalizeTelegramId(telegramId);
    this.db.prepare(`
      UPDATE dialogue_sessions SET history_json = ?, turn_index = turn_index + 1 WHERE user_id = ?
    `).run(JSON.stringify(history), id);
    return this.getDialogueSession(telegramId);
  }

  clearDialogueSession(telegramId) {
    const id = normalizeTelegramId(telegramId);
    this.db.prepare('DELETE FROM dialogue_sessions WHERE user_id = ?').run(id);
  }

  getSupportHistory(telegramId, limit = 10) {
    const id = normalizeTelegramId(telegramId);
    const rows = this.db.prepare(`
      SELECT role, content FROM support_messages
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(id, limit);
    return rows.reverse().map((row) => ({
      role: row.role,
      content: row.content,
    }));
  }

  appendSupportMessage(telegramId, role, content, maxMessages = 10) {
    const id = normalizeTelegramId(telegramId);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO support_messages (user_id, role, content, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, role, content, now);
    this.trimSupportHistory(id, maxMessages);
  }

  trimSupportHistory(telegramId, maxMessages) {
    const id = normalizeTelegramId(telegramId);
    this.db.prepare(`
      DELETE FROM support_messages
      WHERE user_id = ? AND id NOT IN (
        SELECT id FROM support_messages
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT ?
      )
    `).run(id, id, maxMessages);
  }

  clearSupportHistory(telegramId) {
    const id = normalizeTelegramId(telegramId);
    this.db.prepare('DELETE FROM support_messages WHERE user_id = ?').run(id);
  }
}

module.exports = new DbStore();
