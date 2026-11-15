// SANDLINE look plan, in one place. Six neutrals, one amber accent, one colour per
// team: actors always read against architecture, in the scene and on the HUD.
// The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#6a5a44', // ground / sky fog: sandy dusk, light enough to read at a glance
  surface: '#7a6a50', // walls, floors: warm stone, lighter than the ground
  hairline: '#544832', // crates, trim: darker than the walls so cover reads
  ink: '#ece5d8', // HUD text, light
  muted: '#a89a83', // secondary text
  accent: '#e8a33d', // amber: bomb, highlights, Vanguard trim
  teamA: '#3ec6b8', // VANGUARD (player's team): teal
  teamB: '#e05d3d', // EMBER (enemy team): ember orange
};

// Team names and colours, shared by the sim (bots, HUD, kill feed).
export const TEAMS = {
  A: { id: 'A', name: 'VANGUARD', color: PALETTE.teamA, spawn: 'south' },
  B: { id: 'B', name: 'EMBER', color: PALETTE.teamB, spawn: 'north' },
};
