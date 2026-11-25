import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { avatar3d, avatar3dFromUrl, rbxCdnUrl, type Avatar3DMeta } from "../lib/api";
import { t } from "../lib/i18n";

export type Avatar3DProps = {
  userId: number;
  /** Bump to reload after the avatar changed. */
  version?: number;
  /** A try-on render (avatar/render 3D metadata URL) to show instead of the saved avatar. */
  metaUrl?: string | null;
  /** Backdrop image drawn behind the model (profile / avatar background). */
  backdrop?: string | null;
  className?: string;
};

type Stage = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  model: THREE.Object3D | null;
};

function disposeObject(o: THREE.Object3D) {
  o.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats as THREE.MeshPhongMaterial[]) {
      m.map?.dispose();
      m.dispose();
    }
  });
}

async function loadModel(meta: Avatar3DMeta): Promise<THREE.Object3D> {
  const [mtlText, objText] = await Promise.all([
    fetch(rbxCdnUrl(meta.mtl)).then((r) => r.text()),
    fetch(rbxCdnUrl(meta.obj)).then((r) => r.text()),
  ]);
  // Texture names inside the MTL are content hashes; map them to Roblox's CDN.
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    const name = url.split(/[\\/]/).pop() ?? url;
    return /^https?:/.test(url) && url.includes("rbxcdn.com") ? url : rbxCdnUrl(name);
  });
  const textures = new Promise<void>((resolve) => {
    manager.onLoad = () => resolve();
    setTimeout(resolve, 6000); // never hang on a slow texture
  });
  const mtl = new MTLLoader(manager);
  mtl.setCrossOrigin("anonymous");
  const materials = mtl.parse(mtlText, "");
  materials.preload();
  const obj = new OBJLoader(manager).setMaterials(materials).parse(objText);
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats as THREE.MeshPhongMaterial[]) {
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      m.alphaMap = null; // MTL map_d duplicates the diffuse; its alpha already lives in `map`.
      m.transparent = true;
      m.alphaTest = 0.1;
      m.needsUpdate = true;
    }
  });
  await textures; // swap in only once it looks right (no grey flash)
  return obj;
}

/**
 * Interactive 3D avatar, built from the same OBJ/MTL/texture files Roblox's own 3D viewer
 * uses. Drag to rotate, scroll to zoom. Model swaps happen in place, so try-ons don't flicker.
 */
export function Avatar3D({ userId, version = 0, metaUrl, backdrop, className = "" }: Avatar3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const framed = useRef(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(el.clientWidth || 1, el.clientHeight || 1, false);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(-0.5, 1, 1);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.5);
    rim.position.set(1, 0.4, -1);
    scene.add(rim);

    const camera = new THREE.PerspectiveCamera(70, (el.clientWidth || 1) / (el.clientHeight || 1), 0.1, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    stage.current = { renderer, scene, camera, controls, model: null };

    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      if (stage.current?.model) disposeObject(stage.current.model);
      renderer.dispose();
      renderer.domElement.remove();
      stage.current = null;
      framed.current = false;
    };
  }, []);

  // (Re)load the model: the saved avatar, or a try-on render.
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    (async () => {
      try {
        const meta = metaUrl ? await avatar3dFromUrl(metaUrl) : await avatar3d(userId);
        const obj = await loadModel(meta);
        const s = stage.current;
        if (cancelled || !s) {
          disposeObject(obj);
          return;
        }
        if (s.model) {
          s.scene.remove(s.model);
          disposeObject(s.model);
        }
        s.scene.add(obj);
        s.model = obj;

        // Frame with Roblox's own bounding box + camera, once; keep the user's angle after that.
        if (!framed.current) {
          const min = new THREE.Vector3(meta.aabb.min.x, meta.aabb.min.y, meta.aabb.min.z);
          const max = new THREE.Vector3(meta.aabb.max.x, meta.aabb.max.y, meta.aabb.max.z);
          const center = min.clone().add(max).multiplyScalar(0.5);
          s.camera.fov = meta.camera?.fov ?? 70;
          s.camera.position.set(meta.camera.position.x, meta.camera.position.y, meta.camera.position.z);
          // Roblox's camera hugs the body; back off a little so arms/accessories aren't clipped.
          s.camera.position.sub(center).multiplyScalar(1.2).add(center);
          s.controls.target.copy(center);
          const size = max.clone().sub(min).length();
          s.controls.minDistance = size * 0.4;
          s.controls.maxDistance = size * 3;
          s.camera.updateProjectionMatrix();
          s.controls.update();
          framed.current = true;
        }
        setState("ready");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : t("Couldn't load the 3D avatar."));
        // Keep showing the previous model if there is one.
        if (!stage.current?.model) setState("error");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, version, metaUrl]);

  return (
    <div
      className={`avatar-3d ${backdrop ? "has-backdrop" : ""} ${className}`}
      ref={host}
      style={backdrop ? { backgroundImage: `url("${backdrop}")` } : undefined}
    >
      {state === "loading" ? (
        <div className="avatar-3d-state">
          <div className="model-loader" aria-busy="true" aria-label={t("Loading 3D")}><span /></div>
        </div>
      ) : null}
      {state === "error" ? <div className="avatar-3d-state muted small">{error}</div> : null}
      {busy && state === "ready" ? <div className="avatar-3d-busy" /> : null}
    </div>
  );
}
