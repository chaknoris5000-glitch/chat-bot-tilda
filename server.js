const express = require('express');
const cors = require('cors');

try { require('dotenv').config(); } catch (e) {}

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json({ limit: '25mb' }));

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const OPENROUTER_KEY = process.env.OPENROUTER_KEY || '';
const FIRECRAWL_KEY = process.env.FIRECRAWL_KEY || '';
const SITE_TO_CRAWL = process.env.SITE_TO_CRAWL || 'https://send-empty-creedite.tilda.ws';
const BUSINESS_NAME = process.env.BUSINESS_NAME || 'AI-Администратор';
const CLIENT_ID = 'tilda';

console.log('TELEGRAM_TOKEN:', TELEGRAM_TOKEN ? 'ЕСТЬ' : 'НЕТ');
console.log('SUPABASE_URL:', SUPABASE_URL ? 'ЕСТЬ' : 'НЕТ');
console.log('OPENROUTER_KEY:', OPENROUTER_KEY ? 'ЕСТЬ' : 'НЕТ');
console.log('FIRECRAWL_KEY:', FIRECRAWL_KEY ? 'ЕСТЬ' : 'НЕТ');

async function getEmbedding(text) {
  const r = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'openai/text-embedding-3-small', input: text })
  });
  const data = await r.json();
  if (!r.ok) throw new Error('embedding error');
  return data.data[0].embedding;
}

async function transcribeVoice(fileUrl) {
  try {
    const fileResp = await fetch(fileUrl);
    if (!fileResp.ok) return null;
    const buf = await fileResp.arrayBuffer();
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: 'audio/ogg' }), 'voice.ogg');
    fd.append('model', 'openai/whisper-large-v3');
    const r = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}` },
      body: fd
    });
    const d = await r.json();
    if (!r.ok) return null;
    return d.text || null;
  } catch (e) { return null; }
}

async function getTelegramFileUrl(fileId) {
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
  const d = await r.json();
  if (!d.ok) return null;
  return `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${d.result.file_path}`;
}

// ==== ПОИСК ЧЕРЕЗ RPC (правильный, точный) ====
async function searchDocuments(queryEmbedding, limit = 5) {
  try {
    const embeddingText = '[' + queryEmbedding.join(',') + ']';
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_documents_text`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query_embedding_text: embeddingText,
        match_count: limit
      })
    });
    if (!r.ok) {
      const err = await r.text();
      console.log('RPC error:', err.slice(0, 200));
      return [];
    }
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.log('searchDocuments error:', e.message);
    return [];
  }
}

async function saveDocument(content, embedding, url) {
  await fetch(`${SUPABASE_URL}/rest/v1/documents`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ content, embedding, url, client_id: CLIENT_ID })
  });
}

async function getOrCreateSession(sessionId) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/chat_sessions?session_id=eq.${sessionId}&client_id=eq.${CLIENT_ID}&select=*`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length > 0) return rows[0];
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/chat_sessions`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({ session_id: sessionId, history: [], client_id: CLIENT_ID })
    });
    const created = await ins.json();
    if (Array.isArray(created) && created.length > 0) return created[0];
    return { session_id: sessionId, history: [] };
  } catch (e) { return { session_id: sessionId, history: [] }; }
}

async function getSessionByTelegram(chatId) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/chat_sessions?telegram_chat_id=eq.${chatId}&client_id=eq.${CLIENT_ID}&select=*&order=updated_at.desc&limit=1`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch (e) { return null; }
}

async function updateSession(sessionId, patch) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/chat_sessions?session_id=eq.${sessionId}&client_id=eq.${CLIENT_ID}`, {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
    });
  } catch (e) {}
}

async function saveLead(sessionId, name, phone, problem) {
  await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ session_id: sessionId, name: name || null, phone: phone || null, problem: problem || null, client_id: CLIENT_ID })
  });
}

async function notifyManager(lead) {
  if (!MANAGER_CHAT_ID) return;
  const lines = ['🔔 Новая заявка'];
  if (lead.name) lines.push('👤 ' + lead.name);
  if (lead.phone) lines.push('📞 ' + lead.phone);
  if (lead.problem) lines.push('💬 ' + lead.problem);
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: MANAGER_CHAT_ID, text: lines.join('\n') })
  });
}

function extractLeadData(text) {
  const data = { name: null, phone: null, problem: null, save: false };
  if (text.includes('[LEAD_SAVE]')) {
    data.save = true;
    const n = text.match(/\[NAME:([^\]]+)\]/); if (n) data.name = n[1].trim();
    const p = text.match(/\[PHONE:([^\]]+)\]/); if (p) data.phone = p[1].trim();
    const pr = text.match(/\[PROBLEM:([^\]]+)\]/); if (pr) data.problem = pr[1].trim();
  }
  return data;
}

function isValidLead(name, phone) {
  if (!name || !phone) return false;
  const bad = ['...', '..', '.', '-', '—', 'нет', 'не указано'];
  const n = String(name).trim().toLowerCase();
  const p = String(phone).trim().toLowerCase();
  if (bad.includes(n) || bad.includes(p)) return false;
  if (n.length < 2) return false;
  if (p.replace(/\D/g, '').length < 5) return false;
  return true;
}

function cleanReply(text) {
  return text
    .replace(/\[LEAD_SAVE\]/g, '').replace(/\[NAME:[^\]]*\]/g, '').replace(/\[PHONE:[^\]]*\]/g, '').replace(/\[PROBLEM:[^\]]*\]/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/__(.*?)__/g, '$1').replace(/_(.*?)_/g, '$1')
    .replace(/^#{1,6}\s+/gm, '').replace(/`/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

async function askAI(message, history, sessionId) {
  let context = '';
  try {
    const emb = await getEmbedding(message);
    const matches = await searchDocuments(emb, 5);
    console.log('Найдено кусочков:', matches.length);
    if (matches.length > 0) {
      context = matches.map(m => m.content).join('\n\n---\n\n');
    }
  } catch (e) { console.log('Контекст не собран:', e.message); }

  const systemPrompt = `Ты — AI-Администратор компании «${BUSINESS_NAME}». Общаешься вежливо, на «Вы», коротко и по делу.

СТИЛЬ:
1. Коротко, 1-2 предложения.
2. На «Вы».
3. Без markdown (**звёздочек**, #заголовков).
4. Не повторяй вопрос клиента.

ФОРМАТИРОВАНИЕ:
- 2+ мысли — с новой строки.
- Между блоками — пустая строка.

СБОР ЗАЯВКИ:
- Если клиент готов — попроси имя и телефон.
- Когда есть РЕАЛЬНЫЕ имя + телефон — добавь В КОНЦЕ:
  [LEAD_SAVE][NAME:имя][PHONE:телефон][PROBLEM:кратко]
- Не добавляй маркеры, если данных нет.

ВАЖНО:
- Используй информацию о компании ниже для ответов про цены, услуги, условия.
- Если данных нет — скажи «Уточните у менеджера».

ИНФОРМАЦИЯ О КОМПАНИИ:
${context || 'Информация временно недоступна.'}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...(history || []).slice(-10),
    { role: 'user', content: message }
  ];

  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek/deepseek-chat', messages, temperature: 0.5, max_tokens: 600 })
  });
  const data = await r.json();
  if (!r.ok) throw new Error('OpenRouter error');
  let reply = data.choices?.[0]?.message?.content || 'Нет ответа';

  const leadData = extractLeadData(reply);
  if (leadData.save && isValidLead(leadData.name, leadData.phone)) {
    try {
      await saveLead(sessionId, leadData.name, leadData.phone, leadData.problem);
      await notifyManager(leadData);
    } catch (e) {}
  }

  return cleanReply(reply);
}

async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

app.post('/message', async (req, res) => {
  try {
    const { message, session_id } = req.body;
    if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Введите сообщение' });
    const sid = session_id || 'default';
    const session = await getOrCreateSession(sid);
    const history = session.history || [];
    const reply = await askAI(message, history, sid);
    const newHistory = [...history, { role: 'user', content: message }, { role: 'assistant', content: reply }];
    await updateSession(sid, { history: newHistory.slice(-20) });
    res.json({ reply, session_id: sid });
  } catch (error) {
    console.log('Server error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/telegram-webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const msg = req.body.message;
    if (!msg) return;
    const chatId = msg.chat.id;
    let text = '';

    if (msg.voice) {
      const fileUrl = await getTelegramFileUrl(msg.voice.file_id);
      if (!fileUrl) return;
      const tr = await transcribeVoice(fileUrl);
      if (!tr) { await sendTelegram(chatId, 'Не удалось распознать. Напишите текстом.'); return; }
      text = tr.trim();
    } else if (msg.text) {
      text = msg.text.trim();
    } else return;

    if (text === '/leads' && String(chatId) === String(MANAGER_CHAT_ID)) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?select=*&client_id=eq.${CLIENT_ID}&order=id.desc&limit=10`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      const leads = await r.json();
      if (!Array.isArray(leads) || leads.length === 0) { await sendTelegram(chatId, 'Заявок пока нет.'); return; }
      const lines = leads.map((l, i) => `${i+1}. ${l.name||'—'} | ${l.phone||'—'}\n💬 ${l.problem||'—'}`);
      await sendTelegram(chatId, '📋 Последние заявки:\n\n' + lines.join('\n\n'));
      return;
    }

    if (text.startsWith('/start')) {
      const parts = text.split(' ');
      const siteSessionId = parts[1];
      if (siteSessionId) {
        await getOrCreateSession(siteSessionId);
        await updateSession(siteSessionId, { telegram_chat_id: chatId });
        await sendTelegram(chatId, 'Продолжаем диалог с сайта. Чем помочь?');
      } else {
        await sendTelegram(chatId, 'Здравствуйте! Я AI-Администратор. Задайте вопрос.');
      }
      return;
    }

    let session = await getSessionByTelegram(chatId);
    if (!session) {
      const newSid = 'tg_' + chatId;
      await getOrCreateSession(newSid);
      await updateSession(newSid, { telegram_chat_id: chatId });
      session = await getSessionByTelegram(chatId);
    }
    if (!session) session = { session_id: 'tg_' + chatId, history: [] };

    const history = session.history || [];
    const reply = await askAI(text, history, session.session_id);
    const newHistory = [...history, { role: 'user', content: text }, { role: 'assistant', content: reply }];
    await updateSession(session.session_id, { history: newHistory.slice(-20) });
    await sendTelegram(chatId, reply);
  } catch (error) {
    console.log('Telegram error:', error);
  }
});

app.get('/crawl', async (req, res) => {
  try {
    const scrape = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${FIRECRAWL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: SITE_TO_CRAWL, formats: ['markdown'] })
    });
    const scrapeData = await scrape.json();
    if (!scrape.ok) return res.status(500).json({ error: 'Firecrawl error' });
    const text = scrapeData.data?.markdown || '';
    const chunks = [];
    for (let i = 0; i < text.length; i += 1000) chunks.push(text.slice(i, i + 1000));

    let saved = 0;
    for (const chunk of chunks) {
      try {
        const embedding = await getEmbedding(chunk);
        await saveDocument(chunk, embedding, SITE_TO_CRAWL);
        saved++;
      } catch (e) {}
    }
    res.json({ ok: true, saved, total: chunks.length });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка кроулинга' });
  }
});

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
