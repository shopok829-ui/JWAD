const TelegramBot = require('node-telegram-bot-api');
const { OpenAI } = require('openai');
const axios = require('axios');
const express = require('express');
const cron = require('node-cron'); 

const app = express();

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SHEET_SCRIPT_URL = process.env.SHEET_SCRIPT_URL;
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID;

if (!TELEGRAM_TOKEN || !OPENAI_API_KEY || !SHEET_SCRIPT_URL) {
    console.error("❌ Error: Missing Variables");
    process.exit(1);
}

// =================================================================
// ⏰ 1. التقرير اليومي (الساعة 6 صباحاً بتوقيت الرياض)
// =================================================================
cron.schedule('0 6 * * *', async () => {
    if (!ALLOWED_USER_ID) return;
    try {
        const sheetRes = await axios.post(SHEET_SCRIPT_URL, { action: "get_data" });
        const totals = sheetRes.data.totals;
        const reportMsg = `☀️ *صباح الخير! تقريرك المالي:*
📥 *الدخل:* ${totals.income.toLocaleString()} ريال
📤 *المصروف:* ${totals.expense.toLocaleString()} ريال
💎 *الرصيد:* ${totals.balance.toLocaleString()} ريال
يوماً موفقاً! 🌹`;
        bot.sendMessage(ALLOWED_USER_ID, reportMsg, { parse_mode: "Markdown" });
    } catch (error) {
        console.error('❌ Error daily report:', error.message);
    }
}, { timezone: "Asia/Riyadh" });

// =================================================================
// 📊 2. الداش بورد (النسخة الاحترافية مع الرسوم البيانية)
// =================================================================
const getDashboardHTML = (totals, records) => {
    // تجهيز البيانات للجافاسكربت
    const safeRecords = JSON.stringify(records).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    
    return `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>الميزانية الشخصية</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;800&display=swap" rel="stylesheet">
        
        <style>
            body { font-family: 'Tajawal', sans-serif; background-color: #f0f2f5; padding-bottom: 50px; }
            .header-gradient { background: linear-gradient(135deg, #1e3c72, #2a5298); color: white; padding: 2rem 0; border-radius: 0 0 25px 25px; margin-bottom: 2rem; }
            .card { border: none; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); transition: transform 0.2s; }
            .card:hover { transform: translateY(-5px); }
            .metric-value { font-size: 2rem; font-weight: 800; }
            .text-income { color: #198754; } .text-expense { color: #dc3545; } .text-balance { color: #0d6efd; }
            .chart-container { position: relative; height: 300px; width: 100%; }
        </style>
    </head>
    <body>
        <div class="header-gradient text-center">
            <div class="container">
                <h1>📊 لوحة التحكم المالية</h1>
                <p class="opacity-75">نظرة شاملة على مصاريفك ودخلك</p>
            </div>
        </div>

        <div class="container">
            <div class="row g-3 mb-4">
                <div class="col-md-4">
                    <div class="card p-4 text-center">
                        <span class="text-muted small">إجمالي الدخل</span>
                        <div class="metric-value text-income">${totals.income.toLocaleString()} <small style="font-size:1rem">ريال</small></div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="card p-4 text-center">
                        <span class="text-muted small">إجمالي المصروفات</span>
                        <div class="metric-value text-expense">${totals.expense.toLocaleString()} <small style="font-size:1rem">ريال</small></div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="card p-4 text-center">
                        <span class="text-muted small">الرصيد المتبقي</span>
                        <div class="metric-value text-balance">${totals.balance.toLocaleString()} <small style="font-size:1rem">ريال</small></div>
                    </div>
                </div>
            </div>

            <div class="row g-3 mb-4">
                <div class="col-md-8">
                    <div class="card p-4">
                        <h5 class="mb-3">توزيع المصاريف (حسب الفئة)</h5>
                        <div class="chart-container">
                            <canvas id="categoryChart"></canvas>
                        </div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="card p-4">
                        <h5 class="mb-3">نسبة الصرف</h5>
                        <div class="chart-container">
                            <canvas id="ratioChart"></canvas>
                        </div>
                    </div>
                </div>
            </div>

            <div class="card p-4">
                <h5 class="mb-3">📝 آخر العمليات المسجلة</h5>
                <div class="table-responsive">
                    <table class="table table-hover align-middle">
                        <thead class="table-light">
                            <tr><th>التاريخ</th><th>البند</th><th>التصنيف</th><th>المبلغ</th></tr>
                        </thead>
                        <tbody id="tableBody"></tbody>
                    </table>
                </div>
            </div>
        </div>

        <script>
            // استلام البيانات
            const records = JSON.parse('${safeRecords}');
            const totals = { income: ${totals.income}, expense: ${totals.expense} };

            // 1. تعبئة الجدول
            document.getElementById('tableBody').innerHTML = records.slice(-10).reverse().map(i => {
                const color = i.type === 'income' ? 'text-success' : 'text-danger';
                const sign = i.type === 'income' ? '+' : '-';
                return \`<tr>
                    <td>\${i.date}</td>
                    <td class="fw-bold">\${i.item}</td>
                    <td><span class="badge bg-secondary">\${i.category}</span></td>
                    <td class="\${color} fw-bold" dir="ltr">\${sign}\${i.amount}</td>
                </tr>\`;
            }).join('');

            // 2. تجهيز بيانات الرسم البياني (تجميع المصاريف حسب الفئة)
            const categories = {};
            records.forEach(r => {
                if (r.type === 'expense') {
                    categories[r.category] = (categories[r.category] || 0) + r.amount;
                }
            });

            // 3. رسم الشارت الدائري (توزيع المصاريف)
            new Chart(document.getElementById('categoryChart'), {
                type: 'bar',
                data: {
                    labels: Object.keys(categories),
                    datasets: [{
                        label: 'المصروف',
                        data: Object.values(categories),
                        backgroundColor: '#3498db',
                        borderRadius: 5
                    }]
                },
                options: { 
                    indexAxis: 'y', 
                    responsive: true, 
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } }
                }
            });

            // 4. رسم شارت الدونات (دخل vs صرف)
            new Chart(document.getElementById('ratioChart'), {
                type: 'doughnut',
                data: {
                    labels: ['المتبقي', 'المصروف'],
                    datasets: [{
                        data: [Math.max(0, totals.income - totals.expense), totals.expense],
                        backgroundColor: ['#2ecc71', '#e74c3c'],
                        borderWidth: 0
                    }]
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false,
                    cutout: '70%'
                }
            });
        </script>
    </body>
    </html>`;
};

app.get('/', async (req, res) => {
    try {
        const response = await axios.post(SHEET_SCRIPT_URL, { action: "get_data" });
        res.send(getDashboardHTML(response.data.totals, response.data.records));
    } catch (error) { res.send(error.message); }
});
app.listen(3000, () => console.log(`Server started`));

// =================================================================
// 🤖 3. البوت الذكي (كامل المزايا)
// =================================================================
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
let pendingTransaction = null; 

const EXPENSE_CATEGORIES = [["السوبر ماركت", "المطاعم والكافيهات"], ["النقل والمواصلات", "الفواتير الخدمية"], ["مستلزمات الأطفال", "الصحة"], ["التعليم", "العناية الشخصية"], ["الترفيه", "الواجبات الاجتماعية"], ["السكن", "أقساط بنكية"]];
const INCOME_CATEGORIES = [["الراتب الشهري", "دخل إضافي"], ["عيدية/هدايا", "استرداد مبلغ"]];

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const userId = msg.from.id.toString();

    if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) return;
    if (!text) return;

    // 🛑 معالجة التأكيد
    if (pendingTransaction) {
        if (text === "✅ نعم، اعتمد") {
            try {
                await axios.post(SHEET_SCRIPT_URL, pendingTransaction);
                const emoji = pendingTransaction.type === 'income' ? '💰' : '💸';
                bot.sendMessage(chatId, `✅ تم الحفظ: ${pendingTransaction.item} (${pendingTransaction.amount}) - ${pendingTransaction.category} ${emoji}`, { reply_markup: { remove_keyboard: true } });
                pendingTransaction = null;
            } catch (e) { bot.sendMessage(chatId, "❌ خطأ في الحفظ."); }
            return;
        }
        if (text === "❌ لا، إلغاء") {
            bot.sendMessage(chatId, "❌ تم الإلغاء.", { reply_markup: { remove_keyboard: true } });
            pendingTransaction = null;
            return;
        }
        if (text === "🔄 تغيير البند") {
            const cats = pendingTransaction.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
            bot.sendMessage(chatId, "اختر البند:", { reply_markup: { keyboard: [...cats, ["❌ إلغاء"]], one_time_keyboard: true, resize_keyboard: true } });
            pendingTransaction.status = "waiting_category";
            return;
        }
        if (pendingTransaction.status === "waiting_category") {
            if (text === "❌ إلغاء") {
                bot.sendMessage(chatId, "❌ تم الإلغاء.", { reply_markup: { remove_keyboard: true } });
                pendingTransaction = null;
                return;
            }
            pendingTransaction.category = text;
            pendingTransaction.status = "ready";
            bot.sendMessage(chatId, `هل تعتمد: ( *${pendingTransaction.item}* ) بـ ( *${pendingTransaction.amount}* ) في ( *${pendingTransaction.category}* )؟`, { parse_mode: "Markdown", reply_markup: { keyboard: [["✅ نعم، اعتمد"], ["❌ لا، إلغاء"], ["🔄 تغيير البند"]], one_time_keyboard: true, resize_keyboard: true } });
            return;
        }
    }

    // 🔗 طلب الرابط
    if (['رابط', 'موقع', 'داش بورد'].some(k => text.includes(k))) {
        bot.sendMessage(chatId, "https://jwad.onrender.com/");
        return;
    }

    bot.sendChatAction(chatId, 'typing');

    try {
        const intentRes = await openai.chat.completions.create({
            messages: [
                { role: "system", content: `Classify intent JSON {"type":...}: "write" (record money), "read" (ask totals), "chat" (greeting/chat).` },
                { role: "user", content: text }
            ],
            model: "gpt-3.5-turbo"
        });
        const intent = JSON.parse(intentRes.choices[0].message.content.match(/{.*}/s)[0]).type;

        if (intent === "chat") {
            const chatRes = await openai.chat.completions.create({
                messages: [{ role: "system", content: "Friendly assistant. Reply in Arabic." }, { role: "user", content: text }],
                model: "gpt-3.5-turbo"
            });
            bot.sendMessage(chatId, chatRes.choices[0].message.content);
            return;
        }

        if (intent === "write") {
            const extractRes = await openai.chat.completions.create({
                messages: [
                    { role: "system", content: `Extract JSON {"item": string, "amount": number, "category": string, "type": "income"|"expense"}. Default categories: [Expense]: السوبر ماركت... [Income]: الراتب...` },
                    { role: "user", content: text }
                ],
                model: "gpt-3.5-turbo"
            });
            const data = JSON.parse(extractRes.choices[0].message.content.match(/{.*}/s)[0]);
            data.raw_text = text;
            pendingTransaction = data;
            pendingTransaction.status = "ready";
            bot.sendMessage(chatId, `هل تعتمد: ( *${data.item}* ) بـ ( *${data.amount}* ) في ( *${data.category}* )؟`, { parse_mode: "Markdown", reply_markup: { keyboard: [["✅ نعم، اعتمد"], ["❌ لا، إلغاء"], ["🔄 تغيير البند"]], one_time_keyboard: true, resize_keyboard: true } });
        } 
        else if (intent === "read") {
            const sheetRes = await axios.post(SHEET_SCRIPT_URL, { action: "get_data" });
            const totals = sheetRes.data.totals;
            bot.sendMessage(chatId, `📊 *الملخص:*\n📥 الدخل: ${totals.income.toLocaleString()}\n📤 المصروف: ${totals.expense.toLocaleString()}\n💎 الرصيد: ${totals.balance.toLocaleString()}`, { parse_mode: "Markdown" });
        }
    } catch (error) {
        bot.sendMessage(chatId, "⚠️ لم أفهم، حاول مرة أخرى.");
    }
});
