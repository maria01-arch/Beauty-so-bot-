const fs = require("fs");
const path = require("path");

const DATA_DIR = __dirname;
const DB_FILE = path.join(DATA_DIR, "groups.json");

function ensureDatabase() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify([], null, 2)
    );
  }
}

function loadGroups() {
  ensureDatabase();

  try {
    const data = fs.readFileSync(DB_FILE, "utf8");
    const groups = JSON.parse(data);

    if (!Array.isArray(groups)) {
      return [];
    }

    return groups;
  } catch (error) {
    console.error("❌ Could not read groups database.");
    return [];
  }
}

function saveGroups(groups) {
  ensureDatabase();

  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(groups, null, 2)
  );
}

function saveGroup(id, name) {
  const groups = loadGroups();

  const existing = groups.find(
    group => group.id === id
  );

  if (existing) {
    existing.name = name;
    existing.last_seen = Date.now();
  } else {
    groups.push({
      id,
      name,
      enabled: false,
      added_at: Date.now(),
      last_seen: Date.now()
    });
  }

  saveGroups(groups);
}

function getGroups() {
  return loadGroups();
}

function getEnabledGroups() {
  return loadGroups().filter(
    group => group.enabled === true
  );
}

function setEnabled(id, enabled) {
  const groups = loadGroups();

  const group = groups.find(
    group => group.id === id
  );

  if (!group) {
    return false;
  }

  group.enabled = Boolean(enabled);

  saveGroups(groups);

  return true;
}

function setMultipleEnabled(ids, enabled) {
  const groups = loadGroups();

  let changed = 0;
  let notFound = [];

  for (const id of ids) {
    const group = groups.find(
      group => group.id === id
    );

    if (!group) {
      notFound.push(id);
      continue;
    }

    group.enabled = Boolean(enabled);
    changed++;
  }

  saveGroups(groups);

  return {
    changed,
    notFound
  };
}

/*
 * Remove groups this account is no longer a member of.
 *
 * Without this, groups saved under a previous phone number stay in the
 * database forever. Posting to them makes WhatsApp reply 403 "forbidden",
 * because the logged-in account is not a participant.
 */
function pruneGroups(activeIds) {
  const active = new Set(activeIds);
  const groups = loadGroups();

  const kept = groups.filter(
    group => active.has(group.id)
  );

  const removed = groups.length - kept.length;

  if (removed > 0) {
    saveGroups(kept);
  }

  return {
    removed,
    kept: kept.length
  };
}

/* ---------- per-group settings (antilink, antigcstatus, ...) ---------- */

function getSetting(id, key, fallback) {
  const group = loadGroups().find(g => g.id === id);

  if (!group || !group.settings || group.settings[key] === undefined) {
    return fallback;
  }

  return group.settings[key];
}

function setSetting(id, key, value) {
  const groups = loadGroups();
  const group = groups.find(g => g.id === id);

  if (!group) {
    return false;
  }

  if (!group.settings) {
    group.settings = {};
  }

  group.settings[key] = value;

  saveGroups(groups);

  return true;
}

function getSettings(id) {
  const group = loadGroups().find(g => g.id === id);
  return (group && group.settings) || {};
}

/* ---------- member activity (for .listactive / .listinactive) ---------- */

// Skip the write if we already recorded this person recently -
// with active groups this avoids rewriting the whole JSON file on
// every single message.
const ACTIVITY_WRITE_THROTTLE_MS = 5 * 60 * 1000;

function recordActivity(groupId, participantId) {
  const groups = loadGroups();
  const group = groups.find(g => g.id === groupId);

  if (!group) return;

  if (!group.activity) {
    group.activity = {};
  }

  const last = group.activity[participantId] || 0;

  if (Date.now() - last < ACTIVITY_WRITE_THROTTLE_MS) {
    return;
  }

  group.activity[participantId] = Date.now();

  saveGroups(groups);
}

function getActivityMap(groupId) {
  const group = loadGroups().find(g => g.id === groupId);
  return (group && group.activity) || {};
}

/* ---------- sudo users (people other than the bot's own number who ---------- *
 * ---------- are allowed to issue commands, in DM and in groups)     ---------- */

const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

function ensureSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(
      SETTINGS_FILE,
      JSON.stringify({ sudo: [] }, null, 2)
    );
  }
}

function loadSettings() {
  ensureSettings();

  try {
    const data = fs.readFileSync(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(data);

    if (!parsed || typeof parsed !== "object") {
      return { sudo: [] };
    }

    if (!Array.isArray(parsed.sudo)) {
      parsed.sudo = [];
    }

    return parsed;
  } catch (error) {
    console.error("❌ Could not read settings database.");
    return { sudo: [] };
  }
}

function saveSettings(settings) {
  ensureSettings();

  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify(settings, null, 2)
  );
}

// numbers are stored as bare digits, e.g. "2348012345678"
function normalizeNumber(input) {
  return String(input || "").replace(/\D/g, "");
}

function getSudoList() {
  return loadSettings().sudo;
}

function addSudo(number) {
  const num = normalizeNumber(number);

  if (!num) return false;

  const settings = loadSettings();

  if (!settings.sudo.includes(num)) {
    settings.sudo.push(num);
    saveSettings(settings);
  }

  return true;
}

function removeSudo(number) {
  const num = normalizeNumber(number);

  const settings = loadSettings();
  const before = settings.sudo.length;

  settings.sudo = settings.sudo.filter(x => x !== num);

  saveSettings(settings);

  return settings.sudo.length !== before;
}

// jid can be "2348012345678@s.whatsapp.net", "...@lid", with or without ":device"
function isSudoJid(jid) {
  if (!jid) return false;

  const num = normalizeNumber(jid.split("@")[0].split(":")[0]);

  return getSudoList().includes(num);
}

/* ---------- per-user mutes (delete everything they post, for a while) ---------- */

function muteUser(groupId, userId, expiresAt) {
  const groups = loadGroups();
  const group = groups.find(g => g.id === groupId);

  if (!group) return false;

  if (!group.mutedUsers) {
    group.mutedUsers = {};
  }

  group.mutedUsers[userId] = expiresAt;

  saveGroups(groups);

  return true;
}

function unmuteUser(groupId, userId) {
  const groups = loadGroups();
  const group = groups.find(g => g.id === groupId);

  if (!group || !group.mutedUsers) return false;

  const had = userId in group.mutedUsers;

  delete group.mutedUsers[userId];

  saveGroups(groups);

  return had;
}

// Also lazily prunes expired entries as it reads, so the file doesn't
// accumulate stale mutes forever.
function isUserMuted(groupId, userId) {
  const groups = loadGroups();
  const group = groups.find(g => g.id === groupId);

  if (!group || !group.mutedUsers) return false;

  const expiresAt = group.mutedUsers[userId];

  if (!expiresAt) return false;

  if (Date.now() >= expiresAt) {
    delete group.mutedUsers[userId];
    saveGroups(groups);
    return false;
  }

  return true;
}

module.exports = {
  saveGroup,
  recordActivity,
  getActivityMap,
  getSetting,
  setSetting,
  getSettings,
  pruneGroups,
  getGroups,
  getEnabledGroups,
  setEnabled,
  setMultipleEnabled,
  getSudoList,
  addSudo,
  removeSudo,
  isSudoJid,
  muteUser,
  unmuteUser,
  isUserMuted
};
