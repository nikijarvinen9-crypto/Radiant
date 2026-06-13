const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  REST,
  Routes
} = require("discord.js");

const axios = require("axios");

/*
  TÄRKEÄ:
  Laita nämä Railway -> Variables kohtaan:

  TOKEN=sinun_discord_bot_token
  CLIENT_ID=sinun_botin_client_id
  GUILD_ID=sinun_discord_serverin_id
  TRACKER_API_KEY=sinun_tracker_api_key

  Tämä tiedosto rekisteröi /vlrank komennon automaattisesti,
  kun botti käynnistyy ja tämä tiedosto ladataan.
*/

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TRACKER_API_KEY = process.env.TRACKER_API_KEY;

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
  "Radiant"
];

const commandData = new SlashCommandBuilder()
  .setName("vlrank")
  .setDescription("Tarkistaa Valorant rankin Trackerista ja antaa Discord rank-roolin.")
  .addStringOption(option =>
    option
      .setName("riotid")
      .setDescription("Riot ID muodossa Name#TAG")
      .setRequired(true)
  );

async function autoRegisterCommand() {
  if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.log("[VLRank] Slash commandia ei rekisteröity, koska TOKEN / CLIENT_ID / GUILD_ID puuttuu.");
    return;
  }

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      {
        body: [commandData.toJSON()]
      }
    );

    console.log("[VLRank] ✅ /vlrank rekisteröity Discordiin onnistuneesti.");
  } catch (error) {
    console.error("[VLRank] ❌ /vlrank rekisteröinti epäonnistui:");
    console.error(error);
  }
}

autoRegisterCommand();

function cleanText(text) {
  return String(text || "")
    .toLowerCase()
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRank(rankText) {
  const text = cleanText(rankText);

  if (!text) return null;

  const aliases = {
    "iron 1": "Iron 1",
    "iron i": "Iron 1",
    "iron 2": "Iron 2",
    "iron ii": "Iron 2",
    "iron 3": "Iron 3",
    "iron iii": "Iron 3",

    "bronze 1": "Bronze 1",
    "bronze i": "Bronze 1",
    "bronze 2": "Bronze 2",
    "bronze ii": "Bronze 2",
    "bronze 3": "Bronze 3",
    "bronze iii": "Bronze 3",

    "silver 1": "Silver 1",
    "silver i": "Silver 1",
    "silver 2": "Silver 2",
    "silver ii": "Silver 2",
    "silver 3": "Silver 3",
    "silver iii": "Silver 3",

    "gold 1": "Gold 1",
    "gold i": "Gold 1",
    "gold 2": "Gold 2",
    "gold ii": "Gold 2",
    "gold 3": "Gold 3",
    "gold iii": "Gold 3",

    "platinum 1": "Platinum 1",
    "plat 1": "Platinum 1",
    "platinum i": "Platinum 1",
    "platinum 2": "Platinum 2",
    "plat 2": "Platinum 2",
    "platinum ii": "Platinum 2",
    "platinum 3": "Platinum 3",
    "plat 3": "Platinum 3",
    "platinum iii": "Platinum 3",

    "diamond 1": "Diamond 1",
    "diamond i": "Diamond 1",
    "diamond 2": "Diamond 2",
    "diamond ii": "Diamond 2",
    "diamond 3": "Diamond 3",
    "diamond iii": "Diamond 3",

    "ascendant 1": "Ascendant 1",
    "ascendant i": "Ascendant 1",
    "ascendant 2": "Ascendant 2",
    "ascendant ii": "Ascendant 2",
    "ascendant 3": "Ascendant 3",
    "ascendant iii": "Ascendant 3",

    "immortal 1": "Immortal 1",
    "immortal i": "Immortal 1",
    "immortal 2": "Immortal 2",
    "immortal ii": "Immortal 2",
    "immortal 3": "Immortal 3",
    "immortal iii": "Immortal 3",

    "radiant": "Radiant"
  };

  if (aliases[text]) return aliases[text];

  for (const rank of RANK_ROLES) {
    if (text === cleanText(rank)) return rank;
    if (text.includes(cleanText(rank))) return rank;
  }

  return null;
}

function parseRiotId(riotId) {
  const value = String(riotId || "").trim();

  if (!value.includes("#")) {
    throw new Error("Riot ID pitää olla muodossa `Name#TAG`, esimerkiksi `Player#EUW`.");
  }

  const parts = value.split("#");

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Riot ID pitää olla muodossa `Name#TAG`, esimerkiksi `Player#EUW`.");
  }

  return {
    name: parts[0].trim(),
    tag: parts[1].trim(),
    full: `${parts[0].trim()}#${parts[1].trim()}`
  };
}

function findRankFromTrackerData(data) {
  const possibleValues = [];

  function scan(obj) {
    if (!obj || typeof obj !== "object") return;

    for (const value of Object.values(obj)) {
      if (typeof value === "string") {
        possibleValues.push(value);
      } else if (typeof value === "object") {
        scan(value);
      }
    }
  }

  scan(data);

  for (const value of possibleValues) {
    const rank = normalizeRank(value);
    if (rank) return rank;
  }

  return null;
}

async function fetchRankFromTracker(riotId) {
  if (!TRACKER_API_KEY) {
    throw new Error("TRACKER_API_KEY puuttuu Railway Variables kohdasta.");
  }

  const parsed = parseRiotId(riotId);
  const encoded = encodeURIComponent(parsed.full);

  const url = `https://public-api.tracker.gg/v2/valorant/standard/profile/riot/${encoded}`;

  let response;

  try {
    response = await axios.get(url, {
      headers: {
        "TRN-Api-Key": TRACKER_API_KEY
      },
      timeout: 20000
    });
  } catch (error) {
    const status = error.response?.status;
    const apiMessage =
      error.response?.data?.message ||
      error.response?.data?.errors?.[0]?.message ||
      error.message;

    if (status === 401 || status === 403) {
      throw new Error("Tracker API key ei kelpaa tai sillä ei ole oikeuksia Valorant APIin.");
    }

    if (status === 404) {
      throw new Error("Pelaajaa ei löytynyt Trackerista. Tarkista Riot ID.");
    }

    if (status === 429) {
      throw new Error("Tracker rate limit tuli vastaan. Kokeile myöhemmin uudestaan.");
    }

    throw new Error(`Tracker API error ${status || ""}: ${apiMessage}`);
  }

  const data = response.data?.data;

  if (!data) {
    throw new Error("Tracker ei palauttanut profiilidataa.");
  }

  const rank = findRankFromTrackerData(data);

  if (!rank) {
    throw new Error(
      "Rankkia ei löytynyt. Profiili voi olla private, unranked tai Tracker ei palauta rankkia API:n kautta."
    );
  }

  return {
    riotId: parsed.full,
    rank,
    profileUrl: `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(parsed.name)}%23${encodeURIComponent(parsed.tag)}/overview`
  };
}

async function removeOldRankRoles(member) {
  const oldRoles = member.roles.cache.filter(role => RANK_ROLES.includes(role.name));

  if (oldRoles.size > 0) {
    await member.roles.remove(oldRoles);
  }
}

async function giveRankRole(member, rankName) {
  const role = member.guild.roles.cache.find(r => r.name === rankName);

  if (!role) {
    throw new Error(`Discordista ei löytynyt roolia "${rankName}". Luo se ensin serverille.`);
  }

  const botMember = await member.guild.members.fetchMe();

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error("Botilta puuttuu Manage Roles permission.");
  }

  if (role.position >= botMember.roles.highest.position) {
    throw new Error(`Botin rooli pitää siirtää roolin "${rankName}" yläpuolelle.`);
  }

  await removeOldRankRoles(member);
  await member.roles.add(role);

  return role;
}

module.exports = {
  name: "vlrank",

  data: commandData,

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const riotId = interaction.options.getString("riotid");

    try {
      const result = await fetchRankFromTracker(riotId);
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const role = await giveRankRole(member, result.rank);

      const embed = new EmbedBuilder()
        .setTitle("✅ Valorant rank verified")
        .setDescription(`Sinulle annettiin rooli **${role.name}**.`)
        .addFields(
          {
            name: "Riot ID",
            value: result.riotId,
            inline: true
          },
          {
            name: "Rank",
            value: result.rank,
            inline: true
          },
          {
            name: "Tracker",
            value: `[Avaa profiili](${result.profileUrl})`
          }
        )
        .setColor(0x00ff99);

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("[VLRank Error]", error);

      return interaction.editReply(
        `❌ Valorant rank verify epäonnistui.\n\n` +
        `**Syy:** ${error.message}\n\n` +
        `Tarkista nämä:\n` +
        `1. Railway Variables kohdassa on \`TRACKER_API_KEY\`.\n` +
        `2. Railway Variables kohdassa on \`TOKEN\`, \`CLIENT_ID\` ja \`GUILD_ID\`.\n` +
        `3. Discordissa on roolit täsmälleen nimillä esim. \`Gold 1\`, \`Diamond 2\`, \`Radiant\`.\n` +
        `4. Botilla on \`Manage Roles\` permission.\n` +
        `5. Botin oma rooli on rank-roolien yläpuolella.\n` +
        `6. Riot ID on muodossa \`Name#TAG\`.\n` +
        `7. Tracker-profiili ei ole private.`
      );
    }
  }
};
