const express = require('express');
const path = require('path');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios'); // Добавил для надежности

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
const CLIENT_ID = process.env.CLIENT_ID || 'tilda';
const PRICE_PER_LEAD = Number(process.env.PRICE_PER_LEAD) || 25;
const BASE_URL = process.env.BASE_URL || 'https://send-empty-creedite.tilda.ws';
const REPORT_HOUR = Number(process.env.REPORT_HOUR) || 20;
const AI_MODEL_CHAT = process.env.AI_MODEL_CHAT || 'deepseek/deepseek-chat';
const AI_MODEL_EMBED = process.env.AI_MODEL_EMBED || 'openai/text-embedding-3-small';
const AI_MODEL_VOICE = process.env.AI_MODEL_VOICE || 'openai/whisper-large-v3';

const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID || '';
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY || '';
const YOOKASSA_RETURN_URL = process.env.YOOKASSA_RETURN_URL || 'https://t.me/vadim602_bot';

const TARIFFS = {
  'start': { name: 'Старт', amountMonth: 1990, amountYear: 14900 },
  'business': { name: 'Бизнес', amountMonth: 2490, amountYear: 19900 },
  'unlimited': { name: 'Безлимит', amountMonth: 4990, amountYear: 39900 },
  'result': { name: 'За результат', amountMonth: 25, amountYear: 25 }
};

const processedUpdates = new Set();
const newClientStates = {};

// ========== КЛИЕНТЫ И ОПЛАТА ==========

async function getClient(clientId) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/clients?client_id=eq.${clientId}&select=*&limit=1`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (e) { return null; }
}

function isPaid(client) {
  if (!client || !client.paid_until) return false;
  return new Date(client.paid_until) > new Date();
}

async function extendPayment(clientId, months = 1) {
  const client = await getClient(clientId);
  if (!client) return null;
  const base = client.paid_until && new Date(client.paid_until) > new Date() ? new Date(client.paid_until) : new Date();
  base.setMonth(base.getMonth() + months);
  await fetch(`${SUPABASE_URL}/rest/v1/clients?client_id=eq.${clientId}`, {
    method: 'PATCH', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ paid_until: base.toISOString(), updated_at: new Date().toISOString() })
  });
  return base;
}

async function disablePayment(clientId) {
  await fetch(`${SUPABASE_URL}/rest/v1/clients?client_id=eq.${clientId}`, {
    method: 'PATCH', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ paid_until: new Date(Date.now() - 86400000).toISOString(), updated_at: new Date().toISOString() })
  });
}

async function createYookassaPayment(chatId, tariffKey, period = 'month') {
  const tariff = TARIFFS[tariffKey];
  if (!tariff) return null;
  const amount = period === 'year' ? tariff.amountYear : tariff.amountMonth;
  const desc = period === 'year' ? `Годовая подписка ${tariff.name}` : `Месячная подписка ${tariff.name}`;
  const idempotenceKey = `pay_${chatId}_${tariffKey}_${period}_${Date.now()}`;
  const auth = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64');
  try {
    const r = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST', headers: { 'Authorization': `Basic ${auth}`, 'Idempotence-Key': idempotenceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: { value: amount.toFixed(2), currency: 'RUB' }, capture: true,
        confirmation: { type: 'redirect', return_url: YOOKASSA_RETURN_URL },
        description: `AI-Администратор: ${desc}`,
        metadata: { chat_id: chatId.toString(), tariff: tariffKey, period: period }
      })
    });
    const data = await r.json();
    if (r.ok && data.confirmation && data.confirmation.confirmation_url) return data.confirmation.confirmation_url;
    return null;
  } catch (e) { return null; }
}

// ========== БАЗОВЫЕ ФУНКЦИИ ==========

async function getEmbedding(text) {
  const r = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST', headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: AI_MODEL_EMBED, input: text })
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
    fd.append('model', AI_MODEL_VOICE);
    const r = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST', headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}` }, body: fd
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

async function searchDocuments(queryEmbedding, limit = 8) {
  try {
    // ВАЖНО: Сначала фильтр client_id, потом select!
    const r = await fetch(`${SUPABASE_URL}/rest/v1/documents?client_id=eq.${CLIENT_ID}&select=id,content,url,embedding`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    if (!r.ok) return [];
    const docs = await r.json();
    if (!Array.isArray(docs) || docs.length === 0) return [];

    function parseEmb(str) {
      if (!str) return [];
      if (Array.isArray(str)) return str;
      return String(str).replace(/[\[\]]/g, '').split(',').map(Number);
    }
    function cos(a, b) {
      let dot = 0, na = 0, nb = 0;
      const len = Math.min(a.length, b.length);
      for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
      return dot / (Math.sqrt(na) * Math.sqrt(nb));
    }

    const scored = docs.map(doc => ({ id: doc.id, content: doc.content, similarity: cos(queryEmbedding, parseEmb(doc.embedding)) }));
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  } catch (e) { return []; }
}

async function saveDocument(content, embedding, url) {
  await fetch(`${SUPABASE_URL}/rest/v1/documents`, {
    method: 'POST', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, embedding, url, client_id: CLIENT_ID })
  });
}

async function getOrCreateSession(sessionId) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/chat_sessions?session_id=eq.${sessionId}&select=*`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length > 0) return rows[0];
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/chat_sessions`, {
      method: 'POST', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({ session_id: sessionId, history: [] })
    });
    const created = await ins.json();
    if (Array.isArray(created) && created.length > 0) return created[0];
    return { session_id: sessionId, history: [] };
  } catch (e) { return { session_id: sessionId, history: [] }; }
}

async function getSessionByTelegram(chatId) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/chat_sessions?telegram_chat_id=eq.${chatId}&select=*&order=updated_at.desc&limit=1`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch (e) { return null; }
}

async function updateSession(sessionId, patch) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/chat_sessions?session_id=eq.${sessionId}`, {
      method: 'PATCH', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
    });
  } catch (e) {}
}

async function saveLead(sessionId, name, phone, problem, source = 'site') {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
      method: 'POST', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({ session_id: sessionId, client_id: CLIENT_ID, name: name || null, phone: phone || null, problem: problem || null, source, status: 'new' })
    });
    const inserted = await r.json();
    return Array.isArray(inserted) && inserted[0] ? inserted[0].id : 0;
  } catch (e) { return 0; }
}

// ========== TELEGRAM API ==========

async function sendTelegram(chatId, text, keyboard = null) {
  const body = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: false };
  if (keyboard) body.reply_markup = { inline_keyboard: keyboard };
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
}

async function sendContact(chatId, phone, name) {
  const formData = new FormData();
  formData.append('chat_id', chatId); formData.append('phone_number', phone); formData.append('first_name', name || 'Клиент');
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendContact`, { method: 'POST', body: formData });
}

async function answerCallback(callbackId, text = '') {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id: callbackId, text })
  });
}

async function editMessage(chatId, messageId, text, keyboard = null) {
  const body = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
  if (keyboard) body.reply_markup = { inline_keyboard: keyboard };
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
}

// ========== ЛОГИКА ЗАЯВОК ==========

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
  const n = String(name).trim().toLowerCase(); const p = String(phone).trim().toLowerCase();
  if (bad.includes(n) || bad.includes(p)) return false;
  if (n.length < 2) return false;
  if (p.replace(/\D/g, '').length < 5) return false;
  return true;
}

function cleanReply(text) {
  return text.replace(/\[LEAD_SAVE\]/g, '').replace(/\[NAME:[^\]]*\]/g, '').replace(/\[PHONE:[^\]]*\]/g, '').replace(/\[PROBLEM:[^\]]*\]/g, '').replace(/\[SCROLL:[^\]]*\]/g, '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/__(.*?)__/g, '$1').replace(/_(.*?)_/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/`/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

async function notifyManager(lead, leadId) {
  if (!MANAGER_CHAT_ID) return;
  const text = `🔥 <b>НОВАЯ ЗАЯВКА</b>\n\n👤 <b>Имя:</b> ${lead.name || '—'}\n📞 <b>Телефон:</b> ${lead.phone || '—'}\n💬 <b>Задача:</b> ${lead.problem || '—'}\n\n<i>Статус: 🆕 Новая</i>`;
  const keyboard = [[{ text: '🔄 Взять в работу', callback_data: `status_${leadId}_in_progress` }], [{ text: '📞 Позвонить', callback_data: `call_${leadId}` }, { text: '✉️ Написать', callback_data: `write_${leadId}` }]];
  try { await sendTelegram(MANAGER_CHAT_ID, text, keyboard); } catch (e) {}
}

// ========== ИИ ==========

async function askAI(message, history, sessionId) {
  let context = '';
  try {
    const emb = await getEmbedding(message);
    const matches = await searchDocuments(emb, 8);
    if (matches.length > 0) context = matches.map(m => m.content).join('\n\n---\n\n');
  } catch (e) { console.log('Контекст не собран:', e.message); }

  const clientConfig = await getClient(CLIENT_ID);
  // Чистый промпт: берет из базы, если нет - короткий дефолтный.
  const systemPrompt = clientConfig?.prompt || `Ты — администратор компании «${BUSINESS_NAME}». Консультируй по услугам и собирай заявки. Отвечай вежливо.`;
  const fullPrompt = `${systemPrompt}\n\nБАЗА ЗНАНИЙ:\n${context || 'Информация временно недоступна.'}`;

  const messages = [{ role: 'system', content: fullPrompt }, ...(history || []).slice(-10), { role: 'user', content: message }];

  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: AI_MODEL_CHAT, messages, temperature: 0.6, max_tokens: 400 })
  });
  const data = await r.json();
  if (!r.ok) throw new Error('OpenRouter error');
  let reply = data.choices?.[0]?.message?.content || 'Нет ответа';

  const leadData = extractLeadData(reply);
  if (leadData.save && isValidLead(leadData.name, leadData.phone)) {
    try {
      const leadId = await saveLead(sessionId, leadData.name, leadData.phone, leadData.problem);
      await notifyManager(leadData, leadId);
    } catch (e) {}
  }
  return cleanReply(reply);
}

// ========== ЭКСПОРТ XLSX ==========

async function buildXlsx(leads, title = 'Заявки') {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title);
  ws.columns = [{ header: 'ID', key: 'id', width: 8 }, { header: 'Дата', key: 'date', width: 20 }, { header: 'Имя', key: 'name', width: 18 }, { header: 'Телефон', key: 'phone', width: 18 }, { header: 'Задача', key: 'problem', width: 45 }, { header: 'Источник', key: 'source', width: 12 }, { header: 'Статус', key: 'status', width: 14 }];
  leads.forEach(l => { ws.addRow({ id: l.id, date: l.created_at ? new Date(l.created_at).toLocaleString('ru-RU') : '', name: l.name || '', phone: l.phone || '', problem: l.problem || '', source: l.source === 'telegram' ? 'Telegram' : 'Сайт', status: l.status === 'closed' ? 'Закрыта' : (l.status === 'in_progress' ? 'В работе' : 'Новая') }); });
  return await wb.xlsx.writeBuffer();
}

async function fetchLeads(sinceIso = null) {
  let url = `${SUPABASE_URL}/rest/v1/leads?select=*&order=id.desc&client_id=eq.${CLIENT_ID}`;
  if (sinceIso) url += `&created_at=gte.${encodeURIComponent(sinceIso)}`;
  const r = await fetch(url, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
  let leads = await r.json();
  if (!Array.isArray(leads)) leads = [];
  return leads.filter(l => isValidLead(l.name, l.phone));
}

function statsBlock(leads, periodLabel) {
  const total = leads.length; const closed = leads.filter(l => l.status === 'closed').length; const inProgress = leads.filter(l => l.status === 'in_progress').length; const newOnes = total - closed - inProgress; const conversion = total > 0 ? Math.round((closed / total) * 100) : 0; const sum = total * PRICE_PER_LEAD;
  return `📊 <b>${periodLabel}</b>\n\n📥 Всего заявок: <b>${total}</b>\n🆕 Новых: <b>${newOnes}</b>\n🔄 В работе: <b>${inProgress}</b>\n✅ Закрыто: <b>${closed}</b>\n📈 Конверсия: <b>${conversion}%</b>\n\n💰 По тарифу «за результат»: <b>${total} × ${PRICE_PER_LEAD} ₽ = ${sum} ₽</b>`;
}

// ========== ЭНДПОИНТЫ ==========

app.get('/health', (req, res) => res.json({ ok: true, client_id: CLIENT_ID }));
app.get('/', (req, res) => res.json({ ok: true, service: 'AI-Администратор', client_id: CLIENT_ID }));

app.post('/message', async (req, res) => {
  try {
    const { message, session_id } = req.body;
    if (!message) return res.status(400).json({ error: 'Введите сообщение' });
    const client = await getClient(CLIENT_ID);
    if (!isPaid(client)) return res.json({ reply: 'Сервис приостановлен.', session_id: session_id || 'default' });
    const sid = session_id || 'default';
    const session = await getOrCreateSession(sid);
    const reply = await askAI(message, session.history || [], sid);
    await updateSession(sid, { history: [...(session.history || []), { role: 'user', content: message }, { role: 'assistant', content: reply }].slice(-20) });
    res.json({ reply, session_id: sid });
  } catch (error) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/telegram-webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const msg = req.body.message;
    if (req.body.callback_query) {
      const cb = req.body.callback_query;
      if (String(cb.message.chat.id) !== String(MANAGER_CHAT_ID)) return answerCallback(cb.id, 'Нет доступа');
      if (cb.data.startsWith('status_')) {
        const parts = cb.data.split('_'); const leadId = parts[1]; const newStatus = parts.slice(2).join('_');
        await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, { method: 'PATCH', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }) });
        return answerCallback(cb.id, `Статус изменен`);
      }
      if (cb.data.startsWith('call_')) {
        const leadId = cb.data.split('_')[1];
        const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&select=*`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
        const rows = await r.json();
        if (rows[0]) { await answerCallback(cb.id, `Телефон: ${rows[0].phone}`); await sendContact(cb.message.chat.id, rows[0].phone, rows[0].name); }
        return;
      }
      return;
    }

    if (!msg) return;
    const chatId = msg.chat.id;
    let text = msg.text || '';

    if (text.startsWith('/start')) {
      return sendTelegram(chatId, `Здравствуйте! 👋\n\nЯ виртуальный администратор компании «${BUSINESS_NAME}». Чем могу помочь?`);
    }

    const isManager = String(chatId) === String(MANAGER_CHAT_ID);
    let chatSession = await getSessionByTelegram(chatId);
    if (!chatSession) {
      const newSid = 'tg_' + chatId; await getOrCreateSession(newSid); await updateSession(newSid, { telegram_chat_id: chatId }); chatSession = await getSessionByTelegram(chatId);
    }
    if (!chatSession) chatSession = { session_id: 'tg_' + chatId, history: [] };

    const reply = await askAI(text, chatSession.history || [], chatSession.session_id);
    await updateSession(chatSession.session_id, { history: [...(chatSession.history || []), { role: 'user', content: text }, { role: 'assistant', content: reply }].slice(-20) });
    await sendTelegram(chatId, reply);
  } catch (error) { console.log(error); }
});

app.get('/crawl', async (req, res) => {
  try {
    const scrape = await fetch('https://api.firecrawl.dev/v2/scrape', { method: 'POST', headers: { 'Authorization': `Bearer ${FIRECRAWL_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: SITE_TO_CRAWL, formats: ['markdown'] }) });
    const scrapeData = await scrape.json();
    if (!scrape.ok) return res.status(500).json({ error: 'Firecrawl error' });
    const text = scrapeData.data?.markdown || '';
    const chunks = []; for (let i = 0; i < text.length; i += 1000) chunks.push(text.slice(i, i + 1000));
    let saved = 0;
    for (const chunk of chunks) { try { const embedding = await getEmbedding(chunk); await saveDocument(chunk, embedding, SITE_TO_CRAWL); saved++; } catch (e) {} }
    res.json({ ok: true, saved, total: chunks.length });
  } catch (error) { res.status(500).json({ error: 'Ошибка кроулинга' }); }
});

app.get('/crm', (req, res) => res.sendFile(path.join(__dirname, 'crm.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'app.html')));

app.listen(PORT, () => console.log(`Сервер запущен: http://localhost:${PORT}`));
