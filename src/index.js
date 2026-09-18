import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import * as handlers from './handlers.js';

const REQUIRED_ENV = ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'ANTHROPIC_API_KEY'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key} (see .env.example)`);
    process.exit(1);
  }
}

const lineConfig = { channelSecret: process.env.LINE_CHANNEL_SECRET };
const client = line.LineBotClient.fromChannelAccessToken({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

const app = express();

// Health check for the hosting platform (Render/Railway ping this).
app.get('/', (_req, res) => res.status(200).send('ok'));

app.post('/callback', line.middleware(lineConfig), (req, res) => {
  // Respond to LINE right away; Claude's analysis (especially with an image)
  // can take a few seconds, and LINE will retry the whole webhook delivery
  // if it doesn't get a fast 200 — replyMessage below uses the reply token,
  // which stays valid long enough for that short delay.
  res.status(200).end();
  const events = (req.body && req.body.events) || [];
  for (const event of events) {
    handleEvent(event).catch((err) => console.error('Error handling event:', err));
  }
});

async function handleEvent(event) {
  if (event.type !== 'message' || !event.source || !event.source.userId) return;
  const userId = event.source.userId;

  let replyText;
  if (event.message.type === 'text') {
    replyText = await handlers.handleText(userId, event.message.text);
  } else if (event.message.type === 'image') {
    const buffer = await downloadMessageContent(event.message.id);
    replyText = await handlers.handleImage(userId, buffer, 'image/jpeg');
  } else {
    return; // ignore stickers, video, audio, location, etc. for now
  }

  if (!replyText) return;
  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: replyText }],
  });
}

async function downloadMessageContent(messageId) {
  const stream = await client.getMessageContent(messageId);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`LINE fitness bot listening on port ${port}`));
