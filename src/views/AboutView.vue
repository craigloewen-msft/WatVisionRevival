<template>
  <div class="about">
    <h1>This is an about page</h1>

    <div class="top-controls">

      <div class="upload-btn" v-for="(imageName, index) of $store.getters['input/allImageNames']" :key="imageName">
        <input type="file" @change="event => generateFileChangeHandler(imageName,event)" accept="image/*">
        <label> {{ imageName }}
        </label>
      </div>

      <button
          @click="stitch">
          Stitch
        </button>

    </div>


    <app-input-images :polygons="$store.getters['input/polygons']" @addPolygonPoint="addPolygonPt" />

    <h3>Result</h3>
    <app-image-result
          :image-url="$store.getters['worker/results/imageDataUrl'](stitchName)"
          :image-name="stitchName"
          :projected="$store.getters['worker/results/stitcherProjected']"
          :field-of-view="$store.getters['worker/results/stitcherFieldOfView']"
        />
  </div>
</template>

<script>
import InputImages from '../components/common/InputImages.vue';
import ActionBar from '../components/common/ActionBar2.vue';
import ImageResult from '../components/common/ImageResult.vue';
import { fixedImageName, movingImageName, stitchName } from '@/models/constants/images';

export default {
  components: {
    'AppActionBar': ActionBar,
    'AppInputImages': InputImages,
    'AppImageResult': ImageResult,
  },
  computed: {

    stitchName() {
      return stitchName;
    },
    resultValid() {
      return this.$store.getters['worker/results/imageDataValid'](stitchName);
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

      if (this.$store.getters['worker/results/success'](stitchName)) {
        await this.$store.dispatch('worker/displayStitchedImage');
      }
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
      console.log("e: ",e);
      this.onFileChanged("Whattt",e.target.files[0])
    },
    generateFileChangeHandler(inName,e) {
      console.log("Generating file change handler",inName);
      this.onFileChanged(inName,e.target.files[0]);
    }
  },
  created() {
    console.log("Initting store");
    this.$store.dispatch('input/init');
    this.$store.dispatch('worker/load');
  },
}

</script>

<style>

</style>
