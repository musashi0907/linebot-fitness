// SQLite storage. One file, keyed by LINE userId so the bot works correctly
// even if more than one person ever adds it as a friend.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'fitness.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS weights (
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    weight_kg REAL NOT NULL,
    body_fat_pct REAL,
    PRIMARY KEY (user_id, date)
  );

  CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    exercise TEXT NOT NULL,
    sets_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    name TEXT NOT NULL,
    calories REAL NOT NULL,
    protein REAL,
    fat REAL,
    carbs REAL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS goals (
    user_id TEXT PRIMARY KEY,
    target_weight_kg REAL,
    start_weight_kg REAL,
    target_body_fat_pct REAL,
    target_date TEXT,
    daily_calorie_goal REAL
  );

  CREATE TABLE IF NOT EXISTS last_action (
    user_id TEXT PRIMARY KEY,
    action_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON workouts(user_id, date);
  CREATE INDEX IF NOT EXISTS idx_meals_user_date ON meals(user_id, date);
`);

// ---------- weights ----------
export function upsertWeight(userId, date, weightKg, bodyFatPct) {
  db.prepare(
    `INSERT INTO weights (user_id, date, weight_kg, body_fat_pct)
     VALUES (@userId, @date, @weightKg, @bodyFatPct)
     ON CONFLICT(user_id, date) DO UPDATE SET
       weight_kg = excluded.weight_kg,
       body_fat_pct = COALESCE(excluded.body_fat_pct, weights.body_fat_pct)`
  ).run({ userId, date, weightKg, bodyFatPct: bodyFatPct ?? null });
}
export function getWeight(userId, date) {
  return db.prepare(`SELECT * FROM weights WHERE user_id = ? AND date = ?`).get(userId, date);
}
export function deleteWeight(userId, date) {
  db.prepare(`DELETE FROM weights WHERE user_id = ? AND date = ?`).run(userId, date);
}
export function listWeights(userId, limit = 500) {
  return db.prepare(`SELECT * FROM weights WHERE user_id = ? ORDER BY date DESC LIMIT ?`).all(userId, limit);
}
export function latestWeight(userId) {
  return db.prepare(`SELECT * FROM weights WHERE user_id = ? ORDER BY date DESC LIMIT 1`).get(userId);
}
export function firstWeight(userId) {
  return db.prepare(`SELECT * FROM weights WHERE user_id = ? ORDER BY date ASC LIMIT 1`).get(userId);
}

// ---------- workouts ----------
export function addWorkout(userId, date, exercise, sets) {
  const info = db.prepare(
    `INSERT INTO workouts (user_id, date, exercise, sets_json, created_at) VALUES (?,?,?,?,?)`
  ).run(userId, date, exercise, JSON.stringify(sets), Date.now());
  return info.lastInsertRowid;
}
export function deleteWorkout(userId, id) {
  db.prepare(`DELETE FROM workouts WHERE user_id = ? AND id = ?`).run(userId, id);
}
export function listWorkouts(userId, limit = 30) {
  const rows = db.prepare(
    `SELECT * FROM workouts WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT ?`
  ).all(userId, limit);
  return rows.map((r) => ({ ...r, sets: JSON.parse(r.sets_json) }));
}
export function weeklyVolume(userId, sinceDate) {
  const rows = db.prepare(
    `SELECT sets_json FROM workouts WHERE user_id = ? AND date >= ?`
  ).all(userId, sinceDate);
  let total = 0;
  for (const r of rows) {
    for (const s of JSON.parse(r.sets_json)) total += (Number(s.reps) || 0) * (Number(s.weightKg) || 0);
  }
  return total;
}
export function personalBests(userId) {
  const rows = db.prepare(`SELECT exercise, sets_json FROM workouts WHERE user_id = ?`).all(userId);
  const best = {};
  for (const r of rows) {
    for (const s of JSON.parse(r.sets_json)) {
      const w = Number(s.weightKg) || 0;
      if (!best[r.exercise] || w > best[r.exercise].weightKg) {
        best[r.exercise] = { weightKg: w, reps: s.reps };
      }
    }
  }
  return best;
}

// ---------- meals ----------
export function addMeal(userId, date, name, calories, protein, fat, carbs) {
  const info = db.prepare(
    `INSERT INTO meals (user_id, date, name, calories, protein, fat, carbs, created_at) VALUES (?,?,?,?,?,?,?,?)`
  ).run(userId, date, name, calories, protein ?? null, fat ?? null, carbs ?? null, Date.now());
  return info.lastInsertRowid;
}
export function deleteMeal(userId, id) {
  db.prepare(`DELETE FROM meals WHERE user_id = ? AND id = ?`).run(userId, id);
}
export function mealsForDate(userId, date) {
  return db.prepare(`SELECT * FROM meals WHERE user_id = ? AND date = ? ORDER BY id`).all(userId, date);
}
export function listMeals(userId, limit = 50) {
  return db.prepare(`SELECT * FROM meals WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT ?`).all(userId, limit);
}

// ---------- goals ----------
export function getGoal(userId) {
  return db.prepare(`SELECT * FROM goals WHERE user_id = ?`).get(userId);
}
export function saveGoal(userId, goal) {
  const existing = getGoal(userId) || {};
  const merged = { ...existing, ...goal };
  db.prepare(
    `INSERT INTO goals (user_id, target_weight_kg, start_weight_kg, target_body_fat_pct, target_date, daily_calorie_goal)
     VALUES (@userId, @targetWeightKg, @startWeightKg, @targetBodyFatPct, @targetDate, @dailyCalorieGoal)
     ON CONFLICT(user_id) DO UPDATE SET
       target_weight_kg = excluded.target_weight_kg,
       start_weight_kg = excluded.start_weight_kg,
       target_body_fat_pct = excluded.target_body_fat_pct,
       target_date = excluded.target_date,
       daily_calorie_goal = excluded.daily_calorie_goal`
  ).run({
    userId,
    targetWeightKg: merged.target_weight_kg ?? null,
    startWeightKg: merged.start_weight_kg ?? null,
    targetBodyFatPct: merged.target_body_fat_pct ?? null,
    targetDate: merged.target_date ?? null,
    dailyCalorieGoal: merged.daily_calorie_goal ?? null,
  });
}

// ---------- undo support ----------
export function setLastAction(userId, action) {
  db.prepare(
    `INSERT INTO last_action (user_id, action_json, created_at) VALUES (?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET action_json = excluded.action_json, created_at = excluded.created_at`
  ).run(userId, JSON.stringify(action), Date.now());
}
export function getLastAction(userId) {
  const row = db.prepare(`SELECT * FROM last_action WHERE user_id = ?`).get(userId);
  return row ? JSON.parse(row.action_json) : null;
}
export function clearLastAction(userId) {
  db.prepare(`DELETE FROM last_action WHERE user_id = ?`).run(userId);
}
