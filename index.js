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
    console.log('⏰ Sending daily report...');
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
// 📊 2. الداش بورد
// =================================================================
const getDashboardHTML = (totals, records) => {
    const safeRecords = JSON.stringify(records).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `<!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>الميزانية الشخصية</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <style>body{font-family:'Segoe UI',Tahoma,sans-serif;background:#f8f9fa;padding:20px}.card{margin-bottom:20px;border:none;box-shadow:0 2px 4px rgba(0,0,0,0.1)}.val{font-size:1.5rem;font-weight:bold}</style>
    </head>
    <body>
        <div class="container">
            <h2 class="text-center mb-4">لوحة التحكم المالية</h2>
            <div class="row text-center">
                <div class="col-md-4"><div class="card p-3"><div class="text-success">الدخل</div><div class="val">${totals.income.toLocaleString()}</div></div></div>
                <div class="col-md-4"><div class="card p-3"><div class="text-danger">المصروف</div><div class="val">${totals.expense.toLocaleString()}</div></div></div>
                <div class="col-md-4"><div class="card p-3"><div class="text-primary">الرصيد</div><div class="val">${totals.balance.toLocaleString()}</div></div></div>
            </div>
            <div class="card p-3">
                <h5>آخر العمليات</h5>
                <table class="table table-striped">
                    <thead><tr><th>التاريخ</th><th>البند</th><th>التصنيف</th><th>المبلغ</th></tr></thead>
                    <tbody id="tableBody"></tbody>
                </table>
            </div>
        </div>
        <script>
            const data = JSON.parse('${safeRecords}');
            document.getElementById('tableBody').innerHTML = data.slice(-10).reverse().map(i => 
                \`<tr><td>\${i.date}</td><td>\${i.item}</td><td>\${i.category}</td><td style="color:\${i.type==='income'?'green':'red'}">\${i.amount}</td></tr>\`
            ).join('');
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
// 🤖 3. البوت الذكي (الكامل)
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
            bot.sendMessage(chatId, `📊 *الملخص:*\n📥 الدخل: ${totals.income}\n📤 المصروف: ${totals.expense}\n💎 الرصيد: ${totals.balance}`, { parse_mode: "Markdown" });
        }
    } catch (error) {
        bot.sendMessage(chatId, "⚠️ لم أفهم، حاول مرة أخرى.");
    }
});
