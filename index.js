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

const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is Running...'));
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

let pendingTransaction = null; 

console.log('✅ Bot is ready...');

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const userId = msg.from.id.toString();

    if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) return;
    if (!text) return;

    // معالجة الرد على التوضيح (إذا كان معلقاً)
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
            bot.sendMessage(chatId, `✅ *تم التقييد:*\n📦 ${finalData.item}\n💸 ${finalData.amount} ريال\n🏷️ ${finalData.category}`, { parse_mode: 'Markdown' });
            pendingTransaction = null; 
        } catch (error) {
            bot.sendMessage(chatId, "❌ خطأ في الحفظ.");
        }
        return;
    }

    bot.sendChatAction(chatId, 'typing');

    try {
        // 1. تحديد النية
        const intentCheck = await openai.chat.completions.create({
            messages: [
                { role: "system", content: `Classify intent: {"type": "write"} for expenses, {"type": "read"} for questions. Return JSON.` },
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
                        content: `You are an intelligent accountant. Extract expense data into JSON: 
                        {"item": string, "amount": number, "category": string}.
                        
                        CATEGORIES:
                        - "السكن", "الفواتير الخدمية", "الاتصالات والإنترنت", "التعليم", "العمالة المنزلية", "الأقساط البنكية"
                        - "السوبر ماركت", "النقل والمواصلات", "الصحة", "مستلزمات الأطفال"
                        - "المطاعم والكافيهات", "الترفيه", "العناية الشخصية", "الواجبات الاجتماعية"
                        - "الادخار للطوارئ", "الادخار لأهداف مستقبلية", "الاستثمار"

                        🧠 INTELLIGENT GUESSING RULES:
                        1. Try your best to guess the category from the item name.
                           - "Burger", "Pizza", "Coffee", "McDonalds" -> "المطاعم والكافيهات" (Don't ask!)
                           - "Uber", "Petrol", "Gas station" -> "النقل والمواصلات" (Don't ask!)
                           - "Pampers", "Milk" -> "مستلزمات الأطفال" (Don't ask!)
                           - "Cinema", "Netflix" -> "الترفيه" (Don't ask!)
                        
                        2. ONLY use "ASK_USER" if the item is COMPLETELY ambiguous with NO context.
                           - "Noon 50" -> "ASK_USER" (Could be toys or food)
                           - "Transfer 500" -> "ASK_USER"
                           - "STC Pay 100" -> "ASK_USER"
                           - "Purchase 50" -> "ASK_USER"
                        
                        Input: "Amazon headphones" -> category: "الترفيه" (Good guess)
                        Input: "Amazon" -> category: "ASK_USER" (Too vague)

                        Return JSON ONLY.` 
                    },
                    { role: "user", content: text }
                ],
                model: "gpt-3.5-turbo",
            });

            const data = JSON.parse(extraction.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim());
            data.raw_text = text;

            // إذا طلب التوضيح
            if (data.category === "ASK_USER") {
                pendingTransaction = { item: data.item, amount: data.amount, raw_text: text };
                
                const msg = `❓ *توضيح مطلوب:* \nما هو تصنيف "${data.item}" (${data.amount} ريال)؟`;
                bot.sendMessage(chatId, msg, { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ["السوبر ماركت", "المطاعم والكافيهات"],
                            ["النقل والمواصلات", "العناية الشخصية"],
                            ["مستلزمات الأطفال", "الواجبات الاجتماعية"],
                            ["الترفيه", "إلغاء"]
                        ],
                        one_time_keyboard: true,
                        resize_keyboard: true
                    }
                });
                return;
            }

            // الحفظ المباشر
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
        bot.sendMessage(chatId, "⚠️ خطأ فني.");
    }
});
