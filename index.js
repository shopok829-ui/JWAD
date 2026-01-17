const TelegramBot = require('node-telegram-bot-api');
const { OpenAI } = require('openai');
const axios = require('axios');
const express = require('express');

const app = express();

// 1. استدعاء المتغيرات من Render
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SHEET_SCRIPT_URL = process.env.SHEET_SCRIPT_URL;
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID; 

// التحقق من المتغيرات
if (!TELEGRAM_TOKEN || !OPENAI_API_KEY || !SHEET_SCRIPT_URL) {
    console.error("❌ Error: Missing Environment Variables in Render!");
    process.exit(1);
}

// 2. سيرفر لإبقاء البوت مستيقظاً
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Telegram Bot is Active 🚀'));
app.listen(PORT, () => console.log(`🌍 Server running on port ${PORT}`));

// 3. إعداد البوت والذكاء الاصطناعي
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

console.log('✅ Telegram Bot is up and running...');

// 4. معالجة الرسائل
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const userId = msg.from.id.toString();

    // حماية: تأكد أن المرسل هو جواد فقط
    if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) {
        // يمكنك تفعيل السطر التالي إذا أردت تنبيه الغرباء
        // bot.sendMessage(chatId, "⛔ هذا البوت خاص.");
        return; 
    }

    if (text) {
        // إظهار "جاري الكتابة..."
        bot.sendChatAction(chatId, 'typing');

        try {
            // تحليل النص بـ GPT
            const gptResponse = await openai.chat.completions.create({
                messages: [
                    { 
                        role: "system", 
                        content: `You are an expense tracker. Extract JSON: {"item":string, "amount":number, "category":string}. 
                        Categories: Food, Transport, Bills, Shopping, Work, Other.
                        If currency missing assume SAR. Return JSON ONLY.` 
                    },
                    { role: "user", content: `Extract from: "${text}"` }
                ],
                model: "gpt-3.5-turbo",
            });

            // تنظيف الرد وتحويله لـ JSON
            let content = gptResponse.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
            const data = JSON.parse(content);
            data.raw_text = text;

            // إرسال لـ Google Sheet
            await axios.post(SHEET_SCRIPT_URL, data);

            // الرد عليك
            bot.sendMessage(chatId, `✅ *تم التسجيل:*\n📦 ${data.item}\n💰 ${data.amount} ريال\n📂 ${data.category}`, { parse_mode: 'Markdown' });

        } catch (error) {
            console.error("Error:", error);
            bot.sendMessage(chatId, "❌ لم أتمكن من فهم المصروف، حاول مرة أخرى.");
        }
    }
});
