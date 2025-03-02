const qrcode = require("qrcode-terminal");
const fetch = require("node-fetch");
const fs = require("fs");
const gTTS = require("gtts");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeInMemoryStore
} = require("@whiskeysockets/baileys");

// تخزين بيانات الجلسة
const store = makeInMemoryStore({});
let isRestarting = false;
global.hasSentCommandList = false; // لتجنب تكرار إرسال قائمة الأوامر
const handledMessages = new Set();
const games = {}; // لتخزين الألعاب لكل شات

async function startBot() {
  try {
    console.log("📡 جاري تشغيل البوت...");

    const { state, saveCreds } = await useMultiFileAuthState("auth");
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      syncFullHistory: true
    });

    store.bind(sock.ev);

    sock.ev.on("connection.update", (update) => {
      const { qr, connection, lastDisconnect } = update;

      if (qr) {
        console.log("📸 امسح كود QR باستخدام واتساب ويب:");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "open") {
        console.log("✅ تم الاتصال بنجاح!");
        isRestarting = false;

        // إرسال قائمة الأوامر مرة واحدة فقط عند التشغيل الأول
        if (!global.hasSentCommandList) {
          sendCommandList(sock, sock.user.id);
          global.hasSentCommandList = true;
        }
      }

      if (connection === "close") {
        const reason = lastDisconnect?.error?.output?.statusCode;
        console.log("⚠️ الاتصال مغلق، السبب:", reason);

        if (reason === DisconnectReason.loggedOut) {
          console.log("❌ تم تسجيل خروج الجلسة، احذف مجلد auth وامسح QR مجددًا.");
          return;
        }

        if (!isRestarting) {
          isRestarting = true;
          console.log("🔄 سيتم إعادة تشغيل البوت بعد 5 ثوانٍ...");
          setTimeout(startBot, 5000);
        }
      }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async ({ messages }) => {
      const msg = messages[0];
      if (!msg.message) return;

      const chatId = msg.key.remoteJid;
      const senderId = msg.key.participant || msg.key.remoteJid;
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        msg.message?.documentMessage?.caption ||
        "";

      console.log(`📩 رسالة جديدة من ${senderId}: ${text}`);
      if (!text) return;

      const command = text.trim().toLowerCase();

      const commands = {
        "اهلا": "👋 أهلاً وسهلاً!",
        "مين": "👋 انا بوت ذكاء اصطناعي لمساعده صاحب الرقم اذا كنت تريده ارسل كلمه خاص ",
        "مرحبا": "😊 مرحبًا! كيف يمكنني مساعدتك؟",
        "كيف حالك": "أنا بخير، شكرًا لسؤالك! 😊 وأنت؟",
        "من انتم": "نحن فريق one Team هنا لدعمك في اي وقت 😊 وأنت؟",
        "one team": "نحن شركه او مؤسسه لدعم المتعلمين او الخريجين لايجاد الطريق الذي يحتاجه الشخص لسلوك مسعاه او مبتغاه 😊 وأنت؟",
        "خاص": "سيتم التواصل معك في اقرب وقت الرجاء الأنتظار😊"
      };

      if (commands[command]) {
        await sock.sendMessage(chatId, { text: commands[command] });
        return;
      }

      if (command === ".وقت") {
        const now = new Date();
        const timeString = now.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        await sock.sendMessage(chatId, { text: `🕒 الوقت الحالي: ${timeString}` });
        return;
      }

      if (command === ".حكمه") {
        const wisdoms = [
          "💡 المال هو زينة الحياة الدنيا.",
          "🦉 العلم نور والجهل ظلام.",
          "🎯 لا تؤجل عمل اليوم إلى الغد.",
          "🎯 من أنجز سريعًا أخذ تاسكات كثيرة.",
          "🎯 استيقظ على الواقع، لا شيء يسير كما هو مخطط له في هذا العالم.",
          "🌱 من جد وجد، ومن زرع حصد.",
          "💡 الحكمة هي خلاصة الفكر.",
          "🦉 الحكيم هو من يعرف متى يتحدث ومتى يصمت.",
          "🎯 النجاح يأتي لمن يسعى إليه.",
          "🌱 الثقة بالنفس أساس النجاح.",
          "💡 الصبر مفتاح الفرج.",
          "🦉 التعلم من الأخطاء هو طريق النجاح.",
          "💡 لا تسأل عن شيء لا تريد سماع إجابته.",
          "🦉 النجاح ليس نهاية الطريق، بل هو بداية رحلة جديدة.",
          "🎯 افعل ما تستطيع بما لديك، حيثما كنت.",
          "🌱 الحياة ليست عن انتظار العاصفة لتمر، بل عن تعلم الرقص تحت المطر."
        ];
        const randomWisdom = wisdoms[Math.floor(Math.random() * wisdoms.length)];
        await sock.sendMessage(chatId, { text: randomWisdom });
        return;
      }

      if (command === ".اوامر") {
        await sendCommandList(sock, chatId);
        return;
      }

      // إضافة ميزة تحويل النص إلى صوت
      if (command.startsWith(".صوت ")) {
        const textToConvert = command.replace(".صوت ", "").trim();
        if (!textToConvert) {
          await sock.sendMessage(chatId, { text: "⚠️ استخدم: .صوت [نص]" });
          return;
        }

        const filePath = "voice.mp3";
        const gtts = new gTTS(textToConvert, "ar");

        gtts.save(filePath, async function (error) {
          if (error) {
            console.error("❌ خطأ في تحويل النص إلى صوت:", error);
            await sock.sendMessage(chatId, { text: "❌ لم أتمكن من تحويل النص إلى صوت." });
            return;
          }

          const audioBuffer = fs.readFileSync(filePath);
          await sock.sendMessage(chatId, { audio: { buffer: audioBuffer }, mimetype: "audio/mp4" });

          fs.unlinkSync(filePath); // حذف الملف بعد الإرسال
        });
        return;
      }

      // إضافة ميزة جلب صورة من Unsplash
      if (command.startsWith(".صورة ")) {
        const query = command.replace(".صورة ", "").trim();
        if (!query) {
          await sock.sendMessage(chatId, { text: "⚠️ استخدم: .صورة [كلمة البحث]" });
          return;
        }

        try {
          const response = await fetch(`https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&client_id=YOUR_ACCESS_KEY`);
          const data = await response.json();
          const imageUrl = data.urls.regular;
          const imageResponse = await fetch(imageUrl);
          const imageBuffer = await imageResponse.arrayBuffer();

          await sock.sendMessage(chatId, {
            image: Buffer.from(imageBuffer),
            caption: `🔎 نتيجة البحث عن: ${query}`,
          });
        } catch (error) {
          console.error("❌ خطأ في جلب الصورة:", error);
          await sock.sendMessage(chatId, { text: "❌ لم أتمكن من العثور على صورة." });
        }
        return;
      }

      if (command.startsWith(".الكل")) {
        try {
          const groupMetadata = await sock.groupMetadata(chatId);
          const participants = groupMetadata.participants.map(p => p.id);
          const mentionText = `👥 منشن جماعي:\n${participants.map(p => `@${p.split("@")[0]}`).join(" ")}`;
          await sock.sendMessage(chatId, { text: mentionText, mentions: participants });
        } catch {
          await sock.sendMessage(chatId, { text: "⚠️ لا يمكن تنفيذ هذا الأمر إلا داخل المجموعات." });
        }
        return;
      }

      if (command.startsWith(".كرر ")) {
        const args = text.split(" ");
        const repeatCount = parseInt(args[1]);
        const messageToRepeat = args.slice(2).join(" ");

        if (!isNaN(repeatCount) && repeatCount > 0) {
          for (let i = 0; i < repeatCount; i++) {
            await sock.sendMessage(chatId, { text: messageToRepeat });
          }
        } else {
          await sock.sendMessage(chatId, { text: "⚠️ استخدم الأمر بهذا الشكل: .كرر [عدد] [نص]" });
        }
        return;
      }

      if (command.startsWith(".كرر_سطر ")) {
        const args = text.split(" ");
        const repeatCount = parseInt(args[1]);
        const messageToRepeat = args.slice(2).join(" ");

        if (!isNaN(repeatCount) && repeatCount > 0) {
          const repeatedText = Array(repeatCount).fill(messageToRepeat).join("\n");
          await sock.sendMessage(chatId, { text: repeatedText });
        } else {
          await sock.sendMessage(chatId, { text: "⚠️ استخدم الأمر بهذا الشكل: .كرر_سطر [عدد] [نص]" });
        }
        return;
      }

      // إضافة لعبة XO
      if (command === ".xo") {
        if (!games[chatId]) {
          games[chatId] = {
            board: ["0", "1", "2", "3", "4", "5", "6", "7", "8"],
            currentPlayer: "X",
            gameEnded: false,
          };

          await sock.sendMessage(chatId, { text: `🎮 لعبة XO بدأت!\nاستخدم ".xo [رقم]" للعب.\n\n${printBoard(games[chatId].board)}` });
        } else {
          await sock.sendMessage(chatId, { text: "⚠️ هناك لعبة جارية بالفعل! أكملها أولًا أو استخدم .الغاء لإلغاء اللعبة الحالية." });
        }
        return;
      }

      if (command === ".الغاء") {
        if (games[chatId]) {
          delete games[chatId];
          await sock.sendMessage(chatId, { text: "تم إلغاء اللعبة الحالية." });
        } else {
          await sock.sendMessage(chatId, { text: "❌ لا يوجد لعبة جارية لإلغائها." });
        }
        return;
      }

      if (command.startsWith(".xo ")) {
        if (!games[chatId]) {
          await sock.sendMessage(chatId, { text: "❌ لا يوجد لعبة جارية، ابدأ واحدة بـ .xo" });
          return;
        }

        const index = parseInt(command.split(" ")[1]);
        if (isNaN(index) || index < 0 || index > 8) {
          await sock.sendMessage(chatId, { text: "⚠️ استخدم رقم بين 0 و 8." });
          return;
        }

        let game = games[chatId];
        if (game.board[index] === "X" || game.board[index] === "O" || game.gameEnded) {
          await sock.sendMessage(chatId, { text: "⚠️ هذه الخانة مشغولة أو اللعبة انتهت!" });
          return;
        }

        game.board[index] = game.currentPlayer;
        const winner = checkWin(game.board);

        if (winner) {
          game.gameEnded = true;
          await sock.sendMessage(chatId, { text: `🎉 ${winner} فاز!\n${printBoard(game.board)}` });
          delete games[chatId];
        } else if (!game.board.includes("0") && !game.board.includes("1") && !game.board.includes("2") && !game.board.includes("3") && !game.board.includes("4") && !game.board.includes("5") && !game.board.includes("6") && !game.board.includes("7") && !game.board.includes("8")) {
          game.gameEnded = true;
          await sock.sendMessage(chatId, { text: `🏳️ تعادل!\n${printBoard(game.board)}` });
          delete games[chatId];
        } else {
          game.currentPlayer = game.currentPlayer === "X" ? "O" : "X";
          await sock.sendMessage(chatId, { text: `🎮 دور ${game.currentPlayer}\n${printBoard(game.board)}` });
        }
        return;
      }

      if (command === ".اقتباس") {
        try {
          const response = await fetch("https://api.quotable.io/random");
          const data = await response.json();
          await sock.sendMessage(chatId, { text: `📜 اقتباس: ${data.content}` });
        } catch (error) {
          console.error("❌ خطأ في جلب الاقتباس:", error);
          await sock.sendMessage(chatId, { text: "❌ لم أتمكن من جلب الاقتباس." });
        }
        return;
      }
    });

    console.log("✅ البوت يعمل! امسح كود QR من واتساب ويب.");
  } catch (error) {
    console.error("❌ حدث خطأ:", error);
  }
}

async function sendCommandList(sock, chatId) {
  const commandList = `🚀 **قائمة الأوامر المتاحة**:
- **.الكل** → منشن جماعي
- **.كرر [عدد] [نص]** → تكرار الرسالة عدة مرات كرسائل منفصلة
- **.كرر_سطر [عدد] [نص]** → تكرار الرسالة عدة مرات في رسالة واحدة
- **.وقت** → معرفة الوقت الحالي
- **.حكمه** → إرسال حكمة عشوائية
- **.اقتباس** → إرسال اقتباس عشوائي
- **.xo** → بدء لعبة XO
- **.الغاء** → إلغاء اللعبة الحالية
- **.صوت [نص]** → تحويل النص إلى صوت
- **.صورة [كلمة البحث]** → جلب صورة من Unsplash
- **ردود تلقائية** → عند إرسال "مين"، "من انتم"، "One team"، "اهلا"، "مرحبا"، "كيف حالك؟"
    `;

  try {
    await sock.sendMessage(chatId, { text: commandList });
    console.log("📜 تم إرسال قائمة الأوامر.");
  } catch (err) {
    console.error("❌ فشل إرسال قائمة الأوامر:", err);
  }
}

// دوال مساعدة لـ XO
function printBoard(board) {
  return `
    ${board[0]} | ${board[1]} | ${board[2]}
    ---------
    ${board[3]} | ${board[4]} | ${board[5]}
    ---------
    ${board[6]} | ${board[7]} | ${board[8]}
  `;
}

function checkWin(board) {
  const winConditions = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];

  for (let [a, b, c] of winConditions) {
    if (board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return null;
}

startBot();