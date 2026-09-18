// Wraps the Anthropic API: sends the user's LINE message (text and/or a
// photo) to Claude and gets back structured JSON describing what to log.
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

function buildPrompt(text, todayKey, hasPhoto) {
  let p = `あなたは減量・筋トレ記録用のLINE Botのアシスタントです。ユーザーから届いたメッセージを解析し、以下のJSON形式のオブジェクトを1つだけ出力してください。説明文やコードフェンスは付けず、JSONだけを返してください。

今日の日付: ${todayKey} (「今日」「昨日」「一昨日」などはこの日付を基準に解釈してください)

出力するJSONの構造:
{
  "type": "weight" | "workout" | "meal" | "goal" | "unknown",
  "weight": {"date":"YYYY-MM-DD","weightKg":数値,"bodyFatPct":数値またはnull} または null,
  "workout": {"date":"YYYY-MM-DD","exercise":"種目名","sets":[{"reps":数値,"weightKg":数値}]} または null,
  "meal": {"date":"YYYY-MM-DD","name":"食事内容","calories":数値,"protein":数値またはnull,"fat":数値またはnull,"carbs":数値またはnull} または null,
  "goal": {"targetWeightKg":数値またはnull,"startWeightKg":数値またはnull,"targetBodyFatPct":数値またはnull,"targetDate":"YYYY-MM-DD"またはnull,"dailyCalorieGoal":数値またはnull} または null,
  "reply": "ユーザーへの短い日本語の返信(1〜2文。記録内容を端的に確認する文、または内容が読み取れない場合は聞き返す文)"
}

typeに対応するフィールドだけを埋め、他はnullにしてください。数値が読み取れない、または内容が不明瞭な場合はtypeを"unknown"にして、weight/workout/meal/goalは全てnullにし、replyで何を記録したいか短く聞き返してください。食事のカロリーが明記されていない場合は一般的な目安として常識的に推定してよく、その場合はreplyで推定であることに軽く触れてください。`;

  if (hasPhoto) {
    p += `

ユーザーは写真を1枚送っています。写真が体重計・体組成計の表示であれば、写っている数値を体重として読み取り(体脂肪率も表示されていれば併せて読み取り)、typeを"weight"にしてください。写真が食事・料理であれば、内容から一般的なカロリーと栄養素(たんぱく質・脂質・炭水化物、g)を常識的に推定し、typeを"meal"にして、replyで推定であることに軽く触れてください。トレーニング中の様子や器具の写真で数値が読み取れない場合や、どちらとも判断できない写真の場合は、写真の内容を踏まえてreplyで何の記録かを聞き返してください。`;
  }

  p += `

ユーザーのメッセージ本文(空の場合は写真のみが送られています): "${(text || '').replace(/"/g, '\\"')}"`;
  return p;
}

function extractJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    // fall through to more tolerant parsing below
  }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      // fall through
    }
  }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    try {
      return JSON.parse(raw.slice(first, last + 1));
    } catch {
      // give up below
    }
  }
  return null;
}

/**
 * @param {{text?: string, todayKey: string, imageBase64?: string, imageMediaType?: string}} args
 * @returns {Promise<object>} parsed result matching the schema in buildPrompt
 */
export async function parseMessage({ text, todayKey, imageBase64, imageMediaType }) {
  const content = [];
  if (imageBase64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: imageMediaType || 'image/jpeg', data: imageBase64 },
    });
  }
  content.push({ type: 'text', text: buildPrompt(text, todayKey, !!imageBase64) });

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content }],
  });

  const raw = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const json = extractJson(raw);
  if (!json) {
    const err = new Error('Claude did not return parseable JSON');
    err.raw = raw;
    throw err;
  }
  return json;
}
