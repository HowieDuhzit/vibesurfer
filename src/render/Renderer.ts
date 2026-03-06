import * as THREE from "three";

export class Renderer {
  public readonly webglRenderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;

  public constructor(private readonly mount: HTMLElement) {
    this.webglRenderer = new THREE.WebGLRenderer({ antialias: true });
    this.webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webglRenderer.setSize(this.mount.clientWidth, this.mount.clientHeight);
    this.webglRenderer.shadowMap.enabled = true;
    this.webglRenderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020617);

    this.camera = new THREE.PerspectiveCamera(70, this.aspect, 0.1, 1000);
    this.camera.position.set(0, 4, 6);

    this.mount.appendChild(this.webglRenderer.domElement);

    window.addEventListener("resize", this.onResize);
  }

  public render(): void {
    this.webglRenderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.webglRenderer.dispose();
  }

  private get aspect(): number {
    const width = this.mount.clientWidth || window.innerWidth;
    const height = this.mount.clientHeight || window.innerHeight;
    return width / height;
  }

  private onResize = (): void => {
    const width = this.mount.clientWidth || window.innerWidth;
    const height = this.mount.clientHeight || window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.webglRenderer.setSize(width, height);
  };
}
