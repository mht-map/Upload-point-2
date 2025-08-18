'use client';

import { useEffect, useRef, useState } from 'react';

// The URL on your server where CesiumJS's static files are hosted.
declare global {
  interface Window {
    CESIUM_BASE_URL: string;
    imageSize: { width: number; height: number };
  }
}

export default function CesiumViewer() {
  const viewerRef = useRef<any>(null);
  const cesiumRef = useRef<any>(null);             // NEW: hold Cesium in a ref
  const imageUrlRef = useRef<string | null>(null); // NEW: track object URL for cleanup
  const containerRef = useRef<HTMLDivElement>(null);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageBillboard, setImageBillboard] = useState<any>(null);

  // Add state to store the image's aspect ratio
  const [imageAspectRatio, setImageAspectRatio] = useState<number>(1);

  // Add state for resize handles and interaction
  const [showResizeHandles, setShowResizeHandles] = useState<boolean>(false);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [resizeStartPoint, setResizeStartPoint] = useState<any>(null);
  const [resizeStartRect, setResizeStartRect] = useState<any>(null);

  // Function to show resize handles when image is loaded
  const showResizeHandlesForImage = () => {
    if (imageBillboard?.type === 'imagery') {
      setShowResizeHandles(true);
    }
  };

  // Function to hide resize handles
  const hideResizeHandles = () => {
    setShowResizeHandles(false);
    setIsResizing(false);
  };

  // Function to handle resize start
  const startResize = (handle: string, event: any) => {
    if (imageBillboard?.type !== 'imagery' || !cesiumRef.current) return;
    
    setIsResizing(true);
    setResizeStartPoint(event);
    setResizeStartRect({ ...imageBillboard.layer.rectangle });
    
    // Add event listeners for dragging
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', stopResize);
  };

  // Function to handle resize movement
  const handleResizeMove = (event: MouseEvent) => {
    if (!isResizing || !resizeStartPoint || !resizeStartRect || !cesiumRef.current || imageBillboard?.type !== 'imagery') return;
    
    const viewer = viewerRef.current;
    if (!viewer) return;

    // Convert mouse position to world coordinates
    const mousePosition = new cesiumRef.current.Cartesian2(event.clientX, event.clientY);
    const pickedPosition = viewer.camera.pickEllipsoid(mousePosition, viewer.scene.globe.ellipsoid);
    
    if (!pickedPosition) return;
    
    const cartographic = cesiumRef.current.Cartographic.fromCartesian(pickedPosition);
    const longitude = cesiumRef.current.Math.toDegrees(cartographic.longitude);
    const latitude = cesiumRef.current.Math.toDegrees(cartographic.latitude);
    
    // Calculate new rectangle based on which handle was dragged
    let newRect;
    const deltaLon = longitude - cesiumRef.current.Math.toDegrees(cesiumRef.current.Cartographic.fromCartesian(resizeStartPoint.position).longitude);
    const deltaLat = latitude - cesiumRef.current.Math.toDegrees(cesiumRef.current.Cartographic.fromCartesian(resizeStartPoint.position).latitude);
    
    if (resizeStartPoint.handle === 'corner') {
      // Uniform scaling from corner
      const scaleFactor = 1 + Math.max(Math.abs(deltaLon), Math.abs(deltaLat)) / 0.01;
      const centerLon = (resizeStartRect.west + resizeStartRect.east) / 2;
      const centerLat = (resizeStartRect.south + resizeStartRect.north) / 2;
      const halfWidth = (resizeStartRect.east - resizeStartRect.west) / 2 * scaleFactor;
      const halfHeight = (resizeStartRect.north - resizeStartRect.south) / 2 * scaleFactor;
      
      newRect = cesiumRef.current.Rectangle.fromDegrees(
        centerLon - halfWidth,
        centerLat - halfHeight,
        centerLon + halfWidth,
        centerLat + halfHeight
      );
    } else if (resizeStartPoint.handle === 'edge') {
      // Non-uniform scaling from edge
      const edge = resizeStartPoint.edge;
      if (edge === 'north' || edge === 'south') {
        newRect = cesiumRef.current.Rectangle.fromDegrees(
          resizeStartRect.west,
          edge === 'north' ? resizeStartRect.south : resizeStartRect.south + deltaLat,
          resizeStartRect.east,
          edge === 'north' ? resizeStartRect.north + deltaLat : resizeStartRect.north
        );
      } else {
        newRect = cesiumRef.current.Rectangle.fromDegrees(
          edge === 'east' ? resizeStartRect.west : resizeStartRect.west + deltaLon,
          resizeStartRect.south,
          edge === 'east' ? resizeStartRect.east + deltaLon : resizeStartRect.east,
          resizeStartRect.north
        );
      }
    }
    
    if (newRect) {
      imageBillboard.layer.rectangle = newRect;
      // Update position controls to reflect new position
      updatePositionControls(newRect);
    }
  };

  // Function to stop resizing
  const stopResize = () => {
    setIsResizing(false);
    setResizeStartPoint(null);
    setResizeStartRect(null);
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', stopResize);
  };

  // Add resize handles to the map
  useEffect(() => {
    if (!showResizeHandles || imageBillboard?.type !== 'imagery' || !cesiumRef.current || !viewerRef.current) return;
    
    console.log('Creating resize handles...'); // Debug log
    
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    
    // Create resize handle entities
    const rect = imageBillboard.layer.rectangle;
    console.log('Image rectangle:', rect); // Debug log
    const handles: any[] = [];
    
    // Corner handles (uniform scaling)
    const corners = [
      { position: Cesium.Cartesian3.fromDegrees(rect.west, rect.north), handle: 'corner', edge: 'nw' },
      { position: Cesium.Cartesian3.fromDegrees(rect.east, rect.north), handle: 'corner', edge: 'ne' },
      { position: Cesium.Cartesian3.fromDegrees(rect.east, rect.south), handle: 'corner', edge: 'se' },
      { position: Cesium.Cartesian3.fromDegrees(rect.west, rect.south), handle: 'corner', edge: 'sw' }
    ];
    
    // Edge handles (non-uniform scaling)
    const edges = [
      { position: Cesium.Cartesian3.fromDegrees((rect.west + rect.east) / 2, rect.north), handle: 'edge', edge: 'north' },
      { position: Cesium.Cartesian3.fromDegrees(rect.east, (rect.south + rect.north) / 2), handle: 'edge', edge: 'east' },
      { position: Cesium.Cartesian3.fromDegrees((rect.west + rect.east) / 2, rect.south), handle: 'edge', edge: 'south' },
      { position: Cesium.Cartesian3.fromDegrees(rect.west, (rect.south + rect.north) / 2), handle: 'edge', edge: 'west' }
    ];
    
    // Add corner handles
    corners.forEach(({ position, handle, edge }) => {
      const entity = viewer.entities.add({
        position: position,
        point: {
          pixelOffset: new Cesium.Cartesian2(0, 0),
          color: Cesium.Color.YELLOW,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          scale: 15,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
      
      handles.push({ entity, handle, edge, position });
      console.log('Added corner handle:', edge, 'at position:', position); // Debug log
    });
    
    // Add edge handles
    edges.forEach(({ position, handle, edge }) => {
      const entity = viewer.entities.add({
        position: position,
        point: {
          pixelOffset: new Cesium.Cartesian2(0, 0),
          color: Cesium.Color.ORANGE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          scale: 12,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
      
      handles.push({ entity, handle, edge, position });
      console.log('Added edge handle:', edge, 'at position:', position); // Debug log
    });
    
    console.log('Total handles created:', handles.length); // Debug log
    
    // Add click event handler for resize handles
    const clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    clickHandler.setInputAction((event: any) => {
      const pickedObject = viewer.scene.pick(event.position);
      if (pickedObject && pickedObject.id) {
        const handle = handles.find(h => h.entity === pickedObject.id);
        if (handle) {
          console.log('Handle clicked:', handle); // Debug log
          startResize(handle.handle, { position: handle.position, handle: handle.handle, edge: handle.edge });
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    
    // Cleanup function
    return () => {
      handles.forEach(handle => viewer.entities.remove(handle.entity));
      clickHandler.destroy();
    };
  }, [showResizeHandles, imageBillboard]);

  // Function to update handle positions when image moves
  const updateHandlePositions = () => {
    if (!showResizeHandles || imageBillboard?.type !== 'imagery' || !cesiumRef.current || !viewerRef.current) return;
    
    // Force re-render of handles by toggling showResizeHandles
    setShowResizeHandles(false);
    setTimeout(() => setShowResizeHandles(true), 100);
  };

  // Init Cesium only when an image is chosen (your original intent)
  useEffect(() => {
    if (!imageFile) return;

    window.CESIUM_BASE_URL = '/cesium/';
    let cancelled = false;

    const init = async () => {
      try {
        const Cesium = await import('cesium');
        await import('cesium/Build/Cesium/Widgets/widgets.css');
        Cesium.Ion.defaultAccessToken =
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIwYTI4MjJiZi1jYjhlLTRjZDEtODA2Yy05MWNkMTRkOGI3MGYiLCJpZCI6MzI4ODM3LCJpYXQiOjE3NTQzNzgwNzJ9.tbvEcKvb4zstlIzlgFxcbqluP5hZ1gaCT_8NpyNdZww';

        cesiumRef.current = Cesium; // NEW: assign to ref synchronously

        const viewer = new Cesium.Viewer(containerRef.current!, {
          terrain: undefined,
          timeline: false,
          animation: false,
          geocoder: false,
          homeButton: true,
          sceneModePicker: true,
          baseLayerPicker: false,
          navigationHelpButton: false,
          infoBox: false,
          selectionIndicator: false,
          fullscreenButton: false,
        });

        await viewer.imageryLayers.addImageryProvider(
          await Cesium.IonImageryProvider.fromAssetId(2)
        );

        viewerRef.current = viewer;

        if (!cancelled) {
          // Call converter with LOCAL handles to avoid state race
          convertImageToImageryLayerWith(Cesium, viewer, imageFile);
        }
      } catch (err) {
        console.error('Cesium init failed:', err);
      }
    };

    init();

    return () => {
      cancelled = true;

      // Clean up imagery layer and URL
      try {
        const v = viewerRef.current;
        if (imageBillboard?.type === 'imagery' && v) {
          v.imageryLayers.remove(imageBillboard.layer);
        } else if (imageBillboard?.type === 'billboard' && v) {
          v.entities.remove(imageBillboard.entity);
        }
      } catch (e) {
        console.warn('Error cleaning up image layer:', e);
      }

      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = null;
      }

      const v = viewerRef.current;
      if (v && !v.isDestroyed?.()) v.destroy();
      viewerRef.current = null;
      cesiumRef.current = null;
    };
  }, [imageFile]); // eslint-disable-line

  // NEW: parametric converter that DOES NOT read React state
  function convertImageToImageryLayerWith(Cesium: any, viewer: any, file: File) {
    if (!file || !Cesium || !viewer) return;

    try {
      // Remove old layer/entity if present
      if (imageBillboard?.type === 'imagery') {
        try { viewer.imageryLayers.remove(imageBillboard.layer); } catch {}
      } else if (imageBillboard?.type === 'billboard') {
        try { viewer.entities.remove(imageBillboard.entity); } catch {}
      }

      // Revoke previous URL to avoid leaks
      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current);
      }
      const imageUrl = URL.createObjectURL(file);
      imageUrlRef.current = imageUrl;

      const rect = Cesium.Rectangle.fromDegrees(-0.01, -0.01, 0.01, 0.01);

      if (!Cesium.SingleTileImageryProvider) {
        // Fallback: billboard
        const billboard = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
          billboard: {
            image: imageUrl,
            width: 1000,
            height: 1000,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            sizeInMeters: true,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          },
        });
        setImageBillboard({ type: 'billboard', entity: billboard, url: imageUrl });
        viewer.zoomTo(billboard);
        return;
      }

      // Preferred: imagery layer
      const layer = viewer.imageryLayers.addImageryProvider(
        new Cesium.SingleTileImageryProvider({
          url: imageUrl,
          rectangle: rect,
          tileWidth: 512,  // Required parameter
          tileHeight: 512  // Required parameter
        })
      );

      setImageBillboard({ type: 'imagery', layer, url: imageUrl });

      viewer.camera.flyTo({ destination: rect, duration: 1.0 });
      
      // Show resize handles immediately after image is loaded
      setShowResizeHandles(true);
    } catch (error: any) {
      console.error('convertImageToImageryLayerWith error:', error);
      // Don't alert during init; reserve alerts for explicit user actions
    }
  }

  // Keep around for manual re-run if you want, but use refs not state
  function convertImageToImageryLayer() {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!imageFile || !Cesium || !viewer) return; // no alert
    convertImageToImageryLayerWith(Cesium, viewer, imageFile);
  }

  function onFileChosen(f: File | null) {
    setImageFile(f);
    if (!f) {
      setImageBillboard(null);
      setImageAspectRatio(1);
      return;
    }
    if (!f.type.startsWith('image/')) {
      alert('Please select an image file (PNG, JPG, JPEG, etc.)');
      setImageFile(null);
      setImageAspectRatio(1);
      return;
    }
    
    // Calculate and store the aspect ratio
    const img = new Image();
    img.onload = () => {
      const aspectRatio = img.width / img.height;
      setImageAspectRatio(aspectRatio);
      console.log('Image dimensions:', img.width, 'x', img.height, 'Aspect ratio:', aspectRatio);
    };
    img.src = URL.createObjectURL(f);
    
    console.log('Image file selected:', f.name, f.type);
  }

  // Use refs instead of state here too
  function centerImageAtPostcode(postcode: string) {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || !imageBillboard || imageBillboard.type !== 'imagery') {
      alert('Please upload an image first to use postcode centering.');
      return;
    }

    const layer = imageBillboard.layer;
    const postcodeInput = document.querySelector('input[placeholder*="postcode"]') as HTMLInputElement;
    if (postcodeInput) postcodeInput.value = 'Searching...';

    const cleanPostcode = postcode.replace(/\s+/g, '').toUpperCase();
    const apiUrl = `https://api.postcodes.io/postcodes/${cleanPostcode}`;

    fetch(apiUrl)
      .then(r => (r.ok ? r.json() : r.text().then(t => { throw new Error(`HTTP ${r.status}: ${t}`); })))
      .then(data => {
        const { longitude, latitude } = data.result || {};
        if (typeof longitude !== 'number' || typeof latitude !== 'number') {
          throw new Error('Invalid response format from postcode API');
        }

        // Calculate the proper aspect ratio from the original image dimensions
        // Use a base width and calculate height to maintain proportions
        const baseWidth = 0.02; // Base width in degrees
        const aspectRatio = imageAspectRatio; // Use the stored aspect ratio
        const baseHeight = baseWidth / aspectRatio;
        
        // Create new rectangle centered on the postcode, with proper aspect ratio
        const newImageRect = Cesium.Rectangle.fromDegrees(
          longitude - baseWidth / 2,
          latitude - baseHeight / 2,
          longitude + baseWidth / 2,
          latitude + baseHeight / 2
        );

        // Swap provider by replacing the layer entirely
        const newProvider = new Cesium.SingleTileImageryProvider({
          url: imageBillboard.url,
          rectangle: newImageRect,
          tileWidth: 512,  // Required parameter
          tileHeight: 512  // Required parameter
        });

        viewer.imageryLayers.remove(layer);
        const newLayer = viewer.imageryLayers.addImageryProvider(newProvider);
        setImageBillboard({ type: 'imagery', layer: newLayer, url: imageBillboard.url });

        updatePositionControls(newImageRect);
        viewer.camera.flyTo({ destination: newImageRect, duration: 1.0 });

        if (postcodeInput) postcodeInput.value = postcode.toUpperCase();
        
        // Show resize handles after repositioning and update their positions
        setShowResizeHandles(true);
        setTimeout(() => updateHandlePositions(), 100);
      })
      .catch(error => {
        if (postcodeInput) postcodeInput.value = postcode;
        let msg = `Could not find postcode "${postcode}". `;
        if (String(error.message).includes('HTTP 404')) msg += 'Postcode not found.';
        else if (String(error.message).includes('HTTP 429')) msg += 'Too many requests—try again shortly.';
        else msg += `Error: ${error.message}`;
        alert(msg);
      });
  }

  function updatePositionControls(rect: any) {
    const westInput = document.querySelector('input[placeholder="West"]') as HTMLInputElement;
    const eastInput = document.querySelector('input[placeholder="East"]') as HTMLInputElement;
    const southInput = document.querySelector('input[placeholder="South"]') as HTMLInputElement;
    const northInput = document.querySelector('input[placeholder="North"]') as HTMLInputElement;

    if (westInput) westInput.value = rect.west.toFixed(6);
    if (eastInput) eastInput.value = rect.east.toFixed(6);
    if (southInput) southInput.value = rect.south.toFixed(6);
    if (northInput) northInput.value = rect.north.toFixed(6);
  }

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
                onKeyDown={(e) => { // CHANGED: onKeyDown is preferred over deprecated onKeyPress
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
            {imageBillboard && (
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
                    ? 'Drag yellow corners for uniform scaling, orange edges for non-uniform scaling'
                    : 'Click "Show Handles" to enable image resizing'
                  }
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Map */}
        <div className="col-span-8 xl:col-span-9 relative">
          {!imageFile ? (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
              <div className="text-center">
                <div className="text-6xl mb-4">🖼️</div>
                <h2 className="text-xl font-semibold text-gray-600 mb-2">Image Overlay Tool</h2>
                <p className="text-gray-500">Upload an image to overlay it on the map</p>
              </div>
            </div>
          ) : (
            <div ref={containerRef} className="w-full h-full" />
          )}
        </div>
      </div>
    </div>
  );
}