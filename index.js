const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} = require("stian-baileys");

const pino = require("pino");
const readline = require("readline");

const {
  saveGroup,
  getGroups,
  getEnabledGroups,
  setMultipleEnabled
} = require("./database/db");

const BOT_NAME = "Beauty's Bot";
const DEVELOPER = "Lord Samzy";
const POWERED_BY = "Xchordlabs LLC";

const SESSION_DIR = "./session";

let sock = null;
let reconnecting = false;

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function getText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    ""
  ).trim();
}

function printHeader() {
  console.log("");
  console.log("╔══════════════════════════════════════╗");
  console.log(`║        ${BOT_NAME.padEnd(25)}║`);
  console.log(`║        Developer: ${DEVELOPER.padEnd(17)}║`);
  console.log(`║        ${POWERED_BY.padEnd(25)}║`);
  console.log("╚══════════════════════════════════════╝");
  console.log("");
}

function getMenu() {
  return `
╭━━━〔 ${BOT_NAME} 〕━━━╮
┃
┃ 👤 Developer: ${DEVELOPER}
┃ ⚡ Powered by: ${POWERED_BY}
┃
┣━━━〔 COMMANDS 〕━━━
┃
┃ .ping
┃ .help
┃ .menu
┃
┃ .groups
┃ .enabled
┃ .refreshgroups
┃ .stats
┃
┃ .enable 1,3,5
┃ .disable 1,3,5
┃
┃ .group 3
┃
┃ .send 3 Hello
┃
┃ .gstatus Hello
┃ .gstatus 1,3,5 Hello
┃
╰━━━━━━━━━━━━━━━━━━━━╯
`;
}

function showGroups() {
  const groups = getGroups();

  if (!groups.length) {
    return "📭 No groups found.";
  }

  let text = `📋 GROUPS (${groups.length})\n\n`;

  groups.forEach((group, index) => {
    text += `${index + 1}. ${group.name || "Unnamed Group"}\n`;
    text += `   ${group.enabled ? "🟢 ENABLED" : "⚪ DISABLED"}\n`;
    text += `   ID: ${group.id}\n\n`;
  });

  return text;
}

function showEnabledGroups() {
  const groups = getEnabledGroups();

  if (!groups.length) {
    return "⚪ No groups are currently enabled.";
  }

  let text = `🟢 ENABLED GROUPS (${groups.length})\n\n`;

  groups.forEach((group, index) => {
    text += `${index + 1}. ${group.name || "Unnamed Group"}\n`;
    text += `   ID: ${group.id}\n\n`;
  });

  return text;
}

function showStats() {
  const groups = getGroups();
  const enabled = groups.filter(g => g.enabled).length;

  return `
📊 BOT STATISTICS

Total groups: ${groups.length}
Enabled groups: ${enabled}
Disabled groups: ${groups.length - enabled}

Bot: ${BOT_NAME}
Developer: ${DEVELOPER}
Powered by: ${POWERED_BY}
`;
}

async function refreshGroups() {
  if (!sock) return [];

  try {
    const groups = await sock.groupFetchAllParticipating();
    const list = Object.values(groups);

    for (const group of list) {
      saveGroup(group.id, group.subject || "Unnamed Group");
    }

    console.log(`✅ ${list.length} groups saved to database.`);

    return list;
  } catch (error) {
    console.error("❌ Could not refresh groups:", error.message);
    return [];
  }
}

function getGroupByNumber(number) {
  const groups = getGroups();
  const index = Number(number) - 1;

  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= groups.length
  ) {
    return null;
  }

  return groups[index];
}

async function sendGroupStatus(group, text) {
  if (!sock?.stianStatus) {
    throw new Error("Group Status API is unavailable.");
  }

  console.log(`📤 Sending Group Status → ${group.name}`);

  await sock.stianStatus.sendGroupStatus(
    group.id,
    { text }
  );

  console.log(`✅ Group Status sent → ${group.name}`);
}

async function sendSelectedGroupStatuses(groups, text) {
  if (!groups.length) {
    return {
      sent: 0,
      failed: 0
    };
  }

  let sent = 0;
  let failed = 0;

  for (const group of groups) {
    try {
      await sendGroupStatus(group, text);
      sent++;

      // Conservative delay between operations
      await sleep(3000);
    } catch (error) {
      failed++;

      console.error(
        `❌ Failed → ${group.name}:`,
        error.message
      );
    }
  }

  return {
    sent,
    failed
  };
}

async function handleCommand(msg, text) {
  const parts = text.split(/\s+/);
  const command = parts[0].toLowerCase();

  const args = text.slice(parts[0].length).trim();

  switch (command) {

    case ".ping":
      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text: "🏓 Pong!\n\nBeauty's Bot is online."
        }
      );
      console.log("✅ Ping response sent.");
      break;


    case ".help":
    case ".menu":
      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text: getMenu()
        }
      );
      break;


    case ".groups":
      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text: showGroups()
        }
      );
      break;


    case ".enabled":
      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text: showEnabledGroups()
        }
      );
      break;


    case ".stats":
      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text: showStats()
        }
      );
      break;


    case ".refreshgroups": {
      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text: "🔄 Refreshing groups..."
        }
      );

      const groups = await refreshGroups();

      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text: `✅ Groups refreshed.\n\nFound: ${groups.length}`
        }
      );

      break;
    }


    case ".enable": {
      if (!args) {
        await sock.sendMessage(
          msg.key.remoteJid,
          {
            text:
              "Usage:\n.enable 1,3,5"
          }
        );
        break;
      }

      const numbers = args
        .split(",")
        .map(x => x.trim())
        .filter(Boolean);

      const groups = getGroups();
      const ids = [];
      const names = [];

      for (const number of numbers) {
        const group = getGroupByNumber(number);

        if (group) {
          ids.push(group.id);
          names.push(
            `${number}. ${group.name || "Unnamed Group"}`
          );
        }
      }

      if (!ids.length) {
        await sock.sendMessage(
          msg.key.remoteJid,
          {
            text: "❌ None of those group numbers were found."
          }
        );
        break;
      }

      const result = setMultipleEnabled(ids, true);

      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text:
`🟢 GROUPS ENABLED

${names.join("\n")}

Changed: ${result.changed}`
        }
      );

      break;
    }


    case ".disable": {
      if (!args) {
        await sock.sendMessage(
          msg.key.remoteJid,
          {
            text:
              "Usage:\n.disable 1,3,5"
          }
        );
        break;
      }

      const numbers = args
        .split(",")
        .map(x => x.trim())
        .filter(Boolean);

      const ids = [];
      const names = [];

      for (const number of numbers) {
        const group = getGroupByNumber(number);

        if (group) {
          ids.push(group.id);
          names.push(
            `${number}. ${group.name || "Unnamed Group"}`
          );
        }
      }

      if (!ids.length) {
        await sock.sendMessage(
          msg.key.remoteJid,
          {
            text: "❌ None of those group numbers were found."
          }
        );
        break;
      }

      const result = setMultipleEnabled(ids, false);

      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text:
`⚪ GROUPS DISABLED

${names.join("\n")}

Changed: ${result.changed}`
        }
      );

      break;
    }


    case ".group": {
      if (!args) {
        await sock.sendMessage(
          msg.key.remoteJid,
          {
            text: "Usage:\n.group 3"
          }
        );
        break;
      }

      const group = getGroupByNumber(args);

      if (!group) {
        await sock.sendMessage(
          msg.key.remoteJid,
          {
            text: "❌ Group number not found."
          }
        );
        break;
      }

      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text:
`📋 GROUP ${args}

Name: ${group.name}
ID: ${group.id}
Status: ${group.enabled ? "🟢 Enabled" : "⚪ Disabled"}`
        }
      );

      break;
    }


    case ".send": {
      const sendParts = args.split(/\s+/);

      if (sendParts.length < 2) {
        await sock.sendMessage(
          msg.key.remoteJid,
          {
            text:
              "Usage:\n.send 3 Hello everyone"
          }
        );
        break;
      }

      const number = sendParts.shift();
      const message = sendParts.join(" ");

      const group = getGroupByNumber(number);

      if (!group) {
        await sock.sendMessage(
          msg.key.remoteJid,
          {
            text: "❌ Group number not found."
          }
        );
        break;
      }

      if (!group.enabled) {
        await sock.sendMessage(
          msg.key.remoteJid,
          {
            text:
              "⚠️ This group is disabled. Enable it first."
          }
        );
        break;
      }

      await sock.sendMessage(
        group.id,
        {
          text: message
        }
      );

      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text:
`✅ Message sent to:

${group.name}`
        }
      );

      break;
    }


    case ".gstatus": {
      if (!args) {
        await sock.sendMessage(
          msg.key.remoteJid,
          {
            text:
`Usage:

.gstatus Hello everyone

or

.gstatus 1,3,5 Hello everyone`
          }
        );
        break;
      }

      const firstPart = args.split(/\s+/)[0];

      // Explicit group selection
      if (/^[0-9,]+$/.test(firstPart)) {

        const numberList = firstPart
          .split(",")
          .map(x => x.trim())
          .filter(Boolean);

        const statusText = args
          .slice(firstPart.length)
          .trim();

        if (!statusText) {
          await sock.sendMessage(
            msg.key.remoteJid,
            {
              text:
                "❌ Please provide status text."
            }
          );
          break;
        }

        const selected = [];

        for (const number of numberList) {
          const group = getGroupByNumber(number);

          if (group && group.enabled) {
            selected.push(group);
          }
        }

        if (!selected.length) {
          await sock.sendMessage(
            msg.key.remoteJid,
            {
              text:
                "❌ No enabled groups were selected."
            }
          );
          break;
        }

        await sock.sendMessage(
          msg.key.remoteJid,
          {
            text:
`📋 Group Status preview

Groups: ${selected.length}
Text: ${statusText}

Sending with a 3-second delay between groups...`
          }
        );

        const result =
          await sendSelectedGroupStatuses(
            selected,
            statusText
          );

        await sock.sendMessage(
          msg.key.remoteJid,
          {
            text:
`✅ Group Status operation finished.

Sent: ${result.sent}
Failed: ${result.failed}`
          }
        );

        break;
      }


      // All enabled groups
      const enabledGroups = getEnabledGroups();

      if (!enabledGroups.length) {
        await sock.sendMessage(
          msg.key.remoteJid,
          {
            text:
              "❌ No enabled groups."
          }
        );
        break;
      }

      const statusText = args;

      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text:
`📋 Group Status preview

Enabled groups: ${enabledGroups.length}
Text: ${statusText}

Sending with a 3-second delay between groups...`
        }
      );

      const result =
        await sendSelectedGroupStatuses(
          enabledGroups,
          statusText
        );

      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text:
`✅ Group Status operation finished.

Sent: ${result.sent}
Failed: ${result.failed}`
        }
      );

      break;
    }


    default:
      console.log(`❓ Unknown command: ${command}`);

      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text:
`❓ Unknown command: ${command}

Type .menu to see available commands.`
        }
      );
  }
}

async function startBot() {
  if (reconnecting) return;

  const { state, saveCreds } =
    await useMultiFileAuthState(SESSION_DIR);

  sock = makeWASocket({
    auth: state,

    browser: Browsers.ubuntu("Chrome"),

    logger: pino({
      level: "silent"
    }),

    printQRInTerminal: false,

    generateHighQualityLinkPreview: false
  });

  // Group Status extension
  if (!sock.stianStatus) {
    console.log("⚠️ stianStatus is not available on this socket.");
  }

  sock.ev.on("creds.update", saveCreds);

  /*
   * IMPORTANT:
   *
   * WhatsApp can send a large backlog using:
   *
   *     type === "append"
   *
   * We DO NOT process those messages.
   *
   * Only "notify" represents new incoming messages
   * that we want to use for bot commands.
   */
  sock.ev.on("messages.upsert", async ({ type, messages }) => {
    try {

      // 🚫 Ignore WhatsApp history/backlog
      if (type !== "notify") {
        return;
      }

      console.log(
        `📥 NEW MESSAGE → ${messages.length}`
      );

      for (const msg of messages) {

        if (!msg?.message) {
          continue;
        }

        const jid = msg.key?.remoteJid;

        if (!jid) {
          continue;
        }

        // Ignore group messages
        if (jid.endsWith("@g.us")) {
          continue;
        }

        // Only accept commands sent from the bot account
        if (!msg.key?.fromMe) {
          continue;
        }

        const text = getText(msg);

        if (!text) {
          continue;
        }

        console.log(`⌨️ COMMAND TEXT → ${text}`);

        if (!text.startsWith(".")) {
          continue;
        }

        console.log(`⚡ COMMAND → ${text}`);

        await handleCommand(msg, text);
      }

    } catch (error) {
      console.error(
        "❌ Message handler error:",
        error
      );
    }
  });


  sock.ev.on("connection.update", async update => {
    const {
      connection,
      lastDisconnect
    } = update;

    if (connection === "connecting") {
      console.log("🔄 Connecting to WhatsApp...");
    }

    if (connection === "open") {
      reconnecting = false;

      console.log("");
      console.log("╔══════════════════════════════════════╗");
      console.log("║       ✅ WHATSAPP CONNECTED         ║");
      console.log("╚══════════════════════════════════════╝");
      console.log("");

      printHeader();

      await refreshGroups();

      console.log("");
      console.log("💡 Waiting for commands...");
      console.log("");
    }

    if (connection === "close") {

      const statusCode =
        lastDisconnect?.error?.output?.statusCode;

      console.log("");
      console.log(
        "⚠️ WhatsApp connection closed.",
        statusCode || ""
      );

      if (
        statusCode === DisconnectReason.loggedOut
      ) {
        console.log(
          "❌ WhatsApp session was logged out."
        );

        console.log(
          "Delete the session only if you intentionally want to pair again."
        );

        return;
      }

      if (!reconnecting) {
        reconnecting = true;

        console.log(
          "🔄 Reconnecting in 5 seconds..."
        );

        setTimeout(async () => {
          reconnecting = false;

          try {
            await startBot();
          } catch (error) {
            console.error(
              "❌ Reconnect failed:",
              error.message
            );
          }
        }, 5000);
      }
    }
  });


  /*
   * Pairing code
   *
   * If this session is already registered, this section
   * simply waits for the existing session.
   */
  if (!state.creds.registered) {

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(
      "📱 Enter your WhatsApp number with country code (example: 2348012345678): ",
      async number => {

        number = number.replace(/\D/g, "");

        try {
          console.log(
            "🔑 Requesting pairing code..."
          );

          const code =
            await sock.requestPairingCode(number);

          console.log("");
          console.log(
            "╔══════════════════════════════════════╗"
          );
          console.log(
            `║       PAIRING CODE: ${code}       ║`
          );
          console.log(
            "╚══════════════════════════════════════╝"
          );
          console.log("");

        } catch (error) {
          console.error(
            "❌ Pairing code failed:",
            error.message
          );
        }

        rl.close();
      }
    );
  }
}


process.on("uncaughtException", error => {
  console.error(
    "❌ Uncaught exception:",
    error
  );
});

process.on("unhandledRejection", error => {
  console.error(
    "❌ Unhandled rejection:",
    error
  );
});


console.log("");
console.log("🚀 Starting Beauty's Bot...");
console.log("");


startBot().catch(error => {
  console.error(
    "❌ Failed to start bot:",
    error
  );
});
