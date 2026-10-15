#!/usr/bin/env bash
# Create or edit the store credentials, kept encrypted to the YubiKey's FIDO2
# key with age-plugin-fido2-hmac.
#
#   scripts/secrets.sh init   once: make a YubiKey recipient and an empty template
#   scripts/secrets.sh edit   decrypt to a private temp file, edit, re-encrypt, delete
#
# Needs age and age-plugin-fido2-hmac on PATH (and libfido2: brew install libfido2).
set -euo pipefail
cd "$(dirname "$0")/.."

die() { echo "secrets: $*" >&2; exit 1; }
RECIPIENT=.env.submit.recipient

encrypt() { age --encrypt --recipient "$(cat "$RECIPIENT")" --output .env.submit.age "$1"; }

case ${1:-} in
  init)
    [[ ! -e .env.submit.age ]] || die ".env.submit.age already exists; use: scripts/secrets.sh edit"
    command -v age-plugin-fido2-hmac >/dev/null || die "age-plugin-fido2-hmac isn't installed"
    echo "Creating a YubiKey recipient: you'll be asked for the PIN and a touch."
    echo "Answer yes to requiring the PIN, and no to a separate identity."
    age-plugin-fido2-hmac -g | grep -o 'age1[a-z0-9]*' | head -1 > "$RECIPIENT"
    [[ -s $RECIPIENT ]] || die "no recipient was generated"
    tmp=$(mktemp)
    trap 'rm -P "$tmp"' EXIT
    cat > "$tmp" <<'EOF'
# Chrome Web Store, API v2 with a service account
CHROME_API_VERSION=v2
CHROME_EXTENSION_ID=
CHROME_PUBLISHER_ID=
CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL=
# The JSON key's private_key, in double quotes with \n for line breaks
CHROME_SERVICE_ACCOUNT_PRIVATE_KEY=""

# Firefox Add-ons: addons.mozilla.org/developers/addon/api/key/
FIREFOX_EXTENSION_ID=overpass-maps@thingsarebootwontfix.com
FIREFOX_JWT_ISSUER=
FIREFOX_JWT_SECRET=
EOF
    encrypt "$tmp"
    echo "Made .env.submit.age. Fill it in with: scripts/secrets.sh edit"
    ;;
  edit)
    [[ -f .env.submit.age && -f $RECIPIENT ]] || die "nothing to edit yet; run: scripts/secrets.sh init"
    tmp=$(mktemp)
    trap 'rm -P "$tmp"' EXIT
    echo "Touch the YubiKey to decrypt."
    age --decrypt -j fido2-hmac --output "$tmp" .env.submit.age
    "${EDITOR:-vi}" "$tmp"
    encrypt "$tmp"
    echo "Saved .env.submit.age."
    ;;
  *)
    die "usage: scripts/secrets.sh init|edit"
    ;;
esac
