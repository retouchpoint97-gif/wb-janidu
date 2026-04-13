const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

// 🌟 SECURE FIREBASE URL FROM GITHUB SECRETS 🌟
const FIREBASE_URL = process.env.FIREBASE_URL;

const orderStates = {};

// Function to fetch the dynamic API packages or use fallbacks
async function getMenuFromApp() {
    try {
        let data;
        if (FIREBASE_URL) {
            const response = await fetch(`${FIREBASE_URL}/packages.json`).catch(() => null);
            if (response && response.ok) {
                data = await response.json();
            }
        }

        if (!data) {
            return [
                { id: 'w1', name: 'Basic', category: 'Wedding', price: 60000, priceText: '60k' },
                { id: 'w2', name: 'Opal', category: 'Wedding', price: 115000, priceText: '115k' },
                { id: 'w3', name: 'Emerald', category: 'Wedding', price: 145000, priceText: '145k' },
                { id: 'w4', name: 'Jadeite', category: 'Wedding', price: 185000, priceText: '185k' },
                { id: 'p1', name: 'Package 01', category: 'Pre-Shoot', price: 65000, priceText: '65k' },
                { id: 'p2', name: 'Package 02', category: 'Pre-Shoot', price: 35000, priceText: '35k' }
            ];
        }

        // Convert Firebase object into an array
        return Object.keys(data).map(key => ({
            id: key,
            name: data[key].name,
            category: data[key].category || 'Wedding',
            price: data[key].price,
            priceText: data[key].priceText || `${data[key].price / 1000}k`,
            imageUrl: data[key].imageUrl
        }));
    } catch (error) {
        console.error("Failed to fetch packages:", error);
        return [
            { id: 'w1', name: 'Basic', category: 'Wedding', price: 60000, priceText: '60k' },
            { id: 'w2', name: 'Opal', category: 'Wedding', price: 115000, priceText: '115k' },
            { id: 'w3', name: 'Emerald', category: 'Wedding', price: 145000, priceText: '145k' },
            { id: 'w4', name: 'Jadeite', category: 'Wedding', price: 185000, priceText: '185k' },
            { id: 'p1', name: 'Package 01', category: 'Pre-Shoot', price: 65000, priceText: '65k' },
            { id: 'p2', name: 'Package 02', category: 'Pre-Shoot', price: 35000, priceText: '35k' }
        ];
    }
}

async function startBot() {
    if (!FIREBASE_URL) {
        console.log("⚠️ WARNING: FIREBASE_URL is missing! Bot will use fallback static packages.");
    }

    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["S", "K", "1"]
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.clear();
            console.log('\n==================================================');
            console.log('⚠️ QR CODE TOO BIG? CLICK "View raw logs" in top right!');
            console.log('==================================================\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') console.log('✅ Shutter Stories AI IS ONLINE!');
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startBot();
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
        if (msg.key.fromMe) return; // Loop Protection

        const sender = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase();

        console.log(`📩 Query: ${text}`);

        // --- 🛒 STEP 2: FINISH BOOKING & SEND TO ADMIN PANEL ---
        if (orderStates[sender]?.step === 'WAITING_FOR_DETAILS') {
            const customerDetails = text;
            const item = orderStates[sender].item;
            const customerWaNumber = sender.split('@')[0];

            const bookingOrder = {
                userId: "whatsapp_" + customerWaNumber,
                userEmail: "whatsapp@shutterstories.com",
                phone: customerWaNumber,
                details: customerDetails,
                location: { lat: 0, lng: 0 },
                items: [{
                    id: item.id,
                    name: item.name,
                    price: parseFloat(item.price),
                    img: item.imageUrl || "",
                    quantity: 1
                }],
                total: parseFloat(item.price).toFixed(2),
                status: "Pending",
                method: "Bank Transfer / Cash (WhatsApp)",
                timestamp: new Date().toISOString()
            };

            try {
                if (FIREBASE_URL) {
                    await fetch(`${FIREBASE_URL}/bookings.json`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(bookingOrder)
                    });
                }
            } catch (error) {
                console.log("Firebase Error: ", error);
            }

            await sock.sendMessage(sender, { text: `✅ *Booking Request Received!* \n\nThank you! Your request for the *${item.name}* package is being reviewed.\n\n*Total Estimate:* Rs ${item.priceText}\nJanidu will be in touch shortly to confirm and discuss the event.\nWe are excited to capture your moments! 📸` });
            delete orderStates[sender];
            return;
        }

        // --- 🌟 STEP 1: START BOOKING FLOW ---
        if (text.startsWith("book ")) {
            const productRequested = text.replace("book ", "").trim().toLowerCase();
            const currentMenu = await getMenuFromApp();

            // Search the packages
            const matchedItem = currentMenu.find(item => item.name.toLowerCase().includes(productRequested) || item.id.toLowerCase() === productRequested);

            if (!matchedItem) {
                await sock.sendMessage(sender, { text: `❌ Sorry, we couldn't find *${productRequested}* in our packages.\n\nType *packages* to see all available options.` });
                return;
            }

            orderStates[sender] = { step: 'WAITING_FOR_DETAILS', item: matchedItem };

            const captionText = `📸 *Booking Started!* \n\nYou selected: *${matchedItem.name}* (Rs ${matchedItem.priceText})\n\nPlease reply with your *Full Name, Phone Number, Date of Event, and Event Location* (We service Horana and Colombo).`;

            if (matchedItem.imageUrl) {
                await sock.sendMessage(sender, {
                    image: { url: matchedItem.imageUrl },
                    caption: captionText
                });
            } else {
                await sock.sendMessage(sender, { text: captionText });
            }
        }
        else if (text === "book") {
            await sock.sendMessage(sender, { text: "📸 *How to book:* \nPlease type 'book' followed by the package name. \nExample: *book basic*" });
        }

        // --- DYNAMIC PACKAGES FEATURE ---
        else if (text.includes("wedding") || text.includes("package") || text.includes("pre-shoot") || text.includes("price") || text.includes("list")) {
            const currentMenu = await getMenuFromApp();

            if (currentMenu.length === 0) {
                await sock.sendMessage(sender, { text: "Our packages list is currently updating. Please check back soon!" });
                return;
            }

            const weddings = currentMenu.filter(p => p.category === 'Wedding');
            const preshoots = currentMenu.filter(p => p.category === 'Pre-Shoot');

            let message = "📸 *Shutter Stories Packages* 📸\n\n";
            message += "*Wedding Packages:*\n";
            weddings.forEach(item => {
                message += `🔸 ${item.name} - Rs ${item.priceText}\n`;
            });
            message += "\n*Pre-Shoot Packages:*\n";
            preshoots.forEach(item => {
                message += `🔸 ${item.name} - Rs ${item.priceText}\n`;
            });
            message += "\n_Type 'book [package name]' to book your package!_";

            await sock.sendMessage(sender, { text: message });
        }

        // --- GREETINGS ---
        else if (text.includes("hi") || text.includes("hello") || text.includes("hey")) {
            await sock.sendMessage(sender, { text: "👋 *Welcome to Shutter Stories!* \n\nI am your AI Assistant. I can help you book photography sessions with Janidu!\nWe primarily cover *Horana* and *Colombo*.\n\nType *packages* or *wedding* to view our options, or type *book [package]* to start booking!" });
        }
        else if (text.includes("contact") || text.includes("call")) {
            await sock.sendMessage(sender, { text: "📞 *Contact Shutter Stories:* \n\n- *Owner:* Janidu\n- *Locations:* Horana & Colombo\n- *Email:* contact@shutterstories.com" });
        }
        else {
            await sock.sendMessage(sender, { text: "🤔 I didn't quite catch that.\n\nType *packages* to see our packages list, or *book [package]* to book a session!" });
        }
    });
}

startBot().catch(err => console.log("Error: " + err));
