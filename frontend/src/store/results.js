
import { WorkerMatchResult } from '@/models/WorkerMatchResult';
import { WorkerCompareResult } from '@/models/WorkerCompareResult';
import { WorkerStitchResult } from '@/models/WorkerStitchResult';
import { WorkerMultiStitchResult } from '@/models/WorkerMultiStitchResult';

import { matchName, compareName, stitchName, multiStitchName } from '@/models/constants/images';
import { ImageDataConversion } from '@/utilities/ImageDataConversion';

const state = {
  imageResults: {
    [matchName]: new WorkerMatchResult(matchName, ImageDataConversion.imageSrcFromImageData),
    [compareName]: new WorkerCompareResult(compareName, ImageDataConversion.imageSrcFromImageData),
    [stitchName]: new WorkerStitchResult(stitchName, ImageDataConversion.imageSrcFromImageData),
    [multiStitchName]: new WorkerMultiStitchResult(stitchName, ImageDataConversion.imageSrcFromImageData)
  }
}

const getters = {
  imageData(state) {
    return name => state.imageResults[name].imageData;
  },
  imageDataUrl(state) {
    console.log("Getting image data url");
    return name => {
      console.log("State: ", state);
      console.log("Image results: ", state.imageResults);
      console.log("Image results name: ", state.imageResults[name]);
      state.imageResults[name].imageDataUrl;
    }
  },
  newImageDataUrl() {
    console.log("Getting image data url");
    return name => {
      console.log("State: ", state);
      console.log("Image results: ", state.imageResults);
      console.log("Image results name: ", state.imageResults[name]);
      return state.imageResults[name].imageDataUrl;
    }
  },
  imageDataValid(state) {
    return name => state.imageResults[name].imageDataValid;
  },
  success(state) {
    return name => {
      console.log("Getting result for: ", name);
      console.log(state.imageResults);
      console.log(state.imageResults[name]);
      return state.imageResults[name].success;
    }
  },
  time(state) {
    return name => state.imageResults[name].time;
  },
  settings(state) {
    return name => state.imageResults[name].settings;
  },

  matcherImageType(state) {
    return state.imageResults[matchName].matcherImageType;
  },
  matcherImageBlend(state) {
    return state.imageResults[matchName].matcherImageBlend;
  },

  compareTimeUsedPerDet(state) {
    return state.imageResults[compareName].compareTimeUsedPerDet;
  },
  compareKeyPointsCountPerDet(state) {
    return state.imageResults[compareName].compareKeyPointsCountPerDet;
  },

  stitcherProjected(state) {
    return state.imageResults[stitchName].projected;
  },
  stitcherFieldOfView(state) {
    return state.imageResults[stitchName].fieldOfView;
  },

  multiStitcherFieldOfView(state) {
    return state.imageResults[multiStitchName].fieldOfView;
  }
}

const mutations = {
  imageData(state, { name, imageData, imageDataSmall }) {
    console.log("Mutating image data for: ", name);
    console.log(imageData);
    if (!imageData) {
      console.log("Yes Image data existed");
      state.imageResults[name].imageData = null;
    }
    else {
      console.log("No image data existed");
      console.log(state.imageResults[name]);
      state.imageResults[name].setImageData(imageData, imageDataSmall);
    }
  },
  success(state, { name, success }) {
    state.imageResults[name].success = success;
  },
  time(state, { name, time }) {
    state.imageResults[name].time = time;
  },
  settings(state, { name, settings }) {
    if (!settings) return;
    settings.copyValuesTo(state.imageResults[name].settings);
  },

  matcherImageType(state, value) {
    state.imageResults[matchName].matcherImageType = value;
  },
  matcherImageTypeSetDefault(state) {
    state.imageResults[matchName].setDefault();
  },
  matcherImageBlend(state, value) {
    state.imageResults[matchName].matcherImageBlend = value;
  },

  compareTimeUsedPerDet(state, valueArr) {
    state.imageResults[compareName].compareTimeUsedPerDet = valueArr;
  },
  compareKeyPointsCountPerDet(state, valueArr) {
    state.imageResults[compareName].compareKeyPointsCountPerDet = valueArr;
  },

  stitcherProjected(state, value) {
    return state.imageResults[stitchName].projected = value;
  },
  stitcherFieldOfView(state, value) {
    return state.imageResults[stitchName].fieldOfView = value;
  },

  multiStitcherFieldOfView(state, value) {
    return state.imageResults[multiStitchName].fieldOfView = value;
  }
}

const actions = {
}

export default {
  namespaced: true,
  state,
  getters,
  mutations,
  actions
};