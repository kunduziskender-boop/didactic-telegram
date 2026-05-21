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

function migrateSchema(database) {
  const existing = new Set(
    database.prepare('PRAGMA table_info(session_responses)').all().map((r) => r.name),
  );

  for (const [name, type] of SESSION_RESPONSE_COLUMNS) {
    if (existing.has(name)) continue;
    database.exec(`ALTER TABLE session_responses ADD COLUMN ${name} ${type}`);
    existing.add(name);
  }
}

module.exports = { migrateSchema };
