import React, { useEffect, useRef, useState } from "react";
import WatVision from "../js/watvision";

function Debug() {
  const imageRef = useRef(null);
  const compareRef = useRef(null);
  const debugInputImageRef = useRef(null);
  const debugReferenceImageRef = useRef(null);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [watVision, setWatVision] = useState(null);

  useEffect(() => {
    async function initWatVision() {
      let watVision = new WatVision();
      let result = await watVision.init();
      setWatVision(watVision);
    }

    initWatVision();
  }, []);

  useEffect(() => {
    if (!watVision) {
      console.log("Vision not ready yet");
      return;
    } else {
      console.log("Vision ready now");
    }

    async function processImage() {
      const currentImageElement = imageRef.current;
      const compareElement = compareRef.current;
      const debugInputImageElement = debugInputImageRef.current;
      const debugReferenceImageElement = debugReferenceImageRef.current;
      if (!currentImageElement || !debugInputImageElement || !compareElement) return;

      try {
        // Compare features between the two 
        // watVision.detectHands(currentImageElement);

        await watVision.captureSourceImage(compareElement);

        watVision.step(currentImageElement, debugInputImageElement, debugReferenceImageElement);
      } catch (err) {
        console.error(err);
        setError(err);
      }

      setLoading(false);
    }

    const imgElement = imageRef.current;
    if (imgElement.complete) {
      processImage();
    } else {
      imgElement.onload = processImage;
    }
  }, [watVision]);

  return (
    <div className="container">
      {/* Load image from the public directory */}
      <h3>Debug page</h3>
      <div className="row">
        <div>
          {loading ? (
            <p>Loading...</p>
          ) : error ? (
            <p>Error: {error.message}</p>
          ) : (
            <pre>{JSON.stringify(data, null, 2)}</pre>
          )}
        </div>
      </div>
      <div className="row">
        <div className="col-6">
          <h3>Input image</h3>
          <img ref={imageRef} src="/screen_test_compare.jpg" className="img-fluid" alt="Touchscreen" />
        </div>
        <div className="col-6">
          <h3>Source reference image</h3>
          <img ref={compareRef} src="/screen_test_source.jpg" className="img-fluid" alt="Touchscreen" />
        </div>
      </div>
      <div className="row">
        <div className="col-6">
          <h3>Debug input image</h3>
          <canvas ref={debugInputImageRef} />
        </div>
        <div className="col-6">
          <h3>Debug source image</h3>
          <canvas ref={debugReferenceImageRef} />
        </div>
      </div>
    </div>
  );
}

export default Debug;
