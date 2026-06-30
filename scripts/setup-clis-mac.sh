#!/bin/bash
# Hypervibe - Setup CLIs (macOS)
# Opens a new Terminal.app window and installs + connects each CLI sequentially.
# Tracks per-CLI status and displays a dynamic report at the end so that
# if the user cancels a login or the install fails, the script tells them
# exactly what's still missing instead of falsely claiming success.
# Neon is handled via REST API + vault key (NEON.api_key) + run-sql helper, not via CLI or MCP.
# Wrangler (Cloudflare) is installed here, but auth = via CLOUDFLARE_API_TOKEN
# env var that /start sets BEFORE launching this script. No `wrangler login`.
#
# Why `npm install -g` and not `pnpm add -g` (despite the pnpm-only rule) :
# this script runs during /start, BEFORE `pnpm setup` has potentially
# been executed. At that point, `pnpm` may not be on the PATH or may install
# into a folder outside the PATH. `npm` ships with Node, so it's always available.
# Once /start is done, the other skills do use `pnpm add -g`.

SCRIPT='#!/bin/bash

# Status flags per CLI (KO = not ready, OK = installed + connected)
STATUS_GH=KO
STATUS_VERCEL=KO
STATUS_WRANGLER=KO

echo ""
echo "============================================"
echo " Hypervibe - CLI installation"
echo "============================================"

# --- [1/3] GitHub CLI ---
echo ""
echo "=== [1/3] GitHub CLI ==="
if ! command -v gh &>/dev/null; then
    echo "Installing..."
    brew install gh
fi
if ! gh auth status &>/dev/null 2>&1; then
    echo ""
    echo "GitHub sign-in..."
    gh auth login
fi
if gh auth status &>/dev/null 2>&1; then
    STATUS_GH=OK
    echo "[OK] GitHub CLI ready."
fi

# --- [2/3] Vercel CLI ---
echo ""
echo "=== [2/3] Vercel CLI ==="
if ! command -v vercel &>/dev/null; then
    echo "Installing..."
    npm install -g vercel
fi
if ! vercel whoami &>/dev/null 2>&1; then
    echo ""
    echo "Vercel sign-in..."
    vercel login
fi
if vercel whoami &>/dev/null 2>&1; then
    STATUS_VERCEL=OK
    echo "[OK] Vercel CLI ready."
fi

# (Resend CLI removed: email sent via the Resend API with the key from the vault.)

# --- [3/3] Wrangler CLI (Cloudflare - Workers, R2) ---
# No login: wrangler picks up CLOUDFLARE_API_TOKEN env var (set by /start before).
echo ""
echo "=== [3/3] Wrangler CLI (Cloudflare) ==="
if ! command -v wrangler &>/dev/null; then
    echo "Installing..."
    npm install -g wrangler
fi
if wrangler whoami &>/dev/null 2>&1; then
    STATUS_WRANGLER=OK
    echo "[OK] Wrangler CLI ready (Cloudflare token detected)."
else
    echo ""
    echo "[INFO] Wrangler installed but the Cloudflare token is not detected yet."
    echo "Go back to Claude - it will configure the token via export CLOUDFLARE_API_TOKEN."
fi

# --- Final report ---
echo ""
echo "============================================"
echo " Final report"
echo "============================================"
print_status() {
    if [ "$2" = "OK" ]; then
        echo "  [OK] $1"
    else
        echo "  [MISSING] $1 - installation or sign-in incomplete"
    fi
}
print_status "GitHub CLI" "$STATUS_GH"
print_status "Vercel CLI" "$STATUS_VERCEL"
print_status "Wrangler CLI (Cloudflare token)" "$STATUS_WRANGLER"
echo "============================================"
echo ""

if [ "$STATUS_GH" = "OK" ] && [ "$STATUS_VERCEL" = "OK" ] && [ "$STATUS_WRANGLER" = "OK" ]; then
    echo "Everything is installed and connected!"
    echo "Go back to Claude to continue."
else
    echo "Some tools are not ready yet."
    echo "Go back to Claude - it will tell you what is left to do"
    echo "and offer to rerun this script to finish."
fi
echo ""
read -p "Press Enter to close..."
'

TMP=$(mktemp /tmp/hypervibe-setup-clis.XXXXXX.sh)
echo "$SCRIPT" > "$TMP"
chmod +x "$TMP"
# AppleScript can't handle the bash `'\''` quote-escape idiom (it isn't in single
# quotes here - we're already inside double quotes for `osascript -e`). Pass the
# tempfile path unquoted; mktemp guarantees it's free of spaces/special chars.
osascript -e "tell application \"Terminal\" to do script \"bash $TMP\"" -e "tell application \"Terminal\" to activate"
