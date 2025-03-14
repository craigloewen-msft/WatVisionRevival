import cv from "@techstark/opencv-js";
import axios from "axios";
import {
    HandLandmarker,
    FilesetResolver,
} from "@mediapipe/tasks-vision";
import { HAND_CONNECTIONS } from "@mediapipe/hands";

import {
    drawConnectors, drawLandmarks
} from "@mediapipe/drawing_utils";

class WatVision {

    constructor() {
        this.vision = null;
        this.handLandmarker = null;
        this.initiating = false;
    }

    async initVision() {

        this.vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
        );

        this.handLandmarker = await HandLandmarker.createFromOptions(this.vision, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                delegate: "GPU"
            },
            minHandPresenceConfidence: 0.01,
            minHandDetectionConfidence: 0.01,
            runningMode: "IMAGE",
            numHands: 1
        });

        console.log("Done initializing vision");
        return true;
    }

    async init() {
        if (this.initiating) return false;

        this.initiating = true;

        let initVisionPromise = this.initVision();

        // aync wait for cv to be ready inline
        let initCVPromise = new Promise((resolve) => {
            cv["onRuntimeInitialized"] = () => {
                console.log("Open CV is ready setting variable");
                resolve();
            };
        });

        await Promise.all([initVisionPromise, initCVPromise]);

        return true;
    }

    async detectHands(inputImageElement) {
        console.log("Detecting hands");
        const handLandmarkerResult = this.handLandmarker.detect(inputImageElement);

        if (handLandmarkerResult.landmarks.length > 0) {
            let src = cv.imread(inputImageElement);

            handLandmarkerResult.landmarks.forEach((landmarks) => {
                for (let i = 0; i < landmarks.length; i++) {
                    let x = landmarks[i].x * src.cols;
                    let y = landmarks[i].y * src.rows;
                    cv.circle(src, new cv.Point(x, y), 5, [0, 0, 255, 255], -1);
                }

                HAND_CONNECTIONS.forEach(([startIdx, endIdx]) => {
                    let startX = landmarks[startIdx].x * src.cols;
                    let startY = landmarks[startIdx].y * src.rows;
                    let endX = landmarks[endIdx].x * src.cols;
                    let endY = landmarks[endIdx].y * src.rows;
                    cv.line(src, new cv.Point(startX, startY), new cv.Point(endX, endY), [0, 255, 0, 255], 2);
                });
            });

            cv.imshow(inputImageElement, src);
            src.delete();
        }

        return true;
    }

    compareFeatures(img1Element, img2Element, debugCanvasElement) {
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

    async identifyImageTextData(imageElement) {
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

    copyImage(srcElement, destElement) {
        const src = cv.imread(srcElement);
        cv.imshow(destElement, src);
        src.delete();
    }

    drawImageTextData(imageElement, imageTextData) {
        const src = cv.imread(imageElement);

        // Get original image size from imageTextData.readResults.width and height
        let { width, height } = imageTextData.readResults[0];

        // Get ratio of original image size to displayed image size
        let horizontal_ratio = src.cols / width;
        let vertical_ratio = src.rows / height;

        // If ratios are not within 5% of eachother show a warn
        if (Math.abs(horizontal_ratio - vertical_ratio) > 0.05) {
            console.warn("Image size ratios are not within 5% of each other");
        }

        imageTextData.readResults.forEach((readResult) => {
            readResult.lines.forEach((line) => {
                // boundingBox is an array
                let [x0, y0, x1, y1, x2, y2, x3, y3] = line.boundingBox;

                let scale = horizontal_ratio;
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
}

export default WatVision;