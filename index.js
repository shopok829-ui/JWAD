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
// 🎨 نظام الداش بورد المطور (Advanced Dashboard)
// =================================================================

const getDashboardHTML = (records) => {
    // نمرر البيانات الخام إلى المتصفح ليتعامل معها الجافاسكربت بمرونة
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
            .card { border: none; border-radius: 15px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); transition: transform 0.2s; }
            .card:hover { transform: translateY(-5px); }
            .metric-value { font-size: 2rem; font-weight: bold; color: #2c3e50; }
            .metric-label { color: #7f8c8d; font-size: 0.9rem; }
            .chart-box { height: 300px; position: relative; }
            .header-gradient { background: linear-gradient(135deg, #0d6efd, #0dcaf0); color: white; padding: 2rem 0; margin-bottom: 2rem; border-radius: 0 0 20px 20px; }
            .filter-btn { margin: 0 5px; border-radius: 20px; padding: 5px 20px; }
            .filter-btn.active { background-color: #0d6efd; color: white; }
            table thead { background-color: #f8f9fa; }
        </style>
    </head>
    <body>

        <div class="header-gradient text-center">
            <div class="container">
                <h1>📊 لوحة التحكم المالية</h1>
                <p class="opacity-75">متابعة دقيقة لمصاريفك الشخصية</p>
                <div class="mt-3">
                    <button onclick="filterData('all')" class="btn btn-light filter-btn active" id="btn-all">الكل</button>
                    <button onclick="filterData('month')" class="btn btn-light filter-btn" id="btn-month">هذا الشهر</button>
                    <button onclick="filterData('week')" class="btn btn-light filter-btn" id="btn-week">آخر 7 أيام</button>
                </div>
            </div>
        </div>

        <div class="container mb-5">
            <div class="row g-4 mb-4">
                <div class="col-md-4">
                    <div class="card p-3 text-center">
                        <div class="metric-label">إجمالي المصروفات</div>
                        <div class="metric-value text-primary" id="totalDisplay">0 ر.س</div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="card p-3 text-center">
                        <div class="metric-label">عدد العمليات</div>
                        <div class="metric-value text-success" id="countDisplay">0</div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="card p-3 text-center">
                        <div class="metric-label">المتوسط للعملية</div>
                        <div class="metric-value text-warning" id="avgDisplay">0 ر.س</div>
                    </div>
                </div>
            </div>

            <div class="row g-4 mb-4">
                <div class="col-md-6">
                    <div class="card p-3">
                        <h5 class="card-title mb-3">توزيع المصاريف (الفئات)</h5>
                        <div class="chart-box">
                            <canvas id="categoryChart"></canvas>
                        </div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="card p-3">
                        <h5 class="card-title mb-3">تطور الصرف (يومياً)</h5>
                        <div class="chart-box">
                            <canvas id="trendChart"></canvas>
                        </div>
                    </div>
                </div>
            </div>

            <div class="card p-4">
                <h5 class="card-title mb-3">📝 آخر العمليات المسجلة</h5>
                <div class="table-responsive">
                    <table class="table table-hover align-middle">
                        <thead>
                            <tr>
                                <th>التاريخ</th>
                                <th>البند</th>
                                <th>التصنيف</th>
                                <th>المبلغ</th>
                            </tr>
                        </thead>
                        <tbody id="transactionsTable">
                            </tbody>
                    </table>
                </div>
            </div>
        </div>

        <script>
            // استلام البيانات من السيرفر
            const rawData = JSON.parse("${safeRecords}");
            let categoryChartInstance = null;
            let trendChartInstance = null;

            // تحويل التواريخ لتنسيق قابل للمقارنة
            const processedData = rawData.map(item => {
                // تحويل التاريخ من DD/MM/YYYY إلى كائن Date
                const parts = item.date.split('/');
                const dateObj = new Date(parts[2], parts[1] - 1, parts[0]);
                return { ...item, dateObj: dateObj };
            });

            function filterData(type) {
                // تحديث شكل الأزرار
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active', 'btn-primary'));
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.add('btn-light'));
                const activeBtn = document.getElementById('btn-' + type);
                activeBtn.classList.remove('btn-light');
                activeBtn.classList.add('active', 'btn-primary');

                const now = new Date();
                let filtered = [];

                if (type === 'all') {
                    filtered = processedData;
                } else if (type === 'month') {
                    filtered = processedData.filter(d => 
                        d.dateObj.getMonth() === now.getMonth() && 
                        d.dateObj.getFullYear() === now.getFullYear()
                    );
                } else if (type === 'week') {
                    const lastWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
                    filtered = processedData.filter(d => d.dateObj >= lastWeek);
                }

                updateDashboard(filtered);
            }

            function updateDashboard(data) {
                // 1. تحديث الأرقام
                const total = data.reduce((sum, item) => sum + (item.amount || 0), 0);
                const count = data.length;
                const avg = count > 0 ? (total / count).toFixed(1) : 0;

                document.getElementById('totalDisplay').innerText = total.toLocaleString() + ' ر.س';
                document.getElementById('countDisplay').innerText = count;
                document.getElementById('avgDisplay').innerText = avg + ' ر.س';

                // 2. تحديث الجدول (آخر 10 عمليات)
                const tableBody = document.getElementById('transactionsTable');
                tableBody.innerHTML = data.slice(-10).reverse().map(item => \`
                    <tr>
                        <td>\${item.date} <small class="text-muted">\${item.time}</small></td>
                        <td class="fw-bold">\${item.item}</td>
                        <td><span class="badge bg-secondary">\${item.category}</span></td>
                        <td class="text-danger fw-bold">-\${item.amount}</td>
                    </tr>
                \`).join('');

                // 3. تحديث الرسم البياني (الفئات)
                const categories = {};
                data.forEach(item => {
                    categories[item.category] = (categories[item.category] || 0) + item.amount;
                });

                if (categoryChartInstance) categoryChartInstance.destroy();
                const ctxCat = document.getElementById('categoryChart').getContext('2d');
                categoryChartInstance = new Chart(ctxCat, {
                    type: 'doughnut',
                    data: {
                        labels: Object.keys(categories),
                        datasets: [{
                            data: Object.values(categories),
                            backgroundColor: ['#3498db', '#e74c3c', '#f1c40f', '#2ecc71', '#9b59b6', '#34495e'],
                            borderWidth: 0
                        }]
                    },
                    options: { maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
                });

                // 4. تحديث الرسم البياني (التطور الزمني)
                const dailySpending = {};
                data.forEach(item => {
                    // تجميع حسب التاريخ
                    const dateKey = item.date; // DD/MM/YYYY
                    dailySpending[dateKey] = (dailySpending[dateKey] || 0) + item.amount;
                });
                
                // ترتيب التواريخ
                const sortedDates = Object.keys(dailySpending).sort((a, b) => {
                    const da = a.split('/'); const db = b.split('/');
                    return new Date(da[2], da[1]-1, da[0]) - new Date(db[2], db[1]-1, db[0]);
                });

                if (trendChartInstance) trendChartInstance.destroy();
                const ctxTrend = document.getElementById('trendChart').getContext('2d');
                trendChartInstance = new Chart(ctxTrend, {
                    type: 'line',
                    data: {
                        labels: sortedDates,
                        datasets: [{
                            label: 'المصروف اليومي',
                            data: sortedDates.map(d => dailySpending[d]),
                            borderColor: '#0d6efd',
                            tension: 0.4,
                            fill: true,
                            backgroundColor: 'rgba(13, 110, 253, 0.1)'
                        }]
                    },
                    options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
                });
            }

            // التشغيل الأولي
            filterData('all');
        </script>
    </body>
    </html>
    `;
};

// الراوت الرئيسي
app.get('/', async (req, res) => {
    try {
        const response = await axios.post(SHEET_SCRIPT_URL, { action: "get_data" });
        const records = response.data.records || [];
        res.send(getDashboardHTML(records));
    } catch (error) {
        res.send(`<h1>حدث خطأ: ${error.message}</h1>`);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));

// =================================================================
// 🤖 كود البوت (نفس المنطق السابق)
// =================================================================
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const userId = msg.from.id.toString();

    if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) return;
    if (!text) return;

    bot.sendChatAction(chatId, 'typing');

    try {
        const intentCheck = await openai.chat.completions.create({
            messages: [
                { role: "system", content: `Classify intent: {"type": "write"} for recording expenses, {"type": "read"} for questions/analysis. Return JSON.` },
                { role: "user", content: text }
            ],
            model: "gpt-3.5-turbo",
        });

        const intent = JSON.parse(intentCheck.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim()).type;

        if (intent === "write") {
            const extraction = await openai.chat.completions.create({
                messages: [
                    { role: "system", content: `Extract JSON: {"item":string, "amount":number, "category":string}. If currency missing assume SAR.` },
                    { role: "user", content: text }
                ],
                model: "gpt-3.5-turbo",
            });

            const data = JSON.parse(extraction.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim());
            data.raw_text = text;

            await axios.post(SHEET_SCRIPT_URL, data);
            bot.sendMessage(chatId, `✅ *تم التسجيل:* ${data.item} (${data.amount} ريال)`, { parse_mode: 'Markdown' });

        } else {
            const sheetResponse = await axios.post(SHEET_SCRIPT_URL, { action: "get_data" });
            const records = sheetResponse.data.records || [];
            const recordsText = records.map(r => `[${r.date}, ${r.item}, ${r.amount}, ${r.category}]`).join("\n");

            const analysis = await openai.chat.completions.create({
                messages: [
                    { role: "system", content: `You are a financial advisor. Data:\n${recordsText}\nAnswer the user query in Arabic.` },
                    { role: "user", content: text }
                ],
                model: "gpt-3.5-turbo",
            });

            bot.sendMessage(chatId, analysis.choices[0].message.content);
        }

    } catch (error) {
        console.error(error);
        bot.sendMessage(chatId, "⚠️ حدث خطأ بسيط، حاول مرة أخرى.");
    }
});
