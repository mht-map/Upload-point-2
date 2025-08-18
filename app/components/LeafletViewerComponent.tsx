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

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [transparency, setTransparency] = useState<number>(1.0);
  const [imageAspectRatio, setImageAspectRatio] = useState<number>(1);
  const [showResizeHandles, setShowResizeHandles] = useState<boolean>(false);
  const [showMoveHandle, setShowMoveHandle] = useState<boolean>(false);
  const [isMoving, setIsMoving] = useState<boolean>(false);

  // Initialize Leaflet map
  useEffect(() => {
    if (!containerRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: false
    }).setView([51.5074, -0.1278], 13); // London default

    // Start with OSM tiles to test, then switch to ESRI aerial
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Switch to ESRI aerial after a short delay to ensure OSM loads first
    setTimeout(() => {
      if (map && !map.hasLayer(osmLayer)) return; // Map was destroyed
      
      // Remove OSM layer
      map.removeLayer(osmLayer);
      
      // Add ESRI World Imagery basemap (aerial/satellite view)
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: '&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
      }).addTo(map);
    }, 2000); // Switch after 2 seconds

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

    // Create new image overlay
    const overlay = L.imageOverlay(url, bounds, { 
      opacity: transparency,
      interactive: true // Make it clickable for handles
    });
    overlay.addTo(map);
    imageOverlayRef.current = overlay;

    // Fit map to image bounds
    map.fitBounds(bounds, { animate: true, padding: [20, 20] });

    // Show resize handles if enabled
    if (showResizeHandles) {
      addResizeHandles(bounds);
    }

    // Show move handle if enabled
    if (showMoveHandle) {
      addMoveHandle(bounds);
    }
  };

  // Function to add resize handles
  const addResizeHandles = useCallback((bounds: L.LatLngBounds) => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing handles
    handleMarkersRef.current.filter(marker => marker !== null).forEach(marker => map.removeLayer(marker!));
    handleMarkersRef.current = [];

    // Create corner handles
    const corners = [
      bounds.getNorthWest(), // NW
      bounds.getNorthEast(), // NE
      bounds.getSouthEast(), // SE
      bounds.getSouthWest(), // SW
    ];

    const cornerHandles = corners.map((latlng) => {
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
      });

      marker.on('drag', (e) => {
        if (!resizeStartRef.current || !imageOverlayRef.current) return;
        
        const currentMarker = e.target;
        const start = resizeStartRef.current.bounds; // Use start bounds here
        
        // Calculate new bounds based on which corner was dragged
        let newBounds: L.LatLngBounds;
        const markerIndex = handleMarkersRef.current.indexOf(currentMarker);
        const currentPos = currentMarker.getLatLng();
        
        switch (markerIndex) {
          case 0: // NW
            newBounds = L.latLngBounds(
              [start.getSouth(), start.getWest()],
              [currentPos.lat, currentPos.lng]
            );
            break;
          case 1: // NE
            newBounds = L.latLngBounds(
              [start.getSouth(), currentPos.lng],
              [currentPos.lat, start.getEast()]
            );
            break;
          case 2: // SE
            newBounds = L.latLngBounds(
              [currentPos.lat, currentPos.lng],
              [start.getNorth(), start.getEast()]
            );
            break;
          case 3: // SW
            newBounds = L.latLngBounds(
              [currentPos.lat, start.getWest()],
              [start.getNorth(), currentPos.lng]
            );
            break;
          default:
            return;
        }

        // Maintain aspect ratio for uniform scaling
        if (markerIndex === 0 || markerIndex === 2) { // Corner handles
          const currentWidth = newBounds.getEast() - newBounds.getWest();
          const currentHeight = newBounds.getNorth() - newBounds.getSouth();
          const currentAspectRatio = currentWidth / currentHeight;
          
          // Adjust to maintain original aspect ratio
          if (Math.abs(currentAspectRatio - imageAspectRatio) > 0.1) {
            const center = newBounds.getCenter();
            const halfWidth = Math.max(currentWidth, currentHeight) / 2;
            const halfHeight = halfWidth / imageAspectRatio;
            
            newBounds = L.latLngBounds(
              [center.lat - halfHeight, center.lng - halfWidth],
              [center.lat + halfHeight, center.lng + halfWidth]
            );
          }
        }

        // Update image overlay bounds
        imageOverlayRef.current.setBounds(newBounds);
        
        // Update handle positions
        updateHandlePositions(newBounds);
      });

      marker.on('dragend', () => {
        resizeStartRef.current = null;
        marker.getElement()!.style.cursor = 'grab';
      });

      return marker;
    });

    // Create edge handles
    const edges = [
      { position: L.latLng(bounds.getNorth(), (bounds.getWest() + bounds.getEast()) / 2), edge: 'north' },
      { position: L.latLng((bounds.getSouth() + bounds.getNorth()) / 2, bounds.getEast()), edge: 'east' },
      { position: L.latLng(bounds.getSouth(), (bounds.getWest() + bounds.getEast()) / 2), edge: 'south' },
      { position: L.latLng((bounds.getSouth() + bounds.getNorth()) / 2, bounds.getWest()), edge: 'west' },
    ];

    const edgeHandles = edges.map(({ position, edge }) => {
      const marker = L.marker(position, {
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
        
        // Update handle positions
        updateHandlePositions(newBounds);
      });

      marker.on('dragend', () => {
        resizeStartRef.current = null;
        marker.getElement()!.style.cursor = 'grab';
      });

      return marker;
    });

    // Store all handles
    handleMarkersRef.current = [...cornerHandles, ...edgeHandles];
  }, [imageAspectRatio]);

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
      setIsMoving(true);
      moveHandle.getElement()!.style.cursor = 'grabbing';
      moveHandle.getElement()!.style.transform = 'scale(1.1)';
      
      // Store the starting positions
      dragStartPos = e.target.getLatLng();
      dragStartBounds = imageOverlayRef.current?.getBounds() || null;
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
      
      // Update all handle positions
      updateHandlePositions(newBounds);
      
      // Keep move handle at the new center position
      const newCenter = newBounds.getCenter();
      moveHandle.setLatLng(newCenter);
    });

    moveHandle.on('dragend', () => {
      setIsMoving(false);
      moveHandle.getElement()!.style.cursor = 'move';
      moveHandle.getElement()!.style.transform = 'scale(1)';
      
      // Clear drag tracking
      dragStartPos = null;
      dragStartBounds = null;
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

  // Function to remove move handle
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

    const corners = [
      newBounds.getNorthWest(),
      newBounds.getNorthEast(),
      newBounds.getSouthEast(),
      newBounds.getSouthWest(),
    ];

    const edges = [
      L.latLng(newBounds.getNorth(), (newBounds.getWest() + newBounds.getEast()) / 2),
      L.latLng((newBounds.getSouth() + newBounds.getNorth()) / 2, newBounds.getEast()),
      L.latLng(newBounds.getSouth(), (newBounds.getWest() + newBounds.getEast()) / 2),
      L.latLng((newBounds.getSouth() + newBounds.getNorth()) / 2, newBounds.getWest()),
    ];

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
  };

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
    }
  }, [transparency]);

  // Effect to show/hide resize handles
  useEffect(() => {
    if (!imageOverlayRef.current || !mapRef.current) return;

    if (showResizeHandles) {
      addResizeHandles(imageOverlayRef.current.getBounds());
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
  }, [showResizeHandles, addResizeHandles]);

  // Effect to show/hide move handle
  useEffect(() => {
    if (!imageOverlayRef.current || !mapRef.current) return;

    if (showMoveHandle) {
      addMoveHandle(imageOverlayRef.current.getBounds());
    } else {
      removeMoveHandle();
    }
  }, [showMoveHandle, addMoveHandle, removeMoveHandle]);

  // Keyboard controls for precise movement
  useEffect(() => {
    if (!showMoveHandle || !imageOverlayRef.current) return;

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
      
      // Update all handle positions
      updateHandlePositions(newBounds);
      
      // Update move handle position
      if (handleMarkersRef.current.length > 8) {
        const moveHandle = handleMarkersRef.current[8];
        if (moveHandle) {
          moveHandle.setLatLng(newBounds.getCenter());
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showMoveHandle, updateHandlePositions]);

  return (
    <div suppressHydrationWarning={true}>
      <div className="w-full h-screen grid grid-cols-12 grid-rows-1">
        {/* Sidebar */}
        <div className="col-span-4 xl:col-span-3 bg-white p-4 border-r border-gray-200 overflow-y-auto">
          <h1 className="text-xl font-bold mb-4">Image Overlay Tool</h1>

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
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Image Moving</label>
                  <button
                    onClick={() => setShowMoveHandle(!showMoveHandle)}
                    className={`px-3 py-1 text-xs rounded-md ${
                      showMoveHandle 
                        ? 'bg-green-600 text-white hover:bg-green-700' 
                        : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                    }`}
                  >
                    {showMoveHandle ? 'Hide Move' : 'Show Move'}
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  {showMoveHandle 
                    ? '🔵 Drag the blue center handle to move the entire image'
                    : 'Click "Show Move" to enable image moving'
                  }
                </p>
                {showMoveHandle && (
                  <div className="mt-2 p-2 bg-green-50 rounded border border-green-200">
                    <p className="text-xs text-green-700">
                      <strong>Tip:</strong> Drag the blue center handle (↔) to smoothly move your image around the map.
                    </p>
                    <div className="mt-2 pt-2 border-t border-green-200">
                      <p className="text-xs text-green-600 font-medium">Precision Controls:</p>
                      <p className="text-xs text-green-600">• Drag handle: Fine-tuned movement</p>
                      <p className="text-xs text-green-600">• Arrow keys: Pixel-perfect positioning</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Map */}
        <div className="col-span-8 xl:col-span-9 relative">
          <div ref={containerRef} className="w-full h-full" />

          {!imageFile && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
              <div className="text-center">
                <div className="text-6xl mb-4">🗺️</div>
                <h2 className="text-xl font-semibold text-gray-600 mb-2">Image Overlay Tool</h2>
                <p className="text-gray-500">Upload an image to overlay it on the map</p>
                <p className="text-sm text-gray-400 mt-2">Powered by Leaflet & ESRI World Imagery</p>
              </div>
            </div>
          )}

          {/* Transparency Control Panel - Always visible when image is uploaded */}
          {imageFile && (
            <div className="absolute top-4 right-4 bg-white bg-opacity-95 backdrop-blur-sm rounded-lg shadow-lg p-4 border border-gray-200 min-w-[200px] z-50 transparency-panel">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Image Transparency</h3>
               
              <div className="space-y-3">
                <div className="relative">
                  <label className="block text-xs text-gray-600 mb-1">
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
                    className="relative w-full h-2 rounded-lg appearance-none cursor-pointer slider z-10"
                    style={{ marginTop: '0px' }}
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
