// Feste Gesamtbilanz (je Account-ID) für Spieler, bei denen STRATZ/OpenDota unvollständige Daten liefern.
// Eintrag je Held: [Name wie bei Dotabuff, Spiele gesamt, Winrate in %]. Die App ordnet die Namen beim Start den Hero-IDs zu.
// Ein im Browser eingefügter Dotabuff-Import (Team-Panel) hat Vorrang vor diesen Werten.
export type TotalsRow = [name: string, games: number, winPct: number];

export const DEFAULT_TOTALS_UPDATED = '03.11.2026';

export const DEFAULT_TOTALS: Record<string, TotalsRow[]> = {
  // Dirty Harry – Dotabuff „Heroes“, Stand 03.11.2026
  '51114035': [
    ['Brewmaster', 457, 60.39], ['Axe', 362, 60.22], ['Legion Commander', 317, 55.21], ['Bristleback', 219, 66.67],
    ['Undying', 212, 59.91], ['Lich', 181, 51.93], ['Dawnbreaker', 170, 54.12], ['Enchantress', 142, 50.70],
    ['Ogre Magi', 134, 58.21], ['Skywrath Mage', 83, 46.99], ['Viper', 75, 48.00], ['Zeus', 65, 46.15],
    ['Windranger', 50, 56.00], ['Phantom Assassin', 44, 56.82], ['Faceless Void', 41, 36.59], ['Tidehunter', 39, 58.97],
    ['Pudge', 36, 30.56], ['Witch Doctor', 36, 50.00], ['Sniper', 34, 41.18], ['Dragon Knight', 33, 66.67],
    ['Doom', 33, 45.45], ['Necrophos', 31, 45.16], ['Phantom Lancer', 27, 51.85], ['Leshrac', 27, 70.37],
    ['Jakiro', 27, 40.74], ['Wraith King', 26, 76.92], ['Underlord', 26, 61.54], ['Lina', 24, 29.17],
    ['Grimstroke', 19, 42.11], ['Vengeful Spirit', 19, 36.84], ['Abaddon', 18, 55.56], ['Night Stalker', 18, 50.00],
    ['Shadow Shaman', 16, 37.50], ['Venomancer', 16, 31.25], ['Disruptor', 16, 50.00], ['Crystal Maiden', 14, 42.86],
    ['Juggernaut', 14, 71.43], ['Techies', 14, 35.71], ['Lion', 14, 35.71], ['Centaur Warrunner', 13, 53.85],
    ['Mars', 12, 41.67], ['Pangolier', 11, 63.64], ['Timbersaw', 11, 36.36], ['Queen of Pain', 11, 18.18],
    ['Nyx Assassin', 11, 36.36], ['Tiny', 10, 40.00], ['Keeper of the Light', 9, 33.33], ['Razor', 9, 22.22],
    ['Anti-Mage', 8, 37.50], ['Gyrocopter', 8, 50.00], ['Spirit Breaker', 8, 62.50], ['Drow Ranger', 8, 37.50],
    ['Sven', 7, 42.86], ['Rubick', 7, 42.86], ['Omniknight', 7, 28.57], ['Snapfire', 7, 71.43],
    ['Chaos Knight', 7, 57.14], ['Ursa', 6, 16.67], ['Silencer', 6, 50.00], ['Lycan', 6, 50.00],
    ['Clockwerk', 6, 16.67], ['Warlock', 5, 40.00], ["Nature's Prophet", 5, 60.00], ['Enigma', 5, 40.00],
    ['Dark Willow', 5, 80.00], ['Earthshaker', 5, 40.00], ['Dark Seer', 4, 75.00], ['Treant Protector', 4, 0],
    ['Medusa', 4, 25.00], ['Bane', 4, 0], ['Alchemist', 4, 50.00], ['Slardar', 4, 50.00],
    ['Oracle', 3, 33.33], ['Tusk', 3, 33.33], ['Death Prophet', 3, 33.33], ['Dazzle', 3, 33.33],
    ['Beastmaster', 3, 33.33], ['Winter Wyvern', 3, 100], ['Chen', 2, 50.00], ['Weaver', 2, 0],
    ['Sand King', 2, 50.00], ['Pugna', 2, 50.00], ['Phoenix', 2, 50.00], ['Naga Siren', 2, 50.00],
    ['Broodmother', 2, 100], ['Bounty Hunter', 2, 0], ['Luna', 2, 100], ['Terrorblade', 2, 50.00],
    ['Ancient Apparition', 2, 50.00], ['Bloodseeker', 2, 50.00], ['Monkey King', 2, 50.00], ['Clinkz', 2, 0],
    ['Lifestealer', 2, 50.00], ['Riki', 2, 50.00], ['Slark', 2, 0], ['Troll Warlord', 2, 50.00],
    ['Io', 1, 0], ['Morphling', 1, 100], ['Mirana', 1, 100], ['Batrider', 1, 0],
    ['Magnus', 1, 100], ['Shadow Fiend', 1, 0], ['Spectre', 1, 100], ['Shadow Demon', 1, 0],
    ['Ember Spirit', 1, 0], ['Meepo', 1, 0], ['Invoker', 1, 0],
  ],
};
