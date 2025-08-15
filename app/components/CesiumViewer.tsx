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

            {/* Size Control */}
            <div className="mb-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Image Size (degrees)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  placeholder="Width"
                  step="0.001"
                  min="0.001"
                  max="1.0"
                  defaultValue="0.02"
                  onChange={(e) => {
                    const value = parseFloat(e.target.value);
                    if (!isNaN(value) && value > 0) {
                      window.imageSize = { width: value, height: value };
                    }
                  }}
                  className="px-2 py-1 border border-gray-300 rounded text-xs"
                />
                <input
                  type="number"
                  placeholder="Height"
                  step="0.001"
                  min="0.001"
                  max="1.0"
                  defaultValue="0.02"
                  onChange={(e) => {
                    const value = parseFloat(e.target.value);
                    if (!isNaN(value) && value > 0) {
                      if (!window.imageSize) window.imageSize = { width: 0.02, height: 0.02 };
                      window.imageSize.height = value;
                    }
                  }}
                  className="px-2 py-1 border border-gray-300 rounded text-xs"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Set the size of the image rectangle when centering on a postcode
              </p>
            </div>

            <p className="text-xs text-gray-500 mt-1">
              Enter a UK postcode and press Enter or click Center to position the image
            </p>
            <div className="mt-2 text-xs text-gray-400">
              <p className="font-medium">Example postcodes:</p>
              <p>SW1A 1AA (Buckingham Palace), M1 1AA (Manchester), B1 1AA (Birmingham)</p>
            </div>
          </div>

          {/* Image Controls */}
          {imageBillboard && (
            <div className="space-y-4 border-t pt-4">
              <h2 className="font-medium">Image Controls</h2>

              <div className="space-y-3">
                {imageBillboard.type === 'imagery' ? (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Position & Size (Degrees)</label>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <label className="block text-gray-500">West</label>
                        <input
                          type="number"
                          step="0.001"
                          defaultValue="-0.01"
                          onChange={(e) => {
                            const value = parseFloat(e.target.value);
                            if (!isNaN(value) && imageBillboard.layer && cesiumRef.current) {
                              const currentRect = imageBillboard.layer.rectangle;
                              const newRect = cesiumRef.current.Rectangle.fromDegrees(
                                value, currentRect.south, currentRect.east, currentRect.north
                              );
                              imageBillboard.layer.rectangle = newRect;
                            }
                          }}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">East</label>
                        <input
                          type="number"
                          step="0.001"
                          defaultValue="0.01"
                          onChange={(e) => {
                            const value = parseFloat(e.target.value);
                            if (!isNaN(value) && imageBillboard.layer && cesiumRef.current) {
                              const currentRect = imageBillboard.layer.rectangle;
                              const newRect = cesiumRef.current.Rectangle.fromDegrees(
                                currentRect.west, currentRect.south, value, currentRect.north
                              );
                              imageBillboard.layer.rectangle = newRect;
                            }
                          }}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">South</label>
                        <input
                          type="number"
                          step="0.001"
                          defaultValue="-0.01"
                          onChange={(e) => {
                            const value = parseFloat(e.target.value);
                            if (!isNaN(value) && imageBillboard.layer && cesiumRef.current) {
                              const currentRect = imageBillboard.layer.rectangle;
                              const newRect = cesiumRef.current.Rectangle.fromDegrees(
                                currentRect.west, value, currentRect.east, currentRect.north
                              );
                              imageBillboard.layer.rectangle = newRect;
                            }
                          }}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">North</label>
                        <input
                          type="number"
                          step="0.001"
                          defaultValue="0.01"
                          onChange={(e) => {
                            const value = parseFloat(e.target.value);
                            if (!isNaN(value) && imageBillboard.layer && cesiumRef.current) {
                              const currentRect = imageBillboard.layer.rectangle;
                              const newRect = cesiumRef.current.Rectangle.fromDegrees(
                                currentRect.west, currentRect.south, currentRect.east, value
                              );
                              imageBillboard.layer.rectangle = newRect;
                            }
                          }}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Size (meters)</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        placeholder="Width"
                        step="10"
                        min="10"
                        defaultValue="1000"
                        onChange={(e) => {
                          const value = parseFloat(e.target.value);
                          if (!isNaN(value) && imageBillboard.entity?.billboard && cesiumRef.current) {
                            imageBillboard.entity.billboard.width = new cesiumRef.current.ConstantProperty(value);
                          }
                        }}
                        className="px-2 py-1 border border-gray-300 rounded text-xs"
                      />
                      <input
                        type="number"
                        placeholder="Height"
                        step="10"
                        min="10"
                        defaultValue="1000"
                        onChange={(e) => {
                          const value = parseFloat(e.target.value);
                          if (!isNaN(value) && imageBillboard.entity?.billboard && cesiumRef.current) {
                            imageBillboard.entity.billboard.height = new cesiumRef.current.ConstantProperty(value);
                          }
                        }}
                        className="px-2 py-1 border border-gray-300 rounded text-xs"
                      />
                    </div>
                  </div>
                )}

                <button
                  onClick={() => {
                    const v = viewerRef.current;
                    if (!v) return;
                    if (imageBillboard?.type === 'imagery') {
                      v.imageryLayers.remove(imageBillboard.layer);
                    } else if (imageBillboard?.type === 'billboard') {
                      v.entities.remove(imageBillboard.entity);
                    }
                    setImageBillboard(null);
                    if (imageUrlRef.current) {
                      URL.revokeObjectURL(imageUrlRef.current);
                      imageUrlRef.current = null;
                    }
                  }}
                  className="w-full px-3 py-2 bg-red-600 text-white rounded-md text-sm hover:bg-red-700"
                >
                  Remove Image
                </button>
              </div>
            </div>
          )}
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