# BCRutility

Nebula (patched for NeoForge) **and** the distribution root for the BCR Launcher,
in one repo. `ROOT` in `.env` points at this folder, so generated output lands
here and GitHub serves it over raw. Same arrangement as the old NRutility repo.

Currently ships **Minecraft 1.21.1 / NeoForge 21.1.262**.

## Layout

| Path | Committed? | What it is |
| --- | --- | --- |
| `src/`, `package.json`, `libraries/` | yes | Nebula itself |
| `distribution.json` | yes | the index the launcher reads |
| `repo/` | yes | NeoForge + Minecraft libraries clients download |
| `servers/` | yes | per-server config and **your mod jars** |
| `meta/`, `schemas/` | yes | Nebula inputs; launcher never reads these |
| `cache/` | **no** | installer scratch, ~128 MB, regenerates |
| `node_modules/`, `dist/`, `.env` | **no** | local build + local paths |
| `nebula.bat` | **no** | machine-specific helper |

## Everyday workflow

1. Drop mod jars into `servers/BlackCloverRepublic-1.21.1/forgemods/required/`
2. Regenerate the index:

   ```
   npm start -- generate distro
   ```

3. Commit and push in GitHub Desktop.

Players get the new jars on next launch — the launcher diffs `distribution.json`
against what they have and downloads the difference.

`optionalon/` and `optionaloff/` hold toggleable mods. Non-mod files that belong in
the game directory (configs, resource packs) go in `files/`.

### Node version

Nebula needs **Node 20.19+**; its yargs dependency hard-errors below that. If
`npm start` fails with a yargs version error, your system Node is too old — use
`.\nebula.bat generate distro` instead, which falls back to the portable Node 22
at `C:\Users\Bigza\BCR\node22`. Installing Node 22 system-wide makes plain
`npm start` work and the wrapper unnecessary.

### Other commands

```
npm start -- generate server <id> <mcVersion> --neoforge <version>
npm start -- generate schemas
npm start -- generate distro --invalidateCache   # rerun the NeoForge installer
npm start -- generate distro --installLocal      # also install to the launcher's data folder for local testing
```

`--neoforge latest` and `--neoforge recommended` resolve against NeoForge's maven;
`recommended` picks the newest non-`-beta` build.

## URLs must stay in sync

`BASE_URL` in `.env` is baked into every artifact URL in `distribution.json`. If you
change it you **must** re-run `generate distro`, or every download points at the old
host. It must also match `REMOTE_DISTRO_URL` in the launcher's
`app/assets/js/distromanager.js`.

Both currently expect this repo to be public at `Vesuviuz1/BCRutility` on branch
`main`.

## File size limits

GitHub rejects any file over **100 MB**. The generated `repo/` is fine (largest
file ~18 MB), but the Black Clover mod jar is ~121 MB and **will be rejected**.
Options: Git LFS (watch the 1 GB/month free bandwidth quota — 100 players × 121 MB
blows through it immediately), a GitHub Release asset, or a real static host.

Clients currently download ~66 MB. About 32 MB of that is `client-...-srg.jar` and
`client-...-slim.jar`, which are installer build intermediates — see the note in
`src/resolver/neoforge/NeoForge.resolver.ts`. Dropping them from `configure()` would
nearly halve the download, but it has not been verified against a real game launch,
so they are published for safety.

## How NeoForge support works

Upstream Nebula supports only Forge and Fabric, and neither can ship a modern pack
through Helios: Forge removed `--fml.modLists` in 1.20.3, which is the only way the
launcher loads mods from its shared modstore.

NeoForge's FancyModLoader still implements `modLists`/`mods`/`mavenRoots`, so it
drops into the existing Forge 1.17+ launch path. **The launcher is unmodified** apart
from its distro URL. The resolver publishes the NeoForge universal jar as a
`ForgeHosted` module with a `VersionManifest` submodule — helios-core finds the mod
loader by exactly that shape, and for Minecraft ≥ 1.13 reads the manifest instead of
unzipping it. `mainClass`, JVM args and game args then come straight from that
manifest, so NeoForge's bootstrap and module path pass through untouched.

Full reasoning is in the `feat: add NeoForge support` commit message.

## This repo vs upstream Nebula

A real clone of `dscalzi/Nebula`, so it opens normally in VS Code and GitHub Desktop.

- `main` carries the NeoForge work on top of upstream `master`.
- The remote is named **`upstream`** (dscalzi's repo) — you have no push access
  there. GitHub Desktop's **Publish repository** will create your own and set
  `origin`, leaving `upstream` intact.

Pulling upstream changes later:

```
git fetch upstream
git rebase upstream/master
npm i && npm run build
```

`.env` is gitignored, so it survives all of this.

## Verifying a distro

```
node C:\Users\Bigza\BCR\verify\verify-distro.cjs C:\Users\Bigza\OneDrive\Desktop\BCRutility\distribution.json
node C:\Users\Bigza\BCR\verify\audit-sizes.cjs
```

The first parses the index with the launcher's own helios-core and reproduces
ProcessBuilder's classpath selection. The second reports client download size.
Nebula's built-in `validate` command is an upstream stub that checks nothing.

## Still outstanding

- `servers/BlackCloverRepublic-1.21.1/servermeta.json` has `address: localhost:25565`
  — needs the real server IP.
- No Discord `clientId` in `meta/distrometa.json`, so Rich Presence is off.
- `meta/distrometa.json` points `rss` at a `news.xml` in this repo that does not
  exist yet; the launcher's news panel stays empty until it does.
- The mod jar size problem above.
- An actual in-game launch has never been tested — it needs this repo published,
  the mod added, and real auth.
