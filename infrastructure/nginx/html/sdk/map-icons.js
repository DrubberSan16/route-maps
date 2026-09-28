// Icons of the points of interest, drawn on demand: the style asks for "poi-<class>" images and
// they are painted here (coloured disc + white Lucide-style glyph) when MapLibre reports them
// missing. Colours come from the style metadata ("maps-platform:poi-colors"), not from this file.

const SIZE = 48; // drawn at 2x, shown at 24 css px
const GLYPHS = {
  restaurant: ['M7 3v8c0 1.1.9 2 2 2h0a2 2 0 0 0 2-2V3', 'M9 3v18', 'M17 21V3c-2.2 0-4 1.8-4 4v6h4'],
  shop: ['M6 3 4 7v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7l-2-4Z', 'M4 7h16', 'M15.5 11a3.5 3.5 0 0 1-7 0'],
  hospital: ['M12 6v12', 'M6 12h12'],
  pharmacy: ['M10.5 19.5 19.5 10.5a4.24 4.24 0 0 0-6-6L4.5 13.5a4.24 4.24 0 0 0 6 6Z', 'M9 9l6 6'],
  school: ['M21 9 12 5 3 9l9 4 9-4Z', 'M7 11v4.5c2.8 2 7.2 2 10 0V11'],
  college: ['M21 9 12 5 3 9l9 4 9-4Z', 'M7 11v4.5c2.8 2 7.2 2 10 0V11', 'M21 9v5'],
  library: ['M5 19V5.5A1.5 1.5 0 0 1 6.5 4H19v13H6.5A1.5 1.5 0 0 0 5 18.5Z', 'M5 18.5A1.5 1.5 0 0 0 6.5 20H19'],
  park: ['M12 3 6 12h3l-3 5h12l-3-5h3Z', 'M12 17v4'],
  sports: ['M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16Z', 'M12 4v16', 'M4 12h16'],
  stadium: ['M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16Z', 'M12 4v16', 'M4 12h16'],
  cemetery: ['M12 4v16', 'M7.5 9h9'],
  bus: ['M7 4h10a2 2 0 0 1 2 2v10H5V6a2 2 0 0 1 2-2Z', 'M5 11h14', 'M8 19v-3', 'M16 19v-3'],
  airport: ['M4 13l6-1-3-7h2.5l4.5 6.5L18 11a1.6 1.6 0 0 1 0 3.2l-4 .3-4.5 6.5H7l3-7-6-1Z'],
  rail: ['M8 4h8a2 2 0 0 1 2 2v9H6V6a2 2 0 0 1 2-2Z', 'M6 11h12', 'M9 20l1.5-4', 'M15 20l-1.5-4'],
  ferry: ['M12 8v12', 'M6 13H4a8 7 0 0 0 16 0h-2', 'M12 4a2 2 0 1 0 0 4a2 2 0 1 0 0-4Z'],
  fuel: ['M5 20V6a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v14', 'M4 20h11', 'M5 10h9', 'M14 13h1.5a1.5 1.5 0 0 1 1.5 1.5V17a1.5 1.5 0 0 0 3 0V9l-3-3'],
  lodging: ['M3 5v14', 'M3 9h15a3 3 0 0 1 3 3v7', 'M3 16h18', 'M7 9v7'],
  bank: ['M3 20h18', 'M6 17v-6', 'M10 17v-6', 'M14 17v-6', 'M18 17v-6', 'M12 3 20 8H4Z'],
  museum: ['M3 20h18', 'M6 17v-6', 'M10 17v-6', 'M14 17v-6', 'M18 17v-6', 'M12 3 20 8H4Z'],
  theatre: ['M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8-4.3-4.1 5.9-.9Z'],
  cinema: ['M4 6h16v12H4Z', 'M8 6v12', 'M16 6v12', 'M4 12h16'],
  attraction: ['M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8-4.3-4.1 5.9-.9Z'],
  place_of_worship: ['M12 3v6', 'M9.5 5.5h5', 'M6 21V12l6-3 6 3v9', 'M10 21v-4a2 2 0 0 1 4 0v4'],
  town_hall: ['M3 20h18', 'M5 20V10l7-5 7 5v10', 'M9 20v-5h6v5'],
  government: ['M3 20h18', 'M5 20V10l7-5 7 5v10', 'M9 20v-5h6v5'],
  police: ['M12 21s7-3.5 7-9V6l-7-3-7 3v6c0 5.5 7 9 7 9Z'],
  military: ['M12 21s7-3.5 7-9V6l-7-3-7 3v6c0 5.5 7 9 7 9Z'],
  fire_station: ['M12 21a6 6 0 0 0 6-6c0-3-2-5-3.5-7-.5 2-1.5 3-3 3.5.5-2.5 0-5.5-2.5-7.5 0 3.5-3 6-3 11a6 6 0 0 0 6 6Z'],
  post: ['M4 6h16v12H4Z', 'M4 7l8 6 8-6'],
  community: ['M9 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 1 0 0 7Z', 'M3 20v-1.5A4.5 4.5 0 0 1 7.5 14h3a4.5 4.5 0 0 1 4.5 4.5V20', 'M16 4.3a3.5 3.5 0 0 1 0 6.4', 'M21 20v-1.5a4.5 4.5 0 0 0-3-4.2'],
  building: ['M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6Z'],
};

function draw(color, glyph) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'white';
  ctx.stroke();
  ctx.save();
  ctx.translate(SIZE * 0.25, SIZE * 0.25);
  ctx.scale(SIZE / 48, SIZE / 48);
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'white';
  for (const path of glyph) ctx.stroke(new Path2D(path));
  ctx.restore();
  return ctx.getImageData(0, 0, SIZE, SIZE);
}

/**
 * Paints the POI icons. `colors` maps a POI class to its colour (style metadata); unknown classes
 * use `colors.default`. Every known class is added as soon as the style loads, before any tile asks
 * for it; a class that only the data knows is painted when MapLibre reports it missing.
 */
export function registerPoiIcons(map, colors = {}) {
  const add = (id) => {
    if (!id.startsWith('poi-') || map.hasImage(id)) return;
    const poiClass = id.slice(4);
    const glyph = GLYPHS[poiClass] ?? GLYPHS.building;
    const color = colors[poiClass] ?? colors.default ?? 'gray';
    try {
      map.addImage(id, draw(color, glyph), { pixelRatio: 2 });
    } catch {
      // Another tile may have added it in the meantime.
    }
  };
  const addAll = () => {
    for (const poiClass of new Set([...Object.keys(GLYPHS), ...Object.keys(colors)])) {
      if (poiClass !== 'default') add(`poi-${poiClass}`);
    }
  };
  map.on('style.load', addAll);
  if (map.isStyleLoaded()) addAll();
  map.on('styleimagemissing', (event) => add(event.id));
}
