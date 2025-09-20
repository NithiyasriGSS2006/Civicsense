import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());

const OPENAI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

if (!OPENAI_API_KEY) {
  console.error('Set GEMINI_API_KEY in .env first.');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: OPENAI_API_KEY });
const sessions = {};

const SYSTEM_PROMPT = `
You are a legal triage assistant. Rules:
1) Ask ONLY single yes/no questions to gather facts.
2) If you have enough facts, STOP asking questions and respond with ONLY a JSON object wrapped in <DECISION>...</DECISION>:
{
  "assessment": "likely_case" | "weak_case" | "no_case",
  "confidence": <number 0-100>,
  "reasoning": "<short explanation>",
  "next_steps": "<advice, reminder not legal advice>"
}
3) Keep questions short and clear.
`;

async function callGeminiChat(messages) {
  const response = await ai.models.generateContent({
    model: OPENAI_MODEL,
    contents: messages.map(msg => `${msg.role}: ${msg.content}`).join('\n')
  });
  return response.text;
}

function extractDecision(text) {
  const start = text.indexOf('<DECISION>');
  const end = text.indexOf('</DECISION>');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(text.substring(start + 10, end).trim());
    } catch {
      return null;
    }
  }
  return null;
}

app.post('/start', async (req, res) => {
  const { userQuery } = req.body;
  if (!userQuery) return res.status(400).json({ error: 'userQuery required' });

  const sessionId = uuidv4();
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `User described: ${userQuery}. Ask the first yes/no question.` }
  ];

  sessions[sessionId] = { messages, finished: false };

  const assistantText = await callGeminiChat(messages);
  sessions[sessionId].messages.push({ role: 'assistant', content: assistantText });

  const decision = extractDecision(assistantText);
  if (decision) sessions[sessionId].finished = true;

  res.json({
    sessionId,
    type: decision ? 'result' : 'question',
    content: decision ? decision : assistantText.trim()
  });
});

app.post('/answer', async (req, res) => {
  const { sessionId, answer } = req.body;
  if (!sessionId || !answer) return res.status(400).json({ error: 'sessionId and answer required' });

  const s = sessions[sessionId];
  if (!s) return res.status(404).json({ error: 'session not found' });
  if (s.finished) return res.status(400).json({ error: 'session already finished' });

  s.messages.push({ role: 'user', content: `Answer: ${answer.toLowerCase()}` });

  const assistantText = await callGeminiChat(s.messages);
  s.messages.push({ role: 'assistant', content: assistantText });

  const decision = extractDecision(assistantText);
  if (decision) s.finished = true;

  res.json({
    sessionId,
    type: decision ? 'result' : 'question',
    content: decision ? decision : assistantText.trim()
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
