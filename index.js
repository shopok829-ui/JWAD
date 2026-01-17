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
// 🎨 نظام الداش بورد (Dashboard System)
// =================================================================

// دالة لتوليد كود HTML للداش بورد
const getDashboardHTML = (records) => {
    // حساب الإحصائيات للجافاسكربت
    const categories = {};
    let totalSpent = 0;

    records.forEach(r => {
        if (!r.amount) return;
        totalSpent += r.amount;
        if (categories[r.category]) {
            categories[r.category] += r.amount;
        } else {
            categories[r.category] = r.amount;
        }
    });

    const categoryLabels = Object.keys(categories);
    const categoryData = Object.values(categories);

    return `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>لوحة تحكم مصاريف جواد</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f9; color: #333; margin: 0; padding: 20px; }
            .container { max-width: 800px; margin: 0 auto; }
            .card { background: white; padding: 20px; border-radius: 15px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); margin-bottom: 20px; text-align: center; }
            h1 { color: #2c3e50; }
            .total-box { font-size: 2.5em; color: #27ae60; font-weight: bold; }
            .chart-container { position: relative; height: 300px; width: 100%; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { padding: 10px; border-bottom: 1px solid #ddd; text-align: right; }
            th { background-color: #f8f9fa; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>📊 لوحة تحكم المصاريف</h1>
            
            <div class="card">
                <h3>إجمالي المصروفات</h3>
                <div class="total-box">${totalSpent.toLocaleString()} ريال</div>
            </div>

            <div class="card">
                <h3>توزيع المصاريف حسب الفئة</h3>
                <div class="chart-container">
                    <canvas id="categoryChart"></canvas>
                </div>
            </div>

            <div class="card">
                <h3>آخر 5 عمليات</h3>
                <table>
                    <thead><tr><th>البند</th><th>المبلغ</th><th>التاريخ</th></tr></thead>
                    <tbody>
                        ${records.slice(-5).reverse().map(r => `<tr><td>${r.item}</td><td>${r.amount}</td><td>${r.date}</td></tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <script>
            const ctx = document.getElementById('categoryChart').getContext('2d');
            new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ${JSON.stringify(categoryLabels)},
                    datasets: [{
                        data: ${JSON.stringify(categoryData)},
                        backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'],
                        borderWidth: 1
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        </script>
    </body>
    </html>
    `;
};

// الراوت الرئيسي: يعرض الداش بورد
app.get('/', async (req, res) => {
    try {
        // جلب البيانات من الشيت
        const response = await axios.post(SHEET_SCRIPT_URL, { action: "get_data" });
        const records = response.data.records || [];
        
        // إرسال صفحة الويب
        res.send(getDashboardHTML(records));
    } catch (error) {
        res.send(`<h1>حدث خطأ أثناء جلب البيانات: ${error.message}</h1>`);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));

// =================================================================
// 🤖 كود البوت (AI Accountant)
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
        // 1. تصنيف النية
        const intentCheck = await openai.chat.completions.create({
            messages: [
                { role: "system", content: `Classify intent: {"type": "write"} for recording expenses, {"type": "read"} for questions/analysis. Return JSON.` },
                { role: "user", content: text }
            ],
            model: "gpt-3.5-turbo",
        });

        const intent = JSON.parse(intentCheck.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim()).type;

        // 2. التنفيذ
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
            // جلب البيانات للتحليل (نفس البيانات المستخدمة في الداش بورد)
            const sheetResponse = await axios.post(SHEET_SCRIPT_URL, { action: "get_data" });
            const records = sheetResponse.data.records || [];
            
            // تحويل البيانات لنص بسيط ليفهمه GPT
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
