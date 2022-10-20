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
      <button v-on:click="manualMatch()">Manual Match</button>
      <button v-on:click="checkMatch()">Check match</button>
      <div>{{ OCRStatus }}</div>
      <div>Select progress: {{ selectProgress}}</div>
      <div>{{ selectStatus }}</div>
      <div>Action info: {{ currentActionInfo }}</div>
      <div>
        <h3>Result</h3>
        <app-image-result :image-url="$store.getters['worker/results/newImageDataUrl']('result')"
          :image-name="'result'" />
        <app-input-images :polygons="$store.getters['input/polygons']" />
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
      canvasElement: null,
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
      await this.match(this.screenBaseImg, this.lastSeenInputImage);
    },
    async match(inFixedImage, inMovingImage) {

      await this.$store.dispatch('input/inputImageData', { name: "fixed", inImage: inFixedImage, width: this.screenBaseImgWidth, height: this.screenBaseImgHeight });
      await this.$store.dispatch('input/inputImageData', { name: "moving", inImage: inMovingImage, width: this.screenBaseImgWidth, height: this.screenBaseImgHeight });

      console.log("Fixed image before starting");
      console.log(this.$store.getters['input/imageData']("fixed"));

      await this.$store.dispatch('worker/computeStitchedImage', {
        fixedImage: this.$store.getters['input/imageData']("fixed"),
        movingImage: this.$store.getters['input/imageData']("moving"),
        fixedImagePolygonPts: this.$store.getters['input/polygonClosedPts']("fixed"),
        movingImagePolygonPts: this.$store.getters['input/polygonClosedPts']("moving"),
        settings: this.$store.getters['settings/settings']
      });

      if (this.$store.getters['worker/results/success']('result')) {
        await this.$store.dispatch('worker/displayStitchedImage');
      }

    },
    async checkMatch() {
      console.log(this.$store.getters['worker/results/success']('result'));
    },
    mapNewFrameOntoScreen: function (handResults) {
      if (this.screenBaseImg) {
        let newScreenImg = handResults.image;

        // 

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

      // Map new frame onto identified screen
      this.mapNewFrameOntoScreen(handResults);

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
  created: function () {
    this.$store.dispatch('input/init');
    this.$store.dispatch('worker/load');
    this.$store.commit('worker/results/matcherImageType', 'Side by side inlier matches');
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