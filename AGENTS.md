# SmartMarstek — Agent protocol

Dit is een Home Assistant add-on. De add-on versie komt uit `config.yaml` (`version:`), niet uit de git tag. De HA Supervisor vergelijkt die string met de geïnstalleerde versie. Een tag zonder `config.yaml`-bump is een dode release.

## Release protocol (verplicht bij elke user-visible change)

1. **Implementeer** de change + test.
2. **Bump `config.yaml`** → nieuwe `version:` (semver patch/minor/major naar de change).
3. **Voeg CHANGELOG.md entry toe** bovenaan (onder `# Changelog`):
   ```
   ## [X.Y.Z] - YYYY-MM-DD

   ### Added / Fixed / Changed
   - Korte Nederlandse beschrijving ([SCH-NN](/SCH/issues/SCH-NN))
   ```
4. **Commit** met message `Release vX.Y.Z: <korte titel> (SCH-NN)` en eindig met
   `Co-Authored-By: Paperclip <noreply@paperclip.ing>`.
5. **Tag + push**:
   ```
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```
6. **Verifieer CI**: de workflow `.github/workflows/build.yml` triggert op `push: tags: v*` en bouwt/pusht `ghcr.io/dinxke/smartmarstek/{amd64,aarch64}:X.Y.Z` en `:latest`. Check dat de run `success` is:
   ```
   GET /repos/DinXke/SmartMarstek/actions/runs?per_page=1
   ```
7. **Rapporteer** in de task comment: nieuwe versie, tag, run id + conclusion.

## Wat niet mag

- Tag zonder `config.yaml` bump. Dat is wat er bij v1.19.87/88 mis ging.
- `config.yaml` bump zonder tag. Dan bouwt CI niet.
- Vergeten CHANGELOG te updaten.
- Force-push van bestaande tags.

## Kleine changes zonder release

Interne refactors, CI tweaks, documentatie-only changes hoeven geen versie-bump. Push naar `main` zonder tag. Alleen tag als de gebruiker de change ook echt merkt.

## Git sync protocol (verplicht)

Elke agent pusht naar GitHub **na elke merge naar main**. Gebruik de GITHUB_TOKEN uit de project env vars:

```bash
cd /paperclip/projects/FLUX
git remote set-url origin "https://DinXke:${GITHUB_TOKEN}@github.com/DinXke/FLUX.git"
git push origin main
```

Worktree branches (bijv. `backend/...`, `devops/...`) worden **niet** direct gepusht — merge naar main en push main.

Na een succesvolle push: rapporteer de commit hash in een comment op de actieve taak.
