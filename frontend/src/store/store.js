import { createStore } from "vuex";

import input from '@/store/input';
import multiInput from '@/store/multiInput';
import worker from '@/store/worker';
import settings from '@/store/settings';
import logs from '@/store/logs';

export default createStore({
  //strict: true,
  state: {
  },
  getters: {
  },
  mutations: {
  },
  actions: {
  },
  modules: {
    worker,
    settings,
    input,
    multiInput,
    logs
  }
})
