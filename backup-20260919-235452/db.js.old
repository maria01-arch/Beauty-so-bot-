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
  } else {
    groups.push({
      id,
      name,
      enabled: false,
      added_at: Date.now()
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

module.exports = {
  saveGroup,
  getGroups,
  getEnabledGroups,
  setEnabled,
  setMultipleEnabled
};
