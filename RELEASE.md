# Release Guide

How to ship a new version of Jurni with auto-update working.

## One-time setup (do once, then never again)

### 1. Apple Developer account (already configured)

Current signing identity — baked into `package.json`:

- **Team ID**: `U2EBW657CK`
- **Entity**: Everest Minds for Programming S.A.E
- **Apple ID**: `behairy@everestminds.com`

Before your first release, confirm:

- [x] Apple Developer membership active (renews Dec 5, 2026)
- [ ] **Developer ID Application certificate** in your Keychain. To verify:
  - Open Keychain Access → login → search `Developer ID Application`
  - You should see: `Developer ID Application: Everest Minds for Programming S.A.E (U2EBW657CK)`
  - If missing: Xcode → Settings → Accounts → your team → Manage Certificates → + → `Developer ID Application`
- [ ] **App-specific password** for notarization:
  - Go to <https://account.apple.com> → Sign-In & Security → App-Specific Passwords
  - Generate one called "Jurni notarization"
  - Copy into `.env` as `APPLE_APP_SPECIFIC_PASSWORD`

### 2. GitHub setup

Publish target — baked into `package.json`:

- **Owner**: `abehairy` (your personal GitHub account)
- **Repo**: `jurni-os`

Before your first release:

- [ ] `gh` CLI is installed and logged in as `abehairy` with `repo` scope
- [ ] Repo exists at `github.com/abehairy/jurni-os` (create with `gh repo create abehairy/jurni-os --public --source=. --push`)
- [ ] `GH_TOKEN` in `.env` — electron-builder uses it to upload release assets.
      Easiest: `echo "GH_TOKEN=$(gh auth token)" >> .env`

### 3. Local `.env`

Copy `.env.example` to `.env` and fill in the four values:

```bash
cp .env.example .env
# then edit .env with real values
```

`.env` is gitignored. Never commit it.

## Every release

### 1. Bump version + tag

```bash
npm version patch   # bug fix:       0.1.0 → 0.1.1
npm version minor   # new feature:   0.1.0 → 0.2.0
npm version major   # breaking:      0.1.0 → 1.0.0
```

This updates `package.json`, creates a commit, and tags it (e.g. `v0.1.1`).

### 2. Push

```bash
git push && git push --tags
```

### 3. Build + publish

```bash
# Loads .env, builds signed + notarized DMG, uploads to a GitHub Release.
set -a && source .env && set +a
npm run release
```

First build takes ~10 min because of notarization (Apple's servers scan the app). Subsequent builds are faster.

### 4. Verify

- [ ] Go to GitHub → your repo → Releases → the new tag should have:
  - `Jurni-<version>-arm64.dmg` + `Jurni-<version>-x64.dmg`
  - `Jurni-<version>-arm64-mac.zip` + `Jurni-<version>-x64-mac.zip`
  - `latest-mac.yml` — critical, this is the manifest electron-updater reads
- [ ] Install the DMG on a clean Mac (or VM). Open it. Should launch without "damaged" warnings.
- [ ] Existing users should see the "Update ready — restart to install" banner within 4 hours of their app launching (or immediately if they restart Jurni).

### 5. Dry-run (if unsure)

Want to build without publishing? Run:

```bash
set -a && source .env && set +a
npm run release:dry
```

DMGs land in `release/` locally. Upload nothing to GitHub.

## Troubleshooting

### "App is damaged, can't be opened"

Means notarization failed or the binary isn't signed. Check:
- Is `.env` loaded in the current shell?
- Does `security find-identity -v -p codesigning` list your Developer ID?
- Check `notarization` step in the build output — Apple returns error details.

### Users not getting updates

- Confirm the new release has a `latest-mac.yml` attached. If missing, `--publish always` didn't upload correctly.
- User's app checks 8 seconds after launch and every 4 hours. They can also trigger a manual check from Settings (if wired).
- If user is on a very old version, they may need to reinstall manually once. Auto-update only bridges a few minor versions reliably.

### `GH_TOKEN` rejected

GitHub tokens expire. Regenerate at <https://github.com/settings/tokens> and update `.env`.

### Notarization takes forever

Normal first run can be 5–15 min. Subsequent runs should be fast. If it hangs 30+ min, check Apple's system status at <https://developer.apple.com/system-status/>.

## Version policy

- **Patch** (`x.y.Z+1`): bug fixes, prompt changes, small UX tweaks, no migrations.
- **Minor** (`x.Y+1.0`): new connectors, new features, additive schema changes (like the `kind` column).
- **Major** (`X+1.0.0`): breaking changes — user data migrations that aren't fully backwards-compatible, or fundamental UX pivots.

Keep a `CHANGELOG.md` summarizing what changed per release so users know what they're getting.

## Rollback

If a release is broken and already published:

1. Delete the GitHub Release (keeps the tag).
2. Bump a new patch version with the fix.
3. Release again.

Users on the broken version will auto-update to the new patch on next check. If the broken version corrupts their DB, you'll need to ship a migration in the new patch — don't rely on rollback alone.
