import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { ENEMY_PUNCH_URL, HERO_NINJA } from "./characterCatalog";
import { Atmosphere } from "./Atmosphere";
import { GameAudio } from "./Audio";
import { CombatEffects } from "./CombatEffects";
import { EnemyManager, type EnemyHit } from "./Enemies";
import { fitCharacter } from "./fitCharacter";
import { Input } from "./Input";
import { Nature } from "./Nature";
import { Player } from "./Player";
import { PostFX } from "./PostFX";
import { SKY, SkyDome } from "./Sky";
import { ThirdPersonCamera } from "./ThirdPersonCamera";
import { Village } from "./Village";

const MAX_DELTA = 0.05;

const LOAD_HERO_GLB = true;

/** Seconds without landing a blow before the combo meter drops. */
const COMBO_TIMEOUT = 2.6;
const COMBO_RANKS: ReadonlyArray<[number, string]> = [
  [20, "影 Shadow Legend"],
  [14, "Sublime"],
  [9, "Fierce"],
  [5, "Sharp"],
  [2, "Good"],
];

export class Game {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly timer = new THREE.Timer();

  private readonly player = new Player();
  private readonly followCam: ThirdPersonCamera;
  private readonly input: Input;
  private village: Village | null = null;
  private nature: Nature | null = null;
  private readonly enemies = new EnemyManager(this.scene);
  private readonly audio = new GameAudio();
  private readonly combatEffects = new CombatEffects(this.scene);
  private readonly sky = new SkyDome();
  private readonly atmosphere = new Atmosphere(this.scene);
  private postFX: PostFX | null = null;

  /** Real seconds of near-frozen time after a blow lands. */
  private hitStop = 0;
  /** Real seconds of slow motion, and how slow. */
  private slowMo = 0;
  private slowScale = 1;
  /** Slow-mo from a perfect dodge gets the blue ink look; wave-clear slow-mo does not. */
  private dodgeFocus = false;
  private combo = 0;
  private bestCombo = 0;
  private comboTimer = 0;
  private calloutTimeout = 0;
  private auraTimer = 0;
  private defeatTimer = 0;
  private bannerTimeout = 0;
  private readonly hud = {
    healthFill: document.getElementById("health-fill"),
    kills: document.getElementById("kills"),
    hurt: document.getElementById("hurt-flash"),
    banner: document.getElementById("banner"),
    load: document.getElementById("load-status"),
    pause: document.getElementById("pause-overlay"),
    combo: document.getElementById("combo"),
    comboCount: document.getElementById("combo-count"),
    comboRank: document.getElementById("combo-rank"),
    callout: document.getElementById("callout"),
    counter: document.getElementById("counter-ready"),
    wave: document.getElementById("wave"),
  };
  private paused = false;
  /** Only auto-pause on Esc once the player has actually started playing. */
  private hasPlayed = false;

  private readonly axesHelper = new THREE.AxesHelper(2.5);
  private readonly gridHelper = new THREE.GridHelper(80, 80, 0x5a4638, 0x2a221c);

  private helpersVisible = false;
  private rafId = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      200,
    );

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });

    const hint = document.getElementById("hint");
    this.input = new Input(canvas, hint);
    this.followCam = new ThirdPersonCamera(this.camera, this.player);

    this.loop = this.loop.bind(this);
    this.onResize = this.onResize.bind(this);

    this.player.onHealthChange = (hp, max, damaged) => {
      if (this.hud.healthFill) this.hud.healthFill.style.width = `${(hp / max) * 100}%`;
      if (damaged && this.hud.hurt) {
        this.hud.hurt.classList.remove("is-active");
        void this.hud.hurt.offsetWidth;
        this.hud.hurt.classList.add("is-active");
      }
      if (damaged) {
        this.followCam.addTrauma(0.55);
        this.postFX?.flashHurt();
        this.hitStop = Math.max(this.hitStop, 0.05);
        this.breakCombo();
      }
    };
    this.input.onLockChange = (locked) => {
      if (locked) {
        this.hasPlayed = true;
        this.setPaused(false);
      } else if (this.hasPlayed) {
        this.setPaused(true);
      }
    };
    this.player.onSound = this.audio.play;
    this.player.onAttackEffect = (kind, at, facing) => {
      if (kind === "kick") this.combatEffects.roundhouse(at, facing);
      else if (kind === "punch") {
        this.combatEffects.jab(at, facing);
        // A quick zoom-in sells the snap even when the jab whiffs.
        this.followCam.kickFov(-1.6);
      }
      else {
        this.combatEffects.slam(at);
        this.followCam.addTrauma(0.35);
      }
    };
    this.player.onDust = (at, amount) => this.combatEffects.dust(at, amount);
    this.player.findTarget = (from, range) => this.enemies.nearestAlivePosition(from, range);
    this.player.onRollStart = () => this.checkPerfectDodge();
    this.enemies.onHit = (hit) => this.onEnemyHit(hit);
    this.enemies.onSound = this.audio.play;
    this.enemies.onKill = (kills) => {
      if (this.hud.kills) this.hud.kills.textContent = `Red Clan defeated: ${kills}`;
    };
    this.enemies.onWave = (wave) => {
      const banner = this.hud.banner;
      if (!banner || this.player.isDefeated()) return;
      banner.textContent = `Wave ${wave} — the Red Clan approaches`;
      if (this.hud.wave) this.hud.wave.textContent = `Wave ${wave}`;
      banner.classList.add("is-visible");
      window.clearTimeout(this.bannerTimeout);
      this.bannerTimeout = window.setTimeout(() => banner.classList.remove("is-visible"), 2600);
    };
  }

  init(): void {
    this.setupRenderer();
    this.setupScene();
    this.setupLights();
    this.setupGround();
    this.setupHelpers();
    this.postFX = new PostFX(this.renderer, this.scene, this.camera);
    this.loadVillage();

    this.scene.add(this.player.group);
    this.followCam.syncImmediate();
    this.renderer.render(this.scene, this.camera);
    if (LOAD_HERO_GLB) {
      this.loadHeroNinja();
    }

    this.input.attach();
    window.addEventListener("resize", this.onResize);
    this.onResize();

    this.timer.connect(document);
    this.rafId = requestAnimationFrame(this.loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.onResize);
    this.input.dispose();
    this.postFX?.dispose();
    this.renderer.dispose();
    this.combatEffects.dispose();
    this.atmosphere.dispose();
    this.sky.dispose();
  }

  private setupRenderer(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  private setupScene(): void {
    // The dome paints the sky; fog matches its horizon so distance melts into haze.
    this.scene.background = SKY.fog.clone();
    this.scene.fog = new THREE.Fog(SKY.fog, 38, 125);
    this.scene.add(this.sky.mesh);
  }

  private setupLights(): void {
    const ambient = new THREE.AmbientLight(0xffe8d0, 0.35);
    this.scene.add(ambient);

    // Sky-blue from above, warm bounce from the sunlit earth below.
    const hemi = new THREE.HemisphereLight(0xc4d8f2, 0x8a6e4c, 1.35);
    this.scene.add(hemi);

    // Lower, warmer late-afternoon sun: longer shadows, golden rim light.
    const sun = new THREE.DirectionalLight(0xffd6a0, 3.4);
    sun.name = "Sun";
    sun.position.copy(SKY.sunDir).multiplyScalar(45).add(new THREE.Vector3(0, 0, -6));
    sun.target.position.set(0, 0, -6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;

    const extent = 36;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    sun.shadow.camera.left = -extent;
    sun.shadow.camera.right = extent;
    sun.shadow.camera.top = extent;
    sun.shadow.camera.bottom = -extent;

    this.scene.add(sun);
    this.scene.add(sun.target);

    const fill = new THREE.DirectionalLight(0xb8cff0, 0.7);
    fill.position.set(-14, 12, -18);
    this.scene.add(fill);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.4;
    pmrem.dispose();
  }

  private setupGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({
        color: 0x4f6140,
        roughness: 0.94,
        metalness: 0.03,
      }),
    );
    ground.name = "Ground";
    ground.rotation.x = -Math.PI / 2;
    // Sit below the village earth so the two planes don't z-fight.
    ground.position.y = -0.08;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private setupHelpers(): void {
    this.axesHelper.position.set(0, 0.02, 0);
    this.gridHelper.position.y = 0.01;
    this.axesHelper.visible = false;
    this.gridHelper.visible = false;
    this.scene.add(this.axesHelper, this.gridHelper);
  }

  private loop(time: number): void {
    this.rafId = requestAnimationFrame(this.loop);
    this.timer.update(time);
    const delta = Math.min(this.timer.getDelta(), MAX_DELTA);

    if (this.input.consumePauseToggle()) {
      if (this.paused) {
        this.setPaused(false);
        this.input.requestLock();
      } else {
        this.setPaused(true);
        document.exitPointerLock();
      }
    }

    if (!this.paused) this.update(delta);
    this.render(this.paused ? 0 : delta);
  }

  private setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.input.clearQueued();
    this.audio.setPaused(paused);
    this.hud.pause?.classList.toggle("is-visible", paused);
  }

  private update(delta: number): void {
    if (this.input.consumeHelpersToggle()) {
      this.helpersVisible = !this.helpersVisible;
      this.axesHelper.visible = this.helpersVisible;
      this.gridHelper.visible = this.helpersVisible;
    }
    if (this.input.consumeMuteToggle()) this.audio.toggleMute();
    if (this.input.consumeFxToggle() && this.postFX) {
      this.postFX.enabled = !this.postFX.enabled;
      this.showCallout(this.postFX.enabled ? "Post effects on" : "Post effects off", "info");
    }
    this.audio.updateListener(this.camera);

    const look = this.input.consumeLook();
    const wheel = this.input.consumeWheel();

    // Hit-stop freezes the world for a few frames; slow-mo stretches it.
    // The camera keeps real time so shakes and looking stay responsive.
    const realDelta = delta;
    let scale = 1;
    if (this.hitStop > 0) {
      this.hitStop -= realDelta;
      scale = 0.03;
    } else if (this.slowMo > 0) {
      this.slowMo -= realDelta;
      // Ease back to full speed over the last 0.25 s.
      const ease = THREE.MathUtils.clamp(this.slowMo / 0.25, 0, 1);
      scale = THREE.MathUtils.lerp(1, this.slowScale, ease);
      if (this.slowMo <= 0) this.dodgeFocus = false;
    }
    const gameDelta = delta * scale;
    this.postFX?.setFocus(this.dodgeFocus && this.slowMo > 0 ? 1 : 0);

    this.player.update(gameDelta, this.input, this.camera);
    this.combatEffects.update(gameDelta);
    this.enemies.update(gameDelta, this.player);
    this.updateDefeat(gameDelta);
    this.updateCombo(gameDelta);
    this.updateCounterAura(gameDelta);
    this.audio.updateMusic(realDelta, this.enemies.isInCombat() && !this.player.isDefeated());
    this.village?.update(gameDelta);
    this.nature?.update(gameDelta);
    this.atmosphere.update(gameDelta, this.player.group.position);
    this.followCam.update(realDelta, look.dx, look.dy, wheel, this.player.isSprinting());
    this.sky.update(realDelta, this.camera);
  }

  /** Every connecting blow: freeze-frame, shake, sparks, a number and the combo meter. */
  private onEnemyHit(hit: EnemyHit): void {
    const { attack, killed, at } = hit;
    let power = attack.kind === "punch" ? 1 : attack.kind === "kick" ? 1.4 : 2;
    if (attack.finisher) power = Math.max(power, 2);
    if (attack.counter) power += 1;
    if (killed) power += 0.5;

    this.hitStop = Math.max(this.hitStop, 0.04 + power * 0.022 + (killed ? 0.05 : 0));
    this.followCam.addTrauma(0.12 + power * 0.1);
    if (attack.finisher || killed) this.followCam.kickFov(-4 - power);
    this.combatEffects.hit(at, this.player.group.position, power, attack.counter);
    this.combatEffects.damageNumber(
      at,
      attack.damage,
      killed ? "kill" : attack.counter ? "counter" : attack.finisher ? "heavy" : "normal",
    );

    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.comboTimer = COMBO_TIMEOUT;
    this.renderCombo(true);

    if (attack.counter && !killed) this.showCallout("Counter!", "counter");
    if (hit.lastOfWave) {
      // The last kill of a wave plays out in slow motion.
      this.slowMo = 1.2;
      this.slowScale = 0.22;
      this.dodgeFocus = false;
      window.setTimeout(() => this.showCallout(`Wave ${this.enemies.getWave()} cleared`, "wave"), 350);
    }
  }

  /** Rolling just as a blow is about to land: slow time and empower the next strikes. */
  private checkPerfectDodge(): void {
    if (!this.enemies.isThreatening(this.player)) return;
    this.player.grantCounter();
    this.slowMo = 0.7;
    this.slowScale = 0.28;
    this.dodgeFocus = true;
    this.followCam.kickFov(3);
    this.audio.play("jump_whoosh", undefined, 0.9);
    this.showCallout("Shadow Step", "counter");
  }

  private updateCounterAura(delta: number): void {
    const ready = this.player.hasCounter();
    this.hud.counter?.classList.toggle("is-visible", ready);
    if (!ready) return;
    this.auraTimer -= delta;
    if (this.auraTimer > 0) return;
    this.auraTimer = 0.03;
    this.combatEffects.aura(this.player.group.position);
  }

  private updateCombo(delta: number): void {
    if (this.combo === 0) return;
    this.comboTimer -= delta;
    if (this.comboTimer <= 0) this.breakCombo();
    else this.hud.combo?.style.setProperty("--combo-left", String(this.comboTimer / COMBO_TIMEOUT));
  }

  private breakCombo(): void {
    if (this.combo === 0) return;
    this.combo = 0;
    this.renderCombo(false);
  }

  private renderCombo(pop: boolean): void {
    const { combo, comboCount, comboRank } = this.hud;
    if (!combo || !comboCount || !comboRank) return;
    combo.classList.toggle("is-visible", this.combo >= 2);
    if (this.combo < 2) return;
    comboCount.textContent = String(this.combo);
    comboRank.textContent = COMBO_RANKS.find(([min]) => this.combo >= min)?.[1] ?? "";
    combo.style.setProperty("--combo-left", "1");
    if (pop) {
      combo.classList.remove("is-pop");
      void combo.offsetWidth;
      combo.classList.add("is-pop");
    }
  }

  private showCallout(text: string, kind: "counter" | "wave" | "info"): void {
    const el = this.hud.callout;
    if (!el) return;
    el.textContent = text;
    el.dataset.kind = kind;
    el.classList.remove("is-visible");
    void el.offsetWidth;
    el.classList.add("is-visible");
    window.clearTimeout(this.calloutTimeout);
    this.calloutTimeout = window.setTimeout(() => el.classList.remove("is-visible"), 1300);
  }

  private updateDefeat(delta: number): void {
    if (!this.player.isDefeated()) return;
    if (this.defeatTimer === 0) {
      this.audio.play("defeat");
      window.clearTimeout(this.bannerTimeout);
      if (this.hud.banner) {
        this.hud.banner.textContent = "Defeated by the Red Clan";
        this.hud.banner.classList.add("is-visible");
      }
    }
    this.defeatTimer += delta;
    if (this.defeatTimer < 2.2) return;
    this.defeatTimer = 0;
    this.hud.banner?.classList.remove("is-visible");
    this.player.respawn();
    this.enemies.resetAggro();
    this.breakCombo();
    this.followCam.syncImmediate();
  }

  private render(delta: number): void {
    if (this.postFX) this.postFX.render(delta);
    else this.renderer.render(this.scene, this.camera);
  }

  private onResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    const ratio = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height);
    this.postFX?.setSize(width, height, ratio);
    this.combatEffects.setViewportHeight(height * ratio);
    this.atmosphere.setViewportHeight(height * ratio);
  }

  private loadVillage(): void {
    const village = new Village(this.scene);
    this.village = village;
    void village.load().then(async () => {
      const walls = village.getCollisionMeshes();
      this.player.setCollisionMeshes(walls);
      this.enemies.setCollisionMeshes(walls);

      this.atmosphere.attachLanterns(this.scene);
      // Shader programs are keyed on the scene's light count, so warm the enemy
      // shaders only once the lantern lights are in.
      this.enemies.prewarm = (root) => this.postFX?.prewarm(root) ?? Promise.resolve();
      this.enemies.warmShaders();
      const nature = new Nature(this.scene);
      this.nature = nature;
      await nature.build();
      this.player.water = nature;
      this.enemies.water = nature;
      const all = [...walls, ...nature.getColliders()];
      this.player.setCollisionMeshes(all);
      this.enemies.setCollisionMeshes(all);
    });
  }

  private loadHeroNinja(): void {
    void this.assembleHero();
  }

  private setLoadStatus(text: string | null): void {
    const el = this.hud.load;
    if (!el) return;
    if (!text) {
      el.classList.add("is-hidden");
      return;
    }
    el.textContent = text;
    el.classList.remove("is-hidden");
  }

  private async assembleHero(): Promise<void> {
    this.setLoadStatus("Downloading character…");
    const loader = new GLTFLoader();
    // Start the small move downloads alongside the only mesh and texture file.
    const extraJobs = [
      ENEMY_PUNCH_URL,
      HERO_NINJA.kickUrl,
      HERO_NINJA.jumpHitUrl,
      HERO_NINJA.idleUrl,
      HERO_NINJA.rollUrl,
      HERO_NINJA.jumpUrl,
    ].map((url) => ({ url, promise: loader.loadAsync(url) }));
    const meshPromise = loader.loadAsync(HERO_NINJA.url);

    try {
      const meshGltf = await meshPromise;
      const clips = labelClips(meshGltf.animations, "run");
      const fitted = fitCharacter(meshGltf.scene, HERO_NINJA.height);
      fitted.name = "HeroNinja";
      this.enemies.setTemplate(fitted.userData.animRoot as THREE.Object3D);
      this.player.setModel(fitted, clips, "run");
      this.enemies.addClips(clips);
      this.followCam.syncImmediate();
      this.renderer.render(this.scene, this.camera);
      console.info(
        "[hero] mesh ready:",
        clips.map((c) => `${c.name} (${c.duration.toFixed(2)}s)`).join(", "),
      );
    } catch (err) {
      console.error("Failed to load hero GLB", err);
      this.player.showPlaceholder();
      this.setLoadStatus("Character failed to load");
      return;
    }

    const total = extraJobs.length;
    let ready = 0;
    this.setLoadStatus(`Loading moves… 0/${total}`);

    await Promise.all(
      extraJobs.map(async ({ url: extraUrl, promise }) => {
        try {
          const extraGltf = await promise;
          const extraClips = labelClips(extraGltf.animations, clipLabelFromUrl(extraUrl));
          this.player.addClips(extraClips);
          this.enemies.addClips(extraClips);
          ready += 1;
          this.setLoadStatus(`Loading moves… ${ready}/${total}`);
          console.info(
            "[hero] clip ready:",
            extraClips.map((c) => `${c.name} (${c.duration.toFixed(2)}s)`).join(", ") || extraUrl,
          );
        } catch (err) {
          ready += 1;
          this.setLoadStatus(`Loading moves… ${ready}/${total}`);
          console.error("Failed to load extra hero clip", extraUrl, err);
        }
      }),
    );

    this.setLoadStatus("Ready");
    window.setTimeout(() => this.setLoadStatus(null), 900);
  }

}

function clipLabelFromUrl(
  url: string,
): "idle" | "walk" | "run" | "jump" | "roll" | "kick" | "punch" | "jumphit" {
  const file = url.split("/").pop()?.toLowerCase() ?? "";
  // "jumphit" / "runjump" both contain "jump" — match the more specific names first.
  if (file.includes("jumphit") || file.includes("jumpattack")) return "jumphit";
  if (file.includes("jump")) return "jump";
  if (file.includes("roll") || file.includes("dodge")) return "roll";
  if (file.includes("kick")) return "kick";
  if (file.includes("punch") || file.includes("attack")) return "punch";
  if (file.includes("walk")) return "walk";
  if (file.includes("run")) return "run";
  return "idle";
}

/** Blender names the take "Animation"; the source filename identifies it. */
function labelClips(
  clips: THREE.AnimationClip[],
  fallbackName: string,
): THREE.AnimationClip[] {
  return clips
    .filter((clip) => clip.duration > 0.15 && clip.tracks.length > 0)
    .map((clip) => {
      clip.name = fallbackName;
      return clip;
    });
}
