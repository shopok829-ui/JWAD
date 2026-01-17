const TelegramBot = require('node-telegram-bot-api');
const { OpenAI } = require('openai');
const axios = require('axios');
const express = require('express');

const app = express();

// المتغيرات
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SHEET_SCRIPT_URL = process.env.SHEET_SCRIPT_URL;
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID;

if (!TELEGRAM_TOKEN || !OPENAI_API_KEY || !SHEET_SCRIPT_URL) {
    console.error("❌ Error: Missing Variables");
    process.exit(1);
}

// =================================================================
// 📊 الجزء الأول: نظام الداش بورد (Dashboard)
// =================================================================

const getDashboardHTML = (records) => {
    const safeRecords = JSON.stringify(records).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    return `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>محفظة جواد 📊</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Tajawal', sans-serif; background-color: #f0f2f5; }
            .header-gradient { background: linear-gradient(135deg, #0d6efd, #0dcaf0); color: white; padding: 2rem 0; margin-bottom: 2rem; border-radius: 0 0 20px 20px; }
            .card { border: none; border-radius: 15px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
            .metric-value { font-size: 1.8rem; font-weight: bold; color: #2c3e50; }
            .chart-box { height: 300px; position: relative; }
            .filter-btn.active { background-color: #0d6efd; color: white; }
        </style>
    </head>
    <body>
        <div class="header-gradient text-center">
            <div class="container">
                <h1>📊 لوحة التحكم المالية</h1>
                <div class="mt-3">
                    <button onclick="filterData('all')" class="btn btn-light filter-btn active" id="btn-all">الكل</button>
                    <button onclick="filterData('month')" class="btn btn-light filter-btn" id="btn-month">هذا الشهر</button>
                    <button onclick="filterData('week')" class="btn btn-light filter-btn" id="btn-week">آخر أسبوع</button>
                </div>
            </div>
        </div>

        <div class="container mb-5">
            <div class="row g-4 mb-4">
                <div class="col-md-4"><div class="card p-3 text-center"><small>الإجمالي</small><div class="metric-value text-primary" id="totalDisplay">0</div></div></div>
                <div class="col-md-4"><div class="card p-3 text-center"><small>العمليات</small><div class="metric-value text-success" id="countDisplay">0</div></div></div>
                <div class="col-md-4"><div class="card p-3 text-center"><small>المتوسط</small><div class="metric-value text-warning" id="avgDisplay">0</div></div></div>
            </div>

            <div class="row g-4 mb-4">
                <div class="col-md-6"><div class="card p-3"><h5>توزيع الفئات</h5><div class="chart-box"><canvas id="categoryChart"></canvas></div></div></div>
                <div class="col-md-6"><div class="card p-3"><h5>التطور الزمني</h5><div class="chart-box"><canvas id="trendChart"></canvas></div></div></div>
            </div>

            <div class="card p-3">
                <h5>📝 آخر العمليات</h5>
                <div class="table-responsive">
                    <table class="table table-hover">
                        <thead><tr><th>التاريخ</th><th>البند</th><th>التصنيف</th><th>المبلغ</th></tr></thead>
                        <tbody id="transactionsTable"></tbody>
                    </table>
                </div>
            </div>
        </div>

        <script>
            const rawData = JSON.parse("${safeRecords}");
            let catChart = null; let trendChart = null;
            
            const processedData = rawData.map(item => {
                const parts = item.date.split('/');
                return { ...item, dateObj: new Date(parts[2], parts[1]-1, parts[0]) };
            });

            function filterData(type) {
                document.querySelectorAll('.filter-btn').forEach(b => { b.classList.remove('active', 'btn-primary'); b.classList.add('btn-light'); });
                document.getElementById('btn-'+type).classList.add('active', 'btn-primary');
                document.getElementById('btn-'+type).classList.remove('btn-light');

                const now = new Date();
                let filtered = processedData;
                if(type === 'month') filtered = processedData.filter(d => d.dateObj.getMonth() === now.getMonth() && d.dateObj.getFullYear() === now.getFullYear());
                if(type === 'week') { const lastWeek = new Date(); lastWeek.setDate(now.getDate() - 7); filtered = processedData.filter(d => d.dateObj >= lastWeek); }
                
                updateUI(filtered);
            }

            function updateUI(data) {
                const total = data.reduce((s, i) => s + (i.amount||0), 0);
                document.getElementById('totalDisplay').innerText = total.toLocaleString() + ' ر.س';
                document.getElementById('countDisplay').innerText = data.length;
                document.getElementById('avgDisplay').innerText = (data.length ? (total/data.length).toFixed(0) : 0) + ' ر.س';

                document.getElementById('transactionsTable').innerHTML = data.slice(-10).reverse().map(i => 
                    \`<tr><td>\${i.date}</td><td>\${i.item}</td><td><span class="badge bg-secondary">\${i.category}</span></td><td class="text-danger">-\${i.amount}</td></tr>\`
                ).join('');

                const cats = {}; const dates = {};
                data.forEach(i => {
                    cats[i.category] = (cats[i.category]||0) + i.amount;
                    dates[i.date] = (dates[i.date]||0) + i.amount;
                });

                if(catChart) catChart.destroy();
                catChart = new Chart(document.getElementById('categoryChart'), {
                    type: 'doughnut',
                    data: { labels: Object.keys(cats), datasets: [{ data: Object.values(cats), backgroundColor: ['#3498db','#e74c3c','#f1c40f','#2ecc71','#9b59b6'] }] },
                    options: { maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
                });

                if(trendChart) trendChart.destroy();
                const sortedDates = Object.keys(dates).sort((a,b) => { const x=a.split('/'); const y=b.split('/'); return new Date(x[2],x[1]-1,x[0]) - new Date(y[2],y[1]-1,y[0]); });
                trendChart = new Chart(document.getElementById('trendChart'), {
                    type: 'line',
                    data: { labels: sortedDates, datasets: [{ label: 'مصروف يومي', data: sortedDates.map(d=>dates[d]), borderColor: '#0d6efd', tension: 0.3, fill: true }] },
                    options: { maintainAspectRatio: false }
                });
            }
            filterData('all');
        </script>
    </body>
    </html>
    `;
};

// راوت الصفحة الرئيسية
app.get('/', async (req, res) => {
    try {
        const response = await axios.post(SHEET_SCRIPT_URL, { action: "get_data" });
        const records = response.data.records || [];
        res.send(getDashboardHTML(records));
    } catch (error) {
        res.send(`<h1>خطأ في الاتصال: ${error.message}</h1>`);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));

// =================================================================
// 🤖 الجزء الثاني: البوت الذكي (Smart Bot)
// =================================================================

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
let pendingTransaction = null; 

console.log('✅ Bot & Dashboard Ready!');

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const userId = msg.from.id.toString();

    if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) return;
    if (!text) return;

    // 1. معالجة الردود المعلقة (اختيار التصنيف)
    if (pendingTransaction) {
        const chosenCategory = text.trim();
        const finalData = {
            item: pendingTransaction.item,
            amount: pendingTransaction.amount,
            category: chosenCategory,
            raw_text: pendingTransaction.raw_text
        };
        bot.sendMessage(chatId, `🔄 تم اعتماد: *${chosenCategory}*`, { parse_mode: 'Markdown' });
        try {
            await axios.post(SHEET_SCRIPT_URL, finalData);
            bot.sendMessage(chatId, `✅ *تم التقييد:* ${finalData.item} (${finalData.amount} ريال) - ${finalData.category}`, { parse_mode: 'Markdown' });
            pendingTransaction = null; 
        } catch (error) {
            bot.sendMessage(chatId, "❌ خطأ في الحفظ.");
        }
        return;
    }

    bot.sendChatAction(chatId, 'typing');

    try {
        // 2. تصنيف النية (كتابة أم قراءة)
        const intentCheck = await openai.chat.completions.create({
            messages: [
                { role: "system", content: `Classify intent: {"type": "write"} for expenses, {"type": "read"} for questions/analysis. Return JSON.` },
                { role: "user", content: text }
            ],
            model: "gpt-3.5-turbo",
        });
        const intent = JSON.parse(intentCheck.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim()).type;

        // 3. التنفيذ
        if (intent === "write") {
            const extraction = await openai.chat.completions.create({
                messages: [
                    { 
                        role: "system", 
                        content: `Extract expense JSON: {"item": string, "amount": number, "category": string}.
                        CATEGORIES:
                        - "السكن", "الفواتير الخدمية", "الاتصالات والإنترنت", "التعليم", "العمالة المنزلية", "الأقساط البنكية"
                        - "السوبر ماركت", "النقل والمواصلات", "الصحة", "مستلزمات الأطفال"
                        - "المطاعم والكافيهات", "الترفيه", "العناية الشخصية", "الواجبات الاجتماعية"
                        - "الادخار للطوارئ", "الادخار لأهداف مستقبلية", "الاستثمار"

                        RULES:
                        1. Guess category if item is clear (e.g. Burger -> المطاعم, Uber -> النقل).
                        2. Use "ASK_USER" ONLY if item is ambiguous (e.g. "Noon", "Transfer", "Purchase").
                        Return JSON.` 
                    },
                    { role: "user", content: text }
                ],
                model: "gpt-3.5-turbo",
            });
            const data = JSON.parse(extraction.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim());
            data.raw_text = text;

            if (data.category === "ASK_USER") {
                pendingTransaction = { item: data.item, amount: data.amount, raw_text: text };
                bot.sendMessage(chatId, `❓ *توضيح مطلوب:* ما تصنيف "${data.item}" (${data.amount} ريال)؟`, { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ["السوبر ماركت", "المطاعم والكافيهات"],
                            ["النقل والمواصلات", "العناية الشخصية"],
                            ["مستلزمات الأطفال", "الواجبات الاجتماعية"],
                            ["الترفيه", "إلغاء"]
                        ],
                        one_time_keyboard: true, resize_keyboard: true
                    }
                });
                return;
            }

            await axios.post(SHEET_SCRIPT_URL, data);
            bot.sendMessage(chatId, `✅ *تم التقييد:* ${data.item} (${data.amount} ريال) - ${data.category}`, { parse_mode: 'Markdown' });

        } else {
            // القراءة والتحليل
            const sheetResponse = await axios.post(SHEET_SCRIPT_URL, { action: "get_data" });
            const records = sheetResponse.data.records || [];
            const recordsText = records.map(r => `[${r.date}, ${r.item}, ${r.amount}, ${r.category}]`).join("\n");

            const analysis = await openai.chat.completions.create({
                messages: [
                    { role: "system", content: `Financial advisor. Data:\n${recordsText}\nAnswer in Arabic.` },
                    { role: "user", content: text }
                ],
                model: "gpt-3.5-turbo",
            });
            bot.sendMessage(chatId, analysis.choices[0].message.content);
        }

    } catch (error) {
        console.error(error);
        pendingTransaction = null;
        bot.sendMessage(chatId, "⚠️ خطأ بسيط، حاول مرة أخرى.");
    }
});
