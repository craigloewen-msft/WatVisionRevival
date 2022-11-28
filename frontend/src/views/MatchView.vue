<template>
  <div class="about">
    <h1>This is an about page</h1>

    <div class="top-controls">

      <div class="upload-btn" v-for="(imageName, index) of $store.getters['input/allImageNames']" :key="imageName">
        <input type="file" @change="event => generateFileChangeHandler(imageName,event)" accept="image/*">
        <label> {{ imageName }}
        </label>
      </div>

      <button @click="match">
        Match
      </button>

      <div>
        Worker busy compute: {{ $store.getters['worker/busyCompute']}}
        Worker Action info: {{ $store.getters['worker/currentActionInfo']}}
        Worker Action info error: {{ $store.getters['logs/currentErrorMessage']}}
      </div>

    </div>


    <app-input-images :polygons="$store.getters['input/polygons']" />

    <h3>Result</h3>
    <app-image-result :image-url="$store.getters['worker/results/newImageDataUrl'](matchName)"
      :image-name="matchName" />
    <div class="canvasContainer">
      <canvas ref="canvas" class="output_canvas" id="output_canvas" style="border:3px solid;"></canvas>
      <canvas ref="canvas2" class="output_canvas" id="output_canvas2" style="border:3px solid;"></canvas>
    </div>
    <button v-on:click="getImageData">Get Image Data</button>
  </div>
</template>

<script>
import InputImages from '../components/common/InputImages.vue';
import ActionBar from '../components/common/ActionBar2.vue';
import ImageResult from '../components/common/ImageResult.vue';
import { fixedImageName, movingImageName, matchName } from '@/models/constants/images';
import imageFunctions from "../imageFunctions.js";

import defaultImage1 from '@/assets/zauberSchuleTemplate.jpg';
import defaultImage2 from '@/assets/zauberSchuleAlign.jpg';

export default {
  components: {
    'AppActionBar': ActionBar,
    'AppInputImages': InputImages,
    'AppImageResult': ImageResult,
  },
  computed: {

    matchName() {
      return matchName;
    },
    resultValid() {
      return this.$store.getters['worker/results/imageDataValid'](matchName);
    },
    errorText() {
      const e = this.$store.getters['worker/error'];
      if (e && e.message) return e.message;
      return 'No match found!';
    },
    detTypeName() {
      return ParamUtils.getParamName(this.$store.getters['settings/param'](paramTypes.detType.id));
    },
    pathPtsFixedImage() {
      return this.$store.getters['input/pathPtsFixedImage'];
    },
    pathPtsMovingImage() {
      return this.$store.getters['input/pathPtsMovingImage'];
    },
    fieldOfViewInitialValue1() {
      return this.$store.getters['input/imageFieldOfView'](fixedImageName);
    },
    fieldOfViewInitialValue2() {
      return this.$store.getters['input/imageFieldOfView'](movingImageName);
    }
  },
  methods: {
    async stitch() {

      await this.$store.dispatch('worker/computeStitchedImage', {
        fixedImage: this.$store.getters['input/imageData'](fixedImageName),
        movingImage: this.$store.getters['input/imageData'](movingImageName),
        fixedImagePolygonPts: this.$store.getters['input/polygonClosedPts'](fixedImageName),
        movingImagePolygonPts: this.$store.getters['input/polygonClosedPts'](movingImageName),
        settings: this.$store.getters['settings/settings']
      });

      if (this.$store.getters['worker/results/success'](matchName)) {
        await this.$store.dispatch('worker/displayStitchedImage');
      }
    },
    async match() {
      // eslint-disable-next-line no-console
      console.assert(
        this.$store.getters['input/imageDataValid'](fixedImageName)
        && this.$store.getters['input/imageDataValid'](movingImageName),
        "Invalid InputData in Matcher.match");

      await this.$store.dispatch(
        'worker/computeAlignedImage', {
        fixedImage: this.$store.getters['input/imageData'](fixedImageName),
        movingImage: this.$store.getters['input/imageData'](movingImageName),
        fixedImagePolygonPts: this.$store.getters['input/polygonClosedPts'](fixedImageName),
        movingImagePolygonPts: this.$store.getters['input/polygonClosedPts'](movingImageName),
        settings: this.$store.getters['settings/settings']
      }
      );
    },
    getImageData() {
      // eslint-disable-next-line no-console
      let fixedImage = this.$store.getters['input/imageData'](fixedImageName);
      let movingImage = this.$store.getters['input/imageData'](movingImageName);
      // let [matchImage, resultImage] = imageFunctions.doCVStuff(fixedImage, movingImage);
      let [matchImage, resultImage] = imageFunctions.doCVStuff(movingImage,fixedImage);
      cv.imshow('output_canvas', resultImage);
      cv.imshow('output_canvas2', matchImage);
    },
    loadDefaultImages() {
      console.log("Before reset: ", this.$store.getters['input/imageDataUrl']);
      this.$store.dispatch('input/loadDefaultImages');
      this.$store.dispatch('worker/resetWorkerData');
    },
    onFileChanged(name, file) {
      console.log("Changing file: ", name);
      this.$store.dispatch('input/imageFile', { name, file });
    },
    fileChangeHandler(e) {
      console.log("e: ", e);
      this.onFileChanged("Whattt", e.target.files[0])
    },
    generateFileChangeHandler(inName, e) {
      console.log("Generating file change handler", inName);
      this.onFileChanged(inName, e.target.files[0]);
    }
  },
  created() {
    console.log("Initting store");
    this.$store.dispatch('input/init', { url1: defaultImage1, url2: defaultImage2 });
    this.$store.dispatch('worker/load');
    this.$store.commit('worker/results/matcherImageType', 'Side by side inlier matches');
  },
}

</script>

<style>

</style>
