const axios = require('axios');

const GITHUB_TOKEN = process.env.MY_GITHUB_TOKEN || '';
const RENDER_API_KEY = process.env.RENDER_API_KEY || '';
const SUPABASE_TOKEN = process.env.SUPABASE_TOKEN || '';
const SUPABASE_ORG_ID = 'ixrnejeyhrxibepllfac'; 
const GITHUB_OWNER = 'chaknoris5000-glitch';
const SOURCE_REPO = 'chaknoris5000-glitch/chat-bot-tilda';

const clientId = process.argv[2];
const businessName = process.argv[3];
const siteUrl = process.argv[4];
const timezone = process.argv[5] || 'Europe/Moscow';
const managerChatId = process.argv[6];
const botToken = process.argv[7];

async function generatePrompt(businessName, siteUrl) {
  try {
    const r = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: 'deepseek/deepseek-chat',
      messages: [
        { role: 'user', content: `Напиши системный промпт для ИИ-администратора компании "${businessName}" (сайт: ${siteUrl}). 
Промпт должен:
1. Называть бизнес по имени.
2. Вежливо консультировать по услугам.
3. Собирать заявки (имя и телефон).
4. Быть коротким (3-4 предложения).
5. Не упоминать другие бизнесы или ИИ-ботов.
Верни только сам текст промпта, без кавычек и лишних слов.` }
      ],
      temperature: 0.7
    }, {
      headers: { 'Authorization': `Bearer ${process.env.COMMON_OPENROUTER_KEY}`, 'Content-Type': 'application/json' }
    });
    return r.data.choices[0].message.content.trim();
  } catch (e) {
    console.log('Ошибка генерации промпта, использую стандартный.');
    return `Ты — администратор компании «${businessName}». Консультируй по услугам, ценам и записи. Собирай заявки.`;
  }
}

async function createClient() {
  console.log(`🚀 Создаю: ${businessName} (${clientId})`);
  const ghHeaders = { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' };

  try {
    // 1. СКАЧИВАЕМ И ОБРАБАТЫВАЕМ КОД
    const sRes = await axios.get(`https://api.github.com/repos/${SOURCE_REPO}/contents/server.js`, { headers: ghHeaders });
    let serverCode = Buffer.from(sRes.data.content, 'base64').toString('utf8');

    serverCode = serverCode.replace(/const CLIENT_ID = .*?;/, `const CLIENT_ID = '${clientId}';`);
    serverCode = serverCode.replace(/const BUSINESS_NAME = .*?;/, `const BUSINESS_NAME = '${businessName}';`);
    serverCode = serverCode.replace(/const SITE_TO_CRAWL = .*?;/, `const SITE_TO_CRAWL = '${siteUrl}';`);
    serverCode = serverCode.replace(/const BASE_URL = .*?;/, `const BASE_URL = '${siteUrl}';`);
    serverCode = serverCode.replace(/const TELEGRAM_TOKEN = .*?;/, `const TELEGRAM_TOKEN = '${botToken}';`);
    serverCode = serverCode.replace(/const MANAGER_CHAT_ID = .*?;/, `const MANAGER_CHAT_ID = '${managerChatId}';`);
    
    const pRes = await axios.get(`https://api.github.com/repos/${SOURCE_REPO}/contents/package.json`, { headers: ghHeaders });
    const packageJson = Buffer.from(pRes.data.content, 'base64').toString('utf8');

    // 2. СОЗДАЕМ РЕПОЗИТОРИЙ
    const ghRes = await axios.post(`https://api.github.com/user/repos`, { name: `chat-bot-${clientId}`, private: false }, { headers: ghHeaders });
    const githubRepoUrl = ghRes.data.html_url;

    // 3. ЗАЛИВАЕМ ФАЙЛЫ
    await axios.put(`https://api.github.com/repos/${GITHUB_OWNER}/chat-bot-${clientId}/contents/server.js`, { message: "Add server.js", content: Buffer.from(serverCode).toString('base64') }, { headers: ghHeaders });
    await axios.put(`https://api.github.com/repos/${GITHUB_OWNER}/chat-bot-${clientId}/contents/package.json`, { message: "Add package.json", content: Buffer.from(packageJson).toString('base64') }, { headers: ghHeaders });
    console.log(`✅ GitHub готов`);

    // 4. ГЕНЕРИРУЕМ ПРОМПТ И ЗАПИСЫВАЕМ В БАЗУ
    const generatedPrompt = await generatePrompt(businessName, siteUrl);
    
    const commonSupabaseUrl = process.env.COMMON_SUPABASE_URL;
    const commonSupabaseKey = process.env.COMMON_SUPABASE_KEY;
    
    try {
      await axios.post(`${commonSupabaseUrl}/rest/v1/clients`, {
        client_id: clientId,
        business_name: businessName,
        chat_id: parseInt(managerChatId, 10),
        paid_until: new Date(Date.now() + 7 * 86400000).toISOString(),
        timezone: timezone,
        prompt: generatedPrompt
      }, {
        headers: { 
          'apikey': commonSupabaseKey, 
          'Authorization': `Bearer ${commonSupabaseKey}`, 
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        }
      });
      console.log(`✅ Клиент и промпт добавлены в базу`);
    } catch (e) {
      console.log(`❌ Ошибка при записи в базу: ${e.response?.data?.message || e.message}`);
    }
     
    // 5. СОЗДАЕМ RENDER
    const ownRes = await axios.get('https://api.render.com/v1/owners', { headers: { Authorization: `Bearer ${RENDER_API_KEY}` } });
    const ownerId = ownRes.data[0]?.owner?.id || ownRes.data[0]?.id;
    
    await axios.post('https://api.render.com/v1/services', {
      type: 'web_service', name: `chat-bot-${clientId}`, repo: githubRepoUrl, branch: 'main', ownerId: ownerId,
      envVars: [
        { key: 'CLIENT_ID', value: clientId }, { key: 'BUSINESS_NAME', value: businessName },
        { key: 'SITE_TO_CRAWL', value: siteUrl }, { key: 'BASE_URL', value: siteUrl },
        { key: 'MANAGER_CHAT_ID', value: managerChatId }, 
        { key: 'SUPABASE_URL', value: process.env.COMMON_SUPABASE_URL },
        { key: 'SUPABASE_KEY', value: process.env.COMMON_SUPABASE_KEY }, 
        { key: 'TELEGRAM_TOKEN', value: botToken },
        { key: 'OPENROUTER_KEY', value: process.env.COMMON_OPENROUTER_KEY }, 
        { key: 'FIRECRAWL_KEY', value: process.env.COMMON_FIRECRAWL_KEY }
      ],
      serviceDetails: { env: 'node', plan: 'free', region: 'frankfurt', envSpecificDetails: { buildCommand: 'npm install', startCommand: 'node server.js' } }
    }, { headers: { Authorization: `Bearer ${RENDER_API_KEY}`, 'Content-Type': 'application/json' } });
    console.log(`✅ Render готов`);

    // 6. ВЕБХУК
    if (botToken) {
      try {
        const webhookUrl = `https://chat-bot-${clientId}.onrender.com/telegram-webhook`;
        await axios.get(`https://api.telegram.org/bot${botToken}/setWebhook?url=${webhookUrl}`);
        console.log(`✅ Вебхук привязан`);
      } catch (e) { console.log(`❌ Ошибка вебхука: ${e.message}`); }
    }

  } catch (e) { console.log(`❌ Ошибка: ${e.response?.data?.message || e.message}`); }
}
createClient();
