# ClaudeNinja

Third-person ninja brawler in the browser: **Three.js** + **Vite** + **TypeScript**.
Forked from [GROKNinja](https://github.com/wolfxxx/GrokNinja) and reworked for combat
feel and atmosphere.

A Mixamo ninja fights waves of the Red Clan in a Japanese village with a shrine,
maple trees, bamboo, grass and wadeable koi ponds. Sound effects and music were
generated with ElevenLabs.

## Run

Large source assets (FBX, GLB, PNG) are stored with [Git LFS](https://git-lfs.com/),
so install it before cloning.

```bash
git lfs install
git clone https://github.com/wolfxxx/ClaudeNinja.git
cd ClaudeNinja
npm install
npm run dev
```

Open `http://localhost:5173` and click the canvas to start.

## Play online

Live site (GitHub Pages): **https://wolfxxx.github.io/Claudeninja/**

First load can take a while — the Mixamo takes and village assets are large.
The site is rebuilt and published automatically on every push to `main`.

The playable ninja is shipped as one GLB with mesh and textures plus small
animation-only GLBs. To rebuild them after changing a source Mixamo take, run
`blender --background --python tools/convert-ninja.py`. Source takes are in
`source/characters/`; keep them outside `public/` so Vite does not publish them.

## What's new in ClaudeNinja

**Combat feel**

- **Punch → punch → roundhouse chain** on left click, with input buffering. The
  roundhouse finisher hits for double damage and launches enemies.
- **Aim assist and lunge**: each strike snaps toward the nearest enemy and closes the gap.
- **Hit-stop, camera shake and FOV punch** scaled to how hard the blow was.
- **Shadow Step**: roll just as an enemy's strike is about to land (watch for the
  orange glint over their head) to slow time. Your next strikes within 1.6 s are
  **counters** — double damage, and they dash across the gap.
- **Combo meter** with ranks, **damage numbers**, **enemy health bars**, spark sprays,
  impact flashes, and dust on rolls, landings and sprints.
- Slow-motion on the last kill of every wave.

**Visuals**

- Late-afternoon gradient sky with sun glow and drifting clouds; fog matched to the horizon.
- Warmer, lower sun with longer shadows; retuned hemisphere and fill light.
- Post-processing: bloom on hot pixels only, warm/cool colour grade, vignette,
  hurt tint and the blue "ink" look during Shadow Step. Toggle with **G**.
- Flickering lantern lights and sunlit dust motes.

## Controls

| Input | Action |
| --- | --- |
| WASD | Move relative to camera |
| Space (hold) | Sprint |
| Left Shift | Jump |
| Ctrl | Roll |
| Left click | Combo: punch, punch, roundhouse |
| Right click | Jump attack |
| Ctrl at the last moment | Shadow Step (perfect dodge → counter) |
| Mouse / Scroll | Look / zoom |
| P or Esc | Pause |
| M | Mute |
| G | Toggle post effects |
| H | Toggle grid + axes helpers |

## Regenerating audio

The scripts read `ELEVENLABS_API_KEY` from the environment and write to
`public/audio/`. Existing files are skipped unless you pass `--force`.

```bash
node tools/generate-sfx.mjs
node tools/generate-music.mjs
```

## Project layout

```
src/game/
├── Game.ts              # scene, lights, loop, HUD, hit-stop/slow-mo, combo
├── Player.ts            # hero movement, combo chain, counters, health, wading
├── Enemies.ts           # Red Clan AI, waves, telegraphs, health bars
├── CombatEffects.ts     # particles, impact flashes, damage numbers, dust
├── PostFX.ts            # bloom, colour grade, vignette, Shadow Step look
├── Sky.ts               # gradient sky dome and shared palette
├── Atmosphere.ts        # lantern lights, dust motes
├── Village.ts           # village layout, shrine, collision
├── Nature.ts            # trees, grass, rocks, ponds, ripples
├── Audio.ts             # Web Audio SFX, ambience, music crossfade
├── ThirdPersonCamera.ts
├── Input.ts
└── constants.ts
```
