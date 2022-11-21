<template>
  <div>
    <div class="container">
      <video class="input_video videoContainer"></video>
      <div>Render Canvas:</div>
      <div class="canvasContainer">
        <canvas ref="rendercanvas" class="output_canvas" style="border:3px solid;"></canvas>
      </div>
      <div>Video Canvas:</div>
      <div class="canvasContainer">
        <canvas ref="videocanvas" class="output_canvas" style="border:3px solid;"></canvas>
      </div>
      <div>Screen base: </div>
      <div class="canvasContainer">
        <canvas ref="screencanvas" class="output_canvas" style="border:3px solid;"></canvas>
      </div>
      <div>Screen render: </div>
      <div class="canvasContainer">
        <canvas ref="screenrendercanvas" class="output_canvas" style="border:3px solid;"></canvas>
      </div>
      <button v-on:click="getNewBaseScreenImage(this.lastSeenInputImage)">Snap new screen</button>
      <button v-on:click="manualMatch()">Check match</button>
      <div>{{ OCRStatus }}</div>
      <div>Select progress: {{ selectProgress }}</div>
      <div>{{ selectStatus }}</div>
      <div>Action info: {{ currentActionInfo }}</div>
      <div>
        <h3>Result</h3>
        <div class="canvasContainer">
          <canvas ref="matchinfocanvas" class="output_canvas" id="matchinfocanvas" style="border:3px solid;"></canvas>
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
import ImageResult from '../components/common/ImageResult.vue';
import InputImages from '../components/common/InputImages.vue';
import { createWorker } from 'tesseract.js';
import imageFunctions from "../imageFunctions.js";

export default {
  components: {
    'AppImageResult': ImageResult,
    'AppInputImages': InputImages,
  },
  computed: {
    currentActionInfo() {
      return this.$store.getters['worker/currentActionInfo'];
    },
  },
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
      lineConfidenceThreshold: 60,
      selectProgress: 0,
      selectProgressSpeed: 0.12,
      selectStatus: "Not selected",
      lastSelectedText: "",
      lastSeenInputImageData: null,
      screenBaseImgData: null,
      screenRenderCanvasCtx: null,
      screenRenderCanvasElement: null,
      baseScreenImgStitchedCanvas: null,
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
    fingerTipSelectionHandler() {
      // If the finger tip is not null 
      if (this.fingerTipPosition && this.OCRLinesData) {

        let absoluteFingerTipPosition = {};
        absoluteFingerTipPosition.x = this.fingerTipPosition.x / this.screenCanvasElement.width;
        absoluteFingerTipPosition.y = this.fingerTipPosition.y / this.screenCanvasElement.height;

        // Check if the finger tip is hovering over any of the OCR lines
        for (let i = 0; i < this.OCRLinesData.length; i++) {
          const line = this.OCRLinesData[i];
          let isHovering = absoluteFingerTipPosition.x < line.bbox.x1 && absoluteFingerTipPosition.x > line.bbox.x0 && absoluteFingerTipPosition.y < line.bbox.y1 && absoluteFingerTipPosition.y > line.bbox.y0;
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

      let newImgSave = inputImage.toDataURL();
      this.screenBaseImg = new Image();
      this.screenBaseImg.src = newImgSave;
      this.screenBaseImg.onload = function () {
        this.screenBaseImgLoaded = true;

        // Draw the image to the screen canvas
        this.screenCanvasCtx.drawImage(this.screenBaseImg, 0, 0, this.screenCanvasElement.width, this.screenCanvasElement.height);

        // Get the image data
        this.screenBaseImgData = this.screenCanvasCtx.getImageData(0, 0, this.screenCanvasElement.width, this.screenCanvasElement.height);
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
    doScreenStitchingProcessing: function (handResults) {
      // Get image of new screen:
      let newScreenImg = handResults.image;

      // If there is no base image set it and we are done
      if (this.screenBaseImg == null) {
        this.getNewBaseScreenImage(newScreenImg);
        return;
      }

    },
    async manualMatch() {
      // await this.match(this.screenBaseImgData, this.lastSeenInputImageData);
      await this.match(this.lastSeenInputImageData, this.screenBaseImgData);
    },
    async match(inFixedImage, inMovingImage) {
      // Get ImageData from Image
      try {
        let [matchImage, resultImage, homographyMat] = imageFunctions.doCVStuff(inMovingImage, inFixedImage);

        this.homographyMat = homographyMat;
        cv.imshow('matchresultcanvas', resultImage);
        cv.imshow('matchinfocanvas', matchImage);

      } catch (error) {
        console.log("Error");
        console.log(error);
      }
    },
    async checkMatch() {
      console.log(this.$store.getters['worker/results/success']('result'));
    },
    mapNewFrameOntoScreen: function (handResults) {
      if (this.screenBaseImg) {
        // this.manualMatch();
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
      canvasToRenderCtx.restore();

      // Render the screen render canvas
      let screenCanvasCtxToRender = this.screenRenderCanvasCtx;
      let screenCanvasElementToRender = this.screenRenderCanvasElement;

      screenCanvasElementToRender.width = this.baseScreenImgStitchedCanvas.width;
      screenCanvasElementToRender.height = this.baseScreenImgStitchedCanvas.height;

      screenCanvasCtxToRender.save();
      screenCanvasCtxToRender.clearRect(0, 0, screenCanvasElementToRender.width, screenCanvasElementToRender.height);
      if (this.screenBaseImgLoaded) {
        // screenCanvasCtxToRender.drawImage(this.screenBaseImg, 0, 0, screenCanvasElementToRender.width, screenCanvasElementToRender.height);
        screenCanvasCtxToRender.drawImage(this.baseScreenImgStitchedCanvas, 0, 0, screenCanvasElementToRender.width, screenCanvasElementToRender.height);
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
        } else {
          screenCanvasCtxToRender.beginPath();
          screenCanvasCtxToRender.arc(this.fingerTipPosition.x, this.fingerTipPosition.y, 10, 0, 2 * Math.PI);
          screenCanvasCtxToRender.stroke();
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

      screenCanvasCtxToRender.restore();
    },
    cameraProcessLoop: function (handResults) {

      // Set last seen input image
      this.lastSeenInputImage = handResults.image;

      // Get lastSeenInputImageData
      this.lastSeenInputImageData = this.videoCanvasCtx.getImageData(0, 0, this.videoCanvasElement.width, this.videoCanvasElement.height);

      // Map new frame onto identified screen
      this.mapNewFrameOntoScreen(handResults);

      // Get finger tip position
      this.fingerTipPositionUnmapped = this.getFingerTipPosition(handResults);

      // Get finger tip position mapped to base image
      this.fingerTipPosition = this.mapFingerTipPositionToBaseImage(this.fingerTipPositionUnmapped);

      // Handle finger tip selection
      this.fingerTipSelectionHandler();

      // Do screen processing to identify if screen stitching is needed
      this.doScreenStitchingProcessing(handResults);

      // Render any images
      this.renderImages(handResults);

    },
    startCameraProcessing: function () {

      const videoElement = document.getElementsByClassName('input_video')[0];
      this.videoCanvasElement = this.$refs.videocanvas;
      this.videoCanvasCtx = this.videoCanvasElement.getContext('2d');

      this.videoCanvasElement.width = 640;
      this.videoCanvasElement.height = 360;

      this.renderCanvasElement = this.$refs.rendercanvas;
      this.renderCanvasCtx = this.renderCanvasElement.getContext('2d');

      this.renderCanvasElement.width = 640;
      this.renderCanvasElement.height = 360;

      this.screenRenderCanvasCtx = this.$refs.screenrendercanvas.getContext('2d');
      this.screenRenderCanvasElement = this.$refs.screenrendercanvas;

      this.screenRenderCanvasElement.width = 640;
      this.screenRenderCanvasElement.height = 360;

      this.screenCanvasElement = this.$refs.screencanvas;
      this.screenCanvasCtx = this.screenCanvasElement.getContext('2d');

      this.screenCanvasElement.width = 640;
      this.screenCanvasElement.height = 360;

      this.baseScreenImgStitchedCanvas = this.$refs.matchresultcanvas;

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
  created: function () {
    // this.$store.dispatch('input/init');
    // this.$store.dispatch('worker/load');
    // this.$store.commit('worker/results/matcherImageType', 'Side by side inlier matches');
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