const express = require('express');
const path = require('path');
const cors = require('cors');
const cron = require('node-cron');
// Добавляем библиотеку для проверки Telegram
const { AuthDataValidator } = require('@telegram-auth/server');
const { urlStrToAuthDataMap } = require('@telegram-auth/server/utils');

try { require('dotenv').config(); } catch (e) {}

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json({ limit: '25mb' }));

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';

const crypto = require('crypto');
const ADMIN_TG_ID = '5818548555';

function verifyTelegramInitData(initData) {
  try {
    if (!initData || typeof initData !== 'string') return null;
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dataCheckString = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(TELEGRAM_TOKEN).digest();
    const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    if (calc !== hash) return null;
    const user = JSON.parse(params.get('user') || '{}');
    return user && user.id ? String(user.id) : null;
  } catch (e) { return null; }
}

function signAuth(telegramId, days) {
  const ttl = days || 365;
  const exp = Math.floor(Date.now() / 1000) + ttl * 86400;
  const sig = crypto.createHmac('sha256', TELEGRAM_TOKEN).update(`${telegramId}.${exp}`).digest('hex').slice(0, 32);
  return `${telegramId}.${exp}.${sig}`;
}

function verifyAuthToken(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length === 2) {
      const [id, sig] = parts;
      const expect = crypto.createHmac('sha256', TELEGRAM_TOKEN).update(id).digest('hex').slice(0, 32);
      return sig === expect ? String(id) : null;
    }
    if (parts.length === 3) {
      const [id, exp, sig] = parts;
      if (Number(exp) * 1000 < Date.now()) return null;
      const expect = crypto.createHmac('sha256', TELEGRAM_TOKEN).update(`${id}.${exp}`).digest('hex').slice(0, 32);
      return sig === expect ? String(id) : null;
    }
    return null;
  } catch (e) { return null; }
}

function getRequesterId(req) {
  const fromInit = verifyTelegramInitData(req.headers['x-telegram-init-data'] || req.query.init_data);
  if (fromInit) return fromInit;
  return verifyAuthToken(req.headers['x-auth-token'] || req.query.auth);
}

async function ownedClientIds(telegramId) {
  if (String(telegramId) === ADMIN_TG_ID) return null; // null = доступ ко всем
  try {
    const r = await fetch(`${COMMON_SUPABASE_URL}/rest/v1/clients?select=client_id&owner_telegram_id=eq.${telegramId}`, {
      headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}` }
    });
    const rows = await r.json();
    return Array.isArray(rows) ? rows.map(x => x.client_id) : [];
  } catch (e) { return []; }
}

// Простой лимит запросов на /message: 20 в минуту с одного IP
const __rateBucket = new Map();
function __rateOk(ip) {
  const now = Date.now();
  const arr = (__rateBucket.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now);
  __rateBucket.set(ip, arr);
  if (__rateBucket.size > 5000) __rateBucket.clear();
  return arr.length <= 20;
}
app.use('/message', (req, res, next) => {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
  if (!__rateOk(ip)) return res.status(429).json({ error: 'Слишком много запросов, попробуйте позже' });
  next();
});

app.get('/api/auth-token', (req, res) => {
  const uid = getRequesterId(req);
  if (!uid) return res.status(401).json({ error: 'unauthorized' });
  res.json({ token: signAuth(uid) });
});

const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const COMMON_SUPABASE_URL = process.env.COMMON_SUPABASE_URL || process.env.SUPABASE_URL || '';
const COMMON_SUPABASE_KEY = process.env.COMMON_SUPABASE_KEY || process.env.SUPABASE_KEY || '';

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


// Филиалы клиента (JSON-массив в env BRANCHES), используются для кнопок выбора
const BRANCHES = (() => {
  try {
    const raw = process.env.BRANCHES || '';
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(x => typeof x === 'string' && x.trim()) : [];
  } catch (e) { return []; }
})();

const TARIFFS = {
  'start': { 
    name: 'Старт', 
    amountMonth: Number(process.env.TARIFF_START_MONTH) || 1990, 
    amountYear: Number(process.env.TARIFF_START_YEAR) || 14900 
  },
  'business': { 
    name: 'Бизнес', 
    amountMonth: Number(process.env.TARIFF_BUSINESS_MONTH) || 2490, 
    amountYear: Number(process.env.TARIFF_BUSINESS_YEAR) || 19900 
  },
  'unlimited': { 
    name: 'Безлимит', 
    amountMonth: Number(process.env.TARIFF_UNLIMITED_MONTH) || 4990, 
    amountYear: Number(process.env.TARIFF_UNLIMITED_YEAR) || 39900 
  },
  'result': { 
    name: 'За результат', 
    amountMonth: 25, 
    amountYear: 25 
  }
};

const processedUpdates = new Set();
const newClientStates = {}; // Память для пошагового создания
const BUSINESS_PROMPT = process.env.BUSINESS_PROMPT || 'Ты — AI-Администратор компании «' + BUSINESS_NAME + '». Опытный, живой менеджер по продажам: общаешься с клиентами на сайте и в Telegram, коротко и по делу.';

// ========== КЛИЕНТЫ И ОПЛАТА ==========

async function getClient(clientId) {
  try {
    const isTilda = clientId === 'tilda';
    const url = isTilda ? SUPABASE_URL : COMMON_SUPABASE_URL;
    const key = isTilda ? SUPABASE_KEY : COMMON_SUPABASE_KEY;

    const r = await fetch(`${url}/rest/v1/clients?client_id=eq.${clientId}&select=*&limit=1`, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
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
  const base = client.paid_until && new Date(client.paid_until) > new Date()
    ? new Date(client.paid_until)
    : new Date();
  base.setMonth(base.getMonth() + months);
  await fetch(`${COMMON_SUPABASE_URL}/rest/v1/clients?client_id=eq.${clientId}`, {
    method: 'PATCH',
    headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ paid_until: base.toISOString(), updated_at: new Date().toISOString() })
  });
  return base;
}

async function disablePayment(clientId) {
  await fetch(`${COMMON_SUPABASE_URL}/rest/v1/clients?client_id=eq.${clientId}`, {
    method: 'PATCH',
    headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ paid_until: new Date(Date.now() - 86000).toISOString(), updated_at: new Date().toISOString() })
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
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Idempotence-Key': idempotenceKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: { value: amount.toFixed(2), currency: 'RUB' },
        capture: true,
        confirmation: { type: 'redirect', return_url: YOOKASSA_RETURN_URL },
        description: `AI-Администратор: ${desc}`,
        receipt: {
          customer: { email: 'chaknoris5000@gmail.com' },
          items: [{
            description: `Подписка ${tariff.name}`,
            quantity: '1.00',
            amount: { value: amount.toFixed(2), currency: 'RUB' },
            vat_code: 1,
            payment_mode: 'full_payment',
            payment_subject: 'service'
          }]
        },
        metadata: { chat_id: chatId.toString(), tariff: tariffKey, period: period }
      })
    });
    
    const data = await r.json();
    if (r.ok && data.confirmation && data.confirmation.confirmation_url) {
      return data.confirmation.confirmation_url;
    }
    console.log('Ошибка ЮKassa:', data);
    return null;
  } catch (e) {
    console.log('Ошибка запроса к ЮKassa:', e.message);
    return null;
  }
}

// ========== БАЗОВЫЕ ФУНКЦИИ ==========

async function getEmbedding(text) {
  const r = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
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

async function searchDocuments(queryEmbedding, limit = 8) {
  try {
    const r = await fetch(`${COMMON_SUPABASE_URL}/rest/v1/documents?client_id=eq.${CLIENT_ID}&select=id,content,url,embedding`, {
      headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}` }
    });
    if (!r.ok) { console.log('Supabase fetch error'); return []; }
    const docs = await r.json();
    if (!Array.isArray(docs) || docs.length === 0) { console.log('docs empty'); return []; }

    function parseEmb(str) {
      if (!str) return [];
      if (Array.isArray(str)) return str;
      return String(str).replace(/[\[\]]/g, '').split(',').map(Number);
    }
    function cos(a, b) {
      let dot = 0, na = 0, nb = 0;
      const len = Math.min(a.length, b.length);
      for (let i = 0; i < len; i++) {
        dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
      }
      return dot / (Math.sqrt(na) * Math.sqrt(nb));
    }

    const scored = docs.map(doc => ({
      id: doc.id,
      content: doc.content,
      similarity: cos(queryEmbedding, parseEmb(doc.embedding))
    }));
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  } catch (e) {
    console.log('search error:', e.message);
    return [];
  }
}

async function saveDocument(content, embedding, url) {
  const r = await fetch(`${COMMON_SUPABASE_URL}/rest/v1/documents`, {
    method: 'POST',
    headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ content, embedding, url, client_id: CLIENT_ID })
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`saveDocument ${r.status}: ${errText.slice(0, 300)}`);
  }
}

async function getOrCreateSession(sessionId) {
  try {
    const r = await fetch(`${COMMON_SUPABASE_URL}/rest/v1/chat_sessions?session_id=eq.${sessionId}&client_id=eq.${CLIENT_ID}&select=*`, {
      headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}` }
    });
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length > 0) return rows[0];
    const ins = await fetch(`${COMMON_SUPABASE_URL}/rest/v1/chat_sessions`, {
      method: 'POST',
      headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({ session_id: sessionId, history: [], client_id: CLIENT_ID })
    });
    const created = await ins.json();
    if (Array.isArray(created) && created.length > 0) return created[0];
    return { session_id: sessionId, history: [], client_id: CLIENT_ID };
  } catch (e) { return { session_id: sessionId, history: [], client_id: CLIENT_ID }; }
}

async function getSessionByTelegram(chatId) {
  try {
    const r = await fetch(`${COMMON_SUPABASE_URL}/rest/v1/chat_sessions?telegram_chat_id=eq.${chatId}&client_id=eq.${CLIENT_ID}&select=*&order=updated_at.desc&limit=1`, {
      headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}` }
    });
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch (e) { return null; }
}

async function updateSession(sessionId, patch) {
  try {
    await fetch(`${COMMON_SUPABASE_URL}/rest/v1/chat_sessions?session_id=eq.${sessionId}&client_id=eq.${CLIENT_ID}`, {
      method: 'PATCH',
      headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
    });
  } catch (e) {}
}

async function saveLead(sessionId, name, phone, problem, source = 'site') {
  try {
    // Жесткая привязка: если это Тильда - всегда шлем в Тильду.
    // Если это копия - всегда шлем в Общую базу.
    const isTildaBot = CLIENT_ID === 'tilda';
    const targetUrl = isTildaBot ? SUPABASE_URL : COMMON_SUPABASE_URL;
    const targetKey = isTildaBot ? SUPABASE_KEY : COMMON_SUPABASE_KEY;
    
    // Защита от перекрестных заявок: используем тот ID, который прописан в константе.
    const finalClientId = CLIENT_ID;

    const r = await fetch(`${targetUrl}/rest/v1/leads`, {
      method: 'POST',
      headers: { 'apikey': targetKey, 'Authorization': `Bearer ${targetKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({ session_id: sessionId, client_id: finalClientId, name: name || null, phone: phone || null, problem: problem || null, source, status: 'new' })
    });
    const inserted = await r.json();
    const leadId = Array.isArray(inserted) && inserted[0] ? inserted[0].id : 0;
    console.log('💾 saveLead status:', r.status, '| id:', leadId, '| name:', name, '| phone:', phone);
    return leadId;
  } catch (e) {
    console.log('❌ saveLead error:', e.message);
    return 0;
  }
}

// ========== TELEGRAM API ==========

async function sendTelegram(chatId, text, keyboard = null) {
  const body = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: false };
  if (keyboard) body.reply_markup = { inline_keyboard: keyboard };
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function sendTelegramDoc(chatId, buffer, filename, caption = '') {
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('document', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  if (caption) formData.append('caption', caption);
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, { method: 'POST', body: formData });
}

async function sendContact(chatId, phone, name) {
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('phone_number', phone);
  formData.append('first_name', name || 'Клиент');
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendContact`, { method: 'POST', body: formData });
}

async function answerCallback(callbackId, text = '') {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text })
  });
}

async function editMessage(chatId, messageId, text, keyboard = null) {
  const body = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
  if (keyboard) body.reply_markup = { inline_keyboard: keyboard };
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
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
    .replace(/\[SCROLL:[^\]]*\]/g, '') 
    .replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/__(.*?)__/g, '$1').replace(/_(.*?)_/g, '$1')
    .replace(/^#{1,6}\s+/gm, '').replace(/`/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map(l => l.trim()).filter(l => l.length).join('\n')
    .trim();
}

async function notifyManager(lead, leadId) {
  if (!MANAGER_CHAT_ID) return;
  const text = `🔥 <b>НОВАЯ ЗАЯВКА</b>\n\n` +
    `👤 <b>Имя:</b> ${lead.name || '—'}\n` +
    `📞 <b>Телефон:</b> ${lead.phone || '—'}\n` +
    `💬 <b>Задача:</b> ${lead.problem || '—'}\n\n` +
    `<i>Статус: 🆕 Новая</i>`;

  const keyboard = [
    [{ text: '🔄 Взять в работу', callback_data: `status_${leadId}_in_progress` }],
    [
      { text: '📞 Позвонить', callback_data: `call_${leadId}` },
      { text: '✉️ Написать', callback_data: `write_${leadId}` }
    ]
  ];

  try {
    await sendTelegram(MANAGER_CHAT_ID, text, keyboard);
    console.log('✅ Уведомление отправлено менеджеру:', lead.phone);
  } catch (e) {
    console.log('❌ notifyManager error:', e.message);
  }
}

// ========== ИИ ==========

async function askAI(message, history, sessionId) {
    // --- ПРОВЕРКА ЛИМИТА ЗАЯВОК ---
  try {
    const client = await getClient(CLIENT_ID);
    if (client && client.leads_limit) {
      // Считаем заявки за текущий месяц
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const countUrl = `${COMMON_SUPABASE_URL}/rest/v1/leads?client_id=eq.${CLIENT_ID}&created_at=gte.${monthStart}&select=id`;
      const countRes = await fetch(countUrl, {
        headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}` }
      });
      const currentLeads = await countRes.json();
      
      if (Array.isArray(currentLeads) && currentLeads.length >= client.leads_limit) {
        console.log(`⛔️ Лимит исчерпан для ${CLIENT_ID}. Заявок: ${currentLeads.length} из ${client.leads_limit}`);
        try {
          const chatId = client.chat_id || MANAGER_CHAT_ID;
          const dayKey = new Date().toISOString().slice(0, 10) + '_' + CLIENT_ID;
          global.__limitNotified = global.__limitNotified || {};
          if (chatId && global.__limitNotified[dayKey] !== currentLeads.length) {
            global.__limitNotified[dayKey] = currentLeads.length;
            await sendTelegram(chatId,
              `⚠️ <b>Лимит заявок исчерпан</b>\n\n` +
              `Тариф «${client.tariff || 'business'}»: ${currentLeads.length} из ${client.leads_limit} заявок за месяц.\n` +
              `Новые заявки не собираются. Продлите тариф или увеличьте лимит.`);
          }
        } catch (e) { console.log('limit notify error:', e.message); }
        return 'Лимит заявок на этот месяц исчерпан. Пожалуйста, свяжитесь с менеджером для продления тарифа.';
      }
    }
  } catch (e) {
    console.log('Ошибка проверки лимита:', e.message);
  }
  // -------------------------------
  let context = '';
  try {
        const emb = await getEmbedding(message);
    const matches = await searchDocuments(emb, 8);
    if (matches.length > 0) {
      context = matches.map(m => m.content).join('\n\n---\n\n');
    }
  } catch (e) { console.log('Контекст не собран:', e.message); }
  
  const clientConfig = await getClient(CLIENT_ID);
    // Получаем часовой пояс клиента из базы (или берем Москву, если нет)
  const now = new Date();
    // Получаем часовой пояс клиента из базы (или берем Москву, если нет)
  const clientTz = clientConfig?.timezone || 'Europe/Moscow';
  
  // Смещения для часовых поясов
  const offsets = {
    'Europe/Moscow': 3,
    'Asia/Yekaterinburg': 5,
    'Asia/Novosibirsk': 7,
    'Asia/Novokuznetsk': 7,
    'Asia/Krasnoyarsk': 7,
    'Asia/Vladivostok': 10
  };
  const offsetHours = offsets[clientTz] || 3; // По умолчанию Москва
  
  // Считаем точное время и минуты
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
  const localDate = new Date(utcMs + (offsetHours * 3600000));
  
  const currentDate = localDate.toLocaleDateString('ru-RU', { 
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' 
  }) + ', ' + localDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    // Идентичность клиента + правила + БАЗА ЗНАНИЙ. Контекст подставляется ВСЕГДА,
    // даже если промпт задан в БД, иначе бот отвечает без базы знаний и выдумывает факты.
    const identityPrompt = (clientConfig?.prompt || BUSINESS_PROMPT || '').trim();
    const isSaasBot = CLIENT_ID === 'tilda';
    const saasBlock = `Ты — AI-Администратор компании «${BUSINESS_NAME}». Ты опытный, живой менеджер по продажам, который общается с клиентами на сайте и в Telegram. Твоя цель — продать услугу, собрать заявку и мягко работать с возражениями.
1. Ты — живой человек, а не робот. Общайся максимально естественно, как в обычном чате. Используй слова вроде «Отлично», «Понял», «Да, это решаемо».
2. Отвечай ОЧЕНЬ коротко: строго 2-3 предложения. Никаких длинных текстов и простыней.
3. НЕ используй списки, тире, нумерацию, звёздочки. Только обычный текст.
4. Не повторяй вопрос клиента. Не используй шаблонные фразы.
5. Задавай ОДИН наводящий вопрос за раз, чтобы поддерживать диалог.
6. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО повторять один и тот же оффер в каждом сообщении. Предлагай подключиться только тогда, когда клиент сам проявит интерес. Не дави на него.
7. НИКОГДА не пиши маркеры [LEAD_SAVE] в обычных сообщениях.

УМНАЯ НАВИГАЦИЯ ПО САЙТУ:
Если клиент спрашивает про цены/тарифы — в ответе ОБЯЗАТЕЛЬНО добавь тег [SCROLL:tariffs]. 
Если клиент спрашивает "как это работает" — добавь [SCROLL:how].
Если клиент просит показать примеры/демо — добавь [SCROLL:demos].
Если клиент спрашивает про гарантии — добавь [SCROLL:guarantee].
Если спрашивает "почему вы" или "почему я" — добавь [SCROLL:why-me].
Если спрашивает "кому подходит" или про сферы бизнеса — добавь [SCROLL:for-whom].
Если просит оферту или договор — добавь [SCROLL:oferta].
Если просит отзывы — добавь [SCROLL:reviews].

ТВОИ ЗНАНИЯ О ПРОДУКТЕ:
- Бот работает 24/7, отвечает мгновенно.
- Понимает голосовые сообщения.
- Собирает заявки (имя, телефон, запрос).
- Работает как CRM: все заявки в одном месте, группировка, выгрузка в Excel и на почту.
- Первая неделя и настройка ВСЕГДА бесплатно.
- Отключить можно в любой момент (без штрафов).

ТАРИФЫ И ЦЕНЫ (ЗНАЙ ИХ НАИЗУСТЬ):
1. Тариф «Старт» — ${TARIFFS.start.amountMonth} ₽/мес (до 100 заявок, свыше — ${PRICE_PER_LEAD} ₽/заявка). При годовой оплате — ${TARIFFS.start.amountYear} ₽/год.
2. Тариф «Бизнес» — ${TARIFFS.business.amountMonth} ₽/мес (до 300 заявок, свыше — ${PRICE_PER_LEAD} ₽/заявка). При годовой оплате — ${TARIFFS.business.amountYear} ₽/год.
3. Тариф «Безлимит» — ${TARIFFS.unlimited.amountMonth} ₽/мес (без ограничений). При годовой оплате — ${TARIFFS.unlimited.amountYear} ₽/год.
4. Тариф «За результат» — ${PRICE_PER_LEAD} ₽ за заявку (платит в конце месяца).

ПРАВИЛА ПРОДАЖ (ВОРОНКА):
1. Поздоровайся и спроси, чем занимается бизнес.
2. Уточни боль: теряются ли заявки?
3. Покажи выгоду.
4. Если спрашивают цену — озвучь ВСЕ 4 ТАРИФА кратко.
5. Обязательно подчеркни: "Настройка и первая неделя бесплатно" (но только если уместно!).
6. Призыв к действию: не проси контакты сразу. Сначала ответь на вопрос и помоги. Предложи оставить имя и телефон только тогда, когда клиент готов к следующему шагу (сам спросил «как записаться», «хочу подключить», уточняет детали или сомневается).

СБОР ЗАЯВКИ:
Когда клиент назвал имя + телефон — добавь в САМОМ КОНЦЕ ответа строку ровно такого вида, подставив РЕАЛЬНЫЕ данные клиента:
[LEAD_SAVE][NAME:Иван][PHONE:+79001234567][PROBLEM:краткая суть]
Никогда не выводи вместо значений слова «имя», «телефон», «суть» или угловые скобки.

КОНТЕКСТ ДИАЛОГА:
Если ты видишь, что диалог начался на сайте (в истории есть предыдущие сообщения), не начинай разговор с нуля. Продолжай его по смыслу. Например: "Возвращаясь к вашему вопросу про тарифы..." или "Как я понял, вас интересует...".
`;
    const clientBlock = `Ты — AI-Администратор компании «${BUSINESS_NAME}». Твоя задача — консультировать клиентов по услугам и товарам компании и собирать заявки.

ГЛАВНОЕ ПРАВИЛО: все факты (адрес, телефон, цены, услуги, график) бери ТОЛЬКО из блока «БАЗА ЗНАНИЙ» ниже. Не используй свои общие знания о компаниях и городах. Если факта в базе нет — скажи: «Уточню у администратора» и предложи оставить имя и телефон.

ПРАВИЛА:
1. Ты — живой человек. Общайся естественно, с эмпатией, без канцелярита.
2. Отвечай коротко: 1-2 предложения.
3. Помни историю диалога, не задавай вопросы, на которые уже ответили.
4. Не используй списки, тире, звёздочки и markdown.
5. Если спрашивают адрес, телефон, цены или график — найди эту строку в «БАЗЕ ЗНАНИЙ» и передай её смысл дословно, ничего не добавляя от себя.
6. Категорически запрещено называть адрес, телефон или цену, которых нет в «БАЗЕ ЗНАНИЙ», даже если ты «знаешь» эту компанию.
7. Имя и телефон проси только тогда, когда клиент сам проявил интерес (спросил цену, «хочу», «запишите»).

СБОР ЗАЯВКИ:
Когда клиент назвал имя И телефон — добавь в САМОМ КОНЦЕ ответа строку ровно такого вида, подставив РЕАЛЬНЫЕ данные:
[LEAD_SAVE][NAME:Иван][PHONE:+79001234567][PROBLEM:краткая суть]
Никогда не выводи вместо значений слова «имя», «телефон», «суть» или угловые скобки.`;
    const systemPrompt = `${identityPrompt ? identityPrompt + '\n\n' : ''}СЕГОДНЯШНЯЯ ДАТА И ВРЕМЯ: ${currentDate}.\n\n${isSaasBot ? saasBlock : clientBlock}\n\nБАЗА ЗНАНИЙ:\n{context || 'Информация временно недоступна.'}`;

        const limitPrompt = `СЕГОДНЯШНЯЯ ДАТА И ВРЕМЯ: ${currentDate}.\n\n` + systemPrompt + `

ВАЖНО:
- Отвечай кратко (1-2 предложения), по-человечески, без списков.
- Твоя цель — помочь клиенту и мягко подвести к покупке/записи.
- Имя и телефон проси ТОЛЬКО когда клиент сам проявил интерес (спросил цену, сказал «хочу», «запишите», «подключить» и т.п.) и ещё их не дал.
- НЕ спрашивай имя/телефон в каждом сообщении. Если уже спрашивал и клиент не дал — не дави, продолжай помогать.
- Когда клиент сам назвал имя И телефон — добавь в самом конце: [LEAD_SAVE][NAME:имя][PHONE:телефон][PROBLEM:суть]`;
  const messages = [
    { role: 'system', content: limitPrompt },
    ...(history || []).slice(-10),
    { role: 'user', content: message }
  ];

  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: AI_MODEL_CHAT, messages, temperature: CLIENT_ID === 'tilda' ? 0.6 : 0.2, max_tokens: 150 })
  });
  const data = await r.json();
  if (!r.ok) throw new Error('OpenRouter error');
  let reply = data.choices?.[0]?.message?.content || 'Нет ответа';

  // Защита от выдуманных фактов: если в ответе про адрес/телефон есть цифры или слова,
  // которых нет в базе знаний — значит модель сочинила. Отвечаем безопасно.
  if (CLIENT_ID !== 'tilda') {
    const asksContact = /адрес|где\s|где вы|где находит|добрат|телефон|позвон|контакт/i.test(message || '');
    if (asksContact) {
      const ctx = (context || '').toLowerCase();
      const ctxDigits = (ctx.match(/\d+/g) || []).join(' ');
      const replyDigits = (reply.match(/\d{3,}/g) || []);
      const badDigits = replyDigits.filter(d => !ctxDigits.includes(d));
      const streetWords = ['проспект', 'улица', 'ул.', 'переулок', 'бульвар', 'трц', 'этаж', 'д.'];
      const badStreet = streetWords.some(w => reply.toLowerCase().includes(w) && !ctx.includes(w));
      if (badDigits.length > 0 || badStreet) {
        console.log('⚠️ выдуманные контакты, ответ заменён:', reply.slice(0, 80));
        // Отвечаем фактом из базы знаний, а не отказом
        const wantsPhone = /телефон|позвон|номер/i.test(message || '');
        let grounded = '';
        if (wantsPhone) {
          const m = (context || '').match(/\+?7[\d\s\-()]{9,}/);
          if (m) grounded = 'Наш телефон: ' + m[0].trim().replace(/[^\d+]+$/, '');
        }
        if (!grounded) {
          const m = (context || '').match(/[^\n]{0,40}(?:улица|ул\.|проспект|трц)[^\n]{0,60}/i);
          if (m) grounded = 'Наш адрес: ' + m[0].trim().replace(/^[^\wА-Яа-я+]+/, '');
        }
        reply = grounded || 'Уточню точный адрес и телефон у администратора. Оставьте, пожалуйста, имя и номер — мы свяжемся и всё расскажем.';
      }
    }
  }

  const lowerMsg = message.toLowerCase();
  
  // Сайтовые ответы (тарифы, демо, оферта) — только для бота-витрины.
  if (CLIENT_ID === 'tilda') {
    if (lowerMsg.includes('тариф') || lowerMsg.includes('цен') || lowerMsg.includes('стоимост') || lowerMsg.includes('подробн')) {
    reply = `Есть 4 тарифа:
    
1. <b>Старт</b> — ${TARIFFS.start.amountMonth} ₽/мес (до 100 заявок)
2. <b>Бизнес</b> — ${TARIFFS.business.amountMonth} ₽/мес (до 300 заявок)
3. <b>Безлимит</b> — ${TARIFFS.unlimited.amountMonth} ₽/мес (без ограничений)
4. <b>За результат</b> — ${PRICE_PER_LEAD} ₽ за заявку

Первая неделя и настройка бесплатно. Какой объём заявок у вас обычно?

Посмотреть тарифы: ${BASE_URL}/?go=tariffs`;
  }
  
  if (lowerMsg.includes('как работает') || lowerMsg.includes('как это работает')) {
    if (!reply.includes('[SCROLL:')) reply += ' [SCROLL:how]';
    if (!reply.includes(BASE_URL)) reply += `\n\nКак это работает: ${BASE_URL}/?go=how`;
  }
  
    if (lowerMsg.includes('пример') || lowerMsg.includes('демо') || lowerMsg.includes('покажи')) {
    reply = `Вы можете посмотреть живые примеры работы бота на нашем сайте. Там есть 4 демо-сайта: салон красоты, стоматология, автосервис и магазин запчастей.\n\nПосмотреть их можно здесь: ${BASE_URL}/?go=demos\nНажмите на любую карточку и протестируйте бота в действии.`;
  }

  if (lowerMsg.includes('ссылка') || lowerMsg.includes('сайт') || lowerMsg.includes('адрес')) {
    reply = `Наш официальный сайт: ${BASE_URL}\n\nТам вы можете посмотреть тарифы, примеры работ и оставить заявку.`;
  }
 
  if (lowerMsg.includes('гаранти')) {
    if (!reply.includes('[SCROLL:')) reply += ' [SCROLL:guarantee]';
    if (!reply.includes(BASE_URL)) reply += `\n\nО гарантиях: ${BASE_URL}/?go=guarantee`;
  }

  if (lowerMsg.includes('почему вы') || lowerMsg.includes('почему я') || lowerMsg.includes('кому доверять')) {
    if (!reply.includes('[SCROLL:')) reply += ' [SCROLL:why-me]';
    if (!reply.includes(BASE_URL)) reply += `\n\nПочему стоит выбрать нас: ${BASE_URL}/?go=why-me`;
  }

  if (lowerMsg.includes('выгод')) {
    if (!reply.includes('[SCROLL:')) reply += ' [SCROLL:benefits]';
    if (!reply.includes(BASE_URL)) reply += `\n\nВыгоды: ${BASE_URL}/?go=benefits`;
  }

  if (lowerMsg.includes('прибыл') || lowerMsg.includes('заработ')) {
    if (!reply.includes('[SCROLL:')) reply += ' [SCROLL:profit]';
    if (!reply.includes(BASE_URL)) reply += `\n\nО прибыли: ${BASE_URL}/?go=profit`;
  }

  if (lowerMsg.includes('кому подход') || lowerMsg.includes('какой бизнес') || lowerMsg.includes('сферы')) {
    if (!reply.includes('[SCROLL:')) reply += ' [SCROLL:for-whom]';
    if (!reply.includes(BASE_URL)) reply += `\n\nКому подходит: ${BASE_URL}/?go=for-whom`;
  }

  if (lowerMsg.includes('оферт') || lowerMsg.includes('договор')) {
    if (!reply.includes('[SCROLL:')) reply += ' [SCROLL:oferta]';
    if (!reply.includes(BASE_URL)) reply += `\n\nПубличная оферта: ${BASE_URL}/?go=oferta`;
  }

  if (lowerMsg.includes('отзыв')) {
    if (!reply.includes('[SCROLL:')) reply += ' [SCROLL:reviews]';
    if (!reply.includes(BASE_URL)) reply += `\n\nОтзывы клиентов: ${BASE_URL}/?go=reviews`;
  }
  }

  const leadData = extractLeadData(reply); 
  console.log('🔍 Проверка лида:', JSON.stringify(leadData));
   
  if (leadData.save && isValidLead(leadData.name, leadData.phone)) {
    try {
      const leadId = await saveLead(sessionId, leadData.name, leadData.phone, leadData.problem);
      await notifyManager(leadData, leadId);
    } catch (e) { console.log('lead save/notify error:', e.message); }
  }

  return cleanReply(reply);
}

// ========== ЭКСПОРТ XLSX ==========

async function buildXlsx(leads, title = 'Заявки') {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title);

  ws.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Дата', key: 'date', width: 20 },
    { header: 'Имя', key: 'name', width: 18 },
    { header: 'Телефон', key: 'phone', width: 18 },
    { header: 'Задача', key: 'problem', width: 45 },
    { header: 'Источник', key: 'source', width: 12 },
    { header: 'Статус', key: 'status', width: 14 }
  ];

  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5B43' } };
  ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 24;

  leads.forEach(l => {
    ws.addRow({
      id: l.id,
      date: l.created_at ? new Date(l.created_at).toLocaleString('ru-RU') : '',
      name: l.name || '',
      phone: l.phone || '',
      problem: l.problem || '',
      source: l.source === 'telegram' ? 'Telegram' : 'Сайт',
      status: l.status === 'closed' ? 'Закрыта' : (l.status === 'in_progress' ? 'В работе' : 'Новая')
    });
  });

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        right: { style: 'thin', color: { argb: 'FFDDDDDD' } }
      };
      cell.alignment = { vertical: 'top', wrapText: true };
      if (rowNumber > 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowNumber % 2 === 0 ? 'FFF7F9F8' : 'FFFFFFFF' } };
      }
    });
  });

  return await wb.xlsx.writeBuffer();
}

async function fetchLeads(sinceIso = null) {
  let url = `${COMMON_SUPABASE_URL}/rest/v1/leads?select=*&order=id.desc&client_id=eq.${CLIENT_ID}`;
  if (sinceIso) url += `&created_at=gte.${encodeURIComponent(sinceIso)}`;
  const r = await fetch(url, {
    headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}` }
  });
  let leads = await r.json();
  if (!Array.isArray(leads)) leads = [];
  return leads.filter(l => isValidLead(l.name, l.phone));
}

function statsBlock(leads, periodLabel) {
  const total = leads.length;
  const closed = leads.filter(l => l.status === 'closed').length;
  const inProgress = leads.filter(l => l.status === 'in_progress').length;
  const newOnes = total - closed - inProgress;
  const conversion = total > 0 ? Math.round((closed / total) * 100) : 0;
  const sum = total * PRICE_PER_LEAD;

  return `📊 <b>${periodLabel}</b>\n\n` +
    `📥 Всего заявок: <b>${total}</b>\n` +
    `🆕 Новых: <b>${newOnes}</b>\n` +
    `🔄 В работе: <b>${inProgress}</b>\n` +
    `✅ Закрыто: <b>${closed}</b>\n` +
    `📈 Конверсия: <b>${conversion}%</b>\n\n` +
    `💰 По тарифу «за результат»: <b>${total} × ${PRICE_PER_LEAD} ₽ = ${sum} ₽</b>`;
}

// ========== HEALTH ==========
app.get('/crm', (req, res) => {
  res.sendFile(path.join(__dirname, 'crm.html'));
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'app.html'));
});
app.get('/api/get-my-client', async (req, res) => {
  try {
    const uid = getRequesterId(req);
    if (!uid) return res.status(401).json({ error: 'unauthorized' });
    const { owner_telegram_id } = req.query;
    if (String(owner_telegram_id || uid) !== String(uid) && String(uid) !== ADMIN_TG_ID) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const url = `${COMMON_SUPABASE_URL}/rest/v1/clients?select=*&owner_telegram_id=eq.${owner_telegram_id}&client_id=eq.${CLIENT_ID}&limit=1`;
    const r = await fetch(url, {
      headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}` }
    });
    const data = await r.json();
    res.json(Array.isArray(data) && data.length > 0 ? data[0] : null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/api/get-leads', async (req, res) => {
  try {
    const uid = getRequesterId(req);
    if (!uid) return res.status(401).json({ error: 'unauthorized' });
    const { client_id } = req.query;
    const allowed = await ownedClientIds(uid);
    if (allowed && (!client_id || !allowed.includes(client_id))) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const isTilda = client_id === 'tilda';
    const baseUrl = isTilda ? SUPABASE_URL : COMMON_SUPABASE_URL;
    const baseKey = isTilda ? SUPABASE_KEY : COMMON_SUPABASE_KEY;

    let url = `${baseUrl}/rest/v1/leads?select=*&order=id.desc`;
    if (client_id) url += `&client_id=eq.${client_id}`;
    
    const r = await fetch(url, {
      headers: { 'apikey': baseKey, 'Authorization': `Bearer ${baseKey}` }
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/yookassa-webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const event = req.body;
    
    if (event.event === 'payment.succeeded') {
      const payment = event.object;
      const chatId = payment.metadata.chat_id;
      const tariffKey = payment.metadata.tariff;
      const period = payment.metadata.period || 'month';

      if (chatId && tariffKey) {
        const monthsToAdd = period === 'year' ? 12 : 1;
        await extendPayment(chatId.toString(), monthsToAdd); 
        
        const tariffName = TARIFFS[tariffKey]?.name || 'AI-Администратор';
        const periodLabel = period === 'year' ? '1 год' : '1 месяц';

        await sendTelegram(chatId, 
          `✅ <b>Оплата прошла успешно!</b>\n\n` +
          `Сумма: ${payment.amount.value} ₽\n` +
          `Ваша подписка на тариф «${tariffName}» активирована на ${periodLabel}.\n\n` +
          `Спасибо за доверие!`
        );
        
        if (MANAGER_CHAT_ID) {
          await sendTelegram(MANAGER_CHAT_ID, 
            `💰 <b>Новая оплата!</b>\n` +
            `Клиент: ${chatId}\n` +
            `Тариф: ${tariffName}\n` +
            `Период: ${periodLabel}\n` +
            `Сумма: ${payment.amount.value} ₽`
          );
        }
      }
    }
  } catch (e) {
    console.log('Ошибка вебхука ЮKassa:', e.message);
  }
});

app.post('/message', async (req, res) => {
  try {
    const { message, session_id } = req.body;
    if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Введите сообщение' });

    const client = await getClient(CLIENT_ID);
    if (!isPaid(client)) {
      return res.json({ reply: 'Сервис временно приостановлен. Свяжитесь с менеджером.', session_id: session_id || 'default' });
    }

    // Пространство имён на клиента: два разных бота с одинаковым session_id
    // больше не попадут в одну и ту же историю диалога.
    const rawSid = String(session_id || 'default');
    const sid = rawSid.startsWith(CLIENT_ID + '_') ? rawSid : `${CLIENT_ID}_${rawSid}`;
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
        const updateId = req.body.update_id;
    if (updateId) {
      if (processedUpdates.has(updateId)) {
        console.log('♻️ Дубль пропущен:', updateId);
        return;
      }
      processedUpdates.add(updateId);
      if (processedUpdates.size > 500) {
        const arr = Array.from(processedUpdates);
        processedUpdates.clear();
        arr.slice(-200).forEach(id => processedUpdates.add(id));
      }
    }

    if (req.body.callback_query) {
      const cb = req.body.callback_query;
      const chatId = cb.message.chat.id;
      const messageId = cb.message.message_id;
      const data = cb.data;

      // Выбор филиала клиентом (кнопки в его чате)
      if (String(data).startsWith('br_')) {
        const idx = Number(String(data).slice(3));
        const addr = BRANCHES[idx];
        if (!addr) { await answerCallback(cb.id, 'Не найдено'); return; }
        await answerCallback(cb.id, addr);
        await sendTelegram(chatId, 'Вы выбрали филиал: <b>' + addr + '</b>\n\nОн находится по этому адресу. Хотите записаться?');
        try {
          const sess = await getSessionByTelegram(chatId);
          if (sess) {
            const h = sess.history || [];
            h.push({ role: 'user', content: 'Выбрал филиал: ' + addr });
            await updateSession(sess.session_id, { history: h.slice(-20) });
          }
        } catch (e) {}
        return;
      }

      if (String(chatId) !== String(MANAGER_CHAT_ID)) { await answerCallback(cb.id, 'Нет доступа'); return; }

      if (data === 'menu_bill') {
        const billText = `<b>Наши тарифы:</b>\n\n` +
          `1. <b>Старт</b> — ${TARIFFS.start.amountMonth} ₽/мес (до 100 заявок, далее ${PRICE_PER_LEAD} ₽/заявка).\n` +
          `2. <b>Бизнес</b> — ${TARIFFS.business.amountMonth} ₽/мес (до 300 заявок, далее ${PRICE_PER_LEAD} ₽/заявка).\n` +
          `3. <b>Безлимит</b> — ${TARIFFS.unlimited.amountMonth} ₽/мес (без ограничений).\n` +
          `4. <b>За результат</b> — ${PRICE_PER_LEAD} ₽ за заявку.\n\n` +
          `<i>При оплате за год скидка! Первая неделя бесплатно.</i>`;
        
        await answerCallback(cb.id, 'Загружаю тарифы...');
        await sendTelegram(chatId, billText);
        await sendTelegram(chatId, `Подробнее на сайте: ${BASE_URL}/?go=tariffs`);
        return;
      }

      if (data.startsWith('status_')) {
        const parts = data.split('_');
        const leadId = parts[1];
        const newStatus = parts.slice(2).join('_');

        await fetch(`${COMMON_SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
          method: 'PATCH',
          headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ status: newStatus, updated_at: new Date().toISOString() })
        });

        const statusLabel = newStatus === 'closed' ? '✅ Закрыта' : (newStatus === 'in_progress' ? '🔄 В работе' : '🆕 Новая');
        await answerCallback(cb.id, `Статус: ${statusLabel}`);

        let newKeyboard = [];
        if (newStatus === 'in_progress') {
          newKeyboard = [
            [{ text: '✅ Закрыть', callback_data: `status_${leadId}_closed` }],
            [
              { text: '📞 Позвонить', callback_data: `call_${leadId}` },
              { text: '✉️ Написать', callback_data: `write_${leadId}` }
            ]
          ];
        } else if (newStatus === 'closed') {
          newKeyboard = [[{ text: '🔄 Вернуть в работу', callback_data: `status_${leadId}_in_progress` }]];
        } else {
          newKeyboard = [
            [{ text: '🔄 Взять в работу', callback_data: `status_${leadId}_in_progress` }],
            [
              { text: '📞 Позвонить', callback_data: `call_${leadId}` },
              { text: '✉️ Написать', callback_data: `write_${leadId}` }
            ]
          ];
        }

        const baseText = cb.message.text.replace(/\n\n<i>Статус:.*<\/i>$/, '');
        await editMessage(chatId, messageId, `${baseText}\n\n<i>Статус: ${statusLabel}</i>`, newKeyboard);
        return;
      }

      if (data.startsWith('call_')) {
        const leadId = data.split('_')[1];
        const r = await fetch(`${COMMON_SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&select=*`, {
          headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}` }
        });
        const rows = await r.json();
        if (!Array.isArray(rows) || !rows[0]) { await answerCallback(cb.id, 'Заявка не найдена'); return; }
        const l = rows[0];
        await answerCallback(cb.id, `Телефон: ${l.phone}`);
        await sendContact(chatId, l.phone, l.name);
        return;
      }

      if (data.startsWith('write_')) {
        const leadId = data.split('_')[1];
        const r = await fetch(`${COMMON_SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&select=*`, {
          headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}` }
        });
        const rows = await r.json();
        if (!Array.isArray(rows) || !rows[0]) { await answerCallback(cb.id, 'Заявка не найдена'); return; }
        const l = rows[0];
        const digits = (l.phone || '').replace(/\D/g, '');
        await answerCallback(cb.id, 'Ссылка ниже');
        await sendTelegram(chatId, `👤 ${l.name || '—'}\n📞 ${l.phone || '—'}\n💬 ${l.problem || '—'}\n\n🔗 https://t.me/+${digits}`);
        return;
      }

      return;
    }

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

    const isManager = String(chatId) === String(MANAGER_CHAT_ID);

    if (text.startsWith('/start')) {
      const parts = text.split(' ');
      const payload = parts[1] || '';

                        if (payload.startsWith('sess_')) {
        const sessId = payload;
        await getOrCreateSession(sessId);
        await updateSession(sessId, { telegram_chat_id: chatId });
        
        const sessionData = await getOrCreateSession(sessId);
        const history = sessionData.history || [];
        
        if (history.length > 0) {
          const lastMessages = history.slice(-4).map(m => `${m.role === 'user' ? 'Клиент' : 'Бот'}: ${m.content}`).join('\n');
          const prompt = `Клиент перешел с сайта в Telegram. Вот последние сообщения из их диалога:\n${lastMessages}\n\nНапиши ОДНО короткое (1-2 предложения) приветствие, которое логично продолжит этот диалог. Опирайся на то, что клиент хотел (например, настройка бота, тарифы, спорт). НЕ пиши варианты ответов, НЕ пиши "Или...", НЕ пиши списки. Просто напиши естественное приветствие, которое укладывается в лимит.`;
          
          try {
             const aiResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
               method: 'POST',
               headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
               body: JSON.stringify({ model: AI_MODEL_CHAT, messages: [{ role: 'user', content: prompt }], max_tokens: 150 })
             });
             const aiData = await aiResp.json();
             const aiGreeting = aiData.choices?.[0]?.message?.content || '👋 Продолжаем диалог. Чем помочь?';
             await sendTelegram(chatId, cleanReply(aiGreeting));
          } catch (e) {
             await sendTelegram(chatId, '👋 Продолжаем диалог. Чем помочь?');
          }
        } else {
          await sendTelegram(chatId, '👋 Привет! Продолжаем. Что вас интересует?');
        }
        return;
      }
      
      if (payload.startsWith('pay_')) {
        const payParts = payload.split('_');
        const tariffKey = payParts[1];
        const period = payParts[2] || 'month';
        
        if (TARIFFS[tariffKey]) {
          await sendTelegram(chatId, '⏳ Создаю ссылку на оплату...');
          const payUrl = await createYookassaPayment(chatId, tariffKey, period);
          
          if (payUrl) {
            const tariff = TARIFFS[tariffKey];
            const amount = period === 'year' ? tariff.amountYear : tariff.amountMonth;
            const periodLabel = period === 'year' ? 'год' : 'месяц';

            await sendTelegram(chatId, 
              `💳 <b>Счёт на оплату тарифа «${tariff.name}»</b>\n\n` +
              `Период: ${periodLabel}\n` +
              `Сумма: ${amount} ₽.\n\n` +
              `Перейдите по ссылке ниже, чтобы оплатить. После оплаты подписка активируется автоматически.`,
              [[{ text: '💸 Перейти к оплате', url: payUrl }]]
            );
          } else {
            await sendTelegram(chatId, '❌ Ошибка при создании счёта. Попробуйте позже.');
          }
          return;
        }
      }

      const startKeyboard = [
        [{ text: '💳 Посмотреть тарифы', callback_data: 'menu_bill' }],
        [{ text: '🌐 Открыть сайт', url: BASE_URL }]
      ];

      if (payload === 'free') {
        await sendTelegram(chatId, 
          `Отличное решение! 👌\n\n` +
          `Чтобы запустить тест на 7 дней, мне понадобится ваше имя и телефон. Напишите их сюда, и я передам данные менеджеру.\n\n` +
          `Если есть вопросы — задавайте, обсудим.`, 
          startKeyboard
        );
        return;
      }

      if (payload.startsWith('tariff_')) {
        const tariffKey = payload.split('_')[1];
        const tariffName = TARIFFS[tariffKey]?.name || 'выбранный';
        await sendTelegram(chatId, 
          `Отличный выбор! Тариф «${tariffName}» — это то, что нужно. 🚀\n\n` +
          `Давайте я покажу, как он будет работать именно на вашем бизнесе. Расскажите, чем вы занимаетесь?`, 
          startKeyboard
        );
        return;
      }

      if (CLIENT_ID === 'tilda') {
        await sendTelegram(chatId, 
          `Здравствуйте! 👋\n\n` +
          `Я AI-Администратор — отвечаю клиентам 24/7, собираю заявки и помогаю с ними работать.\n\n` +
          `Можете посмотреть тарифы по кнопкам ниже, или просто расскажите, чем занимается ваш бизнес — я подскажу, как лучше настроить бота под ваши задачи.`, 
          [[{ text: '💳 Посмотреть тарифы', callback_data: 'menu_bill' }], [{ text: '🌐 Открыть сайт', url: BASE_URL }]]
        );
      } else {
        await sendTelegram(chatId, 
          `Здравствуйте! 👋\n\n` +
          `Я AI-Администратор компании «${BUSINESS_NAME}». Отвечаю на вопросы, помогаю с записью и собираю заявки.\n\n` +
          `Напишите, что вас интересует, или перейдите на наш сайт по кнопке ниже.`, 
          [[{ text: '🌐 Перейти на сайт', url: BASE_URL }]]
        );
      }
      return; //
    } //

    // --- ПОШАГОВОЕ СОЗДАНИЕ КЛИЕНТА ---
    if (isManager && text === '/newclient') {
      
      newClientStates[chatId] = { step: 'waiting_for_id' };
      await sendTelegram(chatId, 'Шаг 1 из 4. Напиши ID клиента (латиницей, без пробелов, например: salon1):');
      return;
    }

    if (isManager && newClientStates[chatId]) {
      const state = newClientStates[chatId];
      
      if (state.step === 'waiting_for_id') {
        state.client_id = text;
        state.step = 'waiting_for_name';
        await sendTelegram(chatId, `Шаг 2 из 4. Напиши название бизнеса (например: Салон Красоты):`);
        return;
      }

      if (state.step === 'waiting_for_name') {
        state.business_name = text;
        state.step = 'waiting_for_url';
        await sendTelegram(chatId, `Шаг 3 из 4. Напиши ссылку на сайт (например: https://salon.tilda.ws):`);
        return;
      }

      if (state.step === 'waiting_for_url') {
        state.site_url = text;
        state.step = 'waiting_for_tz';
        await sendTelegram(chatId, `Шаг 4 из 4. Напиши часовой пояс (например: Europe/Moscow):`);
        return;
      }

      if (state.step === 'waiting_for_tz') {
        const tz = text || 'Europe/Moscow';
        const cid = state.client_id;
        const bname = state.business_name;
        const site = state.site_url;
        
        delete newClientStates[chatId]; 
        
        await sendTelegram(chatId, `⏳ Отправляю запрос на GitHub...`);
        
        try {
                    const res = await fetch(`https://api.github.com/repos/chaknoris5000-glitch/chat-bot-tilda/actions/workflows/create-client.yml/dispatches`, {
            method: 'POST',
            headers: { 
              'Authorization': `token ${process.env.MY_GITHUB_TOKEN}`, 
              'Accept': 'application/vnd.github.v3+json', 
              'Content-Type': 'application/json' 
            },
            body: JSON.stringify({ 
              ref: 'main', 
              inputs: { 
                client_id: cid, 
                business_name: bname, 
                site_url: site, 
                timezone: tz, 
                manager_chat_id: chatId.toString(),
                bot_token: '', 
                owner_telegram_id: chatId.toString()
              } 
            })
          });
          if (res.ok) await sendTelegram(chatId, `🚀 Задача запущена на серверах GitHub! Проверь папку "Действия" (Actions).`);
          else await sendTelegram(chatId, `❌ Ошибка GitHub: ${await res.text()}`);
        } catch (e) { await sendTelegram(chatId, `❌ Ошибка связи: ${e.message}`); }
        return;
      }
    }

    // --- ОСТАЛЬНЫЕ КОМАНДЫ ---
    if (isManager && text === '/leads') {
      const leads = (await fetchLeads()).slice(0, 10);
      if (leads.length === 0) { await sendTelegram(chatId, 'Заявок пока нет.'); return; }
      const lines = leads.map((l, i) => {
        const s = l.status === 'closed' ? '✅' : (l.status === 'in_progress' ? '🔄' : '🆕');
        return `${s} <b>${i+1}. ${l.name || '—'}</b> | ${l.phone || '—'}\n💬 ${l.problem || '—'}`;
      });
      await sendTelegram(chatId, '📋 <b>Последние заявки</b>\n\n' + lines.join('\n\n'));
      return;
    }

    if (isManager && text === '/export') {
      const leads = await fetchLeads();
      if (leads.length === 0) { await sendTelegram(chatId, 'Заявок пока нет.'); return; }
      const buffer = await buildXlsx(leads, 'Все заявки');
      await sendTelegramDoc(chatId, buffer, `leads_${new Date().toISOString().slice(0,10)}.xlsx`, `📊 Выгрузка заявок (${leads.length} шт.)`);
      return;
    }

    if (isManager && text === '/stats') {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const leads = await fetchLeads(today.toISOString());
      await sendTelegram(chatId, statsBlock(leads, `Итоги за сегодня (${today.toLocaleDateString('ru-RU')})`));
      return;
    }

    if (isManager && text === '/invoice') {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const leads = await fetchLeads(monthStart.toISOString());
      const total = leads.length;
      const sum = total * PRICE_PER_LEAD;
      const monthLabel = now.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
      await sendTelegram(chatId, `🧾 <b>Счёт за ${monthLabel}</b>\n\n📥 Заявок: <b>${total}</b>\n💵 Цена: <b>${PRICE_PER_LEAD} ₽</b>\n💰 Итого: <b>${sum} ₽</b>`);
      return;
    }

    if (isManager && text === '/clients') {
      const r = await fetch(`${COMMON_SUPABASE_URL}/rest/v1/clients?select=*&order=id.desc`, {
        headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}` }
      });
      const rows = await r.json();
      if (!Array.isArray(rows) || rows.length === 0) { await sendTelegram(chatId, 'Клиентов нет.'); return; }
      const lines = rows.map(c => {
        const paid = isPaid(c);
        const until = c.paid_until ? new Date(c.paid_until).toLocaleDateString('ru-RU') : '—';
        const tz = c.timezone || 'Europe/Moscow';
        return `${paid ? '✅' : '⛔️'} <b>${c.client_id}</b> — ${c.business_name || '—'}\nОплачено до: ${until}\nЧасовой пояс: ${tz}`;
      });
      await sendTelegram(chatId, '👥 <b>Клиенты</b>\n\n' + lines.join('\n\n') + '\n\n<i>Команды:\n/add id | название | chat_id | пояс\n/view id\n/remove id\n/paid id месяцев\n/unpaid id</i>');
      return;
    }

    if (isManager && text.startsWith('/paid ')) {
      const parts = text.split(' ');
      const cid = parts[1];
      const months = parseInt(parts[2] || '1', 10);
      if (!cid || isNaN(months) || months < 1) {
        await sendTelegram(chatId, 'Формат: /paid client_id количество_месяцев\nПример: /paid tilda 1');
        return;
      }
      const newDate = await extendPayment(cid, months);
      if (!newDate) { await sendTelegram(chatId, `Клиент «${cid}» не найден.`); return; }
      await sendTelegram(chatId, `✅ Клиенту «${cid}» оплата продлена на ${months} мес.\nНовая дата: ${newDate.toLocaleDateString('ru-RU')}`);
      return;
    }

    if (isManager && text.startsWith('/unpaid ')) {
      const cid = text.split(' ')[1];
      if (!cid) { await sendTelegram(chatId, 'Формат: /unpaid client_id'); return; }
      await disablePayment(cid);
      await sendTelegram(chatId, `⛔️ Клиенту «${cid}» оплата отключена.`);
      return;
    }

    if (isManager && text.startsWith('/add ')) {
      const raw = text.slice(5).trim();
      const parts = raw.split('|').map(s => s.trim());
      if (parts.length < 3) {
        await sendTelegram(chatId, 'Формат:\n/add client_id | название | chat_id | часовой_пояс\n\nПример:\n/add salon-1 | Салон Красоты | 5818548555 | Europe/Moscow');
        return;
      }
      const [cid, bname, cchat, ctz] = [parts[0], parts[1], parts[2], parts[3] || 'Europe/Moscow'];

      const existing = await getClient(cid);
      if (existing) {
        await sendTelegram(chatId, `⚠️ Клиент «${cid}» уже существует.\nИспользуй /paid для продления или /remove для удаления.`);
        return;
      }

      const r = await fetch(`${COMMON_SUPABASE_URL}/rest/v1/clients`, {
        method: 'POST',
        headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify({
          client_id: cid,
          business_name: bname,
          chat_id: parseInt(cchat, 10) || null,
          paid_until: new Date(Date.now() + 7 * 86400000).toISOString(),
          timezone: ctz
        })
      });
      if (!r.ok) {
        const err = await r.text();
        await sendTelegram(chatId, `❌ Ошибка: ${err.slice(0, 200)}`);
        return;
      }
      await sendTelegram(chatId, `✅ Клиент «${cid}» добавлен.\n\n` +
        `Название: ${bname}\n` +
        `Chat ID: ${cchat}\n` +
        `Часовой пояс: ${ctz}\n` +
        `Оплачено до: ${new Date(Date.now() + 7 * 86400000).toLocaleDateString('ru-RU')} (+7 дней теста)`);
      return;
    }

    if (isManager && text.startsWith('/view ')) {
      const cid = text.slice(6).trim();
      const client = await getClient(cid);
      if (!client) { await sendTelegram(chatId, `Клиент «${cid}» не найден.`); return; }
      const paid = isPaid(client);
      const until = client.paid_until ? new Date(client.paid_until).toLocaleDateString('ru-RU') : '—';
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const leadsMonth = await fetchLeads(monthStart.toISOString());
      const sum = leadsMonth.length * PRICE_PER_LEAD;

      await sendTelegram(chatId, `👤 <b>Клиент: ${client.client_id}</b>\n\n` +
        `🏢 Название: ${client.business_name || '—'}\n` +
        `💬 Chat ID: ${client.chat_id || '—'}\n` +
        `🌍 Часовой пояс: ${client.timezone || 'Europe/Moscow'}\n` +
        `💳 Статус: ${paid ? '✅ оплачено' : '⛔️ не оплачено'}\n` +
        `📅 Оплачено до: ${until}\n\n` +
        `📊 <b>За текущий месяц</b>\n` +
        `📥 Заявок: ${leadsMonth.length}\n` +
        `💰 По тарифу «за результат»: ${sum} ₽`);
      return;
    }

    if (isManager && text.startsWith('/remove ')) {
      const cid = text.slice(8).trim();
      const client = await getClient(cid);
      if (!client) { await sendTelegram(chatId, `Клиент «${cid}» не найден.`); return; }
      await fetch(`${COMMON_SUPABASE_URL}/rest/v1/clients?client_id=eq.${cid}`, {
        method: 'DELETE',
        headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}` }
      });
      await sendTelegram(chatId, `🗑 Клиент «${cid}» удалён.\n⚠️ Данные заявок не тронуты.`);
      return;
    }

    let chatSession = await getSessionByTelegram(chatId);
    if (!chatSession) {
      const newSid = 'tg_' + chatId + '_' + CLIENT_ID;
      await getOrCreateSession(newSid);
      await updateSession(newSid, { telegram_chat_id: chatId });
      chatSession = await getSessionByTelegram(chatId);
    }
    if (!chatSession) chatSession = { session_id: 'tg_' + chatId, history: [] };

    if (!isManager) {
      const client = await getClient(CLIENT_ID);
      if (!isPaid(client)) {
        await sendTelegram(chatId, '⛔️ Сервис временно приостановлен. Свяжитесь с менеджером.');
        return;
      }
    }

    const history = chatSession.history || [];
    const reply = await askAI(text, history, chatSession.session_id);
    const newHistory = [...history, { role: 'user', content: text }, { role: 'assistant', content: reply }];
    await updateSession(chatSession.session_id, { history: newHistory.slice(-20) });
    await sendTelegram(chatId, reply);

    // Кнопки выбора филиала (если у клиента задан список адресов)
    if (BRANCHES.length && /адрес|филиал|где вы|где наход|как добрат|какой филиал/i.test(text || '')) {
      const kb = [];
      for (let i = 0; i < BRANCHES.length; i += 3) {
        kb.push(BRANCHES.slice(i, i + 3).map((addr, j) => ({
          text: addr.length > 38 ? addr.slice(0, 36) + '…' : addr,
          callback_data: 'br_' + (i + j)
        })));
      }
      await sendTelegram(chatId, 'Выберите филиал — подскажу, как добраться и когда работаем:', kb);
    }
  } catch (error) {
    console.log('Telegram error:', error);
  }
});


// Режем текст по абзацам, не разрывая слова (для карточек товаров и цен)
function splitIntoChunks(text, maxLen) {
  const limit = maxLen || 900;
  const parts = String(text).split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  for (const p of parts) {
    if (!cur) { cur = p; }
    else if ((cur + '\n\n' + p).length <= limit) { cur += '\n\n' + p; }
    else { chunks.push(cur); cur = p; }
    while (cur.length > limit) { chunks.push(cur.slice(0, limit)); cur = cur.slice(limit); }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// Еженедельное обновление базы знаний с сайта клиента
cron.schedule('0 4 * * 1', async () => {
  const self = process.env.RENDER_EXTERNAL_URL;
  if (!self || !SITE_TO_CRAWL) return;
  try {
    const r = await fetch(self + '/crawl');
    console.log('auto-crawl:', r.status, (await r.text()).slice(0, 120));
  } catch (e) { console.log('auto-crawl error:', e.message); }
});

app.get('/crawl', async (req, res) => {
  try {
    // Собираем несколько страниц сайта (главная + внутренние ссылки), а не только одну
    let pages = [];
    try {
      const mapRes = await fetch('https://api.firecrawl.dev/v2/map', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${FIRECRAWL_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: SITE_TO_CRAWL, limit: 60 })
      });
      const mapData = await mapRes.json();
      const links = (mapData.links || [])
        .map(l => (typeof l === 'string' ? l : l.url))
        .filter(u => typeof u === 'string' && u.startsWith('http'));
      pages = [...new Set(links)].slice(0, 40);
    } catch (e) { console.log('map error:', e.message); }
    if (pages.length === 0) pages = [SITE_TO_CRAWL];

    let text = '';
    let okPages = 0;
    for (const pageUrl of pages) {
      try {
        const scrape = await fetch('https://api.firecrawl.dev/v2/scrape', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${FIRECRAWL_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: pageUrl, formats: ['markdown'], onlyMainContent: false })
        });
        const d = await scrape.json();
        if (!scrape.ok) { console.log('Firecrawl error', pageUrl, JSON.stringify(d).slice(0, 200)); continue; }
        const md = d.data?.markdown || '';
        if (md && md.length > 100) {
          text += `\n\n# Страница: ${pageUrl}\n\n${md}`;
          okPages++;
        }
      } catch (e) { console.log('scrape error', pageUrl, e.message); }
    }

    console.log(`crawl: страниц ${pages.length}, собрано ${okPages}, символов ${text.length}`);
    if (!text || text.length < 300) {
      return res.status(500).json({ error: 'Empty text from Firecrawl', pages: pages.length });
    }

    const chunks = splitIntoChunks(text, 900);

    // Чистим старую базу знаний клиента, чтобы повторный парсинг не плодил дубли
    await fetch(`${COMMON_SUPABASE_URL}/rest/v1/documents?client_id=eq.${CLIENT_ID}`, {
      method: 'DELETE',
      headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}` }
    });

    let saved = 0;
    for (const chunk of chunks) {
      try {
        const embedding = await getEmbedding(chunk);
        await saveDocument(chunk, embedding, SITE_TO_CRAWL);
        saved++;
      } catch (e) { console.log('Ошибка сохранения чанка:', e.message); }
    }
    
    res.json({ ok: true, saved, total: chunks.length });
  } catch (error) {
    console.log('Crawl error:', error.message);
    res.status(500).json({ error: 'Ошибка Firecrawl' });
  }
});

// ========== АВТОСВОДКИ С ЧАСОВЫМ ПОЯСОМ ==========

function getLocalTime(timezone) {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('ru-RU', {
      timeZone: timezone || 'Europe/Moscow',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    const parts = fmt.formatToParts(now);
    const get = (t) => parts.find(p => p.type === t)?.value;
    return {
      hour: parseInt(get('hour'), 10),
      minute: parseInt(get('minute'), 10),
      dateStr: `${get('year')}-${get('month')}-${get('day')}`
    };
  } catch (e) {
    return { hour: 20, minute: 0, dateStr: '' };
  }
}

async function sendDailyReportForClient(client) {
  try {
    const tz = client.timezone || 'Europe/Moscow';
    const local = getLocalTime(tz);

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);

    const leads = await fetchLeads(since.toISOString());
    if (leads.length === 0) return;

    // ЖЕСТКОЕ ИСПРАВЛЕНИЕ:
    // Если это бот Тильда, шлем только тебе (MANAGER_CHAT_ID).
    // Если это бот клиента, шлем владельцу (client.chat_id).
    const targetChatId = CLIENT_ID === 'tilda' ? MANAGER_CHAT_ID : (client.chat_id || MANAGER_CHAT_ID);
    
    if (!targetChatId) return;

    await sendTelegram(targetChatId, statsBlock(leads, `Итоги за сегодня (${local.dateStr})`));
    const buffer = await buildXlsx(leads, 'День');
    await sendTelegramDoc(targetChatId, buffer, `leads_day_${local.dateStr}.xlsx`, `📥 Заявки за день (${leads.length} шт.)`);
    console.log(`✅ Сводка отправлена (${CLIENT_ID === 'tilda' ? 'Админу' : 'Клиенту'}) (${tz})`);
  } catch (e) {
    console.log('sendDailyReportForClient error:', e.message);
  }
}

cron.schedule('*/15 * * * *', async () => {
  try {
    // Каждый бот отчитывается только по своему клиенту (в своей базе).
    const client = await getClient(CLIENT_ID);
    if (!client || !isPaid(client)) return;
    const tz = client.timezone || 'Europe/Moscow';
    const local = getLocalTime(tz);
    if (local.hour === REPORT_HOUR && local.minute >= 0 && local.minute < 15) {
      await sendDailyReportForClient(client);
    }
  } catch (e) { console.log('cron 15min error:', e.message); }
});

cron.schedule('0 7 * * 1', async () => {
  try {
    if (!MANAGER_CHAT_ID) return;
    const since = new Date(); since.setDate(since.getDate() - 7); since.setHours(0, 0, 0, 0);
    const leads = await fetchLeads(since.toISOString());
    console.log('⏰ cron week сработал, заявок:', leads.length);
    if (leads.length === 0) return;
    await sendTelegram(MANAGER_CHAT_ID, statsBlock(leads, `Итоги за неделю (${since.toLocaleDateString('ru-RU')} — ${new Date().toLocaleDateString('ru-RU')})`));
    const buffer = await buildXlsx(leads, 'Неделя');
    await sendTelegramDoc(MANAGER_CHAT_ID, buffer, `leads_week_${new Date().toISOString().slice(0,10)}.xlsx`, `📥 Заявки за неделю (${leads.length} шт.)`);
  } catch (e) { console.log('cron week error:', e.message); }
});

cron.schedule('0 7 1 * *', async () => {
  try {
    if (!MANAGER_CHAT_ID) return;
    const now = new Date();
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
    const leads = await fetchLeads(prevMonthStart.toISOString());
    console.log('⏰ cron month сработал, заявок:', leads.length);
    if (leads.length === 0) return;

    const total = leads.length;
    const sum = total * PRICE_PER_LEAD;
    const monthLabel = prevMonthStart.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

    await sendTelegram(MANAGER_CHAT_ID, statsBlock(leads, `Итоги за ${monthLabel}`));
    await sendTelegram(MANAGER_CHAT_ID, `🧾 <b>Счёт за ${monthLabel}</b>\n\n📥 Заявок: <b>${total}</b>\n💵 Цена: <b>${PRICE_PER_LEAD} ₽</b>\n💰 Итого: <b>${sum} ₽</b>`);

    const buffer = await buildXlsx(leads, 'Месяц');
    await sendTelegramDoc(MANAGER_CHAT_ID, buffer, `leads_month_${prevMonthStart.toISOString().slice(0,7)}.xlsx`, `📥 Заявки за ${monthLabel} (${total} шт.)`);
  } catch (e) { console.log('cron month error:', e.message); }
});

// ========== БИЛЛИНГ И НАПОМИНАНИЯ ==========
cron.schedule('0 10 * * *', async () => { 
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Получаем всех клиентов
    const r = await fetch(`${COMMON_SUPABASE_URL}/rest/v1/clients?select=*`, {
      headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}` }
    });
    const clients = await r.json();
    if (!Array.isArray(clients)) return;

    // Получаем юзернейм бота для ссылок на оплату
    let botUsername = '';
    try {
      const botInfo = await (await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getMe`)).json();
      botUsername = botInfo.result.username;
    } catch(e) {}

    for (const client of clients) {
      if (!client.paid_until) continue;

      const paidDate = new Date(client.paid_until);
      paidDate.setHours(0, 0, 0, 0);

      const diffTime = paidDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const chatId = client.chat_id || MANAGER_CHAT_ID;
      
      // 1. ФИКСИРОВАННЫЕ ТАРИФЫ (предупреждение и приостановка)
      if (client.tariff !== 'result') {
        if (diffDays === 1 && chatId) {
          const keyboard = botUsername ? [[{ text: '💳 Продлить подписку', url: `https://t.me/${botUsername}?start=pay_${client.tariff}_month` }]] : null;
          await sendTelegram(chatId, 
            `⚠️ <b>Напоминание об оплате</b>\n\n` +
            `Завтра заканчивается подписка на тариф «${client.business_name || client.client_id}».\n` +
            `Чтобы бот не перестал работать, продлите оплату.`, 
            keyboard
          );
        }
        if (diffDays === 0 && chatId) {
          const keyboard = botUsername ? [[{ text: '💳 Продлить подписку', url: `https://t.me/${botUsername}?start=pay_${client.tariff}_month` }]] : null;
          await sendTelegram(chatId, 
            `⛔️ <b>Тариф приостановлен</b>\n\n` +
            `Оплата за тариф «${client.business_name || client.client_id}» не поступила.\n` +
            `Бот временно не отвечает клиентам. Продлите подписку, чтобы возобновить работу.`, 
            keyboard
          );
        }
      }

      // 2. ТАРИФ "ЗА РЕЗУЛЬТАТ" (для Админа за 1 день до конца месяца)
      if (client.tariff === 'result') {
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        
        // Если сегодня предпоследний день месяца
        if (today.getDate() === lastDay.getDate() - 1) {
          const prevMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          const prevMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          const monthLabel = prevMonthStart.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

          const leadsUrl = `${COMMON_SUPABASE_URL}/rest/v1/leads?client_id=eq.${client.client_id}&created_at=gte.${prevMonthStart.toISOString()}&created_at=lte.${prevMonthEnd.toISOString()}`;
          const leadsRes = await fetch(leadsUrl, { headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}` } });
          const leads = await leadsRes.json();
          const count = Array.isArray(leads) ? leads.length : 0;
          
          if (count > 0 && client.chat_id) {
            const sum = count * PRICE_PER_LEAD;
            const adminText = `📊 <b>Предварительный счет за ${monthLabel}</b>\n\nКлиент: ${client.business_name || client.client_id}\nЗаявок: <b>${count}</b>\nК оплате: <b>${sum} ₽</b>\n\n<i>Проверьте базу. Завтра клиенту уйдет официальный счет.</i>`;
            await sendTelegram(MANAGER_CHAT_ID, adminText);
          }
        }
      }
    }
  } catch (e) { console.log('Ошибка при проверке напоминаний:', e.message); }
});

// ========== ОТПРАВКА СЧЕТА ЗА РЕЗУЛЬТАТ (1-е число) ==========
cron.schedule('0 10 1 * *', async () => {
  try {
    const now = new Date();
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const monthLabel = prevMonthStart.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

    const r = await fetch(`${COMMON_SUPABASE_URL}/rest/v1/clients?select=*`, {
      headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}` }
    });
    const clients = await r.json();
    if (!Array.isArray(clients)) return;

    let botUsername = '';
    try {
      const botInfo = await (await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getMe`)).json();
      botUsername = botInfo.result.username;
    } catch(e) {}

    for (const client of clients) {
      if (client.tariff !== 'result') continue;
      if (!client.chat_id) continue;

      const leadsUrl = `${COMMON_SUPABASE_URL}/rest/v1/leads?client_id=eq.${client.client_id}&created_at=gte.${prevMonthStart.toISOString()}&created_at=lte.${prevMonthEnd.toISOString()}`;
      const leadsRes = await fetch(leadsUrl, { headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}` } });
      const leads = await leadsRes.json();
      const count = Array.isArray(leads) ? leads.length : 0;

      if (count > 0) {
        const sum = count * PRICE_PER_LEAD;
        const clientText = `📊 <b>Ваш счет за ${monthLabel}</b>\n\nЗаявок: <b>${count}</b>\nСумма к оплате: <b>${sum} ₽</b>.\n\nОплатить можно по ссылке ниже.`;
        const keyboard = botUsername ? [[{ text: '💳 Оплатить', url: `https://t.me/${botUsername}?start=pay_result_month` }]] : null;
        await sendTelegram(client.chat_id, clientText, keyboard);
      }
    }
  } catch (e) { console.log('Ошибка при отправке счета за результат:', e.message); }
});

// Прямое создание клиента (резервный путь, если GitHub Actions недоступен):
// новый Render-сервис из этого же репозитория + запись в базе. Отдельный репозиторий не нужен.
async function createClientDirect(p) {
  const renderKey = process.env.RENDER_API_KEY;
  if (!renderKey) throw new Error('RENDER_API_KEY не задан');
  if (!/^[a-z0-9][a-z0-9-]{2,24}$/.test(String(p.client_id || ''))) {
    throw new Error('client_id: только латиница, цифры и дефис, 3-25 символов');
  }

  const check = await fetch(`${COMMON_SUPABASE_URL}/rest/v1/clients?client_id=eq.${encodeURIComponent(p.client_id)}&select=client_id`, {
    headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}` }
  });
  const existing = await check.json();
  if (Array.isArray(existing) && existing.length > 0) throw new Error('Клиент с таким client_id уже существует');

  const ownersRes = await fetch('https://api.render.com/v1/owners', { headers: { Authorization: `Bearer ${renderKey}` } });
  const owners = await ownersRes.json();
  const ownerId = owners[0]?.owner?.id || owners[0]?.id;
  if (!ownerId) throw new Error('Не удалось получить ownerId Render');

  // Сначала читаем сайт клиента, чтобы промпт был по реальным фактам, а не по названию домена
  let siteText = '';
  try {
    const sr = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.FIRECRAWL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: p.site_url, formats: ['markdown'], onlyMainContent: false })
    });
    const sd = await sr.json();
    siteText = (sd.data?.markdown || '').slice(0, 6000);
    console.log('prompt: прочитано сайта', siteText.length, 'символов');
  } catch (e) { console.log('scrape for prompt error:', e.message); }

  let prompt = '';
  try {
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek/deepseek-chat',
        temperature: 0.3,
        max_tokens: 700,
        messages: [{
          role: 'user',
          content: `Ниже текст сайта компании. Составь системный промпт (до 900 символов) для ИИ-администратора компании «${p.business_name}». ` +
            'Включи: кто вы, чем занимаетесь, тон общения, ключевые услуги. ' +
            'Обязательно: все факты (цены, адрес, телефон) брать только из текста сайта, ничего не выдумывать, ' +
            'собирать имя и телефон для заявки. Без markdown и списков.\n\nТЕКСТ САЙТА:\n' +
            (siteText || '(текст недоступен, используй только базу знаний)')
        }]
      })
    });
    const aiData = await aiRes.json();
    prompt = (aiData.choices?.[0]?.message?.content || '').trim();
  } catch (e) { console.log('prompt generation error:', e.message); }

  if (!prompt || prompt.length < 80) {
    prompt = `Ты — AI-администратор компании «${p.business_name}» (сайт ${p.site_url}).` +
      ' Общайся как живой администратор: приветливо, коротко, по делу.' +
      ' Отвечай ТОЛЬКО по информации из базы знаний ниже.' +
      ' Если нужных данных там нет — скажи, что уточнишь у администратора, и предложи оставить имя и телефон.';
  }

  // Отдельный репозиторий под клиента: шаблон копируется из chat-bot-tilda
  let repoUrl = 'https://github.com/chaknoris5000-glitch/chat-bot-tilda';
  try {
    const ghToken = process.env.MY_GITHUB_TOKEN || '';
    const ghHeaders = { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-agent' };

    const repoRes = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `chat-bot-${p.client_id}`, private: false })
    });

    if (repoRes.ok) {
      const repo = await repoRes.json();
      repoUrl = repo.html_url;
      const safeName = String(p.business_name).replace(/'/g, "\\'");

      for (const f of ['server.js', 'package.json', 'crm.html', 'app.html']) {
        const srcRes = await fetch(`https://api.github.com/repos/chaknoris5000-glitch/chat-bot-tilda/contents/${f}?ref=main`, { headers: ghHeaders });
        if (!srcRes.ok) { console.log('copy skip', f, srcRes.status); continue; }
        const srcMeta = await srcRes.json();
        let content = Buffer.from(srcMeta.content, 'base64').toString('utf8');

        if (f === 'server.js') {
          content = content
            .replace(/const CLIENT_ID = .*?;/, `const CLIENT_ID = '${p.client_id}';`)
            .replace(/const BUSINESS_NAME = .*?;/, `const BUSINESS_NAME = '${safeName}';`)
            .replace(/const SITE_TO_CRAWL = .*?;/, `const SITE_TO_CRAWL = '${p.site_url}';`)
            .replace(/const BASE_URL = .*?;/, `const BASE_URL = '${p.site_url}';`);
        } else {
          content = content.replace(/const BOT_CLIENT_ID = .*?;/, `const BOT_CLIENT_ID = '${p.client_id}';`);
        }

        const putRes = await fetch(`https://api.github.com/repos/${repo.full_name}/contents/${f}`, {
          method: 'PUT',
          headers: { ...ghHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `Add ${f}`, content: Buffer.from(content).toString('base64') })
        });
        if (!putRes.ok) console.log('copy fail', f, putRes.status, (await putRes.text()).slice(0, 120));
      }
      console.log('✅ репозиторий клиента создан:', repoUrl);
    } else {
      console.log('repo create failed:', repoRes.status, (await repoRes.text()).slice(0, 160));
    }
  } catch (e) { console.log('repo create error, используем общий репозиторий:', e.message); }

  const envMap = {
    CLIENT_ID: p.client_id,
    BOT_CLIENT_ID: p.client_id,
    BUSINESS_NAME: p.business_name,
    SITE_TO_CRAWL: p.site_url,
    BASE_URL: p.site_url,
    MANAGER_CHAT_ID: String(p.manager_chat_id),
    TELEGRAM_TOKEN: p.bot_token,
    COMMON_SUPABASE_URL: process.env.COMMON_SUPABASE_URL,
    COMMON_SUPABASE_KEY: process.env.COMMON_SUPABASE_KEY,
    SUPABASE_URL: process.env.COMMON_SUPABASE_URL,
    SUPABASE_KEY: process.env.COMMON_SUPABASE_KEY,
    OPENROUTER_KEY: process.env.OPENROUTER_KEY,
    FIRECRAWL_KEY: process.env.FIRECRAWL_KEY,
    YOOKASSA_SHOP_ID: process.env.YOOKASSA_SHOP_ID || '',
    YOOKASSA_SECRET_KEY: process.env.YOOKASSA_SECRET_KEY || '',
    BUSINESS_PROMPT: prompt
  };
  const envVars = Object.entries(envMap)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([key, value]) => ({ key, value: String(value) }));

  const createRes = await fetch('https://api.render.com/v1/services', {
    method: 'POST',
    headers: { Authorization: `Bearer ${renderKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      type: 'web_service',
      name: `chat-bot-${p.client_id}`,
      ownerId,
      repo: repoUrl,
      branch: 'main',
      autoDeploy: 'yes',
      envVars,
      serviceDetails: {
        env: 'node',
        plan: 'free',
        region: 'frankfurt',
        envSpecificDetails: { buildCommand: 'npm install', startCommand: 'node server.js' }
      }
    })
  });
  const createdText = await createRes.text();
  if (!createRes.ok) throw new Error('Render: ' + createdText.slice(0, 300));

  let svc = {};
  try { svc = JSON.parse(createdText); } catch (e) {}
  const url = svc.service?.serviceDetails?.url || svc.serviceDetails?.url || `https://chat-bot-${String(p.client_id).toLowerCase()}.onrender.com`;

  const chatId = Number(p.manager_chat_id);
  await fetch(`${COMMON_SUPABASE_URL}/rest/v1/clients`, {
    method: 'POST',
    headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      client_id: p.client_id,
      business_name: p.business_name,
      chat_id: Number.isFinite(chatId) ? chatId : null,
      paid_until: new Date(Date.now() + 7 * 86400000).toISOString(),
      timezone: p.timezone || 'Europe/Moscow',
      prompt: null,
      tariff: p.tariff || 'business',
      leads_limit: Number(p.leads_limit) || 300,
      owner_telegram_id: p.owner_telegram_id ? Number(p.owner_telegram_id) : null
    })
  });

  // вебхук и парсинг — после старта сервиса
  setTimeout(async () => {
    try {
      await fetch(`https://api.telegram.org/bot${p.bot_token}/setWebhook?url=${encodeURIComponent(url + '/telegram-webhook')}`);
      await fetch(url + '/crawl').catch(() => {});
      console.log('✅ fallback: вебхук и парсинг запущены для', p.client_id);
    } catch (e) { console.log('fallback post-create error:', e.message); }
  }, 90000);

  return { url, mode: 'direct' };
}

app.post('/api/create-client', async (req, res) => {
  try {
    const { client_id, business_name, site_url, timezone, manager_chat_id, bot_token, owner_telegram_id } = req.body;
    
    const tariff = req.body.tariff || 'business';
    const leads_limit = Number(req.body.leads_limit) || 300;

    const ghRes = await fetch(`https://api.github.com/repos/chaknoris5000-glitch/chat-bot-tilda/actions/workflows/create-client.yml/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${process.env.MY_GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: { 
            client_id, 
            business_name, 
            site_url, 
            timezone, 
            manager_chat_id, 
            bot_token, 
            owner_telegram_id: String(owner_telegram_id || ''),
            tariff,
            leads_limit: String(leads_limit || '300')
        }
      })
    });

    if (!ghRes.ok) {
      const errText = await ghRes.text();
      console.log('GitHub dispatch недоступен, создаю напрямую:', errText.slice(0, 160));
      const direct = await createClientDirect({ client_id, business_name, site_url, timezone, manager_chat_id, bot_token, owner_telegram_id, tariff, leads_limit });
      return res.json({ ok: true, ...direct });
    }

    res.json({ ok: true, mode: 'actions' });
  } catch (e) {
    console.error('Ошибка создания клиента:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ========== CRM: правка заявок через сервер (без anon-доступа к базе) ==========
app.post('/api/lead-update', async (req, res) => {
  try {
    const uid = getRequesterId(req);
    if (!uid) return res.status(401).json({ error: 'unauthorized' });
    const { id, db, patch, action } = req.body || {};
    if (!id) return res.status(400).json({ error: 'no id' });
    const useTilda = db === 'tilda';
    const baseUrl = useTilda ? SUPABASE_URL : COMMON_SUPABASE_URL;
    const baseKey = useTilda ? SUPABASE_KEY : COMMON_SUPABASE_KEY;
    const headers = { apikey: baseKey, Authorization: 'Bearer ' + baseKey };

    const leadRes = await fetch(baseUrl + '/rest/v1/leads?id=eq.' + id + '&select=client_id', { headers });
    const leadRows = await leadRes.json();
    const leadClient = Array.isArray(leadRows) && leadRows[0] ? leadRows[0].client_id : null;
    const allowedForUser = await ownedClientIds(uid);
    if (!leadClient || (allowedForUser && !allowedForUser.includes(leadClient))) {
      return res.status(403).json({ error: 'forbidden' });
    }

    if (action === 'delete') {
      const d = await fetch(baseUrl + '/rest/v1/leads?id=eq.' + id, { method: 'DELETE', headers });
      if (!d.ok) throw new Error((await d.text()).slice(0, 200));
      return res.json({ ok: true });
    }

    const allowed = ['status', 'archive_reason', 'name', 'phone', 'phones', 'services', 'service', 'amount', 'is_paid', 'notes', 'next_contact_date', 'client_id', 'problem', 'source'];
    const body = {};
    for (const k of allowed) if (patch && Object.prototype.hasOwnProperty.call(patch, k)) body[k] = patch[k];
    if (!Object.keys(body).length) return res.status(400).json({ error: 'empty patch' });
    body.updated_at = new Date().toISOString();

    const r = await fetch(baseUrl + '/rest/v1/leads?id=eq.' + id, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error((await r.text()).slice(0, 200));
    res.json({ ok: true });
  } catch (e) {
    console.log('lead-update error:', e.message);
    res.status(500).json({ error: e.message });
  }
});


// ========== БЭКАПЫ И МОНИТОРИНГ (только на центральном боте) ==========
const BACKUP_BUCKET = 'backups';

async function makeBackup() {
  const tables = ['clients', 'documents', 'leads', 'chat_sessions'];
  const dump = {};
  for (const t of tables) {
    const r = await fetch(`${COMMON_SUPABASE_URL}/rest/v1/${t}?select=*`, {
      headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}` }
    });
    dump[t] = await r.json();
  }
  const payload = JSON.stringify({ created_at: new Date().toISOString(), data: dump });
  const name = `dump-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;

  const up = await fetch(`${COMMON_SUPABASE_URL}/storage/v1/object/${BACKUP_BUCKET}/${name}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${COMMON_SUPABASE_KEY}`,
      'apikey': COMMON_SUPABASE_KEY,
      'Content-Type': 'application/json',
      'x-upsert': 'true'
    },
    body: payload
  });
  const text = await up.text();
  console.log('backup:', name, up.status, payload.length, 'bytes', up.ok ? '' : text.slice(0, 150));

  // Бэкап второй базы (Tilda_bot) — там данные основного бота
  let tildaOk = false;
  try {
    const tDump = {};
    for (const t of tables) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=*`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      tDump[t] = await r.json();
    }
    const tPayload = JSON.stringify({ created_at: new Date().toISOString(), data: tDump });
    const tName = `tilda-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    const tUp = await fetch(`${COMMON_SUPABASE_URL}/storage/v1/object/${BACKUP_BUCKET}/${tName}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COMMON_SUPABASE_KEY}`,
        'apikey': COMMON_SUPABASE_KEY,
        'Content-Type': 'application/json',
        'x-upsert': 'true'
      },
      body: tPayload
    });
    tildaOk = tUp.ok;
  } catch (e) { console.log('tilda backup error:', e.message); }

  // Чистим бэкапы старше 14 дней
  try {
    const listRes = await fetch(`${COMMON_SUPABASE_URL}/storage/v1/object/list/${BACKUP_BUCKET}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COMMON_SUPABASE_KEY}`,
        'apikey': COMMON_SUPABASE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prefix: '', limit: 200, sortBy: { column: 'created_at', order: 'desc' } })
    });
    const items = await listRes.json();
    const cutoff = Date.now() - 14 * 86400000;
    let removed = 0;
    for (const it of Array.isArray(items) ? items : []) {
      if (new Date(it.created_at).getTime() < cutoff) {
        await fetch(`${COMMON_SUPABASE_URL}/storage/v1/object/${BACKUP_BUCKET}/${it.name}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}`, 'apikey': COMMON_SUPABASE_KEY }
        });
        removed++;
      }
    }
    if (removed) console.log('backup: удалено старых', removed);
  } catch (e) { console.log('backup cleanup error:', e.message); }

  return { ok: up.ok, name, bytes: payload.length, status: up.status, tildaOk };
}

cron.schedule('0 3 * * *', async () => {
  if (CLIENT_ID !== 'tilda') return;
  try { await makeBackup(); } catch (e) { console.log('backup error:', e.message); }
});

const __alerted = new Map();
const __failCount = new Map();
async function checkBots(alert = true) {
  const r = await fetch(`${COMMON_SUPABASE_URL}/rest/v1/clients?select=client_id,business_name`, {
    headers: { 'apikey': COMMON_SUPABASE_KEY, 'Authorization': `Bearer ${COMMON_SUPABASE_KEY}` }
  });
  const clients = await r.json();
  const results = [];
  for (const c of Array.isArray(clients) ? clients : []) {
    if (!c.client_id || c.client_id === 'demo-client') continue;
    const url = `https://chat-bot-${String(c.client_id).toLowerCase()}.onrender.com/health`;
    let ok = false;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      ok = res.ok;
    } catch (e) { ok = false; }

    // Free-план Render «просыпается» до минуты — перепроверяем, прежде чем паниковать
    if (!ok) {
      await new Promise(r => setTimeout(r, 15000));
      try {
        const res2 = await fetch(url, { signal: AbortSignal.timeout(60000) });
        ok = res2.ok;
      } catch (e) { ok = false; }
    }

    const fails = (__failCount.get(c.client_id) || 0) + (ok ? 0 : 1);
    __failCount.set(c.client_id, ok ? 0 : fails);
    results.push({ client_id: c.client_id, ok, fails: __failCount.get(c.client_id) });
    // Алерт только после двух провалов подряд (20 минут), чтобы не ловить холодный старт
    if (!ok && alert && __failCount.get(c.client_id) >= 2) {
      const last = __alerted.get(c.client_id) || 0;
      if (Date.now() - last > 3600000) {
        __alerted.set(c.client_id, Date.now());
        try {
          await sendTelegram(MANAGER_CHAT_ID, `⚠️ <b>Бот не отвечает</b>\n\nКлиент: ${c.business_name || c.client_id}\nСервис: ${url}`);
        } catch (e) {}
      }
    }
  }
  return results;
}

cron.schedule('*/10 * * * *', async () => {
  if (CLIENT_ID !== 'tilda') return;
  try {
    const res = await checkBots(true);
    const bad = res.filter(x => !x.ok);
    if (bad.length) console.log('watchdog: недоступны', bad.map(x => x.client_id).join(', '));
  } catch (e) { console.log('watchdog error:', e.message); }
});

app.post('/api/backup-now', async (req, res) => {
  const uid = getRequesterId(req);
  if (String(uid) !== ADMIN_TG_ID) return res.status(403).json({ error: 'forbidden' });
  try { res.json(await makeBackup()); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/watchdog-now', async (req, res) => {
  const uid = getRequesterId(req);
  if (String(uid) !== ADMIN_TG_ID) return res.status(403).json({ error: 'forbidden' });
  try { res.json({ results: await checkBots(false) }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
