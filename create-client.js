const axios = require('axios');

const GITHUB_TOKEN = process.env.MY_GITHUB_TOKEN || '';
const RENDER_API_KEY = process.env.RENDER_API_KEY || '';
const GITHUB_OWNER = 'chaknoris5000-glitch';
const SOURCE_REPO = 'chaknoris5000-glitch/chat-bot-tilda';

const clientId = process.argv[2];
const businessName = process.argv[3];
const siteUrl = process.argv[4];
const timezone = process.argv[5] || 'Europe/Moscow';
const managerChatId = process.argv[6];
const botToken = process.argv[7];
const ownerTelegramId = process.argv[8]; 

async function generatePrompt(businessName, siteUrl) {
  try {
    const r = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: 'deepseek/deepseek-chat',
      messages: [{ role: 'user', content: `Напиши системный промпт для ИИ-администратора компании "${businessName}" (сайт: ${siteUrl}). Промпт от первого лица. Правила: 1. Называй бизнес по имени. 2. Общайся естественно. 3. Отвечай ОЧЕНЬ коротко: 1-3 предложения. 4. НЕ используй списки. 5. Задавай ОДИН вопрос за раз. 6. Собирай заявки. 7. Не упоминай, что ты бот. 8. ОБЯЗАТЕЛЬНО добавь в конце: [LEAD_SAVE][NAME:имя][PHONE:телефон][PROBLEM:суть]. Верни только текст.` }],
      temperature: 0.7
    }, { headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`, 'Content-Type': 'application/json' } });
    return r.data.choices[0].message.content.trim();
  } catch (e) {
    return `Ты — администратор компании «${businessName}». Отвечай коротко. Собирай заявки. Когда клиент назвал имя и телефон, добавь в конце: [LEAD_SAVE][NAME:имя][PHONE:телефон][PROBLEM:суть]`;
  }
}

async function createClient() {
  console.log(`🚀 Создаю: ${businessName} (${clientId})`);
  const ghHeaders = { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' };

  try {
    const [sRes, pRes, cRes, aRes] = await Promise.all([
      axios.get(`https://api.github.com/repos/${SOURCE_REPO}/contents/server.js`, { headers: ghHeaders }),
      axios.get(`https://api.github.com/repos/${SOURCE_REPO}/contents/package.json`, { headers: ghHeaders }),
      axios.get(`https://api.github.com/repos/${SOURCE_REPO}/contents/crm.html`, { headers: ghHeaders }),
      axios.get(`https://api.github.com/repos/${SOURCE_REPO}/contents/app.html`, { headers: ghHeaders })
    ]);

    let serverCode = Buffer.from(sRes.data.content, 'base64').toString('utf8');
    const generatedPrompt = await generatePrompt(businessName, siteUrl);
    serverCode = serverCode.replace(/const BUSINESS_PROMPT = .*?;/s, `const BUSINESS_PROMPT = ${JSON.stringify(generatedPrompt)};`);
    
    const packageJson = Buffer.from(pRes.data.content, 'base64').toString('utf8');
    const crmHtml = Buffer.from(cRes.data.content, 'base64').toString('utf8');
    const appHtml = Buffer.from(aRes.data.content, 'base64').toString('utf8');

    serverCode = serverCode.replace(/const CLIENT_ID = .*?;/, `const CLIENT_ID = '${clientId}';`);
    serverCode = serverCode.replace(/const BUSINESS_NAME = .*?;/, `const BUSINESS_NAME = '${businessName}';`);
    serverCode = serverCode.replace(/const SITE_TO_CRAWL = .*?;/, `const SITE_TO_CRAWL = '${siteUrl}';`);
    serverCode = serverCode.replace(/const BASE_URL = .*?;/, `const BASE_URL = '${siteUrl}';`);

    serverCode = serverCode.replace(/if \(lowerMsg\.includes\('тариф'\).*?\}\n/s, '');
    serverCode = serverCode.replace(/if \(lowerMsg\.includes\('пример'\).*?\}\n/s, '');

    const ghRes = await axios.post(`https://api.github.com/user/repos`, { name: `chat-bot-${clientId}`, private: false }, { headers: ghHeaders });
    const githubRepoUrl = ghRes.data.html_url;

    const uploadFile = async (path, content, message) => {
      await axios.put(`https://api.github.com/repos/${GITHUB_OWNER}/chat-bot-${clientId}/contents/${path}`, { message: message, content: Buffer.from(content).toString('base64') }, { headers: ghHeaders });
    };

    await uploadFile('server.js', serverCode, 'Add server.js');
    await uploadFile('package.json', packageJson, 'Add package.json');
    await uploadFile('crm.html', crmHtml, 'Add crm.html');
    await uploadFile('app.html', appHtml, 'Add app.html');

    const commonSupabaseUrl = process.env.COMMON_SUPABASE_URL;
    const commonSupabaseKey = process.env.COMMON_SUPABASE_KEY;
    
    try {
      await axios.post(`${commonSupabaseUrl}/rest/v1/clients`, {
        client_id: clientId,
        business_name: businessName,
        chat_id: parseInt(managerChatId, 10),
        paid_until: new Date(Date.now() + 7 * 86400000).toISOString(),
        timezone: timezone,
        prompt: null,
        // БЕЗОПАСНАЯ ПРОВЕРКА ID
        owner_telegram_id: (ownerTelegramId && !isNaN(ownerTelegramId) && ownerTelegramId !== 'НЕТ_ТОКЕНА') ? Number(ownerTelegramId) : null
      }, { headers: { 'apikey': commonSupabaseKey, 'Authorization': `Bearer ${commonSupabaseKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' } });
      console.log(`✅ Клиент добавлен в базу`);
    } catch (e) { console.log(`❌ Ошибка базы: ${e.response?.data?.message || e.message}`); }
     
    const ownRes = await axios.get('https://api.render.com/v1/owners', { headers: { Authorization: `Bearer ${RENDER_API_KEY}` } });
    const ownerId = ownRes.data[0]?.owner?.id || ownRes.data[0]?.id;
    
    await axios.post('https://api.render.com/v1/services', {
      type: 'web_service', name: `chat-bot-${clientId}`, repo: githubRepoUrl, branch: 'main', ownerId: ownerId,
      envVars: [
        { key: 'CLIENT_ID', value: clientId }, 
        { key: 'BUSINESS_NAME', value: businessName },
        { key: 'SITE_TO_CRAWL', value: siteUrl }, 
        { key: 'BASE_URL', value: siteUrl },
        { key: 'MANAGER_CHAT_ID', value: managerChatId }, 
        { key: 'SUPABASE_URL', value: process.env.COMMON_SUPABASE_URL },
        { key: 'SUPABASE_KEY', value: process.env.COMMON_SUPABASE_KEY }, 
        { key: 'COMMON_SUPABASE_URL', value: process.env.COMMON_SUPABASE_URL },
        { key: 'COMMON_SUPABASE_KEY', value: process.env.COMMON_SUPABASE_KEY },
        { key: 'TELEGRAM_TOKEN', value: botToken },
        { key: 'OPENROUTER_KEY', value: process.env.OPENROUTER_KEY },
        { key: 'FIRECRAWL_KEY', value: process.env.FIRECRAWL_KEY },
        { key: 'YOOKASSA_SHOP_ID', value: process.env.YOOKASSA_SHOP_ID },
        { key: 'YOOKASSA_SECRET_KEY', value: process.env.YOOKASSA_SECRET_KEY }
      ],
      serviceDetails: { env: 'node', plan: 'free', region: 'frankfurt', envSpecificDetails: { buildCommand: 'npm install', startCommand: 'node server.js' } }
    }, { headers: { Authorization: `Bearer ${RENDER_API_KEY}`, 'Content-Type': 'application/json' } });
    console.log(`✅ Render готов`);

    if (botToken && botToken !== 'НЕТ_ТОКЕНА') {
      try {
        const webhookUrl = `https://chat-bot-${clientId}.onrender.com/telegram-webhook`;
        await axios.get(`https://api.telegram.org/bot${botToken}/setWebhook?url=${webhookUrl}`);
        console.log(`✅ Вебхук привязан`);
      } catch (e) { console.log(`❌ Ошибка вебхука: ${e.message}`); }
    }

    if (siteUrl) {
      try {
        console.log(`⏳ Парсинг сайта... Жду 10 сек...`);
        await new Promise(resolve => setTimeout(resolve, 10000)); 
        await axios.get(`https://chat-bot-${clientId}.onrender.com/crawl`);
        console.log(`✅ Сайт спарсен!`);
      } catch (e) { console.log(`⚠️ Ошибка парсинга: ${e.message}`); }
    }

  } catch (e) { console.log(`❌ Ошибка: ${e.response?.data?.message || e.message}`); }
}
createClient();
