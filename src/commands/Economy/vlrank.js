const {
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

/*
  RADIANT PLAZA VALORANT RANK BOT
  Command: /rank
  Owner tekee panelin.
  User painaa Find Rank -> kirjoittaa Riot ID:n muodossa Name#TAG.
  Botti hakee Trackerista rankin ja antaa Discord-roolin.
  Botti päivittää rankkeja automaattisesti X tunnin välein.

  Railway variables:
  TRACKER_API_KEY=...
  OWNER_IDS=123456789,987654321
  RANK_BANNER_URL=https://...
  RANK_UPDATE_HOURS=6

  HUOM:
  Tracker.gg Valorant API voi palauttaa 403, koska Valorant ei ole aina public Tracker API:ssa.
*/

const TRACKER_API_KEY = process.env.TRACKER_API_KEY || "";
const OWNER_IDS = (process.env.OWNER_IDS || "772345007469756436")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const BANNER_URL =
  process.env.RANK_BANNER_URL ||
  "https://cdn.discordapp.com/attachments/000000000000000000/000000000000000000/radiant-plaza-banner.png";

const UPDATE_HOURS = Number(process.env.RANK_UPDATE_HOURS || 6);
const UPDATE_MS = Math.max(1, UPDATE_HOURS) * 60 * 60 * 1000;

const BUTTON_ID = "radiant_rank_find_button";
const MODAL_ID = "radiant_rank_modal";
const RIOT_ID_INPUT = "radiant_rank_riot_id";

const LOCAL_DB_PATH = path.join(__dirname, "rank_links.json");

let setupDone = false;
let updateLoopStarted = false;
let pgPool = null;
const cooldown = new Map();

const RANK_ROLES = [
  "Iron 1",
  "Iron 2",
  "Iron 3",
  "Bronze 1",
  "Bronze 2",
  "Bronze 3",
  "Silver 1",
  "Silver 2",
  "Silver 3",
  "Gold 1",
  "Gold 2",
  "Gold 3",
  "Platinum 1",
  "Platinum 2",
  "Platinum 3",
  "Diamond 1",
  "Diamond 2",
  "Diamond 3",
  "Ascendant 1",
  "Ascendant 2",
  "Ascendant 3",
  "Immortal 1",
  "Immortal 2",
  "Immortal 3",
  "Radiant",
];

const ROLE_COLORS = {
  Iron: 0x4b5563,
  Bronze: 0x9a5a2f,
  Silver: 0xc0c0c0,
  Gold: 0xffd700,
  Platinum: 0x36d1dc,
  Diamond: 0x7dd3fc,
  Ascendant: 0x22c55e,
  Immortal: 0xdc2626,
  Radiant: 0xfacc15,
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Lähettää Valorant rank verification panelin.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await ensureSetup(interaction.client);

    if (!OWNER_IDS.includes(interaction.user.id)) {
      return interaction.reply({
        content: "❌ Tämä komento on vain ownerille.",
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0xfacc15)
      .setTitle("⭐ Radiant Plaza Rank Verification")
      .setDescription(
        [
          "**Get your Valorant rank role automatically.**",
          "",
          "Press the yellow **Find Rank** button below.",
          "Write your Riot ID in this format:",
          "",
          "`Name#TAG`",
          "",
          "Example:",
          "`RadiantPlayer#EUW`",
          "",
          "After this, the bot checks your Tracker profile and gives you the matching Discord rank role.",
          "",
          "Your role will also update automatically if your Valorant rank changes.",
        ].join("\n")
      )
      .setImage(BANNER_URL)
      .setFooter({ text: "Radiant Plaza • Community Marketplace" })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BUTTON_ID)
        .setLabel("Find Rank")
        .setEmoji("🔎")
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.channel.send({
      embeds: [embed],
      components: [row],
    });

    return interaction.reply({
      content: "✅ Rank panel lähetetty tähän kanavaan.",
      ephemeral: true,
    });
  },

  async setup(client) {
    await ensureSetup(client);
  },
};

async function ensureSetup(client) {
  if (setupDone) return;
  setupDone = true;

  await initDatabase();

  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isButton() && interaction.customId === BUTTON_ID) {
        return handleRankButton(interaction);
      }

      if (interaction.isModalSubmit() && interaction.customId === MODAL_ID) {
        return handleRankModal(interaction);
      }
    } catch (err) {
      console.error("[Radiant Rank] interaction error:", err);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ Tapahtui virhe. Tarkista botin logs Railwaystä.",
          ephemeral: true,
        }).catch(() => {});
      }
    }
  });

  client.once("ready", async () => {
    console.log(`[Radiant Rank] Logged in as ${client.user.tag}`);

    if (!updateLoopStarted) {
      updateLoopStarted = true;

      setTimeout(() => updateAllLinkedRanks(client), 30_000);

      setInterval(() => {
        updateAllLinkedRanks(client).catch((err) => {
          console.error("[Radiant Rank] auto update failed:", err);
        });
      }, UPDATE_MS);

      console.log(`[Radiant Rank] Auto update every ${UPDATE_HOURS}h started.`);
    }
  });
}

async function handleRankButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle("Find your Valorant rank");

  const riotIdInput = new TextInputBuilder()
    .setCustomId(RIOT_ID_INPUT)
    .setLabel("Valorant Riot ID")
    .setPlaceholder("Example: Player#EUW")
    .setMinLength(3)
    .setMaxLength(32)
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  modal.addComponents(new ActionRowBuilder().addComponents(riotIdInput));

  return interaction.showModal(modal);
}

async function handleRankModal(interaction) {
  const now = Date.now();
  const last = cooldown.get(interaction.user.id) || 0;

  if (now - last < 60_000) {
    return interaction.reply({
      content: "⏳ Odota hetki ennen kuin haet rankkia uudestaan.",
      ephemeral: true,
    });
  }

  cooldown.set(interaction.user.id, now);

  const riotIdRaw = interaction.fields.getTextInputValue(RIOT_ID_INPUT);
  const riotId = cleanRiotId(riotIdRaw);

  if (!isValidRiotId(riotId)) {
    return interaction.reply({
      content: "❌ Kirjoita Riot ID muodossa `Name#TAG`, esimerkiksi `Player#EUW`.",
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  if (!interaction.guild) {
    return interaction.editReply("❌ Tätä voi käyttää vain serverillä.");
  }

  if (!TRACKER_API_KEY) {
    return interaction.editReply(
      "❌ Botilta puuttuu `TRACKER_API_KEY` Railway Variables kohdasta."
    );
  }

  const botMember = await interaction.guild.members.fetchMe();

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.editReply(
      "❌ Botilta puuttuu **Manage Roles** permission."
    );
  }

  let trackerData;
  let rank;

  try {
    trackerData = await fetchValorantTrackerProfile(riotId);
    rank = extractRank(trackerData);
  } catch (err) {
    console.error("[Radiant Rank] Tracker fetch failed:", {
      status: err?.response?.status,
      data: err?.response?.data,
      message: err.message,
    });

    if (err?.response?.status === 403) {
      return interaction.editReply(
        [
          "❌ Tracker palautti **403 Forbidden**.",
          "",
          "Tämä tarkoittaa yleensä sitä, että Tracker ei salli tätä Valorant endpointtia/API keyllä.",
          "Tarkista myös, että pelaajan Tracker-profiili on public.",
        ].join("\n")
      );
    }

    if (err?.response?.status === 404) {
      return interaction.editReply(
        "❌ Pelaajaa ei löytynyt Trackerista. Tarkista että Riot ID on oikein ja profiili on public."
      );
    }

    return interaction.editReply(
      "❌ Rankin haku epäonnistui. Tarkista API key, Riot ID ja Railway logs."
    );
  }

  if (!rank || !RANK_ROLES.includes(rank)) {
    return interaction.editReply(
      [
        "❌ En löytänyt pelaajan rankkia Tracker datasta.",
        "",
        "Mahdolliset syyt:",
        "- Tracker profiili ei ole public",
        "- pelaaja ei ole pelannut competitivea",
        "- Tracker ei anna Valorant rankkia API:n kautta",
      ].join("\n")
    );
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);

  const result = await applyRankRole(interaction.guild, member, rank);

  if (!result.ok) {
    return interaction.editReply(result.message);
  }

  await saveLink({
    discord_id: interaction.user.id,
    guild_id: interaction.guild.id,
    riot_id: riotId,
    current_rank: rank,
    last_checked: new Date().toISOString(),
  });

  await sendRankDM(interaction.user, rank, false, riotId).catch(() => {});

  return interaction.editReply(
    `✅ Rank löydetty: **${rank}**. Sait roolin **${rank}**. Lähetin sinulle myös DM-viestin.`
  );
}

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
      if (status === 404 || status === 403 || status === 401) {
        throw err;
      }
    }
  }

  throw lastError;
}

function extractRank(data) {
  const possible = [];

  walkObject(data, (key, value) => {
    if (typeof value !== "string") return;

    const k = String(key).toLowerCase();
    const v = value.trim();

    if (
      k.includes("rank") ||
      k.includes("tier") ||
      k.includes("rating") ||
      k.includes("division")
    ) {
      possible.push(v);
    }
  });

  for (const value of possible) {
    const normalized = normalizeRank(value);
    if (normalized) return normalized;
  }

  const json = JSON.stringify(data);

  for (const role of [...RANK_ROLES].reverse()) {
    const escaped = role.replace(" ", "\\s*");
    const regex = new RegExp(escaped, "i");
    if (regex.test(json)) return role;
  }

  return null;
}

function normalizeRank(value) {
  if (!value) return null;

  let text = String(value)
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  text = text.replace(/^competitive\s+/i, "");
  text = text.replace(/^rank\s+/i, "");

  if (/radiant/i.test(text)) return "Radiant";

  const match = text.match(
    /\b(iron|bronze|silver|gold|platinum|diamond|ascendant|immortal)\s*([123])\b/i
  );

  if (!match) return null;

  const name = capitalize(match[1].toLowerCase());
  const number = match[2];

  const rank = `${name} ${number}`;

  return RANK_ROLES.includes(rank) ? rank : null;
}

function walkObject(obj, cb) {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj) walkObject(item, cb);
    return;
  }

  for (const [key, value] of Object.entries(obj)) {
    cb(key, value);
    if (value && typeof value === "object") {
      walkObject(value, cb);
    }
  }
}

async function applyRankRole(guild, member, rank) {
  const botMember = await guild.members.fetchMe();
  const role = await getOrCreateRankRole(guild, rank);

  if (!role) {
    return {
      ok: false,
      message: `❌ En pystynyt luomaan/löytämään roolia **${rank}**.`,
    };
  }

  if (role.position >= botMember.roles.highest.position) {
    return {
      ok: false,
      message:
        `❌ Botin rooli ei ole tarpeeksi korkealla. Siirrä botin korkein rooli ylemmäs kuin **${rank}**.`,
    };
  }

  const rolesToRemove = [];

  for (const roleName of RANK_ROLES) {
    const found = guild.roles.cache.find((r) => r.name === roleName);
    if (found && found.id !== role.id && member.roles.cache.has(found.id)) {
      if (found.position < botMember.roles.highest.position) {
        rolesToRemove.push(found);
      }
    }
  }

  if (rolesToRemove.length > 0) {
    await member.roles.remove(rolesToRemove).catch((err) => {
      console.error("[Radiant Rank] remove old roles failed:", err);
    });
  }

  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role);
  }

  return {
    ok: true,
    message: `✅ Rank role updated: ${rank}`,
  };
}

async function getOrCreateRankRole(guild, rank) {
  let role = guild.roles.cache.find((r) => r.name === rank);
  if (role) return role;

  const baseName = rank.split(" ")[0];
  const color = ROLE_COLORS[baseName] || 0xfacc15;

  role = await guild.roles.create({
    name: rank,
    color,
    reason: "Radiant Plaza Valorant rank role",
    mentionable: false,
  });

  return role;
}

async function updateAllLinkedRanks(client) {
  const links = await getAllLinks();

  if (!links.length) {
    console.log("[Radiant Rank] No linked users to update.");
    return;
  }

  console.log(`[Radiant Rank] Updating ${links.length} linked users...`);

  for (const link of links) {
    try {
      const guild = await client.guilds.fetch(link.guild_id).catch(() => null);
      if (!guild) continue;

      const member = await guild.members.fetch(link.discord_id).catch(() => null);
      if (!member) continue;

      const data = await fetchValorantTrackerProfile(link.riot_id);
      const newRank = extractRank(data);

      if (!newRank || !RANK_ROLES.includes(newRank)) {
        console.log(`[Radiant Rank] No rank found for ${link.riot_id}`);
        continue;
      }

      const oldRank = link.current_rank;

      await applyRankRole(guild, member, newRank);

      await saveLink({
        discord_id: link.discord_id,
        guild_id: link.guild_id,
        riot_id: link.riot_id,
        current_rank: newRank,
        last_checked: new Date().toISOString(),
      });

      if (oldRank && oldRank !== newRank) {
        await sendRankDM(member.user, newRank, true, link.riot_id, oldRank).catch(() => {});
        console.log(`[Radiant Rank] ${link.riot_id}: ${oldRank} -> ${newRank}`);
      }
    } catch (err) {
      console.error("[Radiant Rank] update user failed:", {
        user: link.discord_id,
        riot: link.riot_id,
        status: err?.response?.status,
        message: err.message,
      });
    }

    await wait(2500);
  }
}

async function sendRankDM(user, rank, changed, riotId, oldRank = null) {
  const rankIndex = RANK_ROLES.indexOf(rank);
  const unlocked = RANK_ROLES.slice(0, rankIndex + 1);

  const title = changed
    ? "⭐ Your Valorant rank was updated!"
    : "⭐ Valorant rank verified!";

  const description = changed
    ? `Your rank changed from **${oldRank}** to **${rank}**.`
    : `You are now verified as **${rank}**.`;

  const embed = new EmbedBuilder()
    .setColor(0xfacc15)
    .setTitle(title)
    .setDescription(
      [
        description,
        "",
        `**Riot ID:** \`${riotId}\``,
        "",
        "**Your benefits:**",
        "• You now have your correct Valorant rank role.",
        "• You can access rank-based channels that your server has enabled.",
        "• Your role can update automatically when your rank changes.",
        "",
        "**Unlocked rank level:**",
        unlocked.slice(-8).map((r) => `• ${r}`).join("\n"),
      ].join("\n")
    )
    .setFooter({ text: "Radiant Plaza • Community Marketplace" })
    .setTimestamp();

  return user.send({ embeds: [embed] });
}

async function initDatabase() {
  if (process.env.DATABASE_URL) {
    try {
      const { Pool } = require("pg");

      pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes("railway")
          ? { rejectUnauthorized: false }
          : undefined,
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

      console.log("[Radiant Rank] PostgreSQL database ready.");
      return;
    } catch (err) {
      pgPool = null;
      console.warn("[Radiant Rank] PostgreSQL failed, using local JSON fallback:", err.message);
    }
  }

  if (!fs.existsSync(LOCAL_DB_PATH)) {
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify([], null, 2));
  }

  console.log("[Radiant Rank] Local JSON database ready.");
}

async function saveLink(link) {
  if (pgPool) {
    await pgPool.query(
      `
      INSERT INTO discord_rank_links
        (discord_id, guild_id, riot_id, current_rank, last_checked)
      VALUES
        ($1, $2, $3, $4, $5)
      ON CONFLICT (discord_id, guild_id)
      DO UPDATE SET
        riot_id = EXCLUDED.riot_id,
        current_rank = EXCLUDED.current_rank,
        last_checked = EXCLUDED.last_checked;
      `,
      [
        link.discord_id,
        link.guild_id,
        link.riot_id,
        link.current_rank,
        link.last_checked,
      ]
    );

    return;
  }

  const links = readLocalLinks();
  const index = links.findIndex(
    (x) => x.discord_id === link.discord_id && x.guild_id === link.guild_id
  );

  if (index >= 0) links[index] = link;
  else links.push(link);

  fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(links, null, 2));
}

async function getAllLinks() {
  if (pgPool) {
    const res = await pgPool.query(`SELECT * FROM discord_rank_links;`);
    return res.rows || [];
  }

  return readLocalLinks();
}

function readLocalLinks() {
  try {
    if (!fs.existsSync(LOCAL_DB_PATH)) return [];
    return JSON.parse(fs.readFileSync(LOCAL_DB_PATH, "utf8"));
  } catch {
    return [];
  }
}

function cleanRiotId(value) {
  return String(value || "")
    .trim()
    .replace(/\s+#/g, "#")
    .replace(/#\s+/g, "#");
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
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
