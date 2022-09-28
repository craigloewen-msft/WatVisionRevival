<template>
  <div>
    <div class="container">
      <video class="input_video videoContainer"></video>
      <div class="canvasContainer">
        <canvas ref="canvas" class="output_canvas" style="border:3px solid;"></canvas>
      </div>
    </div>
  </div>
</template>

<script>
import Hands from "@mediapipe/hands"
import Camera from "@mediapipe/camera_utils"
import DrawUtils from "@mediapipe/drawing_utils"

export default {
  methods: {
    doCameraProcessing: function () {

      const videoElement = document.getElementsByClassName('input_video')[0];
      this.canvasElement = this.$refs.canvas;
      this.canvasCtx = this.canvasElement.getContext('2d');

      console.log("First canvas width", this.canvasElement.width);

      this.canvasElement.width = 640;
      this.canvasElement.height = 360;

      console.log("Second canvas width", this.canvasElement.width);


      let onResults = function (results) {
        console.log(this.canvasCtx);
        this.canvasCtx.save();
        console.log("Clearing rect", this.canvasElement.width, " yeee");
        this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
        console.log("Drawing image");
        this.canvasCtx.drawImage(
          results.image, 0, 0, this.canvasElement.width, this.canvasElement.height);
        if (results.multiHandLandmarks) {
          for (const landmarks of results.multiHandLandmarks) {
            DrawUtils.drawConnectors(this.canvasCtx, landmarks, Hands.HAND_CONNECTIONS,
              { color: '#00FF00', lineWidth: 5 });
            DrawUtils.drawLandmarks(this.canvasCtx, landmarks, { color: '#FF0000', lineWidth: 2 });
          }
        }
        this.canvasCtx.restore();
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

    // console.log("Store state: ", this.$store.state.count);
    this.doCameraProcessing();

  }
}
</script>

<style>
.videoContainer {
  width: 640;
  height: 360;
}
</style>