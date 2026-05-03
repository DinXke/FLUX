"""
discord_bot.py – FLUX Discord slash commands (Fase 1).

Implementeert 4 /flux slash commands die live data ophalen via de FLUX backend API.
Start met: python discord_bot.py
Vereist: DISCORD_BOT_TOKEN env var, optioneel FLUX_API_URL (default http://localhost:8080)
"""

import logging
import os
from datetime import datetime, timezone

import discord
from discord import app_commands
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("flux_discord_bot")

FLUX_API_URL = os.environ.get("FLUX_API_URL", "http://localhost:8080").rstrip("/")
DISCORD_BOT_TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "")

if not DISCORD_BOT_TOKEN:
    raise RuntimeError("DISCORD_BOT_TOKEN is niet ingesteld.")


def _flux_get(path: str, params: dict | None = None) -> dict:
    url = f"{FLUX_API_URL}{path}"
    resp = requests.get(url, params=params, timeout=10)
    resp.raise_for_status()
    return resp.json()


def _fmt_power(w: float | None) -> str:
    if w is None:
        return "?"
    return f"{w:.0f} W"


class FluxBot(discord.Client):
    def __init__(self):
        intents = discord.Intents.default()
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        await self.tree.sync()
        log.info("Slash commands gesynchroniseerd.")

    async def on_ready(self):
        log.info("Ingelogd als %s (ID: %s)", self.user, self.user.id)


client = FluxBot()


@client.tree.command(name="flux-status", description="Huidige SoC (%), vermogen (W) en grid-import/export")
async def flux_status(interaction: discord.Interaction):
    await interaction.response.defer()
    try:
        soc_data = _flux_get("/api/debug/soc")

        soc: float | None = None
        # Probeer eerst last_soc_json, dan esphome_poll
        last_soc = soc_data.get("last_soc_json", {})
        if not last_soc.get("error") and last_soc.get("fresh"):
            soc = last_soc.get("soc")
        if soc is None:
            esphome = soc_data.get("esphome_poll", {})
            soc = esphome.get("average")

        soc_str = f"{soc:.1f}%" if soc is not None else "onbekend"
        ts = datetime.now(timezone.utc).strftime("%H:%M UTC")

        embed = discord.Embed(
            title="⚡ FLUX Status",
            color=0x5865F2,
            timestamp=datetime.now(timezone.utc),
        )
        embed.add_field(name="🔋 Batterij SoC", value=soc_str, inline=True)
        embed.set_footer(text=f"FLUX · {ts}")

        await interaction.followup.send(embed=embed)
    except Exception as exc:
        log.error("flux_status fout: %s", exc)
        await interaction.followup.send(f"❌ Fout bij ophalen status: {exc}")


@client.tree.command(name="flux-today", description="Energiesamenvatting van vandaag")
async def flux_today(interaction: discord.Interaction):
    await interaction.response.defer()
    try:
        p1 = _flux_get("/api/p1/today-consumption")
        import_kwh = p1.get("value", 0)

        embed = discord.Embed(
            title="📊 FLUX: Vandaag",
            color=0xFEE75C,
            timestamp=datetime.now(timezone.utc),
        )
        embed.add_field(name="🔌 Netafname vandaag", value=f"{import_kwh:.2f} kWh", inline=True)
        embed.set_footer(text="FLUX · vandaag")

        await interaction.followup.send(embed=embed)
    except Exception as exc:
        log.error("flux_today fout: %s", exc)
        await interaction.followup.send(f"❌ Fout bij ophalen dagdata: {exc}")


@client.tree.command(name="flux-forecast", description="Zonne-energieverwachting komende uren")
async def flux_forecast(interaction: discord.Interaction):
    await interaction.response.defer()
    try:
        data = _flux_get("/api/forecast/estimate")

        watts = data.get("watts", {})
        if not watts:
            await interaction.followup.send("ℹ️ Geen voorspellingsdata beschikbaar (locatie niet ingesteld?).")
            return

        now = datetime.now(timezone.utc)
        # Selecteer komende 6 uur
        upcoming = {}
        for ts_str, w in sorted(watts.items()):
            try:
                dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                if dt >= now:
                    upcoming[ts_str] = w
                if len(upcoming) >= 6:
                    break
            except ValueError:
                continue

        embed = discord.Embed(
            title="🌤️ FLUX: Zonne-prognose",
            color=0x57F287,
            timestamp=datetime.now(timezone.utc),
        )

        if upcoming:
            lines = []
            for ts_str, w in upcoming.items():
                try:
                    dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    label = dt.strftime("%H:%M")
                except ValueError:
                    label = ts_str[:16]
                lines.append(f"**{label}**: {w:.0f} W")
            embed.description = "\n".join(lines)
        else:
            embed.description = "Geen uurdata gevonden voor de komende uren."

        if data.get("stale"):
            embed.set_footer(text="⚠️ Gecachede data (ophalen mislukt)")
        else:
            embed.set_footer(text="FLUX · forecast.solar")

        await interaction.followup.send(embed=embed)
    except Exception as exc:
        log.error("flux_forecast fout: %s", exc)
        await interaction.followup.send(f"❌ Fout bij ophalen voorspelling: {exc}")


@client.tree.command(name="flux-history", description="Historisch verbruiksprofiel (gemiddeld per uur)")
@app_commands.describe(dagen="Aantal dagen terugkijken (default: 7)")
async def flux_history(interaction: discord.Interaction, dagen: int = 7):
    await interaction.response.defer()
    if not 1 <= dagen <= 90:
        await interaction.followup.send("❌ Kies een waarde tussen 1 en 90 dagen.")
        return
    try:
        data = _flux_get("/api/strategy/history", params={"days": dagen})
        hours: list = data.get("hours", [])

        if not hours:
            await interaction.followup.send("ℹ️ Geen historische data beschikbaar.")
            return

        # Toon gemiddeld verbruik per uur als tekst-grafiek (24 slots)
        max_val = max((h.get("consumption_kwh", 0) or 0) for h in hours) or 1
        lines = []
        for h in hours[:24]:
            hour_label = f"{h.get('hour', '?'):02d}:00"
            kwh = h.get("consumption_kwh", 0) or 0
            bar_len = int((kwh / max_val) * 10)
            bar = "█" * bar_len + "░" * (10 - bar_len)
            lines.append(f"`{hour_label}` {bar} {kwh:.2f} kWh")

        embed = discord.Embed(
            title=f"📈 FLUX: Verbruik afgelopen {dagen} dag(en)",
            description="\n".join(lines),
            color=0x5865F2,
            timestamp=datetime.now(timezone.utc),
        )
        embed.set_footer(text=f"FLUX · gemiddeld over {dagen} dagen")

        await interaction.followup.send(embed=embed)
    except Exception as exc:
        log.error("flux_history fout: %s", exc)
        await interaction.followup.send(f"❌ Fout bij ophalen geschiedenis: {exc}")


if __name__ == "__main__":
    client.run(DISCORD_BOT_TOKEN)
