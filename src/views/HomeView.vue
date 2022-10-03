<template>
  <div>
    <div class="container">
      <video class="input_video videoContainer"></video>
      <div>Main Canvas:</div>
      <div class="canvasContainer">
        <canvas ref="canvas" class="output_canvas" style="border:3px solid;"></canvas>
      </div>
      <div>Screen canvas: </div>
      <div class="canvasContainer">
        <canvas ref="screencanvas" class="output_canvas" style="border:3px solid;"></canvas>
      </div>
      <button v-on:click="getNewBaseScreenImage(this.lastSeenInputImage)">Snap new screen</button>
      <div>{{ OCRStatus }}</div>
      <div>Select progress: {{ selectProgress}}</div>
      <div>{{ selectStatus }}</div>
    </div>
  </div>
</template>

<script>
import Hands from "@mediapipe/hands"
import Camera from "@mediapipe/camera_utils"
import DrawUtils from "@mediapipe/drawing_utils"
import Tesseract from "tesseract.js"

export default {
  data: function () {
    return {
      canvasElement: null,
      canvasCtx: null,
      screenCanvasElement: null,
      screenCanvasCtx: null,
      screenBaseImg: null,
      screenBaseImgLoaded: false,
      lastSeenInputImage: null,
      OCRLinesData: null,
      OCRStatus: "Not Started",
      lineConfidenceThreshold: 60,
      selectProgress: 0,
      selectProgressSpeed: 0.12,
      selectStatus: "Not selected",
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
      return highestFingerTip;
    },
    fingerTipSelectionHandler() {
      // If the finger tip is not null 
      if (this.fingerTipPosition && this.OCRLinesData) {

        // Check if the finger tip is hovering over any of the OCR lines
        for (let i = 0; i < this.OCRLinesData.length; i++) {
          const line = this.OCRLinesData[i];
          let isHovering = this.fingerTipPosition.x < line.bbox.x1 && this.fingerTipPosition.x > line.bbox.x0 && this.fingerTipPosition.y < line.bbox.y1 && this.fingerTipPosition.y > line.bbox.y0;
          if (isHovering) {
            this.selectProgress += this.selectProgressSpeed;
            if (this.selectProgress > 1) {
              this.selectProgress = 0;
              this.selectStatus = "Selected! " + line.text;
              if ('speechSynthesis' in window) {
                console.log("Speech command!");
                var msg = new SpeechSynthesisUtterance(this.selectStatus);
                window.speechSynthesis.speak(msg);
              }
            }
            return;
          }
        }
      }

      this.selectProgress = 0;
    },
    async getNewBaseScreenImage(inputImage) {
      let newImgSave = inputImage.toDataURL();
      this.screenBaseImg = new Image();
      this.screenBaseImg.src = newImgSave;
      this.screenBaseImg.onload = function () {
        this.screenBaseImgLoaded = true;
      }.bind(this);

      let updateStatusFunction = function (logger) {
        this.OCRStatus = logger.status;
      }.bind(this);

      this.OCRLinesData = null;

      // Get OCR of new base screen image
      let dataResult = await Tesseract.recognize(newImgSave, 'eng', { logger: updateStatusFunction })
      console.log(dataResult);
      this.OCRLinesData = dataResult.data.lines;
      this.OCRStatus = "Done";

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

      console.log(this.OCRLinesData);
    },
    doScreenStitchingProcessing: function (handResults) {
      // Get image of new screen:
      let newScreenImg = handResults.image;

      // If there is no base image set it and we are done
      if (this.screenBaseImg == null) {
        this.getNewBaseScreenImage(newScreenImg);
        return;
      }

    },
    renderImages: function (handResults) {

      this.lastSeenInputImage = handResults.image;

      // Render the main canvas
      this.canvasCtx.save();
      this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
      this.canvasCtx.drawImage(
        handResults.image, 0, 0, this.canvasElement.width, this.canvasElement.height);
      if (handResults.multiHandLandmarks) {
        for (const landmarks of handResults.multiHandLandmarks) {
          DrawUtils.drawConnectors(this.canvasCtx, landmarks, Hands.HAND_CONNECTIONS,
            { color: '#00FF00', lineWidth: 5 });
          DrawUtils.drawLandmarks(this.canvasCtx, landmarks, { color: '#FF0000', lineWidth: 2 });
        }
        // If we have a finger tip position, draw a circle on it
        if (this.fingerTipPosition) {
          this.canvasCtx.beginPath();
          this.canvasCtx.arc(this.fingerTipPosition.x * this.canvasElement.width, this.fingerTipPosition.y * this.canvasElement.height, 10, 0, 2 * Math.PI);
          this.canvasCtx.stroke();
        }
      }
      this.canvasCtx.restore();

      // Render the screen canvas
      this.screenCanvasCtx.save();
      this.screenCanvasCtx.clearRect(0, 0, this.screenCanvasElement.width, this.screenCanvasElement.height);
      if (this.screenBaseImgLoaded) {
        this.screenCanvasCtx.drawImage(this.screenBaseImg, 0, 0, this.screenCanvasElement.width, this.screenCanvasElement.height);
      }
      // If we have a finger tip position, draw a circle on it
      if (this.fingerTipPosition) {
        if (this.selectProgress > 0) {
          this.screenCanvasCtx.strokeStyle = "#FFFFFF";
          this.screenCanvasCtx.beginPath();
          this.screenCanvasCtx.arc(this.fingerTipPosition.x * this.screenCanvasElement.width, this.fingerTipPosition.y * this.screenCanvasElement.height, 10, 0, 2 * Math.PI);
          this.screenCanvasCtx.stroke();
          // Fill in the circle based on the progress
          this.screenCanvasCtx.strokeStyle = "#00FF00";
          this.screenCanvasCtx.beginPath();
          this.screenCanvasCtx.arc(this.fingerTipPosition.x * this.screenCanvasElement.width, this.fingerTipPosition.y * this.screenCanvasElement.height, 10, 0, 2 * Math.PI * this.selectProgress);
          this.screenCanvasCtx.stroke();
        } else {
          this.screenCanvasCtx.beginPath();
          this.screenCanvasCtx.arc(this.fingerTipPosition.x * this.canvasElement.width, this.fingerTipPosition.y * this.canvasElement.height, 10, 0, 2 * Math.PI);
          this.screenCanvasCtx.stroke();
        }
      }
      // If we have line data draw the bounding boxes
      if (this.OCRLinesData) {
        this.OCRLinesData.forEach((line) => {
          this.screenCanvasCtx.beginPath();
          let confidence = line.confidence;

          // Set the stroke color from red to green based on confidence
          let red = Math.floor(255.0 * (100 - confidence) / 100.0);
          let green = Math.floor(255.0 * confidence / 100.0);
          this.screenCanvasCtx.strokeStyle = `rgb(${red},${green},0)`;

          this.screenCanvasCtx.rect(line.bbox.x0 * this.screenCanvasElement.width, line.bbox.y0 * this.screenCanvasElement.height, (line.bbox.x1 - line.bbox.x0) * this.screenCanvasElement.width, (line.bbox.y1 - line.bbox.y0) * this.screenCanvasElement.height);
          this.screenCanvasCtx.stroke();
        })
      }

      this.screenCanvasCtx.restore();

    },
    cameraProcessLoop: function (handResults) {

      // Get finger tip position
      this.fingerTipPosition = this.getFingerTipPosition(handResults);

      // Handle finger tip selection
      this.fingerTipSelectionHandler();

      // Do screen processing to identify if screen stitching is needed
      this.doScreenStitchingProcessing(handResults);

      // Render any images
      this.renderImages(handResults);

    },
    startCameraProcessing: function () {

      const videoElement = document.getElementsByClassName('input_video')[0];
      this.canvasElement = this.$refs.canvas;
      this.canvasCtx = this.canvasElement.getContext('2d');

      this.screenCanvasElement = this.$refs.screencanvas;
      this.screenCanvasCtx = this.screenCanvasElement.getContext('2d');

      this.canvasElement.width = 640;
      this.canvasElement.height = 360;

      this.screenCanvasElement.width = 640;
      this.screenCanvasElement.height = 360;

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
        height: 720
      });
      camera.start();



    }
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
</style>