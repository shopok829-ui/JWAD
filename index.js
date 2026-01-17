const TelegramBot = require('node-telegram-bot-api');
const { OpenAI } = require('openai');
const axios = require('axios');
const express = require('express');

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
// 📊 نظام الداش بورد المحاسبي (Balance Sheet Style)
// =================================================================

const getDashboardHTML = (records) => {
    const safeRecords = JSON.stringify(records).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    return `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>الميزانية الشخصية 💰</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;800&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Tajawal', sans-serif; background-color: #f0f2f5; }
            .header-gradient { background: linear-gradient(135deg, #134E5E, #71B280); color: white; padding: 2rem 0; border-radius: 0 0 25px 25px; margin-bottom: 2rem; }
            .card { border: none; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
            .balance-card { background: #fff; border-right: 5px solid; }
            .metric-title { font-size: 0.9rem; color: #6c757d; }
            .metric-value { font-size: 1.8rem; font-weight: 800; }
            .text-income { color: #198754; }  /* أخضر للدخل */
            .text-expense { color: #dc3545; } /* أحمر للصرف */
            .text-balance { color: #0d6efd; } /* أزرق للرصيد */
        </style>
    </head>
    <body>
        <div class="header-gradient text-center">
            <div class="container">
                <h1>💰 الميزانية الشخصية</h1>
                <p class="opacity-75">مراقبة الدخل والمصروفات وصافي الرصيد</p>
                <div class="btn-group mt-3" role="group">
                    <button onclick="filterData('all')" class="btn btn-light active" id="btn-all">الكل</button>
                    <button onclick="filterData('month')" class="btn btn-outline-light" id="btn-month">هذا الشهر</button>
                </div>
            </div>
        </div>

        <div class="container mb-5">
            <div class="row g-3 mb-4">
                <div class="col-md-4">
                    <div class="card p-4 balance-card" style="border-color: #198754;">
                        <span class="metric-title">📥 إجمالي الدخل</span>
                        <div class="metric-value text-income" id="incomeDisplay">0</div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="card p-4 balance-card" style="border-color: #dc3545;">
                        <span class="metric-title">📤 إجمالي المصروفات</span>
                        <div class="metric-value text-expense" id="expenseDisplay">0</div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="card p-4 balance-card" style="border-color: #0d6efd;">
                        <span class="metric-title">💎 صافي الرصيد (المتبقي)</span>
                        <div class="metric-value text-balance" id="balanceDisplay">0</div>
                    </div>
                </div>
            </div>

            <div class="row g-3 mb-4">
                <div class="col-md-8">
                    <div class="card p-3">
                        <h5>تحليل المصروفات (أين تذهب أموالك؟)</h5>
                        <div style="height: 300px;"><canvas id="expenseChart"></canvas></div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="card p-3">
                        <h5>نسبة الصرف من الدخل</h5>
                        <div style="height: 300px;"><canvas id="ratioChart"></canvas></div>
                    </div>
                </div>
            </div>

            <div class="card p-3">
                <h5>📝 سجل العمليات الأخيرة</h5>
                <div class="table-responsive">
                    <table class="table table-hover align-middle">
                        <thead class="table-light"><tr><th>التاريخ</th><th>البند</th><th>التصنيف</th><th>المبلغ</th></tr></thead>
                        <tbody id="transactionsTable"></tbody>
                    </table>
                </div>
            </div>
        </div>

        <script>
            const rawData = JSON.parse("${safeRecords}");
            let expenseChartInst = null; let ratioChartInst = null;
            
            const processedData = rawData.map(item => {
                const parts = item.date.split('/');
                return { ...item, dateObj: new Date(parts[2], parts[1]-1, parts[0]) };
            });

            function filterData(type) {
                document.getElementById('btn-all').className = 'btn btn-outline-light';
                document.getElementById('btn-month').className = 'btn btn-outline-light';
                document.getElementById('btn-'+type).className = 'btn btn-light active';

                const now = new Date();
                let filtered = processedData;
                
                if(type === 'month') {
                    filtered = processedData.filter(d => d.dateObj.getMonth() === now.getMonth() && d.dateObj.getFullYear() === now.getFullYear());
                }
                
                updateUI(filtered);
            }

            function updateUI(data) {
                // 1. الحسابات
                let totalIncome = 0;
                let totalExpense = 0;
                const expenseCats = {};

                data.forEach(i => {
                    if (i.type === 'income') {
                        totalIncome += i.amount;
                    } else {
                        totalExpense += i.amount;
                        expenseCats[i.category] = (expenseCats[i.category] || 0) + i.amount;
                    }
                });

                const balance = totalIncome - totalExpense;

                // 2. تحديث الأرقام
                document.getElementById('incomeDisplay').innerText = totalIncome.toLocaleString() + ' ر.س';
                document.getElementById('expenseDisplay').innerText = totalExpense.toLocaleString() + ' ر.س';
                document.getElementById('balanceDisplay').innerText = balance.toLocaleString() + ' ر.س';

                // 3. تحديث الجدول
                document.getElementById('transactionsTable').innerHTML = data.slice(-10).reverse().map(i => {
                    const color = i.type === 'income' ? 'text-success' : 'text-danger';
                    const sign = i.type === 'income' ? '+' : '-';
                    return \`<tr>
                        <td>\${i.date}</td>
                        <td class="fw-bold">\${i.item}</td>
                        <td><span class="badge bg-secondary">\${i.category}</span></td>
                        <td class="\${color} fw-bold" dir="ltr">\${sign}\${i.amount}</td>
                    </tr>\`;
                }).join('');

                // 4. الرسم البياني (توزيع المصاريف)
                if(expenseChartInst) expenseChartInst.destroy();
                expenseChartInst = new Chart(document.getElementById('expenseChart'), {
                    type: 'bar',
                    data: {
                        labels: Object.keys(expenseCats),
                        datasets: [{
                            label: 'المبلغ',
                            data: Object.values(expenseCats),
                            backgroundColor: '#dc3545',
                            borderRadius: 5
                        }]
                    },
                    options: { indexAxis: 'y', maintainAspectRatio: false }
                });

                // 5. الرسم البياني (الدخل vs الصرف)
                if(ratioChartInst) ratioChartInst.destroy();
                ratioChartInst = new Chart(document.getElementById('ratioChart'), {
                    type: 'doughnut',
                    data: {
                        labels: ['المصروفات', 'المتبقي'],
                        datasets: [{
                            data: [totalExpense, Math.max(0, balance)],
                            backgroundColor: ['#dc3545', '#198754']
                        }]
                    },
                    options: { maintainAspectRatio: false }
                });
            }

            filterData('all');
        </script>
    </body>
    </html>
    `;
};

// الراوت
app.get('/', async (req, res) => {
    try {
        const response = await axios.post(SHEET_SCRIPT_URL, { action: "get_data" });
        const records = response.data.records || [];
        res.send(getDashboardHTML(records));
    } catch (error) {
        res.send(`<h1>Error: ${error.message}</h1>`);
    }
});

app.listen(3000, () => console.log(`Server started`));

// =================================================================
// 🤖 البوت الذكي (النسخة المحاسبية)
// =================================================================

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
let pendingTransaction = null; 

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const userId = msg.from.id.toString();

    if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) return;
    if (!text) return;

    // معالجة الردود المعلقة
    if (pendingTransaction) {
        const chosenCategory = text.trim();
        const finalData = { ...pendingTransaction, category: chosenCategory }; // دمج البيانات
        
        bot.sendMessage(chatId, `🔄 تم اعتماد: *${chosenCategory}*`, { parse_mode: 'Markdown' });
        try {
            await axios.post(SHEET_SCRIPT_URL, finalData);
            const emoji = finalData.type === 'income' ? '💰' : '💸';
            bot.sendMessage(chatId, `✅ *تم التقييد:* ${finalData.item} (${finalData.amount}) - ${finalData.category} ${emoji}`, { parse_mode: 'Markdown' });
            pendingTransaction = null; 
        } catch (error) {
            bot.sendMessage(chatId, "❌ خطأ في الحفظ.");
        }
        return;
    }

    bot.sendChatAction(chatId, 'typing');

    try {
        // 1. تحديد النية (تسجيل أم قراءة)
        const intentCheck = await openai.chat.completions.create({
            messages: [
                { role: "system", content: `Classify intent: 
                - "write": recording transaction (expense OR income).
                - "read": asking about balance, total, history.
                Return JSON: {"type": "write"} OR {"type": "read"}` },
                { role: "user", content: text }
            ],
            model: "gpt-3.5-turbo",
        });
        const intent = JSON.parse(intentCheck.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim()).type;

        if (intent === "write") {
            const extraction = await openai.chat.completions.create({
                messages: [
                    { 
                        role: "system", 
                        content: `Extract transaction data into JSON: 
                        {"item": string, "amount": number, "category": string, "type": "income" | "expense"}.
                        
                        STEP 1: Determine TYPE.
                        - INCOME keywords: "راتب", "نزل", "تحويل لي", "إيداع", "مكافأة", "دخل", "salary", "deposit".
                        - EXPENSE keywords: "شريت", "دفعت", "سوبرماركت", "فاتورة", "بنزين", "spent", "paid".

                        STEP 2: Determine CATEGORY based on TYPE.
                        
                        [IF TYPE = "expense"]: Use your previous expense categories:
                        (السكن, الفواتير, السوبر ماركت, المطاعم, النقل, الصحة, الترفيه, ...etc).

                        [IF TYPE = "income"]: Use these categories:
                        - "الراتب الشهري"
                        - "دخل إضافي"
                        - "عيدية/هدايا"
                        - "استرداد مبلغ"
                        - "تحويلات واردة"

                        STEP 3: Ambiguity Check.
                        If item is ambiguous (e.g. "Transfer 500" - could be in or out?), set category to "ASK_USER" and type to "expense" (default).

                        Return JSON ONLY.` 
                    },
                    { role: "user", content: text }
                ],
                model: "gpt-3.5-turbo",
            });
            const data = JSON.parse(extraction.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim());
            data.raw_text = text;

            if (data.category === "ASK_USER") {
                pendingTransaction = { item: data.item, amount: data.amount, raw_text: text, type: data.type };
                bot.sendMessage(chatId, `❓ *توضيح مطلوب:* ما تصنيف "${data.item}" (${data.amount})؟`, { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ["السوبر ماركت", "المطاعم والكافيهات"],
                            ["الراتب الشهري", "دخل إضافي"], // خيارات دخل وصرف
                            ["النقل والمواصلات", "الفواتير الخدمية"],
                            ["إلغاء"]
                        ],
                        one_time_keyboard: true, resize_keyboard: true
                    }
                });
                return;
            }

            await axios.post(SHEET_SCRIPT_URL, data);
            const emoji = data.type === 'income' ? '💰' : '💸';
            bot.sendMessage(chatId, `✅ *تم التقييد:* ${data.item} (${data.amount} ريال)\n🏷️ ${data.category} ${emoji}`, { parse_mode: 'Markdown' });

        } else {
            // القراءة والتحليل
            const sheetResponse = await axios.post(SHEET_SCRIPT_URL, { action: "get_data" });
            const records = sheetResponse.data.records || [];
            
            // تجهيز ملخص مالي لـ GPT
            let totalIncome = 0; let totalExpense = 0;
            records.forEach(r => {
                if(r.type === 'income') totalIncome += r.amount;
                else totalExpense += r.amount;
            });
            const balance = totalIncome - totalExpense;

            const analysis = await openai.chat.completions.create({
                messages: [
                    { 
                        role: "system", 
                        content: `Financial accountant. 
                        Summary: Total Income=${totalIncome}, Total Expense=${totalExpense}, Balance=${balance}.
                        Recent Data: ${JSON.stringify(records.slice(-20))}
                        
                        User Question: "${text}"
                        Answer in Arabic. Explain the balance situation.` 
                    },
                    { role: "user", content: text }
                ],
                model: "gpt-3.5-turbo",
            });
            bot.sendMessage(chatId, analysis.choices[0].message.content);
        }

    } catch (error) {
        console.error(error);
        pendingTransaction = null;
        bot.sendMessage(chatId, "⚠️ خطأ بسيط.");
    }
});
