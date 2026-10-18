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

const SQL_SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id BIGSERIAL PRIMARY KEY,
  content TEXT,
  embedding TEXT,
  url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS chat_sessions (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT UNIQUE,
  telegram_chat_id BIGINT,
  history JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS leads (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT,
  name TEXT,
  phone TEXT,
  problem TEXT,
  source TEXT,
  status TEXT DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS clients (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT UNIQUE,
  business_name TEXT,
  chat_id BIGINT,
  paid_until TIMESTAMPTZ,
  timezone TEXT DEFAULT 'Europe/Moscow',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Добавляем RLS (базовая защита)
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
`;

async function createClient() {
  console.log(`🚀 Создаю: ${businessName} (${clientId})`);
  const ghHeaders = { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' };

  try {
    // 1. СКАЧИВАЕМ КОД
    const sRes = await axios.get(`https://api.github.com/repos/${SOURCE_REPO}/contents/server.js`, { headers: ghHeaders });
    const serverCode = Buffer.from(sRes.data.content, 'base64').toString('utf8');
    const pRes = await axios.get(`https://api.github.com/repos/${SOURCE_REPO}/contents/package.json`, { headers: ghHeaders });
    const packageJson = Buffer.from(pRes.data.content, 'base64').toString('utf8');

    // 2. СОЗДАЕМ РЕПОЗИТОРИЙ
    const ghRes = await axios.post(`https://api.github.com/user/repos`, { name: `chat-bot-${clientId}`, private: false }, { headers: ghHeaders });
    const githubRepoUrl = ghRes.data.html_url;

    // 3. ЗАЛИВАЕМ ФАЙЛЫ
    await axios.put(`https://api.github.com/repos/${GITHUB_OWNER}/chat-bot-${clientId}/contents/server.js`, { message: "Add server.js", content: Buffer.from(serverCode).toString('base64') }, { headers: ghHeaders });
    await axios.put(`https://api.github.com/repos/${GITHUB_OWNER}/chat-bot-${clientId}/contents/package.json`, { message: "Add package.json", content: Buffer.from(packageJson).toString('base64') }, { headers: ghHeaders });
    console.log(`✅ GitHub готов`);

    // 4. СОЗДАЕМ SUPABASE
    let supabaseUrl = '', supabaseKey = '', supabaseRef = '';
    try {
      const dbPassword = Math.random().toString(36).slice(-10) + 'A1!';
      const sbRes = await axios.post(`https://api.supabase.com/v1/projects`, { organization_id: SUPABASE_ORG_ID, name: `sb-${clientId}`, region: 'eu-central-1', db_pass: dbPassword }, { headers: { Authorization: `Bearer ${SUPABASE_TOKEN}` } });
      supabaseRef = sbRes.data.id;
      
      console.log(`⏳ Жду инициализации базы (60 сек)...`);
      await new Promise(r => setTimeout(r, 60000));
      
      const keysRes = await axios.get(`https://api.supabase.com/v1/projects/${supabaseRef}/api-keys`, { headers: { Authorization: `Bearer ${SUPABASE_TOKEN}` } });
      supabaseUrl = `https://${supabaseRef}.supabase.co`;
      supabaseKey = keysRes.data.find(k => k.name === 'service_role')?.api_key;

      // СОЗДАЕМ ТАБЛИЦЫ (SQL)
      console.log(`⏳ Создаю таблицы в базе...`);
      await axios.post(`https://api.supabase.com/v1/projects/${supabaseRef}/database/query`, { query: SQL_SCHEMA }, { headers: { Authorization: `Bearer ${SUPABASE_TOKEN}`, 'Content-Type': 'application/json' } });
      
      console.log(`✅ Supabase готов (таблицы созданы)`);
    } catch (e) { console.log(`❌ Supabase: ${e.response?.data?.message || e.message}`); }

    // 5. СОЗДАЕМ RENDER
    const ownRes = await axios.get('https://api.render.com/v1/owners', { headers: { Authorization: `Bearer ${RENDER_API_KEY}` } });
    const ownerId = ownRes.data[0]?.owner?.id || ownRes.data[0]?.id;
    
    const renderRes = await axios.post('https://api.render.com/v1/services', {
      type: 'web_service', name: `chat-bot-${clientId}`, repo: githubRepoUrl, branch: 'main', ownerId: ownerId,
      envVars: [
        { key: 'CLIENT_ID', value: clientId }, { key: 'BUSINESS_NAME', value: businessName },
        { key: 'SITE_TO_CRAWL', value: siteUrl }, { key: 'BASE_URL', value: siteUrl },
        { key: 'MANAGER_CHAT_ID', value: managerChatId }, { key: 'SUPABASE_URL', value: supabaseUrl },
        { key: 'SUPABASE_KEY', value: supabaseKey }, { key: 'TELEGRAM_TOKEN', value: 'ВСТАВЬТЕ_ТОКЕН' },
        { key: 'OPENROUTER_KEY', value: 'ВСТАВЬТЕ_КЛЮЧ' }, { key: 'FIRECRAWL_KEY', value: 'ВСТАВЬТЕ_КЛЮЧ' }
      ],
      serviceDetails: { env: 'node', plan: 'free', region: 'frankfurt', envSpecificDetails: { buildCommand: 'npm install', startCommand: 'node server.js' } }
    }, { headers: { Authorization: `Bearer ${RENDER_API_KEY}`, 'Content-Type': 'application/json' } });
    console.log(`✅ Render готов: ${renderRes.data.serviceDetails.url}`);
  } catch (e) { console.log(`❌ Ошибка: ${e.response?.data?.message || e.message}`); }
}
createClient();
