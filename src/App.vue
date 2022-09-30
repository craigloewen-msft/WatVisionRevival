<script setup>
import { RouterLink, RouterView } from "vue-router";
</script>

<template>
  <div class="wrapper">
    <nav>
      <RouterLink to="/">Home</RouterLink>
      <RouterLink to="/about">About</RouterLink>
      <RouterLink to="/camera">Camera</RouterLink>
    </nav>
  </div>

  <RouterView />
</template>

<script>
  export default {
    created() {
      this.$store.dispatch('settings/init');
    },
  }
</script>

<style scoped>

</style>
