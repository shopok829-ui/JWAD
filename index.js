const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require('openai');
const axios = require('axios');
const express = require('express');

const app = express();

// 1. استدعاء المتغيرات من إعدادات Render
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SHEET_SCRIPT_URL = process.env.SHEET_SCRIPT_URL;

// التحقق من المتغيرات
if (!OPENAI_API_KEY || !SHEET_SCRIPT_URL) {
    console.error("❌ ERROR: Missing Environment Variables! Check Render Settings.");
    process.exit(1);
}

// 2. سيرفر لإبقاء البوت حياً
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is Running 🤖'));
app.listen(PORT, () => console.log(`🌍 Server port: ${PORT}`));

// 3. إعداد OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// 4. إعداد الواتساب
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './auth_session' }),
    puppeteer: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    }
});

client.on('qr', (qr) => {
    console.log('\n=================================================');
    console.log('⚠️  SCAN THIS QR CODE:');
    qrcode.generate(qr, { small: true });
    console.log('=================================================\n');
});

client.on('ready', () => console.log('✅ WhatsApp Ready!'));

// 5. معالجة الرسائل
client.on('message', async msg => {
    const text = msg.body;
    const triggers = ['سجل', 'اشتريت', 'شريت', 'صرفت', 'دفعت'];
    
    if (triggers.some(t => text.startsWith(t))) {
        console.log(`📩 Processing: ${text}`);
        try {
            const gptResponse = await openai.chat.completions.create({
                messages: [
                    { role: "system", content: 'Extract JSON: {"item":string, "amount":number, "category":string}. If currency missing assume SAR.' },
                    { role: "user", content: `Extract from: "${text}"` }
                ],
                model: "gpt-3.5-turbo",
            });

            let content = gptResponse.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
            const data = JSON.parse(content);
            data.raw_text = text;

            await axios.post(SHEET_SCRIPT_URL, data);
            await msg.reply(`✅ تم التسجيل: ${data.item} (${data.amount})`);

        } catch (error) {
            console.error("Error:", error);
        }
    }
});

client.initialize();
