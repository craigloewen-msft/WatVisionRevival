import React, { useEffect, useRef, useState } from "react";
import cv from "@techstark/opencv-js";
import axios from "axios";

function compareFeatures(img1Element, img2Element, outputCanvasElement) {
  if (!img1Element || !img2Element || !outputCanvasElement) return;

  console.log("Starting compare features");

  // Read images into OpenCV Mat
  let img1 = cv.imread(img1Element);
  let img2 = cv.imread(img2Element);

  // Convert to grayscale for feature detection
  let img1Gray = new cv.Mat();
  let img2Gray = new cv.Mat();
  cv.cvtColor(img1, img1Gray, cv.COLOR_RGBA2GRAY);
  cv.cvtColor(img2, img2Gray, cv.COLOR_RGBA2GRAY);

  // Detect ORB keypoints and descriptors
  let orb = new cv.ORB();
  let keypoints1 = new cv.KeyPointVector();
  let keypoints2 = new cv.KeyPointVector();
  let descriptors1 = new cv.Mat();
  let descriptors2 = new cv.Mat();

  orb.detectAndCompute(img1Gray, new cv.Mat(), keypoints1, descriptors1);
  orb.detectAndCompute(img2Gray, new cv.Mat(), keypoints2, descriptors2);

  // Match descriptors using BFMatcher with Hamming distance
  let bf = new cv.BFMatcher();
  let matches = new cv.DMatchVector();
  bf.match(descriptors1, descriptors2, matches);

  // Extract matched keypoints
  let goodMatches = new cv.DMatchVector();

  let outImg = new cv.Mat();
  cv.drawMatches(img1Gray, keypoints1, img2Gray, keypoints2, matches, outImg);
  cv.imshow(outputCanvasElement, outImg);

  console.log("Done comparing features");

  // Cleanup
  img1.delete();
  img2.delete();
  img1Gray.delete();
  img2Gray.delete();
  keypoints1.delete();
  keypoints2.delete();
  descriptors1.delete();
  descriptors2.delete();
  matches.delete();
  goodMatches.delete();
  // srcMat.delete();
  // dstMat.delete();
  // homography.delete();
  // alignedImg2.delete();
  // blended.delete();
}


function Debug() {
  const imageRef = useRef(null);
  const canvasRef = useRef(null);

  const compareRef = useRef(null);
  const finalComparisonRef = useRef(null);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [cvReady, setCvReady] = useState(false);

  useEffect(() => {
    cv['onRuntimeInitialized'] = () => {
      console.log("Open CV is ready setting variable");
      setCvReady(true);
    };
  }, []);


  useEffect(() => {
    if (!cvReady) {
      console.log("Open CV not ready yet");
      return;
    } else {
      console.log("Open CV is ready now");
    }

    async function processImage() {
      const imgElement = imageRef.current;
      const canvasElement = canvasRef.current;
      const compareElement = compareRef.current;
      if (!imgElement || !canvasElement || !compareElement) return;

      compareFeatures(imgElement, compareElement, finalComparisonRef.current);

      const imgSrcResponse = await fetch(imageRef.current.src);
      const imgBlob = await imgSrcResponse.blob();

      const formData = new FormData();
      formData.append("image", imgBlob, "image.png");

      const src = cv.imread(imgElement);

      try {
        console.log("Calling API");
        const response = await axios.post("/api/vision/", formData, {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });
        console.log("Vision API response:", response.data);

        if (!response.data.success) {
          throw new Error("API call failed: " + response.data.error);
        }

        setData("Success");

        response.data.result.readResults.forEach((readResult) => {
          readResult.lines.forEach((line) => {
            // boundingBox is an array
            let [x0, y0, x1, y1, x2, y2, x3, y3] = line.boundingBox;

            let scale = 0.288;
            x0 = x0 * scale;
            y0 = y0 * scale;
            x1 = x1 * scale;
            y1 = y1 * scale;
            x2 = x2 * scale;
            y2 = y2 * scale;
            x3 = x3 * scale;
            y3 = y3 * scale;

            cv.line(src, new cv.Point(x0, y0), new cv.Point(x1, y1), [255, 0, 0, 255], 2);
            cv.line(src, new cv.Point(x1, y1), new cv.Point(x2, y2), [255, 0, 0, 255], 2);
            cv.line(src, new cv.Point(x2, y2), new cv.Point(x3, y3), [255, 0, 0, 255], 2);
            cv.line(src, new cv.Point(x3, y3), new cv.Point(x0, y0), [255, 0, 0, 255], 2);

          });
        });

        // ret.data.blocks.forEach(block => {
        //   const { x0, y0, x1, y1 } = block.bbox;
        //   cv.rectangle(src, new cv.Point(x0, y0), new cv.Point(x1, y1), [255, 0, 0, 255], 2);
        // });

        // Show results
        cv.imshow(canvasElement, src); // Original image

      } catch (err) {
        console.error("Error calling Vision API:", err);
        setError(err);
      }

      setLoading(false);

      // Cleanup
      src.delete();
    }

    const imgElement = imageRef.current;
    if (imgElement.complete) {
      processImage();
    } else {
      imgElement.onload = processImage;
    }
  }, [cvReady]);

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
          <img ref={imageRef} src="/walmart_touchscreen1.png" className="img-fluid" alt="Touchscreen" />
          <canvas ref={canvasRef} />
        </div>
        <div className="col-6">
          <img ref={compareRef} src="/walmart_touchscreen_rotated.png" className="img-fluid" alt="Touchscreen" />
        </div>
      </div>
      <div className="row">
        <canvas ref={finalComparisonRef} />
      </div>
    </div>
  );
}

export default Debug;
