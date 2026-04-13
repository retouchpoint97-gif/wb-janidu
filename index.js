const { GoogleGenerativeAI } = require("@google/generative-ai");
const fetch = require('node-fetch');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

// 🔑 API KEY එක මෙතනට පේස්ට් කරන්න
const genAI = new GoogleGenerativeAI("AIzaSyD4rPEDQ2Up5IPV5Fdy-N-6agwIpkM9Fic");
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session_data');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ["Shutter Stories", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log("📸 කරුණාකර මෙම QR එක Scan කරන්න:");
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'open') console.log('✅ Shutter Stories AI IS ONLINE! (Smart Mode Active)');
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startBot();
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "");

        console.log(`📩 ලැබුණු පණිවිඩය: ${text}`);

        // 🧠 AI එකට දෙන පුහුණුව (Instructions)
        const systemPrompt = `You are the smart AI assistant for "Shutter Stories Photography", owned by Janidu (also known as Mithun). 
        You are professional, friendly, and helpful. 
        Respond in a mix of Sinhala/Singlish and English (Natural Sri Lankan style).

        About Shutter Stories:
        - Owner: Janidu (Mithun)
        - Locations: Horana and Colombo.
        - Wedding Packages: Basic (60k), Opal (115k), Emerald (145k), Jadeite (185k).
        - Pre-Shoot Packages: Package 01 (65k), Package 02 (35k).
        - Services: Weddings, Birthdays, Pre-shoots, and Event Photography.

        Rules:
        1. If someone asks for prices, list them clearly.
        2. If someone wants to book, ask for their Name, Date, and Location.
        3. Keep the conversation friendly but professional.
        4. If you don't know something, tell them Janidu will contact them soon.

        User message: ${text}`;

        try {
            const result = await model.generateContent(systemPrompt);
            const aiReply = result.response.text();

            await sock.sendMessage(sender, { text: aiReply });
        } catch (error) {
            console.error("AI Error:", error);
            // AI එකේ අවුලක් වුණොත් සාමාන්‍ය රිප්ලයි එකක් යැවීම
            await sock.sendMessage(sender, { text: "ස්තූතියි පණිවිඩයට. ජනිදු ඉක්මනින්ම ඔබව සම්බන්ධ කරගනීවි." });
        }
    });
}

startBot();
