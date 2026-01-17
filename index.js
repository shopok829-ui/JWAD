const TelegramBot = require('node-telegram-bot-api');
const { OpenAI } = require('openai');
const axios = require('axios');
const express = require('express');

const app = express();

// المتغيرات البيئية
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SHEET_SCRIPT_URL = process.env.SHEET_SCRIPT_URL;
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID;

// التحقق من المتغيرات
if (!TELEGRAM_TOKEN || !OPENAI_API_KEY || !SHEET_SCRIPT_URL) {
    console.error("❌ Error: Missing Environment Variables!");
    process.exit(1);
}

// سيرفر Render
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('AI Accountant Bot is Running 🧠💰'));
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));

// إعداد البوت
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

console.log('✅ Bot is ready to serve...');

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const userId = msg.from.id.toString();

    // 1. حماية البوت
    if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) return;
    if (!text) return;

    // إشعار بالكتابة
    bot.sendChatAction(chatId, 'typing');

    try {
        // 🧠 المرحلة الأولى: الفهم (التوجيه)
        // نسأل GPT: ماذا يريد المستخدم؟ تسجيل (write) أم تحليل وسواليف (read)؟
        const intentCheck = await openai.chat.completions.create({
            messages: [
                { 
                    role: "system", 
                    content: `You are a router. Classify the user input into one of two JSON outputs:
                    1. If the user wants to ADD/RECORD a transaction: {"type": "write"}
                    2. If the user asks a question, wants a summary, analysis, or checks totals: {"type": "read"}
                    
                    Input: "سجل 50 ريال عشاء" -> Output: {"type": "write"}
                    Input: "شريت بنزين" -> Output: {"type": "write"}
                    Input: "كم صرفت؟" -> Output: {"type": "read"}
                    Input: "وش اكثر شي صرفت عليه؟" -> Output: {"type": "read"}
                    Input: "كم باقي معي؟" -> Output: {"type": "read"}
                    Input: "تحليل لمصاريفي" -> Output: {"type": "read"}
                    
                    Return JSON ONLY.` 
                },
                { role: "user", content: text }
            ],
            model: "gpt-3.5-turbo",
            temperature: 0.1 // دقة عالية، إبداع قليل في التصنيف
        });

        const intentJson = intentCheck.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
        const intent = JSON.parse(intentJson).type;

        // =========================================================
        // 📝 المسار الأول: التسجيل (الكتابة في الشيت)
        // =========================================================
        if (intent === "write") {
            const extraction = await openai.chat.completions.create({
                messages: [
                    { 
                        role: "system", 
                        content: `You are a data extractor. Extract expense details into JSON: 
                        {"item": string, "amount": number, "category": string}.
                        Categories: Food, Transport, Bills, Shopping, Groceries, Other.
                        If currency is missing, assume it is local. Return JSON ONLY.` 
                    },
                    { role: "user", content: text }
                ],
                model: "gpt-3.5-turbo",
            });

            const data = JSON.parse(extraction.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim());
            data.raw_text = text;

            // الحفظ في الشيت
            await axios.post(SHEET_SCRIPT_URL, data);
            
            // الرد
            bot.sendMessage(chatId, `✅ *تم تقييد العملية:*\n📦 البند: ${data.item}\n💸 المبلغ: ${data.amount}\n📂 التصنيف: ${data.category}`, { parse_mode: 'Markdown' });
        } 
        
        // =========================================================
        // 📊 المسار الثاني: المحاسب الذكي (قراءة وتحليل)
        // =========================================================
        else {
            bot.sendMessage(chatId, "🧐 دقيقة أراجع الدفاتر...");

            // 1. جلب البيانات من الشيت
            const sheetResponse = await axios.post(SHEET_SCRIPT_URL, { action: "get_data" });
            const records = sheetResponse.data.records;

            if (!records || records.length === 0) {
                bot.sendMessage(chatId, "📭 سجلك نظيف! لا توجد بيانات مسجلة حتى الآن.");
                return;
            }

            // 2. إعطاء البيانات + سؤالك لـ GPT ليجيب
            const analysis = await openai.chat.completions.create({
                messages: [
                    { 
                        role: "system", 
                        content: `You are a smart financial accountant named "Jawad's Assistant".
                        I will give you a list of recent transactions.
                        You must answer the user's question based strictly on this data.
                        
                        - You can calculate totals.
                        - You can find the highest spending category.
                        - You can give advice if asked.
                        - Reply in a friendly Arabic tone.
                        
                        Data:
                        ${JSON.stringify(records)}` 
                    },
                    { role: "user", content: text }
                ],
                model: "gpt-3.5-turbo", // أو gpt-4o-mini إذا توفرت
            });

            // إرسال رد المحاسب
            bot.sendMessage(chatId, analysis.choices[0].message.content);
        }

    } catch (error) {
        console.error("Error:", error);
        bot.sendMessage(chatId, "⚠️ حدث خطأ بسيط، حاول صياغة الجملة بشكل آخر.");
    }
});
