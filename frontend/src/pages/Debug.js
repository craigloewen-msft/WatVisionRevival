import React, { useEffect, useRef, useState } from "react";
import cv from "@techstark/opencv-js";
import axios from "axios";

function compareFeatures(img1Element, img2Element, debugCanvasElement) {
  if (!img1Element || !img2Element || !debugCanvasElement) return;

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

  // Sort matches by distance and only take top 10
  let topMatchesCount = 30;

  let matchesArray = [];
  for (let i = 0; i < matches.size(); i++) {
    matchesArray.push(matches.get(i));
  }

  matchesArray.sort((a, b) => a.distance - b.distance);
  for (let i = 0; i < topMatchesCount; i++) {
    goodMatches.push_back(matchesArray[i]);
  }

  // Get key points from good matches
  let srcPointsArray = [];
  let dstPointsArray = [];
  for (let i = 0; i < goodMatches.size(); i++) {
    srcPointsArray.push(keypoints1.get(goodMatches.get(i).queryIdx).pt.x);
    srcPointsArray.push(keypoints1.get(goodMatches.get(i).queryIdx).pt.y);
    dstPointsArray.push(keypoints2.get(goodMatches.get(i).trainIdx).pt.x);
    dstPointsArray.push(keypoints2.get(goodMatches.get(i).trainIdx).pt.y);
  }

  // Find homography
  let srcMat = cv.matFromArray(goodMatches.size(), 2, cv.CV_32F, srcPointsArray);
  let dstMat = cv.matFromArray(goodMatches.size(), 2, cv.CV_32F, dstPointsArray);
  let homography = cv.findHomography(dstMat, srcMat, cv.RANSAC, 5);

  let { width, height } = img2.size();
  let cornerPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height]);
  let alignedCorners = new cv.Mat();
  cv.perspectiveTransform(cornerPts, alignedCorners, homography);

  // Convert alignedCorners to integer points
  let alignedCornersInt = new cv.Mat();
  alignedCorners.convertTo(alignedCornersInt, cv.CV_32SC2);

  // Create a MatVector and push the aligned corners
  let alignedCornersMatVector = new cv.MatVector();
  alignedCornersMatVector.push_back(alignedCornersInt);
  cv.polylines(img1, alignedCornersMatVector, true, [0, 255, 0, 255], 2);

  cv.imshow(debugCanvasElement, img1);

  // let matchedImage = new cv.Mat();
  // cv.drawMatches(img1, keypoints1, img2Gray, keypoints2, goodMatches, matchedImage);
  // cv.imshow(debugCanvasElement, matchedImage);
  console.log("Done comparing features");

  // Cleanup
  img1Gray.delete();
  img2Gray.delete();
  keypoints1.delete();
  keypoints2.delete();
  descriptors1.delete();
  descriptors2.delete();
  matches.delete();
  goodMatches.delete();

  return homography;
}

async function identifyImageTextData(imageElement) {
  const imgSrcResponse = await fetch(imageElement.current.src);
  const imgBlob = await imgSrcResponse.blob();

  const formData = new FormData();
  formData.append("image", imgBlob, "image.png");

  const response = await axios.post("/api/vision/", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  return response.data;
}

function drawImageTextData(imageElement, imageTextData) {
  const src = cv.imread(imageElement);
  imageTextData.readResults.forEach((readResult) => {
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
  cv.imshow(imageElement, src); // Original image
  src.delete();
}

function Debug() {
  const imageRef = useRef(null);
  const compareRef = useRef(null);
  const debugImageRef = useRef(null);

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
      const currentImageElement = imageRef.current;
      const compareElement = compareRef.current;
      const debugImageElement = debugImageRef.current;
      if (!currentImageElement || !debugImageElement || !compareElement) return;


      try {
        // Compare features between the two 
        let homography = compareFeatures(currentImageElement, compareElement, debugImageElement);

        console.log("Calling API");
        const imageTextDataResponse = await identifyImageTextData(compareRef);

        if (!imageTextDataResponse.success) {
          throw new Error("API call failed: " + imageTextDataResponse.data.error);
        }

        console.log("Vision API response:", imageTextDataResponse.data);
        const imageTextData = imageTextDataResponse.data;

        setData("Success");

        drawImageTextData(debugImageElement, imageTextData);
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
          <img ref={imageRef} src="/walmart_touchscreen2.png" className="img-fluid" alt="Touchscreen" />
        </div>
        <div className="col-6">
          <img ref={compareRef} src="/walmart_touchscreen1.png" className="img-fluid" alt="Touchscreen" />
        </div>
      </div>
      <div className="row">
        <div className="col-6">
          <canvas ref={debugImageRef} />
        </div>
      </div>
    </div>
  );
}

export default Debug;
