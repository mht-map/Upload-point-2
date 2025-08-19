'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';

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
  const resizeStartRef = useRef<{ bounds: L.LatLngBounds; marker: L.Marker } | null>(null);
  const rotateHandleRef = useRef<L.Marker | null>(null);
  const rotationDegRef = useRef<number>(0);
  const roadLayerRef = useRef<L.TileLayer | null>(null);
  const aerialLayerRef = useRef<L.TileLayer | null>(null);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [transparency, setTransparency] = useState<number>(1.0);
  const [imageAspectRatio, setImageAspectRatio] = useState<number>(1);
  const [showResizeHandles, setShowResizeHandles] = useState<boolean>(false);
  const [showRotateHandle, setShowRotateHandle] = useState<boolean>(false);
  const [mapStyle, setMapStyle] = useState<'road' | 'aerial'>('aerial');

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

    mapRef.current = map;

    return () => { 
      window.removeEventListener('resize', onReady); 
      map.remove(); 
      mapRef.current = null;
    };
  }, []);

  // Function to show image overlay
  const showImage = (url: string, bounds: L.LatLngBounds) => {
    const map = mapRef.current;
    if (!map) return;

    // Remove previous overlay if any
    if (imageOverlayRef.current) {
      map.removeLayer(imageOverlayRef.current);
    }

    // Remove existing handles
    handleMarkersRef.current.filter(marker => marker !== null).forEach(marker => map.removeLayer(marker!));
    handleMarkersRef.current = [];
    removeRotateHandle();

    // Create new image overlay
    const overlay = L.imageOverlay(url, bounds, { 
      opacity: transparency,
      interactive: true // Make it clickable for handles
    });
    overlay.addTo(map);
    imageOverlayRef.current = overlay;

    // Apply any existing rotation
    applyRotation(rotationDegRef.current);

    // Fit map to image bounds
    map.fitBounds(bounds, { animate: true, padding: [20, 20] });

    // Show resize handles if enabled
    if (showResizeHandles) {
      addResizeHandles(bounds);
      // Update handle positions to account for rotation
      updateHandlePositions(bounds);
    }

    // Add Ctrl+click and drag functionality to the image overlay
    addImageOverlayDragHandlers(overlay);

    // Show rotate handle if enabled
    if (showRotateHandle) {
      addRotateHandle();
    }
  };

  // Function to calculate visual corners of rotated image
  const computeRotatedImageCorners = (bounds: L.LatLngBounds, rotationDeg: number) => {
    const map = mapRef.current;
    if (!map) return { corners: [], edges: [] };

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
        resizeStartRef.current = { 
          bounds: imageOverlayRef.current!.getBounds(), // Use live bounds
          marker 
        };
        marker.getElement()!.style.cursor = 'grabbing';
        // Disable map dragging while resizing
        map.dragging.disable();
      });

      marker.on('drag', (e) => {
        if (!resizeStartRef.current || !imageOverlayRef.current) return;
        
        const currentMarker = e.target;
        const start = resizeStartRef.current.bounds; // Use start bounds here
        
        // Calculate new bounds based on which corner was dragged
        let newBounds: L.LatLngBounds;
        const markerIndex = idx; // Use the captured index from closure
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

        // Update image overlay bounds
        imageOverlayRef.current.setBounds(newBounds);
        
        // Re-apply rotation to maintain visual appearance
        applyRotation(rotationDegRef.current);
        
        // Update handle positions
        updateHandlePositions(newBounds);
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
        resizeStartRef.current = { 
          bounds: imageOverlayRef.current!.getBounds(), // Use live bounds
          marker 
        };
        marker.getElement()!.style.cursor = 'grabbing';
        // Disable map dragging while resizing
        map.dragging.disable();
      });

      marker.on('drag', (e) => {
        if (!resizeStartRef.current || !imageOverlayRef.current) return;
        
        const currentMarker = e.target;
        const currentPos = currentMarker.getLatLng();
        const start = resizeStartRef.current.bounds; // Use start bounds here
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

        // Update image overlay bounds
        imageOverlayRef.current.setBounds(newBounds);
        
        // Re-apply rotation to maintain visual appearance
        applyRotation(rotationDegRef.current);
        
        // Update handle positions
        updateHandlePositions(newBounds);
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
      dragStartBounds = imageOverlayRef.current?.getBounds() || null;
      
      // Disable map dragging while moving
      map.dragging.disable();
    });

    moveHandle.on('drag', (e) => {
      if (!imageOverlayRef.current || !dragStartPos || !dragStartBounds) return;
      
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
      
      // Update image overlay bounds
      imageOverlayRef.current.setBounds(newBounds);
      
      // Re-apply current rotation
      applyRotation(rotationDegRef.current);
      
      // Update all handle positions
      updateHandlePositions(newBounds);
      
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
  const updateHandlePositions = (newBounds: L.LatLngBounds) => {
    if (handleMarkersRef.current.length === 0) return;

    // Calculate rotated positions for handles
    const { corners, edges } = computeRotatedImageCorners(newBounds, rotationDegRef.current);

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
  };

  // Helper: apply rotation to the image element
  const applyRotation = useCallback((deg: number) => {
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
          background: #10b981; 
          border: 3px solid white; 
          border-radius: 50%;
          cursor: grab;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: bold;
          color: white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        ">🔄</div>`,
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
  const onFileChosen = (f: File | null) => {
    setImageFile(f);
    if (!f) {
      if (imageOverlayRef.current && mapRef.current) {
        mapRef.current.removeLayer(imageOverlayRef.current);
        imageOverlayRef.current = null;
      }
      setImageAspectRatio(1);
      return;
    }

    if (!f.type.startsWith('image/')) {
      alert('Please select an image file (PNG, JPG, JPEG, etc.)');
      setImageFile(null);
      setImageAspectRatio(1);
      return;
    }

    // Calculate aspect ratio
    const img = new Image();
    img.onload = () => {
      const aspectRatio = img.width / img.height;
      setImageAspectRatio(aspectRatio);
      console.log('Image dimensions:', img.width, 'x', img.height, 'Aspect ratio:', aspectRatio);

      // Create initial bounds
      const url = URL.createObjectURL(f);
      const baseWidth = 0.01; // Base width in degrees
      const baseHeight = baseWidth / aspectRatio;
      
      const bounds = L.latLngBounds(
        [-baseHeight / 2, -baseWidth / 2],
        [baseHeight / 2, baseWidth / 2]
      );

      showImage(url, bounds);
    };
    img.src = URL.createObjectURL(f);
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
    if (!imageOverlayRef.current || !mapRef.current) {
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

  return (
    <div suppressHydrationWarning={true}>
      <div className="w-full h-screen grid grid-cols-12 grid-rows-1">
        {/* Sidebar */}
        <div className="col-span-4 xl:col-span-3 bg-white p-4 border-r border-gray-200 overflow-y-auto">
          <div className="flex items-center gap-3 mb-4">
            <img 
              src="/1st_planner_ltd_logo.jfif" 
              alt="1st Planner Ltd Logo" 
              className="w-12 h-12 object-contain"
            />
            <h1 className="text-xl font-bold text-blue-700">Image Overlay Tool</h1>
          </div>



          {/* File Upload */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Upload Image
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onFileChosen(e.target.files?.[0] || null)}
              className="block w-full"
            />
            {imageFile && (
              <p className="text-xs text-gray-500 mt-1">Loaded: {imageFile.name}</p>
            )}
          </div>

          {/* Postcode Input */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Center Image at Postcode
            </label>
            <div className="flex space-x-2 mb-2">
              <input
                type="text"
                placeholder="Enter UK postcode (e.g., SW1A 1AA)"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const postcode = (e.currentTarget as HTMLInputElement).value.trim();
                    if (postcode) centerImageAtPostcode(postcode);
                  }
                }}
              />
              <button
                onClick={() => {
                  const postcodeInput = document.querySelector('input[placeholder*="postcode"]') as HTMLInputElement;
                  const postcode = postcodeInput?.value.trim();
                  if (postcode) centerImageAtPostcode(postcode);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
              >
                Center
              </button>
            </div>

            <p className="text-xs text-gray-500 mt-1">
              Enter a UK postcode and press Enter or click Center to position the image
            </p>
            <div className="mt-2 text-xs text-gray-400">
              <p className="font-medium">Example postcodes:</p>
              <p>SW1A 1AA (Buckingham Palace), M1 1AA (Manchester), B1 1AA (Birmingham)</p>
            </div>

            {/* Resize Controls */}
            {imageFile && (
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Image Resizing</label>
                  <button
                    onClick={() => setShowResizeHandles(!showResizeHandles)}
                    className={`px-3 py-1 text-xs rounded-md ${
                      showResizeHandles 
                        ? 'bg-blue-600 text-white hover:bg-blue-700' 
                        : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                    }`}
                  >
                    {showResizeHandles ? 'Hide Handles' : 'Show Handles'}
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  {showResizeHandles 
                    ? '🟡 Drag yellow corners for uniform scaling, 🟠 Drag orange edges for non-uniform scaling'
                    : 'Click "Show Handles" to enable image resizing'
                  }
                </p>
                {showResizeHandles && (
                  <div className="mt-2 p-2 bg-blue-50 rounded border border-blue-200">
                    <p className="text-xs text-blue-700">
                      <strong>Tip:</strong> Drag the handles to resize your image. 
                      Yellow corners maintain aspect ratio, orange edges allow free resizing.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Move Controls */}
            {imageFile && (
              <div className="mt-4 pt-4 border-t">
                <div className="mb-2">
                  <label className="text-sm font-medium text-gray-700">Image Moving</label>
                </div>
                <p className="text-xs text-gray-500">
                  Hold Ctrl and drag anywhere on the image to move it
                </p>
                <div className="mt-2 p-2 bg-green-50 rounded border border-green-200">
                  <p className="text-xs text-green-700">
                    <strong>Tip:</strong> Hold the Ctrl key and drag anywhere on the image to smoothly move it around the map.
                  </p>
                  <div className="mt-2 pt-2 border-t border-green-200">
                    <p className="text-xs text-green-600 font-medium">Precision Controls:</p>
                    <p className="text-xs text-green-600">• Ctrl + Drag: Fine-tuned movement from anywhere on image</p>
                    <p className="text-xs text-green-600">• Arrow keys: Pixel-perfect positioning</p>
                  </div>
                </div>
              </div>
            )}

            {/* Rotation Controls */}
            {imageFile && (
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Image Rotation</label>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setShowRotateHandle(!showRotateHandle)}
                      className={`px-3 py-1 text-xs rounded-md ${
                        showRotateHandle 
                          ? 'bg-emerald-600 text-white hover:bg-emerald-700' 
                          : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                      }`}
                    >
                      {showRotateHandle ? 'Hide Rotate' : 'Show Rotate'}
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
                <p className="text-xs text-gray-500">
                  {showRotateHandle 
                    ? '🟢 Drag the green handle to rotate the image around its center'
                    : 'Click "Show Rotate" to enable image rotation'
                  }
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Map */}
        <div className="col-span-8 xl:col-span-9 relative">
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
      </div>
    </div>
  );
}
