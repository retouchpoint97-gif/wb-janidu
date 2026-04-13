const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fetch = require('node-fetch'); // node-fetch v2 අවශ්‍යයි

// 🔑 CONFIGURATION
const FIREBASE_URL = process.env.FIREBASE_URL;
const GEN_AI_KEY = "AIzaSyD4rPEDQ2Up5IPV5Fdy-N-6agwIpkM9Fic"; // ඔයාගේ Gemini API Key එක

const genAI = new GoogleGenerativeAI(GEN_AI_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const orderStates = {};

// --- 📦 DATA FETCHING ---
async function getMenuFromApp() {
    try {
        let data;
        if (FIREBASE_URL) {
            const response = await fetch(`${FIREBASE_URL}/packages.json`).catch(() => null);
            if (response && response.ok) data = await response.json();
        }
        if (!data) return [
            { id: 'w1', name: 'Basic', category: 'Wedding', price: 60000, priceText: '60k' },
            { id: 'w2', name: 'Opal', category: 'Wedding', price: 115000, priceText: '115k' },
            { id: 'p1', name: 'Package 01', category: 'Pre-Shoot', price: 65000, priceText: '65k' }
        ];
        return Object.keys(data).map(key => ({
            id: key,
            name: data[key].name,
            category: data[key].category || 'Wedding',
            price: data[key].price,
            priceText: data[key].priceText || `${data[key].price / 1000}k`,
            imageUrl: data[key].imageUrl
        }));
    } catch (error) {
        return [];
    }
}

// --- 🚀 MAIN BOT START ---
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ["Shutter Stories", "Chrome", "1.0.0"]
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        if (connection === 'open') console.log('✅ Shutter Stories AI IS ONLINE!');
        if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) startBot();
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const rawText = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const text = rawText.toLowerCase();

        // 1️⃣ BOOKING LOGIC (Static/Fixed)
        if (orderStates[sender]?.step === 'WAITING_FOR_DETAILS') {
            const item = orderStates[sender].item;
            await sock.sendMessage(sender, { text: `✅ *Booking Received!* \n\nThank you! We received details for the *${item.name}* package.\nJanidu will call you soon! 📸` });
            delete orderStates[sender];
            return;
        }

        if (text.startsWith("book ")) {
            const currentMenu = await getMenuFromApp();
            const product = text.replace("book ", "").trim();
            const matchedItem = currentMenu.find(item => item.name.toLowerCase().includes(product));

            if (matchedItem) {
                orderStates[sender] = { step: 'WAITING_FOR_DETAILS', item: matchedItem };
                await sock.sendMessage(sender, { text: `📸 *Booking Started!* \nYou selected: *${matchedItem.name}*\n\nPlease reply with your Name, Date, and Location.` });
                return;
            }
        }

        // 2️⃣ SMART AI LOGIC (Gemini)
        const currentMenu = await getMenuFromApp();
        const menuString = currentMenu.map(p => `${p.name} (${p.category}): Rs ${p.priceText}`).join(", ");

        const systemPrompt = `You are the smart AI assistant for "Shutter Stories Photography", owned by Janidu (Mithun). 
        You are professional and friendly. Respond in Sinhala, Singlish, or English naturally.
        
        Our Packages: ${menuString}
        Locations: Horana and Colombo.
        
        If someone asks for prices, explain our ${menuString}. 
        If someone wants to book, tell them to type "book [package name]".
        If you don't know the answer, tell them Janidu will contact them shortly.
        
        User: ${rawText}`;

        try {
            const result = await model.generateContent(systemPrompt);
            const aiReply = result.response.text();
            await sock.sendMessage(sender, { text: aiReply });
        } catch (e) {
            await sock.sendMessage(sender, { text: "පොඩි දෝෂයක් ආවා. කරුණාකර නැවත උත්සාහ කරන්න." });
        }
    });
}

startBot().catch(err => console.log("Error: " + err));
