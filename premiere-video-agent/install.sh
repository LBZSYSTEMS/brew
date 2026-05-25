#!/usr/bin/env bash
# Installs the Premiere Video Agent CEP extension and Python backend.
set -euo pipefail

BUNDLE_ID="com.lbzsystems.premierevideoagent"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Detect OS ────────────────────────────────────────
case "$(uname -s)" in
  Darwin)
    CEP_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/$BUNDLE_ID"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    CEP_DIR="$APPDATA/Adobe/CEP/extensions/$BUNDLE_ID"
    ;;
  Linux)
    CEP_DIR="$HOME/.config/Adobe/CEP/extensions/$BUNDLE_ID"
    ;;
  *)
    echo "Unsupported OS." && exit 1 ;;
esac

# ── Copy extension ───────────────────────────────────
echo "Installing CEP extension → $CEP_DIR"
mkdir -p "$CEP_DIR"
cp -r "$SCRIPT_DIR/extension/." "$CEP_DIR/"
echo "  Extension copied."

# ── Download CSInterface.js ──────────────────────────
CS_JS="$CEP_DIR/js/CSInterface.js"
if [ ! -f "$CS_JS" ]; then
  echo "  Downloading CSInterface.js…"
  curl -fsSL \
    "https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_12.x/CSInterface.js" \
    -o "$CS_JS" || {
      echo "  WARNING: Could not download CSInterface.js. Download manually from:"
      echo "  https://github.com/Adobe-CEP/CEP-Resources"
    }
fi

# ── Disable CEP signature check (dev mode) ──────────
echo "  Enabling CEP PlayerDebugMode…"
if [[ "$(uname -s)" == "Darwin" ]]; then
  defaults write com.adobe.CSXS.12 PlayerDebugMode 1 2>/dev/null || true
  defaults write com.adobe.CSXS.11 PlayerDebugMode 1 2>/dev/null || true
  defaults write com.adobe.CSXS.10 PlayerDebugMode 1 2>/dev/null || true
elif [[ "$(uname -s)" == MINGW* ]]; then
  reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f 2>/dev/null || true
fi

# ── Python backend ───────────────────────────────────
echo ""
echo "Setting up Python backend…"
cd "$SCRIPT_DIR/backend"
if command -v python3 &>/dev/null; then
  python3 -m pip install --quiet -r requirements.txt && echo "  Python deps installed." || \
    echo "  (optional) pip install failed — WAV-only mode will still work."
else
  echo "  Python 3 not found. Backend won't start automatically."
fi

echo ""
echo "Done! Restart Adobe Premiere Pro, then:"
echo "  Window → Extensions → Video Agent"
echo ""
echo "Start the beat-detection backend manually:"
echo "  python3 $SCRIPT_DIR/backend/server.py"
