// Kindlemoot: every hero, weapon and match number lives in this file.
// The simulation, the bots and the hero select text all read from here,
// so a balance change is one edit in one place.

export const RULES = {
  tickRate: 60,
  gravity: 24,
  jumpVel: 7.6,
  stepHeight: 0.5,
  groundAccel: 75,
  groundFriction: 60,
  airAccel: 16,
  respawnTime: 7,
  spawnShieldTime: 1.5,
  // Objective: hold the Year-Fire.
  pointRadius: 7,
  pointHeight: 5,
  captureTime: 5,          // seconds for one hero to light the fire
  captureBonus: [0, 1, 1.35, 1.6], // capture speed by number of heroes (3+ uses the last)
  captureDecay: 0.25,      // progress lost per second when nobody is capturing
  scoreRate: 100 / 138,    // percent per second while a team holds the fire
  matchTime: 480,          // hard limit in seconds
  unlockDelay: 12,         // the fire can not be captured before this time
  // Ultimate charge.
  ultPerDamage: 1,
  ultPerHeal: 1.1,
  ultPassive: 6,
  // Feast plates (health packs).
  packHeal: 90,
  packRespawn: 14,
  packRadius: 1.4,
  headRadiusScale: 1,
};

const pct = (v) => Math.round(v * 100) + '%';

export const HEROES = {
  marta: {
    id: 'marta',
    name: 'Marta Longnight',
    title: 'The Hearthwarden',
    holiday: 'Midwinter',
    culture: 'Winter solstice, northern Europe',
    role: 'tank',
    difficulty: 1,
    hp: 560,
    speed: 5.3,
    radius: 0.62,
    height: 2.1,
    color: '#3f8f5a',
    accent: '#ffd9a0',
    tagline: 'Holds the line. Burns what comes close.',
    strength: 'Strong against heroes who fight at close range. Her ward stops shots from far away.',
    counter: 'Weak against heroes who stay far away and shoot around the ward.',
    bio: [
      'Marta has kept the Year-Fire through forty longest nights. She carries the old log on her back and a crown of candles on her hood.',
      'Last year the Year-Fire went out for one night, and it was her watch. She will not say what she saw in the dark.',
      'She has not slept since. Meenal brings her tea. Marta has not said thank you yet.',
    ],
    weapon: {
      name: 'Hearth Bellows',
      type: 'flame',
      desc: (w) => `A short stream of embers. It burns every enemy in front of you for ${Math.round(w.damage * w.rate)} damage each second, up to ${w.range} m.`,
      damage: 8.5,
      rate: 10,
      range: 10.5,
      cone: 10,          // half angle in degrees
      mag: 70,
      reload: 1.7,
    },
    abilities: [
      {
        id: 'ward', key: 'shift', name: 'Evergreen Ward', cooldown: 13,
        desc: (a) => `Plant a wreath wall. It stops ${a.hp} damage from enemy shots for ${a.duration} s. Your team can shoot through it.`,
        hp: 600, width: 7, height: 3.6, duration: 7, distance: 2.6,
      },
      {
        id: 'slam', key: 'e', name: 'Log Drop', cooldown: 9,
        desc: (a) => `Drop the Yule log. Enemies within ${a.radius} m take ${a.damage} damage and fly back.`,
        radius: 5.5, damage: 55, knockback: 11, lift: 5,
      },
    ],
    ult: {
      id: 'longnight', name: 'The Longest Night', cost: 1500,
      desc: (u) => `For ${u.duration} s, cold night falls around you. Enemies within ${u.radius} m move ${pct(u.slow)} slower and deal ${pct(1 - u.weaken)} less damage.`,
      radius: 13, duration: 7, slow: 0.35, weaken: 0.65,
    },
    ai: { range: 6, hold: 4 },
  },

  jun: {
    id: 'jun',
    name: 'Jun',
    title: 'The Lion Dancer',
    holiday: 'Lunar New Year',
    culture: 'East and Southeast Asia',
    role: 'tank',
    difficulty: 2,
    hp: 480,
    speed: 5.6,
    radius: 0.6,
    height: 2.0,
    color: '#d8322b',
    accent: '#ffcf3f',
    tagline: 'Jumps in first. Makes noise for two.',
    strength: 'Strong against heroes who hide at the back. The pounce reaches them.',
    counter: 'Weak when alone. A team that shoots Jun together wins.',
    bio: [
      'A lion dance needs two dancers. Jun danced the head, and Jun\'s sister Lan danced the tail.',
      'On the night the Year-Fire went out, Lan walked into the dark to look for it. She has not come back.',
      'Now Jun dances both halves and beats the drum as loud as two people. Don Chema says the noise will help Lan find the way home.',
    ],
    weapon: {
      name: 'Firecracker String',
      type: 'projectile',
      desc: (w) => `Throws ${w.rate} firecrackers each second. Each one does ${w.damage} damage.`,
      damage: 13,
      rate: 9,
      speed: 58,
      spread: 1.5,
      radius: 0.18,
      mag: 45,
      reload: 1.7,
    },
    abilities: [
      {
        id: 'pounce', key: 'shift', name: 'Lion\'s Pounce', cooldown: 7,
        desc: (a) => `Leap where you look. Where you land, enemies within ${a.radius} m take ${a.damage} damage and are pushed away.`,
        speed: 15, lift: 7.5, radius: 4, damage: 50, knockback: 8,
      },
      {
        id: 'luckyred', key: 'e', name: 'Lucky Red', cooldown: 13,
        desc: (a) => `Throw red envelopes. You get ${a.self} extra health and allies within ${a.radius} m get ${a.allies}. It lasts ${a.duration} s.`,
        self: 150, allies: 75, radius: 9, duration: 5,
      },
    ],
    ult: {
      id: 'drums', name: 'New Year Drums', cost: 1500,
      desc: (u) => `Beat the drum ${u.beats} times. Each beat does ${u.damage} damage to enemies within ${u.radius} m and slows them. You take ${pct(u.resist)} less damage while you drum.`,
      beats: 5, interval: 0.8, radius: 9, damage: 45, slow: 0.4, slowTime: 0.7, resist: 0.35,
    },
    ai: { range: 9, hold: 3 },
  },

  tamsin: {
    id: 'tamsin',
    name: 'Tamsin Crowe',
    title: 'The Guiser',
    holiday: 'Halloween',
    culture: 'Samhain and guising, Ireland and Scotland',
    role: 'damage',
    difficulty: 3,
    hp: 200,
    speed: 6.0,
    radius: 0.45,
    height: 1.85,
    color: '#f08a1c',
    accent: '#9d6bff',
    tagline: 'One careful shot from far away.',
    strength: 'Strong at long range. A shot to the head does double damage.',
    counter: 'Weak when an enemy gets close. A ward blocks her shots.',
    bio: [
      'Tamsin carves turnip lanterns and makes masks at the Hollow House. Guisers wear masks so the dark does not know them.',
      'On the night the Year-Fire went out, she saw someone leave the square in one of her masks. She has looked for that mask ever since.',
      'She thinks Pip took it. She takes off her own mask for one person only: Don Chema, who knew her mother.',
    ],
    weapon: {
      name: 'Candlelock',
      type: 'hitscan',
      desc: (w) => `A long rifle. Each shot does ${w.damage} damage, or ${w.damage * w.crit} to the head. Hold the right mouse button to aim.`,
      damage: 72,
      crit: 2,
      rate: 1.2,
      spread: 0.1,
      range: 120,
      mag: 6,
      reload: 1.8,
      zoom: 2.4,
    },
    abilities: [
      {
        id: 'guise', key: 'shift', name: 'Guise', cooldown: 11,
        desc: (a) => `Put on a mask and fade away for ${a.duration} s. You move ${pct(a.speed - 1)} faster. Enemies can not see you. You can not shoot.`,
        duration: 2.5, speed: 1.35,
      },
      {
        id: 'jackobomb', key: 'e', name: 'Jack-o\'-Bomb', cooldown: 8,
        desc: (a) => `Throw a lantern that bursts. It does up to ${a.damage} damage within ${a.radius} m.`,
        speed: 24, gravity: 14, radius: 4.5, damage: 90, minDamage: 30,
      },
    ],
    ult: {
      id: 'crows', name: 'Murder of Crows', cost: 1350,
      desc: (u) => `Send a crow at every enemy you can see within ${u.range} m. Each crow does ${u.damage} damage over ${u.duration} s.`,
      range: 42, damage: 105, duration: 2.5,
    },
    ai: { range: 24, hold: 12 },
  },

  pip: {
    id: 'pip',
    name: 'Pip Motley',
    title: 'The First of April',
    holiday: 'April Fools\' Day',
    culture: 'Spring prank days in many countries',
    role: 'damage',
    difficulty: 2,
    hp: 200,
    speed: 6.4,
    radius: 0.42,
    height: 1.7,
    color: '#e23fa0',
    accent: '#2fd6c3',
    tagline: 'Fast, close and never where you look.',
    strength: 'Strong against slow heroes and heroes who stand at the back alone.',
    counter: 'Weak at long range, and weak against anything that slows or pushes.',
    bio: [
      'Pip keeps the one day when a lie is a gift. Pip once swapped all of Marta\'s coal for licorice, and the town still talks about it.',
      'So when the Year-Fire went out, everybody looked at Pip. Pip swears it was not a prank.',
      'Nobody believes a fool. Pip thinks that is very funny, and also a little sad. Pip wants to win the Kindlemoot and relight the fire in front of everyone.',
    ],
    weapon: {
      name: 'Party Poppers',
      type: 'hitscan',
      desc: (w) => `Two fast poppers. Each shot does ${w.damage} damage up close and less from far away.`,
      damage: 17,
      crit: 1.5,
      rate: 8,
      spread: 2.0,
      range: 60,
      falloffStart: 10,
      falloffEnd: 24,
      falloffMin: 0.4,
      mag: 28,
      reload: 1.3,
    },
    abilities: [
      {
        id: 'gotcha', key: 'shift', name: 'Gotcha!', cooldown: 7,
        desc: (a) => `Jump ${a.distance} m in a blink. A copy of you stays behind for ${a.decoyTime} s and fools enemies.`,
        distance: 9, decoyHp: 80, decoyTime: 3,
      },
      {
        id: 'whoopee', key: 'e', name: 'Whoopee Trap', cooldown: 9,
        desc: (a) => `Throw a trap. When an enemy steps near, it does ${a.damage} damage and slows by ${pct(a.slow)} for ${a.slowTime} s.`,
        speed: 14, gravity: 20, arm: 0.5, trigger: 2.6, radius: 3.5, damage: 65, slow: 0.5, slowTime: 1.5, life: 20,
      },
    ],
    ult: {
      id: 'jackbox', name: 'Jack-in-the-Box', cost: 1300,
      desc: (u) => `Throw a big box. After ${u.fuse} s it springs open. Enemies within ${u.radius} m take ${u.damage} damage and fly high into the air.`,
      speed: 16, gravity: 20, fuse: 0.9, radius: 7, damage: 70, lift: 13, knockback: 6,
    },
    ai: { range: 7, hold: 5 },
  },

  meenal: {
    id: 'meenal',
    name: 'Meenal',
    title: 'The Lampwright',
    holiday: 'Diwali',
    culture: 'Festival of lights, India',
    role: 'support',
    difficulty: 2,
    hp: 200,
    speed: 6.0,
    radius: 0.45,
    height: 1.75,
    color: '#c2185b',
    accent: '#ffc247',
    tagline: 'Heals with light. Keeps the team on the fire.',
    strength: 'Strong when the team stands together. Her light heals many allies at once.',
    counter: 'Weak when the team spreads out, and weak when an enemy reaches her.',
    bio: [
      'Meenal makes clay lamps and draws rangoli, the bright patterns that welcome guests at the door.',
      'On the night the Year-Fire went out, she put one lamp in every window of the Almanac, so nobody had to sit in the dark.',
      'She taught Jun to hide a lamp in the lion\'s mouth. She brings Marta tea. She does not need a thank you, but she counts the days.',
    ],
    weapon: {
      name: 'Sparkler',
      type: 'projectile',
      desc: (w) => `Throws sparks. A spark heals an ally for ${w.heal} or does ${w.damage} damage to an enemy.`,
      damage: 26,
      heal: 36,
      rate: 2.6,
      speed: 62,
      spread: 0.2,
      radius: 0.3,
      mag: 14,
      reload: 1.5,
    },
    abilities: [
      {
        id: 'rangoli', key: 'shift', name: 'Rangoli', cooldown: 13,
        desc: (a) => `Draw a pattern of light at your feet. Allies who stand on it heal ${a.heal} each second for ${a.duration} s.`,
        radius: 5, heal: 32, duration: 6,
      },
      {
        id: 'sweetbox', key: 'e', name: 'Sweet Box', cooldown: 9,
        desc: (a) => `Give a sweet to the ally you look at, or to yourself. It heals ${a.heal} and gives ${pct(a.speed - 1)} more speed for ${a.duration} s.`,
        range: 22, cone: 25, heal: 80, speed: 1.25, duration: 3,
      },
    ],
    ult: {
      id: 'lights', name: 'Festival of Lights', cost: 1500,
      desc: (u) => `Light a hundred lamps for ${u.duration} s. Allies within ${u.radius} m heal ${u.heal} each second and take ${pct(u.resist)} less damage.`,
      radius: 12, duration: 6, heal: 65, resist: 0.25,
    },
    ai: { range: 14, hold: 8 },
  },

  chema: {
    id: 'chema',
    name: 'Don Chema',
    title: 'The Serenader',
    holiday: 'Day of the Dead',
    culture: 'Día de Muertos, Mexico',
    role: 'support',
    difficulty: 1,
    hp: 200,
    speed: 6.0,
    radius: 0.45,
    height: 1.8,
    color: '#ff9a1f',
    accent: '#35c2d6',
    tagline: 'His songs make the whole team hit harder.',
    strength: 'Strong on a team that attacks. His songs add speed and damage.',
    counter: 'Weak when the team is losing a fight. His healing is slow.',
    bio: [
      'Don Chema plays for the people who are away. Each autumn he lays a path of marigolds so they can find the door.',
      'He says Lan is not gone, only late. He keeps a place for her at the table and a second chair for Jun.',
      'He knew Tamsin\'s mother, and he is the only one who sees Tamsin without her mask. He thinks the Year-Fire went out for a reason, and he is not afraid of it.',
    ],
    weapon: {
      name: 'Serenade',
      type: 'projectile',
      desc: (w) => `Plays sharp notes. Each note does ${w.damage} damage.`,
      damage: 26,
      rate: 3,
      speed: 66,
      spread: 0.3,
      radius: 0.2,
      mag: 12,
      reload: 1.5,
    },
    abilities: [
      {
        id: 'marigold', key: 'shift', name: 'Marigold Path', cooldown: 12,
        desc: (a) => `Play a walking song for ${a.duration} s. You and allies within ${a.radius} m heal ${a.heal} each second and move ${pct(a.speed - 1)} faster.`,
        radius: 9, duration: 5, heal: 22, speed: 1.25,
      },
      {
        id: 'rattle', key: 'e', name: 'Calaca Rattle', cooldown: 10,
        desc: (a) => `Shake the rattle at enemies in front of you. For ${a.duration} s they take ${pct(a.amp - 1)} more damage.`,
        range: 16, cone: 35, duration: 4, amp: 1.25,
      },
    ],
    ult: {
      id: 'lastsong', name: 'The Last Song', cost: 1500,
      desc: (u) => `A band of friends plays with you for ${u.duration} s. You and allies within ${u.radius} m do ${pct(u.boost - 1)} more damage and heal for ${pct(u.lifesteal)} of the damage they do.`,
      radius: 12, duration: 7, boost: 1.3, lifesteal: 0.3,
    },
    ai: { range: 15, hold: 8 },
  },
};

export const HERO_IDS = Object.keys(HEROES);
export const ROLES = ['tank', 'damage', 'support'];
export const ROLE_NAMES = { tank: 'Tank', damage: 'Damage', support: 'Support' };

export const TEAMS = [
  { id: 0, name: 'Dawn Troupe', short: 'Dawn', color: '#ffb347' },
  { id: 1, name: 'Dusk Troupe', short: 'Dusk', color: '#8f7bff' },
];

// Bot skill levels. Balance tests use "normal".
export const DIFFICULTY = {
  easy:   { label: 'Gentle',  aimError: 3.4, aimSpeed: 5.5, reaction: 0.55, abilityDelay: 1.6, ultSense: 0.5, strafe: 0.4, headAim: 0.0 },
  normal: { label: 'Fair',    aimError: 2.0, aimSpeed: 8,   reaction: 0.32, abilityDelay: 0.7, ultSense: 0.8, strafe: 0.7, headAim: 0.15 },
  hard:   { label: 'Fierce',  aimError: 1.1, aimSpeed: 11,  reaction: 0.18, abilityDelay: 0.3, ultSense: 1.0, strafe: 1.0, headAim: 0.35 },
};

export const WORLD_TEXT = {
  title: 'Kindlemoot',
  subtitle: 'A holiday hero shooter',
  intro: [
    'The Almanac is a town between the days. Every festival has a house there, and every house has a Keeper.',
    'In the middle of the town burns the Year-Fire. Once a year the Keepers split into two troupes and hold the Kindlemoot. The troupe that holds the fire lights the first day of the new year.',
    'Last year the fire went out for one night. Nobody agrees why. This year, everybody wants to win.',
  ],
};

export function describe(item) {
  return typeof item.desc === 'function' ? item.desc(item) : item.desc;
}
