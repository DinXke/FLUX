# FLUX — Agent protocol

FLUX is een standalone energiestuurapplicatie (Docker). De versie staat in `config.yaml` (`version:`). SmartMarstek is de parallelle HA addon variant — blijf daar af.

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

## Integraties — gebruik bestaande libraries (verplicht)

> "Beter goed gejat dan slecht gemaakt." — CEO

Bij elke nieuwe integratie of feature: **zoek eerst** naar bestaande Python libraries (PyPI) of open source projecten (GitHub) voordat je zelf iets bouwt.

### Aanpak

1. **PyPI zoeken** — `pip search` of https://pypi.org voor de integratie (bijv. `daikin`, `bosch`, `homewizard`, `entsoe`)
2. **GitHub zoeken** — zoek naar bestaande clients/wrappers (bijv. `site:github.com python daikin onecta`)
3. **Beoordeel** op: actief onderhouden, licentie (MIT/Apache), README kwaliteit, issues/stars
4. **Voorkeur:** gevestigde library boven eigen implementatie, tenzij de library te zwaar of ongeschikt is
5. **Documenteer** in de task comment welke library gekozen is en waarom

### Voorbeelden voor FLUX

| Integratie | Te onderzoeken libraries |
|---|---|
| Daikin Onecta | `pydaikin`, `daikin-controller`, `onecta-client` |
| Bosch Home Connect | `home-connect-python`, `pyboschconnect` |
| HomeWizard | `python-homewizard-energy` |
| ENTSO-E | `entsoe-py` (al in gebruik) |
| Frank Energie | `frank-energie-python` |
| SMA Modbus | `pymodbus` (al in gebruik) |
| Authenticatie | `flask-jwt-extended`, `flask-login` |
