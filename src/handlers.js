// Business logic: turn one LINE message (text or image) into a database
// write plus the reply text to send back. Kept separate from index.js so it
// has no LINE-SDK-specific types in it.
import * as db from './db.js';
import * as claude from './claude.js';
import { todayKeyJST, isValidDateKey, addDaysKey, fmtDateJP, round1 } from './utils.js';

const UNDO_WORDS = ['取り消し', '取消', '元に戻す', 'アンドゥ', 'undo'];
const SUMMARY_WORDS = ['サマリー', '今日', 'summary'];
const GOAL_WORDS = ['目標', '目標確認'];
const HELP_WORDS = ['使い方', 'ヘルプ', 'help'];

export const HELP_TEXT = `このBotは自由な文章や写真を送るだけで、体重・筋トレ・食事・目標を記録します。

例:
・「今日68.4kg」
・「ベンチプレス60kg 10回×3セット」
・「昼食 鶏胸肉とごはん 600kcal」
・「目標体重65kg、3月末まで」
・体重計の写真、料理の写真をそのまま送る

コマンド:
・「今日」→ 今日のサマリー
・「目標」→ 今の目標を確認
・「取り消し」→ 直前の記録を取り消す`;

export async function handleText(userId, rawText) {
  const text = (rawText || '').trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  if (UNDO_WORDS.some((w) => text.includes(w) || lower.includes(w))) return handleUndo(userId);
  if (HELP_WORDS.some((w) => text.includes(w) || lower.includes(w))) return HELP_TEXT;
  if (SUMMARY_WORDS.includes(text)) return buildSummary(userId);
  if (GOAL_WORDS.includes(text)) return buildGoalSummary(userId);

  let result;
  try {
    result = await claude.parseMessage({ text, todayKey: todayKeyJST() });
  } catch (e) {
    return claudeErrorReply(e);
  }
  return applyParsedResult(userId, result);
}

export async function handleImage(userId, imageBuffer, mediaType) {
  let result;
  try {
    result = await claude.parseMessage({
      text: '',
      todayKey: todayKeyJST(),
      imageBase64: imageBuffer.toString('base64'),
      imageMediaType: mediaType || 'image/jpeg',
    });
  } catch (e) {
    return claudeErrorReply(e);
  }
  return applyParsedResult(userId, result);
}

function claudeErrorReply(e) {
  console.error('Claude parse error:', e && (e.raw || e.message || e));
  return 'うまく解析できませんでした。もう一度送るか、内容を変えて送ってみてください。';
}

function applyParsedResult(userId, result) {
  if (!result || typeof result !== 'object') {
    return '内容を読み取れませんでした。体重・筋トレ・食事・目標のいずれかを、具体的な数値つきで送ってみてください。';
  }
  const reply = typeof result.reply === 'string' && result.reply ? result.reply : '記録しました。';

  if (result.type === 'weight' && result.weight && typeof result.weight.weightKg === 'number') {
    const date = isValidDateKey(result.weight.date) ? result.weight.date : todayKeyJST();
    const existing = db.getWeight(userId, date);
    const bodyFat =
      typeof result.weight.bodyFatPct === 'number'
        ? result.weight.bodyFatPct
        : existing
        ? existing.body_fat_pct
        : null;
    db.upsertWeight(userId, date, result.weight.weightKg, bodyFat);
    db.setLastAction(userId, { type: 'weight', date });
    return reply;
  }

  if (
    result.type === 'workout' &&
    result.workout &&
    result.workout.exercise &&
    Array.isArray(result.workout.sets) &&
    result.workout.sets.length
  ) {
    const date = isValidDateKey(result.workout.date) ? result.workout.date : todayKeyJST();
    const sets = result.workout.sets.filter(
      (s) => typeof s.reps === 'number' && typeof s.weightKg === 'number'
    );
    if (!sets.length) return 'セットの回数・重量を読み取れませんでした。もう一度お試しください。';
    const id = db.addWorkout(userId, date, String(result.workout.exercise), sets);
    db.setLastAction(userId, { type: 'workout', id });
    return reply;
  }

  if (result.type === 'meal' && result.meal && result.meal.name && typeof result.meal.calories === 'number') {
    const date = isValidDateKey(result.meal.date) ? result.meal.date : todayKeyJST();
    const id = db.addMeal(
      userId,
      date,
      String(result.meal.name),
      result.meal.calories,
      typeof result.meal.protein === 'number' ? result.meal.protein : null,
      typeof result.meal.fat === 'number' ? result.meal.fat : null,
      typeof result.meal.carbs === 'number' ? result.meal.carbs : null
    );
    db.setLastAction(userId, { type: 'meal', id });
    return reply;
  }

  if (result.type === 'goal' && result.goal) {
    const g = result.goal;
    const prev = db.getGoal(userId) || null;
    const merged = {};
    if (typeof g.targetWeightKg === 'number') merged.target_weight_kg = g.targetWeightKg;
    if (typeof g.startWeightKg === 'number') merged.start_weight_kg = g.startWeightKg;
    if (typeof g.targetBodyFatPct === 'number') merged.target_body_fat_pct = g.targetBodyFatPct;
    if (isValidDateKey(g.targetDate)) merged.target_date = g.targetDate;
    if (typeof g.dailyCalorieGoal === 'number') merged.daily_calorie_goal = g.dailyCalorieGoal;
    const willHaveTarget = merged.target_weight_kg != null || (prev && prev.target_weight_kg != null);
    if (!willHaveTarget) {
      return '目標体重が読み取れませんでした。「目標体重65kg」のように送ってみてください。';
    }
    db.saveGoal(userId, merged);
    db.setLastAction(userId, { type: 'goal', prev });
    return reply;
  }

  return reply || '内容を読み取れませんでした。体重・筋トレ・食事・目標のいずれかを、具体的な数値つきで送ってみてください。';
}

function handleUndo(userId) {
  const action = db.getLastAction(userId);
  if (!action) return '取り消せる記録が見つかりませんでした。';
  if (action.type === 'weight') db.deleteWeight(userId, action.date);
  else if (action.type === 'workout') db.deleteWorkout(userId, action.id);
  else if (action.type === 'meal') db.deleteMeal(userId, action.id);
  else if (action.type === 'goal') {
    if (action.prev) {
      db.saveGoal(userId, {
        target_weight_kg: action.prev.target_weight_kg,
        start_weight_kg: action.prev.start_weight_kg,
        target_body_fat_pct: action.prev.target_body_fat_pct,
        target_date: action.prev.target_date,
        daily_calorie_goal: action.prev.daily_calorie_goal,
      });
    }
  }
  db.clearLastAction(userId);
  return '直前の記録を取り消しました。';
}

function buildSummary(userId) {
  const lw = db.latestWeight(userId);
  const today = todayKeyJST();
  const weekStart = addDaysKey(today, -6);
  const volume = db.weeklyVolume(userId, weekStart);
  const meals = db.mealsForDate(userId, today);
  const kcal = meals.reduce((s, m) => s + (Number(m.calories) || 0), 0);
  const goal = db.getGoal(userId);

  const lines = [`【${fmtDateJP(today)}のサマリー】`];
  lines.push(lw ? `体重: ${round1(lw.weight_kg)}kg (${fmtDateJP(lw.date)}時点)` : '体重: 未記録');
  lines.push(`今週の総挙上重量: ${Math.round(volume)}kg`);
  lines.push(`今日の摂取カロリー: ${Math.round(kcal)}kcal${goal && goal.daily_calorie_goal ? ` / 目標 ${Math.round(goal.daily_calorie_goal)}kcal` : ''}`);

  if (goal && goal.target_weight_kg != null) {
    const start = goal.start_weight_kg != null ? goal.start_weight_kg : (db.firstWeight(userId) || {}).weight_kg;
    const current = lw ? lw.weight_kg : start;
    if (start != null && current != null) {
      const remaining = goal.target_weight_kg - current;
      lines.push(
        Math.abs(remaining) < 0.05
          ? '目標体重に到達しています🎉'
          : `目標まで: あと${round1(Math.abs(remaining))}kg${remaining < 0 ? '減量' : '増量'}`
      );
    }
  }
  return lines.join('\n');
}

function buildGoalSummary(userId) {
  const goal = db.getGoal(userId);
  if (!goal || goal.target_weight_kg == null) {
    return '目標が未設定です。「目標体重65kg、3月末まで」のように送って設定してください。';
  }
  const lines = ['【現在の目標】'];
  lines.push(`目標体重: ${round1(goal.target_weight_kg)}kg`);
  if (goal.start_weight_kg != null) lines.push(`開始体重: ${round1(goal.start_weight_kg)}kg`);
  if (goal.target_body_fat_pct != null) lines.push(`目標体脂肪率: ${round1(goal.target_body_fat_pct)}%`);
  if (goal.target_date) lines.push(`目標達成日: ${fmtDateJP(goal.target_date)}`);
  if (goal.daily_calorie_goal != null) lines.push(`1日の摂取カロリー目標: ${Math.round(goal.daily_calorie_goal)}kcal`);
  return lines.join('\n');
}
