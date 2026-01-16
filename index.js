const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require('openai');
const axios = require('axios');
const express = require('express');

// إنشاء تطبيق Express لإبقاء السيرفر حياً
const app = express();

// ------------------------------------------------------------------
// 1. استدعاء المتغيرات من إعدادات السيرفر (Render Environment Variables)
// ------------------------------------------------------------------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SHEET_SCRIPT_URL = process.env.SHEET_SCRIPT_URL;

// التحقق من وجود المتغيرات (للتنبيه في Logs السيرفر إذا نسيتها)
if (!OPENAI_API_KEY || !SHEET_SCRIPT_URL) {
    console.error("❌ ERROR: Missing Environment Variables! Please add OPENAI_API_KEY and SHEET_SCRIPT_URL in Render settings.");
    process.exit(1);
}

// ------------------------------------------------------------------
// 2. تشغيل سيرفر وهمي (Keep-Alive Server)
// ------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('WhatsApp Expense Bot is Running Securely! 🔒🤖');
});

app.listen(PORT, () => {
    console.log(`🌍 Server is listening on port ${PORT}`);
});

// ------------------------------------------------------------------
// 3. إعداد OpenAI و WhatsApp
// ------------------------------------------------------------------
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './auth_session' }), 
    puppeteer: {
        // هذا السطر مهم جداً ليعمل على Render باستخدام Docker
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ],
    }
});

// ------------------------------------------------------------------
// 4. أحداث البوت
// ------------------------------------------------------------------

client.on('qr', (qr) => {
    console.log('\n=================================================');
    console.log('⚠️  يرجى مسح الكود أدناه لربط الواتساب:');
    qrcode.generate(qr, { small: true });
    console.log('=================================================\n');
});

client.on('ready', () => {
    console.log('✅ البوت جاهز ومتصل بالواتساب بنجاح!');
});

// ------------------------------------------------------------------
// 5. معالجة الرسائل
// ------------------------------------------------------------------
client.on('message', async msg => {
    const text = msg.body;
    
    // كلمات الاستدعاء
    const triggers = ['سجل', 'اشتريت', 'شريت', 'صرفت', 'دفعت', 'تم شراء'];
    const startsWithTrigger = triggers.some(t => text.startsWith(t));

    if (startsWithTrigger) {
        console.log(`📩 معالجة رسالة: ${text}`);

        try {
            // أ) تحليل النص باستخدام GPT
            const completion = await openai.chat.completions.create({
                messages: [
                    { 
                        role: "system", 
                        content: `You are an expense tracker assistant. Extract data from Arabic text into JSON. 
                        Keys: "item" (string), "amount" (number), "category" (string).
                        Categories: Food, Transport, Bills, Shopping, Work, Other.
                        If currency is missing, assume SAR. Return JSON ONLY inside curly braces.` 
                    },
                    { role: "user", content: `Extract from: "${text}"` }
                ],
                model: "gpt-3.5-turbo",
                temperature: 0.3
            });

            // تنظيف النص من أي زيادات (Markdown)
            let gptContent = completion.choices[0].message.content;
            gptContent = gptContent.replace(/```json/g, '').replace(/```/g, '').trim();
            
            const expenseData = JSON.parse(gptContent);
            expenseData.raw_text = text;

            // ب) إرسال البيانات إلى Google Sheet
            await axios.post(SHEET_SCRIPT_URL, expenseData);

            // ج) الرد
            await msg.reply(`✅ *تم التسجيل:*\n📦 البند: ${expenseData.item}\n💰 المبلغ: ${expenseData.amount}\n📂 التصنيف: ${expenseData.category}`);
            console.log("✅ Data saved successfully.");

        } catch (error) {
            console.error("❌ Error processing message:", error);
            // msg.reply('❌ حدث خطأ، حاول مرة أخرى.');
        }
    }
});

client.initialize();
