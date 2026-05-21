const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');
const { SCHEMA_SQL } = require('./schema');
const { SEED_TASKS } = require('./seedTasks');
const { migrateSchema } = require('./migrate');

let db = null;

function resolveDbPath() {
  const url = config.databaseUrl;
  if (url.startsWith('sqlite://')) {
    return path.resolve(url.replace('sqlite://', ''));
  }
  return path.resolve(url);
}

function wrapDatabase(native) {
  return {
    prepare: (sql) => native.prepare(sql),
    exec: (sql) => native.exec(sql),
    pragma: (p) => native.exec(`PRAGMA ${p}`),
    close: () => native.close(),
    transaction(fn) {
      return (...args) => {
        native.exec('BEGIN IMMEDIATE');
        try {
          const result = fn(...args);
          native.exec('COMMIT');
          return result;
        } catch (err) {
          native.exec('ROLLBACK');
          throw err;
        }
      };
    },
  };
}

function seedTasks(database) {
  const exists = database.prepare(`
    SELECT 1 AS ok FROM tasks
    WHERE level = ? AND topic = ? AND prompt_en = ?
    LIMIT 1
  `);
  const insert = database.prepare(`
    INSERT INTO tasks (level, topic, prompt_en, prompt_ru, active)
    VALUES (?, ?, ?, ?, 1)
  `);

  let added = 0;
  for (const task of SEED_TASKS) {
    if (exists.get(task.level, task.topic, task.promptEn)) continue;
    insert.run(task.level, task.topic, task.promptEn, task.promptRu);
    added += 1;
  }

  if (added > 0) {
    console.log(`Seeded ${added} new task(s) into database`);
  }
}

function getDb() {
  if (db) return db;

  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = wrapDatabase(new DatabaseSync(dbPath));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
  seedTasks(db);

  console.log(`Database ready: ${dbPath}`);
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb, resolveDbPath };
