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
  pruneGroups,
  getSetting,
  setSetting,
  setEnabled,
  recordActivity,
  getActivityMap,
  getSettings,
  getGroups,
  getEnabledGroups,
  setMultipleEnabled,
  getSudoList,
  addSudo,
  removeSudo,
  isSudoJid,
  muteUser,
  unmuteUser,
  isUserMuted
} = require("./database/db");

const BOT_NAME = "Beauty's Bot";
const DEVELOPER = "Lord Samzy";
const POWERED_BY = "Xchordlabs LLC";

/*
 * ===================== CUSTOM DM MESSAGES =====================
 *
 * Add as many of these as you want. The key becomes the command word
 * (no dot, no spaces), the value is the full message sent to whoever
 * you target.
 *
 * Usage in the bot's own DM:
 *   .hi 2348012345678
 *   .rules 2348012345678
 *
 * That's it - no other code needs to change when you add a new one.
 */
const CUSTOM_MESSAGES = {
  hi: `Hello! 👋

Thanks for reaching out. Here's the full explanation you asked about:

[replace this with your actual message]`,

  // rules: `Group rules:\n1. ...\n2. ...`,
  // welcome: `Welcome! Glad to have you here.`,
};

const SESSION_DIR = "./session";

let sock = null;
let reconnecting = false;
let reconnectAttempts = 0;

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
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return `
╭─❖ *${BOT_NAME.toUpperCase()}* ❖─╮

   ✦ Premium WhatsApp Automation ✦

   👤 Owner    : ${DEVELOPER}
   ⚡ Engine   : ${POWERED_BY}
   📅 ${dateStr}  •  🕒 ${timeStr}
   ⏳ Uptime   : ${formatUptime(process.uptime())}

╰────────────────────────╯

┌─「 📊 OVERVIEW 」
│ .ping
│ .help / .menu
│ .stats
└─

┌─「 📁 GROUP MANAGEMENT 」
│ .groups
│ .enabled
│ .refreshgroups
│ .group <no.>
│ .enable 1,3,5 | 1-50 | all
│ .disable 1,3,5 | 1-50 | all
└─

┌─「 📢 STATUS & BROADCAST 」
│ .gstatus <text>
│ .gstatus 1,3,5 <text>
│ .gstatus 1-50 <text>
│ .gstatus all <text>
│ .broadcast <text>   ⚠️ instant, no delay
│ .send <no.> <text>
└─

┌─「 🛡️ GROUP PROTECTION 」  (run inside the group)
│ .protect
│ .antilink delete | kick | off
│ .antigcstatus on | off
│ .antistatusmention on | off
│ .mute / .unmute
│ .muteuser 30m | 2h | 1d
│ .unmuteuser
│ .kick  (reply to spammer)
└─

┌─「 👥 MEMBER TOOLS 」  (run inside the group)
│ .tagall <message>
│ .accept <count>       approve join requests
│ .listactive [count] [Nd]
│ .listinactive [count] [Nd]
│ .kick inactive 500 6d
└─

┌─「 👑 ACCESS 」
│ .sudo add|remove|list <number>
└─

┌─「 💬 CUSTOM DM MESSAGES 」  (DM only)
│ .hi <number>          e.g. .hi 2348012345678
│ (add more in CUSTOM_MESSAGES near the top of index.js)
└─

   Type a command to get started ✨
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

    // Drop groups this account is no longer in (e.g. after a number change)
    const { removed } = pruneGroups(list.map(g => g.id));

    console.log(`✅ ${list.length} groups saved to database.`);

    if (removed > 0) {
      console.log(
        `🧹 Removed ${removed} stale group(s) this account is no longer a member of.`
      );
    }

    return list;
  } catch (error) {
    console.error("❌ Could not refresh groups:", error.message);
    return [];
  }
}

/*
 * Parse a group selection string.
 *
 * Accepts:  "1,3,5"   "1, 3, 5"   "1-50"   "1-20, 35, 40-45"   "all"
 * Returns an array of 1-based index strings, de-duplicated and in order.
 */
function parseSelection(input) {
  const text = String(input || "").trim();

  if (!text) return [];

  if (/^all$/i.test(text)) {
    return getGroups().map((_, i) => String(i + 1));
  }

  const out = [];
  const seen = new Set();

  const push = n => {
    if (!seen.has(n)) {
      seen.add(n);
      out.push(String(n));
    }
  };

  for (const chunk of text.split(",")) {
    const part = chunk.trim();

    if (!part) continue;

    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);

    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);

      // guard against a typo like 1-100000 eating all memory
      if (Math.abs(to - from) > 5000) continue;

      for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
        push(i);
      }
    } else if (/^\d+$/.test(part)) {
      push(Number(part));
    }
  }

  return out;
}

/* Split "1-50 some text" into { selection, rest }. */
function splitSelection(args) {
  const m = String(args || "").match(
    /^((?:\d+(?:\s*-\s*\d+)?)(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*|all)\s+([\s\S]+)$/i
  );

  if (!m) return null;

  return { selection: m[1], rest: m[2].trim() };
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

/* ===================== GROUP PROTECTION ===================== */

const LINK_PATTERN = new RegExp(
  [
    "https?://",
    "www\\.",
    "chat\\.whatsapp\\.com/",
    "wa\\.me/",
    "t\\.me/",
    "whatsapp\\.com/channel/",
    "\\b[a-z0-9-]{2,}\\.(com|net|org|xyz|link|io|me|info|site|store|shop|club|online|live|app|co|ng)\\b"
  ].join("|"),
  "i"
);

const metadataCache = new Map();
const METADATA_TTL_MS = 5 * 60 * 1000;

async function getMetadata(jid) {
  const hit = metadataCache.get(jid);

  if (hit && Date.now() - hit.at < METADATA_TTL_MS) {
    return hit.data;
  }

  const data = await sock.groupMetadata(jid);

  metadataCache.set(jid, { data, at: Date.now() });

  return data;
}

/* Match a participant across id / jid / lid, which differ in Baileys 7. */
function findParticipant(metadata, who) {
  if (!who) return null;

  const key = who.split(":")[0].split("@")[0];

  return metadata.participants.find(p =>
    [p.id, p.jid, p.lid]
      .filter(Boolean)
      .some(v => v.split(":")[0].split("@")[0] === key)
  ) || null;
}

function isAdmin(metadata, who) {
  const p = findParticipant(metadata, who);
  return !!p && (p.admin === "admin" || p.admin === "superadmin");
}

function botIsAdmin(metadata) {
  return isAdmin(metadata, sock?.user?.id) ||
    isAdmin(metadata, sock?.user?.lid);
}

/* Peel ephemeral / view-once wrappers so we can see the real message type. */
function unwrap(message) {
  let m = message;

  for (let i = 0; i < 5 && m; i++) {
    const next =
      m.ephemeralMessage?.message ||
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.documentWithCaptionMessage?.message;

    if (!next) break;

    m = next;
  }

  return m || {};
}

function isGroupStatusPost(message) {
  const m = unwrap(message);
  return !!(m.groupStatusMessageV2 || m.groupStatusMessage);
}

function isStatusMention(message) {
  const m = unwrap(message);

  return !!(
    m.groupStatusMentionMessage ||
    m.statusMentionMessage ||
    m.protocolMessage?.type === 25
  );
}

async function deleteMessage(jid, key) {
  try {
    await sock.sendMessage(jid, { delete: key });
    return true;
  } catch (error) {
    console.error("⚠️ Could not delete message:", error.message);
    return false;
  }
}

async function removeParticipant(jid, who) {
  try {
    await sock.groupParticipantsUpdate(jid, [who], "remove");
    metadataCache.delete(jid);
    return true;
  } catch (error) {
    console.error("⚠️ Could not remove participant:", error.message);
    return false;
  }
}

/*
 * Runs on every incoming group message.
 * Returns quietly if nothing is enabled for that group.
 */
async function handleGroupGuard(msg) {
  const jid = msg.key.remoteJid;

  // never moderate ourselves
  if (msg.key.fromMe) return;

  const sender = msg.key.participant || msg.participant;

  if (!sender) return;

  let metadata;

  try {
    metadata = await getMetadata(jid);
  } catch (error) {
    return;
  }

  // admins are exempt from every filter, including .muteuser
  if (isAdmin(metadata, sender)) return;

  // Per-user mute applies no matter what else is on/off - checked first
  // so a muted spammer stays silenced even if antilink etc. are off.
  //
  // Resolve through findParticipant() the same way .muteuser stored it -
  // the raw sender id from the event and the id in metadata.participants
  // aren't guaranteed to be the same identifier form (jid vs lid), so a
  // plain string match against the stored key can silently miss.
  const senderRecord = findParticipant(metadata, sender);
  const canonicalSender = senderRecord
    ? (senderRecord.id || senderRecord.jid || senderRecord.lid)
    : sender;

  if (isUserMuted(jid, canonicalSender)) {
    if (botIsAdmin(metadata)) {
      await deleteMessage(jid, msg.key);
      console.log(`🔇 muteuser → deleted a message from ${sender.split("@")[0]} in ${metadata.subject}`);
    }
    return;
  }

  const settings = getSettings(jid);

  const antilink = settings.antilink || "off";
  const antigcstatus = settings.antigcstatus === true;
  const antistatusmention = settings.antistatusmention === true;

  if (antilink === "off" && !antigcstatus && !antistatusmention) {
    return;
  }

  if (!botIsAdmin(metadata)) return;

  const senderName = sender ? sender.split("@")[0] : "someone";

  if (antigcstatus && isGroupStatusPost(msg.message)) {
    await deleteMessage(jid, msg.key);
    console.log(`🛡️ antigcstatus → removed a group status in ${metadata.subject}`);
    return;
  }

  if (antistatusmention && isStatusMention(msg.message)) {
    await deleteMessage(jid, msg.key);
    console.log(`🛡️ antistatusmention → removed a status mention in ${metadata.subject}`);
    return;
  }

  if (antilink !== "off") {
    const body = getText(msg);

    if (body && LINK_PATTERN.test(body)) {
      await deleteMessage(jid, msg.key);

      console.log(`🛡️ antilink → deleted a link from ${senderName} in ${metadata.subject}`);

      if (antilink === "kick" && sender) {
        const removed = await removeParticipant(jid, sender);

        await sock.sendMessage(jid, {
          text: removed
            ? `🚫 @${senderName} was removed for posting links.`
            : `⚠️ Link deleted. I could not remove @${senderName}.`,
          mentions: [sender]
        });
      } else {
        await sock.sendMessage(jid, {
          text: `⚠️ @${senderName}, links are not allowed here.`,
          mentions: [sender]
        });
      }
    }
  }
}

/*
 * Parses the shared "[count] [Nd]" argument style used by
 * .listactive / .listinactive / .kick inactive, e.g.:
 *
 *   "500"      -> { count: 500, days: defaultDays }
 *   "7D"       -> { count: null, days: 7 }
 *   "500 7D"   -> { count: 500, days: 7 }
 *   ""         -> { count: null, days: defaultDays }
 */
function parseCountDays(argsStr, defaultDays = 7) {
  const text = String(argsStr || "").trim();

  const dayMatch = text.match(/(\d+)\s*d\b/i);
  const days = dayMatch ? Number(dayMatch[1]) : defaultDays;

  const withoutDays = text.replace(/(\d+)\s*d\b/i, "").trim();
  const countMatch = withoutDays.match(/(\d+)/);
  const count = countMatch ? Number(countMatch[1]) : null;

  return { count, days };
}

/*
 * Returns group members split by activity, sorted so the LEAST recently
 * active (or never-seen) come first in the inactive list - useful both
 * for display and for deciding who a mass-kick should target first.
 */
async function getMembersByActivity(jid, days) {
  const metadata = await getMetadata(jid);
  const activity = getActivityMap(jid);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const withLastSeen = metadata.participants.map(p => {
    const key = [p.id, p.jid, p.lid].filter(Boolean)[0];
    return { participant: p, key, lastSeen: activity[key] || 0 };
  });

  const active = withLastSeen.filter(x => x.lastSeen >= cutoff);
  const inactive = withLastSeen
    .filter(x => x.lastSeen < cutoff)
    .sort((a, b) => a.lastSeen - b.lastSeen); // oldest / never-seen first

  return { metadata, active, inactive, total: metadata.participants.length };
}

/* "30m" / "2h" / "1d" / "45" (bare minutes) -> milliseconds, or null if unparseable */
function parseDuration(input) {
  const text = String(input || "").trim().toLowerCase();

  const m = text.match(/^(\d+)\s*(m|min|mins|h|hr|hrs|hour|hours|d|day|days)?$/);

  if (!m) return null;

  const value = Number(m[1]);
  const unit = m[2] || "m";

  if (/^h/.test(unit)) return value * 60 * 60 * 1000;
  if (/^d/.test(unit)) return value * 24 * 60 * 60 * 1000;

  return value * 60 * 1000; // minutes default
}

function describeSendError(error) {
  const code =
    error?.output?.statusCode ??
    error?.data ??
    null;

  if (code === 403 || /forbidden/i.test(error?.message || "")) {
    return "forbidden (403) - this account is not a member of the group, or the group is set to 'only admins can send messages'";
  }

  if (code === 401) {
    return "unauthorized (401) - session is stale, re-pair the bot";
  }

  if (code === 429) {
    return "rate limited (429) - slow down, increase the delay";
  }

  return error?.message || String(error);
}

function errorCode(error) {
  return error?.output?.statusCode ?? error?.data ?? null;
}

/* 403 = we are not allowed in that group. Retrying will never help. */
function isPermanent(error) {
  return errorCode(error) === 403 ||
    /forbidden|not-authorized/i.test(error?.message || "");
}

async function sendGroupStatus(group, text, attempt = 1) {
  const MAX_ATTEMPTS = 3;

  if (!sock?.stianStatus) {
    throw new Error("Group Status API is unavailable.");
  }

  console.log(`📤 Sending Group Status → ${group.name}`);

  try {
    await sock.stianStatus.sendGroupStatus(
      group.id,
      { text }
    );
  } catch (error) {
    if (isPermanent(error)) {
      // stop trying this group on future runs
      setEnabled(group.id, false);
      console.log(`⛔ Auto-disabled "${group.name}" (no longer reachable).`);
      throw error;
    }

    if (attempt >= MAX_ATTEMPTS) {
      throw error;
    }

    const wait = 5000 * attempt;

    console.log(`🔁 Retry ${attempt + 1}/${MAX_ATTEMPTS} for ${group.name} in ${wait / 1000}s`);

    await sleep(wait);

    return sendGroupStatus(group, text, attempt + 1);
  }

  console.log(`✅ Group Status sent → ${group.name}`);
}

/*
 * Group statuses only render for other members if the bot is ALLOWED to
 * post there - WhatsApp enforces this server-side and still acks the
 * relay either way, so we have to check ourselves instead of trusting
 * a "successful" send.
 *
 * "Allowed" means: the bot is a group admin, OR the group is not locked
 * to "only admins can send messages" (metadata.announce === true is that
 * lock). Confirmed against the account's own past experience - a group
 * that was announce-locked before a number change kept rejecting posts
 * from the new, non-admin number even after re-checking; the fix is to
 * check the actual announce flag rather than assuming admin is always
 * required.
 */
async function canPostGroupStatus(groupId) {
  try {
    const metadata = await getMetadata(groupId);
    return botIsAdmin(metadata) || !metadata.announce;
  } catch (error) {
    // if we can't even read metadata, don't block the send on that alone
    return true;
  }
}

/*
 * delayMs: null means "no delay at all" - used by .broadcast.
 * Anything else is a fixed number of ms to wait between sends.
 */
async function sendSelectedGroupStatuses(groups, text, delayMs = () => 2000 + Math.floor(Math.random() * 6000)) {
  if (!groups.length) {
    return {
      sent: 0,
      failed: 0,
      skippedLocked: []
    };
  }

  let sent = 0;
  let failed = 0;
  const skippedLocked = [];

  for (const group of groups) {
    const allowed = await canPostGroupStatus(group.id);

    if (!allowed) {
      skippedLocked.push(group.name);
      console.log(`⛔ Skipped (announce-locked, bot not admin) → ${group.name}`);
      continue;
    }

    try {
      await sendGroupStatus(group, text);
      sent++;

      if (delayMs !== null) {
        await sleep(typeof delayMs === "function" ? delayMs() : delayMs);
      }
    } catch (error) {
      failed++;

      console.error(
        `❌ Failed → ${group.name}: ${describeSendError(error)}`
      );
    }
  }

  return {
    sent,
    failed,
    skippedLocked
  };
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);

  return parts.join(" ");
}

async function handleCommand(msg, text) {
  const parts = text.split(/\s+/);
  const command = parts[0].toLowerCase();

  const args = text.slice(parts[0].length).trim();

  // ---- custom DM message dispatcher (see CUSTOM_MESSAGES above) ----
  const customKey = command.slice(1);

  if (Object.prototype.hasOwnProperty.call(CUSTOM_MESSAGES, customKey)) {
    const jid = msg.key.remoteJid;
    const numMatch = args.match(/\d{7,}/);

    if (!numMatch) {
      await sock.sendMessage(jid, {
        text: `Usage: .${customKey} 2348012345678\n\nSends the "${customKey}" message straight to that person's DM.`
      });
      return;
    }

    const targetJid = `${numMatch[0]}@s.whatsapp.net`;

    try {
      await sock.sendMessage(targetJid, { text: CUSTOM_MESSAGES[customKey] });

      await sock.sendMessage(jid, {
        text: `✅ Sent "${customKey}" message to ${numMatch[0]}.`
      });
    } catch (error) {
      await sock.sendMessage(jid, {
        text: `❌ Could not send to ${numMatch[0]}: ${error.message}\n\n(They may not be on WhatsApp, or have blocked this number.)`
      });
    }

    return;
  }

  switch (command) {

    case ".ping": {
      const jid = msg.key.remoteJid;

      // Network/WhatsApp-server delay: from when the message was sent
      // on-device to when this process picked it up.
      const sentAt = Number(msg.messageTimestamp) * 1000;
      const networkMs = sentAt ? Date.now() - sentAt : null;

      // Processing/round-trip delay: how long it takes this process to
      // actually push a reply back out.
      const start = Date.now();

      await sock.sendMessage(jid, {
        text: "🏓 Pong!"
      });

      const responseMs = Date.now() - start;

      await sock.sendMessage(jid, {
        text:
`🏓 *PONG*

Response: ${responseMs}ms${networkMs !== null ? `\nNetwork: ${networkMs}ms` : ""}
Uptime: ${formatUptime(process.uptime())}

*${BOT_NAME}* is online.`
      });

      console.log(`✅ Ping response sent (${responseMs}ms).`);
      break;
    }


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
              "Usage:\n.enable 1,3,5\n.enable 1-50\n.enable all"
          }
        );
        break;
      }

      const numbers = parseSelection(args);

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
              "Usage:\n.disable 1,3,5\n.disable 1-50\n.disable all"
          }
        );
        break;
      }

      const numbers = parseSelection(args);

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


    case ".sudo": {
      const jid = msg.key.remoteJid;

      // Only the owner's own number can grant/revoke sudo access -
      // a sudo user is never allowed to add more sudo users.
      if (!msg.key.fromMe) {
        await sock.sendMessage(jid, {
          text: "❌ Only the bot owner can manage sudo access."
        });
        break;
      }

      const [sub, ...rest] = args.split(/\s+/);
      const number = rest.join("");

      if (sub === "add" && number) {
        addSudo(number);

        await sock.sendMessage(jid, {
          text: `✅ ${number.replace(/\D/g, "")} can now use all bot commands (DM and groups).`
        });
      } else if ((sub === "remove" || sub === "del") && number) {
        const removed = removeSudo(number);

        await sock.sendMessage(jid, {
          text: removed
            ? `✅ ${number.replace(/\D/g, "")} removed from sudo.`
            : `That number was not in the sudo list.`
        });
      } else if (sub === "list") {
        const list = getSudoList();

        await sock.sendMessage(jid, {
          text: list.length
            ? `👑 SUDO USERS\n\n${list.join("\n")}`
            : "No sudo users added yet."
        });
      } else {
        await sock.sendMessage(jid, {
          text:
`Usage:

.sudo add 2348012345678
.sudo remove 2348012345678
.sudo list

A sudo user can run every command this account can, in DM and in any
group the bot is in - including .gstatus, .broadcast and .kick. Only
add numbers you fully trust.`
        });
      }

      break;
    }


    case ".broadcast": {
      if (!args) {
        await sock.sendMessage(
          msg.key.remoteJid,
          {
            text:
`Usage:

.broadcast Hello everyone

Sends to every ENABLED group immediately, back-to-back, with NO delay
between sends - unlike .gstatus, which paces itself.

This is the fastest option but also the most likely to get the account
rate-limited or flagged if you run it often. Use it sparingly.`
          }
        );
        break;
      }

      const broadcastGroups = getEnabledGroups();

      if (!broadcastGroups.length) {
        await sock.sendMessage(
          msg.key.remoteJid,
          { text: "❌ No enabled groups to broadcast to." }
        );
        break;
      }

      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text: `📡 Broadcasting to ${broadcastGroups.length} groups, no delay...`
        }
      );

      const broadcastResult = await sendSelectedGroupStatuses(
        broadcastGroups,
        args,
        null // no delay
      );

      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text:
`📡 BROADCAST COMPLETE

Sent: ${broadcastResult.sent}
Failed: ${broadcastResult.failed}${broadcastResult.skippedLocked.length ? `
Skipped (locked, bot not admin): ${broadcastResult.skippedLocked.length}
  ${broadcastResult.skippedLocked.join(", ")}` : ""}`
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

      /*
       * Explicit group selection.
       *
       * Matches a full leading selector, so spaces after commas are fine:
       *
       *   .gstatus 1,3,5 Hello
       *   .gstatus 1, 3, 5 Hello
       *   .gstatus 1-20, 35 Hello
       *
       * The old code only read up to the first space, so "1, 2, 3 Hi"
       * selected group 1 and turned "2, 3 Hi" into the status text.
       */
      const parsed = splitSelection(args);

      if (parsed) {

        const numberList = parseSelection(parsed.selection);
        const statusText = parsed.rest;

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
Failed: ${result.failed}${result.skippedLocked.length ? `
Skipped (locked, bot not admin): ${result.skippedLocked.length}
  ${result.skippedLocked.join(", ")}` : ""}`
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
Failed: ${result.failed}${result.skippedLocked.length ? `
Skipped (locked, bot not admin): ${result.skippedLocked.length}
  ${result.skippedLocked.join(", ")}` : ""}`
        }
      );

      break;
    }


    case ".antilink":
    case ".antigcstatus":
    case ".antistatusmention": {
      const jid = msg.key.remoteJid;

      if (!jid.endsWith("@g.us")) {
        await sock.sendMessage(jid, {
          text: "❌ Run this inside the group you want to protect."
        });
        break;
      }

      const key = command.slice(1);
      const value = args.toLowerCase();

      if (key === "antilink") {
        if (!["on", "off", "delete", "kick"].includes(value)) {
          await sock.sendMessage(jid, {
            text:
`Usage:

.antilink delete   → delete the link + warn
.antilink kick     → delete the link + remove sender
.antilink off      → disable

Current: ${getSetting(jid, "antilink", "off")}`
          });
          break;
        }

        const mode = value === "on" ? "delete" : value;

        setSetting(jid, "antilink", mode);

        await sock.sendMessage(jid, {
          text: `🛡️ Antilink set to: ${mode}`
        });
      } else {
        if (!["on", "off"].includes(value)) {
          await sock.sendMessage(jid, {
            text: `Usage: .${key} on  |  .${key} off\n\nCurrent: ${getSetting(jid, key, false) ? "on" : "off"}`
          });
          break;
        }

        setSetting(jid, key, value === "on");

        await sock.sendMessage(jid, {
          text: `🛡️ ${key} is now ${value.toUpperCase()}`
        });
      }

      // warn if the bot cannot actually act
      try {
        const metadata = await getMetadata(jid);

        if (!botIsAdmin(metadata)) {
          await sock.sendMessage(jid, {
            text: "⚠️ I am not an admin here, so I cannot delete messages or remove anyone. Make me admin."
          });
        }
      } catch (error) {
        // ignore
      }

      break;
    }


    case ".protect": {
      const jid = msg.key.remoteJid;

      if (!jid.endsWith("@g.us")) {
        await sock.sendMessage(jid, {
          text: "❌ Run this inside a group."
        });
        break;
      }

      const settings = getSettings(jid);

      let adminNote = "";
      let statusNote = "";

      try {
        const metadata = await getMetadata(jid);
        const admin = botIsAdmin(metadata);

        adminNote = admin
          ? "✅ Bot is admin"
          : "⚠️ Bot is NOT admin - filters (antilink/kick/delete) cannot act";

        statusNote = admin
          ? "✅ Group status: can post"
          : metadata.announce
            ? "❌ Group status: blocked (group is locked to admins-only and bot is not admin)"
            : "✅ Group status: can post (group is open to all members)";
      } catch (error) {
        adminNote = "⚠️ Could not read group info";
      }

      await sock.sendMessage(jid, {
        text:
`🛡️ PROTECTION STATUS

Antilink: ${settings.antilink || "off"}
Antigcstatus: ${settings.antigcstatus ? "on" : "off"}
Antistatusmention: ${settings.antistatusmention ? "on" : "off"}

${adminNote}
${statusNote}`
      });

      break;
    }


    case ".mute":
    case ".unmute": {
      const jid = msg.key.remoteJid;

      if (!jid.endsWith("@g.us")) {
        await sock.sendMessage(jid, {
          text: "❌ Run this inside the group you want to lock/unlock."
        });
        break;
      }

      let metadata;

      try {
        metadata = await getMetadata(jid);
      } catch (error) {
        await sock.sendMessage(jid, {
          text: "❌ Could not read group info."
        });
        break;
      }

      if (!botIsAdmin(metadata)) {
        await sock.sendMessage(jid, {
          text: "❌ I need to be a group admin to lock/unlock the group."
        });
        break;
      }

      const locking = command === ".mute";

      try {
        await sock.groupSettingUpdate(jid, locking ? "announcement" : "not_announcement");
        metadataCache.delete(jid);

        await sock.sendMessage(jid, {
          text: locking
            ? "🔒 Group locked - only admins can send messages now."
            : "🔓 Group unlocked - all members can send messages again."
        });
      } catch (error) {
        await sock.sendMessage(jid, {
          text: `❌ Could not change group setting: ${error.message}`
        });
      }

      break;
    }


    case ".muteuser":
    case ".unmuteuser": {
      const jid = msg.key.remoteJid;

      if (!jid.endsWith("@g.us")) {
        await sock.sendMessage(jid, {
          text: "❌ Run this inside the group."
        });
        break;
      }

      const quoted = msg.message?.extendedTextMessage?.contextInfo;

      let target = null;

      if (quoted?.mentionedJid?.length) {
        target = quoted.mentionedJid[0];
      } else if (quoted?.participant) {
        target = quoted.participant;
      } else {
        const numMatch = args.match(/\d{7,}/);
        if (numMatch) target = `${numMatch[0]}@s.whatsapp.net`;
      }

      if (!target) {
        await sock.sendMessage(jid, {
          text:
command === ".muteuser"
? `Usage:

Reply to the spammer's message with .muteuser 30m
or mention them: .muteuser @2348012345678 2h
or pass the number: .muteuser 2348012345678 1d

Accepts m (minutes), h (hours), d (days). Every message they send
gets deleted automatically until the mute expires.`
: `Usage:

Reply to their message with .unmuteuser
or: .unmuteuser 2348012345678`
        });
        break;
      }

      /*
       * The number/mention you give resolves to a phone-based jid, but
       * WhatsApp may report the actual sender in the group using a
       * different identifier (@lid) that isn't derivable from the phone
       * number. Resolve through the group's own participant list so the
       * stored mute key matches whatever msg.key.participant will
       * actually look like when this person sends a message.
       */
      let groupMetadata;

      try {
        groupMetadata = await getMetadata(jid);
      } catch (error) {
        await sock.sendMessage(jid, {
          text: "❌ Could not read group member list."
        });
        break;
      }

      const participantRecord = findParticipant(groupMetadata, target);

      if (!participantRecord) {
        await sock.sendMessage(jid, {
          text: "❌ Couldn't find that person in this group's member list."
        });
        break;
      }

      const canonicalTarget = participantRecord.id || participantRecord.jid || participantRecord.lid;

      if (command === ".unmuteuser") {
        const removed = unmuteUser(jid, canonicalTarget);

        await sock.sendMessage(jid, {
          text: removed
            ? `🔊 @${canonicalTarget.split("@")[0]} unmuted.`
            : `That person wasn't muted.`,
          mentions: [canonicalTarget]
        });
        break;
      }

      const durationText = args.replace(/@?\d{7,}/, "").trim() || "30m";
      const durationMs = parseDuration(durationText);

      if (!durationMs) {
        await sock.sendMessage(jid, {
          text: `❌ Couldn't parse duration "${durationText}". Try 30m, 2h or 1d.`
        });
        break;
      }

      const expiresAt = Date.now() + durationMs;

      muteUser(jid, canonicalTarget, expiresAt);

      await sock.sendMessage(jid, {
        text: `🔇 @${canonicalTarget.split("@")[0]} muted for ${durationText}. Every message they send will be deleted until then.`,
        mentions: [canonicalTarget]
      });

      break;
    }


    case ".accept": {
      const jid = msg.key.remoteJid;

      if (!jid.endsWith("@g.us")) {
        await sock.sendMessage(jid, {
          text: "❌ Run this inside the group with pending join requests."
        });
        break;
      }

      if (!sock.groupRequestParticipantsList) {
        await sock.sendMessage(jid, {
          text: "❌ This library version doesn't support join-request approval."
        });
        break;
      }

      let metadata;

      try {
        metadata = await getMetadata(jid);
      } catch (error) {
        await sock.sendMessage(jid, {
          text: "❌ Could not read group info."
        });
        break;
      }

      if (!botIsAdmin(metadata)) {
        await sock.sendMessage(jid, {
          text: "❌ I need to be a group admin to approve join requests."
        });
        break;
      }

      let pending;

      try {
        pending = await sock.groupRequestParticipantsList(jid);
      } catch (error) {
        await sock.sendMessage(jid, {
          text: `❌ Could not fetch join requests: ${error.message}`
        });
        break;
      }

      if (!pending.length) {
        await sock.sendMessage(jid, {
          text: "📋 No pending join requests."
        });
        break;
      }

      const requested = args.trim();
      const count = /^\d+$/.test(requested) ? Number(requested) : pending.length;
      const targets = pending.slice(0, count).map(p => p.jid);

      await sock.sendMessage(jid, {
        text: `✅ Approving ${targets.length} of ${pending.length} pending request(s)...`
      });

      const BATCH_SIZE = 50;
      let approved = 0;
      let failed = 0;

      for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        const batch = targets.slice(i, i + BATCH_SIZE);

        try {
          const results = await sock.groupRequestParticipantsUpdate(jid, batch, "approve");

          approved += results.filter(r => r.status === "200").length;
          failed += results.filter(r => r.status !== "200").length;
        } catch (error) {
          failed += batch.length;
          console.error("⚠️ Batch approve failed:", error.message);
        }

        if (i + BATCH_SIZE < targets.length) {
          await sleep(2000);
        }
      }

      await sock.sendMessage(jid, {
        text:
`✅ JOIN REQUESTS

Approved: ${approved}
Failed: ${failed}${pending.length > targets.length ? `\nStill pending: ${pending.length - targets.length}` : ""}`
      });

      break;
    }


    case ".tagall": {
      const jid = msg.key.remoteJid;

      if (!jid.endsWith("@g.us")) {
        await sock.sendMessage(jid, {
          text: "❌ Run this inside the group you want to tag."
        });
        break;
      }

      let metadata;

      try {
        metadata = await getMetadata(jid);
      } catch (error) {
        await sock.sendMessage(jid, {
          text: "❌ Could not read group member list."
        });
        break;
      }

      const participants = metadata.participants
        .map(p => p.id || p.jid || p.lid)
        .filter(Boolean);

      // Large groups (communities can run past 1000 members) get split
      // into batches so one message doesn't hit WhatsApp's mention/size cap.
      const BATCH_SIZE = 250;

      for (let i = 0; i < participants.length; i += BATCH_SIZE) {
        const batch = participants.slice(i, i + BATCH_SIZE);
        const lines = batch.map(id => `@${id.split("@")[0].split(":")[0]}`);
        const part = Math.floor(i / BATCH_SIZE) + 1;
        const totalParts = Math.ceil(participants.length / BATCH_SIZE);

        await sock.sendMessage(jid, {
          text:
`📢 TAG ALL (${participants.length} members${totalParts > 1 ? ` - part ${part}/${totalParts}` : ""})
${args && part === 1 ? `\n${args}\n` : ""}
${lines.join(" ")}`,
          mentions: batch
        });

        if (i + BATCH_SIZE < participants.length) {
          await sleep(1500);
        }
      }

      break;
    }


    case ".kick": {
      const jid = msg.key.remoteJid;

      if (!jid.endsWith("@g.us")) {
        await sock.sendMessage(jid, {
          text: "❌ Run this inside a group."
        });
        break;
      }

      // .kick inactive 500 6D -> mass-kick up to 500 members who have
      // been inactive for at least 6 days (oldest / never-seen first)
      if (/^inactive\b/i.test(args.trim())) {
        const rest = args.trim().replace(/^inactive\b/i, "");
        const { count, days } = parseCountDays(rest, 7);

        let bucket;

        try {
          bucket = await getMembersByActivity(jid, days);
        } catch (error) {
          await sock.sendMessage(jid, {
            text: "❌ Could not read group member list."
          });
          break;
        }

        if (!botIsAdmin(bucket.metadata)) {
          await sock.sendMessage(jid, {
            text: "❌ I need to be a group admin to remove anyone."
          });
          break;
        }

        const targets = (count ? bucket.inactive.slice(0, count) : bucket.inactive)
          .map(x => x.key)
          .filter(Boolean);

        if (!targets.length) {
          await sock.sendMessage(jid, {
            text: `📋 No members inactive for ${days}+ days.`
          });
          break;
        }

        await sock.sendMessage(jid, {
          text: `👢 Kicking ${targets.length} member(s) inactive for ${days}+ days...`
        });

        const removed = [];
        const failed = [];

        for (const target of targets) {
          if (isAdmin(bucket.metadata, target)) {
            failed.push(`${target.split("@")[0]} (admin)`);
            continue;
          }

          const ok = await removeParticipant(jid, target);

          if (ok) {
            removed.push(target.split("@")[0]);
          } else {
            failed.push(target.split("@")[0]);
          }

          await sleep(1200);
        }

        await sock.sendMessage(jid, {
          text:
`👢 MASS KICK COMPLETE (inactive ${days}+ days)

Removed: ${removed.length}
Failed: ${failed.length}${failed.length ? `\n${failed.slice(0, 30).join(", ")}${failed.length > 30 ? ` ...and ${failed.length - 30} more` : ""}` : ""}`
        });

        break;
      }

      const quoted = msg.message?.extendedTextMessage?.contextInfo;

      let targets = [];

      if (quoted?.mentionedJid?.length) {
        targets = quoted.mentionedJid;
      } else if (quoted?.participant) {
        targets = [quoted.participant];
      } else if (args) {
        targets = args
          .split(/[\s,]+/)
          .map(x => x.replace(/\D/g, ""))
          .filter(x => x.length >= 7)
          .map(x => `${x}@s.whatsapp.net`);
      }

      if (!targets.length) {
        await sock.sendMessage(jid, {
          text:
`Usage:

Reply to the spammer's message with .kick
or mention them: .kick @2348012345678
or pass the number: .kick 2348012345678`
        });
        break;
      }

      let metadata;

      try {
        metadata = await getMetadata(jid);
      } catch (error) {
        await sock.sendMessage(jid, {
          text: "❌ Could not read group info."
        });
        break;
      }

      if (!botIsAdmin(metadata)) {
        await sock.sendMessage(jid, {
          text: "❌ I need to be a group admin to remove anyone."
        });
        break;
      }

      const removed = [];
      const failed = [];

      for (const target of targets) {
        if (isAdmin(metadata, target)) {
          failed.push(`${target.split("@")[0]} (admin)`);
          continue;
        }

        const ok = await removeParticipant(jid, target);

        if (ok) {
          removed.push(target.split("@")[0]);
        } else {
          failed.push(target.split("@")[0]);
        }

        await sleep(1200);
      }

      await sock.sendMessage(jid, {
        text:
`👢 KICK

Removed: ${removed.length ? removed.join(", ") : "none"}${failed.length ? `\nFailed: ${failed.join(", ")}` : ""}`
      });

      break;
    }


    case ".listactive":
    case ".listinactive": {
      const jid = msg.key.remoteJid;

      if (!jid.endsWith("@g.us")) {
        await sock.sendMessage(jid, {
          text: "❌ Run this inside the group you want to check."
        });
        break;
      }

      const wantActive = command === ".listactive";

      // .listactive 500      -> up to 500 active members, default 7d window
      // .listactive 7D       -> all active members within 7 days
      // .listactive 500 7D   -> up to 500, within 7 days
      const { count, days } = parseCountDays(args, 7);

      let bucket;

      try {
        bucket = await getMembersByActivity(jid, days);
      } catch (error) {
        await sock.sendMessage(jid, {
          text: "❌ Could not read group member list."
        });
        break;
      }

      const pool = wantActive ? bucket.active : bucket.inactive;
      const label = wantActive ? "ACTIVE" : "INACTIVE";

      const matches = count ? pool.slice(0, count) : pool;

      if (!matches.length) {
        await sock.sendMessage(jid, {
          text: `📋 ${label} (last ${days}d): none out of ${bucket.total} members.`
        });
        break;
      }

      // Split into batches so one message never exceeds WhatsApp's
      // practical mention limit - no more silently capping at a fixed 80.
      const BATCH_SIZE = 250;
      const totalParts = Math.ceil(matches.length / BATCH_SIZE);

      for (let i = 0; i < matches.length; i += BATCH_SIZE) {
        const batch = matches.slice(i, i + BATCH_SIZE);
        const part = Math.floor(i / BATCH_SIZE) + 1;

        const lines = batch.map((x, idx) => {
          const num = (x.key || "").split("@")[0].split(":")[0];
          return `${i + idx + 1}. @${num}`;
        });

        await sock.sendMessage(jid, {
          text:
`📋 ${label} MEMBERS (last ${days}d)${totalParts > 1 ? ` - part ${part}/${totalParts}` : ""}
${matches.length} of ${bucket.total} members${count ? ` (showing up to ${count})` : ""}

${lines.join("\n")}${!wantActive && part === totalParts ? "\n\nNote: only counts activity the bot has seen since it started tracking. A long-silent member is not necessarily inactive on WhatsApp overall." : ""}`,
          mentions: batch.map(x => x.key).filter(Boolean)
        });

        if (i + BATCH_SIZE < matches.length) {
          await sleep(1500);
        }
      }

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

    generateHighQualityLinkPreview: false,

    // ---- stability ----
    syncFullHistory: false,
    markOnlineOnConnect: false,
    keepAliveIntervalMs: 25_000,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    retryRequestDelayMs: 2_000,
    emitOwnEvents: true,
    cachedGroupMetadata: async jid => {
      const hit = metadataCache.get(jid);
      return hit && Date.now() - hit.at < METADATA_TTL_MS ? hit.data : undefined;
    }
  });

  // Group Status extension
  if (!sock.stianStatus) {
    console.log("⚠️ stianStatus is not available on this socket.");
  }

  sock.ev.on("creds.update", saveCreds);

  // keep the group metadata cache honest
  sock.ev.on("groups.update", updates => {
    for (const u of updates) {
      if (u.id) metadataCache.delete(u.id);
    }
  });

  sock.ev.on("group-participants.update", ({ id }) => {
    if (id) metadataCache.delete(id);
  });

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

        if (jid.endsWith("@g.us")) {

          // Track who's actually talking, for .listactive / .listinactive
          const activitySender = msg.key.participant || msg.participant;

          if (activitySender && !msg.key?.fromMe) {
            try {
              recordActivity(jid, activitySender);
            } catch (error) {
              // non-fatal
            }
          }

          // Run protection filters regardless of who sent the message
          try {
            await handleGroupGuard(msg);
          } catch (error) {
            console.error("⚠️ Guard error:", error.message);
          }

          const groupSender = msg.key.participant || msg.participant;
          const isOwner = !!msg.key?.fromMe;
          const isSudo = !isOwner && isSudoJid(groupSender);

          if (!isOwner && !isSudo) {
            continue;
          }

          const groupText = getText(msg);

          // Every command works in groups now - the check above already
          // restricts this to the owner or an approved sudo user, so
          // there is no need for a separate per-command whitelist.
          if (groupText && groupText.trim().startsWith(".")) {
            await handleCommand(msg, groupText.trim());
          }

          continue;
        }

        // In DM: accept the owner's own messages, or a DM from a sudo user
        const dmSender = msg.key.participant || jid;
        const isOwner = !!msg.key?.fromMe;
        const isSudo = !isOwner && isSudoJid(dmSender);

        if (!isOwner && !isSudo) {
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
      reconnectAttempts = 0;

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

        reconnectAttempts++;

        // 5s, 10s, 20s, 40s ... capped at 5 minutes
        const wait = Math.min(
          5000 * Math.pow(2, reconnectAttempts - 1),
          300_000
        );

        console.log(
          `🔄 Reconnect attempt ${reconnectAttempts} in ${Math.round(wait / 1000)}s...`
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

            reconnecting = false;
          }
        }, wait);
      }
    }
  });


  /*
   * Pairing code
   *
   * If this session is already registered, this section
   * simply waits for the existing session.
   *
   * PAIR_NUMBER env var lets this run on a host with no real terminal
   * (Railway, Katabump, etc.) - their web log viewers can display output
   * but cannot send typed input back to the process, so rl.question()
   * would hang forever waiting on stdin that will never arrive. If
   * PAIR_NUMBER is set, skip the prompt entirely and pair with that
   * number instead. Locally (Termux/SSH) leave it unset and you get the
   * interactive prompt exactly as before.
   */
  if (!state.creds.registered) {

    const requestPairing = async rawNumber => {
      const number = rawNumber.replace(/\D/g, "");

      try {
        console.log("🔑 Requesting pairing code...");

        const code = await sock.requestPairingCode(number);

        console.log("");
        console.log("╔══════════════════════════════════════╗");
        console.log(`║       PAIRING CODE: ${code}       ║`);
        console.log("╚══════════════════════════════════════╝");
        console.log("");
      } catch (error) {
        console.error("❌ Pairing code failed:", error.message);
      }
    };

    if (process.env.PAIR_NUMBER) {
      console.log(`📱 Using PAIR_NUMBER from environment: ${process.env.PAIR_NUMBER}`);
      await requestPairing(process.env.PAIR_NUMBER);
    } else {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      rl.question(
        "📱 Enter your WhatsApp number with country code (example: 2348012345678): ",
        async number => {
          await requestPairing(number);
          rl.close();
        }
      );
    }
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


/*
 * Crash guards.
 *
 * A single unhandled rejection (a dropped socket mid-send, a decryption
 * failure on someone's old message) used to kill the whole process.
 * Log it and keep running instead.
 */
process.on("unhandledRejection", error => {
  console.error("⚠️ Unhandled rejection:", error?.message || error);
});

process.on("uncaughtException", error => {
  console.error("⚠️ Uncaught exception:", error?.message || error);
});

process.on("SIGINT", () => {
  console.log("\n👋 Shutting down cleanly...");
  process.exit(0);
});
