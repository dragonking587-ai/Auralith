import { LinearFilter, TextureLoader, type Texture } from "three";
import calmUrl from "../assets/flame-calm.webp";
import flareUrl from "../assets/flame-flare.webp";

let atlases: { calm: Texture; flare: Texture } | undefined;
let loaded = 0;

export function getFlameAtlases() {
  if (!atlases) {
    const loader = new TextureLoader();
    const load = (url: string) => {
      const texture = loader.load(url, () => { loaded++; });
      texture.minFilter = LinearFilter;
      texture.magFilter = LinearFilter;
      texture.generateMipmaps = false;
      return texture;
    };
    atlases = { calm: load(calmUrl), flare: load(flareUrl) };
  }
  return atlases;
}

export function flameAtlasesReady() {
  return loaded === 2;
}
