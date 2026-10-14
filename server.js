const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

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

// ========== БАЗОВЫЕ ФУНКЦИИ ==========

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

async function searchDocuments(queryEmbedding, limit = 5) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/documents?select=id,content,url,embedding`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    if (!r.ok) { console.log('Supabase fetch error'); return []; }
    const docs = await r.json();
    if (!Array.isArray(docs) || docs.length === 0) { console.log('docs empty'); return []; }

    function parseEmb(str) {
      if (Array.isArray(str)) return str;
      return str.replace(/[\[\]]/g, '').split(',').map(Number);
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
  await fetch(`${SUPABASE_URL}/rest/v1/documents`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ content, embedding, url })
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
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
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
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
    });
  } catch (e) {}
}

async function saveLead(sessionId, name, phone, problem, source = 'site') {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ session_id: sessionId, name: name || null, phone: phone || null, problem: problem || null, source, status: 'new' })
    });
    console.log('💾 saveLead status:', r.status, '| name:', name, '| phone:', phone);
  } catch (e) {
    console.log('❌ saveLead error:', e.message);
  }
}

// ========== TELEGRAM API ==========

async function sendTelegram(chatId, text, keyboard = null) {
  const body = { chat_id: chatId, text, parse_mode: 'HTML' };
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
    .replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/__(.*?)__/g, '$1').replace(/_(.*?)_/g, '$1')
    .replace(/^#{1,6}\s+/gm, '').replace(/`/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

async function notifyManager(lead) {
  if (!MANAGER_CHAT_ID) return;
  const text = `🔥 <b>НОВАЯ ЗАЯВКА</b>\n\n` +
    `👤 <b>Имя:</b> ${lead.name || '—'}\n` +
    `📞 <b>Телефон:</b> ${lead.phone || '—'}\n` +
    `💬 <b>Задача:</b> ${lead.problem || '—'}`;

  try {
    await sendTelegram(MANAGER_CHAT_ID, text);
    console.log('✅ Уведомление отправлено менеджеру:', lead.phone);
  } catch (e) {
    console.log('❌ notifyManager error:', e.message);
  }
}

// ========== ИИ ==========

async function askAI(message, history, sessionId) {
  let context = '';
  try {
    const emb = await getEmbedding(message);
    const matches = await searchDocuments(emb, 5);
    if (matches.length > 0) {
      context = matches.map(m => m.content).join('\n\n---\n\n');
    }
  } catch (e) { console.log('Контекст не собран:', e.message); }

  const systemPrompt = `Ты — AI-Администратор компании «${BUSINESS_NAME}». Ты опытный продавец-консультант, знаешь продукт вдоль и поперёк, ведёшь клиента к покупке.

ТВОЯ РОЛЬ:
- Помогаешь владельцу бизнеса понять, как AI-администратор решит его проблемы.
- Выявляешь боль: клиенты не дожидаются ответа, заявки теряются, менеджер не успевает.
- Показываешь решение: бот отвечает 24/7, собирает заявки, продолжает диалог в Telegram.
- Ведёшь к оформлению подписки.

СТИЛЬ:
1. Коротко — 1-2 предложения. Без воды.
2. На «Вы», дружелюбно, но по-деловому.
3. Без markdown.
4. Не повторяй вопрос клиента.
5. Задавай наводящие вопросы.

ВОРОНКА ПРОДАЖ:
1. Приветствие → выясни сферу бизнеса.
2. Презентация → покажи, как бот решит его задачу.
3. Работа с возражениями:
   - «Дорого» → «2 500 ₽ за настройку + месяц бесплатно — это меньше, чем один упущенный клиент.»
   - «Подумаю» → «Конечно. Могу пока оставить вам демо?»
   - «У меня уже есть менеджер» → «Бот его разгрузит — менеджер займётся только горячими клиентами.»
4. Призыв: «Оставьте имя и номер телефона — запустим бота за 2 дня.»
5. Передача менеджеру.

ЧТО ТЫ ЗНАЕШЬ О ПРОДУКТЕ:
- Настройка — 2 500 ₽.
- Первый месяц — бесплатно.
- Со второго — 2 500 ₽/мес.
- При годовой оплате — 2 200 ₽/мес (экономия 3 600 ₽).
- Запуск за 2 дня.
- Работает 24/7.
- Продолжает диалог в Telegram.
- Обучается на данных бизнеса.
- Не требует разработчиков.

ЗНАНИЯ ПО СФЕРАМ:
- Автосервис: запись на диагностику, уточнение модели авто, подбор запчастей.
- Стоматология: запись на консультацию, вопросы про цены, врачей.
- Салон красоты: запись, подбор времени, вопросы про мастеров.
- Кофейня / ресторан: бронь, меню, доставка.
- Магазин: консультация по товару, наличие.
- Клиника: запись, услуги.
- Фитнес: расписание, абонементы.

ГОЛОС: ты понимаешь голосовые, отвечаешь текстом.

СБОР ЗАЯВКИ:
- Если клиент готов — попроси имя и телефон.
- Когда есть РЕАЛЬНЫЕ имя + телефон — добавь в САМОМ КОНЦЕ:
  [LEAD_SAVE][NAME:имя][PHONE:телефон][PROBLEM:кратко задача]
- НИКОГДА не пиши маркеры в обычных ответах.
- Если имя/телефон не настоящие — НЕ добавляй маркеры.

ЧЕГО НЕ ДЕЛАЕШЬ:
- НЕ обещай интеграции с CRM, календарями, WhatsApp, VK.
- НЕ выдумывай цены, сроки, гарантии.
- НЕ обещай бесплатный пробный период свыше указанного.
- Если данных нет — «Уточните у менеджера».

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
  console.log('🔍 extractLeadData:', JSON.stringify(leadData));
  if (leadData.save && isValidLead(leadData.name, leadData.phone)) {
    try {
      await saveLead(sessionId, leadData.name, leadData.phone, leadData.problem);
      await notifyManager(leadData);
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
  let url = `${SUPABASE_URL}/rest/v1/leads?select=*&order=id.desc`;
  if (sinceIso) url += `&created_at=gte.${encodeURIComponent(sinceIso)}`;
  const r = await fetch(url, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
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

  return `📊 <b>${periodLabel}</b>\n\n` +
    `📥 Всего заявок: <b>${total}</b>\n` +
    `🆕 Новых: <b>${newOnes}</b>\n` +
    `🔄 В работе: <b>${inProgress}</b>\n` +
    `✅ Закрыто: <b>${closed}</b>\n` +
    `📈 Конверсия: <b>${conversion}%</b>`;
}

// ========== ВЕБХУКИ ==========

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
    // Обработка кнопок
    if (req.body.callback_query) {
      const cb = req.body.callback_query;
      const chatId = cb.message.chat.id;
      const messageId = cb.message.message_id;
      const data = cb.data;

      if (String(chatId) !== String(MANAGER_CHAT_ID)) { await answerCallback(cb.id, 'Нет доступа'); return; }

      if (data.startsWith('status_')) {
        const parts = data.split('_');
        const leadId = parts[1];
        const newStatus = parts.slice(2).join('_');

        await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
          method: 'PATCH',
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ status: newStatus, updated_at: new Date().toISOString() })
        });

        const statusLabel = newStatus === 'closed' ? '✅ Закрыта' : (newStatus === 'in_progress' ? '🔄 В работе' : '🆕 Новая');
        await answerCallback(cb.id, `Статус: ${statusLabel}`);

        const newKeyboard = [
          [
            { text: newStatus === 'in_progress' ? '✅ Закрыть' : '🔄 Взять в работу', callback_data: newStatus === 'in_progress' ? `status_${leadId}_closed` : `status_${leadId}_in_progress` }
          ]
        ];
        const baseText = cb.message.text.replace(/\n\n<i>Статус:.*<\/i>$/, '');
        await editMessage(chatId, messageId, `${baseText}\n\n<i>Статус: ${statusLabel}</i>`, newKeyboard);
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

    // /start
    if (text.startsWith('/start')) {
      const parts = text.split(' ');
      const siteSessionId = parts[1];
      if (siteSessionId && siteSessionId.startsWith('sess_')) {
        await getOrCreateSession(siteSessionId);
        await updateSession(siteSessionId, { telegram_chat_id: chatId });
        await sendTelegram(chatId, '👋 Продолжаем диалог с сайта. Чем помочь?');
      } else {
        await sendTelegram(chatId, '👋 Здравствуйте! Я AI-Администратор. Задайте вопрос.');
      }
      return;
    }

    // ===== КОМАНДЫ МЕНЕДЖЕРА =====

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

    // ===== ОБЫЧНЫЙ ДИАЛОГ =====

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

// ========== АВТОСВОДКИ (CRON) ==========

// Ежедневно в 20:00 по Москве (17:00 UTC)
cron.schedule('0 17 * * *', async () => {
  try {
    if (!MANAGER_CHAT_ID) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const leads = await fetchLeads(today.toISOString());
    if (leads.length === 0) return;

    await sendTelegram(MANAGER_CHAT_ID, statsBlock(leads, `Итоги за сегодня (${today.toLocaleDateString('ru-RU')})`));

    const buffer = await buildXlsx(leads, 'День');
    await sendTelegramDoc(MANAGER_CHAT_ID, buffer, `leads_day_${new Date().toISOString().slice(0,10)}.xlsx`, `📥 Заявки за день (${leads.length} шт.)`);
  } catch (e) { console.log('cron day error:', e.message); }
});

// Каждый понедельник в 10:00 по Москве (07:00 UTC)
cron.schedule('0 7 * * 1', async () => {
  try {
    if (!MANAGER_CHAT_ID) return;
    const since = new Date(); since.setDate(since.getDate() - 7); since.setHours(0, 0, 0, 0);
    const leads = await fetchLeads(since.toISOString());
    if (leads.length === 0) return;

    await sendTelegram(MANAGER_CHAT_ID, statsBlock(leads, `Итоги за неделю (${since.toLocaleDateString('ru-RU')} — ${new Date().toLocaleDateString('ru-RU')})`));

    const buffer = await buildXlsx(leads, 'Неделя');
    await sendTelegramDoc(MANAGER_CHAT_ID, buffer, `leads_week_${new Date().toISOString().slice(0,10)}.xlsx`, `📥 Заявки за неделю (${leads.length} шт.)`);
  } catch (e) { console.log('cron week error:', e.message); }
});

// 1-го числа каждого месяца в 10:00 по Москве (07:00 UTC)
cron.schedule('0 7 1 * *', async () => {
  try {
    if (!MANAGER_CHAT_ID) return;
    const since = new Date(); since.setMonth(since.getMonth() - 1); since.setDate(1); since.setHours(0, 0, 0, 0);
    const leads = await fetchLeads(since.toISOString());
    if (leads.length === 0) return;

    await sendTelegram(MANAGER_CHAT_ID, statsBlock(leads, `Итоги за месяц (${since.toLocaleDateString('ru-RU')} — ${new Date().toLocaleDateString('ru-RU')})`));

    const buffer = await buildXlsx(leads, 'Месяц');
    await sendTelegramDoc(MANAGER_CHAT_ID, buffer, `leads_month_${new Date().toISOString().slice(0,7)}.xlsx`, `📥 Заявки за месяц (${leads.length} шт.)`);
  } catch (e) { console.log('cron month error:', e.message); }
});

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
