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

// ⏰ 1. التقرير اليومي
cron.schedule('0 6 * * *', async () => {
    if (!ALLOWED_USER_ID) return;
    try {
        const sheetRes = await axios.post(SHEET_SCRIPT_URL, { action: "get_data" });
        const totals = sheetRes.data.totals;
        bot.sendMessage(ALLOWED_USER_ID, `☀️ *تقريرك الصباحي:*\n📥 دخل: ${totals.income}\n📤 صرف: ${totals.expense}\n💎 رصيد: ${totals.balance}`, { parse_mode: "Markdown" });
    } catch (e) { console.error(e); }
}, { timezone: "Asia/Riyadh" });

// 📊 2. الداش بورد
const getDashboardHTML = (totals, records) => {
    const safeRecords = JSON.stringify(records).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><title>محفظتي</title></head><body class="bg-light p-3"><div class="card p-3 mb-3 text-center"><h1>💎 ${totals.balance.toLocaleString()}</h1><div class="row"><div class="col text-success">📥 ${totals.income.toLocaleString()}</div><div class="col text-danger">📤 ${totals.expense.toLocaleString()}</div></div></div><div class="card p-3 mb-3"><canvas id="chart"></canvas></div><ul class="list-group" id="list"></ul><script>const d=${safeRecords};const cats={};d.forEach(r=>{if(r.type==='expense')cats[r.category]=(cats[r.category]||0)+r.amount});new Chart(document.getElementById('chart'),{type:'doughnut',data:{labels:Object.keys(cats),datasets:[{data:Object.values(cats)}]}});document.getElementById('list').innerHTML=d.slice(-20).reverse().map(i=>\`<li class="list-group-item d-flex justify-content-between"><span>\${i.item} <small class="text-muted">\${i.category}</small></span><span class="\${i.type=='income'?'text-success':'text-danger'} fw-bold">\${i.amount}</span></li>\`).join('')</script></body></html>`;
};

app.get('/', async (req, res) => {
    try {
        const response = await axios.post(SHEET_SCRIPT_URL, { action: "get_data" });
        res.send(getDashboardHTML(response.data.totals, response.data.records));
    } catch (error) { res.send(error.message); }
});
app.listen(3000, () => console.log(`Server started`));

// =================================================================
// 🤖 3. المستشار المالي الذكي (The Financial Advisor)
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

    // 🛑 أزرار التأكيد (الأولوية القصوى)
    if (pendingTransaction) {
        if (text === "✅ نعم، اعتمد") {
            try {
                await axios.post(SHEET_SCRIPT_URL, pendingTransaction);
                const emoji = pendingTransaction.type === 'income' ? '💰' : '💸';
                bot.sendMessage(chatId, `✅ تم الحفظ: ${pendingTransaction.item} (${pendingTransaction.amount}) في ${pendingTransaction.category} ${emoji}`, { reply_markup: { remove_keyboard: true } });
                pendingTransaction = null;
            } catch (e) { bot.sendMessage(chatId, "❌ خطأ تقني في الحفظ."); }
            return;
        }
        if (text === "❌ لا، إلغاء") {
            bot.sendMessage(chatId, "❌ تم الإلغاء.", { reply_markup: { remove_keyboard: true } });
            pendingTransaction = null;
            return;
        }
        if (text === "🔄 تغيير البند") {
            const cats = pendingTransaction.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
            bot.sendMessage(chatId, "اختر البند الصحيح:", { reply_markup: { keyboard: [...cats, ["❌ إلغاء"]], one_time_keyboard: true, resize_keyboard: true } });
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
            bot.sendMessage(chatId, `تعتمد: *${pendingTransaction.item}* (${pendingTransaction.amount}) في *${pendingTransaction.category}*؟`, { parse_mode: "Markdown", reply_markup: { keyboard: [["✅ نعم، اعتمد"], ["❌ لا، إلغاء"], ["🔄 تغيير البند"]], one_time_keyboard: true, resize_keyboard: true } });
            return;
        }
    }

    // 🔗 طلب الرابط السريع
    if (['رابط', 'موقع', 'داش بورد'].some(k => text.includes(k))) {
        bot.sendMessage(chatId, "https://jwad.onrender.com/");
        return;
    }

    bot.sendChatAction(chatId, 'typing');

    try {
        // 1. جلب البيانات المالية أولاً (لإعطاء البوت "عيون")
        const sheetRes = await axios.post(SHEET_SCRIPT_URL, { action: "get_data" });
        const totals = sheetRes.data.totals;
        const recentRecords = sheetRes.data.records.slice(-10); // آخر 10 عمليات لرؤية السياق

        // 2. هندسة الأمر (The Super Prompt)
        // نطلب من الذكاء الاصطناعي شيئين في نفس الوقت: رد نصي + استخراج بيانات إن وجدت
        const systemPrompt = `
        أنت مساعد مالي شخصي ذكي للمستخدم "جواد".
        
        📊 **الوضع المالي الحالي لجواد:**
        - الدخل: ${totals.income}
        - المصروف: ${totals.expense}
        - الرصيد المتبقي: ${totals.balance}
        - آخر العمليات: ${JSON.stringify(recentRecords)}

        🎯 **المطلوب منك:**
        1. تحليل رسالة جواد والرد عليها بأسلوب محاسب ناصح وودود (باللهجة العربية).
        2. إذا كان جواد يطلب نصيحة أو تحليل، استخدم الأرقام أعلاه لتقديم نصيحة دقيقة (مثلاً حذره إذا الرصيد منخفض).
        3. **الأهم:** إذا ذكر جواد عملية مالية (شراء، صرف، راتب) في وسط الكلام، يجب أن تستخرجها لتقييدها.

        📤 **صيغة الرد (JSON فقط):**
        {
            "reply": "نص الرد الذي سيظهر لجواد (نصيحة، رد على سواليف، تحليل...)",
            "transaction": { "item": "اسم البند", "amount": 0, "category": "التصنيف المقترح", "type": "income أو expense" } OR null
        }

        ملاحظات للتصنيف:
        - المصاريف: السوبر ماركت، المطاعم والكافيهات، النقل والمواصلات، الفواتير، الصحة، التعليم، السكن.
        - الدخل: الراتب الشهري، دخل إضافي.
        `;

        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: text }
            ],
            model: "gpt-3.5-turbo"
        });

        // استخراج الرد
        const rawContent = completion.choices[0].message.content;
        // تنظيف الرد تحسباً لأي زوائد
        const jsonStr = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
        const response = JSON.parse(jsonStr);

        // 3. الخطوة الأولى: إرسال الرد النصي (النصيحة/السواليف)
        if (response.reply) {
            await bot.sendMessage(chatId, response.reply);
        }

        // 4. الخطوة الثانية: إذا وجد عملية مالية، تفعيل وضع التأكيد
        if (response.transaction && response.transaction.amount > 0) {
            pendingTransaction = response.transaction;
            pendingTransaction.status = "ready";
            pendingTransaction.raw_text = text;

            const msgText = `💡 *اقتراح تقييد:*
هل أعتمد تسجيل ( *${pendingTransaction.item}* ) بمبلغ ( *${pendingTransaction.amount}* ) في بند ( *${pendingTransaction.category}* )؟`;
            
            // تأخير بسيط جداً لترتيب الرسائل
            setTimeout(() => {
                bot.sendMessage(chatId, msgText, { 
                    parse_mode: "Markdown", 
                    reply_markup: { 
                        keyboard: [["✅ نعم، اعتمد"], ["❌ لا، إلغاء"], ["🔄 تغيير البند"]], 
                        one_time_keyboard: true, 
                        resize_keyboard: true 
                    } 
                });
            }, 500);
        }

    } catch (error) {
        console.error("AI Error:", error);
        bot.sendMessage(chatId, "⚠️ حدث خطأ في الفهم، ممكن تعيد الصياغة؟");
    }
});
