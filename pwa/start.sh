#!/bin/bash
# ───────────────────────────────────────────────
# Drape PWA — Local Development Server
# Runs on http://localhost:3000
# Access from phone: http://<your-mac-ip>:3000
# ───────────────────────────────────────────────

echo ""
echo "  🧥 Drape — Virtual Wardrobe PWA"
echo "  ─────────────────────────────────"
echo ""
echo "  Starting local server..."
echo ""

# Get local IP for mobile access
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "unknown")

echo "  📱 To test on your phone:"
echo "     1. Connect phone to same WiFi as this Mac"
echo "     2. Open Safari/Chrome and go to:"
echo "        http://${LOCAL_IP}:3000"
echo ""
echo "  💻 On this Mac:"
echo "     http://localhost:3000"
echo ""
echo "  ℹ️  Camera requires HTTPS in production."
echo "     For local dev, http://localhost is fine,"
echo "     but your phone needs the IP address above."
echo "     For phone testing with camera, use:"
echo "     npx serve --ssl-cert --ssl-key (self-signed)"
echo ""
echo "  Press Ctrl+C to stop."
echo ""

# Use npx serve (zero install)
npx -y serve . --listen 3000 --cors
