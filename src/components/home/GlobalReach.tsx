import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import topologyData from '../../assets/geo/world-110m.topo.json';
import { GLOBAL_REACH_COUNTRIES, type GlobalReachCountry } from '../../data/globalReachConfig';
import { publicMedia } from '../../data/publicMedia';
import { resolveGlobeAppearance, type GlobeAppearanceTheme } from '../../data/globeAppearance';
import type { HeroVideoTheme } from '../../data/heroVideo';
import type { SiteContent } from '../../data/siteContent';
import type { AnimationSettings } from '../../data/siteContent';

type ArcIndex = number;

interface TopologyGeometry {
  id?: string | number;
  type: string;
  arcs: ArcIndex[][] | ArcIndex[][][];
}

interface MapPolygon {
  id: string;
  rings: number[][][][];
}

const topology = topologyData as {
  transform: { scale: number[]; translate: number[] };
  arcs: number[][][];
  objects: { countries: { geometries: TopologyGeometry[] } };
};
const textureWidth = 2048;
const textureHeight = 1024;
const rgbaFromHex = (hex: string, alpha: number) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
};

const worldPolygons: MapPolygon[] = topology.objects.countries.geometries.map((geometry) => {
  const polygons = geometry.type === 'Polygon'
    ? [geometry.arcs as ArcIndex[][]]
    : geometry.arcs as ArcIndex[][][];
  return {
    id: String(geometry.id ?? '').padStart(3, '0'),
    rings: polygons.map((polygon) => polygon.map((ring) => {
      const points: number[][] = [];
      ring.forEach((arcIndex) => {
        const index = arcIndex < 0 ? ~arcIndex : arcIndex;
        let x = 0;
        let y = 0;
        const arc = topology.arcs[index].map(([dx, dy]) => {
          x += dx;
          y += dy;
          return [
            x * topology.transform.scale[0] + topology.transform.translate[0],
            y * topology.transform.scale[1] + topology.transform.translate[1],
          ];
        });
        if (arcIndex < 0) arc.reverse();
        points.push(...arc);
      });
      return points;
    })),
  };
});

function pointInRing(longitude: number, latitude: number, ring: number[][]): boolean {
  if (ring.length < 3) return false;

  const unwrappedRing: [number, number][] = [];
  let previousLongitude = ring[0][0];
  ring.forEach(([ringLongitude, ringLatitude], index) => {
    const unwrappedLongitude = index === 0
      ? ringLongitude
      : previousLongitude + (((ringLongitude - previousLongitude + 180) % 360 + 360) % 360) - 180;
    unwrappedRing.push([unwrappedLongitude, ringLatitude]);
    previousLongitude = unwrappedLongitude;
  });
  const ringCenter = unwrappedRing.reduce((total, [ringLongitude]) => total + ringLongitude, 0) / unwrappedRing.length;
  const pointLongitude = longitude + 360 * Math.round((ringCenter - longitude) / 360);
  let inside = false;
  for (let index = 0, previous = unwrappedRing.length - 1; index < unwrappedRing.length; previous = index, index += 1) {
    const [currentLongitude, currentLatitude] = unwrappedRing[index];
    const [previousLongitude, previousLatitude] = unwrappedRing[previous];
    const crossesLatitude = (currentLatitude > latitude) !== (previousLatitude > latitude);
    if (crossesLatitude && pointLongitude < ((previousLongitude - currentLongitude) * (latitude - currentLatitude)) / (previousLatitude - currentLatitude) + currentLongitude) {
      inside = !inside;
    }
  }
  return inside;
}

function countryAtCoordinates(longitude: number, latitude: number): GlobalReachCountry | undefined {
  return GLOBAL_REACH_COUNTRIES.find((country) => {
    const polygon = worldPolygons.find((candidate) => candidate.id === country.topologyId);
    return polygon?.rings.some((rings) =>
      pointInRing(longitude, latitude, rings[0]) &&
      rings.slice(1).every((hole) => !pointInRing(longitude, latitude, hole)),
    );
  });
}

const cities: [number, number][] = [
  [77.2, 28.6], [72.88, 19.07], [88.36, 22.57], [80.27, 13.08], [77.59, 12.97],
  [121.47, 31.23], [116.4, 39.9], [139.69, 35.69], [135.5, 34.7], [126.98, 37.56],
  [114.17, 22.32], [121, 14.6], [100.5, 13.75], [106.8, -6.2], [103.82, 1.35],
  [101.69, 3.14], [55.27, 25.2], [46.68, 24.71], [-0.12, 51.5], [-74, 40.71],
  [-118.24, 34.05], [-99.13, 19.43], [-46.63, -23.55], [-43.2, -22.9],
  [-79.38, 43.65], [-123.12, 49.28], [151.21, -33.87], [144.96, -37.81],
];

const createMapTexture = (
  canvas: HTMLCanvasElement,
  selected: GlobalReachCountry,
  settings: AnimationSettings,
  theme: GlobeAppearanceTheme,
) => {
  const context = canvas.getContext('2d');
  if (!context) return;
  const lightTheme = theme === 'light';
  const appearance = resolveGlobeAppearance(theme, settings);
  context.clearRect(0, 0, textureWidth, textureHeight);
  context.fillStyle = appearance.oceanColor;
  context.fillRect(0, 0, textureWidth, textureHeight);

  const point = ([longitude, latitude]: number[]) => [
    ((longitude + 180) / 360) * textureWidth,
    ((90 - latitude) / 180) * textureHeight,
  ];
  const drawPolygon = (polygon: MapPolygon, mode: 'land' | 'selected') => {
    context.beginPath();
    polygon.rings.forEach((rings) => {
      rings.forEach((ring) => {
        ring.forEach((coordinate, index) => {
          const [x, y] = point(coordinate);
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.closePath();
      });
    });
    if (mode === 'land') {
      context.fillStyle = appearance.landColor;
      context.fill('evenodd');
      context.strokeStyle = lightTheme ? appearance.countryBorderColor : 'rgba(190, 207, 218, 0.18)';
      context.globalAlpha = lightTheme ? appearance.countryBorderOpacity : 1;
      context.lineWidth = 0.75;
      context.stroke();
      context.globalAlpha = 1;
    } else {
      context.strokeStyle = appearance.selectionOutlineColor;
      if (lightTheme) {
        context.fillStyle = rgbaFromHex(appearance.selectionOutlineColor, 0.24);
        context.fill('evenodd');
      }
      context.lineWidth = 3;
      context.shadowColor = lightTheme
        ? rgbaFromHex(appearance.selectionGlowColor, appearance.selectionGlowIntensity)
        : appearance.selectionGlowColor;
      context.shadowBlur = lightTheme ? appearance.selectionGlowIntensity * 14 : 4;
      context.stroke();
      context.shadowBlur = 0;
    }
  };

  worldPolygons.forEach((polygon) => drawPolygon(polygon, 'land'));
  if (appearance.gridEnabled) {
    context.strokeStyle = lightTheme ? '#71816D' : 'rgba(186, 202, 211, 0.08)';
    context.globalAlpha = lightTheme ? appearance.gridOpacity : 1;
    context.lineWidth = 0.8;
    for (let latitude = -60; latitude <= 60; latitude += 30) {
      const y = point([0, latitude])[1];
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(textureWidth, y);
      context.stroke();
    }
    for (let longitude = -150; longitude <= 180; longitude += 30) {
      const x = point([longitude, 0])[0];
      context.beginPath();
      context.moveTo(x, point([0, -85])[1]);
      context.lineTo(x, point([0, 85])[1]);
      context.stroke();
    }
    context.globalAlpha = 1;
  }
  cities.forEach((city, index) => {
    const [x, y] = point(city);
    context.beginPath();
    context.arc(x, y, index % 4 === 0 ? 3.2 : 1.8, 0, Math.PI * 2);
    context.fillStyle = lightTheme
      ? (index % 4 === 0 ? 'rgba(245, 166, 35, 0.55)' : 'rgba(35, 115, 75, 0.42)')
      : (index % 4 === 0 ? 'rgba(245, 166, 35, 0.72)' : 'rgba(232, 204, 145, 0.46)');
    context.fill();
  });
  const selectedPolygon = worldPolygons.find((polygon) => polygon.id === selected.topologyId);
  if (selectedPolygon) drawPolygon(selectedPolygon, 'selected');
};

const vectorForCoordinates = (
  latitude: number,
  longitude: number,
  radius: number,
  target = new THREE.Vector3(),
) => {
  const phi = THREE.MathUtils.degToRad(latitude);
  const theta = THREE.MathUtils.degToRad(longitude);
  return target.set(
    radius * Math.cos(phi) * Math.cos(theta),
    radius * Math.sin(phi),
    -radius * Math.cos(phi) * Math.sin(theta),
  );
};

const orientationForCoordinates = (latitude: number, longitude: number) => {
  const phi = THREE.MathUtils.degToRad(latitude);
  const theta = THREE.MathUtils.degToRad(longitude);
  const east = new THREE.Vector3(-Math.sin(theta), 0, -Math.cos(theta));
  const north = new THREE.Vector3(
    -Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  );
  const outward = vectorForCoordinates(latitude, longitude, 1);
  const geographicBasis = new THREE.Matrix4().makeBasis(east, north, outward);
  return new THREE.Quaternion().setFromRotationMatrix(geographicBasis).invert();
};

interface GlobeRendererProps {
  selectedCountry: GlobalReachCountry;
  onSelect: (country: GlobalReachCountry) => void;
  reducedMotion: boolean;
  hasSelection: boolean;
  settings: AnimationSettings;
}

function GlobeRenderer({ selectedCountry, onSelect, reducedMotion, hasSelection, settings }: GlobeRendererProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const earthRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const markerRef = useRef<THREE.Group | null>(null);
  const labelOverlayRef = useRef<HTMLDivElement>(null);
  const mapResourcesRef = useRef<{ canvas: HTMLCanvasElement; texture: THREE.CanvasTexture } | null>(null);
  const refreshAppearanceRef = useRef<() => void>(() => {});
  const requestRenderRef = useRef<() => void>(() => {});
  const rotationTransitionRef = useRef<{
    from: THREE.Quaternion;
    to: THREE.Quaternion;
    startedAt: number;
  } | null>(null);
  const scaleTransitionRef = useRef<{ from: number; to: number; startedAt: number } | null>(null);
  const selectedRef = useRef(selectedCountry);
  const onSelectRef = useRef(onSelect);
  const pointerDownRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const motionRef = useRef(reducedMotion);
  const hasSelectionRef = useRef(hasSelection);
  const settingsRef = useRef(settings);
  const [renderFailed, setRenderFailed] = useState(false);

  selectedRef.current = selectedCountry;
  onSelectRef.current = onSelect;
  motionRef.current = reducedMotion;
  hasSelectionRef.current = hasSelection;
  settingsRef.current = settings;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
      });
    } catch {
      setRenderFailed(true);
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    const ambientLight = new THREE.AmbientLight(0x95a6b9, 1.25);
    scene.add(ambientLight);
    const keyLight = new THREE.DirectionalLight(0xd7e6f0, 2);
    keyLight.position.set(-3, 2, 5);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x70c442, 0.9);
    rimLight.position.set(2, -1, -4);
    scene.add(rimLight);

    const earth = new THREE.Group();
    earth.scale.setScalar(0.94 * settingsRef.current.globeSize / 100);
    scene.add(earth);
    const mapCanvas = document.createElement('canvas');
    mapCanvas.width = textureWidth;
    mapCanvas.height = textureHeight;
    createMapTexture(
      mapCanvas,
      selectedRef.current,
      settingsRef.current,
      document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
    );
    const mapTexture = new THREE.CanvasTexture(mapCanvas);
    mapTexture.colorSpace = THREE.SRGBColorSpace;
    mapTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
    const globeMaterial = new THREE.MeshPhongMaterial({
      map: mapTexture,
      color: 0xd1dbe1,
      specular: 0x17232e,
      shininess: 10,
    });
    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 96, 64),
      globeMaterial,
    );
    earth.add(globe);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const handlePointerDown = (event: PointerEvent) => {
      if ((event.pointerType === 'mouse' && event.button !== 0) || !event.isPrimary) return;
      pointerDownRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const handlePointerUp = (event: PointerEvent) => {
      const pointerDown = pointerDownRef.current;
      if (!pointerDown || pointerDown.pointerId !== event.pointerId) return;
      pointerDownRef.current = null;
      if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 8) return;

      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height ||
        event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) return;
      pointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      camera.updateMatrixWorld();
      earth.updateMatrixWorld(true);
      raycaster.setFromCamera(pointer, camera);
      const intersection = raycaster.intersectObject(globe, false)[0];
      if (!intersection) return;

      const localPoint = earth.worldToLocal(intersection.point.clone()).normalize();
      const latitude = THREE.MathUtils.radToDeg(Math.asin(localPoint.y));
      const longitude = THREE.MathUtils.radToDeg(Math.atan2(-localPoint.z, localPoint.x));
      const country = countryAtCoordinates(longitude, latitude);
      if (country) onSelectRef.current(country);
    };
    const handlePointerCancel = () => {
      pointerDownRef.current = null;
    };
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerCancel);
    const atmosphereMaterial = new THREE.MeshBasicMaterial({
      color: 0xa4c3d5,
      transparent: true,
      opacity: 0.1,
      side: THREE.BackSide,
    });
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.565, 64, 48),
      atmosphereMaterial,
    );
    earth.add(atmosphere);

    const lightPositions = cities.map(([longitude, latitude]) => vectorForCoordinates(latitude, longitude, 1.506));
    const cityLightsMaterial = new THREE.PointsMaterial({
      color: 0xe6c58c,
      size: 0.018,
      transparent: true,
      opacity: 0.66,
      sizeAttenuation: true,
      depthWrite: false,
    });
    const cityLights = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(lightPositions),
      cityLightsMaterial,
    );
    earth.add(cityLights);

    const marker = new THREE.Group();
    const markerDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xf5a623 }),
    );
    marker.add(markerDot);
    const markerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.078, 32),
      new THREE.MeshBasicMaterial({
        color: 0xf5a623,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    markerRing.position.z = 0.008;
    marker.add(markerRing);
    marker.userData.ring = markerRing;
    earth.add(marker);
    markerRef.current = marker;

    let resizeScene = () => {};
    const routes = new THREE.Group();
    const origin = vectorForCoordinates(20.5937, 78.9629, 1.5);
    const particles: { mesh: THREE.Mesh; routePoints: THREE.Vector3[]; phase: number }[] = [];
    GLOBAL_REACH_COUNTRIES.filter((country) => country.id !== 'IN').forEach((country, index) => {
      const destination = vectorForCoordinates(country.lat, country.lng, 1.5);
      const points: THREE.Vector3[] = [];
      for (let step = 0; step <= 72; step += 1) {
        const t = step / 72;
        const point = origin.clone().lerp(destination, t).normalize().multiplyScalar(1.505 + Math.sin(Math.PI * t) * 0.12);
        points.push(point);
      }
      const route = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: 0x348d3c,
          transparent: true,
          opacity: 0.34,
          depthTest: true,
          depthWrite: false,
        }),
      );
      routes.add(route);
      const endpointMarker = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 12, 8),
        new THREE.MeshBasicMaterial({
          color: 0x82cf50,
          transparent: true,
          depthTest: true,
          depthWrite: false,
        }),
      );
      endpointMarker.position.copy(vectorForCoordinates(country.lat, country.lng, 1.518));
      endpointMarker.userData.isRouteEndpoint = true;
      routes.add(endpointMarker);
      const particle = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 8, 8),
        new THREE.MeshBasicMaterial({
          color: 0x9bcf68,
          transparent: true,
          depthTest: true,
          depthWrite: false,
        }),
      );
      particles.push({ mesh: particle, routePoints: points, phase: index / 9 });
      routes.add(particle);
    });
    earth.add(routes);

    const updateTheme = () => {
      const lightTheme = document.documentElement.dataset.theme === 'light';
      const theme = lightTheme ? 'light' : 'dark';
      const appearance = resolveGlobeAppearance(theme, settingsRef.current);
      createMapTexture(mapCanvas, selectedRef.current, settingsRef.current, theme);
      mapTexture.needsUpdate = true;

      globeMaterial.color.setHex(lightTheme ? 0xffffff : 0xd1dbe1);
      globeMaterial.specular.setHex(lightTheme ? 0x7c9480 : 0x17232e);
      globeMaterial.shininess = lightTheme ? 8 : 10;
      ambientLight.color.setHex(lightTheme ? 0xffffff : 0x95a6b9);
      ambientLight.intensity = lightTheme ? 1.55 : 1.25;
      keyLight.color.setHex(lightTheme ? 0xfff9eb : 0xd7e6f0);
      keyLight.intensity = lightTheme ? 1.1 : 2;
      rimLight.color.setHex(lightTheme ? 0xd7e8ce : 0x70c442);
      rimLight.intensity = lightTheme ? 0.45 : 0.9;
      atmosphereMaterial.color.setHex(lightTheme ? 0xdce8d2 : 0xa4c3d5);
      atmosphereMaterial.opacity = lightTheme ? appearance.atmosphereIntensity : 0.1;
      cityLightsMaterial.color.setHex(lightTheme ? Number.parseInt(appearance.markerColor.slice(1), 16) : 0xe6c58c);
      const selectedColor = lightTheme ? appearance.selectionOutlineColor : '#f5a623';
      markerDot.material.color.set(selectedColor);
      markerRing.material.color.set(lightTheme ? appearance.selectionGlowColor : selectedColor);
      markerRing.material.opacity = lightTheme
        ? 0.15 + appearance.selectionGlowIntensity * 0.7
        : 0.8;
      routes.children.forEach((route) => {
        if (route instanceof THREE.Line) {
          const material = route.material as THREE.LineBasicMaterial;
          material.color.set(appearance.routeColor);
          material.opacity = appearance.routeOpacity;
        } else if (route instanceof THREE.Mesh) {
          const material = route.material as THREE.MeshBasicMaterial;
          material.color.set(appearance.markerColor);
          if (route.userData.isRouteEndpoint) route.visible = lightTheme;
        }
      });
      resizeScene();
      requestRenderRef.current();
    };
    refreshAppearanceRef.current = updateTheme;
    updateTheme();
    const themeObserver = new MutationObserver(updateTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const selectedVector = vectorForCoordinates(selectedRef.current.lat, selectedRef.current.lng, 1.505);
    marker.position.copy(selectedVector);
    marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), selectedVector.clone().normalize());
    earth.quaternion.copy(orientationForCoordinates(selectedRef.current.lat, selectedRef.current.lng));
    earthRef.current = earth;
    cameraRef.current = camera;
    mapResourcesRef.current = { canvas: mapCanvas, texture: mapTexture };

    let isVisible = false;
    let isDocumentVisible = !document.hidden;
    let frame = 0;
    let lastFrame = performance.now();
    let wrapperWidth = 0;
    let wrapperHeight = 0;
    let popupWidth = 0;
    let popupHeight = 0;
    const markerVector = new THREE.Vector3();
    const markerDirection = new THREE.Vector3();
    const markerForward = new THREE.Vector3(0, 0, 1);
    const markerPosition = new THREE.Vector3();
    const resize = () => {
      const bounds = wrapperRef.current?.getBoundingClientRect();
      if (!bounds) return;
      wrapperWidth = Math.max(1, bounds.width);
      wrapperHeight = Math.max(1, bounds.height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(wrapperWidth, wrapperHeight, false);
      camera.aspect = wrapperWidth / wrapperHeight;
      camera.updateProjectionMatrix();
      const margin = Math.max(24, Math.min(42, Math.min(wrapperWidth, wrapperHeight) * 0.07));
      const safeRadius = Math.max(1, Math.min(wrapperWidth / 2 - margin, wrapperHeight / 2 - margin) / 1.14);
      const focalLength = wrapperHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      const framing = document.documentElement.dataset.theme === 'light' ? 1.32 : 1.68;
      camera.position.z = (framing * focalLength) / safeRadius;
      requestRenderRef.current();
    };
    resizeScene = resize;
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (wrapperRef.current) resizeObserver?.observe(wrapperRef.current);
    const popup = labelOverlayRef.current;
    const popupBounds = popup?.getBoundingClientRect();
    popupWidth = popupBounds?.width ?? 0;
    popupHeight = popupBounds?.height ?? 0;
    const popupResizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(([entry]) => {
      const bounds = entry.target.getBoundingClientRect();
      popupWidth = bounds.width;
      popupHeight = bounds.height;
    }) : null;
    if (popup) popupResizeObserver?.observe(popup);
    const handleWindowResize = () => {
      resize();
      if (!popup) return;
      const bounds = popup.getBoundingClientRect();
      popupWidth = bounds.width;
      popupHeight = bounds.height;
    };
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', handleWindowResize);
    }
    resize();

    const render = (time: number) => {
      if (!isVisible || !isDocumentVisible) {
        frame = 0;
        return;
      }
      frame = 0;
      const delta = Math.min((time - lastFrame) / 1000, 0.05);
      lastFrame = time;
      const rotationTransition = rotationTransitionRef.current;
      if (rotationTransition) {
        const progress = Math.min((time - rotationTransition.startedAt) / 1450, 1);
        const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - ((-2 * progress + 2) ** 3) / 2;
        earth.quaternion.copy(rotationTransition.from).slerp(rotationTransition.to, eased);
        if (progress >= 1) rotationTransitionRef.current = null;
      } else if (!hasSelectionRef.current && !motionRef.current && settingsRef.current.globeEnabled) {
        earth.rotateY(delta * 0.006 * settingsRef.current.globeRotationSpeed / 100);
      }

      const scaleTransition = scaleTransitionRef.current;
      if (scaleTransition) {
        const progress = Math.min((time - scaleTransition.startedAt) / 900, 1);
        const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - ((-2 * progress + 2) ** 3) / 2;
        earth.scale.setScalar(scaleTransition.from + (scaleTransition.to - scaleTransition.from) * eased);
        if (progress >= 1) scaleTransitionRef.current = null;
      }

      const activeMarker = markerRef.current;
      if (activeMarker) {
        const country = selectedRef.current;
        const vector = vectorForCoordinates(country.lat, country.lng, 1.505, markerVector);
        activeMarker.position.copy(vector);
        markerDirection.copy(vector).normalize();
        activeMarker.quaternion.setFromUnitVectors(markerForward, markerDirection);
        earth.updateMatrixWorld(true);
        activeMarker.getWorldPosition(markerPosition);
        const popup = labelOverlayRef.current;
        if (popup && wrapperWidth > 0 && wrapperHeight > 0) {
          if (markerPosition.z <= 0) {
            popup.style.visibility = 'hidden';
            popup.style.opacity = '0';
          } else {
            const projected = markerPosition.project(camera);
            const markerX = (projected.x * 0.5 + 0.5) * wrapperWidth;
            const markerY = (-projected.y * 0.5 + 0.5) * wrapperHeight;
            const left = THREE.MathUtils.clamp(markerX - popupWidth / 2, 8, wrapperWidth - popupWidth - 8);
            const top = THREE.MathUtils.clamp(markerY - popupHeight - 6, 8, wrapperHeight - popupHeight - 8);
            popup.style.transform = `translate3d(${left}px, ${top}px, 0)`;
            popup.style.setProperty('--ng-reach-popup-arrow-left', `${THREE.MathUtils.clamp(markerX - left, 12, popupWidth - 12)}px`);
            popup.style.visibility = 'visible';
            popup.style.opacity = '1';
          }
        }
        const ring = activeMarker.userData.ring as THREE.Mesh;
        if (motionRef.current || !settingsRef.current.globeEnabled) {
          ring.scale.setScalar(1);
          (ring.material as THREE.MeshBasicMaterial).opacity = document.documentElement.dataset.theme === 'light'
            ? 0.15 + settingsRef.current.globeLightAppearance.selectionGlowIntensity * 0.7
            : 0.62;
        } else {
          const pulse = 1 + 0.16 * Math.sin(time / 420);
          ring.scale.setScalar(pulse);
          (ring.material as THREE.MeshBasicMaterial).opacity = document.documentElement.dataset.theme === 'light'
            ? 0.15 + settingsRef.current.globeLightAppearance.selectionGlowIntensity * (0.42 + pulse * 0.3)
            : 0.5 + pulse * 0.16;
        }
      }
      if (!motionRef.current && settingsRef.current.globeEnabled) {
        particles.forEach(({ mesh, routePoints, phase }) => {
          const progress = (time / 5600 + phase) % 1;
          const routePosition = progress * (routePoints.length - 1);
          const segmentIndex = Math.floor(routePosition);
          mesh.position.copy(routePoints[segmentIndex]).lerp(
            routePoints[Math.min(segmentIndex + 1, routePoints.length - 1)],
            routePosition - segmentIndex,
          );
        });
      }
      renderer.render(scene, camera);
      if (rotationTransitionRef.current || scaleTransitionRef.current ||
        (!motionRef.current && settingsRef.current.globeEnabled)) {
        frame = requestAnimationFrame(render);
      }
    };
    const startRendering = () => {
      if (!frame && isVisible && isDocumentVisible) {
        lastFrame = performance.now();
        frame = requestAnimationFrame(render);
      }
    };
    const stopRendering = () => {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
    };
    requestRenderRef.current = startRendering;
    const updateFallbackVisibility = () => {
      const bounds = (wrapperRef.current ?? canvas).getBoundingClientRect();
      isVisible = bounds.bottom > -100 && bounds.top < window.innerHeight + 100;
      if (isVisible) startRendering();
      else stopRendering();
    };
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      stopRendering();
      setRenderFailed(true);
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);
    const visibilityObserver = 'IntersectionObserver' in window
      ? new IntersectionObserver(([entry]) => {
        isVisible = entry.isIntersecting;
        if (isVisible) startRendering();
        else stopRendering();
      }, { rootMargin: '100px' })
      : null;
    if (visibilityObserver) {
      visibilityObserver.observe(wrapperRef.current ?? canvas);
    } else {
      updateFallbackVisibility();
      window.addEventListener('scroll', updateFallbackVisibility, { passive: true });
      window.addEventListener('resize', updateFallbackVisibility);
    }
    const updateDocumentVisibility = () => {
      isDocumentVisible = !document.hidden;
      if (isDocumentVisible) startRendering();
      else stopRendering();
    };
    document.addEventListener('visibilitychange', updateDocumentVisibility);
    startRendering();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      popupResizeObserver?.disconnect();
      themeObserver.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      window.removeEventListener('scroll', updateFallbackVisibility);
      window.removeEventListener('resize', updateFallbackVisibility);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      visibilityObserver?.disconnect();
      document.removeEventListener('visibilitychange', updateDocumentVisibility);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', handlePointerCancel);
      pointerDownRef.current = null;
      refreshAppearanceRef.current = () => {};
      requestRenderRef.current = () => {};
      resizeScene = () => {};
      scene.traverse((object) => {
        if (object instanceof THREE.Sprite) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            if ('map' in material) material.map?.dispose();
            material.dispose();
          });
          return;
        }
        if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          if ('map' in material) material.map?.dispose();
          material.dispose();
        });
      });
      renderer.dispose();
      renderer.forceContextLoss();
      earthRef.current = null;
      cameraRef.current = null;
      markerRef.current = null;
      wrapperRef.current = null;
      mapResourcesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const earth = earthRef.current;
    const camera = cameraRef.current;
    const map = mapResourcesRef.current;
    if (!earth || !camera || !map) return;

    refreshAppearanceRef.current();
    if (labelOverlayRef.current) {
      labelOverlayRef.current.replaceChildren();
      const title = document.createElement('strong');
      title.textContent = settings.globePopupTitle.replaceAll('{country}', selectedCountry.name);
      const detail = document.createElement('span');
      detail.textContent = settings.globePopupDetail
        .replaceAll('{clicks}', String(selectedCountry.clicks))
        .replaceAll('{country}', selectedCountry.name);
      labelOverlayRef.current.append(title, detail);
    }
    const targetOrientation = orientationForCoordinates(selectedCountry.lat, selectedCountry.lng);
    if (reducedMotion || !settings.globeEnabled) {
      earth.quaternion.copy(targetOrientation);
      rotationTransitionRef.current = null;
    } else {
      rotationTransitionRef.current = {
        from: earth.quaternion.clone(),
        to: targetOrientation,
        startedAt: performance.now(),
      };
    }
    const baseScale = 0.94 * settings.globeSize / 100;
    if (reducedMotion || !settings.globeEnabled) {
      earth.scale.setScalar(hasSelection ? baseScale / 0.94 : baseScale);
      scaleTransitionRef.current = null;
    } else {
      scaleTransitionRef.current = {
        from: earth.scale.x,
        to: hasSelection ? baseScale / 0.94 : baseScale,
        startedAt: performance.now(),
      };
    }
    requestRenderRef.current();
  }, [selectedCountry, hasSelection, reducedMotion, settings.globeEnabled, settings.globeSize]);

  useEffect(() => {
    refreshAppearanceRef.current();
    requestRenderRef.current();
  }, [settings]);

  if (renderFailed) {
    return (
      <div className="ng-global-reach-fallback" role="img" aria-label="Static globe fallback. Country information is available in the country list.">
        <span aria-hidden="true">Earth</span>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="ng-global-reach-renderer">
      <canvas
        ref={canvasRef}
        className="ng-global-reach-canvas"
        role="img"
        aria-label="Interactive geographic globe showing a selected country, its boundary, and discovery connections from India"
      />
      <div ref={labelOverlayRef} className="ng-global-reach-marker-popup" aria-hidden="true" />
      <span className="sr-only" role="status" aria-live="polite">
        {selectedCountry.name}: {selectedCountry.clicks} {selectedCountry.clicks === 1 ? 'click' : 'clicks'}.
      </span>
    </div>
  );
}

interface CountryCardProps {
  country: GlobalReachCountry & { focalX: number; focalY: number };
  selected: boolean;
  onSelect: (country: GlobalReachCountry) => void;
  clone?: boolean;
}

function CountryCard({ country, selected, onSelect, clone = false }: CountryCardProps) {
  return (
    <button
      className={`ng-global-reach-country${selected ? ' is-selected' : ''}`}
      type="button"
      aria-pressed={!clone && selected}
      tabIndex={clone ? -1 : undefined}
      onClick={() => onSelect(country)}
    >
      <span className="ng-global-reach-country-photo">
        <img src={country.photo} alt={country.photoAlt} loading="lazy" decoding="async" draggable="false" style={{ objectPosition: `${country.focalX}% ${country.focalY}%` }} />
        <span className="ng-global-reach-country-name">{country.name}</span>
      </span>
      <span className="ng-global-reach-country-clicks">{country.clicks} {country.clicks === 1 ? 'click' : 'clicks'}</span>
    </button>
  );
}

export default function GlobalReach({ media, settings, theme }: { media: SiteContent['media']; settings: AnimationSettings; theme: HeroVideoTheme }) {
  const [selectedCountry, setSelectedCountry] = useState(GLOBAL_REACH_COUNTRIES[0]);
  const [hasSelection, setHasSelection] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [focusPaused, setFocusPaused] = useState(false);
  const [selectionPaused, setSelectionPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
  const interactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  const countries = GLOBAL_REACH_COUNTRIES.map((country) => {
    const asset = publicMedia(media, `home.globalReach.${country.id}`, country.photo, theme);
    return { ...country, photo: asset.url, photoAlt: asset.altText, focalX: asset.focalX, focalY: asset.focalY };
  });
  const totalClicks = countries.reduce((total, country) => total + country.clicks, 0);
  const marqueePaused = userPaused || hoverPaused || focusPaused || selectionPaused || reducedMotion || !documentVisible;

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setReducedMotion(query.matches);
    const updateVisibility = () => setDocumentVisible(!document.hidden);
    updateMotion();
    updateVisibility();
    query.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      query.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  useEffect(() => () => {
    if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
  }, []);

  const selectCountry = (country: GlobalReachCountry) => {
    setSelectedCountry(country);
    setHasSelection(true);
    setSelectionPaused(true);
    if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
    interactionTimerRef.current = setTimeout(() => {
      setSelectionPaused(false);
      interactionTimerRef.current = null;
    }, 4500);
  };

  const holdForManualScroll = () => {
    setUserPaused(true);
    if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
    interactionTimerRef.current = setTimeout(() => {
      setUserPaused(false);
      interactionTimerRef.current = null;
    }, 4500);
  };

  return (
    <section className="ng-global-reach" aria-labelledby="ng-global-reach-title">
      <div className="ng-global-reach-inner">
        <header className="ng-global-reach-header">
          <div>
            <span className="ng-global-reach-eyebrow">NearGrow Ads · Global Reach</span>
            <h2 id="ng-global-reach-title">A world of discovery.</h2>
            <p>Explore where people are discovering NearGrow Ads.</p>
          </div>
          <div className="ng-global-reach-total" aria-label={`${totalClicks} clicks across ${countries.length} listed countries`}>
            <strong>{totalClicks}</strong>
            <span>clicks · {countries.length} countries</span>
          </div>
        </header>

        <div className="ng-global-reach-stage">
          <div className="ng-global-reach-globe" style={{ transform: `translate(${settings.globePositionX}%, ${settings.globePositionY}%)` }}>
            <GlobeRenderer
              selectedCountry={selectedCountry}
              onSelect={selectCountry}
              reducedMotion={reducedMotion}
              hasSelection={hasSelection}
              settings={settings}
            />
          </div>

          <aside className="ng-global-reach-rail" aria-label="Explore countries">
            <div className="ng-global-reach-rail-heading">
              <h3>Discover by country</h3>
            </div>
            <div
              ref={railRef}
              className={`ng-global-reach-rail-window${marqueePaused ? ' is-paused' : ''}`}
              onMouseEnter={() => setHoverPaused(true)}
              onMouseLeave={() => setHoverPaused(false)}
              onFocusCapture={() => setFocusPaused(true)}
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusPaused(false);
              }}
              onWheel={holdForManualScroll}
              onTouchStart={holdForManualScroll}
            >
              <div className="ng-global-reach-rail-track">
                {countries.map((country) => (
                  <CountryCard
                    key={country.id}
                    country={country}
                    selected={country.id === selectedCountry.id}
                    onSelect={selectCountry}
                  />
                ))}
                <div className="ng-global-reach-rail-clone" aria-hidden="true">
                  {countries.map((country) => (
                    <CountryCard
                      key={`clone-${country.id}`}
                      country={country}
                      selected={country.id === selectedCountry.id}
                      onSelect={selectCountry}
                      clone
                    />
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
