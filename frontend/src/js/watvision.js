import cv from "@techstark/opencv-js";
import axios from "axios";
import {
    HandLandmarker,
    FilesetResolver,
} from "@mediapipe/tasks-vision";
import { HAND_CONNECTIONS } from "@mediapipe/hands";

class WatVision {

    constructor() {
        this.vision = null;
        this.handLandmarker = null;
        this.initiating = false;

        this.inputImageMat = null;
        this.sourceImageMat = null;
        this.sourceImageBlob = null;

        this.sourceTextInfo = null;

        this.inputImageDebugMat = null;
        this.sourceImageDebugMat = null;

        this.sourceImageCaptured = false;
    }

    async initVision() {

        // this.vision = await FilesetResolver.forVisionTasks(
        //     "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
        // );

        // this.handLandmarker = await HandLandmarker.createFromOptions(this.vision, {
        //     baseOptions: {
        //         modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
        //         delegate: "GPU"
        //     },
        //     minHandPresenceConfidence: 0.01,
        //     minHandDetectionConfidence: 0.01,
        //     runningMode: "IMAGE",
        //     numHands: 1
        // });

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

    async captureSourceImage(inputImageElement) {
        let imgBlob = await this.getImageBlob(inputImageElement);

        const formData = new FormData();
        formData.append("source", imgBlob, "image.png");

        const response = await axios.post("/api/set_source_image/", formData, {
            headers: {
                "Content-Type": "multipart/form-data",
            },
        });

        if (response.data.success) {
            this.sourceImageCaptured = true;
        }

        return response.data;
    }

    async step(inputImageElement, debugInputImageElement, debugReferenceImageElement) {
        // Return null if things aren't ready

        let imgBlob = await this.getImageBlob(inputImageElement);

        const formData = new FormData();
        formData.append("image", imgBlob, "image.png");

        const response = await axios.post("/api/step/", formData, {
            headers: {
                "Content-Type": "multipart/form-data",
            },
        });

        if (response.data.success) {
            let inputImageData = response.data.data.input_image;
            let sourceImageData = response.data.data.source_image;

            debugInputImageElement.src = `data:image/png;base64,${inputImageData}`;
            debugReferenceImageElement.src = `data:image/png;base64,${sourceImageData}`;
        }

        return response.data;

        // Put mat 
        this.inputImageMat = cv.imread(inputImageElement);
        this.inputImageDebugMat = this.inputImageMat.clone();

        this.sourceImageDebugMat = this.sourceImageMat.clone();

        // Detect hands
        let handsInfo = this.detectHands(inputImageElement);

        // Align two images and get homography
        let homography = await this.compareFeatures(inputImageElement, this.sourceImageBlob);

        let [inputFingerTipLocation, sourceFingerTipLocation] = this.calculateFingerTipLocation(handsInfo, homography, this.inputImageMat);

        // Draw bounding box of source on input
        this.drawSourceOnInput(this.inputImageDebugMat, this.sourceImageDebugMat, homography);

        // Draw text data
        this.drawImageTextData(this.inputImageDebugMat, this.sourceImageDebugMat, this.sourceTextInfo, homography, inputFingerTipLocation, sourceFingerTipLocation);

        // Draw hands 
        this.drawHands(this.inputImageDebugMat, this.sourceImageDebugMat, handsInfo, sourceFingerTipLocation);

        // Draw mats on elements
        cv.imshow(debugInputImageElement, this.inputImageDebugMat);
        cv.imshow(debugReferenceImageElement, this.sourceImageDebugMat);
    }

    doesSourceImageExist() {
        return this.sourceImageCaptured;
    }

    detectHands(inputImageElement) {
        console.log("Detecting hands");
        const handLandmarkerResult = this.handLandmarker.detect(inputImageElement);
        return handLandmarkerResult;
    }

    drawSourceOnInput(inputDebugMat, sourceDebugMat, homography) {
        let { width, height } = sourceDebugMat.size();
        let cornerPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height]);
        let alignedCorners = new cv.Mat();
        cv.perspectiveTransform(cornerPts, alignedCorners, homography);
        // Convert alignedCorners to integer points
        let alignedCornersInt = new cv.Mat();
        alignedCorners.convertTo(alignedCornersInt, cv.CV_32SC2);
        // Create a MatVector and push the aligned corners
        let alignedCornersMatVector = new cv.MatVector();
        alignedCornersMatVector.push_back(alignedCornersInt);
        cv.polylines(inputDebugMat, alignedCornersMatVector, true, [0, 255, 0, 255], 2);

        alignedCorners.delete();
        alignedCornersInt.delete();
        alignedCornersMatVector.delete();
    }

    drawHands(inputDebugMat, sourceDebugMat, handLandmarkerResult, sourceFingerTipLocation) {
        if (handLandmarkerResult.landmarks.length > 0) {
            let src = inputDebugMat;

            handLandmarkerResult.landmarks.forEach((landmarks) => {
                for (let i = 0; i < landmarks.length; i++) {
                    let x = landmarks[i].x * src.cols;
                    let y = landmarks[i].y * src.rows;
                    let color = (i === 8) ? [255, 0, 0, 255] : [0, 0, 255, 255]; // Red for index finger tip, blue for others
                    cv.circle(src, new cv.Point(x, y), 5, color, -1);
                }

                HAND_CONNECTIONS.forEach(([startIdx, endIdx]) => {
                    let startX = landmarks[startIdx].x * src.cols;
                    let startY = landmarks[startIdx].y * src.rows;
                    let endX = landmarks[endIdx].x * src.cols;
                    let endY = landmarks[endIdx].y * src.rows;
                    cv.line(src, new cv.Point(startX, startY), new cv.Point(endX, endY), [0, 255, 0, 255], 2);
                });
            });

            if (sourceFingerTipLocation) {
                cv.circle(sourceDebugMat, new cv.Point(sourceFingerTipLocation.x, sourceFingerTipLocation.y), 5, [255, 0, 0, 255], -1);
            }
        }
    }

    async getImageBlob(inputElement) {
        let imgBlob;

        if (inputElement instanceof HTMLImageElement) {
            // Handle <img> element
            const imgSrcResponse = await fetch(inputElement.src);
            imgBlob = await imgSrcResponse.blob();
        } else if (inputElement instanceof HTMLCanvasElement) {
            // Handle <canvas> element
            imgBlob = await new Promise(resolve => {
                inputElement.toBlob(blob => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        throw new Error("Failed to create blob from canvas element.");
                    }
                }, "image/png");
            });
        } else {
            throw new Error("Input must be an image or canvas element.");
        }

        return imgBlob;
    }

    async compareFeatures(inputImageElement, sourceBlob) {

        let imgBlob = await this.getImageBlob(inputImageElement);

        const formData = new FormData();
        formData.append("input", imgBlob, "input.jpeg");
        formData.append("source", sourceBlob, "source.jpeg");

        const response = await axios.post("/api/get_homography/", formData, {
            headers: {
                "Content-Type": "multipart/form-data",
            },
        });

        let returnString = response.data;
        // Convert from string to JSON data
        let jsonData = JSON.parse(returnString.data);
        return cv.matFromArray(3, 3, cv.CV_32F, jsonData.flat());

        let img1, img2;

        let knnDistance_option = 0.7;

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
        let matches = new cv.DMatchVectorVector();
        let goodMatches = new cv.DMatchVector();
        bf.knnMatch(descriptors1, descriptors2, matches, 2);

        for (let i = 0; i < matches.size(); ++i) {
            let match = matches.get(i);
            let dMatch1 = match.get(0);
            let dMatch2 = match.get(1);
            if (dMatch1.distance <= dMatch2.distance * knnDistance_option) {
                goodMatches.push_back(dMatch1);
            }
        }

        console.log("Number of good matches: " + goodMatches.size());

        let matchesArray = [];
        for (let i = 0; i < goodMatches.size(); i++) {
            matchesArray.push(goodMatches.get(i));
        }

        matchesArray.sort((a, b) => a.distance - b.distance);

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

    async identifyImageTextData(inputElement) {
        let imgBlob = await this.getImageBlob(inputElement);

        const formData = new FormData();
        formData.append("image", imgBlob, "image.png");

        const response = await axios.post("/api/get_text_info/", formData, {
            headers: {
                "Content-Type": "multipart/form-data",
            },
        });

        return response.data;
    }

    drawImageTextData(inputSrc, compareSrc, imageTextData, homography, inputFingerTipLocation, sourceFingerTipLocation) {
        // Get original image size from imageTextData.readResults.width and height
        let { width, height } = imageTextData.readResults[0];

        // Get ratio of original image size to displayed image size
        let horizontal_ratio = compareSrc.cols / width;
        let vertical_ratio = compareSrc.rows / height;

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

                let boxColor = [0, 0, 255, 255]; // Default color

                // Check if sourceFingerTipLocation is inside the text box
                if (sourceFingerTipLocation) {
                    let { x, y } = sourceFingerTipLocation;
                    if (x >= x0 && x <= x2 && y >= y0 && y <= y2) {
                        boxColor = [0, 255, 0, 255]; // Change color if inside the box
                    }
                }

                cv.line(compareSrc, new cv.Point(x0, y0), new cv.Point(x1, y1), boxColor, 2);
                cv.line(compareSrc, new cv.Point(x1, y1), new cv.Point(x2, y2), boxColor, 2);
                cv.line(compareSrc, new cv.Point(x2, y2), new cv.Point(x3, y3), boxColor, 2);
                cv.line(compareSrc, new cv.Point(x3, y3), new cv.Point(x0, y0), boxColor, 2);

                boxColor = [0, 0, 255, 255]; // Reset color

                let boxPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [x0, y0, x1, y1, x2, y2, x3, y3]);
                let alignedBox = new cv.Mat();
                cv.perspectiveTransform(boxPoints, alignedBox, homography);

                // Convert alignedBox to integer points
                let alignedBoxInt = new cv.Mat();
                alignedBox.convertTo(alignedBoxInt, cv.CV_32SC2);

                // Create a MatVector and push the aligned corners
                let alignedBoxMatVector = new cv.MatVector();
                alignedBoxMatVector.push_back(alignedBoxInt);

                if (inputFingerTipLocation) {
                    let { x, y } = inputFingerTipLocation;
                    if (x >= alignedBox.data32F[0] && x <= alignedBox.data32F[4] && y >= alignedBox.data32F[1] && y <= alignedBox.data32F[5]) {
                        boxColor = [0, 255, 0, 255]; // Change color if inside the box
                    }
                }

                cv.polylines(inputSrc, alignedBoxMatVector, true, boxColor, 2);
            });
        });
    }

    calculateFingerTipLocation(handsInfo, homography, inputImageMat) {
        if (handsInfo.landmarks.length > 0) {
            let src = inputImageMat;

            let landmarks = handsInfo.landmarks[0];
            let x = landmarks[8].x * src.cols;
            let y = landmarks[8].y * src.rows;

            let homographyInv = new cv.Mat();
            cv.invert(homography, homographyInv);

            let srcPoint = new cv.matFromArray(1, 1, cv.CV_32FC2, [x, y]);
            let dstPoint = new cv.Mat();
            cv.perspectiveTransform(srcPoint, dstPoint, homographyInv);

            let [dstX, dstY] = dstPoint.data32F;

            return [{ x: x, y: y }, { x: dstX, y: dstY }];
        } else {
            return [null, null];
        }
    }
}

export default WatVision;