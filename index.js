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
    console.error("❌ Error: Missing Variables!");
    process.exit(1);
}

const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Smart Bot is Active 🧠'));
app.listen(PORT, () => console.log(`🌍 Port: ${PORT}`));

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

console.log('✅ Smart Bot Ready');

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const userId = msg.from.id.toString();

    if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) return;

    if (!text) return;

    bot.sendChatAction(chatId, 'typing');

    try {
        // 🧠 الخطوة 1: فهم النية (Intent Classification)
        // نسأل GPT: هل المستخدم يريد تسجيل مصروف أم يسأل سؤالاً؟
        const intentCheck = await openai.chat.completions.create({
            messages: [
                { 
                    role: "system", 
                    content: `You are a helper. Decide if the user text is adding a new expense OR asking a question about past data.
                    Return JSON ONLY: {"type": "record"} OR {"type": "query"}.
                    Examples:
                    "سجل غداء 20" -> record
                    "شريت قهوة" -> record
                    "كم صرفت؟" -> query
                    "وش وضعي المالي؟" -> query
                    "كم باقي لي؟" -> query`
                },
                { role: "user", content: text }
            ],
            model: "gpt-3.5-turbo",
        });

        const intentJson = intentCheck.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
        const intent = JSON.parse(intentJson).type;

        // ============================================================
        // 📝 مسار 1: المستخدم يريد "تسجيل" مصروف
        // ============================================================
        if (intent === "record") {
            const extraction = await openai.chat.completions.create({
                messages: [
                    { 
                        role: "system", 
                        content: `Extract expense data to JSON: {"item":string, "amount":number, "category":string}. 
                        Categories: Food, Transport, Bills, Shopping, Other. If currency missing assume SAR.` 
                    },
                    { role: "user", content: text }
                ],
                model: "gpt-3.5-turbo",
            });

            const dataContent = extraction.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
            const data = JSON.parse(dataContent);
            data.raw_text = text;

            await axios.post(SHEET_SCRIPT_URL, data);
            bot.sendMessage(chatId, `✅ *تم التسجيل:*\n📦 ${data.item}\n💰 ${data.amount} ريال\n📂 ${data.category}`, { parse_mode: 'Markdown' });
        } 
        
        // ============================================================
        // 🔍 مسار 2: المستخدم يسأل "سؤالاً" (تحليل بيانات)
        // ============================================================
        else {
            bot.sendMessage(chatId, "🧐 لحظة أراجع سجلاتك...");

            // 1. جلب آخر البيانات من الشيت
            const sheetResponse = await axios.post(SHEET_SCRIPT_URL, { action: "get_data" });
            const records = sheetResponse.data.records; // قائمة بآخر العمليات

            if (!records || records.length === 0) {
                bot.sendMessage(chatId, "لا توجد بيانات سابقة لتحليلها.");
                return;
            }

            // 2. إعطاء البيانات لـ GPT ليجيب على سؤالك
            const analysis = await openai.chat.completions.create({
                messages: [
                    { 
                        role: "system", 
                        content: `You are a financial advisor. Here is the user's recent transaction history:\n${JSON.stringify(records)}\n\nAnswer the user's question based strictly on this data. Be helpful, summarize if asked, and calculate totals if needed. Reply in Arabic.` 
                    },
                    { role: "user", content: text }
                ],
                model: "gpt-3.5-turbo",
            });

            bot.sendMessage(chatId, analysis.choices[0].message.content);
        }

    } catch (error) {
        console.error("Error:", error);
        bot.sendMessage(chatId, "❌ حدث خطأ تقني، حاول مرة أخرى.");
    }
});
