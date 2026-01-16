const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode'); // مكتبة تحويل الكود لصورة
const { OpenAI } = require('openai');
const axios = require('axios');
const express = require('express');

const app = express();

// متغير لتخزين صورة الباركود
let qrCodeImage = null;
let isConnected = false;

// 1. استدعاء المتغيرات
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SHEET_SCRIPT_URL = process.env.SHEET_SCRIPT_URL;

if (!OPENAI_API_KEY || !SHEET_SCRIPT_URL) {
    console.error("❌ ERROR: Missing Keys in Render!");
    process.exit(1);
}

// 2. إعداد صفحة الويب لعرض الباركود
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    if (isConnected) {
        res.send('<h1>✅ البوت متصل ويعمل بنجاح!</h1>');
    } else if (qrCodeImage) {
        // عرض الصورة في وسط الشاشة
        res.send(`
            <div style="text-align:center; padding-top:50px;">
                <h1>امسح الكود لربط الواتساب</h1>
                <img src="${qrCodeImage}" alt="QR Code" style="width:300px; border:2px solid #333;"/>
                <p>تحديث الصفحة إذا لم يظهر الكود</p>
            </div>
        `);
    } else {
        res.send('<h1>⏳ جاري تشغيل البوت... انتظر دقيقة وحدث الصفحة.</h1>');
    }
});

app.listen(PORT, () => console.log(`🌍 Server running on port ${PORT}`));

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

// عند إنشاء كود الربط، نحوله لصورة
client.on('qr', (qr) => {
    console.log('QR Generated');
    qrcode.toDataURL(qr, (err, url) => {
        if (!err) {
            qrCodeImage = url; // حفظ الصورة لعرضها في المتصفح
        }
    });
});

client.on('ready', () => {
    console.log('✅ WhatsApp Ready!');
    isConnected = true;
    qrCodeImage = null; // إخفاء الكود بعد الربط
});

// 5. معالجة الرسائل
client.on('message', async msg => {
    const text = msg.body;
    const triggers = ['سجل', 'اشتريت', 'شريت', 'صرفت', 'دفعت'];
    
    if (triggers.some(t => text.startsWith(t))) {
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
