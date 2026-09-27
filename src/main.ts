import "./style.css";
import { Game } from "./game/Game";

const canvas = document.querySelector("#game-canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Missing #game-canvas");
}

const game = new Game(canvas);
game.init();

// Dev-only handle for poking at the running game from the console / test scripts.
if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
