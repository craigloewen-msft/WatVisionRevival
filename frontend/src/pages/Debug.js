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

  const [visionReady, setVisionReady] = useState(false);

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
        let homography = watVision.compareFeatures(currentImageElement, compareElement, debugInputImageElement);

        console.log("Calling API");
        const imageTextDataResponse = await watVision.identifyImageTextData(compareRef);

        if (!imageTextDataResponse.success) {
          throw new Error("API call failed: " + imageTextDataResponse.data.error);
        }

        console.log("Vision API response:", imageTextDataResponse.data);
        const imageTextData = imageTextDataResponse.data;

        setData("Success");

        watVision.copyImage(compareElement, debugReferenceImageElement);
        watVision.drawImageTextData(debugReferenceImageElement, imageTextData);
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

  const handleButtonClick = () => {
    const imgElement = imageRef.current;
    if (imgElement) {
      watVision.detectHands(imgElement);
    }
  };

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
          <img ref={imageRef} onClick={handleButtonClick} src="/walmart_touchscreen2.png" className="img-fluid" alt="Touchscreen" />
        </div>
        <div className="col-6">
          <h3>Source reference image</h3>
          <img ref={compareRef} src="/walmart_touchscreen1.png" className="img-fluid" alt="Touchscreen" />
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
