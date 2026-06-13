const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const axios = require("axios");

/*
  LAITA TRACKER API KEY TÄHÄN.
  Korvaa PASTE_TRACKER_API_KEY_HERE omalla keylläsi.

  ÄLÄ jaa keytä muille.
*/
const TRACKER_API_KEY = "dd5a297d-d38a-4ad2-b232-45d03e656aec";

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
    throw new Error("Riot ID pitää olla muodossa `Name#TAG`, esim. `Niki#EUW`.");
  }

  const parts = value.split("#");
  const name = parts[0]?.trim();
  const tag = parts[1]?.trim();

  if (!name || !tag) {
    throw new Error("Riot ID pitää olla muodossa `Name#TAG`, esim. `Niki#EUW`.");
  }

  return {
    name,
    tag,
    full: `${name}#${tag}`
  };
}

function findRankFromTrackerData(data) {
  const possibleValues = [];

  const segments = data?.segments || [];

  for (const segment of segments) {
    const stats = segment?.stats || {};

    for (const key of Object.keys(stats)) {
      const stat = stats[key];

      if (!stat) continue;

      if (typeof stat.displayValue === "string") {
        possibleValues.push(stat.displayValue);
      }

      if (typeof stat.value === "string") {
        possibleValues.push(stat.value);
      }

      if (typeof stat.metadata?.name === "string") {
        possibleValues.push(stat.metadata.name);
      }

      if (typeof stat.metadata?.rankName === "string") {
        possibleValues.push(stat.metadata.rankName);
      }

      if (typeof stat.metadata?.tierName === "string") {
        possibleValues.push(stat.metadata.tierName);
      }

      if (typeof stat.metadata?.currentTierName === "string") {
        possibleValues.push(stat.metadata.currentTierName);
      }

      if (typeof stat.metadata?.localizedValue === "string") {
        possibleValues.push(stat.metadata.localizedValue);
      }
    }
  }

  for (const value of possibleValues) {
    const rank = normalizeRank(value);

    if (rank) {
      return rank;
    }
  }

  return null;
}

async function fetchRankFromTracker(riotId) {
  if (!TRACKER_API_KEY || TRACKER_API_KEY === "PASTE_TRACKER_API_KEY_HERE") {
    throw new Error("Tracker API key puuttuu `vlrank.js` tiedostosta.");
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
    const message = error.response?.data?.message || error.response?.data?.errors?.[0]?.message;

    if (status === 401 || status === 403) {
      throw new Error("Tracker API key ei kelpaa tai sillä ei ole oikeuksia Valorant API:in.");
    }

    if (status === 404) {
      throw new Error("Pelaajaa ei löytynyt Trackerista. Tarkista Riot ID ja että profiili on olemassa.");
    }

    if (status === 429) {
      throw new Error("Tracker API rate limit tuli vastaan. Kokeile hetken päästä uudestaan.");
    }

    throw new Error(message || `Tracker API error ${status || ""}`.trim());
  }

  const data = response.data?.data;

  if (!data) {
    throw new Error("Tracker ei palauttanut profiilidataa.");
  }

  const rank = findRankFromTrackerData(data);

  if (!rank) {
    throw new Error(
      "Rankkia ei löytynyt Trackerin datasta. Pelaaja voi olla unranked, profiili voi olla private tai Tracker API ei palauta Valorant rankkia tällä keyllä."
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
    throw new Error(`Discord-roolia "${rankName}" ei löytynyt. Luo se ensin serverille.`);
  }

  await removeOldRankRoles(member);
  await member.roles.add(role);

  return role;
}

module.exports = {
  name: "vlrank",

  data: new SlashCommandBuilder()
    .setName("vlrank")
    .setDescription("Tarkista Valorant rank Trackerista ja anna Discord-rooli.")
    .addSubcommand(subcommand =>
      subcommand
        .setName("verify")
        .setDescription("Tarkistaa Valorant rankin Trackerista.")
        .addStringOption(option =>
          option
            .setName("riotid")
            .setDescription("Riot ID muodossa Name#TAG")
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("list")
        .setDescription("Näyttää kaikki Valorant rank-roolit.")
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("test")
        .setDescription("Testaa että /vlrank toimii.")
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "test") {
      return interaction.reply({
        content: "✅ `/vlrank` toimii oikein!",
        ephemeral: true
      });
    }

    if (subcommand === "list") {
      const embed = new EmbedBuilder()
        .setTitle("Valorant rank-roolit")
        .setDescription(RANK_ROLES.map(role => `• ${role}`).join("\n"))
        .setColor(0xff4655);

      return interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    }

    if (subcommand === "verify") {
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
        return interaction.editReply(
          `❌ Valorant rank verify epäonnistui.\n\n` +
          `**Syy:** ${error.message}\n\n` +
          `Tarkista nämä:\n` +
          `1. Tracker API key on laitettu \`vlrank.js\` tiedostoon.\n` +
          `2. Käyttäjä on kirjautunut Tracker.gg:hen Riot-tilillä.\n` +
          `3. Käyttäjän Tracker-profiili ei ole private.\n` +
          `4. Riot ID on muodossa \`Name#TAG\`.\n` +
          `5. Discordissa on luotu oikea rank-rooli.\n` +
          `6. Botin rooli on rank-roolien yläpuolella.`
        );
      }
    }
  }
};
