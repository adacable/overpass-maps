#!/usr/bin/env bash
# Submit the current version to the Chrome Web Store and Firefox Add-ons.
#
#   scripts/release.sh --dry-run   check the store credentials only
#   scripts/release.sh             submit for review, then tag the release
#
# The store credentials are in .env.submit.age, encrypted to the YubiKey (see
# scripts/secrets.sh). They're decrypted straight into the submit process's
# environment: never to disk, never into this shell.
set -euo pipefail
cd "$(dirname "$0")/.."

die() { echo "release: $*" >&2; exit 1; }

dry=
[[ ${1:-} == --dry-run ]] && dry=1

version=$(node -p "require('./package.json').version")
tag="v$version"

# Only release what's been pushed, and so signed. A dry run only needs the credentials.
if [[ -z $dry ]]; then
  [[ -z $(git status --porcelain) ]] || die "the working tree has changes; commit or stash them"
  git fetch --quiet
  upstream=$(git rev-parse --verify --quiet '@{u}') || die "this branch has no upstream; push it first"
  [[ $(git rev-parse HEAD) == "$upstream" ]] || die "HEAD isn't what's pushed; run git resign and push first"
  ! git rev-parse --quiet --verify "refs/tags/$tag" >/dev/null ||
    die "$tag is already released; bump the version (npm version patch --no-git-tag-version) and commit"
fi
[[ -f .env.submit.age ]] || die "no .env.submit.age; set it up with scripts/secrets.sh"

npm run check
npm run zip
npm run zip:firefox

artifact() { local f=(.output/*-"$1".zip); [[ -f ${f[0]} ]] || die "missing .output/*-$1.zip"; echo "${f[0]}"; }

echo "Touch the YubiKey to unlock the store credentials."
node --env-file=/dev/fd/3 node_modules/.bin/wxt submit ${dry:+--dry-run} \
  --chrome-zip "$(artifact chrome)" \
  --firefox-zip "$(artifact firefox)" \
  --firefox-sources-zip "$(artifact sources)" \
  3< <(age --decrypt -j fido2-hmac .env.submit.age)

[[ -n $dry ]] && exit 0

# Signed with the YubiKey, like the commits.
git tag -s "$tag" -m "$tag"
echo "Submitted $tag for review. Push the tag with: git push origin $tag"
