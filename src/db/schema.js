const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  level TEXT,
  topic TEXT,
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
  fsm_state TEXT NOT NULL DEFAULT 'idle',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  topic TEXT NOT NULL,
  prompt_en TEXT NOT NULL,
  prompt_ru TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS daily_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  session_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  task_sent_at TEXT,
  completed_at TEXT,
  reminder_sent_at TEXT,
  UNIQUE(user_id, session_date),
  FOREIGN KEY(user_id) REFERENCES users(telegram_id),
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS session_responses (
  session_id INTEGER PRIMARY KEY,
  transcript TEXT,
  corrected_text TEXT,
  grammar_tip TEXT,
  praise TEXT,
  error_rule_tag TEXT,
  response_audio_path TEXT,
  corrected_audio_path TEXT,
  shadow_done INTEGER NOT NULL DEFAULT 0,
  what_went_well TEXT,
  useful_phrases TEXT,
  main_improvement TEXT,
  follow_up_prompt_en TEXT,
  follow_up_prompt_ru TEXT,
  follow_up_transcript TEXT,
  follow_up_corrected_text TEXT,
  follow_up_praise TEXT,
  follow_up_done INTEGER NOT NULL DEFAULT 0,
  follow_up_skipped INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(session_id) REFERENCES daily_sessions(id)
);

CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  session_id INTEGER,
  rule_tag TEXT NOT NULL,
  original_fragment TEXT,
  correction TEXT,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(telegram_id)
);

CREATE TABLE IF NOT EXISTS streaks (
  user_id INTEGER PRIMARY KEY,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_completed_date TEXT,
  FOREIGN KEY(user_id) REFERENCES users(telegram_id)
);

CREATE TABLE IF NOT EXISTS weekly_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  week_start TEXT NOT NULL,
  top_errors_json TEXT,
  mini_exercise TEXT,
  sent_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON daily_sessions(user_id, session_date);
CREATE INDEX IF NOT EXISTS idx_error_log_user ON error_log(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_tasks_level_topic ON tasks(level, topic, active);

CREATE TABLE IF NOT EXISTS vocab_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  word TEXT NOT NULL,
  translation_ru TEXT,
  context_en TEXT NOT NULL,
  context_ru TEXT,
  source TEXT NOT NULL DEFAULT 'drill',
  session_id INTEGER,
  created_at TEXT NOT NULL,
  next_review_at TEXT NOT NULL,
  interval_days INTEGER NOT NULL DEFAULT 1,
  repetitions INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at TEXT,
  status TEXT NOT NULL DEFAULT 'learning',
  UNIQUE(user_id, context_en),
  FOREIGN KEY(user_id) REFERENCES users(telegram_id)
);

CREATE TABLE IF NOT EXISTS vocab_review_sessions (
  user_id INTEGER PRIMARY KEY,
  card_ids_json TEXT NOT NULL,
  current_index INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_vocab_user_review ON vocab_cards(user_id, next_review_at);

CREATE TABLE IF NOT EXISTS dialogue_sessions (
  user_id INTEGER PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL DEFAULT 0,
  max_turns INTEGER NOT NULL DEFAULT 4,
  history_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(telegram_id)
);
`;

module.exports = { SCHEMA_SQL };
