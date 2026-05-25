/** Incremental column migrations for existing SQLite databases. */
const SESSION_RESPONSE_COLUMNS = [
  ['what_went_well', 'TEXT'],
  ['useful_phrases', 'TEXT'],
  ['main_improvement', 'TEXT'],
  ['follow_up_prompt_en', 'TEXT'],
  ['follow_up_prompt_ru', 'TEXT'],
  ['follow_up_transcript', 'TEXT'],
  ['follow_up_corrected_text', 'TEXT'],
  ['follow_up_praise', 'TEXT'],
  ['follow_up_done', 'INTEGER NOT NULL DEFAULT 0'],
  ['follow_up_skipped', 'INTEGER NOT NULL DEFAULT 0'],
];

const DIALOGUE_SESSION_COLUMNS = [
  ['suggested_reply_en', 'TEXT'],
  ['suggested_reply_ru', 'TEXT'],
];

function migrateTableColumns(database, table, columns) {
  const existing = new Set(
    database.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name),
  );
  for (const [name, type] of columns) {
    if (existing.has(name)) continue;
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    existing.add(name);
  }
}

function migrateSchema(database) {
  migrateTableColumns(database, 'session_responses', SESSION_RESPONSE_COLUMNS);
  migrateTableColumns(database, 'dialogue_sessions', DIALOGUE_SESSION_COLUMNS);
}

module.exports = { migrateSchema };
