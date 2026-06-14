/**
 * RADIANT PLAZA VALORANT RANK BOT
 * Kaikki yhdessä tiedostossa — kopioi tämä vlrank.js:n tilalle.
 *
 * Railway Variables:
 *   DISCORD_TOKEN      = botin token
 *   CLIENT_ID          = botin Application ID (Discord Developer Portal)
 *   GUILD_ID           = serverin ID (oikealla klikillä Discord-serveriä → Copy Server ID)
 *   TRACKER_API_KEY    = tracker.gg API key
 *   OWNER_IDS          = sinun Discord ID (pilkulla erotettu jos useampi)
 *   RANK_BANNER_URL    = (valinnainen) bannerin URL
 *   RANK_UPDATE_HOURS  = (valinnainen, oletus 6) kuinka usein rankit päivitetään
 *   DATABASE_URL       = (valinnainen) PostgreSQL-yhteys, muuten käyttää JSON-tiedostoa
 */

const {
  Client,
  GatewayIntentBits,
  Collection,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require("discord.js");

const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ─── Ympäristömuuttujat ───────────────────────────────────────────────────────

const DISCORD_TOKEN   = process.env.DISCORD_TOKEN || "";
const CLIENT_ID       = process.env.CLIENT_ID || "";
const GUILD_ID        = process.env.GUILD_ID || ""; // Guild = instant, tyhjä = global (1h viive)
const TRACKER_API_KEY = process.env.TRACKER_API_KEY || "";
const OWNER_IDS       = (process.env.OWNER_IDS || "772345007469756436")
  .split(",").map((x) => x.trim()).filter(Boolean);
const BANNER_URL      = process.env.RANK_BANNER_URL ||
  "https://cdn.discordapp.com/attachments/000000000000000000/000000000000000000/radiant-plaza-banner.png";
const UPDATE_HOURS    = Number(process.env.RANK_UPDATE_HOURS || 6);
const UPDATE_MS       = Math.max(1, UPDATE_HOURS) * 60 * 60 * 1000;

// ─── Vakiot ───────────────────────────────────────────────────────────────────

const BUTTON_ID    = "radiant_plaza_find_rank";
const MODAL_ID     = "radiant_plaza_rank_modal";
const RIOT_ID_INPUT = "radiant_plaza_riot_id";
const LOCAL_DB_PATH = path.join(__dirname, "rank_links.json");

const RANK_ROLES = [
  "Iron 1", "Iron 2", "Iron 3",
  "Bronze 1", "Bronze 2", "Bronze 3",
  "Silver 1", "Silver 2", "Silver 3",
  "Gold 1", "Gold 2", "Gold 3",
  "Platinum 1", "Platinum 2", "Platinum 3",
  "Diamond 1", "Diamond 2", "Diamond 3",
  "Ascendant 1", "Ascendant 2", "Ascendant 3",
  "Immortal 1", "Immortal 2", "Immortal 3",
  "Radiant",
];

const ROLE_COLORS = {
  Iron: 0x4b5563, Bronze: 0x9a5a2f, Silver: 0xc0c0c0,
  Gold: 0xffd700, Platinum: 0x36d1dc, Diamond: 0x7dd3fc,
  Ascendant: 0x22c55e, Immortal: 0xdc2626, Radiant: 0xfacc15,
};

// ─── Tila ─────────────────────────────────────────────────────────────────────

let pgPool = null;
let updateLoopStarted = false;
const cooldown = new Map();

// ─── 1. Rekisteröi slash-komento Discordiin ───────────────────────────────────

async function registerCommands() {
  if (!DISCORD_TOKEN || !CLIENT_ID) {
    console.error("❌ DISCORD_TOKEN tai CLIENT_ID puuttuu. Lisää Railway Variables.");
    process.exit(1);
  }

  const commands = [
    new SlashCommandBuilder()
      .setName("vlrank")
      .setDescription("Lähettää Valorant rank verification panelin.")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),
  ];

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log(`[Radiant Rank] ✅ Slash-komennot rekisteröity palvelimelle ${GUILD_ID} (instant).`);
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log("[Radiant Rank] ✅ Slash-komennot rekisteröity globaalisti (voi kestää 1h näkyä).");
    }
  } catch (err) {
    console.error("[Radiant Rank] ❌ Slash-komennon rekisteröinti epäonnistui:", err);
  }
}

// ─── 2. Discord-client ───────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "vlrank") {
      return handleVlrankCommand(interaction);
    }
    if (interaction.isButton() && interaction.customId === BUTTON_ID) {
      return handleRankButton(interaction);
    }
    if (interaction.isModalSubmit() && interaction.customId === MODAL_ID) {
      return handleRankModal(interaction);
    }
  } catch (err) {
    console.error("[Radiant Rank] Interaction error:", err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "❌ Tapahtui virhe. Tarkista Railway logs.", ephemeral: true }).catch(() => {});
    }
  }
});

client.once("ready", async () => {
  console.log(`[Radiant Rank] ✅ Kirjautunut: ${client.user.tag}`);

  if (!updateLoopStarted) {
    updateLoopStarted = true;

    setTimeout(() => {
      updateAllLinkedRanks().catch((err) =>
        console.error("[Radiant Rank] First auto update failed:", err)
      );
    }, 30_000);

    setInterval(() => {
      updateAllLinkedRanks().catch((err) =>
        console.error("[Radiant Rank] Auto update failed:", err)
      );
    }, UPDATE_MS);

    console.log(`[Radiant Rank] Auto update käynnissä joka ${UPDATE_HOURS}h.`);
  }
});

// ─── 3. Käynnistys ───────────────────────────────────────────────────────────

(async () => {
  await initDatabase();
  await registerCommands();
  await client.login(DISCORD_TOKEN);
})();

// ─── Komennon käsittely ───────────────────────────────────────────────────────

async function handleVlrankCommand(interaction) {
  if (!OWNER_IDS.includes(interaction.user.id)) {
    return interaction.reply({ content: "❌ Tämä komento on vain ownerille.", ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setColor(0xfacc15)
    .setTitle("⭐ Radiant Plaza Rank Verification")
    .setDescription(
      [
        "**Verify your Valorant rank and get your Discord role automatically.**",
        "",
        "Press the **⭐ Find Rank** button below.",
        "",
        "**How it works:**",
        "1. Press the button.",
        "2. Write your Valorant Riot ID.",
        "3. The bot checks your Tracker profile.",
        "4. You get the correct Discord rank role.",
        "",
        "**Riot ID format:**",
        "`Name#TAG`",
        "",
        "**Example:**",
        "`RadiantPlayer#EUW`",
        "",
        "Your rank role will also update automatically if your rank changes.",
      ].join("\n")
    )
    .setImage(BANNER_URL)
    .setFooter({ text: "Radiant Plaza • Community Marketplace" })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTON_ID)
      .setLabel("Find Rank")
      .setEmoji("⭐")
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.channel.send({ embeds: [embed], components: [row] });

  return interaction.reply({ content: "✅ Valorant rank panel lähetetty tähän kanavaan.", ephemeral: true });
}

// ─── Nappi → modal ────────────────────────────────────────────────────────────

async function handleRankButton(interaction) {
  const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle("Find your Valorant rank");

  const riotInput = new TextInputBuilder()
    .setCustomId(RIOT_ID_INPUT)
    .setLabel("Valorant Riot ID")
    .setPlaceholder("Example: Player#EUW")
    .setMinLength(3)
    .setMaxLength(32)
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  modal.addComponents(new ActionRowBuilder().addComponents(riotInput));
  return interaction.showModal(modal);
}

// ─── Modal → rank fetch ───────────────────────────────────────────────────────

async function handleRankModal(interaction) {
  const now = Date.now();
  const last = cooldown.get(interaction.user.id) || 0;

  if (now - last < 60_000) {
    return interaction.reply({ content: "⏳ Odota hetki ennen kuin haet rankkia uudestaan.", ephemeral: true });
  }

  cooldown.set(interaction.user.id, now);

  const riotId = cleanRiotId(interaction.fields.getTextInputValue(RIOT_ID_INPUT));

  if (!isValidRiotId(riotId)) {
    return interaction.reply({
      content: "❌ Kirjoita Riot ID muodossa `Name#TAG`, esimerkiksi `Player#EUW`.",
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  if (!interaction.guild) return interaction.editReply("❌ Tätä voi käyttää vain Discord serverillä.");
  if (!TRACKER_API_KEY) return interaction.editReply("❌ Botilta puuttuu `TRACKER_API_KEY`. Lisää se Railway → Variables.");

  const botMember = await interaction.guild.members.fetchMe();

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.editReply("❌ Botilta puuttuu **Manage Roles** permission.");
  }

  let rank;

  try {
    const trackerData = await fetchValorantTrackerProfile(riotId);
    rank = extractRank(trackerData);
  } catch (err) {
    console.error("[Radiant Rank] Tracker fetch failed:", { status: err?.response?.status, message: err.message });

    if (err?.response?.status === 401) return interaction.editReply("❌ Tracker API key on väärä tai ei toimi. Tarkista Railway `TRACKER_API_KEY`.");
    if (err?.response?.status === 403) return interaction.editReply("❌ Tracker palautti **403 Forbidden**. Tarkista API key ja että profiili on public.");
    if (err?.response?.status === 404) return interaction.editReply("❌ Pelaajaa ei löytynyt Trackerista. Tarkista Riot ID ja että profiili on public.");

    return interaction.editReply("❌ Rankin haku epäonnistui. Tarkista Riot ID, API key ja Railway logs.");
  }

  if (!rank || !RANK_ROLES.includes(rank)) {
    return interaction.editReply(
      [
        "❌ En löytänyt pelaajan Valorant rankkia Tracker datasta.",
        "",
        "Mahdolliset syyt:",
        "• Tracker profiili ei ole public",
        "• pelaaja ei ole pelannut competitivea",
        "• Tracker ei anna Valorant rankkia API:n kautta",
      ].join("\n")
    );
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const result = await applyRankRole(interaction.guild, member, rank);

  if (!result.ok) return interaction.editReply(result.message);

  await saveLink({
    discord_id: interaction.user.id,
    guild_id: interaction.guild.id,
    riot_id: riotId,
    current_rank: rank,
    last_checked: new Date().toISOString(),
  });

  await sendRankDM(interaction.user, rank, false, riotId).catch(() => {});

  return interaction.editReply(`✅ Rank löydetty: **${rank}**. Sait roolin **${rank}**. Lähetin sinulle myös DM-viestin.`);
}

// ─── Tracker API ──────────────────────────────────────────────────────────────

async function fetchValorantTrackerProfile(riotId) {
  const encoded = encodeURIComponent(riotId);
  const urls = [
    `https://public-api.tracker.gg/v2/valorant/standard/profile/riot/${encoded}`,
    `https://api.tracker.gg/api/v2/valorant/standard/profile/riot/${encoded}?forceCollect=true`,
  ];

  let lastError;

  for (const url of urls) {
    try {
      const res = await axios.get(url, {
        timeout: 20_000,
        headers: {
          "TRN-Api-Key": TRACKER_API_KEY,
          Accept: "application/json",
          "User-Agent": "Radiant-Plaza-Discord-Bot/1.0",
        },
      });
      return res.data;
    } catch (err) {
      lastError = err;
      const status = err?.response?.status;
      if (status === 401 || status === 403 || status === 404) throw err;
    }
  }

  throw lastError;
}

// ─── Rankin parsinta ──────────────────────────────────────────────────────────

function extractRank(data) {
  const possibleValues = [];

  walkObject(data, (key, value) => {
    if (typeof value !== "string") return;
    const lowerKey = String(key).toLowerCase();
    if (lowerKey.includes("rank") || lowerKey.includes("tier") || lowerKey.includes("rating") || lowerKey.includes("division")) {
      possibleValues.push(value.trim());
    }
  });

  for (const value of possibleValues) {
    const normalized = normalizeRank(value);
    if (normalized) return normalized;
  }

  const json = JSON.stringify(data);

  for (const rank of [...RANK_ROLES].reverse()) {
    const escaped = rank.replace(" ", "\\s*");
    if (new RegExp(escaped, "i").test(json)) return rank;
  }

  return null;
}

function normalizeRank(value) {
  if (!value) return null;

  let text = String(value).replace(/_/g, " ").replace(/-/g, " ").replace(/\s+/g, " ").trim();
  text = text.replace(/^competitive\s+/i, "").replace(/^rank\s+/i, "");

  if (/radiant/i.test(text)) return "Radiant";

  const match = text.match(/\b(iron|bronze|silver|gold|platinum|diamond|ascendant|immortal)\s*([123])\b/i);
  if (!match) return null;

  const rank = `${capitalize(match[1])} ${match[2]}`;
  return RANK_ROLES.includes(rank) ? rank : null;
}

function walkObject(obj, callback) {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) { obj.forEach((item) => walkObject(item, callback)); return; }
  for (const [key, value] of Object.entries(obj)) {
    callback(key, value);
    if (value && typeof value === "object") walkObject(value, callback);
  }
}

// ─── Roolien hallinta ─────────────────────────────────────────────────────────

async function applyRankRole(guild, member, rank) {
  const botMember = await guild.members.fetchMe();
  const role = await getOrCreateRankRole(guild, rank);

  if (!role) return { ok: false, message: `❌ En pystynyt luomaan/löytämään roolia **${rank}**.` };
  if (role.position >= botMember.roles.highest.position) {
    return { ok: false, message: `❌ Botin rooli ei ole tarpeeksi korkealla. Siirrä botin rooli ylemmäs kuin **${rank}**.` };
  }

  const rolesToRemove = RANK_ROLES
    .map((r) => guild.roles.cache.find((gr) => gr.name === r))
    .filter((r) => r && r.id !== role.id && member.roles.cache.has(r.id) && r.position < botMember.roles.highest.position);

  if (rolesToRemove.length > 0) {
    await member.roles.remove(rolesToRemove).catch((err) => console.error("[Radiant Rank] Failed to remove old roles:", err));
  }

  if (!member.roles.cache.has(role.id)) await member.roles.add(role);

  return { ok: true };
}

async function getOrCreateRankRole(guild, rank) {
  let role = guild.roles.cache.find((r) => r.name === rank);
  if (role) return role;

  const color = ROLE_COLORS[rank.split(" ")[0]] || 0xfacc15;
  return guild.roles.create({ name: rank, color, reason: "Radiant Plaza Valorant rank role", mentionable: false });
}

// ─── Auto-update ──────────────────────────────────────────────────────────────

async function updateAllLinkedRanks() {
  const links = await getAllLinks();
  if (!links.length) { console.log("[Radiant Rank] No linked users."); return; }

  console.log(`[Radiant Rank] Updating ${links.length} users...`);

  for (const link of links) {
    try {
      const guild = await client.guilds.fetch(link.guild_id).catch(() => null);
      if (!guild) continue;

      const member = await guild.members.fetch(link.discord_id).catch(() => null);
      if (!member) continue;

      const data = await fetchValorantTrackerProfile(link.riot_id);
      const newRank = extractRank(data);

      if (!newRank || !RANK_ROLES.includes(newRank)) continue;

      const oldRank = link.current_rank;
      await applyRankRole(guild, member, newRank);
      await saveLink({ ...link, current_rank: newRank, last_checked: new Date().toISOString() });

      if (oldRank && oldRank !== newRank) {
        await sendRankDM(member.user, newRank, true, link.riot_id, oldRank).catch(() => {});
        console.log(`[Radiant Rank] ${link.riot_id}: ${oldRank} -> ${newRank}`);
      }
    } catch (err) {
      console.error("[Radiant Rank] Failed to update user:", { discord_id: link.discord_id, riot_id: link.riot_id, message: err.message });
    }

    await wait(2500);
  }
}

// ─── DM ──────────────────────────────────────────────────────────────────────

async function sendRankDM(user, rank, changed, riotId, oldRank = null) {
  const unlocked = RANK_ROLES.slice(0, RANK_ROLES.indexOf(rank) + 1);

  const embed = new EmbedBuilder()
    .setColor(0xfacc15)
    .setTitle(changed ? "⭐ Your Valorant rank was updated!" : "⭐ Valorant rank verified!")
    .setDescription(
      [
        changed ? `Your rank changed from **${oldRank}** to **${rank}**.` : `You are now verified as **${rank}**.`,
        "",
        `**Riot ID:** \`${riotId}\``,
        "",
        "**Your benefits:**",
        "• You now have your correct Valorant rank role.",
        "• You can access rank-based channels if the server has them.",
        "• Your rank can update automatically when your Valorant rank changes.",
        "",
        "**Unlocked rank level:**",
        unlocked.slice(-8).map((r) => `• ${r}`).join("\n"),
      ].join("\n")
    )
    .setFooter({ text: "Radiant Plaza • Community Marketplace" })
    .setTimestamp();

  return user.send({ embeds: [embed] });
}

// ─── Tietokanta ───────────────────────────────────────────────────────────────

async function initDatabase() {
  if (process.env.DATABASE_URL) {
    try {
      const { Pool } = require("pg");
      pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: (process.env.DATABASE_URL.includes("railway") || process.env.DATABASE_URL.includes("proxy.rlwy.net"))
          ? { rejectUnauthorized: false } : undefined,
      });

      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS discord_rank_links (
          discord_id TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          riot_id TEXT NOT NULL,
          current_rank TEXT,
          last_checked TEXT,
          PRIMARY KEY (discord_id, guild_id)
        );
      `);

      console.log("[Radiant Rank] PostgreSQL ready.");
      return;
    } catch (err) {
      pgPool = null;
      console.warn("[Radiant Rank] PostgreSQL failed, using JSON fallback:", err.message);
    }
  }

  if (!fs.existsSync(LOCAL_DB_PATH)) fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify([], null, 2));
  console.log("[Radiant Rank] Local JSON database ready.");
}

async function saveLink(link) {
  if (pgPool) {
    await pgPool.query(
      `INSERT INTO discord_rank_links (discord_id, guild_id, riot_id, current_rank, last_checked)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (discord_id, guild_id) DO UPDATE SET
         riot_id = EXCLUDED.riot_id,
         current_rank = EXCLUDED.current_rank,
         last_checked = EXCLUDED.last_checked;`,
      [link.discord_id, link.guild_id, link.riot_id, link.current_rank, link.last_checked]
    );
    return;
  }

  const links = readLocalLinks();
  const index = links.findIndex((x) => x.discord_id === link.discord_id && x.guild_id === link.guild_id);
  if (index >= 0) links[index] = link; else links.push(link);
  fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(links, null, 2));
}

async function getAllLinks() {
  if (pgPool) { const res = await pgPool.query("SELECT * FROM discord_rank_links;"); return res.rows || []; }
  return readLocalLinks();
}

function readLocalLinks() {
  try {
    if (!fs.existsSync(LOCAL_DB_PATH)) return [];
    return JSON.parse(fs.readFileSync(LOCAL_DB_PATH, "utf8"));
  } catch { return []; }
}

// ─── Apufunktiot ──────────────────────────────────────────────────────────────

function cleanRiotId(value) {
  return String(value || "").trim().replace(/\s+#/g, "#").replace(/#\s+/g, "#");
}

function isValidRiotId(value) {
  if (!value.includes("#")) return false;
  const [name, tag] = value.split("#");
  if (!name || !tag) return false;
  if (name.length < 2 || tag.length < 2) return false;
  if (name.length > 16 || tag.length > 8) return false;
  return true;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
