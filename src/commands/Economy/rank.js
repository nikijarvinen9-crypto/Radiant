const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

/*
  TARVITSET .env TIEDOSTOON:

  TRACKER_API_KEY=sinun_tracker_api_key

  Tämä command toimii command handlerissa, joka käyttää:
  command.data
  command.execute(interaction)
*/

const TRACKER_API_KEY = process.env.TRACKER_API_KEY;

const DATA_FILE = path.join(__dirname, "../valorant-linked-users.json");

/*
  Kaikki Valorant competitive rankit.
  roleName = Discord roolin nimi.
  aliases = erilaiset muodot, joita Tracker/API voi palauttaa.
*/

const VALORANT_RANKS = [
  {
    tier: 0,
    roleName: "Unrated",
    aliases: ["unrated", "unranked", "none"]
  },

  {
    tier: 1,
    roleName: "Iron 1",
    aliases: ["iron 1", "iron i", "iron_1"]
  },
  {
    tier: 2,
    roleName: "Iron 2",
    aliases: ["iron 2", "iron ii", "iron_2"]
  },
  {
    tier: 3,
    roleName: "Iron 3",
    aliases: ["iron 3", "iron iii", "iron_3"]
  },

  {
    tier: 4,
    roleName: "Bronze 1",
    aliases: ["bronze 1", "bronze i", "bronze_1"]
  },
  {
    tier: 5,
    roleName: "Bronze 2",
    aliases: ["bronze 2", "bronze ii", "bronze_2"]
  },
  {
    tier: 6,
    roleName: "Bronze 3",
    aliases: ["bronze 3", "bronze iii", "bronze_3"]
  },

  {
    tier: 7,
    roleName: "Silver 1",
    aliases: ["silver 1", "silver i", "silver_1"]
  },
  {
    tier: 8,
    roleName: "Silver 2",
    aliases: ["silver 2", "silver ii", "silver_2"]
  },
  {
    tier: 9,
    roleName: "Silver 3",
    aliases: ["silver 3", "silver iii", "silver_3"]
  },

  {
    tier: 10,
    roleName: "Gold 1",
    aliases: ["gold 1", "gold i", "gold_1"]
  },
  {
    tier: 11,
    roleName: "Gold 2",
    aliases: ["gold 2", "gold ii", "gold_2"]
  },
  {
    tier: 12,
    roleName: "Gold 3",
    aliases: ["gold 3", "gold iii", "gold_3"]
  },

  {
    tier: 13,
    roleName: "Platinum 1",
    aliases: ["platinum 1", "plat 1", "platinum i", "platinum_1"]
  },
  {
    tier: 14,
    roleName: "Platinum 2",
    aliases: ["platinum 2", "plat 2", "platinum ii", "platinum_2"]
  },
  {
    tier: 15,
    roleName: "Platinum 3",
    aliases: ["platinum 3", "plat 3", "platinum iii", "platinum_3"]
  },

  {
    tier: 16,
    roleName: "Diamond 1",
    aliases: ["diamond 1", "diamond i", "diamond_1"]
  },
  {
    tier: 17,
    roleName: "Diamond 2",
    aliases: ["diamond 2", "diamond ii", "diamond_2"]
  },
  {
    tier: 18,
    roleName: "Diamond 3",
    aliases: ["diamond 3", "diamond iii", "diamond_3"]
  },

  {
    tier: 19,
    roleName: "Ascendant 1",
    aliases: ["ascendant 1", "ascendant i", "ascendant_1"]
  },
  {
    tier: 20,
    roleName: "Ascendant 2",
    aliases: ["ascendant 2", "ascendant ii", "ascendant_2"]
  },
  {
    tier: 21,
    roleName: "Ascendant 3",
    aliases: ["ascendant 3", "ascendant iii", "ascendant_3"]
  },

  {
    tier: 22,
    roleName: "Immortal 1",
    aliases: ["immortal 1", "immortal i", "immortal_1"]
  },
  {
    tier: 23,
    roleName: "Immortal 2",
    aliases: ["immortal 2", "immortal ii", "immortal_2"]
  },
  {
    tier: 24,
    roleName: "Immortal 3",
    aliases: ["immortal 3", "immortal iii", "immortal_3"]
  },

  {
    tier: 25,
    roleName: "Radiant",
    aliases: ["radiant"]
  }
];

function loadLinks() {
  if (!fs.existsSync(DATA_FILE)) return {};

  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveLinks(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function cleanText(text) {
  return String(text || "")
    .toLowerCase()
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRiotId(riotId) {
  const cleaned = String(riotId || "").trim();

  if (!cleaned.includes("#")) {
    throw new Error("Riot ID pitää olla muodossa `Name#TAG`, esim. `Player#EUW`.");
  }

  const [name, tag] = cleaned.split("#");

  if (!name || !tag) {
    throw new Error("Riot ID pitää olla muodossa `Name#TAG`, esim. `Player#EUW`.");
  }

  return {
    name: name.trim(),
    tag: tag.trim(),
    full: `${name.trim()}#${tag.trim()}`
  };
}

function findRankFromText(text) {
  const cleaned = cleanText(text);

  if (!cleaned) return null;

  for (const rank of VALORANT_RANKS) {
    if (cleanText(rank.roleName) === cleaned) return rank;

    for (const alias of rank.aliases) {
      if (cleanText(alias) === cleaned) return rank;
    }
  }

  for (const rank of VALORANT_RANKS) {
    if (cleaned.includes(cleanText(rank.roleName))) return rank;

    for (const alias of rank.aliases) {
      if (cleaned.includes(cleanText(alias))) return rank;
    }
  }

  return null;
}

function findRankFromTrackerData(data) {
  const segments = data?.segments || [];

  const possibleValues = [];

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
    }
  }

  for (const value of possibleValues) {
    const rank = findRankFromText(value);

    if (rank && rank.roleName !== "Unrated") {
      return rank;
    }
  }

  return null;
}

async function getValorantRank(riotId) {
  if (!TRACKER_API_KEY) {
    throw new Error("TRACKER_API_KEY puuttuu .env tiedostosta.");
  }

  const parsed = parseRiotId(riotId);
  const encodedRiotId = encodeURIComponent(parsed.full);

  const url = `https://public-api.tracker.gg/v2/valorant/standard/profile/riot/${encodedRiotId}`;

  const response = await axios.get(url, {
    headers: {
      "TRN-Api-Key": TRACKER_API_KEY
    },
    timeout: 15000
  });

  const trackerData = response.data?.data;

  if (!trackerData) {
    throw new Error("Tracker ei palauttanut profiilidataa.");
  }

  const rank = findRankFromTrackerData(trackerData);

  if (!rank) {
    throw new Error(
      "Rankkia ei löytynyt. Pelaajan pitää yleensä kirjautua Tracker.gg:hen Riot-tilillä ja profiilin pitää olla näkyvissä."
    );
  }

  return {
    riotId: parsed.full,
    rankName: rank.roleName,
    rankTier: rank.tier,
    profileUrl: `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(parsed.name)}%23${encodeURIComponent(parsed.tag)}/overview`
  };
}

async function getOrCreateRankRole(guild, rankName) {
  let role = guild.roles.cache.find(
    r => r.name.toLowerCase() === rankName.toLowerCase()
  );

  if (!role) {
    role = await guild.roles.create({
      name: rankName,
      reason: "Valorant rank role created automatically"
    });
  }

  return role;
}

function isValorantRankRole(roleName) {
  return VALORANT_RANKS.some(
    rank => rank.roleName.toLowerCase() === roleName.toLowerCase()
  );
}

async function removeOldRankRoles(member) {
  const rolesToRemove = member.roles.cache.filter(role =>
    isValorantRankRole(role.name)
  );

  if (rolesToRemove.size > 0) {
    await member.roles.remove(rolesToRemove);
  }
}

async function giveRankRole(member, rankName) {
  await removeOldRankRoles(member);

  const role = await getOrCreateRankRole(member.guild, rankName);

  await member.roles.add(role);

  return role;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Valorant rank system")
    .addSubcommand(subcommand =>
      subcommand
        .setName("verify")
        .setDescription("Tarkistaa Valorant rankin Trackerista ja antaa roolin.")
        .addStringOption(option =>
          option
            .setName("riotid")
            .setDescription("Riot ID muodossa Name#TAG")
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("refresh")
        .setDescription("Päivittää sinun nykyisen Valorant rank-roolin.")
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("me")
        .setDescription("Näyttää sinun linkitetyn Valorant rankin.")
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("unlink")
        .setDescription("Poistaa Valorant linkityksen ja rank-roolit.")
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("list")
        .setDescription("Näyttää kaikki Valorant rank-roolit.")
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const links = loadLinks();

    if (subcommand === "verify") {
      await interaction.deferReply({ ephemeral: true });

      const riotId = interaction.options.getString("riotid");

      try {
        const result = await getValorantRank(riotId);
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const role = await giveRankRole(member, result.rankName);

        links[interaction.user.id] = {
          discordId: interaction.user.id,
          riotId: result.riotId,
          rankName: result.rankName,
          rankTier: result.rankTier,
          profileUrl: result.profileUrl,
          verifiedAt: new Date().toISOString()
        };

        saveLinks(links);

        const embed = new EmbedBuilder()
          .setTitle("Valorant rank verified")
          .setDescription(`Sinulle annettiin rooli **${role.name}**.`)
          .addFields(
            {
              name: "Riot ID",
              value: result.riotId,
              inline: true
            },
            {
              name: "Rank",
              value: result.rankName,
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
          `Verify epäonnistui.\n\n` +
          `**Syy:** ${error.message}\n\n` +
          `Tarkista nämä:\n` +
          `1. Käyttäjä on kirjautunut Tracker.gg:hen Riot-tilillä.\n` +
          `2. Tracker-profiili ei ole private.\n` +
          `3. Riot ID on muodossa \`Name#TAG\`.\n` +
          `4. Botin rooli on Discordissa ylempänä kuin rank-roolit.\n` +
          `5. \`.env\` tiedostossa on oikea \`TRACKER_API_KEY\`.`
        );
      }
    }

    if (subcommand === "refresh") {
      await interaction.deferReply({ ephemeral: true });

      const userData = links[interaction.user.id];

      if (!userData) {
        return interaction.editReply(
          "Sinulla ei ole vielä linkitettyä Valorant käyttäjää. Käytä ensin `/rank verify`."
        );
      }

      try {
        const result = await getValorantRank(userData.riotId);
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const role = await giveRankRole(member, result.rankName);

        links[interaction.user.id] = {
          ...userData,
          rankName: result.rankName,
          rankTier: result.rankTier,
          profileUrl: result.profileUrl,
          refreshedAt: new Date().toISOString()
        };

        saveLinks(links);

        return interaction.editReply(
          `Rank päivitetty onnistuneesti. Sinun uusi rooli on **${role.name}**.`
        );
      } catch (error) {
        return interaction.editReply(`Rankin päivitys epäonnistui: ${error.message}`);
      }
    }

    if (subcommand === "me") {
      const userData = links[interaction.user.id];

      if (!userData) {
        return interaction.reply({
          content: "Sinulla ei ole linkitettyä Valorant käyttäjää. Käytä `/rank verify`.",
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setTitle("Sinun Valorant rank")
        .addFields(
          {
            name: "Riot ID",
            value: userData.riotId,
            inline: true
          },
          {
            name: "Rank",
            value: userData.rankName,
            inline: true
          },
          {
            name: "Tracker",
            value: `[Avaa profiili](${userData.profileUrl})`
          }
        )
        .setColor(0x5865f2);

      return interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    }

    if (subcommand === "unlink") {
      await interaction.deferReply({ ephemeral: true });

      try {
        const member = await interaction.guild.members.fetch(interaction.user.id);

        await removeOldRankRoles(member);

        delete links[interaction.user.id];
        saveLinks(links);

        return interaction.editReply("Valorant linkitys poistettu ja rank-roolit poistettu.");
      } catch (error) {
        return interaction.editReply(`Unlink epäonnistui: ${error.message}`);
      }
    }

    if (subcommand === "list") {
      const rankList = VALORANT_RANKS
        .filter(rank => rank.roleName !== "Unrated")
        .map(rank => `**${rank.tier}.** ${rank.roleName}`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle("Kaikki Valorant rankit")
        .setDescription(rankList)
        .setColor(0xff4655);

      return interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    }
  }
};
