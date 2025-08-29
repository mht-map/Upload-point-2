'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';

// Extend HTMLImageElement to include our custom rotation observer
declare global {
  interface HTMLImageElement {
    _rotationObserver?: MutationObserver;
  }
}

// Fix Leaflet marker icons for Next.js
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

export default function LeafletViewerComponent() {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageOverlayRef = useRef<L.ImageOverlay | null>(null);
  const handleMarkersRef = useRef<(L.Marker | null)[]>([]);
  const resizeStartRef = useRef<{ bounds: L.LatLngBounds; center: L.LatLng; rotation: number; marker: L.Marker } | null>(null);
  const rotateHandleRef = useRef<L.Marker | null>(null);
  const rotationDegRef = useRef<number>(0);
  const roadLayerRef = useRef<L.TileLayer | null>(null);
  const aerialLayerRef = useRef<L.TileLayer | null>(null);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [transparency, setTransparency] = useState<number>(1.0);
  const [imageAspectRatio, setImageAspectRatio] = useState<number>(1);
  const [showResizeHandles, setShowResizeHandles] = useState<boolean>(false);
  const [showRotateHandle, setShowRotateHandle] = useState<boolean>(false);
  const [rotationDeg, setRotationDeg] = useState<number>(0);
  const [mapStyle, setMapStyle] = useState<'road' | 'aerial'>('aerial');
  const [savedImages, setSavedImages] = useState<Array<{
    id: string;
    name: string;
    url: string;
    bounds: L.LatLngBounds;
    rotation: number;
    transparency: number;
    floorLevel: string;
    timestamp: number;
    polygons?: Array<{ 
      latlngs: Array<{ lat: number; lng: number }>;
      name?: string;
      area?: number;
      unit?: string;
      roomCategory?: string;
      roomType?: string;
    }>;
  }>>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null);
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [imageName, setImageName] = useState('');
  const [selectedFloorLevel, setSelectedFloorLevel] = useState('ground-floor');
  const [showPolygonTools, setShowPolygonTools] = useState(false);
  const [isDrawingPolygon, setIsDrawingPolygon] = useState(false);
  const [drawnPolygons, setDrawnPolygons] = useState<L.Polygon[]>([]);
  const [polygonAreas, setPolygonAreas] = useState<Array<{ 
    id: string; 
    name: string; 
    area: number; 
    unit: string;
    roomCategory?: string;
    roomType?: string;
  }>>([]);
  const [showPolygonNameDialog, setShowPolygonNameDialog] = useState(false);
  const [polygonName, setPolygonName] = useState('');
  const [polygonToName, setPolygonToName] = useState<{ polygon: L.Polygon; area: number; unit: string } | null>(null);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [contextMenuPolygon, setContextMenuPolygon] = useState<{ polygon: L.Polygon; name: string; polygonId: string } | null>(null);
  const [showImageContextMenu, setShowImageContextMenu] = useState(false);
  const [imageContextMenuPosition, setImageContextMenuPosition] = useState({ x: 0, y: 0 });
  const [imageContextMenuImage, setImageContextMenuImage] = useState<{ id: string; name: string; polygons?: any[] } | null>(null);

  // Room types and uses from CSV
  const [roomTypes, setRoomTypes] = useState<Array<{ category: string; types: string[] }>>([]);
  const [selectedRoomCategory, setSelectedRoomCategory] = useState<string>('');
  const [selectedRoomType, setSelectedRoomType] = useState<string>('');
  
  // Room colors from CSV
  const [roomColors, setRoomColors] = useState<Map<string, string>>(new Map());
  const [roomColorsLoaded, setRoomColorsLoaded] = useState<boolean>(false);
  
  // Editable area for polygon naming dialog
  const [editableArea, setEditableArea] = useState<number>(0);

  // ===== WORKBENCH ARCHITECTURE =====
  
  // Upload mode and GeoJSON type
  type UploadMode = 'image' | 'geojson';
  type GeoJSONKind = 'local' | 'wgs84' | null;
  
  const [uploadMode, setUploadMode] = useState<UploadMode>('image');
  const geoJSONKindRef = useRef<GeoJSONKind>(null);
  const geoJSONFileRef = useRef<File | null>(null);
  
  // Shared refs for both modes
  const localGeoRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const localExtentRef = useRef<{minX:number; minY:number; width:number; height:number} | null>(null);
  const geoLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const activeBoundsRef = useRef<L.LatLngBounds | null>(null);
  const boundsOverlayRef = useRef<L.Rectangle | null>(null);

  // ===== SHARED BOUNDS/ROTATION HELPERS =====
  
  // One source of truth for the "active frame"
  const getActiveBounds = useCallback(() => {
    console.log('getActiveBounds: Called with uploadMode:', uploadMode);
    
    if (uploadMode === 'image') {
      const bounds = imageOverlayRef.current?.getBounds() ?? null;
      console.log('getActiveBounds: Returning image bounds:', bounds);
      return bounds;
    }
    
    const bounds = activeBoundsRef.current; // for GeoJSON local-XY frame
    console.log('getActiveBounds: Returning GeoJSON bounds:', bounds);
    return bounds;
  }, [uploadMode]);

  // Shared rotation function
  const applyRotation = useCallback((deg: number) => {
    if (uploadMode === 'image') {
      const imgEl = imageOverlayRef.current?.getElement() as HTMLImageElement | undefined;
      if (!imgEl) return;
      
      // Store the rotation angle in a data attribute for persistence
      imgEl.setAttribute('data-rotation', deg.toString());
      
      // Force pivot at center and ensure rotation is preserved during zoom
      imgEl.style.setProperty('transform-origin', '50% 50%', 'important');
      imgEl.style.setProperty('will-change', 'transform', 'important');
      
      // Apply rotation using a more robust method that won't conflict with Leaflet's zoom transforms
      const applyRotationTransform = () => {
        const currentTransform = imgEl.style.transform || '';
        // Remove any existing rotation from the transform
        const withoutRotate = currentTransform.replace(/\s?rotate\([^)]*\)/, '');
        // Add our rotation at the end to ensure it's applied last
        imgEl.style.transform = `${withoutRotate} rotate(${deg}deg)`.replace(/\s+/g, ' ').trim();
      };
      
      // Apply rotation immediately
      applyRotationTransform();
      
      // Also apply rotation after any Leaflet transform changes (like zoom)
      const observer = new MutationObserver(() => {
        // Check if Leaflet has modified the transform (e.g., during zoom)
        const currentTransform = imgEl.style.transform || '';
        if (!currentTransform.includes(`rotate(${deg}deg)`)) {
          applyRotationTransform();
        }
      });
      
      // Observe changes to the style attribute
      observer.observe(imgEl, { attributes: true, attributeFilter: ['style'] });
      
      // Store observer reference for cleanup
      if (imgEl._rotationObserver) {
        imgEl._rotationObserver.disconnect();
      }
      imgEl._rotationObserver = observer;
      
      // Update handle positions to follow the rotated image
      if (imageOverlayRef.current) {
        // Call updateHandlePositions directly if available
        if (typeof updateHandlePositions === 'function') {
          updateHandlePositions(imageOverlayRef.current.getBounds());
        }
      }
    } else if (uploadMode === 'geojson' && geoJSONKindRef.current === 'local') {
      // For local GeoJSON, rotation affects the transform frame
      rotationDegRef.current = deg;
      if (localGeoRef.current) {
        // Call renderLocalGeoJSON directly if available
        if (typeof renderLocalGeoJSON === 'function') {
          renderLocalGeoJSON();
        }
      }
      
      // Update handle positions to follow the rotated frame
      const bounds = getActiveBounds();
      if (bounds) {
        // Call updateHandlePositions directly if available
        if (typeof updateHandlePositions === 'function') {
          updateHandlePositions(bounds);
        }
      }
    }
  }, [uploadMode, getActiveBounds]);

  const setActiveBounds = useCallback((b: L.LatLngBounds) => {
    if (uploadMode === 'image' && imageOverlayRef.current) {
      imageOverlayRef.current.setBounds(b);
      applyRotation(rotationDegRef.current);
    } else {
      activeBoundsRef.current = b;
      // also redraw any local-XY GeoJSON using the new transform frame
      if (localGeoRef.current) {
        // Call renderLocalGeoJSON directly if available
        if (typeof renderLocalGeoJSON === 'function') {
          renderLocalGeoJSON();
        }
      }
    }
    // Call updateHandlePositions directly if available
    if (typeof updateHandlePositions === 'function') {
      updateHandlePositions(b);
    }
  }, [uploadMode, applyRotation]);

  // ===== GEOJSON HELPER FUNCTIONS =====
  
  // 1. forEachCoord - no dependencies
  const forEachCoord = useCallback((geom: GeoJSON.Geometry, cb: (x: number, y: number) => void) => {
    const walk = (c: any) => {
      if (typeof c[0] === 'number') { cb(c[0], c[1]); return; }
      for (const cc of c) walk(cc);
    };
    walk((geom as any).coordinates);
  }, []);

  // 2. getLocalExtent - depends on forEachCoord
  const getLocalExtent = useCallback((fc: GeoJSON.FeatureCollection) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    fc.features.forEach(f => {
      if (!f.geometry) return;
      forEachCoord(f.geometry, (x, y) => {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      });
    });
    const width = maxX - minX;
    const height = maxY - minY;
    return { minX, minY, width: Math.max(width, 1e-9), height: Math.max(height, 1e-9) };
  }, [forEachCoord]);

  // 3. localToLatLng - no dependencies on our functions
  const localToLatLng = useCallback((
    x: number, y: number,
    bounds: L.LatLngBounds,
    extent: {minX:number; minY:number; width:number; height:number},
    rotationDeg: number,
    map: L.Map
  ): L.LatLng => {
    // normalize into [0..1]
    const u = (x - extent.minX) / extent.width;
    const v = (y - extent.minY) / extent.height;

    // place inside unrotated bounds
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const lat = sw.lat + v * (ne.lat - sw.lat);
    const lng = sw.lng + u * (ne.lng - sw.lng);

    // rotate around center (using layerPoint space, same as your image code)
    if (!rotationDeg) return L.latLng(lat, lng);
    const center = bounds.getCenter();
    const cPt = map.latLngToLayerPoint(center);
    const p = map.latLngToLayerPoint(L.latLng(lat, lng));
    const theta = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(theta), sin = Math.sin(theta);
    const dx = p.x - cPt.x, dy = p.y - cPt.y;
    const rx = cPt.x + dx * cos - dy * sin;
    const ry = cPt.y + dx * sin + dy * cos;
    return map.layerPointToLatLng(L.point(rx, ry));
  }, []);

  // 4. renderLocalGeoJSON - depends on localToLatLng
  const renderLocalGeoJSON = useCallback(() => {
    const map = mapRef.current;
    if (!map || !localGeoRef.current || !activeBoundsRef.current || !localExtentRef.current) {
      console.log('renderLocalGeoJSON: Missing required refs', {
        map: !!map,
        localGeo: !!localGeoRef.current,
        activeBounds: !!activeBoundsRef.current,
        localExtent: !!localExtentRef.current
      });
      return;
    }

    console.log('renderLocalGeoJSON: Rendering GeoJSON features', {
      bounds: activeBoundsRef.current,
      extent: localExtentRef.current,
      rotation: rotationDegRef.current
    });

    // clear previous
    if (!geoLayerGroupRef.current) {
      geoLayerGroupRef.current = L.layerGroup().addTo(map);
    }
    geoLayerGroupRef.current.clearLayers();

    const fc = localGeoRef.current;
    const b = activeBoundsRef.current;
    const ex = localExtentRef.current;
    const deg = rotationDegRef.current;

    const makeLatLngRings = (coords: number[][][]) =>
      coords.map(ring => ring.map(([x,y]) => localToLatLng(x, y, b, ex, deg, map)));

    let featureCount = 0;
    fc.features.forEach(f => {
      if (!f.geometry) return;
      const g = f.geometry;
      switch (g.type) {
        case 'Polygon': {
          const rings = makeLatLngRings(g.coordinates as any);
          const polygon = L.polygon(rings, { color: '#6b7280', weight: 2, fillOpacity: 0.2, fillColor: '#6b7280' });
          polygon.addTo(geoLayerGroupRef.current!);
          featureCount++;
          console.log('renderLocalGeoJSON: Added polygon', { rings: rings.length });
          break;
        }
        case 'MultiPolygon': {
          (g.coordinates as any).forEach((poly: number[][][]) => {
            const rings = makeLatLngRings(poly);
            const polygon = L.polygon(rings, { color: '#6b7280', weight: 2, fillOpacity: 0.2, fillColor: '#6b7280' });
            polygon.addTo(geoLayerGroupRef.current!);
            featureCount++;
          });
          console.log('renderLocalGeoJSON: Added MultiPolygon features');
          break;
        }
        case 'LineString': {
          const ll = (g.coordinates as any).map(([x,y]:number[]) => localToLatLng(x,y,b,ex,deg,map));
          const line = L.polyline(ll, { color: '#22c55e', weight: 2 });
          line.addTo(geoLayerGroupRef.current!);
          featureCount++;
          console.log('renderLocalGeoJSON: Added LineString', { points: ll.length });
          break;
        }
        case 'MultiLineString': {
          (g.coordinates as any).forEach((line: number[][]) => {
            const ll = line.map(([x,y]) => localToLatLng(x,y,b,ex,deg,map));
            const polyline = L.polyline(ll, { color: '#22c55e', weight: 2 });
            polyline.addTo(geoLayerGroupRef.current!);
            featureCount++;
          });
          console.log('renderLocalGeoJSON: Added MultiLineString features');
          break;
        }
        case 'Point': {
          const [x,y] = (g.coordinates as number[]);
          const point = L.circleMarker(localToLatLng(x,y,b,ex,deg,map), { radius: 4 });
          point.addTo(geoLayerGroupRef.current!);
          featureCount++;
          console.log('renderLocalGeoJSON: Added Point');
          break;
        }
        default:
          console.log('renderLocalGeoJSON: Unknown geometry type', g.type);
          break;
      }
    });
    
    console.log(`renderLocalGeoJSON: Rendered ${featureCount} features`);
  }, [localToLatLng]);

  // ===== GEOJSON UPLOAD FUNCTION =====
  
  const onGeoJSONChosen = useCallback(async (f: File | null) => {
    console.log('onGeoJSONChosen: Function called with file:', f?.name);
    
    if (!f) {
      console.log('onGeoJSONChosen: Clearing GeoJSON state');
      // clear state & layers
      localGeoRef.current = null;
      localExtentRef.current = null;
      geoJSONFileRef.current = null;
      geoJSONKindRef.current = null;
      if (geoLayerGroupRef.current) geoLayerGroupRef.current.clearLayers();
      if (boundsOverlayRef.current && mapRef.current) {
        mapRef.current.removeLayer(boundsOverlayRef.current);
        boundsOverlayRef.current = null;
      }
      setIsImageLoaded(false);
      setShowResizeHandles(false);
      setShowRotateHandle(false);
      return;
    }

    try {
      const text = await f.text();
      const fc = JSON.parse(text) as GeoJSON.FeatureCollection;
      geoJSONFileRef.current = f;

      // If the user chose explicitly, honor it; otherwise auto-detect
      let kind: GeoJSONKind | 'auto' = geoJSONKindRef.current ?? 'auto';

      if (kind === 'auto') {
        console.log('onGeoJSONChosen: Auto-detecting coordinate system');
        
        // 1) Check lon/lat RANGE
        let looksLonLat = true;
        let sampleCount = 0;
        const visit = (c: any) => {
          if (sampleCount > 500) return;
          if (typeof c[0] === 'number') {
            sampleCount++;
            const [x, y] = c;
            if (x < -180 || x > 180 || y < -90 || y > 90) looksLonLat = false;
            return;
          }
          c.forEach(visit);
        };
        fc.features.forEach(ft => ft.geometry && visit((ft.geometry as any).coordinates));

        // 2) Require the bbox to be at least ~0.5° in either dimension
        const ex = getLocalExtent(fc);
        const bboxLargeEnough = (ex.width >= 0.5 || ex.height >= 0.5);

        kind = (looksLonLat && bboxLargeEnough) ? 'wgs84' : 'local';
        
        console.log('onGeoJSONChosen: Auto-detection result:', { 
          looksLonLat, 
          bboxLargeEnough, 
          bbox: { width: ex.width, height: ex.height },
          sampleCount,
          detectedKind: kind 
        });
      } else {
        console.log('onGeoJSONChosen: Using user-selected coordinate system:', kind);
      }

      geoJSONKindRef.current = kind;

      if (kind === 'wgs84') {
        console.log('onGeoJSONChosen: Treating as WGS84 coordinates');
        // draw directly
        if (!geoLayerGroupRef.current) geoLayerGroupRef.current = L.layerGroup().addTo(mapRef.current!);
        geoLayerGroupRef.current.clearLayers();
        const layer = L.geoJSON(fc, { style: { color: '#0ea5e9', weight: 2, fillOpacity: 0.2 } })
                      .addTo(geoLayerGroupRef.current);
        mapRef.current!.fitBounds(layer.getBounds(), { padding: [20, 20] });
        // hide resize/rotate; no frame here
        setShowResizeHandles(false);
        setShowRotateHandle(false);
        setIsImageLoaded(true);
        return;
      }

      // local-XY path: create/keep a transform frame
      console.log('onGeoJSONChosen: Treating as local XY coordinates');
      geoJSONKindRef.current = 'local';
      localGeoRef.current = fc;
      localExtentRef.current = getLocalExtent(fc);
      
      console.log('onGeoJSONChosen: Local extent calculated:', localExtentRef.current);
      
      const ar = localExtentRef.current.width / localExtentRef.current.height || 1;
      const baseW = 0.01, baseH = baseW / ar;
      const frame = L.latLngBounds([-baseH / 2, -baseW / 2], [baseH / 2, baseW / 2]);

      console.log('onGeoJSONChosen: Frame bounds calculated:', frame);
      
      activeBoundsRef.current = frame;
      rotationDegRef.current = 0;

      // Create bounds overlay for dragging
      if (boundsOverlayRef.current) {
        boundsOverlayRef.current.setBounds(frame);
      } else {
        const rect = L.rectangle(frame, {
          color: '#000',
          weight: 1,
          opacity: 0,
          fillOpacity: 0,
          interactive: true
        }).addTo(mapRef.current!);
        boundsOverlayRef.current = rect;
        
        // Add drag handlers
        let isDragging = false;
        let dragStartPos: L.LatLng | null = null;
        let dragStartBounds: L.LatLngBounds | null = null;

        rect.on('mousedown', (e: any) => {
          if (!e.originalEvent.ctrlKey) return;
          e.originalEvent.preventDefault();
          isDragging = true;
          dragStartPos = mapRef.current!.mouseEventToLatLng(e.originalEvent);
          dragStartBounds = frame;
          mapRef.current!.dragging.disable();
          mapRef.current!.getContainer().style.cursor = 'grabbing';
        });

        rect.on('mousemove', (e: any) => {
          if (!isDragging || !dragStartPos || !dragStartBounds) return;
          const currentPos = mapRef.current!.mouseEventToLatLng(e.originalEvent);
          const offset = { lat: currentPos.lat - dragStartPos.lat, lng: currentPos.lng - dragStartPos.lng };
          const nb = L.latLngBounds(
            [dragStartBounds.getSouth() + offset.lat, dragStartBounds.getWest() + offset.lng],
            [dragStartBounds.getNorth() + offset.lat, dragStartBounds.getEast() + offset.lng]
          );
          setActiveBounds(nb);
        });

        const end = () => {
          if (!isDragging) return;
          isDragging = false;
          dragStartPos = null;
          dragStartBounds = null;
          mapRef.current!.dragging.enable();
          mapRef.current!.getContainer().style.cursor = '';
        };

        rect.on('mouseup', end);
        rect.on('mouseleave', end);
      }

      console.log('onGeoJSONChosen: About to render local GeoJSON');
      renderLocalGeoJSON();
      console.log('onGeoJSONChosen: Local GeoJSON rendered, fitting map to frame');
      mapRef.current!.fitBounds(frame, { padding: [20, 20] });

      setShowResizeHandles(true);
      setShowRotateHandle(true);
      setIsImageLoaded(true);
      
      // Add resize handles and rotate handle
      if (typeof addResizeHandles === 'function') {
        addResizeHandles(frame);
      }
      if (typeof updateHandlePositions === 'function') {
        updateHandlePositions(frame);
      }
      if (typeof addRotateHandle === 'function') {
        addRotateHandle();
      }
    } catch (e) {
      alert('Could not parse GeoJSON file.');
      console.error(e);
    }
  }, [getLocalExtent, renderLocalGeoJSON, setActiveBounds]);

  // ===== SHARED POSTCODE CENTERING =====
  
  const centerAtPostcode = useCallback(async (postcode: string) => {
    console.log('centerAtPostcode: Function called with postcode:', postcode);
    console.log('centerAtPostcode: Current state:', {
      uploadMode,
      geoJSONKind: geoJSONKindRef.current,
      hasGeoJSON: !!geoJSONFileRef.current,
      hasLocalGeo: !!localGeoRef.current,
      hasActiveBounds: !!activeBoundsRef.current
    });
    
    const map = mapRef.current!;
    const clean = postcode.replace(/\s+/g, '').toUpperCase();
    
    try {
      const r = await fetch(`https://api.postcodes.io/postcodes/${clean}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { latitude: lat, longitude: lng } = (await r.json()).result;
      
      console.log('centerAtPostcode: Got coordinates:', { lat, lng });

      // keep current frame size, move the center:
      const b = getActiveBounds();
      console.log('centerAtPostcode: Current active bounds:', b);
      
      if (b) {
        const h = b.getNorth() - b.getSouth();
        const w = b.getEast() - b.getWest();
        const nb = L.latLngBounds([lat - h / 2, lng - w / 2], [lat + h / 2, lng + w / 2]);
        
        console.log('centerAtPostcode: New bounds calculated:', nb);
        
        // Use single path through setActiveBounds for both image and local-XY GeoJSON
        console.log('centerAtPostcode: Using setActiveBounds for repositioning');
        setActiveBounds(nb);
        
        map.fitBounds(nb, { padding: [20, 20] });
        return;
      }

      // WGS84 GeoJSON path: just pan/zoom
      console.log('centerAtPostcode: No active bounds, using WGS84 path');
      map.setView([lat, lng], Math.max(map.getZoom(), 16));
    } catch (error) {
      console.error('centerAtPostcode: Error occurred:', error);
      let msg = `Could not find postcode "${postcode}". `;
      if (String(error).includes('HTTP 404')) msg += 'Postcode not found.';
      else if (String(error).includes('HTTP 429')) msg += 'Too many requests—try again shortly.';
      else msg += `Error: ${error}`;
      alert(msg);
    }
  }, [getActiveBounds, setActiveBounds, uploadMode, geoJSONKindRef, renderLocalGeoJSON]);

  // Function to load all saved images as overlays (for display purposes)
  const loadAllSavedImagesAsOverlays = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    
    // Get current values from refs to avoid dependency issues
    const currentSavedImages = savedImages;
    const currentActiveId = activeImageId;
    
    if (currentSavedImages.length === 0) return;

    // Load all saved images as non-interactive overlays (except the active one)
    currentSavedImages.forEach((savedImage) => {
      // Skip if this is the currently active image
      if (currentActiveId === savedImage.id) return;
      
      const overlay = L.imageOverlay(savedImage.url, savedImage.bounds, {
        opacity: savedImage.transparency,
        interactive: false // These are just for display, not for editing
      });
      overlay.addTo(map);
      
      // Apply rotation
      if (savedImage.rotation !== 0) {
        const imgElement = overlay.getElement();
        if (imgElement) {
          imgElement.style.transform = `rotate(${savedImage.rotation}deg)`;
          imgElement.style.transformOrigin = 'center';
        }
      }
    });
  }, [savedImages, activeImageId]);

  // Load room types from CSV
  const loadRoomTypes = useCallback(async () => {
    try {
      const response = await fetch('/BB103 and BB104 Room Types and Uses (1).csv');
      const csvText = await response.text();
      
      // Parse CSV - first line contains main room categories (column headers)
      const lines = csvText.split('\n').filter(line => line.trim());
      if (lines.length < 2) return;
      
      // Simple CSV parsing that handles quoted fields
      const parseCSVLine = (line: string): string[] => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current.trim());
        return result;
      };
      
      const mainCategories = parseCSVLine(lines[0]).filter(cat => cat && cat.trim().length > 0);
      const roomTypesData: Array<{ category: string; types: string[] }> = [];
      
      // Process each column (main category)
      mainCategories.forEach((mainCategory, colIndex) => {
        const subCategories: string[] = [];
        
        // Each subsequent row contains sub-categories for this main category
        for (let rowIndex = 1; rowIndex < lines.length; rowIndex++) {
          const cells = parseCSVLine(lines[rowIndex]);
          if (cells[colIndex] && cells[colIndex].length > 0 && cells[colIndex] !== '') {
            // Clean up the text and only add if it's not just whitespace or empty
            const cleanText = cells[colIndex].trim().replace(/"/g, '');
            if (cleanText.length > 0) {
              subCategories.push(cleanText);
            }
          }
        }
        
        // Only add categories that have at least 2 meaningful sub-categories
        // This filters out categories with mostly empty cells
        if (subCategories.length >= 2) {
          // Remove duplicates and filter out any remaining empty strings
          const uniqueTypes = [...new Set(subCategories)].filter(type => 
            type && 
            type.trim().length > 0 && 
            type !== 'undefined' && 
            type !== 'null' && 
            type !== '""' &&
            !type.startsWith('"') &&
            !type.endsWith('"')
          );
          
          // Only add if we still have meaningful types after filtering
          if (uniqueTypes.length >= 2) {
            roomTypesData.push({ 
              category: mainCategory, 
              types: uniqueTypes 
            });
          }
        }
      });
      
      setRoomTypes(roomTypesData);
      console.log('Loaded room types:', roomTypesData);
      console.log('Total categories loaded:', roomTypesData.length);
      console.log('Raw main categories from CSV:', mainCategories);
      roomTypesData.forEach(cat => {
        console.log(`Category: "${cat.category}" - ${cat.types.length} types`);
        console.log('Types:', cat.types);
      });
    } catch (error) {
      console.error('Failed to load room types:', error);
    }
  }, []);

  // Load room colors from CSV
  const loadRoomColors = useCallback(async () => {
    try {
      const response = await fetch('/room by colour.csv');
      const csvText = await response.text();
      
      // Parse CSV - first line contains main room categories, second line contains colors
      const lines = csvText.split('\n').filter(line => line.trim());
      if (lines.length < 2) return;
      
      // Simple CSV parsing that handles quoted fields
      const parseCSVLine = (line: string): string[] => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current.trim());
        return result;
      };
      
      const mainCategories = parseCSVLine(lines[0]).filter(cat => cat && cat.trim().length > 0);
      const colors = parseCSVLine(lines[1]).filter(color => color && color.trim().length > 0);
      
      // Create a map of category to color
      const colorMap = new Map<string, string>();
      mainCategories.forEach((category, index) => {
        if (colors[index] && colors[index].startsWith('#')) {
          colorMap.set(category, colors[index]);
        }
      });
      
      setRoomColors(colorMap);
      setRoomColorsLoaded(true);
      console.log('=== ROOM COLORS LOADED ===');
      console.log('Loaded room colors:', colorMap);
      console.log('Room colors loaded successfully, size:', colorMap.size);
      console.log('Room colors state updated, triggering re-render');
      console.log('roomColorsLoaded flag set to true');
    } catch (error) {
      console.error('Failed to load room colors:', error);
    }
  }, []);

  // Helper function to get polygon color based on room category
  const getPolygonColor = useCallback((roomCategory: string): string => {
    // Add additional safety check
    if (!roomColorsLoaded || roomColors.size === 0) {
      console.warn(`Room colors not yet loaded for category "${roomCategory}", using default pink`);
      return '#ff00ff';
    }
    
    const color = roomColors.get(roomCategory);
    console.log(`Getting color for room category "${roomCategory}":`, color || '#ff00ff (default)');
    console.log(`Current roomColors size: ${roomColors.size}, available categories:`, Array.from(roomColors.keys()));
    console.log(`Full roomColors map:`, Object.fromEntries(roomColors));
    return color || '#ff00ff'; // Default to pink if no color found
  }, [roomColors, roomColorsLoaded]);

  // Initialize Leaflet map
  useEffect(() => {
    if (!containerRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: false
    }).setView([51.5074, -0.1278], 13); // London default

    // Create both map layers
    const roadLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    });

    const aerialLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: '&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    });

    // Store layer references
    roadLayerRef.current = roadLayer;
    aerialLayerRef.current = aerialLayer;

    // Start with aerial layer (default)
    aerialLayer.addTo(map);
    
    // Ensure both layers are ready
    roadLayer.on('load', () => {
      console.log('Road layer loaded');
    });
    
    aerialLayer.on('load', () => {
      console.log('Aerial layer loaded');
    });

    // Ensure correct sizing after mount/resizes
    const onReady = () => map.invalidateSize();
    map.whenReady(onReady);
    window.addEventListener('resize', onReady);
    
    // Add zoom event listener to preserve image rotation
    map.on('zoomend', () => {
      // Re-apply rotation after zoom to ensure it's preserved
      if (imageOverlayRef.current && rotationDegRef.current !== 0) {
        const imgEl = imageOverlayRef.current.getElement() as HTMLImageElement;
        if (imgEl) {
          const currentTransform = imgEl.style.transform || '';
          const withoutRotate = currentTransform.replace(/\s?rotate\([^)]*\)/, '');
          imgEl.style.transform = `${withoutRotate} rotate(${rotationDegRef.current}deg)`.replace(/\s+/g, ' ').trim();
        }
      }
    });

    mapRef.current = map;

    // Load room types and colors when map is ready
    loadRoomTypes();
    loadRoomColors();

    return () => { 
      window.removeEventListener('resize', onReady); 
      map.remove(); 
      mapRef.current = null;
      
      // Clean up rotation handle styles
      const rotationStyles = document.getElementById('rotation-handle-styles');
      if (rotationStyles) {
        rotationStyles.remove();
      }
    };
  }, []);

  // Function to show image overlay
  const showImage = (url: string, bounds: L.LatLngBounds) => {
    const map = mapRef.current;
    if (!map) return;

    // Remove previous overlay if any
    if (imageOverlayRef.current) {
      // Clean up rotation observer before removing
      const imgEl = imageOverlayRef.current.getElement() as HTMLImageElement;
      if (imgEl && imgEl._rotationObserver) {
        imgEl._rotationObserver.disconnect();
      }
      map.removeLayer(imageOverlayRef.current);
    }

    // Remove existing handles
    handleMarkersRef.current.filter(marker => marker !== null).forEach(marker => map.removeLayer(marker!));
    handleMarkersRef.current = [];
    removeRotateHandle();

    // Create new image overlay and add it immediately
    const overlay = L.imageOverlay(url, bounds, { 
      opacity: transparency,
      interactive: true
    });
    
    overlay.addTo(map);
    imageOverlayRef.current = overlay;
    setIsImageLoaded(true);

    // Apply any existing rotation
    applyRotation(rotationDegRef.current);

    // Fit map to image bounds
    map.fitBounds(bounds, { animate: true, padding: [20, 20] });

    // Show resize handles if enabled
    if (showResizeHandles) {
      addResizeHandles(bounds);
      updateHandlePositions(bounds);
    }

    // Add Ctrl+click and drag functionality
    addImageOverlayDragHandlers(overlay);

    // Show rotate handle if enabled
    if (showRotateHandle) {
      addRotateHandle();
    }
    
    // Hide polygon tools when uploading a new image
    setShowPolygonTools(false);
    clearAllPolygons();
  };

  // Function to calculate visual corners of rotated image
  const computeRotatedImageCorners = (bounds: L.LatLngBounds, rotationDeg: number) => {
    const map = mapRef.current;
    if (!map) return { corners: [], edges: [] };

    console.log(`computeRotatedImageCorners called with rotation: ${rotationDeg} degrees`);

    const center = bounds.getCenter();
    const centerPt = map.latLngToLayerPoint(center);
    
    // Calculate the four corners in layer coordinates
    const corners = [
      map.latLngToLayerPoint(bounds.getNorthWest()), // NW
      map.latLngToLayerPoint(bounds.getNorthEast()), // NE
      map.latLngToLayerPoint(bounds.getSouthEast()), // SE
      map.latLngToLayerPoint(bounds.getSouthWest()), // SW
    ];

    // Calculate edge midpoints in layer coordinates
    const edges = [
      map.latLngToLayerPoint(L.latLng(bounds.getNorth(), (bounds.getWest() + bounds.getEast()) / 2)), // North
      map.latLngToLayerPoint(L.latLng((bounds.getSouth() + bounds.getNorth()) / 2, bounds.getEast())), // East
      map.latLngToLayerPoint(L.latLng(bounds.getSouth(), (bounds.getWest() + bounds.getEast()) / 2)), // South
      map.latLngToLayerPoint(L.latLng((bounds.getSouth() + bounds.getNorth()) / 2, bounds.getWest())), // West
    ];

    // Apply rotation transformation
    const rad = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    console.log(`Rotation math: rad=${rad}, cos=${cos}, sin=${sin}`);

    // Rotate corners around center
    const rotatedCorners = corners.map(corner => {
      const dx = corner.x - centerPt.x;
      const dy = corner.y - centerPt.y;
      const rotatedX = centerPt.x + dx * cos - dy * sin;
      const rotatedY = centerPt.y + dx * sin + dy * cos;
      return map.layerPointToLatLng(L.point(rotatedX, rotatedY));
    });

    // Rotate edges around center
    const rotatedEdges = edges.map(edge => {
      const dx = edge.x - centerPt.x;
      const dy = edge.y - centerPt.y;
      const rotatedX = centerPt.x + dx * cos - dy * sin;
      const rotatedY = centerPt.y + dx * sin + dy * cos;
      return map.layerPointToLatLng(L.point(rotatedX, rotatedY));
    });

    console.log(`Returning ${rotatedCorners.length} corners and ${rotatedEdges.length} edges`);
    return { corners: rotatedCorners, edges: rotatedEdges };
  };

  // Function to convert visual handle positions back to geographic bounds
  const computeBoundsFromVisualHandles = (handlePositions: L.LatLng[], rotationDeg: number) => {
    const map = mapRef.current;
    if (!map || handlePositions.length < 4) return null;

    const center = L.latLng(
      (handlePositions[0].lat + handlePositions[1].lat + handlePositions[2].lat + handlePositions[3].lat) / 4,
      (handlePositions[0].lng + handlePositions[1].lng + handlePositions[2].lng + handlePositions[3].lng) / 4
    );
    const centerPt = map.latLngToLayerPoint(center);

    // Convert handle positions to layer coordinates
    const handlePts = handlePositions.map(pos => map.latLngToLayerPoint(pos));

    // Apply inverse rotation transformation
    const rad = (-rotationDeg * Math.PI) / 180; // Negative rotation to reverse
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Rotate handles back to their unrotated positions
    const unrotatedPts = handlePts.map(pt => {
      const dx = pt.x - centerPt.x;
      const dy = pt.y - centerPt.y;
      const unrotatedX = centerPt.x + dx * cos - dy * sin;
      const unrotatedY = centerPt.y + dx * sin + dy * cos;
      return map.layerPointToLatLng(L.point(unrotatedX, unrotatedY));
    });

    // Create bounds from unrotated positions
    const lats = unrotatedPts.map(pt => pt.lat);
    const lngs = unrotatedPts.map(pt => pt.lng);
    
    return L.latLngBounds(
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)]
    );
  };



  // Function to add resize handles
  const addResizeHandles = useCallback((bounds: L.LatLngBounds) => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing handles
    handleMarkersRef.current.filter(marker => marker !== null).forEach(marker => map.removeLayer(marker!));
    handleMarkersRef.current = [];

    // Calculate rotated positions for handles
    const { corners, edges } = computeRotatedImageCorners(bounds, rotationDegRef.current);

    const cornerHandles = corners.map((latlng, idx) => {
      const marker = L.marker(latlng, {
        draggable: true,
        icon: L.divIcon({
          className: 'resize-handle corner-handle',
          html: `<div style="
            width: 20px; 
            height: 20px; 
            background: yellow; 
            border: 3px solid black; 
            border-radius: 50%;
            cursor: grab;
          "></div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        })
      }).addTo(map);

             // Add drag event handlers
       marker.on('dragstart', () => {
         // Store the current image bounds and center position
         const currentBounds = imageOverlayRef.current?.getBounds() || getActiveBounds()!;
         const currentCenter = currentBounds.getCenter();
         const currentRotation = rotationDegRef.current;
         
         resizeStartRef.current = { 
           bounds: currentBounds,
           center: currentCenter,
           rotation: currentRotation,
           marker 
         };
         marker.getElement()!.style.cursor = 'grabbing';
         // Disable map dragging while resizing
         map.dragging.disable();
       });

      marker.on('drag', (e) => {
        if (!resizeStartRef.current) return;
        
        const currentMarker = e.target;
        const start = resizeStartRef.current.bounds;
        const startCenter = resizeStartRef.current.center;
        const startRotation = resizeStartRef.current.rotation;
        
        // Calculate new bounds based on which corner was dragged
        let newBounds: L.LatLngBounds;
        const markerIndex = idx;
        const currentPos = currentMarker.getLatLng();
        
        // When dragging a corner, only the two edges that meet at that corner should move;
        // the opposite two edges stay fixed
        switch (markerIndex) {
          case 0: // NW: move North and West, keep South and East
            newBounds = L.latLngBounds(
              [start.getSouth(), currentPos.lng],   // SW
              [currentPos.lat, start.getEast()]     // NE
            );
            break;
          case 1: // NE: move North and East, keep South and West
            newBounds = L.latLngBounds(
              [start.getSouth(), start.getWest()],  // SW
              [currentPos.lat, currentPos.lng]      // NE
            );
            break;
          case 2: // SE: move South and East, keep North and West
            newBounds = L.latLngBounds(
              [currentPos.lat, start.getWest()],    // SW
              [start.getNorth(), currentPos.lng]    // NE
            );
            break;
          case 3: // SW: move South and West, keep North and East
            newBounds = L.latLngBounds(
              [currentPos.lat, currentPos.lng],     // SW
              [start.getNorth(), start.getEast()]   // NE
            );
            break;
          default:
            return;
        }

        // Maintain aspect ratio for uniform scaling (all corners)
        if (markerIndex >= 0 && markerIndex <= 3) {
          let sw = newBounds.getSouthWest();
          let ne = newBounds.getNorthEast();

          const width = ne.lng - sw.lng;
          const height = ne.lat - sw.lat;
          const ar = imageAspectRatio;

          if (width / height > ar) {
            // too wide → increase height (move the edge that belongs to the dragged corner)
            const desiredHeight = width / ar;
            if (markerIndex === 0 || markerIndex === 1) {
              // North edge moves
              ne = L.latLng(sw.lat + desiredHeight, ne.lng);
            } else {
              // South edge moves
              sw = L.latLng(ne.lat - desiredHeight, sw.lng);
            }
          } else {
            // too tall → increase width (move the edge that belongs to the dragged corner)
            const desiredWidth = height * ar;
            if (markerIndex === 0 || markerIndex === 3) {
              // West edge moves
              sw = L.latLng(sw.lat, ne.lng - desiredWidth);
            } else {
              // East edge moves
              ne = L.latLng(ne.lat, sw.lng + desiredWidth);
            }
          }

          newBounds = L.latLngBounds(sw, ne);
        }

        // Preserve the center position and rotation during resize
        const newCenter = newBounds.getCenter();
        const centerOffset = {
          lat: startCenter.lat - newCenter.lat,
          lng: startCenter.lng - newCenter.lng
        };
        
        // Adjust bounds to maintain the original center
        const adjustedBounds = L.latLngBounds(
          [newBounds.getSouth() + centerOffset.lat, newBounds.getWest() + centerOffset.lng],
          [newBounds.getNorth() + centerOffset.lat, newBounds.getEast() + centerOffset.lng]
        );

        // Update bounds using shared function
        setActiveBounds(adjustedBounds);
        
        // Re-apply rotation to maintain visual appearance
        applyRotation(startRotation);
      });

      marker.on('dragend', () => {
        resizeStartRef.current = null;
        marker.getElement()!.style.cursor = 'grab';
        // Re-enable map dragging
        map.dragging.enable();
      });

      return marker;
    });

    // Create edge handles using rotated positions
    const edgeHandles = edges.map((latlng, idx) => {
      const edgeTypes = ['north', 'east', 'south', 'west'];
      const edge = edgeTypes[idx];
      const marker = L.marker(latlng, {
        draggable: true,
        icon: L.divIcon({
          className: 'resize-handle edge-handle',
          html: `<div style="
            width: 16px; 
            height: 16px; 
            background: orange; 
            border: 3px solid black; 
            border-radius: 50%;
            cursor: grab;
          "></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        })
      }).addTo(map);

      // Add drag event handlers for edge handles
      marker.on('dragstart', () => {
        // Store the current image bounds and center position
        const currentBounds = imageOverlayRef.current?.getBounds() || getActiveBounds()!;
        const currentCenter = currentBounds.getCenter();
        const currentRotation = rotationDegRef.current;
        
        resizeStartRef.current = { 
          bounds: currentBounds,
          center: currentCenter,
          rotation: currentRotation,
          marker 
        };
        marker.getElement()!.style.cursor = 'grabbing';
        // Disable map dragging while resizing
        map.dragging.disable();
      });

      marker.on('drag', (e) => {
        if (!resizeStartRef.current) return;
        
        const currentMarker = e.target;
        const currentPos = currentMarker.getLatLng();
        const start = resizeStartRef.current.bounds;
        const startCenter = resizeStartRef.current.center;
        const startRotation = resizeStartRef.current.rotation;
        let newBounds: L.LatLngBounds;
        
        // Create new bounds based on which edge was dragged
        switch (edge) {
          case 'north':
            newBounds = L.latLngBounds(
              [start.getSouth(), start.getWest()],
              [currentPos.lat, start.getEast()]
            );
            break;
          case 'east':
            newBounds = L.latLngBounds(
              [start.getSouth(), start.getWest()],
              [start.getNorth(), currentPos.lng]
            );
            break;
          case 'south':
            newBounds = L.latLngBounds(
              [currentPos.lat, start.getWest()],
              [start.getNorth(), start.getEast()]
            );
            break;
          case 'west':
            newBounds = L.latLngBounds(
              [start.getSouth(), currentPos.lng],
              [start.getNorth(), start.getEast()]
            );
            break;
          default:
            return;
        }

        // Preserve the center position and rotation during resize
        const newCenter = newBounds.getCenter();
        const centerOffset = {
          lat: startCenter.lat - newCenter.lat,
          lng: startCenter.lng - newCenter.lng
        };
        
        // Adjust bounds to maintain the original center
        const adjustedBounds = L.latLngBounds(
          [newBounds.getSouth() + centerOffset.lat, newBounds.getWest() + centerOffset.lng],
          [newBounds.getNorth() + centerOffset.lat, newBounds.getEast() + centerOffset.lng]
        );

        // Update bounds using shared function
        setActiveBounds(adjustedBounds);
        
        // Re-apply rotation to maintain visual appearance
        applyRotation(startRotation);
      });

      marker.on('dragend', () => {
        resizeStartRef.current = null;
        marker.getElement()!.style.cursor = 'grab';
        // Re-enable map dragging
        map.dragging.enable();
      });

      return marker;
    });

    // Store all handles
    handleMarkersRef.current = [...cornerHandles, ...edgeHandles];
  }, [imageAspectRatio, computeRotatedImageCorners]);

  // Function to add move handle in the center of the image
  const addMoveHandle = useCallback((bounds: L.LatLngBounds) => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing move handle first
    removeMoveHandle();

    // Create move handle in the center
    const center = bounds.getCenter();
    const moveHandle = L.marker(center, {
      draggable: true,
      icon: L.divIcon({
        className: 'move-handle',
        html: `<div style="
          width: 32px; 
          height: 32px; 
          background: #3b82f6; 
          border: 3px solid white; 
          border-radius: 50%;
          cursor: move;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          font-weight: bold;
          color: white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          position: relative;
        ">
          ↔
          <div style="
            position: absolute;
            bottom: -8px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 10px;
            color: #1e40af;
            font-weight: normal;
            white-space: nowrap;
          ">Precise</div>
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 20] // Adjusted anchor to account for "Precise" label
      })
    }).addTo(map);

    // Track drag start position
    let dragStartPos: L.LatLng | null = null;
    let dragStartBounds: L.LatLngBounds | null = null;

    // Add drag event handlers for move handle
    moveHandle.on('dragstart', (e) => {
      moveHandle.getElement()!.style.cursor = 'grabbing';
      moveHandle.getElement()!.style.transform = 'scale(1.1)';
      
      // Store the starting positions
      dragStartPos = e.target.getLatLng();
      dragStartBounds = getActiveBounds() || null;
      
      // Disable map dragging while moving
      map.dragging.disable();
    });

    moveHandle.on('drag', (e) => {
      if (!dragStartPos || !dragStartBounds) return;
      
      const currentPos = e.target.getLatLng();
      
      // Calculate the offset from where the drag started
      const offset = {
        lat: currentPos.lat - dragStartPos.lat,
        lng: currentPos.lng - dragStartPos.lng
      };
      
      // Create new bounds by moving the original bounds by the offset
      const newBounds = L.latLngBounds(
        [dragStartBounds.getSouth() + offset.lat, dragStartBounds.getWest() + offset.lng],
        [dragStartBounds.getNorth() + offset.lat, dragStartBounds.getEast() + offset.lng]
      );
      
      // Update bounds using shared function
      setActiveBounds(newBounds);
      
      // Re-apply current rotation
      applyRotation(rotationDegRef.current);
      
      // Keep move handle at the new center position
      const newCenter = newBounds.getCenter();
      moveHandle.setLatLng(newCenter);
    });

    moveHandle.on('dragend', () => {
      moveHandle.getElement()!.style.cursor = 'move';
      moveHandle.getElement()!.style.transform = 'scale(1)';
      
      // Clear drag tracking
      dragStartPos = null;
      dragStartBounds = null;
      
      // Re-enable map dragging
      map.dragging.enable();
    });

    // Store move handle at index 8 (after resize handles)
    if (handleMarkersRef.current.length >= 8) {
      handleMarkersRef.current[8] = moveHandle;
    } else {
      // Pad array to reach index 8
      while (handleMarkersRef.current.length < 8) {
        handleMarkersRef.current.push(null);
      }
      handleMarkersRef.current[8] = moveHandle;
    }
  }, []);



  // Function to remove move handle (kept for compatibility but no longer used)
  const removeMoveHandle = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove move handle at index 8
    if (handleMarkersRef.current.length > 8) {
      const moveHandle = handleMarkersRef.current[8];
      if (moveHandle) {
        map.removeLayer(moveHandle);
        handleMarkersRef.current[8] = null;
      }
    }
  }, []);

  // Function to update handle positions
  const updateHandlePositions = useCallback((newBounds: L.LatLngBounds) => {
    if (handleMarkersRef.current.length === 0) return;

    const currentRotation = rotationDegRef.current;
    console.log(`updateHandlePositions called with rotation: ${currentRotation} degrees`);

    // Calculate rotated positions for handles
    const { corners, edges } = computeRotatedImageCorners(newBounds, currentRotation);

    // Update corner handle positions
    corners.forEach((latlng, i) => {
      if (handleMarkersRef.current[i] && handleMarkersRef.current[i] !== null) {
        handleMarkersRef.current[i]!.setLatLng(latlng);
      }
    });

    // Update edge handle positions
    edges.forEach((latlng, i) => {
      const edgeIndex = i + 4; // Edge handles come after corner handles
      if (handleMarkersRef.current[edgeIndex] && handleMarkersRef.current[edgeIndex] !== null) {
        handleMarkersRef.current[edgeIndex]!.setLatLng(latlng);
      }
    });

    // Update move handle position (index 8) - keep at geographic center
    if (handleMarkersRef.current.length > 8 && handleMarkersRef.current[8]) {
      handleMarkersRef.current[8]!.setLatLng(newBounds.getCenter());
    }

    // Update rotation handle position if it exists
    if (rotateHandleRef.current) {
      const p = computeRotateHandleLatLng(newBounds);
      if (p) rotateHandleRef.current.setLatLng(p);
    }
  }, []);

  // Helper: apply rotation to the image element (using shared function)
  const applyRotationToImage = useCallback((deg: number) => {
    const imgEl = imageOverlayRef.current?.getElement() as HTMLImageElement | undefined;
    if (!imgEl) return;
    // Force pivot at center
    imgEl.style.setProperty('transform-origin', '50% 50%', 'important');
    // Compose rotation with Leaflet's transform without clobbering it
    const base = imgEl.style.transform || '';
    const withoutRotate = base.replace(/\s?rotate\([^)]*\)/, '');
    imgEl.style.transform = `${withoutRotate} rotate(${deg}deg)`.
      replace(/\s+/g, ' ').trim();
    imgEl.style.willChange = 'transform';
    
    // Update handle positions to follow the rotated image
    if (imageOverlayRef.current) {
      updateHandlePositions(imageOverlayRef.current.getBounds());
    }
  }, [updateHandlePositions]);

  // Function to add Ctrl+click and drag functionality to image overlay
  const addImageOverlayDragHandlers = useCallback((overlay: L.ImageOverlay) => {
    const map = mapRef.current;
    if (!map) return;

    let isDragging = false;
    let dragStartPos: L.LatLng | null = null;
    let dragStartBounds: L.LatLngBounds | null = null;

    // Add mouse event handlers to the image overlay
    overlay.on('mousedown', (e) => {
      // Only activate if Ctrl key is pressed
      if (!e.originalEvent.ctrlKey) return;
      
      e.originalEvent.preventDefault();
      isDragging = true;
      
      // Store starting positions
      dragStartPos = map.mouseEventToLatLng(e.originalEvent);
      dragStartBounds = overlay.getBounds();
      
      // Disable map dragging while moving image
      map.dragging.disable();
      
      // Change cursor
      map.getContainer().style.cursor = 'grabbing';
    });

    overlay.on('mousemove', (e) => {
      if (!isDragging || !dragStartPos || !dragStartBounds) return;
      
      const currentPos = map.mouseEventToLatLng(e.originalEvent);
      
      // Calculate the offset from where the drag started
      const offset = {
        lat: currentPos.lat - dragStartPos.lat,
        lng: currentPos.lng - dragStartPos.lng
      };
      
      // Create new bounds by moving the original bounds by the offset
      const newBounds = L.latLngBounds(
        [dragStartBounds.getSouth() + offset.lat, dragStartBounds.getWest() + offset.lng],
        [dragStartBounds.getNorth() + offset.lat, dragStartBounds.getEast() + offset.lng]
      );
      
      // Update image overlay bounds
      overlay.setBounds(newBounds);
      
      // Re-apply current rotation
      applyRotation(rotationDegRef.current);
      
      // Update all handle positions
      updateHandlePositions(newBounds);
    });

    overlay.on('mouseup', () => {
      if (!isDragging) return;
      
      isDragging = false;
      dragStartPos = null;
      dragStartBounds = null;
      
      // Re-enable map dragging
      map.dragging.enable();
      
      // Reset cursor
      map.getContainer().style.cursor = '';
    });

    // Handle mouse leaving the overlay
    overlay.on('mouseleave', () => {
      if (isDragging) {
        isDragging = false;
        dragStartPos = null;
        dragStartBounds = null;
        
        // Re-enable map dragging
        map.dragging.enable();
        
        // Reset cursor
        map.getContainer().style.cursor = '';
      }
    });

    // Add global key event listeners for Ctrl key visual feedback
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        const imgEl = overlay.getElement();
        if (imgEl) {
          imgEl.classList.add('ctrl-pressed');
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        const imgEl = overlay.getElement();
        if (imgEl) {
          imgEl.classList.remove('ctrl-pressed');
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // Cleanup function to remove event listeners
    overlay.on('remove', () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    });
  }, [applyRotation, updateHandlePositions]);

  // Compute rotation handle position given current bounds and rotation
  const computeRotateHandleLatLng = useCallback((bounds: L.LatLngBounds): L.LatLng | null => {
    const map = mapRef.current;
    if (!map) return null;

    const center = bounds.getCenter();
    const topMid = L.latLng(bounds.getNorth(), (bounds.getWest() + bounds.getEast()) / 2);
    const centerPt = map.latLngToLayerPoint(center);
    const topPt = map.latLngToLayerPoint(topMid);

    const v = topPt.subtract(centerPt);
    const len = Math.hypot(v.x, v.y) || 1;
    const offset = 40; // px above the top edge

    // Rotate the vector by current rotation
    const theta = (rotationDegRef.current * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const rx = v.x * cos - v.y * sin;
    const ry = v.x * sin + v.y * cos;

    const scale = (len + offset) / len;
    const handlePt = L.point(centerPt.x + rx * scale, centerPt.y + ry * scale);
    return map.layerPointToLatLng(handlePt);
  }, []);

  // Create rotation handle
  const addRotateHandle = useCallback(() => {
    const map = mapRef.current;
    if (!map || !imageOverlayRef.current) return;

    // Remove existing rotate handle
    if (rotateHandleRef.current) {
      map.removeLayer(rotateHandleRef.current);
      rotateHandleRef.current = null;
    }

    // Add CSS styles for rotation handle if not already added
    if (!document.getElementById('rotation-handle-styles')) {
      const style = document.createElement('style');
      style.id = 'rotation-handle-styles';
      style.textContent = `
        .rotate-handle {
          transition: all 0.2s ease;
        }
        .rotate-handle:hover {
          transform: scale(1.1);
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
        }
        .rotate-handle:active {
          transform: scale(0.95);
          box-shadow: 0 2px 6px rgba(59, 130, 246, 0.6);
        }
      `;
      document.head.appendChild(style);
    }

    const bounds = imageOverlayRef.current.getBounds();
    const ll = computeRotateHandleLatLng(bounds);
    if (!ll) return;

    const handle = L.marker(ll, {
      draggable: true,
      icon: L.divIcon({
        className: 'rotate-handle',
        html: `<div style="
          width: 28px; 
          height: 28px; 
          background: linear-gradient(135deg, #3b82f6, #1d4ed8);
          border: 3px solid white; 
          border-radius: 50%;
          cursor: grab;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          transition: all 0.2s ease;
        ">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" fill="white"/>
            <path d="M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" fill="white"/>
            <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" fill="white"/>
            <path d="M12 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" fill="white"/>
            <path d="M12 11c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z" fill="white"/>
          </svg>
        </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      })
    }).addTo(map);

    let dragStartAngleRad = 0;
    let baseDeg = 0;

    handle.on('dragstart', (e) => {
      const b = imageOverlayRef.current?.getBounds();
      if (!b) return;
      const mapLocal = mapRef.current!;
      // Calculate starting angle from center to mouse position
      const center = b.getCenter();
      const cPt = mapLocal.latLngToLayerPoint(center);
      const mousePt = mapLocal.latLngToLayerPoint((e.target as L.Marker).getLatLng());
      dragStartAngleRad = Math.atan2(mousePt.y - cPt.y, mousePt.x - cPt.x);
      baseDeg = rotationDegRef.current;
      handle.getElement()!.style.cursor = 'grabbing';
      mapLocal.dragging.disable();
    });

    handle.on('drag', (e) => {
      const b = imageOverlayRef.current?.getBounds();
      if (!b) return;
      const mapLocal = mapRef.current!;
      const center = b.getCenter();
      const cPt = mapLocal.latLngToLayerPoint(center);
      const mousePt = mapLocal.latLngToLayerPoint((e.target as L.Marker).getLatLng());
      const currAngleRad = Math.atan2(mousePt.y - cPt.y, mousePt.x - cPt.x);
      const deltaDeg = ((currAngleRad - dragStartAngleRad) * 180) / Math.PI;
      const newDeg = baseDeg + deltaDeg;
      rotationDegRef.current = newDeg;
      applyRotation(newDeg);
      // Reposition handle based on current rotation so it stays outside the top edge
      const newLL = computeRotateHandleLatLng(b);
      if (newLL) handle.setLatLng(newLL);
    });

    handle.on('dragend', () => {
      const b = imageOverlayRef.current?.getBounds();
      const mapLocal = mapRef.current!;
      if (b) {
        const newLL = computeRotateHandleLatLng(b);
        if (newLL) handle.setLatLng(newLL);
      }
      handle.getElement()!.style.cursor = 'grab';
      mapLocal.dragging.enable();
    });

    rotateHandleRef.current = handle;
  }, [applyRotation, computeRotateHandleLatLng]);

  const removeRotateHandle = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (rotateHandleRef.current) {
      map.removeLayer(rotateHandleRef.current);
      rotateHandleRef.current = null;
    }
  }, []);

  // Function to handle file selection
  const onFileChosen = async (f: File | null) => {
    setImageFile(f);
    
    if (!f) {
      // Clear image and reset states
      if (imageOverlayRef.current && mapRef.current) {
        mapRef.current.removeLayer(imageOverlayRef.current);
        imageOverlayRef.current = null;
      }
      setImageAspectRatio(1);
      setActiveImageId(null);
      setIsImageLoaded(false);
      setCurrentImageUrl(null);
      return;
    }

    if (!f.type.startsWith('image/')) {
      alert('Please select an image file (PNG, JPG, JPEG, etc.)');
      setImageFile(null);
      setImageAspectRatio(1);
      setShowPolygonTools(false);
      clearAllPolygons();
      return;
    }

    if (f.size > 10 * 1024 * 1024) {
      alert('File too large. Please select an image under 10MB.');
      setImageFile(null);
      setImageAspectRatio(1);
      setShowPolygonTools(false);
      clearAllPolygons();
      return;
    }

    try {
      setIsUploading(true);
      
      // Upload file to server
      const formData = new FormData();
      formData.append('file', f);
      
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }
      
      const uploadResult = await response.json();
      
      // Create image element to get dimensions
    const img = new Image();
    img.onload = () => {
      const aspectRatio = img.width / img.height;
      setImageAspectRatio(aspectRatio);

        // Clear any existing saved image overlays when uploading new image
        if (mapRef.current) {
          mapRef.current.eachLayer((layer) => {
            if (layer instanceof L.ImageOverlay && layer !== imageOverlayRef.current) {
              mapRef.current!.removeLayer(layer);
            }
          });
        }

      // Create initial bounds
      const baseWidth = 0.01; // Base width in degrees
      const baseHeight = baseWidth / aspectRatio;
      
      const bounds = L.latLngBounds(
        [-baseHeight / 2, -baseWidth / 2],
        [baseHeight / 2, baseWidth / 2]
      );

        // Store the server URL for saving later
        setCurrentImageUrl(uploadResult.url);
        
        // Use the server URL instead of object URL
        showImage(uploadResult.url, bounds);
      };
      img.src = uploadResult.url;
      
    } catch (error) {
      console.error('Upload error:', error);
      alert(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setImageFile(null);
      setImageAspectRatio(1);
      setIsImageLoaded(false);
      setShowPolygonTools(false);
      clearAllPolygons();
    } finally {
      setIsUploading(false);
    }
  };

  // Function to switch map style
  const switchMapStyle = (style: 'road' | 'aerial') => {
    const map = mapRef.current;
    if (!map) return;

    console.log('Switching to:', style, 'Current style:', mapStyle);

    // Remove current layer
    if (mapStyle === 'road' && roadLayerRef.current) {
      console.log('Removing road layer');
      map.removeLayer(roadLayerRef.current);
    } else if (mapStyle === 'aerial' && aerialLayerRef.current) {
      console.log('Removing aerial layer');
      map.removeLayer(aerialLayerRef.current);
    }

    // Add new layer
    if (style === 'road' && roadLayerRef.current) {
      console.log('Adding road layer');
      roadLayerRef.current.addTo(map);
    } else if (style === 'aerial' && aerialLayerRef.current) {
      console.log('Adding aerial layer');
      aerialLayerRef.current.addTo(map);
    }

    setMapStyle(style);
  };

  // Function to toggle map style
  const toggleMapStyle = (style: 'road' | 'aerial') => {
    if (mapStyle === style) {
      // If clicking the same style, do nothing
      return;
    }
    switchMapStyle(style);
  };

  // Function to center image at postcode
  const centerImageAtPostcode = async (postcode: string) => {
    if (!imageFile || !mapRef.current) {
      alert('Please upload an image first to use postcode centering.');
      return;
    }

    const postcodeInput = document.querySelector('input[placeholder*="postcode"]') as HTMLInputElement;
    if (postcodeInput) postcodeInput.value = 'Searching...';

    try {
      const cleanPostcode = postcode.replace(/\s+/g, '').toUpperCase();
      const response = await fetch(`https://api.postcodes.io/postcodes/${cleanPostcode}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const { longitude, latitude } = data.result;

      if (typeof longitude !== 'number' || typeof latitude !== 'number') {
        throw new Error('Invalid response format from postcode API');
      }

      // Create new bounds centered on postcode
      const baseWidth = 0.02; // Base width in degrees
      const baseHeight = baseWidth / imageAspectRatio;
      
      const newBounds = L.latLngBounds(
        [latitude - baseHeight / 2, longitude - baseWidth / 2],
        [latitude + baseHeight / 2, longitude + baseWidth / 2]
      );

      // Update image overlay
      if (imageOverlayRef.current) {
        imageOverlayRef.current.setBounds(newBounds);
      }

      // Re-apply current rotation
      applyRotation(rotationDegRef.current);

      // Fit map to new bounds
      mapRef.current.fitBounds(newBounds, { animate: true, padding: [20, 20] });

      // Update handle positions
      if (showResizeHandles) {
        updateHandlePositions(newBounds);
      }

      if (postcodeInput) postcodeInput.value = postcode.toUpperCase();

    } catch (error) {
      if (postcodeInput) postcodeInput.value = postcode;
      let msg = `Could not find postcode "${postcode}". `;
      if (String(error).includes('HTTP 404')) msg += 'Postcode not found.';
      else if (String(error).includes('HTTP 429')) msg += 'Too many requests—try again shortly.';
      else msg += `Error: ${error}`;
      alert(msg);
    }
  };

  // Effect to update transparency
  useEffect(() => {
    if (imageOverlayRef.current) {
      imageOverlayRef.current.setOpacity(transparency);
      // keep rotation applied (some browsers may re-rasterize)
      applyRotation(rotationDegRef.current);
    }
  }, [transparency, applyRotation]);

  // Effect to show/hide resize handles
  useEffect(() => {
    if (!imageOverlayRef.current || !mapRef.current) return;

    if (showResizeHandles) {
      addResizeHandles(imageOverlayRef.current.getBounds());
      // Update handle positions to account for rotation
      updateHandlePositions(imageOverlayRef.current.getBounds());
    } else {
      // Remove resize handles but keep move handle if enabled
      const resizeHandles = handleMarkersRef.current.slice(0, 8);
      resizeHandles.forEach(marker => {
        if (marker && marker !== null) {
          mapRef.current!.removeLayer(marker);
        }
      });
      // Clear resize handles (indices 0-7) but keep move handle at index 8
      handleMarkersRef.current.splice(0, 8);
    }
  }, [showResizeHandles, addResizeHandles, updateHandlePositions]);



  // Effect to show/hide rotate handle
  useEffect(() => {
    if (!imageOverlayRef.current || !mapRef.current) return;

    if (showRotateHandle) {
      addRotateHandle();
    } else {
      removeRotateHandle();
    }
  }, [showRotateHandle, addRotateHandle, removeRotateHandle]);

  // Keyboard controls for precise movement (always active when image is loaded)
  useEffect(() => {
    if (!imageOverlayRef.current) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!imageOverlayRef.current) return;

      const currentBounds = imageOverlayRef.current.getBounds();
      const moveAmount = 0.0001; // Very small movement for precision
      let newBounds = currentBounds;

      switch (e.key) {
        case 'ArrowUp':
          newBounds = L.latLngBounds(
            [currentBounds.getSouth() + moveAmount, currentBounds.getWest()],
            [currentBounds.getNorth() + moveAmount, currentBounds.getEast()]
          );
          break;
        case 'ArrowDown':
          newBounds = L.latLngBounds(
            [currentBounds.getSouth() - moveAmount, currentBounds.getWest()],
            [currentBounds.getNorth() - moveAmount, currentBounds.getEast()]
          );
          break;
        case 'ArrowLeft':
          newBounds = L.latLngBounds(
            [currentBounds.getSouth(), currentBounds.getWest() - moveAmount],
            [currentBounds.getNorth(), currentBounds.getEast() - moveAmount]
          );
          break;
        case 'ArrowRight':
          newBounds = L.latLngBounds(
            [currentBounds.getSouth(), currentBounds.getWest() + moveAmount],
            [currentBounds.getNorth(), currentBounds.getEast() + moveAmount]
          );
          break;
        default:
          return;
      }

      // Update image overlay bounds
      imageOverlayRef.current.setBounds(newBounds);
      
      // Re-apply current rotation
      applyRotation(rotationDegRef.current);
      
      // Update all handle positions
      updateHandlePositions(newBounds);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [updateHandlePositions]);

  // Function to show save dialog
  const openSaveDialog = useCallback(() => {
    if (!imageFile || !imageOverlayRef.current || !currentImageUrl) {
      alert('No image to save. Please upload an image first.');
      return;
    }
    
    // Set default name and floor level
    setImageName(imageFile.name);
    setSelectedFloorLevel('ground-floor');
    setShowSaveDialog(true);
  }, [imageFile, currentImageUrl]);

  // Function to save current image
  const saveCurrentImage = useCallback(() => {
    if (!imageFile || !imageOverlayRef.current || !currentImageUrl) {
      alert('No image to save. Please upload an image first.');
      return;
    }
    
    const bounds = imageOverlayRef.current.getBounds();
    
    console.log('Saving image:', {
      imageFile: imageFile?.name,
      currentUrl: currentImageUrl,
      bounds: bounds,
      imageOverlayRef: imageOverlayRef.current
    });
    
    // Check if this is an update to an existing saved image
    const existingImageIndex = savedImages.findIndex(img => img.url === currentImageUrl);
    
    if (existingImageIndex !== -1) {
      // Update existing saved image
      const updatedImage = {
        ...savedImages[existingImageIndex],
        name: imageName,
        floorLevel: selectedFloorLevel,
        bounds: bounds,
        rotation: rotationDegRef.current,
        transparency: transparency,
        timestamp: Date.now()
      };
      
      setSavedImages(prev => {
        const newSavedImages = [...prev];
        newSavedImages[existingImageIndex] = updatedImage;
        console.log('Updated existing saved image:', updatedImage);
        return newSavedImages;
      });
      
      setActiveImageId(updatedImage.id);
      alert(`Image "${imageName}" updated successfully!`);
    } else {
      // Create new saved image
      const newSavedImage = {
        id: `img_${Date.now()}`,
        name: imageName,
        url: currentImageUrl,
        bounds: bounds,
        rotation: rotationDegRef.current,
        transparency: transparency,
        floorLevel: selectedFloorLevel,
        timestamp: Date.now()
      };
      
      setSavedImages(prev => {
        const newSavedImages = [...prev, newSavedImage];
        console.log('Created new saved image:', newSavedImage);
        return newSavedImages;
      });
      
      setActiveImageId(newSavedImage.id);
      alert(`Image "${imageName}" saved successfully!`);
    }
    
    // Close dialog and reset form
    setShowSaveDialog(false);
    setImageName('');
    setSelectedFloorLevel('ground-floor');
  }, [imageFile, transparency, currentImageUrl, savedImages, imageName, selectedFloorLevel]);

  // Polygon drawing functionality
  const startPolygonDrawing = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    setIsDrawingPolygon(true);
    
    // Change map cursor to indicate drawing mode
    const mapContainer = map.getContainer();
    mapContainer.style.cursor = 'crosshair';
    
    // Create a temporary polygon for drawing
    const tempPolygon = L.polygon([], {
      color: '#ff00ff', // Default color, will be updated when room category is selected
      weight: 3,
      opacity: 0.8,
      fillColor: '#ff00ff', // Default color, will be updated when room category is selected
      fillOpacity: 0.3
    });

    let points: L.LatLng[] = [];
    
    const onMapClick = (e: L.LeafletMouseEvent) => {
      points.push(e.latlng);
      tempPolygon.setLatLngs(points);
      
      if (points.length === 1) {
        tempPolygon.addTo(map);
      }
    };

    const onDoubleClick = () => {
      if (points.length >= 3) {
        // Finish the polygon
        const finalPolygon = L.polygon(points, {
          color: '#ff00ff', // Default color, will be updated when room category is selected
          weight: 3,
          opacity: 0.8,
          fillColor: '#ff00ff', // Default color, will be updated when room category is selected
          fillOpacity: 0.3
        });
        
        finalPolygon.addTo(map);
        setDrawnPolygons(prev => [...prev, finalPolygon]);
        
        // Add hover tooltip to the polygon
        const areaData = calculatePolygonArea(finalPolygon);
        finalPolygon.bindTooltip(
          `<div style="font-weight: 600; font-size: 1.1em;">Polygon ${drawnPolygons.length + 1}</div><div style="font-size: 0.9em; color: #6b7280;">Area: ${areaData.area} ${areaData.unit}</div>`,
          { 
            permanent: false, 
            direction: 'top',
            className: 'polygon-tooltip',
            offset: [0, -10]
          }
        );
        
        // Add right-click context menu for polygon deletion
        finalPolygon.on('contextmenu', (e) => {
          const polygonIndex = drawnPolygons.length; // This will be the new polygon's index
          const polygonName = `Polygon ${polygonIndex + 1}`;
          showPolygonContextMenu(e.originalEvent, finalPolygon, polygonName, 'temp');
        });
        
        // Add visual feedback for right-click interaction
        finalPolygon.on('mouseover', () => {
          const element = finalPolygon.getElement();
          if (element && element instanceof HTMLElement) {
            element.style.cursor = 'pointer';
          }
        });
        
        finalPolygon.on('mouseout', () => {
          const element = finalPolygon.getElement();
          if (element && element instanceof HTMLElement) {
            element.style.cursor = 'default';
          }
        });
        
        // Show polygon naming dialog
        setPolygonToName({ polygon: finalPolygon, area: areaData.area, unit: areaData.unit });
        setPolygonName('');
        setEditableArea(areaData.area || 0); // Initialize editable area with calculated value, fallback to 0
        setShowPolygonNameDialog(true);
        
        // Clean up
        map.off('click', onMapClick);
        map.off('dblclick', onDoubleClick);
        tempPolygon.remove();
        setIsDrawingPolygon(false);
        
        // Reset map cursor
        const mapContainer = map.getContainer();
        mapContainer.style.cursor = '';
      } else {
        alert('Polygon needs at least 3 points. Keep clicking to add more points.');
      }
    };

    map.on('click', onMapClick);
    map.on('dblclick', onDoubleClick);
    
    // Show instructions
    alert('Click on the map to add points to your polygon. Double-click to finish drawing.');
  }, []);

  const clearAllPolygons = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    drawnPolygons.forEach(polygon => {
      map.removeLayer(polygon);
    });
    setDrawnPolygons([]);
    setPolygonAreas([]);
    console.log('Cleared all polygons and areas');
  }, [drawnPolygons]);

  const cancelPolygonDrawing = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    if (isDrawingPolygon) {
      // Remove any temporary polygon
      map.eachLayer((layer) => {
        if (layer instanceof L.Polygon && !drawnPolygons.includes(layer)) {
          map.removeLayer(layer);
        }
      });
      
      // Reset drawing state
      setIsDrawingPolygon(false);
      
      // Reset map cursor
      const mapContainer = map.getContainer();
      mapContainer.style.cursor = '';
      
      // Remove event listeners
      map.off('click');
      map.off('dblclick');
    }
  }, [isDrawingPolygon, drawnPolygons]);

  // Function to calculate polygon area
  const calculatePolygonArea = useCallback((polygon: L.Polygon) => {
    const map = mapRef.current;
    if (!map) return { area: 0, unit: 'm²' };

    try {
      // Get the polygon latlngs
      const latlngs = polygon.getLatLngs()[0] as L.LatLng[];
      if (!Array.isArray(latlngs) || latlngs.length < 3) {
        return { area: 0, unit: 'm²' };
      }

      // Calculate area using the shoelace formula (planar approximation)
      let area = 0;
      for (let i = 0; i < latlngs.length; i++) {
        const j = (i + 1) % latlngs.length;
        area += latlngs[i].lng * latlngs[j].lat;
        area -= latlngs[j].lng * latlngs[i].lat;
      }
      area = Math.abs(area) / 2;

      // Convert to square meters (approximate conversion)
      // This is a rough approximation - for more accurate results, 
      // you'd need to account for the actual geographic projection
      const metersPerDegree = 111320; // Approximate meters per degree at equator
      const areaInSquareMeters = area * (metersPerDegree * metersPerDegree);

      // Convert to appropriate units
      let displayArea: number;
      let unit: string;
      
      if (areaInSquareMeters < 10000) {
        // Less than 10,000 m² - show in m²
        displayArea = Math.round(areaInSquareMeters);
        unit = 'm²';
      } else if (areaInSquareMeters < 10000000) {
        // Less than 10,000,000 m² - show in hectares
        displayArea = Math.round(areaInSquareMeters / 10000 * 100) / 100;
        unit = 'ha';
      } else {
        // Large areas - show in km²
        displayArea = Math.round(areaInSquareMeters / 1000000 * 100) / 100;
        unit = 'km²';
      }
      
      console.log('Calculated area:', { area, areaInSquareMeters, displayArea, unit });
      return { area: displayArea, unit };
    } catch (error) {
      console.error('Error calculating polygon area:', error);
      return { area: 0, unit: 'm²' };
    }
  }, []);

  // Function to update polygon areas
  const updatePolygonAreas = useCallback(() => {
    if (drawnPolygons.length === 0) {
      setPolygonAreas([]);
      return;
    }
    
    const newAreas = drawnPolygons.map((polygon, index) => {
      const areaData = calculatePolygonArea(polygon);
      
      // Try to preserve existing custom names from polygonAreas
      const existingArea = polygonAreas[index];
      const name = existingArea?.name || `Polygon ${index + 1}`;
      
      return {
        id: `polygon_${index}`,
        name: name,
        area: areaData.area,
        unit: areaData.unit
      };
    });
    
    setPolygonAreas(newAreas);
  }, [drawnPolygons, calculatePolygonArea, polygonAreas]);

  // Auto-update polygon areas when drawnPolygons changes
  useEffect(() => {
    if (drawnPolygons.length > 0) {
      console.log('Auto-updating polygon areas due to drawnPolygons change');
      updatePolygonAreas();
    }
  }, [drawnPolygons.length]); // Only depend on the length, not the function

  const deleteLastPolygon = useCallback(() => {
    if (drawnPolygons.length === 0) return;
    
    const map = mapRef.current;
    if (!map) return;

    const lastPolygon = drawnPolygons[drawnPolygons.length - 1];
    map.removeLayer(lastPolygon);
    setDrawnPolygons(prev => prev.slice(0, -1));
    
    // Update polygon areas after deletion
    updatePolygonAreas();
  }, [drawnPolygons]);

  // Function to delete a specific polygon by reference
  const deletePolygonByReference = useCallback((polygonToDelete: L.Polygon) => {
    const map = mapRef.current;
    if (!map) return;

    // Find the current index of the polygon in the array
    const currentIndex = drawnPolygons.findIndex(p => p === polygonToDelete);
    if (currentIndex === -1) return; // Polygon not found
    
    // Remove from map
    map.removeLayer(polygonToDelete);
    
    // Remove from drawnPolygons array and update areas in one go
    setDrawnPolygons(prev => {
      const newPolygons = prev.filter(p => p !== polygonToDelete);
      
      // Update polygon areas immediately based on new array
      if (newPolygons.length === 0) {
        setPolygonAreas([]);
      } else {
        // Calculate new areas for remaining polygons
        const newAreas = newPolygons.map((polygon, newIndex) => {
          const areaData = calculatePolygonArea(polygon);
          
          // Try to preserve existing custom names, adjusting for the new index
          const oldIndex = drawnPolygons.findIndex(p => p === polygon);
          const existingArea = oldIndex >= 0 ? polygonAreas[oldIndex] : null;
          const name = existingArea?.name || `Polygon ${newIndex + 1}`;
          
          return {
            id: `polygon_${newIndex}`,
            name: name,
            area: areaData.area,
            unit: areaData.unit
          };
        });
        setPolygonAreas(newAreas);
      }
      
      return newPolygons;
    });
    
    // Close context menu
    setShowContextMenu(false);
    setContextMenuPolygon(null);
  }, [drawnPolygons, calculatePolygonArea, polygonAreas]);

  // Function to delete a specific polygon by index (kept for backward compatibility)
  const deletePolygonAtIndex = useCallback((index: number) => {
    if (index < 0 || index >= drawnPolygons.length) return;
    
    const polygonToDelete = drawnPolygons[index];
    if (!polygonToDelete) return; // Safety check
    
    deletePolygonByReference(polygonToDelete);
  }, [drawnPolygons, deletePolygonByReference]);

  // Function to show context menu for polygon deletion
  const showPolygonContextMenu = useCallback((e: MouseEvent, polygon: L.Polygon, name: string, polygonId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setContextMenuPolygon({ polygon, name, polygonId });
    setShowContextMenu(true);
  }, []);

  // Function to close context menu
  const closeContextMenu = useCallback(() => {
    setShowContextMenu(false);
    setContextMenuPolygon(null);
  }, []);

  // Function to close image context menu
  const closeImageContextMenu = useCallback(() => {
    setShowImageContextMenu(false);
    setImageContextMenuImage(null);
  }, []);

  // Function to export polygons as GeoJSON
  const exportPolygonsAsGeoJSON = useCallback((imageData: { id: string; name: string; polygons?: any[] }) => {
    if (!imageData.polygons || imageData.polygons.length === 0) {
      alert('No polygons to export for this image.');
      return;
    }

    // Create a FeatureCollection from the saved polygon data
    const featureCollection = {
      type: 'FeatureCollection',
      features: imageData.polygons.map((polyData, index) => ({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [polyData.latlngs.map((latlng: any) => [latlng.lng, latlng.lat])] // GeoJSON uses [lng, lat] order
        },
        properties: {
          name: polyData.name || `Polygon ${index + 1}`,
          area: polyData.area || 0,
          unit: polyData.unit || 'm²',
          imageName: imageData.name,
          exportedAt: new Date().toISOString()
        }
      }))
    };

    // Create and download the GeoJSON file
    const blob = new Blob([JSON.stringify(featureCollection, null, 2)], { 
      type: 'application/vnd.geo+json' 
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${imageData.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_polygons.geojson`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    // Close the context menu
    closeImageContextMenu();
  }, [closeImageContextMenu]);



  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showContextMenu) {
        closeContextMenu();
      }
      if (showImageContextMenu) {
        closeImageContextMenu();
      }
    };
    
    if (showContextMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
    if (showImageContextMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showContextMenu, showImageContextMenu, closeContextMenu, closeImageContextMenu]);

  const savePolygonsToImage = useCallback(() => {
    if (!activeImageId) return;
    
    const imageIndex = savedImages.findIndex(img => img.id === activeImageId);
    if (imageIndex === -1) return;
    
    // Convert polygons to serializable format with areas (or empty array if no polygons)
    const serializablePolygons = drawnPolygons.length > 0 ? drawnPolygons.map((polygon, index) => {
      const latlngs = polygon.getLatLngs();
      // Handle different polygon types (simple polygon vs multi-polygon)
      if (Array.isArray(latlngs) && latlngs.length > 0) {
        const firstRing = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
        return {
          latlngs: firstRing.map((latlng: any) => ({
            lat: latlng.lat,
            lng: latlng.lng
          })),
          name: polygonAreas[index]?.name || `Polygon ${index + 1}`,
          area: polygonAreas[index]?.area || 0,
          unit: polygonAreas[index]?.unit || 'm²',
          roomCategory: polygonAreas[index]?.roomCategory,
          roomType: polygonAreas[index]?.roomType
        };
      }
      return { latlngs: [], name: `Polygon ${index + 1}`, area: 0, unit: 'm²' };
    }) : [];
    
    // Update the saved image with polygons (or empty array)
    setSavedImages(prev => {
      const newSavedImages = [...prev];
      newSavedImages[imageIndex] = {
        ...newSavedImages[imageIndex],
        polygons: serializablePolygons
      };
      return newSavedImages;
    });
    
    // Show appropriate message based on polygon count
    if (drawnPolygons.length === 0) {
      alert(`Saved image "${savedImages[imageIndex].name}" with no polygons`);
    } else {
      alert(`Saved ${drawnPolygons.length} polygon${drawnPolygons.length !== 1 ? 's' : ''} to "${savedImages[imageIndex].name}"`);
    }
  }, [activeImageId, drawnPolygons, savedImages, polygonAreas]);

  // Function to load saved image - using same logic as showImage
  const loadSavedImage = useCallback((savedImage: typeof savedImages[0]) => {
    const map = mapRef.current;
    if (!map) return;

    // Remove current image if any
    if (imageOverlayRef.current) {
      // Clean up rotation observer before removing
      const imgEl = imageOverlayRef.current.getElement() as HTMLImageElement;
      if (imgEl && imgEl._rotationObserver) {
        imgEl._rotationObserver.disconnect();
      }
      map.removeLayer(imageOverlayRef.current);
    }

    // Clear all display overlays (non-active saved images)
    map.eachLayer((layer) => {
      if (layer instanceof L.ImageOverlay && layer !== imageOverlayRef.current) {
        map.removeLayer(layer);
      }
    });
    
    // Clear existing polygons when switching images
    clearAllPolygons();

    // Set up the loaded image for editing - same as fresh upload
    setImageFile(new File([], savedImage.name));
    setCurrentImageUrl(savedImage.url);
    setIsImageLoaded(true);
    setTransparency(savedImage.transparency);
    rotationDegRef.current = savedImage.rotation;
    setRotationDeg(savedImage.rotation);

    // Use the exact same logic as showImage function
    const overlay = L.imageOverlay(savedImage.url, savedImage.bounds, { 
      opacity: savedImage.transparency,
      interactive: true
    });
    
    overlay.addTo(map);
    imageOverlayRef.current = overlay;

    // Apply any existing rotation immediately
    applyRotation(savedImage.rotation);

    // Fit map to image bounds
    map.fitBounds(savedImage.bounds, { animate: true, padding: [20, 20] });

    // Show resize handles if enabled
    setShowResizeHandles(true);
    addResizeHandles(savedImage.bounds);
    updateHandlePositions(savedImage.bounds);

    // Add Ctrl+click and drag functionality
    addImageOverlayDragHandlers(overlay);

    // Show rotate handle if enabled
    setShowRotateHandle(true);
    addRotateHandle();

    // Show polygon tools when viewing saved images
    setShowPolygonTools(true);
    
                  // Restore saved polygons if they exist
        if (savedImage.polygons && savedImage.polygons.length > 0) {
          // Clear any existing polygons first
          clearAllPolygons();
          
          // Restore saved polygons
          const restoredPolygons: L.Polygon[] = [];
          const restoredAreas: Array<{ id: string; name: string; area: number; unit: string; roomCategory?: string; roomType?: string }> = [];
        
        savedImage.polygons.forEach((polyData, index) => {
          if (polyData.latlngs && polyData.latlngs.length >= 3) {
            // Get color based on room category, default to pink if none
            const polygonColor = polyData.roomCategory ? getPolygonColor(polyData.roomCategory) : '#ff00ff';
            
            const polygon = L.polygon(polyData.latlngs, {
              color: polygonColor,
              weight: 3,
              opacity: 0.8,
              fillColor: polygonColor,
              fillOpacity: 0.3
            });
            
            polygon.addTo(map);
            restoredPolygons.push(polygon);
            
            // Add right-click context menu for polygon deletion
            polygon.on('contextmenu', (e) => {
              const polygonName = polyData.name || `Polygon ${index + 1}`;
              showPolygonContextMenu(e.originalEvent, polygon, polygonName, 'saved');
            });
            
            // Add visual feedback for right-click interaction
            polygon.on('mouseover', () => {
              const element = polygon.getElement();
              if (element && element instanceof HTMLElement) {
                element.style.cursor = 'pointer';
              }
            });
            
            polygon.on('mouseout', () => {
              const element = polygon.getElement();
              if (element && element instanceof HTMLElement) {
                element.style.cursor = 'default';
              }
            });
            
            // Add tooltip to restored polygon
            if (polyData.area && polyData.unit) {
              const polygonName = polyData.name || `Polygon ${index + 1}`;
              polygon.bindTooltip(
                `<div style="font-weight: 600; font-size: 1.1em;">${polygonName}</div><div style="font-size: 0.9em; color: #6b7280;">Area: ${polyData.area} ${polyData.unit}</div>`,
                { 
                  permanent: false, 
                  direction: 'top',
                  className: 'polygon-tooltip',
                  offset: [0, -10]
                }
              );
              
              restoredAreas.push({
                id: `polygon_${index}`,
                name: polygonName,
                area: polyData.area,
                unit: polyData.unit,
                roomCategory: polyData.roomCategory,
                roomType: polyData.roomType
              });
            } else {
              // Calculate area for polygon without saved data
              const areaData = calculatePolygonArea(polygon);
              const polygonName = polyData.name || `Polygon ${index + 1}`;
              polygon.bindTooltip(
                `<div style="font-weight: 600; font-size: 1.1em;">${polygonName}</div><div style="font-size: 0.9em; color: #6b7280;">Area: ${areaData.area} ${areaData.unit}</div>`,
                { 
                  permanent: false, 
                  direction: 'top',
                  className: 'polygon-tooltip',
                  offset: [0, -10]
                }
              );
              
              restoredAreas.push({
                id: `polygon_${index}`,
                name: polygonName,
                area: areaData.area,
                unit: areaData.unit,
                roomCategory: polyData.roomCategory,
                roomType: polyData.roomType
              });
            }
          }
        });
        
        setDrawnPolygons(restoredPolygons);
        
        // If we have saved areas, use them; otherwise calculate new ones
        if (restoredAreas.length > 0) {
          setPolygonAreas(restoredAreas);
        } else {
          // Calculate areas for restored polygons
          setTimeout(() => {
            updatePolygonAreas();
          }, 100);
        }
        
        console.log(`Restored ${restoredPolygons.length} polygons for ${savedImage.name}`);
      } else {
        // Clear any existing polygons
        clearAllPolygons();
      }

    console.log(`Loaded saved image: ${savedImage.name} - Ready for editing!`);

  }, [applyRotation, addResizeHandles, updateHandlePositions, addImageOverlayDragHandlers, addRotateHandle]);

  // Function to delete saved image
  const deleteSavedImage = useCallback(async (imageId: string) => {
    const imageToDelete = savedImages.find(img => img.id === imageId);
    
    if (imageToDelete) {
      try {
        // Extract filename from URL (e.g., /uploads/abc123.jpg -> abc123.jpg)
        const filename = imageToDelete.url.split('/').pop();
        if (filename) {
          // Delete file from server
          const response = await fetch('/api/delete', {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ filename }),
          });
          
          if (!response.ok) {
            console.warn('Failed to delete file from server:', filename);
          }
        }
      } catch (error) {
        console.error('Error deleting file from server:', error);
      }
    }
    
    setSavedImages(prev => prev.filter(img => img.id !== imageId));
    
    if (activeImageId === imageId) {
      setActiveImageId(null);
      // Clear current image if it was the active one
      if (imageOverlayRef.current) {
        const map = mapRef.current;
        if (map) {
          map.removeLayer(imageOverlayRef.current);
        }
        imageOverlayRef.current = null;
      }
      setImageFile(null);
    }
  }, [activeImageId, savedImages]);

  // Function to refresh all saved image overlays
  const refreshSavedImageOverlays = useCallback(() => {
    if (!mapRef.current) return;
    
    // Clear any existing display overlays (not the active one)
    const map = mapRef.current;
    map.eachLayer((layer) => {
      if (layer instanceof L.ImageOverlay && layer !== imageOverlayRef.current) {
        map.removeLayer(layer);
      }
    });
    
    // Reload all saved images as overlays
    loadAllSavedImagesAsOverlays();
  }, []);

  // Load saved images from localStorage on component mount
  useEffect(() => {
    console.log('Loading saved images from localStorage...');
    const saved = localStorage.getItem('savedImages');
    console.log('localStorage savedImages:', saved);
    
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        console.log('Parsed saved images:', parsed);
        
        // Convert serialized bounds back to L.LatLngBounds objects
        const restoredImages = parsed.map((img: any) => ({
          ...img,
          floorLevel: img.floorLevel || 'ground-floor', // Provide default for existing images
          bounds: L.latLngBounds(
            [img.bounds._southWest.lat, img.bounds._southWest.lng],
            [img.bounds._northEast.lat, img.bounds._northEast.lng]
          )
        }));
        console.log('Restored images with bounds:', restoredImages);
        
        setSavedImages(restoredImages);
        
        // Mark initial load as complete
        setIsInitialLoadComplete(true);
      } catch (e) {
        console.error('Failed to parse saved images:', e);
        setIsInitialLoadComplete(true);
      }
    } else {
      console.log('No saved images found in localStorage');
      setIsInitialLoadComplete(true);
    }
  }, []);

  // Load active image ID from localStorage on component mount
  useEffect(() => {
    console.log('Loading active image ID from localStorage...');
    const savedActiveId = localStorage.getItem('activeImageId');
    console.log('localStorage activeImageId:', savedActiveId);
    
    if (savedActiveId) {
      setActiveImageId(savedActiveId);
    }
  }, []);

  // Wait for both map and room colors to be ready, then display saved image overlays
  useEffect(() => {
    console.log('Checking if ready to load saved image overlays:', {
      savedImagesLength: savedImages.length,
      mapReady: !!mapRef.current,
      mapSize: mapRef.current?.getSize().x || 0,
      roomColorsSize: roomColors.size,
      roomColorsLoaded
    });
    
    // Only proceed if we have saved images, the map is ready, and room colors are fully loaded
    if (savedImages.length > 0 && mapRef.current && mapRef.current.getSize().x > 0 && roomColorsLoaded && roomColors.size > 0) {
      console.log('Map and room colors ready, loading saved image overlays...');
      // Display all saved images as non-interactive overlays
      setTimeout(() => {
        loadAllSavedImagesAsOverlays();
      }, 100);
    }
  }, [savedImages, roomColors, roomColorsLoaded, mapRef.current]);

  // Load active image when activeImageId changes and room colors are ready
  useEffect(() => {
    console.log('Active image useEffect triggered:', {
      activeImageId,
      mapReady: !!mapRef.current,
      roomColorsLoaded,
      roomColorsSize: roomColors.size,
      savedImagesLength: savedImages.length
    });
    
    if (activeImageId && mapRef.current && roomColorsLoaded && roomColors.size > 0) {
      console.log('=== LOADING ACTIVE IMAGE ===');
      console.log('Loading active image:', activeImageId);
      const activeImage = savedImages.find(img => img.id === activeImageId);
      if (activeImage) {
        console.log('Loading active image immediately');
        loadSavedImage(activeImage);
      }
    } else {
      console.log('Active image loading conditions not met:', {
        hasActiveImageId: !!activeImageId,
        mapReady: !!mapRef.current,
        roomColorsLoaded,
        roomColorsSize: roomColors.size
      });
    }
  }, [activeImageId, roomColorsLoaded, roomColors.size, savedImages]);

  // Save to localStorage whenever savedImages changes
  useEffect(() => {
    // Don't save to localStorage until initial load is complete
    if (!isInitialLoadComplete) {
      console.log('Skipping localStorage save - initial load not complete yet');
      return;
    }
    
    console.log('Saving to localStorage, savedImages:', savedImages);
    
    // Convert L.LatLngBounds objects to serializable format
    const serializableImages = savedImages.map(img => ({
      ...img,
      bounds: {
        _southWest: { lat: img.bounds.getSouthWest().lat, lng: img.bounds.getSouthWest().lng },
        _northEast: { lat: img.bounds.getNorthEast().lat, lng: img.bounds.getNorthEast().lng }
      }
    }));
    
    const jsonString = JSON.stringify(serializableImages);
    console.log('Saving to localStorage:', jsonString);
    localStorage.setItem('savedImages', jsonString);
    
    // Verify it was saved
    const saved = localStorage.getItem('savedImages');
    console.log('Verified localStorage save:', saved);
  }, [savedImages, isInitialLoadComplete]);

  // Save activeImageId to localStorage whenever it changes
  useEffect(() => {
    if (isInitialLoadComplete) {
      if (activeImageId) {
        console.log('Saving activeImageId to localStorage:', activeImageId);
        localStorage.setItem('activeImageId', activeImageId);
      } else {
        console.log('Removing activeImageId from localStorage');
        localStorage.removeItem('activeImageId');
      }
    }
  }, [activeImageId, isInitialLoadComplete]);



  return (
    <div suppressHydrationWarning={true}>
      <div className="w-full h-screen grid grid-cols-12 grid-rows-1">
        {/* Left Sidebar */}
        <div className="col-span-4 xl:col-span-3 bg-white p-4 border-r border-gray-200 overflow-y-auto">
          <div className="flex items-center gap-3 mb-4">
            <img 
              src="/1st_planner_ltd_logo.jfif" 
              alt="1st Planner Ltd Logo" 
              className="w-12 h-12 object-contain"
            />
            <h1 className="text-xl font-bold text-blue-700">Map Workbench</h1>
          </div>

          {/* Upload Mode Selector */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              📋 What are you uploading?
            </label>
            <select
              value={uploadMode}
              onChange={(e) => setUploadMode(e.target.value as 'image' | 'geojson')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="image">🖼️ Image (PNG/JPG)</option>
              <option value="geojson">🗺️ GeoJSON (local XY coords)</option>
            </select>
          </div>

          {/* File Upload */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {uploadMode === 'image' ? '📁 Upload Image' : '🗺️ Upload GeoJSON'}
            </label>
            <input
              type="file"
              accept={uploadMode === 'image' ? 'image/*' : '.geojson,.json'}
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                if (uploadMode === 'image') {
                  onFileChosen(f);
                } else {
                  onGeoJSONChosen(f);
                }
              }}
              className="block w-full"
            />
            {imageFile && uploadMode === 'image' && (
              <div className="mt-2 p-2 rounded border text-xs text-green-600 border-green-200 bg-green-50">
                ✅ {imageFile.name} uploaded
              </div>
            )}
            {geoJSONFileRef.current && uploadMode === 'geojson' && (
              <div className="mt-2 p-2 rounded border text-xs text-green-600 border-green-200 bg-green-50">
                ✅ {geoJSONFileRef.current.name} uploaded and positioned
              </div>
            )}
            
            {/* Coordinate System Selector for GeoJSON */}
            {uploadMode === 'geojson' && (
              <div className="mt-2">
                <label className="block text-xs text-gray-600 mb-1">Coordinates</label>
                <select
                  defaultValue="auto"
                  onChange={(e) => { 
                    const v = e.target.value as 'auto'|'wgs84'|'local';
                    geoJSONKindRef.current = v === 'auto' ? null : (v as any);
                    // if a file is already loaded, re-run with the chosen mode
                    if (geoJSONFileRef.current) onGeoJSONChosen(geoJSONFileRef.current);
                  }}
                  className="w-full px-2 py-1 border rounded text-xs"
                >
                  <option value="auto">Auto detect</option>
                  <option value="local">Local XY (pixels/meters)</option>
                  <option value="wgs84">WGS84 (lon/lat)</option>
                </select>
              </div>
            )}
          </div>

          {/* Postcode Input */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              🎯 Center at Postcode
            </label>
            <div className="flex space-x-2 mb-2">
              <input
                type="text"
                placeholder="SW1A 1AA"
                className={`flex-1 px-3 py-2 border rounded-md text-sm ${
                  !imageFile && !geoJSONFileRef.current
                    ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'border-gray-300 bg-white text-gray-900'
                }`}
                disabled={!imageFile && !geoJSONFileRef.current}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (imageFile || geoJSONFileRef.current)) {
                    const postcode = (e.currentTarget as HTMLInputElement).value.trim();
                    if (postcode) centerAtPostcode(postcode);
                  }
                }}
              />
              <button
                onClick={() => {
                  if (!imageFile && !geoJSONFileRef.current) return;
                  const postcodeInput = document.querySelector('input[placeholder="SW1A 1AA"]') as HTMLInputElement;
                  const postcode = postcodeInput?.value.trim();
                  if (postcode) centerAtPostcode(postcode);
                }}
                disabled={!imageFile && !geoJSONFileRef.current}
                className={`px-4 py-2 text-sm rounded-md transition-colors ${
                  !imageFile && !geoJSONFileRef.current
                    ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                Center
              </button>
            </div>
            {!imageFile && !geoJSONFileRef.current ? (
              <p className="text-xs text-gray-400">Upload an image or GeoJSON file first</p>
            ) : (
              <p className="text-xs text-green-600">✅ Ready to center at postcode</p>
            )}

            {/* Image Controls */}
            {imageFile && (
              <div className="space-y-4">
                {/* Resize Controls */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">🔄 Resize</span>
                  <button
                    onClick={() => setShowResizeHandles(!showResizeHandles)}
                    className={`px-3 py-1 text-xs rounded-md ${
                      showResizeHandles 
                        ? 'bg-blue-600 text-white hover:bg-blue-700' 
                        : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                    }`}
                  >
                    {showResizeHandles ? 'Hide' : 'Show'}
                  </button>
                </div>

                {/* Move Controls */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">🚀 Move</span>
                  <span className="text-xs text-gray-500">Ctrl + Drag</span>
                </div>

                {/* Rotation Controls */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">🔄 Rotate</span>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setShowRotateHandle(!showRotateHandle)}
                      className={`px-3 py-1 text-xs rounded-md ${
                        showRotateHandle 
                          ? 'bg-emerald-600 text-white hover:bg-emerald-700' 
                          : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                      }`}
                    >
                      {showRotateHandle ? 'Hide' : 'Show'}
                    </button>
                    <button
                      onClick={() => { rotationDegRef.current = 0; applyRotation(0); if (imageOverlayRef.current && rotateHandleRef.current) { const b = imageOverlayRef.current.getBounds(); const p = computeRotateHandleLatLng(b); if (p) rotateHandleRef.current.setLatLng(p); } }}
                      className="px-3 py-1 text-xs rounded-md bg-red-500 text-white hover:bg-red-600"
                      title="Reset rotation to 0°"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                {/* Save Button */}
                <button
                  onClick={openSaveDialog}
                  className="w-full px-4 py-2 text-sm transition-colors bg-green-600 text-white hover:bg-green-700 rounded-md"
                >
                  {activeImageId ? '💾 Update Saved Image' : '💾 Save Image Position'}
                </button>
              </div>
            )}

            {/* GeoJSON Controls */}
            {geoJSONFileRef.current && uploadMode === 'geojson' && (
              <div className="space-y-4">
                {/* Resize Controls */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">🔄 Resize</span>
                  <button
                    onClick={() => setShowResizeHandles(!showResizeHandles)}
                    className={`px-3 py-1 text-xs rounded-md ${
                      showResizeHandles 
                        ? 'bg-blue-600 text-white hover:bg-blue-700' 
                        : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                    }`}
                  >
                    {showResizeHandles ? 'Hide' : 'Show'}
                  </button>
                </div>

                {/* Move Controls */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">🚀 Move</span>
                  <span className="text-xs text-gray-500">Ctrl + Drag</span>
                </div>

                {/* Rotation Controls */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">🔄 Rotate</span>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setShowRotateHandle(!showRotateHandle)}
                      className={`px-3 py-1 text-xs rounded-md ${
                        showRotateHandle 
                          ? 'bg-emerald-600 text-white hover:bg-emerald-700' 
                          : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                      }`}
                    >
                      {showRotateHandle ? 'Hide' : 'Show'}
                    </button>
                    <button
                      onClick={() => { 
                        rotationDegRef.current = 0; 
                        applyRotation(0); 
                        if (activeBoundsRef.current && rotateHandleRef.current) { 
                          const b = activeBoundsRef.current; 
                          const p = computeRotateHandleLatLng(b); 
                          if (p) rotateHandleRef.current.setLatLng(p); 
                        } 
                      }}
                      className="px-3 py-1 text-xs rounded-md bg-red-500 text-white hover:bg-red-600"
                      title="Reset rotation to 0°"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                {/* Save Button */}
                <button
                  onClick={openSaveDialog}
                  className="w-full px-4 py-2 text-sm transition-colors bg-green-600 text-white hover:bg-green-700 rounded-md"
                >
                  {activeImageId ? '💾 Update Saved GeoJSON' : '💾 Save GeoJSON Position'}
                </button>
              </div>
            )}

            {/* Save Dialog */}
            {showSaveDialog && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10000]">
                <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">
                    {activeImageId ? `Update Saved ${uploadMode === 'image' ? 'Image' : 'GeoJSON'}` : `Save ${uploadMode === 'image' ? 'Image' : 'GeoJSON'}`}
                  </h3>
                  
                  <div className="space-y-4">
                    {/* Name Input */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {uploadMode === 'image' ? 'Image' : 'GeoJSON'} Name
                      </label>
                      <input
                        type="text"
                        value={imageName}
                        onChange={(e) => setImageName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder={`Enter ${uploadMode === 'image' ? 'image' : 'GeoJSON'} name`}
                      />
                    </div>

                    {/* Floor Level Dropdown */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Floor Level
                      </label>
                      <select
                        value={selectedFloorLevel}
                        onChange={(e) => setSelectedFloorLevel(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="basement">1) Basement</option>
                        <option value="ground-floor">2) Ground Floor</option>
                        <option value="floor-1">3) Floor 1</option>
                        <option value="floor-2">4) Floor 2</option>
                        <option value="floor-3">5) Floor 3</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex space-x-3 mt-6">
                    <button
                      onClick={() => {
                        setShowSaveDialog(false);
                        setImageName('');
                        setSelectedFloorLevel('ground-floor');
                      }}
                      className="flex-1 px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        if (uploadMode === 'image') {
                          saveCurrentImage();
                        } else {
                          // Will implement GeoJSON save later
                          alert('GeoJSON save functionality coming soon!');
                        }
                      }}
                      disabled={!imageName.trim()}
                      className="flex-1 px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                    >
                      {activeImageId ? 'Update' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Quick Guide */}
            <div className="mt-6 pt-4 border-t">
              <h4 className="text-sm font-medium text-gray-700 mb-3">📖 Quick Guide</h4>
              <div className="text-xs text-gray-600 space-y-1">
                <p>• Upload {uploadMode === 'image' ? 'image' : 'GeoJSON'} → Position with Ctrl+drag</p>
                <p>• Show resize handles → Drag corners/edges</p>
                <p>• Show rotate handle → Drag to rotate</p>
                <p>• Save position → Name & categorize</p>
                <p>• Right sidebar → Load saved {uploadMode === 'image' ? 'images' : 'files'}</p>
                {uploadMode === 'geojson' && (
                  <>
                    <p>• Local XY coordinates → Automatically detected</p>
                    <p>• WGS84 coordinates → Displayed directly</p>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Map */}
        <div className="col-span-6 xl:col-span-7 relative">
          <div ref={containerRef} className="w-full h-full" />

          {/* Map Style Toggle - Top Left */}
          <div className="absolute top-4 left-20 bg-white bg-opacity-95 backdrop-blur-sm rounded-lg shadow-lg p-3 border border-gray-200 z-[1000]">
            <div className="text-sm font-medium text-gray-700 mb-2">Map Style</div>
            <div className="space-y-2">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mapStyle === 'road'}
                  onChange={() => toggleMapStyle('road')}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                />
                <span className="text-sm text-gray-700">🛣️ Road Map</span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mapStyle === 'aerial'}
                  onChange={() => toggleMapStyle('aerial')}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                />
                <span className="text-sm text-gray-700">🛸 Aerial Map</span>
              </label>
            </div>
          </div>

          {/* Polygon Drawing Tools - Bottom Right */}
          {showPolygonTools && (
            <div className="absolute bottom-4 right-4 bg-white bg-opacity-95 backdrop-blur-sm rounded-lg shadow-lg p-2 border border-gray-200 z-[1000]">
              <div className="flex items-center space-x-2">
                <button
                  onClick={startPolygonDrawing}
                  disabled={isDrawingPolygon}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    isDrawingPolygon
                      ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                  title="Draw Polygon"
                >
                  ✏️
                </button>
                
                {isDrawingPolygon && (
                  <button
                    onClick={cancelPolygonDrawing}
                    className="px-3 py-1.5 text-xs rounded-md transition-colors bg-yellow-600 text-white hover:bg-yellow-700"
                    title="Cancel Drawing"
                  >
                    ❌
                  </button>
                )}
                
                <button
                  onClick={deleteLastPolygon}
                  disabled={drawnPolygons.length === 0}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    drawnPolygons.length === 0
                      ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                      : 'bg-orange-600 text-white hover:bg-orange-700'
                  }`}
                  title="Delete Last Polygon"
                >
                  🗑️
                </button>
                
                <button
                  onClick={clearAllPolygons}
                  disabled={drawnPolygons.length === 0}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    drawnPolygons.length === 0
                      ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                      : 'bg-red-600 text-white hover:bg-red-700'
                  }`}
                  title="Clear All Polygons"
                >
                  🧹
                </button>
                
                <button
                  onClick={savePolygonsToImage}
                  disabled={!activeImageId}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    !activeImageId
                      ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                      : 'bg-green-600 text-white hover:bg-green-700'
                  }`}
                  title="Save Polygons to Image (or save with no polygons)"
                >
                  💾
                </button>
              </div>
              
                              <div className="text-xs text-gray-600 text-center mt-1 pt-1 border-t">
                  {drawnPolygons.length > 0 ? (
                    <>
                      {drawnPolygons.length} polygon{drawnPolygons.length !== 1 ? 's' : ''}
                      <div className="text-xs text-blue-500 mt-1">
                        💡 Right-click any polygon to delete it
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-green-600 mt-1">
                      💾 Save button will save image without polygons
                    </div>
                  )}
                </div>
              

            </div>
          )}

          {!imageFile && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
              <div className="text-center">
                <div className="text-6xl mb-4">🗺️</div>
              <div className="flex items-center justify-center gap-3 mb-2">
                <img 
                  src="/1st_planner_ltd_logo.jfif" 
                  alt="1st Planner Ltd Logo" 
                  className="w-10 h-10 object-contain"
                />
                <h2 className="text-xl font-semibold text-blue-700 mb-2">Image Overlay Tool</h2>
              </div>
                <p className="text-gray-500">Upload an image to overlay it on the map</p>
              <p className="text-sm text-gray-400 mt-2">
                Powered by Leaflet & {mapStyle === 'road' ? 'OpenStreetMap' : 'ESRI World Imagery'}
              </p>
              </div>
            </div>
          )}

          {/* Transparency Control Panel - Always visible when image is uploaded */}
          {imageFile && (
            <div className="absolute top-4 right-4 bg-white bg-opacity-95 backdrop-blur-sm rounded-lg shadow-lg p-4 border-2 border-blue-300 min-w-[200px] z-[9999] transparency-panel">
              <h3 className="text-sm font-semibold text-blue-700 mb-3">Image Transparency</h3>
               
              <div className="space-y-3">
                <div className="relative">
                  <label className="block text-xs text-blue-600 mb-1">
                    Opacity: {Math.round(transparency * 100)}%
                  </label>
                  {/* Visual track line */}
                  <div className="absolute top-6 left-0 w-full h-2 bg-gray-300 rounded-lg"></div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={transparency}
                    onChange={(e) => setTransparency(parseFloat(e.target.value))}
                    className="relative w-full h-2 rounded-lg appearance-none cursor-pointer slider"
                    style={{ 
                      marginTop: '0px',
                      position: 'relative',
                      zIndex: 1001
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar - Saved Images */}
        <div className="col-span-2 xl:col-span-2 bg-white p-4 border-l border-gray-200 overflow-y-auto">
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold text-gray-800">Saved Images</h3>
              <button
                onClick={refreshSavedImageOverlays}
                className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                title="Refresh saved image overlays"
              >
                🔄
              </button>
            </div>
            <p className="text-xs text-gray-600">Click any saved image to load it on the map</p>
            <p className="text-xs text-blue-600 mt-1">
              💡 Right-click images with polygons to export as GeoJSON
            </p>
          </div>

          {savedImages.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-2">📁</div>
              <p className="text-gray-500 text-sm">No saved images yet</p>
              <p className="text-gray-400 text-xs mt-1">Upload and save an image to see it here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {savedImages.map((savedImage) => (
                <div
                  key={savedImage.id}
                  className={`p-3 rounded-lg border-2 cursor-pointer transition-all hover:shadow-md ${
                    activeImageId === savedImage.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                  }`}
                  onClick={() => loadSavedImage(savedImage)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (savedImage.polygons && savedImage.polygons.length > 0) {
                      setImageContextMenuPosition({ x: e.clientX, y: e.clientY });
                      setImageContextMenuImage(savedImage);
                      setShowImageContextMenu(true);
                    }
                  }}
                  style={{
                    cursor: savedImage.polygons && savedImage.polygons.length > 0 ? 'context-menu' : 'pointer'
                  }}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-gray-800 text-sm truncate" title={savedImage.name}>
                        {savedImage.name}
                      </h4>
                      <p className="text-xs text-gray-500">
                        {new Date(savedImage.timestamp).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSavedImage(savedImage.id);
                      }}
                      className="ml-2 p-1 text-red-500 hover:text-red-700 hover:bg-red-100 rounded transition-colors"
                      title="Delete saved image"
                    >
                      🗑️
                    </button>
                  </div>
                  
                  <div className="text-xs text-gray-600 space-y-1">
                    <div className="flex justify-between">
                      <span>Floor:</span>
                      <span className="font-medium">{savedImage.floorLevel?.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Ground Floor'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Rotation:</span>
                      <span className="font-medium">{Math.round(savedImage.rotation)}°</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Opacity:</span>
                      <span className="font-medium">{Math.round(savedImage.transparency * 100)}%</span>
                    </div>
                    {savedImage.polygons && savedImage.polygons.length > 0 && (
                      <div className="flex justify-between">
                        <span>Polygons:</span>
                        <span className="font-medium flex items-center">
                          {savedImage.polygons.length}
                          <span className="ml-1 text-blue-500" title="Right-click to export as GeoJSON">📁</span>
                        </span>
                      </div>
                    )}
                  </div>

                  {activeImageId === savedImage.id && (
                    <div className="mt-2 pt-2 border-t border-blue-200">
                      <span className="text-xs text-blue-600 font-medium">✓ Currently Active</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Current Polygon Areas - Show when viewing saved images */}
          {showPolygonTools && (
            <div className="mt-6 pt-4 border-t border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-gray-700">Current Polygon Areas</h4>
                <button
                  onClick={updatePolygonAreas}
                  className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  title="Refresh polygon areas"
                >
                  🔄
                </button>
              </div>
              

              
              {drawnPolygons.length > 0 ? (
                <div className="space-y-2">
                  {polygonAreas.length > 0 ? (
                    <>
                      {polygonAreas.map((areaData, index) => (
                        <div key={areaData.id} className="flex items-center justify-between p-3 bg-blue-50 rounded border border-blue-200">
                          <div className="flex flex-col space-y-2 flex-1">
                            <div className="flex items-center space-x-2">
                              <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                              <span className="text-sm font-semibold text-gray-800">
                                {areaData.name || `Polygon ${index + 1}`}
                              </span>
                            </div>
                            {areaData.roomCategory && areaData.roomType && (
                              <div className="ml-5 text-xs text-gray-600 border-l-2 border-gray-300 pl-2">
                                <div className="font-medium text-gray-700">{areaData.roomType}</div>
                                <div className="text-gray-500 italic">{areaData.roomCategory}</div>
                              </div>
                            )}
                          </div>
                          <div className="text-right ml-3">
                            <span className="text-sm font-medium text-blue-700">
                              {areaData.area} {areaData.unit}
                            </span>
                          </div>
                        </div>
                      ))}
                      <div className="text-xs text-gray-500 text-center pt-2">
                        Total Area: {polygonAreas.reduce((sum, area) => sum + area.area, 0)} {polygonAreas[0]?.unit || 'm²'}
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4 text-gray-500 text-sm">
                      No area data available. Click refresh to calculate.
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-4 text-gray-500 text-sm">
                  No polygons currently drawn. Load a saved image or draw new polygons.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
       {/* Polygon Naming Dialog */}
    {showPolygonNameDialog && polygonToName && (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10000]">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">
            Configure Room Details
          </h3>
          
          <div className="space-y-4">
            {/* Editable Area Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Area *
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={editableArea}
                  onChange={(e) => setEditableArea(parseFloat(e.target.value) || 0)}
                  className={`flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black ${
                    editableArea < 0.01 ? 'border-red-300 focus:ring-red-500' : 'border-gray-300'
                  }`}
                  style={{ color: 'black' }}
                  placeholder="Enter area value"
                />
                <span className="text-sm text-gray-600 px-2 py-2">
                  {polygonToName?.unit}
                </span>
              </div>
              <p className={`text-xs mt-1 ${editableArea < 0.01 ? 'text-red-500' : 'text-gray-500'}`}>
                {editableArea < 0.01 
                  ? 'Please enter a valid area value greater than 0.01'
                  : `Calculated area: ${polygonToName?.area} ${polygonToName?.unit} (you can adjust this value)`
                }
              </p>
            </div>

            {/* Instructions */}
            <div className="p-3 bg-gray-50 rounded border border-gray-200">
              <p className="text-xs text-gray-600">
                <strong>Instructions:</strong> Select a room category and type from the BB103/BB104 standards, or enter a custom name below.
              </p>
            </div>

            {/* Room Type Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Room Category *
              </label>
              <select
                value={selectedRoomCategory}
                onChange={(e) => {
                  setSelectedRoomCategory(e.target.value);
                  setSelectedRoomType(''); // Reset room type when category changes
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                style={{ color: 'black' }}
              >
                <option value="" style={{ color: 'black' }}>Select a room category</option>
                {roomTypes.map((category, index) => (
                  <option key={index} value={category.category} style={{ color: 'black' }}>
                    {category.category}
                  </option>
                ))}
              </select>
            </div>

            {/* Room Type Selection */}
            {selectedRoomCategory && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Room Type *
                </label>
                <select
                  value={selectedRoomType}
                  onChange={(e) => setSelectedRoomType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                  style={{ color: 'black' }}
                >
                  <option value="" style={{ color: 'black' }}>Select a room type</option>
                  {roomTypes
                    .find(cat => cat.category === selectedRoomCategory)
                    ?.types.map((type, index) => (
                      <option key={index} value={type} style={{ color: 'black' }}>
                        {type}
                      </option>
                    ))}
                </select>
              </div>
            )}

            {/* Polygon Name Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Polygon Name (Optional)
              </label>
              <input
                type="text"
                value={polygonName}
                onChange={(e) => setPolygonName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                style={{ color: 'black' }}
                placeholder="Enter a custom name (optional)"
              />
            </div>
          </div>

          <div className="flex space-x-3 mt-6">
            <button
              onClick={() => {
                                  setShowPolygonNameDialog(false);
                  setPolygonToName(null);
                  setPolygonName('');
                  setSelectedRoomCategory('');
                  setSelectedRoomType('');
                  setEditableArea(0);
              }}
              className="flex-1 px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if ((selectedRoomType || polygonName.trim()) && editableArea >= 0.01) {
                  // Use custom name if provided, otherwise use main room category as fallback
                  const finalName = polygonName.trim() || selectedRoomCategory;
                  const polygonIndex = drawnPolygons.length - 1;
                  
                  // Update polygon areas with the name, room type info, and edited area
                  setPolygonAreas(prev => {
                    const newAreas = [...prev];
                    if (newAreas[polygonIndex]) {
                      newAreas[polygonIndex] = {
                        ...newAreas[polygonIndex],
                        name: finalName,
                        area: editableArea,
                        roomCategory: selectedRoomCategory,
                        roomType: selectedRoomType
                      };
                    } else {
                      // If this polygon doesn't have an area entry yet, create one
                      newAreas[polygonIndex] = {
                        id: `polygon_${polygonIndex}`,
                        name: finalName,
                        area: editableArea,
                        unit: polygonToName?.unit || 'm²',
                        roomCategory: selectedRoomCategory,
                        roomType: selectedRoomType
                      };
                    }
                    return newAreas;
                  });
                  
                  // Update polygon color based on room category
                  if (selectedRoomCategory && polygonToName) {
                    const newColor = getPolygonColor(selectedRoomCategory);
                    polygonToName.polygon.setStyle({
                      color: newColor,
                      fillColor: newColor
                    });
                  }
                  
                  // Update tooltip to include finalName as main title, room type info, and edited area
                  if (polygonToName) {
                    let tooltipContent = '';
                    
                    // Always use finalName as the main title
                    tooltipContent = `<div style="font-weight: 600; font-size: 1.1em;">${finalName}</div>`;
                    
                    // Add room type and category underneath if available
                    if (selectedRoomType) {
                      tooltipContent += `<div style="font-size: 0.9em; color: #6b7280;">${selectedRoomType}</div>`;
                    }
                    if (selectedRoomCategory) {
                      tooltipContent += `<div style="font-size: 0.9em; color: #6b7280;">Category: ${selectedRoomCategory}</div>`;
                    }
                    
                    // Add area at the bottom
                    tooltipContent += `<div style="font-size: 0.9em; color: #6b7280;">Area: ${editableArea} ${polygonToName.unit}</div>`;
                    
                    polygonToName.polygon.bindTooltip(
                      tooltipContent,
                      { 
                        permanent: false, 
                        direction: 'top',
                        className: 'polygon-tooltip',
                        offset: [0, -10]
                      }
                    );
                  }
                  
                  // Add right-click context menu for the named polygon
                  const namedPolygonIndex = drawnPolygons.findIndex(p => p === polygonToName.polygon);
                  if (namedPolygonIndex !== -1) {
                    polygonToName.polygon.off('contextmenu'); // Remove any existing handler
                    polygonToName.polygon.on('contextmenu', (e) => {
                      showPolygonContextMenu(e.originalEvent, polygonToName.polygon, finalName, 'named');
                    });
                    
                    // Add visual feedback for right-click interaction
                    polygonToName.polygon.off('mouseover mouseout'); // Remove any existing handlers
                    polygonToName.polygon.on('mouseover', () => {
                      const element = polygonToName.polygon.getElement();
                      if (element && element instanceof HTMLElement) {
                        element.style.cursor = 'pointer';
                      }
                    });
                    
                    polygonToName.polygon.on('mouseout', () => {
                      const element = polygonToName.polygon.getElement();
                      if (element && element instanceof HTMLElement) {
                        element.style.cursor = 'default';
                      }
                    });
                  }
                  
                  setShowPolygonNameDialog(false);
                  setPolygonToName(null);
                  setPolygonName('');
                }
              }}
              disabled={(!selectedRoomType && !polygonName.trim()) || editableArea < 0.01}
              className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              Save Name
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Polygon Context Menu */}
    {showContextMenu && contextMenuPolygon && (
      <div 
        className="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-[10001]"
        style={{ 
          left: contextMenuPosition.x, 
          top: contextMenuPosition.y,
          minWidth: '120px'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => {
            if (contextMenuPolygon) {
              deletePolygonByReference(contextMenuPolygon.polygon);
            }
          }}
          className="w-full px-4 py-2 text-sm text-left text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors flex items-center space-x-2"
        >
          <span>🗑️</span>
          <span>Delete "{contextMenuPolygon.name}"</span>
        </button>
      </div>
    )}

    {/* Image Context Menu for GeoJSON Export */}
    {showImageContextMenu && imageContextMenuImage && (
      <div 
        className="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-[10001]"
        style={{ 
          left: imageContextMenuPosition.x, 
          top: imageContextMenuPosition.y,
          minWidth: '150px'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => exportPolygonsAsGeoJSON(imageContextMenuImage)}
          className="w-full px-4 py-2 text-sm text-left text-blue-600 hover:bg-blue-50 hover:text-blue-700 transition-colors flex items-center space-x-2"
        >
          <span>📁</span>
          <span>Export Polygons as GeoJSON</span>
        </button>
      </div>
    )}
  </div>
  );
}