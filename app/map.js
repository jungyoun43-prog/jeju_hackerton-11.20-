let map;
let fallbackTimer;
let mapLoaded = false;

export const DEMO_LOCATIONS = {
  home: [33.461, 126.31],
  hospital: [33.485, 126.48],
};

export function googleMapUrl(directions = false) {
  const base = directions ? 'https://www.google.com/maps/dir/' : 'https://www.google.com/maps/search/';
  const params = directions
    ? { api: '1', origin: DEMO_LOCATIONS.home.join(','), destination: DEMO_LOCATIONS.hospital.join(',') }
    : { api: '1', query: DEMO_LOCATIONS.hospital.join(',') };
  return `${base}?${new URLSearchParams(params)}`;
}

export function destroyMap() {
  clearTimeout(fallbackTimer);
  if (map) { map.remove(); map = undefined; }
  mapLoaded = false;
}

export function refreshMap() {
  if (!map) return;
  const hint = map.getContainer().parentElement?.querySelector('.map-load-state');
  if (hint && mapLoaded) hint.hidden = true;
  requestAnimationFrame(() => map?.invalidateSize({ pan: false }));
}

export async function mountMap(id = 'care-map') {
  const container = document.getElementById(id);
  if (!container) return;
  let config = {};
  try { config = await fetch('/api/config').then(r => r.ok ? r.json() : {}); } catch { /* 기본 지도 설정을 사용한다. */ }
  if (document.getElementById(id) !== container) return;
  if (!window.L) {
    container.innerHTML = '<p class="map-error">지도를 불러오지 못했어요. 아래 Google 지도 링크로 위치를 확인해 주세요.</p>';
    return;
  }
  const L = window.L;
  map = L.map(container, { scrollWheelZoom: false, zoomControl: true, attributionControl: true });
  const tile = L.tileLayer(config.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
  });
  const currentHint = () => container.parentElement?.querySelector('.map-load-state');
  tile.on('load', () => { mapLoaded = true; const hint = currentHint(); if (hint) hint.hidden = true; clearTimeout(fallbackTimer); });
  tile.on('tileerror', () => { const hint = currentHint(); if (hint) { hint.hidden = false; hint.textContent = '지도 배경 연결을 확인해 주세요 · 외부 지도에서 열 수 있어요'; } });
  tile.addTo(map);
  const marker = (position, type, label) => {
    const artwork = type === 'home'
      ? '<path d="m5 11 7-6 7 6v8H5Z"/><path d="M10 19v-6h4v6"/>'
      : '<path d="M5 20V7h14v13M3 20h18M9 4h6v7H9Z"/>';
    const html = `<span class="care-marker ${type}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${artwork}</svg></span>`;
    L.marker(position, { icon: L.divIcon({ className: 'care-marker-wrap', html, iconSize: [40, 40], iconAnchor: [20, 20] }), title: label })
      .addTo(map).bindPopup(`<strong>${label}</strong><br>시연을 위한 가상 위치입니다.`);
  };
  marker(DEMO_LOCATIONS.home, 'home', '부모님 댁 · 가상 위치');
  marker(DEMO_LOCATIONS.hospital, 'hospital', '제주 협진 병원 · 가상 위치');
  map.fitBounds([DEMO_LOCATIONS.home, DEMO_LOCATIONS.hospital], { padding: [45, 45], maxZoom: 10 });
  fallbackTimer = setTimeout(() => { const hint = currentHint(); if (hint) { hint.hidden = false; hint.textContent = '지도 연결이 지연되고 있어요 · Google 지도에서 위치 보기'; } }, 6500);
}
