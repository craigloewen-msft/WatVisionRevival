<template>
  <div>
    <div class="container">
      <video muted playsinline autoplay class="input_video videoContainer"></video>
      <div>Render Canvas:</div>
      <div class="canvasContainer">
        <canvas ref="rendercanvas" class="output_canvas" style="border:3px solid;"></canvas>
      </div>
      <div>Screen render: </div>
      <div class="canvasContainer">
        <canvas ref="screenrendercanvas" class="output_canvas" style="border:3px solid;"></canvas>
      </div>
      <div class="canvasContainer">
        <canvas id="videocanvas" ref="videocanvas" class="output_canvas" style="border:3px solid;"></canvas>
      </div>
      <div>Screen base: </div>
      <div class="canvasContainer">
        <canvas id="screencanvas" ref="screencanvas" class="output_canvas" style="border:3px solid;"></canvas>
      </div>
      <div class="bottomControls">
        <button v-on:click="getNewBaseScreenImage(this.lastSeenInputImage)">Snap new screen</button>
      </div>
      <div>{{ OCRStatus }}</div>
      <div>Select progress: {{ selectProgress }}</div>
      <div>{{ selectStatus }}</div>
      <div>
        <div class="canvasContainer">
          <canvas ref="matchresultcanvas" class="output_canvas" id="matchresultcanvas"
            style="border:3px solid;"></canvas>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import Hands from "@mediapipe/hands"
import Camera from "@mediapipe/camera_utils"
import DrawUtils from "@mediapipe/drawing_utils"
import { createWorker } from 'tesseract.js';
import imageFunctions from "../imageFunctions.js";

export default {
  data: function () {
    return {
      renderCanvasCtx: null,
      renderCanvasElement: null,
      videoCanvasElement: null,
      canvasCtx: null,
      screenCanvasElement: null,
      screenCanvasCtx: null,
      screenBaseImg: null,
      screenBaseImgWidth: 1280,
      screenBaseImgHeight: 720,
      screenBaseImgLoaded: false,
      lastSeenInputImage: null,
      OCRLinesData: null,
      OCRStatus: "Not Started",
      lineConfidenceThreshold: 10,
      selectProgress: 0,
      selectProgressSpeed: 0.40,
      selectStatus: "Not selected",
      lastSelectedText: "",
      lastSeenInputImageData: null,
      screenBaseImgData: null,
      screenRenderCanvasCtx: null,
      screenRenderCanvasElement: null,
      baseScreenImgStitchedCanvasElement: null,
      baseScreenImgStitchedCanvasCtx: null,
      maxScreenDimension: 600,
      processPeriodms: 1000,
      nextProcessms: 0,
      baseScreenLoaded: false,
    }
  },
  methods: {
    getFingerTipPosition(handResults) {
      let highestFingerTip = null;

      // Check if we detected any hands.
      if (handResults.multiHandLandmarks.length > 0) {

        // Get the first hand seen:
        const handLandmarks = handResults.multiHandLandmarks[0];

        const fingerTipLandmarks = [
          handLandmarks[4],
          handLandmarks[8],
          handLandmarks[12],
          handLandmarks[16],
          handLandmarks[20],
        ];

        // Find the highest finger tip:
        highestFingerTip = fingerTipLandmarks.reduce((highest, current) => {
          if (current.y < highest.y) {
            return current;
          } else {
            return highest;
          }
        }, fingerTipLandmarks[0]);

      }

      if (highestFingerTip) {
        let fingerTipToScreenCoords = {};
        fingerTipToScreenCoords.x = highestFingerTip.x * this.screenCanvasElement.width;
        fingerTipToScreenCoords.y = highestFingerTip.y * this.screenCanvasElement.height;

        return fingerTipToScreenCoords;
      } else {
        return null;
      }
    },
    mapFingerTipPositionToBaseImage(inFingerTipPosition) {
      if (this.homographyMat && inFingerTipPosition) {
        let returnPoint = imageFunctions.perspectiveTransformWithMat(inFingerTipPosition, this.homographyMat);
        return returnPoint;
      } else {
        return inFingerTipPosition;
      }
    },
    mapPositionsToBaseScreen() {

      // For each bounding box put the points into an array
      if (this.OCRLinesData && this.inverseHomographyMat) {
        let points = [];
        for (let i = 0; i < this.OCRLinesData.length; i++) {
          let line = this.OCRLinesData[i];
          points.push({ x: line.bbox.x0, y: line.bbox.y0 });
          points.push({ x: line.bbox.x1, y: line.bbox.y1 });
        }


        // For each point in the array change it from a percent to a pixel value
        for (let i = 0; i < points.length; i++) {
          points[i].x = points[i].x * this.lastSeenInputImageData.width;
          points[i].y = points[i].y * this.lastSeenInputImageData.height;
        }

        let mappedOCRPoints = imageFunctions.perspectiveTransformArrayWithMat(points, this.inverseHomographyMat);

        let returnLines = [];

        // For each bounding box put the points into an array
        for (let i = 0; i < this.OCRLinesData.length; i++) {
          let returnLine = { bbox: {}, confidence: this.OCRLinesData[i].confidence, text: this.OCRLinesData[i].text};
          returnLine.bbox.x0 = mappedOCRPoints[i * 2].x;
          returnLine.bbox.y0 = mappedOCRPoints[i * 2].y;
          returnLine.bbox.x1 = mappedOCRPoints[i * 2 + 1].x;
          returnLine.bbox.y1 = mappedOCRPoints[i * 2 + 1].y;

          returnLines.push(returnLine);
        }

        this.mappedOCRBoxes = returnLines;
      }

      // Map the current image corners to the base screen image
      if (this.lastSeenInputImageData && this.homographyMat) {
        let points = [];
        points.push({ x: 0, y: 0 });
        points.push({ x: this.lastSeenInputImageData.width, y: 0 });
        points.push({ x: this.lastSeenInputImageData.width, y: this.lastSeenInputImageData.height });
        points.push({ x: 0, y: this.lastSeenInputImageData.height });

        let mappedPoints = imageFunctions.perspectiveTransformArrayWithMat(points, this.homographyMat);

        this.mappedInputImageCorners = mappedPoints;
      }

      this.fingerTipPosition = this.mapFingerTipPositionToBaseImage(this.fingerTipPositionUnmapped);
    },
    fingerTipSelectionHandler() {
      // If the finger tip is not null 
      if (this.fingerTipPosition && this.mappedOCRBoxes) {

        // Check if the finger tip is hovering over any of the OCR lines
        for (let i = 0; i < this.OCRLinesData.length; i++) {
          const line = this.mappedOCRBoxes[i];
          let isHovering = this.fingerTipPosition.x < line.bbox.x1 && this.fingerTipPosition.x > line.bbox.x0 && this.fingerTipPosition.y < line.bbox.y1 && this.fingerTipPosition.y > line.bbox.y0;
          if (isHovering) {
            this.selectProgress += this.selectProgressSpeed;
            if (this.selectProgress > 1) {
              this.selectProgress = 0;
              this.selectStatus = "Selected! " + line.text;
              if ('speechSynthesis' in window) {
                if (this.lastSelectedText != line.text) {
                  this.lastSelectedText = line.text;
                  let utterance = new SpeechSynthesisUtterance(line.text);
                  speechSynthesis.speak(utterance);
                }
              }
            }
            return;
          }
        }
      }

      this.selectProgress = 0;
    },
    async getNewBaseScreenImage(inputImage) {

      console.log("Getting new screen base image");
      console.log(inputImage);

      let newImgSave = inputImage.toDataURL();
      this.screenBaseImg = new Image();
      this.screenBaseImg.src = newImgSave;
      this.screenBaseImg.onload = function () {
        this.screenBaseImgLoaded = true;

        // Draw the image to the screen canvas
        this.screenCanvasCtx.drawImage(this.screenBaseImg, 0, 0, this.screenCanvasElement.width, this.screenCanvasElement.height);
        this.baseScreenImgStitchedCanvasElement.getContext('2d').drawImage(this.screenBaseImg, 0, 0, this.screenCanvasElement.width, this.screenCanvasElement.height);

        // Get the image data
        this.screenBaseImgData = this.screenCanvasCtx.getImageData(0, 0, this.screenCanvasElement.width, this.screenCanvasElement.height);
        this.baseScreenLoaded = true;
      }.bind(this);

      let updateStatusFunction = function (logger) {
        this.OCRStatus = logger.status;
      }.bind(this);

      this.OCRLinesData = null;

      // Get OCR of new base screen image
      const worker = createWorker({
        logger: updateStatusFunction
      });

      let recognizeFunction = async function () {
        await worker.load();
        await worker.loadLanguage('eng');
        await worker.initialize('eng');
        // await worker.setParameters({
        //   tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
        // });
        const dataResult = await worker.recognize(newImgSave);
        this.OCRLinesData = dataResult.data.lines;
        this.OCRStatus = "Done";
        await worker.terminate();
      }.bind(this);

      await recognizeFunction();

      // Filter out any low confidence lines
      this.OCRLinesData = this.OCRLinesData.filter((line) => {
        return line.confidence > this.lineConfidenceThreshold;
      });

      // Convert OCRLinesData bbox to percents instead of pixels
      this.OCRLinesData.forEach((line) => {
        line.bbox.x0 = line.bbox.x0 / inputImage.width;
        line.bbox.x1 = line.bbox.x1 / inputImage.width;
        line.bbox.y0 = line.bbox.y0 / inputImage.height;
        line.bbox.y1 = line.bbox.y1 / inputImage.height;
      })

    },
    match(inFixedImage, inMovingImage) {
      // Get ImageData from Image
      try {
        let [resultImage, homographyMat, inverseHomographyMat] = imageFunctions.alignTwoImages(inMovingImage, inFixedImage);

        this.homographyMat = homographyMat;
        this.inverseHomographyMat = inverseHomographyMat;

        // cv.imshow('matchresultcanvas', resultImage);

      } catch (error) {
        console.log("Error");
        console.log(error);
      }
    },
    mapScreenLocationOntoFrame: function (handResults) {
      // Get image of new screen:
      let newScreenImg = handResults.image;

      // If there is no base image set it
      if (this.screenBaseImg == null && newScreenImg) {
        this.getNewBaseScreenImage(newScreenImg);
      }

      if (this.screenBaseImg && this.baseScreenLoaded) {
        this.match(this.lastSeenInputImageData, this.screenBaseImgData);
      }
    },
    renderImages: function (handResults) {

      let canvasToRenderCtx = this.renderCanvasCtx;
      let canvasToRenderElement = this.renderCanvasElement;

      // Render the video feed
      this.videoCanvasCtx.save();
      this.videoCanvasCtx.clearRect(0, 0, this.videoCanvasElement.width, this.videoCanvasElement.height);
      this.videoCanvasCtx.drawImage(handResults.image, 0, 0, this.videoCanvasElement.width, this.videoCanvasElement.height);

      // Render the render canvas
      canvasToRenderCtx.save();
      canvasToRenderCtx.clearRect(0, 0, canvasToRenderElement.width, canvasToRenderElement.height);
      canvasToRenderCtx.drawImage(
        handResults.image, 0, 0, canvasToRenderElement.width, canvasToRenderElement.height);
      if (handResults.multiHandLandmarks) {
        for (const landmarks of handResults.multiHandLandmarks) {
          DrawUtils.drawConnectors(canvasToRenderCtx, landmarks, Hands.HAND_CONNECTIONS,
            { color: '#00FF00', lineWidth: 5 });
          DrawUtils.drawLandmarks(canvasToRenderCtx, landmarks, { color: '#FF0000', lineWidth: 2 });
        }
        // If we have a finger tip position, draw a circle on it
        if (this.fingerTipPosition) {
          canvasToRenderCtx.beginPath();
          canvasToRenderCtx.arc(this.fingerTipPosition.x * canvasToRenderElement.width, this.fingerTipPosition.y * canvasToRenderElement.height, 10, 0, 2 * Math.PI);
          canvasToRenderCtx.stroke();
        }
      }

      // Render the screen render canvas
      let screenCanvasCtxToRender = this.screenRenderCanvasCtx;
      let screenCanvasElementToRender = this.screenRenderCanvasElement;

      screenCanvasCtxToRender.save();
      screenCanvasCtxToRender.clearRect(0, 0, screenCanvasElementToRender.width, screenCanvasElementToRender.height);
      if (this.screenBaseImgLoaded) {
        // screenCanvasCtxToRender.drawImage(this.screenBaseImg, 0, 0, screenCanvasElementToRender.width, screenCanvasElementToRender.height);
        screenCanvasCtxToRender.drawImage(this.screenBaseImg, 0, 0, screenCanvasElementToRender.width, screenCanvasElementToRender.height);
      }
      // If we have a finger tip position, draw a circle on it
      if (this.fingerTipPosition) {
        this.renderCanvasCtx.beginPath();
        this.renderCanvasCtx.arc(this.fingerTipPositionUnmapped.x, this.fingerTipPositionUnmapped.y, 10, 0, 2 * Math.PI);
        this.renderCanvasCtx.stroke();
        if (this.selectProgress > 0) {
          screenCanvasCtxToRender.strokeStyle = "#FFFFFF";
          screenCanvasCtxToRender.beginPath();
          screenCanvasCtxToRender.arc(this.fingerTipPosition.x, this.fingerTipPosition.y, 10, 0, 2 * Math.PI);
          screenCanvasCtxToRender.stroke();
          // Fill in the circle based on the progress
          screenCanvasCtxToRender.strokeStyle = "#00FF00";
          screenCanvasCtxToRender.beginPath();
          screenCanvasCtxToRender.arc(this.fingerTipPosition.x, this.fingerTipPosition.y, 10, 0, 2 * Math.PI * this.selectProgress);
          screenCanvasCtxToRender.stroke();

          // Repeat above for canvasToRenderCtx
          canvasToRenderCtx.strokeStyle = "#FFFFFF";
          canvasToRenderCtx.beginPath();
          canvasToRenderCtx.arc(this.fingerTipPositionUnmapped.x, this.fingerTipPositionUnmapped.y, 10, 0, 2 * Math.PI);
          canvasToRenderCtx.stroke();
          // Fill in the circle based on the progress
          canvasToRenderCtx.strokeStyle = "#00FF00";
          canvasToRenderCtx.beginPath();
          canvasToRenderCtx.arc(this.fingerTipPositionUnmapped.x, this.fingerTipPositionUnmapped.y, 10, 0, 2 * Math.PI * this.selectProgress);
          canvasToRenderCtx.stroke();
        } else {
          screenCanvasCtxToRender.beginPath();
          screenCanvasCtxToRender.arc(this.fingerTipPosition.x, this.fingerTipPosition.y, 10, 0, 2 * Math.PI);
          screenCanvasCtxToRender.stroke();

          // Repeat above for canvasToRenderCtx
          canvasToRenderCtx.beginPath();
          canvasToRenderCtx.arc(this.fingerTipPositionUnmapped.x, this.fingerTipPositionUnmapped.y, 10, 0, 2 * Math.PI);
          canvasToRenderCtx.stroke();
        }
      }
      // If we have line data draw the bounding boxes
      if (this.OCRLinesData) {
        this.OCRLinesData.forEach((line) => {
          screenCanvasCtxToRender.beginPath();
          let confidence = line.confidence;

          // Set the stroke color from red to green based on confidence
          let red = Math.floor(255.0 * (100 - confidence) / 100.0);
          let green = Math.floor(255.0 * confidence / 100.0);
          screenCanvasCtxToRender.strokeStyle = `rgb(${red},${green},0)`;

          screenCanvasCtxToRender.rect(line.bbox.x0 * screenCanvasElementToRender.width, line.bbox.y0 * screenCanvasElementToRender.height, (line.bbox.x1 - line.bbox.x0) * screenCanvasElementToRender.width, (line.bbox.y1 - line.bbox.y0) * screenCanvasElementToRender.height);
          screenCanvasCtxToRender.stroke();
        })
      }
      // If we have the mapped line data draw the bounding boxes
      if (this.mappedOCRBoxes) {
        this.mappedOCRBoxes.forEach((line) => {
          canvasToRenderCtx.beginPath();
          let confidence = line.confidence;

          // Set the stroke color from red to green based on confidence
          let red = Math.floor(255.0 * (100 - confidence) / 100.0);
          let green = Math.floor(255.0 * confidence / 100.0);
          canvasToRenderCtx.strokeStyle = `rgb(${red},${green},0)`;

          canvasToRenderCtx.rect(line.bbox.x0, line.bbox.y0, (line.bbox.x1 - line.bbox.x0), (line.bbox.y1 - line.bbox.y0));
          canvasToRenderCtx.stroke();
        })
      }

      // If we have screen corner data draw the corners of the new screen to the base screen
      if (this.mappedInputImageCorners) {
        screenCanvasCtxToRender.strokeStyle = "#FF0000";
        screenCanvasCtxToRender.beginPath();
        screenCanvasCtxToRender.moveTo(this.mappedInputImageCorners[0].x, this.mappedInputImageCorners[0].y);
        screenCanvasCtxToRender.lineTo(this.mappedInputImageCorners[1].x, this.mappedInputImageCorners[1].y);
        screenCanvasCtxToRender.lineTo(this.mappedInputImageCorners[2].x, this.mappedInputImageCorners[2].y);
        screenCanvasCtxToRender.lineTo(this.mappedInputImageCorners[3].x, this.mappedInputImageCorners[3].y);
        screenCanvasCtxToRender.lineTo(this.mappedInputImageCorners[0].x, this.mappedInputImageCorners[0].y);
        screenCanvasCtxToRender.stroke();
      }

      screenCanvasCtxToRender.restore();
      canvasToRenderCtx.restore();
    },
    cameraProcessLoop: function (handResults) {

      let currentms = Date.now()

      if (this.nextProcessms < currentms) {
        this.nextProcessms = currentms + this.processPeriodms;

        if (this.screenWidth == null && handResults.image) {
          this.setScreenWidthandHeight(handResults.image.width, handResults.image.height);
        }

        // Set last seen input image
        this.lastSeenInputImage = handResults.image;

        // Get lastSeenInputImageData
        this.lastSeenInputImageData = this.videoCanvasCtx.getImageData(0, 0, this.videoCanvasElement.width, this.videoCanvasElement.height);

        // Map new frame onto identified screen
        this.mapScreenLocationOntoFrame(handResults);

        // Get finger tip position
        this.fingerTipPositionUnmapped = this.getFingerTipPosition(handResults);

        // Map positions to base screen
        this.mapPositionsToBaseScreen();

        // Handle finger tip selection
        this.fingerTipSelectionHandler();

        // Render any images
        this.renderImages(handResults);

      } else {
      }
    },
    setScreenWidthandHeight: function (width, height) {

      let screenAspectRatio = width / height;
      let screenAdjustMult = 1.0;

      if (screenAspectRatio > 1) {
        screenAdjustMult = this.maxScreenDimension / width;
      } else {
        screenAdjustMult = this.maxScreenDimension / height;
      }

      this.screenWidth = Math.round(width * screenAdjustMult);
      this.screenHeight = Math.round(height * screenAdjustMult);

      this.videoCanvasElement.width = this.screenWidth;
      this.videoCanvasElement.height = this.screenHeight;

      this.renderCanvasElement.width = this.screenWidth;
      this.renderCanvasElement.height = this.screenHeight;

      this.screenRenderCanvasElement.width = this.screenWidth;
      this.screenRenderCanvasElement.height = this.screenHeight;

      this.baseScreenImgStitchedCanvasElement.width = this.screenWidth;
      this.baseScreenImgStitchedCanvasElement.height = this.screenHeight;

      this.screenCanvasElement.width = this.screenWidth;
      this.screenCanvasElement.height = this.screenHeight;
    },
    startCameraProcessing: function () {

      const videoElement = document.getElementsByClassName('input_video')[0];
      this.videoCanvasElement = this.$refs.videocanvas;
      this.videoCanvasCtx = this.videoCanvasElement.getContext('2d', { willReadFrequently: true });

      this.renderCanvasElement = this.$refs.rendercanvas;
      this.renderCanvasCtx = this.renderCanvasElement.getContext('2d', { willReadFrequently: true });

      this.screenRenderCanvasCtx = this.$refs.screenrendercanvas.getContext('2d', { willReadFrequently: true });
      this.screenRenderCanvasElement = this.$refs.screenrendercanvas;

      this.screenCanvasElement = this.$refs.screencanvas;
      this.screenCanvasCtx = this.screenCanvasElement.getContext('2d', { willReadFrequently: true });

      this.baseScreenImgStitchedCanvasElement = this.$refs.matchresultcanvas;
      this.baseScreenImgStitchedCanvasCtx = this.baseScreenImgStitchedCanvasElement.getContext('2d', { willReadFrequently: true });

      let onResults = function (results) {
        this.cameraProcessLoop(results);
      }.bind(this);

      const hands = new Hands.Hands({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
      });
      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
      hands.onResults(onResults);

      const camera = new Camera.Camera(videoElement, {
        onFrame: async () => {
          await hands.send({ image: videoElement });
        },
        width: 1280,
        height: 720,
        facingMode: "environment"
      });
      camera.start();
    },
  },
  mounted: function () {
    this.startCameraProcessing();
  }
}
</script>

<style>
.videoContainer {
  display: none;
}

.bottomControls {
  /* Always on bottom of screen */
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background-color: #000000;
  color: #FFFFFF;
  padding: 10px;
}

#videocanvas {
  display: none;
}

#screencanvas {
  display: none;
}

#matchresultcanvas {
  display: none;
}
</style>