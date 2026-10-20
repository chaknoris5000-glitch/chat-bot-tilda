<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>AI-Администратор</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root {
            --bg: #f4f6f8; --text: #0f172a; --hint: #64748b;
            --primary: #1e3a2f; --primary-light: #2F5B43;
            --border: #e2e8f0; --card-bg: #ffffff; --success: #10b981; --danger: #ef4444;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body { background: var(--bg); color: var(--text); height: 100vh; overflow: hidden; display: flex; flex-direction: column; }
        
        /* Header */
        .top-header { padding: 20px; background: #fff; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: flex-start; z-index: 10; }
        .header-left h1 { font-size: 22px; font-weight: 800; color: var(--primary); letter-spacing: -0.5px; }
        .header-left p { font-size: 13px; color: var(--hint); margin-top: 4px; }
        .btn-support { background: #f1f5f9; color: var(--primary); border: 1px solid var(--border); padding: 8px 12px; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer; }

        /* Контейнер для свайпа (горизонтальный скролл) */
        .swipe-container { flex: 1; display: flex; overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory; scroll-behavior: smooth; scrollbar-width: none; }
        .swipe-container::-webkit-scrollbar { display: none; }
        
        /* Каждая вкладка — это отдельная страница */
        .page { min-width: 100vw; height: 100%; scroll-snap-align: start; overflow-y: auto; padding: 20px 20px 100px 20px; }

        /* Стили Аккаунта */
        .card { background: var(--card-bg); border-radius: 16px; padding: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.03); margin-bottom: 16px; border: 1px solid var(--border); }
        .card-title { font-size: 18px; font-weight: 800; margin-bottom: 16px; color: var(--primary); }
        .info-row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; }
        .info-row:last-child { margin-bottom: 0; }
        .info-label { color: var(--hint); }
        .info-value { font-weight: 700; }
        .progress-bg { background: #e2e8f0; border-radius: 10px; height: 8px; margin-top: 8px; overflow: hidden; }
        .progress-fill { background: var(--success); height: 100%; border-radius: 10px; }

        .plans-grid { display: flex; flex-direction: column; gap: 12px; }
        .plan-card { background: #fff; border: 2px solid var(--border); border-radius: 16px; padding: 20px; transition: 0.2s; cursor: pointer; }
        .plan-card:active { border-color: var(--primary-light); background: #f8fdf9; }
        .plan-name { font-size: 18px; font-weight: 800; margin-bottom: 4px; }
        .plan-price { font-size: 24px; font-weight: 800; color: var(--primary); margin-bottom: 4px; }
        .plan-price span { font-size: 13px; font-weight: 500; color: var(--hint); }
        .plan-year-price { font-size: 13px; color: var(--hint); margin-bottom: 12px; }
        .plan-year-price b { color: var(--success); }

        /* Стили Бизнеса */
        .filters { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 10px; margin-bottom: 16px; scrollbar-width: none; }
        .filters::-webkit-scrollbar { display: none; }
        .filter-btn { padding: 8px 14px; border-radius: 20px; border: 1px solid var(--border); background: #fff; color: var(--hint); font-size: 13px; font-weight: 600; white-space: nowrap; cursor: pointer; }
        .filter-btn.active { background: var(--primary); color: #fff; border-color: var(--primary); }

        .tabs-status { display: flex; gap: 8px; margin-bottom: 16px; }
        .status-tab { flex: 1; text-align: center; padding: 10px; background: #fff; border: 1px solid var(--border); border-radius: 10px; font-size: 13px; font-weight: 700; color: var(--hint); cursor: pointer; }
        .status-tab.active { background: #e8f0ec; color: var(--primary); border-color: var(--primary-light); }

        .lead-list { display: flex; flex-direction: column; gap: 10px; }
        .lead-card { background: #fff; padding: 16px; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 2px 8px rgba(0,0,0,0.02); cursor: pointer; }
        .lead-top { display: flex; justify-content: space-between; margin-bottom: 8px; }
        .lead-name { font-size: 15px; font-weight: 800; }
        .lead-phone { font-size: 13px; color: var(--hint); }
        .lead-service { display: inline-block; background: #f1f5f9; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-top: 8px; }

        /* Нижнее меню */
        .bottom-nav { position: fixed; bottom: 0; left: 0; width: 100%; background: #fff; border-top: 1px solid var(--border); display: flex; justify-content: space-around; padding: 10px 0 20px 0; z-index: 100; box-shadow: 0 -4px 20px rgba(0,0,0,0.05); }
        .nav-item { display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--hint); font-size: 11px; font-weight: 600; cursor: pointer; }
        .nav-item.active { color: var(--primary-light); font-weight: 800; }
        .nav-item svg { width: 24px; height: 24px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

        /* Модалки */
        .modal-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; padding: 20px; }
        .modal-box { background: #fff; border-radius: 16px; padding: 24px; width: 100%; max-width: 400px; max-height: 80vh; overflow-y: auto; }
        .modal-title { font-size: 20px; font-weight: 800; margin-bottom: 16px; color: var(--primary); }
        
        .btn { width: 100%; padding: 14px; border-radius: 10px; border: none; font-size: 15px; font-weight: 700; cursor: pointer; }
        .btn-primary { background: var(--primary); color: #fff; margin-bottom: 10px; }
        .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }
        .btn-danger { background: #fef2f2; color: var(--danger); border: 1px solid #fecaca; }
        .form-group { margin-bottom: 12px; }
        .form-group textarea { width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 14px; outline: none; font-family: inherit; }
    </style>
</head>
<body>
    <div class="top-header">
        <div class="header-left">
            <h1>AI-Администратор</h1>
            <p id="greeting">Загрузка...</p>
        </div>
        <button class="btn-support" onclick="openSupportModal()">Помощь</button>
    </div>

    <!-- КОНТЕЙНЕР ДЛЯ СВАЙПОВ -->
    <div class="swipe-container" id="swipeContainer">
        
        <!-- ================= СТРАНИЦА 1: МОЙ АККАУНТ ================= -->
        <div class="page" id="page-account">
            <div class="card">
                <div class="card-title">Мой аккаунт</div>
                <div class="info-row"><span class="info-label">Текущий тариф:</span><span class="info-value" id="acc-plan-name">—</span></div>
                <div class="info-row"><span class="info-label">Статус:</span><span class="info-value" id="acc-status">—</span></div>
                <div class="info-row"><span class="info-label">Действует до:</span><span class="info-value" id="acc-date">—</span></div>
                <div class="info-row"><span class="info-label">Всего заявок за период:</span><span class="info-value" id="acc-total-leads">0</span></div>
                <div style="margin-top: 16px;">
                    <div class="info-row" style="margin-bottom: 4px;"><span class="info-label">Лимит заявок:</span><span class="info-value" id="acc-limit-text">0 / 100</span></div>
                    <div class="progress-bg"><div class="progress-fill" id="acc-progress" style="width: 0%;"></div></div>
                </div>
            </div>

            <div class="card-title" style="margin-left: 4px; margin-top: 24px; margin-bottom: 16px;">Выберите тариф</div>
            <div class="plans-grid" id="plans-container"></div>
            <button class="btn btn-outline" style="margin-top: 24px; color: var(--danger); border-color: #fecaca;" onclick="openCancelModal()">Отменить подписку</button>
        </div>

        <!-- ================= СТРАНИЦА 2: МОЙ БИЗНЕС ================= -->
        <div class="page" id="page-business">
            <div class="card-title" style="margin-left: 4px; margin-bottom: 16px;">Заявки</div>
            <div class="filters">
                <button class="filter-btn active" onclick="setTimeFilter('today', this)">Сегодня</button>
                <button class="filter-btn" onclick="setTimeFilter('yesterday', this)">Вчера</button>
                <button class="filter-btn" onclick="setTimeFilter('week', this)">За неделю</button>
                <button class="filter-btn" onclick="setTimeFilter('month', this)">За месяц</button>
            </div>
            <div class="tabs-status">
                <div class="status-tab active" onclick="setStatusFilter('all', this)">Все</div>
                <div class="status-tab" onclick="setStatusFilter('new', this)">Новые</div>
                <div class="status-tab" onclick="setStatusFilter('in_progress', this)">В работе</div>
                <div class="status-tab" onclick="setStatusFilter('closed', this)">Выполнено</div>
            </div>
            <div class="lead-list" id="business-leads-list"></div>
            <button class="btn btn-primary" style="margin-top: 24px;" onclick="goToCRM()">Открыть расширенную CRM</button>
        </div>

    </div>

    <!-- Нижнее меню -->
    <div class="bottom-nav" id="bottom-nav">
        <div class="nav-item active" onclick="scrollToPage(0)">
            <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            Аккаунт
        </div>
        <div class="nav-item" onclick="scrollToPage(1)">
            <svg viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            Мой бизнес
        </div>
    </div>

    <!-- Модалки (Тариф, Отмена, Поддержка) -->
    <div id="planModal" class="modal-overlay">
        <div class="modal-box">
            <div class="modal-title" id="modal-plan-name">Тариф</div>
            <div class="plan-price" id="modal-plan-price" style="font-size: 28px;">0 ₽</div>
            <ul id="modal-plan-features" style="margin-top: 16px; margin-bottom: 24px; list-style: none; padding-left: 0;"></ul>
            <button class="btn btn-primary" onclick="payPlan()">Оплатить</button>
            <button class="btn btn-outline" onclick="closeModal('planModal')">Закрыть</button>
        </div>
    </div>

    <div id="cancelModal" class="modal-overlay">
        <div class="modal-box">
            <div class="modal-title">Отмена подписки</div>
            <p style="font-size: 14px; color: var(--hint); margin-bottom: 16px;">Нам жаль, что вы уходите. Пожалуйста, напишите, что вас не устроило:</p>
            <div class="form-group"><textarea id="cancel-reason" rows="3" placeholder="Ваш отзыв..."></textarea></div>
            <button class="btn btn-danger" onclick="submitCancel()">Отправить и отменить</button>
            <button class="btn btn-outline" onclick="closeModal('cancelModal')">Остаться</button>
        </div>
    </div>

    <div id="supportModal" class="modal-overlay">
        <div class="modal-box">
            <div class="modal-title">Поддержка</div>
            <p style="font-size: 14px; color: var(--hint); margin-bottom: 16px;">Опишите вашу проблему, и мы свяжемся с вами.</p>
            <div class="form-group"><textarea id="support-text" rows="4" placeholder="Ваше сообщение..."></textarea></div>
            <button class="btn btn-primary" onclick="sendSupport()">Отправить</button>
            <button class="btn btn-outline" onclick="closeModal('supportModal')">Отмена</button>
        </div>
    </div>

    <script>
        const SUPABASE_URL = 'https://ozutjnwextahorvzdbpl.supabase.co';
        const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96dXRqbndleHRhaG9ydnpkYnBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2MTQ3MzUsImV4cCI6MjEwNzE5MDczNX0.8L3adhQ9gUR5iSly1afSQN6HeEhkj9QQ4NtUyZUQx28';
        const ADMIN_TELEGRAM_ID = 5818548555; 
        
        const tg = window.Telegram.WebApp;
        tg.expand();

        const TARIFFS = {
            'start': { name: 'Старт', month: 1990, year: 14900, features: ['До 100 заявок в месяц', 'Настройка и первая неделя — бесплатно', 'CRM-система и Telegram-бот'] },
            'business': { name: 'Бизнес', month: 2490, year: 19900, features: ['До 300 заявок в месяц', 'Все функции CRM + Аналитика', 'Бесшовный переход в Telegram'] },
            'unlimited': { name: 'Безлимит', month: 4990, year: 39900, features: ['Неограниченное количество заявок', 'Приоритетная поддержка', 'Любые интеграции под ваш бизнес'] },
            'result': { name: 'За результат', month: 25, year: 0, features: ['Оплата только за заявки (25 ₽)', 'Отчет в конце месяца', 'Никаких фиксированных платежей'] }
        };

        let myClient = null;
        let myLeads = [];
        let currentPlanKey = null;
        let filterStatus = 'all';

        // Скролл к странице (для кнопок меню)
        function scrollToPage(index) {
            const container = document.getElementById('swipeContainer');
            container.scrollTo({ left: index * window.innerWidth, behavior: 'smooth' });
        }

        // Отслеживание скролла для подсветки кнопок меню
        document.getElementById('swipeContainer').addEventListener('scroll', () => {
            const container = document.getElementById('swipeContainer');
            const scrollLeft = container.scrollLeft;
            const width = window.innerWidth;
            
            if (scrollLeft < width / 2) {
                document.querySelectorAll('.nav-item')[0].classList.add('active');
                document.querySelectorAll('.nav-item')[1].classList.remove('active');
            } else {
                document.querySelectorAll('.nav-item')[0].classList.remove('active');
                document.querySelectorAll('.nav-item')[1].classList.add('active');
            }
        });

        async function init() {
            const user = tg.initDataUnsafe?.user;
            if (!user) return;
            document.getElementById('greeting').innerText = `Привет, ${user.first_name}!`;
            
            try {
                const [resLeads, resClients] = await Promise.all([
                    fetch(`${SUPABASE_URL}/rest/v1/leads?select=*&order=id.desc`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }),
                    fetch(`${SUPABASE_URL}/rest/v1/clients?select=*`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } })
                ]);

                const allLeads = await resLeads.json();
                const allClients = await resClients.json();
                myClient = allClients.find(c => c.owner_telegram_id === user.id);

                if (user.id !== ADMIN_TELEGRAM_ID && myClient) {
                    const paidUntil = new Date(myClient.paid_until);
                    document.getElementById('acc-plan-name').innerText = myClient.business_name || 'Бизнес';
                    document.getElementById('acc-date').innerText = paidUntil.toLocaleDateString('ru-RU');
                    document.getElementById('acc-status').innerText = (paidUntil > new Date()) ? 'Активен' : 'Истек';
                    
                    myLeads = allLeads.filter(l => l.client_id === myClient.client_id);
                    document.getElementById('acc-total-leads').innerText = myLeads.length;
                    document.getElementById('acc-limit-text').innerText = `${myLeads.length} / 300`;
                    document.getElementById('acc-progress').style.width = Math.min((myLeads.length/300)*100, 100) + '%';

                    renderLeads();
                }
                renderPlans();
            } catch (e) { console.error(e); }
        }

        function renderPlans() {
            const container = document.getElementById('plans-container');
            container.innerHTML = '';
            Object.keys(TARIFFS).forEach(key => {
                const t = TARIFFS[key];
                const card = document.createElement('div');
                card.className = 'plan-card';
                card.onclick = () => openPlanModal(key);
                card.innerHTML = `
                    <div class="plan-name">${t.name}</div>
                    <div class="plan-price">${t.month} ₽ <span>/ мес</span></div>
                    ${t.year > 0 ? `<div class="plan-year-price">При оплате за год: <b>${t.year} ₽</b></div>` : `<div class="plan-year-price">Оплата по факту заявок</div>`}
                `;
                container.appendChild(card);
            });
        }

        function renderLeads() {
            const list = document.getElementById('business-leads-list');
            list.innerHTML = '';
            let filtered = myLeads.filter(lead => filterStatus === 'all' || lead.status === filterStatus);

            if (filtered.length === 0) {
                list.innerHTML = '<p style="color:var(--hint); text-align:center; padding:20px;">Нет заявок</p>';
                return;
            }

            filtered.forEach(lead => {
                const el = document.createElement('div');
                el.className = 'lead-card';
                el.innerHTML = `
                    <div class="lead-top">
                        <div class="lead-name">${lead.name || 'Без имени'}</div>
                    </div>
                    <div class="lead-phone">📞 ${lead.phone || '—'}</div>
                    <div class="lead-service">${lead.service || 'Услуга не указана'}</div>
                `;
                list.appendChild(el);
            });
        }

        function setStatusFilter(status, btn) {
            filterStatus = status;
            document.querySelectorAll('.status-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderLeads();
        }

        function openPlanModal(key) {
            currentPlanKey = key;
            const t = TARIFFS[key];
            document.getElementById('modal-plan-name').innerText = t.name;
            document.getElementById('modal-plan-price').innerText = t.month + ' ₽';
            const ul = document.getElementById('modal-plan-features');
            ul.innerHTML = t.features.map(f => `<li style="font-size:14px; margin-bottom:8px;">✓ ${f}</li>`).join('');
            document.getElementById('planModal').style.display = 'flex';
        }

        function openCancelModal() { document.getElementById('cancelModal').style.display = 'flex'; }
        function openSupportModal() { document.getElementById('supportModal').style.display = 'flex'; }
        function closeModal(id) { document.getElementById(id).style.display = 'none'; }

        function payPlan() { alert('Переход к оплате'); closeModal('planModal'); }
        function submitCancel() { alert('Отменено'); closeModal('cancelModal'); }
        async function sendSupport() {
            const text = document.getElementById('support-text').value;
            if(!text) return;
            await fetch('/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, user_id: tg.initDataUnsafe.user.id, name: tg.initDataUnsafe.user.first_name }) });
            alert('Отправлено!');
            closeModal('supportModal');
        }

        function goToCRM() { window.location.href = '/crm?auth_success=1&telegram_id=' + tg.initDataUnsafe.user.id; }

        init();
    </script>
</body>
</html>
