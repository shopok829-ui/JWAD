const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require('openai');
const axios = require('axios');
const express = require('express');
const app = express();

// --- إعداداتك ---
const OPENAI_API_KEY = 'YOUR_OPENAI_API_KEY_HERE'; // ضع مفتاح OpenAI
const SHEET_SCRIPT_URL = 'YOUR_GOOGLE_SCRIPT_URL_HERE'; // ضع رابط Apps Script الذي نسخته

// إعداد OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// 1. إعداد سيرفر وهمي لإبقاء البوت مستيقظاً في Render
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
    res.send('Bot is running and awake! 🤖');
});
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

// 2. إعداد الواتساب
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: '/opt/render/project/src/.wwebjs_auth' }),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

client.on('qr', (qr) => {
    // في Render سنطبع الكود في الـ Logs
    console.log('QR Code generated. Please scan it from the logs.');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ Whatsapp Bot is Ready!');
});

client.on('message', async msg => {
    const text = msg.body;
    // الكلمات المفتاحية
    if (text.startsWith('سجل') || text.startsWith('شتريت') || text.startsWith('شريت')) {
        
        try {
            // تحليل عبر OpenAI
            const completion = await openai.chat.completions.create({
                messages: [
                    { role: "system", content: "You are a JSON extractor. Output valid JSON only." },
                    { role: "user", content: `Extract (item, amount, category) from: "${text}". If amount is missing put 0. JSON format: {"item":"..","amount":0,"category":".."}` }
                ],
                model: "gpt-3.5-turbo",
            });

            const jsonStr = completion.choices[0].message.content;
            const data = JSON.parse(jsonStr);
            data.raw_text = text;

            // إرسال البيانات لرابط قوقل شيت
            await axios.post(SHEET_SCRIPT_URL, data);

            msg.reply(`✅ تم الحفظ: ${data.item} (${data.amount})`);

        } catch (error) {
            console.error(error);
            msg.reply('❌ حدث خطأ، تأكد من الصيغة.');
        }
    }
});

client.initialize();
