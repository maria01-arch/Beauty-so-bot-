#!/data/data/com.termux/files/usr/bin/bash
#
# Beauty's Bot - update script for Termux
#
# Put this file, index.js and db.js in the SAME folder as your bot,
# then run:
#
#     bash setup.sh
#
# After that you only ever need:  node index.js
#
set -e

echo ""
echo "=============================="
echo "  Beauty's Bot - update"
echo "=============================="
echo ""

# --- 1. sanity check -----------------------------------------------
if [ ! -f "package.json" ]; then
  echo "[x] No package.json here."
  echo "    cd into your bot folder first, then run this again."
  exit 1
fi

for f in index.js db.js; do
  if [ ! -f "$f" ]; then
    echo "[x] Missing $f in this folder."
    echo "    Copy both downloaded files here first."
    exit 1
  fi
done

# --- 2. back up what is already there ------------------------------
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="backup-$STAMP"
mkdir -p "$BACKUP"

[ -f index.js ]          && cp index.js          "$BACKUP/index.js.old"
[ -f database/db.js ]    && cp database/db.js    "$BACKUP/db.js.old"
[ -f database/groups.json ] && cp database/groups.json "$BACKUP/groups.json"

echo "[ok] Backed up to $BACKUP/"

# --- 3. install the new files --------------------------------------
mkdir -p database
mv db.js database/db.js
echo "[ok] database/db.js installed"
echo "[ok] index.js installed"

# --- 4. dependencies ------------------------------------------------
if [ ! -d "node_modules/stian-baileys" ]; then
  echo "[..] Installing dependencies (this takes a while)..."
  npm install
else
  echo "[ok] Dependencies already present"
fi

# --- 5. done --------------------------------------------------------
echo ""
echo "=============================="
echo "  Done."
echo "=============================="
echo ""
echo "Start the bot with:"
echo ""
echo "    node index.js"
echo ""
echo "Tip: run 'termux-wake-lock' first so Android does not"
echo "     kill the bot when the screen turns off."
echo ""
