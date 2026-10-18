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

async function createClient() {
  console.log(`🚀 Создаю: ${businessName} (${clientId})`);
  const ghHeaders = { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' };

  try {
    const sRes = await axios.get(`https://api.github.com/repos/${SOURCE_REPO}/contents/server.js`, { headers: ghHeaders });
    const serverCode = Buffer.from(sRes.data.content, 'base64').toString('utf8');
    const pRes = await axios.get(`https://api.github.com/repos/${SOURCE_REPO}/contents/package.json`, { headers: ghHeaders });
    const packageJson = Buffer.from(pRes.data.content, 'base64').toString('utf8');

    const ghRes = await axios.post(`https://api.github.com/user/repos`, { name: `chat-bot-${clientId}`, private: false }, { headers: ghHeaders });
    const githubRepoUrl = ghRes.data.html_url;

    await axios.put(`https://api.github.com/repos/${GITHUB_OWNER}/chat-bot-${clientId}/contents/server.js`, { message: "Add server.js", content: Buffer.from(serverCode).toString('base64') }, { headers: ghHeaders });
    await axios.put(`https://api.github.com/repos/${GITHUB_OWNER}/chat-bot-${clientId}/contents/package.json`, { message: "Add package.json", content: Buffer.from(packageJson).toString('base64') }, { headers: ghHeaders });
    console.log(`✅ GitHub готов`);

    let supabaseUrl = '', supabaseKey = '';
    try {
      const sbRes = await axios.post(`https://api.supabase.com/v1/projects`, { organization_id: SUPABASE_ORG_ID, name: `sb-${clientId}`, region: 'eu-central-1', db_pass: Math.random().toString(36).slice(-10) + 'A1!' }, { headers: { Authorization: `Bearer ${SUPABASE_TOKEN}` } });
      await new Promise(r => setTimeout(r, 60000));
      const keysRes = await axios.get(`https://api.supabase.com/v1/projects/${sbRes.data.id}/api-keys`, { headers: { Authorization: `Bearer ${SUPABASE_TOKEN}` } });
      supabaseUrl = `https://${sbRes.data.id}.supabase.co`;
      supabaseKey = keysRes.data.find(k => k.name === 'service_role')?.api_key;
      console.log(`✅ Supabase готов`);
    } catch (e) { console.log(`❌ Supabase: ${e.response?.data?.message || e.message}`); }

    const ownRes = await axios.get('https://api.render.com/v1/owners', { headers: { Authorization: `Bearer ${RENDER_API_KEY}` } });
    const ownerId = ownRes.data[0]?.owner?.id || ownRes.data[0]?.id;
    
    await axios.post('https://api.render.com/v1/services', {
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
    console.log(`✅ Render готов`);
  } catch (e) { console.log(`❌ Ошибка: ${e.response?.data?.message || e.message}`); }
}
createClient();
