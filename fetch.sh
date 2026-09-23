#!/data/data/com.termux/files/usr/bin/bash
#
# fetch.sh - pulls the bot files out of your phone's Downloads folder
# and puts them where the bot expects them, whether you downloaded
# loose files (index.js, db.js) or a packed tarball (whatsapp-bot-*.tar.gz).
#
# First time only:
#   termux-setup-storage      (tap Allow on the popup)
#
# Then, from inside your bot folder:
#   bash fetch.sh
#
set -e

DOWNLOADS=~/storage/downloads

if [ ! -d "$DOWNLOADS" ]; then
  echo "[x] Can't see your Downloads folder."
  echo "    Run: termux-setup-storage"
  echo "    Then run this script again."
  exit 1
fi

echo ""
echo "=============================="
echo "  Fetching bot files"
echo "=============================="
echo ""

FOUND=0

# --- Case 1: a packed tarball (whatsapp-bot-*.tar.gz) ---------------
TARBALL=$(ls -t "$DOWNLOADS"/whatsapp-bot-*.tar.gz 2>/dev/null | head -n 1 || true)

if [ -n "$TARBALL" ]; then
  echo "[..] Found tarball: $(basename "$TARBALL")"
  tar -xzf "$TARBALL" -C .
  echo "[ok] Extracted into $(pwd)"
  FOUND=1
fi

# --- Case 2: loose files (index.js, db.js, setup.sh, package.sh) ----
for f in index.js db.js setup.sh package.sh; do
  # newest download of that name, handles "index.js" and "index(1).js" etc.
  SRC=$(ls -t "$DOWNLOADS"/"${f%.js}"*."${f##*.}" 2>/dev/null | head -n 1 || true)

  if [ -n "$SRC" ]; then
    if [ "$f" = "db.js" ]; then
      mkdir -p database
      cp "$SRC" database/db.js
      echo "[ok] $f -> database/db.js"
    else
      cp "$SRC" "./$f"
      echo "[ok] $f -> ./$f"
    fi
    FOUND=1
  fi
done

if [ "$FOUND" -eq 0 ]; then
  echo "[x] Nothing matching was found in $DOWNLOADS"
  echo "    Files there right now:"
  ls -t "$DOWNLOADS" | head -n 10
  exit 1
fi

echo ""
echo "=============================="
echo "  Done"
echo "=============================="
echo ""
echo "If dependencies changed, run: npm install"
echo "Then start the bot with:      node index.js"
